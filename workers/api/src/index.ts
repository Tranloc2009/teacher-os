import { authenticateRequest, userHasAnyRole } from './auth';
import {
  buildSecurityHeaders,
  isOriginAllowed,
  parseAllowedOrigins,
} from './cors';
import {
  claimDurableIdempotencyKey,
  completeDurableIdempotencyKey,
  hashIdempotencyPayload,
  releaseDurableIdempotencyKey,
  validateIdempotencyKey,
} from './idempotency';
import {
  checkGlobalDurableRateLimit,
  extractClientIdentifier,
  IsolateBestEffortRateLimiter,
} from './rateLimit';
import type {
  ApiErrorPayload,
  AuthenticatedUser,
  ExecutionContextLike,
  RateLimitResult,
  WorkerDependencies,
  WorkerEnv,
} from './types';
import {
  isValidUuid,
  readValidatedJsonBody,
  validateCreateClassroomInput,
  validateGrantRoleInput,
} from './validation';

const DEFAULT_RATE_LIMIT_MAX = 60;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MUTATION_RATE_LIMIT_MAX = 20;
const DEFAULT_MUTATION_RATE_LIMIT_WINDOW_SEC = 60;

function jsonResponse(
  status: number,
  body: unknown,
  baseHeaders: Headers,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers(baseHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  baseHeaders: Headers,
  details?: string[],
  extraHeaders?: Record<string, string>
): Response {
  const payload: ApiErrorPayload = {
    error: {
      code,
      message,
      requestId,
      ...(details && details.length > 0 ? { details } : {}),
    },
  };
  return jsonResponse(status, payload, baseHeaders, extraHeaders);
}

function applyRateLimitHeaders(headers: Headers, rate: RateLimitResult): void {
  headers.set('X-RateLimit-Limit', String(rate.limit));
  headers.set('X-RateLimit-Remaining', String(rate.remaining));
  headers.set('X-RateLimit-Scope', rate.scope);
}

function getSupabaseOrigin(env: WorkerEnv): string | null {
  if (!env.SUPABASE_URL) return null;
  try {
    return new URL(env.SUPABASE_URL.trim()).origin;
  } catch {
    return null;
  }
}

async function supabaseServiceRequest(
  env: WorkerEnv,
  pathWithQuery: string,
  options: {
    method: 'GET' | 'POST' | 'PATCH';
    body?: unknown;
    prefer?: string;
  },
  fetchImpl: typeof fetch
): Promise<Response> {
  const origin = getSupabaseOrigin(env);
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!origin || !secretKey) {
    throw new Error('SUPABASE_SERVICE_CONFIG_MISSING');
  }

  const headers: Record<string, string> = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.prefer) {
    headers['Prefer'] = options.prefer;
  }

  return fetchImpl(`${origin}/rest/v1/${pathWithQuery}`, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function recordAuditEvent(
  env: WorkerEnv,
  actor: AuthenticatedUser,
  eventType: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<void> {
  try {
    await supabaseServiceRequest(
      env,
      'audit_events',
      {
        method: 'POST',
        prefer: 'return=minimal',
        body: {
          actor_id: actor.id,
          actor_role: actor.primaryRole,
          event_type: eventType,
          resource_type: resourceType,
          resource_id: resourceId,
          metadata,
        },
      },
      fetchImpl
    );
  } catch {
    // Non-blocking audit persistence safeguard; never leak internal error details
  }
}

async function enforceMutationGuards(options: {
  request: Request;
  env: WorkerEnv;
  user: AuthenticatedUser;
  pathname: string;
  requestPayload: unknown;
  requestId: string;
  baseHeaders: Headers;
  fetchImpl: typeof fetch;
}): Promise<
  | { ok: true; idempotencyKey: string }
  | { ok: false; response: Response }
> {
  const {
    request,
    env,
    user,
    pathname,
    requestPayload,
    requestId,
    baseHeaders,
    fetchImpl,
  } = options;

  // 1. Validate Idempotency-Key header format
  const idemCheck = validateIdempotencyKey(
    request.headers.get('Idempotency-Key')
  );
  if (!idemCheck.valid || !idemCheck.key) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'INVALID_IDEMPOTENCY_KEY',
        idemCheck.error ?? 'Thiếu Idempotency-Key hợp lệ.',
        requestId,
        baseHeaders
      ),
    };
  }

  // 2. Global Multi-Instance Durable Rate Limit (PostgreSQL-backed)
  const mutLimit =
    Number(env.MUTATION_RATE_LIMIT_MAX) || DEFAULT_MUTATION_RATE_LIMIT_MAX;
  const mutWindowSec =
    Number(env.MUTATION_RATE_LIMIT_WINDOW_SEC) ||
    DEFAULT_MUTATION_RATE_LIMIT_WINDOW_SEC;
  const globalRateCheck = await checkGlobalDurableRateLimit(
    env,
    `mut:${user.id}:${pathname}`,
    mutLimit,
    mutWindowSec,
    fetchImpl
  );

  if (!globalRateCheck.ok) {
    return {
      ok: false,
      response: errorResponse(
        503,
        'RATE_LIMIT_STORE_UNAVAILABLE',
        globalRateCheck.message,
        requestId,
        baseHeaders
      ),
    };
  }

  applyRateLimitHeaders(baseHeaders, globalRateCheck.result);
  if (!globalRateCheck.result.allowed) {
    return {
      ok: false,
      response: errorResponse(
        429,
        'RATE_LIMIT_EXCEEDED',
        'Vượt giới hạn số lần ghi dữ liệu toàn cục. Vui lòng thử lại sau.',
        requestId,
        baseHeaders,
        undefined,
        { 'Retry-After': String(globalRateCheck.result.retryAfterSeconds) }
      ),
    };
  }

  // 3. Durable PostgreSQL-backed Idempotency Claim (atomic across all Worker isolates)
  const requestHash = await hashIdempotencyPayload(requestPayload);
  const claim = await claimDurableIdempotencyKey(
    env,
    {
      actorId: user.id,
      method: request.method,
      routePath: pathname,
      idempotencyKey: idemCheck.key,
      requestHash,
    },
    fetchImpl
  );

  if (claim.outcome === 'replay') {
    return {
      ok: false,
      response: jsonResponse(claim.status, claim.body, baseHeaders, {
        'X-Idempotent-Replay': 'true',
        'X-Idempotency-Backing': 'postgres-durable',
      }),
    };
  }

  if (claim.outcome === 'conflict_payload') {
    return {
      ok: false,
      response: errorResponse(
        409,
        'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
        'Idempotency-Key này đã được sử dụng cho một nội dung yêu cầu khác.',
        requestId,
        baseHeaders
      ),
    };
  }

  if (claim.outcome === 'in_progress') {
    return {
      ok: false,
      response: errorResponse(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'Yêu cầu có cùng Idempotency-Key đang được xử lý. Vui lòng thử lại sau giây lát.',
        requestId,
        baseHeaders,
        undefined,
        { 'Retry-After': '1' }
      ),
    };
  }

  if (claim.outcome === 'store_unavailable') {
    return {
      ok: false,
      response: errorResponse(
        503,
        'IDEMPOTENCY_STORE_UNAVAILABLE',
        claim.message,
        requestId,
        baseHeaders
      ),
    };
  }

  return { ok: true, idempotencyKey: idemCheck.key };
}

export function createWorkerHandler(deps: WorkerDependencies = {}) {
  const isolateRateLimiter = new IsolateBestEffortRateLimiter();

  return {
    isolateRateLimiter,
    async fetch(
      request: Request,
      env: WorkerEnv,
      _ctx?: ExecutionContextLike
    ): Promise<Response> {
      const fetchImpl = deps.fetchImpl ?? fetch;
      const nowMs = (deps.now ?? Date.now)();
      const requestId = crypto.randomUUID();
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      const requestOrigin = request.headers.get('Origin');
      const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
      const baseHeaders = buildSecurityHeaders(
        requestOrigin,
        allowedOrigins,
        requestId
      );

      // 1. Strict Origin / CORS enforcement (never wildcard '*')
      if (requestOrigin && !isOriginAllowed(requestOrigin, allowedOrigins)) {
        return errorResponse(
          403,
          'ORIGIN_NOT_ALLOWED',
          'Origin không nằm trong danh sách ALLOWED_ORIGINS được phép truy cập.',
          requestId,
          baseHeaders
        );
      }

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: baseHeaders });
      }

      // 2. Tier-1 Isolate Best-Effort Rate Limiting (fast guard on all routes)
      //    Honest scope header: isolate-best-effort (NOT claimed as global).
      const rateMax = Number(env.RATE_LIMIT_MAX) || DEFAULT_RATE_LIMIT_MAX;
      const rateWindowMs =
        Number(env.RATE_LIMIT_WINDOW_MS) || DEFAULT_RATE_LIMIT_WINDOW_MS;
      const clientId = extractClientIdentifier(request);
      const rateKey = `${clientId}:${pathname}`;
      const isolateRate = isolateRateLimiter.check(
        rateKey,
        rateMax,
        rateWindowMs,
        nowMs
      );

      applyRateLimitHeaders(baseHeaders, isolateRate);

      if (!isolateRate.allowed) {
        return errorResponse(
          429,
          'RATE_LIMIT_EXCEEDED',
          'Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau ít giây.',
          requestId,
          baseHeaders,
          undefined,
          { 'Retry-After': String(isolateRate.retryAfterSeconds) }
        );
      }

      // 3. Explicit Denial for Direct Answer-Key Probing
      if (
        pathname.includes('official_answer_keys') ||
        pathname.includes('exam_private') ||
        pathname.startsWith('/api/v1/answer-keys')
      ) {
        return errorResponse(
          403,
          'ANSWER_KEYS_FORBIDDEN',
          'Đáp án chính thức được bảo vệ tuyệt đối phía server và không bao giờ mở qua API công khai.',
          requestId,
          baseHeaders
        );
      }

      // 4. Public Minimal Liveness Endpoint (ZERO secrets, ZERO service_role calls)
      if (request.method === 'GET' && pathname === '/api/health') {
        const hasSupabaseUrl = Boolean(getSupabaseOrigin(env));
        const hasSecretKey = Boolean(env.SUPABASE_SECRET_KEY?.trim());
        return jsonResponse(
          200,
          {
            ok: true,
            service: 'teacheros-api',
            phase: '4A',
            tier: 'cloudflare-workers-free',
            configured: hasSupabaseUrl && hasSecretKey,
            idempotencyBacking: 'postgres-durable',
            rateLimitModel: {
              publicRoutes: 'isolate-best-effort',
              authenticatedMutations: 'global-db-backed',
            },
            timestamp: new Date(nowMs).toISOString(),
          },
          baseHeaders
        );
      }

      // 5. All /api/v1/* routes require verified JWT + authoritative DB roles
      if (!pathname.startsWith('/api/v1/')) {
        return errorResponse(
          404,
          'ROUTE_NOT_FOUND',
          'Không tìm thấy đường dẫn API yêu cầu.',
          requestId,
          baseHeaders
        );
      }

      const auth = await authenticateRequest(request, env, fetchImpl, nowMs);
      if (!auth.ok) {
        return errorResponse(
          auth.status,
          auth.code,
          auth.message,
          requestId,
          baseHeaders
        );
      }
      const user = auth.user;

      // 5.1 GET /api/v1/auth/me — Verified Identity & Authoritative Roles
      if (request.method === 'GET' && pathname === '/api/v1/auth/me') {
        return jsonResponse(
          200,
          {
            user: {
              id: user.id,
              email: user.email,
              roles: user.roles,
              primaryRole: user.primaryRole,
              verifiedVia: user.verifiedVia,
            },
          },
          baseHeaders
        );
      }

      // 5.2 GET /api/v1/diagnostics — Teacher/Admin safe readiness check (NO secrets)
      if (request.method === 'GET' && pathname === '/api/v1/diagnostics') {
        if (!userHasAnyRole(user, ['teacher', 'admin'])) {
          return errorResponse(
            403,
            'FORBIDDEN_ROLE',
            'Chỉ giáo viên hoặc quản trị viên mới có quyền xem chẩn đoán backend.',
            requestId,
            baseHeaders
          );
        }

        return jsonResponse(
          200,
          {
            ok: true,
            service: 'teacheros-api',
            phase: '4A',
            actorRole: user.primaryRole,
            checks: {
              supabaseUrlConfigured: Boolean(getSupabaseOrigin(env)),
              serverSecretConfigured: Boolean(env.SUPABASE_SECRET_KEY?.trim()),
              publishableKeyConfigured: Boolean(
                env.SUPABASE_PUBLISHABLE_KEY?.trim()
              ),
              corsAllowlistCount: allowedOrigins.length,
              privateAnswerKeySchemaProtected: true,
              durableIdempotencyMode: 'postgres-unique-rpc',
              rateLimitPublicMode: 'isolate-best-effort',
              rateLimitMutationMode: 'global-db-backed',
            },
          },
          baseHeaders
        );
      }

      // 5.3 POST /api/v1/roles/grant — STRICTLY ADMIN ONLY + Durable DB Idempotency + Global DB Rate Limit
      if (request.method === 'POST' && pathname === '/api/v1/roles/grant') {
        if (!userHasAnyRole(user, ['admin'])) {
          return errorResponse(
            403,
            'ADMIN_REQUIRED',
            'Chỉ quản trị viên (admin) mới được cấp quyền hệ thống.',
            requestId,
            baseHeaders
          );
        }

        const parsedBody = await readValidatedJsonBody(request);
        if (!parsedBody.ok) {
          return errorResponse(
            parsedBody.status,
            parsedBody.code,
            parsedBody.message,
            requestId,
            baseHeaders
          );
        }

        const validated = validateGrantRoleInput(parsedBody.data);
        if (!validated.ok) {
          return errorResponse(
            400,
            'VALIDATION_ERROR',
            'Dữ liệu cấp quyền không hợp lệ.',
            requestId,
            baseHeaders,
            validated.details
          );
        }

        const guard = await enforceMutationGuards({
          request,
          env,
          user,
          pathname,
          requestPayload: {
            targetUserId: validated.targetUserId,
            role: validated.role,
          },
          requestId,
          baseHeaders,
          fetchImpl,
        });
        if (!guard.ok) return guard.response;

        const dbRes = await supabaseServiceRequest(
          env,
          'user_roles?on_conflict=user_id,role',
          {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: {
              user_id: validated.targetUserId,
              role: validated.role,
              granted_by: user.id,
            },
          },
          fetchImpl
        );

        if (!dbRes.ok) {
          await releaseDurableIdempotencyKey(
            env,
            {
              actorId: user.id,
              method: request.method,
              routePath: pathname,
              idempotencyKey: guard.idempotencyKey,
            },
            fetchImpl
          );
          return errorResponse(
            502,
            'UPSTREAM_ROLE_GRANT_FAILED',
            'Không thể cập nhật vai trò người dùng trên cơ sở dữ liệu.',
            requestId,
            baseHeaders
          );
        }

        await recordAuditEvent(
          env,
          user,
          'role.granted',
          'user_roles',
          validated.targetUserId,
          { role: validated.role },
          fetchImpl
        );

        const responsePayload = {
          ok: true,
          granted: {
            targetUserId: validated.targetUserId,
            role: validated.role,
            grantedBy: user.id,
          },
        };

        await completeDurableIdempotencyKey(
          env,
          {
            actorId: user.id,
            method: request.method,
            routePath: pathname,
            idempotencyKey: guard.idempotencyKey,
            responseStatus: 201,
            responseBody: responsePayload,
          },
          fetchImpl
        );

        return jsonResponse(201, responsePayload, baseHeaders, {
          'X-Idempotency-Backing': 'postgres-durable',
        });
      }

      // 5.4 GET /api/v1/teacher/classrooms — Scoped strictly to teacher_id = user.id
      if (
        request.method === 'GET' &&
        pathname === '/api/v1/teacher/classrooms'
      ) {
        if (!userHasAnyRole(user, ['teacher', 'admin'])) {
          return errorResponse(
            403,
            'TEACHER_REQUIRED',
            'Chỉ giáo viên mới được truy cập danh sách lớp học giảng dạy.',
            requestId,
            baseHeaders
          );
        }

        const query = `classrooms?teacher_id=eq.${encodeURIComponent(user.id)}&select=id,teacher_id,name,subject,grade,school_year,join_code,is_archived,created_at&order=created_at.desc`;
        const dbRes = await supabaseServiceRequest(
          env,
          query,
          { method: 'GET' },
          fetchImpl
        );

        if (!dbRes.ok) {
          return errorResponse(
            502,
            'UPSTREAM_QUERY_FAILED',
            'Không thể tải danh sách lớp học.',
            requestId,
            baseHeaders
          );
        }

        const classrooms = await dbRes.json();
        return jsonResponse(200, { classrooms }, baseHeaders);
      }

      // 5.5 GET /api/v1/teacher/classrooms/:id — Ownership check (blocks Teacher A -> Teacher B)
      const classroomMatch = /^\/api\/v1\/teacher\/classrooms\/([^/]+)$/.exec(
        pathname
      );
      if (request.method === 'GET' && classroomMatch) {
        if (!userHasAnyRole(user, ['teacher', 'admin'])) {
          return errorResponse(
            403,
            'TEACHER_REQUIRED',
            'Chỉ giáo viên mới được xem chi tiết lớp học.',
            requestId,
            baseHeaders
          );
        }

        const classroomId = classroomMatch[1];
        if (!isValidUuid(classroomId)) {
          return errorResponse(
            400,
            'INVALID_CLASSROOM_ID',
            'Mã lớp học phải là UUID hợp lệ.',
            requestId,
            baseHeaders
          );
        }

        const dbRes = await supabaseServiceRequest(
          env,
          `classrooms?id=eq.${encodeURIComponent(classroomId)}&select=id,teacher_id,name,subject,grade,school_year,join_code,is_archived`,
          { method: 'GET' },
          fetchImpl
        );

        if (!dbRes.ok) {
          return errorResponse(
            502,
            'UPSTREAM_QUERY_FAILED',
            'Không thể truy vấn thông tin lớp học.',
            requestId,
            baseHeaders
          );
        }

        const rows = (await dbRes.json()) as Array<{
          id: string;
          teacher_id: string;
        }>;
        const classroom = Array.isArray(rows) ? rows[0] : null;
        if (!classroom) {
          return errorResponse(
            404,
            'CLASSROOM_NOT_FOUND',
            'Không tìm thấy lớp học yêu cầu.',
            requestId,
            baseHeaders
          );
        }

        if (
          classroom.teacher_id !== user.id &&
          !userHasAnyRole(user, ['admin'])
        ) {
          return errorResponse(
            403,
            'OWNERSHIP_VIOLATION',
            'Bạn không có quyền truy cập lớp học thuộc về giáo viên khác.',
            requestId,
            baseHeaders
          );
        }

        return jsonResponse(200, { classroom }, baseHeaders);
      }

      // 5.6 POST /api/v1/teacher/classrooms — Validated + Durable DB Idempotency + Global DB Rate Limit
      if (
        request.method === 'POST' &&
        pathname === '/api/v1/teacher/classrooms'
      ) {
        if (!userHasAnyRole(user, ['teacher', 'admin'])) {
          return errorResponse(
            403,
            'TEACHER_REQUIRED',
            'Chỉ giáo viên mới được tạo lớp học mới.',
            requestId,
            baseHeaders
          );
        }

        const parsedBody = await readValidatedJsonBody(request);
        if (!parsedBody.ok) {
          return errorResponse(
            parsedBody.status,
            parsedBody.code,
            parsedBody.message,
            requestId,
            baseHeaders
          );
        }

        const validated = validateCreateClassroomInput(parsedBody.data);
        if (!validated.ok) {
          return errorResponse(
            400,
            'VALIDATION_ERROR',
            'Thông tin lớp học không hợp lệ.',
            requestId,
            baseHeaders,
            validated.details
          );
        }

        const guard = await enforceMutationGuards({
          request,
          env,
          user,
          pathname,
          requestPayload: {
            name: validated.value.name,
            subject: validated.value.subject,
            grade: validated.value.grade,
            schoolYear: validated.value.schoolYear,
          },
          requestId,
          baseHeaders,
          fetchImpl,
        });
        if (!guard.ok) return guard.response;

        const dbRes = await supabaseServiceRequest(
          env,
          'classrooms',
          {
            method: 'POST',
            prefer: 'return=representation',
            body: {
              teacher_id: user.id, // Strictly derived from verified JWT
              name: validated.value.name,
              subject: validated.value.subject,
              grade: validated.value.grade,
              school_year: validated.value.schoolYear,
              join_code: validated.value.joinCode,
            },
          },
          fetchImpl
        );

        if (!dbRes.ok) {
          await releaseDurableIdempotencyKey(
            env,
            {
              actorId: user.id,
              method: request.method,
              routePath: pathname,
              idempotencyKey: guard.idempotencyKey,
            },
            fetchImpl
          );
          return errorResponse(
            502,
            'UPSTREAM_CREATE_FAILED',
            'Không thể tạo lớp học trên cơ sở dữ liệu.',
            requestId,
            baseHeaders
          );
        }

        const createdRows = (await dbRes.json()) as Array<{ id?: string }>;
        const classroom = Array.isArray(createdRows) ? createdRows[0] : createdRows;

        await recordAuditEvent(
          env,
          user,
          'classroom.created',
          'classrooms',
          typeof classroom?.id === 'string' ? classroom.id : null,
          { name: validated.value.name, grade: validated.value.grade },
          fetchImpl
        );

        const responsePayload = { ok: true, classroom };
        await completeDurableIdempotencyKey(
          env,
          {
            actorId: user.id,
            method: request.method,
            routePath: pathname,
            idempotencyKey: guard.idempotencyKey,
            responseStatus: 201,
            responseBody: responsePayload,
          },
          fetchImpl
        );

        return jsonResponse(201, responsePayload, baseHeaders, {
          'X-Idempotency-Backing': 'postgres-durable',
        });
      }

      // 5.7 GET /api/v1/student/attempts/:id — Strict Student Ownership Isolation
      const attemptGetMatch = /^\/api\/v1\/student\/attempts\/([^/]+)$/.exec(
        pathname
      );
      if (request.method === 'GET' && attemptGetMatch) {
        const attemptId = attemptGetMatch[1];
        if (!isValidUuid(attemptId)) {
          return errorResponse(
            400,
            'INVALID_ATTEMPT_ID',
            'Mã bài làm phải là UUID hợp lệ.',
            requestId,
            baseHeaders
          );
        }

        const dbRes = await supabaseServiceRequest(
          env,
          `exam_attempts?id=eq.${encodeURIComponent(attemptId)}&select=id,assignment_id,version_id,student_id,attempt_number,status,started_at,submitted_at`,
          { method: 'GET' },
          fetchImpl
        );

        if (!dbRes.ok) {
          return errorResponse(
            502,
            'UPSTREAM_QUERY_FAILED',
            'Không thể tải thông tin bài làm.',
            requestId,
            baseHeaders
          );
        }

        const rows = (await dbRes.json()) as Array<{
          id: string;
          student_id: string;
        }>;
        const attempt = Array.isArray(rows) ? rows[0] : null;
        if (!attempt) {
          return errorResponse(
            404,
            'ATTEMPT_NOT_FOUND',
            'Không tìm thấy bài làm yêu cầu.',
            requestId,
            baseHeaders
          );
        }

        if (attempt.student_id !== user.id && !userHasAnyRole(user, ['admin'])) {
          return errorResponse(
            403,
            'OWNERSHIP_VIOLATION',
            'Học sinh không có quyền xem bài làm của học sinh khác.',
            requestId,
            baseHeaders
          );
        }

        return jsonResponse(200, { attempt }, baseHeaders);
      }

      // 5.8 POST /api/v1/student/attempts/:id/submit — Ownership + Durable DB Idempotency + Zero Answer Leakage
      const attemptSubmitMatch =
        /^\/api\/v1\/student\/attempts\/([^/]+)\/submit$/.exec(pathname);
      if (request.method === 'POST' && attemptSubmitMatch) {
        const attemptId = attemptSubmitMatch[1];
        if (!isValidUuid(attemptId)) {
          return errorResponse(
            400,
            'INVALID_ATTEMPT_ID',
            'Mã bài làm phải là UUID hợp lệ.',
            requestId,
            baseHeaders
          );
        }

        const guard = await enforceMutationGuards({
          request,
          env,
          user,
          pathname,
          requestPayload: { attemptId },
          requestId,
          baseHeaders,
          fetchImpl,
        });
        if (!guard.ok) return guard.response;

        const lookupRes = await supabaseServiceRequest(
          env,
          `exam_attempts?id=eq.${encodeURIComponent(attemptId)}&select=id,student_id,status`,
          { method: 'GET' },
          fetchImpl
        );
        if (!lookupRes.ok) {
          await releaseDurableIdempotencyKey(
            env,
            {
              actorId: user.id,
              method: request.method,
              routePath: pathname,
              idempotencyKey: guard.idempotencyKey,
            },
            fetchImpl
          );
          return errorResponse(
            502,
            'UPSTREAM_QUERY_FAILED',
            'Không thể xác minh trạng thái bài làm.',
            requestId,
            baseHeaders
          );
        }

        const rows = (await lookupRes.json()) as Array<{
          id: string;
          student_id: string;
          status: string;
        }>;
        const attempt = Array.isArray(rows) ? rows[0] : null;
        if (!attempt) {
          await releaseDurableIdempotencyKey(
            env,
            {
              actorId: user.id,
              method: request.method,
              routePath: pathname,
              idempotencyKey: guard.idempotencyKey,
            },
            fetchImpl
          );
          return errorResponse(
            404,
            'ATTEMPT_NOT_FOUND',
            'Không tìm thấy bài làm yêu cầu.',
            requestId,
            baseHeaders
          );
        }

        if (attempt.student_id !== user.id) {
          await releaseDurableIdempotencyKey(
            env,
            {
              actorId: user.id,
              method: request.method,
              routePath: pathname,
              idempotencyKey: guard.idempotencyKey,
            },
            fetchImpl
          );
          return errorResponse(
            403,
            'OWNERSHIP_VIOLATION',
            'Bạn không có quyền nộp bài làm của học sinh khác.',
            requestId,
            baseHeaders
          );
        }

        if (attempt.status !== 'in_progress') {
          await releaseDurableIdempotencyKey(
            env,
            {
              actorId: user.id,
              method: request.method,
              routePath: pathname,
              idempotencyKey: guard.idempotencyKey,
            },
            fetchImpl
          );
          return errorResponse(
            409,
            'ATTEMPT_ALREADY_FINALIZED',
            'Bài làm đã được nộp hoặc đã kết thúc trước đó.',
            requestId,
            baseHeaders
          );
        }

        const submittedAt = new Date(nowMs).toISOString();
        const updateRes = await supabaseServiceRequest(
          env,
          `exam_attempts?id=eq.${encodeURIComponent(attemptId)}&student_id=eq.${encodeURIComponent(user.id)}`,
          {
            method: 'PATCH',
            prefer: 'return=representation',
            body: {
              status: 'submitted',
              submitted_at: submittedAt,
              idempotency_key: guard.idempotencyKey,
            },
          },
          fetchImpl
        );

        if (!updateRes.ok) {
          await releaseDurableIdempotencyKey(
            env,
            {
              actorId: user.id,
              method: request.method,
              routePath: pathname,
              idempotencyKey: guard.idempotencyKey,
            },
            fetchImpl
          );
          return errorResponse(
            502,
            'UPSTREAM_SUBMIT_FAILED',
            'Không thể cập nhật trạng thái nộp bài.',
            requestId,
            baseHeaders
          );
        }

        await recordAuditEvent(
          env,
          user,
          'attempt.submitted',
          'exam_attempts',
          attemptId,
          { submittedAt },
          fetchImpl
        );

        const responsePayload = {
          ok: true,
          attemptId,
          status: 'submitted',
          submittedAt,
        };

        await completeDurableIdempotencyKey(
          env,
          {
            actorId: user.id,
            method: request.method,
            routePath: pathname,
            idempotencyKey: guard.idempotencyKey,
            responseStatus: 200,
            responseBody: responsePayload,
          },
          fetchImpl
        );

        return jsonResponse(200, responsePayload, baseHeaders, {
          'X-Idempotency-Backing': 'postgres-durable',
        });
      }

      return errorResponse(
        404,
        'ROUTE_NOT_FOUND',
        'Không tìm thấy endpoint API yêu cầu.',
        requestId,
        baseHeaders
      );
    },
  };
}

const defaultWorker = createWorkerHandler();

export default {
  fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContextLike) {
    return defaultWorker.fetch(request, env, ctx);
  },
};

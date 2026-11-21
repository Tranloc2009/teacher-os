import type { AppRole, AuthenticatedUser, WorkerEnv } from './types';
import { getSupabaseOrigin, serviceAuthHeaders } from './supabase';
import { isValidRole, isValidUuid } from './validation';

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
}

interface JwkKey extends JsonWebKey {
  kid?: string;
  alg?: string;
  kty?: string;
  crv?: string;
  use?: string;
}

interface JwksCacheEntry {
  keys: JwkKey[];
  fetchedAt: number;
}

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map<string, JwksCacheEntry>();

export function clearJwksCache(): void {
  jwksCache.clear();
}

function decodeBase64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const bytes = decodeBase64UrlToBytes(segment);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

async function fetchJwksKeys(
  supabaseOrigin: string,
  fetchImpl: typeof fetch,
  nowMs: number
): Promise<JwkKey[]> {
  const cached = jwksCache.get(supabaseOrigin);
  if (cached && nowMs - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }

  const jwksUrl = `${supabaseOrigin}/auth/v1/.well-known/jwks.json`;
  const response = await fetchImpl(jwksUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { keys?: unknown };
  const keys = Array.isArray(body.keys) ? (body.keys as JwkKey[]) : [];
  jwksCache.set(supabaseOrigin, { keys, fetchedAt: nowMs });
  return keys;
}

async function verifySignatureWithJwk(
  signingInput: string,
  signatureBytes: Uint8Array,
  jwk: JwkKey,
  alg: string
): Promise<boolean> {
  const data = new TextEncoder().encode(signingInput);
  const sigBuffer = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength
  ) as ArrayBuffer;

  if (alg === 'ES256' && jwk.kty === 'EC') {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: jwk.crv || 'P-256' },
      false,
      ['verify']
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sigBuffer,
      data
    );
  }

  if (alg === 'RS256' && jwk.kty === 'RSA') {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBuffer, data);
  }

  return false;
}

function validateJwtClaims(
  payload: JwtPayload,
  supabaseOrigin: string,
  nowSeconds: number
): { ok: true; userId: string; email: string } | { ok: false; reason: string } {
  if (!isValidUuid(payload.sub)) {
    return { ok: false, reason: 'Token không chứa mã người dùng (sub) hợp lệ.' };
  }

  const expectedIssuer = `${supabaseOrigin}/auth/v1`;
  if (payload.iss !== expectedIssuer) {
    return { ok: false, reason: 'Issuer của token không khớp với dự án Supabase.' };
  }

  const audValid = Array.isArray(payload.aud)
    ? payload.aud.includes('authenticated')
    : payload.aud === 'authenticated';
  if (!audValid) {
    return { ok: false, reason: 'Audience của token không hợp lệ.' };
  }

  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    return { ok: false, reason: 'Phiên đăng nhập đã hết hạn.' };
  }

  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + 30) {
    return { ok: false, reason: 'Token chưa đến thời điểm hiệu lực.' };
  }

  return {
    ok: true,
    userId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
  };
}

async function verifyTokenViaSupabaseAuthApi(
  token: string,
  supabaseOrigin: string,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<{ ok: true; userId: string; email: string } | { ok: false; reason: string }> {
  const response = await fetchImpl(`${supabaseOrigin}/auth/v1/user`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return { ok: false, reason: 'Token không được Supabase Auth chấp nhận.' };
  }

  const body = (await response.json()) as { id?: unknown; email?: unknown };
  if (!isValidUuid(body.id)) {
    return { ok: false, reason: 'Phản hồi xác thực không chứa user id hợp lệ.' };
  }

  return {
    ok: true,
    userId: body.id,
    email: typeof body.email === 'string' ? body.email : '',
  };
}

function resolvePrimaryRole(roles: AppRole[]): AppRole {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('teacher')) return 'teacher';
  return 'student';
}

/**
 * Fetches authoritative user roles from public.user_roles on PostgreSQL.
 * NEVER trusts JWT user_metadata for role authorization.
 */
async function fetchAuthoritativeRoles(
  userId: string,
  supabaseOrigin: string,
  secretKey: string,
  fetchImpl: typeof fetch
): Promise<{ ok: true; roles: AppRole[] } | { ok: false; reason: string }> {
  const url = `${supabaseOrigin}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(userId)}&select=role`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      ...serviceAuthHeaders(secretKey),
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return {
      ok: false,
      reason: 'Không thể tải quyền người dùng từ bảng user_roles.',
    };
  }

  const rows = (await response.json()) as Array<{ role?: unknown }>;
  const roles = Array.isArray(rows)
    ? Array.from(
        new Set(
          rows
            .map((r) => r.role)
            .filter((role): role is AppRole => isValidRole(role))
        )
      )
    : [];

  return {
    ok: true,
    roles,
  };
}

export type AuthVerificationResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: 401 | 403 | 503; code: string; message: string };

export async function authenticateRequest(
  request: Request,
  env: WorkerEnv,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now()
): Promise<AuthVerificationResult> {
  const supabaseOrigin = getSupabaseOrigin(env.SUPABASE_URL);
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseOrigin || !secretKey) {
    return {
      ok: false,
      status: 503,
      code: 'BACKEND_NOT_CONFIGURED',
      message:
        'Backend chưa được cấu hình đầy đủ SUPABASE_URL hoặc SUPABASE_SECRET_KEY.',
    };
  }

  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: 'MISSING_AUTH_TOKEN',
      message: 'Yêu cầu bắt buộc phải có header Authorization: Bearer <token>.',
    };
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    return {
      ok: false,
      status: 401,
      code: 'MALFORMED_TOKEN',
      message: 'Định dạng JWT không hợp lệ.',
    };
  }

  const [headerSeg, payloadSeg, signatureSeg] = segments;
  const header = decodeBase64UrlJson<JwtHeader>(headerSeg);
  const payload = decodeBase64UrlJson<JwtPayload>(payloadSeg);
  if (!header || !payload || !header.alg || header.alg === 'none') {
    return {
      ok: false,
      status: 401,
      code: 'INVALID_TOKEN_HEADER',
      message: 'Header hoặc payload JWT không hợp lệ.',
    };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  let verifiedIdentity: { userId: string; email: string } | null = null;
  let verifiedVia: 'jwks' | 'auth-api' = 'jwks';

  if (header.alg === 'ES256' || header.alg === 'RS256') {
    const claimsCheck = validateJwtClaims(payload, supabaseOrigin, nowSeconds);
    if (!claimsCheck.ok) {
      return {
        ok: false,
        status: 401,
        code: 'INVALID_TOKEN_CLAIMS',
        message: claimsCheck.reason,
      };
    }

    let signatureBytes: Uint8Array;
    try {
      signatureBytes = decodeBase64UrlToBytes(signatureSeg);
    } catch {
      return {
        ok: false,
        status: 401,
        code: 'INVALID_TOKEN_SIGNATURE',
        message: 'Chữ ký JWT không hợp lệ.',
      };
    }

    const keys = await fetchJwksKeys(supabaseOrigin, fetchImpl, nowMs);
    const matchingKeys = header.kid
      ? keys.filter((k) => k.kid === header.kid)
      : keys;

    let signatureValid = false;
    for (const jwk of matchingKeys) {
      try {
        const ok = await verifySignatureWithJwk(
          `${headerSeg}.${payloadSeg}`,
          signatureBytes,
          jwk,
          header.alg
        );
        if (ok) {
          signatureValid = true;
          break;
        }
      } catch {
        // Continue trying matching keys safely
      }
    }

    if (!signatureValid) {
      return {
        ok: false,
        status: 401,
        code: 'INVALID_TOKEN_SIGNATURE',
        message: 'Xác minh chữ ký JWT bằng Supabase JWKS thất bại.',
      };
    }

    verifiedIdentity = {
      userId: claimsCheck.userId,
      email: claimsCheck.email,
    };
  } else {
    // Fallback for legacy symmetric projects: strictly verify live against Supabase Auth API
    const apiKeyForAuthCheck = env.SUPABASE_PUBLISHABLE_KEY?.trim() || secretKey;
    const authApiCheck = await verifyTokenViaSupabaseAuthApi(
      token,
      supabaseOrigin,
      apiKeyForAuthCheck,
      fetchImpl
    );
    if (!authApiCheck.ok) {
      return {
        ok: false,
        status: 401,
        code: 'TOKEN_REJECTED',
        message: authApiCheck.reason,
      };
    }
    verifiedIdentity = {
      userId: authApiCheck.userId,
      email: authApiCheck.email,
    };
    verifiedVia = 'auth-api';
  }

  const roleResult = await fetchAuthoritativeRoles(
    verifiedIdentity.userId,
    supabaseOrigin,
    secretKey,
    fetchImpl
  );

  if (!roleResult.ok) {
    return {
      ok: false,
      status: 503,
      code: 'ROLE_LOOKUP_FAILED',
      message: roleResult.reason,
    };
  }

  if (roleResult.roles.length === 0) {
    return {
      ok: false,
      status: 403,
      code: 'APP_ROLE_REQUIRED',
      message: 'Tài khoản chưa được cấp vai trò TeacherOS.',
    };
  }

  return {
    ok: true,
    user: {
      id: verifiedIdentity.userId,
      email: verifiedIdentity.email,
      roles: roleResult.roles,
      primaryRole: resolvePrimaryRole(roleResult.roles),
      verifiedVia,
    },
  };
}

export function userHasAnyRole(
  user: AuthenticatedUser,
  allowed: AppRole[]
): boolean {
  return allowed.some((role) => user.roles.includes(role));
}

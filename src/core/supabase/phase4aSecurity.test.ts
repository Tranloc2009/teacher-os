import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectForbiddenSecretKey,
  evaluateSupabaseEnv,
} from './config';
import { getSupabaseClient, resetSupabaseClientCache } from './client';
import { runSupabaseConnectionDiagnostic } from './diagnostics';
import { createWorkerHandler } from '../../../workers/api/src/index';
import { clearJwksCache } from '../../../workers/api/src/auth';
import type { WorkerEnv } from '../../../workers/api/src/types';

const ROOT_DIR = process.cwd();
const SUPABASE_ORIGIN = 'https://teacheros-test-free.supabase.co';
const STUDENT_A_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_B_ID = '22222222-2222-4222-8222-222222222222';
const TEACHER_A_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_B_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_ID = '55555555-5555-4555-8555-555555555555';
const CLASSROOM_B_ID = '66666666-6666-4666-8666-666666666666';
const ATTEMPT_A_ID = '77777777-7777-4777-8777-777777777777';
const ATTEMPT_B_ID = '88888888-8888-4888-8888-888888888888';

function toBase64Url(input: Uint8Array | string): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createEcdsaTestKeypair() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk: {
      ...publicJwk,
      kid: 'test-es256-kid-1',
      alg: 'ES256',
      use: 'sig',
    },
  };
}

async function signEs256Jwt(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  headerOverride: Record<string, unknown> = {}
): Promise<string> {
  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid: 'test-es256-kid-1',
    ...headerOverride,
  };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  return `${toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${toBase64Url(JSON.stringify(payload))}.fake_sig`;
}

// =============================================================================
// 1. Frontend Config & Secret Key Guard Tests
// =============================================================================
test('Phase 4A Config: missing env vars reports not-configured and creates no mock client', async () => {
  resetSupabaseClientCache();
  const cfg = evaluateSupabaseEnv({});
  assert.equal(cfg.status, 'not-configured');
  assert.equal(cfg.isReady, false);
  assert.equal(getSupabaseClient(cfg), null);

  const diag = await runSupabaseConnectionDiagnostic({ config: cfg });
  assert.equal(diag.status, 'not-configured');
  assert.equal(diag.workerStatus, 'not-configured');
  assert.equal(diag.workerAuthStatus, 'not-tested');
  assert.match(diag.summary, /Chưa cấu hình/);
});

test('Phase 4A Config: blocks sb_secret_* and service_role JWT keys in frontend env', async () => {
  const secretKeyErr = detectForbiddenSecretKey('sb_secret_test_1234567890abcdef');
  assert.ok(secretKeyErr);

  const cfgSecret = evaluateSupabaseEnv({
    VITE_SUPABASE_URL: SUPABASE_ORIGIN,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test_1234567890abcdef',
  });
  assert.equal(cfgSecret.status, 'secret-key-blocked');
  assert.equal(cfgSecret.isReady, false);
  assert.equal(getSupabaseClient(cfgSecret), null);

  const serviceRoleJwt = makeFakeJwt({ role: 'service_role', iss: 'supabase' });
  const cfgJwt = evaluateSupabaseEnv({
    VITE_SUPABASE_URL: SUPABASE_ORIGIN,
    VITE_SUPABASE_PUBLISHABLE_KEY: serviceRoleJwt,
  });
  assert.equal(cfgJwt.status, 'secret-key-blocked');
  assert.equal(cfgJwt.isReady, false);

  const diag = await runSupabaseConnectionDiagnostic({ config: cfgJwt });
  assert.equal(diag.status, 'secret-key-blocked');
});

test('Phase 4A Config: diagnostic probes Supabase health, teachero-api /api/health, and /api/v1/auth/me', async () => {
  const cfg = evaluateSupabaseEnv({
    VITE_SUPABASE_URL: SUPABASE_ORIGIN,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_valid_public_key_123456',
    VITE_CLOUDFLARE_API_URL: 'https://teacheros-api.example.workers.dev',
  });
  assert.equal(cfg.status, 'configured');
  assert.equal(cfg.isReady, true);

  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/health')) {
      return new Response(JSON.stringify({ version: '2.0.0' }), { status: 200 });
    }
    if (url.endsWith('/api/health')) {
      return new Response(
        JSON.stringify({ ok: true, service: 'teacheros-api', configured: true }),
        { status: 200 }
      );
    }
    if (url.endsWith('/api/v1/auth/me')) {
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth === 'Bearer valid-live-token') {
        return new Response(JSON.stringify({ user: { primaryRole: 'teacher' } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: { code: 'MISSING_AUTH_TOKEN' } }), {
        status: 401,
      });
    }
    return new Response('Not found', { status: 404 });
  };

  // Signed-out probe confirms /api/v1/auth/me enforces 401
  const diagSignedOut = await runSupabaseConnectionDiagnostic({
    config: cfg,
    fetchImpl: fakeFetch,
  });
  assert.equal(diagSignedOut.status, 'connected');
  assert.equal(diagSignedOut.workerStatus, 'healthy');
  assert.equal(diagSignedOut.workerServiceName, 'teacheros-api');
  assert.equal(diagSignedOut.workerAuthStatus, 'unauth-401-verified');

  // Signed-in probe confirms /api/v1/auth/me accepts valid Bearer JWT
  const diagSignedIn = await runSupabaseConnectionDiagnostic({
    config: cfg,
    fetchImpl: fakeFetch,
    accessToken: 'valid-live-token',
  });
  assert.equal(diagSignedIn.workerAuthStatus, 'authenticated-200-verified');
  assert.ok(calls.includes('https://teacheros-api.example.workers.dev/api/v1/auth/me'));
});

test('Phase 4A Config: rejects non-HTTPS remote URLs', () => {
  const cfg = evaluateSupabaseEnv({
    VITE_SUPABASE_URL: 'http://insecure.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_valid_public_key_123456',
  });
  assert.equal(cfg.status, 'invalid-config');
  assert.equal(cfg.isReady, false);
});

// =============================================================================
// 2. Static Source Secret Exposure, Worker Config & Paid-Service Policy Audit
// =============================================================================
test('Phase 4A Security Scan: teachero-api wrangler.toml & zero secrets/paid services', () => {
  const envExample = fs.readFileSync(path.join(ROOT_DIR, '.env.example'), 'utf8');
  assert.doesNotMatch(envExample, /VITE_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(envExample, /VITE_SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(envExample, /sb_secret_[A-Za-z0-9]{10,}/);
  assert.doesNotMatch(envExample, /eyJhbGciOi/);

  const wranglerToml = fs.readFileSync(
    path.join(ROOT_DIR, 'workers/api/wrangler.toml'),
    'utf8'
  );
  assert.match(wranglerToml, /name\s*=\s*"teacheros-api"/);
  assert.match(wranglerToml, /main\s*=\s*"src\/index\.ts"/);
  assert.doesNotMatch(wranglerToml, /r2_buckets/i);
  assert.doesNotMatch(wranglerToml, /durable_objects/i);
  assert.doesNotMatch(wranglerToml, /sb_secret_[A-Za-z0-9]{10,}/);
  assert.doesNotMatch(wranglerToml, /ALLOWED_ORIGINS\s*=\s*"\*"/);

  const frontendFiles = [
    'src/core/supabase/config.ts',
    'src/core/supabase/client.ts',
    'src/core/supabase/diagnostics.ts',
    'src/core/supabase/authService.ts',
    'src/components/cloud/OnlineCloudPanel.tsx',
  ];
  for (const rel of frontendFiles) {
    const content = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    assert.doesNotMatch(content, /VITE_SUPABASE_SERVICE_ROLE_KEY/, rel);
    assert.doesNotMatch(content, /VITE_SUPABASE_SECRET_KEY/, rel);
    assert.doesNotMatch(content, /@google\/genai/, rel);
    assert.doesNotMatch(content, /firebase/i, rel);
  }
});

// =============================================================================
// 3. SQL Migrations (001 + 002 + 003) Schema, RLS, Grants & Durable Controls Audit
// =============================================================================
test('Phase 4A SQL Migrations: 11 tables, RLS, service_role grants, durable idempotency & global rate limit RPCs', () => {
  const schemaSql = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'supabase/migrations/20261120000001_phase4a_foundation_schema.sql'
    ),
    'utf8'
  );
  const rlsSql = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'supabase/migrations/20261120000002_phase4a_rls_and_grants.sql'
    ),
    'utf8'
  );
  const hardeningSql = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'supabase/migrations/20261120000003_phase4a_durable_idempotency_and_hardening.sql'
    ),
    'utf8'
  );

  const requiredPublicTables = [
    'profiles',
    'user_roles',
    'classrooms',
    'class_members',
    'exam_publications',
    'exam_versions',
    'exam_assignments',
    'exam_attempts',
    'attempt_answers',
    'grading_results',
    'audit_events',
  ];

  for (const table of requiredPublicTables) {
    assert.match(
      schemaSql,
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
      `Missing table public.${table}`
    );
    assert.match(
      rlsSql,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`),
      `Missing ENABLE RLS on public.${table}`
    );
    assert.match(
      rlsSql,
      new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY;`),
      `Missing FORCE RLS on public.${table}`
    );
  }

  // Private answer key schema and table protection
  assert.match(schemaSql, /CREATE SCHEMA IF NOT EXISTS exam_private;/);
  assert.match(
    schemaSql,
    /CREATE TABLE IF NOT EXISTS exam_private\.official_answer_keys\b/
  );
  assert.match(
    rlsSql,
    /REVOKE ALL ON SCHEMA exam_private FROM PUBLIC, anon, authenticated;/
  );
  assert.match(
    rlsSql,
    /ALTER TABLE exam_private\.official_answer_keys ENABLE ROW LEVEL SECURITY;/
  );
  assert.doesNotMatch(
    rlsSql,
    /CREATE POLICY .* ON exam_private\.official_answer_keys/i
  );

  // Signup trigger assigns ONLY 'student' and NEVER reads role from raw_user_meta_data
  const executableSchemaSql = schemaSql.replace(/--[^\n]*/g, '');
  assert.match(executableSchemaSql, /VALUES \(NEW\.id, 'student', NULL\)/);
  assert.doesNotMatch(executableSchemaSql, /raw_user_meta_data\s*->>\s*'role'/i);

  // user_roles has NO write grants or write policies for authenticated/anon
  assert.match(rlsSql, /GRANT SELECT ON public\.user_roles TO authenticated;/);
  assert.doesNotMatch(
    rlsSql,
    /GRANT .*(INSERT|UPDATE|DELETE).* ON public\.user_roles TO (anon|authenticated)/i
  );
  assert.doesNotMatch(
    rlsSql,
    /CREATE POLICY .* ON public\.user_roles FOR (INSERT|UPDATE|DELETE|ALL)/i
  );
  assert.doesNotMatch(rlsSql, /GRANT .* TO anon\b/i);

  // Migration 003 hardening checks
  assert.match(hardeningSql, /GRANT USAGE ON SCHEMA exam_private TO service_role;/);
  assert.match(
    hardeningSql,
    /CREATE TABLE IF NOT EXISTS exam_private\.api_idempotency_keys\b/
  );
  assert.match(
    hardeningSql,
    /UNIQUE \(actor_id, method, route_path, idempotency_key\)/
  );
  assert.match(
    hardeningSql,
    /REVOKE ALL ON FUNCTION public\.server_claim_idempotency_key.*FROM PUBLIC, anon, authenticated;/
  );
  assert.match(
    hardeningSql,
    /GRANT EXECUTE ON FUNCTION public\.server_claim_idempotency_key.*TO service_role;/
  );
  assert.match(
    hardeningSql,
    /CREATE TABLE IF NOT EXISTS exam_private\.api_rate_limits\b/
  );
  assert.match(
    hardeningSql,
    /GRANT EXECUTE ON FUNCTION public\.server_check_rate_limit.*TO service_role;/
  );
  assert.match(
    hardeningSql,
    /CREATE OR REPLACE FUNCTION public\.protect_exam_attempt_immutable_fields/
  );
  assert.match(
    hardeningSql,
    /ADD CONSTRAINT chk_exam_versions_no_answer_key_payload/
  );
});

// =============================================================================
// 4. Cloudflare Worker Multi-Instance Security, Durable DB Idempotency & Global DB Rate Limit
// =============================================================================
test('Phase 4A Worker Security: multi-instance durable DB idempotency, global DB rate limit, RBAC & ownership', async () => {
  clearJwksCache();
  const { privateKey, publicJwk } = await createEcdsaTestKeypair();

  const roleTable: Record<string, string[]> = {
    [STUDENT_A_ID]: ['student'],
    [STUDENT_B_ID]: ['student'],
    [TEACHER_A_ID]: ['teacher'],
    [TEACHER_B_ID]: ['teacher'],
    [ADMIN_ID]: ['admin'],
  };

  // Shared simulated PostgreSQL state across MULTIPLE independent Worker instances
  interface StoredIdempotencyRow {
    requestHash: string;
    status: 'in_progress' | 'completed';
    responseStatus: number | null;
    responseBody: unknown;
  }
  const pgIdempotencyTable = new Map<string, StoredIdempotencyRow>();
  const pgRateLimitTable = new Map<string, number>();

  let dbRoleGrantWrites = 0;
  let dbAttemptSubmitPatches = 0;
  let dbClassroomCreates = 0;
  let simulateIdempotencyRpcDown = false;

  const sharedPostgresFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};

    if (url === `${SUPABASE_ORIGIN}/auth/v1/.well-known/jwks.json`) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }

    // Durable DB Idempotency RPCs
    if (url === `${SUPABASE_ORIGIN}/rest/v1/rpc/server_claim_idempotency_key`) {
      if (simulateIdempotencyRpcDown) {
        return new Response(JSON.stringify({ message: 'function not found' }), {
          status: 404,
        });
      }
      const key = `${parsedBody.p_actor_id}|${parsedBody.p_method}|${parsedBody.p_route_path}|${parsedBody.p_idempotency_key}`;
      const existing = pgIdempotencyTable.get(key);
      if (!existing) {
        pgIdempotencyTable.set(key, {
          requestHash: String(parsedBody.p_request_hash),
          status: 'in_progress',
          responseStatus: null,
          responseBody: null,
        });
        return new Response(JSON.stringify([{ outcome: 'claimed' }]), { status: 200 });
      }
      if (existing.requestHash !== String(parsedBody.p_request_hash)) {
        return new Response(JSON.stringify([{ outcome: 'conflict_payload' }]), {
          status: 200,
        });
      }
      if (existing.status === 'completed') {
        return new Response(
          JSON.stringify([
            {
              outcome: 'replay',
              response_status: existing.responseStatus,
              response_body: existing.responseBody,
            },
          ]),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify([{ outcome: 'in_progress' }]), {
        status: 200,
      });
    }

    if (url === `${SUPABASE_ORIGIN}/rest/v1/rpc/server_complete_idempotency_key`) {
      const key = `${parsedBody.p_actor_id}|${parsedBody.p_method}|${parsedBody.p_route_path}|${parsedBody.p_idempotency_key}`;
      const existing = pgIdempotencyTable.get(key);
      if (existing) {
        existing.status = 'completed';
        existing.responseStatus = Number(parsedBody.p_response_status);
        existing.responseBody = parsedBody.p_response_body;
      }
      return new Response(null, { status: 204 });
    }

    if (url === `${SUPABASE_ORIGIN}/rest/v1/rpc/server_release_idempotency_key`) {
      const key = `${parsedBody.p_actor_id}|${parsedBody.p_method}|${parsedBody.p_route_path}|${parsedBody.p_idempotency_key}`;
      const existing = pgIdempotencyTable.get(key);
      if (existing && existing.status === 'in_progress') {
        pgIdempotencyTable.delete(key);
      }
      return new Response(null, { status: 204 });
    }

    // Global Multi-Instance DB Rate Limit RPC
    if (url === `${SUPABASE_ORIGIN}/rest/v1/rpc/server_check_rate_limit`) {
      const bucket = String(parsedBody.p_bucket_key);
      const limit = Number(parsedBody.p_limit);
      const next = (pgRateLimitTable.get(bucket) ?? 0) + 1;
      pgRateLimitTable.set(bucket, next);
      const allowed = next <= limit;
      return new Response(
        JSON.stringify([
          {
            allowed,
            current_count: next,
            remaining: allowed ? limit - next : 0,
            retry_after_seconds: allowed ? 0 : 60,
          },
        ]),
        { status: 200 }
      );
    }

    if (url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/user_roles?user_id=eq.`)) {
      const uid = decodeURIComponent(url.split('user_id=eq.')[1].split('&')[0]);
      const roles = (roleTable[uid] ?? []).map((role) => ({ role }));
      return new Response(JSON.stringify(roles), { status: 200 });
    }

    if (method === 'POST' && url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/user_roles`)) {
      dbRoleGrantWrites += 1;
      return new Response(JSON.stringify([{ ok: true }]), { status: 201 });
    }

    if (method === 'POST' && url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/classrooms`)) {
      dbClassroomCreates += 1;
      return new Response(
        JSON.stringify([{ id: '99999999-9999-4999-8999-999999999999', name: parsedBody.name }]),
        { status: 201 }
      );
    }

    if (method === 'POST' && url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/audit_events`)) {
      return new Response(null, { status: 201 });
    }

    if (
      method === 'GET' &&
      url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/classrooms?id=eq.${CLASSROOM_B_ID}`)
    ) {
      return new Response(
        JSON.stringify([{ id: CLASSROOM_B_ID, teacher_id: TEACHER_B_ID, name: '12A2' }]),
        { status: 200 }
      );
    }

    if (
      method === 'GET' &&
      url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/exam_attempts?id=eq.${ATTEMPT_B_ID}`)
    ) {
      return new Response(
        JSON.stringify([{ id: ATTEMPT_B_ID, student_id: STUDENT_B_ID, status: 'in_progress' }]),
        { status: 200 }
      );
    }

    if (
      method === 'GET' &&
      url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/exam_attempts?id=eq.${ATTEMPT_A_ID}`)
    ) {
      return new Response(
        JSON.stringify([{ id: ATTEMPT_A_ID, student_id: STUDENT_A_ID, status: 'in_progress' }]),
        { status: 200 }
      );
    }

    if (
      method === 'PATCH' &&
      url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/exam_attempts?id=eq.${ATTEMPT_A_ID}`)
    ) {
      dbAttemptSubmitPatches += 1;
      return new Response(
        JSON.stringify([{ id: ATTEMPT_A_ID, status: 'submitted' }]),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify([]), { status: 200 });
  };

  let clockMs = Date.UTC(2026, 10, 20, 12, 0, 0);
  // TWO COMPLETELY SEPARATE Worker isolates (zero shared memory!)
  const workerInstanceA = createWorkerHandler({
    fetchImpl: sharedPostgresFetch,
    now: () => clockMs,
  });
  const workerInstanceB = createWorkerHandler({
    fetchImpl: sharedPostgresFetch,
    now: () => clockMs,
  });

  const env: WorkerEnv = {
    SUPABASE_URL: SUPABASE_ORIGIN,
    SUPABASE_SECRET_KEY: 'test-only-server-secret-not-real',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
    ALLOWED_ORIGINS: 'https://teacheros.pages.dev,http://localhost:3000',
    RATE_LIMIT_MAX: '40',
    RATE_LIMIT_WINDOW_MS: '60000',
    MUTATION_RATE_LIMIT_MAX: '20',
    MUTATION_RATE_LIMIT_WINDOW_SEC: '60',
  };

  const nowSec = Math.floor(clockMs / 1000);
  const makeToken = (sub: string, extra: Record<string, unknown> = {}) =>
    signEs256Jwt(privateKey, {
      sub,
      email: `${sub.slice(0, 8)}@school.edu.vn`,
      iss: `${SUPABASE_ORIGIN}/auth/v1`,
      aud: 'authenticated',
      exp: nowSec + 3600,
      ...extra,
    });

  const studentAToken = await makeToken(STUDENT_A_ID, {
    user_metadata: { role: 'admin' }, // Forged metadata MUST be ignored
  });
  const teacherAToken = await makeToken(TEACHER_A_ID);
  const adminToken = await makeToken(ADMIN_ID);

  // 4.1 Public health check identifies teachero-api, leaks NO secrets, and honestly tags isolate-best-effort
  const healthRes = await workerInstanceA.fetch(
    new Request('https://worker.local/api/health', {
      headers: { Origin: 'https://teacheros.pages.dev' },
    }),
    env
  );
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('X-RateLimit-Scope'), 'isolate-best-effort');
  const healthBody = (await healthRes.json()) as {
    service: string;
    idempotencyBacking: string;
    rateLimitModel: { publicRoutes: string; authenticatedMutations: string };
  };
  assert.equal(healthBody.service, 'teacheros-api');
  assert.equal(healthBody.idempotencyBacking, 'postgres-durable');
  assert.equal(healthBody.rateLimitModel.publicRoutes, 'isolate-best-effort');
  assert.equal(healthBody.rateLimitModel.authenticatedMutations, 'global-db-backed');

  // 4.2 Disallowed CORS origin rejected with 403
  const badOriginRes = await workerInstanceA.fetch(
    new Request('https://worker.local/api/health', {
      headers: { Origin: 'https://evil-attacker.example' },
    }),
    env
  );
  assert.equal(badOriginRes.status, 403);
  assert.equal(badOriginRes.headers.get('Access-Control-Allow-Origin'), null);

  // 4.3 Unauth / expired / tampered / wrong-issuer -> 401
  assert.equal(
    (await workerInstanceA.fetch(new Request('https://worker.local/api/v1/auth/me'), env)).status,
    401
  );
  const expiredToken = await makeToken(STUDENT_A_ID, { exp: nowSec - 10 });
  assert.equal(
    (
      await workerInstanceA.fetch(
        new Request('https://worker.local/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${expiredToken}` },
        }),
        env
      )
    ).status,
    401
  );
  const tamperedToken = `${studentAToken.slice(0, -4)}AAAA`;
  assert.equal(
    (
      await workerInstanceA.fetch(
        new Request('https://worker.local/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${tamperedToken}` },
        }),
        env
      )
    ).status,
    401
  );

  // 4.4 Student forged user_metadata.role='admin' STILL resolves as 'student' and gets 403 on admin/teacher routes
  const meRes = await workerInstanceA.fetch(
    new Request('https://worker.local/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${studentAToken}` },
    }),
    env
  );
  assert.equal(meRes.status, 200);
  const meBody = (await meRes.json()) as { user: { primaryRole: string } };
  assert.equal(meBody.user.primaryRole, 'student');

  assert.equal(
    (
      await workerInstanceA.fetch(
        new Request('https://worker.local/api/v1/roles/grant', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${studentAToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'student-escalate-001',
          },
          body: JSON.stringify({ targetUserId: STUDENT_A_ID, role: 'admin' }),
        }),
        env
      )
    ).status,
    403
  );

  assert.equal(
    (
      await workerInstanceA.fetch(
        new Request('https://worker.local/api/v1/teacher/classrooms', {
          headers: { Authorization: `Bearer ${studentAToken}` },
        }),
        env
      )
    ).status,
    403
  );

  // 4.5 CROSS-INSTANCE Durable DB Idempotency: Instance A writes, Instance B replays from PostgreSQL!
  const grantInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'cross-instance-grant-001',
    },
    body: JSON.stringify({ targetUserId: STUDENT_B_ID, role: 'teacher' }),
  };

  const grantResA = await workerInstanceA.fetch(
    new Request('https://worker.local/api/v1/roles/grant', grantInit),
    env
  );
  assert.equal(grantResA.status, 201);
  assert.equal(grantResA.headers.get('X-Idempotency-Backing'), 'postgres-durable');
  assert.equal(grantResA.headers.get('X-RateLimit-Scope'), 'global-db-backed');
  assert.equal(dbRoleGrantWrites, 1);

  // Separate cold Worker instance B receives same Idempotency-Key -> replays WITHOUT duplicate DB write!
  const grantResB = await workerInstanceB.fetch(
    new Request('https://worker.local/api/v1/roles/grant', grantInit),
    env
  );
  assert.equal(grantResB.status, 201);
  assert.equal(grantResB.headers.get('X-Idempotent-Replay'), 'true');
  assert.equal(grantResB.headers.get('X-Idempotency-Backing'), 'postgres-durable');
  assert.equal(dbRoleGrantWrites, 1);

  // Reusing same Idempotency-Key with DIFFERENT payload on Instance B -> 409 conflict!
  const mismatchRes = await workerInstanceB.fetch(
    new Request('https://worker.local/api/v1/roles/grant', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'cross-instance-grant-001',
      },
      body: JSON.stringify({ targetUserId: STUDENT_B_ID, role: 'admin' }),
    }),
    env
  );
  assert.equal(mismatchRes.status, 409);

  // 4.6 Fail-closed if DB idempotency RPC is unavailable (e.g., Migration 003 not applied)
  simulateIdempotencyRpcDown = true;
  const downRes = await workerInstanceA.fetch(
    new Request('https://worker.local/api/v1/roles/grant', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'new-key-when-rpc-down',
      },
      body: JSON.stringify({ targetUserId: STUDENT_A_ID, role: 'teacher' }),
    }),
    env
  );
  assert.equal(downRes.status, 503);
  simulateIdempotencyRpcDown = false;

  // 4.7 CROSS-INSTANCE Global DB Rate Limiting across Worker Instance A & Instance B!
  const tightMutationEnv: WorkerEnv = {
    ...env,
    MUTATION_RATE_LIMIT_MAX: '2',
    MUTATION_RATE_LIMIT_WINDOW_SEC: '60',
  };

  const c1 = await workerInstanceA.fetch(
    new Request('https://worker.local/api/v1/teacher/classrooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherAToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'classroom-create-001',
      },
      body: JSON.stringify({ name: '12A1', subject: 'Toán', grade: '12' }),
    }),
    tightMutationEnv
  );
  assert.equal(c1.status, 201);
  assert.equal(c1.headers.get('X-RateLimit-Scope'), 'global-db-backed');

  // Hit DIFFERENT Worker instance B -> shares global DB counter!
  const c2 = await workerInstanceB.fetch(
    new Request('https://worker.local/api/v1/teacher/classrooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherAToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'classroom-create-002',
      },
      body: JSON.stringify({ name: '12A2', subject: 'Toán', grade: '12' }),
    }),
    tightMutationEnv
  );
  assert.equal(c2.status, 201);
  assert.equal(dbClassroomCreates, 2);

  // 3rd call back on Instance A MUST be blocked globally with 429!
  const c3 = await workerInstanceA.fetch(
    new Request('https://worker.local/api/v1/teacher/classrooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherAToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'classroom-create-003',
      },
      body: JSON.stringify({ name: '12A3', subject: 'Toán', grade: '12' }),
    }),
    tightMutationEnv
  );
  assert.equal(c3.status, 429);
  assert.equal(c3.headers.get('X-RateLimit-Scope'), 'global-db-backed');
  assert.equal(dbClassroomCreates, 2);

  // 4.8 Ownership Isolation (Teacher A -> Teacher B classroom & Student A -> Student B attempt)
  assert.equal(
    (
      await workerInstanceA.fetch(
        new Request(`https://worker.local/api/v1/teacher/classrooms/${CLASSROOM_B_ID}`, {
          headers: { Authorization: `Bearer ${teacherAToken}` },
        }),
        env
      )
    ).status,
    403
  );
  assert.equal(
    (
      await workerInstanceA.fetch(
        new Request(`https://worker.local/api/v1/student/attempts/${ATTEMPT_B_ID}`, {
          headers: { Authorization: `Bearer ${studentAToken}` },
        }),
        env
      )
    ).status,
    403
  );

  // Student A own submit across two instances replays cleanly without answer leakage
  const subA = await workerInstanceA.fetch(
    new Request(
      `https://worker.local/api/v1/student/attempts/${ATTEMPT_A_ID}/submit`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentAToken}`,
          'Idempotency-Key': 'student-submit-cross-inst-1',
        },
      }
    ),
    env
  );
  assert.equal(subA.status, 200);
  assert.equal(dbAttemptSubmitPatches, 1);

  const subB = await workerInstanceB.fetch(
    new Request(
      `https://worker.local/api/v1/student/attempts/${ATTEMPT_A_ID}/submit`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentAToken}`,
          'Idempotency-Key': 'student-submit-cross-inst-1',
        },
      }
    ),
    env
  );
  assert.equal(subB.status, 200);
  assert.equal(subB.headers.get('X-Idempotent-Replay'), 'true');
  assert.equal(dbAttemptSubmitPatches, 1);

  // Direct answer-key probing blocked
  assert.equal(
    (
      await workerInstanceA.fetch(
        new Request('https://worker.local/api/v1/answer-keys/123', {
          headers: { Authorization: `Bearer ${studentAToken}` },
        }),
        env
      )
    ).status,
    403
  );
  clockMs += 61_000;
});

// =============================================================================
// 5. Optional Live Supabase Free RLS Integration Test (Honest SKIP if unconfigured)
// =============================================================================
test('Phase 4A Live Supabase RLS Integration (requires SUPABASE_TEST_URL & SUPABASE_TEST_PUBLISHABLE_KEY)', async (t) => {
  const testUrl = process.env.SUPABASE_TEST_URL?.trim();
  const testPubKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY?.trim();

  if (!testUrl || !testPubKey) {
    t.skip(
      'Chưa có biến môi trường SUPABASE_TEST_URL / SUPABASE_TEST_PUBLISHABLE_KEY cho dự án Supabase Free thực tế — bỏ qua trung thực thay vì giả lập kết quả Live RLS.'
    );
    return;
  }

  const anonProfilesRes = await fetch(`${testUrl}/rest/v1/profiles?select=*`, {
    headers: { apikey: testPubKey },
  });
  if (anonProfilesRes.ok) {
    const rows = (await anonProfilesRes.json()) as unknown[];
    assert.equal(
      rows.length,
      0,
      'Anonymous user must NEVER read rows from public.profiles'
    );
  } else {
    assert.ok(
      anonProfilesRes.status === 401 || anonProfilesRes.status === 403
    );
  }

  const privateRes = await fetch(
    `${testUrl}/rest/v1/official_answer_keys?select=*`,
    {
      headers: {
        apikey: testPubKey,
        'Accept-Profile': 'exam_private',
      },
    }
  );
  assert.ok(
    !privateRes.ok,
    'exam_private.official_answer_keys must NEVER be readable via public Data API'
  );
});

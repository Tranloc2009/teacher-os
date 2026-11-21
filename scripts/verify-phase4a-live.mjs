#!/usr/bin/env node
/**
 * TeacherOS 5.0 — Phase 4A Live Deployment Verification Script
 * Verifies real Supabase Free + Cloudflare Worker (`teacheros-api`) deployment.
 *
 * Usage (do NOT commit credentials):
 *   VITE_SUPABASE_URL="https://<ref>.supabase.co" \
 *   VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..." \
 *   VITE_CLOUDFLARE_API_URL="https://teacheros-api.<subdomain>.workers.dev" \
 *   TEST_STUDENT_EMAIL="student@example.com" \
 *   TEST_STUDENT_PASSWORD="StrongPassword123!" \
 *   node scripts/verify-phase4a-live.mjs
 */

const supabaseUrl = (
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_TEST_URL ||
  ''
).trim().replace(/\/+$/, '');

const publishableKey = (
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_TEST_PUBLISHABLE_KEY ||
  ''
).trim();

const workerUrl = (
  process.env.VITE_CLOUDFLARE_API_URL ||
  process.env.WORKER_API_URL ||
  ''
).trim().replace(/\/+$/, '');

const studentEmail = (process.env.TEST_STUDENT_EMAIL || '').trim();
const studentPassword = process.env.TEST_STUDENT_PASSWORD || '';

const results = [];
let failed = false;

function record(name, status, detail) {
  results.push({ name, status, detail });
  if (status === 'FAIL') failed = true;
  console.log(`[${status}] ${name} — ${detail}`);
}

async function run() {
  console.log('=== TeacherOS 5.0 Phase 4A Live Verification ===\n');

  if (!supabaseUrl || !publishableKey) {
    record(
      'Supabase Config',
      'FAIL',
      'Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_PUBLISHABLE_KEY.'
    );
    process.exit(1);
  }

  // 1. Supabase Auth Health
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: publishableKey },
    });
    record(
      'Supabase Auth Health',
      res.ok ? 'PASS' : 'FAIL',
      `HTTP ${res.status}`
    );
  } catch (err) {
    record('Supabase Auth Health', 'FAIL', String(err));
  }

  // 2. Anonymous RLS & Private Schema Isolation
  try {
    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?select=*`, {
      headers: { apikey: publishableKey },
    });
    if (profRes.ok) {
      const rows = await profRes.json();
      record(
        'RLS Anonymous Blocked (public.profiles)',
        Array.isArray(rows) && rows.length === 0 ? 'PASS' : 'FAIL',
        `HTTP ${profRes.status}, rows=${Array.isArray(rows) ? rows.length : 'invalid'}`
      );
    } else {
      record(
        'RLS Anonymous Blocked (public.profiles)',
        profRes.status === 401 || profRes.status === 403 ? 'PASS' : 'FAIL',
        `HTTP ${profRes.status}`
      );
    }

    const privRes = await fetch(
      `${supabaseUrl}/rest/v1/official_answer_keys?select=*`,
      {
        headers: {
          apikey: publishableKey,
          'Accept-Profile': 'exam_private',
        },
      }
    );
    record(
      'Private Schema Blocked (exam_private.official_answer_keys)',
      !privRes.ok ? 'PASS' : 'FAIL',
      `HTTP ${privRes.status} (must NOT be 2xx)`
    );
  } catch (err) {
    record('Live RLS Anonymous Checks', 'FAIL', String(err));
  }

  // 3. Cloudflare Worker (`teacheros-api`) Health & Unauth 401 / Forbidden 403
  if (!workerUrl) {
    record(
      'Cloudflare Worker (teacheros-api)',
      'SKIP',
      'Chưa thiết lập VITE_CLOUDFLARE_API_URL.'
    );
  } else {
    try {
      const healthRes = await fetch(`${workerUrl}/api/health`);
      const healthBody = await healthRes.json().catch(() => ({}));
      record(
        'Worker GET /api/health',
        healthRes.ok && healthBody.ok === true && healthBody.configured === true
          ? 'PASS'
          : 'FAIL',
        `HTTP ${healthRes.status}, service=${healthBody.service}, configured=${healthBody.configured}`
      );

      const unauthRes = await fetch(`${workerUrl}/api/v1/auth/me`);
      record(
        'Worker GET /api/v1/auth/me (no token -> 401)',
        unauthRes.status === 401 ? 'PASS' : 'FAIL',
        `HTTP ${unauthRes.status}`
      );

      const invalidRes = await fetch(`${workerUrl}/api/v1/auth/me`, {
        headers: { Authorization: 'Bearer invalid.jwt.token' },
      });
      record(
        'Worker GET /api/v1/auth/me (invalid token -> 401)',
        invalidRes.status === 401 ? 'PASS' : 'FAIL',
        `HTTP ${invalidRes.status}`
      );

      const probeRes = await fetch(`${workerUrl}/api/v1/answer-keys/probe`);
      record(
        'Worker Answer-Key Probe Blocked (403)',
        probeRes.status === 403 ? 'PASS' : 'FAIL',
        `HTTP ${probeRes.status}`
      );
    } catch (err) {
      record('Cloudflare Worker Probes', 'FAIL', String(err));
    }
  }

  // 4. Optional Real Student Auth + Negative RBAC + Self-Escalation Test
  if (!studentEmail || !studentPassword) {
    record(
      'Authenticated Student E2E & RBAC Negative Checks',
      'SKIP',
      'Đặt TEST_STUDENT_EMAIL và TEST_STUDENT_PASSWORD để kiểm thử JWT & RLS thực tế.'
    );
  } else {
    try {
      const loginRes = await fetch(
        `${supabaseUrl}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: {
            apikey: publishableKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: studentEmail,
            password: studentPassword,
          }),
        }
      );
      const loginBody = await loginRes.json();
      if (!loginRes.ok || !loginBody.access_token) {
        record(
          'Supabase Auth Student Sign-In',
          'FAIL',
          `HTTP ${loginRes.status}`
        );
      } else {
        const token = loginBody.access_token;
        const userId = loginBody.user?.id;
        record('Supabase Auth Student Sign-In', 'PASS', `userId=${userId}`);

        // Student self-escalation directly on public.user_roles MUST fail (401/403)
        const selfEscalateDb = await fetch(`${supabaseUrl}/rest/v1/user_roles`, {
          method: 'POST',
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: userId, role: 'admin' }),
        });
        record(
          'RLS Blocks Student Self-Escalation on public.user_roles',
          !selfEscalateDb.ok ? 'PASS' : 'FAIL',
          `HTTP ${selfEscalateDb.status} (must fail)`
        );

        if (workerUrl) {
          const meRes = await fetch(`${workerUrl}/api/v1/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const meBody = await meRes.json().catch(() => ({}));
          record(
            'Worker GET /api/v1/auth/me (real student JWT -> 200)',
            meRes.ok && meBody.user?.primaryRole === 'student' ? 'PASS' : 'FAIL',
            `HTTP ${meRes.status}, primaryRole=${meBody.user?.primaryRole}`
          );

          const grantRes = await fetch(`${workerUrl}/api/v1/roles/grant`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': `live-verify-block-${Date.now()}`,
            },
            body: JSON.stringify({ targetUserId: userId, role: 'admin' }),
          });
          record(
            'Worker Blocks Student POST /api/v1/roles/grant (403)',
            grantRes.status === 403 ? 'PASS' : 'FAIL',
            `HTTP ${grantRes.status}`
          );

          const teacherRouteRes = await fetch(
            `${workerUrl}/api/v1/teacher/classrooms`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          record(
            'Worker Blocks Student GET /api/v1/teacher/classrooms (403)',
            teacherRouteRes.status === 403 ? 'PASS' : 'FAIL',
            `HTTP ${teacherRouteRes.status}`
          );
        }
      }
    } catch (err) {
      record('Authenticated Student E2E', 'FAIL', String(err));
    }
  }

  console.log('\n=== Summary ===');
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const skipCount = results.filter((r) => r.status === 'SKIP').length;
  console.log(`PASS=${passCount} FAIL=${failCount} SKIP=${skipCount}`);
  process.exit(failed ? 1 : 0);
}

run();

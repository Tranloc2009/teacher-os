import type { WorkerEnv } from './types';

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{8,128}$/;

export function validateIdempotencyKey(raw: string | null): {
  valid: boolean;
  key?: string;
  error?: string;
} {
  if (!raw || !raw.trim()) {
    return {
      valid: false,
      error: 'Thiếu header bắt buộc Idempotency-Key cho thao tác ghi dữ liệu.',
    };
  }
  const key = raw.trim();
  if (!IDEMPOTENCY_KEY_REGEX.test(key)) {
    return {
      valid: false,
      error:
        'Idempotency-Key không hợp lệ (cần 8-128 ký tự chữ, số hoặc . _ : -).',
    };
  }
  return { valid: true, key };
}

/**
 * Computes deterministic SHA-256 hex digest of the canonical request payload so
 * reusing an Idempotency-Key with a different payload is rejected with 409.
 */
export async function hashIdempotencyPayload(payload: unknown): Promise<string> {
  const canonical = JSON.stringify(payload ?? {});
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type DurableIdempotencyClaimResult =
  | { outcome: 'claimed' }
  | { outcome: 'replay'; status: number; body: unknown }
  | { outcome: 'conflict_payload' }
  | { outcome: 'in_progress' }
  | { outcome: 'store_unavailable'; message: string };

function getSupabaseOrigin(env: WorkerEnv): string | null {
  if (!env.SUPABASE_URL) return null;
  try {
    return new URL(env.SUPABASE_URL.trim()).origin;
  } catch {
    return null;
  }
}

async function callServiceRpc(
  env: WorkerEnv,
  rpcName: string,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<Response> {
  const origin = getSupabaseOrigin(env);
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!origin || !secretKey) {
    throw new Error('SUPABASE_SERVICE_CONFIG_MISSING');
  }

  return fetchImpl(`${origin}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(params),
  });
}

/**
 * Atomically claims an Idempotency-Key inside PostgreSQL
 * (exam_private.api_idempotency_keys via service_role-only RPC).
 * Fails closed if the durable DB store is unavailable (never silently falls
 * back to unsafe isolate-only memory).
 */
export async function claimDurableIdempotencyKey(
  env: WorkerEnv,
  params: {
    actorId: string;
    method: string;
    routePath: string;
    idempotencyKey: string;
    requestHash: string;
    ttlSeconds?: number;
  },
  fetchImpl: typeof fetch
): Promise<DurableIdempotencyClaimResult> {
  try {
    const res = await callServiceRpc(
      env,
      'server_claim_idempotency_key',
      {
        p_actor_id: params.actorId,
        p_method: params.method.toUpperCase(),
        p_route_path: params.routePath,
        p_idempotency_key: params.idempotencyKey,
        p_request_hash: params.requestHash,
        p_ttl_seconds: params.ttlSeconds ?? 86400,
      },
      fetchImpl
    );

    if (!res.ok) {
      return {
        outcome: 'store_unavailable',
        message:
          'Không thể xác minh ràng buộc Idempotency-Key trong PostgreSQL (hãy kiểm tra Migration 003 đã được áp dụng).',
      };
    }

    const rows = (await res.json()) as Array<{
      outcome?: string;
      response_status?: number | null;
      response_body?: unknown;
    }>;
    const row = Array.isArray(rows) ? rows[0] : (rows as unknown as {
      outcome?: string;
      response_status?: number | null;
      response_body?: unknown;
    });

    if (!row?.outcome) {
      return {
        outcome: 'store_unavailable',
        message: 'Phản hồi kiểm tra Idempotency-Key từ PostgreSQL không hợp lệ.',
      };
    }

    if (row.outcome === 'claimed') {
      return { outcome: 'claimed' };
    }
    if (row.outcome === 'replay') {
      return {
        outcome: 'replay',
        status: typeof row.response_status === 'number' ? row.response_status : 200,
        body: row.response_body ?? { ok: true },
      };
    }
    if (row.outcome === 'conflict_payload') {
      return { outcome: 'conflict_payload' };
    }
    return { outcome: 'in_progress' };
  } catch {
    return {
      outcome: 'store_unavailable',
      message: 'Lỗi kết nối khi kiểm tra Idempotency-Key bền vững trong cơ sở dữ liệu.',
    };
  }
}

export async function completeDurableIdempotencyKey(
  env: WorkerEnv,
  params: {
    actorId: string;
    method: string;
    routePath: string;
    idempotencyKey: string;
    responseStatus: number;
    responseBody: unknown;
  },
  fetchImpl: typeof fetch
): Promise<void> {
  try {
    await callServiceRpc(
      env,
      'server_complete_idempotency_key',
      {
        p_actor_id: params.actorId,
        p_method: params.method.toUpperCase(),
        p_route_path: params.routePath,
        p_idempotency_key: params.idempotencyKey,
        p_response_status: params.responseStatus,
        p_response_body: params.responseBody,
      },
      fetchImpl
    );
  } catch {
    // Response already committed upstream; never crash after write completion
  }
}

export async function releaseDurableIdempotencyKey(
  env: WorkerEnv,
  params: {
    actorId: string;
    method: string;
    routePath: string;
    idempotencyKey: string;
  },
  fetchImpl: typeof fetch
): Promise<void> {
  try {
    await callServiceRpc(
      env,
      'server_release_idempotency_key',
      {
        p_actor_id: params.actorId,
        p_method: params.method.toUpperCase(),
        p_route_path: params.routePath,
        p_idempotency_key: params.idempotencyKey,
      },
      fetchImpl
    );
  } catch {
    // Best-effort cleanup on transient upstream failure
  }
}

import type { RateLimitResult, WorkerEnv } from './types';
import { getSupabaseOrigin, serviceAuthHeaders } from './supabase';

interface BucketEntry {
  timestamps: number[];
}

const MAX_TRACKED_KEYS = 2000;

/**
 * Isolate-local best-effort sliding-window rate limiter for Cloudflare Workers Free.
 * IMPORTANT: Because Cloudflare Workers can run across multiple edge isolates,
 * this limiter provides BEST-EFFORT per-isolate protection only — NOT global
 * enforcement. Global enforcement on authenticated mutations uses
 * `checkGlobalDurableRateLimit` backed by PostgreSQL (`exam_private.api_rate_limits`),
 * and public `/api/health` should additionally use a Cloudflare Free WAF Rule.
 */
export class IsolateBestEffortRateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();

  check(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number
  ): RateLimitResult {
    const safeLimit = Math.max(1, limit);
    const safeWindow = Math.max(1000, windowMs);
    const cutoff = nowMs - safeWindow;

    if (this.buckets.size > MAX_TRACKED_KEYS) {
      this.prune(cutoff);
    }

    const entry = this.buckets.get(key) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

    if (entry.timestamps.length >= safeLimit) {
      const oldest = entry.timestamps[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, oldest + safeWindow - nowMs);
      this.buckets.set(key, entry);
      return {
        allowed: false,
        limit: safeLimit,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        scope: 'isolate-best-effort',
      };
    }

    entry.timestamps.push(nowMs);
    this.buckets.set(key, entry);

    return {
      allowed: true,
      limit: safeLimit,
      remaining: Math.max(0, safeLimit - entry.timestamps.length),
      retryAfterSeconds: 0,
      scope: 'isolate-best-effort',
    };
  }

  clear(): void {
    this.buckets.clear();
  }

  private prune(cutoff: number): void {
    for (const [key, entry] of this.buckets.entries()) {
      const active = entry.timestamps.filter((ts) => ts > cutoff);
      if (active.length === 0) {
        this.buckets.delete(key);
      } else {
        entry.timestamps = active;
      }
    }
  }
}

/**
 * Global multi-instance durable rate limiter backed by PostgreSQL
 * (`exam_private.api_rate_limits` via `server_check_rate_limit` RPC).
 * Consistent across multiple Cloudflare Worker isolates on Supabase Free.
 */
export async function checkGlobalDurableRateLimit(
  env: WorkerEnv,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
  fetchImpl: typeof fetch
): Promise<{ ok: true; result: RateLimitResult } | { ok: false; message: string }> {
  const origin = getSupabaseOrigin(env.SUPABASE_URL);
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!origin || !secretKey) {
    return {
      ok: false,
      message: 'Thiếu cấu hình Supabase để kiểm tra global rate limit.',
    };
  }

  try {
    const res = await fetchImpl(`${origin}/rest/v1/rpc/server_check_rate_limit`, {
      method: 'POST',
      headers: {
        ...serviceAuthHeaders(secretKey),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        p_bucket_key: bucketKey,
        p_limit: Math.max(1, limit),
        p_window_seconds: Math.max(10, windowSeconds),
      }),
    });

    if (!res.ok) {
      return {
        ok: false,
        message: 'Không thể kiểm tra bộ đếm giới hạn tần suất toàn cục trên PostgreSQL.',
      };
    }

    const rows = (await res.json()) as Array<{
      allowed?: boolean;
      remaining?: number;
      retry_after_seconds?: number;
    }>;
    const row = Array.isArray(rows) ? rows[0] : (rows as unknown as {
      allowed?: boolean;
      remaining?: number;
      retry_after_seconds?: number;
    });

    if (typeof row?.allowed !== 'boolean') {
      return {
        ok: false,
        message: 'Phản hồi global rate limit từ PostgreSQL không hợp lệ.',
      };
    }

    return {
      ok: true,
      result: {
        allowed: row.allowed,
        limit: Math.max(1, limit),
        remaining: typeof row.remaining === 'number' ? row.remaining : 0,
        retryAfterSeconds:
          typeof row.retry_after_seconds === 'number'
            ? row.retry_after_seconds
            : 1,
        scope: 'global-db-backed',
      },
    };
  } catch {
    return {
      ok: false,
      message: 'Lỗi kết nối khi kiểm tra global rate limit.',
    };
  }
}

export function extractClientIdentifier(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (cfIp) return cfIp;
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return 'local-client';
}

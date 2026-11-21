/**
 * Strict Origin-Restricted CORS & Security Headers for Cloudflare Workers.
 * NEVER emits wildcard '*' for authenticated APIs.
 */

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const results: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed || trimmed === '*') continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        results.push(parsed.origin);
      }
    } catch {
      // Ignore malformed origin entries safely
    }
  }
  return Array.from(new Set(results));
}

export function isOriginAllowed(
  requestOrigin: string | null,
  allowedOrigins: string[]
): boolean {
  if (!requestOrigin) return true; // Non-browser server/CLI request without Origin header
  if (requestOrigin === '*') return false;
  try {
    const normalized = new URL(requestOrigin).origin;
    return allowedOrigins.includes(normalized);
  } catch {
    return false;
  }
}

export function buildSecurityHeaders(
  requestOrigin: string | null,
  allowedOrigins: string[],
  requestId: string
): Headers {
  const headers = new Headers();
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Request-Id', requestId);
  headers.set('Vary', 'Origin');

  if (requestOrigin && isOriginAllowed(requestOrigin, allowedOrigins)) {
    const normalized = new URL(requestOrigin).origin;
    headers.set('Access-Control-Allow-Origin', normalized);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Idempotency-Key'
    );
    headers.set('Access-Control-Max-Age', '600');
  }

  return headers;
}

export type CloudConfigStatus =
  | 'configured'
  | 'not-configured'
  | 'invalid-config'
  | 'secret-key-blocked';

export interface SupabasePublicEnvInput {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_CLOUDFLARE_API_URL?: string;
}

export interface EvaluatedCloudConfig {
  status: CloudConfigStatus;
  supabaseUrl: string | null;
  publishableKey: string | null;
  publishableKeyPreview: string | null;
  cloudflareApiUrl: string | null;
  isReady: boolean;
  issues: string[];
}

function decodeBase64UrlSegment(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const pad =
      normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    if (typeof atob === 'function') {
      return atob(normalized + pad);
    }
    return Buffer.from(normalized + pad, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Explicitly detects and blocks Supabase secret/service_role keys from ever
 * being accepted or used in the browser frontend.
 */
export function detectForbiddenSecretKey(rawKey: string): string | null {
  const key = rawKey.trim();
  if (!key) return null;

  if (/^sb_secret_/i.test(key)) {
    return 'Phát hiện Supabase Secret Key (sb_secret_*) trong cấu hình frontend. Khóa bí mật chỉ được phép đặt ở Cloudflare Worker bằng wrangler secret put.';
  }

  const parts = key.split('.');
  if (parts.length === 3) {
    const decoded = decodeBase64UrlSegment(parts[1]);
    if (decoded) {
      try {
        const payload = JSON.parse(decoded) as { role?: unknown };
        if (
          payload.role === 'service_role' ||
          payload.role === 'supabase_admin'
        ) {
          return 'Phát hiện JWT service_role trong cấu hình frontend. TUYỆT ĐỐI chỉ sử dụng Publishable / Anon key ở trình duyệt.';
        }
      } catch {
        // Not a JSON JWT payload
      }
    }
  }

  return null;
}

export function validateHttpsServiceUrl(
  rawUrl: string,
  fieldLabel: string
): { valid: boolean; origin?: string; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: `Thiếu ${fieldLabel}.` };
  }
  try {
    const parsed = new URL(trimmed);
    const isLocalDev =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDev)) {
      return {
        valid: false,
        error: `${fieldLabel} phải sử dụng giao thức HTTPS (chỉ cho phép HTTP với localhost).`,
      };
    }
    return { valid: true, origin: parsed.origin };
  } catch {
    return {
      valid: false,
      error: `${fieldLabel} không phải là URL hợp lệ.`,
    };
  }
}

export function maskPublishableKeyPreview(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return '••••••••';
  return `${trimmed.slice(0, 12)}…${trimmed.slice(-4)}`;
}

export function evaluateSupabaseEnv(
  env: SupabasePublicEnvInput
): EvaluatedCloudConfig {
  const rawUrl = (env.VITE_SUPABASE_URL ?? '').trim();
  const rawKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  const rawWorkerUrl = (env.VITE_CLOUDFLARE_API_URL ?? '').trim();

  if (!rawUrl && !rawKey) {
    return {
      status: 'not-configured',
      supabaseUrl: null,
      publishableKey: null,
      publishableKeyPreview: null,
      cloudflareApiUrl: null,
      isReady: false,
      issues: [
        'Chưa cấu hình VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY. TeacherOS đang chạy hoàn toàn cục bộ (IndexedDB).',
      ],
    };
  }

  // Always check for secret key exposure first so it fails loudly and safely
  const secretKeyError = detectForbiddenSecretKey(rawKey);
  if (secretKeyError) {
    return {
      status: 'secret-key-blocked',
      supabaseUrl: null,
      publishableKey: null,
      publishableKeyPreview: null,
      cloudflareApiUrl: null,
      isReady: false,
      issues: [secretKeyError],
    };
  }

  const issues: string[] = [];
  const urlCheck = validateHttpsServiceUrl(rawUrl, 'VITE_SUPABASE_URL');
  if (!urlCheck.valid) {
    issues.push(urlCheck.error ?? 'VITE_SUPABASE_URL không hợp lệ.');
  }

  if (!rawKey) {
    issues.push('Thiếu VITE_SUPABASE_PUBLISHABLE_KEY (khóa công khai Supabase).');
  } else if (rawKey.length < 20) {
    issues.push('VITE_SUPABASE_PUBLISHABLE_KEY quá ngắn hoặc không đúng định dạng.');
  }

  let cloudflareApiUrl: string | null = null;
  if (rawWorkerUrl) {
    const workerCheck = validateHttpsServiceUrl(
      rawWorkerUrl,
      'VITE_CLOUDFLARE_API_URL'
    );
    if (!workerCheck.valid) {
      issues.push(workerCheck.error ?? 'VITE_CLOUDFLARE_API_URL không hợp lệ.');
    } else {
      cloudflareApiUrl = workerCheck.origin ?? null;
    }
  }

  if (issues.length > 0 || !urlCheck.origin) {
    return {
      status: 'invalid-config',
      supabaseUrl: urlCheck.origin ?? null,
      publishableKey: null,
      publishableKeyPreview: null,
      cloudflareApiUrl,
      isReady: false,
      issues,
    };
  }

  return {
    status: 'configured',
    supabaseUrl: urlCheck.origin,
    publishableKey: rawKey,
    publishableKeyPreview: maskPublishableKeyPreview(rawKey),
    cloudflareApiUrl,
    isReady: true,
    issues: [],
  };
}

export function getRuntimeCloudConfig(): EvaluatedCloudConfig {
  const metaEnv = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env;
  return evaluateSupabaseEnv({
    VITE_SUPABASE_URL: metaEnv?.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: metaEnv?.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_CLOUDFLARE_API_URL: metaEnv?.VITE_CLOUDFLARE_API_URL,
  });
}

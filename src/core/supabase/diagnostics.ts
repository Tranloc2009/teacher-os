import {
  getRuntimeCloudConfig,
  type EvaluatedCloudConfig,
} from './config';

export type DiagnosticStatus =
  | 'not-configured'
  | 'secret-key-blocked'
  | 'invalid-config'
  | 'connected'
  | 'auth-error'
  | 'unreachable';

export type WorkerProbeStatus = 'not-configured' | 'healthy' | 'unreachable';
export type WorkerAuthProbeStatus =
  | 'not-tested'
  | 'unauth-401-verified'
  | 'authenticated-200-verified'
  | 'failed';

export interface CloudDiagnosticReport {
  status: DiagnosticStatus;
  checkedAt: string;
  latencyMs: number | null;
  supabaseUrl: string | null;
  workerUrl: string | null;
  workerStatus: WorkerProbeStatus;
  workerAuthStatus: WorkerAuthProbeStatus;
  workerServiceName: string | null;
  summary: string;
  details: string[];
}

export interface DiagnosticOptions {
  config?: EvaluatedCloudConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  accessToken?: string | null;
}

/**
 * Runs a REAL live network check against Supabase Auth health endpoint
 * and optional Cloudflare Worker (`teacheros-api`) `/api/health` + `/api/v1/auth/me`.
 * NEVER fabricates "connected".
 */
export async function runSupabaseConnectionDiagnostic(
  options: DiagnosticOptions = {}
): Promise<CloudDiagnosticReport> {
  const config = options.config ?? getRuntimeCloudConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 6000;
  const checkedAt = new Date().toISOString();

  if (config.status === 'not-configured') {
    return {
      status: 'not-configured',
      checkedAt,
      latencyMs: null,
      supabaseUrl: null,
      workerUrl: null,
      workerStatus: 'not-configured',
      workerAuthStatus: 'not-tested',
      workerServiceName: null,
      summary:
        'Chưa cấu hình Supabase Free. Hệ thống đang hoạt động 100% cục bộ (IndexedDB).',
      details: config.issues,
    };
  }

  if (config.status === 'secret-key-blocked') {
    return {
      status: 'secret-key-blocked',
      checkedAt,
      latencyMs: null,
      supabaseUrl: null,
      workerUrl: null,
      workerStatus: 'not-configured',
      workerAuthStatus: 'not-tested',
      workerServiceName: null,
      summary:
        'ĐÃ CHẶN KẾT NỐI: Phát hiện khóa bí mật (Secret / service_role) trong biến frontend.',
      details: config.issues,
    };
  }

  if (!config.isReady || !config.supabaseUrl || !config.publishableKey) {
    return {
      status: 'invalid-config',
      checkedAt,
      latencyMs: null,
      supabaseUrl: config.supabaseUrl,
      workerUrl: config.cloudflareApiUrl,
      workerStatus: config.cloudflareApiUrl ? 'unreachable' : 'not-configured',
      workerAuthStatus: 'not-tested',
      workerServiceName: null,
      summary: 'Cấu hình biến môi trường Supabase chưa hợp lệ.',
      details: config.issues,
    };
  }

  const startedAt = Date.now();
  const details: string[] = [];
  let status: DiagnosticStatus = 'unreachable';
  let summary = 'Không thể kết nối tới máy chủ Supabase.';
  let latencyMs: number | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/health`, {
      method: 'GET',
      headers: {
        apikey: config.publishableKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    latencyMs = Date.now() - startedAt;

    if (response.ok) {
      status = 'connected';
      summary = `Kết nối thật tới Supabase Auth thành công (${latencyMs} ms).`;
      details.push(`Supabase Auth Health HTTP ${response.status} OK.`);
    } else if (response.status === 401 || response.status === 403) {
      status = 'auth-error';
      summary = `Supabase từ chối Publishable Key (HTTP ${response.status}).`;
      details.push(
        'Kiểm tra lại VITE_SUPABASE_PUBLISHABLE_KEY trong Supabase Project Settings → API Keys.'
      );
    } else {
      status = 'unreachable';
      summary = `Supabase trả về mã lỗi HTTP ${response.status}.`;
      details.push(
        'Dự án Supabase Free có thể đang tạm dừng (paused) hoặc đang khởi động.'
      );
    }
  } catch (err) {
    latencyMs = Date.now() - startedAt;
    status = 'unreachable';
    summary = 'Không thể kết nối mạng tới Supabase URL đã cấu hình.';
    details.push(
      err instanceof Error && err.name === 'AbortError'
        ? `Quá thời gian chờ (${timeoutMs} ms).`
        : 'Kiểm tra kết nối Internet, DNS hoặc cấu hình CORS/URL của dự án Supabase.'
    );
  } finally {
    clearTimeout(timer);
  }

  // Real probe against Cloudflare Worker (`teacheros-api`) if configured
  let workerStatus: WorkerProbeStatus = 'not-configured';
  let workerAuthStatus: WorkerAuthProbeStatus = 'not-tested';
  let workerServiceName: string | null = null;

  if (config.cloudflareApiUrl) {
    const workerController = new AbortController();
    const workerTimer = setTimeout(() => workerController.abort(), timeoutMs);
    try {
      const workerRes = await fetchImpl(
        `${config.cloudflareApiUrl}/api/health`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: workerController.signal,
        }
      );
      if (workerRes.ok) {
        let validWorkerHealth = false;
        try {
          const body = (await workerRes.json()) as {
            ok?: boolean;
            service?: string;
            configured?: boolean;
          };
          if (body?.ok === true && body?.service === 'teacheros-api') {
            validWorkerHealth = true;
            workerStatus = 'healthy';
            workerServiceName = body.service;
            details.push(
              `Cloudflare Worker (${workerServiceName}) /api/health HTTP ${workerRes.status} OK (configured=${String(Boolean(body.configured))}).`
            );
          } else {
            workerStatus = 'unreachable';
            details.push(
              'Worker phản hồi JSON nhưng không phải dịch vụ teachero-api Phase 4A.'
            );
          }
        } catch {
          workerStatus = 'unreachable';
          details.push(
            'URL Worker trả về nội dung không phải JSON chuẩn của teachero-api (có thể vẫn đang chạy template Hello World mặc định).'
          );
        }

        // Verify /api/v1/auth/me protection & live JWT flow only when real teachero-api responded
        if (validWorkerHealth && options.accessToken) {
          const authMeRes = await fetchImpl(
            `${config.cloudflareApiUrl}/api/v1/auth/me`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${options.accessToken}`,
                Accept: 'application/json',
              },
              signal: workerController.signal,
            }
          );
          if (authMeRes.ok) {
            workerAuthStatus = 'authenticated-200-verified';
            details.push('Worker /api/v1/auth/me xác minh JWT + vai trò DB thành công (HTTP 200).');
          } else {
            workerAuthStatus = 'failed';
            details.push(`Worker /api/v1/auth/me trả về HTTP ${authMeRes.status} với phiên hiện tại.`);
          }
        } else if (validWorkerHealth) {
          const unauthMeRes = await fetchImpl(
            `${config.cloudflareApiUrl}/api/v1/auth/me`,
            {
              method: 'GET',
              headers: { Accept: 'application/json' },
              signal: workerController.signal,
            }
          );
          if (unauthMeRes.status === 401) {
            workerAuthStatus = 'unauth-401-verified';
            details.push('Worker /api/v1/auth/me chặn đúng truy cập chưa đăng nhập (HTTP 401).');
          } else {
            workerAuthStatus = 'failed';
            details.push(`Cảnh báo: /api/v1/auth/me không trả về 401 khi thiếu token (HTTP ${unauthMeRes.status}).`);
          }
        }
      } else {
        workerStatus = 'unreachable';
        details.push(
          `Cloudflare Worker /api/health trả về HTTP ${workerRes.status}.`
        );
      }
    } catch {
      workerStatus = 'unreachable';
      details.push(
        'Không kết nối được tới VITE_CLOUDFLARE_API_URL (/api/health). Kiểm tra Worker đã deploy và ALLOWED_ORIGINS.'
      );
    } finally {
      clearTimeout(workerTimer);
    }
  }

  return {
    status,
    checkedAt,
    latencyMs,
    supabaseUrl: config.supabaseUrl,
    workerUrl: config.cloudflareApiUrl,
    workerStatus,
    workerAuthStatus,
    workerServiceName,
    summary,
    details,
  };
}

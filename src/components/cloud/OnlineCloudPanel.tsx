import { FormEvent, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import {
  getCurrentCloudUser,
  signInWithEmailPassword,
  signOutCloudUser,
  signUpStudentAccount,
  subscribeCloudAuthState,
  type CloudAuthUserState,
  type CloudUserRole,
} from '../../core/supabase/authService';
import { getSupabaseClient } from '../../core/supabase/client';
import { getRuntimeCloudConfig } from '../../core/supabase/config';
import {
  runSupabaseConnectionDiagnostic,
  type CloudDiagnosticReport,
} from '../../core/supabase/diagnostics';

const ROLE_LABELS: Record<CloudUserRole, string> = {
  admin: 'Quản trị (Admin)',
  teacher: 'Giáo viên (Teacher)',
  student: 'Học sinh (Student)',
};

export function OnlineCloudPanel() {
  const config = getRuntimeCloudConfig();
  const [diagnostic, setDiagnostic] = useState<CloudDiagnosticReport | null>(
    null
  );
  const [checking, setChecking] = useState(false);

  const [cloudUser, setCloudUser] = useState<CloudAuthUserState | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [authFeedback, setAuthFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!config.isReady) {
      setCloudUser(null);
      return;
    }
    void getCurrentCloudUser().then(setCloudUser);
    return subscribeCloudAuthState(setCloudUser);
  }, [config.isReady]);

  const handleRunDiagnostic = async () => {
    setChecking(true);
    try {
      let accessToken: string | null = null;
      const client = getSupabaseClient(config);
      if (client) {
        const { data } = await client.auth.getSession();
        accessToken = data.session?.access_token ?? null;
      }
      const report = await runSupabaseConnectionDiagnostic({
        config,
        accessToken,
      });
      setDiagnostic(report);
    } finally {
      setChecking(false);
    }
  };

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthFeedback(null);
    setAuthLoading(true);
    try {
      const result =
        authTab === 'signin'
          ? await signInWithEmailPassword(email, password)
          : await signUpStudentAccount({ email, password, fullName });

      if (result.ok) {
        setAuthFeedback({ type: 'success', text: result.message });
        if (result.user) {
          setCloudUser(result.user);
        }
        setPassword('');
      } else {
        setAuthFeedback({ type: 'error', text: result.message });
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthFeedback(null);
    setAuthLoading(true);
    try {
      const result = await signOutCloudUser();
      setCloudUser(null);
      setAuthFeedback({
        type: result.ok ? 'success' : 'error',
        text: result.message,
      });
    } finally {
      setAuthLoading(false);
    }
  };

  const effectiveStatus = diagnostic?.status ?? config.status;

  const statusMeta = (() => {
    switch (effectiveStatus) {
      case 'connected':
        if (diagnostic?.workerUrl && diagnostic.workerStatus !== 'healthy') {
          return {
            label: 'Supabase OK — Worker chưa sẵn sàng',
            tone: 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200',
            Icon: AlertTriangle,
          };
        }
        return {
          label: 'Đã kết nối thật (Supabase Free)',
          tone: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200',
          Icon: CheckCircle2,
        };
      case 'secret-key-blocked':
        return {
          label: 'Đã chặn Secret Key ở Frontend',
          tone: 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/60 text-red-900 dark:text-red-200',
          Icon: AlertTriangle,
        };
      case 'invalid-config':
      case 'auth-error':
      case 'unreachable':
        return {
          label:
            effectiveStatus === 'auth-error'
              ? 'Publishable Key bị từ chối'
              : effectiveStatus === 'unreachable'
              ? 'Không thể kết nối'
              : 'Cấu hình chưa hợp lệ',
          tone: 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200',
          Icon: AlertTriangle,
        };
      case 'configured':
        return {
          label: 'Đã cấu hình — Chưa kiểm tra kết nối',
          tone: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200',
          Icon: Cloud,
        };
      default:
        return {
          label: 'Chưa cấu hình (Chỉ chạy Cục bộ)',
          tone: 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200',
          Icon: CloudOff,
        };
    }
  })();

  const StatusIcon = statusMeta.Icon;

  return (
    <section
      aria-labelledby="cloud-foundation-heading"
      data-testid="settings-cloud-foundation"
      className="tos-card-pad rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="h-5 w-5 text-blue-900 dark:text-blue-400 mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <h2
              id="cloud-foundation-heading"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Nền tảng Trực tuyến &amp; Bảo mật (Phase 4A — Free Tier Only)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Kết nối tùy chọn với Supabase Free (Auth + PostgreSQL + RLS) và Cloudflare Workers Free. Dữ liệu cục bộ IndexedDB luôn tách biệt và không tự tải lên.
            </p>
          </div>
        </div>

        <span
          data-testid="cloud-status-badge"
          className={`self-start inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap shrink-0 ${statusMeta.tone}`}
        >
          <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{statusMeta.label}</span>
        </span>
      </div>

      {/* Explicit Local vs Cloud Separation Bento Grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <HardDrive className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span>Chế độ Cục bộ (Local-First · IndexedDB)</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Resource Vault, ngân hàng câu hỏi, đề thi, mẫu A4 và bảng điểm của TeacherOS 4.0/4.1 vẫn nằm hoàn toàn trên máy bạn. Không tự động đồng bộ lên Cloud.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Lock className="h-4 w-4 text-blue-900 dark:text-blue-400 shrink-0" aria-hidden="true" />
            <span>Bảo vệ Đáp án &amp; Chi phí $0</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Trình duyệt chỉ dùng Publishable Key. Đáp án chính thức nằm trong schema riêng <code className="font-mono-num">exam_private</code> phía server; không dùng dịch vụ trả phí hay AI API.
          </p>
        </div>
      </div>

      {/* Real Connection Diagnostic Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 text-xs">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Trạng thái cấu hình môi trường Frontend (Vite)
            </p>
            <p className="text-slate-600 dark:text-slate-300 font-mono-num break-all">
              URL: {config.supabaseUrl ?? 'Chưa thiết lập (VITE_SUPABASE_URL)'} · Key:{' '}
              {config.publishableKeyPreview ?? 'Chưa thiết lập'}
            </p>
            <p className="text-slate-500 dark:text-slate-400 font-mono-num break-all">
              Cloudflare Worker: {config.cloudflareApiUrl ?? 'Chưa thiết lập (tùy chọn VITE_CLOUDFLARE_API_URL)'}
            </p>
          </div>

          <button
            type="button"
            data-testid="cloud-run-diagnostic-btn"
            disabled={checking}
            onClick={() => void handleRunDiagnostic()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60 whitespace-nowrap"
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Kiểm tra kết nối thật</span>
          </button>
        </div>

        {diagnostic && (
          <div
            data-testid="cloud-diagnostic-result"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs space-y-1.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {diagnostic.summary}
              </span>
              <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                {new Date(diagnostic.checkedAt).toLocaleTimeString('vi-VN')}
              </span>
            </div>
            {diagnostic.details.length > 0 && (
              <ul className="list-disc pl-5 space-y-0.5 text-slate-600 dark:text-slate-300">
                {diagnostic.details.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Honest Setup Guide when Not Configured */}
      {!config.isReady && (
        <div
          data-testid="cloud-setup-instructions"
          className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/60 dark:bg-amber-950/30 p-4 space-y-2.5 text-xs text-slate-800 dark:text-slate-200"
        >
          <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Hướng dẫn kích hoạt Supabase Free &amp; Cloudflare Workers Free</span>
          </div>
          <ol className="list-decimal pl-5 space-y-1 text-slate-700 dark:text-slate-300 leading-relaxed">
            <li>
              Xác minh dự án <strong>Supabase Free ($0)</strong> của TeacherOS trước khi áp dụng các migration trong{' '}
              <code className="font-mono-num">supabase/migrations/</code>.
            </li>
            <li>
              Đặt <code className="font-mono-num">VITE_SUPABASE_URL</code> và{' '}
              <code className="font-mono-num">VITE_SUPABASE_PUBLISHABLE_KEY</code> (chỉ khóa công khai) trong tệp{' '}
              <code className="font-mono-num">.env.local</code> hoặc biến môi trường Cloudflare Pages.
            </li>
            <li>
              Cài khóa bí mật cho Cloudflare Worker bằng lệnh{' '}
              <code className="font-mono-num">wrangler secret put SUPABASE_SECRET_KEY</code> — tuyệt đối không đưa vào frontend.
            </li>
          </ol>
        </div>
      )}

      {/* Real Supabase Auth Panel (Sign In / Student Sign Up) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Tài khoản Xác thực Supabase Auth (Học sinh / Giáo viên)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Vai trò thực tế được đọc từ bảng <code className="font-mono-num">public.user_roles</code> qua RLS; tài khoản tự đăng ký chỉ nhận quyền Học sinh.
            </p>
          </div>
        </div>

        {cloudUser ? (
          <div
            data-testid="cloud-authenticated-card"
            className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 p-4 flex flex-wrap items-center justify-between gap-4"
          >
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                {cloudUser.fullName || cloudUser.email}
              </p>
              <p className="text-slate-600 dark:text-slate-300 font-mono-num">
                {cloudUser.email}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {cloudUser.roles.map((role) => (
                  <span
                    key={role}
                    className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 text-[11px] font-semibold text-blue-900 dark:text-blue-200"
                  >
                    {ROLE_LABELS[role]}
                  </span>
                ))}
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {cloudUser.rolesVerifiedFromDb
                    ? 'Đã xác minh từ user_roles'
                    : 'Mặc định quyền tối thiểu (student)'}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={authLoading}
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Đăng xuất</span>
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleAuthSubmit(e)} className="space-y-3.5">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('signin');
                  setAuthFeedback(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  authTab === 'signin'
                    ? 'border-blue-800 bg-blue-900 dark:bg-blue-700 text-white'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Đăng nhập</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('signup');
                  setAuthFeedback(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  authTab === 'signup'
                    ? 'border-blue-800 bg-blue-900 dark:bg-blue-700 text-white'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Đăng ký Học sinh</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {authTab === 'signup' && (
                <div className="sm:col-span-2">
                  <label
                    htmlFor="cloud-auth-fullname"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Họ và tên học sinh
                  </label>
                  <input
                    id="cloud-auth-fullname"
                    type="text"
                    disabled={!config.isReady || authLoading}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nguyễn Văn An"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="cloud-auth-email"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Email
                </label>
                <input
                  id="cloud-auth-email"
                  type="email"
                  required
                  disabled={!config.isReady || authLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="hocsinh@truong.edu.vn"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor="cloud-auth-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Mật khẩu (tối thiểu 8 ký tự)
                </label>
                <input
                  id="cloud-auth-password"
                  type="password"
                  required
                  minLength={8}
                  disabled={!config.isReady || authLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
              </div>
            </div>

            {authFeedback && (
              <p
                role="alert"
                className={`text-xs font-medium ${
                  authFeedback.type === 'success'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {authFeedback.text}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {config.isReady
                  ? 'Kết nối trực tiếp Supabase Auth (không lưu khóa bí mật trên trình duyệt).'
                  : 'Cần cấu hình biến môi trường Supabase Free trước khi đăng nhập trực tuyến.'}
              </span>

              <button
                type="submit"
                data-testid="cloud-auth-submit-btn"
                disabled={!config.isReady || authLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap"
              >
                {authLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : authTab === 'signin' ? (
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>
                  {authTab === 'signin' ? 'Đăng nhập trực tuyến' : 'Tạo tài khoản Học sinh'}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

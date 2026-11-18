import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { APP_REGISTRY, AppId } from '../../core/appRegistry';
import { normalizeVietnameseSearchText } from '../../core/localSearch';
import { AppIcon } from './appIcons';

interface AppLauncherProps {
  open: boolean;
  activeApp: AppId;
  onClose: () => void;
  onLaunchApp: (appId: AppId) => void;
}

export function AppLauncher({
  open,
  activeApp,
  onClose,
  onLaunchApp,
}: AppLauncherProps) {
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setFilter('');
      return;
    }
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 20);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const filteredApps = useMemo(() => {
    const q = normalizeVietnameseSearchText(filter);
    if (!q) return APP_REGISTRY;
    return APP_REGISTRY.filter((app) => {
      const hay = normalizeVietnameseSearchText(
        `${app.name} ${app.shortName} ${app.description} ${app.keywords.join(' ')}`
      );
      return hay.includes(q);
    });
  }, [filter]);

  if (!open) return null;

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-start justify-center bg-slate-950/50 p-4 sm:p-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-launcher-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mt-4 sm:mt-10 w-full max-w-4xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div>
            <h2
              id="app-launcher-title"
              className="text-base font-semibold text-slate-950 dark:text-slate-50"
            >
              App Launcher — Hệ sinh thái ứng dụng TeacherOS 4.0
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Chuyển nhanh giữa các ứng dụng mà vẫn giữ nguyên dữ liệu đang nhập trong phiên.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng App Launcher"
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3 bg-slate-50/80 dark:bg-slate-950/40">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="launcher-filter" className="sr-only">
              Lọc ứng dụng trong App Launcher
            </label>
            <input
              ref={inputRef}
              id="launcher-filter"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Lọc theo tên ứng dụng hoặc công việc (ví dụ: soạn bài, in A4, workspace)..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
            />
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filteredApps.length === 0 ? (
            <div className="sm:col-span-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-600 dark:text-slate-400">
              Không tìm thấy ứng dụng phù hợp với &ldquo;{filter}&rdquo;.
            </div>
          ) : (
            filteredApps.map((app) => {
              const isCurrent = activeApp === app.id;
              const isReady = app.status === 'ready';
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => {
                    onLaunchApp(app.id);
                    onClose();
                  }}
                  className={`group flex flex-col justify-between rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-blue-700 ${
                    isCurrent
                      ? 'border-blue-800 dark:border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/80 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                            isReady
                              ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <AppIcon appId={app.id} className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                            {app.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {app.statusLabel}
                            {app.shortcutHint && (
                              <>
                                <span aria-hidden="true" className="mx-1.5">·</span>
                                <span className="font-mono-num">{app.shortcutHint}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <ArrowRight
                        className="h-4 w-4 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 shrink-0 mt-1"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {app.description}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

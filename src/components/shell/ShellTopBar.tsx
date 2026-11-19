import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  ChevronRight,
  HelpCircle,
  Moon,
  PanelLeft,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { AppId, getAppById } from '../../core/appRegistry';
import { ThemeMode } from '../../core/theme';
import { InternalNotificationItem } from '../../core/workspaceTabs';

export type ShellViewId = AppId | 'tools';

const SUB_TOOL_IDS: ReadonlySet<AppId> = new Set([
  'workflow-center',
  'math-mixer',
  'grading-studio',
  'print-studio',
  'teaching-journal',
  'settings',
]);

interface ShellTopBarProps {
  activeView: ShellViewId;
  activeContextTitle?: string;
  theme: ThemeMode;
  notifications: InternalNotificationItem[];
  onToggleSidebar: () => void;
  onSelectDesktop: () => void;
  onOpenToolsHub: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  onToggleTheme: () => void;
  onMarkNotificationsRead: () => void;
  onClearNotifications: () => void;
  onOpenTutorialLauncher?: () => void;
}

export function ShellTopBar({
  activeView,
  activeContextTitle,
  theme,
  notifications,
  onToggleSidebar,
  onSelectDesktop,
  onOpenToolsHub,
  onOpenSettings,
  onOpenCommandPalette,
  onToggleTheme,
  onMarkNotificationsRead,
  onClearNotifications,
  onOpenTutorialLauncher,
}: ShellTopBarProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        notifContainerRef.current &&
        !notifContainerRef.current.contains(e.target as Node)
      ) {
        setNotifOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [notifOpen]);

  const isDesktop = activeView === 'desktop';
  const isToolsHub = activeView === 'tools';
  const currentApp = activeView === 'tools' ? null : getAppById(activeView);
  const isSubTool = currentApp !== null && SUB_TOOL_IDS.has(currentApp.id);

  const primaryBreadcrumbLabel = isDesktop
    ? 'Trang chủ'
    : isToolsHub
    ? 'Tất cả công cụ'
    : currentApp?.name ?? 'Trang chủ';

  return (
    <header className="no-print sticky top-0 z-30 h-16 border-b border-slate-200/70 dark:border-slate-800/80 bg-white/82 dark:bg-slate-900/84 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: Sidebar Toggle + Real Breadcrumb & Current Page Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Ẩn/hiện thanh điều hướng bên trái (Ctrl+B)"
            title="Ẩn/hiện Sidebar (Ctrl+B)"
            className="hidden lg:inline-flex items-center justify-center rounded-xl p-2 text-slate-500 dark:text-slate-400 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-100 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <PanelLeft className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>

          <nav
            aria-label="Đường dẫn vị trí"
            className="flex items-center gap-1.5 min-w-0 text-sm"
          >
            <button
              type="button"
              onClick={onSelectDesktop}
              aria-label="Về trang chủ TeacherOS"
              className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-left font-bold tracking-tight text-[#172033] dark:text-slate-50 hover:text-[#635BFF] dark:hover:text-indigo-400 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-[#635BFF]"
            >
              <span className="inline-flex lg:hidden h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[#635BFF] to-[#3B82F6] text-[11px] font-bold text-white">
                T
              </span>
              <span className={isDesktop ? 'inline' : 'hidden sm:inline'}>
                TeacherOS
              </span>
            </button>

            <ChevronRight
              className={`${
                isDesktop ? 'hidden sm:block' : 'block'
              } h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-700`}
              aria-hidden="true"
            />

            {isSubTool && (
              <>
                <button
                  type="button"
                  onClick={onOpenToolsHub}
                  className="hidden md:inline-flex items-center rounded-lg px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-200 transition-colors whitespace-nowrap shrink-0"
                >
                  Công cụ
                </button>
                <ChevronRight
                  className="hidden md:block h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-700"
                  aria-hidden="true"
                />
              </>
            )}

            <span
              className={`${
                isDesktop ? 'hidden sm:inline' : 'inline'
              } font-semibold text-[#172033] dark:text-slate-100 truncate max-w-[160px] sm:max-w-[240px]`}
            >
              {primaryBreadcrumbLabel}
            </span>

            {!isDesktop && !isToolsHub && activeContextTitle && (
              <>
                <ChevronRight
                  className="hidden xl:block h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-700"
                  aria-hidden="true"
                />
                <span className="hidden xl:inline truncate max-w-[220px] text-xs font-medium text-slate-500 dark:text-slate-400">
                  {activeContextTitle}
                </span>
              </>
            )}
          </nav>
        </div>

        {/* Center: Universal Search Bar (Ctrl+K) */}
        <div className="flex-1 max-w-md hidden sm:block">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            data-tour-id="topbar-search-desktop"
            aria-label="Tìm kiếm nhanh toàn hệ thống (Ctrl+K)"
            className="group flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/85 dark:border-slate-700/80 bg-white/85 dark:bg-slate-800/80 px-3.5 py-2 text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 shadow-[0_1px_2px_rgba(23,32,51,0.03)] hover:border-[#635BFF]/45 dark:hover:border-indigo-500/45 hover:bg-white dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-200 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <span className="inline-flex items-center gap-2.5 truncate">
              <Search
                className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-[#635BFF] dark:group-hover:text-indigo-400 transition-colors"
                aria-hidden="true"
              />
              <span className="truncate">Tìm kiếm bài giảng, tài liệu, đề kiểm tra...</span>
            </span>
            <kbd className="hidden md:inline-block rounded-md border border-slate-200/90 dark:border-slate-700 bg-[#F8F9FF] dark:bg-slate-900 px-1.5 py-0.5 text-[11px] font-mono-num font-medium text-slate-500 dark:text-slate-400 shrink-0">
              Ctrl + K
            </kbd>
          </button>
        </div>

        {/* Right: Real Application Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            data-tour-id="topbar-search-mobile"
            aria-label="Tìm kiếm và bảng lệnh"
            className="inline-flex sm:hidden items-center justify-center rounded-xl p-2 text-slate-600 dark:text-slate-300 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Cài đặt & Sao lưu"
            title="Cài đặt & Sao lưu (Alt+0)"
            className={`inline-flex items-center justify-center rounded-xl p-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#635BFF] ${
              activeView === 'settings'
                ? 'bg-[#F3F0FF] dark:bg-indigo-950/75 text-[#635BFF] dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-300 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-100'
            }`}
          >
            <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>

          {/* Notifications */}
          <div ref={notifContainerRef} className="relative">
            <button
              type="button"
              onClick={() => {
                const next = !notifOpen;
                setNotifOpen(next);
                if (next && unreadCount > 0) {
                  onMarkNotificationsRead();
                }
              }}
              aria-label={
                unreadCount > 0
                  ? `Thông báo hệ thống (${unreadCount} mới)`
                  : 'Thông báo hệ thống'
              }
              title="Thông báo & Nhật ký lưu cục bộ"
              className="relative inline-flex items-center justify-center rounded-xl p-2 text-slate-600 dark:text-slate-300 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-[#635BFF]"
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="ml-1 text-[11px] font-mono-num font-bold text-[#635BFF] dark:text-indigo-400">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div
                role="dialog"
                aria-label="Nhật ký hoạt động và thông báo nội bộ"
                className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl z-50"
              >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <span className="text-xs font-semibold text-[#172033] dark:text-slate-100">
                    Thông báo &amp; Nhật ký lưu cục bộ
                  </span>
                  <div className="flex items-center gap-2.5">
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={onClearNotifications}
                        className="text-[11px] font-medium text-slate-500 hover:text-[#172033] dark:hover:text-slate-200"
                      >
                        Xóa nhật ký
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-[11px] font-semibold text-[#635BFF] dark:text-indigo-400"
                    >
                      Đóng
                    </button>
                  </div>
                </div>

                {notifications.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    Chưa có thông báo mới trong phiên làm việc này.
                  </p>
                ) : (
                  <ul className="mt-2 max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.slice(0, 12).map((item) => {
                      const timeStr = new Date(item.timestamp).toLocaleTimeString(
                        'vi-VN',
                        { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                      );
                      return (
                        <li key={item.id} className="py-2 text-xs space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`font-semibold ${
                                item.tone === 'error'
                                  ? 'text-red-600 dark:text-red-400'
                                  : item.tone === 'info'
                                  ? 'text-[#635BFF] dark:text-indigo-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {item.tone === 'error'
                                ? 'Cảnh báo'
                                : item.tone === 'info'
                                ? 'Thông tin'
                                : 'Hoàn tất'}
                            </span>
                            <span className="font-mono-num text-[11px] text-slate-400">
                              {timeStr}
                            </span>
                          </div>
                          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                            {item.message}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {onOpenTutorialLauncher && (
            <button
              type="button"
              onClick={onOpenTutorialLauncher}
              data-tour-id="topbar-help"
              aria-label="Mở TeacherOS Academy — Hướng dẫn tương tác"
              title="Hướng dẫn sử dụng (TeacherOS Academy)"
              className="inline-flex items-center justify-center rounded-xl p-2 text-slate-600 dark:text-slate-300 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-[#635BFF]"
            >
              <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              theme === 'dark'
                ? 'Chuyển sang giao diện sáng'
                : 'Chuyển sang giao diện tối'
            }
            title={
              theme === 'dark'
                ? 'Chuyển sang giao diện sáng'
                : 'Chuyển sang giao diện tối'
            }
            className="inline-flex items-center justify-center rounded-xl p-2 text-slate-600 dark:text-slate-300 hover:bg-[#EEF0FF] dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-[#635BFF]"
          >
            {theme === 'dark' ? (
              <Sun className="h-[18px] w-[18px] text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

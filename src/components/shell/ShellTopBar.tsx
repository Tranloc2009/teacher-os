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

  const isToolsHub = activeView === 'tools';
  const currentApp = activeView === 'tools' ? null : getAppById(activeView);
  const isSubTool = currentApp !== null && SUB_TOOL_IDS.has(currentApp.id);

  return (
    <header className="no-print sticky top-0 z-30 h-14 border-b border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
        {/* Left: Sidebar Toggle + Brand + Contextual Breadcrumb */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Ẩn/hiện thanh điều hướng bên trái (Ctrl+B)"
            title="Ẩn/hiện Sidebar (Ctrl+B)"
            className="hidden lg:inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors shrink-0"
          >
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onSelectDesktop}
            className="inline-flex items-center gap-2 text-left rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 shrink-0"
          >
            <span className="text-base font-bold tracking-tight text-slate-950 dark:text-slate-50">
              TeacherOS
            </span>
            <span className="rounded-md bg-blue-50 dark:bg-blue-950/70 px-1.5 py-0.5 text-[11px] font-semibold font-mono-num text-blue-600 dark:text-blue-400">
              4.1
            </span>
          </button>

          {(isToolsHub || isSubTool) && (
            <nav
              aria-label="Đường dẫn vị trí"
              className="hidden md:flex items-center gap-1 min-w-0 text-xs text-slate-500 dark:text-slate-400"
            >
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-700" aria-hidden="true" />
              <button
                type="button"
                onClick={onOpenToolsHub}
                className={`rounded px-1.5 py-0.5 transition-colors whitespace-nowrap ${
                  isToolsHub
                    ? 'font-medium text-slate-900 dark:text-slate-100'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Công cụ
              </button>
              {isSubTool && currentApp && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-700" aria-hidden="true" />
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[160px]">
                    {currentApp.shortName}
                  </span>
                </>
              )}
            </nav>
          )}

          {!isToolsHub && !isSubTool && activeContextTitle && activeView !== 'desktop' && (
            <nav
              aria-label="Ngữ cảnh đang mở"
              className="hidden xl:flex items-center gap-1 min-w-0 text-xs text-slate-500 dark:text-slate-400"
            >
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-700" aria-hidden="true" />
              <span className="truncate max-w-[200px] text-slate-600 dark:text-slate-300">
                {activeContextTitle}
              </span>
            </nav>
          )}
        </div>

        {/* Center: Clean Pill Universal Search (Ctrl+K) */}
        <div className="flex-1 max-w-md hidden sm:block">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            data-tour-id="topbar-search-desktop"
            aria-label="Tìm kiếm nhanh toàn hệ thống (Ctrl+K)"
            className="flex w-full items-center justify-between gap-3 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-4 py-1.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="truncate">Tìm kiếm nhanh (Ctrl+K)</span>
            </span>
          </button>
        </div>

        {/* Right: Minimal Utility Icons Only */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            data-tour-id="topbar-search-mobile"
            aria-label="Tìm kiếm và bảng lệnh"
            className="inline-flex sm:hidden items-center justify-center rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Cài đặt & Sao lưu"
            title="Cài đặt & Sao lưu (Alt+0)"
            className={`inline-flex items-center justify-center rounded-lg p-2 transition-colors ${
              activeView === 'settings'
                ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
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
              className="relative inline-flex items-center justify-center rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400 ring-2 ring-white dark:ring-slate-900"
                />
              )}
            </button>

            {notifOpen && (
              <div
                role="dialog"
                aria-label="Nhật ký hoạt động và thông báo nội bộ"
                className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 shadow-lg z-50"
              >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Thông báo &amp; Nhật ký lưu cục bộ
                  </span>
                  <div className="flex items-center gap-2.5">
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={onClearNotifications}
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        Xóa nhật ký
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-[11px] font-medium text-blue-600 dark:text-blue-400"
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
                                  ? 'text-blue-600 dark:text-blue-400'
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
              className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
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
            className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

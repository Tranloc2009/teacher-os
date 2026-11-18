import {
  BookOpen,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Folder,
  Home,
  Layers,
} from 'lucide-react';
import type { ShellViewId } from './ShellTopBar';

export type ShellNavId =
  | 'desktop'
  | 'workspace'
  | 'lesson-studio'
  | 'resource-vault'
  | 'tools';

interface NavItemConfig {
  id: ShellNavId;
  label: string;
  title: string;
  tourId: string;
}

export const PRIMARY_SHELL_NAV: NavItemConfig[] = [
  {
    id: 'desktop',
    label: 'Trang chủ',
    title: 'Trang chủ TeacherOS (Alt+1)',
    tourId: 'sidebar-app-desktop',
  },
  {
    id: 'workspace',
    label: 'Không gian',
    title: 'My Workspace — Sơ đồ & Không gian làm việc (Alt+4)',
    tourId: 'sidebar-app-workspace',
  },
  {
    id: 'lesson-studio',
    label: 'Bài dạy',
    title: 'Lesson Studio — Soạn bộ tiết dạy & Kho bài dạy (Alt+2)',
    tourId: 'sidebar-app-lesson-studio',
  },
  {
    id: 'resource-vault',
    label: 'Tài nguyên',
    title: 'Resource Vault — Kho học liệu cá nhân (Alt+5)',
    tourId: 'sidebar-app-resource-vault',
  },
  {
    id: 'tools',
    label: 'Công cụ',
    title: 'Công cụ chuyên sâu: Workflow, Trộn đề Toán, In A4, Nhật ký & Cài đặt',
    tourId: 'sidebar-app-tools',
  },
];

export function getShellNavId(activeView: ShellViewId): ShellNavId {
  if (
    activeView === 'desktop' ||
    activeView === 'workspace' ||
    activeView === 'lesson-studio' ||
    activeView === 'resource-vault'
  ) {
    return activeView;
  }
  return 'tools';
}

function NavIcon({ id, className }: { id: ShellNavId; className?: string }) {
  switch (id) {
    case 'desktop':
      return <Home className={className} aria-hidden="true" />;
    case 'workspace':
      return <Folder className={className} aria-hidden="true" />;
    case 'lesson-studio':
      return <BookOpen className={className} aria-hidden="true" />;
    case 'resource-vault':
      return <Layers className={className} aria-hidden="true" />;
    case 'tools':
      return <Briefcase className={className} aria-hidden="true" />;
  }
}

interface ShellSidebarProps {
  activeView: ShellViewId;
  collapsed: boolean;
  lessonStudioHasDraftChanges: boolean;
  onToggleCollapse: () => void;
  onSelectNav: (navId: ShellNavId) => void;
}

export function ShellSidebar({
  activeView,
  collapsed,
  lessonStudioHasDraftChanges,
  onToggleCollapse,
  onSelectNav,
}: ShellSidebarProps) {
  const activeNavId = getShellNavId(activeView);

  return (
    <aside
      aria-label="Thanh điều hướng chính TeacherOS 4.1"
      className={`no-print hidden lg:flex lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] flex-col shrink-0 border-r border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 select-none transition-[width] duration-150 ${
        collapsed ? 'w-[68px]' : 'w-[220px]'
      }`}
    >
      <nav aria-label="Điều hướng chính" className="flex-1 py-4 px-3">
        <ul className="space-y-1">
          {PRIMARY_SHELL_NAV.map((item) => {
            const isActive = activeNavId === item.id;
            const hasDraftIndicator =
              item.id === 'lesson-studio' && lessonStudioHasDraftChanges;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  data-tour-id={item.tourId}
                  onClick={() => onSelectNav(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  title={item.title}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-100/80 dark:hover:bg-slate-800/80 hover:text-slate-950 dark:hover:text-slate-50'
                  } ${collapsed ? 'justify-center px-0' : 'justify-between'}`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <NavIcon id={item.id} className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!collapsed && hasDraftIndicator && (
                    <span
                      title="Đang có bản soạn chưa lưu"
                      aria-label="Đang có bản soạn"
                      className="h-2 w-2 rounded-full bg-amber-500 shrink-0"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-3 border-t border-slate-100 dark:border-slate-800">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={
            collapsed
              ? 'Mở rộng thanh điều hướng (Ctrl+B)'
              : 'Thu gọn thanh điều hướng (Ctrl+B)'
          }
          title={collapsed ? 'Mở rộng (Ctrl+B)' : 'Thu gọn (Ctrl+B)'}
          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors whitespace-nowrap ${
            collapsed ? 'justify-center px-0' : 'justify-between'
          }`}
        >
          {!collapsed && <span>Thu gọn</span>}
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  );
}

export function MobileBottomNav({
  activeView,
  onSelectNav,
}: {
  activeView: ShellViewId;
  onSelectNav: (navId: ShellNavId) => void;
}) {
  const activeNavId = getShellNavId(activeView);

  return (
    <nav
      aria-label="Điều hướng nhanh trên thiết bị di động"
      className="no-print lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm grid grid-cols-5"
    >
      {PRIMARY_SHELL_NAV.map((item) => {
        const isActive = activeNavId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectNav(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
              isActive
                ? 'text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <NavIcon id={item.id} className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

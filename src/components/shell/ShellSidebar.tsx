import {
  BookOpen,
  BookOpenCheck,
  Briefcase,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Folder,
  GitBranch,
  Home,
  LayoutGrid,
  Printer,
  ScanLine,
  Settings,
  Wand2,
} from 'lucide-react';
import type { AppId } from '../../core/appRegistry';
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
    title: 'Bảng điều khiển TeacherOS (Alt+1)',
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
    label: 'Lesson Studio',
    title: 'Lesson Studio — Soạn bộ tiết dạy & Kho bài dạy (Alt+2)',
    tourId: 'sidebar-app-lesson-studio',
  },
  {
    id: 'resource-vault',
    label: 'Resource Vault',
    title: 'Resource Vault — Kho học liệu cá nhân (Alt+5)',
    tourId: 'sidebar-app-resource-vault',
  },
  {
    id: 'tools',
    label: 'Tất cả công cụ',
    title: 'Danh mục đầy đủ công cụ chuyên sâu',
    tourId: 'sidebar-app-tools',
  },
];

interface UnifiedSidebarItem {
  key: string;
  label: string;
  title: string;
  tourId: string;
  viewId: ShellViewId;
  navTarget?: ShellNavId;
  appTarget?: AppId;
  icon: 'home' | 'lesson' | 'generator' | 'exam' | 'grading' | 'vault' | 'workflow' | 'workspace' | 'journal' | 'print' | 'tools' | 'settings';
}

const SIDEBAR_MAIN_ITEMS: UnifiedSidebarItem[] = [
  {
    key: 'desktop',
    label: 'Trang chủ',
    title: 'Trang chủ TeacherOS (Alt+1)',
    tourId: 'sidebar-app-desktop',
    viewId: 'desktop',
    navTarget: 'desktop',
    icon: 'home',
  },
  {
    key: 'lesson-studio',
    label: 'Lesson Studio',
    title: 'Lesson Studio — Soạn bộ tiết dạy & Kho bài dạy (Alt+2)',
    tourId: 'sidebar-app-lesson-studio',
    viewId: 'lesson-studio',
    navTarget: 'lesson-studio',
    icon: 'lesson',
  },
  {
    key: 'exam-generator',
    label: 'Tạo đề tự động',
    title: 'Smart Exam Generator 2.0 — Tạo đề theo ma trận & Biến thể đổi số kiểm chứng',
    tourId: 'sidebar-app-exam-generator',
    viewId: 'exam-generator',
    appTarget: 'exam-generator',
    icon: 'generator',
  },
  {
    key: 'math-mixer',
    label: 'Exam Mixer Pro',
    title: 'Exam Mixer Pro — Quản lý và trộn đề kiểm tra (Alt+8)',
    tourId: 'sidebar-app-math-mixer',
    viewId: 'math-mixer',
    appTarget: 'math-mixer',
    icon: 'exam',
  },
  {
    key: 'grading-studio',
    label: 'Smart Grading Studio',
    title: 'Smart Grading Studio — Chấm OMR cục bộ & xuất bảng điểm (Alt+9)',
    tourId: 'sidebar-app-grading-studio',
    viewId: 'grading-studio',
    appTarget: 'grading-studio',
    icon: 'grading',
  },
  {
    key: 'resource-vault',
    label: 'Resource Vault',
    title: 'Resource Vault — Kho học liệu cá nhân (Alt+5)',
    tourId: 'sidebar-app-resource-vault',
    viewId: 'resource-vault',
    navTarget: 'resource-vault',
    icon: 'vault',
  },
  {
    key: 'workflow-center',
    label: 'Workflow Center',
    title: 'Workflow Center — Tổ chức quy trình làm việc (Alt+6)',
    tourId: 'sidebar-app-workflow-center',
    viewId: 'workflow-center',
    appTarget: 'workflow-center',
    icon: 'workflow',
  },
  {
    key: 'workspace',
    label: 'Không gian',
    title: 'My Workspace — Sơ đồ & Không gian làm việc (Alt+4)',
    tourId: 'sidebar-app-workspace',
    viewId: 'workspace',
    navTarget: 'workspace',
    icon: 'workspace',
  },
  {
    key: 'teaching-journal',
    label: 'Teaching Journal',
    title: 'Teaching Journal — Nhật ký sau tiết dạy (Alt+7)',
    tourId: 'sidebar-app-teaching-journal',
    viewId: 'teaching-journal',
    appTarget: 'teaching-journal',
    icon: 'journal',
  },
  {
    key: 'print-studio',
    label: 'Print Studio',
    title: 'Print Studio — Xem trước & xuất bản A4 (Alt+3)',
    tourId: 'sidebar-app-print-studio',
    viewId: 'print-studio',
    appTarget: 'print-studio',
    icon: 'print',
  },
  {
    key: 'tools',
    label: 'Tất cả công cụ',
    title: 'Danh mục đầy đủ công cụ chuyên sâu',
    tourId: 'sidebar-app-tools',
    viewId: 'tools',
    navTarget: 'tools',
    icon: 'tools',
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

function SidebarItemIcon({
  icon,
  className,
}: {
  icon: UnifiedSidebarItem['icon'];
  className?: string;
}) {
  switch (icon) {
    case 'home':
      return <Home className={className} aria-hidden="true" />;
    case 'lesson':
      return <BookOpen className={className} aria-hidden="true" />;
    case 'generator':
      return <Wand2 className={className} aria-hidden="true" />;
    case 'exam':
      return <Calculator className={className} aria-hidden="true" />;
    case 'grading':
      return <ScanLine className={className} aria-hidden="true" />;
    case 'vault':
      return <Folder className={className} aria-hidden="true" />;
    case 'workflow':
      return <GitBranch className={className} aria-hidden="true" />;
    case 'workspace':
      return <LayoutGrid className={className} aria-hidden="true" />;
    case 'journal':
      return <BookOpenCheck className={className} aria-hidden="true" />;
    case 'print':
      return <Printer className={className} aria-hidden="true" />;
    case 'tools':
      return <Briefcase className={className} aria-hidden="true" />;
    case 'settings':
      return <Settings className={className} aria-hidden="true" />;
  }
}

function NavIcon({ id, className }: { id: ShellNavId; className?: string }) {
  switch (id) {
    case 'desktop':
      return <Home className={className} aria-hidden="true" />;
    case 'workspace':
      return <LayoutGrid className={className} aria-hidden="true" />;
    case 'lesson-studio':
      return <BookOpen className={className} aria-hidden="true" />;
    case 'resource-vault':
      return <Folder className={className} aria-hidden="true" />;
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
  onOpenApp?: (appId: AppId) => void;
}

export function ShellSidebar({
  activeView,
  collapsed,
  lessonStudioHasDraftChanges,
  onToggleCollapse,
  onSelectNav,
  onOpenApp,
}: ShellSidebarProps) {
  const handleItemClick = (item: UnifiedSidebarItem) => {
    if (item.navTarget) {
      onSelectNav(item.navTarget);
      return;
    }
    if (item.appTarget && onOpenApp) {
      onOpenApp(item.appTarget);
      return;
    }
    onSelectNav('tools');
  };

  const isSettingsActive = activeView === 'settings';

  return (
    <aside
      aria-label="Thanh điều hướng chính TeacherOS"
      className={`no-print hidden lg:flex lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] flex-col shrink-0 border-r border-slate-200/70 dark:border-slate-800/80 bg-white/82 dark:bg-slate-900/84 backdrop-blur-md select-none transition-[width] duration-150 ${
        collapsed ? 'w-[72px]' : 'w-[252px]'
      }`}
    >
      {/* Top Workspace Brand Header inside Sidebar */}
      <div
        className={`flex items-center border-b border-slate-200/60 dark:border-slate-800/70 px-3 py-4 ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectNav('desktop')}
          title="Về trang chủ TeacherOS"
          className="group flex items-center gap-2.5 min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-[#635BFF]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#635BFF] via-[#7C66FF] to-[#3B82F6] text-white shadow-[0_4px_12px_-2px_rgba(99,91,255,0.45)]">
            <BookOpen className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          {!collapsed && (
            <div className="min-w-0 text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-bold tracking-tight text-[#172033] dark:text-slate-50 truncate">
                  TeacherOS
                </span>
                <span className="rounded-md bg-[#F3F0FF] dark:bg-indigo-950/90 px-1.5 py-0.5 text-[10px] font-mono-num font-bold text-[#635BFF] dark:text-indigo-300 border border-[#635BFF]/15">
                  4.1
                </span>
              </div>
              <div className="text-[10.5px] font-medium text-slate-500 dark:text-slate-400 tracking-[-0.01em] whitespace-nowrap">
                Không gian làm việc của giáo viên
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Main Navigation List */}
      <nav
        aria-label="Điều hướng chính"
        className="flex-1 overflow-y-auto py-3.5 px-3 space-y-1"
      >
        <ul className="space-y-1">
          {SIDEBAR_MAIN_ITEMS.map((item) => {
            const isActive = activeView === item.viewId;
            const hasDraftIndicator =
              item.key === 'lesson-studio' && lessonStudioHasDraftChanges;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  data-tour-id={item.tourId}
                  onClick={() => handleItemClick(item)}
                  aria-current={isActive ? 'page' : undefined}
                  title={item.title}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-all duration-150 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#635BFF] ${
                    isActive
                      ? 'bg-gradient-to-r from-[#EFEAFF] to-[#F3F0FF] dark:from-indigo-950/90 dark:to-indigo-900/50 text-[#5046E5] dark:text-indigo-300 font-semibold shadow-[inset_0_0_0_1px_rgba(99,91,255,0.22)]'
                      : 'text-[#475569] dark:text-slate-300 font-medium hover:bg-[#EEF0FF]/75 dark:hover:bg-slate-800/80 hover:text-[#172033] dark:hover:text-slate-50'
                  } ${collapsed ? 'justify-center px-0' : 'justify-between'}`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <SidebarItemIcon
                      icon={item.icon}
                      className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                        isActive
                          ? 'text-[#635BFF] dark:text-indigo-400'
                          : 'text-slate-500 dark:text-slate-400 group-hover:text-[#635BFF] dark:group-hover:text-indigo-400'
                      }`}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!collapsed && hasDraftIndicator && (
                    <span
                      title="Đang có bản soạn chưa lưu"
                      aria-label="Đang có bản soạn"
                      className="text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                    >
                      Nháp
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Subtle Secondary Section: Settings */}
        <div className="pt-3 mt-3 border-t border-slate-200/60 dark:border-slate-800/70">
          <button
            type="button"
            data-tour-id="sidebar-app-settings"
            onClick={() => {
              if (onOpenApp) {
                onOpenApp('settings');
              } else {
                onSelectNav('tools');
              }
            }}
            aria-current={isSettingsActive ? 'page' : undefined}
            title="Cài đặt khổ giấy A4 & Sao lưu dữ liệu (Alt+0)"
            className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-all duration-150 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#635BFF] ${
              isSettingsActive
                ? 'bg-gradient-to-r from-[#EFEAFF] to-[#F3F0FF] dark:from-indigo-950/90 dark:to-indigo-900/50 text-[#5046E5] dark:text-indigo-300 font-semibold shadow-[inset_0_0_0_1px_rgba(99,91,255,0.22)]'
                : 'text-[#475569] dark:text-slate-300 font-medium hover:bg-[#EEF0FF]/75 dark:hover:bg-slate-800/80 hover:text-[#172033] dark:hover:text-slate-50'
            } ${collapsed ? 'justify-center px-0' : 'justify-start'}`}
          >
            <Settings
              className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                isSettingsActive
                  ? 'text-[#635BFF] dark:text-indigo-400'
                  : 'text-slate-500 dark:text-slate-400 group-hover:text-[#635BFF] dark:group-hover:text-indigo-400'
              }`}
              aria-hidden="true"
            />
            {!collapsed && <span className="truncate">Cài đặt &amp; Sao lưu</span>}
          </button>
        </div>
      </nav>

      {/* Bottom Collapse Control */}
      <div className="p-3 border-t border-slate-200/60 dark:border-slate-800/80">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={
            collapsed
              ? 'Mở rộng thanh điều hướng (Ctrl+B)'
              : 'Thu gọn thanh điều hướng (Ctrl+B)'
          }
          title={collapsed ? 'Mở rộng (Ctrl+B)' : 'Thu gọn (Ctrl+B)'}
          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-[#EEF0FF]/80 dark:hover:bg-slate-800 hover:text-[#172033] dark:hover:text-slate-100 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#635BFF] ${
            collapsed ? 'justify-center px-0' : 'justify-between'
          }`}
        >
          {!collapsed && <span>Thu gọn thanh bên</span>}
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
      className="no-print lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 border-t border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md grid grid-cols-5"
    >
      {PRIMARY_SHELL_NAV.map((item) => {
        const isActive = activeNavId === item.id;
        const mobileLabel =
          item.id === 'lesson-studio'
            ? 'Bài dạy'
            : item.id === 'resource-vault'
            ? 'Tài liệu'
            : item.id === 'tools'
            ? 'Công cụ'
            : item.label;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectNav(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
              isActive
                ? 'text-[#635BFF] dark:text-indigo-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-[#172033] dark:hover:text-slate-100'
            }`}
          >
            <NavIcon id={item.id} className="h-4 w-4 shrink-0" />
            <span>{mobileLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}

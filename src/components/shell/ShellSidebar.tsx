import { ChevronLeft, Ellipsis, FilePlus2, FolderOpen, House, ScanLine } from 'lucide-react';
import type { AppId } from '../../core/appRegistry';
import type { ShellViewId } from './ShellTopBar';

export type ShellNavId = 'desktop' | 'workspace' | 'lesson-studio' | 'resource-vault' | 'exam-generator' | 'grading-studio' | 'tools';

const destinations = [
  { id: 'desktop', label: 'Tổng quan', icon: House, tour: 'sidebar-app-desktop' },
  { id: 'exam-generator', label: 'Tạo đề', icon: FilePlus2, tour: 'sidebar-app-exam-generator' },
  { id: 'resource-vault', label: 'Tài liệu', icon: FolderOpen, tour: 'sidebar-app-resource-vault' },
  { id: 'grading-studio', label: 'Chấm bài', icon: ScanLine, tour: 'sidebar-app-grading-studio' },
] as const;

const examViews = new Set<ShellViewId>(['exam-generator', 'math-mixer', 'print-studio']);
const documentViews = new Set<ShellViewId>(['resource-vault', 'lesson-studio', 'workspace', 'teaching-journal']);

export function getShellNavId(view: ShellViewId): ShellNavId {
  if (examViews.has(view)) return 'exam-generator';
  if (documentViews.has(view)) return 'resource-vault';
  if (view === 'grading-studio' || view === 'desktop') return view;
  return 'tools';
}

type NavProps = { activeView: ShellViewId; onSelectNav: (id: ShellNavId) => void };

function PrimaryNavigation({ activeView, onSelectNav, mobile = false }: NavProps & { mobile?: boolean }) {
  return (
    <nav className={mobile ? 'tos-mobile-nav no-print' : 'tos-primary-nav'} aria-label={mobile ? 'Điều hướng di động' : 'Điều hướng chính'}>
      {destinations.map(({ id, label, icon: Icon, tour }) => (
        <button key={id} type="button" title={label} aria-current={getShellNavId(activeView) === id ? 'location' : undefined}
          data-tour-id={mobile ? undefined : tour} onClick={() => onSelectNav(id)} className="tos-nav-item">
          <Icon size={18} aria-hidden="true" /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ShellSidebar({ activeView, collapsed, lessonStudioHasDraftChanges, onToggleCollapse, onSelectNav, onOpenApp }:
  NavProps & { collapsed: boolean; lessonStudioHasDraftChanges: boolean; onToggleCollapse: () => void; onOpenApp?: (id: AppId) => void }) {
  const group = getShellNavId(activeView);
  const related: { id: AppId; label: string }[] = group === 'exam-generator'
    ? [{ id: 'math-mixer', label: 'Trộn mã đề' }, { id: 'print-studio', label: 'In và xuất đề' }]
    : group === 'resource-vault'
    ? [{ id: 'lesson-studio', label: 'Soạn bài' }, { id: 'workspace', label: 'Không gian làm việc' }]
    : [];
  return (
    <aside className="tos-sidebar no-print" data-collapsed={collapsed}>
      <div className="tos-sidebar-inner">
        <PrimaryNavigation activeView={activeView} onSelectNav={onSelectNav} />
        {related.length > 0 && !collapsed && (
          <nav className="tos-context-nav" aria-label="Công cụ liên quan">
            {related.map(({ id, label }) => (
              <button key={id} type="button" data-tour-id={'sidebar-app-' + id}
                aria-current={activeView === id ? 'page' : undefined} onClick={() => onOpenApp?.(id)}>
                {label}{id === 'lesson-studio' && lessonStudioHasDraftChanges && <span className="tos-unsaved-dot" aria-label="Có thay đổi chưa lưu" />}
              </button>
            ))}
          </nav>
        )}
        <div className="tos-nav-secondary">
          <button type="button" title="Thêm công cụ" className="tos-nav-item" aria-current={activeView === 'tools' ? 'page' : undefined}
            onClick={() => onSelectNav('tools')} data-tour-id="sidebar-app-tools">
            <Ellipsis size={18} aria-hidden="true" /><span>Thêm công cụ</span>
          </button>
          <button type="button" className="tos-nav-item tos-collapse" onClick={onToggleCollapse}
            aria-label={collapsed ? 'Mở rộng điều hướng' : 'Thu gọn điều hướng'} title={collapsed ? 'Mở rộng điều hướng' : 'Thu gọn điều hướng'}>
            <ChevronLeft size={17} aria-hidden="true" /><span>Thu gọn</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

export function MobileBottomNav(props: NavProps) {
  return <PrimaryNavigation {...props} mobile />;
}

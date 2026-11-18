import { Plus, X } from 'lucide-react';
import { WorkspaceTab } from '../../core/workspaceTabs';
import { AppIcon } from './appIcons';

interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  activePackId: string;
  lessonStudioHasDraftChanges: boolean;
  onSelectTab: (tab: WorkspaceTab) => void;
  onCloseTab: (tabId: string) => void;
  onCreateNewPackTab: () => void;
}

export function WorkspaceTabBar({
  tabs,
  activeTabId,
  activePackId,
  lessonStudioHasDraftChanges,
  onSelectTab,
  onCloseTab,
  onCreateNewPackTab,
}: WorkspaceTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Các công việc đang mở trên TeacherOS 4.0"
      className="no-print hidden sm:flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900/90 px-3 sm:px-6 h-10 overflow-x-auto"
    >
      <div className="flex items-center gap-1 min-w-0 overflow-x-auto py-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDirtyLesson =
            tab.kind === 'lesson' &&
            tab.packId === activePackId &&
            lessonStudioHasDraftChanges;

          return (
            <div
              key={tab.id}
              className={`group inline-flex items-center rounded-md border text-xs transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-950 dark:text-slate-50 font-semibold shadow-2xs'
                  : 'border-transparent bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectTab(tab)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-blue-700 rounded-l-md"
              >
                <AppIcon appId={tab.appId} className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[160px] truncate">{tab.title}</span>
                {isDirtyLesson && (
                  <span
                    title="Đang có thay đổi soạn thảo"
                    className="font-mono-num text-amber-700 dark:text-amber-400 text-[10px]"
                  >
                    *
                  </span>
                )}
              </button>

              {!tab.pinned && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  aria-label={`Đóng tab ${tab.title}`}
                  title={`Đóng tab ${tab.title}`}
                  className="mr-1 rounded p-0.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onCreateNewPackTab}
        title="Mở tab Bộ tiết dạy mới"
        aria-label="Mở tab Bộ tiết dạy mới"
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Tab bài mới</span>
      </button>
    </div>
  );
}

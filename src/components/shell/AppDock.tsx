import { Grid2x2 } from 'lucide-react';
import { AppDefinition, AppId, getAppById, getDockApps } from '../../core/appRegistry';
import { AppIcon } from './appIcons';

interface AppDockProps {
  activeApp: AppId;
  openedApps: AppId[];
  lessonStudioHasDraftChanges: boolean;
  onSwitchApp: (appId: AppId) => void;
  onOpenLauncher: () => void;
}

export function AppDock({
  activeApp,
  openedApps,
  lessonStudioHasDraftChanges,
  onSwitchApp,
  onOpenLauncher,
}: AppDockProps) {
  const pinnedApps = getDockApps();
  const extraActiveApp: AppDefinition | null = pinnedApps.some((a) => a.id === activeApp)
    ? null
    : getAppById(activeApp);
  const dockItems = extraActiveApp ? [...pinnedApps, extraActiveApp] : pinnedApps;

  return (
    <nav
      aria-label="Thanh ứng dụng TeacherOS"
      className="no-print sticky bottom-0 z-30 h-12 sm:h-14 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between sm:justify-center gap-1 sm:gap-2 px-2 sm:px-6 overflow-x-auto">
        {dockItems.map((app) => {
          const isActive = activeApp === app.id;
          const isRunning = openedApps.includes(app.id);
          const showDirtyIndicator =
            app.id === 'lesson-studio' && lessonStudioHasDraftChanges;

          return (
            <button
              key={app.id}
              type="button"
              onClick={() => onSwitchApp(app.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={
                showDirtyIndicator
                  ? `${app.name} (đang có nội dung giữ nguyên)`
                  : app.name
              }
              className={`relative flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-700 ${
                isActive
                  ? 'bg-blue-900 dark:bg-blue-700 text-white'
                  : isRunning
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <AppIcon appId={app.id} className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">{app.shortName}</span>
              {showDirtyIndicator && (
                <span
                  title="Đang giữ nội dung soạn thảo trong phiên"
                  className={`text-[10px] font-mono-num ${
                    isActive
                      ? 'text-amber-200'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  •
                </span>
              )}
            </button>
          );
        })}

        <span
          aria-hidden="true"
          className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 shrink-0"
        />

        <button
          type="button"
          onClick={onOpenLauncher}
          aria-label="Xem tất cả ứng dụng"
          className="flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
        >
          <Grid2x2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden md:inline">Tất cả</span>
        </button>
      </div>
    </nav>
  );
}

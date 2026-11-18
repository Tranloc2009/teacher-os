import {
  BookOpen,
  CheckCircle2,
  Clock,
  GraduationCap,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { APP_REGISTRY } from '../../core/appRegistry';
import {
  TUTORIAL_REGISTRY,
  getActiveTutorialSteps,
} from '../../core/tutorialRegistry';
import { TutorialPersistenceState } from '../../types/tutorial';

interface TutorialLauncherProps {
  open: boolean;
  persistence: TutorialPersistenceState;
  onClose: () => void;
  onStartTutorial: (tutorialId: string, options?: { restart?: boolean }) => void;
  onToggleAutoShow: (enabled: boolean) => void;
  onResetAll: () => void;
}

export function TutorialLauncher({
  open,
  persistence,
  onClose,
  onStartTutorial,
  onToggleAutoShow,
  onResetAll,
}: TutorialLauncherProps) {
  if (!open) return null;

  const availableTutorials = TUTORIAL_REGISTRY.map((tutorial) => ({
    tutorial,
    steps: getActiveTutorialSteps(tutorial, APP_REGISTRY),
    progress: persistence.tutorials[tutorial.tutorialId],
  }));

  const completedCount = availableTutorials.filter(
    (item) => item.progress?.completed
  ).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="academy-launcher-title"
      data-testid="tutorial-launcher-modal"
      className="no-print fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <GraduationCap className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2
                id="academy-launcher-title"
                className="text-base font-bold text-slate-950 dark:text-slate-50"
              >
                TeacherOS Academy — Hướng dẫn tương tác
              </h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Hướng dẫn từng bước trực tiếp trên giao diện thật ·{' '}
                <span className="font-mono-num font-medium">
                  Đã hoàn thành {completedCount}/{availableTutorials.length} bài hướng dẫn
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng TeacherOS Academy"
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Tutorial List */}
        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {availableTutorials.map(({ tutorial, steps, progress }) => {
            const isPaused =
              persistence.pausedTutorialId === tutorial.tutorialId &&
              progress &&
              !progress.completed &&
              progress.currentStepIndex > 0;
            const isCompleted = Boolean(progress?.completed);
            const appMeta = APP_REGISTRY.find((a) => a.id === tutorial.applicationId);

            return (
              <div
                key={tutorial.tutorialId}
                data-testid={`launcher-item-${tutorial.tutorialId}`}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      {appMeta && (
                        <>
                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                            {appMeta.name}
                          </span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span className="font-mono-num">
                        {steps.length} bước · ~{tutorial.estimatedMinutes} phút
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                      {tutorial.title}
                    </h3>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {tutorial.subtitle}
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${
                      isCompleted
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : isPaused
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {isCompleted ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Đã hoàn thành</span>
                      </>
                    ) : isPaused ? (
                      <>
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="font-mono-num">
                          Đang dừng ở bước {(progress?.currentStepIndex ?? 0) + 1}/{steps.length}
                        </span>
                      </>
                    ) : (
                      <span>Chưa xem</span>
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                  {isPaused ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          onStartTutorial(tutorial.tutorialId, { restart: false })
                        }
                        className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          Tiếp tục từ bước {(progress?.currentStepIndex ?? 0) + 1}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onStartTutorial(tutorial.tutorialId, { restart: true })
                        }
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Xem lại từ đầu</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        onStartTutorial(tutorial.tutorialId, { restart: true })
                      }
                      className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500"
                    >
                      {isCompleted ? (
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {isCompleted ? 'Xem lại hướng dẫn' : 'Bắt đầu hướng dẫn'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Preferences */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={persistence.autoShowEnabled}
                onChange={(e) => onToggleAutoShow(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-900 focus:ring-blue-700"
              />
              <span>
                Tự động hiển thị lời chào giới thiệu cho lần truy cập đầu tiên trên máy mới
              </span>
            </label>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Muốn xem lại như người dùng mới?
              </span>
              <button
                type="button"
                onClick={onResetAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Đặt lại tiến độ hướng dẫn</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

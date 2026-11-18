import { useCallback, useEffect, useState } from 'react';
import { Compass, GraduationCap } from 'lucide-react';
import { BoxRect } from '../../core/tutorialPositioning';
import { useTutorial } from './TutorialProvider';
import { TutorialSpotlight } from './TutorialSpotlight';
import { TutorialTooltip } from './TutorialTooltip';
import { TutorialLauncher } from './TutorialLauncher';

export function TutorialOverlay() {
  const {
    persistence,
    welcomeOpen,
    launcherOpen,
    activeTutorial,
    currentStep,
    currentStepIndex,
    totalSteps,
    stepActionCompleted,
    canAdvanceCurrentStep,
    closeLauncher,
    handleWelcomeAction,
    startTutorial,
    nextStep,
    prevStep,
    skipStep,
    pauseTutorial,
    exitTutorial,
    toggleAutoShowWelcome,
    resetAllTutorials,
  } = useTutorial();

  const [targetRect, setTargetRect] = useState<BoxRect | null>(null);
  const [targetFound, setTargetFound] = useState(false);

  const handleRectChange = useCallback((rect: BoxRect | null, found: boolean) => {
    setTargetRect(rect);
    setTargetFound(found);
  }, []);

  // Global Escape handler for Welcome modal, Launcher modal, and active Tutorial
  useEffect(() => {
    if (!welcomeOpen && !launcherOpen && !activeTutorial) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (launcherOpen) {
        e.preventDefault();
        closeLauncher();
      } else if (activeTutorial) {
        e.preventDefault();
        pauseTutorial();
      } else if (welcomeOpen) {
        e.preventDefault();
        handleWelcomeAction('later');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeTutorial,
    closeLauncher,
    handleWelcomeAction,
    launcherOpen,
    pauseTutorial,
    welcomeOpen,
  ]);

  const isTourRunning = Boolean(activeTutorial && currentStep);

  return (
    <>
      {/* First-run Welcome Dialog */}
      {welcomeOpen && !isTourRunning && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-academy-title"
          data-testid="welcome-tutorial-modal"
          className="no-print fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[1px]"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-start gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                <GraduationCap className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  TeacherOS Academy
                </p>
                <h2
                  id="welcome-academy-title"
                  className="text-lg font-bold text-slate-950 dark:text-slate-50 leading-snug text-balance"
                >
                  Chào mừng đến với TeacherOS!
                </h2>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Đây là không gian làm việc dành riêng cho giáo viên. Hãy dành vài phút khám phá những công cụ giúp việc giảng dạy trở nên đơn giản hơn.
            </p>

            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
              <Compass className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
              <span>
                Hướng dẫn ngắn gồm 8 bước trực tiếp trên màn hình, mất khoảng 2 phút.
              </span>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleWelcomeAction('started')}
                className="w-full inline-flex items-center justify-center gap-2 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors"
              >
                <span>Bắt đầu khám phá</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleWelcomeAction('later')}
                  className="inline-flex items-center justify-center rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Để sau
                </button>
                <button
                  type="button"
                  onClick={() => handleWelcomeAction('skipped')}
                  className="inline-flex items-center justify-center rounded-[10px] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  Bỏ qua hướng dẫn
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Spotlight & Interactive Step Card */}
      {isTourRunning && activeTutorial && currentStep && (
        <>
          <TutorialSpotlight
            active={isTourRunning}
            targetId={currentStep.target}
            fallbackTargetIds={currentStep.fallbackTargets}
            onRectChange={handleRectChange}
          />
          <TutorialTooltip
            tutorial={activeTutorial}
            step={currentStep}
            stepIndex={currentStepIndex}
            totalSteps={totalSteps}
            targetRect={targetRect}
            targetFound={targetFound}
            stepActionCompleted={stepActionCompleted}
            canAdvance={canAdvanceCurrentStep}
            onNext={nextStep}
            onPrev={prevStep}
            onSkipStep={skipStep}
            onPause={pauseTutorial}
            onExit={exitTutorial}
          />
        </>
      )}

      {/* Manual Academy Launcher (triggered by ? in TopBar) */}
      <TutorialLauncher
        open={launcherOpen}
        persistence={persistence}
        onClose={closeLauncher}
        onStartTutorial={startTutorial}
        onToggleAutoShow={toggleAutoShowWelcome}
        onResetAll={resetAllTutorials}
      />
    </>
  );
}

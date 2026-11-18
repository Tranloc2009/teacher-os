import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Lightbulb,
  Pause,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { BoxRect, computeTooltipPosition } from '../../core/tutorialPositioning';
import { TutorialDefinition, TutorialStepDef } from '../../types/tutorial';
import { TutorialProgress } from './TutorialProgress';

interface TutorialTooltipProps {
  tutorial: TutorialDefinition;
  step: TutorialStepDef;
  stepIndex: number;
  totalSteps: number;
  targetRect: BoxRect | null;
  targetFound: boolean;
  stepActionCompleted: boolean;
  canAdvance: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkipStep: () => void;
  onPause: () => void;
  onExit: () => void;
}

export function TutorialTooltip({
  tutorial,
  step,
  stepIndex,
  totalSteps,
  targetRect,
  targetFound,
  stepActionCompleted,
  canAdvance,
  onNext,
  onPrev,
  onSkipStep,
  onPause,
  onExit,
}: TutorialTooltipProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState({ width: 376, height: 270 });
  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const onResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCardSize((prev) =>
        Math.abs(prev.width - rect.width) < 2 && Math.abs(prev.height - rect.height) < 2
          ? prev
          : { width: Math.round(rect.width), height: Math.round(rect.height) }
      );
    }
  }, [step.stepId, stepActionCompleted, viewport.width]);

  const isFinalStep = stepIndex === totalSteps - 1;
  const requiresActionPending = step.actionType !== 'info' && !stepActionCompleted;

  const pos = computeTooltipPosition({
    targetRect,
    tooltipWidth: cardSize.width,
    tooltipHeight: cardSize.height,
    viewport,
    preferredPlacement: step.placement,
  });

  const maxCardWidth = Math.min(390, Math.max(260, viewport.width - 24));

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="tutorial-step-title"
      data-testid="tutorial-tooltip"
      data-step-id={step.stepId}
      className="no-print fixed z-[70] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-5 text-slate-900 dark:text-slate-100 shadow-2xl"
      style={{
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        width: `${maxCardWidth}px`,
      }}
    >
      {/* Directional arrow pointing cleanly toward spotlighted target */}
      {pos.resolvedPlacement === 'bottom' && (
        <div
          aria-hidden="true"
          className="absolute -top-2 h-4 w-4 rotate-45 border-l border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          style={{ left: `${pos.arrowOffset - 8}px` }}
        />
      )}
      {pos.resolvedPlacement === 'top' && (
        <div
          aria-hidden="true"
          className="absolute -bottom-2 h-4 w-4 rotate-45 border-r border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          style={{ left: `${pos.arrowOffset - 8}px` }}
        />
      )}
      {pos.resolvedPlacement === 'right' && (
        <div
          aria-hidden="true"
          className="absolute -left-2 h-4 w-4 rotate-45 border-l border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          style={{ top: `${pos.arrowOffset - 8}px` }}
        />
      )}
      {pos.resolvedPlacement === 'left' && (
        <div
          aria-hidden="true"
          className="absolute -right-2 h-4 w-4 rotate-45 border-r border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          style={{ top: `${pos.arrowOffset - 8}px` }}
        />
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">TeacherOS Academy</span>
          </div>
          <h2
            id="tutorial-step-title"
            className="mt-1 text-base font-bold text-slate-950 dark:text-slate-50 leading-snug"
          >
            {isFinalStep ? tutorial.completionTitle : step.title}
          </h2>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onPause}
            title="Tạm dừng hướng dẫn (có thể tiếp tục sau)"
            aria-label="Tạm dừng hướng dẫn"
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100"
          >
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onExit}
            title="Thoát hướng dẫn (Esc)"
            aria-label="Thoát hướng dẫn"
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <TutorialProgress
          currentStepIndex={stepIndex}
          totalSteps={totalSteps}
          completed={isFinalStep}
        />
      </div>

      {/* Main explanation */}
      <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {isFinalStep ? tutorial.completionMessage : step.description}
      </p>

      {/* Missing target graceful notice */}
      {!targetFound && step.target !== 'center' && (
        <p className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          Mục hướng dẫn hiện không hiển thị trên màn hình nhỏ này. Thầy/cô vẫn có thể xem tiếp các bước khác.
        </p>
      )}

      {/* Action completion micro-feedback */}
      {step.actionType !== 'info' && stepActionCompleted && (
        <div
          role="status"
          className="mt-2.5 flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Đã hoàn thành thao tác! Nhấn Tiếp theo để sang bước kế tiếp.</span>
        </div>
      )}

      {/* Optional hint or example */}
      {step.hint && !stepActionCompleted && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
          <Lightbulb className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="leading-relaxed">{step.hint}</p>
            {step.example && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Ví dụ: {step.example}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Action footer */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={onPrev}
              className="inline-flex items-center gap-1 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Quay lại</span>
            </button>
          )}
          {step.skippable && !isFinalStep && (
            <button
              type="button"
              onClick={onSkipStep}
              className="inline-flex items-center gap-1 rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
            >
              <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Bỏ qua bước</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={!canAdvance}
          className={`inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
            canAdvance
              ? 'bg-blue-600 dark:bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500'
              : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-500 cursor-not-allowed'
          }`}
        >
          <span>
            {isFinalStep
              ? tutorial.completionCtaLabel
              : requiresActionPending
              ? 'Thao tác để tiếp tục'
              : 'Tiếp theo'}
          </span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

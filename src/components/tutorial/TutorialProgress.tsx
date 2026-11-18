interface TutorialProgressProps {
  currentStepIndex: number;
  totalSteps: number;
  completed?: boolean;
}

export function TutorialProgress({
  currentStepIndex,
  totalSteps,
  completed = false,
}: TutorialProgressProps) {
  const safeTotal = Math.max(1, totalSteps);
  const currentHuman = Math.min(safeTotal, currentStepIndex + 1);
  const percent = completed
    ? 100
    : Math.round((currentHuman / safeTotal) * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <span className="font-mono-num">
          Bước {currentHuman}/{safeTotal}
        </span>
        <span className="font-mono-num">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={currentHuman}
        aria-valuemin={1}
        aria-valuemax={safeTotal}
        aria-label={`Tiến độ hướng dẫn: bước ${currentHuman} trên ${safeTotal}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div
          className="h-full rounded-full bg-blue-600 dark:bg-blue-500 transition-[width] duration-200 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

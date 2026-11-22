import { GraduationCap, Play, X } from 'lucide-react';
import { useOptionalTutorial } from './TutorialProvider';

interface ContextualAcademyBarProps {
  tutorialId: string;
  label: string;
  description: string;
  className?: string;
}

/**
 * Thanh gợi ý nhẹ khi giáo viên truy cập một ứng dụng lần đầu.
 * Không chặn thao tác và biến mất ngay khi nhấn Bỏ qua hoặc sau khi xem hướng dẫn.
 */
export function ContextualAcademyBar({
  tutorialId,
  label,
  description,
  className = '',
}: ContextualAcademyBarProps) {
  const tutorial = useOptionalTutorial();
  if (!tutorial) return null;

  const isAutostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const record = tutorial.persistence.tutorials[tutorialId];
  const dismissed = (tutorial.persistence.dismissedHints ?? []).includes(tutorialId);
  const alreadyCovered = Boolean(record?.completed || record?.skipped);
  const tutorialActive = Boolean(tutorial.activeTutorial);

  if (isAutostart || dismissed || alreadyCovered || tutorialActive || tutorial.welcomeOpen) {
    return null;
  }

  return (
    <div
      data-testid={`contextual-academy-hint-${tutorialId}`}
      className={`no-print flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-blue-200/80 dark:border-blue-900/70 bg-blue-50/75 dark:bg-blue-950/35 px-4 py-2.5 text-xs ${className}`}
    >
      <div className="flex items-start gap-2 text-slate-800 dark:text-slate-100 min-w-0">
        <GraduationCap
          className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5"
          aria-hidden="true"
        />
        <p className="leading-relaxed">
          <strong className="font-semibold text-slate-950 dark:text-slate-50">{label}:</strong> {description}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => tutorial.startTutorial(tutorialId, { restart: false })}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500 whitespace-nowrap"
        >
          <Play className="h-3 w-3" aria-hidden="true" />
          <span>Xem hướng dẫn tương tác</span>
        </button>
        <button
          type="button"
          onClick={() => tutorial.dismissContextualHint(tutorialId)}
          aria-label={`Đóng gợi ý hướng dẫn ${label}`}
          className="inline-flex items-center gap-1 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          <span>Để sau</span>
        </button>
      </div>
    </div>
  );
}

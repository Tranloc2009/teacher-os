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
      className={`tos-academy-hint no-print flex items-center justify-between gap-2 text-xs ${className}`}
    >
      <div className="flex items-start gap-2 text-slate-800 dark:text-slate-100 min-w-0">
        <GraduationCap
          className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300 mt-0.5"
          aria-hidden="true"
        />
        <p className="sr-only sm:not-sr-only sm:leading-relaxed">
          <strong className="font-semibold text-slate-950 dark:text-slate-50">{label}:</strong> {description}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => tutorial.startTutorial(tutorialId, { restart: false })}
          className="tos-text-button"
        >
          <Play className="h-3 w-3" aria-hidden="true" />
          <span>Xem hướng dẫn tương tác</span>
        </button>
        <button
          type="button"
          onClick={() => tutorial.dismissContextualHint(tutorialId)}
          aria-label={`Đóng gợi ý hướng dẫn ${label}`}
          className="tos-icon-button"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

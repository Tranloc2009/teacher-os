import type { ExamFormTemplate } from '../../types/examForm';

interface ExamTemplateThumbnailProps {
  template: ExamFormTemplate;
  active?: boolean;
}

/**
 * Miniature visual A4 preview thumbnail representing a template's real layout
 * (orientation, logo, code position, student block, columns, option grid, footer).
 */
export function ExamTemplateThumbnail({ template, active = false }: ExamTemplateThumbnailProps) {
  const isLandscape = template.pageSettings.orientation === 'landscape';
  const cols = template.pageSettings.columns;
  const optLayout = template.bodySettings.optionLayout;
  const hasLogo = Boolean(template.headerSettings.schoolLogoDataUrl?.trim());
  const codePos = template.pageSettings.examCodePosition;

  return (
    <div
      className={`relative shrink-0 rounded-lg border bg-white p-1.5 shadow-sm transition-all ${
        active
          ? 'border-indigo-500 ring-2 ring-indigo-200'
          : 'border-slate-200/90 group-hover:border-indigo-300'
      }`}
      style={{
        width: isLandscape ? 72 : 56,
        height: isLandscape ? 52 : 76,
      }}
      aria-hidden="true"
    >
      {/* Header miniature */}
      <div className="flex items-start justify-between gap-1 border-b border-slate-200 pb-1">
        <div className="flex items-center gap-1 min-w-0">
          {hasLogo && (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500/80" />
          )}
          <div className="space-y-0.5">
            <div className="h-1 w-5 rounded-full bg-slate-400" />
            <div className="h-1 w-6 rounded-full bg-slate-700" />
          </div>
        </div>
        <div className="flex flex-col items-end space-y-0.5">
          <div className="h-1 w-6 rounded-full bg-slate-700" />
          {template.headerSettings.showExamCode && (
            <div
              className={`h-1.5 w-4 rounded-sm ${
                codePos === 'top-box'
                  ? 'border border-indigo-600 bg-indigo-50'
                  : 'bg-indigo-500/80'
              }`}
            />
          )}
        </div>
      </div>

      {/* Student block strip */}
      {template.studentInfoSettings.showStudentBlock && (
        <div className="mt-1 h-1.5 w-full rounded-sm bg-slate-100 border border-slate-200/80" />
      )}

      {/* Body questions + option grid */}
      <div
        className={`mt-1.5 grid gap-1 ${cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
      >
        {[0, 1].map((idx) => (
          <div key={idx} className="space-y-0.5">
            <div className="h-1 w-full rounded-full bg-slate-600/80" />
            <div className="h-0.5 w-4/5 rounded-full bg-slate-300" />
            {optLayout === '4-col' ? (
              <div className="grid grid-cols-4 gap-0.5 pt-0.5">
                <span className="h-0.5 rounded bg-indigo-300" />
                <span className="h-0.5 rounded bg-indigo-300" />
                <span className="h-0.5 rounded bg-indigo-300" />
                <span className="h-0.5 rounded bg-indigo-300" />
              </div>
            ) : optLayout === '2-col' || optLayout === 'auto' ? (
              <div className="grid grid-cols-2 gap-0.5 pt-0.5">
                <span className="h-0.5 rounded bg-indigo-300" />
                <span className="h-0.5 rounded bg-indigo-300" />
                <span className="h-0.5 rounded bg-indigo-300" />
                <span className="h-0.5 rounded bg-indigo-300" />
              </div>
            ) : (
              <div className="space-y-0.5 pt-0.5">
                <span className="block h-0.5 w-3/4 rounded bg-slate-300" />
                <span className="block h-0.5 w-2/3 rounded bg-slate-300" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer indicator */}
      {template.footerSettings.showEndMarker && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-0.5 w-5 rounded-full bg-slate-400" />
      )}
    </div>
  );
}

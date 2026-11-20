import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  MathIntegrityReport,
  MathIntegrityStatus,
} from '../../types/mathExam';

interface MathIntegrityReportPanelProps {
  report: MathIntegrityReport;
  title?: string;
  onManualCheck?: () => void;
  onSelectQuestion?: (questionId: string) => void;
  compact?: boolean;
}

function getStatusStyles(status: MathIntegrityStatus): {
  badge: string;
  border: string;
  label: string;
} {
  if (status === 'BLOCKED') {
    return {
      badge: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200',
      border: 'border-red-200 dark:border-red-800',
      label: 'BLOCKED · Chặn xuất đề',
    };
  }
  if (status === 'WARNING') {
    return {
      badge: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200',
      border: 'border-amber-200 dark:border-amber-800',
      label: 'WARNING · Cần rà soát',
    };
  }
  return {
    badge: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200',
    border: 'border-slate-200 dark:border-slate-800',
    label: 'PASS · Đạt toàn vẹn',
  };
}

export function MathIntegrityBadge({ status }: { status: MathIntegrityStatus }) {
  const st = getStatusStyles(status);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-mono-num font-semibold whitespace-nowrap ${st.badge}`}
    >
      {status === 'BLOCKED' ? (
        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
      ) : status === 'WARNING' ? (
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ) : (
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      )}
      <span>{status}</span>
    </span>
  );
}

export function MathIntegrityReportPanel({
  report,
  title = 'Math Integrity Check — Báo cáo kiểm tra toàn vẹn (6 hạng mục)',
  onManualCheck,
  onSelectQuestion,
  compact = false,
}: MathIntegrityReportPanelProps) {
  const st = getStatusStyles(report.status);
  const errors = report.issues.filter((i) => i.severity === 'error');
  const warnings = report.issues.filter((i) => i.severity === 'warning');

  return (
    <section
      className={`rounded-xl border ${st.border} bg-white dark:bg-slate-900 p-4 space-y-3.5`}
    >
      {/* Header + Stats + Manual Check */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
              {title}
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 text-[11px] font-mono-num font-semibold whitespace-nowrap ${st.badge}`}
            >
              {report.status === 'BLOCKED' ? (
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              ) : report.status === 'WARNING' ? (
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{st.label}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono-num text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Câu khóa: {report.stats.lockedQuestions}/{report.stats.totalQuestions}
            </span>
            <span>Phương án khóa: {report.stats.lockedOptions}</span>
            <span>Nhóm khóa vị trí: {report.stats.lockedGroups}</span>
            <span>Hình/Bảng biến thiên: {report.stats.visualAssetsCount}</span>
            {(report.stats.wmfPreviewCount ?? 0) > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                WMF→SVG: {report.stats.wmfPreviewCount}
              </span>
            )}
            {(report.stats.unresolvedFormulaCount ?? 0) > 0 && (
              <span className="text-red-700 dark:text-red-300 font-semibold">
                OLE lỗi: {report.stats.unresolvedFormulaCount}
              </span>
            )}
            {(report.stats.missingKeyCount ?? 0) > 0 && (
              <span className="text-red-700 dark:text-red-300 font-semibold">
                Thiếu khóa: {report.stats.missingKeyCount}
              </span>
            )}
            {(report.stats.needsReviewKeyCount ?? 0) > 0 && (
              <span className="text-amber-700 dark:text-amber-300 font-semibold">
                Cần duyệt: {report.stats.needsReviewKeyCount}
              </span>
            )}
            {(report.stats.conflictKeyCount ?? 0) > 0 && (
              <span className="text-red-700 dark:text-red-300 font-semibold">
                Mâu thuẫn: {report.stats.conflictKeyCount}
              </span>
            )}
            {(report.stats.duplicateGroupCount ?? 0) > 0 && (
              <span className="text-red-700 dark:text-red-300 font-semibold">
                Trùng nội dung: {report.stats.duplicateGroupCount} nhóm
              </span>
            )}
          </div>
        </div>

        {onManualCheck && (
          <button
            type="button"
            onClick={onManualCheck}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Kiểm tra toàn vẹn</span>
          </button>
        )}
      </div>

      {/* 4 Independent Reporting Pillars (P0) */}
      {report.pillars && report.pillars.length > 0 && (
        <div
          data-testid="integrity-four-pillars"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
        >
          {report.pillars.map((pillar) => (
            <div
              key={pillar.pillar}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-2.5 flex flex-col justify-between gap-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                  {pillar.label}
                </span>
                <MathIntegrityBadge status={pillar.status} />
              </div>
              {!compact && (
                <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                  {pillar.detail}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 6-Category Verification Table */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {report.categories.map((cat) => (
          <div
            key={cat.category}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-2.5 flex flex-col justify-between gap-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {cat.label}
              </span>
              <MathIntegrityBadge status={cat.status} />
            </div>
            {!compact && (
              <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                {cat.detail}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Issue Details (BLOCKED first, then WARNING) */}
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-1.5">
          {[...errors, ...warnings].map((issue) => {
            const locParts = [
              issue.sourceFileName,
              issue.sectionTitle,
              issue.code ? `Câu ${issue.code}` : null,
              issue.optionOrStatementLabel ? `Mục ${issue.optionOrStatementLabel}` : null,
            ].filter(Boolean);
            return (
              <li
                key={issue.id}
                className={`rounded-lg border px-3 py-2 text-xs flex items-start justify-between gap-3 ${
                  issue.severity === 'error'
                    ? 'border-red-200 dark:border-red-800 bg-red-50/70 dark:bg-red-950/40 text-red-900 dark:text-red-200'
                    : 'border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200'
                }`}
              >
                <div>
                  {locParts.length > 0 && (
                    <div className="text-[10px] font-mono-num opacity-75 mb-0.5">
                      {locParts.join(' → ')}
                    </div>
                  )}
                  <p className="font-medium">
                    <span className="font-mono-num font-bold mr-1.5">
                      [{issue.severity === 'error' ? 'BLOCKED' : 'WARNING'}]
                    </span>
                    {issue.message}
                  </p>
                  <p className="mt-0.5 opacity-85">{issue.recommendation}</p>
                </div>
                {issue.questionId && onSelectQuestion && (
                  <button
                    type="button"
                    onClick={() => onSelectQuestion(issue.questionId!)}
                    className="rounded border border-current/25 px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 hover:bg-white/40"
                  >
                    Sửa câu này
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Explicit Mathematical Limitation Notice */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
        {report.limitationNotice}
      </div>
    </section>
  );
}

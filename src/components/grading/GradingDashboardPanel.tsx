import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  Eye,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  GradedSheetRecord,
  GradingRuleConfig,
  GradingSession,
  RoundingRule,
} from '../../types/grading';
import {
  computeGradingDashboardMetrics,
  formatRoundingRuleLabel,
} from '../../core/grading/gradingEngine';
import { getSheetStatusLabelVi } from '../../core/grading/gradingExporter';
import { triggerBlobDownload } from '../../core/grading/omrBrowserBridge';

interface GradingDashboardPanelProps {
  session: GradingSession;
  onReviewSheet: (sheetId: string) => void;
  onDeleteSheet: (sheetId: string) => void;
  onUpdateGradingRule: (next: GradingRuleConfig) => void;
  onImportSessionJson: (imported: GradingSession) => void;
  onDeleteSession: () => void;
  onNotify: (tone: 'success' | 'info' | 'error', message: string) => void;
}

export function GradingDashboardPanel({
  session,
  onReviewSheet,
  onDeleteSheet,
  onUpdateGradingRule,
  onImportSessionJson,
  onDeleteSession,
  onNotify,
}: GradingDashboardPanelProps) {
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCode, setFilterCode] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [minScoreFilter, setMinScoreFilter] = useState<string>('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const metrics = useMemo(
    () => computeGradingDashboardMetrics(session.sheets, session.gradingRule.maxScore),
    [session.gradingRule.maxScore, session.sheets]
  );

  const filteredSheets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minScoreNum = minScoreFilter.trim() === '' ? null : Number(minScoreFilter);

    return session.sheets.filter((s) => {
      if (filterCode !== 'all' && s.examCode !== filterCode) return false;
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (minScoreNum !== null && Number.isFinite(minScoreNum) && s.finalScore < minScoreNum) {
        return false;
      }
      if (q) {
        const hay = `${s.studentId} ${s.studentName} ${s.examCode} ${s.fileName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [filterCode, filterStatus, minScoreFilter, searchQuery, session.sheets]);

  const maxBucketCount = Math.max(
    1,
    ...metrics.scoreDistribution.map((b) => b.count)
  );

  const handleExportSessionBackup = () => {
    const payload = {
      schema: 'teacheros-grading-session-v1',
      exportedAt: new Date().toISOString(),
      session,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    triggerBlobDownload(
      blob,
      `TeacherOS_GradingSession_${session.className.replace(/\s+/g, '_')}.json`
    );
    onNotify('success', 'Đã tải tệp sao lưu phiên chấm JSON cục bộ.');
  };

  const handleImportSessionBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        schema?: string;
        session?: GradingSession;
      };
      if (!parsed.session || !parsed.session.id || !Array.isArray(parsed.session.sheets)) {
        onNotify('error', 'Tệp JSON không phải bản sao lưu phiên chấm Smart Grading Studio hợp lệ.');
        return;
      }
      onImportSessionJson(parsed.session);
    } catch {
      onNotify('error', 'Không thể đọc tệp JSON sao lưu phiên chấm.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Row 1 — 5 Real-Data KPI Cards (Zero fake numbers) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Tổng bài đã tải
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono-num tabular-nums text-slate-950 dark:text-white">
            {metrics.totalSheets}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono-num">
            Sĩ số lớp: {session.students.length}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Đã xác nhận
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono-num tabular-nums text-emerald-700 dark:text-emerald-400">
            {metrics.confirmedCount}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Giáo viên đã chốt điểm
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Chờ duyệt / Cần xem
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono-num tabular-nums text-amber-700 dark:text-amber-400">
            {metrics.reviewRequiredCount + metrics.autoGradedCount}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono-num">
            {metrics.reviewRequiredCount} có cảnh báo · {metrics.autoGradedCount} rõ ràng
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Bài lỗi căn chỉnh/mã
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono-num tabular-nums text-red-600 dark:text-red-400">
            {metrics.errorCount}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Cần gán mã hoặc chụp lại
          </div>
        </div>

        <div className="col-span-2 lg:col-span-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Điểm trung bình
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono-num tabular-nums text-indigo-700 dark:text-indigo-400">
            {metrics.averageScore !== null ? metrics.averageScore.toFixed(2) : '—'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono-num">
            {metrics.highestScore !== null
              ? `Cao nhất ${metrics.highestScore} · Thấp nhất ${metrics.lowestScore}`
              : 'Chưa có bài chấm hợp lệ'}
          </div>
        </div>
      </div>

      {/* Row 2 — Score Distribution + Transparent Grading Rule Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              <span>Phổ điểm thực tế của phiên chấm</span>
            </h2>
            <span className="text-xs font-mono-num text-slate-500">
              Thang {session.gradingRule.maxScore} điểm
            </span>
          </div>

          <div className="grid grid-cols-5 gap-3 items-end h-36 pt-4">
            {metrics.scoreDistribution.map((bucket) => {
              const heightPct =
                bucket.count === 0
                  ? 4
                  : Math.max(14, Math.round((bucket.count / maxBucketCount) * 100));
              return (
                <div
                  key={bucket.bucketLabel}
                  className="flex flex-col items-center gap-1.5 h-full justify-end"
                >
                  <span className="text-xs font-mono-num font-bold text-slate-800 dark:text-slate-200">
                    {bucket.count}
                  </span>
                  <div className="w-full max-w-[54px] rounded-t-lg bg-slate-100 dark:bg-slate-800 flex items-end h-24 overflow-hidden">
                    <div
                      className="w-full rounded-t-lg bg-indigo-600/85 dark:bg-indigo-500 transition-all"
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                    {bucket.bucketLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Grading Rule & Local Privacy Box */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50">
              Quy tắc tính điểm &amp; Làm tròn minh bạch
            </h2>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="block font-semibold text-slate-600 dark:text-slate-400">
                  Thang điểm tối đa
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={session.gradingRule.maxScore}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(100, Number(e.target.value) || 10));
                    onUpdateGradingRule({ ...session.gradingRule, maxScore: v });
                  }}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-mono-num text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </label>

              <label className="space-y-1">
                <span className="block font-semibold text-slate-600 dark:text-slate-400">
                  Làm tròn điểm
                </span>
                <select
                  value={session.gradingRule.rounding}
                  onChange={(e) =>
                    onUpdateGradingRule({
                      ...session.gradingRule,
                      rounding: e.target.value as RoundingRule,
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  {(['0.25', '0.1', '0.5', '0.01', 'none'] as RoundingRule[]).map((r) => (
                    <option key={r} value={r}>
                      {formatRoundingRuleLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={session.gradingRule.useExamQuestionPoints}
                onChange={(e) =>
                  onUpdateGradingRule({
                    ...session.gradingRule,
                    useExamQuestionPoints: e.target.checked,
                  })
                }
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
              />
              <span>Tính theo trọng số điểm từng câu trong đề gốc (thay vì chia đều)</span>
            </label>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>100% lưu cục bộ trên máy</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportSessionBackup}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sao lưu JSON</span>
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportSessionBackup(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Khôi phục</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3 — Filterable Student Gradebook Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm Mã học sinh, Họ tên, Mã đề..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 pl-8 pr-3 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label="Lọc theo mã đề"
              value={filterCode}
              onChange={(e) => setFilterCode(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono-num text-slate-700 dark:text-slate-200"
            >
              <option value="all">Tất cả mã đề</option>
              {session.selectedExamCodes.map((code) => (
                <option key={code} value={code}>
                  Mã {code}
                </option>
              ))}
            </select>

            <select
              aria-label="Lọc theo trạng thái"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-slate-700 dark:text-slate-200"
            >
              <option value="all">Mọi trạng thái</option>
              <option value="confirmed">Đã xác nhận</option>
              <option value="auto-graded">Đã chấm tự động</option>
              <option value="review-required">Cần kiểm tra thủ công</option>
              <option value="error">Lỗi / Chưa thể chấm</option>
            </select>

            <input
              type="number"
              aria-label="Điểm tối thiểu"
              min={0}
              max={session.gradingRule.maxScore}
              step={0.5}
              value={minScoreFilter}
              onChange={(e) => setMinScoreFilter(e.target.value)}
              placeholder="Điểm ≥ ..."
              className="w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono-num text-slate-700 dark:text-slate-200"
            />
          </div>
        </div>

        {filteredSheets.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            {session.sheets.length === 0
              ? 'Chưa có bài chấm nào trong phiên. Tải ảnh phiếu ở mục "Tải ảnh & Chấm OMR" để bắt đầu.'
              : 'Không có bài làm nào khớp bộ lọc hiện tại.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5 font-semibold w-12">STT</th>
                  <th className="px-4 py-2.5 font-semibold w-28">Mã HS</th>
                  <th className="px-4 py-2.5 font-semibold">Họ và tên</th>
                  <th className="px-4 py-2.5 font-semibold w-20">Mã đề</th>
                  <th className="px-4 py-2.5 font-semibold w-28">Đúng / Sai / Trống</th>
                  <th className="px-4 py-2.5 font-semibold w-20 text-right">Điểm</th>
                  <th className="px-4 py-2.5 font-semibold w-44">Trạng thái</th>
                  <th className="px-4 py-2.5 font-semibold w-28 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredSheets.map((s: GradedSheetRecord, idx) => (
                  <tr
                    key={s.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-2.5 font-mono-num text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                      {s.studentId || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {s.studentName || '(Chưa khớp danh sách)'}
                      </div>
                      {s.duplicateStudentWarning && (
                        <div className="text-[10.5px] text-amber-700 dark:text-amber-400">
                          Trùng mã học sinh trong phiên
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono-num font-semibold text-indigo-700 dark:text-indigo-400">
                      {s.examCode || '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono-num text-slate-700 dark:text-slate-300">
                      {s.correctCount} / {s.wrongCount} / {s.blankCount}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num font-bold text-slate-950 dark:text-white">
                      {s.finalScore.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          s.status === 'confirmed'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : s.status === 'review-required'
                            ? 'text-amber-700 dark:text-amber-400'
                            : s.status === 'error'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-indigo-700 dark:text-indigo-400'
                        }`}
                      >
                        {s.status === 'confirmed' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : s.status === 'review-required' || s.status === 'error' ? (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : null}
                        <span>{getSheetStatusLabelVi(s.status)}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onReviewSheet(s.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                        >
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          <span>Duyệt</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Xóa bài ${s.fileName}`}
                          onClick={() => onDeleteSheet(s.id)}
                          className="rounded-lg p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Session Guard */}
      <div className="flex items-center justify-end">
        {!confirmDeleteOpen ? (
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Xóa phiên chấm và toàn bộ ảnh minh chứng cục bộ</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/80 dark:bg-red-950/40 px-3.5 py-2 text-xs">
            <span className="text-red-800 dark:text-red-200 font-medium">
              Xác nhận xóa vĩnh viễn phiên chấm &ldquo;{session.title}&rdquo;?
            </span>
            <button
              type="button"
              onClick={() => {
                setConfirmDeleteOpen(false);
                onDeleteSession();
              }}
              className="rounded-lg bg-red-600 hover:bg-red-700 px-2.5 py-1 font-semibold text-white"
            >
              Xóa ngay
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-300"
            >
              Hủy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

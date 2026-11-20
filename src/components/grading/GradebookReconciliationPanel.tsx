import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  Eye,
  History,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type {
  GradeReconciliationStatus,
  GradingSession,
  IntelligentGradebookEntry,
} from '../../types/grading';
import {
  computeIntelligentGradebookStats,
  reconcileIntelligentGradebook,
} from '../../core/grading/gradebookReconciliationEngine';

interface GradebookReconciliationPanelProps {
  session: GradingSession;
  onConfirmScore: (params: {
    studentId: string;
    chosenScore: number | null;
    source: 'omr' | 'photo-ocr' | 'manual';
    reason: string;
  }) => void;
  onConfirmAllMatched: () => void;
  onUndoLastChange: (studentId: string) => void;
  onInspectOmrSheet: (sheetId: string) => void;
  onScanMissingStudent: () => void;
}

type GradebookFilter = 'all' | 'attention' | 'missing' | 'confirmed';

function statusMeta(status: GradeReconciliationStatus): {
  label: string;
  toneClass: string;
} {
  switch (status) {
    case 'CONFIRMED':
      return {
        label: 'Đã xác nhận',
        toneClass:
          'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
      };
    case 'MATCHED':
      return {
        label: 'Khớp điểm',
        toneClass:
          'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800',
      };
    case 'MISMATCH':
      return {
        label: 'Lệch điểm',
        toneClass:
          'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',
      };
    case 'REVIEW_REQUIRED':
      return {
        label: 'Cần đối soát',
        toneClass:
          'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
      };
    default:
      return {
        label: 'Thiếu / Chờ chốt',
        toneClass:
          'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      };
  }
}

export function GradebookReconciliationPanel({
  session,
  onConfirmScore,
  onConfirmAllMatched,
  onUndoLastChange,
  onInspectOmrSheet,
  onScanMissingStudent,
}: GradebookReconciliationPanelProps) {
  const [filter, setFilter] = useState<GradebookFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editScoreInput, setEditScoreInput] = useState('');
  const [editReasonInput, setEditReasonInput] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  const entries = useMemo<IntelligentGradebookEntry[]>(
    () =>
      session.gradebookEntries && session.gradebookEntries.length > 0
        ? session.gradebookEntries
        : reconcileIntelligentGradebook(session),
    [session]
  );

  const stats = useMemo(
    () => computeIntelligentGradebookStats(entries),
    [entries]
  );

  const auditTrail = session.gradeAuditTrail ?? [];
  const auditStudentIds = useMemo(
    () => new Set(auditTrail.map((a) => a.studentId.trim().toUpperCase())),
    [auditTrail]
  );

  const batchConfirmableCount = useMemo(
    () =>
      entries.filter(
        (e) =>
          !e.confirmedByTeacher &&
          e.omrScore !== null &&
          e.reconciliationStatus !== 'MISMATCH' &&
          e.reconciliationStatus !== 'REVIEW_REQUIRED'
      ).length,
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'attention') {
        if (
          entry.reconciliationStatus !== 'MISMATCH' &&
          entry.reconciliationStatus !== 'REVIEW_REQUIRED'
        ) {
          return false;
        }
      } else if (filter === 'missing') {
        if (entry.reconciliationStatus !== 'MISSING') return false;
      } else if (filter === 'confirmed') {
        if (!entry.confirmedByTeacher) return false;
      }

      if (!q) return true;
      return (
        entry.studentId.toLowerCase().includes(q) ||
        entry.fullName.toLowerCase().includes(q) ||
        entry.examCode.toLowerCase().includes(q)
      );
    });
  }, [entries, filter, searchQuery]);

  const startManualEdit = (entry: IntelligentGradebookEntry) => {
    setEditingStudentId(entry.studentId);
    const seed =
      entry.officialScore ?? entry.omrScore ?? entry.photoScore ?? null;
    setEditScoreInput(seed !== null ? String(seed) : '');
    setEditReasonInput('');
    setEditError(null);
  };

  const submitManualEdit = (entry: IntelligentGradebookEntry) => {
    const raw = editScoreInput.trim().replace(',', '.');
    let parsed: number | null = null;
    if (raw.length > 0) {
      const num = Number(raw);
      if (
        !Number.isFinite(num) ||
        num < 0 ||
        num > session.gradingRule.maxScore
      ) {
        setEditError(
          `Điểm phải nằm trong khoảng 0 đến ${session.gradingRule.maxScore}.`
        );
        return;
      }
      parsed = Number(num.toFixed(2));
    }

    onConfirmScore({
      studentId: entry.studentId,
      chosenScore: parsed,
      source: 'manual',
      reason:
        editReasonInput.trim() ||
        'Giáo viên chỉnh sửa và xác nhận điểm chính thức trong Sổ điểm',
    });
    setEditingStudentId(null);
    setEditError(null);
  };

  return (
    <div className="space-y-4">
      {/* Header + Primary Actions */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <ClipboardCheck
                className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0"
                aria-hidden="true"
              />
              <span>Sổ điểm thông minh &amp; Đối soát điểm chính thức</span>
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Đồng bộ tự động từ phiếu OMR (máy tính &amp; camera điện thoại) và danh sách lớp. Điểm trung bình chính thức chỉ tính trên các bài đã được giáo viên xác nhận.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {batchConfirmableCount > 0 && (
              <button
                type="button"
                onClick={onConfirmAllMatched}
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Xác nhận nhanh {batchConfirmableCount} bài OMR rõ ràng</span>
              </button>
            )}
            <button
              type="button"
              onClick={onScanMissingStudent}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors"
            >
              <Camera className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Quét bổ sung</span>
            </button>
          </div>
        </div>

        {/* Gradebook KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Tổng học sinh
            </div>
            <div className="mt-1 text-xl font-bold font-mono-num text-slate-950 dark:text-white">
              {stats.totalEntries}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/25 p-3">
            <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              Đã xác nhận
            </div>
            <div className="mt-1 text-xl font-bold font-mono-num text-emerald-800 dark:text-emerald-300">
              {stats.confirmedValidCount}/{stats.totalEntries}
            </div>
          </div>

          <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/25 p-3">
            <div className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
              ĐTB đã chốt
            </div>
            <div className="mt-1 text-xl font-bold font-mono-num text-indigo-900 dark:text-indigo-200">
              {stats.confirmedAverageScore !== null
                ? stats.confirmedAverageScore.toFixed(2)
                : '—'}
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/25 p-3">
            <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Cần đối soát / Lệch
            </div>
            <div className="mt-1 text-xl font-bold font-mono-num text-amber-800 dark:text-amber-300">
              {stats.reviewRequiredCount + stats.mismatchCount}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3 col-span-2 lg:col-span-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Thiếu / Chờ chốt
            </div>
            <div className="mt-1 text-xl font-bold font-mono-num text-slate-900 dark:text-slate-100">
              {stats.missingCount}
            </div>
          </div>
        </div>

        {/* Search + Status Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="relative flex-1 max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo Mã HS, họ tên hoặc mã đề..."
              aria-label="Tìm học sinh trong sổ điểm"
              className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `Tất cả (${entries.length})` },
                {
                  id: 'attention',
                  label: `Cần đối soát (${stats.reviewRequiredCount + stats.mismatchCount})`,
                },
                { id: 'missing', label: `Thiếu (${stats.missingCount})` },
                {
                  id: 'confirmed',
                  label: `Đã chốt (${stats.confirmedValidCount})`,
                },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilter(btn.id)}
                className={`min-h-[36px] rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filter === btn.id
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {btn.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setShowAuditTrail((v) => !v)}
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Lịch sử ({auditTrail.length})</span>
            </button>
          </div>
        </div>
      </section>

      {/* Audit Trail Drawer */}
      {showAuditTrail && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Nhật ký kiểm toán điểm chính thức (bất biến)
            </h3>
            <span className="text-[11px] font-mono-num text-slate-500 whitespace-nowrap shrink-0">
              {auditTrail.length} thao tác
            </span>
          </div>
          {auditTrail.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Chưa có thao tác xác nhận hoặc điều chỉnh điểm nào trong phiên này.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-60 overflow-y-auto">
              {[...auditTrail].reverse().map((item) => (
                <li
                  key={item.id}
                  className="py-2 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                      {item.studentId}
                    </span>{' '}
                    <span className="font-mono-num text-indigo-700 dark:text-indigo-300">
                      {item.previousScore ?? '—'} → {item.newScore ?? '—'}
                    </span>{' '}
                    <span className="text-slate-500 dark:text-slate-400">
                      ({item.source}) · {item.reason}
                    </span>
                  </div>
                  <time className="text-[11px] font-mono-num text-slate-400 shrink-0">
                    {new Date(item.timestamp).toLocaleTimeString('vi-VN')}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Empty State */}
      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center space-y-3">
          <ClipboardCheck
            className="mx-auto h-8 w-8 text-slate-400"
            aria-hidden="true"
          />
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Chưa có dữ liệu học sinh hoặc phiếu OMR nào trong sổ điểm
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Hãy nhập danh sách lớp ở tab Danh sách lớp hoặc mở Camera quét phiếu trả lời để tự động tổng hợp bảng điểm chính thức.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Single-Column Card List (< md) */}
          <div className="space-y-3 md:hidden" data-testid="gradebook-mobile-cards">
            {filteredEntries.map((entry) => {
              const badge = statusMeta(entry.reconciliationStatus);
              const isEditing = editingStudentId === entry.studentId;
              const canUndo = auditStudentIds.has(
                entry.studentId.trim().toUpperCase()
              );

              return (
                <article
                  key={entry.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono-num text-xs font-bold text-indigo-700 dark:text-indigo-300">
                          {entry.studentId}
                        </span>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                          Mã {entry.examCode}
                        </span>
                      </div>
                      <h3 className="mt-0.5 text-sm font-bold text-slate-950 dark:text-white truncate">
                        {entry.fullName}
                      </h3>
                    </div>

                    <span
                      className={`shrink-0 rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${badge.toneClass}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 dark:bg-slate-950/60 p-2.5 text-center">
                    <div>
                      <div className="text-[10px] text-slate-500">Điểm OMR</div>
                      <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-slate-100">
                        {entry.omrScore !== null ? entry.omrScore.toFixed(2) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Ảnh sổ</div>
                      <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-slate-100">
                        {entry.photoScore !== null
                          ? entry.photoScore.toFixed(2)
                          : entry.photoRawText || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Chính thức</div>
                      <div className="font-mono-num text-sm font-bold text-indigo-700 dark:text-indigo-300">
                        {entry.officialScore !== null
                          ? entry.officialScore.toFixed(2)
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {entry.notes && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                      {entry.notes}
                    </p>
                  )}

                  {isEditing ? (
                    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 p-3 space-y-2">
                      <div className="grid grid-cols-1 gap-2">
                        <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          Điểm chính thức (0–{session.gradingRule.maxScore})
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editScoreInput}
                            onChange={(e) => setEditScoreInput(e.target.value)}
                            className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-mono-num text-slate-900 dark:text-white"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          Lý do điều chỉnh
                          <input
                            type="text"
                            value={editReasonInput}
                            onChange={(e) => setEditReasonInput(e.target.value)}
                            placeholder="Ví dụ: Kiểm tra phiếu giấy gốc..."
                            className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-white"
                          />
                        </label>
                      </div>
                      {editError && (
                        <div className="text-[11px] font-medium text-red-600 dark:text-red-400 flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{editError}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => submitManualEdit(entry)}
                          className="min-h-[44px] flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-xs font-semibold text-white"
                        >
                          Lưu &amp; Xác nhận
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingStudentId(null)}
                          className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {!entry.confirmedByTeacher && entry.omrScore !== null && (
                        <button
                          type="button"
                          onClick={() =>
                            onConfirmScore({
                              studentId: entry.studentId,
                              chosenScore: entry.omrScore,
                              source: 'omr',
                              reason: 'Giáo viên xác nhận điểm từ phiếu OMR',
                            })
                          }
                          className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          <span>Xác nhận OMR</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startManualEdit(entry)}
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Chỉnh điểm</span>
                      </button>
                      {entry.omrSheetId && (
                        <button
                          type="button"
                          onClick={() => onInspectOmrSheet(entry.omrSheetId!)}
                          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Soi phiếu</span>
                        </button>
                      )}
                      {canUndo && (
                        <button
                          type="button"
                          onClick={() => onUndoLastChange(entry.studentId)}
                          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Hoàn tác</span>
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Desktop Table (>= md) */}
          <div className="hidden md:block rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">STT</th>
                    <th className="px-4 py-3">Mã HS &amp; Họ tên</th>
                    <th className="px-4 py-3">Mã đề</th>
                    <th className="px-4 py-3 text-right">Điểm OMR</th>
                    <th className="px-4 py-3 text-right">Ảnh bảng điểm</th>
                    <th className="px-4 py-3 text-right">Điểm chính thức</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredEntries.map((entry) => {
                    const badge = statusMeta(entry.reconciliationStatus);
                    const isEditing = editingStudentId === entry.studentId;
                    const canUndo = auditStudentIds.has(
                      entry.studentId.trim().toUpperCase()
                    );

                    return (
                      <tr
                        key={entry.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono-num text-slate-500">
                          {entry.orderNumber}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {entry.fullName}
                          </div>
                          <div className="font-mono-num text-[11px] text-slate-500">
                            {entry.studentId} · {entry.className}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-num text-slate-700 dark:text-slate-300">
                          {entry.examCode}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                          {entry.omrScore !== null ? entry.omrScore.toFixed(2) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num text-slate-600 dark:text-slate-400">
                          {entry.photoScore !== null
                            ? entry.photoScore.toFixed(2)
                            : entry.photoRawText || '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-num font-bold text-indigo-700 dark:text-indigo-300">
                          {isEditing ? (
                            <div className="flex flex-col items-end gap-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={editScoreInput}
                                onChange={(e) => setEditScoreInput(e.target.value)}
                                aria-label={`Điểm mới cho ${entry.studentId}`}
                                className="w-20 rounded-lg border border-indigo-400 bg-white dark:bg-slate-800 px-2 py-1 text-right text-xs font-mono-num text-slate-900 dark:text-white"
                              />
                              <input
                                type="text"
                                value={editReasonInput}
                                onChange={(e) => setEditReasonInput(e.target.value)}
                                placeholder="Lý do..."
                                aria-label={`Lý do điều chỉnh cho ${entry.studentId}`}
                                className="w-40 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-900 dark:text-white"
                              />
                              {editError && (
                                <span className="text-[10px] text-red-600">
                                  {editError}
                                </span>
                              )}
                            </div>
                          ) : entry.officialScore !== null ? (
                            entry.officialScore.toFixed(2)
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${badge.toneClass}`}
                          >
                            {badge.label}
                          </span>
                          {entry.notes && (
                            <div className="mt-0.5 text-[10.5px] text-slate-500 max-w-[200px] truncate" title={entry.notes}>
                              {entry.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => submitManualEdit(entry)}
                                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                              >
                                Lưu
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingStudentId(null)}
                                className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                              >
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {!entry.confirmedByTeacher && entry.omrScore !== null && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onConfirmScore({
                                      studentId: entry.studentId,
                                      chosenScore: entry.omrScore,
                                      source: 'omr',
                                      reason: 'Giáo viên xác nhận điểm từ phiếu OMR',
                                    })
                                  }
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                                >
                                  Xác nhận
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => startManualEdit(entry)}
                                className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                Sửa
                              </button>
                              {entry.omrSheetId && (
                                <button
                                  type="button"
                                  onClick={() => onInspectOmrSheet(entry.omrSheetId!)}
                                  className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300"
                                >
                                  Soi phiếu
                                </button>
                              )}
                              {canUndo && (
                                <button
                                  type="button"
                                  onClick={() => onUndoLastChange(entry.studentId)}
                                  aria-label={`Hoàn tác điểm của ${entry.studentId}`}
                                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                  title="Hoàn tác thao tác điều chỉnh gần nhất"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

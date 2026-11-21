import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Edit3,
  Eye,
  FileCheck2,
  Filter,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  MATH_QUESTION_TYPE_LABELS,
  MathExamProject,
  MathQuestion,
  McqOptionLabel,
  TrueFalseLabel,
} from '../../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  applyTeacherManualAnswer,
} from '../../core/mathIntegrity';
import {
  RELIABILITY_ANSWER_STATUS_META,
  ReliabilityAnswerStatus,
  applyBulkAnswerKeyUpdates,
  confirmAllSourceMatchedAnswers,
  confirmSingleQuestionAnswer,
  getAnswerProvenanceSourceLabel,
  getReliabilityAnswerSummary,
  mapToReliabilityAnswerStatus,
  parseBulkAnswerKeyText,
} from '../../core/answerKeyRecovery';

interface AnswerKeyStudioPanelProps {
  exam: MathExamProject;
  onUpdateExam: (nextExam: MathExamProject) => void;
  onInspectQuestion?: (questionId: string) => void;
  onEditQuestion?: (questionId: string) => void;
  onToast?: (message: string, tone?: 'success' | 'warning' | 'error') => void;
}

type StatusFilter = 'all' | 'action-needed' | 'missing' | 'conflict-ambiguous' | 'confirmed';

const STATUS_BADGE_CLASS: Record<ReliabilityAnswerStatus, string> = {
  TEACHER_CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SOURCE_KEY_FOUND: 'bg-sky-50 text-sky-700 border-sky-200',
  AMBIGUOUS: 'bg-amber-50 text-amber-800 border-amber-200',
  CONFLICT: 'bg-rose-50 text-rose-700 border-rose-200',
  MISSING: 'bg-rose-50 text-rose-700 border-rose-200',
  UNSUPPORTED: 'bg-slate-100 text-slate-700 border-slate-300',
};

export const AnswerKeyStudioPanel: React.FC<AnswerKeyStudioPanelProps> = ({
  exam,
  onUpdateExam,
  onInspectQuestion,
  onEditQuestion,
  onToast,
}) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const rows = useMemo(() => {
    return exam.questions.map((q, idx) => ({
      question: q,
      orderNumber: idx + 1,
      status: mapToReliabilityAnswerStatus(q),
      answerSummary: getReliabilityAnswerSummary(q),
      sourceLabel: getAnswerProvenanceSourceLabel(q),
    }));
  }, [exam.questions]);

  const counts = useMemo(() => {
    const c: Record<ReliabilityAnswerStatus, number> = {
      TEACHER_CONFIRMED: 0,
      SOURCE_KEY_FOUND: 0,
      AMBIGUOUS: 0,
      CONFLICT: 0,
      MISSING: 0,
      UNSUPPORTED: 0,
    };
    rows.forEach((r) => {
      c[r.status] += 1;
    });
    return c;
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'confirmed') return r.status === 'TEACHER_CONFIRMED';
      if (statusFilter === 'missing') return r.status === 'MISSING';
      if (statusFilter === 'conflict-ambiguous') {
        return r.status === 'CONFLICT' || r.status === 'AMBIGUOUS' || r.status === 'UNSUPPORTED';
      }
      // action-needed
      return r.status !== 'TEACHER_CONFIRMED';
    });
  }, [rows, statusFilter]);

  const bulkPreview = useMemo(() => {
    if (!bulkText.trim()) return null;
    return parseBulkAnswerKeyText(bulkText, exam.questions);
  }, [bulkText, exam.questions]);

  const handleSetMcqAnswer = (q: MathQuestion, label: McqOptionLabel) => {
    if (q.optionParseIncomplete || !q.options) return;
    const target = q.options.find((o) => o.originalLabel === label);
    if (!target) return;
    const now = new Date().toISOString();
    const nextQuestions = exam.questions.map((item) => {
      if (item.id !== q.id) return item;
      const nextOpts = (item.options ?? []).map((o) => ({
        ...o,
        isCorrect: o.id === target.id,
      }));
      return applyTeacherManualAnswer(
        item,
        {
          ...item,
          options: nextOpts,
          correctOptionId: target.id,
        },
        {
          now,
          sourceLocation: 'Answer Key Studio (chọn trực tiếp)',
          selectionSummary: `Phương án ${label}`,
        }
      );
    });
    const allConfirmed = nextQuestions
      .filter((item) => item.type !== 'essay')
      .every((item) => mapToReliabilityAnswerStatus(item) === 'TEACHER_CONFIRMED');
    onUpdateExam({
      ...exam,
      questions: nextQuestions,
      confirmedOriginalAnswers: allConfirmed ? true : exam.confirmedOriginalAnswers,
      generatedVersions: [],
      updatedAt: now,
    });
  };

  const handleToggleTfStatement = (q: MathQuestion, stmtLabel: TrueFalseLabel, nextVal: boolean) => {
    if (!q.statements) return;
    const now = new Date().toISOString();
    const nextQuestions = exam.questions.map((item) => {
      if (item.id !== q.id) return item;
      const nextSts = (item.statements ?? []).map((st) =>
        st.originalLabel === stmtLabel
          ? { ...st, isTrue: nextVal, answerState: 'confirmed' as const }
          : st
      );
      return applyTeacherManualAnswer(
        item,
        {
          ...item,
          statements: nextSts,
        },
        {
          now,
          sourceLocation: 'Answer Key Studio (xác nhận 4 ý Đ/S)',
        }
      );
    });
    const allConfirmed = nextQuestions
      .filter((item) => item.type !== 'essay')
      .every((item) => mapToReliabilityAnswerStatus(item) === 'TEACHER_CONFIRMED');
    onUpdateExam({
      ...exam,
      questions: nextQuestions,
      confirmedOriginalAnswers: allConfirmed ? true : exam.confirmedOriginalAnswers,
      generatedVersions: [],
      updatedAt: now,
    });
  };

  const handleUpdateShortAnswer = (q: MathQuestion, rawVal: string) => {
    const trimmed = rawVal.trim();
    const now = new Date().toISOString();
    const normalized = trimmed.replace(/−/g, '-').replace(/\s+/g, '').replace(/^(-?\d+),(\d+)$/, '$1.$2');
    const nextQuestions = exam.questions.map((item) => {
      if (item.id !== q.id) return item;
      return applyTeacherManualAnswer(
        item,
        {
          ...item,
          shortAnswer: {
            ...(item.shortAnswer ?? { answerValue: trimmed, acceptedFormats: [] }),
            answerValue: trimmed,
            rawAnswer: trimmed,
            normalizedAnswer: normalized,
            acceptedFormats: Array.from(new Set([trimmed, normalized].filter(Boolean))),
          },
        },
        {
          now,
          sourceLocation: 'Answer Key Studio (nhập tay)',
          selectionSummary: trimmed || undefined,
        }
      );
    });
    const allConfirmed = nextQuestions
      .filter((item) => item.type !== 'essay')
      .every((item) => mapToReliabilityAnswerStatus(item) === 'TEACHER_CONFIRMED');
    onUpdateExam({
      ...exam,
      questions: nextQuestions,
      confirmedOriginalAnswers: allConfirmed ? true : exam.confirmedOriginalAnswers,
      generatedVersions: [],
      updatedAt: now,
    });
  };

  const handleConfirmAllSourceFound = () => {
    const res = confirmAllSourceMatchedAnswers(exam);
    if (res.confirmedCount === 0) {
      onToast?.(
        'Không có câu nào ở trạng thái SOURCE_KEY_FOUND cần xác nhận hàng loạt. Các câu thiếu/mâu thuẫn phải xác nhận riêng.',
        'warning'
      );
      return;
    }
    onUpdateExam(res.exam);
    onToast?.(
      `Đã xác nhận ${res.confirmedCount} câu có khóa đối chiếu từ tài liệu gốc (bỏ qua ${res.skippedCount} câu thiếu/cần duyệt).`,
      'success'
    );
  };

  const handleApplyBulkPaste = () => {
    if (!bulkPreview || bulkPreview.matched.length === 0) {
      onToast?.('Chưa nhận diện được dòng đáp án hợp lệ nào để áp dụng.', 'warning');
      return;
    }
    const nextExam = applyBulkAnswerKeyUpdates(exam, bulkPreview.matched);
    onUpdateExam(nextExam);
    setBulkText('');
    setShowBulkPaste(false);
    onToast?.(
      `Đã cập nhật và xác nhận đáp án cho ${bulkPreview.matched.length} câu hỏi từ bảng dán nhanh.`,
      'success'
    );
  };

  return (
    <div className="space-y-4">
      {/* Header & Status Counters */}
      <div className="bg-white/90 border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck2 className="w-5 h-5 text-indigo-600" />
              <h3 className="text-base font-bold text-slate-900">
                Answer Key Studio — Khôi phục & Xác minh khóa đáp án
              </h3>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Mọi câu hỏi đều hiển thị rõ nguồn phát hiện và trạng thái xác minh. Hệ thống tuyệt đối không tự đoán hay mặc định đáp án A/Sai cho câu thiếu.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBulkPaste((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              {showBulkPaste ? 'Đóng dán nhanh đáp án' : 'Dán nhanh đáp án (Bulk Paste)'}
            </button>
            <button
              type="button"
              onClick={handleConfirmAllSourceFound}
              disabled={counts.SOURCE_KEY_FOUND === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Xác nhận {counts.SOURCE_KEY_FOUND} câu SOURCE_KEY_FOUND
            </button>
          </div>
        </div>

        {/* 6 Status KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {(
            [
              'TEACHER_CONFIRMED',
              'SOURCE_KEY_FOUND',
              'MISSING',
              'AMBIGUOUS',
              'CONFLICT',
              'UNSUPPORTED',
            ] as ReliabilityAnswerStatus[]
          ).map((st) => {
            const meta = RELIABILITY_ANSWER_STATUS_META[st];
            return (
              <div
                key={st}
                className={`rounded-xl border px-3 py-2 ${STATUS_BADGE_CLASS[st]}`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">
                  {st}
                </div>
                <div className="text-lg font-extrabold leading-tight mt-0.5">
                  {counts[st]}
                </div>
                <div className="text-[11px] opacity-85 truncate">{meta.shortLabel}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bulk Paste Answer Key Drawer */}
      {showBulkPaste && (
        <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Nhập nhanh bảng đáp án (Bulk Paste)
              </h4>
              <p className="text-xs text-indigo-900/80 mt-0.5">
                Hỗ trợ: <code className="bg-white/80 px-1 rounded">1.B 2.C 3.A</code> ·{' '}
                <code className="bg-white/80 px-1 rounded">1B 2C 3A 4D</code> ·{' '}
                <code className="bg-white/80 px-1 rounded">Câu 1: B | Câu 2: C</code> ·{' '}
                <code className="bg-white/80 px-1 rounded">Phần II</code> +{' '}
                <code className="bg-white/80 px-1 rounded">1: Đ-S-Đ-S</code> /{' '}
                <code className="bg-white/80 px-1 rounded">1: TFTT</code> ·{' '}
                <code className="bg-white/80 px-1 rounded">Phần III</code> +{' '}
                <code className="bg-white/80 px-1 rounded">1: -4,3</code>. Không tự đoán câu thiếu.
              </p>
            </div>
          </div>

          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            placeholder={'Phần I\n1.B 2.C 3.A 4.D\nPhần II\n1: Đ-S-Đ-S\n2: a) S, b) Đ, c) Đ, d) S\nPhần III\n1: -4,3\n2: 0'}
            className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />

          {bulkPreview && (
            <div className="bg-white rounded-xl border border-indigo-100 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-emerald-700">
                  Khớp hợp lệ: {bulkPreview.matched.length} câu
                </span>
                {bulkPreview.unmatchedTokens.length > 0 && (
                  <span className="font-semibold text-amber-700">
                    Không khớp: {bulkPreview.unmatchedTokens.length} dòng/mục
                  </span>
                )}
              </div>

              {bulkPreview.matched.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {bulkPreview.matched.map((m) => (
                    <span
                      key={m.questionId}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200"
                    >
                      <strong>
                        Câu {m.questionOrderIndex + 1} ({m.questionCode}):
                      </strong>{' '}
                      {m.parsedSummary}
                    </span>
                  ))}
                </div>
              )}

              {bulkPreview.warnings.length > 0 && (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-0.5">
                  {bulkPreview.warnings.slice(0, 5).map((w, idx) => (
                    <div key={idx}>• {w}</div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setBulkText('')}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Xóa nháp
                </button>
                <button
                  type="button"
                  onClick={handleApplyBulkPaste}
                  disabled={bulkPreview.matched.length === 0}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  Áp dụng & xác nhận {bulkPreview.matched.length} câu
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-500 mr-1" />
          {(
            [
              { id: 'all', label: `Tất cả (${rows.length})` },
              {
                id: 'action-needed',
                label: `Cần xử lý (${rows.length - counts.TEACHER_CONFIRMED})`,
              },
              { id: 'missing', label: `Thiếu đáp án (${counts.MISSING})` },
              {
                id: 'conflict-ambiguous',
                label: `Mâu thuẫn / Cần duyệt (${counts.CONFLICT + counts.AMBIGUOUS + counts.UNSUPPORTED})`,
              },
              { id: 'confirmed', label: `Đã xác nhận (${counts.TEACHER_CONFIRMED})` },
            ] as Array<{ id: StatusFilter; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                statusFilter === tab.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Answer Key Studio Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-3 w-28">Câu số</th>
                <th className="py-2.5 px-3 w-36">Loại câu</th>
                <th className="py-2.5 px-3 min-w-[210px]">Đáp án phát hiện / Chỉnh nhanh</th>
                <th className="py-2.5 px-3 min-w-[170px]">Nguồn phát hiện</th>
                <th className="py-2.5 px-3 w-40">Trạng thái</th>
                <th className="py-2.5 px-3 w-44 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Không có câu hỏi nào trong bộ lọc này.
                  </td>
                </tr>
              ) : (
                filteredRows.map(({ question: q, orderNumber, status, answerSummary, sourceLabel }) => {
                  const meta = RELIABILITY_ANSWER_STATUS_META[status];
                  const canConfirmDirectly =
                    status === 'SOURCE_KEY_FOUND' ||
                    (status === 'AMBIGUOUS' &&
                      !q.optionParseIncomplete &&
                      ((q.type === 'mcq' && Boolean(q.correctOptionId)) ||
                        (q.type === 'true-false' &&
                          (q.statements ?? []).length === 4 &&
                          !(q.statements ?? []).some((s) => s.answerState === 'missing')) ||
                        (q.type === 'short-answer' && Boolean(q.shortAnswer?.answerValue?.trim()))));

                  return (
                    <tr
                      key={q.id}
                      className={
                        status === 'CONFLICT' || status === 'MISSING'
                          ? 'bg-rose-50/30 hover:bg-rose-50/60'
                          : status === 'AMBIGUOUS'
                          ? 'bg-amber-50/30 hover:bg-amber-50/60'
                          : 'hover:bg-slate-50/80'
                      }
                    >
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-bold text-slate-900">Câu {orderNumber}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{q.code}</div>
                        {q.optionParseIncomplete && (
                          <span className="inline-block mt-1 text-[10px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">
                            OPTION_PARSE_INCOMPLETE
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-medium text-slate-800">
                          {MATH_QUESTION_TYPE_LABELS[q.type]}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate max-w-[140px]">
                          {q.sectionTitle}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        {q.type === 'mcq' && !q.optionParseIncomplete && (q.options?.length ?? 0) === 4 ? (
                          <div className="flex items-center gap-1">
                            {MCQ_LABELS.map((lbl) => {
                              const opt = (q.options ?? []).find((o) => o.originalLabel === lbl);
                              const active = opt?.id === q.correctOptionId && opt?.isCorrect;
                              return (
                                <button
                                  key={lbl}
                                  type="button"
                                  onClick={() => handleSetMcqAnswer(q, lbl)}
                                  className={`w-7 h-7 rounded-lg text-xs font-bold border transition-colors ${
                                    active
                                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                      : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-400 hover:text-indigo-700'
                                  }`}
                                  title={`Chọn đáp án ${lbl}`}
                                >
                                  {lbl}
                                </button>
                              );
                            })}
                          </div>
                        ) : q.type === 'true-false' && (q.statements?.length ?? 0) === 4 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {TF_LABELS.map((lbl, sIdx) => {
                              const st = q.statements?.[sIdx];
                              const isMissing = st?.answerState === 'missing';
                              const isCand = st?.answerState === 'candidate';
                              return (
                                <div
                                  key={lbl}
                                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden"
                                >
                                  <span className="px-1.5 text-[11px] font-bold text-slate-600 bg-slate-50">
                                    {lbl}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTfStatement(q, lbl, true)}
                                    className={`px-1.5 py-0.5 text-[11px] font-bold ${
                                      !isMissing && st?.isTrue
                                        ? isCand
                                          ? 'bg-amber-400 text-slate-900'
                                          : 'bg-emerald-600 text-white'
                                        : 'text-slate-500 hover:bg-slate-100'
                                    }`}
                                  >
                                    Đ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTfStatement(q, lbl, false)}
                                    className={`px-1.5 py-0.5 text-[11px] font-bold ${
                                      !isMissing && !st?.isTrue
                                        ? isCand
                                          ? 'bg-amber-400 text-slate-900'
                                          : 'bg-rose-600 text-white'
                                        : 'text-slate-500 hover:bg-slate-100'
                                    }`}
                                  >
                                    S
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : q.type === 'short-answer' ? (
                          <input
                            type="text"
                            defaultValue={q.shortAnswer?.rawAnswer || q.shortAnswer?.answerValue || ''}
                            onBlur={(e) => {
                              const val = e.target.value;
                              if (val !== (q.shortAnswer?.answerValue || '')) {
                                handleUpdateShortAnswer(q, val);
                              }
                            }}
                            placeholder="Nhập đáp án ngắn (VD: -4,3)"
                            className="w-40 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                        ) : (
                          <span className="font-semibold text-slate-700">{answerSummary}</span>
                        )}
                        {q.answerProvenance?.note && status !== 'TEACHER_CONFIRMED' && (
                          <div className="text-[11px] text-slate-600 mt-1 leading-snug max-w-xs">
                            {q.answerProvenance.note}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-medium text-slate-800">{sourceLabel}</div>
                        {q.answerProvenance?.rawEvidence && (
                          <div className="text-[11px] text-slate-500 truncate max-w-[190px]" title={q.answerProvenance.rawEvidence}>
                            {q.answerProvenance.rawEvidence}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold ${STATUS_BADGE_CLASS[status]}`}
                        >
                          {status === 'TEACHER_CONFIRMED' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : status === 'CONFLICT' || status === 'MISSING' ? (
                            <XCircle className="w-3 h-3" />
                          ) : status === 'AMBIGUOUS' ? (
                            <AlertTriangle className="w-3 h-3" />
                          ) : (
                            <ShieldAlert className="w-3 h-3" />
                          )}
                          {meta.shortLabel}
                        </span>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">{status}</div>
                      </td>
                      <td className="py-2.5 px-3 align-top text-right">
                        <div className="inline-flex items-center gap-1">
                          {canConfirmDirectly && (
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateExam(confirmSingleQuestionAnswer(exam, q.id));
                                onToast?.(`Đã xác nhận đáp án Câu ${orderNumber} (${q.code}).`, 'success');
                              }}
                              className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                              title="Xác nhận đáp án câu này"
                            >
                              Xác nhận
                            </button>
                          )}
                          {onInspectQuestion && (
                            <button
                              type="button"
                              onClick={() => onInspectQuestion(q.id)}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                              title="Xem trong Document Import Doctor"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onEditQuestion && (
                            <button
                              type="button"
                              onClick={() => onEditQuestion(q.id)}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                              title="Sửa câu hỏi trong trình soạn thảo"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

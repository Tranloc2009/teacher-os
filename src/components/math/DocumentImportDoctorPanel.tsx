import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  FileSearch,
  FileText,
  Image as ImageIcon,
  KeyRound,
  ShieldCheck,
  ShieldX,
  Sigma,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  MATH_QUESTION_TYPE_LABELS,
  MathExamProject,
  MathIntegrityIssue,
  MathQuestion,
} from '../../types/mathExam';
import { auditOriginalExamIntegrity } from '../../core/mathIntegrity';
import {
  RELIABILITY_ANSWER_STATUS_META,
  getAnswerProvenanceSourceLabel,
  getReliabilityAnswerSummary,
  mapToReliabilityAnswerStatus,
} from '../../core/answerKeyRecovery';
import { MathContentRenderer } from './MathContentRenderer';

interface DocumentImportDoctorPanelProps {
  exam: MathExamProject;
  initialQuestionId?: string | null;
  onEditQuestion?: (questionId: string) => void;
  onOpenAnswerStudio?: () => void;
  onConfirmAndProceed?: () => void;
}

export const DocumentImportDoctorPanel: React.FC<DocumentImportDoctorPanelProps> = ({
  exam,
  initialQuestionId,
  onEditQuestion,
  onOpenAnswerStudio,
  onConfirmAndProceed,
}) => {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    initialQuestionId || exam.questions[0]?.id || ''
  );
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number>(0);
  const [sourceZoom, setSourceZoom] = useState<85 | 100 | 115>(100);

  const issues = useMemo(() => auditOriginalExamIntegrity(exam), [exam]);

  const issuesByQuestionId = useMemo(() => {
    const map = new Map<string, MathIntegrityIssue[]>();
    for (const iss of issues) {
      if (!iss.questionId) continue;
      const list = map.get(iss.questionId) ?? [];
      list.push(iss);
      map.set(iss.questionId, list);
    }
    return map;
  }, [issues]);

  const diagnostics = useMemo(() => {
    let formulaCount = 0;
    let imageCount = 0;
    let incompleteOptionCount = 0;
    let unrenderableAssetCount = 0;
    let answerAvailableCount = 0;
    let answerMissingOrProblemCount = 0;
    let questionsNeedingReview = 0;

    const countLatex = (txt?: string) => {
      if (!txt) return 0;
      const m = txt.match(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g);
      return m ? m.length : 0;
    };

    for (const q of exam.questions) {
      const qIssues = issuesByQuestionId.get(q.id) ?? [];
      const hasBlocking = qIssues.some((i) => i.severity === 'error');
      const status = mapToReliabilityAnswerStatus(q);
      if (hasBlocking || status === 'MISSING' || status === 'CONFLICT' || status === 'AMBIGUOUS' || status === 'UNSUPPORTED') {
        questionsNeedingReview += 1;
      }
      if (status === 'TEACHER_CONFIRMED' || status === 'SOURCE_KEY_FOUND') {
        answerAvailableCount += 1;
      } else if (q.type !== 'essay') {
        answerMissingOrProblemCount += 1;
      }

      if (q.optionParseIncomplete) incompleteOptionCount += 1;
      unrenderableAssetCount += q.unrenderableMediaRefs?.length ?? 0;

      formulaCount +=
        countLatex(q.stem.rawSource) +
        (q.options ?? []).reduce((s, o) => s + countLatex(o.content.rawSource), 0) +
        (q.statements ?? []).reduce((s, st) => s + countLatex(st.content.rawSource), 0) +
        (q.formulaStatus?.wmfPreviewCount ?? 0);

      imageCount +=
        (q.visualAssets?.length ?? 0) +
        (q.options ?? []).filter((o) => Boolean(o.visualAsset)).length;
    }

    return {
      totalQuestions: exam.questions.length,
      questionsNeedingReview,
      formulaCount,
      imageCount,
      incompleteOptionCount,
      unrenderableAssetCount,
      answerAvailableCount,
      answerMissingOrProblemCount,
      blockingCount: issues.filter((i) => i.severity === 'error').length,
    };
  }, [exam.questions, issues, issuesByQuestionId]);

  const filteredQuestions = useMemo(() => {
    if (!showOnlyIssues) return exam.questions;
    return exam.questions.filter((q) => {
      const qIssues = issuesByQuestionId.get(q.id) ?? [];
      const st = mapToReliabilityAnswerStatus(q);
      return (
        qIssues.some((i) => i.severity === 'error') ||
        q.optionParseIncomplete ||
        (q.unrenderableMediaRefs?.length ?? 0) > 0 ||
        (q.type !== 'essay' && st !== 'TEACHER_CONFIRMED' && st !== 'SOURCE_KEY_FOUND')
      );
    });
  }, [exam.questions, issuesByQuestionId, showOnlyIssues]);

  const activeQuestion: MathQuestion | undefined =
    exam.questions.find((q) => q.id === selectedQuestionId) ??
    filteredQuestions[0] ??
    exam.questions[0];

  const activeOrderIndex = activeQuestion
    ? exam.questions.findIndex((q) => q.id === activeQuestion.id)
    : -1;
  const activeQuestionIssues = activeQuestion
    ? issuesByQuestionId.get(activeQuestion.id) ?? []
    : [];

  // Fallback read-only source preview if exam was authored manually without an imported file snapshot
  const previewSections = useMemo(() => {
    if (exam.sourceDocumentPreview && exam.sourceDocumentPreview.sections.length > 0) {
      return exam.sourceDocumentPreview.sections;
    }
    return [
      {
        title: 'Bản trích chỉ-đọc từ đề hiện tại (không có tệp nhập gốc)',
        rawLines: exam.questions.flatMap((q, idx) => [
          `Câu ${idx + 1} (${q.code}) [${q.sectionTitle}]: ${q.stem.rawSource}`,
          ...(q.options ?? []).map((o) => `  ${o.originalLabel}. ${o.content.rawSource}`),
          ...(q.statements ?? []).map((s) => `  ${s.originalLabel}) ${s.content.rawSource}`),
        ]),
      },
    ];
  }, [exam.sourceDocumentPreview, exam.questions]);

  const currentSection = previewSections[selectedSectionIdx] ?? previewSections[0];
  const highlightQuestionNeedle = activeQuestion
    ? `Câu ${activeQuestion.sourceTrace?.originalQuestionNumberInSection ?? activeOrderIndex + 1}`
    : '';

  return (
    <div className="space-y-4">
      {/* Top Diagnostic Summary */}
      <div className="bg-white/95 border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-indigo-600" />
              <h3 className="text-base font-bold text-slate-900">
                Document Import Doctor — Đối chiếu tài liệu gốc & Chẩn đoán toàn vẹn
              </h3>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Tệp gốc ở khung trái luôn ở chế độ chỉ-đọc (không bao giờ bị ghi đè). Đối chiếu công thức, hình ảnh, phương án và khóa đáp án trước khi trộn đề.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenAnswerStudio && (
              <button
                type="button"
                onClick={onOpenAnswerStudio}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200 hover:bg-slate-200 transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Mở Answer Key Studio
              </button>
            )}
            {onConfirmAndProceed && (
              <button
                type="button"
                onClick={onConfirmAndProceed}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white transition-colors ${
                  diagnostics.blockingCount === 0
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                Kiểm tra & xác nhận trước khi trộn
              </button>
            )}
          </div>
        </div>

        {/* 7 Diagnostic KPI tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[10px] font-semibold text-slate-500 uppercase">Câu nhận diện</div>
            <div className="text-lg font-extrabold text-slate-900">{diagnostics.totalQuestions}</div>
          </div>
          <div
            className={`rounded-xl border px-3 py-2 ${
              diagnostics.questionsNeedingReview > 0
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase opacity-80">Câu cần kiểm tra</div>
            <div className="text-lg font-extrabold">{diagnostics.questionsNeedingReview}</div>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-indigo-950">
            <div className="text-[10px] font-semibold uppercase opacity-80 flex items-center gap-1">
              <Sigma className="w-3 h-3" /> Công thức
            </div>
            <div className="text-lg font-extrabold">{diagnostics.formulaCount}</div>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2 text-sky-950">
            <div className="text-[10px] font-semibold uppercase opacity-80 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> Hình & bảng
            </div>
            <div className="text-lg font-extrabold">{diagnostics.imageCount}</div>
          </div>
          <div
            className={`rounded-xl border px-3 py-2 ${
              diagnostics.incompleteOptionCount > 0 || diagnostics.unrenderableAssetCount > 0
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-slate-200 bg-slate-50 text-slate-800'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase opacity-80">Phương án / Media lỗi</div>
            <div className="text-lg font-extrabold">
              {diagnostics.incompleteOptionCount + diagnostics.unrenderableAssetCount}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-emerald-900">
            <div className="text-[10px] font-semibold uppercase opacity-80">Đáp án có sẵn</div>
            <div className="text-lg font-extrabold">{diagnostics.answerAvailableCount}</div>
          </div>
          <div
            className={`rounded-xl border px-3 py-2 ${
              diagnostics.answerMissingOrProblemCount > 0
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase opacity-80">Đáp án thiếu / lỗi</div>
            <div className="text-lg font-extrabold">{diagnostics.answerMissingOrProblemCount}</div>
          </div>
        </div>
      </div>

      {/* Split View: LEFT Read-Only Source Document | RIGHT Parsed Structured Question */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* LEFT PANE: Read-Only Original Source Preview */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-slate-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 truncate">
                  Tài liệu gốc (Chỉ đọc):{' '}
                  {exam.sourceDocumentPreview?.fileName || exam.sourceRecord?.fileName || exam.title}
                </div>
                {exam.sourceDocumentPreview?.unsupportedMediaNames &&
                  exam.sourceDocumentPreview.unsupportedMediaNames.length > 0 && (
                    <div className="text-[11px] text-rose-700 font-semibold">
                      UNRENDERABLE: {exam.sourceDocumentPreview.unsupportedMediaNames.join(', ')}
                    </div>
                  )}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <select
                aria-label="Chọn phần tài liệu gốc"
                value={selectedSectionIdx}
                onChange={(e) => setSelectedSectionIdx(Number(e.target.value))}
                className="text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-700 max-w-[175px]"
              >
                {previewSections.map((sec, idx) => (
                  <option key={idx} value={idx}>
                    {idx + 1}. {sec.title.slice(0, 42)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSourceZoom((z) => (z === 115 ? 100 : 85))}
                className="p-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                title="Thu nhỏ"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono text-slate-600 w-9 text-center">
                {sourceZoom}%
              </span>
              <button
                type="button"
                onClick={() => setSourceZoom((z) => (z === 85 ? 100 : 115))}
                className="p-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                title="Phóng to"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div
            className="p-4 max-h-[540px] overflow-y-auto font-mono leading-relaxed space-y-1 bg-slate-50/40"
            style={{ fontSize: `${Math.round(12 * (sourceZoom / 100))}px` }}
          >
            {(currentSection?.rawLines ?? []).map((line, lIdx) => {
              const isSuspect =
                line.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
                line.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]') ||
                line.includes('[TÀI_NGUYÊN_UNRENDERABLE:');
              const isActiveMatch =
                Boolean(highlightQuestionNeedle) &&
                new RegExp(`^\\s*${highlightQuestionNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line);

              return (
                <div
                  key={lIdx}
                  className={`px-2 py-1 rounded-md whitespace-pre-wrap break-words ${
                    isSuspect
                      ? 'bg-rose-100 text-rose-900 border border-rose-300 font-semibold'
                      : isActiveMatch
                      ? 'bg-indigo-100/90 text-indigo-950 border border-indigo-300 font-semibold'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <span className="text-slate-400 select-none mr-2 text-[10px]">
                    {String(lIdx + 1).padStart(3, '0')}
                  </span>
                  {line}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANE: Structured Parsed Question Inspector */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-900">
              Câu hỏi sau phân tích ({filteredQuestions.length}/{exam.questions.length})
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyIssues}
                onChange={(e) => setShowOnlyIssues(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600"
              />
              Chỉ hiện câu có lỗi / cần kiểm tra
            </label>
          </div>

          {/* Question Pill Navigator */}
          <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {filteredQuestions.map((q) => {
              const idx = exam.questions.findIndex((item) => item.id === q.id);
              const qIss = issuesByQuestionId.get(q.id) ?? [];
              const hasErr = qIss.some((i) => i.severity === 'error');
              const isSelected = activeQuestion?.id === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSelectedQuestionId(q.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : hasErr
                      ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  Câu {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Active Question Full Preview */}
          {activeQuestion ? (
            <div className="p-4 space-y-3 max-h-[430px] overflow-y-auto">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    Câu {activeOrderIndex + 1} ({activeQuestion.code}) —{' '}
                    {MATH_QUESTION_TYPE_LABELS[activeQuestion.type]}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {activeQuestion.sectionTitle}
                    {activeQuestion.sourceTrace?.paragraphLocation
                      ? ` · Vị trí nguồn: ${activeQuestion.sourceTrace.paragraphLocation}`
                      : ''}
                  </div>
                </div>
                {onEditQuestion && (
                  <button
                    type="button"
                    onClick={() => onEditQuestion(activeQuestion.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-800 hover:bg-slate-200"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Sửa câu này
                  </button>
                )}
              </div>

              {/* Blocking / Warning alerts for this question */}
              {activeQuestionIssues.length > 0 ? (
                <div className="space-y-1.5">
                  {activeQuestionIssues.map((iss) => (
                    <div
                      key={iss.id}
                      className={`rounded-xl border px-3 py-2 text-xs flex items-start gap-2 ${
                        iss.severity === 'error'
                          ? 'bg-rose-50 border-rose-200 text-rose-900'
                          : 'bg-amber-50 border-amber-200 text-amber-900'
                      }`}
                    >
                      {iss.severity === 'error' ? (
                        <ShieldX className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                      )}
                      <div>
                        <div className="font-semibold">{iss.message}</div>
                        <div className="text-[11px] opacity-85 mt-0.5">{iss.recommendation}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  Câu hỏi đạt đầy đủ kiểm tra cấu trúc, công thức và tài nguyên.
                </div>
              )}

              {/* Rendered Stem */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm text-slate-900">
                <MathContentRenderer payload={activeQuestion.stem} />
              </div>

              {/* Attached visual assets (non-inline formula images) */}
              {(activeQuestion.visualAssets ?? []).filter(
                (a) => !a.id.startsWith('docx-ole-svg-')
              ).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(activeQuestion.visualAssets ?? [])
                    .filter((a) => !a.id.startsWith('docx-ole-svg-'))
                    .map((asset) => (
                      <div
                        key={asset.id}
                        className="rounded-xl border border-slate-200 bg-white p-2 max-w-[220px]"
                      >
                        {asset.sourceData.startsWith('data:image') ? (
                          <img
                            src={asset.sourceData}
                            alt={asset.altText}
                            className="max-h-28 object-contain rounded"
                          />
                        ) : (
                          <div className="text-[11px] font-mono text-slate-600 whitespace-pre-wrap max-h-24 overflow-hidden">
                            {asset.label}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-500 mt-1 truncate">
                          {asset.label}
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {/* MCQ Options */}
              {activeQuestion.type === 'mcq' && (activeQuestion.options?.length ?? 0) > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(activeQuestion.options ?? []).map((opt) => (
                    <div
                      key={opt.id}
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        opt.isCorrect && opt.id === activeQuestion.correctOptionId
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                          : 'bg-white border-slate-200 text-slate-800'
                      }`}
                    >
                      <span className="font-bold mr-1.5">{opt.originalLabel}.</span>
                      <MathContentRenderer payload={opt.content} className="inline" />
                    </div>
                  ))}
                </div>
              )}

              {/* True/False Statements */}
              {activeQuestion.type === 'true-false' && (activeQuestion.statements?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  {(activeQuestion.statements ?? []).map((st) => (
                    <div
                      key={st.id}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs flex items-start justify-between gap-2"
                    >
                      <div>
                        <span className="font-bold mr-1.5">{st.originalLabel})</span>
                        <MathContentRenderer payload={st.content} className="inline" />
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded font-bold text-[11px] ${
                          st.answerState === 'missing'
                            ? 'bg-rose-100 text-rose-700'
                            : st.answerState === 'candidate'
                            ? 'bg-amber-100 text-amber-800'
                            : st.isTrue
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {st.answerState === 'missing'
                          ? 'THIẾU'
                          : st.isTrue
                          ? 'Đúng'
                          : 'Sai'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Answer Status Summary Bar */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-slate-500">Đáp án hiện tại:</span>{' '}
                  <strong className="text-slate-900">
                    {getReliabilityAnswerSummary(activeQuestion)}
                  </strong>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="text-slate-600">
                    Nguồn: {getAnswerProvenanceSourceLabel(activeQuestion)}
                  </span>
                </div>
                <span className="font-mono text-[11px] font-bold text-indigo-700">
                  {RELIABILITY_ANSWER_STATUS_META[mapToReliabilityAnswerStatus(activeQuestion)].status}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-slate-500">
              Không có câu hỏi nào để hiển thị.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

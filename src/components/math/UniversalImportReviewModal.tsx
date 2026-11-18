import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crop,
  FileWarning,
  GitMerge,
  ListOrdered,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { MathQuestion, UNIVERSAL_QUESTION_TYPE_LABELS } from '../../types/mathExam';
import {
  CompatibilityStatus,
  UniversalImportSession,
} from '../../types/universalImport';
import { cropPdfPageRegionToDataUrl } from '../../core/pdfImportAdapter';
import { createImmutableContentPayload } from '../../core/subjectProfileRegistry';
import { insertMathSymbolAtCursor, MathToolbarSymbol } from '../../core/mathToolbarSymbols';
import {
  attachVisualAssetToImportedQuestion,
  confirmAllReviewableQuestions,
  mergeImportedQuestionWithPrevious,
  renumberImportedQuestions,
  splitImportedQuestionAtBreak,
  toggleConfirmImportedQuestion,
  updateImportedQuestion,
} from '../../core/universalImportAdapter';
import { createId } from '../../db/database';
import { MathContentRenderer, MathVisualAssetRenderer } from './MathContentRenderer';
import { MathSymbolToolbar } from './MathSymbolToolbar';

interface UniversalImportReviewModalProps {
  session: UniversalImportSession;
  applySuggestedSubject: boolean;
  onChangeApplySuggestedSubject: (val: boolean) => void;
  onChangeSession: (next: UniversalImportSession) => void;
  onCommit: (replaceExisting: boolean) => void;
  onClose: () => void;
}

const STATUS_META: Record<
  CompatibilityStatus,
  {
    label: string;
    containerClass: string;
    icon: typeof ShieldCheck;
  }
> = {
  READY: {
    label: 'READY · Sẵn sàng',
    containerClass:
      'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/35 text-emerald-800 dark:text-emerald-200',
    icon: ShieldCheck,
  },
  REVIEW_REQUIRED: {
    label: 'REVIEW REQUIRED · Cần đối chiếu',
    containerClass:
      'border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/35 text-amber-900 dark:text-amber-200',
    icon: AlertTriangle,
  },
  UNSUPPORTED: {
    label: 'UNSUPPORTED · Chưa hỗ trợ',
    containerClass:
      'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200',
    icon: FileWarning,
  },
  BLOCKED: {
    label: 'BLOCKED · Bị chặn an toàn',
    containerClass:
      'border-red-200 dark:border-red-800/80 bg-red-50/80 dark:bg-red-950/35 text-red-900 dark:text-red-200',
    icon: Ban,
  },
};

export function UniversalImportReviewModal({
  session,
  applySuggestedSubject,
  onChangeApplySuggestedSubject,
  onChangeSession,
  onCommit,
  onClose,
}: UniversalImportReviewModalProps) {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    session.questions[0]?.id ?? ''
  );
  const [activePageNumber, setActivePageNumber] = useState<number>(
    session.questions[0]?.sourceVerification?.pageNumber ??
      session.documentModel.pages[0]?.pageNumber ??
      1
  );
  const [showTechDetails, setShowTechDetails] = useState(false);
  const [showRawLayerText, setShowRawLayerText] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const stemRef = useRef<HTMLTextAreaElement | null>(null);

  const report = session.compatibilityReport;
  const pages = session.documentModel.pages;
  const statusMeta = STATUS_META[report.status];
  const StatusIcon = statusMeta.icon;

  const activeQuestion = useMemo(
    () =>
      session.questions.find((q) => q.id === selectedQuestionId) ??
      session.questions[0] ??
      null,
    [session.questions, selectedQuestionId]
  );

  const activeQuestionIndex = useMemo(
    () =>
      activeQuestion
        ? session.questions.findIndex((q) => q.id === activeQuestion.id)
        : -1,
    [session.questions, activeQuestion]
  );

  useEffect(() => {
    if (activeQuestion?.sourceVerification?.pageNumber) {
      setActivePageNumber(activeQuestion.sourceVerification.pageNumber);
    }
  }, [activeQuestion?.id, activeQuestion?.sourceVerification?.pageNumber]);

  const activePage = useMemo(
    () => pages.find((p) => p.pageNumber === activePageNumber) ?? pages[0] ?? null,
    [pages, activePageNumber]
  );

  const handleInsertStemSymbol = (symbol: MathToolbarSymbol) => {
    if (!activeQuestion) return;
    const el = stemRef.current;
    const currentText = activeQuestion.stem.rawSource;
    const selStart = el?.selectionStart ?? currentText.length;
    const selEnd = el?.selectionEnd ?? currentText.length;
    const inserted = insertMathSymbolAtCursor(currentText, selStart, selEnd, symbol);
    onChangeSession(
      updateImportedQuestion(session, activeQuestion.id, (prev) => ({
        ...prev,
        stem: createImmutableContentPayload(inserted.nextValue, `${prev.id}-stem`),
        updatedAt: new Date().toISOString(),
      }))
    );
    requestAnimationFrame(() => {
      if (stemRef.current) {
        stemRef.current.focus();
        stemRef.current.setSelectionRange(inserted.selectionStart, inserted.selectionEnd);
      }
    });
  };

  const handleCropPageRegion = async () => {
    if (!activeQuestion || !activePage?.previewImageDataUrl) return;
    const bbox = activeQuestion.sourceVerification?.bbox ?? {
      x: 0.05,
      y: 0.1,
      width: 0.9,
      height: 0.35,
    };
    setCropBusy(true);
    setActionMessage(null);
    try {
      const dataUrl = await cropPdfPageRegionToDataUrl(
        activePage.previewImageDataUrl,
        bbox
      );
      const next = attachVisualAssetToImportedQuestion(session, activeQuestion.id, {
        id: createId('pdfimg'),
        label: `Ảnh vùng Trang ${activePage.pageNumber} (${activeQuestion.code})`,
        sourceData: dataUrl,
        sourceLocation: `pdf/page-${activePage.pageNumber}`,
      });
      onChangeSession(next);
      setActionMessage(`Đã trích vùng trang ${activePage.pageNumber} gắn vào ${activeQuestion.code}.`);
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : 'Không thể cắt vùng hình từ trang PDF.'
      );
    } finally {
      setCropBusy(false);
    }
  };

  const handleToggleVerified = (q: MathQuestion) => {
    const currentlyVerified = Boolean(q.sourceVerification?.verifiedByTeacher);
    onChangeSession(toggleConfirmImportedQuestion(session, q.id, !currentlyVerified));
  };

  const handleMergePrev = () => {
    if (!activeQuestion || activeQuestionIndex <= 0) return;
    const prevId = session.questions[activeQuestionIndex - 1].id;
    onChangeSession(mergeImportedQuestionWithPrevious(session, activeQuestion.id));
    setSelectedQuestionId(prevId);
    setActionMessage('Đã gộp câu hiện tại vào câu liền trước.');
  };

  const handleSplit = () => {
    if (!activeQuestion) return;
    onChangeSession(splitImportedQuestionAtBreak(session, activeQuestion.id, createId));
    setActionMessage('Đã tách khối câu hỏi thành 2 câu liên tiếp.');
  };

  const handleRenumber = () => {
    onChangeSession(renumberImportedQuestions(session, 1));
    setActionMessage('Đã đánh lại mã câu tuần tự từ 01.');
  };

  const isPdf = session.detection.detectedFormat === 'pdf';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="universal-import-review-title"
      data-testid="universal-import-review-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/65 p-3 sm:p-5 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Top Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2
                id="universal-import-review-title"
                className="truncate text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Đối chiếu &amp; Xác nhận Import — {report.fileName}
              </h2>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {report.detectedFormat.toUpperCase()} · {session.detection.magicSignature}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Dữ liệu gốc được lưu tách biệt (Layer 1) · Công thức toán học chỉ được phép trộn sau khi xác minh an toàn.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {report.totalDetectedQuestions > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={applySuggestedSubject}
                  onChange={(e) => onChangeApplySuggestedSubject(e.target.checked)}
                />
                <span>
                  Môn gợi ý: <strong className="font-semibold">{report.suggestedSubject.suggestedName}</strong>
                </span>
              </label>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng màn hình đối chiếu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Document Compatibility Report Banner */}
        <section
          aria-label="Báo cáo tương thích tài liệu"
          className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 px-4 sm:px-5 py-2.5 sm:py-3 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${statusMeta.containerClass}`}
            >
              <StatusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{statusMeta.label}</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-mono-num text-slate-700 dark:text-slate-300">
              <span>
                Trang chữ: <strong>{report.textLayerPages}</strong>/{report.totalPages}
              </span>
              <span>
                Câu nhận diện: <strong>{report.totalDetectedQuestions}</strong>
              </span>
              <span className="text-emerald-700 dark:text-emerald-400">
                An toàn trộn: <strong>{report.safeToMixCount}</strong>
              </span>
              <span className={report.blockedCount > 0 ? 'text-amber-700 dark:text-amber-400' : ''}>
                Cần rà soát / Chặn: <strong>{report.blockedCount}</strong>
              </span>
              <span>
                Vùng rủi ro công thức: <strong>{report.formulaRiskCount}</strong>
              </span>
              <span>
                Ảnh / Không hỗ trợ: <strong>{report.imageCount}</strong> / <strong>{report.unsupportedObjectCount}</strong>
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowTechDetails((prev) => !prev)}
              aria-expanded={showTechDetails}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              <span>Chi tiết kỹ thuật</span>
              {showTechDetails ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>

          {report.recommendations[0] && (
            <p className="text-xs text-slate-700 dark:text-slate-300">
              {report.recommendations[0]}
            </p>
          )}

          {showTechDetails && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/60 p-3 text-[11px] font-mono text-slate-600 dark:text-slate-400 space-y-1 max-h-36 overflow-y-auto">
              {report.technicalDetails.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {report.warnings.map((w, i) => (
                <p key={`w-${i}`} className="text-amber-700 dark:text-amber-300">
                  [Cảnh báo] {w}
                </p>
              ))}
            </div>
          )}
        </section>

        {/* Main Body */}
        {session.questions.length === 0 ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-6 space-y-3 text-sm">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span>Không thể trích xuất câu hỏi tự động từ tệp này</span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {session.detection.reason}
              </p>
              {report.warnings.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  {report.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto lg:grid lg:grid-cols-12 lg:overflow-hidden">
            {/* LEFT COLUMN: Detected Structure, Verification & Math Editor */}
            <div className="shrink-0 lg:shrink lg:col-span-6 flex flex-col lg:min-h-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 lg:overflow-hidden">
              {/* Bulk Structure Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 px-4 py-2.5">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Cấu trúc câu hỏi đã tách ({session.questions.length})
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleRenumber}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                  >
                    <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Sửa số thứ tự</span>
                  </button>
                  {report.reviewRequiredQuestions > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onChangeSession(confirmAllReviewableQuestions(session));
                        setActionMessage('Đã xác nhận toàn bộ câu mức Cần đối chiếu (REVIEW).');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Xác nhận tất cả ({report.reviewRequiredQuestions})</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col lg:flex-1 lg:min-h-0 sm:grid sm:grid-cols-12 lg:overflow-hidden">
                {/* Question Index Sidebar */}
                <div className="sm:col-span-4 border-b sm:border-b-0 sm:border-r border-slate-200 dark:border-slate-800 overflow-y-auto p-2 space-y-1 max-h-44 lg:max-h-none">
                  {session.questions.map((q, idx) => {
                    const sv = q.sourceVerification;
                    const verified = !sv || sv.verifiedByTeacher || sv.verificationStatus === 'READY';
                    const isBlocked = sv?.verificationStatus === 'BLOCKED' && !sv.verifiedByTeacher;
                    const isSelected = activeQuestion?.id === q.id;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setSelectedQuestionId(q.id)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 text-[11px]">
                          <span className="font-semibold font-mono-num text-slate-900 dark:text-slate-100">
                            Câu {idx + 1} · {q.code}
                          </span>
                          <span className="text-[10px] font-mono-num text-slate-500 dark:text-slate-400">
                            {sv?.pageSpan && sv.pageSpan.length > 1
                              ? `Tr.${sv.pageSpan[0]}-${sv.pageSpan[sv.pageSpan.length - 1]}`
                              : sv?.pageNumber
                              ? `Tr.${sv.pageNumber}`
                              : ''}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-400">
                          {q.stem.rawSource || '(Trống đề bài)'}
                        </p>
                        <div className="mt-1 flex items-center justify-between text-[10px] font-medium">
                          {isBlocked ? (
                            <span className="text-red-700 dark:text-red-400">✕ Bị chặn</span>
                          ) : verified ? (
                            <span className="text-emerald-700 dark:text-emerald-400">● Đã xác nhận</span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400">▲ Cần đối chiếu</span>
                          )}
                          {!q.answerConfirmed && (
                            <span className="text-slate-500 dark:text-slate-400">Thiếu ĐA</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Selected Question Inspector & Math Editor */}
                <div className="sm:col-span-8 lg:overflow-y-auto p-3.5 space-y-3">
                  {activeQuestion && (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          Câu {activeQuestionIndex + 1} · {UNIVERSAL_QUESTION_TYPE_LABELS[activeQuestion.universalType ?? activeQuestion.type]}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={activeQuestionIndex <= 0}
                            onClick={handleMergePrev}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                          >
                            <GitMerge className="h-3 w-3" aria-hidden="true" />
                            <span>Gộp câu trước</span>
                          </button>
                          <button
                            type="button"
                            disabled={activeQuestion.stem.rawSource.split(/\r?\n/).length < 2}
                            onClick={handleSplit}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                          >
                            <Scissors className="h-3 w-3" aria-hidden="true" />
                            <span>Tách câu</span>
                          </button>
                        </div>
                      </div>

                      {actionMessage && (
                        <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                          {actionMessage}
                        </p>
                      )}

                      {/* Math Risk Warnings for active question */}
                      {activeQuestion.sourceVerification &&
                        activeQuestion.sourceVerification.reasons.length > 0 && (
                          <div className="rounded-lg border border-amber-200 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                            <p className="font-semibold">
                              Cảnh báo bảo toàn Toán học (đối chiếu với trang PDF bên phải):
                            </p>
                            <ul className="list-disc pl-4 space-y-0.5">
                              {activeQuestion.sourceVerification.reasons.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {/* Confirmation Toggle */}
                      {activeQuestion.sourceVerification && (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                          <span className="text-xs text-slate-700 dark:text-slate-200">
                            {activeQuestion.sourceVerification.verifiedByTeacher
                              ? 'Giáo viên đã xác nhận đúng với tài liệu gốc'
                              : 'Chưa xác nhận đối chiếu trang PDF gốc'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleToggleVerified(activeQuestion)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                              activeQuestion.sourceVerification.verifiedByTeacher
                                ? 'border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {activeQuestion.sourceVerification.verifiedByTeacher
                                ? 'Đã xác nhận'
                                : 'Xác nhận câu này'}
                            </span>
                          </button>
                        </div>
                      )}

                      {/* Math Toolbar + Stem Editor */}
                      <div className="space-y-1.5">
                        <label
                          htmlFor="import-review-stem"
                          className="block text-[11px] font-medium text-slate-700 dark:text-slate-300"
                        >
                          Sửa nội dung / công thức LaTeX ($...$)
                        </label>
                        <MathSymbolToolbar
                          onInsertSymbol={handleInsertStemSymbol}
                          activeFieldLabel="Đề bài câu hỏi"
                        />
                        <textarea
                          id="import-review-stem"
                          ref={stemRef}
                          rows={4}
                          value={activeQuestion.stem.rawSource}
                          onChange={(e) =>
                            onChangeSession(
                              updateImportedQuestion(session, activeQuestion.id, (prev) => ({
                                ...prev,
                                stem: createImmutableContentPayload(
                                  e.target.value,
                                  `${prev.id}-stem`
                                ),
                                updatedAt: new Date().toISOString(),
                              }))
                            )
                          }
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      {/* Live KaTeX Preview */}
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-2.5 space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Xem trước toán học (KaTeX)
                        </div>
                        <div className="text-xs text-slate-900 dark:text-slate-100">
                          <MathContentRenderer payload={activeQuestion.stem} />
                        </div>
                      </div>

                      {/* Options A/B/C/D Quick Check */}
                      {activeQuestion.options && activeQuestion.options.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                            Phương án trả lời (chọn đáp án đúng)
                          </div>
                          <div className="grid grid-cols-1 gap-1.5">
                            {activeQuestion.options.map((opt) => (
                              <label
                                key={opt.id}
                                className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer ${
                                  opt.isCorrect
                                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/30'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`review-ans-${activeQuestion.id}`}
                                  checked={opt.isCorrect}
                                  onChange={() =>
                                    onChangeSession(
                                      updateImportedQuestion(session, activeQuestion.id, (prev) => ({
                                        ...prev,
                                        correctOptionId: opt.id,
                                        answerConfirmed: true,
                                        options: prev.options?.map((o) => ({
                                          ...o,
                                          isCorrect: o.id === opt.id,
                                        })),
                                      }))
                                    )
                                  }
                                  className="mt-0.5"
                                />
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  {opt.originalLabel}.
                                </span>
                                <span className="flex-1 text-slate-800 dark:text-slate-200">
                                  <MathContentRenderer payload={opt.content} />
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Visual Assets attached */}
                      {(activeQuestion.visualAssets?.length ?? 0) > 0 && (
                        <div className="space-y-2">
                          {activeQuestion.visualAssets?.map((asset) => (
                            <MathVisualAssetRenderer key={asset.id} asset={asset} compact />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Original PDF Page Preview + BBox Highlight */}
            <div className="shrink-0 lg:shrink lg:col-span-6 flex flex-col lg:min-h-0 bg-slate-100/70 dark:bg-slate-950/60 lg:overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <span>{isPdf ? 'Trang PDF gốc đối chiếu' : 'Dữ liệu nguồn gốc (Layer 1)'}</span>
                  {activePage && (
                    <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                      · {activePage.columnCount === 2 ? 'Bố cục 2 cột' : 'Bố cục 1 cột'} ·{' '}
                      {activePage.hasTextLayer ? 'Có lớp chữ' : 'Ảnh scan'}
                    </span>
                  )}
                </div>

                {pages.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={activePageNumber <= 1}
                      onClick={() => setActivePageNumber((p) => Math.max(1, p - 1))}
                      aria-label="Trang PDF trước"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <span className="px-1.5 text-xs font-mono-num text-slate-700 dark:text-slate-200">
                      Trang {activePageNumber}/{pages.length}
                    </span>
                    <button
                      type="button"
                      disabled={activePageNumber >= pages.length}
                      onClick={() =>
                        setActivePageNumber((p) => Math.min(pages.length, p + 1))
                      }
                      aria-label="Trang PDF tiếp theo"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>

                    {activePage?.previewImageDataUrl && activeQuestion && (
                      <button
                        type="button"
                        disabled={cropBusy}
                        onClick={() => void handleCropPageRegion()}
                        className="ml-1 inline-flex items-center gap-1 rounded-md border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/60 whitespace-nowrap"
                      >
                        <Crop className="h-3 w-3" aria-hidden="true" />
                        <span>{cropBusy ? 'Đang cắt...' : 'Gắn ảnh vùng câu'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="lg:flex-1 lg:overflow-y-auto p-4 space-y-3">
                {activePage?.previewImageDataUrl ? (
                  <div className="relative mx-auto max-w-full overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 bg-white shadow-sm">
                    <img
                      src={activePage.previewImageDataUrl}
                      alt={`Trang PDF ${activePage.pageNumber}`}
                      className="block w-full h-auto select-none"
                    />
                    {/* Risk Region Overlays */}
                    {activePage.riskRegions.map((reg) => (
                      <div
                        key={reg.id}
                        title={reg.message}
                        style={{
                          left: `${reg.bbox.x * 100}%`,
                          top: `${reg.bbox.y * 100}%`,
                          width: `${reg.bbox.width * 100}%`,
                          height: `${reg.bbox.height * 100}%`,
                        }}
                        className={`pointer-events-none absolute rounded-sm border border-dashed ${
                          reg.severity === 'blocked'
                            ? 'border-red-500 bg-red-500/15'
                            : 'border-amber-500 bg-amber-400/15'
                        }`}
                      />
                    ))}
                    {/* Active Question Bounding Box */}
                    {activeQuestion?.sourceVerification?.bbox &&
                      activeQuestion.sourceVerification.pageNumber === activePage.pageNumber &&
                      (() => {
                        const b = activeQuestion.sourceVerification.bbox;
                        const left = Math.max(0, b.x - 0.012);
                        const top = Math.max(0, b.y - 0.008);
                        const right = Math.min(1, b.x + b.width + 0.012);
                        const bottom = Math.min(1, b.y + b.height + 0.008);
                        return (
                          <div
                            style={{
                              left: `${left * 100}%`,
                              top: `${top * 100}%`,
                              width: `${Math.max(0, right - left) * 100}%`,
                              height: `${Math.max(0, bottom - top) * 100}%`,
                            }}
                            className="pointer-events-none absolute rounded border-2 border-blue-600 bg-blue-500/10"
                          />
                        );
                      })()}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Văn bản trích xuất theo đúng thứ tự cột · Trang {activePage?.pageNumber ?? 1}
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                      {activePage?.reconstructedText ||
                        activeQuestion?.sourceVerification?.extractedRawText ||
                        session.originalSource.rawText ||
                        'Không có văn bản thô để hiển thị.'}
                    </pre>
                  </div>
                )}

                {activePage?.previewImageDataUrl && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setShowRawLayerText((prev) => !prev)}
                      className="flex w-full items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      <span>Xem văn bản trích xuất thô Trang {activePage.pageNumber}</span>
                      {showRawLayerText ? (
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                    {showRawLayerText && (
                      <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        {activePage.reconstructedText || '(Trang không có lớp văn bản)'}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 px-5 py-3">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {report.blockedCount > 0 ? (
              <span>
                Lưu ý: còn <strong className="text-amber-700 dark:text-amber-300">{report.blockedCount} câu</strong> sẽ bị khóa trộn ở Bước 3 cho đến khi bạn xác nhận đối chiếu xong.
              </span>
            ) : report.totalDetectedQuestions > 0 ? (
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                Toàn bộ {report.totalDetectedQuestions} câu hỏi đã sẵn sàng đưa vào trộn đề.
              </span>
            ) : (
              <span>Chọn tệp khác hoặc quay lại trình soạn thảo.</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-[10px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={!session.canCommitToProject}
              onClick={() => onCommit(false)}
              className="inline-flex items-center rounded-[10px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 whitespace-nowrap"
            >
              Thêm {session.questions.length} câu vào cuối đề
            </button>
            <button
              type="button"
              disabled={!session.canCommitToProject}
              onClick={() => onCommit(true)}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-45 whitespace-nowrap"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Thay thế đề bằng {session.questions.length} câu</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

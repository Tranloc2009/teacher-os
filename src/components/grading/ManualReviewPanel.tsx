import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  History,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  OMR_CHOICES,
  type ExamCodeAnswerKey,
  type GradedSheetRecord,
  type GradingSession,
  type OmrBubbleChoice,
} from '../../types/grading';
import { getEvidenceBlob } from '../../db/database';
import { getSheetStatusLabelVi } from '../../core/grading/gradingExporter';

interface ManualReviewPanelProps {
  session: GradingSession;
  answerKeysByCode: Record<string, ExamCodeAnswerKey>;
  selectedSheetId: string | null;
  onSelectSheet: (sheetId: string) => void;
  onOverrideQuestion: (
    sheetId: string,
    questionNumber: number,
    value: OmrBubbleChoice | null,
    reason?: string
  ) => void;
  onUpdateSheetMeta: (
    sheetId: string,
    patch: {
      manualExamCode?: string;
      manualStudentId?: string;
      manualViewRotationDeg?: 0 | 90 | 180 | 270;
      confirmedByTeacher?: boolean;
      notes?: string;
    }
  ) => void;
}

export function ManualReviewPanel({
  session,
  answerKeysByCode,
  selectedSheetId,
  onSelectSheet,
  onOverrideQuestion,
  onUpdateSheetMeta,
}: ManualReviewPanelProps) {
  const [onlyReviewNeeded, setOnlyReviewNeeded] = useState(false);
  const [viewMode, setViewMode] = useState<'annotated' | 'original'>('annotated');
  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);

  const visibleSheets = useMemo(() => {
    if (!onlyReviewNeeded) return session.sheets;
    return session.sheets.filter(
      (s) => s.status === 'review-required' || s.status === 'error'
    );
  }, [onlyReviewNeeded, session.sheets]);

  const activeSheet: GradedSheetRecord | null = useMemo(() => {
    if (selectedSheetId) {
      const found = session.sheets.find((s) => s.id === selectedSheetId);
      if (found) return found;
    }
    return visibleSheets[0] ?? session.sheets[0] ?? null;
  }, [selectedSheetId, session.sheets, visibleSheets]);

  // Tải ảnh nhị phân theo nhu cầu từ IndexedDB và thu hồi ObjectURL sạch sẽ khi chuyển phiếu
  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    async function loadBlob() {
      if (!activeSheet) {
        setImageUrl(null);
        return;
      }
      setLoadingImage(true);
      try {
        const targetBlobId =
          viewMode === 'annotated' && activeSheet.annotatedBlobId
            ? activeSheet.annotatedBlobId
            : activeSheet.originalBlobId;
        const rec = await getEvidenceBlob(targetBlobId);
        if (!active) return;
        if (rec?.blob) {
          createdUrl = URL.createObjectURL(rec.blob);
          setImageUrl(createdUrl);
        } else {
          setImageUrl(activeSheet.thumbnailDataUrl ?? null);
        }
      } catch {
        if (active) setImageUrl(activeSheet.thumbnailDataUrl ?? null);
      } finally {
        if (active) setLoadingImage(false);
      }
    }

    void loadBlob();

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [
    activeSheet?.id,
    activeSheet?.annotatedBlobId,
    activeSheet?.originalBlobId,
    activeSheet?.updatedAt,
    viewMode,
  ]);

  if (session.sheets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center space-y-2">
        <Eye className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-700" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Chưa có bài làm nào để duyệt
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Hãy tải ảnh phiếu trả lời ở bước &ldquo;Tải ảnh &amp; Chấm OMR&rdquo; trước khi vào trung tâm duyệt.
        </p>
      </div>
    );
  }

  const activeKey = activeSheet?.examCode
    ? answerKeysByCode[activeSheet.examCode]
    : undefined;
  const canConfirm = Boolean(
    activeSheet &&
      activeSheet.alignment.aligned &&
      activeKey?.valid &&
      activeSheet.studentMatch.matched &&
      activeSheet.uncertainCount === 0
  );

  const auditEntries = activeSheet
    ? activeSheet.questions.flatMap((q) => q.overrideHistory)
    : [];

  return (
    <div className="space-y-4">
      {/* Compact Sheet Strip Selector */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto max-w-full">
          {visibleSheets.map((s) => {
            const isSelected = activeSheet?.id === s.id;
            const statusColor =
              s.status === 'confirmed'
                ? 'text-emerald-700 dark:text-emerald-400'
                : s.status === 'review-required'
                ? 'text-amber-700 dark:text-amber-400'
                : s.status === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-indigo-700 dark:text-indigo-400';

            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSheet(s.id)}
                className={`shrink-0 rounded-xl border px-3 py-1.5 text-left text-xs transition-colors ${
                  isSelected
                    ? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-100'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="font-semibold font-mono-num">
                  {s.studentId || s.fileName.slice(0, 14)} · {s.finalScore}đ
                </div>
                <div className={`text-[10.5px] ${statusColor}`}>
                  Mã {s.examCode || '—'} · {getSheetStatusLabelVi(s.status)}
                </div>
              </button>
            );
          })}
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyReviewNeeded}
            onChange={(e) => setOnlyReviewNeeded(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
          />
          <span>Chỉ hiện bài cần duyệt</span>
        </label>
      </div>

      {/* 2-Column Manual Review Workspace */}
      {activeSheet && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: Sheet Image Viewer + Controls */}
          <div className="xl:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('annotated')}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                    viewMode === 'annotated'
                      ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Ảnh minh chứng
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('original')}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                    viewMode === 'original'
                      ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Ảnh gốc
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Thu nhỏ ảnh"
                  onClick={() => setZoomPercent((z) => Math.max(60, z - 20))}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="w-11 text-center font-mono-num text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {zoomPercent}%
                </span>
                <button
                  type="button"
                  aria-label="Phóng to ảnh"
                  onClick={() => setZoomPercent((z) => Math.min(240, z + 20))}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Xoay ảnh 90 độ"
                  title="Xoay khung xem 90°"
                  onClick={() =>
                    onUpdateSheetMeta(activeSheet.id, {
                      manualViewRotationDeg: (((activeSheet.manualViewRotationDeg + 90) %
                        360) as 0 | 90 | 180 | 270),
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Xoay</span>
                </button>
              </div>
            </div>

            {/* Alignment Diagnostics Strip */}
            <div className="px-4 py-2 bg-slate-50/80 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800 text-[11px] font-mono-num text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Căn chỉnh 4 góc:{' '}
                <strong
                  className={
                    activeSheet.alignment.aligned
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                >
                  {activeSheet.alignment.aligned ? 'Khớp' : 'Thất bại'}
                </strong>
              </span>
              <span>·</span>
              <span>Độ nét: {activeSheet.alignment.sharpnessScore}</span>
              <span>·</span>
              <span>Xoay tự động: {activeSheet.alignment.detectedRotationDeg}°</span>
              <span>·</span>
              <span>
                Mã 2D:{' '}
                {activeSheet.alignment.opticalCodeStatus === 'decoded'
                  ? 'Đã giải mã'
                  : activeSheet.alignment.opticalCodeStatus === 'corrupted'
                  ? 'Lỗi kiểm tra CRC'
                  : activeSheet.alignment.opticalCodeStatus === 'absent'
                  ? 'Không nhúng'
                  : 'Không đọc được'}
              </span>
            </div>

            {/* Scrollable Image Canvas */}
            <div className="h-[580px] overflow-auto bg-slate-100/90 dark:bg-slate-950 p-4 flex items-start justify-center">
              {loadingImage ? (
                <div className="my-auto text-xs text-slate-500">
                  Đang tải ảnh phiếu từ bộ nhớ cục bộ...
                </div>
              ) : imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`Phiếu bài làm ${activeSheet.fileName}`}
                  style={{
                    width: `${zoomPercent}%`,
                    transform:
                      activeSheet.manualViewRotationDeg !== 0
                        ? `rotate(${activeSheet.manualViewRotationDeg}deg)`
                        : undefined,
                  }}
                  className="max-w-none rounded-lg border border-slate-300 dark:border-slate-700 bg-white shadow-xs transition-transform"
                />
              ) : (
                <div className="my-auto text-xs text-slate-500">
                  Không tìm thấy dữ liệu ảnh trong IndexedDB.
                </div>
              )}
            </div>

            {activeSheet.alignment.warnings.length > 0 && (
              <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-amber-50/60 dark:bg-amber-950/25 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                {activeSheet.alignment.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Metadata Assignment + Per-Question Override Table */}
          <div className="xl:col-span-6 space-y-4">
            {/* Metadata & Confirmation Header */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 font-mono-num">
                    {activeSheet.fileName}
                  </div>
                  <div className="mt-0.5 text-lg font-bold text-slate-950 dark:text-white font-mono-num tabular-nums">
                    {activeSheet.finalScore} / {activeSheet.maxScore} điểm
                  </div>
                  <div className="text-[11.5px] text-slate-600 dark:text-slate-400">
                    {activeSheet.scoreFormulaText}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() =>
                    onUpdateSheetMeta(activeSheet.id, {
                      confirmedByTeacher: !activeSheet.confirmedByTeacher,
                    })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
                    activeSheet.confirmedByTeacher
                      ? 'border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-45 disabled:cursor-not-allowed'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {activeSheet.confirmedByTeacher
                      ? 'Đã xác nhận bài chấm'
                      : 'Xác nhận bài chấm'}
                  </span>
                </button>
              </div>

              {/* Manual Assignment Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label
                    htmlFor="review-student-select"
                    className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Học sinh (theo Mã học sinh)
                  </label>
                  <select
                    id="review-student-select"
                    value={activeSheet.studentId}
                    onChange={(e) =>
                      onUpdateSheetMeta(activeSheet.id, {
                        manualStudentId: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">-- Chọn học sinh từ danh sách lớp --</option>
                    {session.students.map((st) => (
                      <option key={st.studentId} value={st.studentId}>
                        {st.studentId} — {st.fullName} ({st.className})
                      </option>
                    ))}
                  </select>
                  {activeSheet.studentMatch.warning && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      {activeSheet.studentMatch.warning}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="review-code-select"
                    className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Mã đề (đối chiếu đáp án đã trộn)
                  </label>
                  <select
                    id="review-code-select"
                    value={activeSheet.examCode}
                    onChange={(e) =>
                      onUpdateSheetMeta(activeSheet.id, {
                        manualExamCode: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">-- Chọn mã đề --</option>
                    {session.selectedExamCodes.map((code) => (
                      <option key={code} value={code}>
                        Mã đề {code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {activeSheet.duplicateStudentWarning && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  {activeSheet.duplicateStudentWarning}
                </div>
              )}

              {!canConfirm && !activeSheet.confirmedByTeacher && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Để bật nút &ldquo;Xác nhận bài chấm&rdquo;, hãy đảm bảo đã gán đúng học sinh, chọn mã đề hợp lệ và xử lý hết các câu đánh dấu &ldquo;Cần kiểm tra&rdquo;.
                </div>
              )}
            </div>

            {/* Question-by-Question Review & Override Table */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Chi tiết từng câu · Đúng{' '}
                  <span className="font-mono-num text-emerald-700 dark:text-emerald-400">
                    {activeSheet.correctCount}
                  </span>{' '}
                  · Sai{' '}
                  <span className="font-mono-num text-red-600 dark:text-red-400">
                    {activeSheet.wrongCount}
                  </span>{' '}
                  · Trống{' '}
                  <span className="font-mono-num text-slate-600 dark:text-slate-400">
                    {activeSheet.blankCount}
                  </span>
                  {activeSheet.uncertainCount > 0 && (
                    <>
                      {' '}
                      · Cần duyệt{' '}
                      <span className="font-mono-num text-amber-700 dark:text-amber-400">
                        {activeSheet.uncertainCount}
                      </span>
                    </>
                  )}
                </div>

                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Lý do chỉnh sửa (tùy chọn)..."
                  className="w-52 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-800 dark:text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="max-h-[430px] overflow-y-auto pb-16">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2 font-semibold w-12">Câu</th>
                      <th className="px-3 py-2 font-semibold w-24">OMR gốc</th>
                      <th className="px-3 py-2 font-semibold w-16">Đáp án</th>
                      <th className="px-3 py-2 font-semibold">Sửa nhanh / Chốt</th>
                      <th className="px-3 py-2 font-semibold w-16 text-right">Điểm</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeSheet.questions.map((q) => {
                      const rowBg = q.needsReview
                        ? 'bg-amber-50/60 dark:bg-amber-950/20'
                        : q.manuallyOverridden
                        ? 'bg-indigo-50/40 dark:bg-indigo-950/20'
                        : '';
                      return (
                        <tr key={q.questionNumber} className={rowBg}>
                          <td className="px-3 py-2 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                            {String(q.questionNumber).padStart(2, '0')}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                              {q.recognizedChoice ??
                                (q.recognizedStatus === 'multiple'
                                  ? 'Nhiều ô'
                                  : q.recognizedStatus === 'uncertain'
                                  ? 'Mờ / Chưa rõ'
                                  : q.recognizedStatus === 'unreadable'
                                  ? 'Lỗi đọc'
                                  : 'Trống')}
                            </div>
                            <div className="text-[10px] font-mono-num text-slate-400">
                              Tin cậy {Math.round(q.confidence * 100)}%
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono-num font-bold text-indigo-700 dark:text-indigo-400">
                            {q.correctChoice ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            {!q.autoGradable ? (
                              <span className="text-[11px] text-slate-500">
                                Không chấm OMR
                              </span>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1">
                                  {OMR_CHOICES.map((opt) => {
                                    const isActive = q.effectiveChoice === opt;
                                    const isRight = q.correctChoice === opt;
                                    return (
                                      <button
                                        key={opt}
                                        type="button"
                                        aria-label={`Câu ${q.questionNumber} chọn ${opt}`}
                                        onClick={() =>
                                          onOverrideQuestion(
                                            activeSheet.id,
                                            q.questionNumber,
                                            opt,
                                            overrideReason
                                          )
                                        }
                                        className={`h-6 w-7 rounded-md font-mono-num text-[11px] font-bold border transition-colors ${
                                          isActive
                                            ? isRight
                                              ? 'border-emerald-600 bg-emerald-600 text-white'
                                              : 'border-red-600 bg-red-600 text-white'
                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-400'
                                        }`}
                                      >
                                        {opt}
                                      </button>
                                    );
                                  })}
                                  <button
                                    type="button"
                                    aria-label={`Câu ${q.questionNumber} để trống`}
                                    onClick={() =>
                                      onOverrideQuestion(
                                        activeSheet.id,
                                        q.questionNumber,
                                        null,
                                        overrideReason
                                      )
                                    }
                                    className={`h-6 px-2 rounded-md text-[10.5px] font-semibold border transition-colors ${
                                      q.effectiveChoice === null && !q.needsReview
                                        ? 'border-slate-600 bg-slate-600 text-white'
                                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-400'
                                    }`}
                                  >
                                    Trống
                                  </button>
                                </div>
                                {q.reviewReasons.length > 0 && (
                                  <div className="text-[10.5px] text-amber-800 dark:text-amber-300">
                                    {q.reviewReasons[0]}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                            {q.pointsEarned.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Manual Override Audit Trail */}
            {auditEntries.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <History className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                  <span>Nhật ký chỉnh sửa thủ công ({auditEntries.length})</span>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-[11.5px]">
                  {auditEntries.map((entry, idx) => (
                    <li key={idx} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                      <span>
                        <strong className="font-mono-num">Câu {entry.questionNumber}</strong>: OMR gốc{' '}
                        <span className="font-mono-num">
                          (
                          {entry.originalRecognized ??
                            (entry.originalStatus === 'multiple'
                              ? 'Nhiều ô'
                              : entry.originalStatus === 'uncertain'
                              ? 'Mờ / Chưa rõ'
                              : entry.originalStatus === 'unreadable'
                              ? 'Lỗi đọc'
                              : 'Trống')}
                          )
                        </span>{' '}
                        → chốt{' '}
                        <strong className="font-mono-num text-indigo-700 dark:text-indigo-400">
                          {entry.confirmedValue ?? 'Trống'}
                        </strong>
                        {entry.reason ? ` · "${entry.reason}"` : ''}
                      </span>
                      <span className="font-mono-num text-[10.5px] text-slate-400">
                        {new Date(entry.editedAt).toLocaleTimeString('vi-VN')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

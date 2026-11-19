import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  SlidersHorizontal,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import type {
  ExamCodeAnswerKey,
  GradedSheetRecord,
  GradingSession,
  OmrThresholdsConfig,
} from '../../types/grading';
import {
  decodeImageBlobForOmr,
  renderAnnotatedEvidencePngBlob,
  validateUploadedImageFile,
} from '../../core/grading/omrBrowserBridge';
import { runLocalOmrVisionPipeline } from '../../core/grading/omrVisionEngine';
import {
  annotateDuplicateStudentWarnings,
  gradeRecognizedSheet,
} from '../../core/grading/gradingEngine';
import { createId, saveEvidenceBlob } from '../../db/database';

interface OmrBatchUploadPanelProps {
  session: GradingSession;
  answerKeysByCode: Record<string, ExamCodeAnswerKey>;
  onBatchCompleted: (newSheets: GradedSheetRecord[]) => void;
  onUpdateThresholds: (next: OmrThresholdsConfig) => void;
  onNotify: (tone: 'success' | 'info' | 'error', message: string) => void;
}

export function OmrBatchUploadPanel({
  session,
  answerKeysByCode,
  onBatchCompleted,
  onUpdateThresholds,
  onNotify,
}: OmrBatchUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [fallbackExamCode, setFallbackExamCode] = useState<string>(
    session.selectedExamCodes[0] ?? ''
  );
  const [showThresholds, setShowThresholds] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [lastBatchSummary, setLastBatchSummary] = useState<{
    processed: number;
    autoGraded: number;
    reviewRequired: number;
    errors: number;
  } | null>(null);

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const validFiles: File[] = [];
    const validationErrors: string[] = [];

    for (const f of files) {
      const check = validateUploadedImageFile(f);
      if (check.valid) validFiles.push(f);
      else if (check.error) validationErrors.push(check.error);
    }

    setBatchErrors(validationErrors);
    if (validFiles.length === 0) {
      onNotify('error', validationErrors[0] ?? 'Không có tệp ảnh hợp lệ để chấm.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setProcessing(true);
    setProgressCurrent(0);
    setProgressTotal(validFiles.length);
    setLastBatchSummary(null);

    const createdSheets: GradedSheetRecord[] = [];
    const runtimeErrors = [...validationErrors];

    try {
      for (let i = 0; i < validFiles.length; i += 1) {
        if (controller.signal.aborted) {
          runtimeErrors.push(
            `Đã hủy lô chấm tại bài ${i + 1}/${validFiles.length}. Các bài đã xử lý trước đó vẫn được lưu.`
          );
          break;
        }

        const file = validFiles[i];
        setCurrentFileName(file.name);
        setProgressCurrent(i + 1);

        // Nhường main thread mỗi phiếu để UI không bao giờ bị đóng băng khi chấm 30-100 bài
        await new Promise((r) => window.setTimeout(r, 12));

        try {
          const sheetId = createId('sheet');
          const origBlobId = createId('ev-orig');
          const annotBlobId = createId('ev-annot');

          // Lưu ảnh gốc nguyên bản vào IndexedDB (tuyệt đối không chỉnh sửa)
          await saveEvidenceBlob({
            id: origBlobId,
            sessionId: session.id,
            sheetId,
            kind: 'original',
            mimeType: file.type || 'image/jpeg',
            byteSize: file.size,
            blob: file,
            updatedAt: new Date().toISOString(),
          });

          const decoded = await decodeImageBlobForOmr(file);
          const recognition = runLocalOmrVisionPipeline(
            decoded.rgba,
            session.omrQuestionCount,
            session.omrThresholds
          );

          const graded = gradeRecognizedSheet({
            sheetId,
            sessionId: session.id,
            fileName: file.name,
            originalBlobId: origBlobId,
            thumbnailDataUrl: decoded.thumbnailDataUrl,
            recognition,
            answerKeysByCode,
            students: session.students,
            gradingRule: session.gradingRule,
            fallbackExamCode: fallbackExamCode || undefined,
          });

          // Kết xuất ảnh minh chứng riêng (annotated.png) vào IndexedDB
          try {
            const annotatedBlob = await renderAnnotatedEvidencePngBlob(
              file,
              graded,
              session.omrQuestionCount
            );
            await saveEvidenceBlob({
              id: annotBlobId,
              sessionId: session.id,
              sheetId,
              kind: 'annotated',
              mimeType: 'image/png',
              byteSize: annotatedBlob.size,
              blob: annotatedBlob,
              updatedAt: new Date().toISOString(),
            });
            graded.annotatedBlobId = annotBlobId;
          } catch {
            // Không chặn toàn bộ bài nếu chỉ bước vẽ ảnh chú thích gặp lỗi
          }

          createdSheets.push(graded);
        } catch (err) {
          runtimeErrors.push(
            `${file.name}: ${
              err instanceof Error ? err.message : 'Lỗi không xác định khi đọc ảnh.'
            }`
          );
        }
      }

      if (createdSheets.length > 0) {
        const annotated = annotateDuplicateStudentWarnings([
          ...session.sheets,
          ...createdSheets,
        ]);
        const newOnly = annotated.slice(session.sheets.length);
        onBatchCompleted(newOnly);

        const autoGraded = newOnly.filter((s) => s.status === 'auto-graded').length;
        const reviewRequired = newOnly.filter(
          (s) => s.status === 'review-required'
        ).length;
        const errCount = newOnly.filter((s) => s.status === 'error').length;
        setLastBatchSummary({
          processed: newOnly.length,
          autoGraded,
          reviewRequired,
          errors: errCount,
        });

        onNotify(
          'success',
          `Đã nhận diện ${newOnly.length} phiếu cục bộ (${autoGraded} đạt chấm tự động, ${reviewRequired} cần duyệt thủ công, ${errCount} lỗi).`
        );
      }

      setBatchErrors(runtimeErrors);
    } finally {
      abortRef.current = null;
      setProcessing(false);
      setCurrentFileName('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Main Upload Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-950 dark:text-slate-50 flex items-center gap-2">
              <Camera className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              <span>Tải ảnh phiếu bài làm &amp; Nhận diện OMR cục bộ</span>
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              100% xử lý trực tiếp trên trình duyệt bằng Computer Vision cục bộ (căn chỉnh 4 góc, khử nghiêng phối cảnh, đọc mã phiếu và ô tô A/B/C/D). Không gửi ảnh ra ngoài.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowThresholds((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Ngưỡng OMR</span>
          </button>
        </div>

        {/* Fallback Exam Code selector */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label
            htmlFor="batch-fallback-code"
            className="font-semibold text-slate-700 dark:text-slate-300"
          >
            Mã đề dự phòng (khi phiếu không có mã 2D):
          </label>
          <select
            id="batch-fallback-code"
            value={fallbackExamCode}
            onChange={(e) => setFallbackExamCode(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Chỉ dùng mã đọc từ phiếu</option>
            {session.selectedExamCodes.map((code) => (
              <option key={code} value={code}>
                Mã đề {code}
              </option>
            ))}
          </select>
        </div>

        {/* Optional Threshold Tuning */}
        {showThresholds && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 text-xs">
            <label className="space-y-1">
              <div className="flex justify-between font-medium text-slate-700 dark:text-slate-300">
                <span>Ngưỡng tô đậm</span>
                <span className="font-mono-num">
                  {Math.round(session.omrThresholds.filledThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.28}
                max={0.65}
                step={0.02}
                value={session.omrThresholds.filledThreshold}
                onChange={(e) =>
                  onUpdateThresholds({
                    ...session.omrThresholds,
                    filledThreshold: Number(e.target.value),
                  })
                }
                className="w-full accent-indigo-600"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between font-medium text-slate-700 dark:text-slate-300">
                <span>Ngưỡng bỏ trống</span>
                <span className="font-mono-num">
                  {Math.round(session.omrThresholds.blankMaxThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.08}
                max={0.26}
                step={0.02}
                value={session.omrThresholds.blankMaxThreshold}
                onChange={(e) =>
                  onUpdateThresholds({
                    ...session.omrThresholds,
                    blankMaxThreshold: Number(e.target.value),
                  })
                }
                className="w-full accent-indigo-600"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between font-medium text-slate-700 dark:text-slate-300">
                <span>Chênh lệch tối thiểu</span>
                <span className="font-mono-num">
                  {Math.round(session.omrThresholds.minMarginToSecond * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.08}
                max={0.32}
                step={0.02}
                value={session.omrThresholds.minMarginToSecond}
                onChange={(e) =>
                  onUpdateThresholds({
                    ...session.omrThresholds,
                    minMarginToSecond: Number(e.target.value),
                  })
                }
                className="w-full accent-indigo-600"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between font-medium text-slate-700 dark:text-slate-300">
                <span>Độ sắc nét tối thiểu</span>
                <span className="font-mono-num">
                  {session.omrThresholds.minSharpnessScore}
                </span>
              </div>
              <input
                type="range"
                min={8}
                max={35}
                step={1}
                value={session.omrThresholds.minSharpnessScore}
                onChange={(e) =>
                  onUpdateThresholds({
                    ...session.omrThresholds,
                    minSharpnessScore: Number(e.target.value),
                  })
                }
                className="w-full accent-indigo-600"
              />
            </label>
          </div>
        )}

        {/* Drag & Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!processing) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (!processing && e.dataTransfer.files.length > 0) {
              void handleFiles(e.dataTransfer.files);
            }
          }}
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
              : 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/bmp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />

          <UploadCloud
            className="mx-auto h-9 w-9 text-indigo-500 dark:text-indigo-400"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Kéo thả ảnh phiếu trả lời (JPG, PNG, WEBP) vào đây
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Hỗ trợ tải hàng loạt 30–100 bài. Các ô tô mờ, tô trùng hoặc ảnh mất nét sẽ tự động đưa sang Hàng đợi duyệt thủ công.
          </p>

          <div className="mt-4">
            <button
              type="button"
              disabled={processing}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
            >
              <UploadCloud className="h-4 w-4" aria-hidden="true" />
              <span>Chọn ảnh từ máy tính / điện thoại</span>
            </button>
          </div>
        </div>

        {/* Real Progress Bar + Cancel */}
        {processing && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/40 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-indigo-950 dark:text-indigo-100 truncate">
                Đang xử lý bài {progressCurrent}/{progressTotal}: {currentFileName}
              </span>
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0"
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Hủy lô</span>
              </button>
            </div>
            <div className="h-2 w-full rounded-full bg-indigo-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-150"
                style={{
                  width: `${Math.round(
                    (progressCurrent / Math.max(1, progressTotal)) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Batch Result Summary */}
        {lastBatchSummary && !processing && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>
                Đã xử lý {lastBatchSummary.processed} phiếu ·{' '}
                {lastBatchSummary.autoGraded} tự động rõ ràng ·{' '}
                {lastBatchSummary.reviewRequired} cần kiểm tra thủ công ·{' '}
                {lastBatchSummary.errors} lỗi căn chỉnh/mã đề
              </span>
            </div>
          </div>
        )}

        {batchErrors.length > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Cảnh báo tệp tải lên</span>
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {batchErrors.slice(0, 8).map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

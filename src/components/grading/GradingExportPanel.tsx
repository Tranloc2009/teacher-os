import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FileSpreadsheet,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { ExamCodeAnswerKey, GradingSession } from '../../types/grading';
import {
  buildGradebookXlsxBuffer,
  buildGradingArchiveZip,
} from '../../core/grading/gradingExporter';
import {
  renderAnnotatedEvidencePngBlob,
  triggerBlobDownload,
} from '../../core/grading/omrBrowserBridge';
import { getEvidenceBlob } from '../../db/database';

interface GradingExportPanelProps {
  session: GradingSession;
  answerKeysByCode: Record<string, ExamCodeAnswerKey>;
  onNotify: (tone: 'success' | 'info' | 'error', message: string) => void;
}

export function GradingExportPanel({
  session,
  answerKeysByCode,
  onNotify,
}: GradingExportPanelProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [zipStatusText, setZipStatusText] = useState('');

  const total = session.sheets.length;
  const confirmedCount = session.sheets.filter((s) => s.confirmedByTeacher).length;
  const unconfirmedCount = total - confirmedCount;
  const reviewOrErrorCount = session.sheets.filter(
    (s) => s.status === 'review-required' || s.status === 'error'
  ).length;

  const handleDownloadXlsx = async () => {
    if (total === 0) {
      onNotify('error', 'Chưa có bài chấm nào để xuất bảng điểm Excel.');
      return;
    }
    setExportingXlsx(true);
    try {
      const bytes = await buildGradebookXlsxBuffer(session);
      const safeBytes = new Uint8Array(bytes.byteLength);
      safeBytes.set(bytes);
      const blob = new Blob([safeBytes.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      triggerBlobDownload(blob, 'Bang_diem.xlsx');
      onNotify('success', `Đã xuất Bang_diem.xlsx (${total} học sinh).`);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể tạo tệp Excel bảng điểm.'
      );
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleDownloadZip = async () => {
    if (total === 0) {
      onNotify('error', 'Chưa có bài chấm nào để đóng gói ZIP minh chứng.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setExportingZip(true);
    setZipProgress(2);
    setZipStatusText('Đang chuẩn bị dữ liệu minh chứng cục bộ...');

    try {
      const archiveBytes = await buildGradingArchiveZip({
        session,
        answerKeysByCode,
        signal: controller.signal,
        onProgress: (pct, label) => {
          setZipProgress(pct);
          setZipStatusText(label);
        },
        evidenceProvider: {
          getOriginalBytes: async (sheet) => {
            const rec = await getEvidenceBlob(sheet.originalBlobId);
            if (!rec?.blob) return null;
            return new Uint8Array(await rec.blob.arrayBuffer());
          },
          getAnnotatedBytes: async (sheet) => {
            if (sheet.annotatedBlobId) {
              const rec = await getEvidenceBlob(sheet.annotatedBlobId);
              if (rec?.blob) {
                return new Uint8Array(await rec.blob.arrayBuffer());
              }
            }
            // Nếu chưa có annotated blob (ví dụ sau chỉnh tay), dựng lại ngay từ ảnh gốc
            const origRec = await getEvidenceBlob(sheet.originalBlobId);
            if (!origRec?.blob) return null;
            const freshPng = await renderAnnotatedEvidencePngBlob(
              origRec.blob,
              sheet,
              session.omrQuestionCount
            );
            return new Uint8Array(await freshPng.arrayBuffer());
          },
        },
      });

      const safeZip = new Uint8Array(archiveBytes.byteLength);
      safeZip.set(archiveBytes);
      const blob = new Blob([safeZip.buffer], { type: 'application/zip' });
      triggerBlobDownload(blob, 'TeacherOS_Grading_Archive.zip');
      onNotify(
        'success',
        `Đã đóng gói thành công TeacherOS_Grading_Archive.zip (${total} bài minh chứng).`
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        onNotify('info', 'Đã hủy quá trình đóng gói ZIP minh chứng.');
      } else {
        onNotify(
          'error',
          err instanceof Error ? err.message : 'Lỗi khi đóng gói tệp ZIP minh chứng.'
        );
      }
    } finally {
      abortRef.current = null;
      setExportingZip(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Readiness Check */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-950 dark:text-slate-50">
            Kiểm tra sẵn sàng trước khi xuất bảng điểm &amp; minh chứng
          </h2>
          <span className="font-mono-num text-xs text-slate-500">
            {confirmedCount}/{total} bài đã xác nhận
          </span>
        </div>

        {total === 0 ? (
          <p className="text-xs text-slate-500">
            Phiên chấm hiện chưa có bài làm nào. Vui lòng tải ảnh phiếu và chấm OMR trước khi xuất.
          </p>
        ) : reviewOrErrorCount > 0 ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Còn <strong className="font-mono-num">{reviewOrErrorCount}</strong> bài đang ở trạng thái cần kiểm tra thủ công hoặc lỗi, và{' '}
              <strong className="font-mono-num">{unconfirmedCount}</strong> bài chưa xác nhận. Bạn vẫn có thể xuất bản nháp, cột &ldquo;Trạng thái xác nhận&rdquo; sẽ phản ánh trung thực trạng thái từng bài.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/80 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Tất cả {total} bài đều đã có kết quả chấm rõ ràng ({confirmedCount} bài đã giáo viên xác nhận). Sẵn sàng xuất Excel &amp; gói ZIP minh chứng.
            </span>
          </div>
        )}
      </div>

      {/* 2 Export Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Card 1: Excel XLSX */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/60">
                <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                  Bảng điểm Excel (.xlsx)
                </h3>
                <div className="text-xs font-mono-num text-slate-500">
                  Bang_diem.xlsx · 11 cột chuẩn
                </div>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Gồm đủ 11 cột: STT, Mã học sinh, Họ và tên, Lớp, Mã đề, Số câu đúng, Số câu sai, Số câu bỏ trống, Điểm, Trạng thái xác nhận và Tên file ảnh minh chứng có liên kết tương đối{' '}
              <span className="font-mono-num">Evidence/&lt;MaHS&gt;/annotated.png</span>.
            </p>
          </div>

          <button
            type="button"
            disabled={total === 0 || exportingXlsx}
            onClick={() => void handleDownloadXlsx()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 px-4 py-2.5 text-xs font-semibold text-emerald-900 dark:text-emerald-200 transition-colors disabled:opacity-45"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            <span>{exportingXlsx ? 'Đang tạo Bang_diem.xlsx...' : 'Tải Bang_diem.xlsx'}</span>
          </button>
        </div>

        {/* Card 2: Full ZIP Archive */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-400 border border-indigo-200/70 dark:border-indigo-800/60">
                <Archive className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                  Gói lưu trữ minh chứng (.zip)
                </h3>
                <div className="text-xs font-mono-num text-slate-500">
                  TeacherOS_Grading_Archive.zip
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 p-3 font-mono-num text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
              <div>TeacherOS_Grading_Archive.zip</div>
              <div>├── Bang_diem.xlsx</div>
              <div>├── grading_manifest.json</div>
              <div>└── Evidence/&lt;MaHS&gt;/</div>
              <div>    ├── original.jpg (ảnh gốc nguyên bản)</div>
              <div>    ├── annotated.png (ảnh đã chấm chú thích)</div>
              <div>    └── student_report.html (phiếu riêng từng HS)</div>
            </div>
          </div>

          {exportingZip ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 dark:text-slate-300 truncate">
                  {zipStatusText} ({zipProgress}%)
                </span>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold shrink-0"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Hủy</span>
                </button>
              </div>
              <div className="h-2 w-full rounded-full bg-indigo-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all"
                  style={{ width: `${zipProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={total === 0}
              onClick={() => void handleDownloadZip()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors disabled:opacity-45"
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              <span>Tải TeacherOS_Grading_Archive.zip</span>
            </button>
          )}
        </div>
      </div>

      {/* Privacy & Relative Link Explanation */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 flex items-start gap-3 text-xs text-slate-600 dark:text-slate-400">
        <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="leading-relaxed">
          <strong className="text-slate-800 dark:text-slate-200">Bảo mật Local-First:</strong>{' '}
          Liên kết ảnh minh chứng trong Excel là đường dẫn tương đối cục bộ — hãy giải nén trọn vẹn gói ZIP trên máy tính rồi mở{' '}
          <span className="font-mono-num">Bang_diem.xlsx</span> để bấm xem ảnh trực tiếp. Hệ thống tuyệt đối không tải ảnh học sinh lên máy chủ và không tạo liên kết công khai. Khi gửi cho từng học sinh, chỉ chia sẻ tệp{' '}
          <span className="font-mono-num">student_report.html</span> và{' '}
          <span className="font-mono-num">annotated.png</span> trong thư mục riêng của học sinh đó.
        </p>
      </div>
    </div>
  );
}

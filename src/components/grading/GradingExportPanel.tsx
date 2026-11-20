import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Share2,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import type { ExamCodeAnswerKey, GradingSession } from '../../types/grading';
import {
  buildGradebookXlsxBuffer,
  buildGradingArchiveZip,
  buildIndividualStudentReportHtml,
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

function canWebShareFile(file: File): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare === 'function') {
    try {
      return navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  }
  return false;
}

export function GradingExportPanel({
  session,
  answerKeysByCode,
  onNotify,
}: GradingExportPanelProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [exportingSingle, setExportingSingle] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [zipStatusText, setZipStatusText] = useState('');
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);

  // Chỉ xuất các phiếu đang hoạt động (không lẫn bản trùng đã lưu ẩn)
  const activeSheets = useMemo(
    () => session.sheets.filter((s) => !s.archivedByDuplicateResolution),
    [session.sheets]
  );

  const exportableSession: GradingSession = useMemo(
    () => ({ ...session, sheets: activeSheets }),
    [activeSheets, session]
  );

  const [selectedStudentSheetId, setSelectedStudentSheetId] = useState<string>(
    activeSheets[0]?.id ?? ''
  );

  const selectedSingleSheet = useMemo(
    () =>
      activeSheets.find((s) => s.id === selectedStudentSheetId) ??
      activeSheets[0] ??
      null,
    [activeSheets, selectedStudentSheetId]
  );

  const total = activeSheets.length;
  const confirmedCount = activeSheets.filter((s) => s.confirmedByTeacher).length;
  const unconfirmedCount = total - confirmedCount;
  const reviewOrErrorCount = activeSheets.filter(
    (s) => s.status === 'review-required' || s.status === 'error'
  ).length;

  const deliverBlob = async (
    blob: Blob,
    fileName: string,
    preferShare: boolean,
    shareTitle: string
  ) => {
    if (preferShare) {
      const file = new File([blob], fileName, {
        type: blob.type || 'application/octet-stream',
      });
      if (canWebShareFile(file)) {
        try {
          await navigator.share({
            title: shareTitle,
            files: [file],
          });
          onNotify('success', `Đã mở hộp thoại chia sẻ cho tệp ${fileName}.`);
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            onNotify('info', 'Đã hủy chia sẻ tệp.');
            return;
          }
          // Fall back seamlessly to local file download
        }
      }
    }
    triggerBlobDownload(blob, fileName);
    onNotify('success', `Đã tải xuống tệp ${fileName}.`);
  };

  const handleExportXlsx = async (preferShare = false) => {
    if (total === 0) {
      onNotify('error', 'Chưa có bài chấm nào để xuất bảng điểm Excel.');
      return;
    }
    if (!privacyConfirmed) {
      onNotify(
        'error',
        'Vui lòng xác nhận lưu ý bảo mật dữ liệu học sinh trước khi xuất hoặc chia sẻ tệp cả lớp.'
      );
      return;
    }
    setExportingXlsx(true);
    try {
      const bytes = await buildGradebookXlsxBuffer(exportableSession);
      const safeBytes = new Uint8Array(bytes.byteLength);
      safeBytes.set(bytes);
      const blob = new Blob([safeBytes.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      await deliverBlob(
        blob,
        'Bang_diem.xlsx',
        preferShare,
        `Bảng điểm ${session.className} — ${session.examTitle}`
      );
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể tạo tệp Excel bảng điểm.'
      );
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleExportZip = async (preferShare = false) => {
    if (total === 0) {
      onNotify('error', 'Chưa có bài chấm nào để đóng gói ZIP minh chứng.');
      return;
    }
    if (!privacyConfirmed) {
      onNotify(
        'error',
        'Vui lòng xác nhận lưu ý bảo mật dữ liệu học sinh trước khi đóng gói hoặc chia sẻ gói ZIP cả lớp.'
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setExportingZip(true);
    setZipProgress(2);
    setZipStatusText('Đang chuẩn bị dữ liệu minh chứng cục bộ...');

    try {
      const archiveBytes = await buildGradingArchiveZip({
        session: exportableSession,
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
      await deliverBlob(
        blob,
        'TeacherOS_Grading_Archive.zip',
        preferShare,
        `Gói minh chứng chấm bài ${session.className}`
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

  const handleExportSingleStudentImage = async (preferShare = false) => {
    if (!selectedSingleSheet) return;
    setExportingSingle(true);
    try {
      let blob: Blob | null = null;
      if (selectedSingleSheet.annotatedBlobId) {
        const rec = await getEvidenceBlob(selectedSingleSheet.annotatedBlobId);
        if (rec?.blob) blob = rec.blob;
      }
      if (!blob) {
        const origRec = await getEvidenceBlob(selectedSingleSheet.originalBlobId);
        if (origRec?.blob) {
          blob = await renderAnnotatedEvidencePngBlob(
            origRec.blob,
            selectedSingleSheet,
            session.omrQuestionCount
          );
        }
      }
      if (!blob) {
        onNotify('error', 'Không tìm thấy ảnh minh chứng của học sinh này trong IndexedDB.');
        return;
      }
      const safeId = (selectedSingleSheet.studentId || 'HocSinh').replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      await deliverBlob(
        blob,
        `MinhChung_${safeId}_Ma${selectedSingleSheet.examCode || 'OMR'}.png`,
        preferShare,
        `Bài chấm cá nhân ${selectedSingleSheet.studentName || selectedSingleSheet.studentId}`
      );
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể xuất ảnh minh chứng cá nhân.'
      );
    } finally {
      setExportingSingle(false);
    }
  };

  const handleExportSingleStudentReport = async (preferShare = false) => {
    if (!selectedSingleSheet) return;
    const html = buildIndividualStudentReportHtml(
      exportableSession,
      selectedSingleSheet
    );
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const safeId = (selectedSingleSheet.studentId || 'HocSinh').replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );
    await deliverBlob(
      blob,
      `PhieuKetQua_${safeId}.html`,
      preferShare,
      `Phiếu kết quả cá nhân ${selectedSingleSheet.studentName || selectedSingleSheet.studentId}`
    );
  };

  const webShareAvailable =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

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
            Phiên chấm hiện chưa có bài làm nào. Vui lòng quét camera hoặc tải ảnh phiếu trước khi xuất.
          </p>
        ) : reviewOrErrorCount > 0 ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Còn <strong className="font-mono-num">{reviewOrErrorCount}</strong> bài đang ở trạng thái cần kiểm tra thủ công hoặc lỗi, và{' '}
              <strong className="font-mono-num">{unconfirmedCount}</strong> bài chưa xác nhận. Cột &ldquo;Trạng thái xác nhận&rdquo; sẽ phản ánh trung thực trạng thái từng bài.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/80 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Tất cả {total} bài đang hoạt động đều có kết quả chấm rõ ràng ({confirmedCount} bài đã xác nhận). Sẵn sàng xuất Excel &amp; ZIP minh chứng.
            </span>
          </div>
        )}

        {/* Mandatory Privacy Guard for Multi-Student Exports */}
        {total > 0 && (
          <label className="flex items-start gap-2.5 rounded-xl border border-amber-300/90 dark:border-amber-800/80 bg-amber-50/60 dark:bg-amber-950/25 p-3.5 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={privacyConfirmed}
              onChange={(e) => setPrivacyConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-400 text-indigo-600 shrink-0"
            />
            <span className="space-y-0.5">
              <span className="flex items-center gap-1.5 font-bold text-amber-950 dark:text-amber-200">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Xác nhận bảo mật khi xuất dữ liệu nhiều học sinh</span>
              </span>
              <span className="block text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">
                Tôi hiểu rằng <strong>Bang_diem.xlsx</strong> và <strong>TeacherOS_Grading_Archive.zip</strong> chứa điểm số &amp; ảnh bài làm của nhiều học sinh — chỉ lưu trữ cá nhân của giáo viên và <strong>không gửi gói ZIP cả lớp vào nhóm chat học sinh/phụ huynh</strong>.
              </span>
            </span>
          </label>
        )}
      </div>

      {/* 2 Class-Wide Export Cards */}
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
              Gồm đủ 11 cột chuẩn cùng liên kết tương đối cục bộ{' '}
              <span className="font-mono-num">Evidence/&lt;MaHS&gt;/annotated.png</span>.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              disabled={total === 0 || exportingXlsx || !privacyConfirmed}
              onClick={() => void handleExportXlsx(false)}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 px-4 py-2.5 text-xs font-semibold text-emerald-900 dark:text-emerald-200 transition-colors disabled:opacity-45"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>{exportingXlsx ? 'Đang tạo...' : 'Tải Bang_diem.xlsx'}</span>
            </button>

            {webShareAvailable && (
              <button
                type="button"
                disabled={total === 0 || exportingXlsx || !privacyConfirmed}
                onClick={() => void handleExportXlsx(true)}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-45"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                <span>Chia sẻ</span>
              </button>
            )}
          </div>
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
              <div>├── Bang_diem.xlsx &amp; grading_manifest.json</div>
              <div>└── Evidence/&lt;MaHS&gt;/original.jpg · annotated.png · student_report.html</div>
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
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={total === 0 || !privacyConfirmed}
                onClick={() => void handleExportZip(false)}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors disabled:opacity-45"
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                <span>Tải TeacherOS_Grading_Archive.zip</span>
              </button>

              {webShareAvailable && (
                <button
                  type="button"
                  disabled={total === 0 || !privacyConfirmed}
                  onClick={() => void handleExportZip(true)}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-45"
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  <span>Chia sẻ</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Card 3: Individual Student Evidence Export (Safe to send to 1 student/parent) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3.5">
        <div className="flex items-start gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-400 border border-sky-200/70 dark:border-sky-800/60">
            <UserCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-950 dark:text-white">
              Xuất minh chứng riêng cho từng học sinh (An toàn gửi cá nhân)
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Chỉ xuất ảnh bài đã chấm hoặc phiếu kết quả của đúng 1 học sinh được chọn — tuyệt đối không lộ điểm của bạn khác trong lớp.
            </p>
          </div>
        </div>

        {activeSheets.length === 0 ? (
          <p className="text-xs text-slate-500">Chưa có bài làm để xuất riêng.</p>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <select
              aria-label="Chọn học sinh xuất minh chứng riêng"
              value={selectedSingleSheet?.id ?? ''}
              onChange={(e) => setSelectedStudentSheetId(e.target.value)}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              {activeSheets.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.studentId || '(Chưa gán)'} — {sh.studentName || sh.fileName} · Mã {sh.examCode || '—'} · {sh.finalScore}/{sh.maxScore}đ
                </option>
              ))}
            </select>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!selectedSingleSheet || exportingSingle}
                onClick={() => void handleExportSingleStudentImage(webShareAvailable)}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900/50 px-3.5 py-2 text-xs font-semibold text-sky-900 dark:text-sky-200 disabled:opacity-45"
              >
                <ImageIcon className="h-4 w-4" aria-hidden="true" />
                <span>{webShareAvailable ? 'Chia sẻ / Tải ảnh chấm' : 'Tải ảnh chấm (PNG)'}</span>
              </button>

              <button
                type="button"
                disabled={!selectedSingleSheet}
                onClick={() => void handleExportSingleStudentReport(false)}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-45"
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                <span>Phiếu kết quả (HTML)</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Privacy & Cross-Device Local-First Notice */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 flex items-start gap-3 text-xs text-slate-600 dark:text-slate-400">
        <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="leading-relaxed">
          <strong className="text-slate-800 dark:text-slate-200">Bảo mật Local-First &amp; Chuyển dữ liệu giữa thiết bị:</strong>{' '}
          Dữ liệu lưu hoàn toàn trong trình duyệt của thiết bị này và không tự động đồng bộ qua Internet. Để chuyển kết quả từ điện thoại sang máy tính, hãy xuất gói ZIP hoặc tệp sao lưu JSON có kiểm tra toàn vẹn ở tab Tổng quan rồi nhập lại thủ công.
        </p>
      </div>
    </div>
  );
}

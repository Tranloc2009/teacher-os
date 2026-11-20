import { useMemo, useState } from 'react';
import { Download, Printer, QrCode } from 'lucide-react';
import type { GradingSession } from '../../types/grading';
import { buildPrintableOmrSheetSvg } from '../../core/grading/omrLayout';
import {
  renderSvgStringToPngBlob,
  triggerBlobDownload,
} from '../../core/grading/omrBrowserBridge';

interface AnswerSheetGeneratorPanelProps {
  session: GradingSession;
  onNotify: (tone: 'success' | 'info' | 'error', message: string) => void;
}

export function AnswerSheetGeneratorPanel({
  session,
  onNotify,
}: AnswerSheetGeneratorPanelProps) {
  const [selectedExamCode, setSelectedExamCode] = useState<string>(
    session.selectedExamCodes[0] ?? '101'
  );
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [includeOpticalCode, setIncludeOpticalCode] = useState<boolean>(true);
  const [exportingPng, setExportingPng] = useState<boolean>(false);

  const selectedStudent = useMemo(
    () => session.students.find((s) => s.studentId === selectedStudentId),
    [selectedStudentId, session.students]
  );

  const svgMarkup = useMemo(
    () =>
      buildPrintableOmrSheetSvg({
        examTitle: session.examTitle || session.title,
        subject: session.subject,
        grade: session.grade,
        examCode: selectedExamCode || session.selectedExamCodes[0] || '101',
        className: session.className,
        studentId: selectedStudent?.studentId,
        studentName: selectedStudent?.fullName,
        sessionId: session.id.slice(-4).toUpperCase(),
        questionCount: session.omrQuestionCount,
        includeOpticalCode,
      }),
    [
      includeOpticalCode,
      selectedExamCode,
      selectedStudent,
      session.className,
      session.examTitle,
      session.grade,
      session.id,
      session.omrQuestionCount,
      session.selectedExamCodes,
      session.subject,
      session.title,
    ]
  );

  const handleDownloadPng = async () => {
    setExportingPng(true);
    try {
      const blob = await renderSvgStringToPngBlob(svgMarkup, 1240, 1754);
      const namePart = selectedStudent
        ? `${selectedStudent.studentId}_Ma${selectedExamCode}`
        : `Phieu_trong_Ma${selectedExamCode}`;
      triggerBlobDownload(blob, `TeacherOS_OMR_${namePart}.png`);
      onNotify('success', `Đã xuất phiếu chuẩn A4 PNG (${namePart}).`);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể xuất PNG phiếu trả lời.'
      );
    } finally {
      setExportingPng(false);
    }
  };

  const handlePrintA4 = () => {
    // In sạch trong iframe ẩn — tránh window.open bị chặn trong iframe
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      onNotify('error', 'Không thể khởi tạo khung in A4 trên trình duyệt này.');
      return;
    }
    doc.open();
    doc.write(`<!doctype html><html><head><title>In phiếu OMR A4</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        html, body { margin: 0; padding: 0; width: 210mm; height: 297mm; background: #fff; }
        svg { width: 210mm; height: 297mm; display: block; }
      </style>
    </head><body>${svgMarkup}</body></html>`);
    doc.close();
    window.setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1500);
    }, 150);
  };

  const handlePrintClassBatch = () => {
    if (session.students.length === 0) {
      onNotify('error', 'Chưa có danh sách học sinh để in bộ phiếu cả lớp.');
      return;
    }
    const codes =
      session.selectedExamCodes.length > 0
        ? session.selectedExamCodes
        : [selectedExamCode || '101'];

    const pagesHtml = session.students
      .map((st, idx) => {
        const assignedCode = codes[idx % codes.length];
        const svg = buildPrintableOmrSheetSvg({
          examTitle: session.examTitle || session.title,
          subject: session.subject,
          grade: session.grade,
          examCode: assignedCode,
          className: st.className || session.className,
          studentId: st.studentId,
          studentName: st.fullName,
          sessionId: session.id.slice(-4).toUpperCase(),
          questionCount: session.omrQuestionCount,
          includeOpticalCode,
        });
        return `<div class="omr-page">${svg}</div>`;
      })
      .join('');

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      onNotify('error', 'Không thể khởi tạo khung in A4 trên trình duyệt này.');
      return;
    }
    doc.open();
    doc.write(`<!doctype html><html><head><title>In bộ phiếu OMR cả lớp (${session.students.length} HS)</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        .omr-page { width: 210mm; height: 297mm; page-break-after: always; break-after: page; }
        .omr-page:last-child { page-break-after: auto; break-after: auto; }
        svg { width: 210mm; height: 297mm; display: block; }
      </style>
    </head><body>${pagesHtml}</body></html>`);
    doc.close();
    window.setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 2000);
    }, 200);
    onNotify(
      'success',
      `Đã chuẩn bị lệnh in A4 cho ${session.students.length} học sinh (xoay vòng mã đề: ${codes.join(', ')}).`
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Left: Configuration Controls */}
      <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-950 dark:text-slate-50 flex items-center gap-2">
            <QrCode className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <span>Tạo phiếu trả lời chuẩn A4</span>
          </h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Phiếu in chuẩn TeacherOS gồm 4 dấu định vị góc (fiducial markers), điểm nhận diện chiều xoay và lưới ô A/B/C/D tách biệt vùng chữ.
          </p>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label htmlFor="omr-gen-code" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Mã đề in trên phiếu
            </label>
            <select
              id="omr-gen-code"
              value={selectedExamCode}
              onChange={(e) => setSelectedExamCode(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
            >
              {(session.selectedExamCodes.length > 0
                ? session.selectedExamCodes
                : ['101']
              ).map((code) => (
                <option key={code} value={code}>
                  Mã đề {code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="omr-gen-student" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Điền sẵn thông tin học sinh (tùy chọn)
            </label>
            <select
              id="omr-gen-student"
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Phiếu trống (học sinh tự điền tay)</option>
              {session.students.map((st) => (
                <option key={st.studentId} value={st.studentId}>
                  {st.studentId} — {st.fullName}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={includeOpticalCode}
              onChange={(e) => setIncludeOpticalCode(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Nhúng mã định danh 2D (chỉ chứa phiên, mã đề, mã học sinh — không chứa đáp án hay điểm số).
            </span>
          </label>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 p-3 text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <div className="font-semibold text-slate-800 dark:text-slate-200">
            Thông số phiếu chuẩn A4
          </div>
          <div className="font-mono-num">
            {session.omrQuestionCount} câu trắc nghiệm · 4 phương án A/B/C/D · Tỉ lệ 210×297 mm
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={handlePrintA4}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            <span>In phiếu chuẩn A4</span>
          </button>

          {session.students.length > 0 && (
            <button
              type="button"
              onClick={handlePrintClassBatch}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 px-4 py-2.5 text-xs font-semibold text-indigo-800 dark:text-indigo-200 transition-colors"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              <span>In bộ phiếu cả lớp ({session.students.length} HS · chia đều mã đề)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleDownloadPng()}
            disabled={exportingPng}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>{exportingPng ? 'Đang xuất PNG...' : 'Tải ảnh PNG chuẩn A4'}</span>
          </button>
        </div>
      </div>

      {/* Right: Crisp A4 Vector Preview */}
      <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/60 p-4 sm:p-6 flex flex-col items-center">
        <div className="w-full max-w-[640px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white shadow-sm overflow-hidden">
          <div
            className="w-full"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        </div>
      </div>
    </div>
  );
}

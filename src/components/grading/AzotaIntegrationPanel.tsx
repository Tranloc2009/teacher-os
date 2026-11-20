import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  RefreshCw,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import type {
  AzotaAvailabilityReport,
  AzotaResultColumnRole,
  AzotaResultImportPreview,
  ExternalIntegrationConfig,
} from '../../types/azota';
import type { GradingSession } from '../../types/grading';
import type { MathExamProject } from '../../types/mathExam';
import type { ExamFormTemplate } from '../../types/examForm';
import {
  AZOTA_OFFICIAL_STATUS_BANNER,
  appendAzotaActivity,
  buildAzotaImportPreviewFromRows,
  buildAzotaSampleResultXlsxBuffer,
  commitAzotaResultsToSession,
  createDefaultExternalIntegrationConfig,
  defaultAzotaProvider,
} from '../../core/azotaIntegrationEngine';
import {
  loadExternalIntegrationConfig,
  saveExternalIntegrationConfig,
} from '../../db/database';

interface AzotaIntegrationPanelProps {
  mathExams: MathExamProject[];
  activeSession: GradingSession | null;
  preferredExamId?: string | null;
  activeFormTemplate?: ExamFormTemplate | null;
  onCommitToSession?: (updatedSession: GradingSession) => Promise<void> | void;
  onOpenGradebookTab?: () => void;
  onOpenCreateSession?: () => void;
  onNotify: (tone: 'success' | 'info' | 'error', message: string) => void;
}

const COLUMN_ROLE_LABELS: Record<AzotaResultColumnRole, string> = {
  stt: 'STT',
  studentId: 'Mã HS / SBD',
  fullName: 'Họ và tên',
  className: 'Lớp',
  examCode: 'Mã đề',
  score: 'Điểm số',
  correctCount: 'Số câu đúng',
  notes: 'Ghi chú',
  ignore: 'Bỏ qua cột này',
};

export function AzotaIntegrationPanel({
  mathExams,
  activeSession,
  preferredExamId,
  activeFormTemplate,
  onCommitToSession,
  onOpenGradebookTab,
  onOpenCreateSession,
  onNotify,
}: AzotaIntegrationPanelProps) {
  const [subMode, setSubMode] = useState<'export' | 'import' | 'status'>('export');
  const [availability, setAvailability] = useState<AzotaAvailabilityReport | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [config, setConfig] = useState<ExternalIntegrationConfig>(() =>
    createDefaultExternalIntegrationConfig()
  );

  // Export Exam state
  const [selectedExamId, setSelectedExamId] = useState<string>(
    preferredExamId || activeSession?.examId || mathExams[0]?.id || ''
  );
  const [selectedCode, setSelectedCode] = useState<string>('AUTO');
  const [includeTrailingAnswerKey, setIncludeTrailingAnswerKey] = useState<boolean>(true);
  const [includeAnswerCsv, setIncludeAnswerCsv] = useState<boolean>(true);
  const [exportConsentChecked, setExportConsentChecked] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [lastExportGuide, setLastExportGuide] = useState<{
    fileName: string;
    questionCount: number;
    mediaCount: number;
    steps: string[];
    warnings: string[];
  } | null>(null);

  // Import Results state
  const [importPreview, setImportPreview] = useState<AzotaResultImportPreview | null>(null);
  const [columnOverrides, setColumnOverrides] = useState<
    Record<number, AzotaResultColumnRole>
  >({});
  const [importConsentChecked, setImportConsentChecked] = useState<boolean>(false);
  const [importingFile, setImportingFile] = useState<boolean>(false);
  const [committing, setCommitting] = useState<boolean>(false);

  // Load saved non-secret local config & run honest availability check on mount
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [savedCfg, checkRes] = await Promise.all([
        loadExternalIntegrationConfig(),
        defaultAzotaProvider.checkAvailability(),
      ]);
      if (!mounted) return;
      setConfig(savedCfg);
      setIncludeTrailingAnswerKey(savedCfg.azota.preferredIncludeTrailingAnswerKey);
      setIncludeAnswerCsv(savedCfg.azota.preferredIncludeAnswerCsv);
      if (checkRes.data) setAvailability(checkRes.data);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (preferredExamId && mathExams.some((e) => e.id === preferredExamId)) {
      setSelectedExamId(preferredExamId);
    } else if (!selectedExamId && activeSession?.examId) {
      setSelectedExamId(activeSession.examId);
    } else if (!selectedExamId && mathExams[0]) {
      setSelectedExamId(mathExams[0].id);
    }
  }, [preferredExamId, activeSession?.examId, mathExams, selectedExamId]);

  const selectedExam = useMemo(
    () => mathExams.find((e) => e.id === selectedExamId) ?? mathExams[0] ?? null,
    [mathExams, selectedExamId]
  );

  const selectedVersion = useMemo(() => {
    if (!selectedExam) return null;
    if (selectedCode === 'ORIGINAL') return null;
    if (selectedCode === 'AUTO') {
      return selectedExam.generatedVersions[0] ?? null;
    }
    return (
      selectedExam.generatedVersions.find((v) => v.code === selectedCode) ??
      selectedExam.generatedVersions[0] ??
      null
    );
  }, [selectedExam, selectedCode]);

  const persistConfigUpdate = async (next: ExternalIntegrationConfig) => {
    setConfig(next);
    await saveExternalIntegrationConfig(next);
  };

  const handleRecheckAvailability = async () => {
    setCheckingStatus(true);
    try {
      const res = await defaultAzotaProvider.checkAvailability();
      if (res.data) setAvailability(res.data);
      const nextCfg = appendAzotaActivity(config, {
        action: 'availability-check',
        summary: 'Kiểm tra trạng thái API trực tiếp Azota: NOT_AVAILABLE / Chế độ tệp tin cục bộ',
      });
      await persistConfigUpdate(nextCfg);
      onNotify(
        'info',
        'Azota chưa có Official Public API được xác minh — đang chạy chế độ Trao đổi tệp tin thủ công (Local-First).'
      );
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleExportForAzota = async () => {
    if (!selectedExam) {
      onNotify('error', 'Chưa có đề kiểm tra nào để xuất cho Azota.');
      return;
    }
    if (!exportConsentChecked) {
      onNotify(
        'info',
        'Vui lòng tích xác nhận chủ động xuất tệp trước khi tải về máy.'
      );
      return;
    }

    setExporting(true);
    try {
      const res = await defaultAzotaProvider.exportExam({
        mode: 'file-based',
        exam: selectedExam,
        version: selectedVersion,
        formTemplate: activeFormTemplate ?? null,
        includeTrailingAnswerKey,
        includeConsolidatedCsv: includeAnswerCsv,
        teacherConfirmedConsent: exportConsentChecked,
      });

      if (res.status !== 'OK' || !res.data) {
        onNotify('error', res.messageVi);
        return;
      }

      // Tải file .DOCX về máy giáo viên
      const docxBlob = new Blob([res.data.docxBuffer.slice().buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const docxUrl = URL.createObjectURL(docxBlob);
      const docxLink = document.createElement('a');
      docxLink.href = docxUrl;
      docxLink.download = res.data.docxFileName;
      docxLink.click();
      URL.revokeObjectURL(docxUrl);

      // Tải thêm bảng đáp án CSV nếu giáo viên chọn
      if (res.data.answerCsvText && res.data.answerCsvFileName) {
        const csvBlob = new Blob([res.data.answerCsvText], {
          type: 'text/csv;charset=utf-8',
        });
        const csvUrl = URL.createObjectURL(csvBlob);
        const csvLink = document.createElement('a');
        csvLink.href = csvUrl;
        csvLink.download = res.data.answerCsvFileName;
        csvLink.click();
        URL.revokeObjectURL(csvUrl);
      }

      setLastExportGuide({
        fileName: res.data.docxFileName,
        questionCount: res.data.questionCount,
        mediaCount: res.data.embeddedMediaCount,
        steps: res.data.manualUploadStepsVi,
        warnings: res.data.warnings,
      });

      const nextCfg = appendAzotaActivity(
        {
          ...config,
          azota: {
            ...config.azota,
            preferredIncludeTrailingAnswerKey: includeTrailingAnswerKey,
            preferredIncludeAnswerCsv: includeAnswerCsv,
          },
        },
        {
          action: 'file-export',
          summary: `Xuất tệp đề tương thích Azota (${selectedExam.title} · Mã ${res.data.examCodeLabel})`,
          fileName: res.data.docxFileName,
        }
      );
      await persistConfigUpdate(nextCfg);
      onNotify('success', res.messageVi);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể xuất file DOCX tương thích Azota.'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadSampleXlsx = async () => {
    try {
      const buf = await buildAzotaSampleResultXlsxBuffer(
        activeSession?.students ?? [],
        activeSession?.className || '12A1',
        activeSession?.selectedExamCodes[0] || '101'
      );
      const blob = new Blob([buf.slice().buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Mau_BangDiem_Azota_${activeSession?.className || '12A1'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(
        'info',
        'Đã tải file Excel mẫu cấu trúc bảng điểm Azota (chỉ để đối chiếu hoặc thử ánh xạ cột cục bộ).'
      );
    } catch {
      onNotify('error', 'Không thể tạo tệp Excel mẫu cục bộ.');
    }
  };

  const handleUploadResultFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportingFile(true);
    setImportConsentChecked(false);
    setColumnOverrides({});

    try {
      const buffer = await file.arrayBuffer();
      const res = await defaultAzotaProvider.importResults({
        mode: 'file-based',
        fileName: file.name,
        fileBuffer: buffer,
        roster: activeSession?.students ?? [],
        maxScore: activeSession?.gradingRule.maxScore ?? 10,
      });

      if (res.data) {
        setImportPreview(res.data);
      } else {
        setImportPreview(null);
      }

      if (res.status !== 'OK') {
        onNotify('error', res.messageVi);
        return;
      }

      const nextCfg = appendAzotaActivity(config, {
        action: 'file-import',
        summary: `Đọc xem trước bảng điểm từ "${file.name}" (${res.data?.rows.length ?? 0} dòng)`,
        fileName: file.name,
      });
      await persistConfigUpdate(nextCfg);
      onNotify('success', res.messageVi);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể đọc tệp bảng điểm Excel/CSV.'
      );
    } finally {
      setImportingFile(false);
    }
  };

  const handleChangeColumnRole = (colIdx: number, nextRole: AzotaResultColumnRole) => {
    if (!importPreview) return;
    const nextOverrides: Record<number, AzotaResultColumnRole> = {
      ...columnOverrides,
      [colIdx]: nextRole,
    };
    setColumnOverrides(nextOverrides);
    const rebuilt = buildAzotaImportPreviewFromRows({
      fileName: importPreview.fileName,
      fileType: importPreview.fileType,
      rawRows: importPreview.rawRows,
      roster: activeSession?.students ?? [],
      maxScore: activeSession?.gradingRule.maxScore ?? 10,
      columnOverrides: nextOverrides,
    });
    setImportPreview(rebuilt);
  };

  const handleCommitImportedScores = async () => {
    if (!activeSession || !onCommitToSession) {
      onNotify(
        'error',
        'Hãy tạo hoặc chọn một phiên chấm bài trong Smart Grading Studio trước khi ghi điểm vào Sổ điểm.'
      );
      return;
    }
    if (!importPreview || importPreview.errors.length > 0) {
      onNotify('error', 'Dữ liệu bảng điểm đang có lỗi ánh xạ cột. Hãy kiểm tra lại.');
      return;
    }
    if (!importConsentChecked) {
      onNotify(
        'info',
        'Vui lòng tích xác nhận nhập kết quả vào Sổ điểm TeacherOS trước khi thực hiện.'
      );
      return;
    }

    setCommitting(true);
    try {
      const committed = commitAzotaResultsToSession(
        activeSession,
        importPreview,
        true
      );
      await onCommitToSession(committed.updatedSession);

      const nextCfg = appendAzotaActivity(config, {
        action: 'gradebook-commit',
        summary: `Đã nhập ${committed.importedCount} điểm hợp lệ từ "${importPreview.fileName}" vào Sổ điểm lớp ${activeSession.className}`,
        fileName: importPreview.fileName,
      });
      await persistConfigUpdate(nextCfg);
      onNotify(
        'success',
        `Đã nhập ${committed.importedCount} điểm hợp lệ vào Sổ điểm TeacherOS (giữ trống ${committed.skippedEmptyCount} ô chưa có điểm, ghi đủ nhật ký kiểm toán).`
      );
      setImportConsentChecked(false);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể ghi dữ liệu điểm Azota vào Sổ điểm.'
      );
    } finally {
      setCommitting(false);
    }
  };

  return (
    <section
      aria-label="Tích hợp Azota (Chế độ trao đổi tệp tin minh bạch)"
      data-testid="azota-integration-panel"
      className="space-y-4"
    >
      {/* Honest API Status & Security Banner (Section 11.1 + 11.4) */}
      <div className="rounded-2xl border border-amber-200/90 dark:border-amber-900/70 bg-gradient-to-r from-amber-50/90 via-white to-indigo-50/50 dark:from-amber-950/30 dark:via-slate-900 dark:to-indigo-950/20 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-950 dark:text-white">
                  {availability?.officialStatusBanner ?? AZOTA_OFFICIAL_STATUS_BANNER}
                </h2>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                Azota hiện <strong>chưa công bố Official Public API</strong> cho ứng dụng bên thứ ba. TeacherOS tuyệt đối không dùng API nội bộ không xác minh, không yêu cầu mật khẩu/cookie Azota và không giả lập kết nối. Hiện đang hỗ trợ đầy đủ <strong>chế độ trao đổi tệp tin thủ công (Local-First File Fallback)</strong>: xuất đề .DOCX tương thích Azota và nhập bảng điểm .XLSX/.CSV từ Azota.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleRecheckAvailability()}
            disabled={checkingStatus}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-400 shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${checkingStatus ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Kiểm tra trạng thái</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/60 dark:border-amber-900/40 pt-2.5 text-[11.5px] text-slate-600 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Xuất đề .DOCX cho Azota: Sẵn sàng
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Nhập bảng điểm .XLSX/.CSV: Sẵn sàng
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Đồng bộ API trực tiếp: NOT_SUPPORTED
            </span>
          </div>
          {config.azota.lastCheckedAt && (
            <span className="font-mono-num text-[11px] text-slate-500">
              Cục bộ 100% · Không lưu mật khẩu/token
            </span>
          )}
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div
        role="tablist"
        aria-label="Chức năng trao đổi tệp với Azota"
        className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1"
      >
        <button
          role="tab"
          aria-selected={subMode === 'export'}
          type="button"
          onClick={() => setSubMode('export')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
            subMode === 'export'
              ? 'bg-[#635BFF] text-white'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          <span>1. Xuất đề tương thích Azota (.DOCX)</span>
        </button>
        <button
          role="tab"
          aria-selected={subMode === 'import'}
          type="button"
          onClick={() => setSubMode('import')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
            subMode === 'import'
              ? 'bg-[#635BFF] text-white'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
          <span>2. Nhập bảng điểm từ Azota (.XLSX / .CSV)</span>
        </button>
        <button
          role="tab"
          aria-selected={subMode === 'status'}
          type="button"
          onClick={() => setSubMode('status')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
            subMode === 'status'
              ? 'bg-[#635BFF] text-white'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          <span>3. Trạng thái Provider & Bảo mật</span>
        </button>
      </div>

      {/* PANEL 1: EXPORT EXAM FOR AZOTA */}
      {subMode === 'export' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                Xuất file .DOCX đề thi chuẩn bị tải lên Azota
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Tái sử dụng bộ xuất DOCX hiện có của TeacherOS — giữ nguyên công thức toán, hình vẽ, bảng biến thiên và không làm thay đổi đề gốc hay đáp án.
              </p>
            </div>

            {mathExams.length === 0 ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs text-slate-600 dark:text-slate-400">
                Chưa có đề kiểm tra nào trong TeacherOS. Hãy tạo hoặc nhập đề trong Smart Exam Generator / Exam Mixer Pro trước.
              </div>
            ) : (
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="azota-export-exam-select"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Chọn đề kiểm tra
                    </label>
                    <select
                      id="azota-export-exam-select"
                      value={selectedExam?.id ?? ''}
                      onChange={(e) => {
                        setSelectedExamId(e.target.value);
                        setSelectedCode('AUTO');
                      }}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-100"
                    >
                      {mathExams.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.title} ({ex.questions.length} câu · {ex.generatedVersions.length} mã đề)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="azota-export-code-select"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Chọn mã đề xuất file
                    </label>
                    <select
                      id="azota-export-code-select"
                      value={selectedCode}
                      onChange={(e) => setSelectedCode(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-100"
                    >
                      {selectedExam && selectedExam.generatedVersions.length > 0 && (
                        <option value="AUTO">
                          Mã đề đầu tiên ({selectedExam.generatedVersions[0].code})
                        </option>
                      )}
                      {selectedExam?.generatedVersions.map((v) => (
                        <option key={v.code} value={v.code}>
                          Mã đề {v.code} ({v.questions.length} câu)
                        </option>
                      ))}
                      <option value="ORIGINAL">
                        Đề gốc (chỉ đọc, chưa trộn mã)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3">
                  <label className="flex items-start gap-2.5 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeTrailingAnswerKey}
                      onChange={(e) => setIncludeTrailingAnswerKey(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    <span>
                      <strong>Kèm Bảng đáp án cuối tệp .DOCX</strong> (định dạng{' '}
                      <code className="font-mono-num">1.A 2.B ...</code> hỗ trợ trình nhận diện Word của Azota).
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAnswerCsv}
                      onChange={(e) => setIncludeAnswerCsv(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    <span>
                      <strong>Tải kèm tệp đối chiếu đáp án (.CSV)</strong> để giáo viên kiểm tra nhanh sau khi tải đề lên Azota.
                    </span>
                  </label>
                </div>

                {/* Mandatory Consent Gate (Section 11.4 + Test #32) */}
                <label className="flex items-start gap-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    id="azota-export-consent"
                    type="checkbox"
                    checked={exportConsentChecked}
                    onChange={(e) => setExportConsentChecked(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-indigo-300 text-indigo-600"
                  />
                  <span>
                    Tôi xác nhận chủ động xuất tệp đề kiểm tra này về máy để tự tải lên Azota.{' '}
                    <span className="text-slate-600 dark:text-slate-400">
                      (TeacherOS không tự upload đề hay đồng bộ ngầm ra bên ngoài.)
                    </span>
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={!selectedExam || !exportConsentChecked || exporting}
                    onClick={() => void handleExportForAzota()}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#635BFF] hover:bg-[#5046E5] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-xs font-semibold text-white transition-colors"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {exporting ? 'Đang tạo tệp .DOCX...' : 'Tải tệp .DOCX tương thích Azota'}
                    </span>
                  </button>
                  {selectedExam && (
                    <span className="text-[11.5px] text-slate-500">
                      {selectedExam.questions.length} câu hỏi · Chỉ gửi dữ liệu đề tối thiểu trong tệp xuất
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Guide Card */}
          <aside className="lg:col-span-5 min-w-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-200">
              Quy trình tải đề thủ công lên Azota
            </h3>
            <ol className="space-y-2 text-xs text-slate-700 dark:text-slate-300 list-decimal pl-4">
              <li>Chọn đề và mã đề muốn phát, tích xác nhận xuất tệp về máy.</li>
              <li>Mở file <code className="font-mono-num">.DOCX</code> vừa tải kiểm tra lại công thức toán & đồ thị.</li>
              <li>Mở trình duyệt đăng nhập <strong>azota.vn</strong> bằng tài khoản giáo viên của bạn.</li>
              <li>Chọn <strong>Đề thi → Tạo đề thi → Tải file Word (.docx)</strong> và đối chiếu đáp án trước khi xuất bản.</li>
            </ol>

            {lastExportGuide && (
              <div className="min-w-0 overflow-hidden rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 space-y-1.5 text-xs">
                <div className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-start gap-1.5 min-w-0">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="min-w-0 break-all">Đã tạo: {lastExportGuide.fileName}</span>
                </div>
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  {lastExportGuide.questionCount} câu hỏi · {lastExportGuide.mediaCount} ảnh/đồ thị đính kèm
                </div>
                {lastExportGuide.warnings.map((w, idx) => (
                  <p key={idx} className="text-[11px] text-amber-800 dark:text-amber-300 break-words">
                    Lưu ý: {w}
                  </p>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* PANEL 2: IMPORT RESULTS FROM AZOTA (.XLSX / .CSV) */}
      {subMode === 'import' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                  Nhập tệp bảng điểm Excel / CSV xuất từ Azota
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Đọc hoàn toàn cục bộ trên trình duyệt — cho phép ánh xạ từng cột, xem trước đối chiếu danh sách lớp và xác nhận trước khi ghi vào Sổ điểm TeacherOS.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadSampleXlsx()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-400"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Tải file Excel mẫu</span>
                </button>
                <label className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] hover:bg-[#5046E5] px-3.5 py-2 text-xs font-semibold text-white cursor-pointer transition-colors">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{importingFile ? 'Đang đọc tệp...' : 'Chọn tệp .XLSX / .CSV'}</span>
                  <input
                    type="file"
                    accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    className="sr-only"
                    aria-label="Chọn tệp bảng điểm xuất từ Azota (.xlsx hoặc .csv)"
                    onChange={(e) => void handleUploadResultFile(e)}
                  />
                </label>
              </div>
            </div>

            {!activeSession && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                <span>
                  Bạn vẫn có thể xem trước & ánh xạ tệp điểm ngay bây giờ. Để lưu điểm vào Sổ điểm lớp, hãy tạo một phiên chấm bài trong Smart Grading Studio.
                </span>
                {onOpenCreateSession && (
                  <button
                    type="button"
                    onClick={onOpenCreateSession}
                    className="rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Tạo phiên chấm bài
                  </button>
                )}
              </div>
            )}

            {importPreview && (
              <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                {/* Summary Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Tệp: {importPreview.fileName} ({importPreview.rows.length} học sinh)
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-num">
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                      Hợp lệ: {importPreview.validScoreCount}
                    </span>
                    <span className="text-slate-500">
                      Trống/vắng: {importPreview.emptyScoreCount}
                    </span>
                    {importPreview.invalidScoreCount > 0 && (
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">
                        Lỗi điểm: {importPreview.invalidScoreCount}
                      </span>
                    )}
                    {activeSession && activeSession.students.length > 0 && (
                      <span className="text-indigo-700 dark:text-indigo-300">
                        Khớp DS lớp: {importPreview.matchedCount}/{importPreview.rows.length}
                      </span>
                    )}
                  </div>
                </div>

                {/* Errors & Warnings */}
                {importPreview.errors.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-800 dark:text-rose-200 space-y-1"
                  >
                    {importPreview.errors.map((err, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                )}

                {importPreview.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                    {importPreview.warnings.map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                )}

                {/* Column Mapping Grid */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                    Ánh xạ cột dữ liệu (có thể chỉnh tay trước khi nhập)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {importPreview.columns.map((col) => (
                      <div
                        key={col.columnIndex}
                        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 p-2.5 space-y-1.5"
                      >
                        <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">
                          {col.headerText}
                        </div>
                        <select
                          aria-label={`Ánh xạ cột ${col.headerText}`}
                          value={col.role}
                          onChange={(e) =>
                            handleChangeColumnRole(
                              col.columnIndex,
                              e.target.value as AzotaResultColumnRole
                            )
                          }
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        >
                          {(Object.keys(COLUMN_ROLE_LABELS) as AzotaResultColumnRole[]).map(
                            (roleKey) => (
                              <option key={roleKey} value={roleKey}>
                                {COLUMN_ROLE_LABELS[roleKey]}
                              </option>
                            )
                          )}
                        </select>
                        {col.sampleValues.length > 0 && (
                          <div className="text-[10.5px] text-slate-500 truncate">
                            Mẫu: {col.sampleValues.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live Preview Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-[11px] uppercase text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Dòng</th>
                        <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Mã HS / SBD</th>
                        <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Họ và tên</th>
                        <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Lớp</th>
                        <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Mã đề</th>
                        <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Điểm</th>
                        <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {importPreview.rows.slice(0, 30).map((row) => (
                        <tr key={row.rowIndex} className="bg-white dark:bg-slate-900">
                          <td className="px-3 py-2 font-mono-num text-slate-500">{row.rowIndex}</td>
                          <td className="px-3 py-2 font-mono-num font-medium text-slate-900 dark:text-slate-100">
                            {row.matchedStudentId || row.studentId || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-900 dark:text-slate-100">
                            {row.matchedStudentName || row.fullName || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {row.className || activeSession?.className || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono-num text-slate-600 dark:text-slate-400">
                            {row.examCode || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono-num font-bold">
                            {row.scoreStatus === 'valid' && row.numericScore !== null ? (
                              <span className="text-emerald-700 dark:text-emerald-400">
                                {row.numericScore}
                              </span>
                            ) : row.scoreStatus === 'invalid' ? (
                              <span className="text-rose-600 dark:text-rose-400">
                                Lỗi ({row.rawScoreText})
                              </span>
                            ) : (
                              <span className="text-slate-400">Trống</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-400">
                            {row.warnings.length > 0
                              ? row.warnings[0]
                              : row.matchState === 'MATCHED_ID' || row.matchState === 'MATCHED_NAME'
                              ? 'Khớp danh sách lớp'
                              : 'Hợp lệ (nhập mới)'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Explicit Confirmation Gate */}
                <div className="space-y-3 pt-1">
                  <label className="flex items-start gap-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input
                      id="azota-import-consent"
                      type="checkbox"
                      checked={importConsentChecked}
                      onChange={(e) => setImportConsentChecked(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-indigo-300 text-indigo-600"
                    />
                    <span>
                      Tôi đã kiểm tra bảng xem trước và xác nhận nhập{' '}
                      <strong>{importPreview.validScoreCount}</strong> điểm hợp lệ vào Sổ điểm TeacherOS (ô trống/vắng giữ nguyên không quy về 0, không xóa ảnh minh chứng OMR hiện có).
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={
                        !activeSession ||
                        !importConsentChecked ||
                        importPreview.errors.length > 0 ||
                        importPreview.validScoreCount === 0 ||
                        committing
                      }
                      onClick={() => void handleCommitImportedScores()}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-xs font-semibold text-white transition-colors"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {committing
                          ? 'Đang ghi vào Sổ điểm...'
                          : 'Xác nhận nhập vào Sổ điểm TeacherOS'}
                      </span>
                    </button>

                    {activeSession && onOpenGradebookTab && (
                      <button
                        type="button"
                        onClick={onOpenGradebookTab}
                        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-400"
                      >
                        Mở Sổ điểm & Đối soát
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PANEL 3: PROVIDER CAPABILITIES & SECURITY AUDIT */}
      {subMode === 'status' && availability && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white">
              Bảng năng lực AzotaIntegrationProvider (7 phương thức chuẩn)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-950 text-[11px] uppercase text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Phương thức</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">API trực tiếp</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Tệp tin cục bộ</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {availability.capabilities.map((cap) => (
                    <tr key={cap.operation}>
                      <td className="px-3 py-2 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                        {cap.operation}
                      </td>
                      <td className="px-3 py-2 font-mono-num text-amber-700 dark:text-amber-400 font-semibold">
                        {cap.directApiStatus}
                      </td>
                      <td className="px-3 py-2 font-mono-num">
                        {cap.fileFallbackStatus === 'SUPPORTED' ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            SUPPORTED
                          </span>
                        ) : (
                          <span className="text-slate-500">{cap.fileFallbackStatus}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {cap.summaryVi}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-200">
                Cam kết bảo mật & Quyền riêng tư
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 list-disc pl-4">
                {availability.securityGuarantees.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>

            {config.azota.recentActivities.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  Nhật ký thao tác tệp cục bộ gần đây
                </h4>
                <ul className="space-y-1.5 text-[11.5px] text-slate-600 dark:text-slate-400">
                  {config.azota.recentActivities.slice(0, 5).map((act) => (
                    <li key={act.id} className="flex items-start justify-between gap-2">
                      <span>{act.summary}</span>
                      <span className="font-mono-num text-[10.5px] text-slate-400 shrink-0">
                        {new Date(act.timestamp).toLocaleTimeString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Layers,
  Printer,
  ScanLine,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  LessonPack,
  MarginPreset,
  PrintSettings,
} from '../../types/lesson';
import type { ExamExportSettings, MathExamProject } from '../../types/mathExam';
import type { ExamFormTemplate } from '../../types/examForm';
import { BUILT_IN_EXAM_FORM_PRESETS } from '../../core/examFormEngine';
import {
  buildStudentExamDocxBuffer,
} from '../../core/examExportEngine';
import { checkExamExportGate } from '../../core/mathIntegrity';
import {
  allocateThreeWorksheets,
  calculateActivityMinutes,
  normalizeWorksheetVariants,
} from '../../utils/allocation';
import { ContextualAcademyBar } from '../tutorial/ContextualAcademyBar';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { Step5PrintPreview } from '../wizard/Step5PrintPreview';
import { MathExamPrintPreview } from '../math/MathExamPrintPreview';
import { ExamFormDesigner } from '../examForm/ExamFormDesigner';
import { Button, PageBanner } from '../ui/DesignSystem';

interface PrintStudioAppProps {
  packs: LessonPack[];
  selectedPack: LessonPack;
  settings: PrintSettings;
  mathExams?: MathExamProject[];
  examFormTemplates?: ExamFormTemplate[];
  preferredExamId?: string | null;
  preferredFormId?: string | null;
  preferredFormLabel?: string | null;
  onSelectPackId: (id: string) => void;
  onMarkCompleted: (pack: LessonPack) => void;
  onOpenSettings: () => void;
  onOpenInLessonStudio: (pack: LessonPack) => void;
  onQuickUpdateSettings?: (next: PrintSettings) => Promise<void>;
  onSaveMathExam?: (exam: MathExamProject, silent?: boolean) => Promise<MathExamProject>;
  onSaveExamFormTemplates?: (templates: ExamFormTemplate[]) => void;
  onExamFormApplied?: (examId: string, template: ExamFormTemplate) => void;
  onOpenExamMixer?: (examId: string) => void;
  onOpenGradingStudio?: (examId: string) => void;
  onOpenAzotaBridge?: (examId: string) => void;
  onExamPrinted?: (examId: string, formLabel?: string, formId?: string) => void;
  onNotify?: (type: 'success' | 'info' | 'warning' | 'error', message: string) => void;
}

type ExportFormatId = 'pdf' | 'docx' | 'png';
type PrintStudioSourceMode = 'lesson-pack' | 'math-exam';
type ExamPrintSubMode = 'form-designer' | 'matrix-preview';

export function PrintStudioApp({
  packs,
  selectedPack,
  settings,
  mathExams = [],
  examFormTemplates,
  preferredExamId,
  preferredFormId,
  preferredFormLabel,
  onSelectPackId,
  onMarkCompleted,
  onOpenSettings,
  onOpenInLessonStudio,
  onQuickUpdateSettings,
  onSaveMathExam,
  onSaveExamFormTemplates,
  onExamFormApplied,
  onOpenExamMixer,
  onOpenGradingStudio,
  onOpenAzotaBridge,
  onExamPrinted,
  onNotify,
}: PrintStudioAppProps) {
  const [sourceMode, setSourceMode] = useState<PrintStudioSourceMode>(
    preferredExamId ? 'math-exam' : 'lesson-pack'
  );
  const [examSubMode, setExamSubMode] = useState<ExamPrintSubMode>('form-designer');
  const [localTemplates, setLocalTemplates] = useState<ExamFormTemplate[]>(
    () => examFormTemplates ?? structuredClone(BUILT_IN_EXAM_FORM_PRESETS)
  );
  const [selectedExamId, setSelectedExamId] = useState<string>(
    preferredExamId || mathExams[0]?.id || ''
  );
  const [selectedExamCode, setSelectedExamCode] = useState<string>('');
  const [downloadingExamDocx, setDownloadingExamDocx] = useState(false);

  const effectiveTemplates = examFormTemplates ?? localTemplates;
  const handleTemplatesChange = (next: ExamFormTemplate[]) => {
    setLocalTemplates(next);
    onSaveExamFormTemplates?.(next);
  };

  const [showInspector, setShowInspector] = useState(true);
  const [previewPage, setPreviewPage] = useState(1);
  const [zoomPercent, setZoomPercent] = useState<85 | 100 | 115>(100);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [exportFormat, setExportFormat] = useState<ExportFormatId>('pdf');
  const tutorial = useOptionalTutorial();

  useEffect(() => {
    if (preferredExamId && mathExams.some((e) => e.id === preferredExamId)) {
      setSelectedExamId(preferredExamId);
      setSourceMode('math-exam');
    }
  }, [preferredExamId, mathExams]);

  const activeExam = useMemo(
    () => mathExams.find((e) => e.id === selectedExamId) ?? mathExams[0] ?? null,
    [mathExams, selectedExamId]
  );

  useEffect(() => {
    if (!activeExam) {
      setSelectedExamCode('');
      return;
    }
    const firstCode = activeExam.generatedVersions[0]?.code ?? '';
    setSelectedExamCode((prev) =>
      activeExam.generatedVersions.some((v) => v.code === prev) ? prev : firstCode
    );
  }, [activeExam]);

  const examExportGate = useMemo(
    () => (activeExam ? checkExamExportGate(activeExam) : null),
    [activeExam]
  );

  const handleUpdateExamExportSettings = (next: ExamExportSettings) => {
    if (!activeExam || !onSaveMathExam) return;
    void onSaveMathExam({ ...activeExam, exportSettings: next }, true);
  };

  const handleExportExamDocx = async () => {
    if (!activeExam || !selectedExamCode) return;
    const version = activeExam.generatedVersions.find((v) => v.code === selectedExamCode);
    if (!version) return;
    setDownloadingExamDocx(true);
    try {
      const buf = await buildStudentExamDocxBuffer(activeExam, version);
      const blob = new Blob([buf.slice().buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `De_${activeExam.grade.replace(/\s+/g, '')}_Ma${version.code}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      onExamPrinted?.(activeExam.id, preferredFormLabel ?? 'DOCX A4');
    } finally {
      setDownloadingExamDocx(false);
    }
  };

  useEffect(() => {
    if (
      tutorial?.activeTutorial?.tutorialId === 'tutorial.print-studio' &&
      tutorial.currentStep?.stepId === 'ps-inspector-check' &&
      !showInspector
    ) {
      setShowInspector(true);
    }
  }, [
    showInspector,
    tutorial?.activeTutorial?.tutorialId,
    tutorial?.currentStep?.stepId,
  ]);

  const totalPages = 2;
  const totalMinutes = calculateActivityMinutes(selectedPack);
  const variants = normalizeWorksheetVariants(selectedPack);
  const allocatedVariants = allocateThreeWorksheets(selectedPack.questions, variants);
  const shortfallCount = allocatedVariants.reduce(
    (sum, v) => sum + v.allocated.warnings.length,
    0
  );
  const rubricWeightSum = selectedPack.rubric.reduce(
    (sum, r) => sum + (Number(r.weightPercent) || 0),
    0
  );

  const preflightChecks = [
    {
      id: 'paper-size',
      label: 'Đã chọn đúng khổ giấy (A4)',
      ok: true,
      detail: 'A4 (210 × 297 mm)',
    },
    {
      id: 'margins',
      label: 'Lề giấy phù hợp và nội dung không bị cắt',
      ok:
        settings.marginsMm.top >= 5 &&
        settings.marginsMm.right >= 5 &&
        settings.marginsMm.bottom >= 5 &&
        settings.marginsMm.left >= 5,
      detail: `Lề ${settings.marginsMm.top} mm · An toàn in ấn`,
    },
    {
      id: 'orientation',
      label: 'Hướng giấy và bố cục hiển thị đúng',
      ok: true,
      detail: orientation === 'portrait' ? 'Khổ dọc chuẩn A4' : 'Khổ ngang A4',
    },
    {
      id: 'page-num',
      label: `Số trang được hiển thị (Trang ${previewPage} / ${totalPages})`,
      ok: showPageNumbers,
      detail: showPageNumbers ? 'Đang bật đánh số trang cuối mỗi tờ' : 'Đang tắt số trang',
    },
    {
      id: 'worksheets',
      label: 'Độ phủ câu hỏi & Thời lượng bài dạy',
      ok: shortfallCount === 0 && totalMinutes === selectedPack.duration,
      detail: `${selectedPack.questions.length} câu hỏi · ${totalMinutes}/${selectedPack.duration} phút`,
    },
    {
      id: 'rubric',
      label: 'Rubric đánh giá quá trình',
      ok:
        selectedPack.rubric.length >= 3 &&
        selectedPack.rubric.length <= 5 &&
        rubricWeightSum === 100,
      detail: `${selectedPack.rubric.length} tiêu chí · Tổng tỷ trọng ${rubricWeightSum}%`,
    },
  ];

  const passedCount = preflightChecks.filter((c) => c.ok).length;

  const handleQuickMarginPreset = (preset: Exclude<MarginPreset, 'custom'>) => {
    tutorial?.emitTutorialEvent('print-inspector-or-margin-used');
    if (!onQuickUpdateSettings) return;
    const mm = preset === 'narrow' ? 10 : preset === 'wide' ? 20 : 15;
    void onQuickUpdateSettings({
      ...settings,
      marginPreset: preset,
      marginsMm: { top: mm, right: mm, bottom: mm, left: mm },
    });
  };

  const handleDirectPrintOrPdf = () => {
    window.print();
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 space-y-6 print:max-w-none print:m-0 print:p-0 print:space-y-0">
      <div className="no-print space-y-5">
        <ContextualAcademyBar
          tutorialId="tutorial.print-studio"
          label="Print Studio"
          description="Xem trước, tùy chỉnh khổ giấy, kiểm tra trước khi in và xuất tài liệu PDF A4 một chạm."
        />

        <PageBanner
          title="Print Studio"
          subtitle="Xem trước, tùy chỉnh và in hoặc xuất tài liệu, bài tập, phiếu học tập một cách nhanh chóng."
          icon={<Printer className="h-5 w-5" aria-hidden="true" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {mathExams.length > 0 && (
                <div
                  role="tablist"
                  aria-label="Nguồn tài liệu in"
                  className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80 p-0.5 text-xs font-semibold"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceMode === 'lesson-pack'}
                    onClick={() => setSourceMode('lesson-pack')}
                    className={`rounded-lg px-3 py-1.5 transition-colors ${
                      sourceMode === 'lesson-pack'
                        ? 'bg-white dark:bg-slate-900 text-[#4338CA] dark:text-indigo-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Bộ tiết dạy
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceMode === 'math-exam'}
                    onClick={() => setSourceMode('math-exam')}
                    className={`rounded-lg px-3 py-1.5 transition-colors ${
                      sourceMode === 'math-exam'
                        ? 'bg-[#635BFF] text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Đề kiểm tra ({mathExams.length})
                  </button>
                </div>
              )}

              {tutorial && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-tour-id="ps-help-btn"
                  onClick={() =>
                    tutorial.startTutorial('tutorial.print-studio', { restart: true })
                  }
                  aria-label="Hướng dẫn sử dụng Print Studio"
                >
                  <HelpCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>Hướng dẫn</span>
                </Button>
              )}
              {sourceMode === 'lesson-pack' && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-tour-id="ps-inspector-toggle"
                    onClick={() => {
                      setShowInspector((prev) => !prev);
                      tutorial?.emitTutorialEvent('print-inspector-or-margin-used');
                    }}
                  >
                    <span className="font-mono-num">
                      Kiểm tra trước khi in ({passedCount}/{preflightChecks.length})
                    </span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenInLessonStudio(selectedPack)}
                  >
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Chỉnh sửa bài dạy</span>
                  </Button>
                </>
              )}
            </div>
          }
        />
      </div>

      {/* Connected Exam Print Mode (Exam Mixer Pro -> Exam Form Designer -> Print Studio -> Smart Grading Studio) */}
      {sourceMode === 'math-exam' && activeExam ? (
        <div className="space-y-4">
          <div className="no-print rounded-2xl border border-indigo-200/80 dark:border-indigo-900 bg-white/95 dark:bg-slate-900/90 p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0 w-full sm:w-auto">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF] dark:bg-indigo-950 text-[#635BFF] dark:text-indigo-300">
                <Layers className="h-4 w-4" aria-hidden="true" />
              </span>
              <select
                aria-label="Chọn đề kiểm tra để in A4"
                value={activeExam.id}
                onChange={(e) => setSelectedExamId(e.target.value)}
                className="w-full sm:w-auto max-w-full sm:max-w-md min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate"
              >
                {mathExams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title} ({ex.generatedVersions.length} mã đề)
                  </option>
                ))}
              </select>
              <div
                role="tablist"
                aria-label="Chế độ xem đề kiểm tra trong Print Studio"
                className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5 text-xs"
              >
                <button
                  role="tab"
                  aria-selected={examSubMode === 'form-designer'}
                  type="button"
                  onClick={() => setExamSubMode('form-designer')}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                    examSubMode === 'form-designer'
                      ? 'bg-[#635BFF] text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Thiết kế mẫu đề
                </button>
                <button
                  role="tab"
                  aria-selected={examSubMode === 'matrix-preview'}
                  type="button"
                  onClick={() => setExamSubMode('matrix-preview')}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                    examSubMode === 'matrix-preview'
                      ? 'bg-[#635BFF] text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Xem nhanh & Ma trận
                </button>
              </div>
            </div>

            {examSubMode === 'matrix-preview' && (
              <div className="flex flex-wrap items-center gap-2">
                {selectedExamCode && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={downloadingExamDocx || !examExportGate?.canExport}
                    onClick={() => void handleExportExamDocx()}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {downloadingExamDocx
                        ? 'Đang tạo DOCX...'
                        : `Tải Mã ${selectedExamCode} (.DOCX)`}
                    </span>
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={activeExam.generatedVersions.length === 0}
                  onClick={() => {
                    if (activeExam.generatedVersions.length === 0) return;
                    onExamPrinted?.(activeExam.id, preferredFormLabel ?? 'In A4 PDF');
                    window.print();
                  }}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>In / Lưu PDF A4</span>
                </Button>
                {onOpenExamMixer && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenExamMixer(activeExam.id)}
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Quay lại Exam Mixer</span>
                  </Button>
                )}
                {onOpenGradingStudio && activeExam.generatedVersions.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenGradingStudio(activeExam.id)}
                  >
                    <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tạo phiếu OMR & Chấm bài</span>
                  </Button>
                )}
              </div>
            )}
          </div>

          {examSubMode === 'form-designer' ? (
            <ExamFormDesigner
              exam={activeExam}
              templates={effectiveTemplates}
              preferredFormId={preferredFormId}
              preferredFormLabel={preferredFormLabel}
              selectedExamCode={selectedExamCode}
              onSelectExamCode={setSelectedExamCode}
              onChangeTemplates={handleTemplatesChange}
              onApplyFormToExam={(examId, tpl, legacySettings) => {
                if (activeExam && activeExam.id === examId && onSaveMathExam) {
                  void onSaveMathExam({ ...activeExam, exportSettings: legacySettings }, true);
                }
                onExamFormApplied?.(examId, tpl);
              }}
              onExamPrinted={onExamPrinted}
              onOpenExamMixer={onOpenExamMixer}
              onOpenGradingStudio={onOpenGradingStudio}
              onOpenAzotaBridge={onOpenAzotaBridge}
              onNotify={onNotify}
            />
          ) : activeExam.generatedVersions.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 p-6 text-center space-y-3">
              <AlertTriangle className="h-7 w-7 text-amber-600 mx-auto" aria-hidden="true" />
              <h3 className="text-sm font-bold text-amber-950 dark:text-amber-200">
                Đề "{activeExam.title}" chưa tạo mã đề nào để in A4
              </h3>
              <p className="text-xs text-amber-900 dark:text-amber-300 max-w-lg mx-auto">
                Hãy quay lại Exam Mixer Pro để kiểm tra đáp án gốc và tạo ít nhất 1 mã đề trước khi in hoặc xuất DOCX.
              </p>
              {onOpenExamMixer && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onOpenExamMixer(activeExam.id)}
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Mở Exam Mixer để tạo mã đề</span>
                </Button>
              )}
            </div>
          ) : (
            <MathExamPrintPreview
              exam={activeExam}
              selectedCode={selectedExamCode || activeExam.generatedVersions[0].code}
              canExport={Boolean(examExportGate?.canExport)}
              onSelectCode={setSelectedExamCode}
              onChangeExportSettings={handleUpdateExamExportSettings}
              onTriggerPrint={() => {
                onExamPrinted?.(activeExam.id, preferredFormLabel ?? 'In A4 PDF');
                window.print();
              }}
            />
          )}
        </div>
      ) : (
      /* 2-Column Print Studio 4.1 Workspace (Lesson Pack Mode) */
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start print:block">
        {/* Left Column: Document Toolbar + A4 Sheet Canvas */}
        <div className="lg:col-span-8 space-y-4 print:w-full">
          {/* Document Preview Top Bar (hidden on print) */}
          <div
            data-tour-id="ps-topbar"
            className="no-print rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </span>
              <select
                id="print-studio-pack-select"
                aria-label="Chọn bộ tiết dạy xem trước A4"
                data-tour-id="ps-pack-select"
                value={selectedPack.id}
                onChange={(e) => onSelectPackId(e.target.value)}
                className="w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none truncate"
              >
                {packs.length === 0 ? (
                  <option value={selectedPack.id}>
                    {selectedPack.title || 'Phiếu bài tập – Bộ tiết dạy mới.docx'}
                  </option>
                ) : (
                  packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      Phiếu bài tập – {p.title || 'Chưa đặt tên'}.docx ({p.subject} · {p.grade})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Page Indicator */}
              <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-2 py-1 text-xs font-mono-num">
                <button
                  type="button"
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                  aria-label="Trang trước"
                  className="rounded p-0.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="px-1.5 font-medium text-slate-700 dark:text-slate-200">
                  Trang {previewPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Trang sau"
                  className="rounded p-0.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* Zoom Controls */}
              <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-2 py-1 text-xs font-mono-num">
                <button
                  type="button"
                  onClick={() =>
                    setZoomPercent((z) => (z === 115 ? 100 : 85))
                  }
                  aria-label="Thu nhỏ bản xem trước"
                  className="rounded p-0.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <select
                  aria-label="Mức thu phóng bản xem trước"
                  value={zoomPercent}
                  onChange={(e) =>
                    setZoomPercent(Number(e.target.value) as 85 | 100 | 115)
                  }
                  className="bg-transparent font-medium text-slate-700 dark:text-slate-200 focus:outline-none"
                >
                  <option value={85}>85%</option>
                  <option value={100}>100%</option>
                  <option value={115}>115%</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setZoomPercent((z) => (z === 85 ? 100 : 115))
                  }
                  aria-label="Phóng to bản xem trước"
                  className="rounded p-0.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* A4 Document Sheet Container */}
          <div
            data-tour-id="ps-preview-card"
            className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100/75 dark:bg-slate-900/90 p-4 sm:p-6 print:border-none print:bg-white print:p-0 print:rounded-none transition-transform origin-top ${
              zoomPercent === 85
                ? 'scale-[0.94]'
                : zoomPercent === 115
                ? 'scale-[1.03]'
                : 'scale-100'
            }`}
          >
            <Step5PrintPreview
              pack={selectedPack}
              settings={settings}
              onMarkCompleted={() => onMarkCompleted(selectedPack)}
              onOpenSettings={onOpenSettings}
            />
          </div>
        </div>

        {/* Right Column: Page Setup, Direct PDF Export & Pre-Print Inspector */}
        <aside className="no-print lg:col-span-4 space-y-4">
          {/* Card 1: Page Setup & Export */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            {/* Paper Size */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Khổ giấy
              </span>
              <select
                aria-label="Chọn khổ giấy in"
                defaultValue="A4"
                className="w-48 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
              >
                <option value="A4">A4 (210 × 297 mm)</option>
              </select>
            </div>

            {/* Margin Preset */}
            <div
              data-tour-id="ps-margin-presets"
              className="space-y-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Lề
                </span>
                <select
                  aria-label="Chọn định mức lề giấy"
                  value={settings.marginPreset === 'custom' ? 'standard' : settings.marginPreset}
                  onChange={(e) =>
                    handleQuickMarginPreset(
                      e.target.value as Exclude<MarginPreset, 'custom'>
                    )
                  }
                  className="w-48 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
                >
                  <option value="wide">Bình thường (2,0 cm)</option>
                  <option value="standard">Chuẩn (1,5 cm)</option>
                  <option value="narrow">Hẹp (1,0 cm)</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                {(
                  [
                    { id: 'narrow', label: 'Hẹp 10mm' },
                    { id: 'standard', label: 'Chuẩn 15mm' },
                    { id: 'wide', label: 'Rộng 20mm' },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleQuickMarginPreset(p.id)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                      settings.marginPreset === p.id
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Orientation */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Hướng giấy
              </span>
              <div className="grid grid-cols-2 gap-1.5 w-48">
                <button
                  type="button"
                  onClick={() => setOrientation('portrait')}
                  className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                    orientation === 'portrait'
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  Dọc
                </button>
                <button
                  type="button"
                  onClick={() => setOrientation('landscape')}
                  className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                    orientation === 'landscape'
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  Ngang
                </button>
              </div>
            </div>

            {/* Page Numbers Toggle */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div>
                <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Hiển thị số trang
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Hiển thị ở cuối mỗi trang (ví dụ: Trang 1 / 2)
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showPageNumbers}
                aria-label="Hiển thị số trang"
                onClick={() => setShowPageNumbers((prev) => !prev)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  showPageNumbers ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-2xs transition ${
                    showPageNumbers ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Export Formats */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Xuất (Lưu tài liệu)
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'pdf', label: 'PDF', icon: FileText },
                    { id: 'docx', label: 'DOCX', icon: FileSpreadsheet },
                    { id: 'png', label: 'Ảnh (PNG)', icon: FileImage },
                  ] as const
                ).map((fmt) => {
                  const Icon = fmt.icon;
                  const active = exportFormat === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setExportFormat(fmt.id)}
                      className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-2.5 text-xs font-medium transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50/80 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{fmt.label}</span>
                    </button>
                  );
                })}
              </div>

              <div
                data-tour-id="ps-print-actions"
                className="grid grid-cols-2 gap-2.5 pt-1"
              >
                <button
                  type="button"
                  onClick={handleDirectPrintOrPdf}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Xuất PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleDirectPrintOrPdf}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  <span>In</span>
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Pre-Print Checklist Inspector */}
          {showInspector && (
            <div
              data-tour-id="ps-inspector-panel"
              aria-label="Document Inspector — Kiểm tra chất lượng tài liệu trước khi in"
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
            >
              <div className="bg-blue-50/70 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/50 px-4 py-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Kiểm tra trước khi in
                </span>
                <span className="font-mono-num text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                  Đạt {passedCount}/{preflightChecks.length}
                </span>
              </div>
              <ul className="p-4 space-y-2.5 text-xs">
                {preflightChecks.map((chk) => (
                  <li key={chk.id} className="flex items-start gap-2.5">
                    {chk.ok ? (
                      <CheckCircle2
                        className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle
                        className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        {chk.label}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                        {chk.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
      )}
    </main>
  );
}

import { ChangeEvent, CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCheck2,
  FileDown,
  FileUp,
  Info,
  Layers,
  Printer,
  RotateCcw,
  ScanLine,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import type {
  ExamCodeBadgePosition,
  ExamFontFamily,
  ExamFormTemplate,
  ExamImageAlignment,
  ExamOptionLabelStyle,
  ExamOptionLayout,
} from '../../types/examForm';
import type {
  ExamExportSettings,
  MathExamProject,
  MathQuestion,
  QuestionGroup,
} from '../../types/mathExam';
import {
  createCustomFormTemplate,
  duplicateFormTemplate,
  inspectFormExportWarnings,
  mapFormTemplateToExportSettings,
  matchFormTemplateByLabelOrId,
  parseImportedFormTemplateJson,
  serializeFormTemplateJson,
  setDefaultFormTemplate,
  upsertFormTemplate,
} from '../../core/examFormEngine';
import {
  buildAnswerKeyDocxBuffer,
  buildStudentExamDocxBuffer,
} from '../../core/examExportEngine';
import {
  MCQ_LABELS,
  TF_LABELS,
  checkExamExportGate,
  getOptionLetterLabel,
  getStatementLetterLabel,
} from '../../core/mathIntegrity';
import {
  getSubjectProfile,
  getUniversalQuestionType,
  resolveSubjectId,
} from '../../core/subjectProfileRegistry';
import {
  MathContentRenderer,
  MathVisualAssetRenderer,
} from '../math/MathContentRenderer';
import { Button } from '../ui/DesignSystem';

type InspectorTabId = 'header' | 'student' | 'page' | 'body' | 'answer';
type PreviewPaneTab = 'student' | 'answer';

interface ExamFormDesignerProps {
  exam: MathExamProject;
  templates: ExamFormTemplate[];
  preferredFormId?: string | null;
  preferredFormLabel?: string | null;
  selectedExamCode: string;
  onSelectExamCode: (code: string) => void;
  onChangeTemplates: (next: ExamFormTemplate[]) => void;
  onApplyFormToExam: (
    examId: string,
    template: ExamFormTemplate,
    legacySettings: ExamExportSettings
  ) => void;
  onExamPrinted?: (examId: string, formLabel?: string, formId?: string) => void;
  onOpenExamMixer?: (examId: string) => void;
  onOpenGradingStudio?: (examId: string) => void;
  onOpenAzotaBridge?: (examId: string) => void;
  onNotify?: (type: 'success' | 'info' | 'warning' | 'error', message: string) => void;
}

export function ExamFormDesigner({
  exam,
  templates,
  preferredFormId,
  preferredFormLabel,
  selectedExamCode,
  onSelectExamCode,
  onChangeTemplates,
  onApplyFormToExam,
  onExamPrinted,
  onOpenExamMixer,
  onOpenGradingStudio,
  onOpenAzotaBridge,
  onNotify,
}: ExamFormDesignerProps) {
  const initialTemplate = useMemo(
    () => matchFormTemplateByLabelOrId(templates, preferredFormId, preferredFormLabel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [activeTemplateId, setActiveTemplateId] = useState<string>(initialTemplate.id);
  const [workingTemplate, setWorkingTemplate] = useState<ExamFormTemplate>(() =>
    structuredClone(initialTemplate)
  );
  const [undoStack, setUndoStack] = useState<ExamFormTemplate[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>('header');
  const [previewTab, setPreviewTab] = useState<PreviewPaneTab>('student');
  const [templateSearch, setTemplateSearch] = useState('');
  const [saveCustomOpen, setSaveCustomOpen] = useState(false);
  const [customNameDraft, setCustomNameDraft] = useState('');
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportingAnswerDocx, setExportingAnswerDocx] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync if user arrives via Universal Command Bar ("Xuất đề theo mẫu giữa học kỳ")
  useEffect(() => {
    if (!preferredFormId && !preferredFormLabel) return;
    const matched = matchFormTemplateByLabelOrId(templates, preferredFormId, preferredFormLabel);
    if (matched.id !== activeTemplateId) {
      setActiveTemplateId(matched.id);
      setWorkingTemplate(structuredClone(matched));
      setUndoStack([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredFormId, preferredFormLabel]);

  const activeVersion = useMemo(
    () =>
      exam.generatedVersions.find((v) => v.code === selectedExamCode) ??
      exam.generatedVersions[0] ??
      null,
    [exam.generatedVersions, selectedExamCode]
  );

  const exportGate = useMemo(() => checkExamExportGate(exam), [exam]);
  const exportWarnings = useMemo(
    () => inspectFormExportWarnings(exam, activeVersion, workingTemplate),
    [exam, activeVersion, workingTemplate]
  );
  const hasBlockingWarning =
    !exportGate.canExport || exportWarnings.some((w) => w.severity === 'blocking');

  const subjectProfile = useMemo(
    () => getSubjectProfile(resolveSubjectId(exam.subjectId || exam.subject)),
    [exam.subjectId, exam.subject]
  );

  const previewQuestions: MathQuestion[] = activeVersion
    ? activeVersion.questions
    : exam.questions;

  const groupMap = useMemo(
    () => new Map<string, QuestionGroup>((exam.questionGroups ?? []).map((g) => [g.id, g])),
    [exam.questionGroups]
  );

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) =>
      `${t.name} ${t.description} ${t.presetKind}`.toLowerCase().includes(q)
    );
  }, [templates, templateSearch]);

  const mutateWorking = (updater: (prev: ExamFormTemplate) => ExamFormTemplate) => {
    setWorkingTemplate((prev) => {
      setUndoStack((stack) => [...stack.slice(-19), structuredClone(prev)]);
      const next = updater(structuredClone(prev));
      next.updatedAt = new Date().toISOString();
      return next;
    });
  };

  const handleSelectTemplate = (tpl: ExamFormTemplate) => {
    setActiveTemplateId(tpl.id);
    setWorkingTemplate(structuredClone(tpl));
    setUndoStack([]);
    setSaveCustomOpen(false);
    setImportError(null);
  };

  const handleUndo = () => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setWorkingTemplate(previous);
      return stack.slice(0, -1);
    });
  };

  const handleSaveAsCustom = () => {
    const name = customNameDraft.trim() || `${workingTemplate.name} (Mẫu riêng)`;
    const created = createCustomFormTemplate(workingTemplate, name);
    const nextList = upsertFormTemplate(templates, created);
    onChangeTemplates(nextList);
    setActiveTemplateId(created.id);
    setWorkingTemplate(created);
    setUndoStack([]);
    setCustomNameDraft('');
    setSaveCustomOpen(false);
    onNotify?.('success', `Đã lưu mẫu mới "${created.name}" vào bộ nhớ cục bộ.`);
  };

  const handleSaveCurrentChanges = () => {
    const updated = { ...workingTemplate, updatedAt: new Date().toISOString() };
    const nextList = upsertFormTemplate(templates, updated);
    onChangeTemplates(nextList);
    setWorkingTemplate(updated);
    onApplyFormToExam(exam.id, updated, mapFormTemplateToExportSettings(updated));
    onNotify?.(
      'success',
      exam.generatedVersions.length > 0
        ? `Đã áp dụng mẫu "${updated.name}" cho toàn bộ ${exam.generatedVersions.length} mã đề (không làm thay đổi đáp án).`
        : `Đã lưu mẫu "${updated.name}" cho đề hiện tại (không làm thay đổi câu hỏi hay đáp án).`
    );
  };

  const handleDuplicateTemplate = () => {
    const dup = duplicateFormTemplate(workingTemplate);
    const nextList = upsertFormTemplate(templates, dup);
    onChangeTemplates(nextList);
    setActiveTemplateId(dup.id);
    setWorkingTemplate(dup);
    setUndoStack([]);
    onNotify?.('info', `Đã nhân bản thành mẫu "${dup.name}".`);
  };

  const handleSetDefault = () => {
    const savedCurrent = upsertFormTemplate(templates, workingTemplate);
    const nextList = setDefaultFormTemplate(savedCurrent, workingTemplate.id);
    onChangeTemplates(nextList);
    setWorkingTemplate((prev) => ({ ...prev, isDefault: true }));
    onNotify?.('success', `Đã đặt "${workingTemplate.name}" làm mẫu mặc định.`);
  };

  const handleDeleteCustomTemplate = (id: string) => {
    const target = templates.find((t) => t.id === id);
    if (!target || target.isBuiltIn) return;
    const remaining = templates.filter((t) => t.id !== id);
    onChangeTemplates(remaining);
    if (activeTemplateId === id && remaining.length > 0) {
      handleSelectTemplate(remaining[0]);
    }
    onNotify?.('info', `Đã xóa mẫu tùy chỉnh "${target.name}".`);
  };

  const handleExportTemplateJson = () => {
    const json = serializeFormTemplateJson(workingTemplate);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TeacherOS_MauDe_${workingTemplate.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify?.('success', `Đã xuất cấu hình mẫu "${workingTemplate.name}" (.json).`);
  };

  const handleImportTemplateJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseImportedFormTemplateJson(text);
      if (parsed.ok === false) {
        setImportError(parsed.error);
        return;
      }
      setImportError(null);
      const nextList = upsertFormTemplate(templates, parsed.template);
      onChangeTemplates(nextList);
      setActiveTemplateId(parsed.template.id);
      setWorkingTemplate(parsed.template);
      setUndoStack([]);
      onNotify?.('success', `Đã nhập mẫu đề "${parsed.template.name}".`);
    } catch {
      setImportError('Không thể đọc file JSON mẫu đề đã chọn.');
    }
  };

  const handleDownloadStudentDocx = async () => {
    if (!activeVersion || hasBlockingWarning) return;
    setExportingDocx(true);
    try {
      const buf = await buildStudentExamDocxBuffer(exam, activeVersion, workingTemplate);
      const blob = new Blob([buf.slice().buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `De_${exam.grade.replace(/\s+/g, '')}_Ma${activeVersion.code}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      onApplyFormToExam(exam.id, workingTemplate, mapFormTemplateToExportSettings(workingTemplate));
      onExamPrinted?.(exam.id, workingTemplate.name, workingTemplate.id);
      onNotify?.('success', `Đã xuất đề Mã ${activeVersion.code} (.DOCX) theo mẫu "${workingTemplate.name}".`);
    } catch (err) {
      onNotify?.(
        'error',
        err instanceof Error ? err.message : 'Không thể xuất file DOCX đề kiểm tra.'
      );
    } finally {
      setExportingDocx(false);
    }
  };

  const handleDownloadAnswerKeyDocx = async () => {
    if (!activeVersion || hasBlockingWarning) return;
    setExportingAnswerDocx(true);
    try {
      const buf = await buildAnswerKeyDocxBuffer(exam, workingTemplate);
      const blob = new Blob([buf.slice().buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DapAn_${exam.grade.replace(/\s+/g, '')}_${exam.generatedVersions.length}MaDe.docx`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify?.('success', 'Đã xuất bảng đáp án & hướng dẫn chấm (.DOCX).');
    } catch (err) {
      onNotify?.(
        'error',
        err instanceof Error ? err.message : 'Không thể xuất file đáp án DOCX.'
      );
    } finally {
      setExportingAnswerDocx(false);
    }
  };

  // Resolved display values for Live A4 Preview
  const resolvedExamTitle =
    workingTemplate.headerSettings.examTitle.trim() || exam.title;
  const resolvedSubject =
    workingTemplate.headerSettings.subjectOverride.trim() || subjectProfile.name;
  const resolvedGrade =
    workingTemplate.headerSettings.gradeOverride.trim() || exam.grade;
  const resolvedDuration =
    workingTemplate.headerSettings.durationOverrideMinutes ?? exam.durationMinutes;
  const resolvedSchoolYear =
    workingTemplate.headerSettings.schoolYear.trim() || exam.schoolYear;
  const displayCode = activeVersion?.code ?? 'GỐC';
  const optPunct = workingTemplate.bodySettings.optionLabelStyle === 'paren' ? ')' : '.';

  const a4PreviewStyle: CSSProperties = {
    fontFamily:
      workingTemplate.pageSettings.fontFamily === 'Times New Roman'
        ? '"Times New Roman", Times, serif'
        : workingTemplate.pageSettings.fontFamily === 'Arial'
        ? 'Arial, Helvetica, sans-serif'
        : '"Be Vietnam Pro", system-ui, sans-serif',
    fontSize: `${workingTemplate.pageSettings.fontSizePt}pt`,
    lineHeight: workingTemplate.pageSettings.lineHeight,
    paddingTop: `${Math.max(12, Math.round(workingTemplate.pageSettings.marginTopMm * 1.4))}px`,
    paddingRight: `${Math.max(12, Math.round(workingTemplate.pageSettings.marginRightMm * 1.4))}px`,
    paddingBottom: `${Math.max(12, Math.round(workingTemplate.pageSettings.marginBottomMm * 1.4))}px`,
    paddingLeft: `${Math.max(12, Math.round(workingTemplate.pageSettings.marginLeftMm * 1.4))}px`,
  };

  const optionGridClass =
    workingTemplate.bodySettings.optionLayout === '4-col'
      ? 'grid-cols-2 sm:grid-cols-4'
      : workingTemplate.bodySettings.optionLayout === '2-col'
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1';

  const imageAlignClass =
    workingTemplate.bodySettings.imageAlignment === 'left'
      ? 'justify-start'
      : 'justify-center';

  const renderedGroups = new Set<string>();
  let currentSection = '';

  const INSPECTOR_TABS: Array<{ id: InspectorTabId; label: string }> = [
    { id: 'header', label: 'Tiêu đề' },
    { id: 'student', label: 'Học sinh' },
    { id: 'page', label: 'Trang A4' },
    { id: 'body', label: 'Cấu trúc' },
    { id: 'answer', label: 'Đáp án' },
  ];

  return (
    <div className="space-y-3">
      {/* Honest Disclaimer + Above-the-Fold Quick Action Bar */}
      <div className="no-print rounded-2xl border border-indigo-200/70 dark:border-indigo-900/60 bg-gradient-to-r from-[#F8F9FF] via-white to-[#F5F8FF] dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/30 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Info className="h-4 w-4 text-[#5046E5] dark:text-indigo-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Exam Form Designer — Bộ thiết kế mẫu đề A4
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
              {workingTemplate.disclaimer} Chỉnh sửa bố cục không làm thay đổi câu hỏi, công thức, hình ảnh hay đáp án.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="primary"
            size="sm"
            disabled={!activeVersion || hasBlockingWarning || exportingDocx}
            onClick={() => void handleDownloadStudentDocx()}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{exportingDocx ? 'Đang xuất...' : 'Xuất DOCX'}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!activeVersion || hasBlockingWarning}
            onClick={() => {
              onExamPrinted?.(exam.id, workingTemplate.name, workingTemplate.id);
              window.print();
            }}
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            <span>In / PDF A4</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSaveCurrentChanges}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {exam.generatedVersions.length > 0
                ? `Áp dụng cho ${exam.generatedVersions.length} mã đề`
                : 'Áp dụng cho đề hiện tại'}
            </span>
          </Button>
          {onOpenExamMixer && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpenExamMixer(exam.id)}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Exam Mixer</span>
            </Button>
          )}
          {onOpenGradingStudio && exam.generatedVersions.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpenGradingStudio(exam.id)}
            >
              <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tạo phiếu OMR</span>
            </Button>
          )}
          {onOpenAzotaBridge && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpenAzotaBridge(exam.id)}
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Xuất cho Azota</span>
            </Button>
          )}
        </div>
      </div>

      {/* 3-Column Visual Form Editor (Section 12.3) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN (3 cols): Template Presets & Custom Templates */}
        <aside
          aria-label="Danh sách mẫu đề kiểm tra"
          className="no-print xl:col-span-3 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-200 whitespace-nowrap">
              Mẫu đề ({templates.length})
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleExportTemplateJson}
                title="Xuất mẫu đang chọn thành file JSON"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-[#635BFF]"
              >
                <FileDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>Xuất JSON</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Nhập mẫu đề từ file JSON"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-[#635BFF]"
              >
                <FileUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>Nhập</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Nhập file JSON mẫu đề"
                onChange={(e) => void handleImportTemplateJson(e)}
              />
            </div>
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              placeholder="Lọc mẫu (15 phút, giữa kỳ, thi thử...)"
              aria-label="Tìm mẫu đề kiểm tra"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#635BFF] focus:outline-none"
            />
          </div>

          {importError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 px-2.5 py-2 text-[11px] text-rose-800 dark:text-rose-200"
            >
              {importError}
            </div>
          )}

          <div className="max-h-[540px] overflow-y-auto space-y-1.5 pr-0.5">
            {filteredTemplates.map((tpl) => {
              const isSelected = tpl.id === activeTemplateId;
              return (
                <div
                  key={tpl.id}
                  className={`rounded-xl border p-2.5 transition-all ${
                    isSelected
                      ? 'border-[#635BFF] bg-[#F5F6FF] dark:bg-indigo-950/50 shadow-xs'
                      : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 hover:border-indigo-300 dark:hover:border-indigo-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSelectTemplate(tpl)}
                      className="text-left min-w-0 flex-1"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {tpl.name}
                        </span>
                        {tpl.isDefault && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                            <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                            Mặc định
                          </span>
                        )}
                        {!tpl.isBuiltIn && (
                          <span className="rounded bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
                            Mẫu riêng
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-snug">
                        {tpl.description}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                        <span>{tpl.pageSettings.orientation === 'landscape' ? 'A4 Ngang' : 'A4 Dọc'}</span>
                        <span>·</span>
                        <span>{tpl.pageSettings.columns} cột</span>
                        <span>·</span>
                        <span>{tpl.pageSettings.fontSizePt}pt</span>
                      </div>
                    </button>
                    {!tpl.isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomTemplate(tpl.id)}
                        aria-label={`Xóa mẫu ${tpl.name}`}
                        className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* CENTER COLUMN (5 cols): Live A4 Preview + Warnings + Code Switcher */}
        <section
          aria-label="Xem trước trang A4 trực tiếp"
          className="xl:col-span-5 space-y-3 min-w-0"
        >
          {/* Preview Controls Bar */}
          <div className="no-print rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setPreviewTab('student')}
                className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                  previewTab === 'student'
                    ? 'bg-[#635BFF] text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Đề học sinh A4
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('answer')}
                className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                  previewTab === 'answer'
                    ? 'bg-[#635BFF] text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Đáp án ({exam.generatedVersions.length} mã)
              </button>
            </div>

            {exam.generatedVersions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                {exam.generatedVersions.map((ver) => (
                  <button
                    key={ver.code}
                    type="button"
                    onClick={() => onSelectExamCode(ver.code)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-bold font-mono-num transition-colors ${
                      ver.code === activeVersion?.code
                        ? 'border-[#635BFF] bg-[#EEF0FF] text-[#4338CA] dark:bg-indigo-950 dark:text-indigo-200'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Mã {ver.code}
                  </button>
                ))}
              </div>
            ) : (
              <span className="rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                Xem trước đề gốc (chưa trộn mã)
              </span>
            )}
          </div>

          {/* Pre-Export Warnings (Section 12.5) */}
          {exportWarnings.length > 0 && (
            <div className="no-print space-y-1.5">
              {exportWarnings.map((w) => (
                <div
                  key={w.id}
                  role={w.severity === 'blocking' ? 'alert' : 'status'}
                  className={`rounded-xl border px-3 py-2 text-xs flex items-start gap-2 ${
                    w.severity === 'blocking'
                      ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200'
                      : 'border-sky-200 dark:border-sky-800 bg-sky-50/80 dark:bg-sky-950/40 text-sky-950 dark:text-sky-200'
                  }`}
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="font-semibold">{w.message}</div>
                    <div className="text-[11px] opacity-90">{w.recommendation}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Live A4 Sheet */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/70 p-3 sm:p-4 overflow-x-auto">
            {previewTab === 'student' ? (
              <article
                data-testid="exam-form-a4-preview"
                className={`a4-sheet mx-auto bg-white text-slate-900 rounded-lg shadow-sm border border-slate-200 transition-all ${
                  workingTemplate.pageSettings.orientation === 'landscape'
                    ? 'max-w-[780px]'
                    : 'max-w-[640px]'
                }`}
                style={a4PreviewStyle}
              >
                {/* Top-Box Exam Code Position */}
                {workingTemplate.headerSettings.showExamCode &&
                  workingTemplate.pageSettings.examCodePosition === 'top-box' && (
                    <div className="flex justify-end mb-2">
                      <span className="border-2 border-slate-900 px-3 py-0.5 text-xs font-bold font-mono-num">
                        MÃ ĐỀ: {displayCode}
                      </span>
                    </div>
                  )}

                {/* Formal Header */}
                <div className="grid grid-cols-12 gap-3 border-b-2 border-slate-800 pb-2.5 mb-3">
                  <div className="col-span-5 text-center space-y-0.5">
                    <div className="text-[0.82em] font-semibold uppercase tracking-wide">
                      {workingTemplate.headerSettings.departmentName}
                    </div>
                    <div className="text-[0.9em] font-bold uppercase">
                      {workingTemplate.headerSettings.schoolName}
                    </div>
                    {workingTemplate.headerSettings.subjectGroupName.trim() && (
                      <div className="text-[0.8em] font-medium">
                        {workingTemplate.headerSettings.subjectGroupName}
                      </div>
                    )}
                    <div className="mx-auto w-20 border-b border-slate-700 pt-0.5" />
                    {workingTemplate.headerSettings.showQuestionCountSubtitle && (
                      <div className="text-[0.78em] italic text-slate-600 pt-0.5">
                        Đề gồm {previewQuestions.length} câu hỏi
                      </div>
                    )}
                  </div>

                  <div className="col-span-7 text-center space-y-0.5">
                    <div className="text-[1.02em] font-bold uppercase leading-snug">
                      {resolvedExamTitle}
                    </div>
                    <div className="text-[0.85em] font-semibold">
                      Năm học {resolvedSchoolYear} · Môn: {resolvedSubject} · {resolvedGrade}
                    </div>
                    <div className="text-[0.82em]">
                      Thời gian làm bài: {resolvedDuration} phút (không kể thời gian phát đề)
                    </div>
                    {workingTemplate.headerSettings.showExamCode &&
                      workingTemplate.pageSettings.examCodePosition !== 'top-box' && (
                        <div
                          className={`pt-1 ${
                            workingTemplate.pageSettings.examCodePosition === 'header-right'
                              ? 'text-right'
                              : 'text-center'
                          }`}
                        >
                          <span className="inline-block border-2 border-slate-900 px-2.5 py-0.5 text-[0.85em] font-bold font-mono-num">
                            MÃ ĐỀ: {displayCode}
                          </span>
                        </div>
                      )}
                  </div>
                </div>

                {/* Student Info Block */}
                {workingTemplate.studentInfoSettings.showStudentBlock && (
                  <div className="rounded border border-slate-300 px-3 py-1.5 mb-3 text-[0.85em] flex flex-wrap gap-x-5 gap-y-1">
                    {workingTemplate.studentInfoSettings.showFullName && (
                      <span>Họ và tên: ........................................</span>
                    )}
                    {workingTemplate.studentInfoSettings.showClassName && (
                      <span>Lớp: ............</span>
                    )}
                    {workingTemplate.studentInfoSettings.showExamNumber && (
                      <span>SBD: ..................</span>
                    )}
                    {workingTemplate.studentInfoSettings.showStudentId && (
                      <span>Mã HS: ..............</span>
                    )}
                    {workingTemplate.studentInfoSettings.showExamDate && (
                      <span>Ngày KT: ..../..../20....</span>
                    )}
                  </div>
                )}

                {workingTemplate.headerSettings.headerNote.trim() && (
                  <p className="text-[0.82em] italic text-slate-600 mb-3">
                    {workingTemplate.headerSettings.headerNote}
                  </p>
                )}

                {/* Questions Body (supports 1 or 2 columns cleanly) */}
                <div
                  className={
                    workingTemplate.pageSettings.columns === 2
                      ? 'md:columns-2 md:gap-5 space-y-2.5'
                      : ''
                  }
                >
                  {previewQuestions.map((q, idx) => {
                    const showSection =
                      workingTemplate.bodySettings.showSectionTitles &&
                      Boolean(q.sectionTitle) &&
                      q.sectionTitle !== currentSection;
                    if (showSection && q.sectionTitle) {
                      currentSection = q.sectionTitle;
                    }

                    let groupToRender: QuestionGroup | null = null;
                    if (q.groupId && !renderedGroups.has(q.groupId) && groupMap.has(q.groupId)) {
                      renderedGroups.add(q.groupId);
                      groupToRender = groupMap.get(q.groupId)!;
                    }

                    const uType = getUniversalQuestionType(q);
                    const qPrefix = workingTemplate.bodySettings.questionNumberPrefix.trim() || 'Câu';

                    return (
                      <div
                        key={`${displayCode}-${q.id}`}
                        className="break-inside-avoid"
                        style={{
                          marginBottom: `${workingTemplate.pageSettings.questionSpacingPx}px`,
                        }}
                      >
                        {showSection && (
                          <div className="mb-1.5 border-b border-slate-200 pb-0.5">
                            <h4 className="text-[0.92em] font-bold uppercase text-slate-900">
                              {q.sectionTitle}
                            </h4>
                            {workingTemplate.bodySettings.showSectionInstructions &&
                              workingTemplate.bodySettings.sectionInstructionsOverride.trim() && (
                                <p className="text-[0.82em] italic text-slate-600">
                                  {workingTemplate.bodySettings.sectionInstructionsOverride}
                                </p>
                              )}
                          </div>
                        )}

                        {groupToRender && (
                          <div className="mb-2 rounded border border-slate-300 bg-slate-50/70 p-2 text-[0.88em]">
                            <div className="font-semibold">{groupToRender.title}</div>
                            {groupToRender.sharedContext.rawSource.trim() && (
                              <MathContentRenderer payload={groupToRender.sharedContext} />
                            )}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div>
                            <strong className="font-bold">
                              {qPrefix} {idx + 1}
                              {workingTemplate.bodySettings.showPointsPerQuestion &&
                              q.points > 0
                                ? ` (${q.points} điểm)`
                                : ''}
                              :{' '}
                            </strong>
                            <MathContentRenderer payload={q.stem} />
                          </div>

                          {(q.visualAssets ?? []).length > 0 && (
                            <div className={`flex flex-wrap gap-2 py-1 ${imageAlignClass}`}>
                              {(q.visualAssets ?? []).map((asset) => (
                                <MathVisualAssetRenderer key={asset.id} asset={asset} />
                              ))}
                            </div>
                          )}

                          {q.type === 'mcq' && q.options && (
                            <div className={`grid gap-x-3 gap-y-1 pl-2 ${optionGridClass}`}>
                              {q.options.map((opt, oIdx) => {
                                const lbl = MCQ_LABELS[oIdx] ?? getOptionLetterLabel(oIdx);
                                return (
                                  <div key={opt.id} className="min-w-0">
                                    <strong>
                                      {lbl}
                                      {optPunct}{' '}
                                    </strong>
                                    <MathContentRenderer payload={opt.content} />
                                    {opt.visualAsset && (
                                      <div className="mt-1">
                                        <MathVisualAssetRenderer asset={opt.visualAsset} />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {q.type === 'true-false' && q.statements && (
                            <div className="space-y-1 pl-2">
                              {q.statements.map((st, sIdx) => {
                                const lbl = TF_LABELS[sIdx] ?? getStatementLetterLabel(sIdx);
                                return (
                                  <div key={st.id}>
                                    <strong>{lbl}) </strong>
                                    <MathContentRenderer payload={st.content} />
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {uType === 'essay' && q.essayParts && q.essayParts.length > 0 && (
                            <div className="space-y-1 pl-2">
                              {q.essayParts.map((part) => (
                                <div key={part.id}>
                                  <strong>
                                    {part.label} ({part.points} điểm):{' '}
                                  </strong>
                                  <MathContentRenderer payload={part.content} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer */}
                {workingTemplate.footerSettings.showEndMarker && (
                  <div className="mt-5 text-center font-bold text-[0.9em]">
                    {workingTemplate.footerSettings.endMarkerText || '——— HẾT ———'}
                  </div>
                )}
                {(workingTemplate.footerSettings.footerNote.trim() ||
                  workingTemplate.pageSettings.showPageNumbers ||
                  workingTemplate.footerSettings.showCodeInFooter) && (
                  <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between gap-2 text-[0.78em] italic text-slate-600">
                    <span className="truncate">
                      {workingTemplate.footerSettings.footerNote}
                    </span>
                    <span className="shrink-0 font-mono-num">
                      {[
                        workingTemplate.footerSettings.showCodeInFooter &&
                        workingTemplate.headerSettings.showExamCode
                          ? `Mã ${displayCode}`
                          : null,
                        workingTemplate.pageSettings.showPageNumbers ? 'Trang 1' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                )}
              </article>
            ) : (
              /* Answer Key Preview Pane */
              <div className="mx-auto max-w-[640px] rounded-lg bg-white border border-slate-200 p-5 text-slate-900 space-y-4">
                <div className="border-b border-slate-200 pb-2 text-center">
                  <h4 className="text-sm font-bold uppercase">
                    BẢNG ĐÁP ÁN & HƯỚNG DẪN CHẤM — {resolvedExamTitle}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {workingTemplate.headerSettings.schoolName} · {resolvedSubject} · {resolvedGrade}
                  </p>
                </div>

                {exam.generatedVersions.length === 0 ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    Chưa có mã đề nào được tạo. Hãy trộn mã đề trong Exam Mixer Pro để xem bảng đáp án tổng hợp theo từng mã.
                  </p>
                ) : (
                  <>
                    {workingTemplate.answerLayout.includePerCodeAnswerTable && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse border border-slate-300">
                          <thead>
                            <tr className="bg-slate-100">
                              <th className="border border-slate-300 px-2 py-1 text-left">Câu</th>
                              {exam.generatedVersions.map((v) => (
                                <th
                                  key={v.code}
                                  className="border border-slate-300 px-2 py-1 text-center font-mono-num"
                                >
                                  Mã {v.code}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {exam.generatedVersions[0].answerKeyRows.map((_, qIdx) => (
                              <tr key={qIdx}>
                                <td className="border border-slate-300 px-2 py-1 font-medium">
                                  Câu {qIdx + 1}
                                </td>
                                {exam.generatedVersions.map((v) => (
                                  <td
                                    key={v.code}
                                    className="border border-slate-300 px-2 py-1 text-center font-semibold text-indigo-800"
                                  >
                                    {v.answerKeyRows[qIdx]?.answer ?? '—'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-900 flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        Đáp án được lấy trực tiếp từ Answer Mapping đã xác nhận — chỉnh sửa mẫu trình bày không bao giờ làm sai lệch đáp án.
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN (4 cols): Structured Property Inspector & Actions */}
        <aside
          aria-label="Thuộc tính mẫu đề đang chọn"
          className="no-print xl:col-span-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3.5"
        >
          {/* Template Lifecycle Controls */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                {workingTemplate.name}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Phiên bản v{workingTemplate.version}
                {undoStack.length > 0 ? ` · ${undoStack.length} thay đổi chưa lưu` : ''}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                disabled={undoStack.length === 0}
                onClick={handleUndo}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:border-[#635BFF]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Hoàn tác</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomNameDraft(`${workingTemplate.name} (Riêng)`);
                  setSaveCustomOpen((v) => !v);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-[#EEF0FF] dark:bg-indigo-950 px-2 py-1 text-[11px] font-semibold text-[#4338CA] dark:text-indigo-200 hover:bg-indigo-100"
              >
                <BookmarkPlus className="h-3 w-3" aria-hidden="true" />
                <span>Lưu mẫu riêng</span>
              </button>
              <button
                type="button"
                onClick={handleDuplicateTemplate}
                title="Nhân bản mẫu"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-[#635BFF]"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                <span>Nhân bản</span>
              </button>
              <button
                type="button"
                onClick={handleSetDefault}
                title="Đặt mẫu này làm mặc định"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-amber-400"
              >
                <Star className="h-3 w-3 text-amber-500" aria-hidden="true" />
                <span>Mặc định</span>
              </button>
            </div>
          </div>

          {/* Inline Save Custom Template Box */}
          {saveCustomOpen && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-[#F8F9FF] dark:bg-indigo-950/40 p-2.5 space-y-2">
              <label
                htmlFor="custom-form-name-input"
                className="block text-[11px] font-semibold text-indigo-950 dark:text-indigo-200"
              >
                Đặt tên mẫu đề riêng của bạn
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="custom-form-name-input"
                  type="text"
                  value={customNameDraft}
                  onChange={(e) => setCustomNameDraft(e.target.value)}
                  placeholder="VD: Mẫu GK1 Trường THPT Nguyễn Du"
                  className="flex-1 rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-[#635BFF] focus:outline-none"
                />
                <Button variant="primary" size="sm" onClick={handleSaveAsCustom}>
                  Lưu
                </Button>
              </div>
            </div>
          )}

          {/* 5 Property Tabs */}
          <div
            role="tablist"
            aria-label="Nhóm thuộc tính mẫu đề"
            className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 dark:bg-slate-950 p-1"
          >
            {INSPECTOR_TABS.map((t) => {
              const active = inspectorTab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setInspectorTab(t.id)}
                  className={`rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-white dark:bg-slate-800 text-[#4338CA] dark:text-indigo-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Tab Panels */}
          <div className="space-y-3 text-xs max-h-[380px] overflow-y-auto pr-1">
            {inspectorTab === 'header' && (
              <>
                <div className="space-y-1">
                  <label htmlFor="form-dept-input" className="font-semibold text-slate-700 dark:text-slate-300">
                    Đơn vị chủ quản (Sở / Phòng GD&ĐT)
                  </label>
                  <input
                    id="form-dept-input"
                    type="text"
                    value={workingTemplate.headerSettings.departmentName}
                    onChange={(e) =>
                      mutateWorking((p) => ({
                        ...p,
                        headerSettings: { ...p.headerSettings, departmentName: e.target.value },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="form-school-input" className="font-semibold text-slate-700 dark:text-slate-300">
                    Tên trường
                  </label>
                  <input
                    id="form-school-input"
                    type="text"
                    value={workingTemplate.headerSettings.schoolName}
                    onChange={(e) =>
                      mutateWorking((p) => ({
                        ...p,
                        headerSettings: { ...p.headerSettings, schoolName: e.target.value },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="form-group-input" className="font-semibold text-slate-700 dark:text-slate-300">
                      Tổ bộ môn
                    </label>
                    <input
                      id="form-group-input"
                      type="text"
                      value={workingTemplate.headerSettings.subjectGroupName}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          headerSettings: { ...p.headerSettings, subjectGroupName: e.target.value },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-year-input" className="font-semibold text-slate-700 dark:text-slate-300">
                      Năm học
                    </label>
                    <input
                      id="form-year-input"
                      type="text"
                      value={workingTemplate.headerSettings.schoolYear}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          headerSettings: { ...p.headerSettings, schoolYear: e.target.value },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="form-title-input" className="font-semibold text-slate-700 dark:text-slate-300">
                    Tên kỳ kiểm tra
                  </label>
                  <input
                    id="form-title-input"
                    type="text"
                    value={workingTemplate.headerSettings.examTitle}
                    onChange={(e) =>
                      mutateWorking((p) => ({
                        ...p,
                        headerSettings: { ...p.headerSettings, examTitle: e.target.value },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="form-subject-input" className="font-semibold text-slate-700 dark:text-slate-300">
                      Môn học
                    </label>
                    <input
                      id="form-subject-input"
                      type="text"
                      placeholder={subjectProfile.name}
                      value={workingTemplate.headerSettings.subjectOverride}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          headerSettings: { ...p.headerSettings, subjectOverride: e.target.value },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-grade-input" className="font-semibold text-slate-700 dark:text-slate-300">
                      Khối lớp
                    </label>
                    <input
                      id="form-grade-input"
                      type="text"
                      placeholder={exam.grade}
                      value={workingTemplate.headerSettings.gradeOverride}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          headerSettings: { ...p.headerSettings, gradeOverride: e.target.value },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-dur-input" className="font-semibold text-slate-700 dark:text-slate-300">
                      Phút
                    </label>
                    <input
                      id="form-dur-input"
                      type="number"
                      min={5}
                      max={240}
                      placeholder={String(exam.durationMinutes)}
                      value={workingTemplate.headerSettings.durationOverrideMinutes ?? ''}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          headerSettings: {
                            ...p.headerSettings,
                            durationOverrideMinutes: e.target.value
                              ? Number(e.target.value)
                              : null,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="form-note-input" className="font-semibold text-slate-700 dark:text-slate-300">
                    Ghi chú đầu đề
                  </label>
                  <input
                    id="form-note-input"
                    type="text"
                    value={workingTemplate.headerSettings.headerNote}
                    onChange={(e) =>
                      mutateWorking((p) => ({
                        ...p,
                        headerSettings: { ...p.headerSettings, headerNote: e.target.value },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={workingTemplate.headerSettings.showExamCode}
                    onChange={(e) =>
                      mutateWorking((p) => ({
                        ...p,
                        headerSettings: { ...p.headerSettings, showExamCode: e.target.checked },
                      }))
                    }
                  />
                  <span>Hiển thị khung Mã đề</span>
                </label>
              </>
            )}

            {inspectorTab === 'student' && (
              <div className="space-y-2.5">
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={workingTemplate.studentInfoSettings.showStudentBlock}
                    onChange={(e) =>
                      mutateWorking((p) => ({
                        ...p,
                        studentInfoSettings: {
                          ...p.studentInfoSettings,
                          showStudentBlock: e.target.checked,
                        },
                      }))
                    }
                  />
                  <span>Hiển thị khung thông tin học sinh</span>
                </label>
                {workingTemplate.studentInfoSettings.showStudentBlock && (
                  <div className="grid grid-cols-1 gap-2 pl-4 border-l-2 border-indigo-100 dark:border-indigo-900">
                    {(
                      [
                        ['showFullName', 'Họ và tên thí sinh'],
                        ['showClassName', 'Lớp'],
                        ['showExamNumber', 'Số báo danh'],
                        ['showStudentId', 'Mã học sinh'],
                        ['showExamDate', 'Ngày kiểm tra'],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={workingTemplate.studentInfoSettings[field]}
                          onChange={(e) =>
                            mutateWorking((p) => ({
                              ...p,
                              studentInfoSettings: {
                                ...p.studentInfoSettings,
                                [field]: e.target.checked,
                              },
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {inspectorTab === 'page' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="form-orient-select" className="font-semibold">
                      Hướng giấy A4
                    </label>
                    <select
                      id="form-orient-select"
                      value={workingTemplate.pageSettings.orientation}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          pageSettings: {
                            ...p.pageSettings,
                            orientation: e.target.value as 'portrait' | 'landscape',
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    >
                      <option value="portrait">A4 Dọc (Portrait)</option>
                      <option value="landscape">A4 Ngang (Landscape)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-cols-select" className="font-semibold">
                      Chia cột trang
                    </label>
                    <select
                      id="form-cols-select"
                      value={workingTemplate.pageSettings.columns}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          pageSettings: {
                            ...p.pageSettings,
                            columns: Number(e.target.value) === 2 ? 2 : 1,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    >
                      <option value={1}>1 cột chuẩn</option>
                      <option value={2}>2 cột (tiết kiệm giấy)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="form-font-select" className="font-semibold">
                      Font chữ tiếng Việt
                    </label>
                    <select
                      id="form-font-select"
                      value={workingTemplate.pageSettings.fontFamily}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          pageSettings: {
                            ...p.pageSettings,
                            fontFamily: e.target.value as ExamFontFamily,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    >
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Be Vietnam Pro">Be Vietnam Pro</option>
                      <option value="Arial">Arial</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-codepos-select" className="font-semibold">
                      Vị trí mã đề
                    </label>
                    <select
                      id="form-codepos-select"
                      value={workingTemplate.pageSettings.examCodePosition}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          pageSettings: {
                            ...p.pageSettings,
                            examCodePosition: e.target.value as ExamCodeBadgePosition,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    >
                      <option value="header-right">Góc phải tiêu đề</option>
                      <option value="header-center">Giữa tiêu đề</option>
                      <option value="top-box">Khung riêng đầu trang</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="form-fsize-input" className="font-semibold">
                      Cỡ chữ (pt)
                    </label>
                    <input
                      id="form-fsize-input"
                      type="number"
                      min={10}
                      max={15}
                      step={0.5}
                      value={workingTemplate.pageSettings.fontSizePt}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          pageSettings: {
                            ...p.pageSettings,
                            fontSizePt: Math.max(10, Math.min(15, Number(e.target.value) || 12)),
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-lh-input" className="font-semibold">
                      Giãn dòng
                    </label>
                    <input
                      id="form-lh-input"
                      type="number"
                      min={1.1}
                      max={2}
                      step={0.05}
                      value={workingTemplate.pageSettings.lineHeight}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          pageSettings: {
                            ...p.pageSettings,
                            lineHeight: Math.max(1.1, Math.min(2, Number(e.target.value) || 1.4)),
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-qgap-input" className="font-semibold">
                      Cách câu (px)
                    </label>
                    <input
                      id="form-qgap-input"
                      type="number"
                      min={6}
                      max={28}
                      value={workingTemplate.pageSettings.questionSpacingPx}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          pageSettings: {
                            ...p.pageSettings,
                            questionSpacingPx: Math.max(
                              6,
                              Math.min(28, Number(e.target.value) || 12)
                            ),
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      ['marginTopMm', 'Lề trên'],
                      ['marginBottomMm', 'Lề dưới'],
                      ['marginLeftMm', 'Lề trái'],
                      ['marginRightMm', 'Lề phải'],
                    ] as const
                  ).map(([field, lbl]) => (
                    <div key={field} className="space-y-1">
                      <label className="text-[11px] font-semibold block">{lbl} (mm)</label>
                      <input
                        type="number"
                        min={8}
                        max={30}
                        value={workingTemplate.pageSettings[field]}
                        onChange={(e) =>
                          mutateWorking((p) => ({
                            ...p,
                            pageSettings: {
                              ...p.pageSettings,
                              [field]: Math.max(8, Math.min(30, Number(e.target.value) || 15)),
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                      />
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workingTemplate.pageSettings.showPageNumbers}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          pageSettings: {
                            ...p.pageSettings,
                            showPageNumbers: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>Hiển thị số trang ở chân trang</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workingTemplate.footerSettings.showCodeInFooter}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          footerSettings: {
                            ...p.footerSettings,
                            showCodeInFooter: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>Lặp lại mã đề ở chân trang</span>
                  </label>
                </div>
              </>
            )}

            {inspectorTab === 'body' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="form-optlayout-select" className="font-semibold">
                      Bố trí A/B/C/D
                    </label>
                    <select
                      id="form-optlayout-select"
                      value={workingTemplate.bodySettings.optionLayout}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          bodySettings: {
                            ...p.bodySettings,
                            optionLayout: e.target.value as ExamOptionLayout,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    >
                      <option value="1-col">1 cột (dọc)</option>
                      <option value="2-col">2 cột cân đối</option>
                      <option value="4-col">4 cột trên 1 hàng</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-optstyle-select" className="font-semibold">
                      Ký hiệu phương án
                    </label>
                    <select
                      id="form-optstyle-select"
                      value={workingTemplate.bodySettings.optionLabelStyle}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          bodySettings: {
                            ...p.bodySettings,
                            optionLabelStyle: e.target.value as ExamOptionLabelStyle,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    >
                      <option value="dot">A. B. C. D.</option>
                      <option value="paren">A) B) C) D)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="form-qprefix-input" className="font-semibold">
                      Tiền tố câu hỏi
                    </label>
                    <input
                      id="form-qprefix-input"
                      type="text"
                      value={workingTemplate.bodySettings.questionNumberPrefix}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          bodySettings: {
                            ...p.bodySettings,
                            questionNumberPrefix: e.target.value,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="form-imgalign-select" className="font-semibold">
                      Vị trí hình & đồ thị
                    </label>
                    <select
                      id="form-imgalign-select"
                      value={workingTemplate.bodySettings.imageAlignment}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          bodySettings: {
                            ...p.bodySettings,
                            imageAlignment: e.target.value as ExamImageAlignment,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs"
                    >
                      <option value="center">Căn giữa dưới đề</option>
                      <option value="left">Căn trái dưới đề</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="form-secinst-input" className="font-semibold">
                    Hướng dẫn làm bài đầu mỗi phần
                  </label>
                  <input
                    id="form-secinst-input"
                    type="text"
                    placeholder="VD: Chọn một phương án đúng nhất cho mỗi câu hỏi."
                    value={workingTemplate.bodySettings.sectionInstructionsOverride}
                    onChange={(e) =>
                      mutateWorking((p) => ({
                        ...p,
                        bodySettings: {
                          ...p.bodySettings,
                          sectionInstructionsOverride: e.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workingTemplate.bodySettings.showSectionTitles}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          bodySettings: {
                            ...p.bodySettings,
                            showSectionTitles: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>Hiển thị tiêu đề từng phần (Phần I, II, III...)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workingTemplate.bodySettings.showPointsPerQuestion}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          bodySettings: {
                            ...p.bodySettings,
                            showPointsPerQuestion: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>Hiển thị số điểm cạnh số thứ tự câu</span>
                  </label>
                </div>

                <div className="space-y-1 pt-1">
                  <label htmlFor="form-footernote-input" className="font-semibold">
                    Ghi chú chân trang
                  </label>
                  <input
                    id="form-footernote-input"
                    type="text"
                    value={workingTemplate.footerSettings.footerNote}
                    onChange={(e) =>
                      mutateWorking((p) => ({
                        ...p,
                        footerSettings: { ...p.footerSettings, footerNote: e.target.value },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                  />
                </div>
              </>
            )}

            {inspectorTab === 'answer' && (
              <div className="space-y-2.5">
                {(
                  [
                    ['includeSeparateAnswerKey', 'Tạo file/mục bảng đáp án riêng biệt'],
                    ['includePerCodeAnswerTable', 'Bảng đáp án tổng hợp theo từng mã đề'],
                    ['includeDetailedSolutions', 'Kèm lời giải chi tiết (nếu câu có lời giải)'],
                    ['includeScoringRubric', 'Kèm bảng điểm & hướng dẫn chấm'],
                    ['includeMappingAuditTable', 'Kèm bảng ánh xạ hoán vị câu/đáp án'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workingTemplate.answerLayout[field]}
                      onChange={(e) =>
                        mutateWorking((p) => ({
                          ...p,
                          answerLayout: {
                            ...p.answerLayout,
                            [field]: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Export Actions */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={exportingDocx || hasBlockingWarning}
                onClick={() => void handleDownloadStudentDocx()}
                className="w-full justify-center"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {exportingDocx
                    ? 'Đang xuất...'
                    : activeVersion
                    ? `Xuất DOCX (Mã ${activeVersion.code})`
                    : 'Xuất DOCX (cần mã đề)'}
                </span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={exportingAnswerDocx || hasBlockingWarning}
                onClick={() => void handleDownloadAnswerKeyDocx()}
                className="w-full justify-center"
              >
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{exportingAnswerDocx ? 'Đang xuất...' : 'Xuất Đáp án DOCX'}</span>
              </Button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={hasBlockingWarning}
              onClick={() => {
                if (hasBlockingWarning) return;
                onApplyFormToExam(
                  exam.id,
                  workingTemplate,
                  mapFormTemplateToExportSettings(workingTemplate)
                );
                onExamPrinted?.(exam.id, workingTemplate.name, workingTemplate.id);
                window.print();
              }}
              className="w-full justify-center"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>In / Lưu PDF A4 theo mẫu "{workingTemplate.name}"</span>
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

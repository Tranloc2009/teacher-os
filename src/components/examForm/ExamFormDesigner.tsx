import { ChangeEvent, CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentPreview } from '../shell/WorkspaceUI';
import {
  AlertTriangle,
  Archive,
  BookmarkPlus,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileCheck2,
  FileDown,
  FileText,
  FileUp,
  ImagePlus,
  Info,
  KeyRound,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  Pencil,
  Printer,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  ExamAnswerTableStyle,
  ExamBodyAlignment,
  ExamCodeBadgePosition,
  ExamEssayLineStyle,
  ExamFontFamily,
  ExamFormBlockId,
  ExamFormPostExportAuditReport,
  ExamFormTemplate,
  ExamImageAlignment,
  ExamOptionLabelStyle,
  ExamOptionLayout,
  ExamPageNumberFormat,
  ExamShortAnswerBoxStyle,
} from '../../types/examForm';
import type {
  ExamExportSettings,
  MathExamProject,
  MathQuestion,
  QuestionGroup,
} from '../../types/mathExam';
import {
  EXAM_FORM_PLACEHOLDERS,
  buildPlaceholderContext,
  createCustomFormTemplate,
  deleteCustomFormTemplate,
  duplicateFormTemplate,
  estimateExamFormPagination,
  inspectFormExportWarnings,
  mapFormTemplateToExportSettings,
  matchFormTemplateByLabelOrId,
  parseImportedFormTemplateJson,
  renameCustomFormTemplate,
  resolveAutoOptionLayout,
  resolveExamFormPlaceholders,
  saveTemplateSafely,
  serializeFormTemplateJson,
  setDefaultFormTemplate,
  upsertFormTemplate,
} from '../../core/examFormEngine';
import {
  buildAnswerKeyDocxBuffer,
  buildStudentExamDocxBuffer,
  exportMixedExamZipBundle,
  runExamFormPostExportAudit,
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
import { ExamTemplateThumbnail } from './ExamTemplateThumbnail';

type LeftSectionId =
  | 'library'
  | 'page'
  | 'branding'
  | 'questions'
  | 'typography'
  | 'header-footer'
  | 'answer-key'
  | 'manage';

type PreviewPaneTab = 'student' | 'answer';
type ZoomLevel = 75 | 90 | 100 | 115;

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

const LEFT_SECTIONS: Array<{
  id: LeftSectionId;
  label: string;
  icon: typeof LayoutTemplate;
}> = [
  { id: 'library', label: 'Thư viện mẫu', icon: LayoutTemplate },
  { id: 'page', label: 'Trang A4', icon: LayoutGrid },
  { id: 'branding', label: 'Trường & Logo', icon: Building2 },
  { id: 'questions', label: 'Phần câu hỏi', icon: ListChecks },
  { id: 'typography', label: 'Font & Cỡ chữ', icon: Type },
  { id: 'header-footer', label: 'Header & Footer', icon: FileText },
  { id: 'answer-key', label: 'Bảng đáp án', icon: KeyRound },
  { id: 'manage', label: 'Lưu & Quản lý', icon: Save },
];

const BLOCK_LABELS: Record<ExamFormBlockId, string> = {
  header: 'Tiêu đề & Logo',
  student: 'Khung học sinh',
  questions: 'Khối câu hỏi',
  footer: 'Chân trang & Số trang',
  'answer-key': 'Bảng đáp án giáo viên',
};

const ZOOM_STEPS: ZoomLevel[] = [75, 90, 100, 115];

function triggerBinaryDownload(bytes: Uint8Array, fileName: string, mimeType: string) {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
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
  const [leftSection, setLeftSection] = useState<LeftSectionId>('library');
  const [selectedBlock, setSelectedBlock] = useState<ExamFormBlockId>('header');
  const [previewTab, setPreviewTab] = useState<PreviewPaneTab>('student');
  const [zoomPercent, setZoomPercent] = useState<ZoomLevel>(100);
  const [templateSearch, setTemplateSearch] = useState('');
  const [saveCustomOpen, setSaveCustomOpen] = useState(false);
  const [customNameDraft, setCustomNameDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportingAnswerDocx, setExportingAnswerDocx] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [auditingDocx, setAuditingDocx] = useState(false);
  const [lastAuditReport, setLastAuditReport] = useState<ExamFormPostExportAuditReport | null>(
    null
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'setup' | 'inspector'>('none');
  const mobileDrawerRef = useRef<HTMLDialogElement>(null);
  const mobileDrawerTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const drawer = mobileDrawerRef.current;
    if (mobileDrawer === 'none' || !drawer) return;
    drawer.showModal();
    const desktop = window.matchMedia('(min-width: 1280px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileDrawer('none');
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      drawer.close();
      mobileDrawerTrigger.current?.focus();
    };
  }, [mobileDrawer]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  // Sync if user arrives via Universal Command Bar / Exam Mixer / Workflow Center
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

  const previewQuestions: MathQuestion[] = activeVersion ? activeVersion.questions : exam.questions;

  const paginationEstimate = useMemo(
    () => estimateExamFormPagination(previewQuestions, workingTemplate),
    [previewQuestions, workingTemplate]
  );

  const placeholderCtx = useMemo(
    () => buildPlaceholderContext(exam, activeVersion, workingTemplate),
    [exam, activeVersion, workingTemplate]
  );
  const resolveText = (raw: string) => resolveExamFormPlaceholders(raw, placeholderCtx);

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

  const handleSelectTemplate = (tpl: ExamFormTemplate, applyNow = false) => {
    setActiveTemplateId(tpl.id);
    setWorkingTemplate(structuredClone(tpl));
    setUndoStack([]);
    setSaveCustomOpen(false);
    setImportError(null);
    setLastAuditReport(null);
    if (applyNow) {
      onApplyFormToExam(exam.id, tpl, mapFormTemplateToExportSettings(tpl));
      onNotify?.(
        'success',
        `Đã áp dụng mẫu "${tpl.name}" cho ${
          exam.generatedVersions.length > 0
            ? `toàn bộ ${exam.generatedVersions.length} mã đề`
            : 'đề hiện tại'
        } (bảo toàn 100% công thức & đáp án).`
      );
    }
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
    onApplyFormToExam(exam.id, created, mapFormTemplateToExportSettings(created));
    onNotify?.('success', `Đã lưu mẫu mới "${created.name}" và áp dụng cho đề hiện tại.`);
  };

  const handleApplyAndSaveSafely = () => {
    const hasEdits = undoStack.length > 0;
    if (workingTemplate.isBuiltIn && hasEdits) {
      const { templates: nextList, savedTemplate } = saveTemplateSafely(
        templates,
        workingTemplate
      );
      onChangeTemplates(nextList);
      setActiveTemplateId(savedTemplate.id);
      setWorkingTemplate(savedTemplate);
      setUndoStack([]);
      onApplyFormToExam(exam.id, savedTemplate, mapFormTemplateToExportSettings(savedTemplate));
      onNotify?.(
        'success',
        `Đã bảo vệ mẫu chuẩn gốc và lưu bản tùy chỉnh "${savedTemplate.name}" cho toàn bộ mã đề.`
      );
      return;
    }

    const updated = { ...workingTemplate, updatedAt: new Date().toISOString() };
    if (!updated.isBuiltIn) {
      onChangeTemplates(upsertFormTemplate(templates, updated));
    }
    setWorkingTemplate(updated);
    setUndoStack([]);
    onApplyFormToExam(exam.id, updated, mapFormTemplateToExportSettings(updated));
    onNotify?.(
      'success',
      exam.generatedVersions.length > 0
        ? `Đã áp dụng mẫu "${updated.name}" cho toàn bộ ${exam.generatedVersions.length} mã đề (không làm thay đổi đáp án).`
        : `Đã áp dụng mẫu "${updated.name}" cho đề hiện tại (không làm thay đổi câu hỏi hay đáp án).`
    );
  };

  const handleDuplicateTemplate = (source: ExamFormTemplate = workingTemplate) => {
    const dup = duplicateFormTemplate(source);
    const nextList = upsertFormTemplate(templates, dup);
    onChangeTemplates(nextList);
    setActiveTemplateId(dup.id);
    setWorkingTemplate(dup);
    setUndoStack([]);
    setLeftSection('branding');
    onNotify?.('info', `Đã nhân bản thành mẫu riêng "${dup.name}" để bạn chỉnh sửa tự do.`);
  };

  const handleConfirmRename = (targetId: string) => {
    const res = renameCustomFormTemplate(templates, targetId, renameDraft);
    if (!res.renamed) {
      onNotify?.('warning', res.reason || 'Không thể đổi tên mẫu.');
      return;
    }
    onChangeTemplates(res.templates);
    if (workingTemplate.id === targetId) {
      setWorkingTemplate((prev) => ({ ...prev, name: renameDraft.trim() }));
    }
    setRenamingId(null);
    setRenameDraft('');
    onNotify?.('success', 'Đã đổi tên mẫu tùy chỉnh.');
  };

  const handleSetDefault = () => {
    const saved = workingTemplate.isBuiltIn
      ? { templates, savedTemplate: workingTemplate }
      : saveTemplateSafely(templates, workingTemplate);
    const nextList = setDefaultFormTemplate(saved.templates, saved.savedTemplate.id);
    onChangeTemplates(nextList);
    setWorkingTemplate((prev) => ({ ...prev, isDefault: true }));
    onNotify?.('success', `Đã đặt "${saved.savedTemplate.name}" làm mẫu mặc định.`);
  };

  const handleDeleteCustomTemplate = (id: string) => {
    const target = templates.find((t) => t.id === id);
    const res = deleteCustomFormTemplate(templates, id);
    if (!res.deleted) {
      onNotify?.('warning', res.reason || 'Không thể xóa mẫu.');
      setConfirmDeleteId(null);
      return;
    }
    onChangeTemplates(res.templates);
    if (activeTemplateId === id && res.templates.length > 0) {
      handleSelectTemplate(res.templates[0]);
    }
    setConfirmDeleteId(null);
    onNotify?.('info', `Đã xóa mẫu tùy chỉnh "${target?.name ?? ''}".`);
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      onNotify?.('warning', 'Logo trường nên nhỏ hơn 1MB để tối ưu file Word (.docx).');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl.startsWith('data:image/')) {
        onNotify?.('error', 'Vui lòng chọn file ảnh PNG, JPG hoặc SVG hợp lệ cho logo.');
        return;
      }
      mutateWorking((d) => {
        d.headerSettings.schoolLogoDataUrl = dataUrl;
        return d;
      });
      onNotify?.('success', 'Đã tải lên logo trường vào phần tiêu đề đề thi.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleExportTemplateJson = () => {
    const json = serializeFormTemplateJson(workingTemplate);
    const bytes = new TextEncoder().encode(json);
    const safeName = workingTemplate.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    triggerBinaryDownload(bytes, `mau-de-${safeName || 'teacheros'}.json`, 'application/json');
    onNotify?.('success', `Đã xuất file JSON cấu hình mẫu "${workingTemplate.name}".`);
  };

  const handleImportTemplateFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      const parsed = parseImportedFormTemplateJson(text);
      if (!parsed.ok) {
        setImportError(parsed.error);
        onNotify?.('error', parsed.error);
        return;
      }
      const nextList = upsertFormTemplate(templates, parsed.template);
      onChangeTemplates(nextList);
      setActiveTemplateId(parsed.template.id);
      setWorkingTemplate(parsed.template);
      setUndoStack([]);
      onNotify?.('success', `Đã nhập thành công mẫu "${parsed.template.name}".`);
    } catch {
      setImportError('Không thể đọc tệp JSON mẫu đề.');
    } finally {
      e.target.value = '';
    }
  };

  const handleRunQualityAudit = async () => {
    if (!activeVersion || hasBlockingWarning) return;
    setAuditingDocx(true);
    try {
      const buf = await buildStudentExamDocxBuffer(exam, activeVersion, workingTemplate);
      const report = await runExamFormPostExportAudit(buf, exam, activeVersion, workingTemplate);
      setLastAuditReport(report);
      if (report.errors.length === 0) {
        onNotify?.(
          'success',
          `Kiểm định OOXML Mã ${activeVersion.code} đạt: ${report.foundQuestions}/${report.expectedQuestions} câu, 0 rò rỉ đáp án.`
        );
      } else {
        onNotify?.('error', `Kiểm định phát hiện ${report.errors.length} lỗi cần xử lý.`);
      }
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Lỗi kiểm định DOCX.');
    } finally {
      setAuditingDocx(false);
    }
  };

  const handleExportStudentDocx = async () => {
    if (!activeVersion || hasBlockingWarning) return;
    setExportingDocx(true);
    try {
      const buf = await buildStudentExamDocxBuffer(exam, activeVersion, workingTemplate);
      const report = await runExamFormPostExportAudit(buf, exam, activeVersion, workingTemplate);
      setLastAuditReport(report);
      if (!report.ooxmlValid || !report.zeroAnswerLeak) {
        throw new Error(report.errors.join(' ') || 'Kiểm chứng hậu xuất DOCX không đạt.');
      }
      triggerBinaryDownload(
        buf,
        `De_${exam.grade.replace(/\s+/g, '')}_Ma${activeVersion.code}.docx`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      onApplyFormToExam(exam.id, workingTemplate, mapFormTemplateToExportSettings(workingTemplate));
      onExamPrinted?.(exam.id, workingTemplate.name, workingTemplate.id);
      onNotify?.(
        'success',
        `Đã xuất & kiểm định DOCX Mã đề ${activeVersion.code} theo mẫu "${workingTemplate.name}" (0 rò rỉ đáp án).`
      );
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Không thể xuất DOCX đề học sinh.');
    } finally {
      setExportingDocx(false);
    }
  };

  const handleExportAnswerKeyDocx = async () => {
    if (hasBlockingWarning) return;
    setExportingAnswerDocx(true);
    try {
      const buf = await buildAnswerKeyDocxBuffer(exam, workingTemplate);
      triggerBinaryDownload(
        buf,
        `Dap_an_${exam.grade.replace(/\s+/g, '')}_${exam.generatedVersions.length}_ma_de.docx`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      onNotify?.(
        'success',
        `Đã xuất DOCX bảng đáp án riêng cho ${exam.generatedVersions.length} mã đề.`
      );
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Không thể xuất DOCX đáp án.');
    } finally {
      setExportingAnswerDocx(false);
    }
  };

  const handleExportFullZipBundle = async () => {
    if (hasBlockingWarning || exam.generatedVersions.length === 0) return;
    setExportingZip(true);
    try {
      const result = await exportMixedExamZipBundle(exam, workingTemplate);
      triggerBinaryDownload(result.zipBytes, result.fileName, 'application/zip');
      onApplyFormToExam(exam.id, workingTemplate, mapFormTemplateToExportSettings(workingTemplate));
      onExamPrinted?.(exam.id, workingTemplate.name, workingTemplate.id);
      onNotify?.(
        'success',
        `Đã xuất & kiểm định trọn bộ ZIP (${exam.generatedVersions.length} mã đề + đáp án từng mã + ma trận CSV/JSON) theo mẫu "${workingTemplate.name}".`
      );
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Không thể xuất trọn bộ ZIP.');
    } finally {
      setExportingZip(false);
    }
  };

  const handlePrintPdf = () => {
    if (hasBlockingWarning) return;
    onApplyFormToExam(exam.id, workingTemplate, mapFormTemplateToExportSettings(workingTemplate));
    onExamPrinted?.(exam.id, workingTemplate.name, workingTemplate.id);
    window.print();
  };

  const insertPlaceholderIntoField = (
    field: 'examTitle' | 'headerNote' | 'footerNote',
    token: string
  ) => {
    mutateWorking((d) => {
      if (field === 'examTitle') d.headerSettings.examTitle = `${d.headerSettings.examTitle} ${token}`.trim();
      if (field === 'headerNote') d.headerSettings.headerNote = `${d.headerSettings.headerNote} ${token}`.trim();
      if (field === 'footerNote') d.footerSettings.footerNote = `${d.footerSettings.footerNote} ${token}`.trim();
      return d;
    });
  };

  const sheetFontFamily =
    workingTemplate.pageSettings.fontFamily === 'Times New Roman'
      ? '"Times New Roman", Times, serif'
      : workingTemplate.pageSettings.fontFamily === 'Arial'
        ? 'Arial, Helvetica, sans-serif'
        : '"Be Vietnam Pro", system-ui, sans-serif';

  const sheetWidthMm = workingTemplate.pageSettings.orientation === 'landscape' ? 297 : 210;
  const a4SheetStyle: CSSProperties = {
    fontFamily: sheetFontFamily,
    fontSize: `${workingTemplate.pageSettings.fontSizePt}pt`,
    lineHeight: workingTemplate.pageSettings.lineHeight,
    paddingTop: `${workingTemplate.pageSettings.marginTopMm}mm`,
    paddingRight: `${workingTemplate.pageSettings.marginRightMm}mm`,
    paddingBottom: `${workingTemplate.pageSettings.marginBottomMm}mm`,
    paddingLeft: `${workingTemplate.pageSettings.marginLeftMm}mm`,
    textAlign: workingTemplate.pageSettings.bodyAlignment === 'justify' ? 'justify' : 'left',
    width: `${sheetWidthMm}mm`,
    minHeight: workingTemplate.pageSettings.orientation === 'landscape' ? '210mm' : '297mm',
  };

  const durationDisplay =
    workingTemplate.headerSettings.durationOverrideMinutes ?? exam.durationMinutes;
  const subjectDisplay = resolveText(
    workingTemplate.headerSettings.subjectOverride.trim() || subjectProfile.name
  );
  const gradeDisplay = resolveText(workingTemplate.headerSettings.gradeOverride.trim() || exam.grade);
  const optPunct = workingTemplate.bodySettings.optionLabelStyle === 'paren' ? ')' : '.';
  const renderedGroups = new Set<string>();
  const pageBreakSet = useMemo(
    () => new Set(paginationEstimate.pageBreakBeforeIndices),
    [paginationEstimate.pageBreakBeforeIndices]
  );

  // Focus a canvas block and highlight it in Right Inspector
  const focusBlock = (blockId: ExamFormBlockId) => {
    setSelectedBlock(blockId);
    if (blockId === 'answer-key') {
      setPreviewTab('answer');
    }
  };

  const blockRingClass = (blockId: ExamFormBlockId) =>
    `cursor-pointer rounded-lg transition-all print:ring-0 print:outline-none ${
      selectedBlock === blockId
        ? 'ring-2 ring-indigo-400/80 ring-offset-2 bg-indigo-50/15'
        : 'hover:ring-1 hover:ring-indigo-300/60 hover:ring-offset-1'
    }`;

  // =========================================================================
  // LEFT PANEL CONTENT (Reusable in Desktop Sidebar & Mobile Drawer)
  // =========================================================================
  const renderLeftPanelContent = () => (
    <div className="flex flex-col h-full">
      {/* Compact Section Nav */}
      <div className="grid grid-cols-2 gap-1 p-2.5 border-b border-slate-200/80 bg-slate-50/70">
        {LEFT_SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const active = leftSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setLeftSection(sec.id)}
              className={`flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[11px] font-semibold transition-all text-left ${
                active
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200/80 hover:border-indigo-200 hover:text-indigo-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{sec.label}</span>
            </button>
          );
        })}
      </div>

      {/* Section Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-[680px]">
        {/* 1. THƯ VIỆN MẪU */}
        {leftSection === 'library' && (
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Tìm mẫu 15p, 45p, giữa kỳ, thi thử..."
                aria-label="Tìm mẫu đề kiểm tra"
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-slate-50/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>

            <div className="space-y-2">
              {filteredTemplates.map((tpl) => {
                const isActive = tpl.id === activeTemplateId;
                const isRenaming = renamingId === tpl.id;
                const isConfirmDelete = confirmDeleteId === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    className={`group rounded-2xl border p-2.5 transition-all ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-50/40 shadow-sm'
                        : 'border-slate-200/80 bg-white hover:border-indigo-200'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleSelectTemplate(tpl, false)}
                        className="shrink-0 focus:outline-none"
                        title="Xem trước mẫu này"
                      >
                        <ExamTemplateThumbnail template={tpl} active={isActive} />
                      </button>

                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              className="w-full rounded-lg border border-indigo-300 px-2 py-1 text-xs bg-white"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleConfirmRename(tpl.id)}
                              className="p-1 rounded-lg bg-indigo-600 text-white"
                              title="Lưu tên mới"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingId(null)}
                              className="p-1 rounded-lg bg-slate-100 text-slate-600"
                              title="Hủy"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap">
                            <p className="text-xs font-bold text-slate-900 leading-snug">
                              {tpl.name}
                            </p>
                            {tpl.isDefault && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                                <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                                Mặc định
                              </span>
                            )}
                            {!tpl.isBuiltIn && (
                              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100 rounded px-1 py-0.5">
                                Mẫu riêng
                              </span>
                            )}
                          </div>
                        )}
                        <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                          {tpl.description}
                        </p>
                      </div>
                    </div>

                    {/* Quick Card Actions */}
                    <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleSelectTemplate(tpl, false)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
                      >
                        <Eye className="w-3 h-3" />
                        Xem trước
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectTemplate(tpl, true)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        <Check className="w-3 h-3" />
                        Áp dụng
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicateTemplate(tpl)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                      >
                        <Copy className="w-3 h-3" />
                        Nhân bản & sửa
                      </button>

                      {!tpl.isBuiltIn && !isConfirmDelete && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(tpl.id);
                              setRenameDraft(tpl.name);
                            }}
                            className="p-1 rounded-lg text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 ml-auto"
                            title="Đổi tên mẫu riêng"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(tpl.id)}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Xóa mẫu riêng"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>

                    {isConfirmDelete && (
                      <div className="mt-2 rounded-xl bg-rose-50 border border-rose-200 p-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-rose-800">
                          Xóa mẫu này?
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomTemplate(tpl.id)}
                            className="px-2 py-0.5 rounded-lg bg-rose-600 text-white text-[11px] font-semibold"
                          >
                            Xóa
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold"
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. TRANG A4 */}
        {leftSection === 'page' && (
          <div className="space-y-3 text-xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Thiết lập khổ giấy A4 & Phân trang
            </p>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Hướng giấy A4
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['portrait', 'landscape'] as const).map((ori) => (
                  <button
                    key={ori}
                    type="button"
                    onClick={() =>
                      mutateWorking((d) => {
                        d.pageSettings.orientation = ori;
                        return d;
                      })
                    }
                    className={`py-2 rounded-xl border text-xs font-semibold ${
                      workingTemplate.pageSettings.orientation === ori
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {ori === 'portrait' ? 'A4 Dọc (Portrait)' : 'A4 Ngang (Landscape)'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Số cột nội dung trang
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {([1, 2] as const).map((cols) => (
                  <button
                    key={cols}
                    type="button"
                    onClick={() =>
                      mutateWorking((d) => {
                        d.pageSettings.columns = cols;
                        return d;
                      })
                    }
                    className={`py-2 rounded-xl border text-xs font-semibold ${
                      workingTemplate.pageSettings.columns === cols
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {cols === 1 ? '1 cột (Chuẩn)' : '2 cột (Tiết kiệm giấy)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['marginTopMm', 'Lề trên (mm)'],
                  ['marginBottomMm', 'Lề dưới (mm)'],
                  ['marginLeftMm', 'Lề trái (mm)'],
                  ['marginRightMm', 'Lề phải (mm)'],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="block">
                  <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {label}
                  </span>
                  <input
                    type="number"
                    min={8}
                    max={35}
                    value={workingTemplate.pageSettings[field]}
                    onChange={(e) =>
                      mutateWorking((d) => {
                        d.pageSettings[field] = Math.max(
                          8,
                          Math.min(35, Number(e.target.value) || 15)
                        );
                        return d;
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                  />
                </label>
              ))}
            </div>

            <label className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 cursor-pointer bg-slate-50/60">
              <span className="font-semibold text-slate-700">Hiển thị đường ngắt trang A4</span>
              <input
                type="checkbox"
                checked={workingTemplate.pageSettings.showPageBreaks ?? true}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.pageSettings.showPageBreaks = e.target.checked;
                    return d;
                  })
                }
              />
            </label>
          </div>
        )}

        {/* 3. TRƯỜNG HỌC & LOGO */}
        {leftSection === 'branding' && (
          <div className="space-y-2.5 text-xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Đơn vị chủ quản, Logo & Biến tự động
            </p>

            {/* Logo uploader */}
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-700">Logo nhà trường</span>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    Tải logo
                  </button>
                  {workingTemplate.headerSettings.schoolLogoDataUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        mutateWorking((d) => {
                          d.headerSettings.schoolLogoDataUrl = '';
                          return d;
                        })
                      }
                      className="p-1 rounded-lg text-rose-600 hover:bg-rose-50"
                      title="Gỡ logo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {workingTemplate.headerSettings.schoolLogoDataUrl && (
                <div className="flex items-center gap-2.5">
                  <img
                    src={workingTemplate.headerSettings.schoolLogoDataUrl}
                    alt="Logo trường"
                    className="h-10 w-10 object-contain rounded border border-slate-200 bg-white p-0.5"
                  />
                  <label className="flex-1">
                    <span className="block text-[10.5px] text-slate-500 mb-0.5">
                      Cỡ logo: {workingTemplate.headerSettings.schoolLogoWidthPx ?? 52}px
                    </span>
                    <input
                      type="range"
                      min={28}
                      max={84}
                      value={workingTemplate.headerSettings.schoolLogoWidthPx ?? 52}
                      onChange={(e) =>
                        mutateWorking((d) => {
                          d.headerSettings.schoolLogoWidthPx = Number(e.target.value);
                          return d;
                        })
                      }
                      className="w-full"
                    />
                  </label>
                </div>
              )}
            </div>

            {(
              [
                ['departmentName', 'Sở / Phòng GD&ĐT'],
                ['schoolName', 'Tên trường'],
                ['subjectGroupName', 'Tổ chuyên môn'],
                ['examTitle', 'Tiêu đề kỳ kiểm tra'],
                ['schoolYear', 'Năm học'],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  {label}
                </span>
                <input
                  type="text"
                  value={workingTemplate.headerSettings[field]}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.headerSettings[field] = e.target.value;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                />
              </label>
            ))}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Môn (để trống = gốc)
                </span>
                <input
                  type="text"
                  value={workingTemplate.headerSettings.subjectOverride}
                  placeholder={subjectProfile.name}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.headerSettings.subjectOverride = e.target.value;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Thời gian (phút)
                </span>
                <input
                  type="number"
                  min={5}
                  max={240}
                  value={workingTemplate.headerSettings.durationOverrideMinutes ?? ''}
                  placeholder={String(exam.durationMinutes)}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      const raw = e.target.value.trim();
                      d.headerSettings.durationOverrideMinutes = raw ? Number(raw) : null;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Ghi chú đầu trang (hỗ trợ biến tự động)
              </span>
              <textarea
                rows={2}
                value={workingTemplate.headerSettings.headerNote}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.headerSettings.headerNote = e.target.value;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              />
            </label>

            {/* Safe Placeholders */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-2.5 space-y-1.5">
              <p className="text-[10.5px] font-bold text-indigo-800">
                Chèn biến tự động vào Ghi chú đầu trang
              </p>
              <div className="flex flex-wrap gap-1">
                {EXAM_FORM_PLACEHOLDERS.map((ph) => (
                  <button
                    key={ph.token}
                    type="button"
                    onClick={() => insertPlaceholderIntoField('headerNote', ph.token)}
                    className="px-1.5 py-0.5 rounded-md bg-white border border-indigo-200 text-[10px] font-mono text-indigo-700 hover:bg-indigo-100"
                    title={`${ph.label} (VD: ${ph.example})`}
                  >
                    {ph.token}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">
                Chỉ áp dụng cho tiêu đề & ghi chú — tuyệt đối không can thiệp câu hỏi hay công thức.
              </p>
            </div>
          </div>
        )}

        {/* 4. PHẦN CÂU HỎI */}
        {leftSection === 'questions' && (
          <div className="space-y-3 text-xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Bố cục Câu hỏi, Phương án & Vùng làm bài
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Tiền tố câu
                </span>
                <input
                  type="text"
                  value={workingTemplate.bodySettings.questionNumberPrefix}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.bodySettings.questionNumberPrefix = e.target.value;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Nhãn phương án
                </span>
                <select
                  value={workingTemplate.bodySettings.optionLabelStyle}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.bodySettings.optionLabelStyle = e.target.value as ExamOptionLabelStyle;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                >
                  <option value="dot">A. B. C. D.</option>
                  <option value="paren">A) B) C) D)</option>
                </select>
              </label>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Bố cục phương án A/B/C/D
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['auto', 'Tự động (Thông minh)'],
                    ['1-col', '1 cột dọc'],
                    ['2-col', '2 cột ngang'],
                    ['4-col', '4 cột 1 hàng'],
                  ] as Array<[ExamOptionLayout, string]>
                ).map(([layout, label]) => (
                  <button
                    key={layout}
                    type="button"
                    onClick={() =>
                      mutateWorking((d) => {
                        d.bodySettings.optionLayout = layout;
                        return d;
                      })
                    }
                    className={`py-1.5 px-2 rounded-xl border text-[11px] font-semibold ${
                      workingTemplate.bodySettings.optionLayout === layout
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Vùng Trả lời ngắn
                </span>
                <select
                  value={workingTemplate.bodySettings.shortAnswerBoxStyle ?? 'dotted-line'}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.bodySettings.shortAnswerBoxStyle = e.target
                        .value as ExamShortAnswerBoxStyle;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs bg-white"
                >
                  <option value="box">Khung ghi đáp số</option>
                  <option value="dotted-line">Dòng chấm trả lời</option>
                  <option value="none">Ẩn vùng ghi</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Dòng kẻ Tự luận
                </span>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={workingTemplate.bodySettings.essayAnswerLines ?? 4}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.bodySettings.essayAnswerLines = Math.max(
                        0,
                        Math.min(12, Number(e.target.value) || 0)
                      );
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Kiểu dòng Tự luận
              </span>
              <select
                value={workingTemplate.bodySettings.essayLineStyle ?? 'dotted'}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.bodySettings.essayLineStyle = e.target.value as ExamEssayLineStyle;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="dotted">Dòng chấm (...)</option>
                <option value="lined">Dòng kẻ liền (___)</option>
                <option value="blank">Khoảng trắng tự do</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Căn lề hình vẽ / đồ thị / BBT
              </span>
              <select
                value={workingTemplate.bodySettings.imageAlignment}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.bodySettings.imageAlignment = e.target.value as ExamImageAlignment;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="center">Căn giữa trang</option>
                <option value="left">Căn trái</option>
                <option value="inline-below">Sát dưới câu hỏi</option>
              </select>
            </label>

            <div className="space-y-1.5">
              {(
                [
                  ['showSectionTitles', 'Hiển thị tiêu đề Phần I, II, III...'],
                  ['showSectionInstructions', 'Hiển thị hướng dẫn đầu mỗi phần'],
                  ['showPointsPerQuestion', 'Hiển thị điểm từng câu'],
                ] as const
              ).map(([field, label]) => (
                <label
                  key={field}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer"
                >
                  <span className="text-slate-700 font-medium">{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(workingTemplate.bodySettings[field])}
                    onChange={(e) =>
                      mutateWorking((d) => {
                        d.bodySettings[field] = e.target.checked;
                        return d;
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 5. FONT & CỠ CHỮ */}
        {leftSection === 'typography' && (
          <div className="space-y-3 text-xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Font chữ, Cỡ chữ & Giãn dòng
            </p>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Phông chữ (Word & In A4)
              </span>
              <select
                value={workingTemplate.pageSettings.fontFamily}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.pageSettings.fontFamily = e.target.value as ExamFontFamily;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="Times New Roman">Times New Roman (Chuẩn in đề)</option>
                <option value="Be Vietnam Pro">Be Vietnam Pro (Hiện đại)</option>
                <option value="Arial">Arial (Sắc nét)</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Cỡ chữ ({workingTemplate.pageSettings.fontSizePt}pt)
                </span>
                <input
                  type="range"
                  min={11}
                  max={14}
                  step={0.5}
                  value={workingTemplate.pageSettings.fontSizePt}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.pageSettings.fontSizePt = Number(e.target.value);
                      return d;
                    })
                  }
                  className="w-full"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Giãn dòng ({workingTemplate.pageSettings.lineHeight})
                </span>
                <input
                  type="range"
                  min={1.15}
                  max={1.8}
                  step={0.05}
                  value={workingTemplate.pageSettings.lineHeight}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.pageSettings.lineHeight = Number(e.target.value);
                      return d;
                    })
                  }
                  className="w-full"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Cách câu ({workingTemplate.pageSettings.questionSpacingPx}px)
                </span>
                <input
                  type="range"
                  min={8}
                  max={24}
                  step={2}
                  value={workingTemplate.pageSettings.questionSpacingPx}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.pageSettings.questionSpacingPx = Number(e.target.value);
                      return d;
                    })
                  }
                  className="w-full"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Cách đoạn ({workingTemplate.pageSettings.paragraphSpacingPt ?? 4}pt)
                </span>
                <input
                  type="range"
                  min={2}
                  max={12}
                  step={1}
                  value={workingTemplate.pageSettings.paragraphSpacingPt ?? 4}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.pageSettings.paragraphSpacingPt = Number(e.target.value);
                      return d;
                    })
                  }
                  className="w-full"
                />
              </label>
            </div>

            <div>
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Căn lề đoạn văn câu hỏi
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['left', 'Căn trái (Khuyên dùng)'],
                    ['justify', 'Căn đều hai bên'],
                  ] as Array<[ExamBodyAlignment, string]>
                ).map(([al, lbl]) => (
                  <button
                    key={al}
                    type="button"
                    onClick={() =>
                      mutateWorking((d) => {
                        d.pageSettings.bodyAlignment = al;
                        return d;
                      })
                    }
                    className={`py-1.5 rounded-xl border text-[11px] font-semibold ${
                      (workingTemplate.pageSettings.bodyAlignment ?? 'left') === al
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 6. HEADER & FOOTER */}
        {leftSection === 'header-footer' && (
          <div className="space-y-3 text-xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Mã đề, Thông tin học sinh & Chân trang
            </p>

            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Vị trí hiển thị Mã đề
              </span>
              <select
                value={workingTemplate.pageSettings.examCodePosition}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.pageSettings.examCodePosition = e.target.value as ExamCodeBadgePosition;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="header-right">Góc phải tiêu đề</option>
                <option value="top-box">Đóng khung nổi bật</option>
                <option value="header-center">Căn giữa dưới tiêu đề</option>
              </select>
            </label>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold text-slate-600">
                Khung thông tin thí sinh
              </span>
              {(
                [
                  ['showStudentBlock', 'Hiện khung thông tin học sinh'],
                  ['showFullName', 'Họ và tên thí sinh'],
                  ['showClassName', 'Lớp'],
                  ['showExamNumber', 'Số báo danh'],
                  ['showStudentId', 'Mã học sinh'],
                  ['showExamDate', 'Ngày kiểm tra'],
                ] as const
              ).map(([field, label]) => (
                <label
                  key={field}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer"
                >
                  <span className="text-slate-700">{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(workingTemplate.studentInfoSettings[field])}
                    onChange={(e) =>
                      mutateWorking((d) => {
                        d.studentInfoSettings[field] = e.target.checked;
                        return d;
                      })
                    }
                  />
                </label>
              ))}
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Dòng kết thúc đề
                </span>
                <input
                  type="text"
                  value={workingTemplate.footerSettings.endMarkerText}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.footerSettings.endMarkerText = e.target.value;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                />
              </label>

              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Ghi chú chân trang
                </span>
                <input
                  type="text"
                  value={workingTemplate.footerSettings.footerNote}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.footerSettings.footerNote = e.target.value;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                />
              </label>

              <label className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer">
                <span className="text-slate-700">Đánh số trang chân trang</span>
                <input
                  type="checkbox"
                  checked={workingTemplate.pageSettings.showPageNumbers}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.pageSettings.showPageNumbers = e.target.checked;
                      return d;
                    })
                  }
                />
              </label>

              {workingTemplate.pageSettings.showPageNumbers && (
                <select
                  value={workingTemplate.pageSettings.pageNumberFormat ?? 'page-of-total'}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.pageSettings.pageNumberFormat = e.target.value as ExamPageNumberFormat;
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                >
                  <option value="page-of-total">Trang 1 / N (Chuẩn thi cử)</option>
                  <option value="page-only">Trang 1 (Đơn giản)</option>
                </select>
              )}
            </div>
          </div>
        )}

        {/* 7. BẢNG ĐÁP ÁN */}
        {leftSection === 'answer-key' && (
          <div className="space-y-3 text-xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Thiết kế Bảng đáp án giáo viên (Xuất riêng)
            </p>
            <div>
              <span className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                Kiểu trình bày bảng đáp án
              </span>
              <div className="grid grid-cols-1 gap-1.5">
                {(
                  [
                    ['horizontal', 'Bảng đáp án hàng ngang (gọn, dễ chấm nhanh)'],
                    ['multi-column', 'Bảng đáp án nhiều cột (2 / 4 / 5 cột)'],
                    ['by-section', 'Đáp án phân tách theo từng Phần I, II, III'],
                    ['per-code', 'Đáp án riêng biệt theo từng mã đề (101–104)'],
                  ] as Array<[ExamAnswerTableStyle, string]>
                ).map(([style, label]) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => {
                      mutateWorking((d) => {
                        d.answerLayout.answerTableStyle = style;
                        return d;
                      });
                      setPreviewTab('answer');
                      setSelectedBlock('answer-key');
                    }}
                    className={`text-left px-2.5 py-2 rounded-xl border text-[11px] font-semibold transition-all ${
                      (workingTemplate.answerLayout.answerTableStyle ?? 'multi-column') === style
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(workingTemplate.answerLayout.answerTableStyle ?? 'multi-column') ===
              'multi-column' && (
              <div>
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Số cột bảng đáp án
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {([2, 4, 5] as const).map((cols) => (
                    <button
                      key={cols}
                      type="button"
                      onClick={() =>
                        mutateWorking((d) => {
                          d.answerLayout.answerColumns = cols;
                          return d;
                        })
                      }
                      className={`py-1.5 rounded-xl border text-xs font-semibold ${
                        (workingTemplate.answerLayout.answerColumns ?? 4) === cols
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      {cols} cột
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {(
                [
                  ['includeSeparateAnswerKey', 'Xuất tệp đáp án riêng (không dính đề HS)'],
                  ['includePerCodeAnswerTable', 'Kèm ma trận đáp án tổng hợp tất cả mã'],
                  ['includeMappingAuditTable', 'Kèm bảng ánh xạ hoán vị câu/phương án'],
                  ['includeDetailedSolutions', 'Kèm lời giải chi tiết (chỉ khi đề gốc có)'],
                  ['includeScoringRubric', 'Kèm biểu điểm & hướng dẫn chấm'],
                ] as const
              ).map(([field, label]) => (
                <label
                  key={field}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer"
                >
                  <span className="text-slate-700">{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(workingTemplate.answerLayout[field])}
                    onChange={(e) =>
                      mutateWorking((d) => {
                        d.answerLayout[field] = e.target.checked;
                        return d;
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 8. LƯU & QUẢN LÝ MẪU */}
        {leftSection === 'manage' && (
          <div className="space-y-3 text-xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Lưu trữ cục bộ & Chia sẻ mẫu (JSON)
            </p>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 space-y-1.5">
              <p className="font-bold text-slate-800">{workingTemplate.name}</p>
              <p className="text-[11px] text-slate-500">
                {workingTemplate.isBuiltIn
                  ? 'Mẫu chuẩn gợi ý (được bảo vệ — khi sửa sẽ tự lưu thành mẫu riêng mới).'
                  : 'Mẫu tùy chỉnh của giáo viên (lưu bền vững trong IndexedDB cục bộ).'}
              </p>
            </div>

            <div className="space-y-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Lưu thành mẫu mới của trường/cá nhân
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={customNameDraft}
                    onChange={(e) => setCustomNameDraft(e.target.value)}
                    placeholder="VD: Mẫu GK1 Trường THPT Nguyễn Du"
                    className="flex-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                  />
                  <Button variant="primary" size="sm" onClick={handleSaveAsCustom}>
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    Lưu
                  </Button>
                </div>
              </label>

              <div className="grid grid-cols-2 gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => handleDuplicateTemplate()}>
                  <Copy className="w-3.5 h-3.5" />
                  Nhân bản
                </Button>
                <Button variant="secondary" size="sm" onClick={handleSetDefault}>
                  <Star className="w-3.5 h-3.5" />
                  Đặt mặc định
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportTemplateJson}>
                  <FileDown className="w-3.5 h-3.5" />
                  Xuất JSON
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="w-3.5 h-3.5" />
                  Nhập JSON
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportTemplateFile}
                className="hidden"
              />
              {importError && (
                <p className="text-[11px] text-rose-600 font-medium">{importError}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // =========================================================================
  // RIGHT PANEL CONTENT (Block Properties Inspector + Quality Control)
  // =========================================================================
  const renderRightPanelContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-200/80 bg-slate-50/70">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
            <span className="text-xs font-bold text-slate-900">Thuộc tính khối đang chọn</span>
          </div>
          <span className="text-[10.5px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-1.5 py-0.5">
            {BLOCK_LABELS[selectedBlock]}
          </span>
        </div>
        {/* Quick Block Switcher */}
        <div className="mt-2 flex flex-wrap gap-1">
          {(['header', 'student', 'questions', 'footer', 'answer-key'] as ExamFormBlockId[]).map(
            (bId) => (
              <button
                key={bId}
                type="button"
                onClick={() => focusBlock(bId)}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-semibold transition-all ${
                  selectedBlock === bId
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {BLOCK_LABELS[bId]}
              </button>
            )
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs max-h-[680px]">
        {/* Contextual Block Controls */}
        {selectedBlock === 'header' && (
          <div className="space-y-2.5">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Tên trường hiển thị
              </span>
              <input
                type="text"
                value={workingTemplate.headerSettings.schoolName}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.headerSettings.schoolName = e.target.value;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Tiêu đề đề kiểm tra
              </span>
              <input
                type="text"
                value={workingTemplate.headerSettings.examTitle}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.headerSettings.examTitle = e.target.value;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Kiểu hiển thị Mã đề
              </span>
              <select
                value={workingTemplate.pageSettings.examCodePosition}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.pageSettings.examCodePosition = e.target.value as ExamCodeBadgePosition;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="header-right">Góc phải tiêu đề</option>
                <option value="top-box">Đóng khung nổi bật</option>
                <option value="header-center">Căn giữa dưới tiêu đề</option>
              </select>
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer">
              <span>Hiển thị Mã đề</span>
              <input
                type="checkbox"
                checked={workingTemplate.headerSettings.showExamCode}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.headerSettings.showExamCode = e.target.checked;
                    return d;
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() => setLeftSection('branding')}
              className="w-full text-center text-[11px] font-semibold text-indigo-700 hover:underline"
            >
              Mở đầy đủ Trường học, Logo & Biến tự động →
            </button>
          </div>
        )}

        {selectedBlock === 'student' && (
          <div className="space-y-2">
            {(
              [
                ['showStudentBlock', 'Bật khung thông tin thí sinh'],
                ['showFullName', 'Họ và tên'],
                ['showClassName', 'Lớp'],
                ['showExamNumber', 'Số báo danh'],
                ['showStudentId', 'Mã học sinh'],
                ['showExamDate', 'Ngày kiểm tra'],
              ] as const
            ).map(([field, label]) => (
              <label
                key={field}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer"
              >
                <span className="text-slate-700 font-medium">{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(workingTemplate.studentInfoSettings[field])}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.studentInfoSettings[field] = e.target.checked;
                      return d;
                    })
                  }
                />
              </label>
            ))}
          </div>
        )}

        {selectedBlock === 'questions' && (
          <div className="space-y-2.5">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Bố cục phương án A/B/C/D
              </span>
              <select
                value={workingTemplate.bodySettings.optionLayout}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.bodySettings.optionLayout = e.target.value as ExamOptionLayout;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="auto">Tự động theo độ dài</option>
                <option value="1-col">1 cột dọc</option>
                <option value="2-col">2 cột ngang</option>
                <option value="4-col">4 cột trên 1 dòng</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Cỡ chữ (pt)
                </span>
                <input
                  type="number"
                  min={11}
                  max={14}
                  step={0.5}
                  value={workingTemplate.pageSettings.fontSizePt}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.pageSettings.fontSizePt = Math.max(
                        11,
                        Math.min(14, Number(e.target.value) || 12)
                      );
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs bg-white"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Cách câu (px)
                </span>
                <input
                  type="number"
                  min={8}
                  max={24}
                  value={workingTemplate.pageSettings.questionSpacingPx}
                  onChange={(e) =>
                    mutateWorking((d) => {
                      d.pageSettings.questionSpacingPx = Math.max(
                        8,
                        Math.min(24, Number(e.target.value) || 12)
                      );
                      return d;
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs bg-white"
                />
              </label>
            </div>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Số cột trang A4
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {([1, 2] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      mutateWorking((d) => {
                        d.pageSettings.columns = c;
                        return d;
                      })
                    }
                    className={`py-1.5 rounded-xl border text-xs font-semibold ${
                      workingTemplate.pageSettings.columns === c
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    {c} cột
                  </button>
                ))}
              </div>
            </label>
          </div>
        )}

        {selectedBlock === 'footer' && (
          <div className="space-y-2.5">
            <label className="flex items-center justify-between rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer">
              <span>Dòng kết thúc (HẾT)</span>
              <input
                type="checkbox"
                checked={workingTemplate.footerSettings.showEndMarker}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.footerSettings.showEndMarker = e.target.checked;
                    return d;
                  })
                }
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer">
              <span>Hiện mã đề ở chân trang</span>
              <input
                type="checkbox"
                checked={workingTemplate.footerSettings.showCodeInFooter}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.footerSettings.showCodeInFooter = e.target.checked;
                    return d;
                  })
                }
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 px-2.5 py-1.5 bg-slate-50/50 cursor-pointer">
              <span>Đánh số trang tự động</span>
              <input
                type="checkbox"
                checked={workingTemplate.pageSettings.showPageNumbers}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.pageSettings.showPageNumbers = e.target.checked;
                    return d;
                  })
                }
              />
            </label>
          </div>
        )}

        {selectedBlock === 'answer-key' && (
          <div className="space-y-2.5">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                Kiểu bảng đáp án
              </span>
              <select
                value={workingTemplate.answerLayout.answerTableStyle ?? 'multi-column'}
                onChange={(e) =>
                  mutateWorking((d) => {
                    d.answerLayout.answerTableStyle = e.target.value as ExamAnswerTableStyle;
                    return d;
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="horizontal">Hàng ngang</option>
                <option value="multi-column">Nhiều cột</option>
                <option value="by-section">Theo từng phần</option>
                <option value="per-code">Riêng từng mã đề</option>
              </select>
            </label>
            <p className="text-[11px] text-slate-500">
              Bảng đáp án luôn xuất thành file DOCX riêng cho giáo viên, không bao giờ lẫn vào file
              đề học sinh.
            </p>
          </div>
        )}

        {/* Quality Control & Pagination Telemetry */}
        <div className="pt-3 border-t border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Kiểm soát chất lượng A4
            </span>
            <span
              className={`text-[10.5px] font-bold px-2 py-0.5 rounded-md ${
                hasBlockingWarning
                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}
            >
              {hasBlockingWarning ? 'Đang chặn xuất' : 'Sẵn sàng xuất'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-2.5 py-2">
              <div className="text-slate-500">Ước lượng trang</div>
              <div className="font-bold text-slate-900">
                ~{paginationEstimate.estimatedPages} trang A4
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-2.5 py-2">
              <div className="text-slate-500">Vùng in khả dụng</div>
              <div className="font-bold text-slate-900">
                {paginationEstimate.usableWidthMm}×{paginationEstimate.usableHeightMm}mm
              </div>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleRunQualityAudit}
            disabled={hasBlockingWarning || auditingDocx || !activeVersion}
            className="w-full justify-center"
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            {auditingDocx ? 'Đang kiểm định OOXML...' : 'Kiểm định DOCX trước khi in'}
          </Button>

          {lastAuditReport && (
            <div
              className={`rounded-xl border p-2.5 space-y-1.5 text-[11px] ${
                lastAuditReport.errors.length === 0
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50/70 border-rose-200 text-rose-900'
              }`}
            >
              <div className="font-bold flex items-center justify-between">
                <span>Kiểm định hậu xuất Mã {lastAuditReport.examCode}</span>
                <span>{lastAuditReport.errors.length === 0 ? 'PASS' : 'LỖI'}</span>
              </div>
              <ul className="space-y-0.5 text-[10.5px]">
                <li>
                  • OOXML hợp lệ: <strong>{lastAuditReport.ooxmlValid ? 'Có' : 'Không'}</strong>
                </li>
                <li>
                  • Số câu đọc lại:{' '}
                  <strong>
                    {lastAuditReport.foundQuestions}/{lastAuditReport.expectedQuestions}
                  </strong>
                </li>
                <li>
                  • Ảnh / Công thức nhúng: <strong>{lastAuditReport.embeddedMediaCount}</strong>
                  {lastAuditReport.hasLogoMedia ? ' (gồm Logo)' : ''}
                </li>
                <li>
                  • Rò rỉ đáp án HS:{' '}
                  <strong>{lastAuditReport.zeroAnswerLeak ? '0% (An toàn)' : 'CÓ LỖI'}</strong>
                </li>
                <li>
                  • Khớp ánh xạ hoán vị:{' '}
                  <strong>{lastAuditReport.answerMappingIntact ? 'Nguyên vẹn' : 'Lệch'}</strong>
                </li>
                <li className="text-slate-600 pt-1 border-t border-black/10">
                  • Render Word thị giác: <strong>{lastAuditReport.visualRenderStatus}</strong>{' '}
                  (cần mở thử bằng Word trước khi in hàng loạt)
                </li>
              </ul>
            </div>
          )}

          {/* Connected Workflow shortcuts */}
          {(onOpenExamMixer || onOpenGradingStudio || onOpenAzotaBridge) && (
            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                Bước liên thông tiếp theo
              </p>
              <div className="flex flex-col gap-1.5">
                {onOpenExamMixer && (
                  <button
                    type="button"
                    onClick={() => onOpenExamMixer(exam.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 text-[11px] font-semibold text-slate-700"
                  >
                    ← Quay lại Exam Mixer Pro
                  </button>
                )}
                {onOpenGradingStudio && (
                  <button
                    type="button"
                    onClick={() => onOpenGradingStudio(exam.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-200 text-[11px] font-semibold text-slate-700 flex items-center gap-1.5"
                  >
                    <ScanLine className="w-3.5 h-3.5 text-emerald-600" />
                    Chấm OMR trong Smart Grading
                  </button>
                )}
                {onOpenAzotaBridge && (
                  <button
                    type="button"
                    onClick={() => onOpenAzotaBridge(exam.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-amber-50 hover:border-amber-200 text-[11px] font-semibold text-slate-700"
                  >
                    Mở gói xuất thủ công Azota
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // =========================================================================
  // LIVE ANSWER KEY PREVIEW RENDERER (4 Styles)
  // =========================================================================
  const renderLiveAnswerKeyPreview = () => {
    const style = workingTemplate.answerLayout.answerTableStyle ?? 'multi-column';
    const cols = workingTemplate.answerLayout.answerColumns ?? 4;
    const versions = exam.generatedVersions;
    if (versions.length === 0) {
      return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-900">
          Chưa có mã đề trộn nào để hiển thị bảng đáp án. Hãy mở Exam Mixer Pro để tạo mã đề trước.
        </div>
      );
    }

    return (
      <div
        onClick={() => focusBlock('answer-key')}
        className={`tos-paper mx-auto bg-white space-y-4 ${blockRingClass(
          'answer-key'
        )}`}
        style={a4SheetStyle}
      >
        <div className="text-center border-b border-slate-300 pb-3">
          <div className="text-[1.05em] font-bold uppercase text-slate-900">
            ĐÁP ÁN &amp; HƯỚNG DẪN CHẤM — {resolveText(workingTemplate.headerSettings.examTitle)}
          </div>
          <div className="text-[0.85em] text-slate-600 mt-0.5">
            {resolveText(workingTemplate.headerSettings.schoolName)} · Môn: {subjectDisplay} ·{' '}
            {gradeDisplay} · {versions.length} mã đề
          </div>
        </div>

        {/* Style 1: Horizontal strip */}
        {style === 'horizontal' &&
          versions.map((ver) => (
            <div key={ver.code} className="space-y-1.5">
              <div className="font-bold text-[0.95em] text-indigo-900">
                Bảng đáp án hàng ngang — Mã đề {ver.code}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.82em]">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-300 px-2 py-1 text-left">Câu</th>
                      {ver.answerKeyRows.slice(0, 12).map((r) => (
                        <th key={r.number} className="border border-slate-300 px-1.5 py-1 text-center">
                          {r.number}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-slate-300 px-2 py-1 font-semibold">Đáp án</td>
                      {ver.answerKeyRows.slice(0, 12).map((r) => (
                        <td
                          key={r.number}
                          className="border border-slate-300 px-1.5 py-1 text-center font-bold text-indigo-700"
                        >
                          {r.answer}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

        {/* Style 2: Multi-column (2 / 4 / 5 cols) */}
        {style === 'multi-column' &&
          versions.slice(0, 2).map((ver) => {
            const perCol = Math.max(1, Math.ceil(ver.answerKeyRows.length / cols));
            return (
              <div key={ver.code} className="space-y-1.5">
                <div className="font-bold text-[0.95em] text-indigo-900">
                  Bảng đáp án {cols} cột — Mã đề {ver.code}
                </div>
                <table className="w-full border-collapse text-[0.82em]">
                  <thead>
                    <tr className="bg-slate-100">
                      {Array.from({ length: cols }).map((_, cIdx) => (
                        <th key={cIdx} colSpan={2} className="border border-slate-300 px-2 py-1 text-center">
                          Cột {cIdx + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: perCol }).map((_, rIdx) => (
                      <tr key={rIdx}>
                        {Array.from({ length: cols }).map((__, cIdx) => {
                          const entry = ver.answerKeyRows[cIdx * perCol + rIdx];
                          return [
                            <td
                              key={`${cIdx}-q`}
                              className="border border-slate-300 px-1.5 py-1 text-center text-slate-600"
                            >
                              {entry ? `Câu ${entry.number}` : ''}
                            </td>,
                            <td
                              key={`${cIdx}-a`}
                              className="border border-slate-300 px-1.5 py-1 text-center font-bold text-indigo-700"
                            >
                              {entry ? entry.answer : ''}
                            </td>,
                          ];
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

        {/* Style 3: By Section */}
        {style === 'by-section' &&
          (activeVersion ? [activeVersion] : versions.slice(0, 1)).map((ver) => {
            const bySec = new Map<string, typeof ver.answerKeyRows>();
            ver.answerKeyRows.forEach((r) => {
              const sec = r.sectionTitle || 'Phần chung';
              bySec.set(sec, [...(bySec.get(sec) ?? []), r]);
            });
            return (
              <div key={ver.code} className="space-y-3">
                <div className="font-bold text-[0.95em] text-indigo-900">
                  Đáp án theo từng Phần — Mã đề {ver.code}
                </div>
                {Array.from(bySec.entries()).map(([secTitle, rows]) => (
                  <div key={secTitle} className="space-y-1">
                    <div className="font-semibold italic text-[0.88em] text-slate-700">
                      {secTitle}
                    </div>
                    <table className="w-full border-collapse text-[0.82em]">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border border-slate-300 px-2 py-1 text-left w-20">Câu</th>
                          <th className="border border-slate-300 px-2 py-1 text-left">Dạng câu</th>
                          <th className="border border-slate-300 px-2 py-1 text-left">Đáp án</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.number}>
                            <td className="border border-slate-300 px-2 py-1">Câu {r.number}</td>
                            <td className="border border-slate-300 px-2 py-1 text-slate-600">
                              {r.universalType ?? r.type}
                            </td>
                            <td className="border border-slate-300 px-2 py-1 font-bold text-indigo-700">
                              {r.answer}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            );
          })}

        {/* Style 4: Per-Code Matrix */}
        {style === 'per-code' && (
          <div className="space-y-2">
            <div className="font-bold text-[0.95em] text-indigo-900">
              Ma trận đáp án tổng hợp tất cả mã đề ({versions.map((v) => v.code).join(', ')})
            </div>
            <table className="w-full border-collapse text-[0.82em]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1 text-left">Câu</th>
                  {versions.map((v) => (
                    <th key={v.code} className="border border-slate-300 px-2 py-1 text-center">
                      Mã {v.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({
                  length: Math.max(0, ...versions.map((v) => v.answerKeyRows.length)),
                }).map((_, idx) => (
                  <tr key={idx}>
                    <td className="border border-slate-300 px-2 py-1 font-medium">
                      Câu {idx + 1}
                    </td>
                    {versions.map((v) => (
                      <td
                        key={v.code}
                        className="border border-slate-300 px-2 py-1 text-center font-bold text-indigo-700"
                      >
                        {v.answerKeyRows[idx]?.answer ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3" data-testid="exam-form-designer">
      {/* =================================================================== */}
      {/* TOP STUDIO TOOLBAR                                                   */}
      {/* =================================================================== */}
      <div className="tos-document-toolbar print:hidden flex flex-wrap items-center justify-between" role="group" aria-label="Công cụ mẫu đề">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Mobile Drawer Toggles (< xl) */}
          <div className="flex xl:hidden items-center gap-1.5">
            <button
              type="button"
              onClick={(event) => {
                mobileDrawerTrigger.current = event.currentTarget;
                setMobileDrawer('setup');
              }}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-indigo-50"
            >
              <LayoutTemplate className="w-3.5 h-3.5 text-indigo-600" />
              Thiết lập
            </button>
            <button
              type="button"
              onClick={(event) => {
                mobileDrawerTrigger.current = event.currentTarget;
                setMobileDrawer('inspector');
              }}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-indigo-50"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
              Thuộc tính
            </button>
          </div>

          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-bold text-slate-900 truncate max-w-[200px]">
              {workingTemplate.name}
            </span>
            {undoStack.length > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                Chưa lưu
              </span>
            )}
          </div>

          {/* Exam code switcher */}
          {exam.generatedVersions.length > 0 && (
            <div className="flex items-center gap-1 bg-slate-100/90 rounded-xl p-0.5">
              {exam.generatedVersions.map((ver) => (
                <button
                  key={ver.code}
                  type="button"
                  onClick={() => onSelectExamCode(ver.code)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all ${
                    activeVersion?.code === ver.code
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Mã {ver.code}
                </button>
              ))}
            </div>
          )}

          {/* Student vs Answer Key Preview Toggle */}
          <div className="flex items-center gap-1 bg-slate-100/90 rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setPreviewTab('student')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                previewTab === 'student'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Đề học sinh A4
            </button>
            <button
              type="button"
              onClick={() => {
                setPreviewTab('answer');
                setSelectedBlock('answer-key');
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                previewTab === 'answer'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bảng đáp án GV
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="hidden sm:flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => {
                const idx = ZOOM_STEPS.indexOf(zoomPercent);
                if (idx > 0) setZoomPercent(ZOOM_STEPS[idx - 1]);
              }}
              disabled={zoomPercent === ZOOM_STEPS[0]}
              className="p-1 text-slate-600 disabled:opacity-40"
              aria-label="Thu nhỏ trang A4"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-bold text-slate-700 min-w-[36px] text-center">
              {zoomPercent}%
            </span>
            <button
              type="button"
              onClick={() => {
                const idx = ZOOM_STEPS.indexOf(zoomPercent);
                if (idx < ZOOM_STEPS.length - 1) setZoomPercent(ZOOM_STEPS[idx + 1]);
              }}
              disabled={zoomPercent === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              className="p-1 text-slate-600 disabled:opacity-40"
              aria-label="Phóng to trang A4"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right Primary Actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Hoàn tác thay đổi gần nhất"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Hoàn tác
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSaveCustomOpen((v) => !v)}>
            <BookmarkPlus className="w-3.5 h-3.5" />
            Lưu mẫu mới
          </Button>
          <Button variant="secondary" size="sm" onClick={handleApplyAndSaveSafely}>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Áp dụng mẫu
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExportStudentDocx}
            disabled={hasBlockingWarning || exportingDocx || !activeVersion}
          >
            <Download className="w-3.5 h-3.5" />
            {exportingDocx
              ? 'Đang xuất...'
              : activeVersion
                ? `DOCX Mã ${activeVersion.code}`
                : 'DOCX Đề HS'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportAnswerKeyDocx}
            disabled={hasBlockingWarning || exportingAnswerDocx}
          >
            <KeyRound className="w-3.5 h-3.5" />
            {exportingAnswerDocx ? 'Đang xuất...' : 'Đáp án DOCX'}
          </Button>
          {exam.generatedVersions.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportFullZipBundle}
              disabled={hasBlockingWarning || exportingZip}
              title="Xuất trọn bộ ZIP gồm tất cả mã đề học sinh + đáp án từng mã + ma trận CSV/JSON"
            >
              <Archive className="w-3.5 h-3.5 text-indigo-600" />
              {exportingZip ? 'Đang nén ZIP...' : `ZIP (${exam.generatedVersions.length} mã)`}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrintPdf}
            disabled={hasBlockingWarning}
          >
            <Printer className="w-3.5 h-3.5" />
            In / PDF
          </Button>
        </div>
      </div>

      {/* Inline Save As Custom Popover */}
      {saveCustomOpen && (
        <div className="print:hidden rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-indigo-900">
            Lưu mẫu mới (không ghi đè mẫu chuẩn):
          </span>
          <input
            type="text"
            value={customNameDraft}
            onChange={(e) => setCustomNameDraft(e.target.value)}
            placeholder={`VD: ${workingTemplate.name} — Trường tôi`}
            className="flex-1 min-w-[200px] rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs"
            autoFocus
          />
          <Button variant="primary" size="sm" onClick={handleSaveAsCustom}>
            Lưu &amp; Áp dụng
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSaveCustomOpen(false)}>
            Đóng
          </Button>
        </div>
      )}

      {/* Honest Disclaimer & Blocking/Warning Pre-Export Banner */}
      <div className="print:hidden space-y-2">
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-600">
          <div className="flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>{workingTemplate.disclaimer}</span>
          </div>
          <span className="font-semibold text-slate-700">
            Ước lượng: ~{paginationEstimate.estimatedPages} trang A4 ·{' '}
            {workingTemplate.pageSettings.columns} cột · {previewQuestions.length} câu
          </span>
        </div>

        {(hasBlockingWarning || exportWarnings.length > 0) && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 space-y-1 text-xs ${
              hasBlockingWarning
                ? 'border-rose-200 bg-rose-50/85 text-rose-900'
                : 'border-amber-200 bg-amber-50/85 text-amber-900'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {hasBlockingWarning
                  ? 'Đang chặn xuất chính thức — cần hoàn tất kiểm tra chất lượng'
                  : 'Cảnh báo bố cục A4 trước khi in / xuất DOCX'}
              </div>
              {hasBlockingWarning && onOpenExamMixer && (
                <Button variant="secondary" size="sm" onClick={() => onOpenExamMixer(exam.id)}>
                  Mở Exam Mixer Pro để xử lý
                </Button>
              )}
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-[11.5px]">
              {!exportGate.canExport &&
                exportGate.blockingReasons.map((r, i) => <li key={`gate-${i}`}>{r}</li>)}
              {exportWarnings.map((w) => (
                <li key={w.id}>
                  <strong>{w.message}</strong> — {w.recommendation}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* 3-ZONE PROFESSIONAL STUDIO WORKSPACE                                */}
      {/* =================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-[290px_minmax(0,1fr)_300px] gap-4 items-start">
        {/* LEFT PANEL — THIẾT LẬP (Desktop) */}
        <aside className="tos-document-panel hidden xl:flex flex-col print:hidden overflow-hidden">
          {renderLeftPanelContent()}
        </aside>

        {/* CENTER AREA — LIVE A4 PREVIEW */}
        <DocumentPreview label="Xem trước bản in A4" widthMm={sheetWidthMm} zoom={zoomPercent}>
            {previewTab === 'answer' ? (
              renderLiveAnswerKeyPreview()
            ) : (
              <div
                className="tos-paper mx-auto bg-white"
                style={a4SheetStyle}
              >
                {/* BLOCK 1: HEADER & SCHOOL BRANDING */}
                <div
                  onClick={() => focusBlock('header')}
                  className={`p-2 -m-2 mb-3 ${blockRingClass('header')}`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2.5 border-b border-slate-300">
                    <div className="flex flex-col items-center text-center">
                      {workingTemplate.headerSettings.schoolLogoDataUrl && (
                        <img
                          src={workingTemplate.headerSettings.schoolLogoDataUrl}
                          alt={resolveText(workingTemplate.headerSettings.schoolName)}
                          style={{
                            width: workingTemplate.headerSettings.schoolLogoWidthPx ?? 52,
                            height: workingTemplate.headerSettings.schoolLogoWidthPx ?? 52,
                          }}
                          className="object-contain mb-1"
                        />
                      )}
                      <div className="text-[0.86em] font-semibold uppercase tracking-wide text-slate-700">
                        {resolveText(workingTemplate.headerSettings.departmentName)}
                      </div>
                      <div className="text-[0.95em] font-bold uppercase text-slate-900">
                        {resolveText(workingTemplate.headerSettings.schoolName)}
                      </div>
                      {workingTemplate.headerSettings.subjectGroupName.trim() && (
                        <div className="text-[0.82em] font-medium text-slate-600">
                          {resolveText(workingTemplate.headerSettings.subjectGroupName)}
                        </div>
                      )}
                      {workingTemplate.headerSettings.showQuestionCountSubtitle && (
                        <div className="text-[0.78em] italic text-slate-500 mt-0.5">
                          (Đề thi gồm {previewQuestions.length} câu hỏi)
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-center text-center">
                      <div className="text-[1em] font-bold uppercase text-slate-900">
                        {resolveText(workingTemplate.headerSettings.examTitle)}
                      </div>
                      <div className="text-[0.85em] text-slate-700 mt-0.5">
                        Năm học: {resolveText(workingTemplate.headerSettings.schoolYear)} · Môn:{' '}
                        {subjectDisplay} · {gradeDisplay}
                      </div>
                      <div className="text-[0.85em] italic text-slate-700">
                        Thời gian làm bài: {durationDisplay} phút
                      </div>
                      {workingTemplate.headerSettings.showExamCode && (
                        <div
                          className={`mt-1.5 inline-flex items-center px-3 py-0.5 text-[0.85em] font-bold ${
                            workingTemplate.pageSettings.examCodePosition === 'top-box'
                              ? 'border-2 border-slate-900 rounded bg-slate-50'
                              : 'border border-slate-700 rounded'
                          }`}
                        >
                          MÃ ĐỀ: {activeVersion?.code || 'GỐC'}
                        </div>
                      )}
                    </div>
                  </div>

                  {workingTemplate.headerSettings.headerNote.trim() && (
                    <p className="mt-2 text-[0.82em] italic text-slate-600 text-center">
                      {resolveText(workingTemplate.headerSettings.headerNote)}
                    </p>
                  )}
                </div>

                {/* BLOCK 2: STUDENT INFO */}
                {workingTemplate.studentInfoSettings.showStudentBlock && (
                  <div
                    onClick={() => focusBlock('student')}
                    className={`mb-3 rounded border border-slate-300 px-3 py-2 text-[0.86em] text-slate-800 flex flex-wrap gap-x-5 gap-y-1 ${blockRingClass(
                      'student'
                    )}`}
                  >
                    {workingTemplate.studentInfoSettings.showFullName && (
                      <span>Họ và tên thí sinh: .............................................</span>
                    )}
                    {workingTemplate.studentInfoSettings.showClassName && (
                      <span>Lớp: ............</span>
                    )}
                    {workingTemplate.studentInfoSettings.showExamNumber && (
                      <span>Số báo danh: ......................</span>
                    )}
                    {workingTemplate.studentInfoSettings.showStudentId && (
                      <span>Mã HS: ................</span>
                    )}
                    {workingTemplate.studentInfoSettings.showExamDate && (
                      <span>Ngày kiểm tra: ..../..../20....</span>
                    )}
                  </div>
                )}

                {/* BLOCK 3: QUESTIONS BODY */}
                <div
                  onClick={() => focusBlock('questions')}
                  className={`p-1 -m-1 ${blockRingClass('questions')}`}
                >
                  <div
                    className={
                      workingTemplate.pageSettings.columns === 2
                        ? 'columns-1 md:columns-2 gap-6'
                        : 'space-y-0'
                    }
                  >
                    {(() => {
                      let currentSection = '';
                      let pageCounter = 1;
                      return previewQuestions.map((q, qIdx) => {
                        const showPageBreakHere =
                          (workingTemplate.pageSettings.showPageBreaks ?? true) &&
                          pageBreakSet.has(qIdx);
                        if (showPageBreakHere) pageCounter += 1;

                        const showSectionHeader =
                          workingTemplate.bodySettings.showSectionTitles &&
                          Boolean(q.sectionTitle) &&
                          q.sectionTitle !== currentSection;
                        if (showSectionHeader && q.sectionTitle) {
                          currentSection = q.sectionTitle;
                        }

                        const group =
                          q.groupId && !renderedGroups.has(q.groupId)
                            ? groupMap.get(q.groupId)
                            : undefined;
                        if (group) renderedGroups.add(group.id);

                        const uType = getUniversalQuestionType(q);
                        const resolvedOptGrid = resolveAutoOptionLayout(q, workingTemplate);
                        const optGridClass =
                          resolvedOptGrid === '4-col'
                            ? 'grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1'
                            : resolvedOptGrid === '2-col'
                              ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1'
                              : 'space-y-1';

                        const imgAlignClass =
                          workingTemplate.bodySettings.imageAlignment === 'left'
                            ? 'items-start'
                            : 'items-center';

                        return (
                          <div
                            key={`${q.id}-${qIdx}`}
                            className="break-inside-avoid"
                            style={{
                              marginBottom: `${workingTemplate.pageSettings.questionSpacingPx}px`,
                            }}
                          >
                            {/* Visual Page Break Divider */}
                            {showPageBreakHere && (
                              <div className="print:hidden my-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-indigo-500 select-none">
                                <span className="flex-1 border-t border-dashed border-indigo-300" />
                                <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200">
                                  Ngắt trang A4 — Trang {pageCounter}
                                </span>
                                <span className="flex-1 border-t border-dashed border-indigo-300" />
                              </div>
                            )}

                            {showSectionHeader && q.sectionTitle && (
                              <div className="mt-2 mb-1.5 font-bold uppercase text-[0.95em] text-slate-900">
                                {q.sectionTitle}
                                {workingTemplate.bodySettings.showSectionInstructions &&
                                  workingTemplate.bodySettings.sectionInstructionsOverride.trim() && (
                                    <div className="font-normal normal-case italic text-[0.85em] text-slate-600 mt-0.5">
                                      {workingTemplate.bodySettings.sectionInstructionsOverride}
                                    </div>
                                  )}
                              </div>
                            )}

                            {group && (
                              <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 text-[0.9em]">
                                <div className="font-semibold text-indigo-900 mb-1">
                                  {group.title}
                                </div>
                                <MathContentRenderer payload={group.sharedContext} />
                              </div>
                            )}

                            <div className="text-slate-900">
                              <span className="font-bold">
                                {workingTemplate.bodySettings.questionNumberPrefix || 'Câu'}{' '}
                                {qIdx + 1}
                                {workingTemplate.bodySettings.showPointsPerQuestion &&
                                typeof q.points === 'number' &&
                                q.points > 0
                                  ? ` (${q.points}đ)`
                                  : ''}
                                :{' '}
                              </span>
                              <MathContentRenderer payload={q.stem} className="inline" />
                            </div>

                            {q.visualAssets && q.visualAssets.length > 0 && (
                              <div className={`my-2 flex flex-col gap-2 ${imgAlignClass}`}>
                                {q.visualAssets.map((asset) => (
                                  <MathVisualAssetRenderer key={asset.id} asset={asset} />
                                ))}
                              </div>
                            )}

                            {/* MCQ Options */}
                            {(q.type === 'mcq' || uType === 'multi-select') &&
                              (q.multiSelectOptions ?? q.options ?? []).length > 0 && (
                                <div className={`mt-1.5 pl-4 ${optGridClass}`}>
                                  {(q.multiSelectOptions ?? q.options ?? []).map((opt, oIdx) => {
                                    const lbl =
                                      MCQ_LABELS[oIdx] ?? getOptionLetterLabel(oIdx);
                                    return (
                                      <div key={`${opt.id}-${oIdx}`} className="min-w-0">
                                        <span className="font-bold">
                                          {lbl}
                                          {optPunct}{' '}
                                        </span>
                                        <MathContentRenderer
                                          payload={opt.content}
                                          className="inline"
                                        />
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

                            {/* True / False Statements */}
                            {q.type === 'true-false' && q.statements && q.statements.length > 0 && (
                              <div className="mt-1.5 pl-4 space-y-1">
                                {q.statements.map((st, sIdx) => (
                                  <div key={`${st.id}-${sIdx}`}>
                                    <span className="font-bold">
                                      {TF_LABELS[sIdx] ?? getStatementLetterLabel(sIdx)}){' '}
                                    </span>
                                    <MathContentRenderer payload={st.content} className="inline" />
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Short Answer Zone */}
                            {q.type === 'short-answer' &&
                              (workingTemplate.bodySettings.shortAnswerBoxStyle ??
                                'dotted-line') !== 'none' && (
                                <div className="mt-1.5 pl-4">
                                  {(workingTemplate.bodySettings.shortAnswerBoxStyle ??
                                    'dotted-line') === 'box' ? (
                                    <div className="inline-flex items-center gap-2 text-[0.88em] text-slate-600">
                                      <span className="italic">Đáp số:</span>
                                      <span className="inline-block w-36 h-6 border border-slate-400 rounded-sm bg-slate-50/40" />
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5 text-[0.88em] text-slate-500">
                                      {Array.from({
                                        length: Math.max(
                                          1,
                                          workingTemplate.bodySettings.shortAnswerBlankLines ?? 1
                                        ),
                                      }).map((_, i) => (
                                        <div
                                          key={i}
                                          className="border-b border-dotted border-slate-400 pt-2"
                                        >
                                          {i === 0 ? 'Trả lời:' : ''}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                            {/* Essay Parts & Writing Lines */}
                            {q.type === 'essay' && (
                              <div className="mt-1.5 pl-4 space-y-1.5">
                                {q.essayParts?.map((part) => (
                                  <div key={part.id}>
                                    <span className="font-bold">
                                      {part.label} ({part.points}đ):{' '}
                                    </span>
                                    <MathContentRenderer payload={part.content} className="inline" />
                                  </div>
                                ))}
                                {(workingTemplate.bodySettings.essayAnswerLines ?? 4) > 0 &&
                                  (workingTemplate.bodySettings.essayLineStyle ?? 'dotted') !==
                                    'blank' && (
                                    <div className="pt-1 space-y-2.5">
                                      {Array.from({
                                        length: workingTemplate.bodySettings.essayAnswerLines ?? 4,
                                      }).map((_, i) => (
                                        <div
                                          key={i}
                                          className={`h-3 ${
                                            (workingTemplate.bodySettings.essayLineStyle ??
                                              'dotted') === 'lined'
                                              ? 'border-b border-slate-300'
                                              : 'border-b border-dotted border-slate-300'
                                          }`}
                                        />
                                      ))}
                                    </div>
                                  )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* BLOCK 4: FOOTER & PAGE NUMBERS */}
                <div
                  onClick={() => focusBlock('footer')}
                  className={`mt-6 pt-3 border-t border-slate-200 text-center space-y-1 ${blockRingClass(
                    'footer'
                  )}`}
                >
                  {workingTemplate.footerSettings.showEndMarker && (
                    <div className="font-bold text-[0.95em] text-slate-900">
                      {resolveText(workingTemplate.footerSettings.endMarkerText || '——— HẾT ———')}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.78em] italic text-slate-500">
                    <span>{resolveText(workingTemplate.footerSettings.footerNote)}</span>
                    <span className="ml-auto not-italic font-medium text-slate-600">
                      {workingTemplate.footerSettings.showCodeInFooter &&
                      workingTemplate.headerSettings.showExamCode
                        ? `Mã đề ${activeVersion?.code || 'GỐC'} · `
                        : ''}
                      {workingTemplate.pageSettings.showPageNumbers
                        ? workingTemplate.pageSettings.pageNumberFormat === 'page-only'
                          ? 'Trang 1'
                          : `Trang 1 / ${paginationEstimate.estimatedPages}`
                        : ''}
                    </span>
                  </div>
                </div>
              </div>
            )}
        </DocumentPreview>

        {/* RIGHT PANEL — THUỘC TÍNH & QUALITY CONTROL (Desktop) */}
        <aside className="tos-document-panel hidden xl:flex flex-col print:hidden overflow-hidden">
          {renderRightPanelContent()}
        </aside>
      </div>

      {/* =================================================================== */}
      {/* MOBILE / TABLET SLIDE-OVER DRAWERS (< xl)                           */}
      {/* =================================================================== */}
      {mobileDrawer !== 'none' && (
        <dialog
          ref={mobileDrawerRef}
          className={`tos-paper-drawer fixed inset-y-0 m-0 w-[min(90vw,340px)] max-h-none max-w-none p-0 xl:hidden print:hidden ${mobileDrawer === 'inspector' ? 'left-auto right-0' : 'left-0 right-auto'}`}
          aria-label={mobileDrawer === 'setup' ? 'Bảng Thiết lập mẫu đề' : 'Bảng Thuộc tính khối'}
          onCancel={(event) => { event.preventDefault(); setMobileDrawer('none'); }}
          onClick={(event) => { if (event.target === event.currentTarget) setMobileDrawer('none'); }}
        >
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200 bg-slate-50">
              <span className="text-xs font-bold text-slate-900">
                {mobileDrawer === 'setup' ? 'Thiết lập & Thư viện mẫu' : 'Thuộc tính & Kiểm định'}
              </span>
              <button
                type="button"
                autoFocus
                onClick={() => setMobileDrawer('none')}
                className="tos-icon-button hover:bg-slate-200"
                aria-label="Đóng bảng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {mobileDrawer === 'setup' ? renderLeftPanelContent() : renderRightPanelContent()}
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}

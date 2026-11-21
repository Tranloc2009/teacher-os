import { ChangeEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Eye,
  ImagePlus,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import {
  COGNITIVE_LEVEL_LABELS,
  CognitiveLevel,
  ExamSubjectId,
  MATH_QUESTION_TYPE_LABELS,
  MATH_SECTION_TITLES,
  MATH_TOPICS,
  MathExamProject,
  MathIntegrityIssue,
  MathQuestion,
  MathQuestionType,
  QuestionGroup,
  UNIVERSAL_QUESTION_TYPE_LABELS,
  UniversalQuestionType,
} from '../../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  applyTeacherManualAnswer,
  computeLockStats,
  computeQuestionVerificationContentHash,
  createMathVisualAsset,
  detectDependentOptions,
  detectDependentStatements,
  evaluatePreMixIntegrity,
  evaluateQuestionAnswerState,
  parseMathContent,
} from '../../core/mathIntegrity';
import {
  getSubjectProfile,
  listSubjectProfiles,
  resolveSubjectId,
} from '../../core/subjectProfileRegistry';
import {
  UniversalImportResult,
  mergeImportedExamIntoProject,
  parseUniversalExamText,
} from '../../core/universalImportEngine';
import {
  commitUniversalImportSessionToProject,
  runUniversalImportSession,
} from '../../core/universalImportAdapter';
import type { PdfExtractionProgress } from '../../core/pdfImportAdapter';
import type { UniversalImportSession } from '../../types/universalImport';
import {
  VISUAL_ASSET_PRESETS,
  createEmptyMathQuestion,
} from '../../data/demoMathExams';
import { createId } from '../../db/database';
import {
  MathContentRenderer,
  MathVisualAssetRenderer,
} from './MathContentRenderer';
import {
  MathIntegrityBadge,
  MathIntegrityReportPanel,
} from './MathIntegrityReportPanel';
import { MathSymbolToolbar } from './MathSymbolToolbar';
import { UniversalImportReviewModal } from './UniversalImportReviewModal';
import {
  FieldHistoryState,
  MathToolbarSymbol,
  createFieldHistory,
  insertMathSymbolAtCursor,
  pushFieldHistory,
  redoFieldHistory,
  undoFieldHistory,
} from '../../core/mathToolbarSymbols';

type QuestionFilterKind =
  | MathQuestionType
  | 'multi-select'
  | 'fill-blank'
  | 'matching'
  | 'ordering'
  | 'reading-comprehension'
  | 'all'
  | 'locked'
  | 'unlocked'
  | 'grouped';

interface MathExamEditorProps {
  exam: MathExamProject;
  stepMode: 1 | 2;
  integrityIssues: MathIntegrityIssue[];
  onChangeExam: (next: MathExamProject) => void;
  onGoToStep: (step: 1 | 2 | 3 | 4 | 5) => void;
}

export function MathExamEditor({
  exam,
  stepMode,
  integrityIssues,
  onChangeExam,
  onGoToStep,
}: MathExamEditorProps) {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    exam.questions[0]?.id ?? ''
  );
  const [showImportDrawer, setShowImportDrawer] = useState(false);
  const [showGroupDrawer, setShowGroupDrawer] = useState(false);
  const [pasteBuffer, setPasteBuffer] = useState('');
  const [pasteFeedback, setPasteFeedback] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<UniversalImportResult | null>(null);
  const [importSession, setImportSession] = useState<UniversalImportSession | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [importProgress, setImportProgress] = useState<PdfExtractionProgress | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const importAbortRef = useRef<AbortController | null>(null);
  const [applySuggestedSubject, setApplySuggestedSubject] = useState(true);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [filterType, setFilterType] = useState<QuestionFilterKind>('all');
  const [groupDraftIds, setGroupDraftIds] = useState<string[]>([]);
  const [groupDraftTitle, setGroupDraftTitle] = useState('');
  const [groupDraftContext, setGroupDraftContext] = useState('');
  const [groupDraftMode, setGroupDraftMode] = useState<'move' | 'lock'>('move');
  const [groupFeedback, setGroupFeedback] = useState<string | null>(null);
  const [manualCheckTick, setManualCheckTick] = useState<string | null>(null);
  const [activeFieldKey, setActiveFieldKey] = useState<string>('stem');
  const [, setHistoryTick] = useState(0);
  const fieldElementRefs = useRef<Record<string, HTMLTextAreaElement | HTMLInputElement | null>>({});
  const fieldHistoriesRef = useRef<Record<string, FieldHistoryState>>({});
  const pendingSelectionRef = useRef<{ fieldKey: string; start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending) return;
    const el = fieldElementRefs.current[pending.fieldKey];
    if (!el) return;
    pendingSelectionRef.current = null;
    if (document.activeElement !== el) {
      el.focus();
    }
    try {
      el.setSelectionRange(pending.start, pending.end);
    } catch {
      // Ignore if input type does not support selection range
    }
  });

  const subjectProfiles = useMemo(() => listSubjectProfiles(), []);
  const currentSubjectId = useMemo(
    () => resolveSubjectId(exam.subjectId || exam.subject || 'Toán học'),
    [exam.subjectId, exam.subject]
  );
  const currentProfile = useMemo(
    () => getSubjectProfile(currentSubjectId),
    [currentSubjectId]
  );
  const issuesByQuestionId = useMemo(() => {
    const map = new Map<string, MathIntegrityIssue[]>();
    integrityIssues.forEach((issue) => {
      if (!issue.questionId) return;
      const list = map.get(issue.questionId) ?? [];
      list.push(issue);
      map.set(issue.questionId, list);
    });
    return map;
  }, [integrityIssues]);

  const activeQuestion = useMemo(
    () =>
      exam.questions.find((q) => q.id === selectedQuestionId) ??
      exam.questions[0] ??
      null,
    [exam.questions, selectedQuestionId]
  );

  const lockStats = useMemo(() => computeLockStats(exam), [exam]);
  const preMixReport = useMemo(() => evaluatePreMixIntegrity(exam), [exam]);

  const filteredQuestions = useMemo(() => {
    const lockedSet = new Set(exam.mixConfig.lockedQuestionIds);
    if (filterType === 'all') return exam.questions;
    if (filterType === 'locked') {
      return exam.questions.filter(
        (q) => q.lockQuestionPosition || lockedSet.has(q.id)
      );
    }
    if (filterType === 'unlocked') {
      return exam.questions.filter(
        (q) => !q.lockQuestionPosition && !lockedSet.has(q.id)
      );
    }
    if (filterType === 'grouped') {
      return exam.questions.filter((q) => Boolean(q.groupId));
    }
    if (filterType === 'mcq' || filterType === 'true-false' || filterType === 'short-answer' || filterType === 'essay') {
      return exam.questions.filter((q) => q.type === filterType);
    }
    return exam.questions.filter((q) => (q.universalType ?? q.type) === filterType);
  }, [exam.questions, exam.mixConfig.lockedQuestionIds, filterType]);

  const errorIssues = integrityIssues.filter((i) => i.severity === 'error');

  const updateQuestion = (qId: string, updater: (q: MathQuestion) => MathQuestion) => {
    const nextQuestions = exam.questions.map((q) => {
      if (q.id !== qId) return q;
      const beforeHash = computeQuestionVerificationContentHash(q);
      const updated = updater(q);
      const afterHash = computeQuestionVerificationContentHash(updated);
      if (
        beforeHash !== afterHash &&
        updated.answerProvenance?.status === 'teacher-confirmed'
      ) {
        return {
          ...updated,
          answerConfirmed: false,
          answerProvenance: {
            ...updated.answerProvenance,
            status: 'needs-review' as const,
            confirmedContentHash: undefined,
            confirmedAt: undefined,
            note: 'Nội dung hoặc đáp án vừa được chỉnh sửa sau lần xác nhận trước — cần giáo viên xác nhận lại.',
          },
        };
      }
      return updated;
    });
    onChangeExam({
      ...exam,
      questions: nextQuestions,
      confirmedOriginalAnswers: false,
      generatedVersions: [],
      updatedAt: new Date().toISOString(),
    });
  };

  const updateQuestionAnswer = (
    qId: string,
    updater: (q: MathQuestion) => MathQuestion,
    meta?: { sourceLocation?: string; selectionSummary?: string }
  ) => {
    const now = new Date().toISOString();
    const nextQuestions = exam.questions.map((q) => {
      if (q.id !== qId) return q;
      const updated = updater(q);
      return applyTeacherManualAnswer(q, updated, {
        now,
        sourceLocation: meta?.sourceLocation ?? 'Trình sửa câu hỏi (Bước 1)',
        selectionSummary: meta?.selectionSummary,
      });
    });
    onChangeExam({
      ...exam,
      questions: nextQuestions,
      confirmedOriginalAnswers: false,
      generatedVersions: [],
      updatedAt: now,
    });
  };

  const handleConfirmSingleQuestionCandidate = (q: MathQuestion) => {
    if (!canConfirmEditedKey(q)) return;
    const now = new Date().toISOString();
    const promotedBase: MathQuestion = {
      ...q,
      legacyAnomalyReasons: undefined,
      updatedAt: now,
    };
    const promoted = applyTeacherManualAnswer(q, promotedBase, {
      now,
      sourceLocation: q.answerProvenance?.sourceLocation ?? 'Bảng rà soát khóa (Bước 2)',
    });

    const nextQuestions = exam.questions.map((item) => (item.id === q.id ? promoted : item));
    onChangeExam({
      ...exam,
      questions: nextQuestions,
      confirmedOriginalAnswers: false,
      generatedVersions: [],
      updatedAt: now,
    });
  };

  function canConfirmEditedKey(q: MathQuestion): boolean {
    const ansState = evaluateQuestionAnswerState(q);
    if (ansState.structural.status !== 'valid') return false;
    return (
      ansState.isNeedsReview ||
      ansState.isConflict ||
      ansState.isStaleConfirmation ||
      ansState.isMissingKey
    );
  }

  const handleAddQuestion = (type: MathQuestionType) => {
    const created = createEmptyMathQuestion(type, exam.questions.length + 1, createId);
    onChangeExam({
      ...exam,
      questions: [...exam.questions, created],
      confirmedOriginalAnswers: false,
      generatedVersions: [],
      updatedAt: new Date().toISOString(),
    });
    setSelectedQuestionId(created.id);
  };

  const handleDuplicateQuestion = (q: MathQuestion) => {
    const copyId = createId('mq');
    const copy: MathQuestion = {
      ...structuredClone(q),
      id: copyId,
      code: `${q.code}-COPY`,
      options: q.options?.map((o, idx) => ({
        ...o,
        id: `${copyId}-opt-${idx + 1}`,
      })),
      statements: q.statements?.map((s, idx) => ({
        ...s,
        id: `${copyId}-st-${idx + 1}`,
      })),
      updatedAt: new Date().toISOString(),
    };
    if (copy.type === 'mcq' && copy.options) {
      const correct = copy.options.find((o) => o.isCorrect);
      copy.correctOptionId = correct?.id ?? copy.options[0]?.id;
    }
    onChangeExam({
      ...exam,
      questions: [...exam.questions, copy],
      confirmedOriginalAnswers: false,
      generatedVersions: [],
    });
    setSelectedQuestionId(copy.id);
  };

  const handleDeleteQuestion = (qId: string) => {
    const remaining = exam.questions.filter((q) => q.id !== qId);
    const cleanedGroups = (exam.questionGroups ?? [])
      .map((g) => ({
        ...g,
        questionIds: g.questionIds.filter((id) => id !== qId),
      }))
      .filter((g) => g.questionIds.length > 0);
    onChangeExam({
      ...exam,
      questions: remaining,
      questionGroups: cleanedGroups,
      confirmedOriginalAnswers: false,
      generatedVersions: [],
    });
    if (selectedQuestionId === qId) {
      setSelectedQuestionId(remaining[0]?.id ?? '');
    }
  };

  const handleBulkLockAll = (locked: boolean) => {
    const nextQuestions = exam.questions.map((q) => ({
      ...q,
      lockQuestionPosition: locked,
      universalLock: q.universalLock
        ? { ...q.universalLock, positionLock: locked }
        : undefined,
    }));
    onChangeExam({
      ...exam,
      questions: nextQuestions,
      mixConfig: {
        ...exam.mixConfig,
        lockedQuestionIds: locked ? exam.mixConfig.lockedQuestionIds : [],
      },
      generatedVersions: [],
      updatedAt: new Date().toISOString(),
    });
  };

  const handleCreateGroup = () => {
    setGroupFeedback(null);
    const orderedIds = exam.questions
      .filter((q) => groupDraftIds.includes(q.id))
      .map((q) => q.id);
    if (orderedIds.length < 2) {
      setGroupFeedback('Vui lòng chọn ít nhất 2 câu hỏi đứng liền kề nhau để tạo nhóm.');
      return;
    }
    const indices = orderedIds.map((id) => exam.questions.findIndex((q) => q.id === id));
    const isContiguous = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
    if (!isContiguous) {
      setGroupFeedback('Các câu trong nhóm phải đứng liền kề nhau trong đề gốc.');
      return;
    }
    const sections = new Set(indices.map((idx) => exam.questions[idx].sectionTitle));
    if (sections.size > 1) {
      setGroupFeedback('Các câu trong một nhóm phải thuộc cùng một phần thi.');
      return;
    }
    const newGrpId = createId('grp');
    const title =
      groupDraftTitle.trim() ||
      `Nhóm ${indices.map((i) => exam.questions[i].code).join(' + ')}`;
    const newGroup: QuestionGroup = {
      id: newGrpId,
      title,
      sharedContext: parseMathContent(groupDraftContext.trim(), `${newGrpId}-ctx`),
      sharedAssets: [],
      questionIds: orderedIds,
      lockGroupPosition: groupDraftMode === 'lock',
      moveAsUnit: groupDraftMode === 'move',
    };
    const nextQuestions = exam.questions.map((q) =>
      orderedIds.includes(q.id)
        ? {
            ...q,
            groupId: newGrpId,
            lockQuestionPosition: groupDraftMode === 'move' ? false : q.lockQuestionPosition,
          }
        : q
    );
    const filteredPrevGroups = (exam.questionGroups ?? [])
      .map((g) => ({
        ...g,
        questionIds: g.questionIds.filter((id) => !orderedIds.includes(id)),
      }))
      .filter((g) => g.questionIds.length > 0);
    onChangeExam({
      ...exam,
      questions: nextQuestions,
      questionGroups: [...filteredPrevGroups, newGroup],
      generatedVersions: [],
      updatedAt: new Date().toISOString(),
    });
    setGroupDraftIds([]);
    setGroupDraftTitle('');
    setGroupDraftContext('');
    setGroupFeedback(`Đã tạo nhóm "${title}" gồm ${orderedIds.length} câu hỏi.`);
  };

  const handleDisbandGroup = (groupId: string) => {
    onChangeExam({
      ...exam,
      questions: exam.questions.map((q) =>
        q.groupId === groupId ? { ...q, groupId: undefined } : q
      ),
      questionGroups: (exam.questionGroups ?? []).filter((g) => g.id !== groupId),
      generatedVersions: [],
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAttachPresetAsset = (presetKey: string) => {
    if (!activeQuestion) return;
    const preset = VISUAL_ASSET_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    const asset = createMathVisualAsset({
      id: createId('asset'),
      kind: preset.kind,
      label: preset.label,
      sourceData: preset.sourceData,
      altText: preset.altText,
    });
    updateQuestion(activeQuestion.id, (q) => ({
      ...q,
      visualAssets: [...(q.visualAssets ?? []), asset],
      hasVisualAsset: true,
    }));
  };

  const handleUploadImageAsset = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeQuestion) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      const asset = createMathVisualAsset({
        id: createId('img'),
        kind: 'image',
        label: file.name,
        sourceData: result,
        altText: `Hình minh họa ${file.name}`,
      });
      updateQuestion(activeQuestion.id, (q) => ({
        ...q,
        visualAssets: [...(q.visualAssets ?? []), asset],
        hasVisualAsset: true,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleRunManualIntegrityCheck = () => {
    const latest = evaluatePreMixIntegrity(exam);
    setManualCheckTick(
      `Đã kiểm tra lúc ${new Date(latest.checkedAt).toLocaleTimeString('vi-VN')} — Trạng thái: ${latest.status}`
    );
    onChangeExam({
      ...exam,
      lastIntegrityReport: latest,
    });
  };

  const handleImportPaste = () => {
    setImportSession(null);
    const parsed = parseUniversalExamText(pasteBuffer, createId, {
      subjectId: currentSubjectId,
      sourceFormat: 'text',
    });
    if (parsed.questions.length === 0) {
      setImportPreview(null);
      setPasteFeedback([
        'Không nhận diện được câu hỏi theo mẫu "Câu 1: ... A. ... B. ... C. ... D. ..." hoặc "Question 1: ...". Hãy kiểm tra định dạng đầu câu.',
        ...parsed.report.warnings,
      ]);
      return;
    }
    setImportPreview(parsed);
    setApplySuggestedSubject(parsed.report.suggestedSubject.confidence !== 'low');
    setPasteFeedback([
      `Đã phân tích ${parsed.questions.length} câu hỏi (${parsed.report.groupsCreated} nhóm ngữ liệu). Kiểm tra báo cáo bên dưới rồi bấm xác nhận để đưa vào đề.`,
    ]);
  };

  const processUploadedExamFile = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      setPasteFeedback(['Tệp vượt quá giới hạn 50 MB. Vui lòng chia nhỏ tài liệu trước khi nhập.']);
      return;
    }

    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;

    setIsImportingFile(true);
    setImportProgress({ phase: 'loading', currentPage: 0, totalPages: 1, percent: 5 });
    setPasteFeedback([]);
    setImportPreview(null);

    try {
      const buffer = await file.arrayBuffer();
      const session = await runUniversalImportSession(
        {
          fileName: file.name,
          mimeType: file.type,
          buffer,
        },
        createId,
        {
          subjectId: currentSubjectId,
          renderPreviews: true,
          onProgress: (prog) => setImportProgress(prog),
          signal: controller.signal,
        }
      );

      setImportSession(session);
      const compat = session.compatibilityReport;
      setApplySuggestedSubject(compat.suggestedSubject.confidence !== 'low');

      if (session.detection.detectedFormat === 'pdf' || compat.status !== 'READY') {
        setShowReviewModal(true);
      }

      if (session.questions.length > 0) {
        setPasteFeedback([
          `Đã phân tích "${file.name}" (${compat.detectedFormat.toUpperCase()}): ${compat.totalDetectedQuestions} câu · An toàn: ${compat.safeToMixCount} · Cần đối chiếu/Chặn: ${compat.blockedCount}.`,
        ]);
      } else {
        setPasteFeedback([
          `Tệp "${file.name}" ở trạng thái ${compat.status}: ${compat.recommendations[0] ?? session.detection.reason}`,
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể đọc tệp đề thi.';
      setImportSession(null);
      setPasteFeedback([`Lỗi đọc tệp "${file.name}": ${msg}`]);
    } finally {
      setIsImportingFile(false);
      setImportProgress(null);
      importAbortRef.current = null;
    }
  };

  const handleUploadExamFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await processUploadedExamFile(file);
  };

  const handleDropExamFile = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processUploadedExamFile(file);
    }
  };

  const handleCancelImport = () => {
    importAbortRef.current?.abort();
    setIsImportingFile(false);
    setImportProgress(null);
    setPasteFeedback(['Đã hủy quá trình đọc tệp tài liệu.']);
  };

  const handleCommitImport = (replaceExisting: boolean) => {
    if (importSession && importSession.questions.length > 0) {
      const nextExam = commitUniversalImportSessionToProject(exam, importSession, {
        applySuggestedSubject,
        replaceExisting,
      });
      onChangeExam(nextExam);
      setSelectedQuestionId(importSession.questions[0].id);
      setPasteFeedback([
        replaceExisting
          ? `Đã thay thế đề gốc bằng ${importSession.questions.length} câu hỏi từ "${importSession.originalSource.fileName}".`
          : `Đã thêm ${importSession.questions.length} câu hỏi từ "${importSession.originalSource.fileName}" vào đề gốc.`,
      ]);
      setImportSession(null);
      setShowReviewModal(false);
      return;
    }

    if (!importPreview || importPreview.questions.length === 0) return;
    const nextExam = mergeImportedExamIntoProject(exam, importPreview, {
      applySuggestedSubject,
      replaceExisting,
    });
    onChangeExam(nextExam);
    setSelectedQuestionId(importPreview.questions[0].id);
    setPasteFeedback([
      replaceExisting
        ? `Đã thay thế đề gốc bằng ${importPreview.questions.length} câu hỏi mới.`
        : `Đã thêm ${importPreview.questions.length} câu hỏi vào đề gốc.`,
    ]);
    setImportPreview(null);
    setPasteBuffer('');
  };

  useEffect(() => {
    setActiveFieldKey('stem');
  }, [activeQuestion?.id]);

  const getFieldRawValue = (q: MathQuestion, fieldKey: string): string => {
    if (fieldKey === 'stem') return q.stem.rawSource;
    if (fieldKey === 'solutionGuide') return q.solutionGuide.rawSource;
    if (fieldKey.startsWith('opt:')) {
      const optId = fieldKey.slice(4);
      return q.options?.find((o) => o.id === optId)?.content.rawSource ?? '';
    }
    if (fieldKey.startsWith('ms:')) {
      const optId = fieldKey.slice(3);
      return (q.multiSelectOptions ?? q.options ?? []).find((o) => o.id === optId)?.content.rawSource ?? '';
    }
    if (fieldKey.startsWith('st:')) {
      const stId = fieldKey.slice(3);
      return q.statements?.find((s) => s.id === stId)?.content.rawSource ?? '';
    }
    if (fieldKey.startsWith('ord:')) {
      const itId = fieldKey.slice(4);
      return q.ordering?.items.find((it) => it.id === itId)?.content.rawSource ?? '';
    }
    if (fieldKey.startsWith('part:')) {
      const partId = fieldKey.slice(5);
      return q.essayParts?.find((p) => p.id === partId)?.content.rawSource ?? '';
    }
    return q.stem.rawSource;
  };

  const applyFieldRawValue = (q: MathQuestion, fieldKey: string, raw: string): MathQuestion => {
    if (fieldKey === 'stem') {
      return { ...q, stem: parseMathContent(raw, `${q.id}-stem`) };
    }
    if (fieldKey === 'solutionGuide') {
      return { ...q, solutionGuide: parseMathContent(raw, `${q.id}-sol`) };
    }
    if (fieldKey.startsWith('opt:')) {
      const optId = fieldKey.slice(4);
      const nextOpts = (q.options ?? []).map((item) =>
        item.id === optId ? { ...item, content: parseMathContent(raw, `${item.id}-c`) } : item
      );
      const deps = detectDependentOptions(nextOpts);
      return {
        ...q,
        options: nextOpts,
        dependencyFlags: deps,
        lockOptionShuffle: q.lockOptionShuffle || deps.length > 0,
      };
    }
    if (fieldKey.startsWith('ms:')) {
      const optId = fieldKey.slice(3);
      const src = q.multiSelectOptions ?? q.options ?? [];
      const next = src.map((o) =>
        o.id === optId ? { ...o, content: parseMathContent(raw, `${o.id}-c`) } : o
      );
      return { ...q, multiSelectOptions: next };
    }
    if (fieldKey.startsWith('st:')) {
      const stId = fieldKey.slice(3);
      const nextSts = (q.statements ?? []).map((item) =>
        item.id === stId ? { ...item, content: parseMathContent(raw, `${item.id}-c`) } : item
      );
      const deps = detectDependentStatements(nextSts);
      return { ...q, statements: nextSts, dependencyFlags: deps };
    }
    if (fieldKey.startsWith('ord:')) {
      const itId = fieldKey.slice(4);
      return {
        ...q,
        ordering: q.ordering
          ? {
              ...q.ordering,
              items: q.ordering.items.map((x) =>
                x.id === itId ? { ...x, content: parseMathContent(raw, `${x.id}-c`) } : x
              ),
            }
          : undefined,
      };
    }
    if (fieldKey.startsWith('part:')) {
      const partId = fieldKey.slice(5);
      return {
        ...q,
        essayParts: (q.essayParts ?? []).map((p) =>
          p.id === partId ? { ...p, content: parseMathContent(raw, `${p.id}-c`) } : p
        ),
      };
    }
    return { ...q, stem: parseMathContent(raw, `${q.id}-stem`) };
  };

  const getOrInitHistory = (q: MathQuestion, fieldKey: string): FieldHistoryState => {
    const hKey = `${q.id}::${fieldKey}`;
    if (!fieldHistoriesRef.current[hKey]) {
      const currentRaw = getFieldRawValue(q, fieldKey);
      fieldHistoriesRef.current[hKey] = createFieldHistory(currentRaw);
    }
    return fieldHistoriesRef.current[hKey];
  };

  const restoreFocusAndSelection = (fieldKey: string, selStart: number, selEnd: number) => {
    pendingSelectionRef.current = { fieldKey, start: selStart, end: selEnd };
    const el = fieldElementRefs.current[fieldKey];
    if (el && document.activeElement !== el) {
      el.focus();
    }
  };

  const handleTrackedFieldChange = (
    fieldKey: string,
    nextRaw: string,
    selStart: number | null,
    selEnd: number | null
  ) => {
    if (!activeQuestion) return;
    const hKey = `${activeQuestion.id}::${fieldKey}`;
    const hist = getOrInitHistory(activeQuestion, fieldKey);
    const cursorPos = selStart ?? nextRaw.length;
    fieldHistoriesRef.current[hKey] = pushFieldHistory(
      hist,
      { value: nextRaw, selectionStart: cursorPos, selectionEnd: selEnd ?? cursorPos },
      100
    );
    setHistoryTick((t) => t + 1);
    updateQuestion(activeQuestion.id, (q) => applyFieldRawValue(q, fieldKey, nextRaw));
  };

  const handleInsertMathSymbol = (symbol: MathToolbarSymbol) => {
    if (!activeQuestion) return;
    const targetKey = fieldElementRefs.current[activeFieldKey] ? activeFieldKey : 'stem';
    const el = fieldElementRefs.current[targetKey];
    const currentRaw = getFieldRawValue(activeQuestion, targetKey);
    const selStart = el?.selectionStart ?? currentRaw.length;
    const selEnd = el?.selectionEnd ?? currentRaw.length;

    const hKey = `${activeQuestion.id}::${targetKey}`;
    const baseHist = getOrInitHistory(activeQuestion, targetKey);
    const withPreSelection: FieldHistoryState = {
      ...baseHist,
      present: { value: currentRaw, selectionStart: selStart, selectionEnd: selEnd },
    };

    const inserted = insertMathSymbolAtCursor(currentRaw, selStart, selEnd, symbol);
    fieldHistoriesRef.current[hKey] = pushFieldHistory(
      withPreSelection,
      {
        value: inserted.nextValue,
        selectionStart: inserted.selectionStart,
        selectionEnd: inserted.selectionEnd,
      },
      100
    );
    setHistoryTick((t) => t + 1);
    updateQuestion(activeQuestion.id, (q) => applyFieldRawValue(q, targetKey, inserted.nextValue));
    restoreFocusAndSelection(targetKey, inserted.selectionStart, inserted.selectionEnd);
  };

  const handleUndoField = (explicitFieldKey?: string) => {
    if (!activeQuestion) return;
    const targetKey = explicitFieldKey ?? (fieldElementRefs.current[activeFieldKey] ? activeFieldKey : 'stem');
    const hKey = `${activeQuestion.id}::${targetKey}`;
    const hist = getOrInitHistory(activeQuestion, targetKey);
    const { nextState, applied } = undoFieldHistory(hist);
    if (!applied) return;
    fieldHistoriesRef.current[hKey] = nextState;
    setHistoryTick((t) => t + 1);
    updateQuestion(activeQuestion.id, (q) => applyFieldRawValue(q, targetKey, applied.value));
    restoreFocusAndSelection(targetKey, applied.selectionStart, applied.selectionEnd);
  };

  const handleRedoField = (explicitFieldKey?: string) => {
    if (!activeQuestion) return;
    const targetKey = explicitFieldKey ?? (fieldElementRefs.current[activeFieldKey] ? activeFieldKey : 'stem');
    const hKey = `${activeQuestion.id}::${targetKey}`;
    const hist = getOrInitHistory(activeQuestion, targetKey);
    const { nextState, applied } = redoFieldHistory(hist);
    if (!applied) return;
    fieldHistoriesRef.current[hKey] = nextState;
    setHistoryTick((t) => t + 1);
    updateQuestion(activeQuestion.id, (q) => applyFieldRawValue(q, targetKey, applied.value));
    restoreFocusAndSelection(targetKey, applied.selectionStart, applied.selectionEnd);
  };

  const handleFieldKeyDown = (
    fieldKey: string,
    e: ReactKeyboardEvent<HTMLTextAreaElement | HTMLInputElement>
  ) => {
    if (!activeQuestion) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      const hist = getOrInitHistory(activeQuestion, fieldKey);
      if (hist.past.length > 0) {
        e.preventDefault();
        handleUndoField(fieldKey);
      }
    } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
      const hist = getOrInitHistory(activeQuestion, fieldKey);
      if (hist.future.length > 0) {
        e.preventDefault();
        handleRedoField(fieldKey);
      }
    }
  };

  const activeToolbarFieldKey = fieldElementRefs.current[activeFieldKey] ? activeFieldKey : 'stem';
  const activeFieldHistory = activeQuestion
    ? fieldHistoriesRef.current[`${activeQuestion.id}::${activeToolbarFieldKey}`]
    : undefined;
  const canUndoActive = (activeFieldHistory?.past.length ?? 0) > 0;
  const canRedoActive = (activeFieldHistory?.future.length ?? 0) > 0;
  const activeFieldLabel =
    activeToolbarFieldKey === 'stem'
      ? 'Đề bài'
      : activeToolbarFieldKey === 'solutionGuide'
      ? 'Hướng dẫn giải'
      : activeToolbarFieldKey.startsWith('opt:')
      ? 'Phương án'
      : activeToolbarFieldKey.startsWith('st:')
      ? 'Mệnh đề Đ/S'
      : 'Ô đang chọn';

  if (stepMode === 2) {
    const statsByType: Record<MathQuestionType, number> = {
      mcq: exam.questions.filter((q) => q.type === 'mcq').length,
      'true-false': exam.questions.filter((q) => q.type === 'true-false').length,
      'short-answer': exam.questions.filter((q) => q.type === 'short-answer').length,
      essay: exam.questions.filter((q) => q.type === 'essay').length,
    };
    const statsByCog: Record<CognitiveLevel, number> = {
      'nhan-biet': exam.questions.filter((q) => q.cognitiveLevel === 'nhan-biet').length,
      'thong-hieu': exam.questions.filter((q) => q.cognitiveLevel === 'thong-hieu').length,
      'van-dung': exam.questions.filter((q) => q.cognitiveLevel === 'van-dung').length,
      'van-dung-cao': exam.questions.filter((q) => q.cognitiveLevel === 'van-dung-cao').length,
    };

    return (
      <div className="space-y-5">
        {/* Step 2 Summary Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                  Bước 2: Kiểm tra cấu trúc &amp; Xác nhận đáp án gốc
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Hệ thống rà soát ID cố định, công thức LaTeX, câu phụ thuộc "Cả A và B" và yêu cầu xác nhận đáp án trước khi trộn.
                </p>
              </div>
              <span className="font-mono-num text-xs font-semibold text-slate-700 dark:text-slate-300">
                Tổng {exam.questions.length} câu
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Trắc nghiệm 4 PA</div>
                <div className="mt-1 text-lg font-bold font-mono-num text-slate-950 dark:text-slate-50">
                  {statsByType.mcq}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Đúng / Sai (4 ý)</div>
                <div className="mt-1 text-lg font-bold font-mono-num text-slate-950 dark:text-slate-50">
                  {statsByType['true-false']}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Trả lời ngắn</div>
                <div className="mt-1 text-lg font-bold font-mono-num text-slate-950 dark:text-slate-50">
                  {statsByType['short-answer']}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Tự luận</div>
                <div className="mt-1 text-lg font-bold font-mono-num text-slate-950 dark:text-slate-50">
                  {statsByType.essay}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
              {(['nhan-biet', 'thong-hieu', 'van-dung', 'van-dung-cao'] as CognitiveLevel[]).map((lvl) => (
                <div key={lvl} className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">{COGNITIVE_LEVEL_LABELS[lvl]}</span>
                  <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                    {statsByCog[lvl]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Confirmation Box */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                {errorIssues.length > 0 ? (
                  <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                ) : exam.confirmedOriginalAnswers ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                )}
                <span>
                  {errorIssues.length > 0
                    ? `Còn ${errorIssues.length} lỗi chặn trộn đề`
                    : exam.confirmedOriginalAnswers
                    ? 'Đề gốc đã xác nhận đáp án — Sẵn sàng trộn'
                    : 'Chờ giáo viên xác nhận đáp án gốc'}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Engine trộn đề dựa hoàn toàn trên ID phương án và ID mệnh đề của đề gốc, tuyệt đối không tự suy đoán đáp án.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                data-tour-id="math-confirm-answers"
                disabled={errorIssues.length > 0}
                onClick={() => {
                  const nextConfirmed = !exam.confirmedOriginalAnswers;
                  const now = new Date().toISOString();
                  const nextQuestions = nextConfirmed
                    ? exam.questions.map((q) => {
                        const contentHash = computeQuestionVerificationContentHash(q);
                        return {
                          ...q,
                          answerConfirmed: true,
                          answerProvenance:
                            q.answerProvenance?.status === 'source-matched'
                              ? {
                                  ...q.answerProvenance,
                                  confirmedAt: now,
                                  confirmedContentHash: contentHash,
                                }
                              : {
                                  ...q.answerProvenance,
                                  status: 'teacher-confirmed' as const,
                                  sourceKind: q.answerProvenance?.sourceKind ?? 'teacher-manual',
                                  sourceFileHash:
                                    q.answerProvenance?.sourceFileHash ?? q.sourceTrace?.sourceFileHash,
                                  sourceLocation: q.answerProvenance?.sourceLocation,
                                  rawEvidence: q.answerProvenance?.rawEvidence,
                                  confirmedAt: now,
                                  confirmedContentHash: contentHash,
                                  note: 'Giáo viên đã xác nhận toàn bộ đáp án gốc ở Bước 2.',
                                },
                        };
                      })
                    : exam.questions;
                  onChangeExam({
                    ...exam,
                    questions: nextQuestions,
                    confirmedOriginalAnswers: nextConfirmed,
                    updatedAt: now,
                  });
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  errorIssues.length > 0
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                    : exam.confirmedOriginalAnswers
                    ? 'border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200'
                    : 'bg-blue-600 dark:bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {exam.confirmedOriginalAnswers
                    ? 'Đã xác nhận đáp án gốc'
                    : 'Xác nhận toàn bộ đáp án gốc'}
                </span>
              </button>

              <button
                type="button"
                disabled={errorIssues.length > 0 || !exam.confirmedOriginalAnswers}
                onClick={() => onGoToStep(3)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <span>Sang Bước 3: Thiết lập trộn</span>
              </button>
            </div>
          </div>
        </div>

        {/* Math Integrity Check 6-Category Report + Manual Re-Check */}
        <MathIntegrityReportPanel
          report={preMixReport}
          onManualCheck={handleRunManualIntegrityCheck}
          onSelectQuestion={(qId) => {
            setSelectedQuestionId(qId);
            onGoToStep(1);
          }}
        />
        {manualCheckTick && (
          <p className="text-[11px] font-mono-num text-slate-600 dark:text-slate-400">
            {manualCheckTick}
          </p>
        )}

        {/* Original Answer Key Audit Table */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
              Bảng đối soát đáp án gốc theo mã ID cố định
            </h3>
            <button
              type="button"
              onClick={() => onGoToStep(1)}
              className="text-xs font-medium text-blue-900 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Quay lại Bước 1 sửa câu hỏi
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5 font-semibold w-14">STT</th>
                  <th className="px-4 py-2.5 font-semibold w-24">Mã câu</th>
                  <th className="px-4 py-2.5 font-semibold w-36">Dạng câu</th>
                  <th className="px-4 py-2.5 font-semibold">Nội dung tóm tắt (KaTeX)</th>
                  <th className="px-4 py-2.5 font-semibold w-44">Đáp án gốc</th>
                  <th className="px-4 py-2.5 font-semibold w-48">Nguồn khóa &amp; Công thức</th>
                  <th className="px-4 py-2.5 font-semibold w-44">Ràng buộc trộn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {exam.questions.map((q, idx) => {
                  const uType = q.universalType ?? q.type;
                  const ansText =
                    uType === 'multi-select'
                      ? (q.multiSelectOptions ?? q.options ?? [])
                          .map((o, oIdx) => (o.isCorrect ? String.fromCharCode(65 + oIdx) : null))
                          .filter(Boolean)
                          .join(', ') || '?'
                      : q.type === 'mcq'
                      ? q.options?.find((o) => o.id === q.correctOptionId)?.originalLabel ?? 'Thiếu khóa'
                      : q.type === 'true-false'
                      ? (q.statements ?? [])
                          .map((s) =>
                            s.answerState === 'missing'
                              ? `${s.originalLabel}:?`
                              : `${s.originalLabel}:${s.isTrue ? 'Đ' : 'S'}${
                                  s.answerState === 'candidate' ? '*' : ''
                                }`
                          )
                          .join(' · ')
                      : uType === 'fill-blank'
                      ? (q.fillBlank?.slots ?? [])
                          .map((s, sIdx) => `(${sIdx + 1}) ${s.acceptedAnswers[0] ?? '?'}`)
                          .join('; ') || q.shortAnswer?.answerValue || 'Chưa nhập'
                      : uType === 'matching'
                      ? (q.matching?.correctPairs ?? [])
                          .map((p) => {
                            const l = q.matching?.leftItems.find((x) => x.id === p.leftItemId)?.originalLabel ?? '?';
                            const r = q.matching?.rightItems.find((x) => x.id === p.rightItemId)?.originalLabel ?? '?';
                            return `${l}→${r}`;
                          })
                          .join(', ') || '?'
                      : uType === 'ordering'
                      ? [...(q.ordering?.items ?? [])]
                          .sort((a, b) => a.correctRank - b.correctRank)
                          .map((it) => it.originalLabel)
                          .join(' → ') || '?'
                      : q.type === 'short-answer'
                      ? `${q.shortAnswer?.answerValue?.trim() ? q.shortAnswer.answerValue : 'Chưa nhập'}${
                          q.shortAnswer?.unit ? ` ${q.shortAnswer.unit}` : ''
                        }`
                      : `Tự luận (${q.points}đ)`;

                  const ansState = evaluateQuestionAnswerState(q);
                  const provStatus = ansState.effectiveStatus;
                  const provBadge =
                    provStatus === 'conflict'
                      ? {
                          label: 'Mâu thuẫn',
                          cls: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200',
                        }
                      : provStatus === 'missing'
                      ? {
                          label: 'Thiếu khóa',
                          cls: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200',
                        }
                      : provStatus === 'needs-review'
                      ? {
                          label: 'Cần duyệt quy ước',
                          cls: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200',
                        }
                      : provStatus === 'source-matched'
                      ? {
                          label: 'Đối chiếu nguồn',
                          cls: 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200',
                        }
                      : provStatus === 'teacher-confirmed' || q.answerConfirmed
                      ? {
                          label: 'Giáo viên xác nhận',
                          cls: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200',
                        }
                      : {
                          label: 'Chưa xác nhận',
                          cls: 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
                        };

                  const canOneClickConfirm = canConfirmEditedKey(q);

                  return (
                    <tr key={q.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-mono-num text-slate-500">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                        {q.code}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {UNIVERSAL_QUESTION_TYPE_LABELS[uType] ?? MATH_QUESTION_TYPE_LABELS[q.type]}
                      </td>
                      <td className="px-4 py-2.5 max-w-md">
                        <div className="line-clamp-2 text-slate-800 dark:text-slate-200">
                          <MathContentRenderer payload={q.stem} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono-num font-semibold text-blue-900 dark:text-blue-300">
                        {ansText}
                      </td>
                      <td className="px-4 py-2.5 space-y-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${provBadge.cls}`}
                          >
                            {provBadge.label}
                          </span>
                          {q.formulaStatus && !q.formulaStatus.displayable && (
                            <span className="inline-flex items-center rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/60 px-1.5 py-0.5 text-[10px] font-mono-num font-semibold text-red-800 dark:text-red-200">
                              OLE chưa giải mã
                            </span>
                          )}
                          {q.formulaStatus &&
                            q.formulaStatus.displayable &&
                            !q.formulaStatus.machineReadable && (
                              <span className="inline-flex items-center rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-mono-num font-semibold text-amber-900 dark:text-amber-200">
                                WMF→SVG
                              </span>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {canOneClickConfirm && (
                            <button
                              type="button"
                              onClick={() => handleConfirmSingleQuestionCandidate(q)}
                              className="rounded border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 whitespace-nowrap"
                            >
                              Xác nhận khóa này
                            </button>
                          )}
                          {(provStatus === 'missing' ||
                            provStatus === 'conflict' ||
                            provStatus === 'needs-review') && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedQuestionId(q.id);
                                onGoToStep(1);
                              }}
                              className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                            >
                              Sửa khóa
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                        {q.lockQuestionPosition && <div>Khóa vị trí câu</div>}
                        {q.lockOptionShuffle && q.type === 'mcq' && <div>Khóa đảo A/B/C/D</div>}
                        {q.type === 'mcq' &&
                          q.options &&
                          q.options.some((o) => o.lockPosition) && (
                            <div className="text-amber-700 dark:text-amber-400 font-mono-num">
                              Khóa PA:{' '}
                              {q.options
                                .map((o, oIdx) => (o.lockPosition ? MCQ_LABELS[oIdx] : null))
                                .filter(Boolean)
                                .join(', ')}
                            </div>
                          )}
                        {q.groupId && (
                          <div className="text-blue-800 dark:text-blue-300">
                            Thuộc nhóm:{' '}
                            {(exam.questionGroups ?? []).find((g) => g.id === q.groupId)?.title ??
                              q.groupId}
                          </div>
                        )}
                        {q.dependencyFlags.length > 0 && (
                          <div className="text-amber-700 dark:text-amber-400">
                            {q.dependencyFlags[0]}
                          </div>
                        )}
                        {!q.lockQuestionPosition &&
                          !(q.lockOptionShuffle && q.type === 'mcq') &&
                          !(q.options?.some((o) => o.lockPosition)) &&
                          !q.groupId &&
                          q.dependencyFlags.length === 0 && <span>Tự do trong phần</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // STEP 1: Exam Editor + Question Bank + LaTeX Paste Importer
  return (
    <div className="space-y-4">
      {/* Exam Header Config */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
          <div className="md:col-span-3">
            <label
              htmlFor="math-exam-title"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Tên đề kiểm tra
            </label>
            <input
              id="math-exam-title"
              type="text"
              value={exam.title}
              onChange={(e) =>
                onChangeExam({ ...exam, title: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-950 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-2" data-tour-id="math-subject-select">
            <label
              htmlFor="exam-subject-select"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Môn học (Hồ sơ)
            </label>
            <select
              id="exam-subject-select"
              aria-label="Chọn môn học"
              value={currentSubjectId}
              onChange={(e) => {
                const nextId = e.target.value as ExamSubjectId;
                const prof = getSubjectProfile(nextId);
                onChangeExam({
                  ...exam,
                  subject: prof.name,
                  subjectId: prof.id,
                  schemaVersion: '6.0',
                  generatedVersions: [],
                });
              }}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            >
              {subjectProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label
              htmlFor="math-exam-grade"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Khối lớp
            </label>
            <select
              id="math-exam-grade"
              value={exam.grade}
              onChange={(e) => onChangeExam({ ...exam, grade: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100"
            >
              {['Lớp 10', 'Lớp 11', 'Lớp 12', 'Lớp 9', 'Lớp 8', 'Lớp 7', 'Lớp 6'].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-1">
            <label
              htmlFor="math-exam-duration"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Phút
            </label>
            <input
              id="math-exam-duration"
              type="number"
              min={15}
              max={180}
              value={exam.durationMinutes}
              onChange={(e) =>
                onChangeExam({
                  ...exam,
                  durationMinutes: Math.max(15, Number(e.target.value) || 45),
                })
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm font-mono-num text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-4 flex flex-wrap items-center md:justify-end gap-2">
            <MathIntegrityBadge status={preMixReport.status} />
            <button
              type="button"
              onClick={() => setShowGroupDrawer((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Nhóm ({(exam.questionGroups ?? []).length})</span>
            </button>
            <button
              type="button"
              data-tour-id="math-import-btn"
              onClick={() => setShowImportDrawer((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Nhập DOCX / PDF / Đề</span>
            </button>
            <button
              type="button"
              onClick={() => onGoToStep(2)}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500 whitespace-nowrap"
            >
              <span>Kiểm tra &amp; Xác nhận</span>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300">
          <span>
            <strong className="text-slate-800 dark:text-slate-100">Hồ sơ bảo toàn {currentProfile.name}:</strong>{' '}
            {currentProfile.groupRules.description}
          </span>
          <span className="font-mono-num text-blue-700 dark:text-blue-400">
            Cấp bảo vệ: {currentProfile.protectionLevel}
          </span>
        </div>

        {/* Question Group Manager Drawer */}
        {showGroupDrawer && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-950 dark:text-slate-50">
                  Quản lý Nhóm câu hỏi chung dữ kiện / hình vẽ
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Các câu cùng nhóm luôn đứng liền kề theo đúng thứ tự. Giáo viên chọn giữ cố định vị trí nhóm hoặc cho phép di chuyển nguyên khối.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGroupDrawer(false)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Đóng
              </button>
            </div>

            {(exam.questionGroups ?? []).length > 0 && (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {(exam.questionGroups ?? []).map((grp) => (
                  <div
                    key={grp.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {grp.title}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-500">
                          Gồm {grp.questionIds.length} câu:{' '}
                          {grp.questionIds
                            .map((id) => exam.questions.find((q) => q.id === id)?.code ?? id)
                            .join(', ')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDisbandGroup(grp.id)}
                        className="rounded border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 whitespace-nowrap"
                      >
                        Giải tán nhóm
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onChangeExam({
                            ...exam,
                            questionGroups: (exam.questionGroups ?? []).map((item) =>
                              item.id === grp.id
                                ? { ...item, lockGroupPosition: true, moveAsUnit: false }
                                : item
                            ),
                            generatedVersions: [],
                          })
                        }
                        className={`rounded border px-2 py-1 text-[11px] font-medium ${
                          grp.lockGroupPosition
                            ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Khóa vị trí cả nhóm
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onChangeExam({
                            ...exam,
                            questionGroups: (exam.questionGroups ?? []).map((item) =>
                              item.id === grp.id
                                ? { ...item, lockGroupPosition: false, moveAsUnit: true }
                                : item
                            ),
                            generatedVersions: [],
                          })
                        }
                        className={`rounded border px-2 py-1 text-[11px] font-medium ${
                          !grp.lockGroupPosition && grp.moveAsUnit
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Di chuyển cả nhóm như 1 đơn vị
                      </button>
                    </div>
                    {grp.sharedAssets.map((asset) => (
                      <MathVisualAssetRenderer key={asset.id} asset={asset} compact />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Create New Group Form */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-2.5 text-xs">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                + Tạo nhóm mới (chọn từ 2 câu liền kề trở lên)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={groupDraftTitle}
                  onChange={(e) => setGroupDraftTitle(e.target.value)}
                  placeholder="Tên nhóm (VD: Nhóm câu đồ thị hàm bậc 3)"
                  className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                />
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Chế độ di chuyển nhóm"
                    value={groupDraftMode}
                    onChange={(e) => setGroupDraftMode(e.target.value as 'move' | 'lock')}
                    className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  >
                    <option value="move">Di chuyển cả nhóm như 1 đơn vị</option>
                    <option value="lock">Khóa cố định vị trí nhóm</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto py-1">
                {exam.questions.map((q, idx) => {
                  const checked = groupDraftIds.includes(q.id);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() =>
                        setGroupDraftIds((prev) =>
                          prev.includes(q.id)
                            ? prev.filter((id) => id !== q.id)
                            : [...prev, q.id]
                        )
                      }
                      className={`rounded border px-2 py-0.5 text-[11px] font-mono-num ${
                        checked
                          ? 'border-blue-700 bg-blue-900 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      #{idx + 1} {q.code}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  {groupFeedback ?? ''}
                </span>
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  className="inline-flex items-center gap-1 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Gom nhóm câu hỏi</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Universal Import Drawer (DOCX / Text-Layer PDF / HTML / Text & LaTeX) */}
        {showImportDrawer && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  Nhập đề đa định dạng cục bộ (.docx / .pdf có lớp chữ / .html / .txt / Dán văn bản)
                </p>
                <p>
                  Xác thực chữ ký tệp thực tế, tách cột 1/2 cột theo tọa độ trang PDF, bảo vệ công thức Toán học bằng cổng đối chiếu 2 cột trước khi trộn.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportDrawer(false)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Đóng
              </button>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={handleDropExamFile}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-3.5 py-3 transition-colors ${
                isDragActive
                  ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700">
                  <Upload className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>
                    {isImportingFile ? 'Đang phân tích tài liệu...' : 'Chọn tệp .docx / .pdf / .html / .txt'}
                  </span>
                  <input
                    data-testid="universal-import-file-input"
                    type="file"
                    accept=".docx,.pdf,.html,.htm,.txt,.md,.tex,.csv,.xlsx"
                    onChange={(e) => void handleUploadExamFile(e)}
                    className="sr-only"
                  />
                </label>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Kéo thả tệp vào đây · Hỗ trợ DOCX (OMML/ảnh) &amp; PDF có lớp chữ · Tối đa 50 MB / 80 trang · 100% cục bộ
                </span>
              </div>
              {isImportingFile && (
                <button
                  type="button"
                  onClick={handleCancelImport}
                  className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/50 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 whitespace-nowrap"
                >
                  Hủy đọc
                </button>
              )}
            </div>

            {importProgress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono-num text-slate-600 dark:text-slate-300">
                  <span>
                    {importProgress.phase === 'loading'
                      ? 'Đang mở tài liệu & kiểm tra chữ ký...'
                      : importProgress.phase === 'parsing-pages'
                      ? `Đang trích xuất tọa độ & cấu trúc Trang ${importProgress.currentPage}/${importProgress.totalPages}...`
                      : importProgress.phase === 'rendering-previews'
                      ? `Đang tạo ảnh đối chiếu Trang ${importProgress.currentPage}/${importProgress.totalPages}...`
                      : 'Đang kiểm chứng tính tương thích...'}
                  </span>
                  <span>{importProgress.percent}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full bg-blue-600 transition-all duration-150"
                    style={{ width: `${importProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            <textarea
              rows={5}
              value={pasteBuffer}
              onChange={(e) => setPasteBuffer(e.target.value)}
              placeholder={`Hoặc dán trực tiếp nội dung đề thi (Toán, Lý, Hóa, Sinh, Văn, Anh...):\nCâu 1: Cho 0,2 mol H₂SO₄ tác dụng với...\nA. 0,1 mol   B. 0,2 mol   C. 0,3 mol   D. 0,4 mol\nĐáp án: B`}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                {pasteFeedback.map((msg, i) => (
                  <p key={i}>{msg}</p>
                ))}
              </div>
              <button
                type="button"
                onClick={handleImportPaste}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Phân tích văn bản dán</span>
              </button>
            </div>

            {importSession && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Báo cáo tương thích: {importSession.originalSource.fileName} ({importSession.compatibilityReport.status})
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowReviewModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-200 hover:bg-blue-100 whitespace-nowrap"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Mở màn hình đối chiếu 2 cột</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono-num text-[11px] text-slate-600 dark:text-slate-300">
                  <span>Nhận diện: {importSession.compatibilityReport.totalDetectedQuestions} câu</span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Sẵn sàng: {importSession.compatibilityReport.safeToMixCount}
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    Cần đối chiếu/Chặn: {importSession.compatibilityReport.blockedCount}
                  </span>
                  <span>Trang chữ: {importSession.compatibilityReport.textLayerPages}/{importSession.compatibilityReport.totalPages}</span>
                </div>
                {importSession.compatibilityReport.recommendations[0] && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    {importSession.compatibilityReport.recommendations[0]}
                  </p>
                )}
                {importSession.questions.length > 0 && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleCommitImport(false)}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <span>Thêm {importSession.questions.length} câu vào cuối đề</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCommitImport(true)}
                      className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Thay thế bằng đề vừa nhập</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {importPreview && !importSession && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Báo cáo chẩn đoán Import ({importPreview.report.fileName ?? importPreview.report.sourceFormat.toUpperCase()})
                  </div>
                  <span className="font-mono-num text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    {importPreview.report.totalParsed} câu · {importPreview.report.groupsCreated} nhóm ·{' '}
                    {importPreview.report.assetsAttached} ảnh/bảng · {importPreview.report.ommlCount} OMML
                    {(importPreview.report.legacyOleCount ?? 0) > 0
                      ? ` · ${importPreview.report.legacyOleCount} OLE cũ`
                      : ''}
                    {(importPreview.report.unsupportedMediaCount ?? 0) > 0
                      ? ` · ${importPreview.report.unsupportedMediaCount} WMF/EMF`
                      : ''}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 dark:bg-slate-800/70 px-3 py-2">
                  <div>
                    <span className="text-slate-600 dark:text-slate-300">Gợi ý môn học: </span>
                    <span className="font-semibold text-blue-700 dark:text-blue-300">
                      {importPreview.report.suggestedSubject.suggestedName}
                    </span>
                    <span className="text-[11px] text-slate-500 ml-2">
                      ({importPreview.report.suggestedSubject.matchedSignals.join('; ')})
                    </span>
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applySuggestedSubject}
                      onChange={(e) => setApplySuggestedSubject(e.target.checked)}
                    />
                    <span>Áp dụng hồ sơ môn gợi ý</span>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px]">
                  {(Object.entries(importPreview.report.countsByType) as Array<[UniversalQuestionType, number]>)
                    .filter(([, count]) => count > 0)
                    .map(([type, count]) => (
                      <span
                        key={type}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 font-mono-num text-slate-700 dark:text-slate-200"
                      >
                        {UNIVERSAL_QUESTION_TYPE_LABELS[type]}: {count}
                      </span>
                    ))}
                  {importPreview.report.unconfirmedAnswerCount > 0 && (
                    <span className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 font-mono-num text-amber-800 dark:text-amber-200">
                      Chưa có đáp án: {importPreview.report.unconfirmedAnswerCount} câu
                    </span>
                  )}
                </div>

                {importPreview.report.warnings.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-amber-800 dark:text-amber-300 list-disc pl-4 max-h-28 overflow-y-auto">
                    {importPreview.report.warnings.slice(0, 8).map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleCommitImport(false)}
                    disabled={!importPreview.report.canImport}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    <span>Thêm {importPreview.questions.length} câu vào cuối đề</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCommitImport(true)}
                    disabled={!importPreview.report.canImport}
                    className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Thay thế bằng đề vừa nhập</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Main Split Editor: Question Sidebar + Question Detail Editor */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left List */}
        <aside className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Câu hỏi ({filteredQuestions.length}/{exam.questions.length})
              </span>
              <select
                aria-label="Lọc danh sách câu hỏi"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as QuestionFilterKind)}
                className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200"
              >
                <option value="all">Tất cả câu</option>
                <option value="locked">Đã khóa vị trí</option>
                <option value="unlocked">Chưa khóa vị trí</option>
                <option value="grouped">Thuộc nhóm câu hỏi</option>
                <option value="mcq">4 phương án</option>
                <option value="multi-select">Nhiều đáp án đúng</option>
                <option value="true-false">Đúng / Sai</option>
                <option value="short-answer">Trả lời ngắn</option>
                <option value="fill-blank">Điền khuyết</option>
                <option value="matching">Ghép đôi</option>
                <option value="ordering">Sắp xếp trình tự</option>
                <option value="reading-comprehension">Đọc hiểu nhóm</option>
                <option value="essay">Tự luận</option>
              </select>
            </div>

            {/* Lock Summary Strip + Bulk Lock/Unlock */}
            <div
              data-tour-id="math-lock-strip"
              className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-2.5 py-1.5 text-[11px]"
            >
              <span className="font-mono-num text-slate-600 dark:text-slate-300">
                Khóa: {lockStats.lockedQuestions} câu · {lockStats.lockedOptions} PA
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleBulkLockAll(true)}
                  className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  Khóa tất cả
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkLockAll(false)}
                  className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  Mở khóa tất cả
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ['mcq', '+ Trắc nghiệm'],
                  ['true-false', '+ Đúng/Sai'],
                  ['short-answer', '+ Trả lời ngắn'],
                  ['essay', '+ Tự luận'],
                ] as Array<[MathQuestionType, string]>
              ).map(([type, lbl]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleAddQuestion(type)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[540px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {filteredQuestions.map((q) => {
              const globalIdx = exam.questions.findIndex((item) => item.id === q.id) + 1;
              const isSelected = activeQuestion?.id === q.id;
              const isLocked =
                q.lockQuestionPosition || exam.mixConfig.lockedQuestionIds.includes(q.id);
              const lockedOptCount = (q.options ?? []).filter((o) => Boolean(o.lockPosition)).length;
              const qIssues = issuesByQuestionId.get(q.id) ?? [];
              const hasBlockedIssue = qIssues.some((i) => i.severity === 'error');
              const hasWarnIssue = !hasBlockedIssue && qIssues.length > 0;
              return (
                <div
                  key={q.id}
                  className={`flex items-start gap-2 px-3 py-2.5 transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/60'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <button
                    type="button"
                    aria-label={`${isLocked ? 'Mở khóa' : 'Khóa'} vị trí câu ${globalIdx} (${q.code})`}
                    title={isLocked ? 'Đang khóa vị trí câu' : 'Nhấn để khóa vị trí câu'}
                    onClick={() =>
                      updateQuestion(q.id, (item) => {
                        const nextLocked = !item.lockQuestionPosition;
                        return {
                          ...item,
                          lockQuestionPosition: nextLocked,
                          universalLock: item.universalLock
                            ? { ...item.universalLock, positionLock: nextLocked }
                            : undefined,
                        };
                      })
                    }
                    className={`mt-0.5 shrink-0 rounded border p-1 transition-colors ${
                      isLocked
                        ? 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {isLocked ? (
                      <Lock className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <Unlock className="h-3 w-3" aria-hidden="true" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedQuestionId(q.id)}
                    className="flex-1 min-w-0 text-left space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5">
                        <span>Câu {globalIdx} · {q.code}</span>
                        {hasBlockedIssue && (
                          <span className="rounded bg-red-100 dark:bg-red-950 px-1 py-0.5 text-[9px] font-bold text-red-700 dark:text-red-300">
                            LỖI
                          </span>
                        )}
                        {hasWarnIssue && (
                          <span className="rounded bg-amber-100 dark:bg-amber-950 px-1 py-0.5 text-[9px] font-bold text-amber-800 dark:text-amber-300">
                            CẢNH BÁO
                          </span>
                        )}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {COGNITIVE_LEVEL_LABELS[q.cognitiveLevel]}
                      </span>
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2">
                      <MathContentRenderer payload={q.stem} />
                    </div>
                    {(isLocked ||
                      lockedOptCount > 0 ||
                      q.lockOptionShuffle ||
                      q.groupId ||
                      (q.visualAssets?.length ?? 0) > 0 ||
                      q.dependencyFlags.length > 0) && (
                      <div className="flex flex-wrap gap-1.5 text-[10px] font-mono-num">
                        {isLocked && (
                          <span className="text-amber-700 dark:text-amber-400">Khóa câu</span>
                        )}
                        {lockedOptCount > 0 && (
                          <span className="text-amber-700 dark:text-amber-400">
                            Khóa {lockedOptCount} PA
                          </span>
                        )}
                        {q.lockOptionShuffle && q.type === 'mcq' && (
                          <span className="text-amber-700 dark:text-amber-400">Khóa A/B/C/D</span>
                        )}
                        {q.groupId && (
                          <span className="text-blue-800 dark:text-blue-300">Trong nhóm</span>
                        )}
                        {(q.visualAssets?.length ?? 0) > 0 && (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {q.visualAssets!.length} hình/BBT
                          </span>
                        )}
                        {q.dependencyFlags.length > 0 && (
                          <span className="text-amber-700 dark:text-amber-400">Phụ thuộc</span>
                        )}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right Detail Editor */}
        <section className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          {!activeQuestion ? (
            <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
              Chọn một câu hỏi bên trái hoặc nhấn "+ Trắc nghiệm" để bắt đầu soạn đề Toán.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Top Question Meta & Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Mã câu hỏi"
                    type="text"
                    value={activeQuestion.code}
                    onChange={(e) =>
                      updateQuestion(activeQuestion.id, (q) => ({
                        ...q,
                        code: e.target.value,
                      }))
                    }
                    className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono-num font-semibold text-slate-900 dark:text-slate-100"
                  />
                  <select
                    aria-label="Mức độ nhận thức"
                    value={activeQuestion.cognitiveLevel}
                    onChange={(e) =>
                      updateQuestion(activeQuestion.id, (q) => ({
                        ...q,
                        cognitiveLevel: e.target.value as CognitiveLevel,
                      }))
                    }
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-100"
                  >
                    {Object.entries(COGNITIVE_LEVEL_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {currentSubjectId === 'toan' ? (
                    <select
                      aria-label="Chuyên đề Toán"
                      value={activeQuestion.topic}
                      onChange={(e) =>
                        updateQuestion(activeQuestion.id, (q) => ({
                          ...q,
                          topic: e.target.value,
                        }))
                      }
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-100"
                    >
                      {MATH_TOPICS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label="Chủ đề / Chuyên đề"
                      type="text"
                      value={activeQuestion.topic}
                      onChange={(e) =>
                        updateQuestion(activeQuestion.id, (q) => ({
                          ...q,
                          topic: e.target.value,
                        }))
                      }
                      placeholder={currentProfile.name}
                      className="w-40 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-100"
                    />
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      updateQuestion(activeQuestion.id, (q) => {
                        const nextLocked = !q.lockQuestionPosition;
                        return {
                          ...q,
                          lockQuestionPosition: nextLocked,
                          universalLock: q.universalLock
                            ? { ...q.universalLock, positionLock: nextLocked }
                            : undefined,
                        };
                      })
                    }
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                      activeQuestion.lockQuestionPosition
                        ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {activeQuestion.lockQuestionPosition ? (
                      <Lock className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <Unlock className="h-3 w-3" aria-hidden="true" />
                    )}
                    <span>{activeQuestion.lockQuestionPosition ? 'Đã khóa vị trí' : 'Khóa vị trí'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateQuestion(activeQuestion)}
                    title="Nhân bản câu hỏi"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteQuestion(activeQuestion.id)}
                    title="Xóa câu hỏi"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {activeQuestion.sourceVerification &&
                !activeQuestion.sourceVerification.verifiedByTeacher && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/35 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    <div className="space-y-0.5">
                      <p className="font-semibold">
                        Câu nhập từ {activeQuestion.sourceVerification.sourceFormat.toUpperCase()} đang chờ xác nhận bảo toàn Toán học
                        {activeQuestion.sourceVerification.pageNumber
                          ? ` (Trang ${activeQuestion.sourceVerification.pageNumber})`
                          : ''}
                      </p>
                      <p className="text-[11px]">
                        {activeQuestion.sourceVerification.formulaRiskFlags[0] ??
                          activeQuestion.sourceVerification.reasons[0] ??
                          'Cần kiểm tra công thức trước khi trộn.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateQuestion(activeQuestion.id, (q) => ({
                          ...q,
                          sourceVerification: q.sourceVerification
                            ? {
                                ...q.sourceVerification,
                                verifiedByTeacher: true,
                                verifiedAt: new Date().toISOString(),
                              }
                            : undefined,
                        }))
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Đã xác nhận công thức PDF</span>
                    </button>
                  </div>
                )}

              {/* Section title + LaTeX Snippet Toolbar */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Đề bài (hỗ trợ LaTeX $...$ và $$...$$)
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {MATH_SECTION_TITLES[activeQuestion.type]}
                  </span>
                </div>

                <MathSymbolToolbar
                  onInsertSymbol={handleInsertMathSymbol}
                  onUndo={() => handleUndoField()}
                  onRedo={() => handleRedoField()}
                  canUndo={canUndoActive}
                  canRedo={canRedoActive}
                  activeFieldLabel={activeFieldLabel}
                />

                <textarea
                  ref={(el) => {
                    fieldElementRefs.current['stem'] = el;
                  }}
                  aria-label="Nội dung đề bài Toán"
                  rows={3}
                  value={activeQuestion.stem.rawSource}
                  onFocus={() => setActiveFieldKey('stem')}
                  onKeyDown={(e) => handleFieldKeyDown('stem', e)}
                  onChange={(e) =>
                    handleTrackedFieldChange(
                      'stem',
                      e.target.value,
                      e.target.selectionStart,
                      e.target.selectionEnd
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />

                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/50 px-3 py-2 text-sm text-slate-900 dark:text-slate-100">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Xem trước KaTeX
                  </div>
                  <MathContentRenderer payload={activeQuestion.stem} />
                </div>
              </div>

              {/* Type-specific Editors */}
              {(activeQuestion.universalType ?? activeQuestion.type) === 'multi-select' && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Trắc nghiệm nhiều đáp án đúng (chọn ≥ 1 phương án đúng)
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeQuestion.lockOptionShuffle}
                        onChange={(e) =>
                          updateQuestion(activeQuestion.id, (q) => ({
                            ...q,
                            lockOptionShuffle: e.target.checked,
                          }))
                        }
                      />
                      <span>Khóa thứ tự phương án</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(activeQuestion.multiSelectOptions ?? activeQuestion.options ?? []).map((opt, idx) => {
                      const lbl = String.fromCharCode(65 + idx);
                      return (
                        <div
                          key={opt.id}
                          className={`rounded-lg border p-2.5 space-y-1.5 ${
                            opt.isCorrect
                              ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono-num text-xs font-bold">Phương án {lbl}</span>
                            <button
                              type="button"
                              onClick={() =>
                                updateQuestionAnswer(activeQuestion.id, (q) => {
                                  const src = q.multiSelectOptions ?? q.options ?? [];
                                  const next = src.map((o) =>
                                    o.id === opt.id ? { ...o, isCorrect: !o.isCorrect } : o
                                  );
                                  return {
                                    ...q,
                                    multiSelectOptions: next,
                                    correctOptionIds: next.filter((o) => o.isCorrect).map((o) => o.id),
                                  };
                                })
                              }
                              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                                opt.isCorrect
                                  ? 'bg-emerald-700 text-white'
                                  : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {opt.isCorrect ? 'Là đáp án đúng' : 'Đánh dấu đúng'}
                            </button>
                          </div>
                          <input
                            ref={(el) => {
                              fieldElementRefs.current[`ms:${opt.id}`] = el;
                            }}
                            type="text"
                            value={opt.content.rawSource}
                            onFocus={() => setActiveFieldKey(`ms:${opt.id}`)}
                            onKeyDown={(e) => handleFieldKeyDown(`ms:${opt.id}`, e)}
                            onChange={(e) =>
                              handleTrackedFieldChange(
                                `ms:${opt.id}`,
                                e.target.value,
                                e.target.selectionStart,
                                e.target.selectionEnd
                              )
                            }
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-mono"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(activeQuestion.universalType ?? activeQuestion.type) !== 'multi-select' &&
                activeQuestion.type === 'mcq' &&
                activeQuestion.options && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      4 phương án A / B / C / D (chọn đúng 1 đáp án gốc)
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeQuestion.lockOptionShuffle}
                        onChange={(e) =>
                          updateQuestion(activeQuestion.id, (q) => ({
                            ...q,
                            lockOptionShuffle: e.target.checked,
                          }))
                        }
                      />
                      <span>Khóa thứ tự A/B/C/D</span>
                    </label>
                  </div>

                  {activeQuestion.dependencyFlags.length > 0 && (
                    <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                      Cảnh báo an toàn: {activeQuestion.dependencyFlags.join('; ')}. Engine tự động khóa thứ tự phương án A/B/C/D cho câu này.
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {activeQuestion.options.map((opt, idx) => {
                      const isCorrect = opt.id === activeQuestion.correctOptionId;
                      return (
                        <div
                          key={opt.id}
                          className={`rounded-lg border p-2.5 space-y-1.5 ${
                            isCorrect
                              ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-mono-num text-xs font-bold text-slate-800 dark:text-slate-200">
                              Phương án {MCQ_LABELS[idx]}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-pressed={Boolean(opt.lockPosition)}
                                title={
                                  opt.lockPosition
                                    ? `Đang khóa phương án ${MCQ_LABELS[idx]} tại vị trí ${MCQ_LABELS[idx]}`
                                    : `Khóa vị trí phương án ${MCQ_LABELS[idx]}`
                                }
                                onClick={() =>
                                  updateQuestion(activeQuestion.id, (q) => ({
                                    ...q,
                                    options: (q.options ?? []).map((item) =>
                                      item.id === opt.id
                                        ? { ...item, lockPosition: !item.lockPosition }
                                        : item
                                    ),
                                  }))
                                }
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                                  opt.lockPosition
                                    ? 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                    : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-800'
                                }`}
                              >
                                {opt.lockPosition ? (
                                  <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                                ) : (
                                  <Unlock className="h-2.5 w-2.5" aria-hidden="true" />
                                )}
                                <span>Khóa {MCQ_LABELS[idx]}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateQuestionAnswer(
                                    activeQuestion.id,
                                    (q) => ({
                                      ...q,
                                      correctOptionId: opt.id,
                                      options: (q.options ?? []).map((item) => ({
                                        ...item,
                                        isCorrect: item.id === opt.id,
                                      })),
                                    }),
                                    { selectionSummary: `Phương án ${MCQ_LABELS[idx]}` }
                                  )
                                }
                                className={`rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                                  isCorrect
                                    ? 'bg-emerald-700 text-white'
                                    : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {isCorrect ? 'Đáp án đúng' : 'Đặt là đúng'}
                              </button>
                            </div>
                          </div>
                          <input
                            ref={(el) => {
                              fieldElementRefs.current[`opt:${opt.id}`] = el;
                            }}
                            type="text"
                            aria-label={`Nội dung phương án ${MCQ_LABELS[idx]}`}
                            value={opt.content.rawSource}
                            onFocus={() => setActiveFieldKey(`opt:${opt.id}`)}
                            onKeyDown={(e) => handleFieldKeyDown(`opt:${opt.id}`, e)}
                            onChange={(e) =>
                              handleTrackedFieldChange(
                                `opt:${opt.id}`,
                                e.target.value,
                                e.target.selectionStart,
                                e.target.selectionEnd
                              )
                            }
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                          />
                          <div className="text-xs text-slate-700 dark:text-slate-300">
                            <MathContentRenderer payload={opt.content} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeQuestion.type === 'true-false' && activeQuestion.statements && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      4 mệnh đề Đúng / Sai (a, b, c, d)
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeQuestion.allowStatementShuffle}
                        onChange={(e) =>
                          updateQuestion(activeQuestion.id, (q) => ({
                            ...q,
                            allowStatementShuffle: e.target.checked,
                          }))
                        }
                      />
                      <span>Cho phép đảo ý a/b/c/d (nếu các ý độc lập)</span>
                    </label>
                  </div>

                  <div className="space-y-2">
                    {activeQuestion.statements.map((st, idx) => (
                      <div
                        key={st.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono-num text-xs font-bold text-slate-800 dark:text-slate-200">
                            Ý {TF_LABELS[idx]})
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                updateQuestionAnswer(
                                  activeQuestion.id,
                                  (q) => ({
                                    ...q,
                                    statements: (q.statements ?? []).map((item) =>
                                      item.id === st.id ? { ...item, isTrue: true, answerState: 'confirmed' as const } : item
                                    ),
                                  })
                                )
                              }
                              className={`rounded px-2.5 py-0.5 text-[11px] font-medium ${
                                st.isTrue && st.answerState !== 'missing' && st.answerState !== 'candidate'
                                  ? 'bg-emerald-700 text-white'
                                  : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              Đúng
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateQuestionAnswer(
                                  activeQuestion.id,
                                  (q) => ({
                                    ...q,
                                    statements: (q.statements ?? []).map((item) =>
                                      item.id === st.id ? { ...item, isTrue: false, answerState: 'confirmed' as const } : item
                                    ),
                                  })
                                )
                              }
                              className={`rounded px-2.5 py-0.5 text-[11px] font-medium ${
                                !st.isTrue && st.answerState !== 'missing' && st.answerState !== 'candidate'
                                  ? 'bg-slate-800 dark:bg-slate-600 text-white'
                                  : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              Sai
                            </button>
                          </div>
                        </div>
                        <input
                          ref={(el) => {
                            fieldElementRefs.current[`st:${st.id}`] = el;
                          }}
                          type="text"
                          value={st.content.rawSource}
                          onFocus={() => setActiveFieldKey(`st:${st.id}`)}
                          onKeyDown={(e) => handleFieldKeyDown(`st:${st.id}`, e)}
                          onChange={(e) =>
                            handleTrackedFieldChange(
                              `st:${st.id}`,
                              e.target.value,
                              e.target.selectionStart,
                              e.target.selectionEnd
                            )
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                        />
                        <div className="text-xs text-slate-700 dark:text-slate-300">
                          <MathContentRenderer payload={st.content} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(activeQuestion.universalType ?? activeQuestion.type) === 'fill-blank' &&
                activeQuestion.fillBlank && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Đáp án từng chỗ trống Điền khuyết ({activeQuestion.fillBlank.slots.length} vị trí)
                  </div>
                  <div className="space-y-2">
                    {activeQuestion.fillBlank.slots.map((slot, sIdx) => (
                      <div key={slot.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <span className="sm:col-span-3 font-mono-num text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Chỗ trống ({slot.slotNumber || sIdx + 1})
                        </span>
                        <input
                          type="text"
                          value={slot.acceptedAnswers.join(' | ')}
                          onChange={(e) => {
                            const answers = e.target.value
                              .split('|')
                              .map((s) => s.trim())
                              .filter(Boolean);
                            updateQuestionAnswer(activeQuestion.id, (q) => ({
                              ...q,
                              fillBlank: q.fillBlank
                                ? {
                                    ...q.fillBlank,
                                    slots: q.fillBlank.slots.map((sl) =>
                                      sl.id === slot.id ? { ...sl, acceptedAnswers: answers } : sl
                                    ),
                                  }
                                : undefined,
                            }));
                          }}
                          placeholder="Đáp án đúng (ngăn cách nhiều phương án bằng |)"
                          className="sm:col-span-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(activeQuestion.universalType ?? activeQuestion.type) === 'matching' &&
                activeQuestion.matching && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Câu hỏi Ghép đôi ({activeQuestion.matching.leftItems.length} cột A · {activeQuestion.matching.rightItems.length} cột B)
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeQuestion.matching.allowShuffleRight}
                        onChange={(e) =>
                          updateQuestion(activeQuestion.id, (q) => ({
                            ...q,
                            matching: q.matching
                              ? { ...q.matching, allowShuffleRight: e.target.checked }
                              : undefined,
                          }))
                        }
                      />
                      <span>Cho phép đảo cột B (ánh xạ ID)</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {activeQuestion.matching.correctPairs.map((pair, pIdx) => {
                      const left = activeQuestion.matching!.leftItems.find((x) => x.id === pair.leftItemId);
                      const right = activeQuestion.matching!.rightItems.find((x) => x.id === pair.rightItemId);
                      return (
                        <div
                          key={`${pair.leftItemId}-${pair.rightItemId}-${pIdx}`}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 px-2.5 py-2"
                        >
                          <div className="font-mono-num font-semibold text-blue-800 dark:text-blue-300">
                            {left?.originalLabel} ↔ {right?.originalLabel}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                            {left?.content.rawSource} → {right?.content.rawSource}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(activeQuestion.universalType ?? activeQuestion.type) === 'ordering' &&
                activeQuestion.ordering && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Câu hỏi Sắp xếp trình tự ({activeQuestion.ordering.items.length} bước)
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeQuestion.lockOptionShuffle}
                        onChange={(e) =>
                          updateQuestion(activeQuestion.id, (q) => ({
                            ...q,
                            lockOptionShuffle: e.target.checked,
                          }))
                        }
                      />
                      <span>Khóa thứ tự các mảnh trình bày</span>
                    </label>
                  </div>
                  <div className="space-y-1.5">
                    {activeQuestion.ordering.items.map((it) => (
                      <div key={it.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center text-xs">
                        <span className="sm:col-span-1 font-mono-num font-bold">{it.originalLabel}.</span>
                        <input
                          ref={(el) => {
                            fieldElementRefs.current[`ord:${it.id}`] = el;
                          }}
                          type="text"
                          value={it.content.rawSource}
                          onFocus={() => setActiveFieldKey(`ord:${it.id}`)}
                          onKeyDown={(e) => handleFieldKeyDown(`ord:${it.id}`, e)}
                          onChange={(e) =>
                            handleTrackedFieldChange(
                              `ord:${it.id}`,
                              e.target.value,
                              e.target.selectionStart,
                              e.target.selectionEnd
                            )
                          }
                          className="sm:col-span-9 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 font-mono"
                        />
                        <div className="sm:col-span-2 flex items-center gap-1">
                          <span className="text-[11px] text-slate-500">Hạng:</span>
                          <input
                            type="number"
                            min={1}
                            max={activeQuestion.ordering!.items.length}
                            value={it.correctRank}
                            onChange={(e) => {
                              const rk = Math.max(1, Number(e.target.value) || 1);
                              updateQuestionAnswer(activeQuestion.id, (q) => ({
                                ...q,
                                ordering: q.ordering
                                  ? {
                                      ...q.ordering,
                                      items: q.ordering.items.map((x) =>
                                        x.id === it.id ? { ...x, correctRank: rk } : x
                                      ),
                                    }
                                  : undefined,
                              }));
                            }}
                            className="w-14 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1 font-mono-num"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeQuestion.type === 'short-answer' &&
                !['fill-blank', 'matching', 'ordering'].includes(
                  activeQuestion.universalType ?? activeQuestion.type
                ) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Đáp án số cố định
                    </label>
                    <input
                      type="text"
                      value={activeQuestion.shortAnswer?.answerValue ?? ''}
                      onChange={(e) => {
                        const rawVal = e.target.value;
                        const trimmed = rawVal.trim();
                        const normalized = trimmed
                          .replace(/−/g, '-')
                          .replace(/\s+/g, '')
                          .replace(/^(-?\d+),(\d+)$/, '$1.$2');
                        updateQuestionAnswer(activeQuestion.id, (q) => ({
                          ...q,
                          shortAnswer: {
                            ...(q.shortAnswer ?? { answerValue: rawVal, acceptedFormats: [] }),
                            answerValue: rawVal,
                            rawAnswer: trimmed,
                            normalizedAnswer: normalized,
                            acceptedFormats: Array.from(new Set([trimmed, normalized].filter(Boolean))),
                            unit: q.shortAnswer?.unit ?? '',
                            domainCondition: q.shortAnswer?.domainCondition ?? '',
                          },
                        }));
                      }}
                      placeholder="VD: 0,60 hoặc -3/2"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Đơn vị (nếu có)
                    </label>
                    <input
                      type="text"
                      value={activeQuestion.shortAnswer?.unit ?? ''}
                      onChange={(e) =>
                        updateQuestion(activeQuestion.id, (q) => ({
                          ...q,
                          shortAnswer: {
                            answerValue: q.shortAnswer?.answerValue ?? '',
                            acceptedFormats: q.shortAnswer?.acceptedFormats ?? [],
                            unit: e.target.value,
                            domainCondition: q.shortAnswer?.domainCondition ?? '',
                          },
                        }))
                      }
                      placeholder="VD: cm³, đồng"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Quy ước làm tròn / miền giá trị
                    </label>
                    <input
                      type="text"
                      value={activeQuestion.shortAnswer?.domainCondition ?? ''}
                      onChange={(e) =>
                        updateQuestion(activeQuestion.id, (q) => ({
                          ...q,
                          shortAnswer: {
                            answerValue: q.shortAnswer?.answerValue ?? '',
                            acceptedFormats: q.shortAnswer?.acceptedFormats ?? [],
                            unit: q.shortAnswer?.unit ?? '',
                            domainCondition: e.target.value,
                          },
                        }))
                      }
                      placeholder="VD: Làm tròn hàng phần trăm"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              )}

              {activeQuestion.type === 'essay' && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Các ý phụ a, b, c (luôn giữ nguyên thứ tự bên trong bài toán)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateQuestion(activeQuestion.id, (q) => {
                          const parts = q.essayParts ?? [];
                          const nextLbl = `${String.fromCharCode(97 + parts.length)})`;
                          return {
                            ...q,
                            essayParts: [
                              ...parts,
                              {
                                id: `${q.id}-part-${parts.length + 1}`,
                                label: nextLbl,
                                content: parseMathContent(''),
                                points: 1,
                                solutionOutline: parseMathContent(''),
                              },
                            ],
                          };
                        })
                      }
                      className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                    >
                      + Thêm ý phụ
                    </button>
                  </div>
                  {(activeQuestion.essayParts ?? []).map((part) => (
                    <div
                      key={part.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono-num font-bold">Ý {part.label}</span>
                        <span className="font-mono-num text-slate-500">{part.points} điểm</span>
                      </div>
                      <input
                        ref={(el) => {
                          fieldElementRefs.current[`part:${part.id}`] = el;
                        }}
                        type="text"
                        value={part.content.rawSource}
                        onFocus={() => setActiveFieldKey(`part:${part.id}`)}
                        onKeyDown={(e) => handleFieldKeyDown(`part:${part.id}`, e)}
                        onChange={(e) =>
                          handleTrackedFieldChange(
                            `part:${part.id}`,
                            e.target.value,
                            e.target.selectionStart,
                            e.target.selectionEnd
                          )
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Visual Assets Attachment & Preview (SVG / Image / Variation Table) */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Hình vẽ hình học / Đồ thị / Bảng biến thiên đính kèm ({activeQuestion.visualAssets?.length ?? 0})
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {VISUAL_ASSET_PRESETS.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => handleAttachPresetAsset(preset.key)}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                      >
                        + {preset.label.split(' ').slice(0, 3).join(' ')}
                      </button>
                    ))}
                    <label className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer whitespace-nowrap">
                      <ImagePlus className="h-3 w-3" aria-hidden="true" />
                      <span>Tải ảnh</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={handleUploadImageAsset}
                      />
                    </label>
                  </div>
                </div>

                {(activeQuestion.visualAssets ?? []).length > 0 && (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {(activeQuestion.visualAssets ?? []).map((asset) => (
                      <div key={asset.id} className="space-y-1">
                        <MathVisualAssetRenderer asset={asset} />
                        <button
                          type="button"
                          onClick={() =>
                            updateQuestion(activeQuestion.id, (q) => {
                              const nextAssets = (q.visualAssets ?? []).filter(
                                (a) => a.id !== asset.id
                              );
                              return {
                                ...q,
                                visualAssets: nextAssets,
                                hasVisualAsset: nextAssets.length > 0,
                              };
                            })
                          }
                          className="text-[11px] text-red-700 dark:text-red-400 hover:underline"
                        >
                          Xóa tài nguyên "{asset.label}"
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Solution Guide */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Hướng dẫn giải / Ghi chú giáo viên (tùy chọn)
                </label>
                <input
                  ref={(el) => {
                    fieldElementRefs.current['solutionGuide'] = el;
                  }}
                  type="text"
                  value={activeQuestion.solutionGuide.rawSource}
                  onFocus={() => setActiveFieldKey('solutionGuide')}
                  onKeyDown={(e) => handleFieldKeyDown('solutionGuide', e)}
                  onChange={(e) =>
                    handleTrackedFieldChange(
                      'solutionGuide',
                      e.target.value,
                      e.target.selectionStart,
                      e.target.selectionEnd
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          )}
        </section>
      </div>

      {showReviewModal && importSession && (
        <UniversalImportReviewModal
          session={importSession}
          applySuggestedSubject={applySuggestedSubject}
          onChangeApplySuggestedSubject={setApplySuggestedSubject}
          onChangeSession={setImportSession}
          onCommit={handleCommitImport}
          onClose={() => setShowReviewModal(false)}
        />
      )}
    </div>
  );
}

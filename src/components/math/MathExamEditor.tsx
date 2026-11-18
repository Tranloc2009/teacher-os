import { ChangeEvent, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Copy,
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
  computeLockStats,
  createMathVisualAsset,
  detectDependentOptions,
  detectDependentStatements,
  evaluatePreMixIntegrity,
  parseMathContent,
} from '../../core/mathIntegrity';
import {
  getSubjectProfile,
  listSubjectProfiles,
  resolveSubjectId,
} from '../../core/subjectProfileRegistry';
import {
  UniversalImportResult,
  importUniversalExamFile,
  mergeImportedExamIntoProject,
  parseUniversalExamText,
} from '../../core/universalImportEngine';
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

const LATEX_SNIPPETS: Array<{ label: string; snippet: string }> = [
  { label: 'Phân số', snippet: '$\\frac{a}{b}$' },
  { label: 'Căn bậc 2', snippet: '$\\sqrt{x}$' },
  { label: 'Số mũ / Chỉ số', snippet: '$x^2 + x_1$' },
  { label: 'Giới hạn', snippet: '$\\lim_{x \\to 0}$' },
  { label: 'Tích phân', snippet: '$\\int_{0}^{1} f(x)\\,dx$' },
  { label: 'Vectơ', snippet: '$\\vec{u} = (a; b; c)$' },
  { label: 'Logarit', snippet: '$\\log_{a}(x)$' },
  { label: 'Hệ PT', snippet: '$\\begin{cases} x + y = 2 \\\\ x - y = 0 \\end{cases}$' },
  { label: 'Tập hợp ℝ', snippet: '$D = \\mathbb{R} \\setminus \\{0\\}$' },
];

type QuestionFilterKind =
  | MathQuestionType
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
  const [applySuggestedSubject, setApplySuggestedSubject] = useState(true);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [filterType, setFilterType] = useState<QuestionFilterKind>('all');
  const [groupDraftIds, setGroupDraftIds] = useState<string[]>([]);
  const [groupDraftTitle, setGroupDraftTitle] = useState('');
  const [groupDraftContext, setGroupDraftContext] = useState('');
  const [groupDraftMode, setGroupDraftMode] = useState<'move' | 'lock'>('move');
  const [groupFeedback, setGroupFeedback] = useState<string | null>(null);
  const [manualCheckTick, setManualCheckTick] = useState<string | null>(null);

  const subjectProfiles = useMemo(() => listSubjectProfiles(), []);
  const currentSubjectId = useMemo(
    () => resolveSubjectId(exam.subjectId || exam.subject || 'Toán học'),
    [exam.subjectId, exam.subject]
  );

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
    return exam.questions.filter((q) => q.type === filterType);
  }, [exam.questions, exam.mixConfig.lockedQuestionIds, filterType]);

  const errorIssues = integrityIssues.filter((i) => i.severity === 'error');

  const updateQuestion = (qId: string, updater: (q: MathQuestion) => MathQuestion) => {
    const nextQuestions = exam.questions.map((q) => (q.id === qId ? updater(q) : q));
    onChangeExam({
      ...exam,
      questions: nextQuestions,
      confirmedOriginalAnswers: false,
      generatedVersions: [],
      updatedAt: new Date().toISOString(),
    });
  };

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

  const handleUploadExamFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      setPasteFeedback(['Tệp vượt quá giới hạn 50 MB. Vui lòng chia nhỏ tài liệu trước khi nhập.']);
      return;
    }

    setIsImportingFile(true);
    setPasteFeedback([]);
    try {
      const lower = file.name.toLowerCase();
      let result: UniversalImportResult;
      if (lower.endsWith('.docx')) {
        const buffer = await file.arrayBuffer();
        result = await importUniversalExamFile(
          { fileName: file.name, buffer },
          createId,
          { subjectId: currentSubjectId }
        );
      } else {
        const textContent = await file.text();
        result = await importUniversalExamFile(
          { fileName: file.name, textContent },
          createId,
          { subjectId: currentSubjectId }
        );
      }
      setImportPreview(result);
      setApplySuggestedSubject(result.report.suggestedSubject.confidence !== 'low');
      setPasteFeedback(
        result.questions.length > 0
          ? [`Đã phân tích tệp "${file.name}": nhận diện ${result.questions.length} câu hỏi.`]
          : [`Không tách được câu hỏi từ tệp "${file.name}". Xem cảnh báo chi tiết bên dưới.`]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể đọc tệp đề thi.';
      setImportPreview(null);
      setPasteFeedback([`Lỗi đọc tệp "${file.name}": ${msg}`]);
    } finally {
      setIsImportingFile(false);
    }
  };

  const handleCommitImport = (replaceExisting: boolean) => {
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

  const insertSnippetToStem = (snippet: string) => {
    if (!activeQuestion) return;
    const nextRaw = activeQuestion.stem.rawSource
      ? `${activeQuestion.stem.rawSource} ${snippet}`
      : snippet;
    updateQuestion(activeQuestion.id, (q) => ({
      ...q,
      stem: parseMathContent(nextRaw, `${q.id}-stem`),
    }));
  };

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
                disabled={errorIssues.length > 0}
                onClick={() =>
                  onChangeExam({
                    ...exam,
                    confirmedOriginalAnswers: !exam.confirmedOriginalAnswers,
                  })
                }
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
                  <th className="px-4 py-2.5 font-semibold w-44">Ràng buộc trộn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {exam.questions.map((q, idx) => {
                  const ansText =
                    q.type === 'mcq'
                      ? q.options?.find((o) => o.id === q.correctOptionId)?.originalLabel ?? '?'
                      : q.type === 'true-false'
                      ? (q.statements ?? [])
                          .map((s) => `${s.originalLabel}:${s.isTrue ? 'Đ' : 'S'}`)
                          .join(' · ')
                      : q.type === 'short-answer'
                      ? `${q.shortAnswer?.answerValue || 'Chưa nhập'}${
                          q.shortAnswer?.unit ? ` ${q.shortAnswer.unit}` : ''
                        }`
                      : `Tự luận (${q.points}đ)`;

                  return (
                    <tr key={q.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-mono-num text-slate-500">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                        {q.code}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {MATH_QUESTION_TYPE_LABELS[q.type]}
                      </td>
                      <td className="px-4 py-2.5 max-w-md">
                        <div className="line-clamp-2 text-slate-800 dark:text-slate-200">
                          <MathContentRenderer payload={q.stem} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono-num font-semibold text-blue-900 dark:text-blue-300">
                        {ansText}
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
          <div className="md:col-span-2">
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
              onClick={() => setShowImportDrawer((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Nhập DOCX / Đề</span>
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

        {/* Universal Import Drawer (DOCX / OMML / HTML / Text & LaTeX) */}
        {showImportDrawer && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  Nhập đề đa môn cục bộ (.docx / .html / .txt / Dán văn bản)
                </p>
                <p>
                  Tự động đọc công thức OMML/LaTeX, chỉ số trên/dưới (H₂SO₄, Fe³⁺), ảnh &amp; bảng trong Word, tách nhóm Đọc hiểu / Cloze Test và bảng đáp án cuối đề.
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

            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3.5 py-2.5">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700">
                <Upload className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>{isImportingFile ? 'Đang giải nén DOCX...' : 'Chọn tệp .docx / .html / .txt'}</span>
                <input
                  type="file"
                  accept=".docx,.html,.htm,.txt,.md"
                  onChange={(e) => void handleUploadExamFile(e)}
                  className="sr-only"
                />
              </label>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Hỗ trợ Word .docx (giữ ảnh, bảng &amp; XML công thức OMML) · Tối đa 50 MB · Xử lý 100% trên máy
              </span>
            </div>

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

            {importPreview && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Báo cáo chẩn đoán Import ({importPreview.report.fileName ?? importPreview.report.sourceFormat.toUpperCase()})
                  </div>
                  <span className="font-mono-num text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    {importPreview.report.totalParsed} câu · {importPreview.report.groupsCreated} nhóm ·{' '}
                    {importPreview.report.assetsAttached} ảnh/bảng · {importPreview.report.ommlCount} OMML
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
                <option value="true-false">Đúng / Sai</option>
                <option value="short-answer">Trả lời ngắn</option>
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
                      updateQuestion(q.id, (item) => ({
                        ...item,
                        lockQuestionPosition: !item.lockQuestionPosition,
                      }))
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
                      <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                        Câu {globalIdx} · {q.code}
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
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      updateQuestion(activeQuestion.id, (q) => ({
                        ...q,
                        lockQuestionPosition: !q.lockQuestionPosition,
                      }))
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

                <div className="flex flex-wrap gap-1">
                  {LATEX_SNIPPETS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => insertSnippetToStem(item.snippet)}
                      className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                    >
                      + {item.label}
                    </button>
                  ))}
                </div>

                <textarea
                  aria-label="Nội dung đề bài Toán"
                  rows={3}
                  value={activeQuestion.stem.rawSource}
                  onChange={(e) => {
                    const nextRaw = e.target.value;
                    updateQuestion(activeQuestion.id, (q) => ({
                      ...q,
                      stem: parseMathContent(nextRaw, `${q.id}-stem`),
                    }));
                  }}
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
              {activeQuestion.type === 'mcq' && activeQuestion.options && (
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
                                  updateQuestion(activeQuestion.id, (q) => ({
                                    ...q,
                                    correctOptionId: opt.id,
                                    options: (q.options ?? []).map((item) => ({
                                      ...item,
                                      isCorrect: item.id === opt.id,
                                    })),
                                  }))
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
                            type="text"
                            aria-label={`Nội dung phương án ${MCQ_LABELS[idx]}`}
                            value={opt.content.rawSource}
                            onChange={(e) => {
                              const raw = e.target.value;
                              updateQuestion(activeQuestion.id, (q) => {
                                const nextOpts = (q.options ?? []).map((item) =>
                                  item.id === opt.id
                                    ? { ...item, content: parseMathContent(raw, `${item.id}-c`) }
                                    : item
                                );
                                const deps = detectDependentOptions(nextOpts);
                                return {
                                  ...q,
                                  options: nextOpts,
                                  dependencyFlags: deps,
                                  lockOptionShuffle: q.lockOptionShuffle || deps.length > 0,
                                };
                              });
                            }}
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
                                updateQuestion(activeQuestion.id, (q) => ({
                                  ...q,
                                  statements: (q.statements ?? []).map((item) =>
                                    item.id === st.id ? { ...item, isTrue: true } : item
                                  ),
                                }))
                              }
                              className={`rounded px-2.5 py-0.5 text-[11px] font-medium ${
                                st.isTrue
                                  ? 'bg-emerald-700 text-white'
                                  : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              Đúng
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateQuestion(activeQuestion.id, (q) => ({
                                  ...q,
                                  statements: (q.statements ?? []).map((item) =>
                                    item.id === st.id ? { ...item, isTrue: false } : item
                                  ),
                                }))
                              }
                              className={`rounded px-2.5 py-0.5 text-[11px] font-medium ${
                                !st.isTrue
                                  ? 'bg-slate-800 dark:bg-slate-600 text-white'
                                  : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              Sai
                            </button>
                          </div>
                        </div>
                        <input
                          type="text"
                          value={st.content.rawSource}
                          onChange={(e) => {
                            const raw = e.target.value;
                            updateQuestion(activeQuestion.id, (q) => {
                              const nextSts = (q.statements ?? []).map((item) =>
                                item.id === st.id
                                  ? { ...item, content: parseMathContent(raw, `${item.id}-c`) }
                                  : item
                              );
                              const deps = detectDependentStatements(nextSts);
                              return {
                                ...q,
                                statements: nextSts,
                                dependencyFlags: deps,
                              };
                            });
                          }}
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

              {activeQuestion.type === 'short-answer' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Đáp án số cố định
                    </label>
                    <input
                      type="text"
                      value={activeQuestion.shortAnswer?.answerValue ?? ''}
                      onChange={(e) =>
                        updateQuestion(activeQuestion.id, (q) => ({
                          ...q,
                          shortAnswer: {
                            answerValue: e.target.value,
                            acceptedFormats: [e.target.value],
                            unit: q.shortAnswer?.unit ?? '',
                            domainCondition: q.shortAnswer?.domainCondition ?? '',
                          },
                        }))
                      }
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
                        type="text"
                        value={part.content.rawSource}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateQuestion(activeQuestion.id, (q) => ({
                            ...q,
                            essayParts: (q.essayParts ?? []).map((p) =>
                              p.id === part.id
                                ? { ...p, content: parseMathContent(raw, `${p.id}-c`) }
                                : p
                            ),
                          }));
                        }}
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
                  type="text"
                  value={activeQuestion.solutionGuide.rawSource}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateQuestion(activeQuestion.id, (q) => ({
                      ...q,
                      solutionGuide: parseMathContent(raw, `${q.id}-sol`),
                    }));
                  }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

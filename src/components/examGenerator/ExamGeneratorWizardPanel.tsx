import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Lock,
  Play,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Trash2,
  Unlock,
  XCircle,
} from 'lucide-react';
import {
  COGNITIVE_LEVEL_LABELS,
  MATH_QUESTION_TYPE_LABELS,
  type CognitiveLevel,
  type ExamSubjectId,
  type MathQuestionType,
} from '../../types/mathExam';
import type {
  BankQuestionRecord,
  ExamBlueprintConfig,
  ExamGenerationMode,
  ExamMatrixBlueprintRow,
  GeneratedDraftItem,
  GeneratedExamDraft,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import {
  canExportOfficialAnswerKey,
  convertDraftToMathExamProject,
  generateExamsFromBlueprintAsync,
} from '../../core/examGenerator/examBuilderEngine';
import { generateVerifiedVariant } from '../../core/examGenerator/verifiedVariantEngine';
import { generateMixedExams } from '../../core/mathShuffleEngine';
import {
  buildAnswerKeyDocxBuffer,
  buildStudentExamDocxBuffer,
} from '../../core/examExportEngine';
import {
  MathContentRenderer,
  MathVisualAssetRenderer,
} from '../math/MathContentRenderer';

export type WizardStep = 1 | 2 | 3 | 4 | 5;

interface ExamGeneratorWizardPanelProps {
  unifiedBank: BankQuestionRecord[];
  templates: QuestionTemplateDefinition[];
  initialDraftToReview?: GeneratedExamDraft | null;
  onSaveDrafts: (drafts: GeneratedExamDraft[]) => void;
  onUpdateDraft: (draft: GeneratedExamDraft) => void;
  onSendToExamMixer: (draft: GeneratedExamDraft) => void;
  onMixAndSendToGrading: (draft: GeneratedExamDraft) => void;
  onNotify: (tone: 'success' | 'info' | 'error', text: string) => void;
}

const STEP_LABELS: Array<{ step: WizardStep; title: string; short: string }> = [
  { step: 1, title: '1. Chọn nguồn câu hỏi', short: 'Nguồn' },
  { step: 2, title: '2. Cấu trúc & Ma trận đề', short: 'Ma trận' },
  { step: 3, title: '3. Chế độ sinh & Seed', short: 'Chế độ' },
  { step: 4, title: '4. Sinh & Kiểm chứng', short: 'Kiểm chứng' },
  { step: 5, title: '5. Xem trước, Duyệt & Xuất', short: 'Duyệt & Xuất' },
];

const ALL_TYPES: MathQuestionType[] = ['mcq', 'short-answer', 'true-false', 'essay'];
const ALL_LEVELS: CognitiveLevel[] = [
  'nhan-biet',
  'thong-hieu',
  'van-dung',
  'van-dung-cao',
];

function triggerDownload(buffer: ArrayBuffer | Uint8Array, fileName: string) {
  const bytes =
    buffer instanceof Uint8Array
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExamGeneratorWizardPanel({
  unifiedBank,
  templates,
  initialDraftToReview,
  onSaveDrafts,
  onUpdateDraft,
  onSendToExamMixer,
  onMixAndSendToGrading,
  onNotify,
}: ExamGeneratorWizardPanelProps) {
  const [step, setStep] = useState<WizardStep>(initialDraftToReview ? 5 : 1);
  const [blueprint, setBlueprint] = useState<ExamBlueprintConfig>({
    title: 'Đề kiểm tra Giữa kỳ I — Toán 8',
    subjectId: 'toan',
    subjectName: 'Toán học',
    grade: 'Lớp 8',
    durationMinutes: 45,
    selectedTopics: [],
    selectedTypes: ['mcq', 'short-answer', 'essay'],
    selectedCognitiveLevels: ['nhan-biet', 'thong-hieu', 'van-dung', 'van-dung-cao'],
    matrixRows: [
      {
        id: 'row-1',
        topic: 'Tất cả',
        type: 'mcq',
        cognitiveLevel: 'nhan-biet',
        count: 3,
        pointsPerQuestion: 1,
      },
      {
        id: 'row-2',
        topic: 'Tất cả',
        type: 'mcq',
        cognitiveLevel: 'thong-hieu',
        count: 2,
        pointsPerQuestion: 1,
      },
      {
        id: 'row-3',
        topic: 'Tất cả',
        type: 'short-answer',
        cognitiveLevel: 'van-dung',
        count: 1,
        pointsPerQuestion: 2,
      },
    ],
    mode: 'hybrid',
    variantRatioPercent: 70,
    seed: 'TOAN8-GK1-2026',
    examDraftCount: 2,
    allowMultipleVariantsPerTemplate: true,
  });

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; msg: string }>({
    done: 0,
    total: 0,
    msg: '',
  });
  const abortRef = useRef<AbortController | null>(null);

  const [generatedDrafts, setGeneratedDrafts] = useState<GeneratedExamDraft[]>(
    initialDraftToReview ? [initialDraftToReview] : []
  );
  const [activeDraftIdx, setActiveDraftIdx] = useState<number>(0);
  const [regenCounter, setRegenCounter] = useState<number>(10);
  const [exportingDocx, setExportingDocx] = useState(false);

  useEffect(() => {
    if (initialDraftToReview) {
      setGeneratedDrafts([initialDraftToReview]);
      setActiveDraftIdx(0);
      setStep(5);
    }
  }, [initialDraftToReview]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const availableTopics = useMemo(() => {
    const set = new Set<string>();
    for (const b of unifiedBank) {
      if (b.subjectId === blueprint.subjectId) set.add(b.topic);
    }
    for (const t of templates) {
      if (t.subjectId === blueprint.subjectId) set.add(t.topic);
    }
    return Array.from(set).sort();
  }, [unifiedBank, templates, blueprint.subjectId]);

  const matchingSourceStats = useMemo(() => {
    const bankCount = unifiedBank.filter(
      (b) =>
        b.subjectId === blueprint.subjectId &&
        blueprint.selectedTypes.includes(b.type) &&
        blueprint.selectedCognitiveLevels.includes(b.cognitiveLevel) &&
        (blueprint.selectedTopics.length === 0 ||
          blueprint.selectedTopics.includes(b.topic))
    ).length;

    const tplCount = templates.filter(
      (t) =>
        t.verifiedTemplate &&
        t.subjectId === blueprint.subjectId &&
        blueprint.selectedTypes.includes(t.questionType) &&
        blueprint.selectedCognitiveLevels.includes(t.cognitiveLevel) &&
        (blueprint.selectedTopics.length === 0 ||
          blueprint.selectedTopics.includes(t.topic))
    ).length;

    return { bankCount, tplCount };
  }, [unifiedBank, templates, blueprint]);

  const matrixSummary = useMemo(() => {
    let totalQuestions = 0;
    let totalPoints = 0;
    const byLevel: Record<CognitiveLevel, number> = {
      'nhan-biet': 0,
      'thong-hieu': 0,
      'van-dung': 0,
      'van-dung-cao': 0,
    };
    for (const row of blueprint.matrixRows) {
      const c = Math.max(0, Math.floor(row.count));
      totalQuestions += c;
      totalPoints += c * (row.pointsPerQuestion || 0);
      byLevel[row.cognitiveLevel] += c;
    }
    return {
      totalQuestions,
      totalPoints: Number(totalPoints.toFixed(2)),
      byLevel,
    };
  }, [blueprint.matrixRows]);

  const activeDraft = generatedDrafts[activeDraftIdx] ?? null;

  const toggleTopic = (topic: string) => {
    setBlueprint((prev) => ({
      ...prev,
      selectedTopics: prev.selectedTopics.includes(topic)
        ? prev.selectedTopics.filter((t) => t !== topic)
        : [...prev.selectedTopics, topic],
    }));
  };

  const toggleType = (type: MathQuestionType) => {
    setBlueprint((prev) => {
      const exists = prev.selectedTypes.includes(type);
      const next = exists
        ? prev.selectedTypes.filter((t) => t !== type)
        : [...prev.selectedTypes, type];
      return { ...prev, selectedTypes: next.length > 0 ? next : prev.selectedTypes };
    });
  };

  const toggleLevel = (lvl: CognitiveLevel) => {
    setBlueprint((prev) => {
      const exists = prev.selectedCognitiveLevels.includes(lvl);
      const next = exists
        ? prev.selectedCognitiveLevels.filter((l) => l !== lvl)
        : [...prev.selectedCognitiveLevels, lvl];
      return {
        ...prev,
        selectedCognitiveLevels: next.length > 0 ? next : prev.selectedCognitiveLevels,
      };
    });
  };

  const addMatrixRow = () => {
    const nextRow: ExamMatrixBlueprintRow = {
      id: `row-${Date.now().toString(36)}`,
      topic: 'Tất cả',
      type: blueprint.selectedTypes[0] ?? 'mcq',
      cognitiveLevel: blueprint.selectedCognitiveLevels[0] ?? 'nhan-biet',
      count: 1,
      pointsPerQuestion: 0.5,
    };
    setBlueprint((prev) => ({ ...prev, matrixRows: [...prev.matrixRows, nextRow] }));
  };

  const updateMatrixRow = (
    id: string,
    patch: Partial<ExamMatrixBlueprintRow>
  ) => {
    setBlueprint((prev) => ({
      ...prev,
      matrixRows: prev.matrixRows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };

  const removeMatrixRow = (id: string) => {
    setBlueprint((prev) => ({
      ...prev,
      matrixRows: prev.matrixRows.filter((r) => r.id !== id),
    }));
  };

  const handleRunGeneration = async () => {
    if (matrixSummary.totalQuestions === 0) {
      onNotify('error', 'Ma trận hiện có tổng số câu bằng 0. Vui lòng thêm ít nhất 1 câu.');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStep(4);
    setGenerating(true);
    setProgress({
      done: 0,
      total: blueprint.examDraftCount,
      msg: 'Đang khởi tạo bộ sinh biến thể kiểm chứng...',
    });

    try {
      const result = await generateExamsFromBlueprintAsync({
        blueprint,
        bank: unifiedBank,
        templates,
        signal: controller.signal,
        onProgress: (done, total, msg) => setProgress({ done, total, msg }),
      });

      if (result.cancelled) {
        onNotify('info', 'Đã hủy quá trình sinh đề theo yêu cầu của giáo viên.');
        return;
      }

      setGeneratedDrafts(result.drafts);
      setActiveDraftIdx(0);
      onSaveDrafts(result.drafts);
      const totalShortfalls = result.drafts.reduce(
        (sum, d) => sum + d.report.shortfalls.length,
        0
      );
      if (totalShortfalls > 0) {
        onNotify(
          'info',
          `Đã sinh ${result.drafts.length} đề nhưng có ${totalShortfalls} dòng ma trận thiếu câu (hệ thống không tự bịa).`
        );
      } else {
        onNotify(
          'success',
          `Đã sinh và kiểm chứng thành công ${result.drafts.length} đề kiểm tra!`
        );
      }
    } finally {
      setGenerating(false);
    }
  };

  const mutateActiveDraft = (updater: (d: GeneratedExamDraft) => GeneratedExamDraft) => {
    if (!activeDraft) return;
    const updated = updater(structuredClone(activeDraft));
    updated.allAnswersConfirmed =
      updated.items.length > 0 && updated.items.every((i) => i.teacherConfirmed);
    updated.status = updated.allAnswersConfirmed ? 'reviewed' : 'draft';
    updated.totalPoints = Number(
      updated.items.reduce((s, i) => s + (i.question.points || 0), 0).toFixed(2)
    );
    updated.updatedAt = new Date().toISOString();

    setGeneratedDrafts((prev) =>
      prev.map((d, idx) => (idx === activeDraftIdx ? updated : d))
    );
    onUpdateDraft(updated);
  };

  const handleRegenerateSingleItem = (item: GeneratedDraftItem) => {
    if (item.locked) {
      onNotify('info', 'Câu hỏi này đang bị khóa. Hãy mở khóa trước khi sinh biến thể khác.');
      return;
    }
    if (!item.templateId) {
      onNotify('info', 'Câu hỏi gốc này chưa gắn mẫu tham số đổi số.');
      return;
    }
    const tpl = templates.find((t) => t.id === item.templateId);
    if (!tpl) {
      onNotify('error', 'Không tìm thấy mẫu tham số liên kết.');
      return;
    }

    const usedSigs = new Set(
      (activeDraft?.items ?? [])
        .map((i) => i.parameterSignature)
        .filter((s): s is string => Boolean(s))
    );

    const nextIdx = regenCounter + 1;
    setRegenCounter(nextIdx);
    const outcome = generateVerifiedVariant({
      template: tpl,
      seed: `${activeDraft?.seed ?? blueprint.seed}::REGEN-${nextIdx}`,
      variantIndex: nextIdx,
      parentQuestionId: item.parentQuestionId,
      excludeSignatures: usedSigs,
    });

    if (!outcome.ok || !outcome.variant) {
      onNotify(
        'error',
        `Không thể sinh biến thể mới: ${outcome.blockingReasons[0] ?? 'Bị chặn kiểm chứng.'}`
      );
      return;
    }

    const v = outcome.variant;
    mutateActiveDraft((draft) => {
      draft.items = draft.items.map((it) =>
        it.id === item.id
          ? {
              ...it,
              variantCode: v.variantCode,
              variantId: v.id,
              graphFingerprint: v.graphFingerprint,
              functionAnalysis: v.functionAnalysis,
              variationTable: v.variationTable,
              parameterSignature: v.parameterSignature,
              parameterValues: v.parameterValues,
              verificationSummary: v.verification.independentCheckSummary,
              teacherConfirmed: false,
              question: {
                ...v.question,
                points: it.question.points,
              },
            }
          : it
      );
      return draft;
    });
    onNotify(
      'success',
      `Đã sinh biến thể mới (${v.variantCode}) cho Câu ${item.orderNumber} và kiểm chứng đạt.`
    );
  };

  const handleConfirmAllAnswers = () => {
    mutateActiveDraft((draft) => {
      draft.items = draft.items.map((it) => ({
        ...it,
        teacherConfirmed: true,
        question: { ...it.question, answerConfirmed: true },
      }));
      return draft;
    });
    onNotify('success', 'Đã xác nhận toàn bộ đáp án của đề này — sẵn sàng trộn mã đề & xuất bản.');
  };

  const handleExportDocx = async (includeAnswerKey: boolean) => {
    if (!activeDraft) return;
    if (includeAnswerKey) {
      const gate = canExportOfficialAnswerKey(activeDraft);
      if (!gate.allowed) {
        onNotify('error', gate.reason ?? 'Chưa thể xuất đáp án chính thức.');
        return;
      }
    }
    setExportingDocx(true);
    try {
      const project = convertDraftToMathExamProject(activeDraft, {
        examCount: 1,
        startCodeNumber: 101,
      });
      project.mixConfig.level = 0;
      project.mixConfig.shuffleQuestions = false;
      project.mixConfig.shuffleMcqOptions = false;
      const mixed = generateMixedExams(project);
      if (mixed.versions.length === 0) {
        onNotify('error', 'Không thể dựng bản xuất DOCX từ đề này.');
        return;
      }
      const ver = mixed.versions[0];
      project.generatedVersions = mixed.versions;
      const safeName = activeDraft.title.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF-]+/g, '_');
      if (includeAnswerKey) {
        const buf = await buildAnswerKeyDocxBuffer(project);
        triggerDownload(buf, `${safeName}_DapAn.docx`);
        onNotify('success', 'Đã xuất tệp Word Đáp án & Lời giải (.docx).');
      } else {
        const buf = await buildStudentExamDocxBuffer(project, ver);
        triggerDownload(buf, `${safeName}_DeThi.docx`);
        onNotify('success', 'Đã xuất tệp Word Đề kiểm tra (.docx).');
      }
    } catch {
      onNotify('error', 'Lỗi khi xuất tệp DOCX. Vui lòng thử lại.');
    } finally {
      setExportingDocx(false);
    }
  };

  const exportGate = activeDraft ? canExportOfficialAnswerKey(activeDraft) : null;

  return (
    <div className="space-y-5">
      {/* 5-Step Progress Bar */}
      <nav
        aria-label="Các bước tạo đề tự động"
        className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-3 shadow-sm"
      >
        <ol className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {STEP_LABELS.map((s) => {
            const isCurrent = step === s.step;
            const isDone = step > s.step;
            const disabled = s.step === 5 && generatedDrafts.length === 0;
            return (
              <li key={s.step}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setStep(s.step)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors ${
                    isCurrent
                      ? 'bg-[#635BFF] text-white shadow-sm'
                      : isDone
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                      : disabled
                      ? 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 cursor-not-allowed'
                      : 'bg-slate-100/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70'
                  }`}
                >
                  <span className="hidden md:inline">{s.title}</span>
                  <span className="md:hidden">
                    {s.step}. {s.short}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* STEP 1: CHOOSE SOURCE */}
      {step === 1 && (
        <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-5">
          <div>
            <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
              Bước 1: Chọn nguồn câu hỏi &amp; Thông tin đề thi
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Xác định môn học, khối lớp, chủ đề, dạng câu hỏi và mức độ nhận thức cần đưa vào đề.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="space-y-1 text-xs md:col-span-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Tên đề kiểm tra
              </span>
              <input
                type="text"
                value={blueprint.title}
                onChange={(e) =>
                  setBlueprint({ ...blueprint, title: e.target.value })
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Môn học
              </span>
              <select
                value={blueprint.subjectId}
                onChange={(e) => {
                  const sid = e.target.value as ExamSubjectId;
                  setBlueprint({
                    ...blueprint,
                    subjectId: sid,
                    subjectName: sid === 'vat-ly' ? 'Vật lý' : 'Toán học',
                    selectedTopics: [],
                  });
                }}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              >
                <option value="toan">Toán học</option>
                <option value="vat-ly">Vật lý</option>
              </select>
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Khối lớp
              </span>
              <input
                type="text"
                value={blueprint.grade}
                onChange={(e) =>
                  setBlueprint({ ...blueprint, grade: e.target.value })
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </label>
          </div>

          {/* Topics */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Lọc theo Chủ đề (bỏ trống = lấy tất cả chủ đề của môn)
              </span>
              {blueprint.selectedTopics.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBlueprint({ ...blueprint, selectedTopics: [] })}
                  className="text-[11px] font-semibold text-[#635BFF] hover:underline"
                >
                  Chọn lại tất cả
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {availableTopics.map((topic) => {
                const active = blueprint.selectedTopics.includes(topic);
                return (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => toggleTopic(topic)}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-[#635BFF] bg-[#EEF0FF] dark:bg-indigo-950/70 text-[#4F46E5] dark:text-indigo-300 font-semibold'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {topic}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Question types & Cognitive levels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Dạng câu hỏi cho phép
              </span>
              <div className="flex flex-wrap gap-2">
                {ALL_TYPES.map((type) => {
                  const active = blueprint.selectedTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleType(type)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                        active
                          ? 'border-[#635BFF] bg-[#635BFF] text-white'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {MATH_QUESTION_TYPE_LABELS[type]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Mức độ nhận thức cho phép
              </span>
              <div className="flex flex-wrap gap-2">
                {ALL_LEVELS.map((lvl) => {
                  const active = blueprint.selectedCognitiveLevels.includes(lvl);
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => toggleLevel(lvl)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                        active
                          ? 'border-[#635BFF] bg-[#635BFF] text-white'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {COGNITIVE_LEVEL_LABELS[lvl]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Source Availability Summary */}
          <div className="rounded-xl border border-indigo-200/80 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <p className="font-semibold text-indigo-950 dark:text-indigo-200">
                Nguồn khả dụng khớp bộ lọc hiện tại:
              </p>
              <p className="text-indigo-800 dark:text-indigo-300">
                <span className="font-mono-num font-bold">{matchingSourceStats.bankCount}</span> câu hỏi gốc trong ngân hàng ·{' '}
                <span className="font-mono-num font-bold">{matchingSourceStats.tplCount}</span> mẫu đổi số Level 1 &amp; Level 2 đã kiểm chứng.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5248f0]"
            >
              <span>Tiếp tục: Cấu trúc Ma trận</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: EXAM MATRIX */}
      {step === 2 && (
        <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
                Bước 2: Cấu trúc &amp; Ma trận đề kiểm tra
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Thiết lập số câu, chủ đề, mức độ nhận thức và thang điểm cho từng phần.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Thời gian (phút):
                </span>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={blueprint.durationMinutes}
                  onChange={(e) =>
                    setBlueprint({
                      ...blueprint,
                      durationMinutes: Math.max(5, Number(e.target.value) || 45),
                    })
                  }
                  className="w-20 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono-num"
                />
              </label>
              <button
                type="button"
                onClick={addMatrixRow}
                className="inline-flex items-center gap-1 rounded-xl border border-[#635BFF]/40 bg-indigo-50/70 dark:bg-indigo-950/60 px-3 py-1.5 text-xs font-semibold text-[#4F46E5] dark:text-indigo-300 hover:bg-indigo-100"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Thêm dòng ma trận</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-2 font-semibold">Chủ đề</th>
                  <th className="py-2 px-2 font-semibold">Dạng câu hỏi</th>
                  <th className="py-2 px-2 font-semibold">Mức độ</th>
                  <th className="py-2 px-2 font-semibold w-24">Số câu</th>
                  <th className="py-2 px-2 font-semibold w-28">Điểm / câu</th>
                  <th className="py-2 pl-2 text-right font-semibold w-12">Xóa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {blueprint.matrixRows.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2.5 pr-2">
                      <select
                        aria-label="Chủ đề dòng ma trận"
                        value={row.topic}
                        onChange={(e) =>
                          updateMatrixRow(row.id, { topic: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
                      >
                        <option value="Tất cả">Tất cả chủ đề</option>
                        {availableTopics.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-2">
                      <select
                        aria-label="Dạng câu dòng ma trận"
                        value={row.type}
                        onChange={(e) =>
                          updateMatrixRow(row.id, {
                            type: e.target.value as MathQuestionType,
                          })
                        }
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
                      >
                        {ALL_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {MATH_QUESTION_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-2">
                      <select
                        aria-label="Mức độ dòng ma trận"
                        value={row.cognitiveLevel}
                        onChange={(e) =>
                          updateMatrixRow(row.id, {
                            cognitiveLevel: e.target.value as CognitiveLevel,
                          })
                        }
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
                      >
                        {ALL_LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {COGNITIVE_LEVEL_LABELS[l]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-2">
                      <input
                        type="number"
                        min={1}
                        max={50}
                        aria-label="Số câu dòng ma trận"
                        value={row.count}
                        onChange={(e) =>
                          updateMatrixRow(row.id, {
                            count: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono-num"
                      />
                    </td>
                    <td className="py-2.5 px-2">
                      <input
                        type="number"
                        step="0.25"
                        min={0.25}
                        aria-label="Điểm mỗi câu dòng ma trận"
                        value={row.pointsPerQuestion}
                        onChange={(e) =>
                          updateMatrixRow(row.id, {
                            pointsPerQuestion: Math.max(
                              0.25,
                              Number(e.target.value) || 0.5
                            ),
                          })
                        }
                        className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono-num"
                      />
                    </td>
                    <td className="py-2.5 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeMatrixRow(row.id)}
                        aria-label="Xóa dòng ma trận"
                        className="rounded-lg border border-rose-200 dark:border-rose-900 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cognitive Ratio Summary */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Tổng số câu:{' '}
                <strong className="font-mono-num text-[#172033] dark:text-slate-100">
                  {matrixSummary.totalQuestions}
                </strong>
              </span>
              <span>
                Tổng điểm:{' '}
                <strong className="font-mono-num text-[#4F46E5] dark:text-indigo-400">
                  {matrixSummary.totalPoints}
                </strong>
              </span>
              {ALL_LEVELS.map((l) => (
                <span key={l} className="text-slate-600 dark:text-slate-400">
                  {COGNITIVE_LEVEL_LABELS[l]}:{' '}
                  <strong className="font-mono-num">{matrixSummary.byLevel[l]}</strong>
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Quay lại Bước 1</span>
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5248f0]"
            >
              <span>Tiếp tục: Chế độ tạo đề</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {/* STEP 3: GENERATION MODE */}
      {step === 3 && (
        <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-5">
          <div>
            <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
              Bước 3: Chọn chế độ tạo đề, Seed tái lập &amp; Số lượng đề
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Phân biệt rõ: Biến thể câu hỏi (khác dữ kiện số, tự tính lại đáp án) khác với Mã đề Exam Mixer (đảo thứ tự câu/phương án).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(
              [
                {
                  id: 'bank-only',
                  title: 'MODE A — Ngân hàng gốc (Bank Only)',
                  desc: 'Chỉ lấy câu hỏi gốc đã có sẵn trong ngân hàng theo đúng ma trận. An toàn tuyệt đối với câu hình học / tự luận.',
                },
                {
                  id: 'verified-variants',
                  title: 'MODE B — Biến thể kiểm chứng',
                  desc: 'Chỉ sinh biến thể đổi số từ các mẫu Level 1 & Level 2 có bộ giải & kiểm chứng độc lập. Thiếu mẫu sẽ báo rõ.',
                },
                {
                  id: 'hybrid',
                  title: 'MODE C — Kết hợp (Hybrid)',
                  desc: 'Kết hợp câu hỏi gốc trong ngân hàng và biến thể đổi số kiểm chứng theo tỷ lệ mong muốn. Khuyên dùng.',
                },
              ] as Array<{ id: ExamGenerationMode; title: string; desc: string }>
            ).map((opt) => {
              const selected = blueprint.mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBlueprint({ ...blueprint, mode: opt.id })}
                  className={`rounded-2xl border p-4 text-left space-y-1.5 transition-all ${
                    selected
                      ? 'border-[#635BFF] bg-[#EEF0FF]/70 dark:bg-indigo-950/50 ring-2 ring-[#635BFF]/20'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold text-[#172033] dark:text-slate-100">
                    {opt.title}
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {opt.desc}
                  </p>
                </button>
              );
            })}
          </div>

          {blueprint.mode === 'hybrid' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="hybrid-ratio" className="font-semibold text-slate-700 dark:text-slate-200">
                  Tỷ lệ ưu tiên Biến thể đổi số trong chế độ Hybrid
                </label>
                <span className="font-mono-num font-bold text-[#4F46E5] dark:text-indigo-400">
                  {blueprint.variantRatioPercent}% biến thể / {100 - blueprint.variantRatioPercent}% câu gốc
                </span>
              </div>
              <input
                id="hybrid-ratio"
                type="range"
                min={10}
                max={90}
                step={10}
                value={blueprint.variantRatioPercent}
                onChange={(e) =>
                  setBlueprint({
                    ...blueprint,
                    variantRatioPercent: Number(e.target.value),
                  })
                }
                className="w-full accent-[#635BFF]"
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Seed ngẫu nhiên cố định (tái lập 100%)
              </span>
              <input
                type="text"
                value={blueprint.seed}
                onChange={(e) =>
                  setBlueprint({ ...blueprint, seed: e.target.value })
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono-num"
              />
            </label>

            <div className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                Số lượng đề cần tạo cùng ma trận
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {([1, 2, 4, 10] as const).map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() =>
                      setBlueprint({ ...blueprint, examDraftCount: cnt })
                    }
                    className={`rounded-xl border py-2 text-xs font-mono-num font-bold ${
                      blueprint.examDraftCount === cnt
                        ? 'border-[#635BFF] bg-[#635BFF] text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {cnt} đề
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-2 pt-5 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={blueprint.allowMultipleVariantsPerTemplate}
                onChange={(e) =>
                  setBlueprint({
                    ...blueprint,
                    allowMultipleVariantsPerTemplate: e.target.checked,
                  })
                }
                className="mt-0.5 rounded border-slate-300 text-[#635BFF]"
              />
              <span>
                Cho phép sinh nhiều biến thể khác số liệu từ cùng 1 mẫu (vẫn đảm bảo không trùng bộ tham số).
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Quay lại Bước 2</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRunGeneration()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#5248f0]"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sinh &amp; Kiểm chứng {blueprint.examDraftCount} đề</span>
            </button>
          </div>
        </section>
      )}

      {/* STEP 4: GENERATE & VALIDATE */}
      {step === 4 && (
        <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
                Bước 4: Sinh đề &amp; Báo cáo Kiểm chứng độc lập
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Mọi biến thể đều trải qua kiểm tra ràng buộc, giải lại, thế ngược và xác thực 4 phương án phân biệt.
              </p>
            </div>
            {generating && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Hủy quá trình</span>
              </button>
            )}
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {progress.msg || 'Sẵn sàng sinh đề kiểm chứng.'}
              </span>
              <span className="font-mono-num font-bold text-[#4F46E5] dark:text-indigo-400">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#635BFF] to-[#3B82F6] transition-all duration-200"
                style={{
                  width: `${
                    progress.total > 0
                      ? Math.round((progress.done / progress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          {!generating && generatedDrafts.length > 0 && (
            <div className="space-y-4">
              {generatedDrafts.map((d, idx) => (
                <div
                  key={d.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-sm text-[#172033] dark:text-slate-100">
                      {d.title}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDraftIdx(idx);
                        setStep(5);
                      }}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#635BFF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5248f0]"
                    >
                      <span>Mở duyệt đề này</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5">
                      <span className="text-[10px] uppercase text-slate-500 block">Đã sinh / Yêu cầu</span>
                      <strong className="font-mono-num text-sm">
                        {d.report.generatedTotal} / {d.report.requestedTotal}
                      </strong>
                    </div>
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-2.5 text-emerald-800 dark:text-emerald-300">
                      <span className="text-[10px] uppercase block">Biến thể kiểm chứng</span>
                      <strong className="font-mono-num text-sm">{d.report.variantCount}</strong>
                    </div>
                    <div className="rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 p-2.5 text-sky-800 dark:text-sky-300">
                      <span className="text-[10px] uppercase block">Câu gốc ngân hàng</span>
                      <strong className="font-mono-num text-sm">{d.report.originalCount}</strong>
                    </div>
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-2.5 text-amber-800 dark:text-amber-300">
                      <span className="text-[10px] uppercase block">Cần duyệt đáp án</span>
                      <strong className="font-mono-num text-sm">
                        {d.items.filter((i) => !i.teacherConfirmed).length}
                      </strong>
                    </div>
                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 p-2.5 text-rose-800 dark:text-rose-300">
                      <span className="text-[10px] uppercase block">Thiếu câu (Shortfall)</span>
                      <strong className="font-mono-num text-sm">
                        {d.report.shortfalls.reduce((s, sf) => s + sf.shortfall, 0)}
                      </strong>
                    </div>
                  </div>

                  {d.report.shortfalls.length > 0 && (
                    <div
                      role="alert"
                      className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-3 space-y-1.5 text-xs text-amber-900 dark:text-amber-200"
                    >
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>Báo cáo thiếu câu trung thực (không tự bịa câu hỏi):</span>
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {d.report.shortfalls.map((sf) => (
                          <li key={sf.rowId}>{sf.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Điều chỉnh chế độ / ma trận</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep(5)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#5248f0]"
                >
                  <span>Chuyển sang Bước 5: Xem trước &amp; Duyệt đề</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* STEP 5: PREVIEW, TEACHER REVIEW & EXPORT */}
      {step === 5 && activeDraft && (
        <div className="space-y-4">
          {/* Draft Tabs (when multiple exams 2/4/10 were generated) */}
          {generatedDrafts.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              {generatedDrafts.map((d, idx) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setActiveDraftIdx(idx)}
                  className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                    idx === activeDraftIdx
                      ? 'bg-[#635BFF] text-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {d.draftLabel} ({d.items.length} câu · {d.allAnswersConfirmed ? 'Đã duyệt' : 'Chờ duyệt'})
                </button>
              ))}
            </div>
          )}

          {/* Teacher Review & Export Control Bar */}
          <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
                  {activeDraft.title}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {activeDraft.subjectName} · {activeDraft.grade} · {activeDraft.durationMinutes} phút · {activeDraft.items.length} câu · Tổng {activeDraft.totalPoints} điểm · Seed: <span className="font-mono-num">{activeDraft.seed}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!activeDraft.allAnswersConfirmed && (
                  <button
                    type="button"
                    onClick={handleConfirmAllAnswers}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Xác nhận toàn bộ đáp án</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onSendToExamMixer(activeDraft)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#5248f0] transition-colors"
                >
                  <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Chuyển sang Exam Mixer Pro</span>
                </button>

                <button
                  type="button"
                  disabled={!exportGate?.allowed}
                  onClick={() => onMixAndSendToGrading(activeDraft)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
                    exportGate?.allowed
                      ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/60 text-[#4F46E5] dark:text-indigo-300 hover:bg-indigo-100'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Tạo mã đề &amp; Chấm OMR</span>
                </button>

                <button
                  type="button"
                  disabled={exportingDocx}
                  onClick={() => void handleExportDocx(false)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>DOCX Đề</span>
                </button>

                <button
                  type="button"
                  disabled={exportingDocx || !exportGate?.allowed}
                  onClick={() => void handleExportDocx(true)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
                    exportGate?.allowed
                      ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>DOCX Đáp án</span>
                </button>
              </div>
            </div>

            {exportGate && !exportGate.allowed && (
              <div
                role="alert"
                className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2"
              >
                <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{exportGate.reason}</span>
              </div>
            )}
          </section>

          {/* Question Cards for Review */}
          <div className="space-y-3">
            {activeDraft.items.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-4 shadow-sm space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-sm text-[#172033] dark:text-slate-100">
                      Câu {item.orderNumber}
                    </span>
                    <span className="font-mono-num rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      {item.variantCode ?? item.question.code}
                    </span>
                    {item.origin === 'verified-variant' ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Biến thể kiểm chứng
                      </span>
                    ) : (
                      <span className="rounded-md bg-sky-50 dark:bg-sky-950/60 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                        Câu gốc ngân hàng
                      </span>
                    )}
                    <span className="text-slate-500 dark:text-slate-400">
                      {item.question.topic} · {COGNITIVE_LEVEL_LABELS[item.question.cognitiveLevel]} ·{' '}
                      <strong className="font-mono-num">{item.question.points}đ</strong>
                    </span>
                    {item.graphFingerprint && (
                      <span className="font-mono-num rounded-md bg-sky-50 dark:bg-sky-950/60 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                        Graph FP: {item.graphFingerprint}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.templateId && (
                      <button
                        type="button"
                        onClick={() => handleRegenerateSingleItem(item)}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/50 px-2.5 py-1 text-[11px] font-semibold text-[#4F46E5] dark:text-indigo-300 hover:bg-indigo-100"
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden="true" />
                        <span>Đổi biến thể</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        mutateActiveDraft((draft) => {
                          draft.items = draft.items.map((it) =>
                            it.id === item.id ? { ...it, locked: !it.locked } : it
                          );
                          return draft;
                        })
                      }
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                        item.locked
                          ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {item.locked ? (
                        <Lock className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Unlock className="h-3 w-3" aria-hidden="true" />
                      )}
                      <span>{item.locked ? 'Đã khóa' : 'Khóa câu'}</span>
                    </button>

                    <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.teacherConfirmed}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          mutateActiveDraft((draft) => {
                            draft.items = draft.items.map((it) =>
                              it.id === item.id
                                ? {
                                    ...it,
                                    teacherConfirmed: checked,
                                    question: { ...it.question, answerConfirmed: checked },
                                  }
                                : it
                            );
                            return draft;
                          });
                        }}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      <span
                        className={
                          item.teacherConfirmed
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-slate-600 dark:text-slate-300'
                        }
                      >
                        Đã duyệt đáp án
                      </span>
                    </label>
                  </div>
                </div>

                {/* Stem */}
                <div className="text-sm text-[#172033] dark:text-slate-100 leading-relaxed">
                  <MathContentRenderer payload={item.question.stem} />
                </div>

                {/* Question-level SVG Graphs / Variation Tables */}
                {item.question.visualAssets && item.question.visualAssets.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {item.question.visualAssets.map((asset) => (
                      <MathVisualAssetRenderer key={asset.id} asset={asset} compact />
                    ))}
                  </div>
                )}

                {/* MCQ Options */}
                {item.question.options && item.question.options.length > 0 && (
                  <div
                    className={`grid grid-cols-1 gap-2 text-xs ${
                      item.question.options.some((o) => Boolean(o.visualAsset))
                        ? 'sm:grid-cols-2'
                        : 'sm:grid-cols-2 lg:grid-cols-4'
                    }`}
                  >
                    {item.question.options.map((opt) => (
                      <div
                        key={opt.id}
                        className={`rounded-xl border px-3 py-2 space-y-2 ${
                          opt.isCorrect
                            ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/40 font-semibold text-emerald-900 dark:text-emerald-200'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="font-bold mr-1.5">{opt.originalLabel}.</span>
                            <MathContentRenderer payload={opt.content} />
                          </div>
                          {opt.isCorrect && (
                            <CheckCircle2
                              className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        {opt.visualAsset && (
                          <MathVisualAssetRenderer asset={opt.visualAsset} compact />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Short Answer */}
                {item.question.shortAnswer && (
                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                    Đáp án trả lời ngắn: <span className="font-mono-num">{item.question.shortAnswer.answerValue}</span>{' '}
                    {item.question.shortAnswer.unit ?? ''}
                  </div>
                )}

                {/* Independent Verification & Explanation */}
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1 text-xs">
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Kiểm chứng: {item.verificationSummary}
                  </div>
                  <div className="text-slate-700 dark:text-slate-300">
                    <span className="font-semibold">Lời giải: </span>
                    <MathContentRenderer payload={item.question.solutionGuide} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

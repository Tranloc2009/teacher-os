import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Database,
  FileSearch,
  FolderOpen,
  Lock,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { ResourceItem } from '../../types/lesson';
import {
  COGNITIVE_LEVEL_LABELS,
  MATH_QUESTION_TYPE_LABELS,
  type ExamSubjectId,
} from '../../types/mathExam';
import type {
  BankQuestionRecord,
  ExamGenerationMode,
  GeneratedDraftItem,
  GeneratedExamDraft,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import type {
  NaturalLanguageExamBuildResult,
  ParsedExamCommand,
  QuestionSourceProvenance,
  ResourceQuestionIndexSummary,
  SmartRetrievalCandidate,
} from '../../types/resourceIntelligence';
import {
  detectResourceIndexStatus,
  normalizeFolderPath,
} from '../../core/examGenerator/resourceQuestionIndexer';
import {
  buildExamFromNaturalLanguageCommand,
  parseVietnameseExamCommand,
  validateParsedExamCommand,
} from '../../core/examGenerator/naturalLanguageExamParser';
import {
  findEquivalentReplacements,
} from '../../core/examGenerator/smartQuestionRetrieval';
import { generateVerifiedVariant } from '../../core/examGenerator/verifiedVariantEngine';
import { SUBJECT_PROFILES } from '../../core/subjectProfileRegistry';
import { MathContentRenderer, MathVisualAssetRenderer } from '../math/MathContentRenderer';
import { SourceProvenanceModal } from './SourceProvenanceModal';

const SwapIcon = ArrowLeftRight;

interface NaturalLanguageExamPanelProps {
  resources: ResourceItem[];
  unifiedBank: BankQuestionRecord[];
  templates: QuestionTemplateDefinition[];
  initialResourceId?: string | null;
  initialPrompt?: string | null;
  onIndexResources: (resourceIds: string[]) => Promise<{
    summaries: ResourceQuestionIndexSummary[];
    updatedUnifiedBank: BankQuestionRecord[];
  }>;
  onSaveDraft: (draft: GeneratedExamDraft) => Promise<void>;
  onOpenDraftInWizardStep5: (draft: GeneratedExamDraft) => void;
  onSendDraftToExamMixer: (draft: GeneratedExamDraft) => Promise<void>;
  onNotify: (tone: 'success' | 'info' | 'error', text: string) => void;
}

const EXAMPLE_COMMANDS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Toán 12 · Giữa HK1 (Resource Vault + Đổi số)',
    prompt:
      'Tạo cho tôi một đề kiểm tra Toán 12 giữa học kỳ 1, thời gian 45 phút, gồm 4 câu trắc nghiệm, 2 câu đúng sai và 2 câu trả lời ngắn. Lấy câu hỏi từ thư mục Toán 12 trong Resource Vault. Ưu tiên chương Hàm số và Đạo hàm. Mức độ 30% nhận biết, 40% thông hiểu, 30% vận dụng. Những câu toán phù hợp hãy đổi số để tạo câu mới, tính lại đáp án. Tạo 4 mã đề 101, 102, 103, 104 và xuất theo mẫu đề kiểm tra của trường.',
  },
  {
    label: 'Toán 12 · Hàm số & Đồ thị (Biến thể kiểm chứng)',
    prompt:
      'Tạo đề kiểm tra Toán 12 thời gian 45 phút gồm 6 câu trắc nghiệm chương Hàm số và Đồ thị, mức độ 30% nhận biết, 40% thông hiểu, 30% vận dụng. Hãy đổi số tạo biến thể kiểm chứng và tính lại đáp án.',
  },
  {
    label: 'Toán 8 · Ôn tập Phương trình (Hybrid)',
    prompt:
      'Tạo đề ôn tập Toán 8 thời gian 45 phút gồm 5 câu trắc nghiệm và 1 câu trả lời ngắn, ưu tiên chủ đề Phương trình và bất phương trình. Kết hợp câu gốc và biến thể đổi số.',
  },
];

export function NaturalLanguageExamPanel({
  resources,
  unifiedBank,
  templates,
  initialResourceId,
  initialPrompt,
  onIndexResources,
  onSaveDraft,
  onOpenDraftInWizardStep5,
  onSendDraftToExamMixer,
  onNotify,
}: NaturalLanguageExamPanelProps) {
  const [rawPrompt, setRawPrompt] = useState(EXAMPLE_COMMANDS[0].prompt);
  const [parsedCommand, setParsedCommand] = useState<ParsedExamCommand | null>(null);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>(() =>
    initialResourceId ? [initialResourceId] : []
  );
  const [indexing, setIndexing] = useState(false);
  const [lastIndexSummaries, setLastIndexSummaries] = useState<ResourceQuestionIndexSummary[]>([]);
  const [buildResult, setBuildResult] = useState<NaturalLanguageExamBuildResult | null>(null);
  const [activeProvenance, setActiveProvenance] = useState<{
    provenance: QuestionSourceProvenance;
    resource?: ResourceItem;
  } | null>(null);
  const [swapItemId, setSwapItemId] = useState<string | null>(null);

  const availableTopics = useMemo(() => {
    const set = new Set<string>();
    unifiedBank.forEach((b) => {
      if (b.topic) set.add(b.topic);
    });
    resources.forEach((r) => {
      if (r.chapterTopic) set.add(r.chapterTopic);
    });
    return Array.from(set);
  }, [unifiedBank, resources]);

  const resourceById = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources]
  );

  const resourceIndexStatuses = useMemo(() => {
    const map = new Map<string, ReturnType<typeof detectResourceIndexStatus>>();
    for (const r of resources) {
      map.set(r.id, detectResourceIndexStatus(r, unifiedBank));
    }
    return map;
  }, [resources, unifiedBank]);

  const indexedVaultCount = useMemo(
    () => unifiedBank.filter((b) => b.sourceKind === 'resource-vault').length,
    [unifiedBank]
  );

  // When launched directly from a Resource Vault item ("Tạo đề từ tài liệu này")
  useEffect(() => {
    if (!initialResourceId) return;
    const res = resources.find((r) => r.id === initialResourceId);
    if (!res) return;
    setSelectedResourceIds([res.id]);
    const suggestedPrompt = `Tạo đề kiểm tra ${res.subject} ${res.grade} thời gian 45 phút, gồm 4 câu trắc nghiệm, 2 câu đúng sai và 2 câu trả lời ngắn. Lấy câu hỏi từ tài liệu "${res.title}" trong Resource Vault.${
      res.chapterTopic ? ` Ưu tiên chương ${res.chapterTopic}.` : ''
    } Những câu toán phù hợp hãy đổi số để tạo câu mới, tính lại đáp án.`;
    setRawPrompt(suggestedPrompt);
    const parsed = parseVietnameseExamCommand(suggestedPrompt, resources, availableTopics);
    setParsedCommand(
      validateParsedExamCommand({
        ...parsed,
        resourceVaultScope: {
          ...parsed.resourceVaultScope,
          requested: true,
          matchedResourceIds: [res.id],
          matchedResourceTitles: [res.title],
        },
      })
    );
  }, [initialResourceId, resources, availableTopics]);

  // When launched via Universal Command Bar ("Tạo đề Toán 12 từ Resource Vault...")
  useEffect(() => {
    if (!initialPrompt || !initialPrompt.trim()) return;
    setRawPrompt(initialPrompt);
    const parsed = parseVietnameseExamCommand(initialPrompt, resources, availableTopics);
    setParsedCommand(validateParsedExamCommand(parsed));
    if (parsed.resourceVaultScope.matchedResourceIds.length > 0) {
      setSelectedResourceIds(parsed.resourceVaultScope.matchedResourceIds);
    }
  }, [initialPrompt, resources, availableTopics]);

  const handleParsePrompt = (promptText = rawPrompt) => {
    const parsed = parseVietnameseExamCommand(promptText, resources, availableTopics);
    const effectiveSelectedIds =
      selectedResourceIds.length > 0
        ? selectedResourceIds
        : parsed.resourceVaultScope.matchedResourceIds;
    if (selectedResourceIds.length === 0 && effectiveSelectedIds.length > 0) {
      setSelectedResourceIds(effectiveSelectedIds);
    }
    const mergedCmd = validateParsedExamCommand({
      ...parsed,
      resourceVaultScope: {
        ...parsed.resourceVaultScope,
        matchedResourceIds: effectiveSelectedIds,
        matchedResourceTitles: effectiveSelectedIds
          .map((id) => resourceById.get(id)?.title)
          .filter((t): t is string => Boolean(t)),
      },
    });
    setParsedCommand(mergedCmd);
    setBuildResult(null);
  };

  const updateCommandField = (updater: (prev: ParsedExamCommand) => ParsedExamCommand) => {
    setParsedCommand((prev) => {
      if (!prev) return prev;
      return validateParsedExamCommand(updater(prev));
    });
  };

  const handleToggleResourceSelection = (resourceId: string) => {
    setSelectedResourceIds((prev) => {
      const next = prev.includes(resourceId)
        ? prev.filter((id) => id !== resourceId)
        : [...prev, resourceId];
      if (parsedCommand) {
        updateCommandField((cmd) => ({
          ...cmd,
          resourceVaultScope: {
            ...cmd.resourceVaultScope,
            requested: next.length > 0 || cmd.resourceVaultScope.requested,
            matchedResourceIds: next,
            matchedResourceTitles: next
              .map((id) => resourceById.get(id)?.title)
              .filter((t): t is string => Boolean(t)),
          },
        }));
      }
      return next;
    });
  };

  const handleIndexSelected = async (idsToIndex: string[]) => {
    if (idsToIndex.length === 0) {
      onNotify('info', 'Hãy chọn ít nhất 1 tài liệu trong Resource Vault để lập chỉ mục.');
      return;
    }
    setIndexing(true);
    try {
      const { summaries } = await onIndexResources(idsToIndex);
      setLastIndexSummaries(summaries);
    } finally {
      setIndexing(false);
    }
  };

  const handleRunBuild = async (relaxOptions?: {
    relaxTopicFilter?: boolean;
    relaxDifficultyFilter?: boolean;
    relaxResourceScope?: boolean;
  }) => {
    if (!parsedCommand) return;
    const validated = validateParsedExamCommand(parsedCommand);
    setParsedCommand(validated);

    if (validated.conflicts.length > 0) {
      onNotify(
        'error',
        `Cần xử lý ${validated.conflicts.length} mâu thuẫn trong cấu hình trước khi tạo đề.`
      );
      return;
    }

    const targetIds =
      selectedResourceIds.length > 0
        ? selectedResourceIds
        : validated.resourceVaultScope.matchedResourceIds;

    const unindexedIds = targetIds.filter((id) => {
      const st = resourceIndexStatuses.get(id);
      return !st || st.status !== 'up-to-date';
    });

    let effectiveBank = unifiedBank;
    if (unindexedIds.length > 0) {
      setIndexing(true);
      try {
        const { summaries, updatedUnifiedBank } = await onIndexResources(unindexedIds);
        setLastIndexSummaries(summaries);
        effectiveBank = updatedUnifiedBank;
      } finally {
        setIndexing(false);
      }
    }

    try {
      const cmdWithScope: ParsedExamCommand = {
        ...validated,
        resourceVaultScope: {
          ...validated.resourceVaultScope,
          matchedResourceIds: targetIds,
          matchedResourceTitles: targetIds
            .map((id) => resourceById.get(id)?.title)
            .filter((t): t is string => Boolean(t)),
        },
      };

      const res = buildExamFromNaturalLanguageCommand({
        command: cmdWithScope,
        unifiedBank: effectiveBank,
        templates,
        relaxTopicFilter: relaxOptions?.relaxTopicFilter,
        relaxDifficultyFilter: relaxOptions?.relaxDifficultyFilter,
        relaxResourceScope: relaxOptions?.relaxResourceScope,
      });

      setBuildResult(res);
      await onSaveDraft(res.draft);

      if (res.shortfallAdvice.shortfalls.length > 0) {
        onNotify(
          'info',
          `Đã lắp ráp ${res.draft.items.length}/${res.draft.report.requestedTotal} câu từ nguồn thật (${res.draft.report.variantCount} biến thể kiểm chứng). Xem chi tiết các phần còn thiếu bên dưới.`
        );
      } else {
        onNotify(
          'success',
          `Đã tạo đề hoàn chỉnh ${res.draft.items.length} câu (${res.draft.report.variantCount} biến thể kiểm chứng, ${res.draft.report.originalCount} câu gốc có truy xuất nguồn).`
        );
      }
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Không thể tạo đề từ cấu hình hiện tại.'
      );
    }
  };

  const handleToggleItemConfirmed = async (itemId: string) => {
    if (!buildResult) return;
    const nextItems = buildResult.draft.items.map((it) =>
      it.id === itemId
        ? {
            ...it,
            teacherConfirmed: !it.teacherConfirmed,
            question: { ...it.question, answerConfirmed: !it.teacherConfirmed },
          }
        : it
    );
    const nextDraft: GeneratedExamDraft = {
      ...buildResult.draft,
      items: nextItems,
      allAnswersConfirmed: nextItems.length > 0 && nextItems.every((i) => i.teacherConfirmed),
      status: nextItems.every((i) => i.teacherConfirmed) ? 'reviewed' : 'draft',
    };
    setBuildResult({ ...buildResult, draft: nextDraft });
    await onSaveDraft(nextDraft);
  };

  const handleApproveAll = async () => {
    if (!buildResult) return;
    const nextItems = buildResult.draft.items.map((it) => ({
      ...it,
      teacherConfirmed: true,
      question: { ...it.question, answerConfirmed: true },
    }));
    const nextDraft: GeneratedExamDraft = {
      ...buildResult.draft,
      items: nextItems,
      allAnswersConfirmed: nextItems.length > 0,
      status: 'reviewed',
    };
    setBuildResult({ ...buildResult, draft: nextDraft });
    await onSaveDraft(nextDraft);
    onNotify('success', 'Đã xác nhận toàn bộ đáp án của đề — sẵn sàng duyệt Bước 5 hoặc trộn mã đề.');
  };

  const handleRegenerateItemVariant = async (item: GeneratedDraftItem) => {
    if (!buildResult || !item.templateId) return;
    const tpl = templates.find((t) => t.id === item.templateId);
    if (!tpl) return;
    const existingSigs = new Set(
      buildResult.draft.items
        .map((i) => i.parameterSignature)
        .filter((s): s is string => Boolean(s))
    );
    const outcome = generateVerifiedVariant({
      template: tpl,
      parentQuestionId: item.parentQuestionId,
      seed: `${buildResult.draft.seed}::REGEN::${item.id}::${Date.now()}`,
      variantIndex: item.orderNumber,
      excludeSignatures: existingSigs,
    });
    if (!outcome.ok || !outcome.variant) {
      onNotify(
        'error',
        outcome.blockingReasons[0] ?? 'Không sinh được biến thể mới thỏa điều kiện kiểm chứng.'
      );
      return;
    }
    const qClone = structuredClone(outcome.variant.question);
    qClone.points = item.question.points;
    const nextItems = buildResult.draft.items.map((it) =>
      it.id === item.id
        ? {
            ...it,
            variantId: outcome.variant!.id,
            variantCode: outcome.variant!.variantCode,
            parameterSignature: outcome.variant!.parameterSignature,
            parameterValues: outcome.variant!.parameterValues,
            graphFingerprint: outcome.variant!.graphFingerprint,
            functionAnalysis: outcome.variant!.functionAnalysis,
            variationTable: outcome.variant!.variationTable,
            verificationSummary: outcome.variant!.verification.independentCheckSummary,
            teacherConfirmed: false,
            question: qClone,
          }
        : it
    );
    const nextDraft: GeneratedExamDraft = {
      ...buildResult.draft,
      items: nextItems,
      allAnswersConfirmed: false,
      status: 'draft',
    };
    setBuildResult({ ...buildResult, draft: nextDraft });
    await onSaveDraft(nextDraft);
    onNotify('success', `Đã đổi biến thể kiểm chứng mới (${outcome.variant.variantCode}) cho Câu ${item.orderNumber}.`);
  };

  const handleSwapQuestion = async (
    itemId: string,
    replacement: SmartRetrievalCandidate
  ) => {
    if (!buildResult) return;
    const rec = replacement.record;
    const nextItems = buildResult.draft.items.map((it) => {
      if (it.id !== itemId) return it;
      const qClone = structuredClone(rec.question);
      qClone.points = it.question.points;
      return {
        ...it,
        origin: 'bank-original' as const,
        status: rec.question.answerConfirmed ? ('ORIGINAL' as const) : ('REVIEW_REQUIRED' as const),
        parentQuestionId: rec.id,
        templateId: rec.templateId,
        variantId: undefined,
        variantCode: undefined,
        parameterSignature: undefined,
        parameterValues: undefined,
        graphFingerprint: qClone.variantMeta?.graphFingerprint,
        sourceProvenance: rec.sourceProvenance,
        selectionReasons: [
          ...replacement.matchReasons,
          'Giáo viên chọn thay thế tương đương theo tiêu chí ma trận',
        ],
        contentRelevancePercent: replacement.contentRelevancePercent,
        verificationSummary: `Câu thay thế từ ${replacement.sourceLabel}.`,
        teacherConfirmed: false,
        question: qClone,
      };
    });
    const nextDraft: GeneratedExamDraft = {
      ...buildResult.draft,
      items: nextItems,
      allAnswersConfirmed: false,
      status: 'draft',
    };
    setBuildResult({
      ...buildResult,
      draft: nextDraft,
      retrievalByItemId: {
        ...buildResult.retrievalByItemId,
        [itemId]: replacement,
      },
    });
    setSwapItemId(null);
    await onSaveDraft(nextDraft);
    onNotify('success', `Đã thay thế câu hỏi bằng ${rec.code} (${replacement.sourceLabel}).`);
  };

  const activeSwapCandidates = useMemo(() => {
    if (!swapItemId || !buildResult) return [];
    const targetItem = buildResult.draft.items.find((i) => i.id === swapItemId);
    if (!targetItem) return [];
    const targetRecord =
      unifiedBank.find((b) => b.id === targetItem.parentQuestionId) ??
      ({
        id: targetItem.parentQuestionId,
        code: targetItem.question.code,
        subjectId: buildResult.draft.subjectId,
        subjectName: buildResult.draft.subjectName,
        grade: buildResult.draft.grade,
        topic: targetItem.question.topic,
        cognitiveLevel: targetItem.question.cognitiveLevel,
        type: targetItem.question.type,
        points: targetItem.question.points,
        sourceKind: 'generator-bank',
        question: targetItem.question,
        createdAt: targetItem.question.createdAt,
        updatedAt: targetItem.question.updatedAt,
      } as BankQuestionRecord);

    const usedIds = buildResult.draft.items.map((i) => i.parentQuestionId);
    return findEquivalentReplacements(targetRecord, unifiedBank, templates, usedIds, 5);
  }, [swapItemId, buildResult, unifiedBank, templates]);

  const typeSum = parsedCommand
    ? (parsedCommand.typeCounts.mcq ?? 0) +
      (parsedCommand.typeCounts['true-false'] ?? 0) +
      (parsedCommand.typeCounts['short-answer'] ?? 0) +
      (parsedCommand.typeCounts.essay ?? 0)
    : 0;

  return (
    <div className="space-y-5">
      {/* 1. Resource Vault Intelligence Strip */}
      <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4F46E5] dark:text-indigo-400">
              <Database className="h-4 w-4" aria-hidden="true" />
              <span>Bước 1 · Resource Vault Intelligence (Nguồn tri thức cục bộ)</span>
            </div>
            <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
              Lập chỉ mục câu hỏi từ tài liệu Resource Vault (DOCX · PDF văn bản · XLSX/CSV · TXT)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Hiện có <strong className="text-slate-800 dark:text-slate-200">{resources.length}</strong> tài liệu trong Resource Vault ·{' '}
              <strong className="text-indigo-700 dark:text-indigo-300">{indexedVaultCount}</strong> câu hỏi đã lập chỉ mục trong Ngân hàng hợp nhất ({unifiedBank.length} tổng câu). Tuyệt đối không thay đổi tệp gốc.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={indexing || selectedResourceIds.length === 0}
              onClick={() => void handleIndexSelected(selectedResourceIds)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/50 px-3.5 py-2 text-xs font-semibold text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100 disabled:opacity-50"
            >
              <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {indexing
                  ? 'Đang trích xuất...'
                  : `Lập chỉ mục tài liệu đã chọn (${selectedResourceIds.length})`}
              </span>
            </button>
            <button
              type="button"
              disabled={indexing || resources.length === 0}
              onClick={() => void handleIndexSelected(resources.map((r) => r.id))}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#5248f0] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${indexing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Lập chỉ mục toàn bộ kho</span>
            </button>
          </div>
        </div>

        {/* Resource Vault Documents Selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
          {resources.map((res) => {
            const st = resourceIndexStatuses.get(res.id);
            const selected = selectedResourceIds.includes(res.id);
            const folder = normalizeFolderPath(res);
            return (
              <label
                key={res.id}
                className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-all text-xs ${
                  selected
                    ? 'border-[#635BFF] bg-[#EEF0FF]/70 dark:bg-indigo-950/40'
                    : 'border-slate-200/85 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 hover:border-indigo-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => handleToggleResourceSelection(res.id)}
                  className="mt-0.5 rounded border-slate-300 text-[#635BFF]"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-100 line-clamp-1">
                    {res.title}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <FolderOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {folder || `${res.subject} · ${res.grade}`}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {st && st.indexedCount > 0 ? (
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          st.status === 'stale'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        {st.status === 'stale'
                          ? `Cần lập chỉ mục lại (${st.indexedCount} câu)`
                          : `Đã lập chỉ mục · ${st.indexedCount} câu`}
                      </span>
                    ) : (
                      <span className="rounded-md bg-slate-200/80 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">
                        Chưa lập chỉ mục
                      </span>
                    )}
                    {res.sourceFile?.extension && (
                      <span className="rounded-md border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[10px] font-mono-num uppercase text-slate-500">
                        {res.sourceFile.extension}
                      </span>
                    )}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {lastIndexSummaries.length > 0 && (
          <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-2">
            <span>
              Vừa quét <strong>{lastIndexSummaries.length}</strong> tài liệu: trích xuất{' '}
              <strong>
                {lastIndexSummaries.reduce((a, s) => a + s.extractedCount, 0)}
              </strong>{' '}
              câu hỏi ({lastIndexSummaries.reduce((a, s) => a + s.addedCount, 0)} mới,{' '}
              {lastIndexSummaries.reduce((a, s) => a + s.updatedCount, 0)} cập nhật,{' '}
              {lastIndexSummaries.reduce((a, s) => a + s.skippedDuplicateCount, 0)} bỏ qua trùng lặp,{' '}
              {lastIndexSummaries.reduce((a, s) => a + s.preservedTeacherEditedCount, 0)} bảo toàn bản giáo viên đã sửa).
            </span>
          </div>
        )}
      </section>

      {/* 2. Natural Language Command Input */}
      <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4F46E5] dark:text-indigo-400">
              <Wand2 className="h-4 w-4" aria-hidden="true" />
              <span>Bước 2 · Tạo đề bằng yêu cầu tiếng Việt (Natural Language Exam Builder)</span>
            </div>
            <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
              Mô tả yêu cầu đề kiểm tra bằng tiếng Việt tự nhiên
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bộ phân tích quy tắc & từ điển tiếng Việt chạy 100% cục bộ (không dùng AI API). Nếu thiếu thông số hoặc có mâu thuẫn, hệ thống sẽ báo rõ để bạn xác nhận trước khi sinh đề.
            </p>
          </div>
        </div>

        {/* Clickable Example Prompts */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">Mẫu câu lệnh nhanh:</span>
          {EXAMPLE_COMMANDS.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => {
                setRawPrompt(ex.prompt);
                handleParsePrompt(ex.prompt);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-[#635BFF] hover:text-[#4F46E5]"
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          <textarea
            rows={4}
            value={rawPrompt}
            onChange={(e) => setRawPrompt(e.target.value)}
            placeholder="Ví dụ: Tạo cho tôi một đề kiểm tra Toán 12 giữa học kỳ 1, thời gian 45 phút, gồm 4 câu trắc nghiệm, 2 câu đúng sai và 2 câu trả lời ngắn. Lấy câu hỏi từ thư mục Toán 12 trong Resource Vault..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-3 text-sm text-slate-800 dark:text-slate-100 focus:border-[#635BFF] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              Hỗ trợ tiếng Việt có dấu hoặc không dấu · Không gửi tài liệu ra ngoài máy chủ.
            </span>
            <button
              type="button"
              onClick={() => handleParsePrompt(rawPrompt)}
              disabled={!rawPrompt.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#5248f0] disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Phân tích yêu cầu tiếng Việt</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Command Interpretation Preview (Editable & Conflict-Checked) */}
      {parsedCommand && (
        <section className="rounded-2xl border border-indigo-200/90 dark:border-indigo-900 bg-white/95 dark:bg-slate-900/95 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4F46E5] dark:text-indigo-400">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span>Bước 3 · Xác nhận cấu hình hiểu được</span>
              </div>
              <h3 className="text-base font-bold text-[#172033] dark:text-slate-100">
                Tôi đã hiểu yêu cầu như sau (bạn có thể chỉnh mọi trường trước khi tạo đề):
              </h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {parsedCommand.parsedHighlights.slice(0, 6).map((hl) => (
                <span
                  key={hl}
                  className="rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800 px-2.5 py-1 text-[11px] font-semibold text-indigo-800 dark:text-indigo-200"
                >
                  {hl}
                </span>
              ))}
            </div>
          </div>

          {/* Conflict Banner (BLOCKS generation until fixed!) */}
          {parsedCommand.conflicts.length > 0 && (
            <div className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 p-3.5 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-800 dark:text-rose-200">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Phát hiện mâu thuẫn cấu hình — cần chỉnh trước khi tạo đề:</span>
              </div>
              <ul className="list-disc pl-5 text-xs text-rose-700 dark:text-rose-300 space-y-1">
                {parsedCommand.conflicts.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing Fields Notice (Honest: never silently guessed!) */}
          {parsedCommand.missingFields.length > 0 && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-3.5 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Yêu cầu còn thiếu {parsedCommand.missingFields.length} thông số (hệ thống không tự đoán):
                </span>
              </div>
              <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-300 space-y-0.5">
                {parsedCommand.missingFields.map((mf) => (
                  <li key={mf.field}>
                    <strong>{mf.label}:</strong> {mf.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Editable Parsed Specification Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Môn học</span>
              <select
                value={parsedCommand.subjectId ?? ''}
                onChange={(e) => {
                  const id = e.target.value as ExamSubjectId | '';
                  const prof = id ? SUBJECT_PROFILES[id] : undefined;
                  updateCommandField((cmd) => ({
                    ...cmd,
                    subjectId: id || undefined,
                    subjectName: prof?.name,
                  }));
                }}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              >
                <option value="">-- Chọn môn học --</option>
                {Object.values(SUBJECT_PROFILES).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Khối lớp</span>
              <select
                value={parsedCommand.grade ?? ''}
                onChange={(e) =>
                  updateCommandField((cmd) => ({
                    ...cmd,
                    grade: e.target.value || undefined,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              >
                <option value="">-- Chọn lớp --</option>
                {Array.from({ length: 12 }, (_, i) => `Lớp ${i + 1}`).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Loại đề</span>
              <input
                type="text"
                value={parsedCommand.examType ?? ''}
                onChange={(e) =>
                  updateCommandField((cmd) => ({
                    ...cmd,
                    examType: e.target.value || undefined,
                  }))
                }
                placeholder="VD: Giữa học kỳ I"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Thời gian (phút)
              </span>
              <input
                type="number"
                min={5}
                max={240}
                value={parsedCommand.durationMinutes ?? ''}
                onChange={(e) =>
                  updateCommandField((cmd) => ({
                    ...cmd,
                    durationMinutes: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
                placeholder="VD: 45"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono-num"
              />
            </label>
          </div>

          {/* Question Type Counts */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Tổng số câu
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={parsedCommand.requestedTotalCount ?? ''}
                onChange={(e) =>
                  updateCommandField((cmd) => ({
                    ...cmd,
                    requestedTotalCount: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono-num font-bold"
              />
            </label>

            {(
              [
                ['mcq', 'Trắc nghiệm (MCQ)'],
                ['true-false', 'Đúng / Sai'],
                ['short-answer', 'Trả lời ngắn'],
                ['essay', 'Tự luận'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="space-y-1">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{label}</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={parsedCommand.typeCounts[key] ?? 0}
                  onChange={(e) => {
                    const val = Math.max(0, Number(e.target.value) || 0);
                    updateCommandField((cmd) => {
                      const nextTypes = { ...cmd.typeCounts, [key]: val || undefined };
                      const nextSum =
                        (nextTypes.mcq ?? 0) +
                        (nextTypes['true-false'] ?? 0) +
                        (nextTypes['short-answer'] ?? 0) +
                        (nextTypes.essay ?? 0);
                      return {
                        ...cmd,
                        typeCounts: nextTypes,
                        requestedTotalCount: nextSum > 0 ? nextSum : cmd.requestedTotalCount,
                      };
                    });
                  }}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono-num"
                />
              </label>
            ))}
          </div>

          {/* Topics, Difficulty & Variation Mode */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Chương / Chủ đề ưu tiên (cách nhau bằng dấu phẩy)
              </span>
              <input
                type="text"
                value={parsedCommand.chaptersOrTopics.join(', ')}
                onChange={(e) =>
                  updateCommandField((cmd) => ({
                    ...cmd,
                    chaptersOrTopics: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="VD: Hàm số, Đạo hàm"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </label>

            <div className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                Phân bổ mức độ (%) — NB / TH / VD / VDC
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    ['nhanBietPercent', 'NB'],
                    ['thongHieuPercent', 'TH'],
                    ['vanDungPercent', 'VD'],
                    ['vanDungCaoPercent', 'VDC'],
                  ] as const
                ).map(([field, short]) => (
                  <input
                    key={field}
                    type="number"
                    min={0}
                    max={100}
                    placeholder={short}
                    aria-label={`Tỷ lệ ${short}`}
                    value={parsedCommand.difficultyDistribution[field] ?? ''}
                    onChange={(e) =>
                      updateCommandField((cmd) => ({
                        ...cmd,
                        difficultyDistribution: {
                          ...cmd.difficultyDistribution,
                          [field]: e.target.value === '' ? undefined : Number(e.target.value),
                        },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-xs font-mono-num text-center"
                  />
                ))}
              </div>
            </div>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Chế độ sinh đề & đổi số
              </span>
              <select
                value={parsedCommand.variationMode}
                onChange={(e) =>
                  updateCommandField((cmd) => ({
                    ...cmd,
                    variationMode: e.target.value as ExamGenerationMode,
                    variationExplicitlyRequested: true,
                    conflicts: cmd.conflicts.filter((c) => !c.includes('chỉ lấy câu gốc')),
                  }))
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              >
                <option value="hybrid">HYBRID — Kết hợp câu gốc & biến thể kiểm chứng</option>
                <option value="bank-only">BANK ONLY — Chỉ lấy câu gốc (không đổi số)</option>
                <option value="verified-variants">
                  VERIFIED VARIANTS — Chỉ dùng câu đổi số có kiểm chứng
                </option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={parsedCommand.resourceVaultScope.includeQuestionBankFallback}
                onChange={(e) =>
                  updateCommandField((cmd) => ({
                    ...cmd,
                    resourceVaultScope: {
                      ...cmd.resourceVaultScope,
                      includeQuestionBankFallback: e.target.checked,
                    },
                  }))
                }
                className="rounded border-slate-300 text-[#635BFF]"
              />
              <span>
                Ưu tiên tài liệu Resource Vault đã chọn ({selectedResourceIds.length}) và cho phép bổ sung từ Ngân hàng câu hỏi & Mẫu kiểm chứng
              </span>
            </label>

            <button
              type="button"
              disabled={
                indexing ||
                parsedCommand.conflicts.length > 0 ||
                !parsedCommand.subjectId ||
                (typeSum === 0 && !parsedCommand.requestedTotalCount)
              }
              onClick={() => void handleRunBuild()}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Xác nhận cấu hình &amp; Tạo đề</span>
            </button>
          </div>
        </section>
      )}

      {/* 4. Retrieval + Assembled Exam Draft + Provenance + Review */}
      {buildResult && (
        <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Bước 4 · Đề đã lắp ráp từ nguồn thật — Giáo viên duyệt &amp; chuyển tiếp</span>
              </div>
              <h3 className="text-base font-bold text-[#172033] dark:text-slate-100">
                {buildResult.draft.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Đã sinh <strong className="text-slate-800 dark:text-slate-200">{buildResult.draft.items.length}/{buildResult.draft.report.requestedTotal}</strong> câu ·{' '}
                <strong className="text-indigo-700 dark:text-indigo-300">{buildResult.draft.report.variantCount}</strong> biến thể kiểm chứng ·{' '}
                <strong className="text-slate-800 dark:text-slate-200">{buildResult.draft.report.originalCount}</strong> câu gốc · Seed:{' '}
                <span className="font-mono-num">{buildResult.draft.seed}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleApproveAll()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Xác nhận toàn bộ đáp án</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenDraftInWizardStep5(buildResult.draft)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 px-3.5 py-2 text-xs font-semibold text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mở Bước 5: Duyệt &amp; Xuất DOCX</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={buildResult.draft.items.length === 0}
                onClick={() => void onSendDraftToExamMixer(buildResult.draft)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#5248f0] disabled:opacity-50"
              >
                <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Chuyển sang Exam Mixer Pro</span>
              </button>
            </div>
          </div>

          {/* Honest Shortfall Diagnostics */}
          {buildResult.shortfallAdvice.shortfalls.length > 0 && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/50 p-4 space-y-2.5 text-xs">
              <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Báo cáo thiếu câu trung thực ({buildResult.shortfallAdvice.shortfalls.reduce((a, s) => a + s.shortfall, 0)} câu chưa đủ trong nguồn hiện tại — hệ thống KHÔNG tự bịa câu hỏi):
                </span>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-amber-800 dark:text-amber-300">
                {buildResult.shortfallAdvice.shortfalls.map((sf) => (
                  <li key={sf.rowId}>
                    <strong>
                      {MATH_QUESTION_TYPE_LABELS[sf.type]} · {COGNITIVE_LEVEL_LABELS[sf.cognitiveLevel]} ({sf.topic}):
                    </strong>{' '}
                    tìm thấy {sf.fulfilled}/{sf.requested} câu (thiếu {sf.shortfall}).
                  </li>
                ))}
              </ul>
              <div className="text-[11px] text-amber-900/90 dark:text-amber-300">
                Ứng viên khớp bộ lọc: <strong>{buildResult.shortfallAdvice.totalFoundMatching}</strong> · Bị chặn đổi số (BLOCKED):{' '}
                <strong>{buildResult.shortfallAdvice.totalBlockedFromVariants}</strong>.
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="font-semibold text-amber-900 dark:text-amber-200">
                  Tùy chọn nới điều kiện (chỉ áp dụng khi bạn đồng ý):
                </span>
                <button
                  type="button"
                  onClick={() => void handleRunBuild({ relaxDifficultyFilter: true })}
                  className="rounded-lg border border-amber-400 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100"
                >
                  Nới mức độ nhận thức
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleRunBuild({ relaxTopicFilter: true, relaxDifficultyFilter: true })
                  }
                  className="rounded-lg border border-amber-400 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100"
                >
                  Nới chủ đề &amp; mức độ
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleRunBuild({
                      relaxTopicFilter: true,
                      relaxDifficultyFilter: true,
                      relaxResourceScope: true,
                    })
                  }
                  className="rounded-lg border border-amber-400 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100"
                >
                  Mở rộng toàn bộ Ngân hàng hợp nhất
                </button>
              </div>
            </div>
          )}

          {/* Question List with Source Provenance, Match Reasons, Swap & Variant Actions */}
          <div className="space-y-3">
            {buildResult.draft.items.map((item) => {
              const cand = buildResult.retrievalByItemId[item.id];
              const prov = item.sourceProvenance;
              const isSwapping = swapItemId === item.id;
              return (
                <article
                  key={item.id}
                  className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        Câu {item.orderNumber}
                      </span>
                      <span className="font-mono-num text-indigo-700 dark:text-indigo-300 font-semibold">
                        {item.variantCode || item.question.code}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 font-semibold ${
                          item.origin === 'verified-variant'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                        }`}
                      >
                        {item.origin === 'verified-variant'
                          ? 'Biến thể kiểm chứng'
                          : prov
                          ? 'Nguồn Resource Vault'
                          : 'Câu gốc ngân hàng'}
                      </span>
                      <span className="rounded-md bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-slate-700 dark:text-slate-300">
                        {MATH_QUESTION_TYPE_LABELS[item.question.type]} ·{' '}
                        {COGNITIVE_LEVEL_LABELS[item.question.cognitiveLevel]}
                      </span>
                      <span className="rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-slate-600 dark:text-slate-300">
                        {item.question.topic}
                      </span>
                      {typeof item.contentRelevancePercent === 'number' && (
                        <span className="rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 font-mono-num font-semibold text-indigo-700 dark:text-indigo-300">
                          Phù hợp nội dung: {item.contentRelevancePercent}%
                        </span>
                      )}
                      {cand && (
                        <span
                          className={`rounded-md px-2 py-0.5 font-medium ${
                            cand.answerConfidence === 'unconfirmed'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          }`}
                        >
                          {cand.answerConfidenceLabel}
                        </span>
                      )}
                      {item.graphFingerprint && (
                        <span className="rounded-md bg-cyan-50 dark:bg-cyan-950/50 border border-cyan-200 dark:border-cyan-800 px-2 py-0.5 font-mono-num text-cyan-800 dark:text-cyan-200">
                          Graph FP: {item.graphFingerprint}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {prov && (
                        <button
                          type="button"
                          onClick={() =>
                            setActiveProvenance({
                              provenance: prov,
                              resource: resourceById.get(prov.resourceId),
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50"
                        >
                          <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Xem nguồn gốc</span>
                        </button>
                      )}
                      {item.templateId && (
                        <button
                          type="button"
                          onClick={() => void handleRegenerateItemVariant(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-400"
                        >
                          <RefreshCw className="h-3 w-3" aria-hidden="true" />
                          <span>Đổi biến thể số</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSwapItemId(isSwapping ? null : item.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-400"
                      >
                        <SwapIcon className="h-3 w-3" aria-hidden="true" />
                        <span>Đổi câu tương đương</span>
                      </button>
                      <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.teacherConfirmed}
                          onChange={() => void handleToggleItemConfirmed(item.id)}
                          className="rounded border-slate-300 text-emerald-600"
                        />
                        <span className={item.teacherConfirmed ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}>
                          {item.teacherConfirmed ? 'Đã duyệt' : 'Duyệt đáp án'}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Question Stem & Visual Assets */}
                  <div className="text-sm text-slate-800 dark:text-slate-100">
                    <MathContentRenderer payload={item.question.stem} />
                  </div>

                  {item.question.visualAssets && item.question.visualAssets.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {item.question.visualAssets.map((asset) => (
                        <MathVisualAssetRenderer key={asset.id} asset={asset} compact />
                      ))}
                    </div>
                  )}

                  {/* Options / True-False Statements / Short Answer */}
                  {item.question.options && item.question.options.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {item.question.options.map((opt) => {
                        const isCorrect = opt.id === item.question.correctOptionId;
                        return (
                          <div
                            key={opt.id}
                            className={`rounded-lg border px-3 py-2 space-y-1.5 ${
                              isCorrect
                                ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/40'
                                : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                            }`}
                          >
                            <div className="flex items-start gap-1.5">
                              <span className="font-bold">{opt.originalLabel}.</span>
                              <div className="flex-1">
                                <MathContentRenderer payload={opt.content} />
                              </div>
                            </div>
                            {opt.visualAsset && (
                              <MathVisualAssetRenderer asset={opt.visualAsset} compact />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {item.question.statements && item.question.statements.length > 0 && (
                    <div className="space-y-1.5 text-xs">
                      {item.question.statements.map((st) => (
                        <div
                          key={st.id}
                          className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5"
                        >
                          <div className="flex items-start gap-1.5">
                            <span className="font-bold">{st.originalLabel})</span>
                            <MathContentRenderer payload={st.content} />
                          </div>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              st.isTrue
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                            }`}
                          >
                            {st.isTrue ? 'Đúng' : 'Sai'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {item.question.type === 'short-answer' && (
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-900 dark:text-emerald-200">
                      <strong>Đáp số ngắn:</strong>{' '}
                      {item.question.shortAnswer?.answerValue ||
                        '(Chưa có đáp số — cần giáo viên nhập)'}
                    </div>
                  )}

                  {/* Selection Reasons & Provenance Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Lý do chọn:
                      </span>
                      {(item.selectionReasons ?? [item.verificationSummary]).map((r, idx) => (
                        <span
                          key={idx}
                          className="rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                    {cand && !cand.canGenerateVariant && (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        <span>Không đổi số tự động (giữ nguyên gốc)</span>
                      </span>
                    )}
                  </div>

                  {/* Equivalent Replacement Picker */}
                  {isSwapping && (
                    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-indigo-800 dark:text-indigo-200">
                        <span>Chọn câu thay thế tương đương tiêu chí ma trận:</span>
                        <button
                          type="button"
                          onClick={() => setSwapItemId(null)}
                          className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
                        >
                          Đóng
                        </button>
                      </div>
                      {activeSwapCandidates.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          Không tìm thấy câu hỏi khác cùng loại chưa được dùng trong đề này.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {activeSwapCandidates.map((alt) => (
                            <div
                              key={alt.record.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 text-xs"
                            >
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="font-semibold text-slate-800 dark:text-slate-100 line-clamp-2">
                                  {alt.record.question.stem.rawSource}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {alt.sourceLabel} · {alt.record.topic} ·{' '}
                                  {COGNITIVE_LEVEL_LABELS[alt.record.cognitiveLevel]} · Phù hợp{' '}
                                  {alt.contentRelevancePercent}%
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleSwapQuestion(item.id, alt)}
                                className="rounded-lg bg-[#635BFF] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#5248f0]"
                              >
                                Thay bằng câu này
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {activeProvenance && (
        <SourceProvenanceModal
          provenance={activeProvenance.provenance}
          resource={activeProvenance.resource}
          onClose={() => setActiveProvenance(null)}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}

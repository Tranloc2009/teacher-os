import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  GitCompare,
  LineChart,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Table2,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { CognitiveLevel, ExamSubjectId } from '../../types/mathExam';
import type {
  AdvancedTemplateFamilyConfig,
  BankQuestionRecord,
  CubicCriticalCasePolicy,
  DerivativeQuestionSubMode,
  GraphQuestionSubMode,
  LinearSystemQuestionSubMode,
  ParameterConstraint,
  QuadraticQuestionSubMode,
  QuestionTemplateDefinition,
  TemplateCategoryId,
  VerifiedTemplateFamilyId,
} from '../../types/examGenerator';
import {
  generateVerifiedVariant,
  TEMPLATE_CATEGORY_LABELS,
  VERIFIED_FAMILY_LIST,
  VERIFIED_TEMPLATE_FAMILIES,
} from '../../core/examGenerator/verifiedVariantEngine';
import {
  createMathVisualAsset,
  parseMathContent,
} from '../../core/mathIntegrity';
import {
  MathContentRenderer,
  MathVisualAssetRenderer,
} from '../math/MathContentRenderer';

interface TemplateBuilderPanelProps {
  templates: QuestionTemplateDefinition[];
  unifiedBank: BankQuestionRecord[];
  initialTemplateId?: string | null;
  initialSourceQuestion?: BankQuestionRecord | null;
  onSaveTemplate: (template: QuestionTemplateDefinition) => void;
  onDeleteTemplate: (templateId: string) => void;
  onAddVariantToBank: (item: BankQuestionRecord) => void;
  onGoToWizard?: () => void;
  onNotify: (tone: 'success' | 'info' | 'error', text: string) => void;
}

const CATEGORY_ORDER: TemplateCategoryId[] = [
  'basic-level-1',
  'advanced-algebra-level-2',
  'calculus-level-2',
  'calculus-graph-level-3',
];

function createFreshTemplate(
  familyId: VerifiedTemplateFamilyId,
  source?: BankQuestionRecord | null
): QuestionTemplateDefinition {
  const meta = VERIFIED_TEMPLATE_FAMILIES[familyId];
  const now = new Date().toISOString();
  const isL3 = meta.level === 3;
  return {
    id: `tpl-${Date.now().toString(36)}`,
    code: `M-${Math.floor(100 + Math.random() * 899)}`,
    title: source ? `Mẫu đổi số từ ${source.code}: ${meta.shortLabel}` : meta.label,
    familyId,
    subjectId: source?.subjectId ?? (familyId === 'physics-motion' ? 'vat-ly' : 'toan'),
    subjectName:
      source?.subjectName ?? (familyId === 'physics-motion' ? 'Vật lý' : 'Toán học'),
    grade:
      source?.grade ??
      (isL3
        ? 'Lớp 12'
        : familyId === 'polynomial-derivative'
        ? 'Lớp 11'
        : familyId === 'quadratic-equation' || familyId === 'linear-system-2x2'
        ? 'Lớp 10'
        : 'Lớp 8'),
    topic:
      source?.topic ??
      (isL3
        ? 'Hàm số và Đồ thị'
        : familyId === 'polynomial-derivative'
        ? 'Đạo hàm'
        : familyId === 'linear-system-2x2'
        ? 'Hệ phương trình bậc nhất'
        : 'Phương trình và bất phương trình'),
    cognitiveLevel:
      source?.cognitiveLevel ?? (meta.level >= 2 ? 'thong-hieu' : 'nhan-biet'),
    questionType:
      meta.level >= 2
        ? 'mcq'
        : source?.type === 'short-answer'
        ? 'short-answer'
        : 'mcq',
    points: source?.points ?? 0.5,
    stemTemplate: meta.defaultStemTemplate,
    explanationTemplate: meta.defaultExplanationTemplate,
    unit: meta.defaultUnit,
    decimalPlaces: meta.defaultDecimalPlaces,
    familyConfig: meta.defaultFamilyConfig
      ? structuredClone(meta.defaultFamilyConfig)
      : undefined,
    parameters: structuredClone(meta.defaultParameters),
    sourceQuestionId: source?.id,
    verifiedTemplate: true,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function TemplateBuilderPanel({
  templates,
  unifiedBank,
  initialTemplateId,
  initialSourceQuestion,
  onSaveTemplate,
  onDeleteTemplate,
  onAddVariantToBank,
  onGoToWizard,
  onNotify,
}: TemplateBuilderPanelProps) {
  const [selectedId, setSelectedId] = useState<string>(
    initialTemplateId ?? templates[0]?.id ?? ''
  );
  const [draft, setDraft] = useState<QuestionTemplateDefinition>(() => {
    const found = templates.find((t) => t.id === initialTemplateId) ?? templates[0];
    if (found) return structuredClone(found);
    return createFreshTemplate('quadratic-equation', initialSourceQuestion);
  });
  const [previewSeed, setPreviewSeed] = useState<string>('PREVIEW-SEED-1');
  const [variantCounter, setVariantCounter] = useState<number>(1);
  const [showComparison, setShowComparison] = useState<boolean>(true);
  const [visualViewMode, setVisualViewMode] = useState<'both' | 'graph' | 'table'>('both');

  useEffect(() => {
    if (initialTemplateId) {
      const found = templates.find((t) => t.id === initialTemplateId);
      if (found) {
        setSelectedId(found.id);
        setDraft(structuredClone(found));
      }
    }
  }, [initialTemplateId, templates]);

  useEffect(() => {
    if (initialSourceQuestion && !initialTemplateId) {
      const fresh = createFreshTemplate(
        initialSourceQuestion.subjectId === 'vat-ly'
          ? 'physics-motion'
          : 'linear-equation',
        initialSourceQuestion
      );
      setSelectedId(fresh.id);
      setDraft(fresh);
    }
  }, [initialSourceQuestion, initialTemplateId]);

  const linkedSource = useMemo(
    () =>
      draft.sourceQuestionId
        ? unifiedBank.find((b) => b.id === draft.sourceQuestionId) ?? null
        : null,
    [draft.sourceQuestionId, unifiedBank]
  );

  const liveOutcome = useMemo(
    () =>
      generateVerifiedVariant({
        template: draft,
        seed: previewSeed,
        variantIndex: variantCounter,
      }),
    [draft, previewSeed, variantCounter]
  );

  const comparisonOutcomeB = useMemo(() => {
    if (!showComparison || !liveOutcome.ok || !liveOutcome.variant) return null;
    const exclude = new Set<string>([liveOutcome.variant.parameterSignature]);
    return generateVerifiedVariant({
      template: draft,
      seed: previewSeed,
      variantIndex: variantCounter + 1,
      excludeSignatures: exclude,
    });
  }, [draft, previewSeed, variantCounter, showComparison, liveOutcome]);

  const templatesByCategory = useMemo(() => {
    const groups: Record<TemplateCategoryId, QuestionTemplateDefinition[]> = {
      'basic-level-1': [],
      'advanced-algebra-level-2': [],
      'calculus-level-2': [],
      'calculus-graph-level-3': [],
    };
    for (const tpl of templates) {
      const meta = VERIFIED_TEMPLATE_FAMILIES[tpl.familyId];
      const cat: TemplateCategoryId = meta?.category ?? 'basic-level-1';
      groups[cat].push(tpl);
    }
    return groups;
  }, [templates]);

  const handleSelectTemplate = (tpl: QuestionTemplateDefinition) => {
    setSelectedId(tpl.id);
    setDraft(structuredClone(tpl));
    setVariantCounter(1);
  };

  const handleNewTemplate = () => {
    const fresh = createFreshTemplate('cubic-extrema', null);
    setSelectedId(fresh.id);
    setDraft(fresh);
    setVariantCounter(1);
  };

  const handleFamilyChange = (nextFamily: VerifiedTemplateFamilyId) => {
    const meta = VERIFIED_TEMPLATE_FAMILIES[nextFamily];
    const isL3 = meta.level === 3;
    setDraft((prev) => ({
      ...prev,
      familyId: nextFamily,
      stemTemplate: meta.defaultStemTemplate,
      explanationTemplate: meta.defaultExplanationTemplate,
      unit: meta.defaultUnit,
      decimalPlaces: meta.defaultDecimalPlaces,
      familyConfig: meta.defaultFamilyConfig
        ? structuredClone(meta.defaultFamilyConfig)
        : undefined,
      parameters: structuredClone(meta.defaultParameters),
      subjectId: nextFamily === 'physics-motion' ? 'vat-ly' : 'toan',
      subjectName: nextFamily === 'physics-motion' ? 'Vật lý' : 'Toán học',
      grade: isL3
        ? 'Lớp 12'
        : nextFamily === 'polynomial-derivative'
        ? 'Lớp 11'
        : nextFamily === 'quadratic-equation' || nextFamily === 'linear-system-2x2'
        ? 'Lớp 10'
        : prev.grade,
      topic: isL3
        ? 'Hàm số và Đồ thị'
        : nextFamily === 'polynomial-derivative'
        ? 'Đạo hàm'
        : nextFamily === 'linear-system-2x2'
        ? 'Hệ phương trình bậc nhất'
        : nextFamily === 'quadratic-equation'
        ? 'Phương trình và bất phương trình'
        : prev.topic,
      questionType: meta.level >= 2 ? 'mcq' : prev.questionType,
    }));
    setVariantCounter(1);
  };

  const updateFamilyConfig = (patch: Partial<AdvancedTemplateFamilyConfig>) => {
    setDraft((prev) => ({
      ...prev,
      familyConfig: {
        ...(prev.familyConfig ?? {}),
        ...patch,
      },
    }));
    setVariantCounter(1);
  };

  const updateParam = (idx: number, patch: Partial<ParameterConstraint>) => {
    setDraft((prev) => ({
      ...prev,
      parameters: prev.parameters.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
  };

  const handleSave = () => {
    if (!draft.title.trim()) {
      onNotify('error', 'Vui lòng nhập tên mẫu câu hỏi trước khi lưu.');
      return;
    }
    if (!liveOutcome.ok) {
      onNotify(
        'error',
        'Mẫu hiện tại đang vi phạm ràng buộc kiểm chứng — hãy sửa tham số trước khi lưu.'
      );
      return;
    }
    onSaveTemplate(draft);
    setSelectedId(draft.id);
  };

  const handleAddCurrentVariantToBank = () => {
    if (!liveOutcome.ok || !liveOutcome.variant) {
      onNotify('error', 'Chỉ có thể thêm biến thể đã đạt kiểm chứng vào ngân hàng.');
      return;
    }
    const v = liveOutcome.variant;
    const now = new Date().toISOString();
    const record: BankQuestionRecord = {
      id: `bank-var-${Date.now().toString(36)}-${variantCounter}`,
      code: v.variantCode,
      subjectId: draft.subjectId,
      subjectName: draft.subjectName,
      grade: draft.grade,
      topic: draft.topic,
      cognitiveLevel: draft.cognitiveLevel,
      type: v.question.type,
      points: v.question.points,
      sourceKind: 'generator-bank',
      templateId: draft.id,
      question: {
        ...structuredClone(v.question),
        answerConfirmed: false, // Bắt buộc giáo viên rà soát & xác nhận trước khi dùng chấm chính thức
      },
      createdAt: now,
      updatedAt: now,
    };
    onAddVariantToBank(record);
  };

  const familyMeta = VERIFIED_TEMPLATE_FAMILIES[draft.familyId];
  const isLevel2Or3 = familyMeta.level >= 2;
  const isLevel3 = familyMeta.level === 3;
  const checklist = liveOutcome.variant?.verification.checklist;

  const liveGraphAsset = useMemo(() => {
    if (!liveOutcome.ok || !liveOutcome.variant?.graphSvg) return null;
    return createMathVisualAsset({
      id: `live-graph-${liveOutcome.variant.graphFingerprint ?? variantCounter}`,
      kind: 'geometry-svg',
      label: 'Đồ thị hàm số SVG đồng bộ theo dữ kiện',
      sourceData: liveOutcome.variant.graphSvg,
    });
  }, [liveOutcome, variantCounter]);

  const liveTableAsset = useMemo(() => {
    if (!liveOutcome.ok || !liveOutcome.variant?.variationTableSvg) return null;
    return createMathVisualAsset({
      id: `live-bbt-${liveOutcome.variant.graphFingerprint ?? variantCounter}`,
      kind: 'variation-table',
      label: 'Bảng biến thiên đồng bộ theo đạo hàm',
      sourceData: liveOutcome.variant.variationTableSvg,
    });
  }, [liveOutcome, variantCounter]);

  const compAGraphAsset = useMemo(() => {
    if (!liveOutcome.ok || !liveOutcome.variant?.graphSvg) return null;
    return createMathVisualAsset({
      id: `comp-a-${liveOutcome.variant.graphFingerprint ?? variantCounter}`,
      kind: 'geometry-svg',
      label: 'Đồ thị biến thể A',
      sourceData: liveOutcome.variant.graphSvg,
    });
  }, [liveOutcome, variantCounter]);

  const compBGraphAsset = useMemo(() => {
    if (!comparisonOutcomeB?.ok || !comparisonOutcomeB.variant?.graphSvg) return null;
    return createMathVisualAsset({
      id: `comp-b-${comparisonOutcomeB.variant.graphFingerprint ?? variantCounter}`,
      kind: 'geometry-svg',
      label: 'Đồ thị biến thể B',
      sourceData: comparisonOutcomeB.variant.graphSvg,
    });
  }, [comparisonOutcomeB, variantCounter]);

  return (
    <div className="space-y-4">
      {/* Top Template Category Switcher Strip (§XV) */}
      <div className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-[#172033] dark:text-slate-100">
            Danh mục Mẫu kiểm chứng ({templates.length} mẫu · Level 1, Level 2 &amp; Level 3 Đồ thị)
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {onGoToWizard && (
              <button
                type="button"
                onClick={onGoToWizard}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
              >
                <span>Chuyển sang tạo đề</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={handleNewTemplate}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#635BFF]/40 bg-indigo-50/70 dark:bg-indigo-950/60 px-3 py-1.5 text-xs font-semibold text-[#4F46E5] dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tạo mẫu mới</span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {CATEGORY_ORDER.map((catId) => {
            const list = templatesByCategory[catId];
            if (list.length === 0) return null;
            const badgeTone =
              catId === 'calculus-graph-level-3'
                ? 'bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300'
                : catId !== 'basic-level-1'
                ? 'bg-violet-100 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
            return (
              <div key={catId} className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider shrink-0 ${badgeTone}`}
                >
                  {TEMPLATE_CATEGORY_LABELS[catId]}
                </span>
                {list.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleSelectTemplate(tpl)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                      selectedId === tpl.id
                        ? 'bg-[#635BFF] text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {tpl.code} · {VERIFIED_TEMPLATE_FAMILIES[tpl.familyId].shortLabel}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-Column Aurora Bento Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT COLUMN: Template Config & Parameter Constraints */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-[#172033] dark:text-slate-100">
                Cấu hình Mẫu tham số Level {familyMeta.level} (Không dùng eval)
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Chọn bộ giải toán học kiểm chứng độc lập, miền tham số và dạng câu hỏi.
              </p>
            </div>
            {templates.some((t) => t.id === draft.id) && (
              <button
                type="button"
                onClick={() => onDeleteTemplate(draft.id)}
                aria-label={`Xóa mẫu ${draft.title}`}
                className="rounded-lg border border-rose-200 dark:border-rose-900 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Tên mẫu câu hỏi
              </span>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </label>

            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Nhóm quy tắc giải đã kiểm chứng (Level 1, Level 2 &amp; Level 3 Đồ thị)
              </span>
              <select
                value={draft.familyId}
                onChange={(e) =>
                  handleFamilyChange(e.target.value as VerifiedTemplateFamilyId)
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium"
              >
                {CATEGORY_ORDER.map((catId) => (
                  <optgroup key={catId} label={TEMPLATE_CATEGORY_LABELS[catId]}>
                    {VERIFIED_FAMILY_LIST.filter((f) => f.category === catId).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label} ({f.subjectHint})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                {familyMeta.description}
              </span>
            </label>

            {/* Level 2 Sub-Mode Configuration */}
            {draft.familyId === 'quadratic-equation' && (
              <>
                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-violet-700 dark:text-violet-300">
                    Chế độ câu hỏi bậc hai
                  </span>
                  <select
                    value={draft.familyConfig?.quadraticMode ?? 'solution-set'}
                    onChange={(e) => {
                      const nextMode = e.target.value as QuadraticQuestionSubMode;
                      updateFamilyConfig({
                        quadraticMode: nextMode,
                        rootPolicy: nextMode === 'double-root' ? 'double' : 'distinct',
                      });
                    }}
                    className="w-full rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/30 px-2.5 py-2 text-xs"
                  >
                    <option value="solution-set">Chọn tập nghiệm S = {'{r₁; r₂}'}</option>
                    <option value="larger-root">Tìm nghiệm lớn hơn</option>
                    <option value="sum-of-roots">Tính tổng hai nghiệm (Viète)</option>
                    <option value="double-root">Tìm nghiệm kép (Δ = 0)</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-violet-700 dark:text-violet-300">
                    Giới hạn độ lớn hệ số |b|, |c|
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={500}
                    value={draft.familyConfig?.maxCoeffMagnitude ?? 120}
                    onChange={(e) =>
                      updateFamilyConfig({
                        maxCoeffMagnitude: Math.max(10, Number(e.target.value) || 120),
                      })
                    }
                    className="w-full rounded-xl border border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-mono-num"
                  />
                </label>
              </>
            )}

            {draft.familyId === 'linear-system-2x2' && (
              <>
                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-violet-700 dark:text-violet-300">
                    Dạng câu hỏi hệ 2 ẩn
                  </span>
                  <select
                    value={draft.familyConfig?.linearSystemMode ?? 'ordered-pair'}
                    onChange={(e) =>
                      updateFamilyConfig({
                        linearSystemMode: e.target.value as LinearSystemQuestionSubMode,
                      })
                    }
                    className="w-full rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/30 px-2.5 py-2 text-xs"
                  >
                    <option value="ordered-pair">Tìm cặp nghiệm (x; y)</option>
                    <option value="sum-xy">Tính tổng x + y</option>
                    <option value="linear-expr">Tính biểu thức px + qy</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-violet-700 dark:text-violet-300">
                    Giới hạn vế phải |e|, |f|
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={draft.familyConfig?.maxCoeffMagnitude ?? 80}
                    onChange={(e) =>
                      updateFamilyConfig({
                        maxCoeffMagnitude: Math.max(10, Number(e.target.value) || 80),
                      })
                    }
                    className="w-full rounded-xl border border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-mono-num"
                  />
                </label>
              </>
            )}

            {draft.familyId === 'polynomial-derivative' && (
              <>
                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-violet-700 dark:text-violet-300">
                    Dạng câu hỏi đạo hàm
                  </span>
                  <select
                    value={draft.familyConfig?.derivativeMode ?? 'derivative-poly'}
                    onChange={(e) =>
                      updateFamilyConfig({
                        derivativeMode: e.target.value as DerivativeQuestionSubMode,
                      })
                    }
                    className="w-full rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/30 px-2.5 py-2 text-xs"
                  >
                    <option value="derivative-poly">Tìm biểu thức f&apos;(x)</option>
                    <option value="value-at-x0">Tính giá trị f&apos;(x₀)</option>
                    <option value="term-coefficient">Tìm hệ số của hạng tử trong f&apos;(x)</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-violet-700 dark:text-violet-300">
                    Bậc đa thức (2–4)
                  </span>
                  <select
                    value={draft.familyConfig?.polynomialDegree ?? 3}
                    onChange={(e) =>
                      updateFamilyConfig({
                        polynomialDegree: Number(e.target.value) as 2 | 3 | 4,
                      })
                    }
                    className="w-full rounded-xl border border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-mono-num"
                  >
                    <option value={2}>Bậc 2 (ax² + bx + c)</option>
                    <option value={3}>Bậc 3 (a₃x³ + a₂x² + a₁x + a₀)</option>
                    <option value={4}>Bậc 4 (a₄x⁴ + … + a₀)</option>
                  </select>
                </label>
              </>
            )}

            {/* Level 3 Dynamic Math & Graph Configuration */}
            {isLevel3 && (
              <>
                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-sky-700 dark:text-sky-300">
                    Loại câu hỏi Đồ thị &amp; BBT (Level 3)
                  </span>
                  <select
                    value={draft.familyConfig?.graphQuestionMode ?? 'choose-graph'}
                    onChange={(e) =>
                      updateFamilyConfig({
                        graphQuestionMode: e.target.value as GraphQuestionSubMode,
                      })
                    }
                    className="w-full rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/30 px-2.5 py-2 text-xs"
                  >
                    {(draft.familyId === 'rational-asymptotes' ||
                      draft.familyId === 'rational-monotonicity') ? (
                      <>
                        <option value="asymptotes">Xác định đường tiệm cận (TCĐ &amp; TCN)</option>
                        <option value="monotonicity">Xét tính đơn điệu trên từng khoảng</option>
                        <option value="choose-variation-table">Chọn bảng biến thiên đúng (4 SVG)</option>
                        <option value="choose-graph">Chọn đồ thị đúng (4 đồ thị SVG)</option>
                        <option value="read-graph">Đọc đồ thị nhận diện hàm số</option>
                      </>
                    ) : draft.familyId === 'quadratic-graph' ? (
                      <>
                        <option value="extrema-point">Tìm tọa độ đỉnh / điểm cực trị parabol</option>
                        <option value="monotonicity">Tìm khoảng đồng biến / nghịch biến</option>
                        <option value="read-graph">Đọc đồ thị parabol tìm hàm số</option>
                        <option value="choose-variation-table">Chọn bảng biến thiên đúng (4 SVG)</option>
                        <option value="choose-graph">Chọn đồ thị đúng (4 đồ thị SVG)</option>
                      </>
                    ) : (
                      <>
                        <option value="monotonicity">Tìm khoảng đồng biến / nghịch biến</option>
                        <option value="extrema-point">Tìm điểm cực đại / cực tiểu</option>
                        <option value="extrema-value">Tìm giá trị cực đại / cực tiểu</option>
                        <option value="choose-variation-table">Chọn bảng biến thiên đúng (4 SVG)</option>
                        <option value="choose-graph">Chọn đồ thị đúng (4 đồ thị SVG)</option>
                        <option value="read-graph">Đọc đồ thị nhận diện hàm bậc ba</option>
                      </>
                    )}
                  </select>
                </label>

                {(draft.familyId === 'cubic-monotonicity' ||
                  draft.familyId === 'cubic-extrema' ||
                  draft.familyId === 'graph-variation-table') && (
                  <label className="space-y-1 text-xs">
                    <span className="font-semibold text-sky-700 dark:text-sky-300">
                      Trường hợp nghiệm đạo hàm f&apos;(x) = 0
                    </span>
                    <select
                      value={draft.familyConfig?.cubicCasePolicy ?? 'two-extrema'}
                      onChange={(e) =>
                        updateFamilyConfig({
                          cubicCasePolicy: e.target.value as CubicCriticalCasePolicy,
                        })
                      }
                      className="w-full rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
                    >
                      <option value="two-extrema">Δ&apos; &gt; 0 · 2 điểm cực trị phân biệt</option>
                      <option value="double-root">Δ&apos; = 0 · Nghiệm kép (không có cực trị)</option>
                      <option value="no-extrema">Δ&apos; &lt; 0 · Đơn điệu trên ℝ</option>
                      <option value="any">Tự động theo tham số (mọi trường hợp)</option>
                    </select>
                  </label>
                )}
              </>
            )}

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Môn học</span>
              <select
                value={draft.subjectId}
                onChange={(e) => {
                  const sid = e.target.value as ExamSubjectId;
                  setDraft({
                    ...draft,
                    subjectId: sid,
                    subjectName: sid === 'vat-ly' ? 'Vật lý' : 'Toán học',
                  });
                }}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              >
                <option value="toan">Toán học</option>
                <option value="vat-ly">Vật lý</option>
              </select>
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Khối lớp</span>
              <input
                type="text"
                value={draft.grade}
                onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Chủ đề</span>
              <input
                type="text"
                value={draft.topic}
                onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Mức độ nhận thức</span>
              <select
                value={draft.cognitiveLevel}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cognitiveLevel: e.target.value as CognitiveLevel,
                  })
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              >
                <option value="nhan-biet">Nhận biết</option>
                <option value="thong-hieu">Thông hiểu</option>
                <option value="van-dung">Vận dụng</option>
                <option value="van-dung-cao">Vận dụng cao</option>
              </select>
            </label>

            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Dạng câu hỏi</span>
              <select
                value={draft.questionType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    questionType: e.target.value as 'mcq' | 'short-answer',
                  })
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
              >
                <option value="mcq">Trắc nghiệm (A/B/C/D)</option>
                <option value="short-answer">Trả lời ngắn (1 giá trị số)</option>
              </select>
            </label>
          </div>

          {/* Parameter Constraints Editor */}
          <div className="space-y-2.5 pt-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Ràng buộc tham số (Parameter Constraints)
            </h3>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {draft.parameters.map((param, idx) => (
                <div
                  key={param.name}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#172033] dark:text-slate-100">
                      <code className="rounded bg-indigo-100 dark:bg-indigo-950 px-1.5 py-0.5 text-[#4F46E5] dark:text-indigo-300 mr-1.5">
                        {`{{${param.name}}}`}
                      </code>
                      {param.label}
                    </span>
                    <span className="text-[10px] font-semibold uppercase text-slate-500">
                      {param.kind === 'integer' ? 'Số nguyên' : 'Thập phân'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <label className="space-y-0.5">
                      <span className="text-[11px] text-slate-500">Min</span>
                      <input
                        type="number"
                        value={param.min}
                        onChange={(e) =>
                          updateParam(idx, { min: Number(e.target.value) })
                        }
                        aria-label={`Giá trị nhỏ nhất của ${param.name}`}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs font-mono-num"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[11px] text-slate-500">Max</span>
                      <input
                        type="number"
                        value={param.max}
                        onChange={(e) =>
                          updateParam(idx, { max: Number(e.target.value) })
                        }
                        aria-label={`Giá trị lớn nhất của ${param.name}`}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs font-mono-num"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 pt-4 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(param.nonZero)}
                        onChange={(e) =>
                          updateParam(idx, { nonZero: e.target.checked })
                        }
                        className="rounded border-slate-300 text-[#635BFF]"
                      />
                      <span>Khác 0</span>
                    </label>
                    <label className="flex items-center gap-1.5 pt-4 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(param.positive)}
                        onChange={(e) =>
                          updateParam(idx, { positive: e.target.checked })
                        }
                        className="rounded border-slate-300 text-[#635BFF]"
                      />
                      <span>Dương (&gt; 0)</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!isLevel2Or3 && (
            <label className="block space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Khuôn mẫu đề bài (LaTeX + biến tham số)
              </span>
              <textarea
                rows={2}
                value={draft.stemTemplate}
                onChange={(e) => setDraft({ ...draft, stemTemplate: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono"
              />
            </label>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={handleAddCurrentVariantToBank}
              disabled={!liveOutcome.ok}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
                liveOutcome.ok
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Thêm vào ngân hàng</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#635BFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5248f0] transition-colors"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Lưu mẫu tham số</span>
            </button>
          </div>
        </section>

        {/* RIGHT COLUMN: Live Verified Variant Preview + Validation Panel */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-[#172033] dark:text-slate-100">
                Xem trước biến thể &amp; Kiểm chứng độc lập
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Seed cố định đảm bảo tái lập 100% — tự tính lại đáp án và kiểm tra độc lập.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={previewSeed}
                onChange={(e) => setPreviewSeed(e.target.value)}
                aria-label="Seed xem trước"
                className="w-32 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono-num"
              />
              <button
                type="button"
                onClick={() => setVariantCounter((c) => c + 1)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 px-3 py-1.5 text-xs font-semibold text-[#4F46E5] dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/70"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sinh biến thể khác</span>
              </button>
            </div>
          </div>

          {linkedSource && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Câu hỏi gốc (được bảo toàn bất biến — {linkedSource.code})
              </span>
              <div className="text-xs text-slate-700 dark:text-slate-300">
                <MathContentRenderer payload={linkedSource.question.stem} />
              </div>
            </div>
          )}

          {!liveOutcome.ok || !liveOutcome.variant ? (
            <div
              role="alert"
              className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 p-4 space-y-2"
            >
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-sm">
                <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>BLOCKED — Không thể sinh biến thể hợp lệ</span>
              </div>
              <ul className="list-disc pl-5 text-xs text-rose-700 dark:text-rose-300 space-y-1">
                {liveOutcome.blockingReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Verification Status Banner */}
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 p-3 flex items-start gap-2.5">
                <ShieldCheck
                  className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <div className="text-xs space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-emerald-800 dark:text-emerald-200">
                      KIỂM CHỨNG ĐẠT (PASS)
                    </span>
                    <span className="font-mono-num text-[11px] text-emerald-700 dark:text-emerald-300">
                      Biến thể #{variantCounter} · {liveOutcome.variant.variantCode}
                    </span>
                  </div>
                  <p className="text-emerald-800 dark:text-emerald-300">
                    {liveOutcome.variant.verification.independentCheckSummary}
                  </p>
                  <p className="text-[11px] text-emerald-700/90 dark:text-emerald-400">
                    Phương án phân biệt: {liveOutcome.variant.verification.uniqueOptionCount} · Số phương án đúng duy nhất: {liveOutcome.variant.verification.validOptionCount}
                  </p>
                </div>
              </div>

              {/* Validation Panel (6 Checks + 2 Level 3 Graph/BBT Consistency Checks) */}
              {checklist && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Bảng kiểm chứng toán học (Validation Panel)
                    </span>
                    {liveOutcome.variant.graphFingerprint && (
                      <span className="font-mono-num rounded bg-sky-100 dark:bg-sky-950/70 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:text-sky-300">
                        Fingerprint: {liveOutcome.variant.graphFingerprint}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                    {[
                      { label: 'Dữ kiện hợp lệ', ok: checklist.dataValid },
                      { label: 'Nghiệm được xác minh', ok: checklist.solutionVerified },
                      { label: 'Phương án không trùng', ok: checklist.optionsDistinct },
                      { label: 'Lời giải phù hợp', ok: checklist.explanationAligned },
                      { label: 'Có thể xuất đề', ok: checklist.canExportExam },
                      ...(checklist.graphConsistent !== undefined
                        ? [
                            { label: 'Đồ thị đồng bộ', ok: checklist.graphConsistent },
                            {
                              label: 'BBT đồng bộ',
                              ok: Boolean(checklist.variationTableConsistent),
                            },
                          ]
                        : []),
                      {
                        label: 'Cần giáo viên xác nhận',
                        ok: checklist.requiresTeacherConfirmation,
                        warn: true,
                      },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium ${
                          row.warn
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                            : row.ok
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {row.warn ? (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : row.ok ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate">{row.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Level 3 Synchronized Function Graph & Variation Table Viewer */}
              {liveOutcome.variant.functionAnalysis && (liveGraphAsset || liveTableAsset) && (
                <div className="rounded-2xl border border-sky-200/90 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs space-y-0.5">
                      <div className="font-bold text-sky-900 dark:text-sky-200">
                        Hàm số &amp; Đạo hàm đồng bộ (Dynamic SVG Engine)
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>
                          <MathContentRenderer
                            payload={parseMathContent(
                              `$${liveOutcome.variant.functionAnalysis.functionLatex}$`
                            )}
                          />
                        </span>
                        <span>·</span>
                        <span>
                          <MathContentRenderer
                            payload={parseMathContent(
                              `$${liveOutcome.variant.functionAnalysis.derivativeLatex}$`
                            )}
                          />
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setVisualViewMode('graph')}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold ${
                          visualViewMode === 'graph'
                            ? 'bg-[#635BFF] text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <LineChart className="h-3 w-3" aria-hidden="true" />
                        <span>Đồ thị SVG</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisualViewMode('table')}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold ${
                          visualViewMode === 'table'
                            ? 'bg-[#635BFF] text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <Table2 className="h-3 w-3" aria-hidden="true" />
                        <span>Bảng biến thiên</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisualViewMode('both')}
                        className={`rounded-lg px-2 py-1 font-semibold ${
                          visualViewMode === 'both'
                            ? 'bg-[#635BFF] text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Cả hai
                      </button>
                    </div>
                  </div>

                  <div
                    className={`grid gap-3 ${
                      visualViewMode === 'both' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
                    }`}
                  >
                    {(visualViewMode === 'graph' || visualViewMode === 'both') && liveGraphAsset && (
                      <MathVisualAssetRenderer asset={liveGraphAsset} />
                    )}
                    {(visualViewMode === 'table' || visualViewMode === 'both') && liveTableAsset && (
                      <MathVisualAssetRenderer asset={liveTableAsset} />
                    )}
                  </div>
                </div>
              )}

              {/* Generated Question Preview */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/50 p-4 space-y-3">
                <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                  Nội dung biến thể mới (Tham số: {liveOutcome.variant.parameterSignature})
                </div>
                <div className="text-sm font-medium text-[#172033] dark:text-slate-100 leading-relaxed">
                  <MathContentRenderer payload={liveOutcome.variant.question.stem} />
                </div>

                {liveOutcome.variant.question.options && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                    {liveOutcome.variant.question.options.map((opt) => (
                      <div
                        key={opt.id}
                        className={`rounded-xl border px-3 py-2 space-y-2 ${
                          opt.isCorrect
                            ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/40 font-semibold text-emerald-900 dark:text-emerald-200'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold shrink-0">{opt.originalLabel}.</span>
                            <MathContentRenderer payload={opt.content} />
                          </div>
                          {opt.isCorrect && (
                            <CheckCircle2
                              className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0"
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

                {liveOutcome.variant.question.shortAnswer && (
                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                    Đáp án trả lời ngắn chuẩn:{' '}
                    <span className="font-mono-num">
                      {liveOutcome.variant.question.shortAnswer.answerValue}
                    </span>{' '}
                    {liveOutcome.variant.question.shortAnswer.unit ?? ''}
                  </div>
                )}
              </div>

              {/* Recalculated Explanation */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Lời giải tính lại tự động
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                  <MathContentRenderer
                    payload={liveOutcome.variant.question.solutionGuide}
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Variant Comparison Strip (§XV): Câu gốc → Biến thể A → Biến thể B */}
      {liveOutcome.ok && liveOutcome.variant && (
        <section className="rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-[#635BFF]" aria-hidden="true" />
              <h3 className="text-xs font-bold text-[#172033] dark:text-slate-100">
                Đối chiếu biến thể (Câu gốc → Biến thể A → Biến thể B)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowComparison((prev) => !prev)}
              className="text-[11px] font-semibold text-[#635BFF] hover:underline"
            >
              {showComparison ? 'Thu gọn đối chiếu' : 'Mở đối chiếu'}
            </button>
          </div>

          {showComparison && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {/* Original Column */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    Câu gốc ({linkedSource?.code ?? 'Mẫu mới'})
                  </span>
                  <span className="rounded bg-sky-100 dark:bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                    ORIGINAL
                  </span>
                </div>
                {linkedSource ? (
                  <div className="text-slate-700 dark:text-slate-300">
                    <MathContentRenderer payload={linkedSource.question.stem} />
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Mẫu tham số độc lập (không ghi đè câu hỏi nào trong ngân hàng).
                  </p>
                )}
              </div>

              {/* Variant A Column */}
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-emerald-900 dark:text-emerald-200">
                    Biến thể A ({liveOutcome.variant.variantCode})
                  </span>
                  <span className="rounded bg-emerald-100 dark:bg-emerald-900/70 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    PASS
                  </span>
                </div>
                <div className="font-mono-num text-[10px] text-slate-500">
                  {liveOutcome.variant.parameterSignature}
                  {liveOutcome.variant.graphFingerprint
                    ? ` · FP: ${liveOutcome.variant.graphFingerprint}`
                    : ''}
                </div>
                <div className="text-slate-800 dark:text-slate-200">
                  <MathContentRenderer payload={liveOutcome.variant.question.stem} />
                </div>
                {compAGraphAsset && (
                  <MathVisualAssetRenderer asset={compAGraphAsset} compact />
                )}
                <div className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  Đáp án:{' '}
                  {liveOutcome.variant.correctOptionLabel
                    ? `${liveOutcome.variant.correctOptionLabel} · `
                    : ''}
                  <span className="font-mono-num">
                    {liveOutcome.variant.correctFormatted.replace(/\$/g, '')}
                  </span>
                </div>
              </div>

              {/* Variant B Column */}
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-indigo-900 dark:text-indigo-200">
                    Biến thể B ({comparisonOutcomeB?.variant?.variantCode ?? '—'})
                  </span>
                  <span className="rounded bg-indigo-100 dark:bg-indigo-900/70 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                    {comparisonOutcomeB?.ok ? 'PASS' : 'BLOCKED'}
                  </span>
                </div>
                {comparisonOutcomeB?.ok && comparisonOutcomeB.variant ? (
                  <>
                    <div className="font-mono-num text-[10px] text-slate-500">
                      {comparisonOutcomeB.variant.parameterSignature}
                      {comparisonOutcomeB.variant.graphFingerprint
                        ? ` · FP: ${comparisonOutcomeB.variant.graphFingerprint}`
                        : ''}
                    </div>
                    <div className="text-slate-800 dark:text-slate-200">
                      <MathContentRenderer
                        payload={comparisonOutcomeB.variant.question.stem}
                      />
                    </div>
                    {compBGraphAsset && (
                      <MathVisualAssetRenderer asset={compBGraphAsset} compact />
                    )}
                    <div className="text-[11px] font-semibold text-indigo-800 dark:text-indigo-300">
                      Đáp án:{' '}
                      {comparisonOutcomeB.variant.correctOptionLabel
                        ? `${comparisonOutcomeB.variant.correctOptionLabel} · `
                        : ''}
                      <span className="font-mono-num">
                        {comparisonOutcomeB.variant.correctFormatted.replace(/\$/g, '')}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Không có biến thể B khác biệt trong miền ràng buộc hẹp hiện tại.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

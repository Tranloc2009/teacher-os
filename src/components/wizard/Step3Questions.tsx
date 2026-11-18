import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Eye, Plus, Trash2 } from 'lucide-react';
import { createId } from '../../db/database';
import {
  LessonPack,
  QuestionItem,
  QuestionTier,
  TIER_LABELS,
  ValidationErrors,
  WorksheetVariantId,
} from '../../types/lesson';
import {
  allocateThreeWorksheets,
  countAvailableByTier,
  generateNextQuestionCode,
  normalizeWorksheetVariants,
} from '../../utils/allocation';

interface Step3QuestionsProps {
  pack: LessonPack;
  errors: ValidationErrors;
  onChange: (updater: (prev: LessonPack) => LessonPack) => void;
}

const TIERS: QuestionTier[] = ['basic', 'applied', 'extended'];

export function Step3Questions({ pack, errors, onChange }: Step3QuestionsProps) {
  const [previewVariant, setPreviewVariant] = useState<WorksheetVariantId | 'ALL'>('A');
  const [showA4Preview, setShowA4Preview] = useState(true);

  const available = countAvailableByTier(pack.questions);
  const variants = normalizeWorksheetVariants(pack);
  const variantResults = allocateThreeWorksheets(pack.questions, variants);

  const addQuestion = (tier: QuestionTier = 'basic') => {
    onChange((prev) => {
      const code = generateNextQuestionCode(prev.questions, tier);
      const item: QuestionItem = {
        id: createId('q'),
        code,
        tier,
        prompt: '',
        answerGuide: '',
        points: tier === 'basic' ? 2 : tier === 'applied' ? 3 : 2,
      };
      return {
        ...prev,
        questions: [...prev.questions, item],
      };
    });
  };

  const updateQuestion = (id: string, patch: Partial<QuestionItem>) => {
    onChange((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    }));
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pack.questions.length) return;
    onChange((prev) => {
      const next = [...prev.questions];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...prev, questions: next };
    });
  };

  const removeQuestion = (id: string) => {
    onChange((prev) => ({
      ...prev,
      questions: prev.questions.filter((q) => q.id !== id),
    }));
  };

  const updateVariantLabel = (variantId: WorksheetVariantId, label: string) => {
    onChange((prev) => {
      const current = normalizeWorksheetVariants(prev);
      const next = current.map((v) =>
        v.id === variantId ? { ...v, label } : v
      );
      return { ...prev, worksheetVariants: next };
    });
  };

  const setVariantTierCount = (
    variantId: WorksheetVariantId,
    tier: QuestionTier,
    rawValue: number
  ) => {
    const safe = Math.max(0, Math.min(50, Math.floor(Number(rawValue) || 0)));
    onChange((prev) => {
      const current = normalizeWorksheetVariants(prev);
      const next = current.map((v) =>
        v.id === variantId
          ? {
              ...v,
              distribution: {
                ...v.distribution,
                [tier]: safe,
              },
            }
          : v
      );
      // Keep legacy distribution synced to Phiếu B (standard) for summary compatibility
      const standardVariant = next.find((v) => v.id === 'B') ?? next[0];
      return {
        ...prev,
        worksheetVariants: next,
        distribution: { ...standardVariant.distribution },
      };
    });
  };

  const fillVariantWithAvailable = (variantId: WorksheetVariantId) => {
    onChange((prev) => {
      const current = normalizeWorksheetVariants(prev);
      const next = current.map((v) =>
        v.id === variantId ? { ...v, distribution: { ...available } } : v
      );
      const standardVariant = next.find((v) => v.id === 'B') ?? next[0];
      return {
        ...prev,
        worksheetVariants: next,
        distribution: { ...standardVariant.distribution },
      };
    });
  };

  const visiblePreviewResults =
    previewVariant === 'ALL'
      ? variantResults
      : variantResults.filter((r) => r.variant.id === previewVariant);

  return (
    <section aria-labelledby="step3-heading" className="space-y-6">
      <div>
        <h2 id="step3-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Bước 3 (F03): Ngân hàng câu hỏi &amp; Chọn số câu cho 3 bản phiếu A4
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Nhập/sửa/xóa câu hỏi kèm mã riêng và đáp án tùy chọn; sau đó chọn thủ công số câu Cơ bản / Vận dụng / Mở rộng cho từng mẫu phiếu A, B, C. Hệ thống không tự tạo câu giả khi thiếu.
        </p>
      </div>

      {/* Ngân hàng câu hỏi tự nhập */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Ngân hàng câu hỏi của tiết dạy (<span className="font-mono-num">{pack.questions.length}</span> câu)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono-num">
              Hiện có: {available.basic} Cơ bản · {available.applied} Vận dụng · {available.extended} Mở rộng
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => addQuestion(tier)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Thêm câu {TIER_LABELS[tier]}</span>
              </button>
            ))}
          </div>
        </div>

        {errors.questions && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-3 text-sm text-red-800 dark:text-red-200" role="alert">
            {errors.questions}
          </div>
        )}

        {pack.questions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-8 text-center">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Chưa có câu hỏi nào trong ngân hàng của tiết dạy.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Bấm &ldquo;Thêm câu Cơ bản&rdquo;, &ldquo;Thêm câu Vận dụng&rdquo; hoặc &ldquo;Thêm câu Mở rộng&rdquo; ở trên để tự nhập câu hỏi có mã riêng.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pack.questions.map((q, idx) => (
              <div
                key={q.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                      #{idx + 1}
                    </span>

                    {/* Mã riêng */}
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={`q-code-${q.id}`} className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Mã riêng:
                      </label>
                      <input
                        id={`q-code-${q.id}`}
                        type="text"
                        value={q.code}
                        onChange={(e) => updateQuestion(q.id, { code: e.target.value })}
                        placeholder="VD: CB-01"
                        className="w-24 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-mono-num font-medium text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                      />
                    </div>

                    {/* Mức độ */}
                    <div>
                      <label htmlFor={`q-tier-${q.id}`} className="sr-only">
                        Mức độ câu hỏi {idx + 1}
                      </label>
                      <select
                        id={`q-tier-${q.id}`}
                        value={q.tier}
                        onChange={(e) =>
                          updateQuestion(q.id, { tier: e.target.value as QuestionTier })
                        }
                        className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-800 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                      >
                        {TIERS.map((tier) => (
                          <option key={tier} value={tier}>
                            Mức: {TIER_LABELS[tier]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Điểm gợi ý */}
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={`q-pts-${q.id}`} className="text-xs text-slate-600 dark:text-slate-400">
                        Điểm:
                      </label>
                      <input
                        id={`q-pts-${q.id}`}
                        type="number"
                        min={0}
                        max={20}
                        step={0.5}
                        value={q.points}
                        onChange={(e) =>
                          updateQuestion(q.id, {
                            points: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-16 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => moveQuestion(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Di chuyển câu hỏi ${q.code || idx + 1} lên`}
                      className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveQuestion(idx, 1)}
                      disabled={idx === pack.questions.length - 1}
                      aria-label={`Di chuyển câu hỏi ${q.code || idx + 1} xuống`}
                      className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeQuestion(q.id)}
                      aria-label={`Xóa câu hỏi ${q.code || idx + 1}`}
                      className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-700 dark:hover:text-red-400 hover:border-red-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {errors[`question_${q.id}_code`] && (
                  <p className="text-xs font-medium text-red-700 dark:text-red-400" role="alert">
                    {errors[`question_${q.id}_code`]}
                  </p>
                )}

                <div>
                  <label htmlFor={`q-prompt-${q.id}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Nội dung câu hỏi (in trên phiếu học sinh) <span className="text-red-600 dark:text-red-400">*</span>
                  </label>
                  <textarea
                    id={`q-prompt-${q.id}`}
                    rows={3}
                    value={q.prompt}
                    onChange={(e) => updateQuestion(q.id, { prompt: e.target.value })}
                    placeholder="Nhập đầy đủ đề bài, câu hỏi có dấu tiếng Việt chuẩn..."
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                  />
                  {errors[`question_${q.id}_prompt`] && (
                    <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-400" role="alert">
                      {errors[`question_${q.id}_prompt`]}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={`q-ans-${q.id}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Đáp án / hướng dẫn chấm (tùy chọn — chỉ in cho giáo viên)
                  </label>
                  <textarea
                    id={`q-ans-${q.id}`}
                    rows={2}
                    value={q.answerGuide}
                    onChange={(e) => updateQuestion(q.id, { answerGuide: e.target.value })}
                    placeholder="Để trống nếu không cần hoặc ghi nhanh gợi ý đáp án..."
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chọn thủ công số câu cho 3 bản phiếu A, B, C */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Chọn thủ công số câu cho 3 bản phiếu A4 (Phiếu A, B, C)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Mỗi bản phiếu lấy câu hỏi thực tế từ ngân hàng ở trên. Nếu bạn nhập số lượng vượt quá số câu hiện có, hệ thống sẽ báo thiếu rõ ràng và không tự sinh câu giả.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {variantResults.map(({ variant, allocated }) => {
            const hasShortfall =
              allocated.shortfalls.basic > 0 ||
              allocated.shortfalls.applied > 0 ||
              allocated.shortfalls.extended > 0;
            return (
              <div
                key={variant.id}
                className={`rounded-xl border p-4 space-y-3 ${
                  hasShortfall
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono-num font-bold text-blue-900 dark:text-blue-400">
                    MẪU PHIẾU {variant.id}
                  </span>
                  <button
                    type="button"
                    onClick={() => fillVariantWithAvailable(variant.id)}
                    className="text-[11px] font-medium text-blue-900 dark:text-blue-400 hover:underline whitespace-nowrap"
                  >
                    Lấy tối đa hiện có
                  </button>
                </div>

                <div>
                  <label
                    htmlFor={`variant-label-${variant.id}`}
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Tên gọi trên phiếu
                  </label>
                  <input
                    id={`variant-label-${variant.id}`}
                    type="text"
                    value={variant.label}
                    onChange={(e) => updateVariantLabel(variant.id, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div className="space-y-2">
                  {TIERS.map((tier) => (
                    <div
                      key={tier}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
                    >
                      <label
                        htmlFor={`var-${variant.id}-${tier}`}
                        className="text-xs font-medium text-slate-800 dark:text-slate-200"
                      >
                        {TIER_LABELS[tier]}{' '}
                        <span className="text-slate-400 font-mono-num">
                          (có {available[tier]})
                        </span>
                      </label>
                      <input
                        id={`var-${variant.id}-${tier}`}
                        type="number"
                        min={0}
                        max={50}
                        value={variant.distribution[tier]}
                        onChange={(e) =>
                          setVariantTierCount(variant.id, tier, Number(e.target.value))
                        }
                        className="w-16 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-right text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200/80 dark:border-slate-700 pt-2 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                  <div className="flex items-center justify-between font-mono-num">
                    <span>Thực xuất:</span>
                    <strong>
                      {allocated.totalQuestions} câu ({allocated.totalPoints} điểm)
                    </strong>
                  </div>
                  {allocated.orderedQuestions.length > 0 && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num break-words">
                      Mã câu: {allocated.orderedQuestions.map((q) => q.code || q.id).join(', ')}
                    </p>
                  )}
                </div>

                {allocated.warnings.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 p-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-1"
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Cảnh báo thiếu câu hỏi</span>
                    </div>
                    {allocated.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {errors.distribution && (
          <p className="text-xs font-medium text-red-700 dark:text-red-400" role="alert">
            {errors.distribution}
          </p>
        )}
      </div>

      {/* Xem trước 3 mẫu phiếu A4 với vùng Họ tên / Lớp để trống */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Xem trước 3 mẫu phiếu A4 (Họ tên / Lớp để trống để in giấy)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Kiểm tra trực tiếp bố cục từng phiếu A, B, C trước khi sang bước Rubric và in A4.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowA4Preview((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{showA4Preview ? 'Thu gọn xem trước' : 'Mở xem trước 3 mẫu phiếu A4'}</span>
          </button>
        </div>

        {showA4Preview && (
          <div className="space-y-4">
            <div
              role="tablist"
              aria-label="Chọn mẫu phiếu A4 xem trước"
              className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-1"
            >
              {(
                [
                  { id: 'A', label: 'Phiếu A' },
                  { id: 'B', label: 'Phiếu B' },
                  { id: 'C', label: 'Phiếu C' },
                  { id: 'ALL', label: 'Cả 3 mẫu phiếu' },
                ] as const
              ).map((tab) => {
                const active = previewVariant === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setPreviewVariant(tab.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-slate-700 text-blue-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-6 rounded-xl bg-slate-100/80 dark:bg-slate-950/60 p-3 sm:p-5">
              {visiblePreviewResults.map(({ variant, allocated }) => {
                let qCounter = 0;
                return (
                  <article
                    key={variant.id}
                    className="a4-sheet rounded-sm p-6 sm:p-8 text-slate-900"
                    aria-label={`Xem trước A4 ${variant.label}`}
                  >
                    <header className="border-b-2 border-slate-900 pb-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-700">
                        <span className="font-semibold uppercase">{variant.label}</span>
                        <span className="font-mono-num">
                          {pack.subject} · {pack.grade} · {pack.duration} phút
                        </span>
                      </div>
                      <h4 className="mt-1.5 text-base font-bold text-slate-950">
                        {pack.title || 'Phiếu bài tập học sinh'}
                      </h4>
                      <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-slate-800 sm:grid-cols-2">
                        <div className="border-b border-dotted border-slate-400 pb-1">
                          Họ và tên: ......................................................
                        </div>
                        <div className="border-b border-dotted border-slate-400 pb-1">
                          Lớp: .................... Ngày: ..... / ..... / 20.....
                        </div>
                      </div>
                    </header>

                    <div className="mt-4 space-y-4">
                      {allocated.warnings.length > 0 && (
                        <div className="rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                          {allocated.warnings.map((w, idx) => (
                            <p key={idx}>{w}</p>
                          ))}
                        </div>
                      )}

                      {allocated.totalQuestions === 0 ? (
                        <p className="text-sm italic text-slate-500">
                          Phiếu này chưa có câu hỏi nào được chọn.
                        </p>
                      ) : (
                        TIERS.map((tier) => {
                          const list = allocated.sections[tier];
                          if (list.length === 0) return null;
                          return (
                            <div key={tier} className="space-y-3">
                              <h5 className="border-b border-slate-300 pb-1 text-xs font-bold uppercase tracking-wide text-slate-900">
                                Phần {TIER_LABELS[tier]} ({list.length} câu)
                              </h5>
                              {list.map((q) => {
                                qCounter += 1;
                                return (
                                  <div key={q.id} className="avoid-break space-y-1.5">
                                    <div className="flex items-baseline justify-between gap-2 text-sm">
                                      <span className="font-semibold text-slate-950">
                                        Câu {qCounter}{' '}
                                        <span className="font-mono-num text-xs font-normal text-slate-500">
                                          [{q.code || q.id}]
                                        </span>
                                      </span>
                                      <span className="font-mono-num text-xs text-slate-600">
                                        ({q.points} điểm)
                                      </span>
                                    </div>
                                    <p className="text-sm leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
                                      {q.prompt || '(Chưa nhập nội dung câu hỏi)'}
                                    </p>
                                    <div aria-hidden="true" className="pt-1 space-y-2.5">
                                      <div className="border-b border-dotted border-slate-300 h-3" />
                                      <div className="border-b border-dotted border-slate-300 h-3" />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

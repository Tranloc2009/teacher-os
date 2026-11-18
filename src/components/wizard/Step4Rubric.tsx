import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Plus, Printer, Trash2 } from 'lucide-react';
import { createId } from '../../db/database';
import {
  LessonPack,
  RUBRIC_LEVEL_HEADERS,
  RUBRIC_MAX_CRITERIA,
  RUBRIC_MIN_CRITERIA,
  RubricCriterion,
  RubricLevelDescriptions,
  ValidationErrors,
} from '../../types/lesson';

interface Step4RubricProps {
  pack: LessonPack;
  errors: ValidationErrors;
  onChange: (updater: (prev: LessonPack) => LessonPack) => void;
}

export function Step4Rubric({ pack, errors, onChange }: Step4RubricProps) {
  const [showFormativePreview, setShowFormativePreview] = useState(false);

  const criteriaCount = pack.rubric.length;
  const canAdd = criteriaCount < RUBRIC_MAX_CRITERIA;
  const canDelete = criteriaCount > RUBRIC_MIN_CRITERIA;
  const weightSum = pack.rubric.reduce(
    (sum, c) => sum + (Number.isFinite(c.weightPercent) ? c.weightPercent : 0),
    0
  );

  const addCriterion = () => {
    if (!canAdd) return;
    const newCriterion: RubricCriterion = {
      id: createId('rub'),
      name: '',
      weightPercent: 20,
      levels: {
        needsSupport: '',
        meets: '',
        exceeds: '',
      },
    };
    onChange((prev) => ({
      ...prev,
      rubric: [...prev.rubric, newCriterion],
    }));
  };

  const updateCriterion = (id: string, patch: Partial<RubricCriterion>) => {
    onChange((prev) => ({
      ...prev,
      rubric: prev.rubric.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const updateLevel = (
    id: string,
    key: keyof RubricLevelDescriptions,
    value: string
  ) => {
    onChange((prev) => ({
      ...prev,
      rubric: prev.rubric.map((c) =>
        c.id === id ? { ...c, levels: { ...c.levels, [key]: value } } : c
      ),
    }));
  };

  const moveCriterion = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pack.rubric.length) return;
    onChange((prev) => {
      const next = [...prev.rubric];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...prev, rubric: next };
    });
  };

  const removeCriterion = (id: string) => {
    if (!canDelete) return;
    onChange((prev) => ({
      ...prev,
      rubric: prev.rubric.filter((c) => c.id !== id),
    }));
  };

  const rebalanceWeights = () => {
    if (pack.rubric.length === 0) return;
    const count = pack.rubric.length;
    const base = Math.floor(100 / count);
    const remainder = 100 - base * count;
    onChange((prev) => ({
      ...prev,
      rubric: prev.rubric.map((c, idx) => ({
        ...c,
        weightPercent: base + (idx === 0 ? remainder : 0),
      })),
    }));
  };

  return (
    <section aria-labelledby="step4-heading" className="space-y-6 print:space-y-0">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="step4-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Bước 4 (F04): Biên tập Rubric 3–5 tiêu chí (3 mức đạt)
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Soạn 3 đến 5 tiêu chí đánh giá quá trình, mỗi tiêu chí có mô tả 3 mức đạt; hỗ trợ chỉnh sửa, sắp xếp thứ tự và in phiếu đánh giá quá trình (không lưu vào sổ điểm chính thức).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium font-mono-num ${
              criteriaCount >= RUBRIC_MIN_CRITERIA && criteriaCount <= RUBRIC_MAX_CRITERIA
                ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200'
            }`}
          >
            Số tiêu chí: {criteriaCount} / {RUBRIC_MIN_CRITERIA}–{RUBRIC_MAX_CRITERIA}
          </span>
          <span
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium font-mono-num ${
              weightSum === 100
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
            }`}
          >
            Tổng tỷ trọng: {weightSum}%
          </span>
          {pack.rubric.length > 0 && weightSum !== 100 && (
            <button
              type="button"
              onClick={rebalanceWeights}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              Chia đều 100%
            </button>
          )}
          <button
            type="button"
            onClick={addCriterion}
            disabled={!canAdd}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-600 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500 disabled:opacity-45 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Thêm tiêu chí</span>
          </button>
        </div>
      </div>

      {errors.rubric && (
        <div className="no-print rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-3 text-sm text-red-800 dark:text-red-200" role="alert">
          {errors.rubric}
        </div>
      )}

      {errors.weightSum && (
        <div className="no-print rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
          {errors.weightSum}
        </div>
      )}

      <div className="no-print space-y-5">
        {pack.rubric.map((criterion, idx) => (
          <div
            key={criterion.id}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 sm:p-5 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex-1 min-w-[220px]">
                <label
                  htmlFor={`rub-name-${criterion.id}`}
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Tiêu chí <span className="font-mono-num">#{idx + 1}</span>{' '}
                  <span className="text-red-600 dark:text-red-400">*</span>
                </label>
                <input
                  id={`rub-name-${criterion.id}`}
                  type="text"
                  value={criterion.name}
                  onChange={(e) =>
                    updateCriterion(criterion.id, { name: e.target.value })
                  }
                  placeholder="Ví dụ: Lập luận, Trình bày, Hợp tác nhóm..."
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                />
                {errors[`rubric_${criterion.id}_name`] && (
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400" role="alert">
                    {errors[`rubric_${criterion.id}_name`]}
                  </p>
                )}
              </div>

              <div className="w-28">
                <label
                  htmlFor={`rub-weight-${criterion.id}`}
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Tỷ trọng (%)
                </label>
                <input
                  id={`rub-weight-${criterion.id}`}
                  type="number"
                  min={0}
                  max={100}
                  value={criterion.weightPercent}
                  onChange={(e) =>
                    updateCriterion(criterion.id, {
                      weightPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div className="mt-6 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => moveCriterion(idx, -1)}
                  disabled={idx === 0}
                  aria-label={`Di chuyển tiêu chí ${criterion.name || idx + 1} lên`}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => moveCriterion(idx, 1)}
                  disabled={idx === pack.rubric.length - 1}
                  aria-label={`Di chuyển tiêu chí ${criterion.name || idx + 1} xuống`}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => removeCriterion(criterion.id)}
                  disabled={!canDelete}
                  title={
                    canDelete
                      ? 'Xóa tiêu chí này'
                      : `Rubric cần tối thiểu ${RUBRIC_MIN_CRITERIA} tiêu chí`
                  }
                  aria-label={`Xóa tiêu chí ${criterion.name || idx + 1}`}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-700 dark:hover:text-red-400 hover:border-red-200 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {RUBRIC_LEVEL_HEADERS.map((level) => (
                <div key={level.key} className="space-y-1">
                  <label
                    htmlFor={`rub-${criterion.id}-${level.key}`}
                    className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    <span>{level.label}</span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {level.scoreHint}
                    </span>
                  </label>
                  <textarea
                    id={`rub-${criterion.id}-${level.key}`}
                    rows={4}
                    value={criterion.levels[level.key]}
                    onChange={(e) =>
                      updateLevel(criterion.id, level.key, e.target.value)
                    }
                    placeholder={`Mô tả biểu hiện đạt ${level.label.toLowerCase()}...`}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              ))}
            </div>

            {errors[`rubric_${criterion.id}_levels`] && (
              <p className="text-xs text-red-700 dark:text-red-400" role="alert">
                {errors[`rubric_${criterion.id}_levels`]}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Xem trước nhanh bản in đánh giá quá trình */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3 print:border-none print:pt-0 print:space-y-0">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Bản in đánh giá quá trình (Rubric)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dùng để phát hoặc đánh dấu nhận xét quá trình trên lớp; không kết nối hay lưu vào sổ điểm chính thức.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFormativePreview((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{showFormativePreview ? 'Ẩn bản xem trước' : 'Xem trước bản in đánh giá'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowFormativePreview(true);
                window.setTimeout(() => window.print(), 60);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:hover:bg-blue-600 whitespace-nowrap"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>In phiếu đánh giá quá trình</span>
            </button>
          </div>
        </div>

        {showFormativePreview && (
          <div className="print-container rounded-xl bg-slate-100/80 dark:bg-slate-950/60 p-3 sm:p-5">
            <article className="a4-sheet rounded-sm p-6 sm:p-8 text-slate-900">
              <header className="border-b-2 border-slate-900 pb-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-700">
                  <span className="font-semibold uppercase">PHIẾU ĐÁNH GIÁ QUÁ TRÌNH (RUBRIC)</span>
                  <span className="font-mono-num">
                    {pack.subject} · {pack.grade}
                  </span>
                </div>
                <h4 className="mt-1.5 text-base font-bold text-slate-950">
                  {pack.title || 'Đánh giá quá trình học tập'}
                </h4>
                <div className="mt-2.5 grid grid-cols-1 gap-3 text-xs text-slate-800 sm:grid-cols-2">
                  <div className="border-b border-dotted border-slate-400 pb-1">
                    Họ tên / Nhóm học sinh: ...........................................
                  </div>
                  <div className="border-b border-dotted border-slate-400 pb-1">
                    Lớp: ................... Ngày: ..... / ..... / 20.....
                  </div>
                </div>
              </header>

              <div className="mt-4">
                <table className="w-full border-collapse border border-slate-400 text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-left text-slate-900">
                      <th className="border border-slate-400 p-2 font-semibold w-[22%]">
                        Tiêu chí / Tỷ trọng
                      </th>
                      {RUBRIC_LEVEL_HEADERS.map((lv) => (
                        <th key={lv.key} className="border border-slate-400 p-2 font-semibold">
                          <div>{lv.label}</div>
                          <div className="font-normal text-[11px] text-slate-600">{lv.scoreHint}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pack.rubric.map((c, i) => (
                      <tr key={c.id} className="align-top">
                        <td className="border border-slate-400 p-2 font-semibold text-slate-900">
                          <div>
                            {i + 1}. {c.name || '(Chưa đặt tên tiêu chí)'}
                          </div>
                          <div className="mt-1 font-mono-num text-[11px] font-normal text-slate-600">
                            Tỷ trọng: {c.weightPercent}%
                          </div>
                        </td>
                        {RUBRIC_LEVEL_HEADERS.map((lv) => (
                          <td
                            key={lv.key}
                            className="border border-slate-400 p-2 leading-relaxed text-slate-800 whitespace-pre-wrap break-words"
                          >
                            <div className="mb-1 text-[11px] font-medium text-slate-600">
                              [ ] Chọn mức này
                            </div>
                            {c.levels[lv.key] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-4 space-y-2 text-xs text-slate-800">
                  <p className="font-semibold">Nhận xét quá trình &amp; gợi ý bước tiếp theo:</p>
                  <div className="border-b border-dotted border-slate-400 h-5" />
                  <div className="border-b border-dotted border-slate-400 h-5" />
                </div>

                <p className="mt-4 text-[11px] italic text-slate-500">
                  Ghi chú: Phiếu đánh giá quá trình dùng để phản hồi học tập trên lớp, không dùng làm sổ điểm chính thức.
                </p>
              </div>
            </article>
          </div>
        )}
      </div>
    </section>
  );
}

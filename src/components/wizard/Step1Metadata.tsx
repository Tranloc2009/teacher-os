import { Plus, Trash2 } from 'lucide-react';
import {
  GRADE_OPTIONS,
  LessonDuration,
  LessonPack,
  SUBJECT_OPTIONS,
  ValidationErrors,
} from '../../types/lesson';

interface Step1MetadataProps {
  pack: LessonPack;
  errors: ValidationErrors;
  onChange: (updater: (prev: LessonPack) => LessonPack) => void;
}

export function Step1Metadata({ pack, errors, onChange }: Step1MetadataProps) {
  const isCustomSubject =
    pack.subject !== '' &&
    !(SUBJECT_OPTIONS as readonly string[]).includes(pack.subject);

  const selectValue = isCustomSubject ? 'Khác' : pack.subject;

  const handleObjectiveChange = (idx: number, value: string) => {
    onChange((prev) => {
      const next = [...prev.objectives];
      next[idx] = value;
      return { ...prev, objectives: next };
    });
  };

  const handleAddObjective = () => {
    onChange((prev) => ({
      ...prev,
      objectives: [...prev.objectives, ''],
    }));
  };

  const handleRemoveObjective = (idx: number) => {
    onChange((prev) => {
      if (prev.objectives.length <= 1) {
        return { ...prev, objectives: [''] };
      }
      return {
        ...prev,
        objectives: prev.objectives.filter((_, i) => i !== idx),
      };
    });
  };

  return (
    <section aria-labelledby="step1-heading" className="space-y-6">
      <div>
        <h2 id="step1-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Bước 1: Thông tin chung &amp; Mục tiêu tiết dạy
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Xác định môn học, khối lớp, tên chủ đề, thời lượng và các mục tiêu cần đạt của tiết học.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* Môn học */}
        <div>
          <label htmlFor="lesson-subject" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Môn học <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <select
            id="lesson-subject"
            value={selectValue}
            onChange={(e) => {
              const val = e.target.value;
              onChange((prev) => ({
                ...prev,
                subject: val === 'Khác' ? '' : val,
              }));
            }}
            aria-invalid={Boolean(errors.subject)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
          >
            <option value="">-- Chọn môn học --</option>
            {SUBJECT_OPTIONS.map((subj) => (
              <option key={subj} value={subj}>
                {subj}
              </option>
            ))}
          </select>

          {(selectValue === 'Khác' || isCustomSubject) && (
            <div className="mt-2">
              <label htmlFor="lesson-custom-subject" className="sr-only">
                Nhập tên môn học khác
              </label>
              <input
                id="lesson-custom-subject"
                type="text"
                value={pack.subject}
                onChange={(e) =>
                  onChange((prev) => ({ ...prev, subject: e.target.value }))
                }
                placeholder="Nhập tên môn học cụ thể..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
              />
            </div>
          )}

          {errors.subject && (
            <p className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-400" role="alert">
              {errors.subject}
            </p>
          )}
        </div>

        {/* Khối lớp */}
        <div>
          <label htmlFor="lesson-grade" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Khối lớp <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <select
            id="lesson-grade"
            value={pack.grade}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, grade: e.target.value }))
            }
            aria-invalid={Boolean(errors.grade)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
          >
            <option value="">-- Chọn khối lớp --</option>
            {GRADE_OPTIONS.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
          {errors.grade && (
            <p className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-400" role="alert">
              {errors.grade}
            </p>
          )}
        </div>
      </div>

      {/* Chủ đề / Tên bài */}
      <div>
        <label htmlFor="lesson-title" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
          Chủ đề / Tên bài dạy <span className="text-red-600 dark:text-red-400">*</span>
        </label>
        <input
          id="lesson-title"
          type="text"
          value={pack.title}
          onChange={(e) =>
            onChange((prev) => ({ ...prev, title: e.target.value }))
          }
          placeholder="Ví dụ: Phương trình bậc nhất một ẩn — Luyện tập giải toán thực tế"
          aria-invalid={Boolean(errors.title)}
          className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
        />
        {errors.title && (
          <p className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-400" role="alert">
            {errors.title}
          </p>
        )}
      </div>

      {/* Thời lượng */}
      <div>
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
          Thời lượng tiết dạy <span className="text-red-600 dark:text-red-400">*</span>
        </span>
        <div className="mt-2 inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-1">
          {([45, 90] as LessonDuration[]).map((dur) => {
            const active = pack.duration === dur;
            return (
              <button
                key={dur}
                type="button"
                onClick={() => onChange((prev) => ({ ...prev, duration: dur }))}
                aria-pressed={active}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-700 ${
                  active
                    ? 'bg-white dark:bg-slate-700 text-blue-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="font-mono-num">{dur}</span> phút ({dur === 45 ? '1 tiết' : '2 tiết liền'})
              </button>
            );
          })}
        </div>
        {errors.duration && (
          <p className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-400" role="alert">
            {errors.duration}
          </p>
        )}
      </div>

      {/* Mục tiêu bài học */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
              Mục tiêu bài học <span className="text-red-600 dark:text-red-400">*</span>
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Nêu cụ thể kiến thức, năng lực hoặc phẩm chất học sinh đạt được sau tiết dạy.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddObjective}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Thêm mục tiêu</span>
          </button>
        </div>

        <div className="mt-3 space-y-2.5">
          {pack.objectives.map((obj, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="mt-2.5 w-6 shrink-0 text-xs font-mono-num font-medium text-slate-500 dark:text-slate-400 text-right">
                {idx + 1}.
              </span>
              <div className="flex-1">
                <label htmlFor={`objective-${idx}`} className="sr-only">
                  Mục tiêu {idx + 1}
                </label>
                <input
                  id={`objective-${idx}`}
                  type="text"
                  value={obj}
                  onChange={(e) => handleObjectiveChange(idx, e.target.value)}
                  placeholder={`Nhập mục tiêu thứ ${idx + 1}...`}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
              </div>
              <button
                type="button"
                onClick={() => handleRemoveObjective(idx)}
                aria-label={`Xóa mục tiêu ${idx + 1}`}
                className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-700 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        {errors.objectives && (
          <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-400" role="alert">
            {errors.objectives}
          </p>
        )}
      </div>
    </section>
  );
}

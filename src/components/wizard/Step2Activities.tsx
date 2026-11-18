import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { ACTIVITY_TEMPLATES } from '../../data/activityTemplates';
import { createId } from '../../db/database';
import {
  ActivityItem,
  ActivityTemplate,
  LessonPack,
  ValidationErrors,
} from '../../types/lesson';
import { calculateActivityMinutes } from '../../utils/allocation';

interface Step2ActivitiesProps {
  pack: LessonPack;
  errors: ValidationErrors;
  onChange: (updater: (prev: LessonPack) => LessonPack) => void;
}

export function Step2Activities({ pack, errors, onChange }: Step2ActivitiesProps) {
  const totalMinutes = calculateActivityMinutes(pack);
  const overBudget = totalMinutes > pack.duration;

  const addFromTemplate = (tpl: ActivityTemplate) => {
    const newItem: ActivityItem = {
      id: createId('act'),
      templateId: tpl.id,
      title: tpl.name,
      durationMinutes: tpl.suggestedMinutes,
      grouping: tpl.grouping,
      instructions: tpl.steps.join('\n'),
      studentTask: '',
      teacherNote: tpl.teacherNote,
    };
    onChange((prev) => ({
      ...prev,
      activities: [...prev.activities, newItem],
    }));
  };

  const addCustomActivity = () => {
    const newItem: ActivityItem = {
      id: createId('act'),
      templateId: null,
      title: 'Hoạt động mới',
      durationMinutes: 10,
      grouping: 'Cả lớp',
      instructions: '',
      studentTask: '',
      teacherNote: '',
    };
    onChange((prev) => ({
      ...prev,
      activities: [...prev.activities, newItem],
    }));
  };

  const updateActivity = (id: string, patch: Partial<ActivityItem>) => {
    onChange((prev) => ({
      ...prev,
      activities: prev.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  };

  const moveActivity = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pack.activities.length) return;
    onChange((prev) => {
      const next = [...prev.activities];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...prev, activities: next };
    });
  };

  const removeActivity = (id: string) => {
    onChange((prev) => ({
      ...prev,
      activities: prev.activities.filter((a) => a.id !== id),
    }));
  };

  return (
    <section aria-labelledby="step2-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="step2-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Bước 2: Thiết kế hoạt động lớp học (5–15 phút)
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Chọn khung tổ chức từ 8 mẫu sư phạm trung tính theo môn hoặc tự tạo hoạt động, sau đó điền nhiệm vụ cụ thể cho bài dạy.
          </p>
        </div>
        <div
          className={`rounded-lg border px-3.5 py-2 text-sm font-medium whitespace-nowrap shrink-0 ${
            overBudget
              ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
          }`}
        >
          Tổng thời lượng:{' '}
          <span className="font-mono-num font-semibold">
            {totalMinutes} / {pack.duration} phút
          </span>
          {overBudget && <span className="ml-2 text-xs">(Vượt khung tiết)</span>}
        </div>
      </div>

      {/* Thư viện 8 mẫu hoạt động trung tính */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Thư viện 8 mẫu hoạt động trung tính theo môn
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Chỉ gồm khung quy trình 5–15 phút để giáo viên chủ động ghép nội dung môn học của mình.
            </p>
          </div>
          <button
            type="button"
            onClick={addCustomActivity}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tạo hoạt động tự do</span>
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {ACTIVITY_TEMPLATES.map((tpl) => (
            <div
              key={tpl.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{tpl.name}</h4>
                  <span className="font-mono-num text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0">
                    {tpl.suggestedMinutes} phút
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Hình thức: {tpl.grouping}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  {tpl.purpose}
                </p>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  Khung {tpl.minMinutes}–{tpl.maxMinutes} phút
                </span>
                <button
                  type="button"
                  onClick={() => addFromTemplate(tpl)}
                  className="inline-flex items-center gap-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-blue-900 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 hover:border-blue-300 transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Thêm mẫu này</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danh sách hoạt động đã chọn trong tiết dạy */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Chuỗi hoạt động trong tiết dạy (<span className="font-mono-num">{pack.activities.length}</span>)
          </h3>
        </div>

        {errors.activities && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-3 text-sm text-red-800 dark:text-red-200" role="alert">
            {errors.activities}
          </div>
        )}

        {pack.activities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-8 text-center">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Chưa có hoạt động nào trong bộ tiết dạy.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Chọn &ldquo;Thêm mẫu này&rdquo; từ thư viện 8 khung hoạt động phía trên hoặc bấm &ldquo;Tạo hoạt động tự do&rdquo;.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pack.activities.map((act, idx) => (
              <div
                key={act.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Hoạt động <span className="font-mono-num text-slate-900 dark:text-slate-100 font-semibold">#{idx + 1}</span>
                    {act.templateId && (
                      <>
                        <span aria-hidden="true" className="mx-1.5">·</span>
                        <span>Từ khung mẫu</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => moveActivity(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Di chuyển hoạt động ${idx + 1} lên`}
                      className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveActivity(idx, 1)}
                      disabled={idx === pack.activities.length - 1}
                      aria-label={`Di chuyển hoạt động ${idx + 1} xuống`}
                      className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeActivity(act.id)}
                      aria-label={`Xóa hoạt động ${act.title || idx + 1}`}
                      className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-700 dark:hover:text-red-400 hover:border-red-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                  <div className="sm:col-span-6">
                    <label htmlFor={`act-title-${act.id}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Tên hoạt động <span className="text-red-600 dark:text-red-400">*</span>
                    </label>
                    <input
                      id={`act-title-${act.id}`}
                      type="text"
                      value={act.title}
                      onChange={(e) => updateActivity(act.id, { title: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                    />
                    {errors[`activity_${act.id}_title`] && (
                      <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors[`activity_${act.id}_title`]}</p>
                    )}
                  </div>

                  <div className="sm:col-span-3">
                    <label htmlFor={`act-min-${act.id}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Thời lượng (phút)
                    </label>
                    <input
                      id={`act-min-${act.id}`}
                      type="number"
                      min={1}
                      max={45}
                      value={act.durationMinutes}
                      onChange={(e) =>
                        updateActivity(act.id, {
                          durationMinutes: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                    />
                    {errors[`activity_${act.id}_duration`] && (
                      <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors[`activity_${act.id}_duration`]}</p>
                    )}
                  </div>

                  <div className="sm:col-span-3">
                    <label htmlFor={`act-group-${act.id}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Hình thức tổ chức
                    </label>
                    <input
                      id={`act-group-${act.id}`}
                      type="text"
                      value={act.grouping}
                      onChange={(e) => updateActivity(act.id, { grouping: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor={`act-inst-${act.id}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Khung bước tổ chức của giáo viên
                    </label>
                    <textarea
                      id={`act-inst-${act.id}`}
                      rows={4}
                      value={act.instructions}
                      onChange={(e) => updateActivity(act.id, { instructions: e.target.value })}
                      placeholder="Nhập các bước điều phối hoạt động trên lớp..."
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor={`act-task-${act.id}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Nhiệm vụ cụ thể giao cho học sinh (theo bài học)
                    </label>
                    <textarea
                      id={`act-task-${act.id}`}
                      rows={4}
                      value={act.studentTask}
                      onChange={(e) => updateActivity(act.id, { studentTask: e.target.value })}
                      placeholder="Giáo viên tự nhập câu hỏi, ngữ liệu hoặc yêu cầu sản phẩm cụ thể cho môn học..."
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                </div>

                {errors[`activity_${act.id}_body`] && (
                  <p className="text-xs text-red-700 dark:text-red-400">{errors[`activity_${act.id}_body`]}</p>
                )}

                <div>
                  <label htmlFor={`act-note-${act.id}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Lưu ý sư phạm (chỉ in trong Giáo án giáo viên)
                  </label>
                  <input
                    id={`act-note-${act.id}`}
                    type="text"
                    value={act.teacherNote}
                    onChange={(e) => updateActivity(act.id, { teacherNote: e.target.value })}
                    placeholder="Điểm học sinh hay nhầm lẫn, cách hỗ trợ nhanh..."
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import {
  ArrowRight,
  LayoutTemplate,
  ListChecks,
  Sparkles,
  X,
} from 'lucide-react';
import type { LessonPack } from '../../types/lesson';

interface QuickCreateWorkflowModalProps {
  open: boolean;
  packs: LessonPack[];
  onClose: () => void;
  onCreate: (payload: {
    title: string;
    description: string;
    linkedPackId: string;
    initialSteps: string[];
  }) => void;
  onSwitchToTemplates: () => void;
  onSwitchToSmartPlanner: () => void;
}

export function QuickCreateWorkflowModal({
  open,
  packs,
  onClose,
  onCreate,
  onSwitchToTemplates,
  onSwitchToSmartPlanner,
}: QuickCreateWorkflowModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkedPackId, setLinkedPackId] = useState('');
  const [stepsRaw, setStepsRaw] = useState(
    'Xác định mục tiêu và nội dung cần chuẩn bị\nSoạn tài liệu / phiếu học tập\nKiểm tra lại và hoàn tất'
  );

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const initialSteps = stepsRaw
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean);
    onCreate({
      title: cleanTitle,
      description: description.trim(),
      linkedPackId,
      initialSteps,
    });
    setTitle('');
    setDescription('');
    setLinkedPackId('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wf-quick-create-title"
      data-testid="wf-quick-create-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-3 sm:p-5 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-[22px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#635BFF]/10 text-[#635BFF] dark:bg-[#635BFF]/20 dark:text-[#A5B4FC]">
              <ListChecks className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <h2
                id="wf-quick-create-title"
                className="text-base font-bold text-slate-950 dark:text-slate-50"
              >
                Tạo quy trình nhanh
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Nhập tên quy trình và danh sách bước ban đầu · Mở ngay ở chế độ đơn giản
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại tạo nhanh"
            className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="wf-qc-title"
              className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              Tên quy trình *
            </label>
            <input
              id="wf-qc-title"
              type="text"
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Chuẩn bị tiết chuyên đề Toán 8 tuần 12..."
              className="w-full rounded-[11px] border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-950 dark:text-slate-50 focus:border-[#635BFF] focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="wf-qc-desc"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Mô tả ngắn (tùy chọn)
              </label>
              <input
                id="wf-qc-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="VD: Áp dụng cho lớp 8A1 và 8A2"
                className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#635BFF] focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="wf-qc-pack"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Liên kết Bộ tiết dạy (tùy chọn)
              </label>
              <select
                id="wf-qc-pack"
                value={linkedPackId}
                onChange={(e) => setLinkedPackId(e.target.value)}
                className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#635BFF] focus:outline-none"
              >
                <option value="">-- Quy trình độc lập --</option>
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || '(Chưa đặt tên)'} ({p.subject} · {p.grade})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="wf-qc-steps"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Các bước ban đầu (mỗi dòng 1 bước — có thể thêm/sửa sau)
            </label>
            <textarea
              id="wf-qc-steps"
              rows={4}
              value={stepsRaw}
              onChange={(e) => setStepsRaw(e.target.value)}
              className="w-full rounded-[11px] border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 leading-relaxed focus:border-[#635BFF] focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
            />
          </div>

          {/* Alternative quick links */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-400">
            <span>Hoặc thử nhanh:</span>
            <button
              type="button"
              onClick={onSwitchToTemplates}
              className="inline-flex items-center gap-1 font-semibold text-[#5046E5] dark:text-[#A5B4FC] hover:underline"
            >
              <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Dùng 5 mẫu có sẵn</span>
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onSwitchToSmartPlanner}
              className="inline-flex items-center gap-1 font-semibold text-[#5046E5] dark:text-[#A5B4FC] hover:underline"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Lập kế hoạch từ mô tả</span>
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Hủy
            </button>
            <button
              type="submit"
              data-testid="wf-qc-submit-btn"
              disabled={!title.trim()}
              className="aurora-btn-primary inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-xs font-semibold text-white disabled:opacity-45"
            >
              <span>Tạo và bắt đầu</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

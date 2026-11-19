import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckSquare,
  FileSpreadsheet,
  FolderKanban,
  LayoutTemplate,
  ListChecks,
  X,
} from 'lucide-react';
import {
  WORKFLOW_STUDIO_TEMPLATES,
  type WorkflowStudioTemplate,
  type WorkflowTemplateIconKey,
} from '../../data/workflowTemplates';
import { getAppById } from '../../core/appRegistry';

interface WorkflowTemplateModalProps {
  open: boolean;
  onClose: () => void;
  onUseTemplate: (templateId: string, customTitle?: string) => void;
}

function TemplateIcon({
  icon,
  className = 'h-5 w-5',
}: {
  icon: WorkflowTemplateIconKey;
  className?: string;
}) {
  switch (icon) {
    case 'lesson':
      return <BookOpen className={className} aria-hidden="true" />;
    case 'exam':
      return <FileSpreadsheet className={className} aria-hidden="true" />;
    case 'resource':
      return <FolderKanban className={className} aria-hidden="true" />;
    case 'plan':
      return <CalendarDays className={className} aria-hidden="true" />;
    case 'weekly':
      return <ListChecks className={className} aria-hidden="true" />;
  }
}

export function WorkflowTemplateModal({
  open,
  onClose,
  onUseTemplate,
}: WorkflowTemplateModalProps) {
  const [selectedId, setSelectedId] = useState<string>(
    WORKFLOW_STUDIO_TEMPLATES[0].id
  );
  const [customTitle, setCustomTitle] = useState('');

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  const selected: WorkflowStudioTemplate =
    WORKFLOW_STUDIO_TEMPLATES.find((t) => t.id === selectedId) ??
    WORKFLOW_STUDIO_TEMPLATES[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wf-template-modal-title"
      data-testid="wf-template-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-3 sm:p-5 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[22px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 px-5 py-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300">
              <LayoutTemplate className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="wf-template-modal-title"
                className="text-base font-bold text-slate-950 dark:text-slate-50"
              >
                Thư viện mẫu quy trình giáo viên
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Chọn mẫu phù hợp để xem trước từng bước · Tạo thành quy trình mới hoàn toàn chỉnh sửa được (không ghi đè dữ liệu cũ)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thư viện mẫu"
            className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden">
          {/* Template List */}
          <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-2 lg:overflow-y-auto">
            {WORKFLOW_STUDIO_TEMPLATES.map((tpl) => {
              const active = tpl.id === selected.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  data-testid={`wf-tpl-card-${tpl.id}`}
                  onClick={() => {
                    setSelectedId(tpl.id);
                    setCustomTitle('');
                  }}
                  className={`w-full rounded-[14px] border p-3.5 text-left transition-all ${
                    active
                      ? 'border-[#635BFF] bg-[#F3F0FF]/70 dark:bg-[#635BFF]/15'
                      : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        active
                          ? 'bg-[#635BFF] text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <TemplateIcon icon={tpl.icon} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-950 dark:text-slate-50 truncate">
                          {tpl.title}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                          {tpl.steps.length} bước
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                        {tpl.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Template Preview */}
          <div className="lg:col-span-7 flex flex-col min-h-0 bg-slate-50/60 dark:bg-slate-950/40">
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-[#5046E5] dark:text-[#A5B4FC]">
                  Xem trước mẫu · {selected.category} · {selected.steps.length} bước
                </div>
                <h3 className="text-lg font-bold text-slate-950 dark:text-slate-50">
                  {selected.title}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {selected.description}
                </p>
              </div>

              {/* Optional Custom Title */}
              <div className="space-y-1">
                <label
                  htmlFor="wf-tpl-custom-title"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Đặt tên riêng cho quy trình mới (tùy chọn)
                </label>
                <input
                  id="wf-tpl-custom-title"
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={`Mặc định: ${selected.title}`}
                  className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#635BFF] focus:outline-none"
                />
              </div>

              {/* Ordered Preview Steps */}
              <ol className="space-y-2.5">
                {selected.steps.map((step, index) => {
                  const linkedApp = step.suggestedAppId
                    ? getAppById(step.suggestedAppId)
                    : null;
                  return (
                    <li
                      key={index}
                      className="rounded-[14px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300 mt-0.5 tabular-nums">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-950 dark:text-slate-50">
                              {step.title}
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              {step.description}
                            </p>
                          </div>
                        </div>
                      </div>

                      {step.checklist && step.checklist.length > 0 && (
                        <ul className="pl-7 pt-1 space-y-1">
                          {step.checklist.map((item, cIdx) => (
                            <li
                              key={cIdx}
                              className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300"
                            >
                              <CheckSquare
                                className="h-3 w-3 text-slate-400 shrink-0"
                                aria-hidden="true"
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {(linkedApp ||
                        (step.dependsOnIndices &&
                          step.dependsOnIndices.length > 0)) && (
                        <div className="pl-7 pt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {linkedApp && (
                            <span className="font-medium text-[#5046E5] dark:text-[#A5B4FC]">
                              Công cụ: {linkedApp.name}
                            </span>
                          )}
                          {step.dependsOnIndices &&
                            step.dependsOnIndices.length > 0 && (
                              <span>
                                · Sau bước{' '}
                                {step.dependsOnIndices
                                  .map((i) => `#${i + 1}`)
                                  .join(', ')}
                              </span>
                            )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[10px] border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Đóng
              </button>
              <button
                type="button"
                data-testid="wf-use-template-confirm-btn"
                onClick={() => onUseTemplate(selected.id, customTitle || undefined)}
                className="aurora-btn-primary inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap"
              >
                <span>Sử dụng mẫu này</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

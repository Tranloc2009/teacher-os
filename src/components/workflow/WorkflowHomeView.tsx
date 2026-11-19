import { FormEvent, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  GitBranch,
  LayoutTemplate,
  ListChecks,
  Network,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  type UnifiedWorkflowSummary,
  type WorkflowStatusFilter,
  filterUnifiedWorkflows,
} from '../../core/workflowStudioEngine';

interface WorkflowHomeViewProps {
  workflows: UnifiedWorkflowSummary[];
  onOpenEasy: (workflowId: string) => void;
  onOpenCanvas: (workflowId: string) => void;
  onOpenQuickCreate: () => void;
  onOpenTemplates: () => void;
  onOpenSmartPlanner: () => void;
  onOpenNewCanvasDirect: () => void;
  onDuplicateWorkflow: (workflow: UnifiedWorkflowSummary) => void;
  onRenameWorkflow: (workflow: UnifiedWorkflowSummary, nextTitle: string) => void;
  onToggleArchiveWorkflow: (workflow: UnifiedWorkflowSummary) => void;
  onDeleteWorkflow: (workflow: UnifiedWorkflowSummary) => void;
}

function formatDateVi(isoOrDate: string): string {
  if (!isoOrDate) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    const [y, m, d] = isoOrDate.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return '';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec >= 0 && diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin >= 0 && diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours >= 0 && diffHours < 24) return `${diffHours} giờ trước`;
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const FILTER_TABS: Array<{ id: WorkflowStatusFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'active', label: 'Đang làm' },
  { id: 'completed', label: 'Hoàn thành' },
  { id: 'archived', label: 'Đã lưu trữ' },
];

export function WorkflowHomeView({
  workflows,
  onOpenEasy,
  onOpenCanvas,
  onOpenQuickCreate,
  onOpenTemplates,
  onOpenSmartPlanner,
  onOpenNewCanvasDirect,
  onDuplicateWorkflow,
  onRenameWorkflow,
  onToggleArchiveWorkflow,
  onDeleteWorkflow,
}: WorkflowHomeViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkflowStatusFilter>('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const nonArchived = useMemo(
    () => workflows.filter((w) => !w.archived),
    [workflows]
  );

  const continueWorkflow = useMemo(() => {
    const activeIncomplete = nonArchived.find(
      (w) =>
        w.progress.totalSteps === 0 ||
        w.progress.doneSteps < w.progress.totalSteps
    );
    return activeIncomplete ?? nonArchived[0] ?? null;
  }, [nonArchived]);

  const filteredWorkflows = useMemo(
    () => filterUnifiedWorkflows(workflows, searchQuery, statusFilter),
    [workflows, searchQuery, statusFilter]
  );

  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let archived = 0;
    for (const w of workflows) {
      if (w.archived) {
        archived++;
      } else if (
        w.progress.totalSteps > 0 &&
        w.progress.doneSteps === w.progress.totalSteps
      ) {
        completed++;
      } else {
        active++;
      }
    }
    return { all: active + completed, active, completed, archived };
  }, [workflows]);

  const submitRename = (e: FormEvent, wf: UnifiedWorkflowSummary) => {
    e.preventDefault();
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    onRenameWorkflow(wf, trimmed);
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <main
      data-testid="workflow-studio-home"
      className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8 space-y-6"
    >
      {/* 1. Aurora Hero Welcome Header */}
      <section className="aurora-surface-hero rounded-[22px] p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#635BFF] dark:text-[#A5B4FC]">
              <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Workflow Studio 2.0</span>
            </div>
            <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-slate-950 dark:text-slate-50">
              Quy trình làm việc của bạn
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Bắt đầu đơn giản theo từng bước, theo dõi tiến độ thực tế và chuyển sang sơ đồ Canvas bất kỳ lúc nào mà không mất dữ liệu.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              data-testid="wf-open-smart-planner-btn"
              onClick={onOpenSmartPlanner}
              className="inline-flex items-center gap-1.5 rounded-[11px] border border-slate-200/90 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-3.5 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-[#635BFF]/40 hover:text-[#5046E5] dark:hover:text-[#A5B4FC] transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-4 w-4 text-[#635BFF] dark:text-[#A5B4FC]" aria-hidden="true" />
              <span>Lập kế hoạch theo quy tắc</span>
            </button>

            <button
              type="button"
              data-testid="wf-create-new-btn"
              onClick={onOpenQuickCreate}
              className="aurora-btn-primary inline-flex items-center gap-1.5 rounded-[11px] px-4 py-2.5 text-xs font-semibold text-white whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Tạo quy trình mới</span>
            </button>
          </div>
        </div>
      </section>

      {/* 2. Quick Start Section — 3 Clear Choices */}
      <section aria-label="Bắt đầu nhanh" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Bắt đầu nhanh trong 1 chạm
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Chọn cách phù hợp nhất với thói quen của bạn
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {/* Choice 1: Quick Create */}
          <button
            type="button"
            data-testid="wf-quickstart-quick"
            onClick={onOpenQuickCreate}
            className="aurora-quick-card group rounded-[18px] p-5 text-left flex flex-col justify-between gap-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#635BFF]/10 text-[#635BFF] dark:bg-[#635BFF]/20 dark:text-[#A5B4FC]">
                  <ListChecks className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-mono font-semibold text-slate-400 dark:text-slate-500">
                  01
                </span>
              </div>
              <div className="space-y-1">
                <h3 className="text-[15px] font-bold text-slate-950 dark:text-slate-50 group-hover:text-[#5046E5] dark:group-hover:text-[#A5B4FC] transition-colors">
                  Tạo nhanh
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Đặt tên quy trình và thêm từng bước đơn giản như danh sách đầu việc, sẵn sàng đánh dấu hoàn thành ngay.
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-semibold text-[#5046E5] dark:text-[#A5B4FC]">
              <span>Tạo quy trình đơn giản</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </div>
          </button>

          {/* Choice 2: Use Template */}
          <button
            type="button"
            data-testid="wf-quickstart-template"
            onClick={onOpenTemplates}
            className="aurora-quick-card group rounded-[18px] p-5 text-left flex flex-col justify-between gap-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300">
                  <LayoutTemplate className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-mono font-semibold text-slate-400 dark:text-slate-500">
                  02
                </span>
              </div>
              <div className="space-y-1">
                <h3 className="text-[15px] font-bold text-slate-950 dark:text-slate-50 group-hover:text-violet-700 dark:group-hover:text-violet-300 transition-colors">
                  Dùng mẫu có sẵn
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Chọn 1 trong 5 mẫu quy trình giáo viên (Bài giảng, Đề kiểm tra, Tài liệu, Kế hoạch, Công việc tuần) và tùy chỉnh lại.
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
              <span>Xem 5 mẫu quy trình</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </div>
          </button>

          {/* Choice 3: Pro Canvas */}
          <button
            type="button"
            data-testid="wf-quickstart-canvas"
            onClick={onOpenNewCanvasDirect}
            className="aurora-quick-card group rounded-[18px] p-5 text-left flex flex-col justify-between gap-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
                  <Network className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-mono font-semibold text-slate-400 dark:text-slate-500">
                  03
                </span>
              </div>
              <div className="space-y-1">
                <h3 className="text-[15px] font-bold text-slate-950 dark:text-slate-50 group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                  Canvas nâng cao
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Làm việc trực tiếp trên sơ đồ node trực quan để phân nhánh, nối phụ thuộc và liên kết học liệu TeacherOS.
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
              <span>Mở không gian Canvas</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </div>
          </button>
        </div>
      </section>

      {/* 3. Continue Working Section (or Helpful Onboarding Empty State) */}
      <section aria-label="Tiếp tục công việc">
        {continueWorkflow ? (
          <div className="aurora-surface-glass rounded-[18px] p-5 sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-[#5046E5] dark:text-[#A5B4FC]">
                    Tiếp tục công việc
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Cập nhật {formatDateVi(continueWorkflow.updatedAt)}</span>
                  </span>
                  {continueWorkflow.progress.nearestDueDate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 font-medium tabular-nums">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Hạn gần nhất {formatDateVi(continueWorkflow.progress.nearestDueDate)}</span>
                      </span>
                    </>
                  )}
                </div>

                <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50 truncate">
                  {continueWorkflow.title}
                </h2>

                {/* Next Step Hint */}
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {continueWorkflow.progress.nextRecommendation.kind === 'single' ? (
                    <span>
                      Việc tiếp theo:{' '}
                      <strong className="font-semibold text-slate-900 dark:text-slate-100">
                        {continueWorkflow.progress.nextRecommendation.step.title}
                      </strong>
                    </span>
                  ) : continueWorkflow.progress.nextRecommendation.kind === 'multiple' ? (
                    <span>
                      Có{' '}
                      <strong className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {continueWorkflow.progress.nextRecommendation.steps.length} bước
                      </strong>{' '}
                      sẵn sàng thực hiện ngay.
                    </span>
                  ) : continueWorkflow.progress.nextRecommendation.kind === 'completed' &&
                    continueWorkflow.progress.totalSteps > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Tất cả các bước trong quy trình này đã hoàn thành.</span>
                    </span>
                  ) : (
                    <span>Chưa có bước nào — hãy mở để thêm bước đầu tiên.</span>
                  )}
                </div>

                {/* Real Progress Bar */}
                <div className="max-w-xl space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {continueWorkflow.progress.doneSteps}/
                      {continueWorkflow.progress.totalSteps} bước hoàn thành
                    </span>
                    <span className="font-bold text-[#5046E5] dark:text-[#A5B4FC]">
                      {continueWorkflow.progress.percent}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#635BFF] via-[#8B5CF6] to-[#3B82F6] transition-all duration-300"
                      style={{ width: `${continueWorkflow.progress.percent}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid="wf-continue-easy-btn"
                  onClick={() => onOpenEasy(continueWorkflow.id)}
                  className="aurora-btn-primary inline-flex items-center gap-1.5 rounded-[11px] px-4 py-2.5 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                >
                  <span>Tiếp tục làm</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenCanvas(continueWorkflow.id)}
                  className="inline-flex items-center gap-1.5 rounded-[11px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#635BFF]/40 hover:text-[#5046E5] dark:hover:text-[#A5B4FC] whitespace-nowrap shrink-0 transition-colors"
                >
                  <Network className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Mở Canvas</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="aurora-surface-solid rounded-[18px] p-6 sm:p-8 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#635BFF]/10 text-[#635BFF] dark:bg-[#635BFF]/20 dark:text-[#A5B4FC]">
              <ListChecks className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="max-w-lg mx-auto space-y-1.5">
              <h2 className="text-base font-bold text-slate-950 dark:text-slate-50">
                Chưa có quy trình nào đang hoạt động
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Chỉ cần 3 bước: Chọn mẫu hoặc tạo nhanh → Đánh dấu hoàn thành từng việc mỗi ngày → Mở trực tiếp Lesson Studio, Exam Mixer Pro hay Resource Vault ngay trong từng bước.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={onOpenTemplates}
                className="aurora-btn-primary inline-flex items-center gap-1.5 rounded-[11px] px-4 py-2 text-xs font-semibold text-white"
              >
                <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
                <span>Chọn mẫu giáo viên</span>
              </button>
              <button
                type="button"
                onClick={onOpenQuickCreate}
                className="inline-flex items-center gap-1.5 rounded-[11px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Tạo quy trình trống</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 4. My Workflows Section */}
      <section
        aria-label="Quy trình của tôi"
        className="aurora-surface-solid rounded-[18px] overflow-hidden"
      >
        <div className="flex flex-col gap-3 border-b border-slate-200/80 dark:border-slate-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-0.5">
            <h2 className="text-base font-bold text-slate-950 dark:text-slate-50">
              Quy trình của tôi
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {counts.active} đang làm · {counts.completed} đã hoàn thành
              {counts.archived > 0 ? ` · ${counts.archived} lưu trữ` : ''}
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên quy trình hoặc bước..."
                aria-label="Tìm quy trình"
                className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 pl-9 pr-7 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#635BFF] focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Xóa từ khóa tìm kiếm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Segmented Status Filter */}
            <div
              role="tablist"
              aria-label="Lọc trạng thái quy trình"
              className="inline-flex items-center rounded-[10px] bg-slate-100/90 dark:bg-slate-800/90 p-0.5 overflow-x-auto max-w-full"
            >
              {FILTER_TABS.map((tab) => {
                const active = statusFilter === tab.id;
                const tabCount = counts[tab.id];
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setStatusFilter(tab.id)}
                    className={`rounded-[8px] px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                      active
                        ? 'bg-white dark:bg-slate-900 text-slate-950 dark:text-slate-50 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label} ({tabCount})
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Workflow List */}
        {filteredWorkflows.length === 0 ? (
          <div className="px-5 py-12 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {searchQuery.trim()
                ? 'Không tìm thấy quy trình phù hợp với từ khóa.'
                : statusFilter === 'archived'
                ? 'Chưa có quy trình nào được lưu trữ.'
                : statusFilter === 'completed'
                ? 'Chưa có quy trình nào hoàn thành 100%.'
                : 'Chưa có quy trình nào trong mục này.'}
            </p>
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs font-semibold text-[#5046E5] dark:text-[#A5B4FC] hover:underline"
              >
                Xóa bộ lọc tìm kiếm
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/90">
            {filteredWorkflows.map((wf) => {
              const isCompleted =
                wf.progress.totalSteps > 0 &&
                wf.progress.doneSteps === wf.progress.totalSteps;
              const isRenaming = renamingId === wf.id;
              const isConfirmingDelete = confirmDeleteId === wf.id;

              return (
                <li
                  key={wf.id}
                  data-testid={`wf-list-item-${wf.id}`}
                  className="px-5 py-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/35 transition-colors"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {isRenaming ? (
                        <form
                          onSubmit={(e) => submitRename(e, wf)}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input
                            type="text"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            autoFocus
                            aria-label="Tên quy trình mới"
                            className="flex-1 min-w-[200px] rounded-lg border border-[#635BFF] bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-semibold text-slate-950 dark:text-slate-50 focus:outline-none"
                          />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 rounded-lg bg-[#635BFF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5046E5]"
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Lưu</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
                          >
                            Hủy
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => onOpenEasy(wf.id)}
                            className="text-left text-[15px] font-bold text-slate-950 dark:text-slate-50 hover:text-[#5046E5] dark:hover:text-[#A5B4FC] truncate transition-colors"
                          >
                            {wf.title}
                          </button>
                          {isCompleted && (
                            <CheckCircle2
                              className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                              aria-label="Đã hoàn thành"
                            />
                          )}
                        </div>
                      )}

                      {/* Clean inline metadata (zero pill clutter) */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {wf.progress.doneSteps}/{wf.progress.totalSteps} bước ({wf.progress.percent}%)
                        </span>
                        {wf.progress.blockedSteps > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 dark:text-amber-400">
                              {wf.progress.blockedSteps} bước chờ phụ thuộc
                            </span>
                          </>
                        )}
                        {wf.progress.nearestDueDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Hạn {formatDateVi(wf.progress.nearestDueDate)}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>Cập nhật {formatDateVi(wf.updatedAt)}</span>
                      </div>

                      {/* Compact Progress Bar */}
                      <div className="max-w-md pt-0.5">
                        <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isCompleted
                                ? 'bg-emerald-500'
                                : 'bg-gradient-to-r from-[#635BFF] to-[#3B82F6]'
                            }`}
                            style={{ width: `${wf.progress.percent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Row Actions */}
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {isConfirmingDelete ? (
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/90 dark:bg-red-950/50 px-2.5 py-1 text-xs">
                          <span className="font-medium text-red-800 dark:text-red-200">
                            Xóa quy trình này?
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(null);
                              onDeleteWorkflow(wf);
                            }}
                            className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-700"
                          >
                            Xác nhận
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-md px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpenEasy(wf.id)}
                            className="rounded-[9px] bg-[#635BFF]/10 dark:bg-[#635BFF]/20 px-3 py-1.5 text-xs font-semibold text-[#5046E5] dark:text-[#A5B4FC] hover:bg-[#635BFF] hover:text-white transition-colors whitespace-nowrap"
                          >
                            Mở
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenCanvas(wf.id)}
                            title="Mở trong Canvas nâng cao"
                            className="rounded-[9px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-[#635BFF]/40 hover:text-[#5046E5] dark:hover:text-[#A5B4FC] transition-colors whitespace-nowrap"
                          >
                            Canvas
                          </button>
                          <button
                            type="button"
                            onClick={() => onDuplicateWorkflow(wf)}
                            title="Nhân bản quy trình"
                            aria-label={`Nhân bản ${wf.title}`}
                            className="rounded-[9px] border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(wf.id);
                              setRenameDraft(wf.title);
                            }}
                            title="Đổi tên quy trình"
                            aria-label={`Đổi tên ${wf.title}`}
                            className="rounded-[9px] border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleArchiveWorkflow(wf)}
                            title={wf.archived ? 'Khôi phục khỏi lưu trữ' : 'Lưu trữ quy trình'}
                            aria-label={
                              wf.archived
                                ? `Khôi phục ${wf.title}`
                                : `Lưu trữ ${wf.title}`
                            }
                            className="rounded-[9px] border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                          >
                            {wf.archived ? (
                              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(wf.id)}
                            title="Xóa quy trình"
                            aria-label={`Xóa ${wf.title}`}
                            className="rounded-[9px] border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-800 dark:hover:bg-red-950/50 dark:hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

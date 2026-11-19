import { FormEvent, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  FileText,
  GitBranch,
  Info,
  ListChecks,
  Lock,
  Network,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { APP_REGISTRY, type AppId, getAppById } from '../../core/appRegistry';
import type {
  UnifiedWorkflowStep,
  WorkflowStudioProgress,
} from '../../core/workflowStudioEngine';
import {
  CANVAS_PRIORITY_META,
  CANVAS_STATUS_META,
  type CanvasBoard,
  type CanvasChecklistItem,
  type CanvasEdgeRecord,
  type CanvasNodeRecord,
  type CanvasPriority,
  type CanvasTaskStatus,
} from '../../types/canvas';
import type { LessonPack, ResourceItem } from '../../types/lesson';

interface EasyWorkflowEditorProps {
  board: CanvasBoard;
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  progress: WorkflowStudioProgress;
  packs: LessonPack[];
  resources: ResourceItem[];
  onBackHome: () => void;
  onSwitchToCanvas: () => void;
  onUpdateBoardMeta: (patch: Partial<CanvasBoard>) => void;
  onAddStep: (title: string) => void;
  onToggleStepDone: (stepId: string) => void;
  onUpdateStepNode: (nodeId: string, patch: Partial<CanvasNodeRecord>) => void;
  onReorderStep: (stepId: string, direction: 'up' | 'down') => void;
  onDuplicateStep: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onAddDependency: (prerequisiteId: string, stepId: string) => void;
  onRemoveDependency: (prerequisiteId: string, stepId: string) => void;
  onNavigateApp: (appId: AppId, linkedPackId?: string) => void;
}

const TEACHER_TOOL_IDS: AppId[] = [
  'lesson-studio',
  'math-mixer',
  'resource-vault',
  'print-studio',
  'teaching-journal',
];

function formatDueVi(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function EasyWorkflowEditor({
  board,
  nodes,
  edges,
  progress,
  packs,
  resources,
  onBackHome,
  onSwitchToCanvas,
  onUpdateBoardMeta,
  onAddStep,
  onToggleStepDone,
  onUpdateStepNode,
  onReorderStep,
  onDuplicateStep,
  onDeleteStep,
  onAddDependency,
  onRemoveDependency,
  onNavigateApp,
}: EasyWorkflowEditorProps) {
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [newStepTitle, setNewStepTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(board.title);
  const [confirmDeleteStepId, setConfirmDeleteStepId] = useState<string | null>(
    null
  );
  const [checklistInputByStep, setChecklistInputByStep] = useState<
    Record<string, string>
  >({});
  const [depSelectByStep, setDepSelectByStep] = useState<
    Record<string, string>
  >({});

  const teacherTools = APP_REGISTRY.filter((app) =>
    TEACHER_TOOL_IDS.includes(app.id)
  );

  const handleCreateStep = (e: FormEvent) => {
    e.preventDefault();
    const clean = newStepTitle.trim();
    if (!clean) return;
    onAddStep(clean);
    setNewStepTitle('');
  };

  const handleSaveBoardTitle = (e: FormEvent) => {
    e.preventDefault();
    const clean = titleDraft.trim();
    if (!clean) return;
    onUpdateBoardMeta({ title: clean });
    setEditingTitle(false);
  };

  const stepById = new Map(progress.orderedSteps.map((s) => [s.id, s]));

  const needsDeleteConfirmation = (step: UnifiedWorkflowStep): boolean => {
    return (
      step.checklist.length > 0 ||
      step.notes.trim().length > 0 ||
      step.description.trim().length > 0 ||
      step.dependsOnIds.length > 0 ||
      step.unlocksTitles.length > 0
    );
  };

  const handleAddChecklist = (step: UnifiedWorkflowStep) => {
    const label = (checklistInputByStep[step.id] ?? '').trim();
    if (!label) return;
    const nextList: CanvasChecklistItem[] = [
      ...step.checklist,
      { id: `chk-${Date.now().toString(36)}`, label, done: false },
    ];
    onUpdateStepNode(step.id, { checklist: nextList });
    setChecklistInputByStep((prev) => ({ ...prev, [step.id]: '' }));
  };

  const handleToggleChecklist = (
    step: UnifiedWorkflowStep,
    itemId: string
  ) => {
    const nextList = step.checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );
    const doneCount = nextList.filter((i) => i.done).length;
    const patch: Partial<CanvasNodeRecord> = { checklist: nextList };
    if (step.type === 'checklist' && step.status !== 'blocked') {
      if (doneCount === nextList.length && !step.isDependencyBlocked) {
        patch.status = 'done';
      } else if (doneCount > 0) {
        patch.status = 'in_progress';
      } else {
        patch.status = 'todo';
      }
    }
    onUpdateStepNode(step.id, patch);
  };

  const handleRemoveChecklist = (
    step: UnifiedWorkflowStep,
    itemId: string
  ) => {
    const nextList = step.checklist.filter((item) => item.id !== itemId);
    onUpdateStepNode(step.id, { checklist: nextList });
  };

  const scrollToStep = (stepId: string) => {
    setExpandedStepId(stepId);
    const el = document.getElementById(`easy-step-${stepId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const linkedPack = packs.find((p) => p.id === board.linkedPackId);

  return (
    <div
      data-testid="wf-easy-editor"
      className="mx-auto max-w-[1160px] px-4 py-5 sm:px-6 lg:px-8 space-y-5"
    >
      {/* Top Studio Bar: Back + Title + Mode Switch */}
      <header className="aurora-surface-glass rounded-[18px] px-4 py-3.5 sm:px-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            data-testid="wf-back-home-btn"
            onClick={onBackHome}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#635BFF]/40 hover:text-[#5046E5] dark:hover:text-[#A5B4FC] whitespace-nowrap shrink-0 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Quy trình</span>
          </button>

          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <form
                onSubmit={handleSaveBoardTitle}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  autoFocus
                  aria-label="Tên quy trình"
                  className="flex-1 min-w-0 rounded-lg border border-[#635BFF] bg-white dark:bg-slate-900 px-2.5 py-1 text-sm font-bold text-slate-950 dark:text-slate-50 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-[#635BFF] p-1.5 text-white hover:bg-[#5046E5]"
                  aria-label="Lưu tên quy trình"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTitle(false);
                    setTitleDraft(board.title);
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500"
                  aria-label="Hủy đổi tên"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </form>
            ) : (
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(board.title);
                    setEditingTitle(true);
                  }}
                  title="Bấm để đổi tên quy trình"
                  className="text-left text-base sm:text-lg font-bold text-slate-950 dark:text-slate-50 hover:text-[#5046E5] dark:hover:text-[#A5B4FC] truncate block max-w-full transition-colors"
                >
                  {board.title}
                </button>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{nodes.length} khối dữ liệu</span>
                  <span>·</span>
                  <span>{edges.length} liên kết</span>
                  {linkedPack && (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() =>
                          onNavigateApp('lesson-studio', linkedPack.id)
                        }
                        className="font-medium text-[#5046E5] dark:text-[#A5B4FC] hover:underline truncate max-w-[260px]"
                      >
                        Bài dạy: {linkedPack.title}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mode Segmented Switch: Easy Workflow (Active) | Pro Canvas */}
        <div
          role="tablist"
          aria-label="Chế độ làm việc Workflow Studio"
          className="inline-flex items-center rounded-[11px] bg-slate-100/90 dark:bg-slate-800/90 p-1 shrink-0 self-start lg:self-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={true}
            data-testid="wf-mode-easy-tab"
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-950 dark:text-slate-50 shadow-2xs whitespace-nowrap"
          >
            <ListChecks className="h-3.5 w-3.5 text-[#635BFF] dark:text-[#A5B4FC]" aria-hidden="true" />
            <span>Chế độ đơn giản</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={false}
            data-testid="wf-mode-canvas-tab"
            onClick={onSwitchToCanvas}
            className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-slate-50 whitespace-nowrap transition-colors"
          >
            <Network className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Canvas nâng cao</span>
          </button>
        </div>
      </header>

      {/* Progress Overview + Next Step Bento Grid */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Real Progress Card */}
        <div className="lg:col-span-7 aurora-surface-solid rounded-[18px] p-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Tiến độ thực tế
              </h2>
              <div
                data-testid="wf-progress-headline"
                className="mt-1 text-lg sm:text-xl font-bold text-slate-950 dark:text-slate-50 tabular-nums"
              >
                {progress.doneSteps}/{progress.totalSteps} bước hoàn thành —{' '}
                <span className="text-[#5046E5] dark:text-[#A5B4FC]">
                  {progress.percent}%
                </span>
              </div>
            </div>

            {progress.nearestDueDate && (
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 tabular-nums">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Hạn gần nhất: {formatDueVi(progress.nearestDueDate)}</span>
              </div>
            )}
          </div>

          <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                progress.totalSteps > 0 &&
                progress.doneSteps === progress.totalSteps
                  ? 'bg-emerald-500'
                  : 'bg-gradient-to-r from-[#635BFF] via-[#8B5CF6] to-[#3B82F6]'
              }`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800 tabular-nums">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Tổng bước
              </div>
              <div className="text-base font-bold text-slate-950 dark:text-slate-50">
                {progress.totalSteps}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Đã hoàn thành
              </div>
              <div className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                {progress.doneSteps}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Còn lại
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                {progress.remainingSteps}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Đang chờ / Bị chặn
              </div>
              <div
                className={`text-base font-bold ${
                  progress.blockedSteps > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {progress.blockedSteps}
              </div>
            </div>
          </div>
        </div>

        {/* Next Step Panel ("Việc cần làm tiếp theo") */}
        <div
          data-testid="wf-next-step-panel"
          className="lg:col-span-5 aurora-surface-hero rounded-[18px] p-5 flex flex-col justify-between gap-3"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#5046E5] dark:text-[#A5B4FC]">
                Việc cần làm tiếp theo
              </h2>
              {progress.nextRecommendation.kind === 'completed' &&
                progress.totalSteps > 0 && (
                  <CheckCircle2
                    className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                )}
            </div>

            {progress.totalSteps === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Quy trình chưa có bước nào. Hãy thêm bước đầu tiên ở khung bên dưới để bắt đầu theo dõi.
              </p>
            ) : progress.nextRecommendation.kind === 'completed' ? (
              <div className="space-y-1">
                <div className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                  Quy trình đã hoàn thành 100%
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Bạn đã hoàn tất tất cả {progress.totalSteps} bước trong quy trình này.
                </p>
              </div>
            ) : progress.nextRecommendation.kind === 'single' ? (() => {
              const rec = progress.nextRecommendation;
              return (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => scrollToStep(rec.step.id)}
                    className="text-left text-sm font-bold text-slate-950 dark:text-slate-50 hover:text-[#5046E5] dark:hover:text-[#A5B4FC] transition-colors line-clamp-2"
                  >
                    {rec.step.title}
                  </button>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {rec.reason}
                  </p>
                </div>
              );
            })() : progress.nextRecommendation.kind === 'multiple' ? (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                  {progress.nextRecommendation.reason}
                </p>
                <ul className="space-y-1 pt-0.5">
                  {progress.nextRecommendation.steps.slice(0, 3).map((step) => (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => scrollToStep(step.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-[#5046E5] dark:hover:text-[#A5B4FC] text-left"
                      >
                        <ArrowRight className="h-3 w-3 shrink-0 text-[#635BFF]" aria-hidden="true" />
                        <span className="line-clamp-1">{step.title}</span>
                      </button>
                    </li>
                  ))}
                  {progress.nextRecommendation.steps.length > 3 && (
                    <li className="text-[11px] text-slate-500 dark:text-slate-400 pl-4">
                      +{progress.nextRecommendation.steps.length - 3} bước sẵn sàng khác
                    </li>
                  )}
                </ul>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Các bước còn lại đang bị chặn</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {progress.nextRecommendation.reason}
                </p>
              </div>
            )}
          </div>

          {progress.nextRecommendation.kind === 'single' && (() => {
            const singleStep = progress.nextRecommendation.step;
            const suggestedAppId = singleStep.suggestedAppId;
            return (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onToggleStepDone(singleStep.id)}
                  className="aurora-btn-primary inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Đánh dấu xong</span>
                </button>
                {suggestedAppId && (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigateApp(
                        suggestedAppId,
                        board.linkedPackId || undefined
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-[10px] border border-slate-200/90 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-[#635BFF]/50 whitespace-nowrap"
                  >
                    <span>Mở {getAppById(suggestedAppId).shortName}</span>
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </section>

      {/* Complex Graph Preservation Banner (only shown when Canvas has branches/references/notes) */}
      {progress.complexity.isComplex && (
        <div
          data-testid="wf-complex-graph-notice"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-indigo-200/80 dark:border-indigo-900/70 bg-indigo-50/60 dark:bg-indigo-950/30 px-4 py-3 text-xs"
        >
          <div className="flex items-start gap-2.5 text-slate-800 dark:text-slate-200 min-w-0 flex-1">
            <Info
              className="h-4 w-4 text-[#635BFF] dark:text-[#A5B4FC] shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="leading-relaxed">
              <span className="font-semibold">
                Quy trình có cấu trúc nhánh nâng cao trên Canvas
              </span>{' '}
              ({progress.complexity.reasons.join(', ')}). Mọi chỉnh sửa ở chế độ đơn giản đều giữ nguyên tọa độ, nhánh và liên kết trên Canvas.
            </div>
          </div>
          <button
            type="button"
            onClick={onSwitchToCanvas}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-[#5046E5] dark:text-[#A5B4FC] hover:bg-indigo-50 dark:hover:bg-indigo-950/60 whitespace-nowrap shrink-0"
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Xem sơ đồ Canvas</span>
          </button>
        </div>
      )}

      {/* Main Step-by-Step Checklist Container */}
      <section
        aria-label="Danh sách các bước thực hiện"
        className="aurora-surface-solid rounded-[18px] overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50">
              Các bước thực hiện
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Đánh dấu hoàn thành từng bước hoặc bấm vào bước để chỉnh chi tiết, hạn, phụ thuộc và tài liệu liên kết.
            </p>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <select
              aria-label="Gắn Bộ tiết dạy cho quy trình"
              value={board.linkedPackId ?? ''}
              onChange={(e) =>
                onUpdateBoardMeta({ linkedPackId: e.target.value })
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 max-w-[240px]"
            >
              <option value="">Không gắn bộ tiết dạy riêng</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  Bài dạy: {p.title || '(Chưa đặt tên)'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Ordered Steps */}
        {progress.orderedSteps.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            Chưa có bước nào trong quy trình. Nhập tên bước đầu tiên bên dưới để bắt đầu.
          </div>
        ) : (
          <ol className="divide-y divide-slate-100 dark:divide-slate-800/90">
            {progress.orderedSteps.map((step, idx) => {
              const isDone = step.status === 'done';
              const isExpanded = expandedStepId === step.id;
              const isConfirmingDelete = confirmDeleteStepId === step.id;
              const linkedApp = step.suggestedAppId
                ? getAppById(step.suggestedAppId)
                : null;
              const linkedResource = step.linkedResourceId
                ? resources.find((r) => r.id === step.linkedResourceId)
                : null;
              const chkDone = step.checklist.filter((c) => c.done).length;
              const chkTotal = step.checklist.length;
              const priorityInfo = CANVAS_PRIORITY_META[step.priority];
              const statusInfo = CANVAS_STATUS_META[step.status];

              const availablePrerequisites = progress.orderedSteps.filter(
                (cand) =>
                  cand.id !== step.id && !step.dependsOnIds.includes(cand.id)
              );

              return (
                <li
                  key={step.id}
                  id={`easy-step-${step.id}`}
                  data-testid={`easy-step-row-${idx}`}
                  className={`transition-colors ${
                    isExpanded
                      ? 'bg-slate-50/60 dark:bg-slate-800/30'
                      : 'hover:bg-slate-50/40 dark:hover:bg-slate-800/20'
                  }`}
                >
                  {/* Step Primary Row */}
                  <div className="px-4 sm:px-5 py-3.5 flex items-start gap-3">
                    {/* Checkbox / Blocked Guard */}
                    <button
                      type="button"
                      data-testid={`easy-step-toggle-${idx}`}
                      onClick={() => onToggleStepDone(step.id)}
                      title={
                        step.isDependencyBlocked
                          ? `Đang chờ bước trước hoàn thành: ${step.blockedByTitles.join(', ')}`
                          : isDone
                          ? 'Bỏ đánh dấu hoàn thành'
                          : 'Đánh dấu hoàn thành bước này'
                      }
                      aria-label={
                        step.isDependencyBlocked
                          ? `Bước đang bị chặn bởi ${step.blockedByTitles.join(', ')}`
                          : isDone
                          ? `Đánh dấu chưa xong: ${step.title}`
                          : `Đánh dấu hoàn thành: ${step.title}`
                      }
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
                        step.isDependencyBlocked
                          ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700'
                          : isDone
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400 hover:text-[#635BFF] dark:hover:text-[#A5B4FC]'
                      }`}
                    >
                      {step.isDependencyBlocked ? (
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : isDone ? (
                        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Circle className="h-5 w-5" aria-hidden="true" />
                      )}
                    </button>

                    {/* Main Title + Clean Inline Metadata */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedStepId(isExpanded ? null : step.id)
                          }
                          className="text-left min-w-0 flex-1"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="text-[11px] font-mono font-semibold text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span
                              className={`text-sm font-semibold leading-snug ${
                                isDone
                                  ? 'line-through text-slate-400 dark:text-slate-500'
                                  : 'text-slate-950 dark:text-slate-50'
                              }`}
                            >
                              {step.title}
                            </span>
                          </div>
                        </button>
                      </div>

                      {step.description && !isExpanded && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 pl-6">
                          {step.description}
                        </p>
                      )}

                      {/* Clean Inline Metadata Row (Zero Pill Overload) */}
                      <div className="pl-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {statusInfo.label}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={priorityInfo.textClass}>
                          Ưu tiên {priorityInfo.label.toLowerCase()}
                        </span>
                        {step.dueDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" aria-hidden="true" />
                              {formatDueVi(step.dueDate)}
                            </span>
                          </>
                        )}
                        {chkTotal > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              Mục con {chkDone}/{chkTotal}
                            </span>
                          </>
                        )}
                        {linkedResource && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 max-w-[200px] truncate">
                              <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{linkedResource.title}</span>
                            </span>
                          </>
                        )}
                        {step.isDependencyBlocked && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span>
                                Chờ: {step.blockedByTitles.join(', ')}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Step Quick Actions */}
                    <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                      {linkedApp && (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigateApp(
                              linkedApp.id,
                              board.linkedPackId || undefined
                            )
                          }
                          title={`Mở ${linkedApp.name}`}
                          className="inline-flex items-center gap-1 rounded-[8px] bg-[#635BFF]/10 dark:bg-[#635BFF]/20 px-2.5 py-1 text-[11px] font-semibold text-[#5046E5] dark:text-[#A5B4FC] hover:bg-[#635BFF] hover:text-white transition-colors whitespace-nowrap"
                        >
                          <span>{linkedApp.shortName}</span>
                          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onReorderStep(step.id, 'up')}
                        aria-label="Đưa bước lên trên"
                        title="Di chuyển lên"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        disabled={idx === progress.orderedSteps.length - 1}
                        onClick={() => onReorderStep(step.id, 'down')}
                        aria-label="Đưa bước xuống dưới"
                        title="Di chuyển xuống"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onDuplicateStep(step.id)}
                        aria-label="Nhân bản bước"
                        title="Nhân bản bước"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedStepId(isExpanded ? null : step.id)
                        }
                        aria-expanded={isExpanded}
                        aria-label={
                          isExpanded ? 'Thu gọn chi tiết bước' : 'Mở chi tiết bước'
                        }
                        title="Chỉnh sửa chi tiết"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (needsDeleteConfirmation(step)) {
                            setConfirmDeleteStepId(step.id);
                          } else {
                            onDeleteStep(step.id);
                          }
                        }}
                        aria-label={`Xóa bước ${step.title}`}
                        title="Xóa bước"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Inline Delete Confirmation */}
                  {isConfirmingDelete && (
                    <div className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/90 dark:bg-red-950/40 px-3.5 py-2 text-xs">
                      <span className="font-medium text-red-800 dark:text-red-200">
                        Bước này có chi tiết / phụ thuộc kèm theo. Xác nhận xóa?
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteStepId(null);
                            onDeleteStep(step.id);
                          }}
                          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                        >
                          Xác nhận xóa
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteStepId(null)}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-200"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expanded Step Detail Editor */}
                  {isExpanded && (
                    <div className="px-4 sm:px-11 pb-5 pt-2 space-y-4 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                      {/* Title & Description */}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2 space-y-1">
                          <label className="block font-semibold text-slate-700 dark:text-slate-300">
                            Tên bước
                          </label>
                          <input
                            type="text"
                            value={step.title}
                            onChange={(e) =>
                              onUpdateStepNode(step.id, {
                                title: e.target.value,
                              })
                            }
                            className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-950 dark:text-slate-50 focus:border-[#635BFF] focus:outline-none"
                          />
                        </div>

                        <div className="sm:col-span-2 space-y-1">
                          <label className="block font-semibold text-slate-700 dark:text-slate-300">
                            Mô tả công việc
                          </label>
                          <textarea
                            rows={2}
                            value={step.description}
                            onChange={(e) =>
                              onUpdateStepNode(step.id, {
                                description: e.target.value,
                              })
                            }
                            placeholder="Ghi ngắn gọn mục tiêu hoặc đầu ra cần đạt của bước này..."
                            className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#635BFF] focus:outline-none"
                          />
                        </div>

                        {/* Status, Priority, Due Date */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:col-span-2">
                          <div className="space-y-1">
                            <label className="block font-semibold text-slate-700 dark:text-slate-300">
                              Trạng thái
                            </label>
                            <select
                              value={step.status}
                              onChange={(e) => {
                                const nextSt = e.target
                                  .value as CanvasTaskStatus;
                                if (
                                  nextSt === 'done' &&
                                  step.isDependencyBlocked
                                ) {
                                  onToggleStepDone(step.id);
                                  return;
                                }
                                onUpdateStepNode(step.id, { status: nextSt });
                              }}
                              className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            >
                              {(
                                Object.keys(
                                  CANVAS_STATUS_META
                                ) as CanvasTaskStatus[]
                              ).map((st) => (
                                <option key={st} value={st}>
                                  {CANVAS_STATUS_META[st].label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="block font-semibold text-slate-700 dark:text-slate-300">
                              Mức ưu tiên
                            </label>
                            <select
                              value={step.priority}
                              onChange={(e) =>
                                onUpdateStepNode(step.id, {
                                  priority: e.target.value as CanvasPriority,
                                })
                              }
                              className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            >
                              {(
                                Object.keys(
                                  CANVAS_PRIORITY_META
                                ) as CanvasPriority[]
                              ).map((p) => (
                                <option key={p} value={p}>
                                  {CANVAS_PRIORITY_META[p].label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="block font-semibold text-slate-700 dark:text-slate-300">
                              Hạn hoàn thành
                            </label>
                            <input
                              type="date"
                              value={step.dueDate ?? ''}
                              onChange={(e) =>
                                onUpdateStepNode(step.id, {
                                  dueDate: e.target.value || undefined,
                                })
                              }
                              className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        </div>

                        {/* Linked TeacherOS Tool + Linked Resource */}
                        <div className="space-y-1">
                          <label className="block font-semibold text-slate-700 dark:text-slate-300">
                            Công cụ TeacherOS liên quan
                          </label>
                          <select
                            value={step.suggestedAppId ?? ''}
                            onChange={(e) =>
                              onUpdateStepNode(step.id, {
                                suggestedAppId: e.target.value
                                  ? (e.target.value as AppId)
                                  : undefined,
                              })
                            }
                            className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                          >
                            <option value="">-- Không gắn công cụ --</option>
                            {teacherTools.map((app) => (
                              <option key={app.id} value={app.id}>
                                {app.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="block font-semibold text-slate-700 dark:text-slate-300">
                            Tài liệu đính kèm (Resource Vault)
                          </label>
                          <div className="flex items-center gap-1.5">
                            <select
                              value={step.linkedResourceId ?? ''}
                              onChange={(e) =>
                                onUpdateStepNode(step.id, {
                                  linkedResourceId: e.target.value || undefined,
                                })
                              }
                              className="flex-1 min-w-0 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            >
                              <option value="">-- Chưa chọn tài liệu --</option>
                              {resources.map((res) => (
                                <option key={res.id} value={res.id}>
                                  {res.title} ({res.subject})
                                </option>
                              ))}
                            </select>
                            {linkedResource && (
                              <button
                                type="button"
                                onClick={() => onNavigateApp('resource-vault')}
                                title="Mở Resource Vault"
                                className="rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 shrink-0"
                              >
                                Mở kho
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Sub-checklist */}
                      <div className="space-y-2 border-t border-slate-200/70 dark:border-slate-800 pt-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          Checklist nhỏ trong bước ({chkDone}/{chkTotal})
                        </div>
                        {step.checklist.length > 0 && (
                          <ul className="space-y-1.5">
                            {step.checklist.map((item) => (
                              <li
                                key={item.id}
                                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleToggleChecklist(step, item.id)
                                  }
                                  className="flex items-center gap-2 text-left flex-1 min-w-0"
                                >
                                  {item.done ? (
                                    <CheckSquare
                                      className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Square
                                      className="h-3.5 w-3.5 text-slate-400 shrink-0"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span
                                    className={
                                      item.done
                                        ? 'line-through text-slate-400 dark:text-slate-500'
                                        : 'text-slate-800 dark:text-slate-200'
                                    }
                                  >
                                    {item.label}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRemoveChecklist(step, item.id)
                                  }
                                  aria-label="Xóa mục nhỏ"
                                  className="text-slate-400 hover:text-red-600 p-0.5"
                                >
                                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={checklistInputByStep[step.id] ?? ''}
                            onChange={(e) =>
                              setChecklistInputByStep((prev) => ({
                                ...prev,
                                [step.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddChecklist(step);
                              }
                            }}
                            placeholder="Thêm mục kiểm tra nhỏ và nhấn Enter..."
                            className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs focus:border-[#635BFF] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddChecklist(step)}
                            className="rounded-lg bg-slate-900 dark:bg-[#635BFF] px-3 py-1.5 text-xs font-semibold text-white shrink-0"
                          >
                            Thêm
                          </button>
                        </div>
                      </div>

                      {/* Dependencies Management (DAG safe) */}
                      <div className="space-y-2 border-t border-slate-200/70 dark:border-slate-800 pt-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          Bước tiên quyết (phải hoàn thành trước bước này)
                        </div>
                        {step.dependsOnIds.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {step.dependsOnIds.map((depId) => {
                              const depStep = stepById.get(depId);
                              return (
                                <span
                                  key={depId}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] text-slate-700 dark:text-slate-200"
                                >
                                  <span className="truncate max-w-[220px]">
                                    {depStep?.title ?? depId}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onRemoveDependency(depId, step.id)
                                    }
                                    aria-label="Gỡ phụ thuộc"
                                    className="text-slate-400 hover:text-red-600"
                                  >
                                    <X className="h-3 w-3" aria-hidden="true" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {availablePrerequisites.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={depSelectByStep[step.id] ?? ''}
                              onChange={(e) =>
                                setDepSelectByStep((prev) => ({
                                  ...prev,
                                  [step.id]: e.target.value,
                                }))
                              }
                              aria-label="Chọn bước tiên quyết"
                              className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                            >
                              <option value="">
                                + Thêm điều kiện phải làm xong trước...
                              </option>
                              {availablePrerequisites.map((cand) => (
                                <option key={cand.id} value={cand.id}>
                                  {cand.title}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!depSelectByStep[step.id]}
                              onClick={() => {
                                const prereqId = depSelectByStep[step.id];
                                if (!prereqId) return;
                                onAddDependency(prereqId, step.id);
                                setDepSelectByStep((prev) => ({
                                  ...prev,
                                  [step.id]: '',
                                }));
                              }}
                              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#635BFF] disabled:opacity-40 shrink-0"
                            >
                              Gắn
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Notes */}
                      <div className="space-y-1 border-t border-slate-200/70 dark:border-slate-800 pt-3">
                        <label className="block font-semibold text-slate-700 dark:text-slate-300">
                          Ghi chú cá nhân
                        </label>
                        <textarea
                          rows={2}
                          value={step.notes}
                          onChange={(e) =>
                            onUpdateStepNode(step.id, { notes: e.target.value })
                          }
                          placeholder="Ghi thêm lưu ý cho lớp dạy hoặc người phối hợp..."
                          className="w-full rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#635BFF] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {/* Inline Quick-Add Step Footer */}
        <form
          onSubmit={handleCreateStep}
          className="border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-4 sm:px-5 py-3.5 flex items-center gap-2"
        >
          <Plus className="h-4 w-4 text-[#635BFF] shrink-0" aria-hidden="true" />
          <input
            type="text"
            data-testid="easy-add-step-input"
            value={newStepTitle}
            onChange={(e) => setNewStepTitle(e.target.value)}
            placeholder="Nhập tên bước mới và nhấn Enter để thêm ngay..."
            aria-label="Thêm bước mới vào quy trình"
            className="flex-1 min-w-0 bg-transparent text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="submit"
            data-testid="easy-add-step-btn"
            disabled={!newStepTitle.trim()}
            className="aurora-btn-primary rounded-[9px] px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            Thêm bước
          </button>
        </form>
      </section>
    </div>
  );
}

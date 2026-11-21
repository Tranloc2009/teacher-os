import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  GitMerge,
  Plus,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { AppId } from '../../core/appRegistry';
import type {
  ConnectedWorkflowContext,
  ConnectedWorkflowStageId,
  ConnectedWorkflowStageStatus,
  SmartActionBarModel,
  SmartActionItem,
  WorkflowStageEvaluation,
} from '../../types/connectedWorkflow';

interface ConnectedWorkflowBarProps {
  activeApp: AppId;
  context: ConnectedWorkflowContext;
  allWorkflows?: ConnectedWorkflowContext[];
  stages: WorkflowStageEvaluation[];
  smartActionBar?: SmartActionBarModel;
  onNavigateStage: (stage: WorkflowStageEvaluation) => void;
  onExecuteSmartAction?: (action: SmartActionItem) => void;
  onSwitchWorkflow?: (workflowId: string) => void;
  onResetWorkflow?: () => void;
}

const STATUS_META: Record<
  ConnectedWorkflowStageStatus,
  {
    label: string;
    pillClass: string;
    dotClass: string;
  }
> = {
  completed: {
    label: 'Hoàn tất',
    pillClass:
      'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/90 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300',
    dotClass: 'text-emerald-600 dark:text-emerald-400',
  },
  'in-progress': {
    label: 'Đang làm',
    pillClass:
      'border-indigo-200 dark:border-indigo-800/80 bg-[#EEF0FF]/90 dark:bg-indigo-950/50 text-[#4338CA] dark:text-indigo-300',
    dotClass: 'text-[#635BFF] dark:text-indigo-400',
  },
  'needs-review': {
    label: 'Cần duyệt',
    pillClass:
      'border-amber-200 dark:border-amber-800/80 bg-amber-50/90 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300',
    dotClass: 'text-amber-600 dark:text-amber-400',
  },
  blocked: {
    label: 'Bị chặn',
    pillClass:
      'border-rose-200 dark:border-rose-800/80 bg-rose-50/90 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300',
    dotClass: 'text-rose-600 dark:text-rose-400',
  },
  'not-started': {
    label: 'Chưa bắt đầu',
    pillClass:
      'border-slate-200/85 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 text-slate-600 dark:text-slate-400',
    dotClass: 'text-slate-400 dark:text-slate-500',
  },
};

function StageStatusIcon({ status }: { status: ConnectedWorkflowStageStatus }) {
  if (status === 'completed') {
    return (
      <CheckCircle2
        className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
    );
  }
  if (status === 'needs-review') {
    return (
      <AlertTriangle
        className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
    );
  }
  if (status === 'blocked') {
    return (
      <ShieldAlert
        className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400"
        aria-hidden="true"
      />
    );
  }
  if (status === 'in-progress') {
    return (
      <Clock
        className="h-3.5 w-3.5 shrink-0 text-[#635BFF] dark:text-indigo-400"
        aria-hidden="true"
      />
    );
  }
  return (
    <Circle
      className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-600"
      aria-hidden="true"
    />
  );
}

const WORKFLOW_RELEVANT_APPS: Set<AppId> = new Set([
  'resource-vault',
  'exam-generator',
  'math-mixer',
  'print-studio',
  'grading-studio',
]);

function isStageActiveForApp(stageId: ConnectedWorkflowStageId, appId: AppId): boolean {
  if (appId === 'resource-vault') return stageId === 'source';
  if (appId === 'exam-generator') return stageId === 'select' || stageId === 'generate';
  if (appId === 'math-mixer') return stageId === 'review' || stageId === 'mix';
  if (appId === 'print-studio') return stageId === 'print';
  if (appId === 'grading-studio') return stageId === 'grade' || stageId === 'summary';
  return false;
}

export function ConnectedWorkflowBar({
  activeApp,
  context,
  allWorkflows = [],
  stages,
  smartActionBar,
  onNavigateStage,
  onExecuteSmartAction,
  onSwitchWorkflow,
  onResetWorkflow,
}: ConnectedWorkflowBarProps) {
  const [expanded, setExpanded] = useState(true);

  if (!WORKFLOW_RELEVANT_APPS.has(activeApp)) {
    return null;
  }

  const completedCount = stages.filter((s) => s.status === 'completed').length;
  const activeEntityLabel =
    context.generatedExamTitle ||
    context.examDraftTitle ||
    context.resourceTitle ||
    'Chưa chọn tài liệu hoặc đề kiểm tra';

  const primaryAction = smartActionBar?.primaryAction ?? null;
  const secondaryActions = smartActionBar?.secondaryActions ?? [];
  const blockedBanner = smartActionBar?.blockedBanner;
  const missingBanner = smartActionBar?.missingReferenceBanner;

  const primaryBtnClass =
    primaryAction?.tone === 'blocked'
      ? 'bg-rose-600 hover:bg-rose-700 text-white'
      : primaryAction?.tone === 'warning'
      ? 'bg-amber-600 hover:bg-amber-700 text-white'
      : 'bg-[#635BFF] hover:bg-[#5248f0] text-white';

  return (
    <section
      aria-label="Thanh quy trình liên thông và hành động tiếp theo TeacherOS"
      className="no-print border-b border-slate-200/80 dark:border-slate-800/90 bg-white/85 dark:bg-slate-900/80 backdrop-blur-md px-3 py-2 sm:px-6"
    >
      <div className="mx-auto max-w-[1440px] space-y-2">
        {/* Row 1: Active workflow context + switcher + collapse */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#4338CA] dark:text-indigo-300 shrink-0">
              <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Luồng kiểm tra liên thông</span>
            </span>

            {allWorkflows.length > 1 && onSwitchWorkflow ? (
              <select
                aria-label="Chuyển phiên quy trình làm việc"
                value={context.workflowId}
                onChange={(e) => onSwitchWorkflow(e.target.value)}
                className="max-w-[220px] sm:max-w-[300px] truncate rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11.5px] font-semibold text-slate-800 dark:text-slate-100"
              >
                {allWorkflows.map((wf) => (
                  <option key={wf.workflowId} value={wf.workflowId}>
                    {wf.generatedExamTitle || wf.examDraftTitle || wf.resourceTitle || wf.title}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                  |
                </span>
                <span className="truncate max-w-[220px] sm:max-w-[360px] font-medium text-slate-800 dark:text-slate-200">
                  {activeEntityLabel}
                </span>
              </>
            )}

            {context.examVersionCodes.length > 0 && (
              <span className="rounded-md border border-indigo-200/80 dark:border-indigo-800 bg-[#EEF0FF] dark:bg-indigo-950/60 px-1.5 py-0.5 text-[11px] font-mono-num font-semibold text-[#4338CA] dark:text-indigo-300">
                {context.examVersionCodes.length} mã ({context.examVersionCodes.slice(0, 4).join(', ')})
              </span>
            )}
            <span className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
              {completedCount}/{stages.length} chặng đạt chuẩn
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onResetWorkflow && (
              <button
                type="button"
                onClick={onResetWorkflow}
                title="Tạo phiên quy trình mới độc lập (không xóa phiên cũ)"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                <span>Phiên mới</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-indigo-300"
            >
              <span>{expanded ? 'Thu gọn' : 'Hiện 8 chặng'}</span>
              {expanded ? (
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Row 2: Smart Action Bar ("Hành động tiếp theo") */}
        {smartActionBar && onExecuteSmartAction && (
          <div
            data-testid="smart-action-bar"
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
              blockedBanner
                ? 'border-rose-200 dark:border-rose-800/80 bg-rose-50/85 dark:bg-rose-950/40'
                : missingBanner
                ? 'border-amber-200 dark:border-amber-800/80 bg-amber-50/85 dark:bg-amber-950/40'
                : 'border-indigo-200/75 dark:border-indigo-900/60 bg-[#F8F9FF] dark:bg-indigo-950/25'
            }`}
          >
            <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
              {blockedBanner ? (
                <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
              ) : missingBanner ? (
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-[#635BFF] dark:text-indigo-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <span className="font-bold text-slate-900 dark:text-slate-100 mr-1.5">
                  {blockedBanner
                    ? blockedBanner.title
                    : missingBanner
                    ? missingBanner.title
                    : 'Hành động tiếp theo:'}
                </span>
                <span className="text-slate-600 dark:text-slate-300 break-words">
                  {blockedBanner
                    ? blockedBanner.reason
                    : missingBanner
                    ? missingBanner.detail
                    : primaryAction?.description ?? 'Chọn chặng bất kỳ để tiếp tục.'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full sm:shrink-0">
              {primaryAction && (
                <button
                  type="button"
                  onClick={() => onExecuteSmartAction(primaryAction)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold shadow-xs transition-colors max-w-full ${primaryBtnClass}`}
                >
                  <span className="truncate">{primaryAction.label}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              )}
              {secondaryActions.slice(0, 2).map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => onExecuteSmartAction(act)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-300 hover:text-[#4338CA] transition-colors"
                >
                  <span>{act.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Row 3: 8-stage progress strip */}
        {expanded && (
          <nav
            aria-label="8 bước quy trình kiểm tra"
            className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
          >
            {stages.map((stage, idx) => {
              const meta = STATUS_META[stage.status];
              const isCurrent = isStageActiveForApp(stage.id, activeApp);
              return (
                <div key={stage.id} className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigateStage(stage)}
                    title={`${stage.label} (${meta.label}): ${stage.detail}`}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11.5px] font-semibold transition-all whitespace-nowrap ${
                      meta.pillClass
                    } ${
                      isCurrent
                        ? 'ring-2 ring-[#635BFF]/45 dark:ring-indigo-400/45 shadow-xs'
                        : 'hover:border-[#635BFF]/50'
                    }`}
                  >
                    <StageStatusIcon status={stage.status} />
                    <span>
                      {stage.order}. {stage.shortLabel}
                    </span>
                  </button>
                  {idx < stages.length - 1 && (
                    <span
                      className="text-slate-300 dark:text-slate-700 text-xs select-none"
                      aria-hidden="true"
                    >
                      →
                    </span>
                  )}
                </div>
              );
            })}
          </nav>
        )}
      </div>
    </section>
  );
}

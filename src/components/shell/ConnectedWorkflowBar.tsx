import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  GitMerge,
  ShieldAlert,
} from 'lucide-react';
import type { AppId } from '../../core/appRegistry';
import type {
  ConnectedWorkflowContext,
  ConnectedWorkflowStageId,
  ConnectedWorkflowStageStatus,
  WorkflowStageEvaluation,
} from '../../types/connectedWorkflow';

interface ConnectedWorkflowBarProps {
  activeApp: AppId;
  context: ConnectedWorkflowContext;
  stages: WorkflowStageEvaluation[];
  onNavigateStage: (stage: WorkflowStageEvaluation) => void;
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
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
  }
  if (status === 'needs-review') {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
  }
  if (status === 'blocked') {
    return <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />;
  }
  if (status === 'in-progress') {
    return <Clock className="h-3.5 w-3.5 shrink-0 text-[#635BFF] dark:text-indigo-400" aria-hidden="true" />;
  }
  return <Circle className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-600" aria-hidden="true" />;
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
  stages,
  onNavigateStage,
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

  return (
    <section
      aria-label="Tiến trình quy trình liên thông TeacherOS"
      className="no-print border-b border-slate-200/80 dark:border-slate-800/90 bg-white/80 dark:bg-slate-900/75 backdrop-blur-md px-4 py-2 sm:px-6"
    >
      <div className="mx-auto max-w-[1440px] space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#4338CA] dark:text-indigo-300 shrink-0">
              <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Luồng kiểm tra liên thông</span>
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              |
            </span>
            <span className="truncate max-w-[260px] sm:max-w-[380px] font-medium text-slate-800 dark:text-slate-200">
              {activeEntityLabel}
            </span>
            {context.examVersionCodes.length > 0 && (
              <span className="rounded-md border border-indigo-200/80 dark:border-indigo-800 bg-[#EEF0FF] dark:bg-indigo-950/60 px-1.5 py-0.5 text-[11px] font-mono-num font-semibold text-[#4338CA] dark:text-indigo-300">
                {context.examVersionCodes.length} mã ({context.examVersionCodes.slice(0, 4).join(', ')})
              </span>
            )}
            <span className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
              {completedCount}/{stages.length} chặng đạt chuẩn
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onResetWorkflow && (context.resourceId || context.examDraftId || context.generatedExamId) && (
              <button
                type="button"
                onClick={onResetWorkflow}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Phiên mới
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

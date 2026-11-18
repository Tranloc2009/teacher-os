import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Circle,
  Compass,
  Crosshair,
  FileText,
  Flag,
  FolderTree,
  GitBranch,
  Layers,
  Lock,
  Plus,
  StickyNote,
} from 'lucide-react';
import {
  CANVAS_COLOR_SWATCHES,
  CANVAS_PRIORITY_META,
  CANVAS_STATUS_META,
  CanvasEntityRef,
  CanvasMode,
  CanvasNodeRecord,
  CanvasNodeType,
} from '../../types/canvas';
import { type AppId, getAppById } from '../../core/appRegistry';
import { ResolvedEntityInfo, getCatalogItem } from '../../core/canvasEngine';
import {
  getEffectiveTaskStatus,
  type NodeDependencyStatus,
  type SubtreeProgress,
} from '../../core/canvasLayout';

export interface CanvasFlowNodeData extends Record<string, unknown> {
  mode?: CanvasMode;
  record: CanvasNodeRecord;
  resolvedEntity: ResolvedEntityInfo | null;
  dimmed?: boolean;
  directChildrenCount?: number;
  descendantCount?: number;
  subtreeProgress?: SubtreeProgress;
  dependencyStatus?: NodeDependencyStatus;
  isFocusedRoot?: boolean;
  onOpenEntity?: (ref: CanvasEntityRef) => void;
  onNavigateApp?: (appId: AppId) => void;
  onToggleCollapse?: (nodeId: string) => void;
  onQuickAddChild?: (parentNodeId: string) => void;
  onToggleTaskDone?: (nodeId: string) => void;
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, 'teacherosNode'>;

export function NodeTypeIcon({
  type,
  className = 'h-3.5 w-3.5',
}: {
  type: CanvasNodeType;
  className?: string;
}) {
  switch (type) {
    case 'root':
      return <Compass className={className} aria-hidden="true" />;
    case 'workspace':
      return <FolderTree className={className} aria-hidden="true" />;
    case 'task':
      return <CheckSquare className={className} aria-hidden="true" />;
    case 'lesson':
      return <BookOpen className={className} aria-hidden="true" />;
    case 'resource':
      return <Layers className={className} aria-hidden="true" />;
    case 'document':
      return <FileText className={className} aria-hidden="true" />;
    case 'checklist':
      return <CheckSquare className={className} aria-hidden="true" />;
    case 'note':
      return <StickyNote className={className} aria-hidden="true" />;
    case 'milestone':
      return <Flag className={className} aria-hidden="true" />;
    case 'workflow':
      return <GitBranch className={className} aria-hidden="true" />;
  }
}

function areNodePropsEqual(
  prev: NodeProps<CanvasFlowNode>,
  next: NodeProps<CanvasFlowNode>
): boolean {
  if (prev.selected !== next.selected) return false;
  const a = prev.data;
  const b = next.data;
  if (a === b) return true;
  if (a.record !== b.record) return false;
  if (Boolean(a.dimmed) !== Boolean(b.dimmed)) return false;
  if ((a.directChildrenCount ?? 0) !== (b.directChildrenCount ?? 0)) return false;
  if ((a.descendantCount ?? 0) !== (b.descendantCount ?? 0)) return false;
  if (Boolean(a.isFocusedRoot) !== Boolean(b.isFocusedRoot)) return false;
  if (
    (a.subtreeProgress?.doneCount ?? 0) !== (b.subtreeProgress?.doneCount ?? 0) ||
    (a.subtreeProgress?.totalCount ?? 0) !== (b.subtreeProgress?.totalCount ?? 0)
  ) {
    return false;
  }
  if (
    Boolean(a.dependencyStatus?.isDependencyBlocked) !==
      Boolean(b.dependencyStatus?.isDependencyBlocked) ||
    (a.dependencyStatus?.blockedByNodeIds.length ?? 0) !==
      (b.dependencyStatus?.blockedByNodeIds.length ?? 0)
  ) {
    return false;
  }
  if (
    a.resolvedEntity?.title !== b.resolvedEntity?.title ||
    a.resolvedEntity?.subtitle !== b.resolvedEntity?.subtitle ||
    a.resolvedEntity?.exists !== b.resolvedEntity?.exists
  ) {
    return false;
  }
  return true;
}

export const CanvasNodeCard = memo(function CanvasNodeCard({
  data,
  selected,
}: NodeProps<CanvasFlowNode>) {
  const {
    mode,
    record,
    resolvedEntity,
    dimmed,
    directChildrenCount = 0,
    descendantCount = 0,
    subtreeProgress,
    dependencyStatus,
    isFocusedRoot,
    onOpenEntity,
    onNavigateApp,
    onToggleCollapse,
    onQuickAddChild,
    onToggleTaskDone,
  } = data;

  const catalog = getCatalogItem(record.type);
  const swatch =
    CANVAS_COLOR_SWATCHES.find((c) => c.key === record.color) ??
    CANVAS_COLOR_SWATCHES[1];
  const effectiveStatus = getEffectiveTaskStatus(record) ?? record.status;
  const statusInfo = effectiveStatus ? CANVAS_STATUS_META[effectiveStatus] : null;
  const priorityInfo = record.priority
    ? CANVAS_PRIORITY_META[record.priority]
    : null;

  const checklistTotal = record.checklist?.length ?? 0;
  const checklistDone = record.checklist?.filter((c) => c.done).length ?? 0;
  const checklistPct =
    checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0;

  const suggestedApp = useMemoApp(record.suggestedAppId);

  const isRoot = record.type === 'root';
  const isMilestone = record.type === 'milestone';
  const isToggleableTask =
    record.type === 'task' || record.type === 'milestone';
  const isTaskDone = effectiveStatus === 'done';
  const hasChildren = directChildrenCount > 0;
  const isBlockedByDep = Boolean(dependencyStatus?.isDependencyBlocked);
  const showSubtreeProgress =
    (record.type === 'root' || record.type === 'workspace') &&
    subtreeProgress &&
    subtreeProgress.totalCount > 0;

  return (
    <div
      data-testid={`canvas-node-${record.id}`}
      className={`group relative w-[256px] overflow-hidden rounded-2xl border bg-white dark:bg-slate-900 transition-all select-none ${
        selected
          ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-600/20 dark:ring-blue-400/25 shadow-md'
          : isFocusedRoot
          ? 'border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/20 shadow-sm'
          : isRoot
          ? 'border-blue-200 dark:border-blue-800 shadow-sm'
          : 'border-slate-200/90 dark:border-slate-800 shadow-2xs hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm'
      } ${dimmed ? 'opacity-30' : 'opacity-100'}`}
    >
      {/* Subtle 3px color identity bar instead of heavy tinted headers */}
      <div
        aria-hidden="true"
        className={`h-1 w-full ${swatch.swatchClass} ${
          isRoot ? 'opacity-100' : 'opacity-80'
        }`}
      />

      {/* Connection Handles (Top, Left target; Bottom, Right source) */}
      <Handle
        type="target"
        position={Position.Top}
        id="t-top"
        className="!bg-slate-400 dark:!bg-slate-500 !border-white dark:!border-slate-900 opacity-0 group-hover:opacity-90 transition-opacity"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="t-left"
        className="!bg-slate-400 dark:!bg-slate-500 !border-white dark:!border-slate-900 opacity-0 group-hover:opacity-90 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="s-bottom"
        className="!bg-blue-600 dark:!bg-blue-400 !border-white dark:!border-slate-900 opacity-0 group-hover:opacity-90 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="s-right"
        className="!bg-blue-600 dark:!bg-blue-400 !border-white dark:!border-slate-900 opacity-0 group-hover:opacity-90 transition-opacity"
      />

      <div className="px-3.5 py-2.5 space-y-2">
        {/* Clean compact top metadata row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${swatch.headerBg} text-slate-700 dark:text-slate-200 shrink-0`}
            >
              <NodeTypeIcon type={record.type} className="h-3 w-3" />
            </span>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
              {catalog.shortLabel}
            </span>
            {isFocusedRoot && (
              <span
                title="Đang tập trung vào nhánh này"
                className="text-indigo-600 dark:text-indigo-400"
              >
                <Crosshair className="h-3 w-3" aria-hidden="true" />
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {record.locked && (
              <span
                title="Node đang khóa vị trí"
                className="text-slate-400 dark:text-slate-500"
              >
                <Lock className="h-3 w-3" aria-hidden="true" />
              </span>
            )}
            {statusInfo && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${statusInfo.badgeClass}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${statusInfo.dotClass}`}
                  aria-hidden="true"
                />
                <span>{statusInfo.label}</span>
              </span>
            )}
          </div>
        </div>

        {/* Title & Completion Toggle */}
        <div className="flex items-start gap-2">
          {isToggleableTask && onToggleTaskDone && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleTaskDone(record.id);
              }}
              title={
                isTaskDone
                  ? 'Đánh dấu chưa hoàn thành'
                  : 'Đánh dấu hoàn thành nhiệm vụ'
              }
              aria-label={
                isTaskDone
                  ? 'Đánh dấu chưa hoàn thành'
                  : 'Đánh dấu hoàn thành nhiệm vụ'
              }
              className="nodrag nopan mt-0.5 shrink-0 rounded text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 focus:outline-none"
            >
              {isTaskDone ? (
                <CheckCircle2
                  className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
              ) : (
                <Circle className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
          <h3
            className={`text-[13px] font-semibold leading-snug line-clamp-2 ${
              isTaskDone && isToggleableTask
                ? 'line-through text-slate-400 dark:text-slate-500'
                : 'text-slate-900 dark:text-slate-50'
            } ${isMilestone ? 'tracking-tight' : ''}`}
          >
            {resolvedEntity ? resolvedEntity.title : record.title}
          </h3>
        </div>

        {(resolvedEntity?.subtitle || record.description) && (
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">
            {resolvedEntity ? resolvedEntity.subtitle : record.description}
          </p>
        )}

        {/* Dependency Blocker Warning */}
        {isBlockedByDep && dependencyStatus && (
          <div
            title={`Đang chờ hoàn thành: ${dependencyStatus.blockedByTitles.join(', ')}`}
            className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200 max-w-full truncate"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate font-mono-num">
              Chờ {dependencyStatus.blockedByNodeIds.length} bước trước
            </span>
          </div>
        )}

        {/* Checklist real progress */}
        {record.type === 'checklist' && checklistTotal > 0 && (
          <div className="space-y-1 pt-0.5">
            <div className="flex items-center justify-between text-[10px] font-mono-num text-slate-500 dark:text-slate-400">
              <span>Kiểm tra</span>
              <span>
                {checklistDone}/{checklistTotal} ({checklistPct}%)
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal-600 dark:bg-teal-400 transition-all"
                style={{ width: `${checklistPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Parent Branch Subtree Progress */}
        {showSubtreeProgress && subtreeProgress && (
          <div className="space-y-1 pt-0.5">
            <div className="flex items-center justify-between text-[10px] font-mono-num text-slate-500 dark:text-slate-400">
              <span>Tiến độ nhánh</span>
              <span>
                {subtreeProgress.doneCount}/{subtreeProgress.totalCount} (
                {subtreeProgress.percent}%)
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 dark:bg-blue-400 transition-all"
                style={{ width: `${subtreeProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Footer metadata & Progressive Tree Controls */}
        {(priorityInfo ||
          record.dueDate ||
          record.entityRef ||
          suggestedApp ||
          hasChildren ||
          onQuickAddChild) && (
          <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0 font-mono-num">
              {priorityInfo && (
                <span className={`font-medium whitespace-nowrap shrink-0 ${priorityInfo.textClass}`}>
                  {priorityInfo.label}
                </span>
              )}
              {record.dueDate && (
                <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 truncate">
                  <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{record.dueDate}</span>
                </span>
              )}
              {resolvedEntity && !resolvedEntity.exists && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>Thiếu bản gốc</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {hasChildren && onToggleCollapse && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(record.id);
                  }}
                  title={
                    record.collapsed
                      ? `Mở rộng ${descendantCount} node con`
                      : `Thu gọn ${descendantCount} node con`
                  }
                  className={`nodrag nopan inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-mono-num font-semibold whitespace-nowrap transition-colors ${
                    record.collapsed
                      ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-700'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {record.collapsed ? (
                    <>
                      <ChevronRight className="h-3 w-3" aria-hidden="true" />
                      <span>+{descendantCount}</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" aria-hidden="true" />
                      <span>{descendantCount}</span>
                    </>
                  )}
                </button>
              )}

              {onQuickAddChild && (
                <button
                  type="button"
                  data-tour-id={
                    mode && record.type === 'root'
                      ? `${mode}-canvas-node-quick-add`
                      : undefined
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickAddChild(record.id);
                  }}
                  title="Thêm node con nối trực tiếp từ node này"
                  className={`nodrag nopan inline-flex items-center gap-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-300 whitespace-nowrap transition-opacity ${
                    selected || isRoot
                      ? 'opacity-100'
                      : 'opacity-65 group-hover:opacity-100'
                  }`}
                >
                  <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                  <span>Con</span>
                </button>
              )}

              {record.entityRef && resolvedEntity?.exists && onOpenEntity && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (record.entityRef) {
                      onOpenEntity(record.entityRef);
                    }
                  }}
                  className="nodrag nopan inline-flex items-center gap-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/70 whitespace-nowrap"
                >
                  <span>Mở</span>
                  <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              )}

              {!(record.entityRef && resolvedEntity?.exists) &&
                suggestedApp &&
                onNavigateApp && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateApp(suggestedApp.id);
                    }}
                    title={`Mở ${suggestedApp.name}`}
                    aria-label={`Mở ${suggestedApp.name}`}
                    className="nodrag nopan inline-flex items-center gap-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/70 whitespace-nowrap"
                  >
                    <span>Mở {suggestedApp.shortName}</span>
                    <ArrowUpRight className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                  </button>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}, areNodePropsEqual);

function useMemoApp(suggestedAppId: AppId | undefined) {
  if (!suggestedAppId) return null;
  const app = getAppById(suggestedAppId);
  if (app.id !== suggestedAppId || app.status !== 'ready') return null;
  return app;
}

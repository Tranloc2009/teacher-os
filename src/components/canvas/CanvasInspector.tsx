import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Crosshair,
  FolderTree,
  Lock,
  Plus,
  Square,
  Trash2,
  Unlink,
  Unlock,
  X,
} from 'lucide-react';
import {
  CANVAS_COLOR_SWATCHES,
  CANVAS_EDGE_META,
  CANVAS_NODE_CATALOG,
  CANVAS_PRIORITY_META,
  CANVAS_STATUS_META,
  CanvasBoard,
  CanvasChecklistItem,
  CanvasColorKey,
  CanvasEdgeRecord,
  CanvasEdgeType,
  CanvasEntityRef,
  CanvasMode,
  CanvasNodeRecord,
  CanvasNodeType,
  CanvasPriority,
  CanvasTaskStatus,
} from '../../types/canvas';
import { type AppId, getAppById, APP_REGISTRY } from '../../core/appRegistry';
import {
  ResolvedEntityInfo,
  WorkflowProgressSummary,
  getCatalogItem,
} from '../../core/canvasEngine';
import type {
  NodeDependencyStatus,
  SubtreeDeletePlan,
  SubtreeProgress,
} from '../../core/canvasLayout';
import { NodeTypeIcon } from './CanvasNodeCard';

interface CanvasInspectorProps {
  mode: CanvasMode;
  board: CanvasBoard;
  nodesCount: number;
  edgesCount: number;
  collapsedBranchesCount: number;
  workflowProgress: WorkflowProgressSummary;
  readyWorkflowNodes: CanvasNodeRecord[];
  blockedWorkflowCount: number;
  selectedNode: CanvasNodeRecord | null;
  selectedNodeDirectChildrenCount: number;
  selectedNodeDescendantCount: number;
  selectedNodeSubtreeProgress: SubtreeProgress | null;
  selectedNodeDependencyStatus: NodeDependencyStatus | null;
  selectedNodeDeletePlan: SubtreeDeletePlan | null;
  selectedNodeParentId: string | null;
  parentCandidates: CanvasNodeRecord[];
  isSelectedNodeFocusedRoot: boolean;
  selectedEdge: CanvasEdgeRecord | null;
  resolvedEntity: ResolvedEntityInfo | null;
  onUpdateNode: (updated: CanvasNodeRecord) => void;
  onReparentNode: (childNodeId: string, newParentId: string | null) => void;
  onDeleteNode: (nodeId: string) => void;
  onAddChildNode: (parentNodeId: string) => void;
  onToggleCollapseNode: (nodeId: string) => void;
  onExpandAllNodes: () => void;
  onFocusSubtree: (nodeId: string | null) => void;
  onDuplicateSubtree: (nodeId: string) => void;
  onDeleteSubtree: (nodeId: string) => void;
  onSelectNodeFromOverview: (nodeId: string) => void;
  onUpdateEdge: (updated: CanvasEdgeRecord) => void;
  onDeleteEdge: (edgeId: string) => void;
  onOpenEntity: (ref: CanvasEntityRef) => void;
  onNavigateApp?: (appId: AppId) => void;
  onClearSelection: () => void;
  onClosePanel?: () => void;
}

function deriveChecklistStatus(
  items: CanvasChecklistItem[],
  currentStatus?: CanvasTaskStatus
): CanvasTaskStatus | undefined {
  if (currentStatus === 'blocked') return 'blocked';
  if (items.length === 0) return currentStatus ?? 'todo';
  const doneCount = items.filter((item) => item.done).length;
  if (doneCount === items.length) return 'done';
  if (doneCount > 0) return 'in_progress';
  return 'todo';
}

export function CanvasInspector({
  mode,
  board,
  nodesCount,
  edgesCount,
  collapsedBranchesCount,
  workflowProgress,
  readyWorkflowNodes,
  blockedWorkflowCount,
  selectedNode,
  selectedNodeDirectChildrenCount,
  selectedNodeDescendantCount,
  selectedNodeSubtreeProgress,
  selectedNodeDependencyStatus,
  selectedNodeDeletePlan,
  selectedNodeParentId,
  parentCandidates,
  isSelectedNodeFocusedRoot,
  selectedEdge,
  resolvedEntity,
  onUpdateNode,
  onReparentNode,
  onDeleteNode,
  onAddChildNode,
  onToggleCollapseNode,
  onExpandAllNodes,
  onFocusSubtree,
  onDuplicateSubtree,
  onDeleteSubtree,
  onSelectNodeFromOverview,
  onUpdateEdge,
  onDeleteEdge,
  onOpenEntity,
  onNavigateApp,
  onClearSelection,
  onClosePanel,
}: CanvasInspectorProps) {
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmDeleteMode, setConfirmDeleteMode] = useState<
    'none' | 'single' | 'subtree'
  >('none');

  useEffect(() => {
    setConfirmDeleteMode('none');
  }, [selectedNode?.id, selectedEdge?.id]);

  if (selectedNode) {
    const catalog = getCatalogItem(selectedNode.type);
    const showStatusControls =
      catalog.supportsStatus ||
      selectedNode.status !== undefined ||
      mode === 'workflow';

    const handleAddChecklistItem = () => {
      const label = newChecklistLabel.trim();
      if (!label) return;
      const next = [
        ...(selectedNode.checklist ?? []),
        { id: `chk-${Date.now().toString(36)}`, label, done: false },
      ];
      const nextStatus =
        selectedNode.type === 'checklist'
          ? deriveChecklistStatus(next, selectedNode.status)
          : selectedNode.status;
      onUpdateNode({ ...selectedNode, checklist: next, status: nextStatus });
      setNewChecklistLabel('');
    };

    const handleToggleChecklistItem = (itemId: string) => {
      const next = (selectedNode.checklist ?? []).map((item) =>
        item.id === itemId ? { ...item, done: !item.done } : item
      );
      const nextStatus =
        selectedNode.type === 'checklist'
          ? deriveChecklistStatus(next, selectedNode.status)
          : selectedNode.status;
      onUpdateNode({ ...selectedNode, checklist: next, status: nextStatus });
    };

    const handleRemoveChecklistItem = (itemId: string) => {
      const next = (selectedNode.checklist ?? []).filter(
        (item) => item.id !== itemId
      );
      const nextStatus =
        selectedNode.type === 'checklist'
          ? deriveChecklistStatus(next, selectedNode.status)
          : selectedNode.status;
      onUpdateNode({ ...selectedNode, checklist: next, status: nextStatus });
    };

    const hasSubtree = selectedNodeDescendantCount > 0;
    const subtreeLocked = Boolean(selectedNodeDeletePlan?.hasLockedNode);

    return (
      <aside
        data-tour-id={`${mode}-canvas-inspector`}
        aria-label="Chi tiết Node đang chọn"
        className="w-[min(20rem,88vw)] lg:w-80 shrink-0 h-full border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col min-h-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <NodeTypeIcon
              type={selectedNode.type}
              className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0"
            />
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              Thuộc tính Node
            </span>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            aria-label="Bỏ chọn node"
            title="Đóng bảng thuộc tính"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
          {/* Title */}
          <div>
            <label
              htmlFor="inspector-node-title"
              className="block font-medium text-slate-700 dark:text-slate-300"
            >
              Tiêu đề
            </label>
            <input
              id="inspector-node-title"
              type="text"
              value={selectedNode.title}
              onChange={(e) =>
                onUpdateNode({ ...selectedNode, title: e.target.value })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
            />
          </div>

          {/* Collapsible Advanced Controls (Type, Lock, Tree Branch, Color) */}
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              aria-expanded={showAdvanced}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 transition-colors"
            >
              <span>Cấu trúc nhánh, màu sắc & khóa vị trí</span>
              {showAdvanced ? (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              )}
            </button>
            {showAdvanced && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-200/70 dark:border-slate-800">
          {/* Type + Lock */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="inspector-node-type"
                className="block font-medium text-slate-700 dark:text-slate-300"
              >
                Loại node
              </label>
              <select
                id="inspector-node-type"
                value={selectedNode.type}
                onChange={(e) => {
                  const nextType = e.target.value as CanvasNodeType;
                  if (nextType === 'root' && selectedNodeParentId) {
                    onReparentNode(selectedNode.id, null);
                  }
                  onUpdateNode({
                    ...selectedNode,
                    type: nextType,
                    ...(nextType === 'root' ? { parentId: null } : {}),
                  });
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                {CANVAS_NODE_CATALOG.map((item) => (
                  <option key={item.type} value={item.type}>
                    {item.shortLabel}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block font-medium text-slate-700 dark:text-slate-300">
                Vị trí
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdateNode({ ...selectedNode, locked: !selectedNode.locked })
                }
                className={`mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium ${
                  selectedNode.locked
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                {selectedNode.locked ? (
                  <>
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Đã khóa</span>
                  </>
                ) : (
                  <>
                    <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tự do</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Subtree / Tree Operations */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-2.5 space-y-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-100">
                <FolderTree className="h-3.5 w-3.5 text-blue-800 dark:text-blue-400" aria-hidden="true" />
                <span>Thao tác nhánh cây</span>
              </span>
              {hasSubtree && (
                <span className="font-mono-num text-[10px] text-slate-500 dark:text-slate-400">
                  {selectedNodeDescendantCount} node con
                </span>
              )}
            </div>

            {/* Parent Branch Assignment / Re-parenting */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <label
                  htmlFor="inspector-node-parent"
                  className="text-[11px] font-medium text-slate-700 dark:text-slate-300"
                >
                  Nhánh cha (Parent)
                </label>
                {selectedNodeParentId && selectedNode.type !== 'root' && (
                  <button
                    type="button"
                    onClick={() => onReparentNode(selectedNode.id, null)}
                    title="Tách node này khỏi nhánh cha hiện tại"
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-800 dark:text-blue-300 hover:underline"
                  >
                    <Unlink className="h-2.5 w-2.5" aria-hidden="true" />
                    <span>Tách nhánh</span>
                  </button>
                )}
              </div>

              {selectedNode.type === 'root' ? (
                <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Node Chủ đề gốc (Root) luôn ở cấp cao nhất, không có node cha.
                </div>
              ) : (
                <select
                  id="inspector-node-parent"
                  value={selectedNodeParentId ?? ''}
                  onChange={(e) =>
                    onReparentNode(
                      selectedNode.id,
                      e.target.value ? e.target.value : null
                    )
                  }
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-[11px] text-slate-900 dark:text-slate-100"
                >
                  <option value="">-- Độc lập (không thuộc nhánh cha) --</option>
                  {parentCandidates.map((cand) => (
                    <option key={cand.id} value={cand.id}>
                      {cand.title} ({getCatalogItem(cand.type).shortLabel})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Subtree Task Progress Summary */}
            {selectedNodeSubtreeProgress &&
              selectedNodeSubtreeProgress.totalCount > 0 && (
                <div className="rounded-md border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-2.5 py-1.5 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono-num text-slate-600 dark:text-slate-300">
                    <span>Tiến độ công việc nhánh con</span>
                    <span className="font-semibold text-blue-900 dark:text-blue-300">
                      {selectedNodeSubtreeProgress.doneCount}/
                      {selectedNodeSubtreeProgress.totalCount} (
                      {selectedNodeSubtreeProgress.percent}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400 transition-all"
                      style={{
                        width: `${selectedNodeSubtreeProgress.percent}%`,
                      }}
                    />
                  </div>
                </div>
              )}

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onAddChildNode(selectedNode.id)}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                <span>Thêm node con</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onFocusSubtree(isSelectedNodeFocusedRoot ? null : selectedNode.id)
                }
                className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium whitespace-nowrap ${
                  isSelectedNodeFocusedRoot
                    ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-900 dark:text-indigo-200'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Crosshair className="h-3 w-3" aria-hidden="true" />
                <span>{isSelectedNodeFocusedRoot ? 'Thoát tập trung' : 'Tập trung nhánh'}</span>
              </button>

              {selectedNodeDirectChildrenCount > 0 && (
                <button
                  type="button"
                  onClick={() => onToggleCollapseNode(selectedNode.id)}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  {selectedNode.collapsed ? (
                    <>
                      <ChevronRight className="h-3 w-3" aria-hidden="true" />
                      <span>Mở rộng (+{selectedNodeDescendantCount})</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" aria-hidden="true" />
                      <span>Thu gọn nhánh</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => onDuplicateSubtree(selectedNode.id)}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <CopyPlus className="h-3 w-3" aria-hidden="true" />
                <span>{hasSubtree ? 'Nhân bản nhánh' : 'Nhân bản node'}</span>
              </button>
            </div>
          </div>

          {/* Color Swatches */}
          <div>
            <span className="block font-medium text-slate-700 dark:text-slate-300">
              Màu phân nhóm
            </span>
            <div className="mt-1.5 flex items-center gap-1.5">
              {CANVAS_COLOR_SWATCHES.map((sw) => {
                const active = selectedNode.color === sw.key;
                return (
                  <button
                    key={sw.key}
                    type="button"
                    onClick={() =>
                      onUpdateNode({
                        ...selectedNode,
                        color: sw.key as CanvasColorKey,
                      })
                    }
                    title={sw.label}
                    aria-label={`Chọn màu ${sw.label}`}
                    className={`h-6 w-6 rounded-md ${sw.swatchClass} ${
                      active
                        ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-slate-900'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  />
                );
              })}
            </div>
          </div>
              </div>
            )}
          </div>

          {/* Workflow / Task Metadata & Dependency Status */}
          {showStatusControls && (
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
              {selectedNodeDependencyStatus &&
                (selectedNodeDependencyStatus.blockedByTitles.length > 0 ||
                  selectedNodeDependencyStatus.unlocksTitles.length > 0) && (
                  <div
                    className={`rounded-lg border p-2.5 space-y-1.5 text-[11px] ${
                      selectedNodeDependencyStatus.isDependencyBlocked
                        ? 'border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100'
                        : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100'
                    }`}
                  >
                    {selectedNodeDependencyStatus.isDependencyBlocked ? (
                      <>
                        <div className="inline-flex items-center gap-1 font-semibold">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>Đang chờ bước tiên quyết hoàn thành:</span>
                        </div>
                        <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                          {selectedNodeDependencyStatus.blockedByTitles.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <div className="inline-flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>Đã đủ điều kiện phụ thuộc để thực hiện</span>
                      </div>
                    )}
                    {selectedNodeDependencyStatus.unlocksTitles.length > 0 && (
                      <div className="text-[10px] opacity-85 pt-0.5">
                        Mở khóa cho: {selectedNodeDependencyStatus.unlocksTitles.join(', ')}
                      </div>
                    )}
                  </div>
                )}

              <div>
                <label
                  htmlFor="inspector-node-status"
                  className="block font-medium text-slate-700 dark:text-slate-300"
                >
                  Trạng thái thực hiện
                </label>
                <select
                  id="inspector-node-status"
                  value={selectedNode.status ?? 'todo'}
                  onChange={(e) =>
                    onUpdateNode({
                      ...selectedNode,
                      status: e.target.value as CanvasTaskStatus,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                >
                  {(Object.keys(CANVAS_STATUS_META) as CanvasTaskStatus[]).map(
                    (st) => (
                      <option key={st} value={st}>
                        {CANVAS_STATUS_META[st].label}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="inspector-node-priority"
                    className="block font-medium text-slate-700 dark:text-slate-300"
                  >
                    Ưu tiên
                  </label>
                  <select
                    id="inspector-node-priority"
                    value={selectedNode.priority ?? 'medium'}
                    onChange={(e) =>
                      onUpdateNode({
                        ...selectedNode,
                        priority: e.target.value as CanvasPriority,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {(Object.keys(CANVAS_PRIORITY_META) as CanvasPriority[]).map(
                      (p) => (
                        <option key={p} value={p}>
                          {CANVAS_PRIORITY_META[p].label}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="inspector-node-due"
                    className="block font-medium text-slate-700 dark:text-slate-300"
                  >
                    Hạn dự kiến
                  </label>
                  <input
                    id="inspector-node-due"
                    type="date"
                    value={selectedNode.dueDate ?? ''}
                    onChange={(e) =>
                      onUpdateNode({
                        ...selectedNode,
                        dueDate: e.target.value || undefined,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono-num text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label
              htmlFor="inspector-node-desc"
              className="block font-medium text-slate-700 dark:text-slate-300"
            >
              Mô tả / Ghi chú
            </label>
            <textarea
              id="inspector-node-desc"
              rows={3}
              value={selectedNode.description ?? ''}
              onChange={(e) =>
                onUpdateNode({ ...selectedNode, description: e.target.value })
              }
              placeholder="Ghi chú nội dung hoặc lưu ý cho node này..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
            />
          </div>

          {/* Checklist sub-items */}
          {(selectedNode.type === 'checklist' ||
            (selectedNode.checklist && selectedNode.checklist.length > 0)) && (
            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Đầu mục kiểm tra
              </div>
              <ul className="space-y-1.5">
                {(selectedNode.checklist ?? []).map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleChecklistItem(item.id)}
                      className="flex items-start gap-1.5 text-left flex-1"
                    >
                      {item.done ? (
                        <CheckSquare className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400 mt-0.5 shrink-0" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
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
                      onClick={() => handleRemoveChecklistItem(item.id)}
                      aria-label="Xóa mục kiểm tra"
                      className="text-slate-400 hover:text-red-600 p-0.5"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newChecklistLabel}
                  onChange={(e) => setNewChecklistLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddChecklistItem();
                    }
                  }}
                  placeholder="Thêm mục kiểm tra..."
                  className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={handleAddChecklistItem}
                  aria-label="Thêm mục kiểm tra"
                  className="rounded-lg bg-slate-900 dark:bg-blue-700 px-2 py-1 text-white"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* Entity Reference Panel */}
          {selectedNode.entityRef && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 p-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-900 dark:text-blue-300">
                Liên kết dữ liệu TeacherOS ({selectedNode.entityRef.kind})
              </div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {resolvedEntity?.title || selectedNode.entityRef.cachedLabel}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                {resolvedEntity?.subtitle || selectedNode.entityRef.cachedMeta}
              </div>
              {resolvedEntity?.exists && (
                <button
                  type="button"
                  onClick={() =>
                    selectedNode.entityRef && onOpenEntity(selectedNode.entityRef)
                  }
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600"
                >
                  <span>Mở trong ứng dụng gốc</span>
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {/* Suggested TeacherOS App Link */}
          {mode === 'workflow' && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2">
              <label
                htmlFor="inspector-suggested-app"
                className="block text-[11px] font-semibold text-slate-800 dark:text-slate-200"
              >
                Ứng dụng TeacherOS liên kết
              </label>
              <select
                id="inspector-suggested-app"
                value={selectedNode.suggestedAppId ?? ''}
                onChange={(e) =>
                  onUpdateNode({
                    ...selectedNode,
                    suggestedAppId: e.target.value
                      ? (e.target.value as AppId)
                      : undefined,
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="">-- Không liên kết ứng dụng --</option>
                {APP_REGISTRY.filter((app) => app.status === 'ready').map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>

              {(() => {
                if (!selectedNode.suggestedAppId || !onNavigateApp) return null;
                const linkedApp = getAppById(selectedNode.suggestedAppId);
                if (
                  linkedApp.id !== selectedNode.suggestedAppId ||
                  linkedApp.status !== 'ready'
                ) {
                  return null;
                }
                return (
                  <button
                    type="button"
                    onClick={() => onNavigateApp(linkedApp.id)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600"
                  >
                    <span>Mở {linkedApp.name}</span>
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                );
              })()}
            </div>
          )}

          {/* Coordinates + Delete Node / Subtree with Confirmation */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
              <span>Tọa độ Canvas</span>
              <span>
                x: {Math.round(selectedNode.position.x)}, y:{' '}
                {Math.round(selectedNode.position.y)}
              </span>
            </div>

            {confirmDeleteMode === 'none' ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteMode('single')}
                  disabled={Boolean(selectedNode.locked)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {selectedNode.locked
                      ? 'Mở khóa trước khi xóa'
                      : 'Xóa node khỏi Canvas'}
                  </span>
                </button>

                {hasSubtree && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteMode('subtree')}
                    disabled={subtreeLocked}
                    title={
                      subtreeLocked
                        ? `Không thể xóa vì có node đang khóa: ${selectedNodeDeletePlan?.lockedTitles.join(', ')}`
                        : undefined
                    }
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-300 dark:border-red-900 bg-white dark:bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    <span>
                      {subtreeLocked
                        ? 'Nhánh có node đang khóa'
                        : `Xóa cả nhánh (${selectedNodeDeletePlan?.nodeIds.length ?? 1} node)`}
                    </span>
                  </button>
                )}
              </>
            ) : (
              <div
                role="alert"
                className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50/90 dark:bg-red-950/50 p-2.5 space-y-2 text-[11px]"
              >
                <div className="font-semibold text-red-900 dark:text-red-200">
                  {confirmDeleteMode === 'subtree'
                    ? `Xác nhận xóa cả nhánh (${selectedNodeDeletePlan?.nodeIds.length ?? 1} node)?`
                    : `Xác nhận xóa node "${selectedNode.title}"?`}
                </div>
                <p className="text-[10px] text-red-800 dark:text-red-300 leading-relaxed">
                  Bạn có thể nhấn Hoàn tác (Ctrl+Z) nếu muốn khôi phục lại ngay sau khi xóa.
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmDeleteMode === 'subtree') {
                        onDeleteSubtree(selectedNode.id);
                      } else {
                        onDeleteNode(selectedNode.id);
                      }
                      setConfirmDeleteMode('none');
                    }}
                    className="flex-1 rounded-md bg-red-700 hover:bg-red-800 px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    Xác nhận xóa
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteMode('none')}
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            )}

            {selectedNode.entityRef && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Lưu ý: Xóa node chỉ gỡ khỏi sơ đồ này, không xóa tài liệu gốc trong kho dữ liệu TeacherOS.
              </p>
            )}
          </div>
        </div>
      </aside>
    );
  }

  if (selectedEdge) {
    return (
      <aside
        data-tour-id={`${mode}-canvas-inspector`}
        aria-label="Chi tiết liên kết đang chọn"
        className="w-[min(20rem,88vw)] lg:w-80 shrink-0 h-full border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col min-h-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 px-4 py-3">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Thuộc tính liên kết (Edge)
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            aria-label="Bỏ chọn liên kết"
            title="Đóng bảng thuộc tính"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-3.5 space-y-4 text-xs">
          <div>
            <label
              htmlFor="inspector-edge-type"
              className="block font-medium text-slate-700 dark:text-slate-300"
            >
              Loại quan hệ
            </label>
            <select
              id="inspector-edge-type"
              value={selectedEdge.edgeType}
              onChange={(e) =>
                onUpdateEdge({
                  ...selectedEdge,
                  edgeType: e.target.value as CanvasEdgeType,
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            >
              {(Object.keys(CANVAS_EDGE_META) as CanvasEdgeType[]).map((key) => (
                <option key={key} value={key}>
                  {CANVAS_EDGE_META[key].label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {CANVAS_EDGE_META[selectedEdge.edgeType].description}
            </p>
          </div>

          <div>
            <label
              htmlFor="inspector-edge-label"
              className="block font-medium text-slate-700 dark:text-slate-300"
            >
              Nhãn hiển thị (tùy chọn)
            </label>
            <input
              id="inspector-edge-label"
              type="text"
              value={selectedEdge.label ?? ''}
              onChange={(e) =>
                onUpdateEdge({ ...selectedEdge, label: e.target.value })
              }
              placeholder="VD: Hoàn thành trước khi in..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <button
            type="button"
            onClick={() => onDeleteEdge(selectedEdge.id)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Xóa liên kết này</span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-tour-id={`${mode}-canvas-inspector`}
      aria-label="Tổng quan bảng Canvas"
      className="w-[min(20rem,88vw)] lg:w-80 shrink-0 h-full border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col min-h-0"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 px-4 py-3">
        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          {mode === 'workflow'
            ? 'Tiến độ Quy trình thực tế'
            : 'Tổng quan Workspace Canvas'}
        </span>
        {onClosePanel && (
          <button
            type="button"
            onClick={onClosePanel}
            aria-label="Đóng bảng thuộc tính"
            title="Đóng bảng tổng quan"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
        <div>
          <h3 className="text-sm font-bold text-slate-950 dark:text-slate-50">
            {board.title}
          </h3>
          {board.description && (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
              {board.description}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 font-mono-num">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-2.5">
            <div className="text-[10px] uppercase text-slate-500 dark:text-slate-400">
              Số Node
            </div>
            <div className="mt-0.5 text-lg font-bold text-slate-950 dark:text-slate-50">
              {nodesCount}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-2.5">
            <div className="text-[10px] uppercase text-slate-500 dark:text-slate-400">
              Liên kết
            </div>
            <div className="mt-0.5 text-lg font-bold text-slate-950 dark:text-slate-50">
              {edgesCount}
            </div>
          </div>
        </div>

        {collapsedBranchesCount > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/30 px-3 py-2 text-[11px]">
            <span className="font-medium text-indigo-900 dark:text-indigo-200 font-mono-num">
              Đang thu gọn {collapsedBranchesCount} nhánh
            </span>
            <button
              type="button"
              onClick={onExpandAllNodes}
              className="rounded px-2 py-0.5 font-semibold text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900 whitespace-nowrap"
            >
              Mở tất cả
            </button>
          </div>
        )}

        {mode === 'workflow' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2.5">
              <div className="flex items-center justify-between font-mono-num">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  Hoàn thành nhiệm vụ
                </span>
                <span className="text-sm font-bold text-blue-900 dark:text-blue-300">
                  {workflowProgress.progressPercent}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400 transition-all"
                  style={{ width: `${workflowProgress.progressPercent}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono-num">
                <div className="text-emerald-700 dark:text-emerald-400">
                  Hoàn thành: {workflowProgress.doneCount}
                </div>
                <div className="text-blue-800 dark:text-blue-300">
                  Đang làm: {workflowProgress.inProgressCount}
                </div>
                <div className="text-slate-600 dark:text-slate-400">
                  Chưa làm: {workflowProgress.todoCount}
                </div>
                <div className="text-rose-700 dark:text-rose-400">
                  Bị chặn: {workflowProgress.blockedCount}
                </div>
              </div>
              {blockedWorkflowCount > 0 && (
                <div className="pt-1.5 border-t border-slate-200/70 dark:border-slate-700 text-[11px] font-mono-num text-amber-700 dark:text-amber-300">
                  {blockedWorkflowCount} bước đang chờ nhiệm vụ trước hoàn thành.
                </div>
              )}
            </div>

            {readyWorkflowNodes.length > 0 && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <div className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                  Sẵn sàng thực hiện ngay ({readyWorkflowNodes.length})
                </div>
                <div className="space-y-1.5">
                  {readyWorkflowNodes.slice(0, 5).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectNodeFromOverview(item.id)}
                      className="w-full text-left rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 px-2.5 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-200 hover:border-blue-400 dark:hover:border-blue-500 truncate"
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            Thao tác nhanh trên Canvas
          </div>
          <ul className="list-disc pl-4 space-y-1">
            <li>Kéo thả node từ cột trái hoặc nhấn &ldquo;+ Con&rdquo; trên node.</li>
            <li>Giữ phím Alt khi kéo thả một node lên node khác để đổi nhánh cha.</li>
            <li>Chuột phải vào node hoặc nền Canvas để mở Menu ngữ cảnh nhanh.</li>
            <li>Chọn kiểu Auto Layout (Cây dọc / Ngang / Mind Map) để tự sắp xếp.</li>
          </ul>
        </div>
      </div>
    </aside>
  );
}

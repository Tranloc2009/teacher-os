import {
  DragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Connection,
  ConnectionMode,
  MarkerType,
  MiniMap,
  OnEdgesChange,
  OnNodesChange,
  OnSelectionChangeFunc,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Crosshair,
  GitBranch,
  GraduationCap,
  LayoutGrid,
  Lock,
  Maximize2,
  PanelRight,
  Plus,
  Sparkles,
  Trash2,
  Unlink,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CANVAS_EDGE_META,
  CanvasBoard,
  CanvasEdgeRecord,
  CanvasEdgeType,
  CanvasEntityRef,
  CanvasLayoutMode,
  CanvasMode,
  CanvasNodeRecord,
  CanvasNodeType,
  CanvasViewSettings,
} from '../../types/canvas';
import {
  TeacherEntityCollections,
  calculateWorkflowProgress,
  createCanvasNode,
  createReferenceNode,
  filterCanvasNodes,
  getAncestorsBreadcrumb,
  getDefaultViewSettings,
  resolveEntityReference,
  validateNewEdge,
} from '../../core/canvasEngine';
import {
  CanvasHistoryState,
  WORKFLOW_CANVAS_TEMPLATES,
  analyzeWorkflowDependencies,
  applyCanvasAutoLayout,
  buildLessonPackWorkspaceTree,
  cloneCanvasSubtree,
  collectSubtreeDeletePlan,
  computeVisibleSubtree,
  createCanvasHistoryState,
  createChildNodeSpec,
  getEffectiveTaskStatus,
  getValidParentCandidates,
  instantiateWorkflowTemplate,
  pushCanvasHistory,
  redoCanvasHistory,
  reparentCanvasNode,
  undoCanvasHistory,
} from '../../core/canvasLayout';
import { type AppId } from '../../core/appRegistry';
import {
  type SmartWorkflowParseResult,
  buildCanvasCommitBundle,
} from '../../core/smartWorkflowParser';
import { ThemeMode } from '../../core/theme';
import { createId } from '../../db/database';
import {
  CanvasNodeCard,
  type CanvasFlowNode,
  type CanvasFlowNodeData,
} from './CanvasNodeCard';
import { CanvasEdgeRenderer, type CanvasFlowEdge } from './CanvasEdgeRenderer';
import {
  CanvasSidebar,
  DND_ENTITY_MIME,
  DND_NODE_TYPE_MIME,
  type DragEntityPayload,
} from './CanvasSidebar';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasInspector } from './CanvasInspector';
import { SmartWorkflowGeneratorModal } from './SmartWorkflowGeneratorModal';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';

// Module-scope constant definitions to prevent React Flow node/edge remounting
const NODE_TYPES = {
  teacherosNode: CanvasNodeCard,
};

const EDGE_TYPES = {
  teacherosEdge: CanvasEdgeRenderer,
};

interface CanvasContextMenuState {
  kind: 'node' | 'pane';
  x: number;
  y: number;
  flowPosition: { x: number; y: number };
  nodeId?: string;
  confirmDelete?: 'none' | 'single' | 'subtree';
}

function getTransitionDuration(ms: number): number {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return 0;
  }
  return ms;
}

export interface VisualWorkspaceCanvasProps {
  mode: CanvasMode;
  theme: ThemeMode;
  boards: CanvasBoard[];
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  viewSettingsList: CanvasViewSettings[];
  collections: TeacherEntityCollections;
  classicViewLabel: string;
  onSwitchToClassicView: () => void;
  onSaveBoard: (board: CanvasBoard) => Promise<void>;
  onSaveNode: (node: CanvasNodeRecord) => Promise<void>;
  onBulkSaveNodes: (nodes: CanvasNodeRecord[]) => Promise<void>;
  onBulkSaveBundle: (
    nodes: CanvasNodeRecord[],
    edges: CanvasEdgeRecord[],
    removedEdgeIds?: string[]
  ) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onBulkDeleteNodes: (nodeIds: string[]) => Promise<void>;
  onSaveEdge: (edge: CanvasEdgeRecord) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onReplaceBoardState: (
    boardId: string,
    nodes: CanvasNodeRecord[],
    edges: CanvasEdgeRecord[]
  ) => Promise<void>;
  onSaveViewSettings: (view: CanvasViewSettings) => Promise<void>;
  onOpenEntity: (ref: CanvasEntityRef) => void;
  onNavigateApp?: (appId: AppId) => void;
  onShowToast: (tone: 'success' | 'info' | 'error', text: string) => void;
  controlledBoardId?: string;
  onBoardChange?: (boardId: string) => void;
  onBackToHome?: () => void;
}

function CanvasInner({
  mode,
  theme,
  boards,
  nodes,
  edges,
  viewSettingsList,
  collections,
  classicViewLabel,
  onSwitchToClassicView,
  onSaveBoard,
  onSaveNode,
  onBulkSaveNodes,
  onBulkSaveBundle,
  onDeleteNode,
  onBulkDeleteNodes,
  onSaveEdge,
  onDeleteEdge,
  onReplaceBoardState,
  onSaveViewSettings,
  onOpenEntity,
  onNavigateApp,
  onShowToast,
  controlledBoardId,
  onBoardChange,
  onBackToHome,
}: VisualWorkspaceCanvasProps) {
  const modeBoards = useMemo(
    () => boards.filter((b) => b.mode === mode),
    [boards, mode]
  );

  const [selectedBoardId, setSelectedBoardId] = useState<string>(
    controlledBoardId || modeBoards[0]?.id || ''
  );

  useEffect(() => {
    if (controlledBoardId && controlledBoardId !== selectedBoardId) {
      setSelectedBoardId(controlledBoardId);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setContextMenu(null);
    }
  }, [controlledBoardId, selectedBoardId]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [desktopOverviewOpen, setDesktopOverviewOpen] = useState(false);
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [activeEdgeType, setActiveEdgeType] = useState<CanvasEdgeType>(
    mode === 'workflow' ? 'dependency' : 'parent'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [zoomPercent, setZoomPercent] = useState<number>(88);
  const [showNewBoardModal, setShowNewBoardModal] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [showSmartBuilderModal, setShowSmartBuilderModal] = useState(false);
  const [showSmartWorkflowGenModal, setShowSmartWorkflowGenModal] = useState(false);
  const [contextMenu, setContextMenu] =
    useState<CanvasContextMenuState | null>(null);
  const [historyByBoard, setHistoryByBoard] = useState<
    Record<string, CanvasHistoryState>
  >({});

  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const viewportSaveTimerRef = useRef<number | null>(null);
  const inspectorUndoMetaRef = useRef<{
    nodeId: string | null;
    timestamp: number;
  }>({ nodeId: null, timestamp: 0 });

  const tutorial = useOptionalTutorial();
  const modeTutorialId =
    mode === 'workflow' ? 'tutorial.workflow-center' : 'tutorial.workspace';

  useEffect(() => {
    const activeTutId = tutorial?.activeTutorial?.tutorialId;
    const stepId = tutorial?.currentStep?.stepId;
    if (activeTutId === 'tutorial.workspace' && stepId === 'ws-link-documents') {
      setSidebarCollapsed(false);
    }
    if (
      activeTutId === 'tutorial.workflow-center' &&
      stepId === 'wf-track-progress'
    ) {
      setDesktopOverviewOpen(true);
    }
  }, [tutorial?.activeTutorial?.tutorialId, tutorial?.currentStep?.stepId]);

  const { screenToFlowPosition, zoomIn, zoomOut, fitView, setCenter, getZoom } =
    useReactFlow();

  const activeBoard: CanvasBoard = useMemo(() => {
    const found =
      modeBoards.find((b) => b.id === selectedBoardId) ?? modeBoards[0];
    if (found) return found;
    const now = new Date().toISOString();
    return {
      id: mode === 'workspace' ? 'canvas-ws-default' : 'canvas-wf-default',
      mode,
      title:
        mode === 'workspace'
          ? 'Workspace Canvas mặc định'
          : 'Workflow Canvas mặc định',
      description: '',
      createdAt: now,
      updatedAt: now,
    };
  }, [mode, modeBoards, selectedBoardId]);

  useEffect(() => {
    if (
      modeBoards.length > 0 &&
      !modeBoards.some((b) => b.id === selectedBoardId)
    ) {
      setSelectedBoardId(modeBoards[0].id);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setContextMenu(null);
    }
  }, [modeBoards, selectedBoardId]);

  const activeViewSettings: CanvasViewSettings = useMemo(() => {
    const found = viewSettingsList.find((v) => v.boardId === activeBoard.id);
    return found ?? getDefaultViewSettings(activeBoard.id);
  }, [activeBoard.id, viewSettingsList]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.22, duration: getTransitionDuration(180) });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [activeBoard.id, fitView]);

  const boardNodes = useMemo(
    () => nodes.filter((n) => n.boardId === activeBoard.id),
    [nodes, activeBoard.id]
  );

  const boardEdges = useMemo(
    () => edges.filter((e) => e.boardId === activeBoard.id),
    [edges, activeBoard.id]
  );

  // History helpers per board
  const activeHistory = useMemo(
    () => historyByBoard[activeBoard.id] ?? createCanvasHistoryState(),
    [historyByBoard, activeBoard.id]
  );

  const recordUndoSnapshot = useCallback(
    (label: string) => {
      setHistoryByBoard((prev) => {
        const current = prev[activeBoard.id] ?? createCanvasHistoryState();
        return {
          ...prev,
          [activeBoard.id]: pushCanvasHistory(current, {
            nodes: boardNodes,
            edges: boardEdges,
            label,
          }),
        };
      });
    },
    [activeBoard.id, boardEdges, boardNodes]
  );

  const clearPendingTimers = useCallback(() => {
    if (viewportSaveTimerRef.current) {
      window.clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    inspectorUndoMetaRef.current = { nodeId: null, timestamp: 0 };
  }, []);

  useEffect(() => {
    return () => {
      if (viewportSaveTimerRef.current) {
        window.clearTimeout(viewportSaveTimerRef.current);
      }
    };
  }, []);

  const handleUndo = useCallback(() => {
    clearPendingTimers();
    const currentHist = historyByBoard[activeBoard.id];
    if (!currentHist || currentHist.past.length === 0) return;
    const { history: nextHist, restored } = undoCanvasHistory(currentHist, {
      nodes: boardNodes,
      edges: boardEdges,
      label: 'current',
    });
    if (!restored) return;
    setHistoryByBoard((prev) => ({ ...prev, [activeBoard.id]: nextHist }));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
    void onReplaceBoardState(activeBoard.id, restored.nodes, restored.edges);
    onShowToast('info', `Đã hoàn tác: ${restored.label}`);
  }, [
    activeBoard.id,
    boardEdges,
    boardNodes,
    clearPendingTimers,
    historyByBoard,
    onReplaceBoardState,
    onShowToast,
  ]);

  const handleRedo = useCallback(() => {
    clearPendingTimers();
    const currentHist = historyByBoard[activeBoard.id];
    if (!currentHist || currentHist.future.length === 0) return;
    const { history: nextHist, restored } = redoCanvasHistory(currentHist, {
      nodes: boardNodes,
      edges: boardEdges,
      label: 'current',
    });
    if (!restored) return;
    setHistoryByBoard((prev) => ({ ...prev, [activeBoard.id]: nextHist }));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
    void onReplaceBoardState(activeBoard.id, restored.nodes, restored.edges);
    onShowToast('info', `Đã làm lại: ${restored.label}`);
  }, [
    activeBoard.id,
    boardEdges,
    boardNodes,
    clearPendingTimers,
    historyByBoard,
    onReplaceBoardState,
    onShowToast,
  ]);

  // Subtree visibility (collapsed & Focus Mode)
  const focusRootId = activeViewSettings.focusSubtreeRootId ?? null;
  const focusRootNode = useMemo(
    () =>
      focusRootId
        ? boardNodes.find((n) => n.id === focusRootId) ?? null
        : null,
    [boardNodes, focusRootId]
  );

  const visibleSubtree = useMemo(
    () =>
      computeVisibleSubtree(
        boardNodes,
        boardEdges,
        focusRootNode?.id ?? null
      ),
    [boardEdges, boardNodes, focusRootNode]
  );

  const dependencySummary = useMemo(
    () =>
      mode === 'workflow'
        ? analyzeWorkflowDependencies(boardNodes, boardEdges)
        : null,
    [boardEdges, boardNodes, mode]
  );

  const collapsedBranchesCount = useMemo(
    () => boardNodes.filter((n) => n.collapsed).length,
    [boardNodes]
  );

  const matchedNodeIds = useMemo(
    () => filterCanvasNodes(visibleSubtree.visibleNodes, searchQuery, 'all'),
    [visibleSubtree.visibleNodes, searchQuery]
  );

  const hasSearchFilter = searchQuery.trim().length > 0;

  // Keep latest mutable ref for stable node card callbacks (avoids 300-node re-render on single node drag)
  const latestRef = useRef({
    activeBoardId: activeBoard.id,
    mode,
    boardNodes,
    boardEdges,
    directChildrenCountMap: visibleSubtree.directChildrenCountMap,
    onSaveNode,
    onBulkSaveBundle,
    onShowToast,
    recordUndoSnapshot,
    emitTutorialEvent: tutorial?.emitTutorialEvent,
  });
  latestRef.current = {
    activeBoardId: activeBoard.id,
    mode,
    boardNodes,
    boardEdges,
    directChildrenCountMap: visibleSubtree.directChildrenCountMap,
    onSaveNode,
    onBulkSaveBundle,
    onShowToast,
    recordUndoSnapshot,
    emitTutorialEvent: tutorial?.emitTutorialEvent,
  };

  const getSuggestedCenterPosition = useCallback((): {
    x: number;
    y: number;
  } => {
    const count = latestRef.current.boardNodes.length;
    const rect = canvasWrapperRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      const offset = (count % 5) * 26;
      return screenToFlowPosition({
        x: rect.left + rect.width * 0.48 + offset,
        y: rect.top + rect.height * 0.42 + offset,
      });
    }
    return {
      x: 220 + (count % 4) * 60,
      y: 160 + (count % 4) * 50,
    };
  }, [screenToFlowPosition]);

  const handleToggleCollapseNode = useCallback((nodeId: string) => {
    const {
      boardNodes: curNodes,
      onSaveNode: saveNode,
      recordUndoSnapshot: snap,
    } = latestRef.current;
    const target = curNodes.find((n) => n.id === nodeId);
    if (!target) return;
    snap(target.collapsed ? 'Mở rộng nhánh' : 'Thu gọn nhánh');
    void saveNode({ ...target, collapsed: !target.collapsed });
  }, []);

  const handleToggleTaskDone = useCallback((nodeId: string) => {
    const {
      mode: curMode,
      boardNodes: curNodes,
      boardEdges: curEdges,
      onSaveNode: saveNode,
      onShowToast: toast,
      recordUndoSnapshot: snap,
    } = latestRef.current;
    const target = curNodes.find((n) => n.id === nodeId);
    if (!target) return;
    const currentEffective = getEffectiveTaskStatus(target) ?? target.status;
    const nextStatus = currentEffective === 'done' ? 'todo' : 'done';
    if (curMode === 'workflow' && nextStatus === 'done') {
      const depInfo = analyzeWorkflowDependencies(curNodes, curEdges).byNodeId[nodeId];
      if (depInfo?.isDependencyBlocked) {
        toast(
          'error',
          `Không thể đánh dấu xong vì đang chờ bước tiên quyết: ${depInfo.blockedByTitles.join(', ')}.`
        );
        return;
      }
    }
    snap(
      nextStatus === 'done'
        ? `Hoàn thành "${target.title}"`
        : `Mở lại "${target.title}"`
    );
    const nextChecklist =
      target.checklist && target.checklist.length > 0
        ? target.checklist.map((item) => ({
            ...item,
            done: nextStatus === 'done',
          }))
        : target.checklist;
    void saveNode({
      ...target,
      status: nextStatus,
      ...(nextChecklist ? { checklist: nextChecklist } : {}),
    });
  }, []);

  const handleQuickAddChildNode = useCallback((parentNodeId: string) => {
    const {
      activeBoardId,
      mode: curMode,
      boardNodes: curNodes,
      directChildrenCountMap,
      onBulkSaveBundle: saveBundle,
      onShowToast: toast,
      recordUndoSnapshot: snap,
      emitTutorialEvent,
    } = latestRef.current;
    const parentNode = curNodes.find((n) => n.id === parentNodeId);
    if (!parentNode) return;
    snap('Thêm node con');
    const childType: CanvasNodeType =
      curMode === 'workflow'
        ? 'task'
        : parentNode.type === 'root'
        ? 'workspace'
        : 'note';
    const existingCount = directChildrenCountMap[parentNodeId] ?? 0;
    const { node, edge } = createChildNodeSpec({
      boardId: activeBoardId,
      parentNode,
      existingChildrenCount: existingCount,
      type: childType,
      mode: curMode,
      idFactory: createId,
    });
    const nodesToSave = parentNode.collapsed
      ? [{ ...parentNode, collapsed: false }, node]
      : [node];
    void saveBundle(nodesToSave, [edge]);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setContextMenu(null);
    emitTutorialEvent?.(
      curMode === 'workflow'
        ? 'workflow-task-or-template-used'
        : 'workspace-tree-or-branch-added'
    );
    toast('success', `Đã thêm node con dưới "${parentNode.title}".`);
  }, []);

  const handleExpandAllNodes = useCallback(() => {
    const collapsed = boardNodes.filter((n) => n.collapsed);
    if (collapsed.length === 0) return;
    recordUndoSnapshot('Mở rộng toàn bộ nhánh');
    void onBulkSaveNodes(collapsed.map((n) => ({ ...n, collapsed: false })));
    onShowToast('success', `Đã mở rộng ${collapsed.length} nhánh đang thu gọn.`);
  }, [boardNodes, onBulkSaveNodes, onShowToast, recordUndoSnapshot]);

  // Reparent / Detach node handler
  const handleReparentNode = useCallback(
    (
      childNodeId: string,
      newParentId: string | null,
      positionOverride?: { x: number; y: number }
    ) => {
      const res = reparentCanvasNode(
        boardNodes,
        boardEdges,
        childNodeId,
        newParentId,
        createId
      );
      if (!res.valid || !res.updatedNode) {
        onShowToast('error', res.reason || 'Không thể đổi nhánh cha.');
        return false;
      }
      recordUndoSnapshot(
        newParentId ? 'Chuyển nhánh cha' : 'Tách node khỏi nhánh cha'
      );
      const updatedChild: CanvasNodeRecord = positionOverride
        ? { ...res.updatedNode, position: positionOverride }
        : res.updatedNode;
      const parentNode = newParentId
        ? boardNodes.find((n) => n.id === newParentId)
        : null;
      const nodesToSave =
        parentNode && parentNode.collapsed
          ? [{ ...parentNode, collapsed: false }, updatedChild]
          : [updatedChild];
      void onBulkSaveBundle(
        nodesToSave,
        res.addedEdge ? [res.addedEdge] : [],
        res.removedEdgeIds
      );
      if (parentNode) {
        onShowToast(
          'success',
          `Đã gán "${updatedChild.title}" vào nhánh "${parentNode.title}".`
        );
      } else {
        onShowToast(
          'info',
          `Đã tách "${updatedChild.title}" thành nhánh độc lập.`
        );
      }
      return true;
    },
    [boardEdges, boardNodes, onBulkSaveBundle, onShowToast, recordUndoSnapshot]
  );

  // Build React Flow node data map independent of selectedNodeId so clicking a node doesn't recreate data for all 300 nodes
  const nodeDataById = useMemo(() => {
    const map = new Map<string, CanvasFlowNodeData>();
    for (const record of visibleSubtree.visibleNodes) {
      const resolvedEntity = resolveEntityReference(
        record.entityRef,
        collections
      );
      map.set(record.id, {
        mode,
        record,
        resolvedEntity,
        dimmed: hasSearchFilter && !matchedNodeIds.has(record.id),
        directChildrenCount:
          visibleSubtree.directChildrenCountMap[record.id] ?? 0,
        descendantCount: visibleSubtree.descendantCountMap[record.id] ?? 0,
        subtreeProgress: visibleSubtree.subtreeProgressMap[record.id],
        dependencyStatus: dependencySummary?.byNodeId[record.id],
        isFocusedRoot: focusRootNode?.id === record.id,
        onOpenEntity,
        onNavigateApp,
        onToggleCollapse: handleToggleCollapseNode,
        onQuickAddChild: handleQuickAddChildNode,
        onToggleTaskDone: handleToggleTaskDone,
      });
    }
    return map;
  }, [
    mode,
    visibleSubtree.visibleNodes,
    visibleSubtree.directChildrenCountMap,
    visibleSubtree.descendantCountMap,
    visibleSubtree.subtreeProgressMap,
    collections,
    hasSearchFilter,
    matchedNodeIds,
    dependencySummary,
    focusRootNode,
    onOpenEntity,
    onNavigateApp,
    handleToggleCollapseNode,
    handleQuickAddChildNode,
    handleToggleTaskDone,
  ]);

  const computedFlowNodes: CanvasFlowNode[] = useMemo(() => {
    return visibleSubtree.visibleNodes.map((record) => ({
      id: record.id,
      type: 'teacherosNode',
      position: record.position,
      selected: record.id === selectedNodeId,
      draggable: !record.locked,
      data: nodeDataById.get(record.id)!,
    }));
  }, [visibleSubtree.visibleNodes, nodeDataById, selectedNodeId]);

  const computedFlowEdges: CanvasFlowEdge[] = useMemo(() => {
    return visibleSubtree.visibleEdges.map((edge) => ({
      id: edge.id,
      type: 'teacherosEdge',
      source: edge.source,
      target: edge.target,
      selected: edge.id === selectedEdgeId,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color:
          edge.edgeType === 'dependency'
            ? '#1d4ed8'
            : edge.edgeType === 'reference'
            ? '#d97706'
            : '#64748b',
      },
      data: {
        edgeType: edge.edgeType,
        label: edge.label,
      },
    }));
  }, [visibleSubtree.visibleEdges, selectedEdgeId]);

  const [rfNodes, setRfNodes] = useState<CanvasFlowNode[]>(computedFlowNodes);
  const [rfEdges, setRfEdges] = useState<CanvasFlowEdge[]>(computedFlowEdges);

  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return computedFlowNodes.map((nextNode) => {
        const existing = prevById.get(nextNode.id);
        if (existing?.measured) {
          return { ...nextNode, measured: existing.measured };
        }
        return nextNode;
      });
    });
  }, [computedFlowNodes]);

  useEffect(() => {
    setRfEdges(computedFlowEdges);
  }, [computedFlowEdges]);

  const onNodesChange: OnNodesChange<CanvasFlowNode> = useCallback(
    (changes) => {
      setRfNodes((prev) => changes.applyTo(prev));
    },
    []
  );

  const onEdgesChange: OnEdgesChange<CanvasFlowEdge> = useCallback(
    (changes) => {
      setRfEdges((prev) => changes.applyTo(prev));
    },
    []
  );

  const handleSelectionChange: OnSelectionChangeFunc<
    CanvasFlowNode,
    CanvasFlowEdge
  > = useCallback(({ nodes: selNodes, edges: selEdges }) => {
    if (selNodes.length > 0) {
      setSelectedNodeId(selNodes[0].id);
      setSelectedEdgeId(null);
    } else if (selEdges.length > 0) {
      setSelectedEdgeId(selEdges[0].id);
      setSelectedNodeId(null);
    }
  }, []);

  const handleNodeDragStop = useCallback(
    (
      event: ReactMouseEvent | MouseEvent | TouchEvent,
      draggedNode: CanvasFlowNode,
      allDragged: CanvasFlowNode[]
    ) => {
      const targetNodes = allDragged.length > 0 ? allDragged : [draggedNode];
      const isAltPressed = 'altKey' in event && Boolean(event.altKey);

      // Check if a single unlocked non-root node was dropped directly onto another node to change its parent branch
      if (targetNodes.length === 1) {
        const rfNode = targetNodes[0];
        const orig = boardNodes.find((n) => n.id === rfNode.id);
        if (orig && !orig.locked && orig.type !== 'root') {
          const nextX = Math.round(rfNode.position.x);
          const nextY = Math.round(rfNode.position.y);
          const movedDistance = Math.hypot(
            nextX - orig.position.x,
            nextY - orig.position.y
          );
          if (movedDistance >= 16) {
            const centerX = nextX + 128;
            const centerY = nextY + 48;
            const dropTarget = visibleSubtree.visibleNodes.find((candidate) => {
              if (candidate.id === orig.id) return false;
              const padX = isAltPressed ? 0 : 24;
              const padY = isAltPressed ? 0 : 10;
              return (
                centerX >= candidate.position.x + padX &&
                centerX <= candidate.position.x + 256 - padX &&
                centerY >= candidate.position.y + padY &&
                centerY <= candidate.position.y + 104 - padY
              );
            });

            const currentParentId =
              visibleSubtree.parentIdMap[orig.id] ?? orig.parentId ?? null;
            if (dropTarget && dropTarget.id !== currentParentId) {
              const siblingCount =
                visibleSubtree.directChildrenCountMap[dropTarget.id] ?? 0;
              const childPos =
                mode === 'workflow'
                  ? {
                      x: Math.round(dropTarget.position.x + 310),
                      y: Math.round(
                        dropTarget.position.y + (siblingCount % 4) * 142
                      ),
                    }
                  : {
                      x: Math.round(
                        dropTarget.position.x + ((siblingCount % 3) - 1) * 140
                      ),
                      y: Math.round(dropTarget.position.y + 156),
                    };
              const reparented = handleReparentNode(
                orig.id,
                dropTarget.id,
                childPos
              );
              if (reparented) return;
            }
          }
        }
      }

      const updates: CanvasNodeRecord[] = [];
      for (const rfNode of targetNodes) {
        const orig = boardNodes.find((n) => n.id === rfNode.id);
        if (orig && !orig.locked) {
          const nextX = Math.round(rfNode.position.x);
          const nextY = Math.round(rfNode.position.y);
          if (nextX !== orig.position.x || nextY !== orig.position.y) {
            updates.push({
              ...orig,
              position: { x: nextX, y: nextY },
            });
          }
        }
      }
      if (updates.length === 0) return;
      recordUndoSnapshot('Di chuyển vị trí node');
      if (updates.length === 1) {
        void onSaveNode(updates[0]);
      } else {
        void onBulkSaveNodes(updates);
      }
    },
    [
      boardNodes,
      handleReparentNode,
      mode,
      onBulkSaveNodes,
      onSaveNode,
      recordUndoSnapshot,
      visibleSubtree.directChildrenCountMap,
      visibleSubtree.parentIdMap,
      visibleSubtree.visibleNodes,
    ]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const check = validateNewEdge(
        boardNodes,
        boardEdges,
        connection.source,
        connection.target,
        activeEdgeType
      );
      if (!check.valid) {
        onShowToast('error', check.reason || 'Không thể tạo liên kết này.');
        return;
      }

      recordUndoSnapshot('Tạo liên kết mới');
      const newEdge: CanvasEdgeRecord = {
        id: createId('edge'),
        boardId: activeBoard.id,
        source: connection.source,
        target: connection.target,
        edgeType: activeEdgeType,
        ...(activeEdgeType === 'dependency'
          ? { label: 'Phụ thuộc' }
          : activeEdgeType === 'reference'
          ? { label: 'Liên kết' }
          : {}),
      };

      const child =
        activeEdgeType === 'parent'
          ? boardNodes.find((n) => n.id === connection.target)
          : undefined;
      if (child && child.parentId !== connection.source) {
        void onBulkSaveBundle(
          [{ ...child, parentId: connection.source }],
          [newEdge]
        );
      } else {
        void onSaveEdge(newEdge);
      }
    },
    [
      activeBoard.id,
      activeEdgeType,
      boardEdges,
      boardNodes,
      onBulkSaveBundle,
      onSaveEdge,
      onShowToast,
      recordUndoSnapshot,
    ]
  );

  const handleQuickAddNode = useCallback(
    (type: CanvasNodeType, positionOverride?: { x: number; y: number }) => {
      recordUndoSnapshot(`Thêm node ${type}`);
      const pos = positionOverride ?? getSuggestedCenterPosition();
      const created = createCanvasNode({
        id: createId('cnode'),
        boardId: activeBoard.id,
        type,
        mode,
        position: pos,
      });
      void onSaveNode(created);
      setSelectedNodeId(created.id);
      setSelectedEdgeId(null);
      setContextMenu(null);
      tutorial?.emitTutorialEvent(
        mode === 'workflow'
          ? 'workflow-task-or-template-used'
          : 'workspace-tree-or-branch-added'
      );
      onShowToast('success', `Đã thêm node "${created.title}" vào Canvas.`);
    },
    [
      activeBoard.id,
      getSuggestedCenterPosition,
      mode,
      onSaveNode,
      onShowToast,
      recordUndoSnapshot,
      tutorial,
    ]
  );

  const handleQuickAddEntity = useCallback(
    (payload: DragEntityPayload) => {
      recordUndoSnapshot(`Liên kết ${payload.label}`);
      const pos = getSuggestedCenterPosition();
      const created = createReferenceNode({
        id: createId('cref'),
        boardId: activeBoard.id,
        mode,
        kind: payload.kind,
        entityId: payload.entityId,
        label: payload.label,
        meta: payload.meta,
        position: pos,
      });
      void onSaveNode(created);
      setSelectedNodeId(created.id);
      setSelectedEdgeId(null);
      setContextMenu(null);
      onShowToast(
        'success',
        `Đã liên kết "${payload.label}" lên Canvas (không sao chép dữ liệu gốc).`
      );
    },
    [
      activeBoard.id,
      getSuggestedCenterPosition,
      mode,
      onSaveNode,
      onShowToast,
      recordUndoSnapshot,
    ]
  );

  const handleCanvasDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      const entityRaw = e.dataTransfer.getData(DND_ENTITY_MIME);
      if (entityRaw) {
        try {
          const payload = JSON.parse(entityRaw) as DragEntityPayload;
          recordUndoSnapshot(`Thả ${payload.label}`);
          const created = createReferenceNode({
            id: createId('cref'),
            boardId: activeBoard.id,
            mode,
            kind: payload.kind,
            entityId: payload.entityId,
            label: payload.label,
            meta: payload.meta,
            position,
          });
          void onSaveNode(created);
          setSelectedNodeId(created.id);
          setSelectedEdgeId(null);
          setContextMenu(null);
          onShowToast('success', `Đã thả "${payload.label}" lên Canvas.`);
          return;
        } catch {
          // Ignore malformed DnD payload
        }
      }

      const nodeType = e.dataTransfer.getData(
        DND_NODE_TYPE_MIME
      ) as CanvasNodeType;
      if (nodeType) {
        recordUndoSnapshot(`Thả node ${nodeType}`);
        const created = createCanvasNode({
          id: createId('cnode'),
          boardId: activeBoard.id,
          type: nodeType,
          mode,
          position,
        });
        void onSaveNode(created);
        setSelectedNodeId(created.id);
        setSelectedEdgeId(null);
        setContextMenu(null);
      }
    },
    [
      activeBoard.id,
      mode,
      onSaveNode,
      onShowToast,
      recordUndoSnapshot,
      screenToFlowPosition,
    ]
  );

  // Auto Layout execution
  const runAutoLayout = useCallback(
    (targetMode: Exclude<CanvasLayoutMode, 'free'>) => {
      if (boardNodes.length === 0) return;
      recordUndoSnapshot(`Tự động dàn trang (${targetMode})`);
      const laidOut = applyCanvasAutoLayout(boardNodes, boardEdges, targetMode);
      void onBulkSaveNodes(laidOut);
      void onSaveViewSettings({
        ...activeViewSettings,
        boardId: activeBoard.id,
        layoutMode: targetMode,
      });
      setContextMenu(null);
      window.setTimeout(() => {
        void fitView({ padding: 0.2, duration: getTransitionDuration(280) });
      }, 60);
      const lockedCount = boardNodes.filter((n) => n.locked).length;
      onShowToast(
        'success',
        lockedCount > 0
          ? `Đã tự động dàn trang sơ đồ (giữ nguyên ${lockedCount} node đã khóa).`
          : 'Đã tự động dàn trang sơ đồ rõ ràng, không chồng lấp.'
      );
    },
    [
      activeBoard.id,
      activeViewSettings,
      boardEdges,
      boardNodes,
      fitView,
      onBulkSaveNodes,
      onSaveViewSettings,
      onShowToast,
      recordUndoSnapshot,
    ]
  );

  const handleSelectLayoutMode = useCallback(
    (nextLayout: CanvasLayoutMode) => {
      if (nextLayout === 'free') {
        void onSaveViewSettings({
          ...activeViewSettings,
          boardId: activeBoard.id,
          layoutMode: 'free',
        });
        return;
      }
      runAutoLayout(nextLayout);
    },
    [activeBoard.id, activeViewSettings, onSaveViewSettings, runAutoLayout]
  );

  const handleTriggerAutoLayout = useCallback(() => {
    const current = activeViewSettings.layoutMode ?? 'free';
    const resolved: Exclude<CanvasLayoutMode, 'free'> =
      current === 'free'
        ? mode === 'workflow'
          ? 'tree-lr'
          : 'tree-tb'
        : current;
    runAutoLayout(resolved);
  }, [activeViewSettings.layoutMode, mode, runAutoLayout]);

  // Focus subtree
  const handleFocusSubtree = useCallback(
    (nodeId: string | null) => {
      void onSaveViewSettings({
        ...activeViewSettings,
        boardId: activeBoard.id,
        focusSubtreeRootId: nodeId,
      });
      setContextMenu(null);
      if (nodeId) {
        const target = boardNodes.find((n) => n.id === nodeId);
        onShowToast(
          'info',
          `Đang tập trung vào nhánh "${target?.title ?? 'đã chọn'}".`
        );
      }
      window.setTimeout(() => {
        void fitView({ padding: 0.22, duration: getTransitionDuration(260) });
      }, 60);
    },
    [
      activeBoard.id,
      activeViewSettings,
      boardNodes,
      fitView,
      onSaveViewSettings,
      onShowToast,
    ]
  );

  // Clone / Duplicate branch
  const handleDuplicateSubtree = useCallback(
    (rootNodeId: string) => {
      const cloned = cloneCanvasSubtree(
        boardNodes,
        boardEdges,
        rootNodeId,
        createId
      );
      if (!cloned.rootCloneId || cloned.nodes.length === 0) return;
      recordUndoSnapshot('Nhân bản nhánh cây');
      void onBulkSaveBundle(cloned.nodes, cloned.edges);
      setSelectedNodeId(cloned.rootCloneId);
      setSelectedEdgeId(null);
      setContextMenu(null);
      onShowToast(
        'success',
        cloned.nodes.length > 1
          ? `Đã nhân bản cả nhánh (${cloned.nodes.length} node).`
          : 'Đã nhân bản node.'
      );
    },
    [boardEdges, boardNodes, onBulkSaveBundle, onShowToast, recordUndoSnapshot]
  );

  // Delete single node or entire subtree
  const handleDeleteSingleNode = useCallback(
    (nodeId: string) => {
      const target = boardNodes.find((n) => n.id === nodeId);
      if (target?.locked) {
        onShowToast('error', 'Node đang khóa vị trí. Hãy mở khóa trước khi xóa.');
        return;
      }
      recordUndoSnapshot(`Xóa node ${target?.title ?? ''}`);
      setSelectedNodeId(null);
      setContextMenu(null);
      void onDeleteNode(nodeId);
    },
    [boardNodes, onDeleteNode, onShowToast, recordUndoSnapshot]
  );

  const handleDeleteSubtree = useCallback(
    (rootNodeId: string) => {
      const plan = collectSubtreeDeletePlan(boardNodes, boardEdges, rootNodeId);
      if (plan.hasLockedNode) {
        onShowToast(
          'error',
          `Không thể xóa cả nhánh vì có node đang khóa: ${plan.lockedTitles.join(', ')}`
        );
        return;
      }
      if (plan.nodeIds.length === 0) return;
      recordUndoSnapshot(`Xóa cả nhánh (${plan.nodeIds.length} node)`);
      if (focusRootNode && plan.nodeIds.includes(focusRootNode.id)) {
        void onSaveViewSettings({
          ...activeViewSettings,
          boardId: activeBoard.id,
          focusSubtreeRootId: null,
        });
      }
      setSelectedNodeId(null);
      setContextMenu(null);
      void onBulkDeleteNodes(plan.nodeIds);
      onShowToast('success', `Đã xóa cả nhánh gồm ${plan.nodeIds.length} node.`);
    },
    [
      activeBoard.id,
      activeViewSettings,
      boardEdges,
      boardNodes,
      focusRootNode,
      onBulkDeleteNodes,
      onSaveViewSettings,
      onShowToast,
      recordUndoSnapshot,
    ]
  );

  // Inspector node updates with throttled Undo snapshot capture
  const handleInspectorUpdateNode = useCallback(
    (updated: CanvasNodeRecord) => {
      const now = Date.now();
      const meta = inspectorUndoMetaRef.current;
      if (meta.nodeId !== updated.id || now - meta.timestamp > 1800) {
        recordUndoSnapshot(`Cập nhật "${updated.title}"`);
      }
      inspectorUndoMetaRef.current = { nodeId: updated.id, timestamp: now };
      void onSaveNode(updated);
    },
    [onSaveNode, recordUndoSnapshot]
  );

  // Workflow Template / LessonPack Tree Builder
  const handleInsertWorkflowTemplate = useCallback(
    (templateId: string) => {
      recordUndoSnapshot('Chèn mẫu quy trình');
      const origin = getSuggestedCenterPosition();
      const built = instantiateWorkflowTemplate({
        templateId,
        boardId: activeBoard.id,
        mode,
        origin,
        idFactory: createId,
      });
      void onBulkSaveBundle(built.nodes, built.edges);
      setSelectedNodeId(built.nodes[0]?.id ?? null);
      setShowSmartBuilderModal(false);
      tutorial?.emitTutorialEvent('workflow-task-or-template-used');
      window.setTimeout(() => {
        void fitView({ padding: 0.2, duration: getTransitionDuration(280) });
      }, 60);
      onShowToast(
        'success',
        `Đã chèn quy trình mẫu "${built.template.title}" (${built.nodes.length} bước).`
      );
    },
    [
      activeBoard.id,
      fitView,
      getSuggestedCenterPosition,
      mode,
      onBulkSaveBundle,
      onShowToast,
      recordUndoSnapshot,
      tutorial,
    ]
  );

  const handleBuildLessonPackTree = useCallback(
    (packId: string) => {
      const pack = collections.packs.find((p) => p.id === packId);
      if (!pack) return;
      recordUndoSnapshot(`Dựng cây bài dạy ${pack.title}`);
      const origin = getSuggestedCenterPosition();
      const built = buildLessonPackWorkspaceTree({
        boardId: activeBoard.id,
        mode,
        pack,
        resources: collections.resources,
        journals: collections.journals,
        workflows: collections.workflows,
        origin,
        idFactory: createId,
      });
      void onBulkSaveBundle(built.nodes, built.edges);
      setSelectedNodeId(built.nodes[0]?.id ?? null);
      setShowSmartBuilderModal(false);
      tutorial?.emitTutorialEvent('workspace-tree-or-branch-added');
      window.setTimeout(() => {
        void fitView({ padding: 0.2, duration: getTransitionDuration(280) });
      }, 60);
      onShowToast(
        'success',
        `Đã dựng nhánh sơ đồ bài dạy "${pack.title}" (${built.nodes.length} node tham chiếu).`
      );
    },
    [
      activeBoard.id,
      collections.journals,
      collections.packs,
      collections.resources,
      collections.workflows,
      fitView,
      getSuggestedCenterPosition,
      mode,
      onBulkSaveBundle,
      onShowToast,
      recordUndoSnapshot,
      tutorial,
    ]
  );

  const handleConfirmSmartWorkflowInsert = useCallback(
    async (
      draft: SmartWorkflowParseResult,
      options: { skipDuplicates: boolean }
    ) => {
      const bundle = buildCanvasCommitBundle({
        draft,
        boardId: activeBoard.id,
        existingBoardNodes: boardNodes,
        skipDuplicates: options.skipDuplicates,
        idFactory: createId,
      });

      if (bundle.validationErrors.length > 0) {
        onShowToast('error', bundle.validationErrors[0]);
        return;
      }

      if (bundle.nodes.length === 0) {
        onShowToast(
          'info',
          'Các công việc đề xuất đều đã có trên bảng Canvas hiện tại.'
        );
        return;
      }

      recordUndoSnapshot(
        `Tạo sơ đồ từ mô tả (${bundle.nodes.length} node)`
      );
      await onBulkSaveBundle(bundle.nodes, bundle.edges);
      setSelectedNodeId(bundle.nodes[0]?.id ?? null);
      setSelectedEdgeId(null);
      setShowSmartWorkflowGenModal(false);
      tutorial?.emitTutorialEvent('workflow-task-or-template-used');
      window.setTimeout(() => {
        void fitView({ padding: 0.2, duration: getTransitionDuration(280) });
      }, 70);

      const skippedSuffix =
        bundle.skippedTitles.length > 0
          ? ` (đã bỏ qua ${bundle.skippedTitles.length} node trùng)`
          : '';
      onShowToast(
        'success',
        `Đã thêm ${bundle.nodes.length} node và ${bundle.edges.length} liên kết vào Workflow Canvas${skippedSuffix}.`
      );
    },
    [
      activeBoard.id,
      boardNodes,
      fitView,
      onBulkSaveBundle,
      onShowToast,
      recordUndoSnapshot,
      tutorial,
    ]
  );

  const selectedNode = useMemo(
    () => boardNodes.find((n) => n.id === selectedNodeId) ?? null,
    [boardNodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => boardEdges.find((e) => e.id === selectedEdgeId) ?? null,
    [boardEdges, selectedEdgeId]
  );

  // Keyboard shortcuts: Ctrl+Z Undo, Ctrl+Shift+Z / Ctrl+Y Redo, Escape, Arrow nudge, Enter child, Space toggle
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'BUTTON' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (showSmartWorkflowGenModal) {
          setShowSmartWorkflowGenModal(false);
          return;
        }
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        if (showSmartBuilderModal) {
          setShowSmartBuilderModal(false);
          return;
        }
        if (focusRootNode) {
          handleFocusSubtree(null);
          return;
        }
      }

      if (isEditingText) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNode) {
          e.preventDefault();
          handleDeleteSingleNode(selectedNode.id);
          return;
        }
        if (selectedEdge) {
          e.preventDefault();
          recordUndoSnapshot('Xóa liên kết');
          setSelectedEdgeId(null);
          void onDeleteEdge(selectedEdge.id);
          return;
        }
      }

      if (!selectedNode) return;

      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight')
      ) {
        if (selectedNode.locked) return;
        e.preventDefault();
        const step = e.shiftKey ? 32 : 16;
        const dx =
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy =
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        handleInspectorUpdateNode({
          ...selectedNode,
          position: {
            x: Math.round(selectedNode.position.x + dx),
            y: Math.round(selectedNode.position.y + dy),
          },
        });
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Enter') {
        e.preventDefault();
        handleQuickAddChildNode(selectedNode.id);
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === ' ') {
        e.preventDefault();
        const hasChildren =
          (visibleSubtree.directChildrenCountMap[selectedNode.id] ?? 0) > 0;
        if (hasChildren) {
          handleToggleCollapseNode(selectedNode.id);
        } else if (
          selectedNode.type === 'task' ||
          selectedNode.type === 'milestone'
        ) {
          handleToggleTaskDone(selectedNode.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    contextMenu,
    focusRootNode,
    handleDeleteSingleNode,
    handleFocusSubtree,
    handleInspectorUpdateNode,
    handleQuickAddChildNode,
    handleRedo,
    handleToggleCollapseNode,
    handleToggleTaskDone,
    handleUndo,
    onDeleteEdge,
    recordUndoSnapshot,
    selectedEdge,
    selectedNode,
    showSmartBuilderModal,
    showSmartWorkflowGenModal,
    visibleSubtree.directChildrenCountMap,
  ]);

  const resolvedSelectedEntity = useMemo(
    () => resolveEntityReference(selectedNode?.entityRef, collections),
    [selectedNode, collections]
  );

  const selectedNodeDeletePlan = useMemo(
    () =>
      selectedNode
        ? collectSubtreeDeletePlan(boardNodes, boardEdges, selectedNode.id)
        : null,
    [boardEdges, boardNodes, selectedNode]
  );

  const selectedNodeParentCandidates = useMemo(
    () =>
      selectedNode
        ? getValidParentCandidates(boardNodes, boardEdges, selectedNode.id)
        : [],
    [boardEdges, boardNodes, selectedNode]
  );

  const selectedNodeParentId = useMemo(
    () =>
      selectedNode
        ? visibleSubtree.parentIdMap[selectedNode.id] ??
          selectedNode.parentId ??
          null
        : null,
    [selectedNode, visibleSubtree.parentIdMap]
  );

  const breadcrumbNodes = useMemo(
    () => getAncestorsBreadcrumb(boardNodes, boardEdges, selectedNodeId),
    [boardNodes, boardEdges, selectedNodeId]
  );

  const workflowProgress = useMemo(
    () => calculateWorkflowProgress(boardNodes),
    [boardNodes]
  );

  const readyWorkflowNodes = useMemo(() => {
    if (!dependencySummary) return [];
    const readySet = new Set(dependencySummary.readyNodeIds);
    return boardNodes.filter((n) => readySet.has(n.id));
  }, [boardNodes, dependencySummary]);

  const handleSelectAndCenterNode = useCallback(
    (nodeId: string) => {
      const target = boardNodes.find((n) => n.id === nodeId);
      if (!target) return;
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setContextMenu(null);
      void setCenter(target.position.x + 128, target.position.y + 60, {
        zoom: Math.max(0.8, getZoom()),
        duration: getTransitionDuration(280),
      });
    },
    [boardNodes, getZoom, setCenter]
  );

  const handleMoveEnd = useCallback(
    (_: unknown, viewport: { x: number; y: number; zoom: number }) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
      if (viewportSaveTimerRef.current) {
        window.clearTimeout(viewportSaveTimerRef.current);
      }
      viewportSaveTimerRef.current = window.setTimeout(() => {
        void onSaveViewSettings({
          ...activeViewSettings,
          boardId: activeBoard.id,
          viewport,
        });
      }, 350);
    },
    [activeBoard.id, activeViewSettings, onSaveViewSettings]
  );

  const handleCreateBoard = async (e: FormEvent) => {
    e.preventDefault();
    const title = newBoardTitle.trim();
    if (!title) return;
    const now = new Date().toISOString();
    const boardId = createId(mode === 'workspace' ? 'cws' : 'cwf');
    const createdBoard: CanvasBoard = {
      id: boardId,
      mode,
      title,
      description: newBoardDesc.trim(),
      createdAt: now,
      updatedAt: now,
    };
    const rootNode = createCanvasNode({
      id: createId('cnode'),
      boardId,
      type: 'root',
      mode,
      title,
      description: newBoardDesc.trim() || 'Chủ đề trung tâm của bảng mới',
      position: { x: 320, y: 120 },
    });
    await onSaveBoard(createdBoard);
    await onSaveNode(rootNode);
    await onSaveViewSettings(getDefaultViewSettings(boardId));
    setSelectedBoardId(boardId);
    setSelectedNodeId(rootNode.id);
    setNewBoardTitle('');
    setNewBoardDesc('');
    setShowNewBoardModal(false);
    onShowToast('success', `Đã tạo bảng Canvas "${title}".`);
  };

  const handleUpdateEdgeWithValidation = useCallback(
    (updated: CanvasEdgeRecord) => {
      const otherEdges = boardEdges.filter((e) => e.id !== updated.id);
      const check = validateNewEdge(
        boardNodes,
        otherEdges,
        updated.source,
        updated.target,
        updated.edgeType
      );
      if (!check.valid) {
        onShowToast(
          'error',
          check.reason || 'Không thể đổi loại liên kết này.'
        );
        return;
      }
      recordUndoSnapshot('Cập nhật liên kết');
      void onSaveEdge(updated);
    },
    [boardEdges, boardNodes, onSaveEdge, onShowToast, recordUndoSnapshot]
  );

  // Context Menu handlers (clamped inside canvas container)
  const openClampedContextMenu = useCallback(
    (
      clientX: number,
      clientY: number,
      kind: 'node' | 'pane',
      nodeId?: string
    ) => {
      const rect = canvasWrapperRef.current?.getBoundingClientRect();
      const menuW = 228;
      const menuH = kind === 'node' ? 290 : 210;
      const relX = rect ? clientX - rect.left : clientX;
      const relY = rect ? clientY - rect.top : clientY;
      const maxX = rect ? Math.max(12, rect.width - menuW - 12) : relX;
      const maxY = rect ? Math.max(12, rect.height - menuH - 12) : relY;
      const flowPos = screenToFlowPosition({ x: clientX, y: clientY });
      setContextMenu({
        kind,
        x: Math.max(12, Math.min(relX, maxX)),
        y: Math.max(12, Math.min(relY, maxY)),
        flowPosition: flowPos,
        nodeId,
        confirmDelete: 'none',
      });
    },
    [screenToFlowPosition]
  );

  const handleNodeContextMenu = useCallback(
    (e: ReactMouseEvent, node: CanvasFlowNode) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      openClampedContextMenu(e.clientX, e.clientY, 'node', node.id);
    },
    [openClampedContextMenu]
  );

  const handlePaneContextMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent) => {
      e.preventDefault();
      openClampedContextMenu(e.clientX, e.clientY, 'pane');
    },
    [openClampedContextMenu]
  );

  const contextMenuNode = useMemo(
    () =>
      contextMenu?.nodeId
        ? boardNodes.find((n) => n.id === contextMenu.nodeId) ?? null
        : null,
    [boardNodes, contextMenu?.nodeId]
  );

  const contextMenuNodeParentId = useMemo(
    () =>
      contextMenuNode
        ? visibleSubtree.parentIdMap[contextMenuNode.id] ??
          contextMenuNode.parentId ??
          null
        : null,
    [contextMenuNode, visibleSubtree.parentIdMap]
  );

  const isDesktopInspectorVisible = Boolean(
    selectedNode || selectedEdge || desktopOverviewOpen
  );

  return (
    <section
      aria-label={
        mode === 'workspace'
          ? 'Workspace Canvas — Sơ đồ cây & Tài liệu'
          : 'Workflow Canvas — Sơ đồ quy trình trực quan'
      }
      className="flex flex-col h-[calc(100vh-7.25rem)] lg:h-[calc(100vh-6.1rem)] min-h-[500px] max-w-full overflow-x-clip bg-slate-50 dark:bg-slate-950"
    >
      <CanvasToolbar
        mode={mode}
        boards={modeBoards.length > 0 ? modeBoards : [activeBoard]}
        activeBoard={activeBoard}
        breadcrumbNodes={breadcrumbNodes}
        focusRootNode={focusRootNode}
        layoutMode={activeViewSettings.layoutMode ?? 'free'}
        searchQuery={searchQuery}
        viewSettings={activeViewSettings}
        classicViewLabel={classicViewLabel}
        mobileLibraryOpen={mobileLibraryOpen}
        mobileInspectorOpen={mobileInspectorOpen}
        desktopInspectorOpen={isDesktopInspectorVisible}
        canUndo={activeHistory.past.length > 0}
        canRedo={activeHistory.future.length > 0}
        onToggleMobileLibrary={() => {
          setMobileLibraryOpen((prev) => !prev);
          setMobileInspectorOpen(false);
        }}
        onToggleMobileInspector={() => {
          setMobileInspectorOpen((prev) => !prev);
          setMobileLibraryOpen(false);
        }}
        onToggleDesktopInspector={() => {
          if (selectedNode || selectedEdge) {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
            setDesktopOverviewOpen(false);
          } else {
            setDesktopOverviewOpen((prev) => !prev);
          }
        }}
        onSelectBoard={(id) => {
          setSelectedBoardId(id);
          onBoardChange?.(id);
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setDesktopOverviewOpen(false);
          setContextMenu(null);
        }}
        onBackToHome={onBackToHome}
        onFitView={() =>
          void fitView({ padding: 0.2, duration: getTransitionDuration(220) })
        }
        onOpenNewBoardForm={() => setShowNewBoardModal(true)}
        onSelectBreadcrumbNode={handleSelectAndCenterNode}
        onExitFocusSubtree={() => handleFocusSubtree(null)}
        onSelectLayoutMode={handleSelectLayoutMode}
        onTriggerAutoLayout={handleTriggerAutoLayout}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenSmartBuilder={() =>
          setShowSmartBuilderModal((prev) => {
            const next = !prev;
            if (next) {
              tutorial?.emitTutorialEvent(
                mode === 'workflow'
                  ? 'workflow-task-or-template-used'
                  : 'workspace-tree-or-branch-added'
              );
            }
            return next;
          })
        }
        onOpenNaturalLanguageGenerator={
          mode === 'workflow'
            ? () => {
                setShowSmartBuilderModal(false);
                setShowSmartWorkflowGenModal(true);
              }
            : undefined
        }
        onChangeSearchQuery={setSearchQuery}
        onToggleSnapToGrid={() =>
          void onSaveViewSettings({
            ...activeViewSettings,
            boardId: activeBoard.id,
            snapToGrid: !activeViewSettings.snapToGrid,
          })
        }
        onToggleMiniMap={() =>
          void onSaveViewSettings({
            ...activeViewSettings,
            boardId: activeBoard.id,
            showMiniMap: !activeViewSettings.showMiniMap,
          })
        }
        onSwitchToClassicView={onSwitchToClassicView}
        onStartHelp={
          tutorial ? () => tutorial.startTutorial(modeTutorialId) : undefined
        }
      />

      {/* Contextual non-blocking first-visit TeacherOS Academy suggestion bar */}
      {(() => {
        if (!tutorial) return null;
        if (tutorial.activeTutorial || tutorial.welcomeOpen || tutorial.launcherOpen) {
          return null;
        }
        const seenModule = Boolean(tutorial.persistence.tutorials[modeTutorialId]?.seen);
        const dismissedHint = (tutorial.persistence.dismissedHints ?? []).includes(
          modeTutorialId
        );
        const isAutostart =
          typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('autostart') === '1';
        if (seenModule || dismissedHint || isAutostart) return null;
        return (
          <div
            data-testid={`${mode}-canvas-academy-hint`}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 dark:border-blue-900 bg-blue-50/75 dark:bg-blue-950/35 px-3 py-2 text-xs shrink-0"
          >
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 min-w-0">
              <GraduationCap
                className="h-4 w-4 text-blue-900 dark:text-blue-400 shrink-0"
                aria-hidden="true"
              />
              <span className="leading-snug">
                {mode === 'workflow'
                  ? 'Lần đầu dùng Workflow Canvas? Xem hướng dẫn nhanh (~2 phút) để làm quen cách thêm việc và nối bước phụ thuộc.'
                  : 'Lần đầu dùng Workspace Canvas? Xem hướng dẫn nhanh (~2 phút) để biết cách dựng sơ đồ cây và gắn tài liệu.'}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => tutorial.startTutorial(modeTutorialId)}
                className="rounded-lg bg-blue-900 dark:bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600 whitespace-nowrap"
              >
                Bắt đầu hướng dẫn
              </button>
              <button
                type="button"
                onClick={() => tutorial.dismissContextualHint(modeTutorialId)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                Để sau
              </button>
            </div>
          </div>
        );
      })()}

      {/* Smart Builder Drawer Bar: Workflow Templates or LessonPack Tree Builder */}
      {showSmartBuilderModal && (
        <div className="border-b border-blue-200 dark:border-blue-900 bg-blue-50/85 dark:bg-blue-950/35 px-3 py-3 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
              {mode === 'workflow' ? (
                <>
                  <GitBranch
                    className="h-4 w-4 text-teal-700 dark:text-teal-400"
                    aria-hidden="true"
                  />
                  <span>
                    Chọn mẫu quy trình giảng dạy để chèn lên Workflow Canvas
                  </span>
                </>
              ) : (
                <>
                  <Sparkles
                    className="h-4 w-4 text-blue-800 dark:text-blue-400"
                    aria-hidden="true"
                  />
                  <span>
                    Dựng nhanh sơ đồ cây bài dạy kèm Học liệu &amp; Nhật ký liên
                    quan
                  </span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowSmartBuilderModal(false)}
              aria-label="Đóng bảng chọn mẫu"
              className="rounded p-1 text-slate-500 hover:bg-white dark:hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {mode === 'workflow' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {WORKFLOW_CANVAS_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleInsertWorkflowTemplate(tpl.id)}
                  className="text-left rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 hover:border-blue-500 dark:hover:border-blue-500 transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-1">
                      {tpl.title}
                    </span>
                    <span className="font-mono-num text-[10px] text-blue-800 dark:text-blue-300 shrink-0">
                      {tpl.stepsCount} bước
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                    {tpl.subtitle}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {collections.packs.slice(0, 6).map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => handleBuildLessonPackTree(pack.id)}
                  className="text-left rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 hover:border-blue-500 dark:hover:border-blue-500 transition-colors space-y-1"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <BookOpen
                      className="h-3.5 w-3.5 text-blue-800 dark:text-blue-400 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {pack.title || '(Chưa đặt tên)'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                    {pack.subject} · {pack.grade} · {pack.duration}p
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {showNewBoardModal && (
        <form
          onSubmit={(e) => void handleCreateBoard(e)}
          className="border-b border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 px-4 py-3 flex flex-wrap items-end gap-3 shrink-0"
        >
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor={`new-board-title-${mode}`}
              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200"
            >
              Tên bảng {mode === 'workspace' ? 'Workspace' : 'Workflow'} mới *
            </label>
            <input
              id={`new-board-title-${mode}`}
              type="text"
              required
              value={newBoardTitle}
              onChange={(e) => setNewBoardTitle(e.target.value)}
              placeholder={
                mode === 'workspace'
                  ? 'VD: Chuyên đề Hình học 8 — Học kỳ II'
                  : 'VD: Quy trình ôn tập kiểm tra giữa kỳ'
              }
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor={`new-board-desc-${mode}`}
              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200"
            >
              Mô tả ngắn (tùy chọn)
            </label>
            <input
              id={`new-board-desc-${mode}`}
              type="text"
              value={newBoardDesc}
              onChange={(e) => setNewBoardDesc(e.target.value)}
              placeholder="Ghi chú phạm vi môn học, khối lớp..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowNewBoardModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="rounded-lg bg-blue-900 dark:bg-blue-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
            >
              Tạo bảng
            </button>
          </div>
        </form>
      )}

      {/* Main 3-Pane Canvas Body: Left Library + Infinite Canvas + Right Inspector */}
      <div className="relative flex-1 flex min-h-0 min-w-0 overflow-hidden">
        {/* Desktop docked Library (lg+) + Mobile overlay drawer (< lg) */}
        <div
          className={`${
            mobileLibraryOpen
              ? 'flex absolute inset-y-0 left-0 z-20 shadow-xl'
              : 'hidden lg:flex'
          } h-full min-h-0`}
        >
          <CanvasSidebar
            mode={mode}
            collapsed={mobileLibraryOpen ? false : sidebarCollapsed}
            collections={collections}
            onToggleCollapse={() => {
              if (mobileLibraryOpen) {
                setMobileLibraryOpen(false);
              } else {
                setSidebarCollapsed((prev) => !prev);
              }
            }}
            onQuickAddNode={(type) => {
              handleQuickAddNode(type);
              setMobileLibraryOpen(false);
            }}
            onQuickAddEntity={(payload) => {
              handleQuickAddEntity(payload);
              setMobileLibraryOpen(false);
            }}
          />
        </div>

        <div
          ref={canvasWrapperRef}
          data-tour-id={`${mode}-canvas-viewport`}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          className="relative flex-1 min-w-0 min-h-0 h-full bg-slate-50 dark:bg-slate-950"
        >
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onlyRenderVisibleElements
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={handleSelectionChange}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
              setContextMenu(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
              setContextMenu(null);
            }}
            onNodeContextMenu={handleNodeContextMenu}
            onPaneContextMenu={handlePaneContextMenu}
            onNodeDragStop={handleNodeDragStop}
            onConnect={handleConnect}
            onMoveEnd={handleMoveEnd}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              setDesktopOverviewOpen(false);
              setContextMenu(null);
              setMobileLibraryOpen(false);
              setMobileInspectorOpen(false);
            }}
            defaultViewport={activeViewSettings.viewport}
            snapToGrid={activeViewSettings.snapToGrid}
            snapGrid={[16, 16]}
            connectionMode={ConnectionMode.Loose}
            selectionMode={SelectionMode.Partial}
            fitView
            fitViewOptions={{ padding: 0.22 }}
            minZoom={0.2}
            maxZoom={2.2}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            {activeViewSettings.showGrid && (
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1.2}
                color={theme === 'dark' ? '#334155' : '#cbd5e1'}
              />
            )}
            {activeViewSettings.showMiniMap && (
              <MiniMap
                pannable
                zoomable
                nodeBorderRadius={6}
                className="!rounded-xl !border !border-slate-200/90 dark:!border-slate-700 !bg-white/90 dark:!bg-slate-900/90 !shadow-sm"
                style={{ width: 138, height: 86 }}
                maskColor={
                  theme === 'dark'
                    ? 'rgba(2, 6, 23, 0.72)'
                    : 'rgba(241, 245, 249, 0.72)'
                }
                nodeColor={(n) => {
                  const nodeData = n.data as CanvasFlowNodeData | undefined;
                  if (nodeData?.record?.type === 'root') {
                    return theme === 'dark' ? '#3b82f6' : '#93c5fd';
                  }
                  return theme === 'dark' ? '#475569' : '#cbd5e1';
                }}
              />
            )}
          </ReactFlow>

          {/* Floating Bottom-Left Zoom & Edge Type Pill */}
          <div className="no-print absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 p-1 shadow-sm backdrop-blur-sm">
            <div className="inline-flex items-center">
              <button
                type="button"
                onClick={() => {
                  void zoomOut({ duration: getTransitionDuration(180) });
                  setZoomPercent(Math.round(Math.max(0.2, getZoom() / 1.2) * 100));
                }}
                aria-label="Thu nhỏ Canvas"
                title="Thu nhỏ"
                className="rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="px-1.5 text-[11px] font-mono-num font-medium text-slate-700 dark:text-slate-200 min-w-[40px] text-center">
                {zoomPercent}%
              </span>
              <button
                type="button"
                onClick={() => {
                  void zoomIn({ duration: getTransitionDuration(180) });
                  setZoomPercent(Math.round(Math.min(2.2, getZoom() * 1.2) * 100));
                }}
                aria-label="Phóng to Canvas"
                title="Phóng to"
                className="rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  void fitView({
                    padding: 0.22,
                    duration: getTransitionDuration(260),
                  });
                }}
                aria-label="Fit View toàn bộ sơ đồ"
                title="Căn vừa màn hình"
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Maximize2 className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">Vừa khung</span>
              </button>
            </div>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

            <label
              data-tour-id={`${mode}-canvas-edge-type`}
              className="inline-flex items-center px-1 text-[11px] text-slate-600 dark:text-slate-300"
            >
              <span className="sr-only">Kiểu đường nối</span>
              <select
                aria-label="Chọn loại liên kết khi kéo nối node"
                value={activeEdgeType}
                onChange={(e) => setActiveEdgeType(e.target.value as CanvasEdgeType)}
                className="rounded-lg bg-transparent px-1.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                {(Object.keys(CANVAS_EDGE_META) as CanvasEdgeType[]).map((key) => (
                  <option key={key} value={key}>
                    Nối: {CANVAS_EDGE_META[key].label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Floating Top-Right Summary Pill when Desktop Inspector is collapsed */}
          {!isDesktopInspectorVisible && (
            <button
              type="button"
              data-tour-id={`${mode}-canvas-inspector`}
              onClick={() => setDesktopOverviewOpen(true)}
              title="Mở bảng Tổng quan & Chi tiết"
              className="hidden lg:inline-flex absolute top-3 right-3 z-10 items-center gap-2 rounded-full border border-slate-200/90 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-sm hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-300 backdrop-blur-sm transition-colors"
            >
              <span className="font-mono-num">
                {boardNodes.length} node
                {mode === 'workflow'
                  ? ` · ${workflowProgress.progressPercent}% xong`
                  : ` · ${boardEdges.length} liên kết`}
              </span>
              <span className="h-3.5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
              <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold">
                <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tổng quan</span>
              </span>
            </button>
          )}

          {/* Mobile Quick Selection Chip to open Node/Edge Inspector */}
          {!mobileInspectorOpen && (selectedNode || selectedEdge) && (
            <button
              type="button"
              onClick={() => {
                setMobileInspectorOpen(true);
                setMobileLibraryOpen(false);
              }}
              className="lg:hidden absolute bottom-16 right-3 z-10 inline-flex items-center gap-2 rounded-full bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md hover:bg-blue-700"
            >
              <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="max-w-[180px] truncate">
                {selectedNode ? `Sửa: ${selectedNode.title}` : 'Sửa liên kết'}
              </span>
            </button>
          )}

          {/* Clamped Context Menu (Node or Pane) */}
          {contextMenu && (
            <div
              role="menu"
              aria-label="Menu ngữ cảnh Canvas"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              className="absolute z-30 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-lg text-xs"
            >
              {contextMenu.kind === 'node' && contextMenuNode ? (
                <div className="space-y-0.5">
                  <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {contextMenuNode.title}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleQuickAddChildNode(contextMenuNode.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Thêm node con</span>
                  </button>

                  {(contextMenuNode.type === 'task' ||
                    contextMenuNode.type === 'milestone') && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        handleToggleTaskDone(contextMenuNode.id);
                        setContextMenu(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {(getEffectiveTaskStatus(contextMenuNode) ??
                          contextMenuNode.status) === 'done'
                          ? 'Đánh dấu Chưa xong'
                          : 'Đánh dấu Hoàn thành'}
                      </span>
                    </button>
                  )}

                  {(visibleSubtree.directChildrenCountMap[contextMenuNode.id] ??
                    0) > 0 && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        handleToggleCollapseNode(contextMenuNode.id);
                        setContextMenu(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {contextMenuNode.collapsed ? (
                        <>
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Mở rộng nhánh con</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Thu gọn nhánh con</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      handleFocusSubtree(
                        focusRootNode?.id === contextMenuNode.id
                          ? null
                          : contextMenuNode.id
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {focusRootNode?.id === contextMenuNode.id
                        ? 'Thoát tập trung nhánh'
                        : 'Tập trung vào nhánh này'}
                    </span>
                  </button>

                  {contextMenuNodeParentId &&
                    contextMenuNode.type !== 'root' && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          handleReparentNode(contextMenuNode.id, null);
                          setContextMenu(null);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Tách khỏi nhánh cha</span>
                      </button>
                    )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleDuplicateSubtree(contextMenuNode.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <CopyPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Nhân bản nhánh/node</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleInspectorUpdateNode({
                        ...contextMenuNode,
                        locked: !contextMenuNode.locked,
                      });
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {contextMenuNode.locked ? (
                      <>
                        <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Mở khóa vị trí</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Khóa vị trí</span>
                      </>
                    )}
                  </button>

                  <div className="border-t border-slate-100 dark:border-slate-800 pt-1 mt-1">
                    {contextMenu.confirmDelete === 'single' ? (
                      <div className="px-2 py-1 space-y-1.5">
                        <div className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                          Xác nhận xóa node này?
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteSingleNode(contextMenuNode.id)
                            }
                            className="flex-1 rounded bg-red-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-800"
                          >
                            Xác nhận
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setContextMenu((prev) =>
                                prev ? { ...prev, confirmDelete: 'none' } : null
                              )
                            }
                            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px]"
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={Boolean(contextMenuNode.locked)}
                        onClick={() =>
                          setContextMenu((prev) =>
                            prev ? { ...prev, confirmDelete: 'single' } : null
                          )
                        }
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {contextMenuNode.locked
                            ? 'Node đang khóa vị trí'
                            : 'Xóa node...'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <div className="px-2.5 py-1 border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Thao tác tại vị trí con trỏ
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      handleQuickAddNode(
                        mode === 'workflow' ? 'task' : 'workspace',
                        contextMenu.flowPosition
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {mode === 'workflow'
                        ? 'Thêm Nhiệm vụ tại đây'
                        : 'Thêm Nhánh con tại đây'}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      handleQuickAddNode(
                        mode === 'workflow' ? 'checklist' : 'note',
                        contextMenu.flowPosition
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {mode === 'workflow'
                        ? 'Thêm Checklist tại đây'
                        : 'Thêm Ghi chú tại đây'}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleTriggerAutoLayout}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tự động dàn trang (Auto Layout)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Empty State if board has 0 nodes */}
          {boardNodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-5 text-center shadow-sm space-y-3">
                <h3 className="text-sm font-bold text-slate-950 dark:text-slate-50">
                  Bảng Canvas đang trống
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Kéo node từ cột bên trái thả vào đây, chọn mẫu dựng nhanh hoặc
                  khởi tạo nút gốc đầu tiên.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleQuickAddNode('root')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Thêm node Root</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSmartBuilderModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {mode === 'workflow' ? 'Mẫu quy trình' : 'Dựng cây bài dạy'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Contextual Inspector: Opens ONLY when a Node/Edge is selected or Overview is toggled */}
        {(mobileInspectorOpen || isDesktopInspectorVisible) && (
          <div
            className={`${
              mobileInspectorOpen
                ? 'flex absolute inset-y-0 right-0 z-20 shadow-xl'
                : 'hidden lg:flex'
            } h-full min-h-0`}
          >
            <CanvasInspector
              mode={mode}
              board={activeBoard}
              nodesCount={boardNodes.length}
              edgesCount={boardEdges.length}
              collapsedBranchesCount={collapsedBranchesCount}
              workflowProgress={workflowProgress}
              readyWorkflowNodes={readyWorkflowNodes}
              blockedWorkflowCount={
                dependencySummary?.blockedByDependencyIds.length ?? 0
              }
              selectedNode={selectedNode}
              selectedNodeDirectChildrenCount={
                selectedNode
                  ? visibleSubtree.directChildrenCountMap[selectedNode.id] ?? 0
                  : 0
              }
              selectedNodeDescendantCount={
                selectedNode
                  ? visibleSubtree.descendantCountMap[selectedNode.id] ?? 0
                  : 0
              }
              selectedNodeSubtreeProgress={
                selectedNode
                  ? visibleSubtree.subtreeProgressMap[selectedNode.id] ?? null
                  : null
              }
              selectedNodeDependencyStatus={
                selectedNode && dependencySummary
                  ? dependencySummary.byNodeId[selectedNode.id] ?? null
                  : null
              }
              selectedNodeDeletePlan={selectedNodeDeletePlan}
              selectedNodeParentId={selectedNodeParentId}
              parentCandidates={selectedNodeParentCandidates}
              isSelectedNodeFocusedRoot={Boolean(
                selectedNode && focusRootNode?.id === selectedNode.id
              )}
              selectedEdge={selectedEdge}
              resolvedEntity={resolvedSelectedEntity}
              onUpdateNode={handleInspectorUpdateNode}
              onReparentNode={(childId, newParentId) => {
                handleReparentNode(childId, newParentId);
              }}
              onDeleteNode={handleDeleteSingleNode}
              onAddChildNode={handleQuickAddChildNode}
              onToggleCollapseNode={handleToggleCollapseNode}
              onExpandAllNodes={handleExpandAllNodes}
              onFocusSubtree={handleFocusSubtree}
              onDuplicateSubtree={handleDuplicateSubtree}
              onDeleteSubtree={handleDeleteSubtree}
              onSelectNodeFromOverview={handleSelectAndCenterNode}
              onUpdateEdge={handleUpdateEdgeWithValidation}
              onDeleteEdge={(edgeId) => {
                recordUndoSnapshot('Xóa liên kết');
                setSelectedEdgeId(null);
                void onDeleteEdge(edgeId);
              }}
              onOpenEntity={onOpenEntity}
              onNavigateApp={onNavigateApp}
              onClearSelection={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                setDesktopOverviewOpen(false);
                setMobileInspectorOpen(false);
              }}
              onClosePanel={() => {
                setDesktopOverviewOpen(false);
                setMobileInspectorOpen(false);
              }}
            />
          </div>
        )}
      </div>

      {mode === 'workflow' && (
        <SmartWorkflowGeneratorModal
          open={showSmartWorkflowGenModal}
          existingBoardNodes={boardNodes}
          onClose={() => setShowSmartWorkflowGenModal(false)}
          onConfirmInsert={(draft, options) => {
            void handleConfirmSmartWorkflowInsert(draft, options);
          }}
        />
      )}
    </section>
  );
}

export function VisualWorkspaceCanvas(props: VisualWorkspaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  JournalEntry,
  LessonPack,
  ResourceItem,
  WorkflowRun,
} from '../../types/lesson';
import { MathExamProject } from '../../types/mathExam';
import {
  CanvasBoard,
  CanvasEdgeRecord,
  CanvasEntityRef,
  CanvasNodeRecord,
  CanvasViewSettings,
} from '../../types/canvas';
import { ThemeMode } from '../../core/theme';
import { AppId } from '../../core/appRegistry';
import { createId } from '../../db/database';
import { getDefaultViewSettings } from '../../core/canvasEngine';
import {
  addEasyWorkflowStep,
  buildMirroredWorkflowRun,
  buildUnifiedWorkflowCatalog,
  computeWorkflowStudioProgressFromCanvas,
  createQuickWorkflowBundle,
  createStepDependencyEdge,
  createWorkflowFromSmartDraftBundle,
  createWorkflowFromTemplateBundle,
  duplicateEasyWorkflowStep,
  duplicateWorkflowBundle,
  hydrateLegacyWorkflowToBoard,
  reorderEasyWorkflowStep,
  toggleEasyWorkflowStepDone,
  type UnifiedWorkflowSummary,
} from '../../core/workflowStudioEngine';
import type { SmartWorkflowParseResult } from '../../core/smartWorkflowParser';
import { VisualWorkspaceCanvas } from '../canvas/VisualWorkspaceCanvas';
import { useOptionalTutorial } from '../tutorial/TutorialProvider';
import { WorkflowHomeView } from '../workflow/WorkflowHomeView';
import { EasyWorkflowEditor } from '../workflow/EasyWorkflowEditor';
import { WorkflowTemplateModal } from '../workflow/WorkflowTemplateModal';
import { SmartPlannerModal } from '../workflow/SmartPlannerModal';
import { QuickCreateWorkflowModal } from '../workflow/QuickCreateWorkflowModal';

interface WorkflowCenterAppProps {
  workflows: WorkflowRun[];
  packs: LessonPack[];
  resources: ResourceItem[];
  journals: JournalEntry[];
  mathExams: MathExamProject[];
  theme: ThemeMode;
  canvasBoards: CanvasBoard[];
  canvasNodes: CanvasNodeRecord[];
  canvasEdges: CanvasEdgeRecord[];
  canvasViewSettings: CanvasViewSettings[];
  onSaveCanvasBoard: (board: CanvasBoard) => Promise<void>;
  onDeleteCanvasBoard?: (boardId: string) => Promise<void>;
  onSaveCanvasNode: (node: CanvasNodeRecord) => Promise<void>;
  onBulkSaveCanvasNodes: (nodes: CanvasNodeRecord[]) => Promise<void>;
  onBulkSaveCanvasBundle: (
    nodes: CanvasNodeRecord[],
    edges: CanvasEdgeRecord[],
    removedEdgeIds?: string[]
  ) => Promise<void>;
  onDeleteCanvasNode: (nodeId: string) => Promise<void>;
  onBulkDeleteCanvasNodes: (nodeIds: string[]) => Promise<void>;
  onSaveCanvasEdge: (edge: CanvasEdgeRecord) => Promise<void>;
  onDeleteCanvasEdge: (edgeId: string) => Promise<void>;
  onReplaceBoardCanvasState: (
    boardId: string,
    nodes: CanvasNodeRecord[],
    edges: CanvasEdgeRecord[]
  ) => Promise<void>;
  onSaveCanvasViewSettings: (view: CanvasViewSettings) => Promise<void>;
  onOpenCanvasEntity: (ref: CanvasEntityRef) => void;
  onShowToast: (tone: 'success' | 'info' | 'error', text: string) => void;
  onSaveWorkflow: (item: WorkflowRun) => Promise<void>;
  onDeleteWorkflow: (id: string) => Promise<void>;
  onNavigateApp: (appId: AppId, linkedPackId?: string) => void;
}

type StudioScreen = 'home' | 'easy' | 'canvas';

export function WorkflowCenterApp({
  workflows,
  packs,
  resources,
  journals,
  mathExams,
  theme,
  canvasBoards,
  canvasNodes,
  canvasEdges,
  canvasViewSettings,
  onSaveCanvasBoard,
  onDeleteCanvasBoard,
  onSaveCanvasNode,
  onBulkSaveCanvasNodes,
  onBulkSaveCanvasBundle,
  onDeleteCanvasNode,
  onBulkDeleteCanvasNodes,
  onSaveCanvasEdge,
  onDeleteCanvasEdge,
  onReplaceBoardCanvasState,
  onSaveCanvasViewSettings,
  onOpenCanvasEntity,
  onShowToast,
  onSaveWorkflow,
  onDeleteWorkflow,
  onNavigateApp,
}: WorkflowCenterAppProps) {
  const [screen, setScreen] = useState<StudioScreen>('home');
  const [activeBoardId, setActiveBoardId] = useState<string>('');
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [smartPlannerOpen, setSmartPlannerOpen] = useState(false);

  const tutorial = useOptionalTutorial();

  const unifiedWorkflows = useMemo(
    () =>
      buildUnifiedWorkflowCatalog({
        workflows,
        canvasBoards,
        canvasNodes,
        canvasEdges,
      }),
    [workflows, canvasBoards, canvasNodes, canvasEdges]
  );

  // Keep TeacherOS Academy interactive tutorial compatibility intact
  useEffect(() => {
    if (
      tutorial?.activeTutorial?.tutorialId === 'tutorial.workflow-center' &&
      screen !== 'canvas'
    ) {
      const firstBoard = canvasBoards.find((b) => b.mode === 'workflow');
      if (firstBoard) setActiveBoardId(firstBoard.id);
      setScreen('canvas');
    }
  }, [tutorial?.activeTutorial?.tutorialId, screen, canvasBoards]);

  const activeBoard = useMemo(() => {
    const wfBoards = canvasBoards.filter((b) => b.mode === 'workflow');
    return wfBoards.find((b) => b.id === activeBoardId) ?? wfBoards[0] ?? null;
  }, [canvasBoards, activeBoardId]);

  const activeBoardNodes = useMemo(
    () =>
      activeBoard
        ? canvasNodes.filter((n) => n.boardId === activeBoard.id)
        : [],
    [canvasNodes, activeBoard]
  );

  const activeBoardEdges = useMemo(
    () =>
      activeBoard
        ? canvasEdges.filter((e) => e.boardId === activeBoard.id)
        : [],
    [canvasEdges, activeBoard]
  );

  const activeProgress = useMemo(
    () =>
      computeWorkflowStudioProgressFromCanvas(
        activeBoardNodes,
        activeBoardEdges
      ),
    [activeBoardNodes, activeBoardEdges]
  );

  const syncMirroredRun = useCallback(
    async (
      board: CanvasBoard,
      nextNodes: CanvasNodeRecord[],
      nextEdges: CanvasEdgeRecord[]
    ) => {
      const existingRun =
        workflows.find(
          (w) => w.id === board.linkedWorkflowId || w.canvasBoardId === board.id
        ) ?? null;
      const mirrored = buildMirroredWorkflowRun({
        board,
        nodes: nextNodes,
        edges: nextEdges,
        existingRun,
        idFactory: createId,
      });
      await onSaveWorkflow(mirrored);
      if (board.linkedWorkflowId !== mirrored.id) {
        await onSaveCanvasBoard({ ...board, linkedWorkflowId: mirrored.id });
      }
    },
    [workflows, onSaveWorkflow, onSaveCanvasBoard]
  );

  /**
   * Ensures a unified workflow has a materialized CanvasBoard before opening in Easy or Canvas mode.
   */
  const ensureBoardForWorkflow = useCallback(
    async (workflowId: string): Promise<string | null> => {
      const target = unifiedWorkflows.find((w) => w.id === workflowId);
      if (!target) return null;
      if (target.boardId) return target.boardId;
      if (!target.workflowRun) return null;

      const hydrated = hydrateLegacyWorkflowToBoard(
        target.workflowRun,
        createId
      );
      await onSaveCanvasBoard(hydrated.board);
      await onBulkSaveCanvasBundle(hydrated.nodes, hydrated.edges);
      await onSaveCanvasViewSettings(getDefaultViewSettings(hydrated.board.id));
      await onSaveWorkflow(hydrated.workflowRun);
      return hydrated.board.id;
    },
    [
      unifiedWorkflows,
      onSaveCanvasBoard,
      onBulkSaveCanvasBundle,
      onSaveCanvasViewSettings,
      onSaveWorkflow,
    ]
  );

  const handleOpenEasy = async (workflowId: string) => {
    const boardId = await ensureBoardForWorkflow(workflowId);
    if (!boardId) return;
    setActiveBoardId(boardId);
    setScreen('easy');
  };

  const handleOpenCanvas = async (workflowId: string) => {
    const boardId = await ensureBoardForWorkflow(workflowId);
    if (!boardId) return;
    setActiveBoardId(boardId);
    setScreen('canvas');
  };

  const handleOpenNewCanvasDirect = async () => {
    const firstActive = unifiedWorkflows.find((w) => !w.archived);
    if (firstActive) {
      await handleOpenCanvas(firstActive.id);
      return;
    }
    const created = createQuickWorkflowBundle({
      title: 'Sơ đồ quy trình mới',
      idFactory: createId,
    });
    await onSaveCanvasBoard(created.board);
    await onBulkSaveCanvasBundle(created.nodes, created.edges);
    await onSaveCanvasViewSettings(getDefaultViewSettings(created.board.id));
    await onSaveWorkflow(created.workflowRun);
    setActiveBoardId(created.board.id);
    setScreen('canvas');
    onShowToast('success', 'Đã khởi tạo quy trình mới trên Canvas nâng cao.');
  };

  const handleCreateQuickWorkflow = async (payload: {
    title: string;
    description: string;
    linkedPackId: string;
    initialSteps: string[];
  }) => {
    const created = createQuickWorkflowBundle({
      ...payload,
      idFactory: createId,
    });
    await onSaveCanvasBoard(created.board);
    await onBulkSaveCanvasBundle(created.nodes, created.edges);
    await onSaveCanvasViewSettings(getDefaultViewSettings(created.board.id));
    await onSaveWorkflow(created.workflowRun);
    setQuickCreateOpen(false);
    setActiveBoardId(created.board.id);
    setScreen('easy');
    onShowToast('success', `Đã tạo quy trình "${created.board.title}".`);
  };

  const handleUseTemplate = async (
    templateId: string,
    customTitle?: string
  ) => {
    const created = createWorkflowFromTemplateBundle({
      templateId,
      customTitle,
      idFactory: createId,
    });
    await onSaveCanvasBoard(created.board);
    await onBulkSaveCanvasBundle(created.nodes, created.edges);
    await onSaveCanvasViewSettings(getDefaultViewSettings(created.board.id));
    await onSaveWorkflow(created.workflowRun);
    setTemplatesOpen(false);
    setActiveBoardId(created.board.id);
    setScreen('easy');
    onShowToast(
      'success',
      `Đã tạo quy trình mới từ mẫu "${created.board.title}".`
    );
  };

  const handleConfirmSmartPlanner = async (
    draft: SmartWorkflowParseResult,
    titleOverride: string
  ) => {
    const created = createWorkflowFromSmartDraftBundle({
      draft,
      titleOverride,
      idFactory: createId,
    });
    await onSaveCanvasBoard(created.board);
    await onBulkSaveCanvasBundle(created.nodes, created.edges);
    await onSaveCanvasViewSettings(getDefaultViewSettings(created.board.id));
    await onSaveWorkflow(created.workflowRun);
    setSmartPlannerOpen(false);
    setActiveBoardId(created.board.id);
    setScreen('easy');
    onShowToast(
      'success',
      `Đã tạo quy trình "${created.board.title}" với ${created.workflowRun.steps.length} bước.`
    );
  };

  const handleDuplicateWorkflow = async (wf: UnifiedWorkflowSummary) => {
    let sourceBoard = wf.board;
    let sourceNodes = wf.boardId
      ? canvasNodes.filter((n) => n.boardId === wf.boardId)
      : [];
    let sourceEdges = wf.boardId
      ? canvasEdges.filter((e) => e.boardId === wf.boardId)
      : [];

    if (!sourceBoard && wf.workflowRun) {
      const hydrated = hydrateLegacyWorkflowToBoard(wf.workflowRun, createId);
      sourceBoard = hydrated.board;
      sourceNodes = hydrated.nodes;
      sourceEdges = hydrated.edges;
    }
    if (!sourceBoard) return;

    const dup = duplicateWorkflowBundle({
      sourceBoard,
      sourceNodes,
      sourceEdges,
      idFactory: createId,
    });
    await onSaveCanvasBoard(dup.board);
    await onBulkSaveCanvasBundle(dup.nodes, dup.edges);
    await onSaveCanvasViewSettings(getDefaultViewSettings(dup.board.id));
    await onSaveWorkflow(dup.workflowRun);
    onShowToast('success', `Đã nhân bản "${dup.board.title}".`);
  };

  const handleRenameWorkflow = async (
    wf: UnifiedWorkflowSummary,
    nextTitle: string
  ) => {
    if (wf.board) {
      await onSaveCanvasBoard({ ...wf.board, title: nextTitle });
    }
    if (wf.workflowRun) {
      await onSaveWorkflow({ ...wf.workflowRun, title: nextTitle });
    }
    onShowToast('success', `Đã đổi tên thành "${nextTitle}".`);
  };

  const handleToggleArchiveWorkflow = async (wf: UnifiedWorkflowSummary) => {
    const nextArchived = !wf.archived;
    if (wf.board) {
      await onSaveCanvasBoard({ ...wf.board, archived: nextArchived });
    }
    if (wf.workflowRun) {
      await onSaveWorkflow({ ...wf.workflowRun, archived: nextArchived });
    }
    onShowToast(
      'info',
      nextArchived
        ? `Đã chuyển "${wf.title}" vào mục Lưu trữ.`
        : `Đã khôi phục "${wf.title}".`
    );
  };

  const handleDeleteUnifiedWorkflow = async (wf: UnifiedWorkflowSummary) => {
    if (wf.boardId && onDeleteCanvasBoard) {
      await onDeleteCanvasBoard(wf.boardId);
    }
    if (wf.workflowRunId) {
      await onDeleteWorkflow(wf.workflowRunId);
    }
    if (activeBoardId === wf.boardId) {
      setActiveBoardId('');
      setScreen('home');
    }
    if (!wf.workflowRunId) {
      onShowToast('success', `Đã xóa quy trình "${wf.title}".`);
    }
  };

  // --- Easy Workflow Handlers (operate directly on unified Canvas nodes/edges + sync WorkflowRun) ---
  const handleUpdateBoardMeta = async (patch: Partial<CanvasBoard>) => {
    if (!activeBoard) return;
    const updatedBoard: CanvasBoard = { ...activeBoard, ...patch };
    await onSaveCanvasBoard(updatedBoard);
    await syncMirroredRun(updatedBoard, activeBoardNodes, activeBoardEdges);
  };

  const handleEasyAddStep = async (title: string) => {
    if (!activeBoard) return;
    const { node, addedEdges } = addEasyWorkflowStep({
      boardId: activeBoard.id,
      existingNodes: activeBoardNodes,
      existingEdges: activeBoardEdges,
      title,
      idFactory: createId,
    });
    const nextNodes = [...activeBoardNodes, node];
    const nextEdges = [...activeBoardEdges, ...addedEdges];
    await onBulkSaveCanvasBundle([node], addedEdges);
    await syncMirroredRun(activeBoard, nextNodes, nextEdges);
  };

  const handleEasyToggleStepDone = async (stepId: string) => {
    if (!activeBoard) return;
    const result = toggleEasyWorkflowStepDone({
      stepId,
      nodes: activeBoardNodes,
      edges: activeBoardEdges,
    });
    if (!result.ok) {
      if (result.blockedByTitles && result.blockedByTitles.length > 0) {
        onShowToast(
          'error',
          `Bước này đang bị chặn. Hãy hoàn thành trước: ${result.blockedByTitles.join(', ')}.`
        );
      }
      return;
    }
    const updatedNode = result.updatedNode!;
    const nextNodes = activeBoardNodes.map((n) =>
      n.id === updatedNode.id ? updatedNode : n
    );
    await onSaveCanvasNode(updatedNode);
    await syncMirroredRun(activeBoard, nextNodes, activeBoardEdges);
  };

  const handleEasyUpdateStepNode = async (
    nodeId: string,
    patch: Partial<CanvasNodeRecord>
  ) => {
    if (!activeBoard) return;
    const target = activeBoardNodes.find((n) => n.id === nodeId);
    if (!target) return;
    const updatedNode: CanvasNodeRecord = { ...target, ...patch };
    const nextNodes = activeBoardNodes.map((n) =>
      n.id === nodeId ? updatedNode : n
    );
    await onSaveCanvasNode(updatedNode);
    await syncMirroredRun(activeBoard, nextNodes, activeBoardEdges);
  };

  const handleEasyReorderStep = async (
    stepId: string,
    direction: 'up' | 'down'
  ) => {
    if (!activeBoard) return;
    const updatedSteps = reorderEasyWorkflowStep({
      nodes: activeBoardNodes,
      edges: activeBoardEdges,
      stepId,
      direction,
    });
    if (updatedSteps.length === 0) return;
    const updatedMap = new Map(updatedSteps.map((n) => [n.id, n]));
    const nextNodes = activeBoardNodes.map((n) => updatedMap.get(n.id) ?? n);
    await onBulkSaveCanvasNodes(updatedSteps);
    await syncMirroredRun(activeBoard, nextNodes, activeBoardEdges);
  };

  const handleEasyDuplicateStep = async (stepId: string) => {
    if (!activeBoard) return;
    const source = activeBoardNodes.find((n) => n.id === stepId);
    if (!source) return;
    const { node, addedEdges } = duplicateEasyWorkflowStep({
      sourceNode: source,
      existingNodes: activeBoardNodes,
      existingEdges: activeBoardEdges,
      idFactory: createId,
    });
    const nextNodes = [...activeBoardNodes, node];
    const nextEdges = [...activeBoardEdges, ...addedEdges];
    await onBulkSaveCanvasBundle([node], addedEdges);
    await syncMirroredRun(activeBoard, nextNodes, nextEdges);
    onShowToast('success', `Đã nhân bản bước "${source.title}".`);
  };

  const handleEasyDeleteStep = async (stepId: string) => {
    if (!activeBoard) return;
    const nextNodes = activeBoardNodes.filter((n) => n.id !== stepId);
    const nextEdges = activeBoardEdges.filter(
      (e) => e.source !== stepId && e.target !== stepId
    );
    await onDeleteCanvasNode(stepId);
    await syncMirroredRun(activeBoard, nextNodes, nextEdges);
    onShowToast('info', 'Đã xóa bước khỏi quy trình.');
  };

  const handleEasyAddDependency = async (
    prerequisiteId: string,
    stepId: string
  ) => {
    if (!activeBoard) return;
    const created = createStepDependencyEdge({
      boardId: activeBoard.id,
      nodes: activeBoardNodes,
      edges: activeBoardEdges,
      prerequisiteId,
      stepId,
      idFactory: createId,
    });
    if (!created.valid || !created.edge) {
      onShowToast(
        'error',
        created.reason || 'Không thể thêm quan hệ phụ thuộc này.'
      );
      return;
    }
    await onSaveCanvasEdge(created.edge);
    onShowToast('success', 'Đã gắn điều kiện phụ thuộc cho bước.');
  };

  const handleEasyRemoveDependency = async (
    prerequisiteId: string,
    stepId: string
  ) => {
    const match = activeBoardEdges.find(
      (e) =>
        e.edgeType === 'dependency' &&
        e.source === prerequisiteId &&
        e.target === stepId
    );
    if (!match) return;
    await onDeleteCanvasEdge(match.id);
    onShowToast('info', 'Đã gỡ điều kiện phụ thuộc.');
  };

  // --- Pro Canvas Sync Wrappers (keep mirrored WorkflowRun updated when user edits in Pro Canvas) ---
  const handleCanvasSaveNodeSynced = async (node: CanvasNodeRecord) => {
    await onSaveCanvasNode(node);
    const board = canvasBoards.find(
      (b) => b.id === node.boardId && b.mode === 'workflow'
    );
    if (board) {
      const bNodes = [
        ...canvasNodes.filter(
          (n) => n.boardId === board.id && n.id !== node.id
        ),
        node,
      ];
      const bEdges = canvasEdges.filter((e) => e.boardId === board.id);
      await syncMirroredRun(board, bNodes, bEdges);
    }
  };

  const handleCanvasDeleteNodeSynced = async (nodeId: string) => {
    const target = canvasNodes.find((n) => n.id === nodeId);
    await onDeleteCanvasNode(nodeId);
    if (target) {
      const board = canvasBoards.find(
        (b) => b.id === target.boardId && b.mode === 'workflow'
      );
      if (board) {
        const bNodes = canvasNodes.filter(
          (n) => n.boardId === board.id && n.id !== nodeId
        );
        const bEdges = canvasEdges.filter(
          (e) =>
            e.boardId === board.id && e.source !== nodeId && e.target !== nodeId
        );
        await syncMirroredRun(board, bNodes, bEdges);
      }
    }
  };

  if (screen === 'canvas') {
    return (
      <>
        <VisualWorkspaceCanvas
          mode="workflow"
          theme={theme}
          boards={canvasBoards}
          nodes={canvasNodes}
          edges={canvasEdges}
          viewSettingsList={canvasViewSettings}
          collections={{ packs, resources, journals, workflows, mathExams }}
          controlledBoardId={activeBoard?.id}
          onBoardChange={(boardId) => setActiveBoardId(boardId)}
          onBackToHome={() => setScreen('home')}
          classicViewLabel="Chế độ đơn giản"
          onSwitchToClassicView={() => setScreen('easy')}
          onSaveBoard={onSaveCanvasBoard}
          onSaveNode={handleCanvasSaveNodeSynced}
          onBulkSaveNodes={onBulkSaveCanvasNodes}
          onBulkSaveBundle={onBulkSaveCanvasBundle}
          onDeleteNode={handleCanvasDeleteNodeSynced}
          onBulkDeleteNodes={onBulkDeleteCanvasNodes}
          onSaveEdge={onSaveCanvasEdge}
          onDeleteEdge={onDeleteCanvasEdge}
          onReplaceBoardState={onReplaceBoardCanvasState}
          onSaveViewSettings={onSaveCanvasViewSettings}
          onOpenEntity={(ref) => {
            if (ref.kind === 'WorkflowRun') {
              const found = unifiedWorkflows.find(
                (w) => w.workflowRunId === ref.entityId || w.id === ref.entityId
              );
              if (found) {
                void handleOpenEasy(found.id);
                return;
              }
            }
            onOpenCanvasEntity(ref);
          }}
          onNavigateApp={(appId) =>
            onNavigateApp(appId, activeBoard?.linkedPackId || undefined)
          }
          onShowToast={onShowToast}
        />
      </>
    );
  }

  return (
    <>
      {screen === 'easy' && activeBoard ? (
        <EasyWorkflowEditor
          board={activeBoard}
          nodes={activeBoardNodes}
          edges={activeBoardEdges}
          progress={activeProgress}
          packs={packs}
          resources={resources}
          onBackHome={() => setScreen('home')}
          onSwitchToCanvas={() => setScreen('canvas')}
          onUpdateBoardMeta={(patch) => void handleUpdateBoardMeta(patch)}
          onAddStep={(title) => void handleEasyAddStep(title)}
          onToggleStepDone={(id) => void handleEasyToggleStepDone(id)}
          onUpdateStepNode={(nodeId, patch) =>
            void handleEasyUpdateStepNode(nodeId, patch)
          }
          onReorderStep={(id, dir) => void handleEasyReorderStep(id, dir)}
          onDuplicateStep={(id) => void handleEasyDuplicateStep(id)}
          onDeleteStep={(id) => void handleEasyDeleteStep(id)}
          onAddDependency={(prereq, stepId) =>
            void handleEasyAddDependency(prereq, stepId)
          }
          onRemoveDependency={(prereq, stepId) =>
            void handleEasyRemoveDependency(prereq, stepId)
          }
          onNavigateApp={onNavigateApp}
        />
      ) : (
        <WorkflowHomeView
          workflows={unifiedWorkflows}
          onOpenEasy={(id) => void handleOpenEasy(id)}
          onOpenCanvas={(id) => void handleOpenCanvas(id)}
          onOpenQuickCreate={() => setQuickCreateOpen(true)}
          onOpenTemplates={() => setTemplatesOpen(true)}
          onOpenSmartPlanner={() => setSmartPlannerOpen(true)}
          onOpenNewCanvasDirect={() => void handleOpenNewCanvasDirect()}
          onDuplicateWorkflow={(wf) => void handleDuplicateWorkflow(wf)}
          onRenameWorkflow={(wf, nextTitle) =>
            void handleRenameWorkflow(wf, nextTitle)
          }
          onToggleArchiveWorkflow={(wf) => void handleToggleArchiveWorkflow(wf)}
          onDeleteWorkflow={(wf) => void handleDeleteUnifiedWorkflow(wf)}
        />
      )}

      {/* Quick Create Modal */}
      <QuickCreateWorkflowModal
        open={quickCreateOpen}
        packs={packs}
        onClose={() => setQuickCreateOpen(false)}
        onCreate={(payload) => void handleCreateQuickWorkflow(payload)}
        onSwitchToTemplates={() => {
          setQuickCreateOpen(false);
          setTemplatesOpen(true);
        }}
        onSwitchToSmartPlanner={() => {
          setQuickCreateOpen(false);
          setSmartPlannerOpen(true);
        }}
      />

      {/* 5-Template Library Modal */}
      <WorkflowTemplateModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onUseTemplate={(tplId, customTitle) =>
          void handleUseTemplate(tplId, customTitle)
        }
      />

      {/* Local Rule-Based Smart Planner Modal */}
      <SmartPlannerModal
        open={smartPlannerOpen}
        onClose={() => setSmartPlannerOpen(false)}
        onConfirmCreateWorkflow={(draft, titleOverride) =>
          void handleConfirmSmartPlanner(draft, titleOverride)
        }
      />
    </>
  );
}

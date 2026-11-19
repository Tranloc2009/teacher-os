import type { AppId } from './appRegistry';
import {
  createCanvasNode,
  normalizeVietnameseText,
  validateNewEdge,
} from './canvasEngine';
import {
  analyzeWorkflowDependencies,
  getEffectiveTaskStatus,
  type IdFactory,
} from './canvasLayout';
import {
  buildCanvasCommitBundle,
  type SmartWorkflowParseResult,
} from './smartWorkflowParser';
import {
  getWorkflowStudioTemplateById,
  type WorkflowStudioTemplate,
} from '../data/workflowTemplates';
import type {
  CanvasBoard,
  CanvasChecklistItem,
  CanvasEdgeRecord,
  CanvasNodeRecord,
  CanvasPriority,
  CanvasTaskStatus,
} from '../types/canvas';
import type {
  WorkflowPhase,
  WorkflowRun,
  WorkflowStepItem,
} from '../types/lesson';

export type WorkflowStatusFilter = 'all' | 'active' | 'completed' | 'archived';

export interface UnifiedWorkflowStep {
  id: string;
  title: string;
  description: string;
  notes: string;
  type: CanvasNodeRecord['type'];
  status: CanvasTaskStatus;
  priority: CanvasPriority;
  dueDate?: string;
  checklist: CanvasChecklistItem[];
  suggestedAppId?: AppId;
  linkedResourceId?: string;
  orderIndex: number;
  dependsOnIds: string[];
  blockedByIds: string[];
  blockedByTitles: string[];
  unlocksTitles: string[];
  isDependencyBlocked: boolean;
  /** Original canvas node record if backed by a CanvasBoard */
  sourceNode?: CanvasNodeRecord;
}

export type NextStepRecommendation =
  | { kind: 'completed'; steps: [] }
  | { kind: 'single'; step: UnifiedWorkflowStep; reason: string }
  | { kind: 'multiple'; steps: UnifiedWorkflowStep[]; reason: string }
  | { kind: 'blocked'; steps: UnifiedWorkflowStep[]; reason: string };

export interface WorkflowGraphComplexity {
  isComplex: boolean;
  reasons: string[];
  branchNodeCount: number;
  referenceEdgeCount: number;
  nonStepNodeCount: number;
  multiDependencyNodeCount: number;
}

export interface WorkflowStudioProgress {
  totalSteps: number;
  doneSteps: number;
  remainingSteps: number;
  inProgressSteps: number;
  blockedSteps: number;
  percent: number;
  nearestDueDate: string | null;
  orderedSteps: UnifiedWorkflowStep[];
  nextRecommendation: NextStepRecommendation;
  complexity: WorkflowGraphComplexity;
}

export interface UnifiedWorkflowSummary {
  /** Primary key in Studio (board.id when board exists, else workflow.id) */
  id: string;
  boardId: string | null;
  workflowRunId: string | null;
  title: string;
  description: string;
  linkedPackId: string;
  templateId?: string;
  archived: boolean;
  updatedAt: string;
  progress: WorkflowStudioProgress;
  board: CanvasBoard | null;
  workflowRun: WorkflowRun | null;
}

export interface WorkflowCommitBundle {
  board: CanvasBoard;
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  workflowRun: WorkflowRun;
}

const STEP_NODE_TYPES = new Set<CanvasNodeRecord['type']>([
  'task',
  'checklist',
  'milestone',
  'workflow',
]);

export function isActionableWorkflowNode(node: CanvasNodeRecord): boolean {
  if (node.type === 'root') return false;
  return STEP_NODE_TYPES.has(node.type) || node.status !== undefined;
}

/**
 * Computes topological depth for actionable workflow nodes based on dependency edges,
 * then orders deterministically by explicit orderIndex -> topological depth -> position -> createdAt.
 */
export function orderWorkflowStepNodes(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[]
): CanvasNodeRecord[] {
  const stepNodes = nodes.filter(isActionableWorkflowNode);
  if (stepNodes.length <= 1) return stepNodes;

  const nodeIds = new Set(stepNodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of stepNodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (e.edgeType !== 'dependency') continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    incoming.get(e.target)!.push(e.source);
    outgoing.get(e.source)!.push(e.target);
  }

  // Compute DAG level using Kahn-like relaxation (safe against unexpected cycles)
  const level = new Map<string, number>();
  for (const n of stepNodes) level.set(n.id, 0);
  for (let pass = 0; pass < stepNodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      if (e.edgeType !== 'dependency') continue;
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
      const candidate = (level.get(e.source) ?? 0) + 1;
      if (candidate > (level.get(e.target) ?? 0)) {
        level.set(e.target, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const hasExplicitOrder = stepNodes.some(
    (n) => typeof n.orderIndex === 'number' && Number.isFinite(n.orderIndex)
  );

  return [...stepNodes].sort((a, b) => {
    if (hasExplicitOrder) {
      const oa =
        typeof a.orderIndex === 'number' ? a.orderIndex : Number.MAX_SAFE_INTEGER;
      const ob =
        typeof b.orderIndex === 'number' ? b.orderIndex : Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
    }
    const la = level.get(a.id) ?? 0;
    const lb = level.get(b.id) ?? 0;
    if (la !== lb) return la - lb;
    const dy = a.position.y - b.position.y;
    if (Math.abs(dy) > 40) return dy;
    const dx = a.position.x - b.position.x;
    if (dx !== 0) return dx;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function analyzeWorkflowGraphComplexity(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[]
): WorkflowGraphComplexity {
  const stepIds = new Set(nodes.filter(isActionableWorkflowNode).map((n) => n.id));
  const depOutCount = new Map<string, number>();
  const depInCount = new Map<string, number>();
  let referenceEdgeCount = 0;

  for (const e of edges) {
    if (e.edgeType === 'reference') {
      referenceEdgeCount++;
      continue;
    }
    if (
      e.edgeType === 'dependency' &&
      stepIds.has(e.source) &&
      stepIds.has(e.target)
    ) {
      depOutCount.set(e.source, (depOutCount.get(e.source) ?? 0) + 1);
      depInCount.set(e.target, (depInCount.get(e.target) ?? 0) + 1);
    }
  }

  let branchNodeCount = 0;
  for (const count of depOutCount.values()) {
    if (count > 1) branchNodeCount++;
  }
  let multiDependencyNodeCount = 0;
  for (const count of depInCount.values()) {
    if (count > 1) multiDependencyNodeCount++;
  }

  const nonStepNodeCount = nodes.filter(
    (n) => n.type !== 'root' && !isActionableWorkflowNode(n)
  ).length;

  const reasons: string[] = [];
  if (branchNodeCount > 0) {
    reasons.push(`${branchNodeCount} điểm rẽ nhánh song song trên Canvas`);
  }
  if (multiDependencyNodeCount > 0) {
    reasons.push(`${multiDependencyNodeCount} bước hội tụ nhiều điều kiện phụ thuộc`);
  }
  if (referenceEdgeCount > 0) {
    reasons.push(`${referenceEdgeCount} liên kết tham chiếu giữa các khối`);
  }
  if (nonStepNodeCount > 0) {
    reasons.push(`${nonStepNodeCount} khối ghi chú / tài liệu cấu trúc trên Canvas`);
  }

  return {
    isComplex: reasons.length > 0,
    reasons,
    branchNodeCount,
    referenceEdgeCount,
    nonStepNodeCount,
    multiDependencyNodeCount,
  };
}

export function computeWorkflowStudioProgressFromCanvas(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[]
): WorkflowStudioProgress {
  const orderedNodes = orderWorkflowStepNodes(nodes, edges);
  const depSummary = analyzeWorkflowDependencies(nodes, edges);
  const complexity = analyzeWorkflowGraphComplexity(nodes, edges);

  const incomingDepsByTarget = new Map<string, string[]>();
  const stepIdSet = new Set(orderedNodes.map((n) => n.id));
  for (const e of edges) {
    if (
      e.edgeType === 'dependency' &&
      stepIdSet.has(e.source) &&
      stepIdSet.has(e.target)
    ) {
      const list = incomingDepsByTarget.get(e.target);
      if (list) list.push(e.source);
      else incomingDepsByTarget.set(e.target, [e.source]);
    }
  }

  const orderedSteps: UnifiedWorkflowStep[] = orderedNodes.map((node, index) => {
    const depStatus = depSummary.byNodeId[node.id];
    const effective = getEffectiveTaskStatus(node) ?? 'todo';
    return {
      id: node.id,
      title: node.title,
      description: node.description ?? '',
      notes: node.notes ?? '',
      type: node.type,
      status: effective,
      priority: node.priority ?? 'medium',
      dueDate: node.dueDate,
      checklist: Array.isArray(node.checklist) ? node.checklist : [],
      suggestedAppId: node.suggestedAppId,
      linkedResourceId: node.linkedResourceId,
      orderIndex:
        typeof node.orderIndex === 'number' ? node.orderIndex : index,
      dependsOnIds: incomingDepsByTarget.get(node.id) ?? [],
      blockedByIds: depStatus?.blockedByNodeIds ?? [],
      blockedByTitles: depStatus?.blockedByTitles ?? [],
      unlocksTitles: depStatus?.unlocksTitles ?? [],
      isDependencyBlocked: Boolean(depStatus?.isDependencyBlocked),
      sourceNode: node,
    };
  });

  return finalizeProgressStats(orderedSteps, complexity);
}

export function computeWorkflowStudioProgressFromLegacyRun(
  run: WorkflowRun
): WorkflowStudioProgress {
  const orderedSteps: UnifiedWorkflowStep[] = run.steps.map((step, index) => {
    const status: CanvasTaskStatus = step.done
      ? 'done'
      : step.status ?? 'todo';
    return {
      id: step.id,
      title: step.label,
      description: step.description ?? '',
      notes: step.notes ?? '',
      type: 'task',
      status,
      priority: step.priority ?? 'medium',
      dueDate: step.dueDate,
      checklist: [],
      suggestedAppId: step.targetApp as AppId | undefined,
      linkedResourceId: step.linkedResourceId,
      orderIndex: index,
      dependsOnIds: [],
      blockedByIds: [],
      blockedByTitles: [],
      unlocksTitles: [],
      isDependencyBlocked: false,
    };
  });

  return finalizeProgressStats(orderedSteps, {
    isComplex: false,
    reasons: [],
    branchNodeCount: 0,
    referenceEdgeCount: 0,
    nonStepNodeCount: 0,
    multiDependencyNodeCount: 0,
  });
}

function finalizeProgressStats(
  orderedSteps: UnifiedWorkflowStep[],
  complexity: WorkflowGraphComplexity
): WorkflowStudioProgress {
  const totalSteps = orderedSteps.length;
  let doneSteps = 0;
  let inProgressSteps = 0;
  let blockedSteps = 0;

  const dueDates: string[] = [];

  for (const step of orderedSteps) {
    if (step.status === 'done') {
      doneSteps++;
    } else {
      if (step.status === 'in_progress') inProgressSteps++;
      if (step.isDependencyBlocked || step.status === 'blocked') {
        blockedSteps++;
      }
      if (step.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(step.dueDate)) {
        dueDates.push(step.dueDate);
      }
    }
  }

  dueDates.sort();
  const nearestDueDate = dueDates[0] ?? null;
  const remainingSteps = totalSteps - doneSteps;
  const percent = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  const nextRecommendation = determineNextStepRecommendation(orderedSteps);

  return {
    totalSteps,
    doneSteps,
    remainingSteps,
    inProgressSteps,
    blockedSteps,
    percent,
    nearestDueDate,
    orderedSteps,
    nextRecommendation,
    complexity,
  };
}

/**
 * Determines the honest "Next Step" strictly from step order & dependencies.
 * Never fabricates or guesses when multiple independent tasks are ready without ordering cues.
 */
function determineNextStepRecommendation(
  orderedSteps: UnifiedWorkflowStep[]
): NextStepRecommendation {
  if (orderedSteps.length === 0) {
    return { kind: 'completed', steps: [] };
  }

  const incomplete = orderedSteps.filter((s) => s.status !== 'done');
  if (incomplete.length === 0) {
    return { kind: 'completed', steps: [] };
  }

  const ready = incomplete.filter(
    (s) => !s.isDependencyBlocked && s.status !== 'blocked'
  );

  if (ready.length === 0) {
    return {
      kind: 'blocked',
      steps: incomplete,
      reason:
        'Các bước còn lại đang bị chặn bởi điều kiện phụ thuộc hoặc đang tạm dừng.',
    };
  }

  if (ready.length === 1) {
    const only = ready[0];
    const reason =
      only.status === 'in_progress'
        ? 'Bước duy nhất đang thực hiện.'
        : only.unlocksTitles.length > 0
        ? `Hoàn thành bước này để mở khóa "${only.unlocksTitles[0]}".`
        : 'Bước duy nhất sẵn sàng thực hiện theo thứ tự và phụ thuộc.';
    return { kind: 'single', step: only, reason };
  }

  // If there is exactly ONE step already marked in_progress, highlight it honestly
  const inProgressReady = ready.filter((s) => s.status === 'in_progress');
  if (inProgressReady.length === 1) {
    return {
      kind: 'single',
      step: inProgressReady[0],
      reason: 'Bước đang thực hiện dở dang.',
    };
  }

  // If any ready step strictly unlocks downstream steps while others do not, check if there's a unique blocker
  const unlockingReady = ready.filter((s) => s.unlocksTitles.length > 0);
  if (unlockingReady.length === 1) {
    return {
      kind: 'single',
      step: unlockingReady[0],
      reason: `Bước tiên quyết mở khóa "${unlockingReady[0].unlocksTitles[0]}".`,
    };
  }

  // Multiple independent ready steps: be honest and show the list instead of guessing
  return {
    kind: 'multiple',
    steps: ready,
    reason: `Có ${ready.length} bước độc lập đã sẵn sàng — bạn có thể chọn bắt đầu bất kỳ bước nào dưới đây.`,
  };
}

/**
 * Checks whether a step can safely be marked as done without violating dependency prerequisites.
 */
export function canMarkStepDone(
  stepId: string,
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[]
): { allowed: boolean; blockedByTitles: string[] } {
  const depSummary = analyzeWorkflowDependencies(nodes, edges);
  const status = depSummary.byNodeId[stepId];
  if (status?.isDependencyBlocked) {
    return {
      allowed: false,
      blockedByTitles: status.blockedByTitles,
    };
  }
  return { allowed: true, blockedByTitles: [] };
}

/**
 * Builds the unified workflow list for Workflow Studio 2.0 Home without duplicating paired records
 * and without hiding legacy WorkflowRun items or standalone workflow CanvasBoards.
 */
export function buildUnifiedWorkflowCatalog(params: {
  workflows: WorkflowRun[];
  canvasBoards: CanvasBoard[];
  canvasNodes: CanvasNodeRecord[];
  canvasEdges: CanvasEdgeRecord[];
}): UnifiedWorkflowSummary[] {
  const { workflows, canvasBoards, canvasNodes, canvasEdges } = params;
  const workflowBoards = canvasBoards.filter((b) => b.mode === 'workflow');
  const workflowById = new Map(workflows.map((w) => [w.id, w]));
  const claimedWorkflowIds = new Set<string>();

  const summaries: UnifiedWorkflowSummary[] = [];

  // 1. All CanvasBoards with mode === 'workflow' (paired with linkedWorkflowId if present)
  for (const board of workflowBoards) {
    const linkedRun =
      (board.linkedWorkflowId
        ? workflowById.get(board.linkedWorkflowId)
        : undefined) ??
      workflows.find((w) => w.canvasBoardId === board.id) ??
      null;

    if (linkedRun) {
      claimedWorkflowIds.add(linkedRun.id);
    }

    const bNodes = canvasNodes.filter((n) => n.boardId === board.id);
    const bEdges = canvasEdges.filter((e) => e.boardId === board.id);
    const progress = computeWorkflowStudioProgressFromCanvas(bNodes, bEdges);

    const latestUpdated =
      linkedRun && linkedRun.updatedAt > board.updatedAt
        ? linkedRun.updatedAt
        : board.updatedAt;

    summaries.push({
      id: board.id,
      boardId: board.id,
      workflowRunId: linkedRun?.id ?? board.linkedWorkflowId ?? null,
      title: board.title || linkedRun?.title || 'Quy trình chưa đặt tên',
      description: board.description || linkedRun?.description || '',
      linkedPackId: board.linkedPackId ?? linkedRun?.linkedPackId ?? '',
      templateId: board.templateId ?? linkedRun?.templateId,
      archived: Boolean(board.archived ?? linkedRun?.archived),
      updatedAt: latestUpdated,
      progress,
      board,
      workflowRun: linkedRun,
    });
  }

  // 2. Any legacy WorkflowRun that does not yet have a CanvasBoard
  for (const run of workflows) {
    if (claimedWorkflowIds.has(run.id)) continue;
    const progress = computeWorkflowStudioProgressFromLegacyRun(run);
    summaries.push({
      id: run.id,
      boardId: null,
      workflowRunId: run.id,
      title: run.title || 'Quy trình chưa đặt tên',
      description: run.description ?? '',
      linkedPackId: run.linkedPackId ?? '',
      templateId: run.templateId,
      archived: Boolean(run.archived),
      updatedAt: run.updatedAt,
      progress,
      board: null,
      workflowRun: run,
    });
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function filterUnifiedWorkflows(
  items: UnifiedWorkflowSummary[],
  query: string,
  statusFilter: WorkflowStatusFilter
): UnifiedWorkflowSummary[] {
  const cleanQ = normalizeVietnameseText(query);
  return items.filter((item) => {
    const isCompleted =
      item.progress.totalSteps > 0 &&
      item.progress.doneSteps === item.progress.totalSteps;

    if (statusFilter === 'archived') {
      if (!item.archived) return false;
    } else if (statusFilter === 'completed') {
      if (item.archived || !isCompleted) return false;
    } else if (statusFilter === 'active') {
      if (item.archived || isCompleted) return false;
    } else {
      // 'all' hides archived by default? Wait: users expect 'Tất cả' to show active + completed (non-archived) unless archived tab selected,
      // so archived workflows stay cleanly out of the way until 'Đã lưu trữ' is selected.
      if (item.archived) return false;
    }

    if (!cleanQ) return true;
    const stepText = item.progress.orderedSteps.map((s) => s.title).join(' ');
    const hay = normalizeVietnameseText(
      `${item.title} ${item.description} ${stepText}`
    );
    return hay.includes(cleanQ);
  });
}

function mapAppIdToLegacyTargetApp(
  appId: AppId | undefined
): WorkflowStepItem['targetApp'] {
  if (
    appId === 'lesson-studio' ||
    appId === 'print-studio' ||
    appId === 'resource-vault' ||
    appId === 'teaching-journal' ||
    appId === 'math-mixer'
  ) {
    return appId;
  }
  return undefined;
}

/**
 * Syncs a CanvasBoard + its nodes into a mirrored WorkflowRun record so DesktopHome,
 * ToolsHub, and BackupPayload stay 100% consistent with real workflow state.
 */
export function buildMirroredWorkflowRun(params: {
  board: CanvasBoard;
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  existingRun?: WorkflowRun | null;
  idFactory: IdFactory;
}): WorkflowRun {
  const { board, nodes, edges, existingRun, idFactory } = params;
  const orderedNodes = orderWorkflowStepNodes(nodes, edges);
  const runId = existingRun?.id ?? board.linkedWorkflowId ?? idFactory('wf');

  const steps: WorkflowStepItem[] = orderedNodes.map((node, idx) => {
    const effective = getEffectiveTaskStatus(node) ?? 'todo';
    const ratio = orderedNodes.length > 1 ? idx / (orderedNodes.length - 1) : 0;
    const phase: WorkflowPhase =
      ratio < 0.5 ? 'pre-class' : ratio < 0.85 ? 'in-class' : 'post-class';

    return {
      id: node.id,
      phase,
      label: node.title,
      done: effective === 'done',
      status: effective,
      description: node.description || undefined,
      priority: node.priority,
      dueDate: node.dueDate,
      notes: node.notes,
      linkedResourceId: node.linkedResourceId,
      targetApp: mapAppIdToLegacyTargetApp(node.suggestedAppId),
    };
  });

  return {
    id: runId,
    title: board.title,
    description: board.description,
    linkedPackId: board.linkedPackId ?? existingRun?.linkedPackId ?? '',
    canvasBoardId: board.id,
    templateId: board.templateId ?? existingRun?.templateId,
    archived: Boolean(board.archived),
    steps,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Materializes a legacy WorkflowRun (that had no CanvasBoard yet) into a unified CanvasBoard + nodes + edges
 * with 100% lossless preservation of step IDs, titles, done flags, and targetApp links.
 */
export function hydrateLegacyWorkflowToBoard(
  run: WorkflowRun,
  idFactory: IdFactory
): WorkflowCommitBundle {
  const now = new Date().toISOString();
  const boardId = run.canvasBoardId || idFactory('cwf');
  const rootId = idFactory('cnode');

  const board: CanvasBoard = {
    id: boardId,
    mode: 'workflow',
    title: run.title || 'Quy trình giảng dạy',
    description: run.description ?? '',
    linkedWorkflowId: run.id,
    linkedPackId: run.linkedPackId ?? '',
    templateId: run.templateId,
    archived: Boolean(run.archived),
    createdAt: run.updatedAt || now,
    updatedAt: now,
  };

  const rootNode = createCanvasNode({
    id: rootId,
    boardId,
    type: 'root',
    mode: 'workflow',
    title: board.title,
    description: board.description || 'Quy trình giảng dạy trong Workflow Studio',
    position: { x: 80, y: 180 },
    color: 'indigo',
  });

  const nodes: CanvasNodeRecord[] = [rootNode];
  const edges: CanvasEdgeRecord[] = [];

  run.steps.forEach((step, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const node = createCanvasNode({
      id: step.id || idFactory('cnode'),
      boardId,
      type: 'task',
      mode: 'workflow',
      title: step.label,
      description: step.description ?? '',
      parentId: rootId,
      position: { x: 400 + col * 310, y: 80 + row * 210 },
      status: step.done ? 'done' : step.status ?? 'todo',
      color: step.done ? 'emerald' : 'blue',
    });
    node.orderIndex = idx;
    node.priority = step.priority ?? 'medium';
    if (step.dueDate) node.dueDate = step.dueDate;
    if (step.notes) node.notes = step.notes;
    if (step.linkedResourceId) node.linkedResourceId = step.linkedResourceId;
    if (step.targetApp) node.suggestedAppId = step.targetApp;

    nodes.push(node);
    edges.push({
      id: idFactory('edge'),
      boardId,
      source: rootId,
      target: node.id,
      edgeType: 'parent',
    });
  });

  const syncedRun: WorkflowRun = {
    ...run,
    canvasBoardId: boardId,
    updatedAt: now,
  };

  return { board, nodes, edges, workflowRun: syncedRun };
}

/**
 * Creates a brand-new Quick Workflow (never overwrites existing workflows).
 */
export function createQuickWorkflowBundle(params: {
  title: string;
  description?: string;
  linkedPackId?: string;
  initialSteps?: string[];
  idFactory: IdFactory;
}): WorkflowCommitBundle {
  const { title, description = '', linkedPackId = '', idFactory } = params;
  const now = new Date().toISOString();
  const boardId = idFactory('cwf');
  const workflowRunId = idFactory('wf');
  const rootId = idFactory('cnode');

  const board: CanvasBoard = {
    id: boardId,
    mode: 'workflow',
    title: title.trim() || 'Quy trình làm việc mới',
    description: description.trim(),
    linkedWorkflowId: workflowRunId,
    linkedPackId,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  const rootNode = createCanvasNode({
    id: rootId,
    boardId,
    type: 'root',
    mode: 'workflow',
    title: board.title,
    description: board.description || 'Mục tiêu chính của quy trình',
    position: { x: 60, y: 180 },
    color: 'indigo',
  });

  const stepLabels = (params.initialSteps ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const finalLabels =
    stepLabels.length > 0
      ? stepLabels
      : ['Bước 1: Xác định mục tiêu và nội dung cần chuẩn bị'];

  const nodes: CanvasNodeRecord[] = [rootNode];
  const edges: CanvasEdgeRecord[] = [];
  let prevStepId: string | null = null;

  finalLabels.forEach((label, idx) => {
    const node = createCanvasNode({
      id: idFactory('cnode'),
      boardId,
      type: 'task',
      mode: 'workflow',
      title: label,
      parentId: rootId,
      position: { x: 390 + (idx % 3) * 310, y: 100 + Math.floor(idx / 3) * 200 },
      status: 'todo',
      color: 'blue',
    });
    node.orderIndex = idx;
    nodes.push(node);
    edges.push({
      id: idFactory('edge'),
      boardId,
      source: rootId,
      target: node.id,
      edgeType: 'parent',
    });
    if (prevStepId) {
      edges.push({
        id: idFactory('edge'),
        boardId,
        source: prevStepId,
        target: node.id,
        edgeType: 'dependency',
        label: 'Tiếp theo',
      });
    }
    prevStepId = node.id;
  });

  const workflowRun = buildMirroredWorkflowRun({
    board,
    nodes,
    edges,
    idFactory,
  });

  return { board, nodes, edges, workflowRun };
}

/**
 * Instantiates one of the 5 Workflow Studio templates as a brand-new workflow
 * (NEVER overwrites any existing workflow).
 */
export function createWorkflowFromTemplateBundle(params: {
  templateId: string;
  customTitle?: string;
  linkedPackId?: string;
  idFactory: IdFactory;
}): WorkflowCommitBundle {
  const tpl: WorkflowStudioTemplate =
    getWorkflowStudioTemplateById(params.templateId) ??
    getWorkflowStudioTemplateById('tpl-studio-lesson-prep')!;
  const { idFactory } = params;
  const now = new Date().toISOString();
  const boardId = idFactory('cwf');
  const workflowRunId = idFactory('wf');
  const rootId = idFactory('cnode');

  const board: CanvasBoard = {
    id: boardId,
    mode: 'workflow',
    title: params.customTitle?.trim() || tpl.title,
    description: tpl.description,
    linkedWorkflowId: workflowRunId,
    linkedPackId: params.linkedPackId ?? '',
    templateId: tpl.id,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  const rootNode = createCanvasNode({
    id: rootId,
    boardId,
    type: 'root',
    mode: 'workflow',
    title: board.title,
    description: tpl.description,
    position: { x: 50, y: 190 },
    color: 'indigo',
  });

  const nodes: CanvasNodeRecord[] = [rootNode];
  const edges: CanvasEdgeRecord[] = [];
  const stepNodeIds: string[] = [];

  tpl.steps.forEach((spec, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const nodeId = idFactory('cnode');
    stepNodeIds.push(nodeId);

    const checklistItems: CanvasChecklistItem[] | undefined = spec.checklist
      ? spec.checklist.map((label, cIdx) => ({
          id: `${nodeId}-chk-${cIdx + 1}`,
          label,
          done: false,
        }))
      : undefined;

    const node = createCanvasNode({
      id: nodeId,
      boardId,
      type: spec.type,
      mode: 'workflow',
      title: spec.title,
      description: spec.description,
      parentId: rootId,
      position: { x: 380 + col * 340, y: 60 + row * 280 },
      status: 'todo',
      color: spec.color,
      checklist: checklistItems,
    });
    node.priority = spec.priority;
    node.orderIndex = idx;
    if (spec.suggestedAppId) {
      node.suggestedAppId = spec.suggestedAppId;
    }

    nodes.push(node);
    edges.push({
      id: idFactory('edge'),
      boardId,
      source: rootId,
      target: nodeId,
      edgeType: 'parent',
    });
  });

  // Add dependency edges strictly from template specification
  tpl.steps.forEach((spec, idx) => {
    const targetId = stepNodeIds[idx];
    for (const depIdx of spec.dependsOnIndices ?? []) {
      const sourceId = stepNodeIds[depIdx];
      if (!sourceId || !targetId || sourceId === targetId) continue;
      const check = validateNewEdge(nodes, edges, sourceId, targetId, 'dependency');
      if (check.valid) {
        edges.push({
          id: idFactory('edge'),
          boardId,
          source: sourceId,
          target: targetId,
          edgeType: 'dependency',
          label: 'Phụ thuộc',
        });
      }
    }
  });

  const workflowRun = buildMirroredWorkflowRun({
    board,
    nodes,
    edges,
    idFactory,
  });

  return { board, nodes, edges, workflowRun };
}

/**
 * Converts a user-confirmed SmartWorkflowParseResult into a brand-new unified workflow bundle.
 */
export function createWorkflowFromSmartDraftBundle(params: {
  draft: SmartWorkflowParseResult;
  titleOverride?: string;
  idFactory: IdFactory;
}): WorkflowCommitBundle {
  const { draft, titleOverride, idFactory } = params;
  const now = new Date().toISOString();
  const boardId = idFactory('cwf');
  const workflowRunId = idFactory('wf');

  const committed = buildCanvasCommitBundle({
    draft,
    boardId,
    existingBoardNodes: [],
    skipDuplicates: false,
    idFactory: (prefix = 'node') => idFactory(prefix),
  });

  const title =
    titleOverride?.trim() ||
    draft.metadata.mainGoal?.trim() ||
    'Quy trình từ lập kế hoạch';

  const board: CanvasBoard = {
    id: boardId,
    mode: 'workflow',
    title,
    description: `Tạo từ mô tả: "${draft.rawInput.trim().slice(0, 140)}"`,
    subject: draft.metadata.subject,
    grade: draft.metadata.grade,
    linkedWorkflowId: workflowRunId,
    linkedPackId: '',
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  let stepOrder = 0;
  const nodes = committed.nodes.map((n) => {
    if (!isActionableWorkflowNode(n)) return n;
    return { ...n, orderIndex: stepOrder++ };
  });

  const workflowRun = buildMirroredWorkflowRun({
    board,
    nodes,
    edges: committed.edges,
    idFactory,
  });

  return {
    board,
    nodes,
    edges: committed.edges,
    workflowRun,
  };
}

/**
 * Duplicates a workflow (Board + all CanvasNodes + all CanvasEdges + WorkflowRun) with remapped IDs.
 */
export function duplicateWorkflowBundle(params: {
  sourceBoard: CanvasBoard;
  sourceNodes: CanvasNodeRecord[];
  sourceEdges: CanvasEdgeRecord[];
  idFactory: IdFactory;
}): WorkflowCommitBundle {
  const { sourceBoard, sourceNodes, sourceEdges, idFactory } = params;
  const now = new Date().toISOString();
  const nextBoardId = idFactory('cwf');
  const nextRunId = idFactory('wf');

  const idMap = new Map<string, string>();
  for (const node of sourceNodes) {
    idMap.set(node.id, idFactory('cnode'));
  }

  const nextBoard: CanvasBoard = {
    ...sourceBoard,
    id: nextBoardId,
    title: `${sourceBoard.title} (Bản sao)`,
    linkedWorkflowId: nextRunId,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  const nextNodes: CanvasNodeRecord[] = sourceNodes.map((n) => ({
    ...structuredClone(n),
    id: idMap.get(n.id)!,
    boardId: nextBoardId,
    parentId: n.parentId ? idMap.get(n.parentId) ?? null : null,
    createdAt: now,
    updatedAt: now,
  }));

  const nextEdges: CanvasEdgeRecord[] = sourceEdges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: idFactory('edge'),
      boardId: nextBoardId,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
    }));

  const workflowRun = buildMirroredWorkflowRun({
    board: nextBoard,
    nodes: nextNodes,
    edges: nextEdges,
    idFactory,
  });

  return {
    board: nextBoard,
    nodes: nextNodes,
    edges: nextEdges,
    workflowRun,
  };
}

/**
 * Adds a new step in Easy Workflow mode while preserving all existing Canvas nodes/edges/positions.
 */
export function addEasyWorkflowStep(params: {
  boardId: string;
  existingNodes: CanvasNodeRecord[];
  existingEdges: CanvasEdgeRecord[];
  title: string;
  description?: string;
  priority?: CanvasPriority;
  dueDate?: string;
  suggestedAppId?: AppId;
  idFactory: IdFactory;
}): { node: CanvasNodeRecord; addedEdges: CanvasEdgeRecord[] } {
  const { boardId, existingNodes, existingEdges, idFactory } = params;
  const ordered = orderWorkflowStepNodes(existingNodes, existingEdges);
  const rootNode = existingNodes.find((n) => n.type === 'root') ?? null;

  const maxOrder = ordered.reduce(
    (max, n, idx) => Math.max(max, typeof n.orderIndex === 'number' ? n.orderIndex : idx),
    -1
  );

  // Place cleanly below or right of the last step without touching existing coordinates
  const lastStep = ordered[ordered.length - 1];
  const position = lastStep
    ? {
        x: Math.round(lastStep.position.x),
        y: Math.round(lastStep.position.y + 265),
      }
    : { x: 390, y: 120 };

  const node = createCanvasNode({
    id: idFactory('cnode'),
    boardId,
    type: 'task',
    mode: 'workflow',
    title: params.title.trim() || 'Bước mới',
    description: params.description?.trim() ?? '',
    parentId: rootNode?.id ?? null,
    position,
    status: 'todo',
    color: 'blue',
  });
  node.priority = params.priority ?? 'medium';
  node.orderIndex = maxOrder + 1;
  if (params.dueDate) node.dueDate = params.dueDate;
  if (params.suggestedAppId) node.suggestedAppId = params.suggestedAppId;

  const addedEdges: CanvasEdgeRecord[] = [];
  if (rootNode) {
    addedEdges.push({
      id: idFactory('edge'),
      boardId,
      source: rootNode.id,
      target: node.id,
      edgeType: 'parent',
    });
  }

  return { node, addedEdges };
}

/**
 * Reorders steps in Easy Workflow by updating ONLY `orderIndex` — preserving Canvas `position` and all `edges`.
 */
export function reorderEasyWorkflowStep(params: {
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  stepId: string;
  direction: 'up' | 'down';
}): CanvasNodeRecord[] {
  const ordered = orderWorkflowStepNodes(params.nodes, params.edges);
  const fromIdx = ordered.findIndex((n) => n.id === params.stepId);
  if (fromIdx < 0) return [];
  const toIdx =
    params.direction === 'up'
      ? Math.max(0, fromIdx - 1)
      : Math.min(ordered.length - 1, fromIdx + 1);
  if (fromIdx === toIdx) return [];

  const nextOrdered = [...ordered];
  const [moved] = nextOrdered.splice(fromIdx, 1);
  nextOrdered.splice(toIdx, 0, moved);

  return nextOrdered.map((node, index) => ({
    ...node,
    orderIndex: index,
  }));
}

/**
 * Duplicates a single step in Easy Workflow (preserving Canvas graph and positioning the clone nearby).
 */
export function duplicateEasyWorkflowStep(params: {
  sourceNode: CanvasNodeRecord;
  existingNodes: CanvasNodeRecord[];
  existingEdges: CanvasEdgeRecord[];
  idFactory: IdFactory;
}): { node: CanvasNodeRecord; addedEdges: CanvasEdgeRecord[] } {
  const { sourceNode, existingNodes, existingEdges, idFactory } = params;
  const now = new Date().toISOString();
  const ordered = orderWorkflowStepNodes(existingNodes, existingEdges);
  const maxOrder = ordered.reduce(
    (max, n, idx) => Math.max(max, typeof n.orderIndex === 'number' ? n.orderIndex : idx),
    -1
  );

  const newId = idFactory('cnode');
  const cloned: CanvasNodeRecord = {
    ...structuredClone(sourceNode),
    id: newId,
    title: `${sourceNode.title} (Bản sao)`,
    status: 'todo',
    orderIndex: maxOrder + 1,
    position: {
      x: Math.round(sourceNode.position.x + 40),
      y: Math.round(sourceNode.position.y + 150),
    },
    checklist: sourceNode.checklist?.map((c, idx) => ({
      ...c,
      id: `${newId}-chk-${idx + 1}`,
      done: false,
    })),
    createdAt: now,
    updatedAt: now,
  };

  const addedEdges: CanvasEdgeRecord[] = [];
  if (sourceNode.parentId) {
    addedEdges.push({
      id: idFactory('edge'),
      boardId: sourceNode.boardId,
      source: sourceNode.parentId,
      target: newId,
      edgeType: 'parent',
    });
  }

  return { node: cloned, addedEdges };
}

/**
 * Toggles a step's done state safely with dependency enforcement and checklist sync.
 */
export function toggleEasyWorkflowStepDone(params: {
  stepId: string;
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
}): {
  ok: boolean;
  updatedNode?: CanvasNodeRecord;
  blockedByTitles?: string[];
} {
  const target = params.nodes.find((n) => n.id === params.stepId);
  if (!target) return { ok: false };

  const currentStatus = getEffectiveTaskStatus(target) ?? 'todo';
  const markingDone = currentStatus !== 'done';

  if (markingDone) {
    const guard = canMarkStepDone(params.stepId, params.nodes, params.edges);
    if (!guard.allowed) {
      return { ok: false, blockedByTitles: guard.blockedByTitles };
    }
  }

  const nextStatus: CanvasTaskStatus = markingDone ? 'done' : 'todo';
  const nextChecklist =
    target.checklist && target.checklist.length > 0
      ? target.checklist.map((item) => ({ ...item, done: markingDone }))
      : target.checklist;

  return {
    ok: true,
    updatedNode: {
      ...target,
      status: nextStatus,
      ...(nextChecklist ? { checklist: nextChecklist } : {}),
    },
  };
}

/**
 * Adds a prerequisite dependency edge (prerequisiteId -> stepId) with DAG cycle protection.
 */
export function createStepDependencyEdge(params: {
  boardId: string;
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  prerequisiteId: string;
  stepId: string;
  idFactory: IdFactory;
}): { valid: boolean; reason?: string; edge?: CanvasEdgeRecord } {
  const check = validateNewEdge(
    params.nodes,
    params.edges,
    params.prerequisiteId,
    params.stepId,
    'dependency'
  );
  if (!check.valid) {
    return { valid: false, reason: check.reason };
  }
  return {
    valid: true,
    edge: {
      id: params.idFactory('edge'),
      boardId: params.boardId,
      source: params.prerequisiteId,
      target: params.stepId,
      edgeType: 'dependency',
      label: 'Phụ thuộc',
    },
  };
}

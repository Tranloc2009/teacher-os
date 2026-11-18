import { APP_REGISTRY, AppId } from './appRegistry';
import {
  CANVAS_NODE_CATALOG,
  CanvasBoard,
  CanvasChecklistItem,
  CanvasColorKey,
  CanvasEdgeRecord,
  CanvasEdgeType,
  CanvasEntityKind,
  CanvasEntityRef,
  CanvasLayoutMode,
  CanvasMode,
  CanvasNodeRecord,
  CanvasNodeType,
  CanvasTaskStatus,
  CanvasViewSettings,
} from '../types/canvas';
import {
  JournalEntry,
  LessonPack,
  ResourceItem,
  WorkflowRun,
} from '../types/lesson';
import { MathExamProject } from '../types/mathExam';

export interface TeacherEntityCollections {
  packs: LessonPack[];
  resources: ResourceItem[];
  journals: JournalEntry[];
  workflows: WorkflowRun[];
  mathExams: MathExamProject[];
}

export interface ResolvedEntityInfo {
  exists: boolean;
  kind: CanvasEntityKind;
  entityId: string;
  title: string;
  subtitle: string;
  statusLabel?: string;
  targetApp: AppId;
}

export interface WorkflowProgressSummary {
  totalTasks: number;
  doneCount: number;
  inProgressCount: number;
  blockedCount: number;
  todoCount: number;
  progressPercent: number;
}

export interface EdgeValidationResult {
  valid: boolean;
  reason?: string;
}

export function normalizeVietnameseText(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

export function getDefaultViewSettings(boardId: string): CanvasViewSettings {
  return {
    boardId,
    viewport: { x: 40, y: 40, zoom: 0.92 },
    snapToGrid: true,
    showMiniMap: true,
    showGrid: true,
    focusSubtreeRootId: null,
    layoutMode: 'free',
  };
}

export function getCatalogItem(type: CanvasNodeType) {
  return (
    CANVAS_NODE_CATALOG.find((item) => item.type === type) ??
    CANVAS_NODE_CATALOG[0]
  );
}

export function createCanvasNode(params: {
  id: string;
  boardId: string;
  type: CanvasNodeType;
  mode: CanvasMode;
  title?: string;
  description?: string;
  position: { x: number; y: number };
  parentId?: string | null;
  color?: CanvasColorKey;
  status?: CanvasTaskStatus;
  checklist?: CanvasChecklistItem[];
  entityRef?: CanvasEntityRef | null;
}): CanvasNodeRecord {
  const now = new Date().toISOString();
  const catalog = getCatalogItem(params.type);
  const supportsStatus =
    catalog.supportsStatus ||
    (params.mode === 'workflow' &&
      (params.type === 'lesson' ||
        params.type === 'resource' ||
        params.type === 'document'));

  const defaultChecklist: CanvasChecklistItem[] | undefined =
    params.type === 'checklist'
      ? params.checklist ?? [
          { id: `${params.id}-c1`, label: 'Rà soát mục tiêu & phân bổ tiết', done: false },
          { id: `${params.id}-c2`, label: 'Kiểm tra bản xem trước in A4', done: false },
        ]
      : params.checklist;

  return {
    id: params.id,
    boardId: params.boardId,
    type: params.type,
    title: params.title?.trim() || catalog.label,
    description: params.description ?? '',
    parentId: params.parentId ?? null,
    position: {
      x: Math.round(params.position.x),
      y: Math.round(params.position.y),
    },
    ...(supportsStatus ? { status: params.status ?? 'todo', priority: 'medium' as const } : {}),
    color: params.color ?? catalog.defaultColor,
    ...(params.entityRef ? { entityRef: params.entityRef } : {}),
    ...(defaultChecklist ? { checklist: defaultChecklist } : {}),
    collapsed: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function mapEntityKindToNodeType(kind: CanvasEntityKind): CanvasNodeType {
  switch (kind) {
    case 'LessonPack':
      return 'lesson';
    case 'ResourceItem':
      return 'resource';
    case 'WorkflowRun':
      return 'workflow';
    case 'JournalEntry':
    case 'MathExamProject':
    default:
      return 'document';
  }
}

export function mapEntityKindToAppId(kind: CanvasEntityKind): AppId {
  switch (kind) {
    case 'LessonPack':
      return 'lesson-studio';
    case 'ResourceItem':
      return 'resource-vault';
    case 'JournalEntry':
      return 'teaching-journal';
    case 'WorkflowRun':
      return 'workflow-center';
    case 'MathExamProject':
      return 'math-mixer';
  }
}

/**
 * Tạo node tham chiếu tài liệu TeacherOS:
 * CHỈ lưu entityRef (kind + entityId + cachedLabel/Meta), TUYỆT ĐỐI KHÔNG sao chép toàn bộ payload LessonPack/Resource.
 */
export function createReferenceNode(params: {
  id: string;
  boardId: string;
  mode: CanvasMode;
  kind: CanvasEntityKind;
  entityId: string;
  label: string;
  meta: string;
  position: { x: number; y: number };
  parentId?: string | null;
}): CanvasNodeRecord {
  const nodeType = mapEntityKindToNodeType(params.kind);
  return createCanvasNode({
    id: params.id,
    boardId: params.boardId,
    type: nodeType,
    mode: params.mode,
    title: params.label,
    description: params.meta,
    position: params.position,
    parentId: params.parentId ?? null,
    entityRef: {
      kind: params.kind,
      entityId: params.entityId,
      cachedLabel: params.label,
      cachedMeta: params.meta,
    },
  });
}

export function resolveEntityReference(
  ref: CanvasEntityRef | null | undefined,
  collections: TeacherEntityCollections
): ResolvedEntityInfo | null {
  if (!ref) return null;
  const targetApp = mapEntityKindToAppId(ref.kind);

  if (ref.kind === 'LessonPack') {
    const found = collections.packs.find((p) => p.id === ref.entityId);
    if (!found) {
      return {
        exists: false,
        kind: ref.kind,
        entityId: ref.entityId,
        title: ref.cachedLabel || 'Bộ tiết dạy không còn tồn tại',
        subtitle: 'Tài liệu gốc đã bị xóa hoặc chưa được khôi phục.',
        targetApp,
      };
    }
    return {
      exists: true,
      kind: ref.kind,
      entityId: found.id,
      title: found.title || '(Bộ tiết dạy chưa đặt tên)',
      subtitle: `${found.subject} · ${found.grade} · ${found.duration} phút`,
      statusLabel: found.status === 'completed' ? 'Hoàn thành' : 'Bản nháp',
      targetApp,
    };
  }

  if (ref.kind === 'ResourceItem') {
    const found = collections.resources.find((r) => r.id === ref.entityId);
    if (!found) {
      return {
        exists: false,
        kind: ref.kind,
        entityId: ref.entityId,
        title: ref.cachedLabel || 'Học liệu không còn tồn tại',
        subtitle: 'Học liệu gốc đã bị xóa khỏi Resource Vault.',
        targetApp,
      };
    }
    return {
      exists: true,
      kind: ref.kind,
      entityId: found.id,
      title: found.title,
      subtitle: `${found.subject} · ${found.grade}`,
      targetApp,
    };
  }

  if (ref.kind === 'JournalEntry') {
    const found = collections.journals.find((j) => j.id === ref.entityId);
    if (!found) {
      return {
        exists: false,
        kind: ref.kind,
        entityId: ref.entityId,
        title: ref.cachedLabel || 'Nhật ký giảng dạy đã xóa',
        subtitle: 'Không tìm thấy trong Teaching Journal.',
        targetApp,
      };
    }
    return {
      exists: true,
      kind: ref.kind,
      entityId: found.id,
      title: `Nhật ký lớp ${found.classLabel} (${found.taughtDate})`,
      subtitle: found.nextAdjustment || found.whatWorked,
      targetApp,
    };
  }

  if (ref.kind === 'WorkflowRun') {
    const found = collections.workflows.find((w) => w.id === ref.entityId);
    if (!found) {
      return {
        exists: false,
        kind: ref.kind,
        entityId: ref.entityId,
        title: ref.cachedLabel || 'Quy trình đã xóa',
        subtitle: 'Không tìm thấy trong Workflow Center.',
        targetApp,
      };
    }
    const done = found.steps.filter((s) => s.done).length;
    return {
      exists: true,
      kind: ref.kind,
      entityId: found.id,
      title: found.title,
      subtitle: `${done}/${found.steps.length} đầu việc hoàn tất`,
      targetApp,
    };
  }

  const foundExam = collections.mathExams.find((m) => m.id === ref.entityId);
  if (!foundExam) {
    return {
      exists: false,
      kind: ref.kind,
      entityId: ref.entityId,
      title: ref.cachedLabel || 'Đề Toán đã xóa',
      subtitle: 'Không tìm thấy trong Math Exam Mixer Pro.',
      targetApp,
    };
  }
  return {
    exists: true,
    kind: ref.kind,
    entityId: foundExam.id,
    title: foundExam.title,
    subtitle: `${foundExam.grade} · ${foundExam.questions.length} câu · ${foundExam.durationMinutes} phút`,
    statusLabel: foundExam.status === 'ready' ? 'Sẵn sàng trộn' : 'Đang soạn',
    targetApp,
  };
}

/**
 * Kiểm tra xem việc thêm cạnh (source -> target) với edgeType có tạo thành vòng lặp
 * trong đồ thị cùng loại cạnh (`parent` hoặc `dependency`) hay không.
 */
export function wouldCreateEdgeCycle(
  edges: CanvasEdgeRecord[],
  source: string,
  target: string,
  edgeType: CanvasEdgeType
): boolean {
  if (source === target) return true;
  if (edgeType === 'reference') return false;

  // Kiểm tra xem từ `target` có đường đi tới `source` theo cùng edgeType hay không
  const relevantEdges = edges.filter((e) => e.edgeType === edgeType);
  const adjacency = new Map<string, string[]>();
  for (const edge of relevantEdges) {
    const list = adjacency.get(edge.source);
    if (list) {
      list.push(edge.target);
    } else {
      adjacency.set(edge.source, [edge.target]);
    }
  }

  const visited = new Set<string>();
  const stack: string[] = [target];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = adjacency.get(current) ?? [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }
  return false;
}

export function validateNewEdge(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  source: string,
  target: string,
  edgeType: CanvasEdgeType
): EdgeValidationResult {
  if (!source || !target) {
    return { valid: false, reason: 'Thiếu nút nguồn hoặc nút đích để liên kết.' };
  }
  if (source === target) {
    return { valid: false, reason: 'Không thể nối một node với chính nó.' };
  }
  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) {
    return { valid: false, reason: 'Node nguồn hoặc node đích không còn tồn tại.' };
  }

  const duplicate = edges.some(
    (e) =>
      e.source === source &&
      e.target === target &&
      e.edgeType === edgeType
  );
  if (duplicate) {
    return { valid: false, reason: 'Liên kết cùng loại giữa hai node này đã tồn tại.' };
  }

  if (edgeType === 'parent') {
    if (targetNode.type === 'root') {
      return {
        valid: false,
        reason: 'Node Chủ đề gốc (Root) không được phép có node cha.',
      };
    }
    const alreadyHasParent =
      edges.some((e) => e.edgeType === 'parent' && e.target === target) ||
      Boolean(targetNode.parentId && targetNode.parentId !== source);
    if (alreadyHasParent) {
      return {
        valid: false,
        reason:
          'Trong sơ đồ cây, mỗi node con chỉ thuộc về một node cha. Hãy dùng mục "Nhánh cha" trong bảng Thuộc tính để đổi nhánh cha.',
      };
    }
  }

  if (wouldCreateEdgeCycle(edges, source, target, edgeType)) {
    return {
      valid: false,
      reason:
        edgeType === 'dependency'
          ? 'Không thể tạo vòng lặp phụ thuộc (A → B → A) trong quy trình công việc.'
          : 'Không thể tạo vòng lặp cha – con trong sơ đồ cây.',
    };
  }

  return { valid: true };
}

/**
 * Tính tiến độ Workflow từ các node công việc thực tế (task, checklist, milestone, workflow hoặc node có status).
 * Không bao giờ trả về tiến độ giả.
 */
export function calculateWorkflowProgress(
  nodes: CanvasNodeRecord[]
): WorkflowProgressSummary {
  const actionableNodes = nodes.filter(
    (n) =>
      n.type === 'task' ||
      n.type === 'checklist' ||
      n.type === 'milestone' ||
      n.type === 'workflow' ||
      n.status !== undefined
  );

  let doneCount = 0;
  let inProgressCount = 0;
  let blockedCount = 0;
  let todoCount = 0;

  for (const node of actionableNodes) {
    let effectiveStatus: CanvasTaskStatus = node.status ?? 'todo';
    if (
      node.type === 'checklist' &&
      Array.isArray(node.checklist) &&
      node.checklist.length > 0 &&
      node.status !== 'blocked'
    ) {
      const completedItems = node.checklist.filter((c) => c.done).length;
      if (completedItems === node.checklist.length) effectiveStatus = 'done';
      else if (completedItems > 0) effectiveStatus = 'in_progress';
      else effectiveStatus = 'todo';
    }

    if (effectiveStatus === 'done') doneCount++;
    else if (effectiveStatus === 'in_progress') inProgressCount++;
    else if (effectiveStatus === 'blocked') blockedCount++;
    else todoCount++;
  }

  const totalTasks = actionableNodes.length;
  const progressPercent =
    totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  return {
    totalTasks,
    doneCount,
    inProgressCount,
    blockedCount,
    todoCount,
    progressPercent,
  };
}

export function getAncestorsBreadcrumb(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  targetNodeId: string | null | undefined
): CanvasNodeRecord[] {
  if (!targetNodeId) return [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const parentByEdge = new Map<string, string>();
  for (const edge of edges) {
    if (edge.edgeType === 'parent' && !parentByEdge.has(edge.target)) {
      parentByEdge.set(edge.target, edge.source);
    }
  }

  const chain: CanvasNodeRecord[] = [];
  const visited = new Set<string>();
  let currentId: string | null | undefined = targetNodeId;
  while (currentId && !visited.has(currentId)) {
    const node = nodeMap.get(currentId);
    if (!node) break;
    chain.unshift(node);
    visited.add(currentId);
    currentId = parentByEdge.get(currentId) ?? node.parentId ?? null;
  }
  return chain;
}

export function filterCanvasNodes(
  nodes: CanvasNodeRecord[],
  query: string,
  statusFilter: CanvasTaskStatus | 'all' = 'all'
): Set<string> {
  const cleanQuery = normalizeVietnameseText(query);
  const matched = new Set<string>();
  for (const node of nodes) {
    if (statusFilter !== 'all' && node.status !== statusFilter) {
      continue;
    }
    if (!cleanQuery) {
      matched.add(node.id);
      continue;
    }
    const haystack = normalizeVietnameseText(
      `${node.title} ${node.description ?? ''} ${node.entityRef?.cachedLabel ?? ''}`
    );
    if (haystack.includes(cleanQuery)) {
      matched.add(node.id);
    }
  }
  return matched;
}

const VALID_NODE_TYPES = new Set<CanvasNodeType>(
  CANVAS_NODE_CATALOG.map((c) => c.type)
);
const VALID_TASK_STATUSES = new Set<CanvasTaskStatus>([
  'todo',
  'in_progress',
  'done',
  'blocked',
]);
const VALID_EDGE_TYPES = new Set<CanvasEdgeType>([
  'parent',
  'dependency',
  'reference',
]);

const READY_APP_IDS = new Set<AppId>(
  APP_REGISTRY.filter((app) => app.status === 'ready').map((app) => app.id)
);

export function normalizeCanvasNode(raw: CanvasNodeRecord): CanvasNodeRecord {
  const safeType: CanvasNodeType = VALID_NODE_TYPES.has(raw.type)
    ? raw.type
    : 'note';
  const catalog = getCatalogItem(safeType);
  const now = new Date().toISOString();
  const safeStatus =
    raw.status && VALID_TASK_STATUSES.has(raw.status) ? raw.status : undefined;
  const safeSuggestedAppId =
    raw.suggestedAppId && READY_APP_IDS.has(raw.suggestedAppId)
      ? raw.suggestedAppId
      : undefined;

  return {
    ...raw,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `cnode-${Date.now()}`,
    boardId:
      typeof raw.boardId === 'string' && raw.boardId.trim()
        ? raw.boardId
        : 'canvas-ws-toan-8',
    type: safeType,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : catalog.label,
    description: typeof raw.description === 'string' ? raw.description : '',
    parentId: safeType === 'root' ? null : raw.parentId ?? null,
    position: {
      x: Number.isFinite(raw.position?.x) ? raw.position.x : 0,
      y: Number.isFinite(raw.position?.y) ? raw.position.y : 0,
    },
    ...(safeStatus ? { status: safeStatus } : { status: undefined }),
    ...(safeSuggestedAppId
      ? { suggestedAppId: safeSuggestedAppId }
      : { suggestedAppId: undefined }),
    color: raw.color ?? catalog.defaultColor,
    collapsed: Boolean(raw.collapsed),
    locked: Boolean(raw.locked),
    checklist: Array.isArray(raw.checklist)
      ? raw.checklist.filter(
          (c) => c && typeof c.id === 'string' && typeof c.label === 'string'
        )
      : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

export function normalizeCanvasEdge(raw: CanvasEdgeRecord): CanvasEdgeRecord {
  const safeEdgeType: CanvasEdgeType = VALID_EDGE_TYPES.has(raw.edgeType)
    ? raw.edgeType
    : 'parent';
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `edge-${Date.now()}`,
    boardId:
      typeof raw.boardId === 'string' && raw.boardId.trim()
        ? raw.boardId
        : 'canvas-ws-toan-8',
    source: typeof raw.source === 'string' ? raw.source : '',
    target: typeof raw.target === 'string' ? raw.target : '',
    edgeType: safeEdgeType,
    ...(typeof raw.label === 'string' && raw.label.trim()
      ? { label: raw.label }
      : {}),
  };
}

export function normalizeCanvasBoard(raw: CanvasBoard): CanvasBoard {
  const now = new Date().toISOString();
  return {
    ...raw,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `cboard-${Date.now()}`,
    mode: raw.mode === 'workflow' ? 'workflow' : 'workspace',
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Bảng Canvas mới',
    description: typeof raw.description === 'string' ? raw.description : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

const VALID_LAYOUT_MODES: CanvasLayoutMode[] = [
  'free',
  'tree-tb',
  'tree-lr',
  'mindmap',
];

export function normalizeCanvasViewSettings(
  raw: CanvasViewSettings | undefined,
  boardId: string
): CanvasViewSettings {
  if (!raw) return getDefaultViewSettings(boardId);
  const layoutMode: CanvasLayoutMode = VALID_LAYOUT_MODES.includes(
    raw.layoutMode as CanvasLayoutMode
  )
    ? (raw.layoutMode as CanvasLayoutMode)
    : 'free';
  return {
    boardId,
    viewport: {
      x: Number.isFinite(raw.viewport?.x) ? raw.viewport.x : 40,
      y: Number.isFinite(raw.viewport?.y) ? raw.viewport.y : 40,
      zoom: Number.isFinite(raw.viewport?.zoom)
        ? Math.max(0.2, Math.min(2.5, raw.viewport.zoom))
        : 0.92,
    },
    snapToGrid: typeof raw.snapToGrid === 'boolean' ? raw.snapToGrid : true,
    showMiniMap: typeof raw.showMiniMap === 'boolean' ? raw.showMiniMap : true,
    showGrid: typeof raw.showGrid === 'boolean' ? raw.showGrid : true,
    focusSubtreeRootId: raw.focusSubtreeRootId ?? null,
    layoutMode,
  };
}

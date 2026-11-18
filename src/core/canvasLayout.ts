import {
  CanvasEdgeRecord,
  CanvasLayoutMode,
  CanvasMode,
  CanvasNodeRecord,
  CanvasNodeType,
  CanvasTaskStatus,
} from '../types/canvas';
import {
  JournalEntry,
  LessonPack,
  ResourceItem,
  WorkflowRun,
} from '../types/lesson';
import { createCanvasNode, createReferenceNode } from './canvasEngine';

export const CANVAS_LAYOUT_OPTIONS: Array<{
  mode: CanvasLayoutMode;
  label: string;
  shortLabel: string;
}> = [
  { mode: 'free', label: 'Tự do (Giữ tay kéo)', shortLabel: 'Tự do' },
  { mode: 'tree-tb', label: 'Sơ đồ cây dọc (Trên → Dưới)', shortLabel: 'Cây dọc' },
  { mode: 'tree-lr', label: 'Sơ đồ ngang (Trái → Phải)', shortLabel: 'Cây ngang' },
  { mode: 'mindmap', label: 'Mind Map 2 nhánh cân đối', shortLabel: 'Mind Map' },
];

const NODE_WIDTH = 256;
const NODE_HEIGHT = 152;
const H_GAP = 64;
const V_GAP = 72;

export type IdFactory = (prefix: string) => string;

export interface SubtreeProgress {
  doneCount: number;
  totalCount: number;
  percent: number;
}

export interface VisibleSubtreeResult {
  visibleNodes: CanvasNodeRecord[];
  visibleEdges: CanvasEdgeRecord[];
  hiddenNodeIds: Set<string>;
  descendantCountMap: Record<string, number>;
  directChildrenCountMap: Record<string, number>;
  subtreeProgressMap: Record<string, SubtreeProgress>;
  parentIdMap: Record<string, string | null>;
}

export interface ReparentNodeResult {
  valid: boolean;
  reason?: string;
  updatedNode?: CanvasNodeRecord;
  addedEdge?: CanvasEdgeRecord;
  removedEdgeIds: string[];
}

export interface SubtreeDeletePlan {
  nodeIds: string[];
  edgeIds: string[];
  hasLockedNode: boolean;
  lockedTitles: string[];
}

export interface CanvasSnapshot {
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  label: string;
}

export interface CanvasHistoryState {
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];
}

export interface NodeDependencyStatus {
  nodeId: string;
  isDependencyBlocked: boolean;
  isReadyToStart: boolean;
  blockedByNodeIds: string[];
  blockedByTitles: string[];
  unlocksNodeIds: string[];
  unlocksTitles: string[];
}

export interface WorkflowDependencySummary {
  byNodeId: Record<string, NodeDependencyStatus>;
  readyNodeIds: string[];
  blockedByDependencyIds: string[];
}

export interface WorkflowCanvasTemplate {
  id: string;
  title: string;
  subtitle: string;
  stepsCount: number;
}

export const WORKFLOW_CANVAS_TEMPLATES: WorkflowCanvasTemplate[] = [
  {
    id: 'tpl-lesson-45-90',
    title: 'Chuẩn bị tiết dạy 45/90p & Phiếu A/B/C',
    subtitle: 'Quy trình chuẩn 3 giai đoạn: Trước tiết → In A4 → Trong lớp → Rút kinh nghiệm.',
    stepsCount: 6,
  },
  {
    id: 'tpl-math-exam',
    title: 'Soạn & Trộn đề Toán THPT an toàn',
    subtitle: 'Kiểm định công thức → Math Lock → Sinh mã đề & Đáp án → Duyệt bản in A4.',
    stepsCount: 5,
  },
  {
    id: 'tpl-post-lesson',
    title: 'Chu trình Rút kinh nghiệm & Cải tiến học liệu',
    subtitle: 'Phản hồi lớp dạy → Nhật ký → Cập nhật Resource Vault → Biến thể lớp song song.',
    stepsCount: 4,
  },
];

export function getEffectiveTaskStatus(node: CanvasNodeRecord): CanvasTaskStatus | null {
  if (
    node.type === 'checklist' &&
    Array.isArray(node.checklist) &&
    node.checklist.length > 0 &&
    node.status !== 'blocked'
  ) {
    const doneCount = node.checklist.filter((c) => c.done).length;
    if (doneCount === node.checklist.length) return 'done';
    if (doneCount > 0) return 'in_progress';
    return 'todo';
  }
  if (node.status) return node.status;
  if (
    node.type === 'task' ||
    node.type === 'checklist' ||
    node.type === 'milestone' ||
    node.type === 'workflow'
  ) {
    return 'todo';
  }
  return null;
}

function buildParentChildrenGraph(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[]
): {
  nodeMap: Map<string, CanvasNodeRecord>;
  childrenMap: Map<string, string[]>;
  parentMap: Map<string, string>;
} {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();

  const addChild = (parentId: string, childId: string) => {
    if (parentId === childId) return;
    if (!nodeMap.has(parentId) || !nodeMap.has(childId)) return;
    if (parentMap.has(childId)) return;
    parentMap.set(childId, parentId);
    const list = childrenMap.get(parentId);
    if (list) {
      if (!list.includes(childId)) list.push(childId);
    } else {
      childrenMap.set(parentId, [childId]);
    }
  };

  for (const edge of edges) {
    if (edge.edgeType === 'parent') {
      addChild(edge.source, edge.target);
    }
  }
  for (const node of nodes) {
    if (node.parentId) {
      addChild(node.parentId, node.id);
    }
  }

  return { nodeMap, childrenMap, parentMap };
}

/**
 * Xây dựng cây đại diện phục vụ Auto Layout:
 * Ưu tiên quan hệ `parent`, sau đó tự động nối thêm cây phủ (spanning tree) theo cạnh `dependency`
 * nếu sơ đồ đang ở chế độ Workflow DAG.
 */
function buildLayoutGraph(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[]
): {
  roots: string[];
  childrenMap: Map<string, string[]>;
} {
  const { nodeMap, childrenMap, parentMap } = buildParentChildrenGraph(nodes, edges);

  // Ancestor guard to prevent cycles when grafting dependency edges
  const isAncestor = (candidateAncestor: string, nodeId: string): boolean => {
    let curr: string | undefined = nodeId;
    const seen = new Set<string>();
    while (curr && !seen.has(curr)) {
      if (curr === candidateAncestor) return true;
      seen.add(curr);
      curr = parentMap.get(curr);
    }
    return false;
  };

  for (const edge of edges) {
    if (edge.edgeType !== 'dependency') continue;
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    if (parentMap.has(edge.target)) continue;
    if (isAncestor(edge.target, edge.source)) continue;
    parentMap.set(edge.target, edge.source);
    const list = childrenMap.get(edge.source);
    if (list) {
      if (!list.includes(edge.target)) list.push(edge.target);
    } else {
      childrenMap.set(edge.source, [edge.target]);
    }
  }

  // Sort children deterministically by current coordinate / title so layout feels predictable
  for (const [parentId, kids] of childrenMap.entries()) {
    kids.sort((a, b) => {
      const na = nodeMap.get(a);
      const nb = nodeMap.get(b);
      if (!na || !nb) return 0;
      return na.position.y - nb.position.y || na.position.x - nb.position.x;
    });
    childrenMap.set(parentId, kids);
  }

  const roots = nodes
    .filter((n) => !parentMap.has(n.id))
    .sort((a, b) => {
      const aRootScore = a.type === 'root' ? 0 : 1;
      const bRootScore = b.type === 'root' ? 0 : 1;
      if (aRootScore !== bRootScore) return aRootScore - bRootScore;
      return a.position.y - b.position.y || a.position.x - b.position.x;
    })
    .map((n) => n.id);

  // Include any remaining nodes inside cycles if somehow present
  const visited = new Set<string>();
  const collect = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const c of childrenMap.get(id) ?? []) collect(c);
  };
  for (const r of roots) collect(r);
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      roots.push(n.id);
      collect(n.id);
    }
  }

  return { roots, childrenMap };
}

/**
 * Thuật toán tự động dàn trang cho Canvas Engine.
 * Hỗ trợ: `tree-tb` (cây dọc), `tree-lr` (sơ đồ ngang), `mindmap` (tỏa 2 phía trái/phải).
 * TUYỆT ĐỐI giữ nguyên tọa độ các node đang bật `locked = true`.
 */
export function applyCanvasAutoLayout(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  mode: Exclude<CanvasLayoutMode, 'free'>
): CanvasNodeRecord[] {
  if (nodes.length === 0) return [];

  const { roots, childrenMap } = buildLayoutGraph(nodes, edges);
  const positions = new Map<string, { x: number; y: number }>();
  const visitedSubtree = new Set<string>();

  const measureSpan = (
    id: string,
    axis: 'horizontal' | 'vertical',
    seen = new Set<string>()
  ): number => {
    if (seen.has(id)) return axis === 'horizontal' ? NODE_WIDTH : NODE_HEIGHT;
    seen.add(id);
    const children = (childrenMap.get(id) ?? []).filter((c) => !seen.has(c));
    if (children.length === 0) {
      return axis === 'horizontal' ? NODE_WIDTH : NODE_HEIGHT;
    }
    const gap = axis === 'horizontal' ? H_GAP : V_GAP;
    let total = 0;
    children.forEach((cid, idx) => {
      total += measureSpan(cid, axis, new Set(seen));
      if (idx > 0) total += gap;
    });
    const selfSize = axis === 'horizontal' ? NODE_WIDTH : NODE_HEIGHT;
    return Math.max(selfSize, total);
  };

  if (mode === 'tree-tb') {
    const placeTB = (id: string, startX: number, y: number, span: number) => {
      if (visitedSubtree.has(id)) return;
      visitedSubtree.add(id);
      positions.set(id, {
        x: Math.round(startX + (span - NODE_WIDTH) / 2),
        y: Math.round(y),
      });
      const children = (childrenMap.get(id) ?? []).filter((c) => !visitedSubtree.has(c));
      let cursorX = startX;
      const totalChildSpan = children.reduce(
        (acc, cid, idx) => acc + measureSpan(cid, 'horizontal') + (idx > 0 ? H_GAP : 0),
        0
      );
      if (totalChildSpan < span) {
        cursorX += (span - totalChildSpan) / 2;
      }
      for (const cid of children) {
        const cSpan = measureSpan(cid, 'horizontal');
        placeTB(cid, cursorX, y + NODE_HEIGHT + V_GAP + 24, cSpan);
        cursorX += cSpan + H_GAP;
      }
    };

    let forestX = 80;
    for (const rootId of roots) {
      if (visitedSubtree.has(rootId)) continue;
      const span = measureSpan(rootId, 'horizontal');
      placeTB(rootId, forestX, 80, span);
      forestX += span + H_GAP * 1.5;
    }
  } else if (mode === 'tree-lr') {
    const placeLR = (
      id: string,
      x: number,
      startY: number,
      span: number,
      dir: 1 | -1 = 1
    ) => {
      if (visitedSubtree.has(id)) return;
      visitedSubtree.add(id);
      positions.set(id, {
        x: Math.round(x),
        y: Math.round(startY + (span - NODE_HEIGHT) / 2),
      });
      const children = (childrenMap.get(id) ?? []).filter((c) => !visitedSubtree.has(c));
      let cursorY = startY;
      const totalChildSpan = children.reduce(
        (acc, cid, idx) => acc + measureSpan(cid, 'vertical') + (idx > 0 ? V_GAP : 0),
        0
      );
      if (totalChildSpan < span) {
        cursorY += (span - totalChildSpan) / 2;
      }
      for (const cid of children) {
        const cSpan = measureSpan(cid, 'vertical');
        placeLR(cid, x + dir * (NODE_WIDTH + H_GAP + 32), cursorY, cSpan, dir);
        cursorY += cSpan + V_GAP;
      }
    };

    let forestY = 80;
    for (const rootId of roots) {
      if (visitedSubtree.has(rootId)) continue;
      const span = measureSpan(rootId, 'vertical');
      placeLR(rootId, 80, forestY, span, 1);
      forestY += span + V_GAP * 1.4;
    }
  } else {
    // Mind Map mode: Root centered horizontally; first-level branches split Right & Left
    const placeBranch = (
      id: string,
      x: number,
      startY: number,
      span: number,
      dir: 1 | -1
    ) => {
      if (visitedSubtree.has(id)) return;
      visitedSubtree.add(id);
      positions.set(id, {
        x: Math.round(x),
        y: Math.round(startY + (span - NODE_HEIGHT) / 2),
      });
      const children = (childrenMap.get(id) ?? []).filter((c) => !visitedSubtree.has(c));
      let cursorY = startY;
      const totalChildSpan = children.reduce(
        (acc, cid, idx) => acc + measureSpan(cid, 'vertical') + (idx > 0 ? V_GAP : 0),
        0
      );
      if (totalChildSpan < span) {
        cursorY += (span - totalChildSpan) / 2;
      }
      for (const cid of children) {
        const cSpan = measureSpan(cid, 'vertical');
        placeBranch(cid, x + dir * (NODE_WIDTH + H_GAP + 28), cursorY, cSpan, dir);
        cursorY += cSpan + V_GAP;
      }
    };

    let cursorCenterY = 260;
    const centerX = 520;
    for (const rootId of roots) {
      if (visitedSubtree.has(rootId)) continue;
      visitedSubtree.add(rootId);

      const directKids = (childrenMap.get(rootId) ?? []).filter((c) => !visitedSubtree.has(c));
      const rightKids: string[] = [];
      const leftKids: string[] = [];
      directKids.forEach((cid, idx) => {
        if (idx % 2 === 0) rightKids.push(cid);
        else leftKids.push(cid);
      });

      const rightSpan = rightKids.reduce(
        (acc, cid, idx) => acc + measureSpan(cid, 'vertical') + (idx > 0 ? V_GAP : 0),
        0
      );
      const leftSpan = leftKids.reduce(
        (acc, cid, idx) => acc + measureSpan(cid, 'vertical') + (idx > 0 ? V_GAP : 0),
        0
      );
      const rootBlockHeight = Math.max(NODE_HEIGHT, rightSpan, leftSpan);

      positions.set(rootId, {
        x: centerX,
        y: Math.round(cursorCenterY + (rootBlockHeight - NODE_HEIGHT) / 2),
      });

      let rY = cursorCenterY + (rootBlockHeight - rightSpan) / 2;
      for (const cid of rightKids) {
        const cSpan = measureSpan(cid, 'vertical');
        placeBranch(cid, centerX + NODE_WIDTH + H_GAP + 36, rY, cSpan, 1);
        rY += cSpan + V_GAP;
      }

      let lY = cursorCenterY + (rootBlockHeight - leftSpan) / 2;
      for (const cid of leftKids) {
        const cSpan = measureSpan(cid, 'vertical');
        placeBranch(cid, centerX - (NODE_WIDTH + H_GAP + 36), lY, cSpan, -1);
        lY += cSpan + V_GAP;
      }

      cursorCenterY += rootBlockHeight + V_GAP * 1.6;
    }
  }

  return nodes.map((node) => {
    if (node.locked) return node;
    const nextPos = positions.get(node.id);
    return nextPos ? { ...node, position: nextPos } : node;
  });
}

/**
 * Lọc danh sách node/edge hiển thị theo trạng thái thu gọn nhánh (`collapsed`)
 * và chế độ tập trung nhánh con (`focusRootId`).
 */
export function computeVisibleSubtree(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  focusRootId?: string | null
): VisibleSubtreeResult {
  const { nodeMap, childrenMap, parentMap } = buildParentChildrenGraph(nodes, edges);
  const directChildrenCountMap: Record<string, number> = {};
  const descendantCountMap: Record<string, number> = {};
  const subtreeProgressMap: Record<string, SubtreeProgress> = {};
  const parentIdMap: Record<string, string | null> = {};

  for (const node of nodes) {
    directChildrenCountMap[node.id] = (childrenMap.get(node.id) ?? []).length;
    parentIdMap[node.id] = parentMap.get(node.id) ?? null;
  }

  const countMemo = new Map<string, number>();
  const countDescendants = (id: string, stack = new Set<string>()): number => {
    if (countMemo.has(id)) return countMemo.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    let total = 0;
    for (const childId of childrenMap.get(id) ?? []) {
      total += 1 + countDescendants(childId, stack);
    }
    stack.delete(id);
    countMemo.set(id, total);
    return total;
  };

  const progressMemo = new Map<string, { done: number; total: number }>();
  const computeDescendantTaskCounts = (
    id: string,
    stack = new Set<string>()
  ): { done: number; total: number } => {
    if (progressMemo.has(id)) return progressMemo.get(id)!;
    if (stack.has(id)) return { done: 0, total: 0 };
    stack.add(id);
    let done = 0;
    let total = 0;
    for (const childId of childrenMap.get(id) ?? []) {
      const childNode = nodeMap.get(childId);
      if (childNode) {
        const eff = getEffectiveTaskStatus(childNode);
        if (eff !== null) {
          total += 1;
          if (eff === 'done') done += 1;
        }
      }
      const sub = computeDescendantTaskCounts(childId, stack);
      done += sub.done;
      total += sub.total;
    }
    stack.delete(id);
    const res = { done, total };
    progressMemo.set(id, res);
    return res;
  };

  for (const node of nodes) {
    descendantCountMap[node.id] = countDescendants(node.id);
    const counts = computeDescendantTaskCounts(node.id);
    subtreeProgressMap[node.id] = {
      doneCount: counts.done,
      totalCount: counts.total,
      percent: counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0,
    };
  }

  // Determine focus scope (if active and root exists)
  let focusScopeSet: Set<string> | null = null;
  if (focusRootId && nodeMap.has(focusRootId)) {
    focusScopeSet = new Set<string>();
    const walkFocus = (id: string) => {
      if (focusScopeSet!.has(id)) return;
      focusScopeSet!.add(id);
      for (const childId of childrenMap.get(id) ?? []) {
        walkFocus(childId);
      }
    };
    walkFocus(focusRootId);
  }

  // Collect collapsed descendants
  const hiddenNodeIds = new Set<string>();
  const hideDescendants = (id: string) => {
    for (const childId of childrenMap.get(id) ?? []) {
      if (!hiddenNodeIds.has(childId)) {
        hiddenNodeIds.add(childId);
        hideDescendants(childId);
      }
    }
  };
  for (const node of nodes) {
    if (node.collapsed) {
      hideDescendants(node.id);
    }
  }

  // If focusRootId itself happened to be inside a collapsed parent above it,
  // focusRootId and its non-collapsed children should remain visible in Focus Mode!
  if (focusRootId && nodeMap.has(focusRootId)) {
    hiddenNodeIds.delete(focusRootId);
    const rebuildFromFocus = new Set<string>();
    const hideUnderCollapsedInsideFocus = (id: string) => {
      if (rebuildFromFocus.has(id)) return;
      rebuildFromFocus.add(id);
      const n = nodeMap.get(id);
      if (n?.collapsed) {
        hideDescendants(id);
        return;
      }
      for (const childId of childrenMap.get(id) ?? []) {
        hiddenNodeIds.delete(childId);
        hideUnderCollapsedInsideFocus(childId);
      }
    };
    hideUnderCollapsedInsideFocus(focusRootId);
  }

  const visibleNodes = nodes.filter((node) => {
    if (focusScopeSet && !focusScopeSet.has(node.id)) return false;
    if (hiddenNodeIds.has(node.id)) return false;
    return true;
  });

  const visibleIdSet = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges.filter(
    (edge) => visibleIdSet.has(edge.source) && visibleIdSet.has(edge.target)
  );

  return {
    visibleNodes,
    visibleEdges,
    hiddenNodeIds,
    descendantCountMap,
    directChildrenCountMap,
    subtreeProgressMap,
    parentIdMap,
  };
}

/**
 * Liệt kê danh sách các node hợp lệ có thể chọn làm nhánh cha cho `childNodeId`
 * (loại bỏ chính nó và toàn bộ hậu duệ của nó để ngăn vòng lặp cha–con).
 */
export function getValidParentCandidates(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  childNodeId: string
): CanvasNodeRecord[] {
  const { nodeMap, childrenMap } = buildParentChildrenGraph(nodes, edges);
  const child = nodeMap.get(childNodeId);
  if (!child || child.type === 'root') return [];

  const forbidden = new Set<string>([childNodeId]);
  const walk = (id: string) => {
    for (const cid of childrenMap.get(id) ?? []) {
      if (!forbidden.has(cid)) {
        forbidden.add(cid);
        walk(cid);
      }
    }
  };
  walk(childNodeId);

  return nodes.filter((n) => !forbidden.has(n.id));
}

/**
 * Đổi nhánh cha hoặc tách một node ra khỏi nhánh hiện tại một cách an toàn:
 * - Chặn gán cha cho node `root`.
 * - Chặn vòng lặp cha–con (gán node làm con của hậu duệ chính nó).
 * - Đảm bảo mỗi node chỉ có tối đa 1 cạnh `parent` đi vào và cập nhật `parentId` đồng bộ.
 */
export function reparentCanvasNode(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  childNodeId: string,
  newParentId: string | null,
  idFactory: IdFactory
): ReparentNodeResult {
  const { nodeMap, childrenMap } = buildParentChildrenGraph(nodes, edges);
  const childNode = nodeMap.get(childNodeId);
  if (!childNode) {
    return {
      valid: false,
      reason: 'Không tìm thấy node cần chuyển nhánh.',
      removedEdgeIds: [],
    };
  }

  if (newParentId !== null) {
    if (childNode.type === 'root') {
      return {
        valid: false,
        reason: 'Node Chủ đề gốc (Root) không được phép có node cha.',
        removedEdgeIds: [],
      };
    }
    if (newParentId === childNodeId) {
      return {
        valid: false,
        reason: 'Không thể gán một node làm cha của chính nó.',
        removedEdgeIds: [],
      };
    }
    if (!nodeMap.has(newParentId)) {
      return {
        valid: false,
        reason: 'Nhánh cha đích không tồn tại trên bảng.',
        removedEdgeIds: [],
      };
    }

    // Check if newParentId is a descendant of childNodeId
    const descendants = new Set<string>();
    const walk = (id: string) => {
      for (const cid of childrenMap.get(id) ?? []) {
        if (!descendants.has(cid)) {
          descendants.add(cid);
          walk(cid);
        }
      }
    };
    walk(childNodeId);
    if (descendants.has(newParentId)) {
      return {
        valid: false,
        reason: 'Không thể chuyển node vào bên trong nhánh con của chính nó (vòng lặp cây).',
        removedEdgeIds: [],
      };
    }
  }

  const removedEdgeIds = edges
    .filter((e) => e.edgeType === 'parent' && e.target === childNodeId)
    .map((e) => e.id);

  const updatedNode: CanvasNodeRecord = {
    ...childNode,
    parentId: newParentId,
    updatedAt: new Date().toISOString(),
  };

  const addedEdge: CanvasEdgeRecord | undefined =
    newParentId !== null
      ? {
          id: idFactory('edge'),
          boardId: childNode.boardId,
          source: newParentId,
          target: childNodeId,
          edgeType: 'parent',
        }
      : undefined;

  return {
    valid: true,
    updatedNode,
    addedEdge,
    removedEdgeIds,
  };
}

export function createChildNodeSpec(params: {
  boardId: string;
  parentNode: CanvasNodeRecord;
  existingChildrenCount: number;
  type: CanvasNodeType;
  mode: CanvasMode;
  idFactory: IdFactory;
  title?: string;
}): { node: CanvasNodeRecord; edge: CanvasEdgeRecord } {
  const offsetX =
    params.existingChildrenCount === 0
      ? 0
      : (params.existingChildrenCount % 2 === 1 ? 1 : -1) *
        Math.ceil(params.existingChildrenCount / 2) *
        290;

  const node = createCanvasNode({
    id: params.idFactory('cnode'),
    boardId: params.boardId,
    type: params.type,
    mode: params.mode,
    title: params.title,
    parentId: params.parentNode.id,
    position: {
      x: Math.round(params.parentNode.position.x + offsetX),
      y: Math.round(params.parentNode.position.y + NODE_HEIGHT + V_GAP + 20),
    },
  });

  const edge: CanvasEdgeRecord = {
    id: params.idFactory('edge'),
    boardId: params.boardId,
    source: params.parentNode.id,
    target: node.id,
    edgeType: 'parent',
  };

  return { node, edge };
}

/**
 * Nhân bản toàn bộ nhánh cây con (node gốc + các hậu duệ + các cạnh nội bộ).
 * Giữ nguyên entityRef ở dạng tham chiếu nhẹ (không bao giờ sao chép payload bài dạy/học liệu gốc).
 */
export function cloneCanvasSubtree(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  rootNodeId: string,
  idFactory: IdFactory,
  offset: { x: number; y: number } = { x: 48, y: 48 }
): {
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  rootCloneId: string | null;
} {
  const { nodeMap, childrenMap } = buildParentChildrenGraph(nodes, edges);
  const root = nodeMap.get(rootNodeId);
  if (!root) {
    return { nodes: [], edges: [], rootCloneId: null };
  }

  const subtreeIds: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    subtreeIds.push(id);
    for (const childId of childrenMap.get(id) ?? []) {
      walk(childId);
    }
  };
  walk(rootNodeId);

  const idRemap = new Map<string, string>();
  for (const oldId of subtreeIds) {
    idRemap.set(oldId, idFactory('cnode'));
  }

  const now = new Date().toISOString();
  const clonedNodes: CanvasNodeRecord[] = subtreeIds.map((oldId) => {
    const src = nodeMap.get(oldId)!;
    const isRoot = oldId === rootNodeId;
    const newParentId = isRoot
      ? src.parentId ?? null
      : src.parentId
      ? idRemap.get(src.parentId) ?? null
      : null;

    return {
      ...structuredClone(src),
      id: idRemap.get(oldId)!,
      title: isRoot ? `${src.title} (Bản sao)` : src.title,
      parentId: newParentId,
      locked: false,
      position: {
        x: Math.round(src.position.x + offset.x),
        y: Math.round(src.position.y + offset.y),
      },
      createdAt: now,
      updatedAt: now,
    };
  });

  const subtreeSet = new Set(subtreeIds);
  const clonedEdges: CanvasEdgeRecord[] = edges
    .filter((e) => subtreeSet.has(e.source) && subtreeSet.has(e.target))
    .map((e) => ({
      ...e,
      id: idFactory('edge'),
      source: idRemap.get(e.source)!,
      target: idRemap.get(e.target)!,
    }));

  // If the original root had a parent node in the same board, attach clone as sibling branch
  const parentEdgeOfRoot = edges.find(
    (e) => e.edgeType === 'parent' && e.target === rootNodeId
  );
  if (parentEdgeOfRoot && nodeMap.has(parentEdgeOfRoot.source)) {
    clonedEdges.push({
      id: idFactory('edge'),
      boardId: root.boardId,
      source: parentEdgeOfRoot.source,
      target: idRemap.get(rootNodeId)!,
      edgeType: 'parent',
    });
  }

  return {
    nodes: clonedNodes,
    edges: clonedEdges,
    rootCloneId: idRemap.get(rootNodeId) ?? null,
  };
}

export function collectSubtreeDeletePlan(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  rootNodeId: string
): SubtreeDeletePlan {
  const { nodeMap, childrenMap } = buildParentChildrenGraph(nodes, edges);
  const nodeIds: string[] = [];
  const seen = new Set<string>();

  const walk = (id: string) => {
    if (seen.has(id) || !nodeMap.has(id)) return;
    seen.add(id);
    nodeIds.push(id);
    for (const childId of childrenMap.get(id) ?? []) {
      walk(childId);
    }
  };
  walk(rootNodeId);

  const targetSet = new Set(nodeIds);
  const edgeIds = edges
    .filter((e) => targetSet.has(e.source) || targetSet.has(e.target))
    .map((e) => e.id);

  const lockedTitles = nodeIds
    .map((id) => nodeMap.get(id))
    .filter((n): n is CanvasNodeRecord => Boolean(n && n.locked))
    .map((n) => n.title);

  return {
    nodeIds,
    edgeIds,
    hasLockedNode: lockedTitles.length > 0,
    lockedTitles,
  };
}

// --- Phase D: Undo / Redo Stack ---
const MAX_HISTORY_DEPTH = 40;

export function createCanvasHistoryState(): CanvasHistoryState {
  return { past: [], future: [] };
}

export function cloneSnapshot(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  label: string
): CanvasSnapshot {
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
    label,
  };
}

export function pushCanvasHistory(
  history: CanvasHistoryState,
  snapshot: CanvasSnapshot
): CanvasHistoryState {
  const nextPast = [
    ...history.past,
    cloneSnapshot(snapshot.nodes, snapshot.edges, snapshot.label),
  ];
  if (nextPast.length > MAX_HISTORY_DEPTH) {
    nextPast.shift();
  }
  return {
    past: nextPast,
    future: [],
  };
}

export function undoCanvasHistory(
  history: CanvasHistoryState,
  currentSnapshot: CanvasSnapshot
): { history: CanvasHistoryState; restored: CanvasSnapshot | null } {
  if (history.past.length === 0) {
    return { history, restored: null };
  }
  const previous = history.past[history.past.length - 1];
  const nextPast = history.past.slice(0, -1);
  const nextFuture = [
    cloneSnapshot(currentSnapshot.nodes, currentSnapshot.edges, previous.label),
    ...history.future,
  ].slice(0, MAX_HISTORY_DEPTH);

  return {
    history: { past: nextPast, future: nextFuture },
    restored: cloneSnapshot(previous.nodes, previous.edges, previous.label),
  };
}

export function redoCanvasHistory(
  history: CanvasHistoryState,
  currentSnapshot: CanvasSnapshot
): { history: CanvasHistoryState; restored: CanvasSnapshot | null } {
  if (history.future.length === 0) {
    return { history, restored: null };
  }
  const nextItem = history.future[0];
  const nextFuture = history.future.slice(1);
  const nextPast = [
    ...history.past,
    cloneSnapshot(currentSnapshot.nodes, currentSnapshot.edges, nextItem.label),
  ].slice(-MAX_HISTORY_DEPTH);

  return {
    history: { past: nextPast, future: nextFuture },
    restored: cloneSnapshot(nextItem.nodes, nextItem.edges, nextItem.label),
  };
}

// --- Phase E: Workflow Dependency Blocking & Templates ---
export function analyzeWorkflowDependencies(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[]
): WorkflowDependencySummary {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const upstreamMap = new Map<string, string[]>();
  const downstreamMap = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.edgeType !== 'dependency') continue;
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;

    const up = upstreamMap.get(edge.target);
    if (up) {
      if (!up.includes(edge.source)) up.push(edge.source);
    } else {
      upstreamMap.set(edge.target, [edge.source]);
    }

    const down = downstreamMap.get(edge.source);
    if (down) {
      if (!down.includes(edge.target)) down.push(edge.target);
    } else {
      downstreamMap.set(edge.source, [edge.target]);
    }
  }

  const byNodeId: Record<string, NodeDependencyStatus> = {};
  const readyNodeIds: string[] = [];
  const blockedByDependencyIds: string[] = [];

  for (const node of nodes) {
    const upstreamIds = upstreamMap.get(node.id) ?? [];
    const downstreamIds = downstreamMap.get(node.id) ?? [];
    const unfinishedUp = upstreamIds.filter((uid) => {
      const upNode = nodeMap.get(uid);
      if (!upNode) return false;
      return getEffectiveTaskStatus(upNode) !== 'done';
    });

    const effective = getEffectiveTaskStatus(node);
    const isDependencyBlocked =
      unfinishedUp.length > 0 && effective !== 'done';
    const isReadyToStart =
      effective !== null &&
      effective !== 'done' &&
      effective !== 'blocked' &&
      !isDependencyBlocked;

    if (isDependencyBlocked) {
      blockedByDependencyIds.push(node.id);
    }
    if (isReadyToStart) {
      readyNodeIds.push(node.id);
    }

    byNodeId[node.id] = {
      nodeId: node.id,
      isDependencyBlocked,
      isReadyToStart,
      blockedByNodeIds: unfinishedUp,
      blockedByTitles: unfinishedUp
        .map((uid) => nodeMap.get(uid)?.title)
        .filter((t): t is string => Boolean(t)),
      unlocksNodeIds: downstreamIds,
      unlocksTitles: downstreamIds
        .map((did) => nodeMap.get(did)?.title)
        .filter((t): t is string => Boolean(t)),
    };
  }

  return {
    byNodeId,
    readyNodeIds,
    blockedByDependencyIds,
  };
}

export function instantiateWorkflowTemplate(params: {
  templateId: string;
  boardId: string;
  mode: CanvasMode;
  origin: { x: number; y: number };
  idFactory: IdFactory;
}): {
  template: WorkflowCanvasTemplate;
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
} {
  const template =
    WORKFLOW_CANVAS_TEMPLATES.find((t) => t.id === params.templateId) ??
    WORKFLOW_CANVAS_TEMPLATES[0];

  const makeNode = (
    type: CanvasNodeType,
    title: string,
    description: string,
    status: CanvasTaskStatus | undefined,
    checklistLabels?: string[]
  ) => {
    const id = params.idFactory('cnode');
    return createCanvasNode({
      id,
      boardId: params.boardId,
      type,
      mode: params.mode,
      title,
      description,
      position: { x: params.origin.x, y: params.origin.y },
      status,
      checklist: checklistLabels?.map((label, idx) => ({
        id: `${id}-chk-${idx + 1}`,
        label,
        done: false,
      })),
    });
  };

  const makeDep = (source: string, target: string, label = 'Hoàn tất trước') => ({
    id: params.idFactory('edge'),
    boardId: params.boardId,
    source,
    target,
    edgeType: 'dependency' as const,
    label,
  });

  let createdNodes: CanvasNodeRecord[] = [];
  let createdEdges: CanvasEdgeRecord[] = [];

  if (template.id === 'tpl-math-exam') {
    const n1 = makeNode(
      'task',
      '1. Nhập đề gốc & kiểm tra ký hiệu Toán',
      'Dán đề chuẩn cấu trúc Câu 1..N, giữ nguyên phân số/căn thức LaTeX.',
      'in_progress'
    );
    const n2 = makeNode(
      'checklist',
      '2. Chạy Math Integrity Check',
      'Đảm bảo không gãy công thức, đủ 4 phương án A/B/C/D và đáp án đúng.',
      'todo',
      [
        'Kiểm tra biến số & dấu âm/dương',
        'Xác nhận đáp án gốc khớp từng câu',
      ]
    );
    const n3 = makeNode(
      'task',
      '3. Thiết lập Math Lock bảo vệ đề',
      'Khóa vị trí câu phụ thuộc, nhóm câu chung hình vẽ/bảng số liệu.',
      'todo'
    );
    const n4 = makeNode(
      'task',
      '4. Sinh mã đề 101–104 & Ma trận đáp án',
      'Kiểm tra lại từng mã đề trên cột Preview song song.',
      'todo'
    );
    const n5 = makeNode(
      'milestone',
      '5. Duyệt bản in A4 & phát đề',
      'Mốc sẵn sàng in đồng loạt không lỗi công thức.',
      'todo'
    );
    createdNodes = [n1, n2, n3, n4, n5];
    createdEdges = [
      makeDep(n1.id, n2.id),
      makeDep(n2.id, n3.id),
      makeDep(n3.id, n4.id),
      makeDep(n4.id, n5.id),
    ];
  } else if (template.id === 'tpl-post-lesson') {
    const n1 = makeNode(
      'task',
      '1. Tổng hợp phản hồi & tốc độ làm bài trên lớp',
      'Ghi lại câu học sinh hay sai hoặc hoạt động bị lố giờ.',
      'todo'
    );
    const n2 = makeNode(
      'note',
      '2. Ghi Teaching Journal ngay sau tiết',
      'Đánh dấu điểm hiệu quả và điều chỉnh cần sửa cho tiết sau.',
      undefined
    );
    const n3 = makeNode(
      'task',
      '3. Bổ sung câu hỏi gợi ý vào Resource Vault',
      'Lưu học liệu vừa tinh chỉnh để tái sử dụng toàn tổ chuyên môn.',
      'todo'
    );
    const n4 = makeNode(
      'milestone',
      '4. Nhân bản biến thể cho lớp song song',
      'Tạo phiên bản tối ưu sẵn sàng dạy lớp kế tiếp.',
      'todo'
    );
    createdNodes = [n1, n2, n3, n4];
    createdEdges = [
      makeDep(n1.id, n2.id),
      makeDep(n2.id, n3.id),
      makeDep(n3.id, n4.id),
    ];
  } else {
    // tpl-lesson-45-90
    const n1 = makeNode(
      'task',
      '1. Xác định mục tiêu & chuỗi hoạt động 5–15p',
      'Cân đối thời lượng khởi động, hình thành kiến thức và luyện tập.',
      'in_progress'
    );
    const n2 = makeNode(
      'checklist',
      '2. Phân bổ Phiếu A / B / C & Rubric',
      'Kiểm tra đủ câu hỏi nền tảng, chuẩn và vận dụng trên 3 phiếu.',
      'todo',
      [
        'Phiếu A: Mức nhận biết – thông hiểu',
        'Phiếu B: Chuẩn trọng tâm bài học',
        'Phiếu C: Vận dụng mở rộng',
      ]
    );
    const n3 = makeNode(
      'task',
      '3. Xem trước & căn lề bản in A4',
      'Kiểm tra ngắt trang, cột điểm Rubric và phông chữ in.',
      'todo'
    );
    const n4 = makeNode(
      'milestone',
      '4. Sẵn sàng lên lớp (In xong hồ sơ)',
      'Mốc kiểm soát hoàn tất toàn bộ khâu chuẩn bị trước tiết.',
      'todo'
    );
    const n5 = makeNode(
      'task',
      '5. Tổ chức hoạt động & quan sát trên lớp',
      'Theo dõi nhịp độ làm phiếu học tập theo nhóm/cá nhân.',
      'todo'
    );
    const n6 = makeNode(
      'task',
      '6. Rút kinh nghiệm & lưu Teaching Journal',
      'Cập nhật điểm cần điều chỉnh cho lớp dạy song song.',
      'todo'
    );
    createdNodes = [n1, n2, n3, n4, n5, n6];
    createdEdges = [
      makeDep(n1.id, n2.id),
      makeDep(n2.id, n3.id),
      makeDep(n3.id, n4.id),
      makeDep(n4.id, n5.id),
      makeDep(n5.id, n6.id),
    ];
  }

  // Apply clean left-to-right layout and shift to requested origin
  const laidOut = applyCanvasAutoLayout(createdNodes, createdEdges, 'tree-lr');
  const minX = Math.min(...laidOut.map((n) => n.position.x));
  const minY = Math.min(...laidOut.map((n) => n.position.y));
  const shiftedNodes = laidOut.map((n) => ({
    ...n,
    position: {
      x: Math.round(n.position.x - minX + params.origin.x),
      y: Math.round(n.position.y - minY + params.origin.y),
    },
  }));

  return {
    template,
    nodes: shiftedNodes,
    edges: createdEdges,
  };
}

/**
 * Dựng nhanh nhánh sơ đồ Mind Map / Tree cho một Bộ tiết dạy (LessonPack)
 * và tự động móc nối các Học liệu / Nhật ký / Quy trình có liên quan qua `entityRef`.
 */
export function buildLessonPackWorkspaceTree(params: {
  boardId: string;
  mode: CanvasMode;
  pack: LessonPack;
  resources: ResourceItem[];
  journals: JournalEntry[];
  workflows: WorkflowRun[];
  origin: { x: number; y: number };
  idFactory: IdFactory;
}): { nodes: CanvasNodeRecord[]; edges: CanvasEdgeRecord[] } {
  const { boardId, mode, pack, resources, journals, workflows, origin, idFactory } =
    params;

  const packNode = createReferenceNode({
    id: idFactory('cref'),
    boardId,
    mode,
    kind: 'LessonPack',
    entityId: pack.id,
    label: pack.title || '(Bộ tiết dạy chưa đặt tên)',
    meta: `${pack.subject} · ${pack.grade} · ${pack.duration} phút`,
    position: { x: origin.x, y: origin.y },
  });

  const nodes: CanvasNodeRecord[] = [packNode];
  const edges: CanvasEdgeRecord[] = [];

  const attachChild = (parentId: string, child: CanvasNodeRecord) => {
    child.parentId = parentId;
    nodes.push(child);
    edges.push({
      id: idFactory('edge'),
      boardId,
      source: parentId,
      target: child.id,
      edgeType: 'parent',
    });
  };

  // Matched resources (by subject or grade, up to 3)
  const matchedResources = resources
    .filter(
      (r) =>
        r.subject === pack.subject ||
        r.grade === pack.grade ||
        (pack.title && r.title.toLowerCase().includes(pack.title.toLowerCase()))
    )
    .slice(0, 3);

  for (const res of matchedResources) {
    attachChild(
      packNode.id,
      createReferenceNode({
        id: idFactory('cref'),
        boardId,
        mode,
        kind: 'ResourceItem',
        entityId: res.id,
        label: res.title,
        meta: `${res.subject} · ${res.grade}`,
        position: { x: origin.x + 320, y: origin.y },
      })
    );
  }

  // Matched journals
  const matchedJournals = journals
    .filter((j) => j.packId === pack.id)
    .slice(0, 2);

  for (const j of matchedJournals) {
    attachChild(
      packNode.id,
      createReferenceNode({
        id: idFactory('cref'),
        boardId,
        mode,
        kind: 'JournalEntry',
        entityId: j.id,
        label: `Nhật ký ${j.classLabel} (${j.taughtDate})`,
        meta: j.nextAdjustment || j.whatWorked,
        position: { x: origin.x + 320, y: origin.y },
      })
    );
  }

  // Matched workflow runs
  const matchedWorkflows = workflows
    .filter((w) => w.linkedPackId === pack.id)
    .slice(0, 2);

  for (const wf of matchedWorkflows) {
    const done = wf.steps.filter((s) => s.done).length;
    attachChild(
      packNode.id,
      createReferenceNode({
        id: idFactory('cref'),
        boardId,
        mode,
        kind: 'WorkflowRun',
        entityId: wf.id,
        label: wf.title,
        meta: `${done}/${wf.steps.length} đầu việc hoàn tất`,
        position: { x: origin.x + 320, y: origin.y },
      })
    );
  }

  // Fallback preparation checklist branch if no matched items exist yet
  if (nodes.length === 1) {
    attachChild(
      packNode.id,
      createCanvasNode({
        id: idFactory('cnode'),
        boardId,
        type: 'checklist',
        mode,
        title: `Kiểm tra hồ sơ: ${pack.title}`,
        description: `${pack.activities.length} hoạt động · ${pack.questions.length} câu hỏi · ${pack.rubric.length} Rubric`,
        position: { x: origin.x + 320, y: origin.y },
        checklist: [
          {
            id: `${pack.id}-c1`,
            label: `Rà soát ${pack.activities.length} hoạt động (5–15p)`,
            done: pack.activities.length > 0,
          },
          {
            id: `${pack.id}-c2`,
            label: 'Duyệt phân bổ Phiếu A/B/C & in A4',
            done: pack.status === 'completed',
          },
        ],
      })
    );
  }

  const laidOut = applyCanvasAutoLayout(nodes, edges, 'tree-lr');
  const minX = Math.min(...laidOut.map((n) => n.position.x));
  const minY = Math.min(...laidOut.map((n) => n.position.y));
  const shifted = laidOut.map((n) => ({
    ...n,
    position: {
      x: Math.round(n.position.x - minX + origin.x),
      y: Math.round(n.position.y - minY + origin.y),
    },
  }));

  return { nodes: shifted, edges };
}

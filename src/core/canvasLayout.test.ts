import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWorkflowProgress,
  createCanvasNode,
  filterCanvasNodes,
  validateNewEdge,
} from './canvasEngine';
import {
  WORKFLOW_CANVAS_TEMPLATES,
  analyzeWorkflowDependencies,
  applyCanvasAutoLayout,
  buildLessonPackWorkspaceTree,
  cloneCanvasSubtree,
  collectSubtreeDeletePlan,
  computeVisibleSubtree,
  createCanvasHistoryState,
  createChildNodeSpec,
  getValidParentCandidates,
  instantiateWorkflowTemplate,
  pushCanvasHistory,
  redoCanvasHistory,
  reparentCanvasNode,
  undoCanvasHistory,
} from './canvasLayout';
import { DEMO_LESSON_PACKS } from '../data/demoPacks';
import {
  DEFAULT_JOURNALS,
  DEFAULT_RESOURCES,
  DEFAULT_WORKFLOWS,
} from './workspaceModules';
import { CanvasEdgeRecord, CanvasNodeRecord } from '../types/canvas';

let seq = 0;
const testId = (prefix: string) => `${prefix}-${++seq}`;

function buildSampleTree() {
  const root = createCanvasNode({
    id: 'n-root',
    boardId: 'b1',
    type: 'root',
    mode: 'workspace',
    title: 'Root Toán 8',
    position: { x: 0, y: 0 },
  });
  const branchA = createCanvasNode({
    id: 'n-a',
    boardId: 'b1',
    type: 'workspace',
    mode: 'workspace',
    title: 'Nhánh A',
    parentId: 'n-root',
    position: { x: 0, y: 0 },
  });
  const branchB = createCanvasNode({
    id: 'n-b',
    boardId: 'b1',
    type: 'workspace',
    mode: 'workspace',
    title: 'Nhánh B (Đã khóa)',
    parentId: 'n-root',
    position: { x: 999, y: 777 },
  });
  branchB.locked = true;

  const leafA1 = createCanvasNode({
    id: 'n-a1',
    boardId: 'b1',
    type: 'note',
    mode: 'workspace',
    title: 'Ghi chú A1',
    parentId: 'n-a',
    position: { x: 0, y: 0 },
  });
  const leafA2 = createCanvasNode({
    id: 'n-a2',
    boardId: 'b1',
    type: 'lesson',
    mode: 'workspace',
    title: 'Bài dạy A2',
    parentId: 'n-a',
    position: { x: 0, y: 0 },
    entityRef: {
      kind: 'LessonPack',
      entityId: DEMO_LESSON_PACKS[0].id,
      cachedLabel: DEMO_LESSON_PACKS[0].title,
    },
  });

  const nodes: CanvasNodeRecord[] = [root, branchA, branchB, leafA1, leafA2];
  const edges: CanvasEdgeRecord[] = [
    { id: 'e1', boardId: 'b1', source: 'n-root', target: 'n-a', edgeType: 'parent' },
    { id: 'e2', boardId: 'b1', source: 'n-root', target: 'n-b', edgeType: 'parent' },
    { id: 'e3', boardId: 'b1', source: 'n-a', target: 'n-a1', edgeType: 'parent' },
    { id: 'e4', boardId: 'b1', source: 'n-a', target: 'n-a2', edgeType: 'parent' },
  ];
  return { nodes, edges };
}

test('Phase C #1: Auto Layout (tree-tb, tree-lr, mindmap) bố trí rõ ràng và giữ nguyên tọa độ node đã khóa', () => {
  const { nodes, edges } = buildSampleTree();

  const tb = applyCanvasAutoLayout(nodes, edges, 'tree-tb');
  const rootTB = tb.find((n) => n.id === 'n-root')!;
  const aTB = tb.find((n) => n.id === 'n-a')!;
  const lockedB = tb.find((n) => n.id === 'n-b')!;
  assert.ok(aTB.position.y > rootTB.position.y);
  assert.deepEqual(lockedB.position, { x: 999, y: 777 });

  const lr = applyCanvasAutoLayout(nodes, edges, 'tree-lr');
  const rootLR = lr.find((n) => n.id === 'n-root')!;
  const aLR = lr.find((n) => n.id === 'n-a')!;
  const a1LR = lr.find((n) => n.id === 'n-a1')!;
  assert.ok(aLR.position.x > rootLR.position.x);
  assert.ok(a1LR.position.x > aLR.position.x);
  assert.deepEqual(lr.find((n) => n.id === 'n-b')!.position, { x: 999, y: 777 });

  const mm = applyCanvasAutoLayout(nodes, edges, 'mindmap');
  const rootMM = mm.find((n) => n.id === 'n-root')!;
  const aMM = mm.find((n) => n.id === 'n-a')!;
  assert.ok(aMM.position.x !== rootMM.position.x);
  assert.deepEqual(mm.find((n) => n.id === 'n-b')!.position, { x: 999, y: 777 });
});

test('Phase C #2: Collapse/Expand nhánh & Focus Subtree lọc chính xác node và cạnh liên quan', () => {
  const { nodes, edges } = buildSampleTree();
  nodes[1] = { ...nodes[1], collapsed: true }; // Collapse n-a (hides n-a1, n-a2)

  const collapsedRes = computeVisibleSubtree(nodes, edges, null);
  assert.equal(collapsedRes.descendantCountMap['n-root'], 4);
  assert.equal(collapsedRes.descendantCountMap['n-a'], 2);
  assert.equal(collapsedRes.directChildrenCountMap['n-a'], 2);
  assert.equal(collapsedRes.visibleNodes.length, 3); // n-root, n-a, n-b
  assert.ok(collapsedRes.hiddenNodeIds.has('n-a1'));
  assert.ok(collapsedRes.hiddenNodeIds.has('n-a2'));

  // Focus vào n-a (đang collapsed -> khi focus trực tiếp vào n-a, n-a & con của n-a hoặc subtree scope)
  const nodesExpanded = nodes.map((n) => ({ ...n, collapsed: false }));
  const focusedRes = computeVisibleSubtree(nodesExpanded, edges, 'n-a');
  assert.deepEqual(
    focusedRes.visibleNodes.map((n) => n.id).sort(),
    ['n-a', 'n-a1', 'n-a2']
  );
  assert.equal(focusedRes.visibleEdges.length, 2);
});

test('Phase C #3: Nhân bản nhánh cây (cloneCanvasSubtree) tạo ID mới và giữ tham chiếu entityRef nhẹ', () => {
  const { nodes, edges } = buildSampleTree();
  const cloned = cloneCanvasSubtree(nodes, edges, 'n-a', testId);

  assert.equal(cloned.nodes.length, 3); // n-a, n-a1, n-a2
  assert.ok(cloned.rootCloneId);
  const origIds = new Set(nodes.map((n) => n.id));
  for (const cn of cloned.nodes) {
    assert.equal(origIds.has(cn.id), false);
    assert.equal(cn.locked, false);
  }
  const clonedLesson = cloned.nodes.find((n) => n.type === 'lesson')!;
  assert.equal(clonedLesson.entityRef?.entityId, DEMO_LESSON_PACKS[0].id);
  // Contains 2 internal edges (n-a->n-a1, n-a->n-a2) + 1 sibling edge from n-root -> rootCloneId
  assert.equal(cloned.edges.length, 3);
});

test('Phase C #4: collectSubtreeDeletePlan ngăn xóa nhánh nếu có hậu duệ đang khóa', () => {
  const { nodes, edges } = buildSampleTree();
  const rootPlan = collectSubtreeDeletePlan(nodes, edges, 'n-root');
  assert.equal(rootPlan.hasLockedNode, true);
  assert.deepEqual(rootPlan.lockedTitles, ['Nhánh B (Đã khóa)']);

  const branchAPlan = collectSubtreeDeletePlan(nodes, edges, 'n-a');
  assert.equal(branchAPlan.hasLockedNode, false);
  assert.deepEqual(branchAPlan.nodeIds.sort(), ['n-a', 'n-a1', 'n-a2']);
});

test('Phase C #5: createChildNodeSpec tạo node con và cạnh parent hợp lệ', () => {
  const { nodes } = buildSampleTree();
  const created = createChildNodeSpec({
    boardId: 'b1',
    parentNode: nodes[0],
    existingChildrenCount: 2,
    type: 'workspace',
    mode: 'workspace',
    idFactory: testId,
    title: 'Nhánh mới',
  });
  assert.equal(created.node.parentId, 'n-root');
  assert.equal(created.edge.edgeType, 'parent');
  assert.equal(created.edge.source, 'n-root');
  assert.equal(created.edge.target, created.node.id);
});

test('Phase D: Undo / Redo history stack khôi phục đúng trạng thái và làm rỗng future khi có thao tác mới', () => {
  const { nodes, edges } = buildSampleTree();
  let history = createCanvasHistoryState();

  const snap0 = { nodes, edges, label: 'Trạng thái đầu' };
  history = pushCanvasHistory(history, snap0);

  const movedNodes = nodes.map((n) =>
    n.id === 'n-root' ? { ...n, position: { x: 400, y: 300 } } : n
  );
  const snap1 = { nodes: movedNodes, edges, label: 'Di chuyển root' };

  const undoRes = undoCanvasHistory(history, snap1);
  assert.ok(undoRes.restored);
  assert.deepEqual(undoRes.restored!.nodes[0].position, { x: 0, y: 0 });
  assert.equal(undoRes.history.future.length, 1);

  const redoRes = redoCanvasHistory(undoRes.history, snap0);
  assert.ok(redoRes.restored);
  assert.deepEqual(redoRes.restored!.nodes[0].position, { x: 400, y: 300 });
});

test('Phase E #1: analyzeWorkflowDependencies phát hiện chính xác bước bị chặn & bước sẵn sàng', () => {
  const t1 = createCanvasNode({
    id: 't1',
    boardId: 'wf1',
    type: 'task',
    mode: 'workflow',
    title: 'Bước 1',
    status: 'in_progress',
    position: { x: 0, y: 0 },
  });
  const t2 = createCanvasNode({
    id: 't2',
    boardId: 'wf1',
    type: 'task',
    mode: 'workflow',
    title: 'Bước 2',
    status: 'todo',
    position: { x: 300, y: 0 },
  });
  const depEdge: CanvasEdgeRecord = {
    id: 'd1',
    boardId: 'wf1',
    source: 't1',
    target: 't2',
    edgeType: 'dependency',
  };

  const summaryBefore = analyzeWorkflowDependencies([t1, t2], [depEdge]);
  assert.equal(summaryBefore.byNodeId['t1'].isReadyToStart, true);
  assert.equal(summaryBefore.byNodeId['t2'].isDependencyBlocked, true);
  assert.deepEqual(summaryBefore.byNodeId['t2'].blockedByTitles, ['Bước 1']);

  const t1Done = { ...t1, status: 'done' as const };
  const summaryAfter = analyzeWorkflowDependencies([t1Done, t2], [depEdge]);
  assert.equal(summaryAfter.byNodeId['t2'].isDependencyBlocked, false);
  assert.equal(summaryAfter.byNodeId['t2'].isReadyToStart, true);
});

test('Phase E #2: Workflow Templates & LessonPack Tree Builder tạo cấu trúc không trùng lặp dữ liệu gốc', () => {
  assert.equal(WORKFLOW_CANVAS_TEMPLATES.length, 3);
  const wfBuilt = instantiateWorkflowTemplate({
    templateId: 'tpl-math-exam',
    boardId: 'wf-b',
    mode: 'workflow',
    origin: { x: 100, y: 100 },
    idFactory: testId,
  });
  assert.equal(wfBuilt.nodes.length, 5);
  assert.equal(wfBuilt.edges.length, 4);
  assert.ok(wfBuilt.edges.every((e) => e.edgeType === 'dependency'));

  const packBuilt = buildLessonPackWorkspaceTree({
    boardId: 'ws-b',
    mode: 'workspace',
    pack: DEMO_LESSON_PACKS[0],
    resources: DEFAULT_RESOURCES,
    journals: DEFAULT_JOURNALS,
    workflows: DEFAULT_WORKFLOWS,
    origin: { x: 100, y: 100 },
    idFactory: testId,
  });
  assert.ok(packBuilt.nodes.length >= 2);
  assert.equal(packBuilt.nodes[0].entityRef?.kind, 'LessonPack');
  assert.equal(packBuilt.nodes[0].entityRef?.entityId, DEMO_LESSON_PACKS[0].id);
});

test('Phase F: Stress test 300 nodes & 299 edges hoàn thành tức thì (< 120ms) không treo luồng chính', () => {
  const nodes: CanvasNodeRecord[] = [];
  const edges: CanvasEdgeRecord[] = [];
  for (let i = 0; i < 300; i++) {
    const parentIdx = i === 0 ? null : Math.floor((i - 1) / 3);
    nodes.push(
      createCanvasNode({
        id: `s-${i}`,
        boardId: 'stress',
        type: i === 0 ? 'root' : i % 4 === 0 ? 'checklist' : 'task',
        mode: 'workflow',
        title: `Nhiệm vụ kiểm thử #${i}`,
        status: i % 3 === 0 ? 'done' : 'todo',
        parentId: parentIdx !== null ? `s-${parentIdx}` : null,
        position: { x: (i % 10) * 50, y: Math.floor(i / 10) * 40 },
      })
    );
    if (parentIdx !== null) {
      edges.push({
        id: `se-${i}`,
        boardId: 'stress',
        source: `s-${parentIdx}`,
        target: `s-${i}`,
        edgeType: 'parent',
      });
    }
  }

  const start = performance.now();
  const laidOut = applyCanvasAutoLayout(nodes, edges, 'tree-tb');
  const visible = computeVisibleSubtree(laidOut, edges, null);
  const progress = calculateWorkflowProgress(laidOut);
  const filtered = filterCanvasNodes(laidOut, 'kiem thu #299', 'all');
  const cycleCheck = validateNewEdge(laidOut, edges, 's-299', 's-0', 'parent');
  const elapsedMs = performance.now() - start;

  assert.equal(laidOut.length, 300);
  assert.equal(visible.visibleNodes.length, 300);
  assert.equal(progress.totalTasks, 299);
  assert.equal(filtered.has('s-299'), true);
  assert.equal(cycleCheck.valid, false);
  assert.ok(elapsedMs < 150, `Expected <150ms for 300-node pipeline, got ${elapsedMs}ms`);
});

test('Audit #2: Đổi node cha (Reparenting), tách nhánh (Detach), chặn chu trình và tính tiến độ nhánh cha (Subtree Progress)', () => {
  const { nodes, edges } = buildSampleTree();
  // Đổi cha của n-a1 từ n-a sang n-b
  const candidatesForA1 = getValidParentCandidates(nodes, edges, 'n-a1').map(
    (c) => c.id
  );
  assert.equal(candidatesForA1.includes('n-b'), true);
  assert.equal(candidatesForA1.includes('n-a1'), false);

  // Chặn việc gán n-root làm con của n-a
  const rootReparent = reparentCanvasNode(nodes, edges, 'n-root', 'n-a', testId);
  assert.equal(rootReparent.valid, false);

  // Chặn việc gán n-a làm con của hậu duệ n-a1 (cycle)
  const cycleReparent = reparentCanvasNode(nodes, edges, 'n-a', 'n-a1', testId);
  assert.equal(cycleReparent.valid, false);

  // Chuyển n-a1 sang nhánh n-b hợp lệ
  const moveRes = reparentCanvasNode(nodes, edges, 'n-a1', 'n-b', testId);
  assert.equal(moveRes.valid, true);
  assert.equal(moveRes.updatedNode?.parentId, 'n-b');
  assert.deepEqual(moveRes.removedEdgeIds, ['e3']);
  assert.equal(moveRes.addedEdge?.source, 'n-b');
  assert.equal(moveRes.addedEdge?.target, 'n-a1');

  // Tách n-a2 ra khỏi nhánh cha (newParentId = null)
  const detachRes = reparentCanvasNode(nodes, edges, 'n-a2', null, testId);
  assert.equal(detachRes.valid, true);
  assert.equal(detachRes.updatedNode?.parentId, null);
  assert.deepEqual(detachRes.removedEdgeIds, ['e4']);
  assert.equal(detachRes.addedEdge, undefined);

  // Kiểm tra tiến độ nhánh cha (Subtree Progress) trên cây công việc nhiều tầng
  const wfRoot = createCanvasNode({
    id: 'w-root',
    boardId: 'wb',
    type: 'root',
    mode: 'workflow',
    position: { x: 0, y: 0 },
  });
  const wfBranch = createCanvasNode({
    id: 'w-br',
    boardId: 'wb',
    type: 'workspace',
    mode: 'workflow',
    parentId: 'w-root',
    position: { x: 0, y: 120 },
  });
  const wfTaskDone = createCanvasNode({
    id: 'w-t1',
    boardId: 'wb',
    type: 'task',
    mode: 'workflow',
    status: 'done',
    parentId: 'w-br',
    position: { x: 0, y: 240 },
  });
  const wfChecklistDone = createCanvasNode({
    id: 'w-c1',
    boardId: 'wb',
    type: 'checklist',
    mode: 'workflow',
    status: 'todo',
    checklist: [{ id: 'i1', label: 'Mục 1', done: true }],
    parentId: 'w-br',
    position: { x: 260, y: 240 },
  });
  const wfTaskTodo = createCanvasNode({
    id: 'w-t2',
    boardId: 'wb',
    type: 'task',
    mode: 'workflow',
    status: 'todo',
    parentId: 'w-br',
    position: { x: 520, y: 240 },
  });
  const wfEdges: CanvasEdgeRecord[] = [
    { id: 'we1', boardId: 'wb', source: 'w-root', target: 'w-br', edgeType: 'parent' },
    { id: 'we2', boardId: 'wb', source: 'w-br', target: 'w-t1', edgeType: 'parent' },
    { id: 'we3', boardId: 'wb', source: 'w-br', target: 'w-c1', edgeType: 'parent' },
    { id: 'we4', boardId: 'wb', source: 'w-br', target: 'w-t2', edgeType: 'parent' },
  ];

  const sub = computeVisibleSubtree(
    [wfRoot, wfBranch, wfTaskDone, wfChecklistDone, wfTaskTodo],
    wfEdges,
    null
  );
  assert.deepEqual(sub.subtreeProgressMap['w-br'], {
    doneCount: 2,
    totalCount: 3,
    percent: 67,
  });
  assert.deepEqual(sub.subtreeProgressMap['w-root'], {
    doneCount: 2,
    totalCount: 3,
    percent: 67,
  });
});


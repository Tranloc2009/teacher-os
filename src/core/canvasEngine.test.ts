import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWorkflowProgress,
  createCanvasNode,
  createReferenceNode,
  filterCanvasNodes,
  getAncestorsBreadcrumb,
  normalizeCanvasViewSettings,
  resolveEntityReference,
  validateNewEdge,
  wouldCreateEdgeCycle,
} from './canvasEngine';
import {
  DEFAULT_CANVAS_BOARDS,
  DEFAULT_CANVAS_EDGES,
  DEFAULT_CANVAS_NODES,
  DEFAULT_CANVAS_VIEW_SETTINGS,
} from '../data/demoCanvas';
import { DEMO_LESSON_PACKS } from '../data/demoPacks';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import {
  DEFAULT_JOURNALS,
  DEFAULT_RESOURCES,
  DEFAULT_WORKFLOWS,
} from './workspaceModules';
import { CANVAS_NODE_CATALOG, CanvasNodeType } from '../types/canvas';
import {
  createBackupPayload,
  DEFAULT_PRINT_SETTINGS,
  validateBackupPayload,
} from '../utils/backup';

test('Phase A #1: Khởi tạo đầy đủ 10 loại node với ngữ nghĩa mặc định cho workspace & workflow', () => {
  const allTypes: CanvasNodeType[] = [
    'root',
    'workspace',
    'task',
    'lesson',
    'resource',
    'document',
    'checklist',
    'note',
    'milestone',
    'workflow',
  ];
  assert.equal(CANVAS_NODE_CATALOG.length, 10);

  for (const type of allTypes) {
    const node = createCanvasNode({
      id: `n-${type}`,
      boardId: 'b-1',
      type,
      mode: 'workflow',
      position: { x: 120.7, y: 84.2 },
    });
    assert.equal(node.type, type);
    assert.deepEqual(node.position, { x: 121, y: 84 });
    assert.equal(node.locked, false);
    if (type === 'checklist') {
      assert.ok(Array.isArray(node.checklist) && node.checklist.length >= 2);
    }
    if (type === 'task' || type === 'milestone' || type === 'workflow' || type === 'checklist') {
      assert.equal(node.status, 'todo');
    }
  }
});

test('Phase A #2: Node tham chiếu CHỈ lưu entityRef (không sao chép LessonPack) & xử lý an toàn khi bản gốc bị xóa', () => {
  const pack = DEMO_LESSON_PACKS[0];
  const refNode = createReferenceNode({
    id: 'ref-pack-1',
    boardId: 'b-ws',
    mode: 'workspace',
    kind: 'LessonPack',
    entityId: pack.id,
    label: pack.title,
    meta: `${pack.subject} · ${pack.grade}`,
    position: { x: 100, y: 200 },
  });

  // Kiểm tra node KHÔNG chứa payload nặng của LessonPack (questions/activities/rubric)
  assert.equal(refNode.type, 'lesson');
  assert.equal(refNode.entityRef?.kind, 'LessonPack');
  assert.equal(refNode.entityRef?.entityId, pack.id);
  assert.equal('questions' in refNode, false);
  assert.equal('activities' in refNode, false);

  const liveResolved = resolveEntityReference(refNode.entityRef, {
    packs: DEMO_LESSON_PACKS,
    resources: DEFAULT_RESOURCES,
    journals: DEFAULT_JOURNALS,
    workflows: DEFAULT_WORKFLOWS,
    mathExams: [DEMO_MATH_EXAM],
  });
  assert.ok(liveResolved);
  assert.equal(liveResolved.exists, true);
  assert.equal(liveResolved.targetApp, 'lesson-studio');
  assert.equal(liveResolved.title, pack.title);

  // Khi bản gốc bị xóa khỏi kho
  const missingResolved = resolveEntityReference(refNode.entityRef, {
    packs: [],
    resources: [],
    journals: [],
    workflows: [],
    mathExams: [],
  });
  assert.ok(missingResolved);
  assert.equal(missingResolved.exists, false);
  assert.ok(missingResolved.subtitle.includes('đã bị xóa'));
});

test('Phase A #3: Phát hiện và chặn vòng lặp (cycle) cho parent & dependency, giữ chuẩn cây 1 cha', () => {
  const nodes = [
    createCanvasNode({ id: 'a', boardId: 'b', type: 'task', mode: 'workflow', position: { x: 0, y: 0 } }),
    createCanvasNode({ id: 'b', boardId: 'b', type: 'task', mode: 'workflow', position: { x: 200, y: 0 } }),
    createCanvasNode({ id: 'c', boardId: 'b', type: 'task', mode: 'workflow', position: { x: 400, y: 0 } }),
  ];

  const depEdges = [
    { id: 'e1', boardId: 'b', source: 'a', target: 'b', edgeType: 'dependency' as const },
    { id: 'e2', boardId: 'b', source: 'b', target: 'c', edgeType: 'dependency' as const },
  ];

  // Chặn tự nối
  const selfLoop = validateNewEdge(nodes, depEdges, 'a', 'a', 'dependency');
  assert.equal(selfLoop.valid, false);

  // Chặn vòng lặp C -> A khi đã có A -> B -> C
  assert.equal(wouldCreateEdgeCycle(depEdges, 'c', 'a', 'dependency'), true);
  const depCycle = validateNewEdge(nodes, depEdges, 'c', 'a', 'dependency');
  assert.equal(depCycle.valid, false);
  assert.ok(depCycle.reason?.includes('vòng lặp phụ thuộc'));

  // Cho phép A -> C (DAG hợp lệ)
  const validShortcut = validateNewEdge(nodes, depEdges, 'a', 'c', 'dependency');
  assert.equal(validShortcut.valid, true);

  // Kiểm tra bất biến cây 1 cha cho cạnh 'parent'
  const parentEdges = [
    { id: 'p1', boardId: 'b', source: 'a', target: 'c', edgeType: 'parent' as const },
  ];
  const secondParent = validateNewEdge(nodes, parentEdges, 'b', 'c', 'parent');
  assert.equal(secondParent.valid, false);
  assert.ok(secondParent.reason?.includes('một node cha'));
});

test('Phase A #4: Tính tiến độ Workflow thực tế từ task, checklist, milestone (không tính root/note)', () => {
  const wfNodes = DEFAULT_CANVAS_NODES.filter((n) => n.boardId === 'canvas-wf-tiet-a4');
  const summary = calculateWorkflowProgress(wfNodes);

  // wf-root-1 không tính; có 5 node thực thi (2 done, 1 in_progress, 2 todo)
  assert.equal(summary.totalTasks, 5);
  assert.equal(summary.doneCount, 2);
  assert.equal(summary.inProgressCount, 1);
  assert.equal(summary.todoCount, 2);
  assert.equal(summary.blockedCount, 0);
  assert.equal(summary.progressPercent, 40);
});

test('Phase A #5: Truy vết đường dẫn Breadcrumb từ Root tới Node đang chọn & lọc tiếng Việt không dấu', () => {
  const wsNodes = DEFAULT_CANVAS_NODES.filter((n) => n.boardId === 'canvas-ws-toan-8');
  const wsEdges = DEFAULT_CANVAS_EDGES.filter((e) => e.boardId === 'canvas-ws-toan-8');

  const chain = getAncestorsBreadcrumb(wsNodes, wsEdges, 'ws-node-res-q1');
  assert.deepEqual(
    chain.map((n) => n.id),
    ['ws-root-1', 'ws-branch-res', 'ws-node-res-q1']
  );

  const matched = filterCanvasNodes(wsNodes, 'chuyen dong');
  assert.equal(matched.has('ws-node-res-q1'), true);
  assert.equal(matched.has('ws-node-exam-1'), false);
});

test('Phase A #6: Tương thích sao lưu JSON TeacherOS 4.0 khi kèm dữ liệu Canvas Engine & chuẩn hóa ViewSettings', () => {
  const normalizedView = normalizeCanvasViewSettings(
    {
      boardId: 'canvas-ws-toan-8',
      viewport: { x: 10, y: 20, zoom: 99 },
      snapToGrid: true,
      showMiniMap: false,
      showGrid: true,
    },
    'canvas-ws-toan-8'
  );
  assert.equal(normalizedView.viewport.zoom, 2.5);

  const payload = createBackupPayload(DEMO_LESSON_PACKS, DEFAULT_PRINT_SETTINGS, {
    canvasBoards: DEFAULT_CANVAS_BOARDS,
    canvasNodes: DEFAULT_CANVAS_NODES,
    canvasEdges: DEFAULT_CANVAS_EDGES,
    canvasViewSettings: DEFAULT_CANVAS_VIEW_SETTINGS,
  });

  const validated = validateBackupPayload(JSON.stringify(payload));
  assert.equal(validated.valid, true);
  assert.equal(validated.payload?.canvasBoards?.length, 2);
  assert.equal(validated.payload?.canvasNodes?.length, DEFAULT_CANVAS_NODES.length);
  assert.equal(validated.payload?.canvasEdges?.length, DEFAULT_CANVAS_EDGES.length);

  // Chặn file backup có canvasNodes hoặc canvasEdges sai định dạng
  const corruptNodesPayload = {
    ...payload,
    canvasNodes: [{ id: 'bad-node-missing-board' }],
  };
  const rejectedNodes = validateBackupPayload(JSON.stringify(corruptNodesPayload));
  assert.equal(rejectedNodes.valid, false);
  assert.ok(rejectedNodes.errors.some((e) => e.includes('Node Canvas')));

  const corruptEdgesPayload = {
    ...payload,
    canvasEdges: [{ id: 'bad-edge', boardId: 'b1' }],
  };
  const rejectedEdges = validateBackupPayload(JSON.stringify(corruptEdgesPayload));
  assert.equal(rejectedEdges.valid, false);
  assert.ok(rejectedEdges.errors.some((e) => e.includes('Liên kết Canvas')));
});

test('Audit #1: Node Root không được có node cha & Checklist tự suy ra tiến độ thực tế', () => {
  const root = createCanvasNode({
    id: 'r1',
    boardId: 'b',
    type: 'root',
    mode: 'workspace',
    position: { x: 0, y: 0 },
  });
  const branch = createCanvasNode({
    id: 'br1',
    boardId: 'b',
    type: 'workspace',
    mode: 'workspace',
    position: { x: 100, y: 100 },
  });

  const parentOnRoot = validateNewEdge([root, branch], [], 'br1', 'r1', 'parent');
  assert.equal(parentOnRoot.valid, false);
  assert.ok(parentOnRoot.reason?.includes('Root'));

  // Checklist với 2/2 mục done phải tính là done ngay cả khi status mặc định lúc tạo là 'todo'
  const chkAllDone = createCanvasNode({
    id: 'chk1',
    boardId: 'b',
    type: 'checklist',
    mode: 'workflow',
    status: 'todo',
    checklist: [
      { id: '1', label: 'A', done: true },
      { id: '2', label: 'B', done: true },
    ],
    position: { x: 0, y: 0 },
  });
  const chkPartial = createCanvasNode({
    id: 'chk2',
    boardId: 'b',
    type: 'checklist',
    mode: 'workflow',
    status: 'todo',
    checklist: [
      { id: '1', label: 'A', done: true },
      { id: '2', label: 'B', done: false },
    ],
    position: { x: 0, y: 0 },
  });
  const prog = calculateWorkflowProgress([root, chkAllDone, chkPartial]);
  assert.equal(prog.totalTasks, 2);
  assert.equal(prog.doneCount, 1);
  assert.equal(prog.inProgressCount, 1);
  assert.equal(prog.progressPercent, 50);
});


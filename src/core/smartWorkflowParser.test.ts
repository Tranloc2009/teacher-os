import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTemplateSuggestionToDraft,
  buildCanvasCommitBundle,
  classifyWorkCategory,
  parseVietnameseWorkflow,
  validateDraftGraph,
} from './smartWorkflowParser';
import { normalizeCanvasNode, wouldCreateEdgeCycle } from './canvasEngine';
import { APP_REGISTRY, AppId } from './appRegistry';
import { CanvasNodeRecord } from '../types/canvas';

// Fixed Wednesday 2026-11-18 for 100% deterministic weekday & relative date assertions
const REF_WEDNESDAY = new Date(2026, 10, 18, 8, 30, 0);

test('Case A: parses Toán 12 exam prep list with 4 mã đề, safe TeacherOS apps, zero invented tasks', () => {
  const result = parseVietnameseWorkflow(
    'Chuẩn bị kiểm tra Toán 12 gồm soạn đề, trộn 4 mã đề, kiểm tra đáp án và in đề.',
    { referenceDate: REF_WEDNESDAY }
  );

  assert.equal(result.isEmpty, false);
  assert.equal(result.isLowDetail, false);
  assert.equal(result.metadata.subject, 'Toán học');
  assert.equal(result.metadata.grade, 'Lớp 12');
  assert.equal(result.metadata.dueDate, undefined); // No date mentioned -> never hallucinated
  assert.equal(result.metadata.quantities.length, 1);
  assert.equal(result.metadata.quantities[0].raw, '4 mã đề');

  const root = result.nodes.find((n) => n.type === 'root');
  assert.ok(root, 'Root node should exist');
  assert.match(root.title, /kiểm tra toán 12/i);
  assert.equal(root.category, 'prepare');

  const children = result.nodes.filter((n) => n.parentId === root.id);
  assert.equal(children.length, 4);
  assert.deepEqual(
    children.map((c) => c.title.toLowerCase()),
    ['soạn đề', 'trộn 4 mã đề', 'kiểm tra đáp án', 'in đề']
  );

  // Verify safe app linking against APP_REGISTRY ready apps
  const mixNode = children.find((c) => /trộn 4 mã đề/i.test(c.title));
  const checkNode = children.find((c) => /kiểm tra đáp án/i.test(c.title));
  const printNode = children.find((c) => /in đề/i.test(c.title));
  assert.equal(mixNode?.suggestedAppId, 'math-mixer');
  assert.equal(mixNode?.quantityLabel, '4 mã đề');
  assert.equal(checkNode?.suggestedAppId, 'math-mixer');
  assert.equal(checkNode?.category, 'review');
  assert.equal(printNode?.suggestedAppId, 'print-studio');
  assert.equal(printNode?.category, 'complete');

  // Every linked app must exist in APP_REGISTRY with status === 'ready'
  for (const node of result.nodes) {
    if (node.suggestedAppId) {
      const reg = APP_REGISTRY.find((a) => a.id === node.suggestedAppId);
      assert.ok(reg && reg.status === 'ready');
    }
  }

  // Graph is strictly acyclic and has non-overlapping positions
  const validation = validateDraftGraph(result.nodes, result.edges);
  assert.equal(validation.valid, true);
});

test('Case B: parses "Ngày mai" dueDate and explicit "sau đó" dependency chain', () => {
  const result = parseVietnameseWorkflow(
    'Ngày mai tôi cần soạn phiếu học tập, sau đó chuẩn bị rubric.',
    { referenceDate: REF_WEDNESDAY }
  );

  assert.equal(result.metadata.dueDate, '2026-11-19');
  assert.match(result.metadata.dueDateLabel ?? '', /Ngày mai/);

  const root = result.nodes.find((n) => n.type === 'root');
  assert.ok(root);
  const children = result.nodes.filter((n) => n.parentId === root.id);
  assert.equal(children.length, 2);
  assert.match(children[0].title, /soạn phiếu học tập/i);
  assert.match(children[1].title, /chuẩn bị rubric/i);
  assert.equal(children[0].suggestedAppId, 'lesson-studio');
  assert.equal(children[1].suggestedAppId, 'lesson-studio');
  assert.equal(children[0].dueDate, '2026-11-19');

  const depEdges = result.edges.filter((e) => e.edgeType === 'dependency');
  assert.equal(depEdges.length, 1);
  assert.equal(depEdges[0].source, children[0].id);
  assert.equal(depEdges[0].target, children[1].id);
  assert.equal(validateDraftGraph(result.nodes, result.edges).valid, true);
});

test('Case C: parses multi-line bulleted lesson preparation workflow cleanly', () => {
  const input = [
    'Chuẩn bị bài dạy:',
    '- Tìm học liệu',
    '- Thiết kế hoạt động',
    '- Tạo phiếu học tập',
    '- In tài liệu',
  ].join('\n');

  const result = parseVietnameseWorkflow(input, { referenceDate: REF_WEDNESDAY });
  const root = result.nodes.find((n) => n.type === 'root');
  assert.ok(root);
  assert.equal(root.title, 'Chuẩn bị bài dạy');

  const children = result.nodes.filter((n) => n.parentId === root.id);
  assert.equal(children.length, 4);
  assert.equal(children[0].suggestedAppId, 'resource-vault');
  assert.equal(children[1].suggestedAppId, 'lesson-studio');
  assert.equal(children[2].suggestedAppId, 'lesson-studio');
  assert.equal(children[3].suggestedAppId, 'print-studio');
  assert.equal(validateDraftGraph(result.nodes, result.edges).valid, true);
});

test('Case D: vague prompt sets low-detail warning and does NOT invent nonexistent subtasks', () => {
  const result = parseVietnameseWorkflow(
    'Tôi muốn tổ chức một buổi sinh hoạt chuyên môn.',
    { referenceDate: REF_WEDNESDAY }
  );

  assert.equal(result.isLowDetail, true);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].source, 'parsed');
  assert.ok(result.warnings.some((w) => w.code === 'low_detail'));
  assert.ok(result.templateSuggestions.length >= 3);
  assert.ok(
    result.templateSuggestions.every((t) => t.badgeLabel === 'Gợi ý bổ sung')
  );

  // When teacher explicitly appends a suggestion template, nodes are tagged source === 'template'
  const withTemplate = appendTemplateSuggestionToDraft(
    result,
    'tpl-department-meeting'
  );
  const templateNodes = withTemplate.nodes.filter((n) => n.source === 'template');
  assert.ok(templateNodes.length >= 3);
  assert.equal(validateDraftGraph(withTemplate.nodes, withTemplate.edges).valid, true);
});

test('handles gibberish / unclear text safely as single unclassified node requiring confirmation', () => {
  const result = parseVietnameseWorkflow('xzqwkj 999 !!!', {
    referenceDate: REF_WEDNESDAY,
  });

  assert.equal(result.isLowDetail, true);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].category, 'unclassified');
  assert.ok(result.warnings.some((w) => w.code === 'unclear_input'));
});

test('resolves Vietnamese weekday "thứ Sáu" and explicit dd/mm/yyyy accurately', () => {
  // Ref is Wednesday 2026-11-18 -> upcoming Friday is 2026-11-20
  const friResult = parseVietnameseWorkflow(
    'Chuẩn bị kiểm tra Toán 12 thứ Sáu gồm soạn đề và in đề',
    { referenceDate: REF_WEDNESDAY }
  );
  assert.equal(friResult.metadata.dueDate, '2026-11-20');

  const explicitResult = parseVietnameseWorkflow(
    'Soạn giáo án Toán 10 trước 25/11/2026, sau đó in tài liệu',
    { referenceDate: REF_WEDNESDAY }
  );
  assert.equal(explicitResult.metadata.dueDate, '2026-11-25');
});

test('supports indented sub-bullets as checklist items and "trước khi" dependency', () => {
  const bulletChecklist = [
    'Kiểm tra đề Toán 11:',
    '- Rà soát đáp án',
    '  * Kiểm tra dấu âm và phân số',
    '  * Đối chiếu đáp án gốc',
    '- In đề',
  ].join('\n');

  const res1 = parseVietnameseWorkflow(bulletChecklist, {
    referenceDate: REF_WEDNESDAY,
  });
  const chkNode = res1.nodes.find((n) => n.type === 'checklist');
  assert.ok(chkNode);
  assert.equal(chkNode.checklist?.length, 2);

  const res2 = parseVietnameseWorkflow(
    'Kiểm tra đáp án trước khi in đề',
    { referenceDate: REF_WEDNESDAY }
  );
  const dep = res2.edges.filter((e) => e.edgeType === 'dependency');
  assert.equal(dep.length, 1);
  assert.equal(classifyWorkCategory('Ghi nhật ký giảng dạy'), 'execute');
});

test('detects duplicate titles against existing board nodes and rejects cycles in validation', () => {
  const existingBoardNodes: CanvasNodeRecord[] = [
    {
      id: 'existing-1',
      boardId: 'board-wf-1',
      type: 'task',
      title: 'Soạn đề',
      position: { x: 0, y: 0 },
      createdAt: '',
      updatedAt: '',
    },
  ];

  const result = parseVietnameseWorkflow(
    'Chuẩn bị kiểm tra Toán 12 gồm soạn đề, in đề',
    { referenceDate: REF_WEDNESDAY, existingBoardNodes }
  );

  assert.equal(result.duplicateMatches.length, 1);
  assert.equal(result.duplicateMatches[0].existingNodeId, 'existing-1');
  assert.ok(result.warnings.some((w) => w.code === 'duplicate_detected'));

  // Cycle check guard
  const cyclic = validateDraftGraph(result.nodes, [
    ...result.edges,
    {
      id: 'bad-cycle-1',
      source: result.nodes[1].id,
      target: result.nodes[2].id,
      edgeType: 'dependency',
      sourceKind: 'manual',
    },
    {
      id: 'bad-cycle-2',
      source: result.nodes[2].id,
      target: result.nodes[1].id,
      edgeType: 'dependency',
      sourceKind: 'manual',
    },
  ]);
  assert.equal(cyclic.valid, false);
  assert.ok(cyclic.errors.length >= 1);
});

test('buildCanvasCommitBundle commits non-overlapping nodes/edges, preserves suggestedAppId, and handles duplicates cleanly', () => {
  const existingBoardNodes: CanvasNodeRecord[] = [
    {
      id: 'exist-1',
      boardId: 'board-wf-1',
      type: 'task',
      title: 'Soạn đề',
      position: { x: 100, y: 300 },
      createdAt: '',
      updatedAt: '',
    },
  ];

  const draft = parseVietnameseWorkflow(
    'Chuẩn bị kiểm tra Toán 12 thứ Sáu gồm soạn đề, trộn 4 mã đề, kiểm tra đáp án và in đề.',
    { referenceDate: REF_WEDNESDAY, existingBoardNodes }
  );

  let idCounter = 1;
  const idFactory = (prefix = 'id') => `${prefix}-t${idCounter++}`;

  // With skipDuplicates: true -> skips "Soạn đề", keeps Root + 3 unique steps, places safely below y = 300 + 152
  const skippedBundle = buildCanvasCommitBundle({
    draft,
    boardId: 'board-wf-1',
    existingBoardNodes,
    skipDuplicates: true,
    idFactory,
  });

  assert.equal(skippedBundle.validationErrors.length, 0);
  assert.deepEqual(skippedBundle.skippedTitles, ['Soạn đề']);
  assert.equal(skippedBundle.nodes.length, 4);
  assert.ok(
    skippedBundle.nodes.every((n) => n.position.y >= 300 + 152),
    'Committed bundle must sit strictly below existing board nodes without overlap'
  );
  const mixCommitted = skippedBundle.nodes.find((n) => /trộn 4 mã đề/i.test(n.title));
  assert.equal(mixCommitted?.suggestedAppId, 'math-mixer');
  assert.equal(mixCommitted?.status, 'todo');

  // Verify normalizeCanvasNode keeps ready suggestedAppId and strips unknown IDs
  const normalizedValid = normalizeCanvasNode(mixCommitted!);
  assert.equal(normalizedValid.suggestedAppId, 'math-mixer');
  const normalizedInvalid = normalizeCanvasNode({
    ...mixCommitted!,
    suggestedAppId: 'unknown-app' as AppId,
  });
  assert.equal(normalizedInvalid.suggestedAppId, undefined);

  // Verify no edge cycle in committed bundle
  const edgeAcc: typeof skippedBundle.edges = [];
  for (const edge of skippedBundle.edges) {
    assert.equal(
      wouldCreateEdgeCycle(edgeAcc, edge.source, edge.target, edge.edgeType),
      false
    );
    edgeAcc.push(edge);
  }

  // With skipDuplicates: false -> keeps all 5 nodes
  const fullBundle = buildCanvasCommitBundle({
    draft,
    boardId: 'board-wf-1',
    existingBoardNodes,
    skipDuplicates: false,
    idFactory,
  });
  assert.equal(fullBundle.nodes.length, 5);
  assert.equal(fullBundle.skippedTitles.length, 0);
});

test('Performance: parses and builds commit bundle for 100 Vietnamese workflow nodes cleanly within budget', () => {
  const lines = ['Kế hoạch ôn thi Toán 12 toàn khối:'];
  for (let i = 1; i <= 100; i++) {
    lines.push(`${i}. Chuẩn bị chuyên đề số ${i} và kiểm tra phiếu học tập ${i}`);
  }
  const bigPrompt = lines.join('\n');

  const t0 = performance.now();
  const parsed = parseVietnameseWorkflow(bigPrompt, {
    referenceDate: REF_WEDNESDAY,
  });
  let seq = 1;
  const bundle = buildCanvasCommitBundle({
    draft: parsed,
    boardId: 'board-wf-perf',
    existingBoardNodes: [],
    skipDuplicates: true,
    idFactory: (p = 'id') => `${p}-p${seq++}`,
  });
  const elapsedMs = performance.now() - t0;

  assert.equal(parsed.nodes.length, 101);
  assert.equal(bundle.nodes.length, 101);
  assert.equal(bundle.edges.length, 199); // 100 parent edges + 99 numbered sequential dependencies
  assert.equal(bundle.validationErrors.length, 0);
  assert.ok(
    elapsedMs < 250,
    `Expected 100-node parse + commit build < 250ms, took ${elapsedMs.toFixed(1)}ms`
  );
});


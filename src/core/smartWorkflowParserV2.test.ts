import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_REGISTRY } from './appRegistry';
import {
  normalizeVietnamese,
  parseVietnameseWorkflowV2,
} from './smartWorkflowParserV2';
import {
  applyMergeSuggestions,
  optimizeWorkflowPlan,
  recommendNextActions,
} from './workflowOptimizer';

const REF_WEDNESDAY = new Date(2026, 10, 18, 9, 0, 0);

test('Test 1 (Acceptance): Toán 12 exam prep splits >= 4 tasks, extracts 4 mã đề, respects ambiguous weekday restraint, infers order & next action', () => {
  const input =
    'Tôi cần chuẩn bị kiểm tra Toán 12 vào thứ Sáu. Phải soạn đề, kiểm tra đáp án, trộn 4 mã đề rồi in đề.';

  const plan = parseVietnameseWorkflowV2(input, { referenceDate: REF_WEDNESDAY });
  const optimized = optimizeWorkflowPlan(plan);

  assert.equal(plan.isEmpty, false);
  assert.equal(plan.isLowDetail, false);
  assert.equal(plan.subject.value, 'Toán');
  assert.equal(plan.subject.canonical, 'Toán học');
  assert.equal(plan.grade.value, 12);
  assert.match(plan.goal.value, /kiểm tra toán 12/i);

  // Must split into 4 distinct tasks (NOT 1 whole-sentence node!)
  assert.equal(plan.tasks.length, 4);
  assert.deepEqual(
    plan.tasks.map((t) => t.title.toLowerCase()),
    ['soạn đề', 'kiểm tra đáp án', 'trộn 4 mã đề', 'in đề']
  );

  // Quantity extraction ("4 mã đề")
  assert.ok(plan.quantities.some((q) => q.value === 4 && q.unit === 'mã đề'));
  const mixTask = plan.tasks.find((t) => /trộn 4 mã đề/i.test(t.title));
  assert.ok(mixTask);
  assert.ok(mixTask.quantities.some((q) => q.raw === '4 mã đề'));
  assert.equal(mixTask.linkedAppId, 'math-mixer');

  // Strict ambiguous date restraint: "thứ Sáu" without week context -> do NOT guess isoDate
  assert.equal(plan.deadline.isoDate, null);
  assert.equal(plan.deadline.text?.toLowerCase(), 'thứ sáu');
  assert.equal(plan.deadline.needsConfirmation, true);
  assert.ok(plan.unknowns.some((u) => /thứ sáu/i.test(u)));

  // Dependency order & Kahn topological sort
  assert.equal(optimized.hasCycle, false);
  assert.deepEqual(
    optimized.orderedTasks.map((t) => t.title.toLowerCase()),
    ['soạn đề', 'kiểm tra đáp án', 'trộn 4 mã đề', 'in đề']
  );

  // Initial next recommended action is "Soạn đề"
  assert.equal(optimized.nextRecommendedActions.length, 1);
  assert.equal(optimized.nextRecommendedActions[0].title.toLowerCase(), 'soạn đề');

  // Advancing state: completing "Soạn đề" unlocks "Kiểm tra đáp án"
  const step2Next = recommendNextActions(
    optimized.orderedTasks,
    optimized.dependencies,
    [optimized.orderedTasks[0].id]
  );
  assert.equal(step2Next.length, 1);
  assert.equal(step2Next[0].title.toLowerCase(), 'kiểm tra đáp án');
});

test('Test 2 (Acceptance): Văn 12 lesson prep splits 4 exact tasks, links ready TeacherOS apps, detects parallel layer', () => {
  const input =
    'Chuẩn bị tiết Văn 12: tìm ngữ liệu, thiết kế hoạt động, tạo phiếu học tập và in tài liệu.';

  const plan = parseVietnameseWorkflowV2(input, { referenceDate: REF_WEDNESDAY });
  const optimized = optimizeWorkflowPlan(plan);

  assert.equal(plan.subject.value, 'Văn');
  assert.equal(plan.subject.canonical, 'Ngữ văn');
  assert.equal(plan.grade.value, 12);
  assert.equal(plan.tasks.length, 4);
  assert.deepEqual(
    plan.tasks.map((t) => t.title.toLowerCase()),
    ['tìm ngữ liệu', 'thiết kế hoạt động', 'tạo phiếu học tập', 'in tài liệu']
  );

  // Safe linking against APP_REGISTRY ready apps
  const byTitle = new Map(plan.tasks.map((t) => [t.title.toLowerCase(), t]));
  assert.equal(byTitle.get('tìm ngữ liệu')?.linkedAppId, 'resource-vault');
  assert.equal(byTitle.get('thiết kế hoạt động')?.linkedAppId, 'lesson-studio');
  assert.equal(byTitle.get('tạo phiếu học tập')?.linkedAppId, 'lesson-studio');
  assert.equal(byTitle.get('in tài liệu')?.linkedAppId, 'print-studio');

  for (const task of plan.tasks) {
    if (task.linkedAppId) {
      const reg = APP_REGISTRY.find((a) => a.id === task.linkedAppId);
      assert.ok(reg && reg.status === 'ready');
    }
  }

  // Optimizer parallel execution layer: after "Tìm ngữ liệu", "Thiết kế hoạt động" & "Tạo phiếu học tập" can run in parallel
  assert.equal(optimized.hasCycle, false);
  const parallelLayer = optimized.parallelGroups.find((l) => l.canRunInParallel);
  assert.ok(parallelLayer, 'Expected a parallel layer for lesson design and worksheet creation');
  assert.deepEqual(
    parallelLayer.taskTitles.map((t) => t.toLowerCase()),
    ['thiết kế hoạt động', 'tạo phiếu học tập']
  );
});

test('Test 3 (Acceptance): detects semantic equivalence merge suggestion losslessly and filters negation constraint', () => {
  const input =
    'Tôi cần soạn đề, chuẩn bị đề kiểm tra, rồi in đề. Không cần trộn mã đề.';

  const plan = parseVietnameseWorkflowV2(input, { referenceDate: REF_WEDNESDAY });

  // Negation constraint must be extracted and MUST NOT appear as an active task
  assert.equal(plan.negations.length, 1);
  assert.match(plan.negations[0].actionPhrase, /trộn mã đề/i);
  assert.equal(
    plan.tasks.some((t) => /trộn/i.test(t.title)),
    false,
    'Negated action must not be added to tasks'
  );

  // Parsed non-negated tasks before merge
  assert.equal(plan.tasks.length, 3);

  // Optimizer detects semantic equivalence ("Soạn đề" <-> "Chuẩn bị đề kiểm tra")
  const previewOptimized = optimizeWorkflowPlan(plan);
  assert.equal(previewOptimized.mergeSuggestions.length, 1);
  assert.ok(previewOptimized.mergeSuggestions[0].similarityScore >= 0.85);
  assert.deepEqual(
    previewOptimized.mergeSuggestions[0].sourceTitles.map((s) => s.toLowerCase()),
    ['soạn đề', 'chuẩn bị đề kiểm tra']
  );

  // Applying merge is pure (non-mutating), lossless, and preserves dependency to "In đề"
  const inputSnapshot = JSON.stringify(plan);
  const mergedResult = applyMergeSuggestions(
    plan.tasks,
    previewOptimized.dependencies,
    previewOptimized.mergeSuggestions
  );
  assert.equal(JSON.stringify(plan), inputSnapshot, 'Original plan must remain untouched');
  assert.equal(mergedResult.tasks.length, 2);
  assert.ok(mergedResult.tasks[0].mergedFromTitles?.length === 2);
  assert.ok(
    mergedResult.tasks[0].subSteps.some((s) => /soạn đề/i.test(s)),
    'Lossless merge keeps distinguishing source detail in subSteps'
  );
  assert.equal(mergedResult.dependencies.length, 1);
  assert.equal(mergedResult.dependencies[0].fromTaskId, mergedResult.tasks[0].id);
  assert.equal(mergedResult.dependencies[0].toTaskId, mergedResult.tasks[1].id);
});

test('Test 4 (Acceptance): vague low-detail prompt surfaces unknowns + low confidence + optional templates without inventing tasks', () => {
  const input = 'Tổ chức hoạt động ngoại khóa.';

  const plan = parseVietnameseWorkflowV2(input, { referenceDate: REF_WEDNESDAY });
  const optimized = optimizeWorkflowPlan(plan);

  assert.equal(plan.isLowDetail, true);
  assert.equal(plan.needsConfirmation, true);
  assert.equal(plan.tasks.length, 0, 'Must NOT invent unstated subtasks');
  assert.ok(plan.unknowns.length >= 2);
  assert.ok(plan.overallConfidence < 0.5);
  assert.ok(plan.templateSuggestions.length >= 3);
  assert.ok(
    plan.templateSuggestions.every(
      (s) => s.isOptionalSuggestion === true && s.badgeLabel === 'Gợi ý bổ sung'
    )
  );

  // Tree blueprint keeps only the 1 RootNode until user accepts an optional template
  assert.equal(optimized.treeBlueprint.nodes.length, 1);
  assert.equal(optimized.treeBlueprint.nodes[0].kind, 'root');
  assert.equal(optimized.treeBlueprint.edges.length, 0);
});

test('Supports Vietnamese without diacritics (không dấu) identically across parser and optimizer', () => {
  const noAccentInput =
    'Toi can chuan bi kiem tra Toan 12 vao thu Sau. Phai soan de, kiem tra dap an, tron 4 ma de roi in de.';

  const plan = parseVietnameseWorkflowV2(noAccentInput, { referenceDate: REF_WEDNESDAY });
  const optimized = optimizeWorkflowPlan(plan);

  assert.equal(plan.subject.value, 'Toán');
  assert.equal(plan.grade.value, 12);
  assert.equal(plan.tasks.length, 4);
  assert.ok(plan.quantities.some((q) => q.value === 4 && q.normalizedUnit === 'ma de'));
  assert.equal(plan.deadline.isoDate, null);
  assert.equal(plan.deadline.needsConfirmation, true);
  assert.equal(optimized.hasCycle, false);
  assert.equal(
    plan.tasks.find((t) => normalizeVietnamese(t.title).includes('tron 4 ma de'))?.linkedAppId,
    'math-mixer'
  );
  assert.equal(
    plan.tasks.find((t) => normalizeVietnamese(t.title).includes('in de'))?.linkedAppId,
    'print-studio'
  );
});

test('Resolves unambiguous relative/explicit dates while refusing ambiguous bare weekdays', () => {
  const explicitPlan = parseVietnameseWorkflowV2(
    'Soạn giáo án Toán 10 trước 25/11/2026, sau đó in tài liệu.',
    { referenceDate: REF_WEDNESDAY }
  );
  assert.equal(explicitPlan.deadline.isoDate, '2026-11-25');
  assert.equal(explicitPlan.deadline.needsConfirmation, false);

  const tomorrowPlan = parseVietnameseWorkflowV2(
    'Ngày mai soạn phiếu học tập rồi kiểm tra lại.',
    { referenceDate: REF_WEDNESDAY }
  );
  assert.equal(tomorrowPlan.deadline.isoDate, '2026-11-19');
  assert.equal(tomorrowPlan.deadline.needsConfirmation, false);

  const scopedWeekdayPlan = parseVietnameseWorkflowV2(
    'Chuẩn bị đề Lý 11 cho thứ Sáu tuần này: soạn đề và in đề.',
    { referenceDate: REF_WEDNESDAY }
  );
  assert.equal(scopedWeekdayPlan.subject.value, 'Vật lí');
  assert.equal(scopedWeekdayPlan.grade.value, 11);
  assert.equal(scopedWeekdayPlan.deadline.isoDate, '2026-11-20');
  assert.equal(scopedWeekdayPlan.deadline.needsConfirmation, false);
});

test('Tree blueprint produces unique node/edge IDs, groups branches cleanly, and modules stay decoupled from Canvas/ReactFlow', () => {
  const input = [
    'Chuẩn bị tiết Sinh 10:',
    '- Tìm học liệu minh họa',
    '- Kiểm tra câu hỏi trắc nghiệm',
    '  * Rà soát thuật ngữ sinh học',
    '  * Kiểm tra đáp án mẫu',
    '- In phiếu học tập',
  ].join('\n');

  const plan = parseVietnameseWorkflowV2(input, { referenceDate: REF_WEDNESDAY });
  const optimized = optimizeWorkflowPlan(plan);

  assert.equal(plan.subject.value, 'Sinh học');
  assert.equal(plan.grade.value, 10);
  assert.equal(plan.tasks.length, 3);
  assert.equal(plan.tasks[1].subSteps.length, 2);

  // Unique IDs in tree blueprint
  const nodeIds = optimized.treeBlueprint.nodes.map((n) => n.id);
  const edgeIds = optimized.treeBlueprint.edges.map((e) => e.id);
  assert.equal(new Set(nodeIds).size, nodeIds.length);
  assert.equal(new Set(edgeIds).size, edgeIds.length);
  assert.ok(optimized.treeBlueprint.nodes.some((n) => n.kind === 'branch'));

  // Architectural check: V2 parser & optimizer have zero imports from Canvas or React Flow
  const parserSrc = fs.readFileSync(
    path.resolve('src/core/smartWorkflowParserV2.ts'),
    'utf8'
  );
  const optimizerSrc = fs.readFileSync(
    path.resolve('src/core/workflowOptimizer.ts'),
    'utf8'
  );
  for (const src of [parserSrc, optimizerSrc]) {
    assert.equal(src.includes('@xyflow/react'), false);
    assert.equal(src.includes('canvasLayout'), false);
    assert.equal(src.includes('canvasEngine'), false);
  }
});

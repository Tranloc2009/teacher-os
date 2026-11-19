import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEasyWorkflowStep,
  analyzeWorkflowGraphComplexity,
  buildUnifiedWorkflowCatalog,
  canMarkStepDone,
  computeWorkflowStudioProgressFromCanvas,
  createQuickWorkflowBundle,
  createStepDependencyEdge,
  createWorkflowFromSmartDraftBundle,
  createWorkflowFromTemplateBundle,
  duplicateEasyWorkflowStep,
  duplicateWorkflowBundle,
  filterUnifiedWorkflows,
  hydrateLegacyWorkflowToBoard,
  reorderEasyWorkflowStep,
  toggleEasyWorkflowStepDone,
} from './workflowStudioEngine';
import { WORKFLOW_STUDIO_TEMPLATES } from '../data/workflowTemplates';
import {
  DEFAULT_CANVAS_BOARDS,
  DEFAULT_CANVAS_EDGES,
  DEFAULT_CANVAS_NODES,
} from '../data/demoCanvas';
import { DEFAULT_WORKFLOWS } from './workspaceModules';
import { parseVietnameseWorkflow } from './smartWorkflowParser';
import type { CanvasNodeRecord } from '../types/canvas';

let seq = 1;
const testIdFactory = (prefix: string) => `${prefix}-t${seq++}`;

describe('Workflow Studio 2.0 Engine', () => {
  it('provides 5 structured real teacher templates and creates new workflows without overwriting', () => {
    assert.equal(WORKFLOW_STUDIO_TEMPLATES.length, 5);
    const createdIds = new Set<string>();
    for (const tpl of WORKFLOW_STUDIO_TEMPLATES) {
      assert.ok(tpl.steps.length >= 4, `Template ${tpl.id} should have >=4 steps`);
      const bundle = createWorkflowFromTemplateBundle({
        templateId: tpl.id,
        idFactory: testIdFactory,
      });
      assert.equal(bundle.board.mode, 'workflow');
      assert.equal(bundle.board.templateId, tpl.id);
      assert.ok(!createdIds.has(bundle.board.id));
      createdIds.add(bundle.board.id);

      const progress = computeWorkflowStudioProgressFromCanvas(
        bundle.nodes,
        bundle.edges
      );
      assert.equal(progress.totalSteps, tpl.steps.length);
      assert.equal(progress.doneSteps, 0);
      assert.equal(progress.percent, 0);
      assert.equal(bundle.workflowRun.steps.length, tpl.steps.length);
    }
  });

  it('unifies paired default CanvasBoard and legacy WorkflowRun without creating duplicate entries', () => {
    const catalog = buildUnifiedWorkflowCatalog({
      workflows: DEFAULT_WORKFLOWS,
      canvasBoards: DEFAULT_CANVAS_BOARDS,
      canvasNodes: DEFAULT_CANVAS_NODES,
      canvasEdges: DEFAULT_CANVAS_EDGES,
    });
    // DEFAULT_CANVAS_BOARDS[1] links to wf-standard-a4 -> should merge into 1 entry
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].boardId, 'canvas-wf-tiet-a4');
    assert.equal(catalog[0].workflowRunId, 'wf-standard-a4');
    assert.equal(catalog[0].progress.totalSteps, 5);
    assert.equal(catalog[0].progress.doneSteps, 2);
    assert.equal(catalog[0].progress.percent, 40);
    assert.equal(catalog[0].progress.nearestDueDate, '2026-11-18');
  });

  it('hydrates legacy WorkflowRun losslessly while preserving step IDs, labels, done flags, and targetApp', () => {
    const legacy = DEFAULT_WORKFLOWS[0];
    const hydrated = hydrateLegacyWorkflowToBoard(legacy, testIdFactory);
    assert.equal(hydrated.board.linkedWorkflowId, legacy.id);
    assert.equal(hydrated.board.title, legacy.title);
    const stepNodes = hydrated.nodes.filter((n) => n.type !== 'root');
    assert.equal(stepNodes.length, legacy.steps.length);
    legacy.steps.forEach((step, idx) => {
      assert.equal(stepNodes[idx].id, step.id);
      assert.equal(stepNodes[idx].title, step.label);
      assert.equal(stepNodes[idx].status, step.done ? 'done' : 'todo');
      assert.equal(stepNodes[idx].suggestedAppId, step.targetApp);
    });
  });

  it('enforces dependency blocking and rejects marking a blocked step done', () => {
    const bundle = createWorkflowFromTemplateBundle({
      templateId: 'tpl-studio-lesson-prep',
      idFactory: testIdFactory,
    });
    const progress = computeWorkflowStudioProgressFromCanvas(
      bundle.nodes,
      bundle.edges
    );
    const firstStep = progress.orderedSteps[0];
    const secondStep = progress.orderedSteps[1];

    // Step 2 depends on Step 1 -> must be blocked
    assert.equal(secondStep.isDependencyBlocked, true);
    assert.equal(canMarkStepDone(secondStep.id, bundle.nodes, bundle.edges).allowed, false);

    const blockedAttempt = toggleEasyWorkflowStepDone({
      stepId: secondStep.id,
      nodes: bundle.nodes,
      edges: bundle.edges,
    });
    assert.equal(blockedAttempt.ok, false);
    assert.ok((blockedAttempt.blockedByTitles?.length ?? 0) > 0);

    // Next step recommendation should point cleanly to Step 1
    assert.equal(progress.nextRecommendation.kind, 'single');
    if (progress.nextRecommendation.kind === 'single') {
      assert.equal(progress.nextRecommendation.step.id, firstStep.id);
    }

    // Complete Step 1 -> Step 2 becomes unblocked!
    const doneFirst = toggleEasyWorkflowStepDone({
      stepId: firstStep.id,
      nodes: bundle.nodes,
      edges: bundle.edges,
    });
    assert.equal(doneFirst.ok, true);
    const updatedNodes = bundle.nodes.map((n) =>
      n.id === firstStep.id ? doneFirst.updatedNode! : n
    );
    const afterProgress = computeWorkflowStudioProgressFromCanvas(
      updatedNodes,
      bundle.edges
    );
    assert.equal(afterProgress.doneSteps, 1);
    assert.equal(afterProgress.orderedSteps[1].isDependencyBlocked, false);
    assert.equal(afterProgress.nextRecommendation.kind, 'single');
    if (afterProgress.nextRecommendation.kind === 'single') {
      assert.equal(afterProgress.nextRecommendation.step.id, secondStep.id);
    }
  });

  it('lists multiple independent ready steps honestly without guessing', () => {
    const quick = createQuickWorkflowBundle({
      title: 'Công việc tự do',
      initialSteps: ['Việc A'],
      idFactory: testIdFactory,
    });
    const added = addEasyWorkflowStep({
      boardId: quick.board.id,
      existingNodes: quick.nodes,
      existingEdges: quick.edges,
      title: 'Việc B độc lập',
      idFactory: testIdFactory,
    });
    const allNodes = [...quick.nodes, added.node];
    const allEdges = [...quick.edges, ...added.addedEdges];

    const progress = computeWorkflowStudioProgressFromCanvas(allNodes, allEdges);
    assert.equal(progress.nextRecommendation.kind, 'multiple');
    if (progress.nextRecommendation.kind === 'multiple') {
      assert.equal(progress.nextRecommendation.steps.length, 2);
    }
  });

  it('prevents DAG dependency cycles cleanly', () => {
    const bundle = createQuickWorkflowBundle({
      title: 'Test DAG',
      initialSteps: ['Bước A', 'Bước B'],
      idFactory: testIdFactory,
    });
    const steps = bundle.nodes.filter((n) => n.type !== 'root');
    // Already has A -> B dependency; adding B -> A must be rejected
    const cycleAttempt = createStepDependencyEdge({
      boardId: bundle.board.id,
      nodes: bundle.nodes,
      edges: bundle.edges,
      prerequisiteId: steps[1].id,
      stepId: steps[0].id,
      idFactory: testIdFactory,
    });
    assert.equal(cycleAttempt.valid, false);
    assert.ok(cycleAttempt.reason?.includes('vòng lặp'));
  });

  it('preserves Canvas node coordinates and edges when reordering or editing in Easy Workflow', () => {
    const bundle = createWorkflowFromTemplateBundle({
      templateId: 'tpl-studio-teaching-plan',
      idFactory: testIdFactory,
    });
    // Teaching plan has a branch (step 1 unlocks both step 2 and step 3, which merge into step 4)
    const complexity = analyzeWorkflowGraphComplexity(bundle.nodes, bundle.edges);
    assert.equal(complexity.isComplex, true);
    assert.ok(complexity.branchNodeCount >= 1);
    assert.ok(complexity.multiDependencyNodeCount >= 1);

    const originalPositions = new Map(
      bundle.nodes.map((n) => [n.id, { ...n.position }])
    );
    const originalEdgeCount = bundle.edges.length;

    const stepNodes = bundle.nodes.filter((n) => n.type !== 'root');
    const reordered = reorderEasyWorkflowStep({
      nodes: bundle.nodes,
      edges: bundle.edges,
      stepId: stepNodes[2].id,
      direction: 'up',
    });
    assert.ok(reordered.length > 0);
    // Coordinates must remain untouched!
    for (const node of reordered) {
      const orig = originalPositions.get(node.id)!;
      assert.deepEqual(node.position, orig);
    }
    assert.equal(bundle.edges.length, originalEdgeCount);
  });

  it('duplicates a step and duplicates a full workflow with fresh remapped IDs', () => {
    const bundle = createWorkflowFromTemplateBundle({
      templateId: 'tpl-studio-weekly-tasks',
      idFactory: testIdFactory,
    });
    const firstStep = bundle.nodes.find((n) => n.type === 'task')!;
    const dupStep = duplicateEasyWorkflowStep({
      sourceNode: firstStep,
      existingNodes: bundle.nodes,
      existingEdges: bundle.edges,
      idFactory: testIdFactory,
    });
    assert.notEqual(dupStep.node.id, firstStep.id);
    assert.ok(dupStep.node.title.includes('(Bản sao)'));

    const dupWf = duplicateWorkflowBundle({
      sourceBoard: bundle.board,
      sourceNodes: bundle.nodes,
      sourceEdges: bundle.edges,
      idFactory: testIdFactory,
    });
    assert.notEqual(dupWf.board.id, bundle.board.id);
    assert.equal(dupWf.nodes.length, bundle.nodes.length);
    assert.equal(dupWf.edges.length, bundle.edges.length);
    for (const e of dupWf.edges) {
      assert.equal(e.boardId, dupWf.board.id);
      assert.ok(dupWf.nodes.some((n) => n.id === e.source));
      assert.ok(dupWf.nodes.some((n) => n.id === e.target));
    }
  });

  it('creates a unified workflow from confirmed local Smart Planner draft and filters by search/status', () => {
    const parsed = parseVietnameseWorkflow(
      'Chuẩn bị kiểm tra Toán 12 gồm soạn đề, trộn 4 mã đề và in đề'
    );
    const created = createWorkflowFromSmartDraftBundle({
      draft: parsed,
      idFactory: testIdFactory,
    });
    assert.equal(created.board.mode, 'workflow');
    assert.ok(created.nodes.filter((n) => n.type !== 'root').length >= 3);

    const catalog = buildUnifiedWorkflowCatalog({
      workflows: [created.workflowRun],
      canvasBoards: [created.board],
      canvasNodes: created.nodes,
      canvasEdges: created.edges,
    });
    assert.equal(catalog.length, 1);
    assert.equal(filterUnifiedWorkflows(catalog, 'Toán 12', 'all').length, 1);
    assert.equal(filterUnifiedWorkflows(catalog, 'Toán 12', 'completed').length, 0);
    assert.equal(filterUnifiedWorkflows(catalog, 'Toán 12', 'archived').length, 0);

    // Mark all steps done -> appears in 'completed'
    const allDoneNodes: CanvasNodeRecord[] = created.nodes.map((n) =>
      n.type === 'root' ? n : { ...n, status: 'done' }
    );
    const doneCatalog = buildUnifiedWorkflowCatalog({
      workflows: [created.workflowRun],
      canvasBoards: [created.board],
      canvasNodes: allDoneNodes,
      canvasEdges: created.edges,
    });
    assert.equal(filterUnifiedWorkflows(doneCatalog, '', 'completed').length, 1);
    assert.equal(filterUnifiedWorkflows(doneCatalog, '', 'active').length, 0);
  });
});

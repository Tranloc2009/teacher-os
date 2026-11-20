import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCubicFunction,
  analyzeDynamicFunction,
  analyzeQuadraticFunction,
  analyzeRationalFunction,
  computeFunctionFingerprint,
  DYNAMIC_FUNCTION_FAMILIES,
  verifyDynamicFunctionAnalysis,
} from './dynamicFunctionAnalyzer';
import {
  buildDynamicSvgGraph,
  buildVariationTableModel,
  renderVariationTableSvg,
} from './dynamicSvgGraphEngine';
import {
  BLOCK_EXPORT_STALE_GRAPH_MSG,
  LEVEL3_GRAPH_FAMILY_IDS,
  verifyDynamicGraphBinding,
} from './level3GraphTemplates';
import {
  generateVerifiedVariant,
  VERIFIED_TEMPLATE_FAMILIES,
} from './verifiedVariantEngine';
import {
  canExportOfficialAnswerKey,
  convertDraftToMathExamProject,
  generateExamsFromBlueprint,
} from './examBuilderEngine';
import {
  DEMO_GENERATOR_BANK,
  DEMO_GENERATOR_TEMPLATES,
  PHASE2_DEMO_BANK,
  PHASE2_DEMO_TEMPLATES,
  PHASE3_DEMO_BANK,
  PHASE3_DEMO_TEMPLATES,
} from '../../data/demoExamGeneratorData';
import { generateMixedExams } from '../mathShuffleEngine';
import {
  buildStudentExamDocxBuffer,
  verifyExportedDocxBuffer,
} from '../examExportEngine';
import { buildExamAnswerKeyMap } from '../grading/examMixerBridge';
import type {
  ExamBlueprintConfig,
  GeneratedDraftItem,
  GeneratedExamDraft,
  GeneratedQuestionVariant,
  QuestionTemplateDefinition,
  VerifiedTemplateFamilyId,
} from '../../types/examGenerator';

function getPhase3Template(familyId: VerifiedTemplateFamilyId): QuestionTemplateDefinition {
  const tpl = PHASE3_DEMO_TEMPLATES.find((t) => t.familyId === familyId);
  assert.ok(tpl, `Expected Phase 3 demo template for ${familyId}`);
  return structuredClone(tpl);
}

function makeDraftFromVariants(
  id: string,
  title: string,
  seed: string,
  variants: GeneratedQuestionVariant[]
): GeneratedExamDraft {
  const now = new Date().toISOString();
  const items: GeneratedDraftItem[] = variants.map((v, idx) => ({
    id: `${id}-item-${idx + 1}`,
    orderNumber: idx + 1,
    origin: 'verified-variant',
    status: 'VARIANT_READY',
    parentQuestionId: v.parentQuestionId,
    templateId: v.templateId,
    variantId: v.id,
    variantCode: v.variantCode,
    parameterSignature: v.parameterSignature,
    parameterValues: v.parameterValues,
    graphFingerprint: v.graphFingerprint,
    functionAnalysis: v.functionAnalysis,
    variationTable: v.variationTable,
    verificationSummary: v.verification.independentCheckSummary,
    locked: false,
    teacherConfirmed: true,
    question: { ...structuredClone(v.question), answerConfirmed: true },
  }));

  return {
    id,
    draftNumber: 1,
    draftLabel: 'Đề 1',
    title,
    subjectId: 'toan',
    subjectName: 'Toán học',
    grade: 'Lớp 12',
    durationMinutes: 45,
    mode: 'verified-variants',
    seed,
    totalPoints: items.reduce((s, it) => s + it.question.points, 0),
    status: 'reviewed',
    allAnswersConfirmed: true,
    items,
    report: {
      requestedTotal: items.length,
      generatedTotal: items.length,
      originalCount: 0,
      variantCount: items.length,
      reviewRequiredCount: 0,
      unsupportedCount: 0,
      blockedCount: 0,
      shortfalls: [],
      warnings: [],
      cancelled: false,
      seedUsed: seed,
      generatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe('Phase 3 — Dynamic Math & Graph Engine (30 Mandatory Tests)', () => {
  // ─── 1–3: Quadratic Function Family ─────────────────────────────────────────

  it('Test 1: Quadratic function a > 0 (f(x) = x^2 - 4x + 3) vertex, axis, monotonicity, extremum', () => {
    const analysis = analyzeQuadraticFunction(1, -4, 3);
    assert.equal(analysis.family, 'quadratic');
    assert.equal(analysis.criticalPoints.length, 1);
    assert.equal(analysis.criticalPoints[0].x.value, 2);
    assert.equal(analysis.criticalPoints[0].y.value, -1);
    assert.equal(analysis.criticalPoints[0].kind, 'local-min');
    assert.equal(analysis.extrema.length, 1);
    assert.equal(analysis.vertex?.x.value, 2);
    assert.equal(analysis.vertex?.axisLatex, 'x = 2');
    assert.equal(analysis.yIntercept?.y.value, 3);

    const dec = analysis.monotonicityIntervals.filter((m) => m.trend === 'decreasing');
    const inc = analysis.monotonicityIntervals.filter((m) => m.trend === 'increasing');
    assert.equal(dec.length, 1);
    assert.equal(inc.length, 1);
    assert.equal(dec[0].toValue, 2);
    assert.equal(inc[0].fromValue, 2);

    const check = verifyDynamicFunctionAnalysis(
      { family: 'quadratic', a: 1, b: -4, c: 3 },
      analysis
    );
    assert.equal(check.valid, true, check.errors.join('; '));
  });

  it('Test 2: Quadratic function a < 0 (f(x) = -2x^2 + 8x - 5) downward parabola has local max', () => {
    const analysis = analyzeQuadraticFunction(-2, 8, -5);
    assert.equal(analysis.criticalPoints.length, 1);
    assert.equal(analysis.criticalPoints[0].x.value, 2);
    assert.equal(analysis.criticalPoints[0].y.value, 3);
    assert.equal(analysis.criticalPoints[0].kind, 'local-max');

    const inc = analysis.monotonicityIntervals.filter((m) => m.trend === 'increasing');
    const dec = analysis.monotonicityIntervals.filter((m) => m.trend === 'decreasing');
    assert.equal(inc[0].toValue, 2);
    assert.equal(dec[0].fromValue, 2);
    assert.equal(analysis.limitNegInf, '-∞');
    assert.equal(analysis.limitPosInf, '-∞');

    const check = verifyDynamicFunctionAnalysis(
      { family: 'quadratic', a: -2, b: 8, c: -5 },
      analysis
    );
    assert.equal(check.valid, true, check.errors.join('; '));
  });

  it('Test 3: Quadratic with non-integer rational vertex (f(x) = 2x^2 - 3x + 1 -> vertex (3/4; -1/8))', () => {
    const analysis = analyzeQuadraticFunction(2, -3, 1);
    assert.equal(analysis.criticalPoints.length, 1);
    assert.equal(analysis.criticalPoints[0].x.value, 0.75);
    assert.equal(analysis.criticalPoints[0].x.latex, '\\frac{3}{4}');
    assert.equal(analysis.criticalPoints[0].y.value, -0.125);
    assert.equal(analysis.criticalPoints[0].y.latex, '-\\frac{1}{8}');

    const check = verifyDynamicFunctionAnalysis(
      { family: 'quadratic', a: 2, b: -3, c: 1 },
      analysis
    );
    assert.equal(check.valid, true, check.errors.join('; '));
  });

  // ─── 4–6: Cubic Function Family ─────────────────────────────────────────────

  it('Test 4: Cubic with 2 distinct extrema (f(x) = x^3 - 3x + 2 -> max (-1; 4), min (1; 0))', () => {
    const analysis = analyzeCubicFunction(1, 0, -3, 2);
    assert.equal(analysis.cubicCase, 'two-extrema');
    assert.equal(analysis.extrema.length, 2);

    const localMax = analysis.extrema.find((e) => e.kind === 'local-max');
    const localMin = analysis.extrema.find((e) => e.kind === 'local-min');
    assert.ok(localMax && localMin);
    assert.equal(localMax.x.value, -1);
    assert.equal(localMax.y.value, 4);
    assert.equal(localMin.x.value, 1);
    assert.equal(localMin.y.value, 0);

    const inc = analysis.monotonicityIntervals.filter((m) => m.trend === 'increasing');
    const dec = analysis.monotonicityIntervals.filter((m) => m.trend === 'decreasing');
    assert.equal(inc.length, 2);
    assert.equal(dec.length, 1);

    const check = verifyDynamicFunctionAnalysis(
      { family: 'cubic', a: 1, b: 0, c: -3, d: 2 },
      analysis
    );
    assert.equal(check.valid, true, check.errors.join('; '));
  });

  it('Test 5: Cubic with no extrema (f(x) = x^3 + 3x + 1 -> strictly increasing on R)', () => {
    const analysis = analyzeCubicFunction(1, 0, 3, 1);
    assert.equal(analysis.cubicCase, 'no-extrema');
    assert.equal(analysis.extrema.length, 0);
    assert.equal(analysis.criticalPoints.length, 0);

    const inc = analysis.monotonicityIntervals.filter((m) => m.trend === 'increasing');
    const dec = analysis.monotonicityIntervals.filter((m) => m.trend === 'decreasing');
    assert.equal(inc.length, 1);
    assert.equal(dec.length, 0);
    assert.equal(inc[0].fromValue, null);
    assert.equal(inc[0].toValue, null);

    const check = verifyDynamicFunctionAnalysis(
      { family: 'cubic', a: 1, b: 0, c: 3, d: 1 },
      analysis
    );
    assert.equal(check.valid, true, check.errors.join('; '));
  });

  it('Test 6: Cubic with derivative double root (f(x) = x^3 - 3x^2 + 3x - 1 = (x-1)^3 -> NO fake extremum)', () => {
    const analysis = analyzeCubicFunction(1, -3, 3, -1);
    assert.equal(analysis.cubicCase, 'double-root');
    assert.equal(analysis.extrema.length, 0, "Double root of f'(x) must NOT create an extremum");
    assert.equal(analysis.criticalPoints.length, 1);
    assert.equal(analysis.criticalPoints[0].kind, 'stationary-inflection');
    assert.equal(analysis.criticalPoints[0].x.value, 1);
    assert.equal(analysis.criticalPoints[0].y.value, 0);

    const inc = analysis.monotonicityIntervals.filter((m) => m.trend === 'increasing');
    const dec = analysis.monotonicityIntervals.filter((m) => m.trend === 'decreasing');
    assert.equal(inc.length, 1);
    assert.equal(dec.length, 0);

    const check = verifyDynamicFunctionAnalysis(
      { family: 'cubic', a: 1, b: -3, c: 3, d: -1 },
      analysis
    );
    assert.equal(check.valid, true, check.errors.join('; '));
  });

  // ─── 7–11: Linear-Fractional Rational Function Family ───────────────────────

  it('Test 7: Rational function vertical asymptote (f(x) = (2x + 1)/(x - 1) -> VA x = 1)', () => {
    const analysis = analyzeRationalFunction(2, 1, 1, -1);
    assert.equal(analysis.asymptotes.vertical?.x.value, 1);
    assert.equal(analysis.asymptotes.vertical?.equationLatex, 'x = 1');
    assert.equal(analysis.excludedPoint?.value, 1);

    const check = verifyDynamicFunctionAnalysis(
      { family: 'rational', a: 2, b: 1, c: 1, d: -1 },
      analysis
    );
    assert.equal(check.valid, true, check.errors.join('; '));
  });

  it('Test 8: Rational function horizontal asymptote (f(x) = (3x - 2)/(2x + 4) -> HA y = 3/2)', () => {
    const analysis = analyzeRationalFunction(3, -2, 2, 4);
    assert.equal(analysis.asymptotes.horizontal?.y.value, 1.5);
    assert.equal(analysis.asymptotes.horizontal?.y.latex, '\\frac{3}{2}');
    assert.equal(analysis.asymptotes.vertical?.x.value, -2);

    const check = verifyDynamicFunctionAnalysis(
      { family: 'rational', a: 3, b: -2, c: 2, d: 4 },
      analysis
    );
    assert.equal(check.valid, true, check.errors.join('; '));
  });

  it('Test 9: Rational function derivative sign (ad - bc < 0 strictly decreasing; ad - bc > 0 strictly increasing)', () => {
    // f(x) = (2x + 1)/(x - 1): ad - bc = 2*(-1) - 1*1 = -3 < 0 -> strictly decreasing on each interval
    const dec = analyzeRationalFunction(2, 1, 1, -1);
    assert.equal(
      dec.monotonicityIntervals.filter((m) => m.trend === 'decreasing').length,
      2
    );
    assert.equal(
      dec.monotonicityIntervals.filter((m) => m.trend === 'increasing').length,
      0
    );
    assert.equal(dec.extrema.length, 0);

    // g(x) = (x - 3)/(x + 1): ad - bc = 1*1 - (-3)*1 = +4 > 0 -> strictly increasing on each interval
    const inc = analyzeRationalFunction(1, -3, 1, 1);
    assert.equal(
      inc.monotonicityIntervals.filter((m) => m.trend === 'increasing').length,
      2
    );
    assert.equal(
      inc.monotonicityIntervals.filter((m) => m.trend === 'decreasing').length,
      0
    );
    assert.equal(inc.extrema.length, 0);
  });

  it('Test 10: Rational function one-sided limits around vertical asymptote', () => {
    // f(x) = (2x + 1)/(x - 1): x -> 1- => -∞; x -> 1+ => +∞
    const dec = analyzeRationalFunction(2, 1, 1, -1);
    assert.equal(dec.asymptotes.vertical?.leftLimit, '-∞');
    assert.equal(dec.asymptotes.vertical?.rightLimit, '+∞');

    // g(x) = (x - 3)/(x + 1): x -> -1- => +∞; x -> -1+ => -∞
    const inc = analyzeRationalFunction(1, -3, 1, 1);
    assert.equal(inc.asymptotes.vertical?.leftLimit, '+∞');
    assert.equal(inc.asymptotes.vertical?.rightLimit, '-∞');
  });

  it('Test 11: Rational SVG graph does NOT connect across vertical asymptote (2+ separated branches)', () => {
    const analysis = analyzeRationalFunction(2, 1, 1, -1);
    const graph = buildDynamicSvgGraph(analysis);
    assert.ok(graph.branchCount >= 2, `Expected >= 2 separated branches, got ${graph.branchCount}`);
    assert.ok(graph.samplePointCount <= 320, `Point budget exceeded: ${graph.samplePointCount}`);
    assert.equal(graph.valid, true, graph.errors.join('; '));
    assert.ok(
      graph.svg.includes('stroke-dasharray'),
      'Expected dashed asymptote lines in rational graph SVG'
    );
    const curvePaths = graph.svg.match(/<path d="M/g) ?? [];
    assert.ok(
      curvePaths.length >= 2,
      `Expected >= 2 separate <path> curve branches, found ${curvePaths.length}`
    );
  });

  // ─── 12–15: SVG Validity & Variation Table Consistency ──────────────────────

  it('Test 12: SVG graphs contain zero NaN, zero Infinity, zero <script>, and valid fingerprint attribute', () => {
    const specs = [
      analyzeQuadraticFunction(1, -4, 3),
      analyzeCubicFunction(1, 0, -3, 2),
      analyzeCubicFunction(-1, 3, -3, 1),
      analyzeRationalFunction(2, 1, 1, -1),
    ];
    for (const analysis of specs) {
      const graph = buildDynamicSvgGraph(analysis);
      assert.equal(graph.valid, true, graph.errors.join('; '));
      assert.equal(/NaN|Infinity|undefined/i.test(graph.svg), false);
      assert.equal(/<script/i.test(graph.svg), false);
      assert.ok(graph.svg.includes(`data-graph-fingerprint="${analysis.fingerprint}"`));
      assert.ok(graph.samplePointCount <= 320);

      const tableModel = buildVariationTableModel(analysis);
      const tableSvg = renderVariationTableSvg(tableModel);
      assert.equal(/NaN|Infinity|undefined/i.test(tableSvg), false);
      assert.ok(tableSvg.includes(`data-graph-fingerprint="${analysis.fingerprint}"`));
    }
  });

  it('Test 13: Variation table derivative signs match derivative evaluation across all intervals', () => {
    const cubic = analyzeCubicFunction(1, 0, -3, 2); // f'(x) = 3x^2 - 3: + on (-∞,-1), - on (-1,1), + on (1,+∞)
    const table = buildVariationTableModel(cubic);
    const intervalSigns = table.columns
      .filter((c) => c.kind === 'interval')
      .map((c) => c.derivSymbol);
    assert.deepEqual(intervalSigns, ['+', '-', '+']);

    const arrows = table.columns
      .filter((c) => c.kind === 'interval')
      .map((c) => c.trend);
    assert.deepEqual(arrows, ['up', 'down', 'up']);
  });

  it('Test 14: Variation table marks local extrema accurately (CĐ at (-1;4), CT at (1;0))', () => {
    const cubic = analyzeCubicFunction(1, 0, -3, 2);
    const table = buildVariationTableModel(cubic);
    const maxCol = table.columns.find((c) => c.extremumBadge === 'CĐ');
    const minCol = table.columns.find((c) => c.extremumBadge === 'CT');
    assert.ok(maxCol && minCol);
    assert.equal(maxCol.xLabel, '-1');
    assert.equal(maxCol.valueLabel, '4');
    assert.equal(minCol.xLabel, '1');
    assert.equal(minCol.valueLabel, '0');

    const svg = renderVariationTableSvg(table);
    assert.ok(svg.includes('CĐ'));
    assert.ok(svg.includes('CT'));
  });

  it('Test 15: Variation table has NO fake extremum on double root AND shows || double bar on rational pole', () => {
    const doubleRoot = analyzeCubicFunction(1, -3, 3, -1); // (x - 1)^3
    const drTable = buildVariationTableModel(doubleRoot);
    assert.equal(
      drTable.columns.some((c) => c.extremumBadge === 'CĐ' || c.extremumBadge === 'CT'),
      false,
      'Double root must not show CĐ/CT badge'
    );
    const drSigns = drTable.columns
      .filter((c) => c.kind === 'interval')
      .map((c) => c.derivSymbol);
    assert.deepEqual(drSigns, ['+', '+']);

    const rational = analyzeRationalFunction(2, 1, 1, -1);
    const ratTable = buildVariationTableModel(rational);
    const discCol = ratTable.columns.find((c) => c.kind === 'discontinuity');
    assert.ok(discCol, 'Rational variation table must include discontinuity column');
    assert.equal(discCol.derivSymbol, '||');
    assert.equal(discCol.leftLimitLabel, '-∞');
    assert.equal(discCol.rightLimitLabel, '+∞');
  });

  // ─── 16–20: Dynamic Content Binding, Regeneration, Stale Guard & Seed ───────

  it('Test 16: Changing numeric parameters generates a new distinct SVG graph', () => {
    const tpl = getPhase3Template('cubic-extrema');
    const v1 = generateVerifiedVariant({ template: tpl, seed: 'S-GRAPH-16', variantIndex: 1 });
    assert.equal(v1.ok, true);
    const v2 = generateVerifiedVariant({
      template: tpl,
      seed: 'S-GRAPH-16',
      variantIndex: 2,
      excludeSignatures: new Set([v1.variant!.parameterSignature]),
    });
    assert.equal(v2.ok, true);
    assert.notEqual(v1.variant!.graphFingerprint, v2.variant!.graphFingerprint);
    assert.notEqual(v1.variant!.graphSvg, v2.variant!.graphSvg);
  });

  it('Test 17: Changing numeric parameters generates a new synchronized variation table', () => {
    const tpl = getPhase3Template('cubic-monotonicity');
    const v1 = generateVerifiedVariant({ template: tpl, seed: 'S-BBT-17', variantIndex: 1 });
    const v2 = generateVerifiedVariant({
      template: tpl,
      seed: 'S-BBT-17',
      variantIndex: 2,
      excludeSignatures: new Set([v1.variant!.parameterSignature]),
    });
    assert.equal(v1.ok, true);
    assert.equal(v2.ok, true);
    assert.notEqual(v1.variant!.variationTableSvg, v2.variant!.variationTableSvg);
    assert.ok(
      v2.variant!.variationTableSvg!.includes(
        `data-graph-fingerprint="${v2.variant!.graphFingerprint}"`
      )
    );
  });

  it('Test 18: Changing numeric parameters recalculates answer and maintains 4 distinct options with 1 valid answer', () => {
    const tpl = getPhase3Template('rational-asymptotes');
    const v1 = generateVerifiedVariant({ template: tpl, seed: 'S-ANS-18', variantIndex: 1 });
    const v2 = generateVerifiedVariant({
      template: tpl,
      seed: 'S-ANS-18',
      variantIndex: 2,
      excludeSignatures: new Set([v1.variant!.parameterSignature]),
    });
    assert.equal(v1.ok, true);
    assert.equal(v2.ok, true);
    assert.equal(v1.variant!.verification.validOptionCount, 1);
    assert.equal(v2.variant!.verification.validOptionCount, 1);
    assert.equal(v1.variant!.verification.uniqueOptionCount, 4);
    assert.equal(v2.variant!.verification.uniqueOptionCount, 4);
    assert.equal(v1.variant!.verification.checklist?.graphConsistent, true);
    assert.equal(v2.variant!.verification.checklist?.variationTableConsistent, true);
  });

  it('Test 19: Stale graph fingerprint mismatch triggers BLOCK EXPORT — STALE GRAPH DATA', () => {
    const tpl = getPhase3Template('quadratic-graph');
    const res = generateVerifiedVariant({ template: tpl, seed: 'S-STALE-19', variantIndex: 1 });
    assert.equal(res.ok, true);
    const v = res.variant!;

    // Authentic binding passes
    const validCheck = verifyDynamicGraphBinding({
      question: v.question,
      functionAnalysis: v.functionAnalysis,
      variationTable: v.variationTable,
      graphFingerprint: v.graphFingerprint,
    });
    assert.equal(validCheck.valid, true, validCheck.reason);

    // Tampered / stale SVG fingerprint on embedded visual asset is blocked
    const tamperedQuestion = structuredClone(v.question);
    assert.ok(tamperedQuestion.visualAssets && tamperedQuestion.visualAssets.length > 0);
    tamperedQuestion.visualAssets[0].sourceData = tamperedQuestion.visualAssets[0].sourceData.replace(
      v.graphFingerprint!,
      'STALE-FP-9999'
    );
    const staleCheck = verifyDynamicGraphBinding({
      question: tamperedQuestion,
      functionAnalysis: v.functionAnalysis,
      variationTable: v.variationTable,
      graphFingerprint: v.graphFingerprint,
    });
    assert.equal(staleCheck.valid, false);
    assert.ok(staleCheck.reason?.includes(BLOCK_EXPORT_STALE_GRAPH_MSG));

    // Draft-level export gate also blocks stale graph data
    const draft = makeDraftFromVariants('draft-stale-19', 'Test Stale Gate', 'S-STALE-19', [v]);
    draft.items[0].graphFingerprint = 'MISMATCHED-FP';
    const gate = canExportOfficialAnswerKey(draft);
    assert.equal(gate.allowed, false);
    assert.ok(gate.reason?.includes(BLOCK_EXPORT_STALE_GRAPH_MSG));
  });

  it('Test 20: Deterministic seed reproducibility across repeated runs', () => {
    const tpl = getPhase3Template('graph-variation-table');
    const run1 = generateVerifiedVariant({ template: tpl, seed: 'DET-SEED-20', variantIndex: 3 });
    const run2 = generateVerifiedVariant({ template: tpl, seed: 'DET-SEED-20', variantIndex: 3 });
    assert.equal(run1.ok, true);
    assert.equal(run2.ok, true);
    assert.equal(run1.variant!.graphFingerprint, run2.variant!.graphFingerprint);
    assert.equal(run1.variant!.parameterSignature, run2.variant!.parameterSignature);
    assert.equal(run1.variant!.graphSvg, run2.variant!.graphSvg);
    assert.equal(run1.variant!.variationTableSvg, run2.variant!.variationTableSvg);
    assert.equal(run1.variant!.correctFormatted, run2.variant!.correctFormatted);
  });

  // ─── 21–23: Backward Compatibility & Non-Destructive Continuity ─────────────

  it('Test 21: Original bank questions remain completely immutable during variant generation', () => {
    const originalSnap = JSON.stringify(PHASE3_DEMO_BANK);
    const bp: ExamBlueprintConfig = {
      title: 'Kiểm tra Hàm số 12',
      subjectId: 'toan',
      subjectName: 'Toán học',
      grade: 'Lớp 12',
      durationMinutes: 45,
      selectedTopics: ['Hàm số và Đồ thị'],
      selectedTypes: ['mcq'],
      selectedCognitiveLevels: ['nhan-biet', 'thong-hieu', 'van-dung'],
      mode: 'verified-variants',
      variantRatioPercent: 100,
      seed: 'IMMUTABLE-21',
      examDraftCount: 1,
      allowMultipleVariantsPerTemplate: true,
      matrixRows: [
        {
          id: 'row-1',
          topic: 'Hàm số và Đồ thị',
          type: 'mcq',
          cognitiveLevel: 'thong-hieu',
          count: 3,
          pointsPerQuestion: 1,
        },
      ],
    };
    const drafts = generateExamsFromBlueprint({
      blueprint: bp,
      bank: PHASE3_DEMO_BANK,
      templates: PHASE3_DEMO_TEMPLATES,
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].items.length, 3);
    assert.equal(JSON.stringify(PHASE3_DEMO_BANK), originalSnap);
  });

  it('Test 22: All 7 original Level 1 templates remain registered and pass verification', () => {
    const level1Families: VerifiedTemplateFamilyId[] = [
      'linear-equation',
      'arithmetic-expression',
      'algebraic-eval',
      'percentage-problem',
      'proportion-ratio',
      'arithmetic-sequence',
      'physics-motion',
    ];
    for (const fid of level1Families) {
      assert.ok(VERIFIED_TEMPLATE_FAMILIES[fid], `Missing Level 1 family ${fid}`);
      const tpl = DEMO_GENERATOR_TEMPLATES.find((t) => t.familyId === fid);
      assert.ok(tpl, `Missing Level 1 demo template for ${fid}`);
      const res = generateVerifiedVariant({ template: tpl, seed: `L1-${fid}`, variantIndex: 1 });
      assert.equal(res.ok, true, `Level 1 ${fid} failed: ${res.blockingReasons.join('; ')}`);
    }
  });

  it('Test 23: All 3 Level 2 templates remain registered and pass verification', () => {
    const level2Families: VerifiedTemplateFamilyId[] = [
      'quadratic-equation',
      'linear-system-2x2',
      'polynomial-derivative',
    ];
    for (const fid of level2Families) {
      assert.ok(VERIFIED_TEMPLATE_FAMILIES[fid], `Missing Level 2 family ${fid}`);
      const tpl = PHASE2_DEMO_TEMPLATES.find((t) => t.familyId === fid);
      assert.ok(tpl, `Missing Level 2 demo template for ${fid}`);
      const res = generateVerifiedVariant({ template: tpl, seed: `L2-${fid}`, variantIndex: 1 });
      assert.equal(res.ok, true, `Level 2 ${fid} failed: ${res.blockingReasons.join('; ')}`);
    }
  });

  // ─── 24–30: Exam Mixer Pro, Option VisualAsset Shuffle, DOCX, Grading, Persistence ───

  it('Test 24: All 6 Level 3 templates pass verification and hand off cleanly to Exam Mixer Pro', () => {
    assert.equal(LEVEL3_GRAPH_FAMILY_IDS.size, 6);
    assert.equal(Object.keys(DYNAMIC_FUNCTION_FAMILIES).length, 3);

    const variants: GeneratedQuestionVariant[] = Array.from(LEVEL3_GRAPH_FAMILY_IDS).map(
      (fid, idx) => {
        const tpl = getPhase3Template(fid);
        const outcome = generateVerifiedVariant({
          template: tpl,
          seed: `P3-MIX-${idx + 1}`,
          variantIndex: 1,
        });
        assert.equal(
          outcome.ok,
          true,
          `Level 3 ${fid} failed: ${outcome.blockingReasons.join('; ')}`
        );
        return outcome.variant!;
      }
    );

    const draft = makeDraftFromVariants('draft-p3-mix-24', 'Đề Đồ thị Hàm số 12', 'P3-MIX-24', variants);
    const gate = canExportOfficialAnswerKey(draft);
    assert.equal(gate.allowed, true, gate.reason);

    const project = convertDraftToMathExamProject(draft);
    assert.equal(project.questions.length, 6);
    const mixed = generateMixedExams(project);
    assert.equal(mixed.errors.length, 0, mixed.errors.join('; '));
    assert.equal(mixed.versions.length, project.mixConfig.examCount);
  });

  it('Test 25: Shuffling questions in Exam Mixer Pro keeps SVG graph/variation table attached to each question', () => {
    const v1 = generateVerifiedVariant({
      template: getPhase3Template('quadratic-graph'),
      seed: 'SHUF-Q-1',
      variantIndex: 1,
    }).variant!;
    const v2 = generateVerifiedVariant({
      template: getPhase3Template('rational-asymptotes'),
      seed: 'SHUF-Q-2',
      variantIndex: 1,
    }).variant!;
    const v3 = generateVerifiedVariant({
      template: getPhase3Template('cubic-extrema'),
      seed: 'SHUF-Q-3',
      variantIndex: 1,
    }).variant!;

    const draft = makeDraftFromVariants('draft-shuf-25', 'Shuffle Graph Test', 'SHUF-25', [
      v1,
      v2,
      v3,
    ]);
    const project = convertDraftToMathExamProject(draft);
    const mixed = generateMixedExams(project);
    assert.equal(mixed.errors.length, 0);

    for (const version of mixed.versions) {
      for (const mq of version.questions) {
        const orig = project.questions.find((o) => o.id === mq.id);
        assert.ok(orig);
        assert.equal(mq.variantMeta?.graphFingerprint, orig.variantMeta?.graphFingerprint);
        assert.equal(mq.visualAssets?.length ?? 0, orig.visualAssets?.length ?? 0);
        if (orig.visualAssets?.[0]) {
          assert.equal(mq.visualAssets?.[0]?.sourceData, orig.visualAssets[0].sourceData);
        }
      }
    }
  });

  it('Test 26: Shuffling options on choose-graph (4 SVG options) moves visualAsset with option & updates Answer Mapping', () => {
    const tpl = getPhase3Template('graph-variation-table');
    tpl.familyConfig = { ...tpl.familyConfig, graphQuestionMode: 'choose-graph' };
    const outcome = generateVerifiedVariant({
      template: tpl,
      seed: 'CHOOSE-GRAPH-26',
      variantIndex: 1,
    });
    assert.equal(outcome.ok, true);
    const v = outcome.variant!;
    assert.equal(v.question.options?.length, 4);
    for (const opt of v.question.options!) {
      assert.ok(opt.visualAsset?.sourceData, `Option ${opt.originalLabel} missing SVG visualAsset`);
    }
    const correctOrigOpt = v.question.options!.find((o) => o.isCorrect)!;
    const correctSvg = correctOrigOpt.visualAsset!.sourceData;

    const draft = makeDraftFromVariants('draft-cg-26', 'Choose Graph Shuffle', 'CHOOSE-GRAPH-26', [v]);
    const project = convertDraftToMathExamProject(draft);
    const mixed = generateMixedExams(project);
    assert.equal(mixed.errors.length, 0);

    for (const version of mixed.versions) {
      const mq = version.questions[0];
      const mapped = version.permutationMap[0];
      const newCorrectIdx = mq.options!.findIndex((o) => o.id === mq.correctOptionId);
      assert.ok(newCorrectIdx >= 0, 'Expected shuffled correct option index >= 0');
      const expectedLetter = (['A', 'B', 'C', 'D'] as const)[newCorrectIdx];
      assert.ok(
        mapped.exactAnswerSummary.includes(expectedLetter),
        `Expected answer mapping "${mapped.exactAnswerSummary}" to reference "${expectedLetter}"`
      );
      const shuffledCorrectOpt = mq.options![newCorrectIdx];
      assert.equal(shuffledCorrectOpt.id, correctOrigOpt.id);
      assert.equal(shuffledCorrectOpt.visualAsset?.sourceData, correctSvg);
    }
  });

  it('Test 27: DOCX export embeds both question-level graphs and choose-graph option SVGs & passes verification', async () => {
    const q1 = generateVerifiedVariant({
      template: getPhase3Template('quadratic-graph'),
      seed: 'DOCX-27-A',
      variantIndex: 1,
    }).variant!;
    const tplChoose = getPhase3Template('graph-variation-table');
    tplChoose.familyConfig = { ...tplChoose.familyConfig, graphQuestionMode: 'choose-graph' };
    const q2 = generateVerifiedVariant({
      template: tplChoose,
      seed: 'DOCX-27-B',
      variantIndex: 1,
    }).variant!;

    const draft = makeDraftFromVariants('draft-docx-27', 'Đề Xuất DOCX Đồ Thị', 'DOCX-27', [
      q1,
      q2,
    ]);
    const project = convertDraftToMathExamProject(draft);
    const mixed = generateMixedExams(project);
    const projectWithVersions = { ...project, generatedVersions: mixed.versions };
    const version = mixed.versions[0];

    const buf = await buildStudentExamDocxBuffer(projectWithVersions, version);
    assert.ok(buf.byteLength > 2000, 'Expected non-empty DOCX buffer');

    const verify = await verifyExportedDocxBuffer(buf, version, projectWithVersions);
    assert.equal(
      verify.passed,
      true,
      `DOCX verification issues: ${verify.issues.map((i) => i.message).join('; ')}`
    );
  });

  it('Test 28: Choose-variation-table mode produces 4 distinct variation table SVGs with valid answer', () => {
    const tpl = getPhase3Template('graph-variation-table');
    tpl.familyConfig = { ...tpl.familyConfig, graphQuestionMode: 'choose-variation-table' };
    const outcome = generateVerifiedVariant({
      template: tpl,
      seed: 'BBT-OPT-28',
      variantIndex: 1,
    });
    assert.equal(outcome.ok, true);
    const opts = outcome.variant!.question.options!;
    assert.equal(opts.length, 4);
    const svgs = new Set(opts.map((o) => o.visualAsset?.sourceData));
    assert.equal(svgs.size, 4, 'All 4 variation table option SVGs must be distinct');
    assert.equal(opts.filter((o) => o.isCorrect).length, 1);
  });

  it('Test 29: Smart Grading Studio AnswerKeyMap compatibility with mixed Level 3 graph exams', () => {
    const v1 = generateVerifiedVariant({
      template: getPhase3Template('cubic-extrema'),
      seed: 'GRADE-29-1',
      variantIndex: 1,
    }).variant!;
    const v2 = generateVerifiedVariant({
      template: getPhase3Template('rational-monotonicity'),
      seed: 'GRADE-29-2',
      variantIndex: 1,
    }).variant!;

    const draft = makeDraftFromVariants('draft-grade-29', 'Đề Chấm OMR Đồ Thị', 'GRADE-29', [
      v1,
      v2,
    ]);
    const project = convertDraftToMathExamProject(draft);
    const mixed = generateMixedExams(project);
    const projectWithVersions = { ...project, generatedVersions: mixed.versions };
    const answerKeyMap = buildExamAnswerKeyMap(projectWithVersions);
    const entries = Object.values(answerKeyMap);
    assert.equal(entries.length, mixed.versions.length);
    for (const keyEntry of entries) {
      assert.equal(keyEntry.totalQuestions, 2);
      assert.equal(keyEntry.questions.length, 2);
      assert.equal(keyEntry.autoGradableCount, 2);
      for (const order of [1, 2]) {
        assert.ok(['A', 'B', 'C', 'D'].includes(keyEntry.mcqAnswerByOrder[order]));
      }
    }
  });

  it('Test 30: Local-first persistence roundtrip (JSON / IndexedDB structuredClone) preserves all Phase 3 graph metadata', () => {
    const v = generateVerifiedVariant({
      template: getPhase3Template('rational-asymptotes'),
      seed: 'PERSIST-30',
      variantIndex: 1,
    }).variant!;

    // Simulate IndexedDB structuredClone + JSON backup roundtrip
    const roundtripped = JSON.parse(JSON.stringify(v));
    assert.equal(roundtripped.graphFingerprint, v.graphFingerprint);
    assert.equal(roundtripped.graphSvg, v.graphSvg);
    assert.equal(roundtripped.variationTableSvg, v.variationTableSvg);
    assert.equal(roundtripped.functionAnalysis.fingerprint, v.functionAnalysis!.fingerprint);

    const recheck = verifyDynamicGraphBinding({
      question: roundtripped.question,
      functionAnalysis: roundtripped.functionAnalysis,
      variationTable: roundtripped.variationTable,
      graphFingerprint: roundtripped.graphFingerprint,
    });
    assert.equal(recheck.valid, true, recheck.reason);

    // Ensure unified demo bank includes Level 1, 2, and 3 without ID collisions
    const bankIds = new Set(DEMO_GENERATOR_BANK.map((b) => b.id));
    assert.equal(
      bankIds.size,
      DEMO_GENERATOR_BANK.length,
      'Bank IDs must be unique across Phase 1/2/3'
    );
    assert.ok(
      PHASE2_DEMO_BANK.every((b) => bankIds.has(b.id)) &&
        PHASE3_DEMO_BANK.every((b) => bankIds.has(b.id)),
      'DEMO_GENERATOR_BANK must include all Phase 2 and Phase 3 bank items'
    );

    const tplIds = new Set(DEMO_GENERATOR_TEMPLATES.map((t) => t.id));
    assert.equal(
      tplIds.size,
      DEMO_GENERATOR_TEMPLATES.length,
      'Template IDs must be unique across Phase 1/2/3'
    );
    assert.ok(
      PHASE2_DEMO_TEMPLATES.every((t) => tplIds.has(t.id)) &&
        PHASE3_DEMO_TEMPLATES.every((t) => tplIds.has(t.id)),
      'DEMO_GENERATOR_TEMPLATES must include all Phase 2 and Phase 3 templates'
    );

    // Sanity check analyzeDynamicFunction dispatcher + fingerprint determinism
    const dispatched = analyzeDynamicFunction({ family: 'quadratic', a: 1, b: -4, c: 3 });
    assert.equal(
      dispatched.fingerprint,
      computeFunctionFingerprint({ family: 'quadratic', a: 1, b: -4, c: 3 })
    );
  });
});

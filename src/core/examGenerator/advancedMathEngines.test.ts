import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areMathAnswersEquivalent,
  canonicalizeMathAnswer,
  createRational,
  differentiatePolynomial,
  evaluatePolynomialDirect,
  evaluatePolynomialHorner,
  formatPolynomialLatex,
  parseSimplePolynomial,
  polynomialsEqual,
  rationalsEqual,
  solveAndVerifyLinearSystem2x2,
  verifyPolynomialDerivative,
  verifyQuadraticEquation,
} from './verifiedMathCore';
import {
  evaluateBankQuestionVariantSafety,
  GENERATION_FAILED_CONSTRAINTS_MSG,
  generateVerifiedVariant,
  VERIFIED_TEMPLATE_FAMILIES,
} from './verifiedVariantEngine';
import {
  canExportOfficialAnswerKey,
  convertDraftToMathExamProject,
  generateExamsFromBlueprint,
} from './examBuilderEngine';
import { generateMixedExams } from '../mathShuffleEngine';
import { buildExamAnswerKeyMap } from '../grading/examMixerBridge';
import {
  buildAnswerKeyDocxBuffer,
  buildStudentExamDocxBuffer,
} from '../examExportEngine';
import {
  DEMO_GENERATOR_BANK,
  DEMO_GENERATOR_TEMPLATES,
  PHASE2_DEMO_TEMPLATES,
} from '../../data/demoExamGeneratorData';
import type {
  ExamBlueprintConfig,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';

const quadTemplate = PHASE2_DEMO_TEMPLATES.find((t) => t.familyId === 'quadratic-equation')!;
const sysTemplate = PHASE2_DEMO_TEMPLATES.find((t) => t.familyId === 'linear-system-2x2')!;
const derivTemplate = PHASE2_DEMO_TEMPLATES.find((t) => t.familyId === 'polynomial-derivative')!;

// ---------------------------------------------------------------------------
// QUADRATIC EQUATION ENGINE TESTS (1 - 8)
// ---------------------------------------------------------------------------

test('1. Quadratic: fixture r1=2, r2=-3, a=2 constructs 2x^2 + 2x - 12 = 0 with S = {-3; 2}', () => {
  const out = generateVerifiedVariant({
    template: quadTemplate,
    seed: 'FIXTURE-QUAD-1',
    forcedParameterValues: { a: 2, r1: 2, r2: -3 },
  });
  assert.equal(out.ok, true);
  assert.ok(out.variant);
  assert.equal(out.variant.parameterValues.b, 2);
  assert.equal(out.variant.parameterValues.c, -12);
  assert.equal(out.variant.correctCanonicalKey, 'SET:{-3;2}');
  assert.match(out.variant.question.stem.rawSource, /2x\^\{2\} \+ 2x - 12 = 0/);
  assert.equal(out.variant.question.options?.length, 4);
  assert.equal(
    out.variant.question.options?.filter((o) => o.isCorrect).length,
    1
  );
});

test('2. Quadratic: double root mode enforces Δ = 0 and single double root', () => {
  const doubleTpl: QuestionTemplateDefinition = {
    ...structuredClone(quadTemplate),
    id: 'tpl-quad-double',
    questionType: 'short-answer',
    familyConfig: { quadraticMode: 'double-root', rootPolicy: 'double' },
  };
  const out = generateVerifiedVariant({
    template: doubleTpl,
    seed: 'FIXTURE-QUAD-DOUBLE',
    forcedParameterValues: { a: 2, r1: 3, r2: 3 },
  });
  assert.equal(out.ok, true);
  assert.ok(out.variant);
  // 2(x - 3)^2 = 2x^2 - 12x + 18 = 0
  assert.equal(out.variant.parameterValues.b, -12);
  assert.equal(out.variant.parameterValues.c, 18);
  assert.equal(out.variant.correctValue, 3);
  assert.equal(out.variant.question.shortAnswer?.answerValue, '3');
  const check = verifyQuadraticEquation(2, -12, 18, 3, 3);
  assert.equal(check.valid, true);
  assert.equal(check.discriminant, 0);
  assert.equal(check.rootKind, 'double-root');
});

test('3. Quadratic: supports negative leading coefficient a < 0 accurately', () => {
  const out = generateVerifiedVariant({
    template: quadTemplate,
    seed: 'FIXTURE-QUAD-NEG-A',
    forcedParameterValues: { a: -2, r1: -1, r2: 4 },
  });
  assert.equal(out.ok, true);
  assert.ok(out.variant);
  // -2(x + 1)(x - 4) = -2x^2 + 6x + 8 = 0
  assert.equal(out.variant.parameterValues.b, 6);
  assert.equal(out.variant.parameterValues.c, 8);
  assert.equal(out.variant.correctCanonicalKey, 'SET:{-1;4}');
  // Independent back-substitution
  const f = (x: number) => -2 * x * x + 6 * x + 8;
  assert.equal(f(-1), 0);
  assert.equal(f(4), 0);
});

test('4. Quadratic: strictly rejects a = 0', () => {
  const out = generateVerifiedVariant({
    template: quadTemplate,
    seed: 'FIXTURE-QUAD-ZERO-A',
    forcedParameterValues: { a: 0, r1: 1, r2: 2 },
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 'BLOCKED');

  const directCheck = verifyQuadraticEquation(0, 2, -4, 2, 2);
  assert.equal(directCheck.valid, false);
});

test('5 & 6. Quadratic: independent Viète & back-substitution verifier detects corrupted roots', () => {
  const good = verifyQuadraticEquation(3, -15, 18, 2, 3);
  assert.equal(good.valid, true);
  assert.equal(good.vieteSumOk, true);
  assert.equal(good.vieteProductOk, true);
  assert.equal(good.substitutionOk, true);

  const bad = verifyQuadraticEquation(3, -15, 18, 2, -3);
  assert.equal(bad.valid, false);
  assert.equal(bad.substitutionOk, false);
});

test('7. Equivalent Answer Detector: detects 1/2 == 2/4, {-3;2} == {2;-3}, 2x+3x == 5x', () => {
  assert.equal(rationalsEqual(createRational(1, 2), createRational(2, 4)), true);
  assert.equal(areMathAnswersEquivalent('1/2', '2/4'), true);
  assert.equal(areMathAnswersEquivalent('\\frac{1}{2}', '0.5'), true);
  assert.equal(areMathAnswersEquivalent('S = \\{-3; 2\\}', 'S = \\{2; -3\\}'), true);
  assert.equal(areMathAnswersEquivalent('2x + 3x', '5x'), true);
  assert.equal(areMathAnswersEquivalent('5 - 4x + 9x^2', '9x^2 - 4x + 5'), true);
  assert.equal(areMathAnswersEquivalent('(2; 3)', '(3; 2)'), false);
});

test('8. Quadratic: 20 generated variants all have 4 unique canonical options, 1 correct answer & short-answer guardrail works', () => {
  for (let i = 1; i <= 20; i += 1) {
    const out = generateVerifiedVariant({
      template: quadTemplate,
      seed: 'QUAD-STRESS-20',
      variantIndex: i,
    });
    assert.equal(out.ok, true, `Variant ${i} failed: ${out.blockingReasons.join('; ')}`);
    const v = out.variant!;
    assert.equal(v.question.options?.length, 4);
    assert.equal(v.question.options?.filter((o) => o.isCorrect).length, 1);
    const keys = new Set(v.question.options!.map((o) => canonicalizeMathAnswer(o.content.rawSource)));
    assert.equal(keys.size, 4, `Duplicate canonical option in variant ${i}`);
    // Independent check on coefficients
    const { a, b, c, r1, r2 } = v.parameterValues;
    assert.notEqual(a, 0);
    assert.equal(a * r1 * r1 + b * r1 + c, 0);
    assert.equal(a * r2 * r2 + b * r2 + c, 0);
  }

  // Guardrail: cannot force 2-distinct-root solution-set into short-answer
  const invalidShort: QuestionTemplateDefinition = {
    ...structuredClone(quadTemplate),
    questionType: 'short-answer',
    familyConfig: { quadraticMode: 'solution-set', rootPolicy: 'distinct' },
  };
  const blocked = generateVerifiedVariant({
    template: invalidShort,
    seed: 'QUAD-BLOCK-SA',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 'BLOCKED');
});

// ---------------------------------------------------------------------------
// LINEAR SYSTEM 2x2 ENGINE TESTS (9 - 14)
// ---------------------------------------------------------------------------

test('9, 10 & 11. Linear System: fixture (x0=2, y0=3) solves 2x+y=7, x-y=-1 with D!=0, Cramer+Gauss+substitution', () => {
  const out = generateVerifiedVariant({
    template: sysTemplate,
    seed: 'FIXTURE-SYS-1',
    forcedParameterValues: { x0: 2, y0: 3, a: 2, b: 1, c: 1, d: -1 },
  });
  assert.equal(out.ok, true);
  assert.ok(out.variant);
  assert.equal(out.variant.parameterValues.e, 7);
  assert.equal(out.variant.parameterValues.f, -1);
  assert.equal(out.variant.correctCanonicalKey, 'PAIR:(2,3)');

  const check = solveAndVerifyLinearSystem2x2(2, 1, 7, 1, -1, -1, 2, 3);
  assert.equal(check.valid, true);
  assert.equal(check.determinant, -3);
  assert.equal(check.substitutionOk, true);
  assert.equal(check.gaussX, 2);
  assert.equal(check.gaussY, 3);
});

test('12. Linear System: detects and blocks degenerate / singular systems (D = ad - bc = 0)', () => {
  const singular = solveAndVerifyLinearSystem2x2(2, 4, 10, 1, 2, 5);
  assert.equal(singular.valid, false);
  assert.equal(singular.degenerate, true);
  assert.equal(singular.determinant, 0);

  const out = generateVerifiedVariant({
    template: sysTemplate,
    seed: 'FIXTURE-SYS-SINGULAR',
    forcedParameterValues: { x0: 1, y0: 2, a: 2, b: 4, c: 1, d: 2 },
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 'BLOCKED');
});

test('13 & 14. Linear System: ordered-pair MCQ, x+y short-answer, and ordered-pair short-answer guardrail', () => {
  for (let i = 1; i <= 15; i += 1) {
    const out = generateVerifiedVariant({
      template: sysTemplate,
      seed: 'SYS-STRESS-15',
      variantIndex: i,
    });
    assert.equal(out.ok, true);
    const { a, b, c, d, e, f, x0, y0 } = out.variant!.parameterValues;
    assert.notEqual(a * d - b * c, 0);
    assert.equal(a * x0 + b * y0, e);
    assert.equal(c * x0 + d * y0, f);
    assert.equal(out.variant!.question.options?.length, 4);
    assert.equal(
      out.variant!.question.options?.filter((o) => o.isCorrect).length,
      1
    );
  }

  // sum-xy short-answer
  const sumTpl: QuestionTemplateDefinition = {
    ...structuredClone(sysTemplate),
    id: 'tpl-sys-sum',
    questionType: 'short-answer',
    familyConfig: { linearSystemMode: 'sum-xy' },
  };
  const sumOut = generateVerifiedVariant({
    template: sumTpl,
    seed: 'SYS-SUM',
    forcedParameterValues: { x0: 2, y0: 3, a: 2, b: 1, c: 1, d: -1 },
  });
  assert.equal(sumOut.ok, true);
  assert.equal(sumOut.variant!.correctValue, 5);
  assert.equal(sumOut.variant!.question.shortAnswer?.answerValue, '5');

  // Guardrail: ordered-pair cannot be short-answer
  const invalidPairSA: QuestionTemplateDefinition = {
    ...structuredClone(sysTemplate),
    questionType: 'short-answer',
    familyConfig: { linearSystemMode: 'ordered-pair' },
  };
  const blocked = generateVerifiedVariant({
    template: invalidPairSA,
    seed: 'SYS-BLOCK-SA',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 'BLOCKED');
});

// ---------------------------------------------------------------------------
// POLYNOMIAL DERIVATIVE ENGINE TESTS (15 - 22)
// ---------------------------------------------------------------------------

test('15, 16 & 17. Polynomial Derivative: degree 2, 3, and 4 exact power-rule differentiation', () => {
  // Degree 2: 4x^2 - 5x + 9 -> 8x - 5
  const d2 = differentiatePolynomial([9, -5, 4]);
  assert.deepEqual(d2, [-5, 8]);
  assert.equal(formatPolynomialLatex(d2), '8x - 5');

  // Degree 3 fixture from spec: 3x^3 - 2x^2 + 5x - 7 -> 9x^2 - 4x + 5
  const d3 = differentiatePolynomial([-7, 5, -2, 3]);
  assert.deepEqual(d3, [5, -4, 9]);
  assert.equal(formatPolynomialLatex(d3), '9x^{2} - 4x + 5');

  // Degree 4: 2x^4 - 3x^3 + 0x^2 + 4x - 1 -> 8x^3 - 9x^2 + 4
  const d4 = differentiatePolynomial([-1, 4, 0, -3, 2]);
  assert.deepEqual(d4, [4, 0, -9, 8]);
  assert.equal(formatPolynomialLatex(d4), '8x^{3} - 9x^{2} + 4');
});

test('18, 19 & 20. Polynomial Derivative: zero coefficients omitted, negative terms clean, constant derivative = 0', () => {
  const deg4Tpl: QuestionTemplateDefinition = {
    ...structuredClone(derivTemplate),
    id: 'tpl-deriv-deg4',
    familyConfig: { derivativeMode: 'derivative-poly', polynomialDegree: 4 },
  };
  const out = generateVerifiedVariant({
    template: deg4Tpl,
    seed: 'FIXTURE-DERIV-4',
    forcedParameterValues: { a4: -2, a3: 0, a2: 3, a1: 0, a0: -9, x0: 1 },
  });
  assert.equal(out.ok, true);
  assert.ok(out.variant);
  // f(x) = -2x^4 + 3x^2 - 9 => f'(x) = -8x^3 + 6x (constant -9 vanishes!)
  assert.equal(out.variant.correctFormatted, "$f'(x) = -8x^{3} + 6x$");
  assert.equal(out.variant.question.stem.rawSource.includes('0x'), false);
  assert.equal(out.variant.correctFormatted.includes('-9'), false);
  assert.equal(out.variant.question.options?.length, 4);
  assert.equal(
    out.variant.question.options?.filter((o) => o.isCorrect).length,
    1
  );
});

test('21. Polynomial Derivative: f\'(x0) fixture f(x)=3x^3-2x^2+5x-7 at x0=2 equals 33 (Horner + finite diff)', () => {
  const valTpl: QuestionTemplateDefinition = {
    ...structuredClone(derivTemplate),
    id: 'tpl-deriv-val',
    questionType: 'short-answer',
    familyConfig: { derivativeMode: 'value-at-x0', polynomialDegree: 3 },
  };
  const out = generateVerifiedVariant({
    template: valTpl,
    seed: 'FIXTURE-DERIV-X0',
    forcedParameterValues: { a4: 1, a3: 3, a2: -2, a1: 5, a0: -7, x0: 2 },
  });
  assert.equal(out.ok, true);
  assert.equal(out.variant!.correctValue, 33);
  assert.equal(out.variant!.question.shortAnswer?.answerValue, '33');

  const vCheck = verifyPolynomialDerivative([-7, 5, -2, 3], [5, -4, 9], 2);
  assert.equal(vCheck.valid, true);
  assert.equal(vCheck.valueAtX0, 33);
  assert.equal(evaluatePolynomialDirect([5, -4, 9], 2), 33);
  assert.equal(evaluatePolynomialHorner([5, -4, 9], 2), 33);
});

test('22. Polynomial Normalization: parseSimplePolynomial recognizes equivalent polynomials', () => {
  const p1 = parseSimplePolynomial('2x + 3x');
  const p2 = parseSimplePolynomial('5x');
  assert.ok(p1 && p2);
  assert.equal(polynomialsEqual(p1, p2), true);

  const p3 = parseSimplePolynomial("f'(x) = 9x^2 - 4x + 5");
  const p4 = parseSimplePolynomial('5 + 9x^{2} - 4x');
  assert.ok(p3 && p4);
  assert.equal(polynomialsEqual(p3, p4), true);
});

// ---------------------------------------------------------------------------
// INTEGRATION, SEED REPRODUCIBILITY, MIXER, GRADING & DOCX (23 - 34)
// ---------------------------------------------------------------------------

test('23 & 24. All Level 1 + Level 2 + Level 3 families (16 total) pass and are 100% seed-reproducible', () => {
  const allFamilyIds = Object.keys(VERIFIED_TEMPLATE_FAMILIES);
  assert.equal(allFamilyIds.length, 16);

  for (const tpl of DEMO_GENERATOR_TEMPLATES) {
    const r1 = generateVerifiedVariant({ template: tpl, seed: 'REPRO-SEED-2026', variantIndex: 3 });
    const r2 = generateVerifiedVariant({ template: tpl, seed: 'REPRO-SEED-2026', variantIndex: 3 });
    assert.equal(r1.ok, true, `Template ${tpl.id} failed`);
    assert.equal(r2.ok, true);
    assert.equal(r1.variant!.parameterSignature, r2.variant!.parameterSignature);
    assert.equal(r1.variant!.correctFormatted, r2.variant!.correctFormatted);
    assert.equal(r1.variant!.correctOptionLabel, r2.variant!.correctOptionLabel);
  }
});

test('25. Unsatisfiable constraints report GENERATION FAILED — CONSTRAINTS UNSATISFIED without infinite loop', () => {
  const impossibleQuad: QuestionTemplateDefinition = {
    ...structuredClone(quadTemplate),
    id: 'tpl-impossible',
    familyConfig: { quadraticMode: 'solution-set', rootPolicy: 'distinct' },
    parameters: [
      { name: 'a', label: 'a', kind: 'integer', min: 1, max: 1, nonZero: true },
      { name: 'r1', label: 'r1', kind: 'integer', min: 2, max: 2 },
      { name: 'r2', label: 'r2', kind: 'integer', min: 2, max: 2 }, // r1 === r2 impossible for distinct!
    ],
  };
  const out = generateVerifiedVariant({ template: impossibleQuad, seed: 'IMPOSSIBLE' });
  assert.equal(out.ok, false);
  assert.equal(out.status, 'BLOCKED');
  assert.ok(
    out.blockingReasons.some((r) => r.includes(GENERATION_FAILED_CONSTRAINTS_MSG))
  );
});

test('26 - 32. End-to-End Level 2 Blueprint -> Confirmation Gate -> Exam Mixer -> Answer Mapping -> DOCX -> Visual Protection', async () => {
  const blueprint: ExamBlueprintConfig = {
    title: 'Đề kiểm tra Toán nâng cao Level 2',
    subjectId: 'toan',
    subjectName: 'Toán học',
    grade: 'Lớp 11',
    durationMinutes: 45,
    selectedTopics: [],
    selectedTypes: ['mcq'],
    selectedCognitiveLevels: ['thong-hieu', 'van-dung'],
    matrixRows: [
      {
        id: 'r-quad',
        topic: 'Phương trình và bất phương trình',
        type: 'mcq',
        cognitiveLevel: 'thong-hieu',
        count: 2,
        pointsPerQuestion: 1,
      },
      {
        id: 'r-sys',
        topic: 'Hệ phương trình bậc nhất',
        type: 'mcq',
        cognitiveLevel: 'thong-hieu',
        count: 2,
        pointsPerQuestion: 1,
      },
      {
        id: 'r-deriv',
        topic: 'Đạo hàm',
        type: 'mcq',
        cognitiveLevel: 'van-dung',
        count: 2,
        pointsPerQuestion: 1,
      },
    ],
    mode: 'verified-variants',
    variantRatioPercent: 100,
    seed: 'PHASE2-E2E-SEED',
    examDraftCount: 2,
    allowMultipleVariantsPerTemplate: true,
  };

  const drafts = generateExamsFromBlueprint({
    blueprint,
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });

  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].items.length, 6);
  assert.equal(drafts[1].items.length, 6);

  // Zero duplicate parameter signatures across all 12 generated items across both drafts
  const allSigs = new Set(
    drafts.flatMap((d) => d.items.map((it) => `${it.templateId}::${it.parameterSignature}`))
  );
  assert.equal(allSigs.size, 12);

  // Teacher confirmation gate blocks official export before approval
  assert.equal(canExportOfficialAnswerKey(drafts[0]).allowed, false);

  // Approve all answers
  const approvedDraft = structuredClone(drafts[0]);
  approvedDraft.items = approvedDraft.items.map((it) => ({
    ...it,
    teacherConfirmed: true,
    question: { ...it.question, answerConfirmed: true },
  }));
  approvedDraft.allAnswersConfirmed = true;
  assert.equal(canExportOfficialAnswerKey(approvedDraft).allowed, true);

  // Convert to MathExamProject and shuffle with existing Exam Mixer Pro engine
  const project = convertDraftToMathExamProject(approvedDraft, {
    examCount: 4,
    startCodeNumber: 201,
  });
  const mixResult = generateMixedExams(project);
  assert.equal(mixResult.versions.length, 4);
  project.generatedVersions = mixResult.versions;

  // Verify Answer Mapping for Smart Grading Studio matches shuffled options exactly
  const keyMap = buildExamAnswerKeyMap(project);
  assert.equal(Object.keys(keyMap).length, 4);
  for (const ver of mixResult.versions) {
    const mapped = keyMap[ver.code];
    assert.ok(mapped?.valid);
    assert.equal(mapped.autoGradableCount, 6);
    ver.questions.forEach((q, idx) => {
      const qNo = idx + 1;
      const correctIdx = (q.options ?? []).findIndex((o) => o.id === q.correctOptionId);
      assert.ok(correctIdx >= 0 && correctIdx < 4);
      const expectedLabel = ['A', 'B', 'C', 'D'][correctIdx];
      assert.equal(ver.answerKeyRows[idx].answer, expectedLabel);
      assert.equal(mapped.mcqAnswerByOrder[qNo], expectedLabel);
    });
  }

  // Verify DOCX export produces valid non-empty buffers
  const studentDocx = await buildStudentExamDocxBuffer(project, mixResult.versions[0]);
  const keyDocx = await buildAnswerKeyDocxBuffer(project);
  assert.ok(studentDocx.byteLength > 1000);
  assert.ok(keyDocx.byteLength > 1000);

  // Verify static visual-asset question (NH-08) remains strictly BLOCKED
  const visualRec = DEMO_GENERATOR_BANK.find((b) => b.id === 'bank-q-08')!;
  const safety = evaluateBankQuestionVariantSafety(visualRec, quadTemplate);
  assert.equal(safety.status, 'BLOCKED');
  assert.equal(safety.canGenerateVariant, false);
});

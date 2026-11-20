import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_GENERATOR_BANK,
  DEMO_GENERATOR_TEMPLATES,
} from '../../data/demoExamGeneratorData';
import { DEMO_MATH_EXAM } from '../../data/demoMathExams';
import {
  canExportOfficialAnswerKey,
  collectUnifiedQuestionBank,
  convertDraftToMathExamProject,
  generateExamsFromBlueprint,
} from './examBuilderEngine';
import {
  evaluateBankQuestionVariantSafety,
  generateVerifiedVariant,
} from './verifiedVariantEngine';
import { validateConstraintDefinitions } from './parameterConstraintEngine';
import { generateMixedExams } from '../mathShuffleEngine';
import { buildExamAnswerKeyMap } from '../grading/examMixerBridge';
import { buildStudentExamDocxBuffer } from '../examExportEngine';
import type {
  BankQuestionRecord,
  ExamBlueprintConfig,
  GeneratorBackupBundle,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';

function makeBaseBlueprint(
  overrides?: Partial<ExamBlueprintConfig>
): ExamBlueprintConfig {
  return {
    title: 'Đề kiểm tra Giữa kỳ I Toán 8',
    subjectId: 'toan',
    subjectName: 'Toán học',
    grade: 'Lớp 8',
    durationMinutes: 45,
    selectedTopics: [],
    selectedTypes: ['mcq', 'short-answer', 'essay'],
    selectedCognitiveLevels: [
      'nhan-biet',
      'thong-hieu',
      'van-dung',
      'van-dung-cao',
    ],
    matrixRows: [
      {
        id: 'row-nb',
        topic: 'Tất cả',
        type: 'mcq',
        cognitiveLevel: 'nhan-biet',
        count: 3,
        pointsPerQuestion: 0.5,
      },
      {
        id: 'row-th',
        topic: 'Tất cả',
        type: 'mcq',
        cognitiveLevel: 'thong-hieu',
        count: 2,
        pointsPerQuestion: 0.5,
      },
    ],
    mode: 'bank-only',
    variantRatioPercent: 50,
    seed: 'UNIT-TEST-SEED-2026',
    examDraftCount: 1,
    allowMultipleVariantsPerTemplate: true,
    ...overrides,
  };
}

// 1. Lấy câu hỏi từ ngân hàng theo cấu trúc đề
test('01. Bank-only mode selects questions matching matrix structure', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint(),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].items.length, 5);
  assert.equal(drafts[0].report.originalCount, 5);
  assert.equal(drafts[0].report.variantCount, 0);
  assert.equal(drafts[0].report.shortfalls.length, 0);
});

// 2. Lọc đúng theo chủ đề
test('02. Topic filter strictly selects only questions from requested topic', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({
      matrixRows: [
        {
          id: 'row-topic',
          topic: 'Biểu thức đại số',
          type: 'mcq',
          cognitiveLevel: 'nhan-biet',
          count: 1,
          pointsPerQuestion: 1,
        },
        {
          id: 'row-topic-th',
          topic: 'Biểu thức đại số',
          type: 'mcq',
          cognitiveLevel: 'thong-hieu',
          count: 1,
          pointsPerQuestion: 1,
        },
      ],
    }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  assert.equal(drafts[0].items.length, 2);
  for (const item of drafts[0].items) {
    assert.equal(item.question.topic, 'Biểu thức đại số');
  }
});

// 3. Lọc đúng theo mức độ nhận thức
test('03. Cognitive level filter selects exact cognitive distribution', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({
      matrixRows: [
        {
          id: 'row-vd',
          topic: 'Tất cả',
          type: 'mcq',
          cognitiveLevel: 'van-dung',
          count: 2,
          pointsPerQuestion: 1,
        },
      ],
    }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  assert.equal(drafts[0].items.length, 2);
  assert.ok(drafts[0].items.every((i) => i.question.cognitiveLevel === 'van-dung'));
});

// 4. Không trùng câu trong cùng một đề
test('04. No duplicate parent questions within the same generated exam', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({
      matrixRows: [
        {
          id: 'row-nb-1',
          topic: 'Tất cả',
          type: 'mcq',
          cognitiveLevel: 'nhan-biet',
          count: 2,
          pointsPerQuestion: 0.5,
        },
        {
          id: 'row-nb-2',
          topic: 'Tất cả',
          type: 'mcq',
          cognitiveLevel: 'nhan-biet',
          count: 1,
          pointsPerQuestion: 0.5,
        },
      ],
    }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  const parentIds = drafts[0].items.map((i) => i.parentQuestionId);
  assert.equal(new Set(parentIds).size, parentIds.length);
});

// 5. Thiếu câu trong ngân hàng báo lỗi rõ, không bịa câu
test('05. Insufficient bank reports honest shortfall without fabricating fake questions', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({
      matrixRows: [
        {
          id: 'row-short',
          topic: 'Tất cả',
          type: 'mcq',
          cognitiveLevel: 'nhan-biet',
          count: 20, // way more than available in bank
          pointsPerQuestion: 0.5,
        },
      ],
    }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  assert.ok(drafts[0].items.length < 20);
  assert.equal(drafts[0].report.shortfalls.length, 1);
  assert.equal(
    drafts[0].report.shortfalls[0].shortfall,
    20 - drafts[0].items.length
  );
  assert.match(drafts[0].report.shortfalls[0].reason, /không tự bịa/i);
});

// 6. Sinh biến thể phương trình bậc nhất đơn giản
test('06. Linear equation template generates verified variant', () => {
  const tpl = DEMO_GENERATOR_TEMPLATES.find((t) => t.familyId === 'linear-equation')!;
  const res = generateVerifiedVariant({
    template: tpl,
    seed: 'LINEAR-SEED-1',
    variantIndex: 1,
  });
  assert.equal(res.ok, true);
  assert.ok(res.variant);
  assert.equal(res.variant.status, 'VARIANT_READY');
  assert.equal(res.variant.verification.passed, true);
});

// 7. Đáp án tính lại chính xác
test('07. Recalculated answer matches mathematical ground truth for all 7 Level 1 families', () => {
  for (const tpl of DEMO_GENERATOR_TEMPLATES) {
    const res = generateVerifiedVariant({
      template: tpl,
      seed: `ALL-FAMILIES-${tpl.familyId}`,
      variantIndex: 1,
    });
    assert.equal(res.ok, true, `Template ${tpl.id} should succeed`);
    const v = res.variant!;
    const p = v.parameterValues;
    if (tpl.familyId === 'linear-equation') {
      assert.equal(p.a * v.correctValue + p.b, p.c);
    } else if (tpl.familyId === 'arithmetic-expression') {
      assert.equal(v.correctValue, p.p * (p.q + p.r) - p.s);
    } else if (tpl.familyId === 'algebraic-eval') {
      assert.equal(v.correctValue, p.a * p.x0 * p.x0 + p.b * p.x0 + p.c);
    } else if (tpl.familyId === 'percentage-problem') {
      assert.equal(v.correctValue, p.basePrice * (100 - p.percent) / 100);
    } else if (tpl.familyId === 'proportion-ratio') {
      assert.equal(p.a * p.c, p.b * v.correctValue);
    } else if (tpl.familyId === 'arithmetic-sequence') {
      assert.equal(v.correctValue, p.u1 + (p.n - 1) * p.d);
    } else if (tpl.familyId === 'physics-motion') {
      assert.equal(v.correctValue * p.t, p.s);
    }
  }
});

// 8. Kiểm tra thế ngược đáp án đúng
test('08. Independent substitution verification proof is recorded and passes', () => {
  const tpl = DEMO_GENERATOR_TEMPLATES.find((t) => t.familyId === 'linear-equation')!;
  const res = generateVerifiedVariant({
    template: tpl,
    seed: 'SUBSTITUTION-PROOF-99',
  });
  assert.equal(res.ok, true);
  assert.match(res.variant!.verification.independentCheckSummary, /Thế ngược x =/);
  assert.equal(res.variant!.verification.passed, true);
});

// 9. 4 phương án A/B/C/D không trùng và chỉ có 1 đáp án đúng
test('09. MCQ variant always has 4 unique options and exactly 1 valid answer', () => {
  const mcqTemplates = DEMO_GENERATOR_TEMPLATES.filter((t) => t.questionType === 'mcq');
  for (const tpl of mcqTemplates) {
    for (let i = 1; i <= 5; i += 1) {
      const res = generateVerifiedVariant({
        template: tpl,
        seed: `DISTRACTOR-CHECK-${i}`,
        variantIndex: i,
      });
      assert.equal(res.ok, true);
      const opts = res.variant!.question.options ?? [];
      assert.equal(opts.length, 4);
      const uniqueOptions = new Set(
        opts.map((o) =>
          o.visualAsset?.sourceData
            ? `${o.content.rawSource}::${o.visualAsset.sourceData}`
            : o.content.rawSource
        )
      );
      assert.equal(uniqueOptions.size, 4, 'All 4 options must be distinct');
      assert.equal(opts.filter((o) => o.isCorrect).length, 1);
      assert.equal(res.variant!.verification.validOptionCount, 1);
      assert.equal(res.variant!.verification.uniqueOptionCount, 4);
    }
  }
});

// 10. Phát hiện và loại biến thể chia cho 0
test('10. Detects and blocks zero-denominator or degenerate zero-coefficient variant', () => {
  const ratioTpl = DEMO_GENERATOR_TEMPLATES.find((t) => t.familyId === 'proportion-ratio')!;
  const res = generateVerifiedVariant({
    template: ratioTpl,
    seed: 'ZERO-DENOM',
    forcedParameterValues: { a: 3, b: 0, k: 2 },
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.blockingReasons.some((r) => /0/.test(r)));

  const physTpl = DEMO_GENERATOR_TEMPLATES.find((t) => t.familyId === 'physics-motion')!;
  const resPhys = generateVerifiedVariant({
    template: physTpl,
    seed: 'ZERO-TIME',
    forcedParameterValues: { v: 50, t: 0 },
  });
  assert.equal(resPhys.ok, false);
  assert.equal(resPhys.status, 'BLOCKED');
});

// 11. Phát hiện và loại biến thể vi phạm ràng buộc
test('11. Detects and blocks invalid parameter constraint definitions (min > max, contradictory signs)', () => {
  const brokenTpl: QuestionTemplateDefinition = {
    ...structuredClone(DEMO_GENERATOR_TEMPLATES[0]),
    id: 'tpl-broken',
    parameters: [
      { name: 'a', label: 'a', kind: 'integer', min: 10, max: 2, nonZero: true },
      { name: 'x0', label: 'x0', kind: 'integer', min: 1, max: 5 },
      { name: 'b', label: 'b', kind: 'integer', min: 1, max: 5 },
    ],
  };
  const check = validateConstraintDefinitions(brokenTpl.parameters);
  assert.equal(check.valid, false);

  const res = generateVerifiedVariant({
    template: brokenTpl,
    seed: 'BROKEN-CONSTRAINTS',
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 'BLOCKED');
});

// 12. Seed giống nhau tạo biến thể giống nhau
test('12. Deterministic seed reproduces identical variants across repeated runs', () => {
  const tpl = DEMO_GENERATOR_TEMPLATES[0];
  const r1 = generateVerifiedVariant({ template: tpl, seed: 'DETERMINISTIC-42', variantIndex: 3 });
  const r2 = generateVerifiedVariant({ template: tpl, seed: 'DETERMINISTIC-42', variantIndex: 3 });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.deepEqual(r1.variant!.parameterValues, r2.variant!.parameterValues);
  assert.equal(r1.variant!.question.stem.rawSource, r2.variant!.question.stem.rawSource);
  assert.equal(r1.variant!.correctOptionLabel, r2.variant!.correctOptionLabel);
  assert.deepEqual(
    r1.variant!.question.options?.map((o) => o.content.rawSource),
    r2.variant!.question.options?.map((o) => o.content.rawSource)
  );
});

// 13. Câu hỏi gốc không bị chỉnh sửa sau khi sinh biến thể
test('13. Original bank questions and MathExamProject remain strictly immutable', () => {
  const bankSnapshotBefore = JSON.stringify(DEMO_GENERATOR_BANK);
  const examSnapshotBefore = JSON.stringify(DEMO_MATH_EXAM);

  const unified = collectUnifiedQuestionBank(DEMO_GENERATOR_BANK, [DEMO_MATH_EXAM]);
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({ mode: 'hybrid', examDraftCount: 2 }),
    bank: unified,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  assert.equal(drafts.length, 2);
  // Mutate a generated item deliberately
  drafts[0].items[0].question.stem.rawSource = 'MUTATED-IN-DRAFT';

  assert.equal(JSON.stringify(DEMO_GENERATOR_BANK), bankSnapshotBefore);
  assert.equal(JSON.stringify(DEMO_MATH_EXAM), examSnapshotBefore);
});

// 14. Không tự sửa công thức MathType OLE / OMML
test('14. Blocks automatic numeric variant generation for questions containing OMML / MathType binary blocks', () => {
  const ommlRecord: BankQuestionRecord = {
    ...structuredClone(DEMO_GENERATOR_BANK[0]),
    id: 'bank-omml-test',
    hasBinaryFormulaOrOmml: true,
    question: {
      ...structuredClone(DEMO_GENERATOR_BANK[0].question),
      id: 'bank-omml-test',
      stem: {
        rawSource: 'Phương trình OMML gốc',
        blocks: [
          {
            id: 'omml-1',
            kind: 'omml-raw',
            content: '<m:oMath><m:r><m:t>x+1=0</m:t></m:r></m:oMath>',
          },
        ],
      },
    },
  };
  const safety = evaluateBankQuestionVariantSafety(ommlRecord, DEMO_GENERATOR_TEMPLATES[0]);
  assert.equal(safety.status, 'BLOCKED');
  assert.equal(safety.canGenerateVariant, false);
  assert.ok(safety.reasons.some((r) => /OMML|MathType/i.test(r)));
});

// 15. Câu có hình ảnh không cập nhật được bị chặn đổi số
test('15. Blocks automatic numeric variant generation for questions with static visual assets', () => {
  const visualRec = DEMO_GENERATOR_BANK.find((b) => b.id === 'bank-q-08')!;
  const safety = evaluateBankQuestionVariantSafety(visualRec, DEMO_GENERATOR_TEMPLATES[0]);
  assert.equal(safety.status, 'BLOCKED');
  assert.equal(safety.canGenerateVariant, false);
  assert.ok(safety.reasons.some((r) => /hình ảnh|đồ thị/i.test(r)));
});

// 16. Tạo 4 đề khác nhau theo cùng cấu trúc ma trận
test('16. Generates 4 distinct exam drafts following the exact same matrix with non-repeating variants', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({
      mode: 'verified-variants',
      examDraftCount: 4,
      matrixRows: [
        {
          id: 'r1',
          topic: 'Tất cả',
          type: 'mcq',
          cognitiveLevel: 'nhan-biet',
          count: 3,
          pointsPerQuestion: 0.5,
        },
        {
          id: 'r2',
          topic: 'Tất cả',
          type: 'mcq',
          cognitiveLevel: 'thong-hieu',
          count: 2,
          pointsPerQuestion: 0.5,
        },
      ],
    }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });

  assert.equal(drafts.length, 4);
  const allSignatures = new Set<string>();
  for (const d of drafts) {
    assert.equal(d.items.length, 5);
    assert.equal(d.report.variantCount, 5);
    for (const item of d.items) {
      assert.ok(item.parameterSignature);
      assert.equal(
        allSignatures.has(item.parameterSignature!),
        false,
        `Variant signature ${item.parameterSignature} should not repeat across 4 drafts`
      );
      allSignatures.add(item.parameterSignature!);
    }
  }
  assert.equal(allSignatures.size, 20);
});

// 17. Chuyển đề tạo ra sang Exam Mixer hoạt động
test('17. Handoff to Exam Mixer Pro produces a valid MathExamProject and mixes cleanly via generateMixedExams', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({ mode: 'hybrid', variantRatioPercent: 60 }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  const draft = drafts[0];
  draft.items.forEach((i) => {
    i.teacherConfirmed = true;
  });
  draft.allAnswersConfirmed = true;

  const project = convertDraftToMathExamProject(draft, { examCount: 4, startCodeNumber: 101 });
  assert.equal(project.questions.length, draft.items.length);
  const mixResult = generateMixedExams(project);
  assert.equal(mixResult.errors.length, 0);
  assert.equal(mixResult.versions.length, 4);
  assert.ok(mixResult.versions.every((v) => v.integrityPassed));
});

// 18. Exam Mixer đảo câu và phương án đúng
test('18. Exam Mixer shuffles both question order and MCQ options for generated variant exams', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({ mode: 'verified-variants', examDraftCount: 1 }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  const draft = drafts[0];
  draft.items.forEach((i) => {
    i.teacherConfirmed = true;
  });
  draft.allAnswersConfirmed = true;

  const project = convertDraftToMathExamProject(draft, { examCount: 4, startCodeNumber: 201 });
  const mixResult = generateMixedExams(project);
  assert.equal(mixResult.versions.length, 4);

  const signatures = new Set(mixResult.versions.map((v) => v.questionOrderSignature));
  assert.ok(signatures.size >= 2, 'Question order should differ across mixed codes');

  const anyOptionMoved = mixResult.versions.some((v) =>
    v.permutationMap.some((m) =>
      (m.optionPermutation ?? []).some((op) => op.newLabel !== op.originalLabel)
    )
  );
  assert.equal(anyOptionMoved, true, 'MCQ options should shuffle when level 2 mixing is enabled');
});

// 19. Answer Mapping cập nhật chính xác theo biến thể mới
test('19. Answer Mapping reflects recalculated correct option of every variant after shuffling', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({ mode: 'verified-variants' }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  const draft = drafts[0];
  draft.items.forEach((i) => {
    i.teacherConfirmed = true;
  });
  draft.allAnswersConfirmed = true;

  const project = convertDraftToMathExamProject(draft, { examCount: 2, startCodeNumber: 301 });
  const mixResult = generateMixedExams(project);
  for (const version of mixResult.versions) {
    version.questions.forEach((q, idx) => {
      const correctIdx = (q.options ?? []).findIndex((o) => o.id === q.correctOptionId);
      assert.ok(correctIdx >= 0 && correctIdx < 4);
      const expectedLetter = ['A', 'B', 'C', 'D'][correctIdx];
      assert.equal(version.answerKeyRows[idx].answer, expectedLetter);
      assert.equal(version.permutationMap[idx].newCorrectLabel, expectedLetter);
    });
  }
});

// 20. Smart Grading Studio nhận đúng đáp án của đề mới tạo (+ chặn khi chưa xác nhận)
test('20. Smart Grading Studio reads exact variant answer keys and gate blocks unconfirmed drafts', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({ mode: 'verified-variants' }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  const draft = drafts[0];

  // Unconfirmed draft MUST be blocked from official answer key / grading export
  const gateBefore = canExportOfficialAnswerKey(draft);
  assert.equal(gateBefore.allowed, false);
  assert.equal(gateBefore.unconfirmedCount, draft.items.length);

  // Confirm all answers -> allowed
  draft.items.forEach((i) => {
    i.teacherConfirmed = true;
  });
  draft.allAnswersConfirmed = true;
  assert.equal(canExportOfficialAnswerKey(draft).allowed, true);

  const project = convertDraftToMathExamProject(draft, { examCount: 2, startCodeNumber: 401 });
  const mixResult = generateMixedExams(project);
  project.generatedVersions = mixResult.versions;

  const keyMap = buildExamAnswerKeyMap(project);
  assert.ok(keyMap['401']?.valid);
  assert.ok(keyMap['402']?.valid);
  assert.equal(keyMap['401'].autoGradableCount, 5);
  assert.equal(Object.keys(keyMap['401'].mcqAnswerByOrder).length, 5);
});

// 21. Xuất DOCX/PDF hoạt động (reusing TeacherOS ExamExportEngine)
test('21. Generated variant exam exports valid DOCX buffer via existing examExportEngine', async () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({ mode: 'hybrid' }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  const draft = drafts[0];
  draft.items.forEach((i) => {
    i.teacherConfirmed = true;
  });
  draft.allAnswersConfirmed = true;

  const project = convertDraftToMathExamProject(draft, { examCount: 1, startCodeNumber: 101 });
  const mixResult = generateMixedExams(project);
  project.generatedVersions = mixResult.versions;

  const docxBuffer = await buildStudentExamDocxBuffer(project, mixResult.versions[0]);
  assert.ok(docxBuffer.byteLength > 1000, 'Exported DOCX buffer should be non-empty valid zip');
});

// 22. Dữ liệu lưu và khôi phục an toàn (JSON backup bundle round-trip)
test('22. Generator backup bundle serializes and restores losslessly', () => {
  const drafts = generateExamsFromBlueprint({
    blueprint: makeBaseBlueprint({ mode: 'hybrid' }),
    bank: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
  });
  const bundle: GeneratorBackupBundle = {
    version: 'smart-exam-generator-2.0-phase1',
    exportedAt: new Date().toISOString(),
    bankQuestions: DEMO_GENERATOR_BANK,
    templates: DEMO_GENERATOR_TEMPLATES,
    drafts,
  };
  const json = JSON.stringify(bundle);
  const parsed = JSON.parse(json) as GeneratorBackupBundle;
  assert.equal(parsed.version, 'smart-exam-generator-2.0-phase1');
  assert.equal(parsed.bankQuestions.length, DEMO_GENERATOR_BANK.length);
  assert.equal(parsed.templates.length, DEMO_GENERATOR_TEMPLATES.length);
  assert.equal(parsed.drafts.length, 1);
  assert.equal(parsed.drafts[0].items.length, drafts[0].items.length);
});

// 23. Không làm hỏng các module cũ của TeacherOS (legacy DEMO_MATH_EXAM compatibility)
test('23. Existing legacy MathExamProject mixes identically without regression', () => {
  const mixResult = generateMixedExams(DEMO_MATH_EXAM);
  assert.equal(mixResult.errors.length, 0);
  assert.ok(mixResult.versions.length > 0);
  assert.ok(mixResult.versions.every((v) => v.integrityPassed));
});

// 24. Short-answer verified variant calculates exact numeric answer & accepted variants
test('24. Short-answer verified template generates exact verified value and solution', () => {
  const shortTpl = DEMO_GENERATOR_TEMPLATES.find((t) => t.questionType === 'short-answer')!;
  const res = generateVerifiedVariant({
    template: shortTpl,
    seed: 'SHORT-ANSWER-24',
  });
  assert.equal(res.ok, true);
  assert.equal(res.variant!.question.type, 'short-answer');
  assert.equal(
    Number(res.variant!.question.shortAnswer?.answerValue),
    res.variant!.correctValue
  );
  assert.equal(res.variant!.verification.passed, true);
});

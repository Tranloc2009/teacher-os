import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditOriginalExamIntegrity,
  checkLatexSyntaxWarnings,
  computeContentHash,
  createMathVisualAsset,
  createOriginalExamSnapshot,
  detectDependentOptions,
  detectDependentStatements,
  detectLockConflictsAndCapacity,
  evaluatePreMixIntegrity,
  parseMathContent,
  verifyMixedExamIntegrity,
} from './mathIntegrity';
import {
  buildDefaultMatrixRules,
  generateMixedExams,
  validateMixConfiguration,
} from './mathShuffleEngine';
import {
  DEMO_MATH_EXAM,
  PRESET_GEOMETRY_PYRAMID_SVG,
  PRESET_VARIATION_TABLE_SVG,
} from '../data/demoMathExams';
import { normalizeMathExamProject } from '../db/database';
import {
  createBackupPayload,
  DEFAULT_PRINT_SETTINGS,
  validateBackupPayload,
} from '../utils/backup';
import {
  CognitiveLevel,
  MATH_SECTION_TITLES,
  MathExamProject,
  MathQuestion,
  QuestionGroup,
} from '../types/mathExam';

function make40McqExam(): MathExamProject {
  const levels: CognitiveLevel[] = [
    'nhan-biet',
    'thong-hieu',
    'van-dung',
    'van-dung-cao',
  ];
  const topics = [
    'Hàm số & Đạo hàm',
    'Nguyên hàm & Tích phân',
    'Mũ & Logarit',
    'Hình học không gian Oxyz',
  ];
  const questions: MathQuestion[] = Array.from({ length: 40 }, (_, i) => {
    const id = `q40-${i + 1}`;
    const level = levels[Math.floor(i / 10)];
    const topic = topics[i % topics.length];
    const correctIdx = i % 4;
    const rawStem = `Câu thử nghiệm #${i + 1}: Giải phương trình $\\frac{x^2 - ${i + 1}}{\\sqrt{x + 2}} = -${i + 3}$ với $\\lim_{t \\to 0} t_n = 0$ và $\\vec{u}_{${i + 1}} = (${i + 1}; -2; 3)$.`;
    const optStrings = [
      `$x = -\\frac{${i + 1}}{2}$`,
      `$x = \\sqrt{${i + 5}}$`,
      `$x = \\log_2(${i + 3})$`,
      `$x = \\int_0^1 t^{${i + 1}}\\,dt$`,
    ];
    const options = optStrings.map((s, idx) => ({
      id: `${id}-opt-${idx + 1}`,
      originalLabel: (['A', 'B', 'C', 'D'] as const)[idx],
      content: parseMathContent(s, `${id}-o${idx}`),
      isCorrect: idx === correctIdx,
    }));

    return {
      id,
      code: `C-${String(i + 1).padStart(2, '0')}`,
      sectionTitle: MATH_SECTION_TITLES.mcq,
      type: 'mcq',
      topic,
      cognitiveLevel: level,
      difficultyScore: ((Math.floor(i / 10) + 1) as 1 | 2 | 3 | 4),
      points: 0.25,
      stem: parseMathContent(rawStem, `${id}-stem`),
      options,
      correctOptionId: options[correctIdx].id,
      solutionGuide: parseMathContent(`Đáp án đúng có giá trị ${optStrings[correctIdx]}`),
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      hasVisualAsset: false,
      answerConfirmed: true,
      createdAt: '2025-10-15T08:00:00.000Z',
      updatedAt: '2025-10-15T08:00:00.000Z',
    };
  });

  return {
    ...structuredClone(DEMO_MATH_EXAM),
    id: 'test-exam-40',
    title: 'Đề kiểm tra 40 câu trắc nghiệm Toán',
    questions,
    questionGroups: [],
    confirmedOriginalAnswers: true,
    mixConfig: {
      ...structuredClone(DEMO_MATH_EXAM.mixConfig),
      level: 2,
      examCount: 4,
      startCodeNumber: 101,
      seed: 'unit-test-40-seed',
    },
  };
}

test('Stage 3: 40-question MCQ exam produces 4 distinct exam codes with 0 duplicate questions and exact ID-mapped answers', () => {
  const exam = make40McqExam();
  const result = generateMixedExams(exam);

  assert.equal(result.errors.length, 0);
  assert.equal(result.versions.length, 4);
  assert.deepEqual(
    result.versions.map((v) => v.code),
    ['101', '102', '103', '104']
  );

  const orderSignatures = new Set<string>();
  for (const version of result.versions) {
    assert.equal(version.integrityPassed, true);
    assert.equal(version.questions.length, 40);

    const seenQIds = new Set(version.questions.map((q) => q.id));
    assert.equal(seenQIds.size, 40, 'Mỗi mã đề phải đủ 40 câu không trùng');

    orderSignatures.add(version.questions.map((q) => q.id).join(','));

    // Kiểm tra từng câu đáp án mới khớp tuyệt đối với ID đáp án gốc
    version.questions.forEach((mq, idx) => {
      const orig = exam.questions.find((o) => o.id === mq.id)!;
      assert.equal(mq.stem.rawSource, orig.stem.rawSource, 'Không được thay đổi đề bài hay LaTeX');

      const correctOptIdx = mq.options!.findIndex((o) => o.id === orig.correctOptionId);
      assert.ok(correctOptIdx >= 0 && correctOptIdx < 4);
      const expectedLabel = (['A', 'B', 'C', 'D'] as const)[correctOptIdx];
      assert.equal(version.permutationMap[idx].newCorrectLabel, expectedLabel);
      assert.equal(version.answerKeyRows[idx].answer, expectedLabel);

      // Bảo toàn nội dung từng phương án
      mq.options!.forEach((opt) => {
        const origOpt = orig.options!.find((o) => o.id === opt.id)!;
        assert.equal(opt.content.rawSource, origOpt.content.rawSource);
        assert.equal(opt.isCorrect, origOpt.isCorrect);
      });
    });
  }

  assert.equal(orderSignatures.size, 4, '4 mã đề phải có thứ tự hoán vị khác nhau');
});

test('Stage 3: Dependent MCQ options ("Cả A và B", "Tất cả đáp án trên") are flagged and never shuffled', () => {
  const base = structuredClone(DEMO_MATH_EXAM);
  const depQ = base.questions.find((q) => q.id === 'mq-demo-10')!;
  const detected = detectDependentOptions(depQ.options!);
  assert.ok(detected.length > 0);

  // Thử bỏ cờ lockOptionShuffle thủ công để kiểm tra engine tự bảo vệ
  depQ.lockOptionShuffle = false;
  // Thêm một câu chứa "Tất cả các đáp án trên"
  const extraDepQ: MathQuestion = {
    ...structuredClone(depQ),
    id: 'mq-dep-extra',
    code: 'VD-EXTRA',
    lockOptionShuffle: false,
    options: [
      { id: 'ex-1', originalLabel: 'A', content: parseMathContent('$x = 1$'), isCorrect: false },
      { id: 'ex-2', originalLabel: 'B', content: parseMathContent('$x = 2$'), isCorrect: false },
      { id: 'ex-3', originalLabel: 'C', content: parseMathContent('$x = 3$'), isCorrect: false },
      { id: 'ex-4', originalLabel: 'D', content: parseMathContent('Tất cả các đáp án trên đều đúng'), isCorrect: true },
    ],
    correctOptionId: 'ex-4',
  };
  base.questions.push(extraDepQ);
  base.mixConfig.level = 2;
  base.mixConfig.examCount = 4;

  const result = generateMixedExams(base);
  assert.equal(result.errors.length, 0);

  for (const v of result.versions) {
    assert.equal(v.integrityPassed, true);
    for (const targetId of ['mq-demo-10', 'mq-dep-extra']) {
      const origQ = base.questions.find((q) => q.id === targetId)!;
      const mixedQ = v.questions.find((q) => q.id === targetId)!;
      assert.deepEqual(
        mixedQ.options!.map((o) => o.id),
        origQ.options!.map((o) => o.id),
        `Câu phụ thuộc ${targetId} phải giữ nguyên thứ tự A/B/C/D`
      );
    }
  }
});

test('Stage 3: True/False statements shuffle only when independent & enabled, and block when cross-referencing', () => {
  const exam = structuredClone(DEMO_MATH_EXAM);
  exam.mixConfig.level = 4;
  exam.mixConfig.shuffleQuestions = true;
  exam.mixConfig.shuffleMcqOptions = true;
  exam.mixConfig.shuffleIndependentTrueFalseStatements = true;

  // Cho phép cả 2 câu Đúng/Sai bật allowStatementShuffle để kiểm tra bộ chặn phụ thuộc cho DS-02
  const tf1 = exam.questions.find((q) => q.id === 'tf-demo-01')!;
  const tf2 = exam.questions.find((q) => q.id === 'tf-demo-02')!;
  tf1.allowStatementShuffle = true;
  tf2.allowStatementShuffle = true;

  assert.equal(detectDependentStatements(tf1.statements!).length, 0);
  assert.ok(detectDependentStatements(tf2.statements!).length > 0);

  const result = generateMixedExams(exam);
  assert.equal(result.errors.length, 0);

  for (const v of result.versions) {
    assert.equal(v.integrityPassed, true);
    const mixedTf2 = v.questions.find((q) => q.id === 'tf-demo-02')!;
    assert.deepEqual(
      mixedTf2.statements!.map((s) => s.id),
      tf2.statements!.map((s) => s.id),
      'DS-02 có câu tham chiếu "Từ ý a" nên không được phép đảo ý'
    );

    const mixedTf1 = v.questions.find((q) => q.id === 'tf-demo-01')!;
    const tf1Map = v.permutationMap.find((m) => m.questionId === 'tf-demo-01')!;
    assert.ok(tf1Map.statementPermutation);
    mixedTf1.statements!.forEach((st, idx) => {
      const origSt = tf1.statements!.find((s) => s.id === st.id)!;
      assert.equal(st.isTrue, origSt.isTrue);
      assert.equal(tf1Map.statementPermutation![idx].isTrue, origSt.isTrue);
      assert.equal(tf1Map.statementPermutation![idx].statementId, origSt.id);
    });
  }
});

test('Stage 3: Locked questions and keepVdcPositions preserve exact position', () => {
  const exam = make40McqExam();
  // Khóa câu 1 (idx 0) và câu 15 (idx 14), đồng thời bật keepVdcPositions (câu 31..40)
  exam.questions[0].lockQuestionPosition = true;
  exam.mixConfig.lockedQuestionIds = [exam.questions[14].id];
  exam.mixConfig.level = 4;
  exam.mixConfig.shuffleQuestions = true;
  exam.mixConfig.shuffleMcqOptions = true;
  exam.mixConfig.keepVdcPositions = true;
  exam.mixConfig.examCount = 4;

  const result = generateMixedExams(exam);
  assert.equal(result.errors.length, 0);

  for (const v of result.versions) {
    assert.equal(v.integrityPassed, true);
    assert.equal(v.questions[0].id, exam.questions[0].id, 'Câu khóa #1 phải giữ nguyên vị trí 1');
    assert.equal(v.questions[14].id, exam.questions[14].id, 'Câu khóa #15 phải giữ nguyên vị trí 15');
    for (let k = 30; k < 40; k++) {
      assert.equal(
        v.questions[k].id,
        exam.questions[k].id,
        `Câu VDC #${k + 1} phải giữ nguyên vị trí`
      );
    }
  }
});

test('Stage 3: Matrix mode (Level 3) preserves cognitive ratios and rejects shortfall without inventing questions', () => {
  const exam = make40McqExam();
  exam.mixConfig.level = 3;
  exam.mixConfig.examCount = 3;
  exam.mixConfig.matrixRules = [
    { id: 'm1', type: 'mcq', topic: 'Tất cả', cognitiveLevel: 'nhan-biet', count: 4 },
    { id: 'm2', type: 'mcq', topic: 'Tất cả', cognitiveLevel: 'thong-hieu', count: 4 },
    { id: 'm3', type: 'mcq', topic: 'Tất cả', cognitiveLevel: 'van-dung', count: 3 },
    { id: 'm4', type: 'mcq', topic: 'Tất cả', cognitiveLevel: 'van-dung-cao', count: 1 },
  ];

  const okRes = generateMixedExams(exam);
  assert.equal(okRes.errors.length, 0);
  assert.equal(okRes.versions.length, 3);
  for (const v of okRes.versions) {
    assert.equal(v.questions.length, 12);
    assert.equal(v.questions.filter((q) => q.cognitiveLevel === 'nhan-biet').length, 4);
    assert.equal(v.questions.filter((q) => q.cognitiveLevel === 'thong-hieu').length, 4);
    assert.equal(v.questions.filter((q) => q.cognitiveLevel === 'van-dung').length, 3);
    assert.equal(v.questions.filter((q) => q.cognitiveLevel === 'van-dung-cao').length, 1);
  }

  // Giả lập ma trận đòi 25 câu Nhận biết (ngân hàng chỉ có 10) -> phải báo lỗi thiếu câu, không bịa câu
  exam.mixConfig.matrixRules[0].count = 25;
  const failRes = generateMixedExams(exam);
  assert.ok(failRes.errors.length > 0);
  assert.equal(failRes.versions.length, 0);
  assert.match(failRes.errors[0], /Thiếu câu cho ma trận/i);

  // buildDefaultMatrixRules helper
  const defaultRules = buildDefaultMatrixRules(DEMO_MATH_EXAM.questions);
  const sumDefault = defaultRules.reduce((s, r) => s + r.count, 0);
  assert.equal(sumDefault, DEMO_MATH_EXAM.questions.length);
});

test('Stage 1/3: LaTeX formulas remain byte-for-byte identical after shuffle & Integrity Verifier catches mutation', () => {
  const exam = structuredClone(DEMO_MATH_EXAM);
  exam.mixConfig.level = 2;
  exam.mixConfig.examCount = 2;

  const result = generateMixedExams(exam);
  assert.equal(result.errors.length, 0);
  const v1 = result.versions[0];
  assert.equal(v1.integrityPassed, true);

  // Kiểm tra hệ phương trình \begin{cases} và tích phân \int giữ nguyên từng ký tự
  const sysOrig = exam.questions.find((q) => q.id === 'mq-demo-06')!;
  const sysMixed = v1.questions.find((q) => q.id === 'mq-demo-06')!;
  assert.equal(sysMixed.stem.rawSource, sysOrig.stem.rawSource);
  assert.ok(sysMixed.stem.rawSource.includes('\\begin{cases} 2x + y = 5 \\\\ x - y = 1 \\end{cases}'));

  // Cố tình làm hỏng 1 dấu trừ trong bản trộn để kiểm tra verifyMixedExamIntegrity bắt lỗi
  const tampered = structuredClone(v1);
  const targetIdx = tampered.questions.findIndex((q) => q.id === 'mq-demo-06');
  tampered.questions[targetIdx].stem.rawSource = tampered.questions[targetIdx].stem.rawSource.replace('x - y = 1', 'x + y = 1');

  const verifyTampered = verifyMixedExamIntegrity(exam, tampered);
  assert.equal(verifyTampered.passed, false);
  assert.ok(verifyTampered.issues.some((i) => i.severity === 'error'));
});

import {
  detectClipboardMathArtifacts,
  parseLatexExamText,
} from './mathTextParser';

test('Stage 1/3: Duplicate exam codes & unbalanced LaTeX delimiters are properly caught', () => {
  const exam = structuredClone(DEMO_MATH_EXAM);
  exam.mixConfig.examCount = 3;
  exam.mixConfig.customCodeNames = ['101', '102', '101'];

  const issues = validateMixConfiguration(exam);
  assert.ok(issues.some((i) => i.id === 'mix-dup-codes' && i.severity === 'error'));

  const latexWarnings = checkLatexSyntaxWarnings('Giải $x = \\frac{1}{2');
  assert.ok(latexWarnings.length > 0);

  const emptyExam: MathExamProject = {
    ...structuredClone(DEMO_MATH_EXAM),
    questions: [],
  };
  const emptyIssues = auditOriginalExamIntegrity(emptyExam);
  assert.ok(emptyIssues.some((i) => i.id === 'exam-empty' && i.severity === 'error'));
});

test('Stage 2: LaTeX exam block parser preserves formulas & detects Word OMML/glyph artifacts', () => {
  const raw = `Câu 1: Tính tích phân $I = \\int_0^1 \\frac{x}{x^2+1}\\,dx$.
A. $\\frac{1}{2}\\ln 2$
B. $\\ln 2$
C. $\\sqrt{2}$
D. $-\\frac{1}{2}$
Đáp án: A

Câu 2: Cả A và B thử nghiệm
A. $x = 1$
B. $x = 2$
C. Cả A và B đều đúng
D. $x = 0$
Đáp án: C`;

  let counter = 0;
  const parsed = parseLatexExamText(raw, (p) => `${p}-${++counter}`);
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.hasSuspiciousOmmlArtifacts, false);
  assert.equal(parsed.questions[0].stem.rawSource.includes('\\int_0^1 \\frac{x}{x^2+1}\\,dx'), true);
  assert.equal(parsed.questions[0].correctOptionId, parsed.questions[0].options![0].id);
  assert.equal(parsed.questions[1].lockOptionShuffle, true, 'Phát hiện "Cả A và B" khi dán văn bản');

  const ommlWarnings = detectClipboardMathArtifacts('Câu 1: Giải <m:oMath><m:f></m:f></m:oMath> hoặc ký tự \uFFFD');
  assert.equal(ommlWarnings.length, 2);
});

// =========================================================================
// MATH SAFETY ENGINE — 12 BÀI KIỂM THỬ BẮT BUỘC (MATH LOCK + INTEGRITY)
// =========================================================================

test('Safety #1: Khóa vị trí câu số 5 -> câu này giữ nguyên vị trí #5 ở cả 10 mã đề', () => {
  const exam = make40McqExam();
  exam.questions[4].lockQuestionPosition = true;
  exam.mixConfig.level = 2;
  exam.mixConfig.examCount = 10;

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  assert.equal(res.versions.length, 10);

  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    assert.equal(ver.integrityStatus, 'PASS');
    assert.equal(
      ver.questions[4].id,
      exam.questions[4].id,
      `Mã ${ver.code} phải giữ câu #5 ở đúng chỉ số index 4`
    );
    assert.equal(ver.permutationMap[4].lockedPositionApplied, true);
  }
});

test('Safety #2: Khóa phương án B của câu trắc nghiệm -> phương án B luôn đứng tại slot B ở mọi mã đề', () => {
  const exam = make40McqExam();
  const targetQ = exam.questions[2];
  const lockedBId = targetQ.options![1].id;
  targetQ.options![1].lockPosition = true;
  exam.mixConfig.level = 2;
  exam.mixConfig.examCount = 10;

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);

  const slotsOfA = new Set<number>();
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const mq = ver.questions.find((q) => q.id === targetQ.id)!;
    assert.equal(
      mq.options![1].id,
      lockedBId,
      `Phương án B của ${targetQ.code} phải đứng yên ở vị trí index 1`
    );
    slotsOfA.add(mq.options!.findIndex((o) => o.id === targetQ.options![0].id));
  }
  assert.ok(slotsOfA.size >= 2, 'Các phương án không khóa A/C/D vẫn phải được trộn');
});

test('Safety #3: Khóa 2 phương án (B và D) -> chỉ 2 phương án còn lại (A và C) hoán vị giữa slot 0 và 2', () => {
  const exam = make40McqExam();
  const targetQ = exam.questions[1];
  const origA = targetQ.options![0].id;
  const origB = targetQ.options![1].id;
  const origC = targetQ.options![2].id;
  const origD = targetQ.options![3].id;

  targetQ.options![1].lockPosition = true; // Khóa B (index 1)
  targetQ.options![3].lockPosition = true; // Khóa D (index 3)
  exam.mixConfig.level = 2;
  exam.mixConfig.examCount = 8;

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);

  const acOrders = new Set<string>();
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const mq = ver.questions.find((q) => q.id === targetQ.id)!;
    assert.equal(mq.options![1].id, origB);
    assert.equal(mq.options![3].id, origD);
    assert.ok(
      (mq.options![0].id === origA && mq.options![2].id === origC) ||
        (mq.options![0].id === origC && mq.options![2].id === origA),
      'Chỉ A và C được phép đổi chỗ giữa vị trí 0 và 2'
    );
    acOrders.add(`${mq.options![0].id}-${mq.options![2].id}`);
  }
  assert.equal(acOrders.size, 2, 'Cả 2 hoán vị (A,C) và (C,A) phải xuất hiện qua 8 mã đề');
});

test('Safety #4: Nhóm 3 câu hỏi liền kề (QuestionGroup) -> không bị tách rời, giữ nguyên thứ tự nội bộ', () => {
  const exam = make40McqExam();
  const groupIds = [exam.questions[6].id, exam.questions[7].id, exam.questions[8].id];
  groupIds.forEach((qid) => {
    const q = exam.questions.find((item) => item.id === qid)!;
    q.groupId = 'grp-3-test';
  });

  const grp: QuestionGroup = {
    id: 'grp-3-test',
    title: 'Nhóm bài toán đồ thị 3 câu',
    sharedContext: parseMathContent('Cho đồ thị hàm số $y = f(x)$ như hình vẽ.'),
    sharedAssets: [
      createMathVisualAsset({
        id: 'grp3-svg',
        kind: 'variation-table',
        label: 'Bảng biến thiên dùng chung nhóm 3 câu',
        sourceData: PRESET_VARIATION_TABLE_SVG,
      }),
    ],
    questionIds: groupIds,
    lockGroupPosition: false,
    moveAsUnit: true,
  };
  exam.questionGroups = [grp];
  exam.mixConfig.level = 2;
  exam.mixConfig.examCount = 8;

  const resMoveUnit = generateMixedExams(exam);
  assert.equal(resMoveUnit.errors.length, 0);

  const groupStartPositions = new Set<number>();
  for (const ver of resMoveUnit.versions) {
    assert.equal(ver.integrityPassed, true);
    const idxs = groupIds.map((id) => ver.questions.findIndex((q) => q.id === id));
    assert.equal(idxs[1], idxs[0] + 1, 'Câu 2 của nhóm phải đứng ngay sau câu 1');
    assert.equal(idxs[2], idxs[0] + 2, 'Câu 3 của nhóm phải đứng ngay sau câu 2');
    groupStartPositions.add(idxs[0]);
  }
  assert.ok(groupStartPositions.size > 1, 'Khi moveAsUnit=true nhóm di chuyển nguyên khối sang các vị trí khác');

  // Kiểm tra thêm trường hợp khóa cứng vị trí nhóm (lockGroupPosition = true)
  grp.lockGroupPosition = true;
  const resLockedGroup = generateMixedExams(exam);
  assert.equal(resLockedGroup.errors.length, 0);
  for (const ver of resLockedGroup.versions) {
    assert.equal(ver.integrityPassed, true);
    const idxs = groupIds.map((id) => ver.questions.findIndex((q) => q.id === id));
    assert.deepEqual(idxs, [6, 7, 8], 'Khi lockGroupPosition=true nhóm phải cố định tại [6, 7, 8]');
  }
});

test('Safety #5: Trộn câu Đúng/Sai (a, b, c, d) -> ánh xạ đúng chính xác theo statement.id', () => {
  const exam = structuredClone(DEMO_MATH_EXAM);
  const tf1 = exam.questions.find((q) => q.id === 'tf-demo-01')!;
  tf1.allowStatementShuffle = true;
  exam.mixConfig.level = 4;
  exam.mixConfig.shuffleQuestions = true;
  exam.mixConfig.shuffleMcqOptions = true;
  exam.mixConfig.shuffleIndependentTrueFalseStatements = true;
  exam.mixConfig.examCount = 8;

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);

  const tfPermutations = new Set<string>();
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const mixedTf1 = ver.questions.find((q) => q.id === 'tf-demo-01')!;
    const tfMap = ver.permutationMap.find((m) => m.questionId === 'tf-demo-01')!;
    const ansRow = ver.answerKeyRows.find((r) => r.questionId === 'tf-demo-01')!;
    assert.ok(tfMap.statementPermutation);

    const expectedSummary = mixedTf1
      .statements!.map((st, sIdx) => {
        const origSt = tf1.statements!.find((o) => o.id === st.id)!;
        assert.equal(st.isTrue, origSt.isTrue);
        assert.equal(tfMap.statementPermutation![sIdx].statementId, origSt.id);
        assert.equal(tfMap.statementPermutation![sIdx].isTrue, origSt.isTrue);
        const lbl = (['a', 'b', 'c', 'd'] as const)[sIdx];
        return `${lbl}:${origSt.isTrue ? 'Đ' : 'S'}`;
      })
      .join(' · ');

    assert.equal(ansRow.answer, expectedSummary);
    tfPermutations.add(mixedTf1.statements!.map((s) => s.id).join(','));
  }
  assert.ok(tfPermutations.size > 1, 'Các mệnh đề độc lập a/b/c/d phải được hoán vị giữa các mã đề');
});

test('Safety #6: Trộn câu chứa phân số, căn thức, tích phân -> không mất ký tự hoặc sai biểu thức', () => {
  const exam = make40McqExam();
  exam.questions[0].stem = parseMathContent(
    'Tính $I = \\int_{0}^{1} \\frac{\\sqrt{x^2 + 1} - 2x}{x^3 + 5}\\,dx + \\lim_{n \\to \\infty} \\frac{2^n - 1}{3^n}$ và $S = \\sum_{k=1}^{10} \\binom{10}{k}$.'
  );
  const expectedRaw = exam.questions[0].stem.rawSource;
  const expectedHash = computeContentHash(expectedRaw);
  exam.mixConfig.examCount = 6;

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const mixedQ = ver.questions.find((q) => q.id === exam.questions[0].id)!;
    assert.equal(mixedQ.stem.rawSource, expectedRaw);
    assert.equal(computeContentHash(mixedQ.stem.rawSource), expectedHash);
    assert.ok(mixedQ.stem.rawSource.includes('\\frac{\\sqrt{x^2 + 1} - 2x}{x^3 + 5}'));
    assert.ok(mixedQ.stem.rawSource.includes('\\int_{0}^{1}'));
  }
});

test('Safety #7: Trộn câu chứa hình vẽ hình học SVG & bảng biến thiên -> giữ nguyên hình & checksum ở mọi mã đề', () => {
  const exam = structuredClone(DEMO_MATH_EXAM);
  const pyramidAsset = createMathVisualAsset({
    id: 'asset-pyramid-test',
    kind: 'geometry-svg',
    label: 'Hình chóp S.ABCD kiểm thử',
    sourceData: PRESET_GEOMETRY_PYRAMID_SVG,
  });
  exam.questions[0].visualAssets = [pyramidAsset];
  exam.questions[0].hasVisualAsset = true;
  exam.mixConfig.examCount = 5;

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);

  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const mq0 = ver.questions.find((q) => q.id === exam.questions[0].id)!;
    assert.equal(mq0.visualAssets?.length, 1);
    assert.equal(mq0.visualAssets![0].sourceData, PRESET_GEOMETRY_PYRAMID_SVG);
    assert.equal(mq0.visualAssets![0].checksum, pyramidAsset.checksum);

    const mixedTf1 = ver.questions.find((q) => q.id === 'tf-demo-01')!;
    assert.equal(mixedTf1.visualAssets?.length, 1);
    assert.equal(mixedTf1.visualAssets![0].sourceData, PRESET_VARIATION_TABLE_SVG);
  }
});

test('Safety #8: Trộn đề 40 câu thành 20 mã đề -> tất cả 20 mã đạt kiểm chứng và ánh xạ đáp án chính xác', () => {
  const exam = make40McqExam();
  exam.mixConfig.level = 2;
  exam.mixConfig.examCount = 20;
  exam.mixConfig.startCodeNumber = 201;

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  assert.equal(res.versions.length, 20);

  const uniqueOrders = new Set<string>();
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    assert.equal(ver.integrityStatus, 'PASS');
    assert.equal(ver.integrityReport?.canExport, true);
    assert.equal(ver.questions.length, 40);
    assert.equal(new Set(ver.questions.map((q) => q.id)).size, 40);
    uniqueOrders.add(ver.questions.map((q) => q.id).join(','));

    ver.questions.forEach((mq, idx) => {
      const orig = exam.questions.find((o) => o.id === mq.id)!;
      const correctSlot = mq.options!.findIndex((o) => o.id === orig.correctOptionId);
      const lbl = (['A', 'B', 'C', 'D'] as const)[correctSlot];
      assert.equal(ver.answerKeyRows[idx].answer, lbl);
    });
  }
  assert.equal(uniqueOrders.size, 20, 'Tất cả 20 mã đề phải có hoán vị khác nhau');
});

test('Safety #9: Cố tình làm thay đổi ký tự/dấu công thức sau trộn -> Integrity Check BLOCKED và chặn xuất đề', () => {
  const exam = structuredClone(DEMO_MATH_EXAM);
  exam.mixConfig.examCount = 2;
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  const snapshot = createOriginalExamSnapshot(exam);

  const tampered = structuredClone(res.versions[0]);
  const target = tampered.questions.find((q) => q.id === 'mq-demo-07')!;
  target.stem.rawSource = target.stem.rawSource.replace('\\frac{3}{5}', '\\frac{4}{5}');

  const verify = verifyMixedExamIntegrity(exam, tampered, snapshot);
  assert.equal(verify.passed, false);
  assert.equal(verify.status, 'BLOCKED');
  assert.equal(verify.report.canExport, false);
  assert.ok(verify.issues.some((i) => i.tier === 'BLOCKED' && i.scope === 'latex'));
});

test('Safety #10: Cố tình làm thiếu/hỏng tài nguyên hình vẽ hoặc bảng biến thiên -> Integrity Check BLOCKED', () => {
  const exam = structuredClone(DEMO_MATH_EXAM);
  exam.mixConfig.examCount = 2;
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  const snapshot = createOriginalExamSnapshot(exam);

  // Trường hợp A: mất tài nguyên ở bản sau trộn
  const assetDropped = structuredClone(res.versions[0]);
  const tfMixed = assetDropped.questions.find((q) => q.id === 'tf-demo-01')!;
  tfMixed.visualAssets = [];

  const verifyDropped = verifyMixedExamIntegrity(exam, assetDropped, snapshot);
  assert.equal(verifyDropped.passed, false);
  assert.equal(verifyDropped.status, 'BLOCKED');
  assert.equal(verifyDropped.report.canExport, false);
  assert.ok(verifyDropped.issues.some((i) => i.scope === 'asset' && i.tier === 'BLOCKED'));

  // Trường hợp B: thiếu dữ liệu nguồn trên đề gốc trước khi trộn -> chặn ngay từ Pre-Mix
  const brokenOrig = structuredClone(DEMO_MATH_EXAM);
  const tfOrig = brokenOrig.questions.find((q) => q.id === 'tf-demo-01')!;
  tfOrig.visualAssets![0].sourceData = '';
  const preReport = evaluatePreMixIntegrity(brokenOrig);
  assert.equal(preReport.status, 'BLOCKED');
  assert.equal(preReport.canExport, false);
});

test('Safety #11: Tạo xung đột khóa hoặc khóa toàn bộ vượt giới hạn hoán vị -> hệ thống phát hiện và chặn rõ ràng', () => {
  // Xung đột A: Nhóm câu hỏi di chuyển nguyên khối nhưng câu thành viên lại khóa vị trí
  const examConflict = structuredClone(DEMO_MATH_EXAM);
  examConflict.questions.find((q) => q.id === 'mq-demo-13')!.lockQuestionPosition = true;
  const grpIssues = detectLockConflictsAndCapacity(examConflict);
  assert.ok(grpIssues.some((i) => i.tier === 'BLOCKED' && i.scope === 'lock'));

  const resConflict = generateMixedExams(examConflict);
  assert.equal(resConflict.versions.length, 0);
  assert.ok(resConflict.errors.some((e) => /Mâu thuẫn khóa/i.test(e)));

  // Xung đột B: Khóa tất cả câu + khóa tất cả phương án nhưng yêu cầu tạo 5 mã đề
  const examOverLocked = make40McqExam();
  examOverLocked.questions.forEach((q) => {
    q.lockQuestionPosition = true;
    q.lockOptionShuffle = true;
  });
  examOverLocked.mixConfig.examCount = 5;
  const capIssues = validateMixConfiguration(examOverLocked);
  assert.ok(capIssues.some((i) => i.id === 'lock-insufficient-permutations' && i.tier === 'BLOCKED'));

  const resOverLocked = generateMixedExams(examOverLocked);
  assert.equal(resOverLocked.versions.length, 0);
  assert.ok(resOverLocked.errors.length > 0);
});

test('Safety #12: Tương thích dữ liệu cũ TeacherOS 4.0 IndexedDB v4 & sao lưu khứ hồi', () => {
  // Giả lập bản ghi cũ chưa có trường questionGroups, visualAssets, option.lockPosition
  const legacyRaw = structuredClone(DEMO_MATH_EXAM) as unknown as Record<string, unknown>;
  delete legacyRaw.questionGroups;
  const legacyQuestions = (legacyRaw.questions as Array<Record<string, unknown>>).map((q) => {
    const copy = { ...q };
    delete copy.visualAssets;
    delete copy.groupId;
    return copy;
  });
  legacyRaw.questions = legacyQuestions;

  const normalized = normalizeMathExamProject(legacyRaw as unknown as MathExamProject);
  assert.deepEqual(normalized.questionGroups, []);
  assert.equal(normalized.questions.length, DEMO_MATH_EXAM.questions.length);
  assert.ok(normalized.questions.every((q) => Array.isArray(q.visualAssets)));

  const preCheck = evaluatePreMixIntegrity(DEMO_MATH_EXAM);
  assert.equal(preCheck.canExport, true);
  assert.ok(preCheck.categories.length === 6);

  // Kiểm tra sao lưu JSON bao gồm mathExams hoạt động khứ hồi không mất dữ liệu
  const backupPayload = createBackupPayload([], DEFAULT_PRINT_SETTINGS, {
    mathExams: [DEMO_MATH_EXAM],
  });
  const validated = validateBackupPayload(JSON.stringify(backupPayload));
  assert.equal(validated.valid, true);
  assert.equal(validated.payload?.mathExams?.length, 1);
  assert.equal(validated.payload?.mathExams?.[0].questionGroups?.length, 1);
});

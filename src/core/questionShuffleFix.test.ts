import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  MathExamProject,
  MathQuestion,
  QuestionGroup,
} from '../types/mathExam';
import {
  parseMathContent,
  createMathVisualAsset,
  resolveEffectiveMixFlags,
} from './mathIntegrity';
import {
  analyzeQuestionShuffleEligibility,
  applyMixLevelPreset,
  applyMixToggleUpdate,
  buildVersionQuestionOrderSignature,
  generateMixedExams,
  generateMixedExamsAsync,
} from './mathShuffleEngine';
import {
  buildAnswerKeyDocxBuffer,
  buildConsolidatedAnswerCsv,
  buildStudentExamDocxBuffer,
  exportMixedExamZipBundle,
  verifyExportedDocxBuffer,
} from './examExportEngine';
import { extractDocxDocument } from './ooxmlParser';
import { parseLatexExamText } from './mathTextParser';

function makeMcqQuestion(
  idx: number,
  overrides?: Partial<MathQuestion>
): MathQuestion {
  const id = `q-${idx}`;
  const correctIdx = (idx - 1) % 4;
  const labels = ['A', 'B', 'C', 'D'] as const;
  const options = labels.map((lbl, oIdx) => ({
    id: `${id}-opt-${lbl}`,
    originalLabel: lbl,
    content: parseMathContent(
      `Giá trị đặc trưng câu ${idx} phương án ${lbl}: $x = ${idx * 10 + oIdx}$`,
      `${id}-o-${lbl}`
    ),
    isCorrect: oIdx === correctIdx,
    lockPosition: false,
  }));

  return {
    id,
    code: `M-${String(idx).padStart(2, '0')}`,
    sectionTitle: 'Phần I. Trắc nghiệm nhiều lựa chọn',
    type: 'mcq',
    universalType: 'mcq',
    subjectId: 'toan',
    topic: 'Hàm số',
    cognitiveLevel: idx % 4 === 0 ? 'van-dung-cao' : 'thong-hieu',
    difficultyScore: idx % 4 === 0 ? 4 : 2,
    points: 0.5,
    stem: parseMathContent(
      `[STEM-${idx}] Tính giá trị biểu thức $f_${idx}(x) = ${idx}x^2 - ${idx + 1}x + 1$ tại $x = 2$.`,
      `${id}-stem`
    ),
    options,
    correctOptionId: options[correctIdx].id,
    solutionGuide: parseMathContent(`Lời giải chuẩn cho câu ${idx}.`, `${id}-sol`),
    lockQuestionPosition: false,
    lockOptionShuffle: false,
    allowStatementShuffle: false,
    dependencyFlags: [],
    hasVisualAsset: false,
    answerConfirmed: true,
    visualAssets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBaseExam(
  questions: MathQuestion[],
  overrides?: Partial<MathExamProject>
): MathExamProject {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'exam-shuffle-fix-test',
    title: 'Đề kiểm tra hồi quy đảo câu hỏi',
    subject: 'Toán học',
    subjectId: 'toan',
    grade: 'Lớp 12',
    durationMinutes: 45,
    schoolYear: '2025–2026',
    examTypeLabel: 'Kiểm tra giữa kỳ',
    schemaVersion: '6.0',
    status: 'draft',
    isDemo: false,
    lastStep: 1,
    confirmedOriginalAnswers: true,
    questions,
    questionGroups: [],
    mixConfig: {
      level: 2,
      examCount: 4,
      startCodeNumber: 101,
      customCodeNames: ['101', '102', '103', '104'],
      seed: 'regression-seed-2026',
      shuffleQuestions: true,
      shuffleMcqOptions: true,
      keepVdcPositions: false,
      preserveTopicRatios: false,
      shufflePerSectionOnly: true,
      shuffleIndependentTrueFalseStatements: false,
      keepDependentGroups: true,
      lockedQuestionIds: [],
      matrixRules: [],
    },
    generatedVersions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function getOrderIds(questions: ReadonlyArray<Pick<MathQuestion, 'id'>>): string[] {
  return questions.map((q) => q.id);
}

// ============================================================================
// TEST 1: Questions-only shuffle (Questions ON, Options OFF)
// ============================================================================
test('TEST 1: Questions-only shuffle moves real question IDs across codes while preserving A/B/C/D option order', () => {
  const questions = Array.from({ length: 12 }, (_, i) => makeMcqQuestion(i + 1));
  const exam = makeBaseExam(questions);
  exam.mixConfig = applyMixToggleUpdate(exam.mixConfig, {
    shuffleQuestions: true,
    shuffleMcqOptions: false,
  });

  const origOrder = buildVersionQuestionOrderSignature(exam.questions);
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  assert.equal(res.versions.length, 4);

  const uniqueOrders = new Set<string>();
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const sig = buildVersionQuestionOrderSignature(ver.questions);
    assert.notEqual(sig, origOrder, `Mã ${ver.code} phải khác thứ tự đề gốc`);
    uniqueOrders.add(sig);

    // Every question must preserve exact original option order & correct answer mapping
    ver.questions.forEach((mq, idx) => {
      const origQ = exam.questions.find((q) => q.id === mq.id)!;
      assert.deepEqual(
        mq.options!.map((o) => o.id),
        origQ.options!.map((o) => o.id),
        `Mã ${ver.code} Câu ${idx + 1} không được đảo phương án khi tắt Đảo phương án`
      );
      const expectedLetter = ['A', 'B', 'C', 'D'][
        origQ.options!.findIndex((o) => o.id === origQ.correctOptionId)
      ];
      assert.equal(ver.answerKeyRows[idx].answer, expectedLetter);
      assert.equal(ver.permutationMap[idx].questionId, origQ.id);
    });
  }
  assert.equal(uniqueOrders.size, 4, 'Cả 4 mã đề phải có 4 thứ tự câu hỏi khác nhau');
});

// ============================================================================
// TEST 2: Options-only shuffle (Questions OFF, Options ON)
// ============================================================================
test('TEST 2: Options-only shuffle keeps exact original question order while shuffling options and updating answer key', () => {
  const questions = Array.from({ length: 10 }, (_, i) => makeMcqQuestion(i + 1));
  const exam = makeBaseExam(questions);
  exam.mixConfig = applyMixToggleUpdate(exam.mixConfig, {
    shuffleQuestions: false,
    shuffleMcqOptions: true,
  });

  const origOrder = getOrderIds(exam.questions);
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  assert.equal(res.versions.length, 4);

  let totalOptionsMoved = 0;
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    assert.deepEqual(
      getOrderIds(ver.questions),
      origOrder,
      `Mã ${ver.code} phải giữ nguyên 100% thứ tự câu hỏi gốc`
    );

    ver.questions.forEach((mq, idx) => {
      const origQ = exam.questions[idx];
      const origOptOrder = origQ.options!.map((o) => o.id).join(',');
      const mixedOptOrder = mq.options!.map((o) => o.id).join(',');
      if (origOptOrder !== mixedOptOrder) totalOptionsMoved += 1;

      const newCorrectIdx = mq.options!.findIndex((o) => o.id === origQ.correctOptionId);
      assert.ok(newCorrectIdx >= 0);
      assert.equal(ver.answerKeyRows[idx].answer, ['A', 'B', 'C', 'D'][newCorrectIdx]);
    });
  }
  assert.ok(totalOptionsMoved > 0, 'Phương án A/B/C/D phải thực sự bị đảo');
});

// ============================================================================
// TEST 3: Both ON (Questions ON, Options ON) — distinct question orders, NOT masked by option shuffle
// ============================================================================
test('TEST 3: Both toggles ON produces distinct non-identity question orders AND shuffled options across all codes', () => {
  const questions = Array.from({ length: 12 }, (_, i) => makeMcqQuestion(i + 1));
  const exam = makeBaseExam(questions);
  exam.mixConfig = applyMixToggleUpdate(exam.mixConfig, {
    shuffleQuestions: true,
    shuffleMcqOptions: true,
  });

  const origOrder = buildVersionQuestionOrderSignature(exam.questions);
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  assert.equal(res.versions.length, 4);

  const qOrderSet = new Set<string>();
  let anyOptionShuffled = false;

  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const sig = buildVersionQuestionOrderSignature(ver.questions);
    assert.notEqual(sig, origOrder, `Mã ${ver.code} không được trùng thứ tự câu đề gốc`);
    qOrderSet.add(sig);

    ver.questions.forEach((mq, idx) => {
      const origQ = exam.questions.find((q) => q.id === mq.id)!;
      if (
        mq.options!.map((o) => o.id).join(',') !== origQ.options!.map((o) => o.id).join(',')
      ) {
        anyOptionShuffled = true;
      }
      const newCorrectIdx = mq.options!.findIndex((o) => o.id === origQ.correctOptionId);
      assert.equal(ver.answerKeyRows[idx].answer, ['A', 'B', 'C', 'D'][newCorrectIdx]);
    });
  }

  assert.equal(qOrderSet.size, 4, '4 mã đề phải có 4 thứ tự originalQuestionId phân biệt');
  assert.equal(anyOptionShuffled, true, 'Phương án trả lời cũng phải được đảo');
});

// ============================================================================
// TEST 4: Both OFF (Questions OFF, Options OFF)
// ============================================================================
test('TEST 4: Both toggles OFF preserves original question order & option order without false capacity error', () => {
  const questions = Array.from({ length: 6 }, (_, i) => makeMcqQuestion(i + 1));
  const exam = makeBaseExam(questions);
  exam.mixConfig = applyMixToggleUpdate(exam.mixConfig, {
    shuffleQuestions: false,
    shuffleMcqOptions: false,
  });

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  assert.equal(res.versions.length, 4);

  const origOrder = getOrderIds(exam.questions);
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    assert.deepEqual(getOrderIds(ver.questions), origOrder);
    ver.questions.forEach((mq, idx) => {
      assert.deepEqual(
        mq.options!.map((o) => o.id),
        exam.questions[idx].options!.map((o) => o.id)
      );
    });
  }
});

// ============================================================================
// TEST 5: Atomic Question Block Integrity & Original Exam Immutability
// ============================================================================
test('TEST 5: Shuffling moves complete atomic question blocks (stem, LaTeX, assets, options, solution) and never mutates original exam', () => {
  const questions = Array.from({ length: 8 }, (_, i) => {
    const idx = i + 1;
    const asset = createMathVisualAsset({
      id: `asset-q-${idx}`,
      kind: 'geometry-svg',
      label: `Hình vẽ câu ${idx}`,
      sourceData: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><text x="5" y="20">Q${idx}</text></svg>`,
      required: true,
    });
    return makeMcqQuestion(idx, { visualAssets: [asset] });
  });

  const exam = makeBaseExam(questions);
  const beforeSnapshotJson = JSON.stringify(exam.questions);

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);

  // Original exam must remain 100% untouched
  assert.equal(JSON.stringify(exam.questions), beforeSnapshotJson);

  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    for (const mq of ver.questions) {
      const origQ = exam.questions.find((q) => q.id === mq.id)!;
      assert.equal(mq.stem.rawSource, origQ.stem.rawSource);
      assert.equal(mq.solutionGuide.rawSource, origQ.solutionGuide.rawSource);
      assert.equal(mq.visualAssets?.length, 1);
      assert.equal(mq.visualAssets?.[0].id, origQ.visualAssets?.[0].id);
      assert.equal(mq.visualAssets?.[0].checksum, origQ.visualAssets?.[0].checksum);
      assert.equal(mq.topic, origQ.topic);
      assert.equal(mq.points, origQ.points);
    }
  }
});

// ============================================================================
// TEST 6: Section Boundary Preservation
// ============================================================================
test('TEST 6: Per-section shuffling keeps sections strictly separated while reordering questions inside each section', () => {
  const sec1 = Array.from({ length: 5 }, (_, i) =>
    makeMcqQuestion(i + 1, { sectionTitle: 'Phần I. Trắc nghiệm' })
  );
  const sec2 = Array.from({ length: 4 }, (_, i) =>
    makeMcqQuestion(i + 6, {
      sectionTitle: 'Phần II. Trả lời ngắn',
      type: 'short-answer',
      universalType: 'short-answer',
      options: undefined,
      correctOptionId: undefined,
      shortAnswer: { answerValue: String((i + 6) * 2), unit: 'cm', acceptedFormats: [] },
    })
  );
  const sec3 = Array.from({ length: 3 }, (_, i) =>
    makeMcqQuestion(i + 10, {
      sectionTitle: 'Phần III. Tự luận',
      type: 'essay',
      universalType: 'essay',
      options: undefined,
      correctOptionId: undefined,
      essayParts: [
        {
          id: `ep-${i + 10}`,
          label: 'a)',
          points: 1,
          content: parseMathContent(`Chứng minh phần ${i + 10}`, `ep-c-${i}`),
          solutionOutline: parseMathContent('Đủ bước chứng minh', `ep-r-${i}`),
        },
      ],
    })
  );

  const exam = makeBaseExam([...sec1, ...sec2, ...sec3]);
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);

  const sec1Orders = new Set<string>();
  const sec2Orders = new Set<string>();
  const sec3Orders = new Set<string>();

  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const s1 = ver.questions.slice(0, 5);
    const s2 = ver.questions.slice(5, 9);
    const s3 = ver.questions.slice(9, 12);

    assert.ok(s1.every((q) => q.sectionTitle === 'Phần I. Trắc nghiệm'));
    assert.ok(s2.every((q) => q.sectionTitle === 'Phần II. Trả lời ngắn'));
    assert.ok(s3.every((q) => q.sectionTitle === 'Phần III. Tự luận'));

    sec1Orders.add(buildVersionQuestionOrderSignature(s1));
    sec2Orders.add(buildVersionQuestionOrderSignature(s2));
    sec3Orders.add(buildVersionQuestionOrderSignature(s3));
  }

  assert.ok(sec1Orders.size > 1, 'Phần I phải thực sự đảo câu nội bộ');
  assert.ok(sec2Orders.size > 1, 'Phần II phải thực sự đảo câu nội bộ');
  assert.ok(sec3Orders.size > 1, 'Phần III phải thực sự đảo câu nội bộ');
});

// ============================================================================
// TEST 7: Dependent / Shared-Context Group Atomicity
// ============================================================================
test('TEST 7: Dependent shared-context group moves as an atomic contiguous block preserving internal order', () => {
  const questions = Array.from({ length: 8 }, (_, i) => {
    const idx = i + 1;
    const isGroupMember = idx === 3 || idx === 4 || idx === 5;
    return makeMcqQuestion(idx, {
      groupId: isGroupMember ? 'grp-reading-1' : undefined,
    });
  });

  const group: QuestionGroup = {
    id: 'grp-reading-1',
    title: 'Đoạn đọc hiểu số 1 (Câu 3–5)',
    contextKind: 'passage',
    sharedContext: parseMathContent('Đoạn văn dùng chung cho 3 câu hỏi.', 'grp-ctx-1'),
    sharedAssets: [],
    questionIds: ['q-3', 'q-4', 'q-5'],
    lockGroupPosition: false,
    moveAsUnit: true,
    lockInternalQuestionOrder: true,
  };

  const exam = makeBaseExam(questions, { questionGroups: [group] });
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);

  const startPositions = new Set<number>();
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const ids = getOrderIds(ver.questions);
    const pos3 = ids.indexOf('q-3');
    const pos4 = ids.indexOf('q-4');
    const pos5 = ids.indexOf('q-5');
    assert.equal(pos4, pos3 + 1, 'q-4 phải đứng liền ngay sau q-3');
    assert.equal(pos5, pos4 + 1, 'q-5 phải đứng liền ngay sau q-4');
    startPositions.add(pos3);
  }
  assert.ok(startPositions.size >= 2, 'Cả nhóm phụ thuộc phải có thể di chuyển nguyên khối sang vị trí khác nhau');
});

// ============================================================================
// TEST 8: Question Position Lock (flag, lockedQuestionIds, universalLock, VDC)
// ============================================================================
test('TEST 8: Locked questions remain fixed at exact original indices while unlocked questions shuffle freely', () => {
  const questions = Array.from({ length: 10 }, (_, i) => {
    const idx = i + 1;
    return makeMcqQuestion(idx, {
      lockQuestionPosition: idx === 1,
      cognitiveLevel: idx === 10 ? 'van-dung-cao' : 'thong-hieu',
    });
  });
  // Also lock q-5 via universalLock.positionLock and q-7 via mixConfig.lockedQuestionIds
  questions[4].universalLock = {
    contentLocked: true,
    positionLock: true,
    groupLockMode: 'none',
    optionShuffleLock: false,
    lockedOptionIds: [],
    referenceLockReasons: [],
  };

  const exam = makeBaseExam(questions);
  exam.mixConfig = {
    ...applyMixToggleUpdate(exam.mixConfig, {
      shuffleQuestions: true,
      shuffleMcqOptions: true,
      keepVdcPositions: true,
    }),
    lockedQuestionIds: ['q-7'],
  };

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);

  const uniqueOrders = new Set<string>();
  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    const ids = getOrderIds(ver.questions);
    assert.equal(ids[0], 'q-1', 'Câu 1 bị khóa bằng lockQuestionPosition phải giữ nguyên vị trí 1');
    assert.equal(ids[4], 'q-5', 'Câu 5 bị khóa bằng universalLock.positionLock phải giữ nguyên vị trí 5');
    assert.equal(ids[6], 'q-7', 'Câu 7 bị khóa bằng lockedQuestionIds phải giữ nguyên vị trí 7');
    assert.equal(ids[9], 'q-10', 'Câu 10 VDC bị khóa bằng keepVdcPositions phải giữ nguyên vị trí 10');
    uniqueOrders.add(buildVersionQuestionOrderSignature(ver.questions));
  }
  assert.equal(uniqueOrders.size, 4, 'Các câu tự do còn lại vẫn phải đảo thành 4 thứ tự phân biệt');
});

// ============================================================================
// TEST 9: Insufficient independent questions warning & duplicate order warning
// ============================================================================
test('TEST 9: Reports "Không đủ câu độc lập để đảo" when unable to reorder and warns when examCount exceeds question permutations', () => {
  // Case A: All questions locked except 1
  const lockedQs = Array.from({ length: 4 }, (_, i) =>
    makeMcqQuestion(i + 1, { lockQuestionPosition: i < 3 })
  );
  const examA = makeBaseExam(lockedQs);
  const eligA = analyzeQuestionShuffleEligibility(examA);
  assert.equal(eligA.canChangeQuestionOrder, false);
  assert.equal(eligA.eligibleQuestions, 0);
  assert.ok(
    eligA.warnings.some((w) => w.includes('Không đủ câu độc lập để đảo')),
    'Phải cảnh báo rõ "Không đủ câu độc lập để đảo"'
  );

  // Case B: 3 independent questions -> 3! = 6 question order permutations, request 8 codes with options ON
  const smallQs = Array.from({ length: 3 }, (_, i) => makeMcqQuestion(i + 1));
  const examB = makeBaseExam(smallQs);
  examB.mixConfig = {
    ...examB.mixConfig,
    examCount: 8,
    customCodeNames: ['101', '102', '103', '104', '105', '106', '107', '108'],
  };
  const eligB = analyzeQuestionShuffleEligibility(examB);
  assert.equal(eligB.maxQuestionPermutations, 6);
  assert.ok(eligB.warnings.length > 0);

  const resB = generateMixedExams(examB);
  assert.equal(resB.errors.length, 0);
  assert.equal(resB.versions.length, 8);
  assert.ok(
    resB.versions.some((v) => Boolean(v.duplicateQuestionOrderWarning)),
    'Khi số mã vượt quá số hoán vị thứ tự câu (8 > 6), phải cảnh báo trùng thứ tự câu'
  );
});

// ============================================================================
// TEST 10: Deterministic Seed Reproducibility & Sync/Async Parity
// ============================================================================
test('TEST 10: Same seed yields identical question order & answer keys across sync and async runs; different seed changes order', async () => {
  const questions = Array.from({ length: 12 }, (_, i) => makeMcqQuestion(i + 1));
  const examA = makeBaseExam(questions);
  const sync1 = generateMixedExams(examA);
  const sync2 = generateMixedExams(examA);
  const async1 = await generateMixedExamsAsync(examA, { chunkSize: 2 });

  assert.equal(sync1.errors.length, 0);
  assert.equal(async1.errors.length, 0);

  for (let i = 0; i < 4; i++) {
    assert.deepEqual(
      getOrderIds(sync1.versions[i].questions),
      getOrderIds(sync2.versions[i].questions)
    );
    assert.deepEqual(
      getOrderIds(sync1.versions[i].questions),
      getOrderIds(async1.versions[i].questions)
    );
    assert.deepEqual(
      sync1.versions[i].answerKeyRows,
      async1.versions[i].answerKeyRows
    );
  }

  const examDifferentSeed = makeBaseExam(questions);
  examDifferentSeed.mixConfig.seed = 'another-seed-9999';
  const diffRes = generateMixedExams(examDifferentSeed);
  assert.notDeepEqual(
    getOrderIds(sync1.versions[0].questions),
    getOrderIds(diffRes.versions[0].questions),
    'Seed khác nhau phải tạo ra thứ tự câu khác nhau'
  );
});

// ============================================================================
// TEST 11: Multi-Type Answer Mapping Accuracy across moved questions
// ============================================================================
test('TEST 11: Answer mapping remains 100% accurate across MCQ, Multi-Select, True/False, Short Answer, Matching, and Ordering after shuffling', () => {
  const q1 = makeMcqQuestion(1, { sectionTitle: 'Phần chung' });
  const q2 = makeMcqQuestion(2, { sectionTitle: 'Phần chung' });
  const q3: MathQuestion = {
    ...makeMcqQuestion(3, { sectionTitle: 'Phần chung' }),
    universalType: 'multi-select',
    multiSelectOptions: [
      { id: 'ms-a', originalLabel: 'A', content: parseMathContent('Đúng 1', 'ms-a'), isCorrect: true },
      { id: 'ms-b', originalLabel: 'B', content: parseMathContent('Sai 1', 'ms-b'), isCorrect: false },
      { id: 'ms-c', originalLabel: 'C', content: parseMathContent('Đúng 2', 'ms-c'), isCorrect: true },
      { id: 'ms-d', originalLabel: 'D', content: parseMathContent('Sai 2', 'ms-d'), isCorrect: false },
    ],
    correctOptionIds: ['ms-a', 'ms-c'],
  };
  const q4: MathQuestion = {
    ...makeMcqQuestion(4, { sectionTitle: 'Phần chung' }),
    type: 'true-false',
    universalType: 'true-false',
    options: undefined,
    correctOptionId: undefined,
    allowStatementShuffle: true,
    statements: [
      { id: 'tf-a', originalLabel: 'a', content: parseMathContent('Mệnh đề 1', 'tf-a'), isTrue: true },
      { id: 'tf-b', originalLabel: 'b', content: parseMathContent('Mệnh đề 2', 'tf-b'), isTrue: false },
      { id: 'tf-c', originalLabel: 'c', content: parseMathContent('Mệnh đề 3', 'tf-c'), isTrue: true },
      { id: 'tf-d', originalLabel: 'd', content: parseMathContent('Mệnh đề 4', 'tf-d'), isTrue: false },
    ],
  };
  const q5: MathQuestion = {
    ...makeMcqQuestion(5, { sectionTitle: 'Phần chung' }),
    type: 'short-answer',
    universalType: 'matching',
    options: undefined,
    correctOptionId: undefined,
    matching: {
      leftItems: [
        { id: 'ml-1', originalLabel: '1', content: parseMathContent('H2O', 'ml-1') },
        { id: 'ml-2', originalLabel: '2', content: parseMathContent('NaCl', 'ml-2') },
      ],
      rightItems: [
        { id: 'mr-a', originalLabel: 'a', content: parseMathContent('Nước', 'mr-a') },
        { id: 'mr-b', originalLabel: 'b', content: parseMathContent('Muối ăn', 'mr-b') },
      ],
      correctPairs: [
        { id: 'mp-1', leftItemId: 'ml-1', rightItemId: 'mr-a' },
        { id: 'mp-2', leftItemId: 'ml-2', rightItemId: 'mr-b' },
      ],
      allowShuffleLeft: false,
      allowShuffleRight: true,
    },
  };
  const q6: MathQuestion = {
    ...makeMcqQuestion(6, { sectionTitle: 'Phần chung' }),
    type: 'short-answer',
    universalType: 'ordering',
    options: undefined,
    correctOptionId: undefined,
    ordering: {
      items: [
        { id: 'ord-1', originalLabel: 'a', content: parseMathContent('Bước 1', 'ord-1'), correctRank: 1 },
        { id: 'ord-2', originalLabel: 'b', content: parseMathContent('Bước 2', 'ord-2'), correctRank: 2 },
        { id: 'ord-3', originalLabel: 'c', content: parseMathContent('Bước 3', 'ord-3'), correctRank: 3 },
      ],
      requireExactSequence: true,
    },
  };

  const exam = makeBaseExam([q1, q2, q3, q4, q5, q6]);
  exam.mixConfig = applyMixToggleUpdate(exam.mixConfig, {
    shuffleQuestions: true,
    shuffleMcqOptions: true,
    shufflePerSectionOnly: false,
    shuffleIndependentTrueFalseStatements: true,
  });

  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0, `Lỗi cấu hình TEST 11: ${res.errors.join('; ')}`);

  for (const ver of res.versions) {
    assert.equal(ver.integrityPassed, true);
    ver.questions.forEach((mq, idx) => {
      const row = ver.answerKeyRows[idx];
      assert.equal(row.questionId, mq.id);
      if (mq.id === 'q-3') {
        const expected = mq.multiSelectOptions!
          .map((o, oIdx) => (o.isCorrect ? ['A', 'B', 'C', 'D'][oIdx] : null))
          .filter(Boolean)
          .join(', ');
        assert.equal(row.answer, expected);
      } else if (mq.id === 'q-4') {
        const expected = mq.statements!
          .map((s, sIdx) => `${['a', 'b', 'c', 'd'][sIdx]}:${s.isTrue ? 'Đ' : 'S'}`)
          .join(' · ');
        assert.equal(row.answer, expected);
      } else if (mq.id === 'q-5') {
        const idxA = mq.matching!.rightItems.findIndex((r) => r.id === 'mr-a');
        const idxB = mq.matching!.rightItems.findIndex((r) => r.id === 'mr-b');
        const expected = `1-${['a', 'b'][idxA]}, 2-${['a', 'b'][idxB]}`;
        assert.equal(row.answer, expected);
      } else if (mq.id === 'q-6') {
        const expected = ['ord-1', 'ord-2', 'ord-3']
          .map((id) => ['a', 'b', 'c'][mq.ordering!.items.findIndex((it) => it.id === id)])
          .join(' → ');
        assert.equal(row.answer, expected);
      }
    });
  }
});

// ============================================================================
// TEST 12: Export Consistency (DOCX, Answer Key DOCX, CSV, ZIP) & Order Verification
// ============================================================================
test('TEST 12: Exported Student DOCX preserves exact shuffled question order, never leaks answers, and verifier blocks order mismatch', async () => {
  const questions = Array.from({ length: 8 }, (_, i) => makeMcqQuestion(i + 1));
  const exam = makeBaseExam(questions);
  const res = generateMixedExams(exam);
  assert.equal(res.errors.length, 0);
  exam.generatedVersions = res.versions;

  const v101 = res.versions[0];
  const v102 = res.versions[1];

  const docx101 = await buildStudentExamDocxBuffer(exam, v101);
  const docx102 = await buildStudentExamDocxBuffer(exam, v102);

  const check101 = await verifyExportedDocxBuffer(docx101, v101, exam);
  const check102 = await verifyExportedDocxBuffer(docx102, v102, exam);
  assert.equal(check101.passed, true, `DOCX Mã 101 lỗi: ${check101.issues.map((i) => i.message).join('; ')}`);
  assert.equal(check102.passed, true, `DOCX Mã 102 lỗi: ${check102.issues.map((i) => i.message).join('; ')}`);

  // Cross-check: verifying docx101 against v102 (wrong question order!) MUST FAIL
  const crossCheck = await verifyExportedDocxBuffer(docx101, v102, exam);
  assert.equal(crossCheck.passed, false, 'Verifier phải phát hiện & chặn khi thứ tự câu trong DOCX không khớp mã đề');
  assert.ok(crossCheck.issues.some((i) => i.id.startsWith('exp-stem-order-mismatch')));

  // Verify extracted stem order inside DOCX matches v101.questions exactly
  const extracted101 = await extractDocxDocument(docx101);
  const text101 = extracted101.plainTextWithMarkers;
  const stemMarkersInDocx = Array.from(text101.matchAll(/\[STEM-(\d+)\]/g)).map((m) => `q-${m[1]}`);
  assert.deepEqual(stemMarkersInDocx, getOrderIds(v101.questions));

  // Verify Answer Key DOCX & CSV & ZIP bundle build cleanly and match answers
  const answerDocx = await buildAnswerKeyDocxBuffer(exam);
  const answerExtracted = await extractDocxDocument(answerDocx);
  assert.ok(answerExtracted.plainTextWithMarkers.includes(`Mã đề ${v101.code}`));

  const csv = buildConsolidatedAnswerCsv(exam);
  assert.ok(csv.includes(`"Mã ${v101.code}"`));
  assert.ok(csv.includes(`"${v101.answerKeyRows[0].answer}"`));

  const zipResult = await exportMixedExamZipBundle(exam);
  assert.equal(zipResult.integrity.verified, true);
  assert.ok(zipResult.zipBytes.byteLength > 1000);
});

// ============================================================================
// TEST 13: Word DOCX Auto Numbering (w:numPr + word/numbering.xml)
// ============================================================================
test('TEST 13: DOCX with Word Auto Numbering (w:numPr + word/numbering.xml) parses cleanly without duplicated prefixes and shuffles questions', async () => {
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="Câu %1:"/>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="upperLetter"/>
      <w:lvlText w:val="%2."/>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="10">
    <w:abstractNumId w:val="1"/>
  </w:num>
</w:numbering>`;

  const qParagraphs = Array.from({ length: 6 }, (_, i) => {
    const n = i + 1;
    return `
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr></w:pPr>
      <w:r><w:t>Tính đạo hàm của hàm số $y = x^{${n + 1}}$ tại điểm $x = ${n}$?</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="10"/></w:numPr></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>${(n + 1) * n}</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="10"/></w:numPr></w:pPr>
      <w:r><w:t>${n + 5}</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="10"/></w:numPr></w:pPr>
      <w:r><w:t>${n + 9}</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="10"/></w:numPr></w:pPr>
      <w:r><w:t>${n + 13}</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Đáp án: A</w:t></w:r></w:p>`;
  }).join('\n');

  // Also add one paragraph that already has literal "Câu 7:" + numPr to ensure NO double prefix
  const literalPrefixPara = `
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr></w:pPr>
      <w:r><w:t>Câu 7: Giải phương trình $2x - 4 = 0$?</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>A. x = 2   B. x = 3   C. x = 4   D. x = 5</w:t></w:r></w:p>
    <w:p><w:r><w:t>Đáp án: A</w:t></w:r></w:p>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${qParagraphs}
    ${literalPrefixPara}
  </w:body>
</w:document>`;

  const zip = new JSZip();
  zip.file('word/numbering.xml', numberingXml);
  zip.file('word/document.xml', documentXml);
  const docxBuf = await zip.generateAsync({ type: 'uint8array' });

  const extracted = await extractDocxDocument(docxBuf);
  assert.ok(!extracted.plainTextWithMarkers.includes('Câu 7: Câu 7:'), 'Không được lặp tiền tố Câu 7');
  assert.ok(extracted.plainTextWithMarkers.includes('Câu 1: Tính đạo hàm'));
  assert.ok(extracted.plainTextWithMarkers.includes('A. '));

  let seq = 0;
  const parsed = parseLatexExamText(extracted.plainTextWithMarkers, (p) => `${p}-${++seq}`);
  assert.equal(parsed.questions.length, 7, 'Phải trích xuất đủ 7 câu hỏi từ file DOCX dùng Auto Numbering');
  assert.ok(
    parsed.questions.every((q) => !/^Câu\s*\d+/i.test(q.stem.rawSource)),
    'Stem câu hỏi sau khi parse không được chứa tiền tố đánh số bị lặp'
  );

  // Confirm imported questions actually shuffle into distinct orders
  const importedExam = makeBaseExam(parsed.questions);
  const mixRes = generateMixedExams(importedExam);
  assert.equal(mixRes.errors.length, 0);
  const origSig = buildVersionQuestionOrderSignature(importedExam.questions);
  const uniqueSigs = new Set(mixRes.versions.map((v) => buildVersionQuestionOrderSignature(v.questions)));
  assert.equal(uniqueSigs.size, 4);
  assert.ok(!uniqueSigs.has(origSig));
});

// ============================================================================
// TEST 14: Independent Toggle State Synchronization (All 4 Combinations)
// ============================================================================
test('TEST 14: Independent shuffle toggles support all 4 combinations without one toggle silently overriding the other', () => {
  const questions = Array.from({ length: 6 }, (_, i) => makeMcqQuestion(i + 1));
  const exam = makeBaseExam(questions);

  // 1. Start from Both ON -> Turn Questions OFF -> Options MUST stay ON!
  const optionsOnlyCfg = applyMixToggleUpdate(exam.mixConfig, { shuffleQuestions: false });
  const flagsOptionsOnly = resolveEffectiveMixFlags({ ...exam, mixConfig: optionsOnlyCfg });
  assert.equal(flagsOptionsOnly.shuffleQuestions, false);
  assert.equal(flagsOptionsOnly.shuffleMcqOptions, true);

  // 2. From Options-only -> Turn Options OFF -> Both OFF
  const neitherCfg = applyMixToggleUpdate(optionsOnlyCfg, { shuffleMcqOptions: false });
  const flagsNeither = resolveEffectiveMixFlags({ ...exam, mixConfig: neitherCfg });
  assert.equal(flagsNeither.shuffleQuestions, false);
  assert.equal(flagsNeither.shuffleMcqOptions, false);
  assert.equal(neitherCfg.level, 0);

  // 3. From Both OFF -> Turn Questions ON -> Questions-only (Options stays OFF)
  const questionsOnlyCfg = applyMixToggleUpdate(neitherCfg, { shuffleQuestions: true });
  const flagsQuestionsOnly = resolveEffectiveMixFlags({ ...exam, mixConfig: questionsOnlyCfg });
  assert.equal(flagsQuestionsOnly.shuffleQuestions, true);
  assert.equal(flagsQuestionsOnly.shuffleMcqOptions, false);
  assert.equal(questionsOnlyCfg.level, 1);

  // 4. From Both OFF -> Turn Options ON -> Options-only (Questions stays OFF!)
  const optionsOnlyFromOff = applyMixToggleUpdate(neitherCfg, { shuffleMcqOptions: true });
  const flagsOptionsFromOff = resolveEffectiveMixFlags({ ...exam, mixConfig: optionsOnlyFromOff });
  assert.equal(flagsOptionsFromOff.shuffleQuestions, false);
  assert.equal(flagsOptionsFromOff.shuffleMcqOptions, true);

  // 5. Preset Level 1 -> syncs shuffleQuestions=true, shuffleMcqOptions=false
  const preset1 = applyMixLevelPreset(exam.mixConfig, 1, questions);
  const flagsPreset1 = resolveEffectiveMixFlags({ ...exam, mixConfig: preset1 });
  assert.equal(flagsPreset1.shuffleQuestions, true);
  assert.equal(flagsPreset1.shuffleMcqOptions, false);
});

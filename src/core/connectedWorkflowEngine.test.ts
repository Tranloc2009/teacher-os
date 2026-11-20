import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDashboardNextSteps,
  createInitialWorkflowContext,
  evaluateConnectedWorkflowProgress,
  normalizeStoredWorkflowContext,
  parseUniversalCommand,
  patchWorkflowContext,
} from './connectedWorkflowEngine';
import type { ResourceItem } from '../types/lesson';
import type { MathExamProject } from '../types/mathExam';
import type { GradingSession, GradedSheetRecord } from '../types/grading';
import { createEmptyMathExamProject } from '../data/demoMathExams';

function makeDemoExam(): MathExamProject {
  let seq = 0;
  const project = createEmptyMathExamProject((p) => `${p}-${++seq}`);
  return {
    ...project,
    id: 'exam-demo-12',
    title: 'Đề kiểm tra Giữa HK1 Toán 12',
  };
}

function makeMixedVersion(code: string): MathExamProject['generatedVersions'][number] {
  return {
    code,
    seedUsed: `seed-${code}`,
    generatedAt: '2026-11-20T08:10:00.000Z',
    questions: [],
    permutationMap: [],
    answerKeyRows: [],
    integrityPassed: true,
    integrityWarnings: [],
  };
}

function makeExamResource(overrides: Partial<ResourceItem> = {}): ResourceItem {
  return {
    id: 'res-toan12-1',
    title: 'Đề ôn tập Chương 1 Hàm số Toán 12',
    type: 'question-template',
    subject: 'Toán học',
    grade: 'Lớp 12',
    tags: ['toan-12', 'ham-so'],
    content: 'Câu 1. Tìm cực trị của hàm số $y = x^3 - 3x$.',
    answerOrNote: 'Đáp án A',
    updatedAt: '2026-11-20T08:00:00.000Z',
    documentCategory: 'de-thi',
    chapterTopic: 'Hàm số & Đạo hàm',
    sourceFile: {
      fileName: 'De_Toan_12_Ham_So.docx',
      relativePath: 'Toán 12/Hàm số/De_Toan_12_Ham_So.docx',
      extension: '.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 24500,
      sha256: 'abc123',
      storageKind: 'indexeddb',
      fileRecordId: 'file-1',
    },
    ...overrides,
  };
}

function makeSheet(overrides: Partial<GradedSheetRecord> = {}): GradedSheetRecord {
  return {
    id: 'sheet-1',
    sessionId: 'sess-1',
    fileName: 'hs01.jpg',
    uploadedAt: '2026-11-20T09:00:00.000Z',
    examCode: '101',
    examCodeSource: 'optical-code',
    studentId: 'HS001',
    studentName: 'Nguyễn Minh Anh',
    className: '12A2',
    studentMatch: {
      matched: true,
      studentId: 'HS001',
      studentName: 'Nguyễn Minh Anh',
      className: '12A2',
    },
    originalBlobId: 'blob-1',
    imageWidth: 1200,
    imageHeight: 1697,
    manualViewRotationDeg: 0,
    status: 'confirmed',
    confirmedByTeacher: true,
    alignment: {
      aligned: true,
      detectedRotationDeg: 0,
      sharpnessScore: 42,
      lowSharpness: false,
      opticalCodeStatus: 'decoded',
      warnings: [],
      processingTimeMs: 45,
    },
    questions: [],
    correctCount: 8,
    wrongCount: 2,
    blankCount: 0,
    uncertainCount: 0,
    unsupportedCount: 0,
    rawScore: 8,
    finalScore: 8,
    maxScore: 10,
    scoreFormulaText: '8/10',
    updatedAt: '2026-11-20T09:05:00.000Z',
    ...overrides,
  };
}

function makeGradingSession(
  exam: MathExamProject,
  sheets: GradedSheetRecord[]
): GradingSession {
  return {
    id: 'sess-1',
    title: `Chấm OMR - ${exam.title}`,
    examId: exam.id,
    examTitle: exam.title,
    subject: exam.subject,
    grade: exam.grade,
    className: '12A2',
    selectedExamCodes: exam.generatedVersions.map((v) => v.code),
    omrQuestionCount: 12,
    gradingRule: {
      maxScore: 10,
      rounding: '0.25',
      useExamQuestionPoints: false,
    },
    omrThresholds: {
      filledThreshold: 0.42,
      blankMaxThreshold: 0.16,
      minMarginToSecond: 0.16,
      minContrastDelta: 0.14,
      minSharpnessScore: 18,
    },
    students: [],
    sheets,
    gradebookEntries: sheets.map((s, idx) => ({
      id: `gb-${idx}`,
      sessionId: 'sess-1',
      orderNumber: idx + 1,
      studentId: s.studentId,
      fullName: s.studentName,
      className: s.className,
      examCode: s.examCode,
      omrSheetId: s.id,
      omrScore: s.finalScore,
      omrStatus: s.status,
      photoScore: null,
      scoreDelta: null,
      officialScore: s.confirmedByTeacher ? s.finalScore : null,
      officialScoreSource: s.confirmedByTeacher ? 'omr' : 'unassigned',
      reconciliationStatus: s.confirmedByTeacher ? 'CONFIRMED' : 'REVIEW_REQUIRED',
      confirmedByTeacher: s.confirmedByTeacher,
      notes: '',
      hasOmrEvidence: true,
      hasPhotoEvidence: false,
      updatedAt: '2026-11-20T09:06:00.000Z',
    })),
    createdAt: '2026-11-20T09:00:00.000Z',
    updatedAt: '2026-11-20T09:06:00.000Z',
  };
}

test('B22-23: Shared Workflow Context chains all 5 modules & preserves prior IDs on back-navigation', () => {
  const initial = createInitialWorkflowContext('2026-11-20T07:00:00.000Z');

  // Step 1: Resource Vault selected
  const s1 = patchWorkflowContext(
    initial,
    {
      resourceId: 'res-toan12-1',
      resourceTitle: 'Đề ôn tập Chương 1 Hàm số Toán 12',
      lastActiveApp: 'resource-vault',
    },
    { stage: 'source', appId: 'resource-vault', summary: 'Chọn tài liệu nguồn Toán 12' }
  );

  // Step 2: Smart Exam Generator created draft
  const s2 = patchWorkflowContext(
    s1,
    {
      examDraftId: 'draft-101',
      examDraftTitle: 'Đề giữa kỳ 1 Toán 12',
      questionSelectionIds: ['q1', 'q2', 'q3', 'q4'],
      examDraftQuestionCount: 4,
      examDraftConfirmedCount: 4,
      examDraftBlockedCount: 0,
      lastActiveApp: 'exam-generator',
    },
    { stage: 'generate', appId: 'exam-generator', summary: 'Tạo đề nháp 4 câu' }
  );

  // Step 3: Exam Mixer Pro created 4 codes
  const s3 = patchWorkflowContext(
    s2,
    {
      generatedExamId: 'exam-math-12',
      generatedExamTitle: 'Đề giữa kỳ 1 Toán 12',
      examVersionIds: ['exam-math-12:101', 'exam-math-12:102', 'exam-math-12:103', 'exam-math-12:104'],
      examVersionCodes: ['101', '102', '103', '104'],
      lastActiveApp: 'math-mixer',
    },
    { stage: 'mix', appId: 'math-mixer', summary: 'Trộn thành 4 mã đề' }
  );

  // Step 4: Print Studio marked printed
  const s4 = patchWorkflowContext(
    s3,
    {
      examFormLabel: 'Mẫu kiểm tra giữa học kỳ',
      printedAt: '2026-11-20T08:30:00.000Z',
      lastActiveApp: 'print-studio',
    },
    { stage: 'print', appId: 'print-studio', summary: 'Xuất in A4' }
  );

  // Step 5: Navigate BACK to Exam Generator -> none of the downstream IDs are lost!
  const sBack = patchWorkflowContext(s4, {
    lastActiveApp: 'exam-generator',
  });

  assert.equal(sBack.workflowId, initial.workflowId);
  assert.equal(sBack.resourceId, 'res-toan12-1');
  assert.deepEqual(sBack.questionSelectionIds, ['q1', 'q2', 'q3', 'q4']);
  assert.equal(sBack.examDraftId, 'draft-101');
  assert.equal(sBack.generatedExamId, 'exam-math-12');
  assert.deepEqual(sBack.examVersionCodes, ['101', '102', '103', '104']);
  assert.equal(sBack.printedAt, '2026-11-20T08:30:00.000Z');
  assert.equal(sBack.lastActiveApp, 'exam-generator');
  assert.equal(sBack.history.length, 4);
});

test('B24: Reload persistence serialization round-trip preserves active context & sanitizes corrupt input', () => {
  const ctx = patchWorkflowContext(createInitialWorkflowContext(), {
    resourceId: 'res-1',
    generatedExamId: 'exam-99',
    generatedExamTitle: 'Đề kiểm tra 45 phút',
    examVersionCodes: ['101', '102'],
    studentClassId: '12A2',
    lastActiveApp: 'print-studio',
  });

  const restored = normalizeStoredWorkflowContext(JSON.parse(JSON.stringify(ctx)));
  assert.equal(restored.workflowId, ctx.workflowId);
  assert.equal(restored.resourceId, 'res-1');
  assert.equal(restored.generatedExamId, 'exam-99');
  assert.deepEqual(restored.examVersionCodes, ['101', '102']);
  assert.equal(restored.studentClassId, '12A2');
  assert.equal(restored.lastActiveApp, 'print-studio');

  // Corrupt/empty fallback never throws
  const fallback = normalizeStoredWorkflowContext(null);
  assert.equal(fallback.lastActiveApp, 'desktop');
  assert.deepEqual(fallback.examVersionCodes, []);
});

test('B25: Connected 8-stage evaluation is truthful — never marks Completed when unconfirmed, unmixed, or blocked', () => {
  const res = makeExamResource();
  const baseExam = makeDemoExam();

  // Case 1: Exam with unconfirmed answer and NO versions generated yet
  const unconfirmedExam: MathExamProject = {
    ...baseExam,
    generatedVersions: [],
    questions: baseExam.questions.map((q, idx) => ({
      ...q,
      answerConfirmed: idx !== 0,
    })),
  };

  const ctx1 = patchWorkflowContext(createInitialWorkflowContext(), {
    resourceId: res.id,
    generatedExamId: unconfirmedExam.id,
  });
  const stages1 = evaluateConnectedWorkflowProgress(ctx1, {
    resources: [res],
    mathExams: [unconfirmedExam],
    gradingSessions: [],
  });
  const byId1 = Object.fromEntries(stages1.map((s) => [s.id, s]));

  assert.equal(stages1.length, 8);
  assert.equal(byId1.source.status, 'completed');
  assert.equal(byId1.select.status, 'completed');
  assert.equal(byId1.generate.status, 'completed');
  assert.equal(byId1.review.status, 'needs-review'); // NOT completed!
  assert.equal(byId1.mix.status, 'in-progress'); // NOT completed!
  assert.equal(byId1.print.status, 'in-progress'); // NOT completed until printedAt!
  assert.equal(byId1.grade.status, 'not-started');
  assert.equal(byId1.summary.status, 'not-started');

  // Case 2: Exam containing a BLOCKED question
  const blockedExam: MathExamProject = {
    ...unconfirmedExam,
    questions: unconfirmedExam.questions.map((q, idx) =>
      idx === 0
        ? {
            ...q,
            sourceVerification: {
              sourceFormat: 'pdf',
              verificationStatus: 'BLOCKED',
              verifiedByTeacher: false,
              formulaRiskFlags: ['broken-fraction'],
              reasons: ['Công thức bị lỗi cần xác minh'],
            },
          }
        : q
    ),
  };
  const stagesBlocked = evaluateConnectedWorkflowProgress(ctx1, {
    resources: [res],
    mathExams: [blockedExam],
    gradingSessions: [],
  });
  const byIdBlocked = Object.fromEntries(stagesBlocked.map((s) => [s.id, s]));
  assert.equal(byIdBlocked.review.status, 'blocked');
  assert.equal(byIdBlocked.mix.status, 'blocked');

  // Case 3: Exam confirmed + mixed + printed + OMR session with 1 flagged sheet -> grade/summary MUST be needs-review
  const confirmedMixedExam: MathExamProject = {
    ...baseExam,
    questions: baseExam.questions.map((q) => ({ ...q, answerConfirmed: true })),
    generatedVersions: [makeMixedVersion('101')],
  };
  const flaggedSheet = makeSheet({
    id: 'sheet-flagged',
    status: 'review-required',
    confirmedByTeacher: false,
    uncertainCount: 1,
  });
  const sessionNeedsReview = makeGradingSession(confirmedMixedExam, [
    makeSheet({ id: 'sheet-ok', confirmedByTeacher: true, status: 'confirmed' }),
    flaggedSheet,
  ]);
  const ctx3 = patchWorkflowContext(createInitialWorkflowContext(), {
    resourceId: res.id,
    generatedExamId: confirmedMixedExam.id,
    printedAt: '2026-11-20T08:30:00.000Z',
    gradingSessionId: sessionNeedsReview.id,
  });
  const stages3 = evaluateConnectedWorkflowProgress(ctx3, {
    resources: [res],
    mathExams: [confirmedMixedExam],
    gradingSessions: [sessionNeedsReview],
  });
  const byId3 = Object.fromEntries(stages3.map((s) => [s.id, s]));
  assert.equal(byId3.review.status, 'completed');
  assert.equal(byId3.mix.status, 'completed');
  assert.equal(byId3.print.status, 'completed');
  assert.equal(byId3.grade.status, 'needs-review');
  assert.equal(byId3.summary.status, 'needs-review');

  // Case 4: All sheets confirmed -> all 8 stages legitimately completed
  const sessionFinalized = makeGradingSession(confirmedMixedExam, [
    makeSheet({ id: 'sheet-ok-1', confirmedByTeacher: true, status: 'confirmed' }),
    makeSheet({ id: 'sheet-ok-2', studentId: 'HS002', confirmedByTeacher: true, status: 'confirmed' }),
  ]);
  const stages4 = evaluateConnectedWorkflowProgress(ctx3, {
    resources: [res],
    mathExams: [confirmedMixedExam],
    gradingSessions: [sessionFinalized],
  });
  assert.ok(stages4.every((s) => s.status === 'completed'));
});

test('B26: Universal Command Bar parses all 6 Vietnamese benchmark commands & rejects destructive commands', () => {
  const res = makeExamResource();
  const exam = makeDemoExam();
  const session = makeGradingSession(exam, [makeSheet()]);
  const ctx = patchWorkflowContext(createInitialWorkflowContext(), {
    generatedExamId: exam.id,
  });
  const params = {
    ctx,
    resources: [res],
    mathExams: [exam],
    gradingSessions: [session],
  };

  // 1. "Tạo đề Toán 12 từ Resource Vault"
  const c1 = parseUniversalCommand('Tạo đề Toán 12 từ Resource Vault', params);
  assert.equal(c1.length, 1);
  assert.equal(c1[0].category, 'workflow');
  assert.equal(c1[0].intent, 'nl-generate-exam');
  assert.equal(c1[0].targetApp, 'exam-generator');
  assert.equal(c1[0].requiresConfirmation, true);
  assert.equal(c1[0].payload.resourceId, res.id);

  // 2. "Mở ngân hàng câu hỏi chương Hàm số"
  const c2 = parseUniversalCommand('Mở ngân hàng câu hỏi chương Hàm số', params);
  assert.equal(c2.length, 1);
  assert.equal(c2[0].category, 'navigation');
  assert.equal(c2[0].intent, 'open-bank-topic');
  assert.equal(c2[0].requiresConfirmation, false);
  assert.equal(c2[0].payload.topicQuery, 'Hàm số');

  // 3. "Trộn đề này thành 4 mã"
  const c3 = parseUniversalCommand('Trộn đề này thành 4 mã', params);
  assert.equal(c3.length, 1);
  assert.equal(c3[0].category, 'workflow');
  assert.equal(c3[0].intent, 'mix-current-exam');
  assert.equal(c3[0].targetApp, 'math-mixer');
  assert.equal(c3[0].requiresConfirmation, true);
  assert.equal(c3[0].payload.versionCount, 4);
  assert.equal(c3[0].payload.examId, exam.id);

  // 4. "Tạo phiếu trả lời cho lớp 12A2"
  const c4 = parseUniversalCommand('Tạo phiếu trả lời cho lớp 12A2', params);
  assert.equal(c4.length, 1);
  assert.equal(c4[0].category, 'workflow');
  assert.equal(c4[0].intent, 'create-omr-sheet');
  assert.equal(c4[0].targetApp, 'grading-studio');
  assert.equal(c4[0].requiresConfirmation, true);
  assert.equal(c4[0].payload.className, '12A2');
  assert.equal(c4[0].payload.gradingTab, 'sheet-gen');

  // 5. "Mở kết quả chấm bài gần nhất"
  const c5 = parseUniversalCommand('Mở kết quả chấm bài gần nhất', params);
  assert.equal(c5.length, 1);
  assert.equal(c5[0].category, 'navigation');
  assert.equal(c5[0].intent, 'open-latest-grading');
  assert.equal(c5[0].targetApp, 'grading-studio');
  assert.equal(c5[0].requiresConfirmation, false);
  assert.equal(c5[0].payload.gradingTab, 'gradebook');

  // 6. "Xuất đề theo mẫu giữa học kỳ"
  const c6 = parseUniversalCommand('Xuất đề theo mẫu giữa học kỳ', params);
  assert.equal(c6.length, 1);
  assert.equal(c6[0].category, 'workflow');
  assert.equal(c6[0].intent, 'print-exam-form');
  assert.equal(c6[0].targetApp, 'print-studio');
  assert.equal(c6[0].requiresConfirmation, true);
  assert.equal(c6[0].payload.formLabel, 'Mẫu giữa học kỳ');

  // 7. Destructive / external commands MUST be rejected safely
  assert.deepEqual(parseUniversalCommand('xóa hết dữ liệu đề thi', params), []);
  assert.deepEqual(parseUniversalCommand('upload toàn bộ đề lên mạng', params), []);
  assert.deepEqual(parseUniversalCommand('reset toàn bộ hệ thống', params), []);

  // 8. Empty query returns starter workflow & navigation commands
  const emptyStarter = parseUniversalCommand('', params);
  assert.ok(emptyStarter.length >= 4);
  assert.ok(emptyStarter.some((c) => c.category === 'workflow' && c.requiresConfirmation));
});

test('B27: Home Dashboard Next-Step Suggestions reflect real IndexedDB state deterministically', () => {
  const ctx = createInitialWorkflowContext();

  // Empty workspace -> 0 fabricated suggestions
  const emptySuggestions = computeDashboardNextSteps(ctx, {
    resources: [],
    mathExams: [],
    gradingSessions: [],
  });
  assert.equal(emptySuggestions.length, 0);

  // Real data: mixed exam + pending OMR review session + Resource Vault doc
  const res = makeExamResource();
  const mixedExam: MathExamProject = {
    ...makeDemoExam(),
    generatedVersions: [makeMixedVersion('101'), makeMixedVersion('102')],
  };
  const pendingSession = makeGradingSession(mixedExam, [
    makeSheet({ status: 'review-required', confirmedByTeacher: false, uncertainCount: 1 }),
  ]);

  const suggestions = computeDashboardNextSteps(ctx, {
    resources: [res],
    mathExams: [mixedExam],
    gradingSessions: [pendingSession],
  });

  assert.equal(suggestions.length, 3);
  // Highest priority: mixed exam -> Print Studio (primary) / OMR (secondary)
  assert.equal(suggestions[0].targetApp, 'print-studio');
  assert.equal(suggestions[0].secondaryTargetApp, 'grading-studio');
  assert.ok(suggestions[0].title.includes('2 mã đề'));
  assert.ok(suggestions[0].title.includes('101, 102'));
  // Second priority: pending OMR review -> Smart Grading Studio
  assert.equal(suggestions[1].targetApp, 'grading-studio');
  assert.ok(suggestions[1].title.includes('1 phiếu cần giáo viên duyệt'));
  // Third priority: Resource Vault exam doc -> Smart Exam Generator
  assert.equal(suggestions[2].targetApp, 'exam-generator');
  assert.equal(suggestions[2].resourceId, res.id);
});

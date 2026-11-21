import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConnectedWorkspaceSummaries,
  computeDashboardNextSteps,
  computeSmartActionBar,
  createInitialWorkflowContext,
  createInitialWorkflowStore,
  createNewWorkflowInStore,
  evaluateConnectedWorkflowProgress,
  findExistingExamForDraft,
  findExistingGradingSession,
  getActiveWorkflowFromStore,
  normalizeStoredWorkflowStore,
  parseUniversalCommand,
  patchWorkflowContext,
  resolveStrictEntityById,
  switchActiveWorkflow,
  upsertWorkflowInStore,
  validateWorkflowContext,
} from './connectedWorkflowEngine';
import { generateMixedExams } from './mathShuffleEngine';
import { buildExamAnswerKeyMap } from './grading/examMixerBridge';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import type { ResourceItem } from '../types/lesson';
import type { MathExamProject } from '../types/mathExam';
import type { GradingSession, GradedSheetRecord } from '../types/grading';
import type { GeneratedExamDraft } from '../types/examGenerator';

function cloneConfirmedDemoExam(overrides: Partial<MathExamProject> = {}): MathExamProject {
  const cloned = structuredClone(DEMO_MATH_EXAM);
  cloned.id = overrides.id ?? 'exam-p2-verified';
  cloned.title = overrides.title ?? 'Đề Toán 12 Giữa HK1 (Kiểm chứng)';
  cloned.confirmedOriginalAnswers = true;
  cloned.questions = cloned.questions.map((q) => ({
    ...q,
    answerConfirmed: true,
  }));
  cloned.mixConfig = {
    ...cloned.mixConfig,
    examCount: 4,
    startCodeNumber: 101,
    seed: 'p2-verified-seed-2026',
  };
  cloned.generatedVersions = [];
  return {
    ...cloned,
    ...overrides,
  };
}

function makeMixedVerifiedExam(id = 'exam-p2-mixed'): MathExamProject {
  const base = cloneConfirmedDemoExam({ id });
  const mixed = generateMixedExams(base);
  assert.equal(mixed.errors.length, 0, `Unexpected mix errors: ${mixed.errors.join('; ')}`);
  assert.equal(mixed.versions.length, 4);
  return {
    ...base,
    generatedVersions: mixed.versions,
    status: 'ready',
  };
}

function makeResource(id = 'res-p2-1', title = 'Đề ôn tập Chương 1 Hàm số Toán 12'): ResourceItem {
  return {
    id,
    title,
    type: 'question-template',
    subject: 'Toán học',
    grade: 'Lớp 12',
    tags: ['toan-12', 'ham-so'],
    content: 'Câu 1. Cho hàm số $y = x^3 - 3x$. Tìm giá trị cực đại.',
    answerOrNote: 'Đáp án A',
    updatedAt: '2026-11-20T08:00:00.000Z',
    documentCategory: 'de-thi',
    chapterTopic: 'Hàm số & Đạo hàm',
  };
}

function makeSheet(overrides: Partial<GradedSheetRecord> = {}): GradedSheetRecord {
  return {
    id: 'sheet-p2-1',
    sessionId: 'sess-p2-1',
    fileName: 'hs01.jpg',
    uploadedAt: '2026-11-20T09:00:00.000Z',
    examCode: '101',
    examCodeSource: 'optical-code',
    studentId: 'HS001',
    studentName: 'Trần Gia Bảo',
    className: '12A2',
    studentMatch: {
      matched: true,
      studentId: 'HS001',
      studentName: 'Trần Gia Bảo',
      className: '12A2',
    },
    originalBlobId: 'blob-p2-1',
    imageWidth: 1200,
    imageHeight: 1697,
    manualViewRotationDeg: 0,
    status: 'confirmed',
    confirmedByTeacher: true,
    alignment: {
      aligned: true,
      detectedRotationDeg: 0,
      sharpnessScore: 45,
      lowSharpness: false,
      opticalCodeStatus: 'decoded',
      warnings: [],
      processingTimeMs: 38,
    },
    questions: [],
    correctCount: 10,
    wrongCount: 2,
    blankCount: 0,
    uncertainCount: 0,
    unsupportedCount: 0,
    rawScore: 8.5,
    finalScore: 8.5,
    maxScore: 10,
    scoreFormulaText: '8.5/10',
    updatedAt: '2026-11-20T09:05:00.000Z',
    ...overrides,
  };
}

function makeSession(
  exam: MathExamProject,
  sheets: GradedSheetRecord[],
  overrides: Partial<GradingSession> = {}
): GradingSession {
  const id = overrides.id ?? 'sess-p2-1';
  const className = overrides.className ?? '12A2';
  return {
    id,
    title: `Chấm OMR - ${exam.title}`,
    examId: exam.id,
    examTitle: exam.title,
    subject: exam.subject,
    grade: exam.grade,
    className,
    selectedExamCodes: exam.generatedVersions.map((v) => v.code),
    omrQuestionCount: exam.questions.filter((q) => q.type === 'mcq').length || 12,
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
      id: `gb-${id}-${idx}`,
      sessionId: id,
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
    ...overrides,
  };
}

test('P2-01: Real end-to-end chain (Vault -> Generator -> Mixer 101-104 -> Print -> Grading) preserves exact IDs & per-code answer keys', () => {
  const res = makeResource();
  const mixedExam = makeMixedVerifiedExam('exam-p2-chain');
  const codes = mixedExam.generatedVersions.map((v) => v.code);
  assert.deepEqual(codes, ['101', '102', '103', '104']);

  // Verify real per-code answer mapping has zero cross-code corruption
  const keyMap = buildExamAnswerKeyMap(mixedExam);
  for (const code of codes) {
    assert.equal(keyMap[code]?.valid, true, `Code ${code} should be valid`);
    assert.equal(keyMap[code]?.examCode, code);
    assert.ok(Object.keys(keyMap[code].mcqAnswerByOrder).length > 0);
  }
  // Distinct shuffled permutations across codes 101 and 102
  const sig101 = mixedExam.generatedVersions[0].questions.map((q) => q.id).join(',');
  const sig102 = mixedExam.generatedVersions[1].questions.map((q) => q.id).join(',');
  assert.notEqual(sig101, sig102, 'Codes 101 and 102 should have distinct shuffled question orders');

  // Chain workflow context through all stages
  const wf1 = patchWorkflowContext(
    createInitialWorkflowContext('2026-11-20T07:00:00.000Z'),
    {
      resourceId: res.id,
      resourceTitle: res.title,
      generatedExamId: mixedExam.id,
      generatedExamTitle: mixedExam.title,
      examVersionIds: codes.map((c) => `${mixedExam.id}:${c}`),
      examVersionCodes: codes,
      lastActiveApp: 'math-mixer',
    },
    { stage: 'mix', appId: 'math-mixer', summary: 'Trộn thành công 4 mã đề 101-104' }
  );

  const valAfterMix = validateWorkflowContext(wf1, {
    resources: [res],
    mathExams: [mixedExam],
    gradingSessions: [],
  });
  assert.equal(valAfterMix.status, 'valid');
  assert.equal(valAfterMix.canMix, true);
  assert.equal(valAfterMix.canExportOfficial, true);
  assert.equal(valAfterMix.canGradeOmr, true);

  // Smart Action Bar after mixing should offer Print / OMR without blocked banner
  const barAfterMix = computeSmartActionBar(
    wf1,
    { resources: [res], mathExams: [mixedExam], gradingSessions: [] },
    'math-mixer'
  );
  assert.equal(barAfterMix.blockedBanner, undefined);
  assert.ok(barAfterMix.primaryAction);
  assert.ok(
    barAfterMix.primaryAction.targetApp === 'print-studio' ||
      barAfterMix.primaryAction.targetApp === 'grading-studio'
  );

  // Complete Print + Grading + Confirm all sheets
  const finalizedSession = makeSession(mixedExam, [
    makeSheet({ id: 'sh-101', examCode: '101', confirmedByTeacher: true, status: 'confirmed' }),
    makeSheet({ id: 'sh-102', studentId: 'HS002', examCode: '102', confirmedByTeacher: true, status: 'confirmed' }),
  ]);
  const wfFinal = patchWorkflowContext(wf1, {
    printedAt: '2026-11-20T08:30:00.000Z',
    gradingSessionId: finalizedSession.id,
    gradingSessionTitle: finalizedSession.title,
    studentClassId: '12A2',
    lastActiveApp: 'grading-studio',
  });

  const valFinal = validateWorkflowContext(wfFinal, {
    resources: [res],
    mathExams: [mixedExam],
    gradingSessions: [finalizedSession],
  });
  assert.equal(valFinal.status, 'valid');
  assert.equal(valFinal.canExportConfirmedGradebook, true);

  const stages = evaluateConnectedWorkflowProgress(wfFinal, {
    resources: [res],
    mathExams: [mixedExam],
    gradingSessions: [finalizedSession],
  });
  assert.ok(stages.every((s) => s.status === 'completed'));
});

test('P2-02: Integrity Gate strictly blocks unconfirmed answers, OPTION_PARSE_INCOMPLETE, UNRENDERABLE media, STALE GRAPH DATA & bad Answer Mapping', () => {
  const res = makeResource();

  // Case A: Unconfirmed answer -> canMix=false, canGradeOmr=false, Smart Action Bar points to Answer Key Studio
  const unconfirmedExam = cloneConfirmedDemoExam({ id: 'exam-unconfirmed' });
  unconfirmedExam.confirmedOriginalAnswers = false;
  unconfirmedExam.questions[0].answerConfirmed = false;

  const wfA = patchWorkflowContext(createInitialWorkflowContext(), {
    resourceId: res.id,
    generatedExamId: unconfirmedExam.id,
  });
  const valA = validateWorkflowContext(wfA, { resources: [res], mathExams: [unconfirmedExam] });
  assert.equal(valA.status, 'needs-review');
  assert.equal(valA.canMix, false);
  assert.equal(valA.canGradeOmr, false);
  assert.equal(valA.recommendedFixView, 'answer-studio');
  const barA = computeSmartActionBar(wfA, { resources: [res], mathExams: [unconfirmedExam] }, 'math-mixer');
  assert.equal(barA.primaryAction?.targetApp, 'math-mixer');
  assert.equal(barA.primaryAction?.targetSubView, 'answer-studio');
  assert.notEqual(barA.primaryAction?.targetApp, 'grading-studio');

  // Case B: OPTION_PARSE_INCOMPLETE -> status='blocked', Smart Action Bar directs to Document Import Doctor
  const incompleteOptExam = cloneConfirmedDemoExam({ id: 'exam-opt-incomplete' });
  incompleteOptExam.questions[0].optionParseIncomplete = true;
  incompleteOptExam.questions[0].optionParseReason = 'Chỉ tách được 2/4 phương án A/B';

  const wfB = patchWorkflowContext(createInitialWorkflowContext(), {
    generatedExamId: incompleteOptExam.id,
  });
  const valB = validateWorkflowContext(wfB, { resources: [res], mathExams: [incompleteOptExam] });
  assert.equal(valB.status, 'blocked');
  assert.equal(valB.canMix, false);
  assert.equal(valB.canExportOfficial, false);
  assert.equal(valB.canGradeOmr, false);
  assert.equal(valB.recommendedFixView, 'import-doctor');
  const barB = computeSmartActionBar(wfB, { resources: [res], mathExams: [incompleteOptExam] }, 'math-mixer');
  assert.ok(barB.blockedBanner);
  assert.equal(barB.blockedBanner.fixAction.targetSubView, 'import-doctor');

  // Dashboard next steps must NOT suggest Print or OMR for blocked exam
  const nextStepsB = computeDashboardNextSteps(wfB, {
    resources: [res],
    mathExams: [incompleteOptExam],
    gradingSessions: [],
  });
  assert.equal(nextStepsB[0].targetApp, 'math-mixer');
  assert.equal(nextStepsB[0].targetSubView, 'import-doctor');

  // Case C: UNRENDERABLE Media placeholder -> status='blocked'
  const unrenderableExam = cloneConfirmedDemoExam({ id: 'exam-unrenderable' });
  unrenderableExam.questions[0].stem = {
    ...unrenderableExam.questions[0].stem,
    rawSource: 'Cho hình vẽ [TÀI_NGUYÊN_UNRENDERABLE:image1.emf] tìm thể tích khối chóp.',
  };
  const wfC = patchWorkflowContext(createInitialWorkflowContext(), {
    generatedExamId: unrenderableExam.id,
  });
  const valC = validateWorkflowContext(wfC, { resources: [res], mathExams: [unrenderableExam] });
  assert.equal(valC.status, 'blocked');
  assert.equal(valC.canMix, false);
  assert.ok(valC.blockedReasons.some((r) => r.includes('UNRENDERABLE')));

  // Case D: STALE GRAPH DATA on Draft -> status='blocked' & review stage blocked
  const baseQ = structuredClone(DEMO_MATH_EXAM.questions[0]);
  const staleDraft: GeneratedExamDraft = {
    id: 'draft-stale-graph',
    draftNumber: 1,
    draftLabel: 'Đề nháp #1',
    title: 'Đề Đồ thị hàm số bậc 3',
    subjectId: 'toan',
    subjectName: 'Toán học',
    grade: 'Lớp 12',
    durationMinutes: 45,
    mode: 'verified-variants',
    seed: 'stale-seed',
    totalPoints: 10,
    status: 'draft',
    items: [
      {
        id: 'item-graph-1',
        orderNumber: 1,
        origin: 'verified-variant',
        parentQuestionId: baseQ.id,
        verificationSummary: 'Dynamic cubic graph variant',
        question: {
          ...baseQ,
          answerConfirmed: true,
          variantMeta: {
            parentQuestionId: baseQ.id,
            templateId: 'tpl-cubic-graph-1',
            variantId: 'var-cubic-1',
            variantCode: 'C01',
            seed: 'stale-seed',
            parameterSignature: 'a=1,b=-3,c=0,d=2',
            parameterValues: { a: 1, b: -3, c: 0, d: 2 },
            verificationSummary: 'verified',
            verifiedAt: '2026-11-20T08:00:00.000Z',
            dynamicFunctionFamily: 'cubic',
            graphFingerprint: 'fp-tampered-mismatch-999',
          },
        },
        status: 'VARIANT_READY',
        teacherConfirmed: true,
        locked: false,
        graphFingerprint: 'fp-tampered-mismatch-999',
      },
    ],
    report: {
      requestedTotal: 1,
      generatedTotal: 1,
      originalCount: 0,
      variantCount: 1,
      reviewRequiredCount: 0,
      unsupportedCount: 0,
      blockedCount: 0,
      shortfalls: [],
      warnings: [],
      cancelled: false,
      seedUsed: 'stale-seed',
      generatedAt: '2026-11-20T08:00:00.000Z',
    },
    allAnswersConfirmed: true,
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
  };
  const wfD = patchWorkflowContext(createInitialWorkflowContext(), {
    examDraftId: staleDraft.id,
    examDraftTitle: staleDraft.title,
  });
  const valD = validateWorkflowContext(wfD, {
    resources: [res],
    mathExams: [],
    drafts: [staleDraft],
  });
  assert.equal(valD.status, 'blocked');
  assert.ok(valD.blockedReasons.some((r) => r.includes('STALE GRAPH')));
  const stagesD = evaluateConnectedWorkflowProgress(wfD, {
    resources: [res],
    mathExams: [],
    drafts: [staleDraft],
  });
  assert.equal(stagesD.find((s) => s.id === 'review')?.status, 'blocked');

  // Case E: Corrupted Answer Mapping on mixed version -> canGradeOmr=false, status='blocked'
  const corruptedMixed = makeMixedVerifiedExam('exam-bad-mapping');
  corruptedMixed.generatedVersions[0].integrityPassed = false;
  corruptedMixed.generatedVersions[0].integrityStatus = 'BLOCKED';
  const wfE = patchWorkflowContext(createInitialWorkflowContext(), {
    generatedExamId: corruptedMixed.id,
    examVersionCodes: ['101', '102', '103', '104'],
  });
  const valE = validateWorkflowContext(wfE, {
    resources: [res],
    mathExams: [corruptedMixed],
  });
  assert.equal(valE.status, 'blocked');
  assert.equal(valE.canGradeOmr, false);
});

test('P2-03: Multi-workflow store persistence, legacy v1 migration, independent workflows & anti-stale revision guard', () => {
  // 1. Legacy v1 migration -> v2 store preserves workflow seamlessly
  const legacyCtx = patchWorkflowContext(createInitialWorkflowContext('2026-11-20T06:00:00.000Z'), {
    title: 'Đề cũ từ Phase 1',
    resourceId: 'res-legacy',
    generatedExamId: 'exam-legacy',
    lastActiveApp: 'math-mixer',
  });
  const migratedStore = normalizeStoredWorkflowStore(null, JSON.parse(JSON.stringify(legacyCtx)));
  assert.equal(migratedStore.version, 2);
  assert.equal(migratedStore.workflows.length, 1);
  assert.equal(migratedStore.activeWorkflowId, legacyCtx.workflowId);
  assert.equal(getActiveWorkflowFromStore(migratedStore).generatedExamId, 'exam-legacy');

  // 2. Create 2nd independent workflow -> 1st workflow remains intact
  const { store: storeWithTwo, workflow: wf2 } = createNewWorkflowInStore(
    migratedStore,
    {
      title: 'Đề giữa kỳ lớp 12A2',
      resourceId: 'res-new-2',
      lastActiveApp: 'exam-generator',
    },
    '2026-11-20T09:00:00.000Z'
  );
  assert.equal(storeWithTwo.workflows.length, 2);
  assert.equal(storeWithTwo.activeWorkflowId, wf2.workflowId);
  assert.ok(storeWithTwo.workflows.some((w) => w.workflowId === legacyCtx.workflowId));

  // 3. Monotonic revision anti-stale overwrite protection
  const wf2Advanced = patchWorkflowContext(
    patchWorkflowContext(wf2, { generatedExamId: 'exam-v2-latest' }),
    { examVersionCodes: ['101', '102'] }
  );
  const up1 = upsertWorkflowInStore(storeWithTwo, wf2Advanced);
  assert.equal(up1.applied, true);

  // Attempt to write back stale older revision of wf2 -> MUST BE REJECTED!
  const staleWf2 = { ...wf2, generatedExamId: 'exam-stale-old', revision: 1 };
  const upStale = upsertWorkflowInStore(up1.store, staleWf2);
  assert.equal(upStale.applied, false);
  assert.ok(upStale.reason?.includes('rev'));
  assert.equal(
    getActiveWorkflowFromStore(upStale.store).generatedExamId,
    'exam-v2-latest'
  );

  // 4. Switching to non-existent workflowId returns explicit error without mutating store
  const badSwitch = switchActiveWorkflow(up1.store, 'wf-non-existent-999');
  assert.equal(badSwitch.found, false);
  assert.ok(badSwitch.error?.includes('Không tìm thấy'));
  assert.equal(badSwitch.store.activeWorkflowId, wf2.workflowId);

  // 5. Valid switch back to legacy workflow
  const goodSwitch = switchActiveWorkflow(up1.store, legacyCtx.workflowId);
  assert.equal(goodSwitch.found, true);
  assert.equal(goodSwitch.store.activeWorkflowId, legacyCtx.workflowId);

  // 6. Full JSON serialization round-trip simulates page reload
  const reloaded = normalizeStoredWorkflowStore(JSON.parse(JSON.stringify(goodSwitch.store)));
  assert.equal(reloaded.workflows.length, 2);
  assert.equal(reloaded.activeWorkflowId, legacyCtx.workflowId);
});

test('P2-04: Deleted/missing entity references never silently fall back to list[0] and surface explicit recovery banners', () => {
  const otherResource = makeResource('res-other', 'Tài liệu khác không liên quan');
  const otherExam = makeMixedVerifiedExam('exam-other');

  // Strict lookup returns missing: true and entity: undefined (NEVER list[0])
  const missingExamLookup = resolveStrictEntityById([otherExam], 'exam-deleted-404');
  assert.equal(missingExamLookup.missing, true);
  assert.equal(missingExamLookup.entity, undefined);

  const missingResLookup = resolveStrictEntityById([otherResource], 'res-deleted-404');
  assert.equal(missingResLookup.missing, true);
  assert.equal(missingResLookup.entity, undefined);

  // Workflow referencing deleted exam -> validation.status === 'missing-reference' & missingReferenceBanner
  const wfMissing = patchWorkflowContext(createInitialWorkflowContext(), {
    resourceId: 'res-deleted-404',
    resourceTitle: 'Đề gốc đã xóa',
    generatedExamId: 'exam-deleted-404',
    generatedExamTitle: 'Đề kiểm tra đã bị xóa',
    gradingSessionId: 'sess-deleted-404',
    gradingSessionTitle: 'Phiên chấm đã xóa',
  });

  const val = validateWorkflowContext(wfMissing, {
    resources: [otherResource],
    mathExams: [otherExam],
    gradingSessions: [],
  });
  assert.equal(val.status, 'missing-reference');
  assert.equal(val.missingReferences.length, 3);
  assert.equal(val.canMix, false);
  assert.equal(val.canGradeOmr, false);

  const bar = computeSmartActionBar(
    wfMissing,
    { resources: [otherResource], mathExams: [otherExam], gradingSessions: [] },
    'math-mixer'
  );
  assert.ok(bar.missingReferenceBanner);
  assert.ok(bar.missingReferenceBanner.title.includes('Không tìm thấy'));
  assert.notEqual(bar.primaryAction?.examId, otherExam.id);
});

test('P2-05: Idempotency helpers prevent duplicate exams and duplicate grading sessions on double-click', () => {
  const existingExam1 = cloneConfirmedDemoExam({ id: 'gen-mexam-draft-77' });
  const existingExam2 = cloneConfirmedDemoExam({ id: 'mexam-gen-draft-88' });
  const existingExam3 = cloneConfirmedDemoExam({ id: 'custom-exam-99' });

  assert.equal(
    findExistingExamForDraft([existingExam1], { id: 'draft-77', title: 'Đề 77' })?.id,
    'gen-mexam-draft-77'
  );
  assert.equal(
    findExistingExamForDraft([existingExam2], { id: 'draft-88', title: 'Đề 88' })?.id,
    'mexam-gen-draft-88'
  );
  assert.equal(
    findExistingExamForDraft([existingExam3], {
      id: 'draft-99',
      exportedExamProjectId: 'custom-exam-99',
      title: 'Đề 99',
    })?.id,
    'custom-exam-99'
  );
  assert.equal(
    findExistingExamForDraft([existingExam1], { id: 'draft-brand-new', title: 'Đề mới' }),
    undefined
  );

  // Grading session idempotency (case-insensitive className + code set order independent)
  const mixedExam = makeMixedVerifiedExam('exam-idem-omr');
  const existingSess = makeSession(mixedExam, [], {
    id: 'sess-existing-12a2',
    className: '12A2',
    selectedExamCodes: ['101', '102', '103', '104'],
  });
  assert.equal(
    findExistingGradingSession([existingSess], mixedExam.id, ' 12a2 ', ['104', '101', '103', '102'])?.id,
    'sess-existing-12a2'
  );
  assert.equal(
    findExistingGradingSession([existingSess], mixedExam.id, '12A3', ['101', '102', '103', '104']),
    undefined
  );
});

test('P2-06: Universal Command Center parses all Phase 2 Vietnamese intents & enforces Integrity Gate + safety rejections', () => {
  const res = makeResource();
  const mixedExam = makeMixedVerifiedExam('exam-cmd-verified');
  const pendingSheet = makeSheet({
    id: 'sh-review',
    status: 'review-required',
    confirmedByTeacher: false,
    uncertainCount: 2,
  });
  const sessionPending = makeSession(mixedExam, [pendingSheet], { id: 'sess-cmd-pending' });

  const ctx = patchWorkflowContext(createInitialWorkflowContext(), {
    resourceId: res.id,
    generatedExamId: mixedExam.id,
    gradingSessionId: sessionPending.id,
  });

  const params = {
    ctx,
    resources: [res],
    mathExams: [mixedExam],
    gradingSessions: [sessionPending],
  };

  // 1. "Mở Resource Vault"
  const r1 = parseUniversalCommand('Mở Resource Vault', params);
  assert.equal(r1[0]?.intent, 'open-app');
  assert.equal(r1[0]?.targetApp, 'resource-vault');

  // 2. "Tạo đề Toán 12 từ tài liệu đang chọn"
  const r2 = parseUniversalCommand('Tạo đề Toán 12 từ tài liệu đang chọn', params);
  assert.equal(r2[0]?.intent, 'nl-generate-exam');
  assert.equal(r2[0]?.payload.resourceId, res.id);
  assert.equal(r2[0]?.requiresConfirmation, true);

  // 3. "Mở đề kiểm tra gần nhất"
  const r3 = parseUniversalCommand('Mở đề kiểm tra gần nhất', params);
  assert.equal(r3[0]?.intent, 'open-latest-exam');
  assert.equal(r3[0]?.payload.examId, mixedExam.id);

  // 4. "Mở Answer Key Studio"
  const r4 = parseUniversalCommand('Mở Answer Key Studio', params);
  assert.equal(r4[0]?.intent, 'open-answer-key-studio');
  assert.equal(r4[0]?.payload.mixerSubView, 'answer-studio');

  // 5. "Mở bảng đáp án mã 101"
  const r5 = parseUniversalCommand('Mở bảng đáp án mã 101', params);
  assert.equal(r5[0]?.intent, 'open-exam-answer-key');
  assert.equal(r5[0]?.payload.examCode, '101');
  assert.equal(r5[0]?.payload.mixerStep, 4);
  assert.equal(r5[0]?.blockedReason, undefined);

  // 5b. Non-existent exam code 999 shows explicit blockedReason (never lies)
  const r5b = parseUniversalCommand('Mở bảng đáp án mã 999', params);
  assert.equal(r5b[0]?.intent, 'open-exam-answer-key');
  assert.ok(r5b[0]?.blockedReason?.includes('999'));

  // 6. "Mở danh sách bài cần duyệt"
  const r6 = parseUniversalCommand('Mở danh sách bài cần duyệt', params);
  assert.equal(r6[0]?.intent, 'open-grading-review');
  assert.equal(r6[0]?.payload.gradingTab, 'review');
  assert.equal(r6[0]?.payload.gradingSessionId, sessionPending.id);

  // 7. "Xuất bảng điểm đã xác nhận" -> blocked when pending sheets exist, routes to review tab!
  const r7Blocked = parseUniversalCommand('Xuất bảng điểm đã xác nhận', params);
  assert.equal(r7Blocked[0]?.intent, 'export-confirmed-gradebook');
  assert.ok(r7Blocked[0]?.blockedReason);
  assert.equal(r7Blocked[0]?.payload.gradingTab, 'review');

  // 7b. When all sheets confirmed -> allows export tab
  const sessionConfirmed = makeSession(mixedExam, [makeSheet({ confirmedByTeacher: true, status: 'confirmed' })]);
  const r7Ok = parseUniversalCommand('Xuất bảng điểm đã xác nhận', {
    ...params,
    gradingSessions: [sessionConfirmed],
  });
  assert.equal(r7Ok[0]?.blockedReason, undefined);
  assert.equal(r7Ok[0]?.payload.gradingTab, 'export');

  // 8. Blocked exam blocks "Tạo phiếu trả lời cho lớp 12A2" -> routes to math-mixer Answer Key Studio
  const blockedExam = cloneConfirmedDemoExam({ id: 'exam-cmd-blocked' });
  blockedExam.questions[0].optionParseIncomplete = true;
  const r8Blocked = parseUniversalCommand('Tạo phiếu trả lời cho lớp 12A2', {
    ctx: patchWorkflowContext(createInitialWorkflowContext(), { generatedExamId: blockedExam.id }),
    resources: [res],
    mathExams: [blockedExam],
    gradingSessions: [],
  });
  assert.equal(r8Blocked[0]?.intent, 'create-omr-sheet');
  assert.ok(r8Blocked[0]?.blockedReason);
  assert.equal(r8Blocked[0]?.targetApp, 'math-mixer');
  assert.equal(r8Blocked[0]?.payload.mixerSubView, 'answer-studio');

  // 9. Destructive & Integrity-bypass commands MUST be rejected
  assert.deepEqual(parseUniversalCommand('xóa toàn bộ dữ liệu', params), []);
  assert.deepEqual(parseUniversalCommand('bỏ qua kiểm chứng đáp án', params), []);
  assert.deepEqual(parseUniversalCommand('tự xác nhận đáp án hết đi', params), []);
});

test('P2-07: Connected Workspace Dashboard summaries report truthful 5-step progress & exact Resume actions for multiple workflows', () => {
  const res = makeResource();
  const mixedExam = makeMixedVerifiedExam('exam-dash-1');
  const unconfirmedExam = cloneConfirmedDemoExam({
    id: 'exam-dash-2',
    title: 'Đề kiểm tra 15 phút Hình học',
    confirmedOriginalAnswers: false,
  });
  unconfirmedExam.questions[0].answerConfirmed = false;

  const wf1 = patchWorkflowContext(createInitialWorkflowContext('2026-11-20T08:00:00.000Z'), {
    title: mixedExam.title,
    resourceId: res.id,
    generatedExamId: mixedExam.id,
    examVersionCodes: ['101', '102', '103', '104'],
  });
  let store = createInitialWorkflowStore(wf1);
  const created2 = createNewWorkflowInStore(
    store,
    {
      title: unconfirmedExam.title,
      generatedExamId: unconfirmedExam.id,
    },
    '2026-11-20T09:00:00.000Z'
  );
  store = created2.store;

  const summaries = buildConnectedWorkspaceSummaries(store, {
    resources: [res],
    mathExams: [mixedExam, unconfirmedExam],
    gradingSessions: [],
  });

  assert.equal(summaries.length, 2);

  const sumUnconfirmed = summaries.find((s) => s.workflow.generatedExamId === unconfirmedExam.id)!;
  assert.equal(sumUnconfirmed.isActive, true);
  assert.equal(sumUnconfirmed.fiveStepProgress.length, 5);
  assert.equal(sumUnconfirmed.fiveStepProgress.find((st) => st.key === 'review')?.status, 'needs-review');
  assert.equal(sumUnconfirmed.resumeAction.targetApp, 'math-mixer');
  assert.equal(sumUnconfirmed.resumeAction.targetSubView, 'answer-studio');

  const sumMixed = summaries.find((s) => s.workflow.generatedExamId === mixedExam.id)!;
  assert.equal(sumMixed.fiveStepProgress.find((st) => st.key === 'review')?.status, 'completed');
  assert.equal(sumMixed.fiveStepProgress.find((st) => st.key === 'mix')?.status, 'completed');
  assert.equal(sumMixed.validation.canGradeOmr, true);
});

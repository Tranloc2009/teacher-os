import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AutoCaptureStabilityTracker,
  PaperFrameStabilityTracker,
  analyzeCameraFrameRgba,
  computeImageDHash,
  hammingDistanceHex64,
} from './cameraFrameAssist';
import {
  applyDuplicateResolution,
  detectDuplicateGroups,
} from './duplicateDetection';
import {
  cancelWaitingQueueItems,
  enqueueBatchItem,
  evaluateStorageQuota,
  markQueueItemCompleted,
  markQueueItemFailed,
  markQueueItemProcessing,
  retryFailedQueueItem,
  summarizeBatchQueue,
} from './batchQueueEngine';
import {
  createVerifiedSessionBackupPayload,
  parseAndVerifySessionBackupJson,
} from './gradingBackupIntegrity';
import { synthesizeOmrSheetImage } from './omrTestSynth';
import { runLocalOmrVisionPipeline } from './omrVisionEngine';
import { runOmrVisionInWorkerOrFallback } from './omrWorkerClient';
import { gradeRecognizedSheet } from './gradingEngine';
import {
  computeIntelligentGradebookStats,
  confirmOrOverrideGradebookEntry,
  reconcileIntelligentGradebook,
  undoLastOfficialGradeChange,
} from './gradebookReconciliationEngine';
import type {
  BatchQueueItem,
  ExamCodeAnswerKey,
  GradedSheetRecord,
  GradingSession,
  OmrBubbleChoice,
  RgbaImageBuffer,
} from '../../types/grading';
import {
  DEFAULT_GRADING_RULE,
  DEFAULT_OMR_THRESHOLDS,
} from '../../types/grading';

function makeSolidBuffer(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): RgbaImageBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function makeMockSheet(overrides: Partial<GradedSheetRecord> = {}): GradedSheetRecord {
  return {
    id: overrides.id ?? 'sheet-1',
    sessionId: 'sess-1',
    fileName: overrides.fileName ?? 'sheet1.png',
    uploadedAt: overrides.uploadedAt ?? '2026-11-19T08:00:00.000Z',
    examCode: overrides.examCode ?? '101',
    examCodeSource: 'optical-code',
    studentId: overrides.studentId ?? 'HS001',
    studentName: overrides.studentName ?? 'Nguyễn Văn An',
    className: '12A1',
    studentMatch: {
      matched: true,
      studentId: overrides.studentId ?? 'HS001',
      studentName: overrides.studentName ?? 'Nguyễn Văn An',
      className: '12A1',
    },
    originalBlobId: 'orig-1',
    imageWidth: 1000,
    imageHeight: 1414,
    manualViewRotationDeg: 0,
    status: overrides.status ?? 'auto-graded',
    confirmedByTeacher: false,
    alignment: overrides.alignment ?? {
      aligned: true,
      detectedRotationDeg: 0,
      sharpnessScore: 42,
      lowSharpness: false,
      opticalCodeStatus: 'decoded',
      opticalCodePayload: {
        v: 1,
        sid: 'sess-1',
        ec: overrides.examCode ?? '101',
        st: overrides.studentId ?? 'HS001',
        p: 1,
      },
      warnings: [],
      processingTimeMs: 25,
    },
    questions: [],
    correctCount: 8,
    wrongCount: 2,
    blankCount: 0,
    uncertainCount: 0,
    unsupportedCount: 0,
    rawScore: 8,
    finalScore: overrides.finalScore ?? 8,
    maxScore: 10,
    scoreFormulaText: '8/10',
    imageDHash: overrides.imageDHash,
    updatedAt: overrides.updatedAt ?? '2026-11-19T08:00:00.000Z',
    ...overrides,
  };
}

test('cameraFrameAssist detects low light on dark frame and blur on flat grey frame', () => {
  const darkFrame = makeSolidBuffer(160, 220, 22, 24, 28);
  const darkResult = analyzeCameraFrameRgba(darkFrame);
  assert.equal(darkResult.isLowLight, true);
  assert.equal(darkResult.alignmentReady, false);
  assert.equal(darkResult.severity, 'error');

  const flatGray = makeSolidBuffer(160, 220, 180, 180, 180);
  const blurResult = analyzeCameraFrameRgba(flatGray);
  assert.equal(blurResult.isLowLight, false);
  assert.equal(blurResult.isBlurry, true);
  assert.equal(blurResult.alignmentReady, false);
});

test('cameraFrameAssist detects sharp synthetic A4 OMR sheet with 4 fiducial corners', () => {
  const synthetic = synthesizeOmrSheetImage({
    questionCount: 10,
    width: 320,
    filledChoices: { 1: ['A'], 2: ['B'], 3: ['C'], 4: ['D'] },
  });
  // Add a subtle dark desk border around the paper so edges are not clipped
  const pad = 28;
  const outW = synthetic.width + pad * 2;
  const outH = synthetic.height + pad * 2;
  const framed = makeSolidBuffer(outW, outH, 55, 60, 70);
  for (let y = 0; y < synthetic.height; y += 1) {
    for (let x = 0; x < synthetic.width; x += 1) {
      const srcIdx = (y * synthetic.width + x) * 4;
      const dstIdx = ((y + pad) * outW + (x + pad)) * 4;
      framed.data[dstIdx] = synthetic.data[srcIdx];
      framed.data[dstIdx + 1] = synthetic.data[srcIdx + 1];
      framed.data[dstIdx + 2] = synthetic.data[srcIdx + 2];
      framed.data[dstIdx + 3] = 255;
    }
  }

  const res = analyzeCameraFrameRgba(framed);
  assert.equal(res.isLowLight, false);
  assert.equal(res.isBlurry, false);
  assert.equal(res.isClippedEdge, false);
  assert.ok(res.cornersDetectedCount >= 3, `Expected >=3 corners, got ${res.cornersDetectedCount}`);
  assert.equal(res.paperFrameDetected, true);
  assert.equal(res.alignmentReady, true);
  assert.equal(res.dHash.length, 16);
});

test('AutoCaptureStabilityTracker is OFF by default and guards stability, cooldown, and duplicate frames', () => {
  const tracker = new AutoCaptureStabilityTracker({
    requiredStableFrames: 3,
    cooldownMs: 2000,
    minDHashDistance: 6,
  });

  const readyFrame = {
    brightnessScore: 195,
    isLowLight: false,
    contrastScore: 76,
    isLowContrast: false,
    sharpnessScore: 36,
    isBlurry: false,
    isClippedEdge: false,
    cornersDetectedCount: 4,
    paperFrameDetected: true,
    tiltEstimateDeg: 0.5,
    alignmentReady: true,
    dHash: '0f0f0f0f0f0f0f0f',
    guidanceMessage: 'OK',
    severity: 'ready' as const,
  };

  // Off by default: never triggers
  assert.equal(tracker.isEnabled(), false);
  assert.equal(tracker.evaluate(readyFrame, 1000).shouldTriggerCapture, false);

  // Enable explicitly: requires 3 consecutive stable frames
  tracker.setEnabled(true);
  assert.equal(tracker.evaluate(readyFrame, 1100).shouldTriggerCapture, false);
  assert.equal(tracker.evaluate(readyFrame, 1200).shouldTriggerCapture, false);
  const third = tracker.evaluate(readyFrame, 1300);
  assert.equal(third.shouldTriggerCapture, true);
  assert.equal(third.reason, 'stable-ready');

  // Cooldown blocks immediate re-capture
  const duringCooldown = tracker.evaluate(
    { ...readyFrame, dHash: 'ffffffff00000000' },
    2000
  );
  assert.equal(duringCooldown.shouldTriggerCapture, false);
  assert.equal(duringCooldown.reason, 'cooldown-active');

  // After cooldown, identical dHash is STILL blocked as duplicate sheet
  const dupAfterCooldown = tracker.evaluate(readyFrame, 4000);
  assert.equal(dupAfterCooldown.shouldTriggerCapture, false);
  assert.equal(dupAfterCooldown.reason, 'duplicate-frame-blocked');

  // New sheet with distinct dHash triggers after 3 stable frames
  const newSheetFrame = { ...readyFrame, dHash: 'f0f0f0f0f0f0f0f0' };
  assert.equal(tracker.evaluate(newSheetFrame, 4100).shouldTriggerCapture, false);
  assert.equal(tracker.evaluate(newSheetFrame, 4200).shouldTriggerCapture, false);
  assert.equal(tracker.evaluate(newSheetFrame, 4300).shouldTriggerCapture, true);
});

test('computeImageDHash produces identical hash for same image and distinct hash for different content', () => {
  const imgA = synthesizeOmrSheetImage({
    questionCount: 10,
    width: 240,
    filledChoices: { 1: ['A'], 2: ['A'], 3: ['A'] },
  });
  const imgB = makeSolidBuffer(240, 320, 20, 20, 20);
  // Paint vertical gradient on imgB so dHash bits differ significantly
  for (let y = 0; y < imgB.height; y += 1) {
    for (let x = 0; x < imgB.width; x += 1) {
      const idx = (y * imgB.width + x) * 4;
      const val = x < imgB.width / 2 ? 230 : 30;
      imgB.data[idx] = val;
      imgB.data[idx + 1] = val;
      imgB.data[idx + 2] = val;
    }
  }
  const hA1 = computeImageDHash(imgA);
  const hA2 = computeImageDHash(imgA);
  const hB = computeImageDHash(imgB);

  assert.equal(hammingDistanceHex64(hA1, hA2), 0);
  assert.ok(hammingDistanceHex64(hA1, hB) > 8);
});

test('duplicateDetection detects same optical code, same studentId, and similar dHash without auto-deleting', () => {
  const s1 = makeMockSheet({
    id: 's1',
    studentId: 'HS001',
    uploadedAt: '2026-11-19T08:00:00.000Z',
    finalScore: 7.5,
    imageDHash: '1111222233334444',
  });
  const s2 = makeMockSheet({
    id: 's2',
    studentId: 'HS001',
    uploadedAt: '2026-11-19T08:02:00.000Z',
    finalScore: 9.0,
    imageDHash: '1111222233334444',
  });
  const s3 = makeMockSheet({
    id: 's3',
    studentId: 'HS002',
    uploadedAt: '2026-11-19T08:03:00.000Z',
    alignment: {
      aligned: true,
      detectedRotationDeg: 0,
      sharpnessScore: 40,
      lowSharpness: false,
      opticalCodeStatus: 'absent',
      warnings: [],
      processingTimeMs: 20,
    },
    imageDHash: 'aaaabbbbccccdddd',
  });
  const s4 = makeMockSheet({
    id: 's4',
    studentId: 'HS003',
    uploadedAt: '2026-11-19T08:04:00.000Z',
    alignment: {
      aligned: true,
      detectedRotationDeg: 0,
      sharpnessScore: 40,
      lowSharpness: false,
      opticalCodeStatus: 'absent',
      warnings: [],
      processingTimeMs: 20,
    },
    // Differs by 1 bit from s3
    imageDHash: 'aaaabbbbccccdddc',
  });

  const groups = detectDuplicateGroups([s1, s2, s3, s4]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].reason, 'same-optical-code');
  assert.deepEqual(groups[0].sheetIds, ['s1', 's2']);
  assert.equal(groups[1].reason, 'similar-image-hash');
  assert.deepEqual(groups[1].sheetIds, ['s3', 's4']);

  // Keep new: s1 is archived (not deleted!), s2 remains active, history recorded
  const resolved = applyDuplicateResolution([s1, s2, s3, s4], groups[0], 'keep-new', 'Chụp lại rõ hơn');
  assert.equal(resolved.sheets.length, 4);
  const archivedS1 = resolved.sheets.find((s) => s.id === 's1');
  const activeS2 = resolved.sheets.find((s) => s.id === 's2');
  assert.equal(archivedS1?.archivedByDuplicateResolution, true);
  assert.equal(archivedS1?.replacedBySheetId, 's2');
  assert.equal(activeS2?.archivedByDuplicateResolution, false);
  assert.equal(resolved.historyEntry.action, 'keep-new');
  assert.equal(resolved.historyEntry.keptSheetId, 's2');

  // After resolving group 0, only group 1 remains active
  const remainingGroups = detectDuplicateGroups(resolved.sheets);
  assert.equal(remainingGroups.length, 1);
  assert.equal(remainingGroups[0].reason, 'similar-image-hash');

  // Mark retake sets retakeRequested & review-required without deleting
  const retakeRes = applyDuplicateResolution(resolved.sheets, remainingGroups[0], 'mark-retake');
  const markedS3 = retakeRes.sheets.find((s) => s.id === 's3');
  assert.equal(markedS3?.retakeRequested, true);
  assert.equal(markedS3?.status, 'review-required');
});

test('batchQueueEngine handles 10 consecutive items with waiting, processing, graded, review-required, failed, retry, cancel', () => {
  let queue: BatchQueueItem[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const res = enqueueBatchItem(queue, {
      id: `q-${i}`,
      fileName: `cam_${i}.jpg`,
      createdAt: `2026-11-19T08:00:${String(i).padStart(2, '0')}.000Z`,
      captureSource: 'camera',
    });
    queue = res.queue;
  }

  assert.equal(summarizeBatchQueue(queue).waiting, 10);

  queue = markQueueItemProcessing(queue, 'q-1');
  queue = markQueueItemCompleted(queue, 'q-1', makeMockSheet({ id: 'sh-1', status: 'auto-graded', finalScore: 9.5 }));
  queue = markQueueItemProcessing(queue, 'q-2');
  queue = markQueueItemCompleted(queue, 'q-2', makeMockSheet({ id: 'sh-2', status: 'review-required', finalScore: 6.0 }));
  queue = markQueueItemProcessing(queue, 'q-3');
  queue = markQueueItemFailed(queue, 'q-3', 'Ảnh bị hỏng');

  let summary = summarizeBatchQueue(queue);
  assert.equal(summary.graded, 1);
  assert.equal(summary.reviewRequired, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.waiting, 7);

  // Retry failed item
  queue = retryFailedQueueItem(queue, 'q-3');
  summary = summarizeBatchQueue(queue);
  assert.equal(summary.failed, 0);
  assert.equal(summary.waiting, 8);

  // Cancel remaining waiting items preserves already processed items
  queue = cancelWaitingQueueItems(queue);
  summary = summarizeBatchQueue(queue);
  assert.equal(summary.waiting, 0);
  assert.equal(summary.total, 2);

  // Low storage warning evaluator
  const lowQuota = evaluateStorageQuota(95 * 1024 * 1024, 100 * 1024 * 1024);
  assert.equal(lowQuota.isLowStorage, true);
  assert.ok(lowQuota.warning);

  const healthyQuota = evaluateStorageQuota(12 * 1024 * 1024, 500 * 1024 * 1024);
  assert.equal(healthyQuota.isLowStorage, false);
});

test('gradingBackupIntegrity round-trips v2 payload and rejects tampered backup', () => {
  const session: GradingSession = {
    id: 'sess-test',
    title: 'Kiểm tra 15 phút Toán 12',
    examId: 'exam-1',
    examTitle: 'Đề 15 phút',
    subject: 'Toán',
    grade: '12',
    className: '12A1',
    selectedExamCodes: ['101', '102'],
    omrQuestionCount: 10,
    gradingRule: DEFAULT_GRADING_RULE,
    omrThresholds: DEFAULT_OMR_THRESHOLDS,
    students: [{ studentId: 'HS001', fullName: 'Nguyễn Văn An', className: '12A1', orderNumber: 1 }],
    sheets: [makeMockSheet({ id: 's1', studentId: 'HS001', finalScore: 8.5 })],
    createdAt: '2026-11-19T08:00:00.000Z',
    updatedAt: '2026-11-19T08:05:00.000Z',
  };

  const payload = createVerifiedSessionBackupPayload(session, 'Mobile Backup');
  const serialized = JSON.stringify(payload);
  const verified = parseAndVerifySessionBackupJson(serialized);
  assert.equal(verified.valid, true);
  assert.equal(verified.version, 'v2');
  assert.equal(verified.session?.sheets[0].finalScore, 8.5);

  // Tamper with score in JSON without updating checksum -> MUST fail verification
  const tampered = serialized.replace('8.5', '10');
  const rejected = parseAndVerifySessionBackupJson(tampered);
  assert.equal(rejected.valid, false);
  assert.match(rejected.error ?? '', /checksum|toàn vẹn/i);
});

function makeAnswerKey(
  examCode: string,
  answers: Record<number, OmrBubbleChoice>
): ExamCodeAnswerKey {
  const entries = Object.entries(answers).map(([orderStr, correctChoice]) => {
    const orderNumber = Number(orderStr);
    return {
      orderNumber,
      questionId: `q-${orderNumber}`,
      originalCode: `C${orderNumber}`,
      universalType: 'mcq' as const,
      autoGradable: true,
      correctChoice,
      points: 1,
    };
  });
  return {
    examId: 'exam-1',
    examTitle: 'Đề kiểm tra mẫu',
    examCode,
    versionIntegrityPassed: true,
    valid: true,
    blockingErrors: [],
    warnings: [],
    totalQuestions: entries.length,
    autoGradableCount: entries.length,
    unsupportedCount: 0,
    questions: entries,
    mcqAnswerByOrder: answers,
  };
}

test('corrupted optical QR forces review-required and never guesses student identity', () => {
  const answerKeys: Record<string, ExamCodeAnswerKey> = {
    '101': makeAnswerKey('101', { 1: 'A', 2: 'B', 3: 'C', 4: 'D' }),
  };
  const img = synthesizeOmrSheetImage({
    questionCount: 4,
    filledChoices: { 1: ['A'], 2: ['B'], 3: ['C'], 4: ['D'] },
  });
  const recognition = runLocalOmrVisionPipeline(img, 4, DEFAULT_OMR_THRESHOLDS);
  // Simulate corrupted QR payload
  recognition.alignment.opticalCodeStatus = 'corrupted';
  recognition.alignment.opticalCodePayload = undefined;

  const graded = gradeRecognizedSheet({
    sheetId: 'sheet-corrupt-qr',
    sessionId: 'sess-1',
    fileName: 'corrupt_qr.jpg',
    originalBlobId: 'orig-corrupt',
    recognition,
    answerKeysByCode: answerKeys,
    students: [
      { studentId: 'HS001', fullName: 'Nguyễn Văn An', className: '12A1', orderNumber: 1 },
    ],
    gradingRule: DEFAULT_GRADING_RULE,
    fallbackExamCode: '101',
  });

  assert.equal(graded.status, 'review-required');
  assert.equal(graded.studentId, '');
  assert.equal(graded.studentMatch.matched, false);
});

test('desktop and mobile worker pipeline produce identical OMR recognition and final score', async () => {
  const answerKeys: Record<string, ExamCodeAnswerKey> = {
    '101': makeAnswerKey('101', { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'A' }),
  };
  const filledChoices: Record<number, OmrBubbleChoice[]> = {
    1: ['A'],
    2: ['B'],
    3: ['C'],
    4: ['A'], // wrong
    5: ['A'],
  };
  const img = synthesizeOmrSheetImage({
    questionCount: 5,
    filledChoices,
    opticalPayload: { v: 1, sid: 'sess-1', ec: '101', st: 'HS001', p: 1 },
  });

  const desktopRecognition = runLocalOmrVisionPipeline(img, 5, DEFAULT_OMR_THRESHOLDS);
  const mobileWorkerOut = await runOmrVisionInWorkerOrFallback(img, 5, DEFAULT_OMR_THRESHOLDS);

  const students = [
    { studentId: 'HS001', fullName: 'Nguyễn Văn An', className: '12A1', orderNumber: 1 },
  ];
  const desktopGraded = gradeRecognizedSheet({
    sheetId: 'desk-1',
    sessionId: 'sess-1',
    fileName: 'desk.png',
    originalBlobId: 'orig-desk',
    recognition: desktopRecognition,
    answerKeysByCode: answerKeys,
    students,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  const mobileGraded = gradeRecognizedSheet({
    sheetId: 'mob-1',
    sessionId: 'sess-1',
    fileName: 'mob.png',
    originalBlobId: 'orig-mob',
    recognition: mobileWorkerOut.recognition,
    answerKeysByCode: answerKeys,
    students,
    gradingRule: DEFAULT_GRADING_RULE,
  });

  assert.equal(desktopGraded.finalScore, 8);
  assert.equal(mobileGraded.finalScore, desktopGraded.finalScore);
  assert.equal(mobileGraded.correctCount, desktopGraded.correctCount);
  assert.equal(mobileGraded.wrongCount, desktopGraded.wrongCount);
  assert.equal(mobileWorkerOut.imageDHash.length, 16);
});

test('Phase 2 Gradebook reconciliation ignores archived duplicate sheets and preserves confirmation + audit trail + undo', () => {
  const oldSheet = makeMockSheet({
    id: 'sheet-old',
    studentId: 'HS001',
    finalScore: 6.0,
    uploadedAt: '2026-11-19T08:00:00.000Z',
    updatedAt: '2026-11-19T08:00:00.000Z',
  });
  const newSheet = makeMockSheet({
    id: 'sheet-new',
    studentId: 'HS001',
    finalScore: 9.0,
    uploadedAt: '2026-11-19T08:05:00.000Z',
    updatedAt: '2026-11-19T08:05:00.000Z',
  });

  const dupGroups = detectDuplicateGroups([oldSheet, newSheet]);
  assert.equal(dupGroups.length, 1);

  // Resolve keeping the newer 9.0 sheet -> old 6.0 sheet is archived
  const { sheets: resolvedSheets } = applyDuplicateResolution(
    [oldSheet, newSheet],
    dupGroups[0],
    'keep-new'
  );

  const session: GradingSession = {
    id: 'sess-gb',
    title: 'Kiểm tra 15p',
    examId: 'ex-1',
    examTitle: 'Đề Toán 12',
    subject: 'Toán',
    grade: '12',
    className: '12A1',
    selectedExamCodes: ['101'],
    omrQuestionCount: 10,
    gradingRule: DEFAULT_GRADING_RULE,
    omrThresholds: DEFAULT_OMR_THRESHOLDS,
    students: [
      { studentId: 'HS001', fullName: 'Nguyễn Văn An', className: '12A1', orderNumber: 1 },
      { studentId: 'HS002', fullName: 'Trần Thị Bình', className: '12A1', orderNumber: 2 },
    ],
    sheets: resolvedSheets,
    createdAt: '2026-11-19T08:00:00.000Z',
    updatedAt: '2026-11-19T08:05:00.000Z',
  };

  const entries = reconcileIntelligentGradebook(session);
  assert.equal(entries.length, 2);
  const hs1 = entries.find((e) => e.studentId === 'HS001');
  const hs2 = entries.find((e) => e.studentId === 'HS002');
  // Archived 6.0 sheet MUST be ignored; active 9.0 sheet MUST flow into Gradebook
  assert.equal(hs1?.omrScore, 9.0);
  assert.equal(hs1?.omrSheetId, 'sheet-new');
  assert.equal(hs2?.reconciliationStatus, 'MISSING');

  // Confirm HS001 official score -> audit trail recorded, stats include only confirmed
  const confirmedSession = confirmOrOverrideGradebookEntry({
    session: { ...session, gradebookEntries: entries },
    studentId: 'HS001',
    chosenScore: 9.0,
    source: 'omr',
    reason: 'Xác nhận điểm OMR mới chụp lại',
  });
  assert.equal(confirmedSession.gradeAuditTrail?.length, 1);
  const stats = computeIntelligentGradebookStats(confirmedSession.gradebookEntries ?? []);
  assert.equal(stats.confirmedValidCount, 1);
  assert.equal(stats.confirmedAverageScore, 9.0);

  // Undo restores safely without deleting audit history
  const undoneSession = undoLastOfficialGradeChange({
    session: confirmedSession,
    studentId: 'HS001',
  });
  assert.equal(undoneSession.gradeAuditTrail?.length, 2);
  const hs1AfterUndo = undoneSession.gradebookEntries?.find((e) => e.studentId === 'HS001');
  assert.equal(hs1AfterUndo?.confirmedByTeacher, false);
});

test('analyzeCameraFrameRgba computes canvas contrast and PaperFrameStabilityTracker triggers Ảnh mờ/Thiếu sáng overlay only when frame stabilizes', () => {
  // Flat washed-out gray frame -> low contrast & blurry
  const lowContrastBuf = makeSolidBuffer(180, 240, 145, 145, 145);
  const lowContrastRes = analyzeCameraFrameRgba(lowContrastBuf);
  assert.equal(lowContrastRes.isLowContrast, true);
  assert.ok(lowContrastRes.contrastScore < 32);

  // Dark blurry frame -> low light + low contrast
  const darkBuf = makeSolidBuffer(180, 240, 28, 30, 32);
  const darkRes = analyzeCameraFrameRgba(darkBuf);
  assert.equal(darkRes.isLowLight, true);
  assert.equal(darkRes.isLowContrast, true);

  // Crisp synthetic OMR sheet -> strong canvas contrast
  const sharpSheet = synthesizeOmrSheetImage({
    questionCount: 10,
    width: 280,
    filledChoices: { 1: ['A'], 2: ['B'], 3: ['C'], 4: ['D'] },
  });
  const sharpRes = analyzeCameraFrameRgba(sharpSheet);
  assert.equal(sharpRes.isLowContrast, false);
  assert.ok(sharpRes.contrastScore >= 32, `Expected contrast >= 32, got ${sharpRes.contrastScore}`);

  const tracker = new PaperFrameStabilityTracker({
    requiredStableFrames: 3,
    maxMotionDHashDistance: 5,
    maxBrightnessDelta: 18,
  });

  // Moving frames (alternating dHash) must NOT trigger overlay even if blurry/dark
  const s1 = tracker.update({ ...darkRes, dHash: '0000000000000000' });
  const s2 = tracker.update({ ...darkRes, dHash: 'ffffffffffffffff' });
  assert.equal(s1.visible, false);
  assert.equal(s2.visible, false);
  assert.equal(s2.isPaperStable, false);

  // Hold paper steady for 3 frames -> overlay appears with 'Ảnh mờ / Thiếu sáng'
  const steady1 = tracker.update({ ...darkRes, dHash: '1111222233334444' });
  const steady2 = tracker.update({ ...darkRes, dHash: '1111222233334444' });
  const steady3 = tracker.update({ ...darkRes, dHash: '1111222233334444' });
  assert.equal(steady1.visible, false);
  assert.equal(steady2.visible, false);
  assert.equal(steady3.isPaperStable, true);
  assert.equal(steady3.visible, true);
  assert.equal(steady3.issueKind, 'blurry-and-low-light');
  assert.equal(steady3.title, 'Ảnh mờ / Thiếu sáng');
  assert.equal(steady3.canSuggestTorch, true);

  // Bright but washed-out low-contrast frame held steady -> triggers blurry/low-contrast overlay
  tracker.reset();
  tracker.update({ ...lowContrastRes, dHash: 'aaaa0000aaaa0000' });
  tracker.update({ ...lowContrastRes, dHash: 'aaaa0000aaaa0000' });
  const washedStable = tracker.update({ ...lowContrastRes, dHash: 'aaaa0000aaaa0000' });
  assert.equal(washedStable.visible, true);
  assert.equal(washedStable.issueKind, 'blurry');
  assert.equal(washedStable.title, 'Ảnh mờ / Thiếu sáng');

  // Recovering to a crisp high-contrast well-lit frame automatically dismisses the overlay
  const recovered = tracker.update(sharpRes);
  assert.equal(recovered.visible, false);
  assert.equal(recovered.issueKind, 'none');
});



import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { DEMO_MATH_EXAM } from '../../data/demoMathExams';
import { generateMixedExams } from '../mathShuffleEngine';
import {
  DEFAULT_GRADING_RULE,
  DEFAULT_OMR_THRESHOLDS,
  type GradingSession,
  type OmrBubbleChoice,
  type StudentRecord,
} from '../../types/grading';
import {
  buildExamAnswerKeyMap,
  extractExamCodeAnswerKey,
} from './examMixerBridge';
import {
  decodeOpticalIdMatrix,
  encodeOpticalIdMatrix,
  validateOpticalIdPayload,
} from './omrOpticalCode';
import { runLocalOmrVisionPipeline } from './omrVisionEngine';
import {
  annotateDuplicateStudentWarnings,
  applyScoreRounding,
  computeGradingDashboardMetrics,
  gradeRecognizedSheet,
  overrideSheetQuestion,
  recalculateSheetRecord,
} from './gradingEngine';
import {
  buildStudentRosterFromRows,
  parseCsvTable,
  parseXlsxFirstSheetRows,
} from './rosterParser';
import {
  buildGradebookXlsxBuffer,
  buildGradingArchiveZip,
} from './gradingExporter';
import { synthesizeOmrSheetImage } from './omrTestSynth';

/**
 * Chuẩn bị đề Exam Mixer Pro thực tế đã trộn 2 mã đề 101 và 102 để kiểm thử toàn bộ quy trình chấm.
 */
function buildTestExamWithTwoShuffledCodes() {
  const project = structuredClone(DEMO_MATH_EXAM);
  // Đảm bảo có đủ câu trắc nghiệm A/B/C/D để trộn khác thứ tự và khác phương án giữa mã 101 & 102
  project.mixConfig = {
    ...project.mixConfig,
    examCount: 2,
    startCodeNumber: 101,
    customCodeNames: ['101', '102'],
    shuffleQuestions: true,
    shuffleMcqOptions: true,
    seed: 'TEACHEROS-GRADING-TEST-2026',
  };
  project.confirmedOriginalAnswers = true;
  const generated = generateMixedExams(project);
  project.generatedVersions = generated.versions;
  return project;
}

const TEST_STUDENTS: StudentRecord[] = [
  { studentId: 'HS001', fullName: 'Nguyễn Minh Anh', className: '12A1', orderNumber: 1 },
  { studentId: 'HS002', fullName: 'Nguyễn Minh Anh', className: '12A1', orderNumber: 2 }, // Cố tình trùng họ tên!
  { studentId: 'HS003', fullName: 'Trần Quốc Bảo', className: '12A1', orderNumber: 3 },
];

test('0. Exam Mixer Bridge — trích xuất đúng đáp án đã đảo và chặn mã đề lỗi ánh xạ', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);

  assert.ok(keyMap['101'], 'Phải có khóa đáp án cho Mã đề 101');
  assert.ok(keyMap['102'], 'Phải có khóa đáp án cho Mã đề 102');
  assert.equal(keyMap['101'].valid, true);
  assert.equal(keyMap['102'].valid, true);
  assert.ok(keyMap['101'].autoGradableCount >= 6);
  // DEMO_MATH_EXAM có cả câu Đúng/Sai, Trả lời ngắn, Tự luận -> phải tách minh bạch không chấm tự động
  assert.ok(keyMap['101'].unsupportedCount > 0);

  // Kiểm thử chặn khi bảng đáp án bị sai lệch so với phương án đã trộn
  const brokenVersion = structuredClone(exam.generatedVersions[0]);
  const firstMcqRow = brokenVersion.answerKeyRows.find((r) => r.type === 'mcq');
  assert.ok(firstMcqRow);
  firstMcqRow.answer = firstMcqRow.answer === 'A' ? 'B' : 'A';
  const brokenKey = extractExamCodeAnswerKey(exam, brokenVersion);
  assert.equal(brokenKey.valid, false);
  assert.ok(brokenKey.blockingErrors.length > 0);
});

test('0b. Bảo mật Optical ID Code — mã hóa & giải mã chính xác, từ chối trường nhạy cảm', () => {
  const badCheck = validateOpticalIdPayload({
    v: 1,
    sid: 'S1',
    ec: '101',
    p: 1,
    // @ts-expect-error kiểm thử bảo mật cấm đưa đáp án vào mã QR/2D
    answers: 'ABCD',
  });
  assert.equal(badCheck.valid, false);

  const matrix = encodeOpticalIdMatrix({
    v: 1,
    sid: 'S1',
    ec: '101',
    st: 'HS001',
    sh: '01',
    p: 1,
  });
  const decoded = decodeOpticalIdMatrix(matrix);
  assert.equal(decoded.status, 'decoded');
  assert.equal(decoded.payload?.ec, '101');
  assert.equal(decoded.payload?.st, 'HS001');
});

test('1. Phiếu chuẩn trống hoàn toàn — nhận diện 100% blank, 0 điểm', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const qCount = keyMap['101'].autoGradableCount;

  const img = synthesizeOmrSheetImage({
    questionCount: qCount,
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
  });
  const rec = runLocalOmrVisionPipeline(img, qCount, DEFAULT_OMR_THRESHOLDS);
  assert.equal(rec.alignment.aligned, true);
  assert.equal(rec.alignment.opticalCodeStatus, 'decoded');
  assert.equal(rec.questions.every((q) => q.recognizedStatus === 'blank'), true);

  const graded = gradeRecognizedSheet({
    sheetId: 'sh-blank',
    sessionId: 'sess-1',
    fileName: 'blank.png',
    originalBlobId: 'blob-1',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.equal(graded.correctCount, 0);
  assert.equal(graded.blankCount, qCount);
  assert.equal(graded.finalScore, 0);
});

test('2. Phiếu tô đúng 100% — nhận diện trọn vẹn và đạt điểm tối đa 10/10', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = [key101.mcqAnswerByOrder[q]];
  }

  const img = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filled,
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
  });
  const rec = runLocalOmrVisionPipeline(img, qCount, DEFAULT_OMR_THRESHOLDS);
  assert.equal(rec.alignment.aligned, true);

  const graded = gradeRecognizedSheet({
    sheetId: 'sh-perfect',
    sessionId: 'sess-1',
    fileName: 'perfect.png',
    originalBlobId: 'blob-2',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.equal(graded.correctCount, qCount);
  assert.equal(graded.wrongCount, 0);
  assert.equal(graded.finalScore, 10);
  assert.equal(graded.status, 'auto-graded');
});

test('3. Phiếu tô sai toàn bộ — nhận diện đúng từng phương án sai và 0 điểm', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const wrongChoice = (c: OmrBubbleChoice): OmrBubbleChoice =>
    c === 'A' ? 'B' : 'A';
  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = [wrongChoice(key101.mcqAnswerByOrder[q])];
  }

  const img = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filled,
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS003', p: 1 },
  });
  const rec = runLocalOmrVisionPipeline(img, qCount, DEFAULT_OMR_THRESHOLDS);
  const graded = gradeRecognizedSheet({
    sheetId: 'sh-wrong',
    sessionId: 'sess-1',
    fileName: 'wrong.png',
    originalBlobId: 'blob-3',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.equal(graded.correctCount, 0);
  assert.equal(graded.wrongCount, qCount);
  assert.equal(graded.finalScore, 0);
});

test('4. Phiếu tô 2 đáp án trong cùng 1 câu — phân loại multiple và buộc REVIEW_REQUIRED', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = q === 2 ? ['A', 'C'] : [key101.mcqAnswerByOrder[q]];
  }

  const img = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filled,
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
  });
  const rec = runLocalOmrVisionPipeline(img, qCount, DEFAULT_OMR_THRESHOLDS);
  const q2 = rec.questions.find((q) => q.questionNumber === 2);
  assert.equal(q2?.recognizedStatus, 'multiple');
  assert.equal(q2?.recognizedChoice, null);
  assert.equal(q2?.needsReview, true);

  const graded = gradeRecognizedSheet({
    sheetId: 'sh-multi',
    sessionId: 'sess-1',
    fileName: 'multi.png',
    originalBlobId: 'blob-4',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.equal(graded.status, 'review-required');
  assert.equal(graded.uncertainCount, 1);
  assert.equal(graded.correctCount, qCount - 1);
});

test('5. Phiếu tô quá mờ — phân loại uncertain, KHÔNG tự đoán và buộc REVIEW_REQUIRED', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = [key101.mcqAnswerByOrder[q]];
  }

  const img = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filled,
    fillIntensityByQuestion: { 3: 0.25 }, // Vết chì rất nhạt nằm trong vùng trung gian
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
  });
  const rec = runLocalOmrVisionPipeline(img, qCount, DEFAULT_OMR_THRESHOLDS);
  const q3 = rec.questions.find((q) => q.questionNumber === 3);
  assert.equal(q3?.recognizedStatus, 'uncertain');
  assert.equal(q3?.recognizedChoice, null);
  assert.equal(q3?.needsReview, true);

  const graded = gradeRecognizedSheet({
    sheetId: 'sh-faint',
    sessionId: 'sess-1',
    fileName: 'faint.png',
    originalBlobId: 'blob-5',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.equal(graded.status, 'review-required');
  assert.equal(graded.uncertainCount, 1);
});

test('6. Ảnh nghiêng / méo phối cảnh nhẹ (4.5°) — homography nắn thẳng và chấm chính xác 100%', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = [key101.mcqAnswerByOrder[q]];
  }

  const img = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filled,
    tiltDegrees: 4.5,
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
  });
  const rec = runLocalOmrVisionPipeline(img, qCount, DEFAULT_OMR_THRESHOLDS);
  assert.equal(rec.alignment.aligned, true);
  assert.equal(rec.alignment.opticalCodeStatus, 'decoded');
  assert.equal(rec.alignment.opticalCodePayload?.ec, '101');
  assert.equal(rec.alignment.opticalCodePayload?.st, 'HS001');

  const graded = gradeRecognizedSheet({
    sheetId: 'sh-tilt',
    sessionId: 'sess-1',
    fileName: 'tilted.png',
    originalBlobId: 'blob-6',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.equal(graded.correctCount, qCount);
  assert.equal(graded.finalScore, 10);
});

test('7. Ảnh xoay 90° / 180° / 270° — tự nhận diện hướng xoay và chấm chính xác', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = [key101.mcqAnswerByOrder[q]];
  }

  for (const rot of [90, 180, 270] as const) {
    const img = synthesizeOmrSheetImage({
      questionCount: qCount,
      filledChoices: filled,
      rotateDeg: rot,
      opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
    });
    const rec = runLocalOmrVisionPipeline(img, qCount, DEFAULT_OMR_THRESHOLDS);
    assert.equal(rec.alignment.aligned, true, `Phải căn chỉnh được khi ảnh xoay ${rot}°`);
    assert.equal(rec.alignment.opticalCodeStatus, 'decoded', `Phải đọc được mã phiếu khi xoay ${rot}°`);
    const graded = gradeRecognizedSheet({
      sheetId: `sh-rot-${rot}`,
      sessionId: 'sess-1',
      fileName: `rot-${rot}.png`,
      originalBlobId: `blob-rot-${rot}`,
      recognition: rec,
      answerKeysByCode: keyMap,
      students: TEST_STUDENTS,
      gradingRule: DEFAULT_GRADING_RULE,
    });
    assert.equal(graded.correctCount, qCount, `Phải chấm đúng 100% khi xoay ${rot}°`);
    assert.equal(graded.finalScore, 10);
  }
});

test('8. Ảnh bị mờ nặng (out-of-focus blur) — phát hiện lowSharpness và chuyển REVIEW_REQUIRED', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = [key101.mcqAnswerByOrder[q]];
  }

  const blurryImg = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filled,
    blurRadius: 6,
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
  });
  const rec = runLocalOmrVisionPipeline(blurryImg, qCount, DEFAULT_OMR_THRESHOLDS);
  assert.equal(rec.alignment.lowSharpness, true);
  assert.ok(rec.alignment.sharpnessScore < DEFAULT_OMR_THRESHOLDS.minSharpnessScore);

  const graded = gradeRecognizedSheet({
    sheetId: 'sh-blur',
    sessionId: 'sess-1',
    fileName: 'blur.png',
    originalBlobId: 'blob-8',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.ok(
    graded.status === 'review-required' || graded.status === 'error',
    'Ảnh mờ tuyệt đối không được tự chốt hoàn tất'
  );
});

test('9. Mã QR/2D bị hỏng hoặc mất — hệ thống không crash, cho chọn thủ công Mã đề & HS', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key102 = keyMap['102'];
  const qCount = key102.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = [key102.mcqAnswerByOrder[q]];
  }

  const corruptedImg = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filled,
    opticalPayload: { v: 1, sid: 'S1', ec: '102', st: 'HS003', p: 1 },
    corruptOpticalCode: true,
  });
  const rec = runLocalOmrVisionPipeline(corruptedImg, qCount, DEFAULT_OMR_THRESHOLDS);
  assert.equal(rec.alignment.aligned, true);
  assert.equal(rec.alignment.opticalCodeStatus, 'corrupted');

  // Chưa chọn mã đề thủ công -> báo lỗi chưa khớp mã đề
  const initialGraded = gradeRecognizedSheet({
    sheetId: 'sh-corrupt-qr',
    sessionId: 'sess-1',
    fileName: 'corrupt-qr.png',
    originalBlobId: 'blob-9',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.equal(initialGraded.status, 'error');

  // Giáo viên chọn thủ công Mã đề 102 và HS003 -> tính điểm đúng ngay lập tức!
  const recovered = recalculateSheetRecord(
    initialGraded,
    keyMap,
    TEST_STUDENTS,
    DEFAULT_GRADING_RULE,
    { manualExamCode: '102', manualStudentId: 'HS003' }
  );
  assert.equal(recovered.examCode, '102');
  assert.equal(recovered.studentId, 'HS003');
  assert.equal(recovered.correctCount, qCount);
  assert.equal(recovered.finalScore, 10);
});

test('10. Hai mã đề 101 và 102 có đáp án đã trộn khác nhau — cùng mẫu tô cho kết quả điểm khác nhau', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const key102 = keyMap['102'];
  const qCount = key101.autoGradableCount;

  // Kiểm tra chắc chắn hai mã đề 101 & 102 có ít nhất 1 đáp án khác nhau
  let diffCount = 0;
  for (let q = 1; q <= qCount; q += 1) {
    if (key101.mcqAnswerByOrder[q] !== key102.mcqAnswerByOrder[q]) diffCount += 1;
  }
  assert.ok(diffCount > 0, 'Mã đề 101 và 102 phải có đáp án đã trộn khác nhau');

  // Tô theo đúng đáp án của Mã đề 101
  const filledAs101: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filledAs101[q] = [key101.mcqAnswerByOrder[q]];
  }

  const img101 = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filledAs101,
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
  });
  const img102 = synthesizeOmrSheetImage({
    questionCount: qCount,
    filledChoices: filledAs101,
    opticalPayload: { v: 1, sid: 'S1', ec: '102', st: 'HS002', p: 1 },
  });

  const rec101 = runLocalOmrVisionPipeline(img101, qCount, DEFAULT_OMR_THRESHOLDS);
  const rec102 = runLocalOmrVisionPipeline(img102, qCount, DEFAULT_OMR_THRESHOLDS);

  const g101 = gradeRecognizedSheet({
    sheetId: 'sh-101',
    sessionId: 'sess-1',
    fileName: 'c101.png',
    originalBlobId: 'b101',
    recognition: rec101,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  const g102 = gradeRecognizedSheet({
    sheetId: 'sh-102',
    sessionId: 'sess-1',
    fileName: 'c102.png',
    originalBlobId: 'b102',
    recognition: rec102,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });

  assert.equal(g101.correctCount, qCount);
  assert.equal(g102.correctCount, qCount - diffCount);
  assert.ok(g101.finalScore > g102.finalScore);
});

test('11. Mã học sinh không tồn tại trong lớp — cảnh báo unmatched và không tự xác nhận', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const qCount = keyMap['101'].autoGradableCount;

  const img = synthesizeOmrSheetImage({
    questionCount: qCount,
    opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS999', p: 1 },
  });
  const rec = runLocalOmrVisionPipeline(img, qCount, DEFAULT_OMR_THRESHOLDS);
  const graded = gradeRecognizedSheet({
    sheetId: 'sh-unknown-hs',
    sessionId: 'sess-1',
    fileName: 'unknown.png',
    originalBlobId: 'b11',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
    confirmedByTeacher: true, // Cố tình thử xác nhận khi chưa khớp HS -> phải từ chối!
  });

  assert.equal(graded.studentMatch.matched, false);
  assert.equal(graded.confirmedByTeacher, false);
  assert.equal(graded.status, 'review-required');
});

test('12. Hai học sinh trùng họ tên (Nguyễn Minh Anh) nhưng khác studentId — chấm & xuất tách biệt', () => {
  const csv = `STT,Mã học sinh,Họ và tên,Lớp\n1,HS001,Nguyễn Minh Anh,12A1\n2,HS002,Nguyễn Minh Anh,12A1\n3,HS001,Bản trùng mã,12A1`;
  const parsed = buildStudentRosterFromRows(parseCsvTable(csv), '12A1');
  assert.equal(parsed.students.length, 2);
  assert.equal(parsed.students[0].studentId, 'HS001');
  assert.equal(parsed.students[1].studentId, 'HS002');
  assert.equal(parsed.students[0].fullName, 'Nguyễn Minh Anh');
  assert.equal(parsed.students[1].fullName, 'Nguyễn Minh Anh');
  assert.equal(parsed.warnings.length, 1, 'Phải cảnh báo bỏ qua dòng trùng Mã học sinh HS001');

  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const allRight: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) allRight[q] = [key101.mcqAnswerByOrder[q]];

  const g1 = gradeRecognizedSheet({
    sheetId: 'sh-dupname-1',
    sessionId: 'sess-1',
    fileName: 'hs001.png',
    originalBlobId: 'b12a',
    recognition: runLocalOmrVisionPipeline(
      synthesizeOmrSheetImage({
        questionCount: qCount,
        filledChoices: allRight,
        opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
      }),
      qCount
    ),
    answerKeysByCode: keyMap,
    students: parsed.students,
    gradingRule: DEFAULT_GRADING_RULE,
  });

  const g2 = gradeRecognizedSheet({
    sheetId: 'sh-dupname-2',
    sessionId: 'sess-1',
    fileName: 'hs002.png',
    originalBlobId: 'b12b',
    recognition: runLocalOmrVisionPipeline(
      synthesizeOmrSheetImage({
        questionCount: qCount,
        opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS002', p: 1 },
      }),
      qCount
    ),
    answerKeysByCode: keyMap,
    students: parsed.students,
    gradingRule: DEFAULT_GRADING_RULE,
  });

  const checked = annotateDuplicateStudentWarnings([g1, g2]);
  assert.equal(checked[0].duplicateStudentWarning, undefined);
  assert.equal(checked[1].duplicateStudentWarning, undefined);
  assert.equal(checked[0].studentId, 'HS001');
  assert.equal(checked[1].studentId, 'HS002');
  assert.equal(checked[0].finalScore, 10);
  assert.equal(checked[1].finalScore, 0);
});

test('13. Tính điểm chính xác và quy tắc làm tròn minh bạch', () => {
  const raw = (5 / 6) * 10; // 8.333333...
  assert.equal(applyScoreRounding(raw, '0.01'), 8.33);
  assert.equal(applyScoreRounding(raw, '0.1'), 8.3);
  assert.equal(applyScoreRounding(raw, '0.25'), 8.25);
  assert.equal(applyScoreRounding(raw, '0.5'), 8.5);
  assert.equal(applyScoreRounding(raw, 'none'), 8.3333);
});

test('14. Chỉnh sửa thủ công 1 câu — lưu đủ audit log, giữ nguyên nhận diện gốc & KHÔNG đổi đáp án mã đề', () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101Before = structuredClone(keyMap['101']);
  const qCount = key101Before.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) {
    filled[q] = q === 1 ? ['A', 'B'] : [key101Before.mcqAnswerByOrder[q]];
  }

  const rec = runLocalOmrVisionPipeline(
    synthesizeOmrSheetImage({
      questionCount: qCount,
      filledChoices: filled,
      opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
    }),
    qCount
  );

  const initial = gradeRecognizedSheet({
    sheetId: 'sh-override',
    sessionId: 'sess-1',
    fileName: 'ov.png',
    originalBlobId: 'b14',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
  });
  assert.equal(initial.status, 'review-required');

  const correctQ1 = key101Before.mcqAnswerByOrder[1];
  const updated = overrideSheetQuestion(
    initial,
    1,
    correctQ1,
    'Học sinh gạch bỏ phương án sai rõ ràng',
    keyMap,
    TEST_STUDENTS,
    DEFAULT_GRADING_RULE
  );

  const q1 = updated.questions.find((q) => q.questionNumber === 1)!;
  assert.equal(q1.recognizedStatus, 'multiple', 'Phải giữ nguyên trạng thái OMR gốc');
  assert.equal(q1.recognizedChoice, null, 'Phải giữ nguyên nhận diện OMR gốc');
  assert.equal(q1.effectiveChoice, correctQ1);
  assert.equal(q1.manuallyOverridden, true);
  assert.equal(q1.overrideHistory.length, 1);
  assert.equal(q1.overrideHistory[0].reason, 'Học sinh gạch bỏ phương án sai rõ ràng');
  assert.equal(updated.correctCount, qCount);
  assert.equal(updated.finalScore, 10);
  // Đáp án gốc của mã đề tuyệt đối không thay đổi
  assert.deepEqual(keyMap['101'], key101Before);
});

test('15 & 16 & 17. Xuất Excel (.xlsx) chuẩn cột + hyperlink tương đối, đóng gói ZIP minh chứng & lưu khôi phục phiên', async () => {
  const exam = buildTestExamWithTwoShuffledCodes();
  const keyMap = buildExamAnswerKeyMap(exam);
  const key101 = keyMap['101'];
  const qCount = key101.autoGradableCount;

  const filled: Record<number, OmrBubbleChoice[]> = {};
  for (let q = 1; q <= qCount; q += 1) filled[q] = [key101.mcqAnswerByOrder[q]];

  const rec = runLocalOmrVisionPipeline(
    synthesizeOmrSheetImage({
      questionCount: qCount,
      filledChoices: filled,
      opticalPayload: { v: 1, sid: 'S1', ec: '101', st: 'HS001', p: 1 },
    }),
    qCount
  );

  const sheet1 = gradeRecognizedSheet({
    sheetId: 'sh-exp-1',
    sessionId: 'sess-export',
    fileName: 'hs001.jpg',
    originalBlobId: 'blob-orig-1',
    recognition: rec,
    answerKeysByCode: keyMap,
    students: TEST_STUDENTS,
    gradingRule: DEFAULT_GRADING_RULE,
    confirmedByTeacher: true,
  });

  const session: GradingSession = {
    id: 'sess-export',
    title: 'Chấm giữa kỳ Toán 12A1',
    examId: exam.id,
    examTitle: exam.title,
    subject: exam.subject,
    grade: exam.grade,
    className: '12A1',
    selectedExamCodes: ['101', '102'],
    omrQuestionCount: qCount,
    gradingRule: DEFAULT_GRADING_RULE,
    omrThresholds: DEFAULT_OMR_THRESHOLDS,
    students: TEST_STUDENTS,
    sheets: [sheet1],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Kiểm thử Dashboard metrics chỉ tính từ dữ liệu thật
  const metrics = computeGradingDashboardMetrics(session.sheets, 10);
  assert.equal(metrics.totalSheets, 1);
  assert.equal(metrics.confirmedCount, 1);
  assert.equal(metrics.averageScore, 10);

  // Kiểm thử 15: Xuất Excel .xlsx hợp lệ & đọc lại bằng parser XLSX
  const xlsxBytes = await buildGradebookXlsxBuffer(session);
  const parsedRows = await parseXlsxFirstSheetRows(xlsxBytes);
  assert.ok(parsedRows.length >= 4);
  const headerRow = parsedRows.find((r) => r[0] === 'STT');
  assert.ok(headerRow, 'Phải có hàng tiêu đề STT');
  assert.deepEqual(headerRow, [
    'STT',
    'Mã học sinh',
    'Họ và tên',
    'Lớp',
    'Mã đề',
    'Số câu đúng',
    'Số câu sai',
    'Số câu bỏ trống',
    'Điểm',
    'Trạng thái xác nhận',
    'Tên file ảnh minh chứng',
  ]);
  const dataRow = parsedRows[parsedRows.indexOf(headerRow) + 1];
  assert.equal(dataRow[1], 'HS001');
  assert.equal(dataRow[2], 'Nguyễn Minh Anh');
  assert.equal(dataRow[4], '101');
  assert.equal(dataRow[8], '10');
  assert.equal(dataRow[10], 'Evidence/HS001/annotated.png');

  // Kiểm tra rels hyperlink tương đối (Target tuyệt đối không chứa URL công khai http:// hay https://)
  const xlsxZip = await JSZip.loadAsync(xlsxBytes);
  const sheetRels = await xlsxZip.file('xl/worksheets/_rels/sheet1.xml.rels')?.async('string');
  assert.ok(sheetRels?.includes('Target="Evidence/HS001/annotated.png"'));
  assert.equal(sheetRels?.includes('Target="http://'), false);
  assert.equal(sheetRels?.includes('Target="https://'), false);

  // Kiểm thử 16: Xuất ZIP minh chứng đầy đủ cấu trúc
  const fakeOriginal = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const fakeAnnotated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);
  const archiveBytes = await buildGradingArchiveZip({
    session,
    answerKeysByCode: keyMap,
    evidenceProvider: {
      getOriginalBytes: async () => fakeOriginal,
      getAnnotatedBytes: async () => fakeAnnotated,
    },
  });
  const archiveZip = await JSZip.loadAsync(archiveBytes);
  assert.ok(archiveZip.file('Bang_diem.xlsx'));
  assert.ok(archiveZip.file('grading_manifest.json'));
  assert.ok(archiveZip.file('Evidence/HS001/original.jpg'));
  assert.ok(archiveZip.file('Evidence/HS001/annotated.png'));
  assert.ok(archiveZip.file('Evidence/HS001/student_report.html'));

  const manifestJson = JSON.parse(
    (await archiveZip.file('grading_manifest.json')!.async('string'))
  );
  assert.equal(manifestJson.sheets.length, 1);
  assert.equal(manifestJson.sheets[0].studentId, 'HS001');
  assert.equal(manifestJson.sheets[0].finalScore, 10);

  // Kiểm thử 17: Tuần tự hóa & khôi phục phiên làm việc (persistence round-trip)
  const serialized = JSON.stringify(session);
  const restored = JSON.parse(serialized) as GradingSession;
  assert.equal(restored.id, session.id);
  assert.equal(restored.sheets.length, 1);
  assert.equal(restored.sheets[0].studentId, 'HS001');
  assert.equal(restored.sheets[0].finalScore, 10);
});

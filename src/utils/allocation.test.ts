import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateQuestions,
  allocateThreeWorksheets,
  calculateActivityMinutes,
  countAvailableByTier,
  generateNextQuestionCode,
  normalizeWorksheetVariants,
  validateStep1,
  validateStep3,
  validateStep4,
} from './allocation';
import { LessonPack, QuestionItem, RubricCriterion } from '../types/lesson';

const SAMPLE_QUESTIONS: QuestionItem[] = [
  { id: 'q1', code: 'CB-01', tier: 'basic', prompt: 'Câu cơ bản 1: Nhận biết dấu tiếng Việt ă â đ ê ô ơ ư.', answerGuide: 'Đáp án 1', points: 1.5 },
  { id: 'q2', code: 'CB-02', tier: 'basic', prompt: 'Câu cơ bản 2: Tính giá trị biểu thức.', answerGuide: '', points: 1.5 },
  { id: 'q3', code: 'VD-01', tier: 'applied', prompt: 'Câu vận dụng 1: Giải quyết tình huống thực tế dài nhiều dòng.', answerGuide: 'Đáp án 3', points: 3 },
  { id: 'q4', code: 'MR-01', tier: 'extended', prompt: 'Câu mở rộng 1: Khái quát hóa bài toán tổng quát.', answerGuide: 'Đáp án 4', points: 4 },
];

function makeCriterion(id: string, name: string, weightPercent: number): RubricCriterion {
  return {
    id,
    name,
    weightPercent,
    levels: {
      needsSupport: 'Chưa đạt yêu cầu cơ bản.',
      meets: 'Đạt mức chuẩn.',
      exceeds: 'Vượt mức mong đợi.',
    },
  };
}

test('allocateQuestions phân bổ đúng số lượng theo Cơ bản / Vận dụng / Mở rộng', () => {
  const result = allocateQuestions(SAMPLE_QUESTIONS, { basic: 1, applied: 1, extended: 1 });
  assert.equal(result.totalQuestions, 3);
  assert.deepEqual(result.actualCounts, { basic: 1, applied: 1, extended: 1 });
  assert.equal(result.orderedQuestions.map((q) => q.code).join(','), 'CB-01,VD-01,MR-01');
  assert.equal(result.totalPoints, 8.5);
  assert.equal(result.warnings.length, 0);
});

test('allocateQuestions thông báo thiếu rõ ràng và KHÔNG tự tạo câu giả khi vượt ngân hàng', () => {
  const result = allocateQuestions(SAMPLE_QUESTIONS, { basic: 3, applied: 2, extended: 0 });
  assert.equal(result.totalQuestions, 3);
  assert.deepEqual(result.actualCounts, { basic: 2, applied: 1, extended: 0 });
  assert.deepEqual(result.shortfalls, { basic: 1, applied: 1, extended: 0 });
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /không tự tạo câu giả/);
  assert.match(result.warnings[1], /Vận dụng/);
});

test('allocateThreeWorksheets phân bổ độc lập cho 3 mẫu phiếu A, B, C', () => {
  const variants = normalizeWorksheetVariants({
    distribution: { basic: 2, applied: 1, extended: 1 },
    worksheetVariants: [
      { id: 'A', label: 'Phiếu A', distribution: { basic: 2, applied: 0, extended: 0 } },
      { id: 'B', label: 'Phiếu B', distribution: { basic: 1, applied: 1, extended: 0 } },
      { id: 'C', label: 'Phiếu C', distribution: { basic: 1, applied: 1, extended: 2 } },
    ],
  });
  const results = allocateThreeWorksheets(SAMPLE_QUESTIONS, variants);
  assert.equal(results.length, 3);
  assert.equal(results[0].allocated.totalQuestions, 2);
  assert.equal(results[1].allocated.totalQuestions, 2);
  // Phiếu C yêu cầu 2 Mở rộng nhưng chỉ có 1 -> chỉ lấy 1, không tạo câu giả
  assert.equal(results[2].allocated.totalQuestions, 3);
  assert.equal(results[2].allocated.shortfalls.extended, 1);
});

test('generateNextQuestionCode sinh mã riêng không trùng theo mức độ', () => {
  assert.equal(generateNextQuestionCode(SAMPLE_QUESTIONS, 'basic'), 'CB-03');
  assert.equal(generateNextQuestionCode(SAMPLE_QUESTIONS, 'applied'), 'VD-02');
  assert.equal(generateNextQuestionCode(SAMPLE_QUESTIONS, 'extended'), 'MR-02');
});

test('countAvailableByTier và calculateActivityMinutes tính chính xác', () => {
  assert.deepEqual(countAvailableByTier(SAMPLE_QUESTIONS), { basic: 2, applied: 1, extended: 1 });
  const total = calculateActivityMinutes({
    activities: [
      { id: 'a1', templateId: null, title: 'Khởi động', durationMinutes: 6, grouping: 'Lớp', instructions: 'x', studentTask: 'y', teacherNote: '' },
      { id: 'a2', templateId: null, title: 'Thảo luận', durationMinutes: 14, grouping: 'Nhóm', instructions: 'x', studentTask: 'y', teacherNote: '' },
    ],
  });
  assert.equal(total, 20);
});

test('validateStep1 bắt buộc đầy đủ môn, khối, chủ đề, thời lượng và mục tiêu', () => {
  const emptyPack: LessonPack = {
    id: 'p1',
    title: '',
    subject: '',
    grade: '',
    duration: 45,
    objectives: [''],
    activities: [],
    questions: [],
    distribution: { basic: 1, applied: 0, extended: 0 },
    rubric: [],
    status: 'draft',
    isDemo: false,
    lastStep: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const errors = validateStep1(emptyPack);
  assert.ok(errors.subject);
  assert.ok(errors.grade);
  assert.ok(errors.title);
  assert.ok(errors.objectives);
});

test('validateStep3 phát hiện trùng mã riêng hoặc cả 3 phiếu đều 0 câu', () => {
  const dupCodeQuestions: QuestionItem[] = [
    { ...SAMPLE_QUESTIONS[0] },
    { ...SAMPLE_QUESTIONS[1], code: 'CB-01' },
  ];
  const pack: LessonPack = {
    id: 'p2',
    title: 'Bài thử nghiệm',
    subject: 'Toán học',
    grade: 'Lớp 8',
    duration: 45,
    objectives: ['Mục tiêu 1'],
    activities: [],
    questions: dupCodeQuestions,
    distribution: { basic: 0, applied: 0, extended: 0 },
    worksheetVariants: [
      { id: 'A', label: 'Phiếu A', distribution: { basic: 0, applied: 0, extended: 0 } },
      { id: 'B', label: 'Phiếu B', distribution: { basic: 0, applied: 0, extended: 0 } },
      { id: 'C', label: 'Phiếu C', distribution: { basic: 0, applied: 0, extended: 0 } },
    ],
    rubric: [],
    status: 'draft',
    isDemo: false,
    lastStep: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const errors = validateStep3(pack);
  assert.ok(errors['question_q2_code']);
  assert.ok(errors.distribution);
});

test('validateStep4 bắt buộc 3–5 tiêu chí và đủ mô tả 3 mức đạt', () => {
  const basePack: LessonPack = {
    id: 'p3',
    title: 'Bài rubric',
    subject: 'Ngữ văn',
    grade: 'Lớp 9',
    duration: 45,
    objectives: ['Mục tiêu'],
    activities: [],
    questions: SAMPLE_QUESTIONS,
    distribution: { basic: 1, applied: 0, extended: 0 },
    rubric: [makeCriterion('r1', 'Tiêu chí 1', 50), makeCriterion('r2', 'Tiêu chí 2', 50)],
    status: 'draft',
    isDemo: false,
    lastStep: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 2 tiêu chí -> lỗi (< 3)
  const err2 = validateStep4(basePack);
  assert.ok(err2.rubric);

  // 3 tiêu chí hợp lệ -> không lỗi
  basePack.rubric = [
    makeCriterion('r1', 'Tiêu chí 1', 40),
    makeCriterion('r2', 'Tiêu chí 2', 30),
    makeCriterion('r3', 'Tiêu chí 3', 30),
  ];
  const ok3 = validateStep4(basePack);
  assert.equal(Object.keys(ok3).length, 0);

  // 6 tiêu chí -> lỗi (> 5)
  basePack.rubric.push(
    makeCriterion('r4', 'Tiêu chí 4', 0),
    makeCriterion('r5', 'Tiêu chí 5', 0),
    makeCriterion('r6', 'Tiêu chí 6', 0)
  );
  const err6 = validateStep4(basePack);
  assert.ok(err6.rubric);
});

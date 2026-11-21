import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  buildPreferredTargetKey,
  evaluateStep2ToStep3Transition,
  evaluateStepNavigationGuard,
  resolvePreferredTargetNavigation,
} from './examMixerNavigation';
import {
  applyTeacherManualAnswer,
  computeQuestionVerificationContentHash,
  createMathVisualAsset,
  parseMathContent,
} from './mathIntegrity';
import { importUniversalExamFile } from './universalImportEngine';
import { createEmptyMathExamProject, createEmptyMathQuestion } from '../data/demoMathExams';
import type { MathExamProject } from '../types/mathExam';

let idSeq = 1;
const nextId = (prefix = 'nav') => `${prefix}-${idSeq++}`;

async function buildDocxFixture(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bodyXml = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
    .join('');

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`
  );

  return zip.generateAsync({ type: 'uint8array' });
}

function makeValidDocxExam(confirmed = true): MathExamProject {
  const project = createEmptyMathExamProject(nextId);
  project.id = 'exam-docx-nav-1';
  project.title = 'Đề Toán 12 — Kiểm thử chuyển Bước 2 sang Bước 3';

  const q1 = createEmptyMathQuestion('mcq', 1, nextId);
  q1.id = 'q-imp-01';
  q1.code = 'IMP-01';
  q1.stem = parseMathContent(
    'Tính tích phân $I = \\int_0^1 x^2\\,dx$ dựa vào đồ thị hàm số kèm theo.'
  );
  q1.options = [
    { id: 'opt-1a', originalLabel: 'A', content: parseMathContent('$\\frac{1}{3}$'), isCorrect: true },
    { id: 'opt-1b', originalLabel: 'B', content: parseMathContent('$\\frac{1}{2}$'), isCorrect: false },
    { id: 'opt-1c', originalLabel: 'C', content: parseMathContent('$1$'), isCorrect: false },
    { id: 'opt-1d', originalLabel: 'D', content: parseMathContent('$\\frac{2}{3}$'), isCorrect: false },
  ];
  q1.correctOptionId = 'opt-1a';
  q1.visualAssets = [
    createMathVisualAsset({
      id: 'asset-graph-1',
      kind: 'geometry-svg',
      label: 'Đồ thị parabol y = x^2',
      sourceData: '<svg viewBox="0 0 100 100"><path d="M 10 90 Q 50 10 90 90" /></svg>',
      altText: 'Hình 1',
    }),
  ];

  const q2 = createEmptyMathQuestion('mcq', 2, nextId);
  q2.id = 'q-imp-02';
  q2.code = 'IMP-02';
  q2.stem = parseMathContent('Đạo hàm của hàm số $y = x^3 - 3x$ là:');
  q2.options = [
    { id: 'opt-2a', originalLabel: 'A', content: parseMathContent("$y' = 3x^2 - 3$"), isCorrect: true },
    { id: 'opt-2b', originalLabel: 'B', content: parseMathContent("$y' = 3x^2 + 3$"), isCorrect: false },
    { id: 'opt-2c', originalLabel: 'C', content: parseMathContent("$y' = x^2 - 3$"), isCorrect: false },
    { id: 'opt-2d', originalLabel: 'D', content: parseMathContent("$y' = 3x - 3$"), isCorrect: false },
  ];
  q2.correctOptionId = 'opt-2a';

  const now = new Date().toISOString();
  if (confirmed) {
    q1.answerConfirmed = true;
    q1.answerProvenance = {
      status: 'teacher-confirmed',
      sourceKind: 'teacher-manual',
      confirmedAt: now,
      confirmedContentHash: computeQuestionVerificationContentHash(q1),
    };
    q2.answerConfirmed = true;
    q2.answerProvenance = {
      status: 'teacher-confirmed',
      sourceKind: 'teacher-manual',
      confirmedAt: now,
      confirmedContentHash: computeQuestionVerificationContentHash(q2),
    };
  } else {
    q1.answerConfirmed = false;
    q1.answerProvenance = { status: 'missing' };
    q2.answerConfirmed = false;
    q2.answerProvenance = { status: 'missing' };
  }

  project.questions = [q1, q2];
  project.confirmedOriginalAnswers = confirmed;
  return project;
}

describe('Exam Mixer Pro — Step 2 -> Step 3 Navigation & Anti-Bounce Regression', () => {
  it('KHÔNG tự động quay lại Bước 2 sau khi đã tiêu thụ preferredStep=2 và mathExams cập nhật bất đồng bộ', () => {
    const initialExam = makeValidDocxExam(false);
    let lastConsumedKey: string | null = null;

    // 1) Người dùng mở Exam Mixer Pro từ Smart Action Bar / Workflow với preferredStep = 2
    const firstResolve = resolvePreferredTargetNavigation({
      target: {
        requestId: 1,
        examId: initialExam.id,
        step: 2,
        step2SubView: 'editor',
        examCode: null,
      },
      lastConsumedTargetKey: lastConsumedKey,
      mathExams: [initialExam],
      currentSelectedExamId: initialExam.id,
    });

    assert.equal(firstResolve.action, 'apply');
    assert.equal(firstResolve.nextStep, 2);
    assert.equal(firstResolve.shouldClearPreferredTarget, true);
    lastConsumedKey = firstResolve.targetKey;

    // 2) Giáo viên xác nhận đáp án gốc -> optimistic update + chuyển sang Bước 3
    const confirmedExam: MathExamProject = {
      ...makeValidDocxExam(true),
      id: initialExam.id,
      updatedAt: new Date(Date.now() + 100).toISOString(),
    };
    const transition = evaluateStep2ToStep3Transition(confirmedExam);
    assert.equal(transition.allowed, true);

    // 3) IndexedDB listMathExams() hoàn tất bất đồng bộ (tạo mảng mathExams mới),
    // ngay cả khi props chưa kịp clear về null ở cùng tick render
    const afterAsyncIndexedDbSave = resolvePreferredTargetNavigation({
      target: {
        requestId: 1,
        examId: initialExam.id,
        step: 2,
        step2SubView: 'editor',
        examCode: null,
      },
      lastConsumedTargetKey: lastConsumedKey,
      mathExams: [confirmedExam],
      currentSelectedExamId: confirmedExam.id,
    });

    assert.equal(
      afterAsyncIndexedDbSave.action,
      'noop',
      'Cập nhật mathExams bất đồng bộ KHÔNG ĐƯỢC kéo người dùng từ Bước 3 quay ngược về Bước 2'
    );

    // 4) Giáo viên đổi số mã đề trên Bước 3 (mathExams đổi reference lần nữa)
    const editedMixConfigExam: MathExamProject = {
      ...confirmedExam,
      mixConfig: { ...confirmedExam.mixConfig, examCount: 8 },
      updatedAt: new Date(Date.now() + 200).toISOString(),
    };
    const afterStep3OptionEdit = resolvePreferredTargetNavigation({
      target: {
        requestId: 1,
        examId: initialExam.id,
        step: 2,
        step2SubView: 'editor',
        examCode: null,
      },
      lastConsumedTargetKey: lastConsumedKey,
      mathExams: [editedMixConfigExam],
      currentSelectedExamId: editedMixConfigExam.id,
    });

    assert.equal(afterStep3OptionEdit.action, 'noop');
  });

  it('áp dụng lại đúng 1 lần khi có yêu cầu điều hướng mới (requestId tăng)', () => {
    const exam = makeValidDocxExam(true);
    const key1 = buildPreferredTargetKey({ requestId: 1, examId: exam.id, step: 2 });

    const newNav = resolvePreferredTargetNavigation({
      target: { requestId: 2, examId: exam.id, step: 3, step2SubView: null, examCode: null },
      lastConsumedTargetKey: key1,
      mathExams: [exam],
      currentSelectedExamId: exam.id,
    });

    assert.equal(newNav.action, 'apply');
    assert.equal(newNav.nextStep, 3);
    assert.equal(newNav.shouldClearPreferredTarget, true);

    const repeatSameRequest = resolvePreferredTargetNavigation({
      target: { requestId: 2, examId: exam.id, step: 3, step2SubView: null, examCode: null },
      lastConsumedTargetKey: newNav.targetKey,
      mathExams: [{ ...exam, updatedAt: new Date(Date.now() + 500).toISOString() }],
      currentSelectedExamId: exam.id,
    });

    assert.equal(repeatSameRequest.action, 'noop');
  });

  it('không phát lại request đã nhận khi cùng ID có nội dung khác', () => {
    const exam = makeValidDocxExam(true);
    const consumed = buildPreferredTargetKey({ requestId: 5, examId: exam.id, step: 2 });
    const resolution = resolvePreferredTargetNavigation({
      target: { requestId: 5, examId: exam.id, step: 4 },
      lastConsumedTargetKey: consumed,
      mathExams: [exam],
      currentSelectedExamId: exam.id,
    });
    assert.equal(resolution.action, 'noop');
  });

  it('cho phép Bước 2 -> Bước 3 -> Bước 2 -> Bước 3 ổn định và bảo toàn toàn bộ câu hỏi, đáp án, công thức và hình ảnh', () => {
    const exam = makeValidDocxExam(true);
    const snapshotBefore = JSON.stringify({
      questionCount: exam.questions.length,
      stems: exam.questions.map((q) => q.stem.rawSource),
      correctOptionIds: exam.questions.map((q) => q.options?.find((o) => o.isCorrect)?.id),
      visualAssetIds: exam.questions.map((q) => q.visualAssets?.map((a) => a.id) ?? []),
    });

    const step2To3 = evaluateStepNavigationGuard(exam, 2, 3);
    assert.equal(step2To3.allowed, true);

    const step3To2 = evaluateStepNavigationGuard(exam, 3, 2);
    assert.equal(step3To2.allowed, true);

    const step2To3Again = evaluateStepNavigationGuard(exam, 2, 3);
    assert.equal(step2To3Again.allowed, true);

    const snapshotAfter = JSON.stringify({
      questionCount: exam.questions.length,
      stems: exam.questions.map((q) => q.stem.rawSource),
      correctOptionIds: exam.questions.map((q) => q.options?.find((o) => o.isCorrect)?.id),
      visualAssetIds: exam.questions.map((q) => q.visualAssets?.map((a) => a.id) ?? []),
    });

    assert.equal(snapshotAfter, snapshotBefore);
  });

  it('luồng thực tế từ DOCX: chặn thiếu khóa đáp án -> chọn thủ công -> nhắc xác nhận -> xác nhận -> sang Bước 3 thành công', async () => {
    const docxBytes = await buildDocxFixture([
      'Câu 1. Tính tích phân $I = \\int_0^1 x^2\\,dx$.',
      'A. $\\frac{1}{3}$',
      'B. $\\frac{1}{2}$',
      'C. $1$',
      'D. $\\frac{2}{3}$',
      'Câu 2. Đạo hàm của hàm số $y = x^3 - 3x$ là:',
      "A. $y' = 3x^2 - 3$",
      "B. $y' = 3x^2 + 3$",
      "C. $y' = x^2 - 3$",
      "D. $y' = 3x - 3$",
    ]);

    const imported = await importUniversalExamFile(
      {
        fileName: 'de_toan_12_khong_dap_an.docx',
        buffer: docxBytes,
      },
      nextId
    );

    assert.equal(imported.questions.length, 2);

    const exam = createEmptyMathExamProject(nextId);
    exam.questions = imported.questions;
    exam.confirmedOriginalAnswers = false;

    // 1) Chưa chọn đáp án -> Integrity Gate CHẶN và chỉ rõ mã câu hỏi (IMP-01)
    const missingKeyCheck = evaluateStep2ToStep3Transition(exam);
    assert.equal(missingKeyCheck.allowed, false);
    assert.equal(missingKeyCheck.reasonCode, 'integrity-blocked');
    assert.ok(missingKeyCheck.blockingIssues.length >= 2);
    assert.equal(missingKeyCheck.firstBlockingQuestionId, exam.questions[0].id);
    assert.match(missingKeyCheck.title, /Chưa thể sang Bước 3/i);
    assert.match(missingKeyCheck.message, /IMP-01/);

    // 2) Giáo viên chọn đáp án đúng cho cả 2 câu nhưng CHƯA bấm "Xác nhận toàn bộ đáp án gốc"
    exam.questions = exam.questions.map((q) =>
      applyTeacherManualAnswer(q, {
        ...q,
        correctOptionId: q.options?.[0]?.id,
        options: q.options?.map((o, idx) => ({ ...o, isCorrect: idx === 0 })),
      })
    );

    const unconfirmedCheck = evaluateStep2ToStep3Transition(exam);
    assert.equal(unconfirmedCheck.allowed, false);
    assert.equal(unconfirmedCheck.reasonCode, 'answers-unconfirmed');
    assert.match(unconfirmedCheck.title, /Chưa xác nhận toàn bộ đáp án gốc/i);
    assert.match(unconfirmedCheck.message, /Xác nhận toàn bộ đáp án gốc/i);

    // 3) Bấm xác nhận toàn bộ -> đủ điều kiện sang Bước 3
    exam.confirmedOriginalAnswers = true;
    const readyCheck = evaluateStep2ToStep3Transition(exam);
    assert.equal(readyCheck.allowed, true);
    assert.equal(readyCheck.reasonCode, 'ok');
  });

  it('chặn sang Bước 3 và chỉ rõ câu hỏi khi có phương án rỗng', () => {
    const exam = makeValidDocxExam(true);
    exam.questions[1] = {
      ...exam.questions[1],
      options: exam.questions[1].options!.map((o) =>
        o.originalLabel === 'C' ? { ...o, content: parseMathContent('') } : o
      ),
    };

    const result = evaluateStep2ToStep3Transition(exam);
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'integrity-blocked');
    assert.equal(result.firstBlockingQuestionId, 'q-imp-02');
    assert.match(result.message, /IMP-02/);
  });

  it('chặn sang Bước 3 với thông báo rõ ràng khi đề gốc chưa có câu hỏi nào', () => {
    const emptyExam = makeValidDocxExam(true);
    emptyExam.questions = [];

    const result = evaluateStep2ToStep3Transition(emptyExam);
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'no-questions');
    assert.match(result.title, /chưa có câu hỏi/i);
  });
});

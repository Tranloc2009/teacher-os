import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import type { MathExamProject, MathQuestion } from '../types/mathExam';
import {
  applyTeacherManualAnswer,
  checkExamExportGate,
  computeLockStats,
  evaluatePreMixIntegrity,
  evaluateQuestionAnswerState,
  parseMathContent,
} from './mathIntegrity';
import { generateMixedExams } from './mathShuffleEngine';
import { importUniversalExamFile } from './universalImportEngine';
import { mapToReliabilityAnswerStatus } from './answerKeyRecovery';
import { normalizeMathExamProject } from '../db/database';

let idSeq = 0;
function makeTestId(prefix = 't'): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

async function buildMinimalDocxBuffer(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const escapeXml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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

function wrapQuestionsIntoProject(questions: MathQuestion[], title = 'Đề kiểm thử khóa thủ công'): MathExamProject {
  const now = '2026-05-01T08:00:00.000Z';
  return {
    id: makeTestId('mexam'),
    title,
    subject: 'Toán học',
    subjectId: 'toan',
    grade: 'Lớp 12',
    durationMinutes: 45,
    schoolYear: '2025-2026',
    examTypeLabel: 'Kiểm tra học kỳ II',
    lastStep: 1,
    isDemo: false,
    status: 'draft',
    confirmedOriginalAnswers: false,
    questions,
    questionGroups: [],
    mixConfig: {
      level: 2,
      examCount: 4,
      startCodeNumber: 101,
      customCodeNames: ['101', '102', '103', '104'],
      seed: 'manual-answer-regression-2026',
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
  };
}

function selectMcqOptionByLabel(q: MathQuestion, label: 'A' | 'B' | 'C' | 'D'): MathQuestion {
  const target = (q.options ?? []).find((o) => o.originalLabel === label);
  assert.ok(target, `Option ${label} must exist on ${q.code}`);
  return applyTeacherManualAnswer(
    q,
    {
      ...q,
      correctOptionId: target.id,
      options: (q.options ?? []).map((item) => ({
        ...item,
        isCorrect: item.id === target.id,
      })),
    },
    {
      now: '2026-05-01T09:00:00.000Z',
      sourceLocation: 'Trình sửa câu hỏi (Bước 1)',
      selectionSummary: `Phương án ${label}`,
    }
  );
}

test('Case 1: DOCX import without key (IMP-01..IMP-15) -> select A (index 0) clears IMP-01 error, decrements missingKeyCount by 1, survives re-check', async () => {
  const paragraphs: string[] = [];
  for (let i = 1; i <= 15; i++) {
    paragraphs.push(`Câu ${i}: Giá trị của biểu thức $x + ${i}$ khi $x = 1$ bằng bao nhiêu?`);
    paragraphs.push(`A. ${i + 1}`);
    paragraphs.push(`B. ${i + 2}`);
    paragraphs.push(`C. ${i + 3}`);
    paragraphs.push(`D. ${i + 4}`);
  }
  const buffer = await buildMinimalDocxBuffer(paragraphs);
  const imported = await importUniversalExamFile(
    { fileName: 'de-toan-15-cau-khong-khoa.docx', buffer },
    makeTestId
  );
  assert.equal(imported.questions.length, 15);
  assert.equal(imported.questions[0].code, 'IMP-01');

  const initialExam = wrapQuestionsIntoProject(imported.questions, 'Đề 15 câu thiếu khóa');
  const beforeReport = evaluatePreMixIntegrity(initialExam);
  const beforeImp01Errors = beforeReport.issues.filter(
    (issue) => issue.questionId === initialExam.questions[0].id && issue.severity === 'error'
  );

  // Initially IMP-01 must report exactly 1 missing-key error (no duplicate mcq-answer- error)
  assert.equal(beforeImp01Errors.length, 1);
  assert.ok(beforeImp01Errors[0].id.startsWith('q-prov-missing-'));
  assert.equal(beforeReport.stats.missingKeyCount, 15);
  assert.equal(computeLockStats(initialExam).missingKeyCount, 15);

  // Select option A (index 0) on IMP-01
  const origFileHash = initialExam.questions[0].answerProvenance?.sourceFileHash ?? initialExam.questions[0].sourceTrace?.sourceFileHash;
  const origLocation = initialExam.questions[0].answerProvenance?.sourceLocation;
  const updatedImp01 = selectMcqOptionByLabel(initialExam.questions[0], 'A');
  const afterExam: MathExamProject = {
    ...initialExam,
    questions: [updatedImp01, ...initialExam.questions.slice(1)],
  };

  // Option A (index 0) is valid and NOT treated as falsy/missing
  const evalImp01 = evaluateQuestionAnswerState(updatedImp01);
  assert.equal(evalImp01.hasValidAnswer, true);
  assert.equal(evalImp01.isMissingKey, false);
  assert.equal(evalImp01.structural.selectedOptionIndex, 0);
  assert.equal(evalImp01.effectiveStatus, 'teacher-confirmed');
  assert.equal(updatedImp01.answerProvenance?.sourceKind, 'teacher-manual');
  assert.equal(updatedImp01.answerProvenance?.sourceFileHash, origFileHash);
  assert.equal(updatedImp01.answerProvenance?.sourceLocation, origLocation);
  assert.equal(mapToReliabilityAnswerStatus(updatedImp01), 'TEACHER_CONFIRMED');

  const afterReport = evaluatePreMixIntegrity(afterExam);
  const afterImp01Errors = afterReport.issues.filter(
    (issue) => issue.questionId === updatedImp01.id && issue.severity === 'error'
  );
  assert.equal(afterImp01Errors.length, 0, 'IMP-01 error must disappear immediately after selecting A');
  assert.equal(afterReport.stats.missingKeyCount, 14, 'Missing-key count must decrement from 15 to 14');
  assert.equal(computeLockStats(afterExam).missingKeyCount, 14);

  // Running manual "Kiểm tra toàn vẹn" again must NOT resurrect IMP-01 error
  const recheckReport = evaluatePreMixIntegrity(afterExam);
  assert.equal(
    recheckReport.issues.filter((i) => i.questionId === updatedImp01.id && i.severity === 'error').length,
    0
  );
  assert.equal(recheckReport.stats.missingKeyCount, 14);
});

test('Case 2: Switch IMP-01 A -> C, persist & reload, shuffle unlocked options -> exported key matches original option C content', async () => {
  const paragraphs = [
    'Câu 1: Nghiệm của phương trình $2x - 6 = 0$ là gì?',
    'A. $x = 1$',
    'B. $x = 2$',
    'C. $x = 3$',
    'D. $x = 4$',
    'Câu 2: Đạo hàm của hàm số $y = x^2$ là gì?',
    'A. $y\' = 2x$',
    'B. $y\' = x$',
    'C. $y\' = x^2$',
    'D. $y\' = 2$',
  ];
  const buffer = await buildMinimalDocxBuffer(paragraphs);
  const imported = await importUniversalExamFile(
    { fileName: 'de-2-cau-doi-dap-an.docx', buffer },
    makeTestId
  );

  // Select A then switch to C on IMP-01; select A on IMP-02
  const imp01WithA = selectMcqOptionByLabel(imported.questions[0], 'A');
  const imp01WithC = selectMcqOptionByLabel(imp01WithA, 'C');
  const imp02WithA = selectMcqOptionByLabel(imported.questions[1], 'A');

  const optionCOriginalId = imp01WithC.options!.find((o) => o.originalLabel === 'C')!.id;
  const optionCOriginalContent = imp01WithC.options!.find((o) => o.id === optionCOriginalId)!.content.rawSource;

  assert.equal(imp01WithC.correctOptionId, optionCOriginalId);
  assert.equal(imp01WithC.answerProvenance?.status, 'teacher-confirmed', 'Switching A -> C must stay teacher-confirmed, not needs-review');

  // Simulate save & reload via JSON serialization + normalizeMathExamProject
  const savedDraft = wrapQuestionsIntoProject([imp01WithC, imp02WithA], 'Đề kiểm thử A->C');
  savedDraft.confirmedOriginalAnswers = true;
  const reloadedExam = normalizeMathExamProject(JSON.parse(JSON.stringify(savedDraft)) as MathExamProject);

  const reloadedImp01 = reloadedExam.questions.find((q) => q.code === 'IMP-01')!;
  assert.equal(reloadedImp01.correctOptionId, optionCOriginalId);
  assert.equal(evaluateQuestionAnswerState(reloadedImp01).hasValidAnswer, true);
  assert.equal(evaluatePreMixIntegrity(reloadedExam).status, 'PASS');

  // Shuffle with unlocked options across multiple codes
  reloadedExam.mixConfig.examCount = 6;
  reloadedExam.mixConfig.customCodeNames = ['101', '102', '103', '104', '105', '106'];
  reloadedExam.mixConfig.shuffleMcqOptions = true;
  reloadedExam.questions.forEach((q) => {
    q.lockOptionShuffle = false;
  });

  const mixed = generateMixedExams(reloadedExam);
  assert.equal(mixed.errors.length, 0, `Shuffle errors: ${mixed.errors.join('; ')}`);
  assert.equal(mixed.versions.length, 6);

  let sawShuffledPositionDifferentFromC = false;
  for (const version of mixed.versions) {
    assert.equal(version.integrityPassed, true);
    const mixedImp01 = version.questions.find((q) => q.id === reloadedImp01.id)!;
    const keyRow = version.answerKeyRows.find((row) => row.questionId === reloadedImp01.id)!;
    const mapping = version.permutationMap.find((m) => m.questionId === reloadedImp01.id)!;

    assert.equal(keyRow.answer, mapping.newCorrectLabel);
    const labelIndex = ['A', 'B', 'C', 'D'].indexOf(keyRow.answer);
    assert.ok(labelIndex >= 0, `Exported key label must be A..D, got ${keyRow.answer}`);
    const optionAtKeyPos = mixedImp01.options![labelIndex];
    assert.equal(optionAtKeyPos.id, optionCOriginalId);
    assert.equal(
      optionAtKeyPos.content.rawSource,
      optionCOriginalContent,
      `Code ${version.code}: exported key ${keyRow.answer} must point to original option C content`
    );
    if (keyRow.answer !== 'C') {
      sawShuffledPositionDifferentFromC = true;
    }
  }
  assert.ok(sawShuffledPositionDifferentFromC, 'At least one shuffled code should move option C to a different letter');
});

test('Case 3: Independent errors (missing key + empty content) remain blocked; fixing sole IMP-01 missing key unblocks shuffle & export', async () => {
  const paragraphs = [
    'Câu 1: Tìm tập xác định của hàm số $y = \\ln(x - 1)$.',
    'A. $(1; +\\infty)$',
    'B. $[1; +\\infty)$',
    'C. $(0; +\\infty)$',
    'D. $\\mathbb{R}$',
    'Câu 2: Đạo hàm của $\\sin x$ là gì?',
    'A. $\\cos x$',
    'B. $-\\cos x$',
    'C. $\\sin x$',
    'D. $-\\sin x$',
    'Câu 3: Câu hỏi có phương án rỗng để kiểm thử lỗi độc lập.',
    'A. Đáp án 1',
    'B. Đáp án 2',
    'C. Đáp án 3',
    'D. Đáp án 4',
  ];
  const buffer = await buildMinimalDocxBuffer(paragraphs);
  const imported = await importUniversalExamFile(
    { fileName: 'de-3-cau-loi-hon-hop.docx', buffer },
    makeTestId
  );

  // IMP-01: fix answer A; IMP-02: keep missing key; IMP-03: give valid answer A but empty option B content
  const imp01Fixed = selectMcqOptionByLabel(imported.questions[0], 'A');
  const imp02Missing = imported.questions[1];
  const imp03WithEmptyOpt = selectMcqOptionByLabel(imported.questions[2], 'A');
  imp03WithEmptyOpt.options![1].content = parseMathContent('', `${imp03WithEmptyOpt.id}-opt-empty`);

  const mixedErrorsExam = wrapQuestionsIntoProject([imp01Fixed, imp02Missing, imp03WithEmptyOpt], 'Đề lỗi độc lập');
  mixedErrorsExam.confirmedOriginalAnswers = true;

  const report = evaluatePreMixIntegrity(mixedErrorsExam);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.stats.missingKeyCount, 1, 'Only IMP-02 is missing key');
  assert.equal(
    report.issues.filter((i) => i.questionId === imp01Fixed.id && i.severity === 'error').length,
    0,
    'IMP-01 must have 0 errors'
  );
  assert.equal(
    report.issues.filter((i) => i.questionId === imp02Missing.id && i.severity === 'error').length,
    1,
    'IMP-02 must report exactly 1 missing-key error'
  );
  assert.ok(
    report.issues.some((i) => i.questionId === imp03WithEmptyOpt.id && i.id.startsWith('mcq-opt-empty-')),
    'IMP-03 empty option content error must still be reported'
  );
  assert.equal(checkExamExportGate(mixedErrorsExam).canExport, false);

  // Separate exam whose ONLY issue was IMP-01 missing key -> selecting A unblocks shuffle & export gate
  const singleIssueExam = wrapQuestionsIntoProject([imported.questions[0]], 'Đề chỉ thiếu IMP-01');
  assert.equal(evaluatePreMixIntegrity(singleIssueExam).status, 'BLOCKED');
  assert.equal(generateMixedExams(singleIssueExam).errors.length > 0, true);

  const singleFixedExam: MathExamProject = {
    ...singleIssueExam,
    questions: [selectMcqOptionByLabel(imported.questions[0], 'A')],
    confirmedOriginalAnswers: true,
    mixConfig: {
      ...singleIssueExam.mixConfig,
      examCount: 2,
      customCodeNames: ['101', '102'],
    },
  };
  assert.equal(evaluatePreMixIntegrity(singleFixedExam).status, 'PASS');
  const mixRes = generateMixedExams(singleFixedExam);
  assert.equal(mixRes.errors.length, 0);
  assert.equal(mixRes.versions.length, 2);

  const readyExam: MathExamProject = {
    ...singleFixedExam,
    generatedVersions: mixRes.versions,
  };
  const gate = checkExamExportGate(readyExam);
  assert.equal(gate.canExport, true, `Export gate should pass, got: ${gate.blockingReasons.join('; ')}`);
});

test('Case 4: Existing DOCX answer, legacy stale missing draft, True/False false ("Sai"), short-answer "0", and broken/cleared selection', async () => {
  // 4A. DOCX with pre-existing answer key stays source-matched
  const docxWithKey = await buildMinimalDocxBuffer([
    'Câu 1: Kết quả của $2 + 3$ là?',
    'A. 4',
    'B. 5',
    'C. 6',
    'D. 7',
    'Đáp án: B',
  ]);
  const importedWithKey = await importUniversalExamFile(
    { fileName: 'de-co-khoa.docx', buffer: docxWithKey },
    makeTestId
  );
  const qWithKey = importedWithKey.questions[0];
  assert.equal(qWithKey.answerProvenance?.status, 'source-matched');
  assert.equal(evaluateQuestionAnswerState(qWithKey).hasValidAnswer, true);
  assert.equal(evaluateQuestionAnswerState(qWithKey).isMissingKey, false);

  // 4B. Legacy draft saved before fix: correctOptionId = option A (index 0) + isCorrect = true,
  //     but answerProvenance.status stuck at 'missing'
  const docxNoKey = await buildMinimalDocxBuffer([
    'Câu 1: Giá trị $\\cos 0$ bằng bao nhiêu?',
    'A. 1',
    'B. 0',
    'C. -1',
    'D. 2',
  ]);
  const importedNoKey = await importUniversalExamFile(
    { fileName: 'de-ban-nhap-cu.docx', buffer: docxNoKey },
    makeTestId
  );
  const legacyQ: MathQuestion = {
    ...importedNoKey.questions[0],
    correctOptionId: importedNoKey.questions[0].options![0].id,
    options: importedNoKey.questions[0].options!.map((o, idx) => ({ ...o, isCorrect: idx === 0 })),
    answerConfirmed: false,
    answerProvenance: {
      status: 'missing',
      sourceFileHash: 'legacy-docx-hash-abc',
      sourceLocation: 'Câu 1 (DOCX gốc)',
      rawEvidence: 'Không có khóa trong DOCX gốc',
      note: 'Không tìm thấy khóa trong tài liệu.',
    },
  };
  const legacyExam = wrapQuestionsIntoProject([legacyQ], 'Bản nháp cũ kẹt provenance');
  // Even before normalization, canonical evaluator reconciles stale missing draft
  const legacyPreReport = evaluatePreMixIntegrity(legacyExam);
  assert.equal(legacyPreReport.stats.missingKeyCount, 0);
  assert.equal(legacyPreReport.issues.filter((i) => i.severity === 'error').length, 0);
  assert.equal(mapToReliabilityAnswerStatus(legacyQ), 'TEACHER_CONFIRMED');

  // After normalizeMathExamProject (reload from IndexedDB), provenance is permanently healed while preserving import metadata
  const healedExam = normalizeMathExamProject(legacyExam);
  const healedQ = healedExam.questions[0];
  assert.equal(healedQ.answerProvenance?.status, 'teacher-confirmed');
  assert.equal(healedQ.answerProvenance?.sourceFileHash, 'legacy-docx-hash-abc');
  assert.equal(healedQ.answerProvenance?.sourceLocation, 'Câu 1 (DOCX gốc)');
  assert.equal(healedQ.answerProvenance?.rawEvidence, 'Không có khóa trong DOCX gốc');
  assert.equal(healedQ.answerConfirmed, true);

  // 4C. True/False question where teacher sets ALL 4 statements to false ("Sai")
  const tfQ: MathQuestion = {
    id: makeTestId('mq'),
    code: 'TF-01',
    sectionTitle: 'PHẦN II. Câu trắc nghiệm đúng sai',
    type: 'true-false',
    topic: 'Hàm số',
    cognitiveLevel: 'thong-hieu',
    difficultyScore: 2,
    points: 1,
    stem: parseMathContent('Xét tính đúng sai của các mệnh đề sau về hàm số $f(x) = x^2$.'),
    statements: (['a', 'b', 'c', 'd'] as const).map((lbl, idx) => ({
      id: makeTestId('st'),
      originalLabel: lbl,
      content: parseMathContent(`Mệnh đề ${lbl}: $f(${idx + 1}) = 0$.`),
      isTrue: false,
      answerState: 'missing',
    })),
    solutionGuide: parseMathContent(''),
    lockQuestionPosition: false,
    lockOptionShuffle: true,
    allowStatementShuffle: false,
    dependencyFlags: [],
    hasVisualAsset: false,
    answerConfirmed: false,
    answerProvenance: {
      status: 'missing',
      note: 'Thiếu khóa Đúng/Sai từ DOCX gốc.',
    },
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
  };

  // Initially missing -> exactly 1 blocking missing-key error (no 4x duplicate!)
  const tfExamBefore = wrapQuestionsIntoProject([tfQ], 'Đề Đúng/Sai');
  const tfReportBefore = evaluatePreMixIntegrity(tfExamBefore);
  assert.equal(tfReportBefore.stats.missingKeyCount, 1);
  assert.equal(
    tfReportBefore.issues.filter((i) => i.questionId === tfQ.id && i.severity === 'error').length,
    1,
    'Missing True/False question must emit 1 canonical error, not 5 duplicate errors'
  );

  // Confirm only 2 statements as false ("Sai") -> still missing (2 statements left)
  const tfHalf = applyTeacherManualAnswer(tfQ, {
    ...tfQ,
    statements: tfQ.statements!.map((st, idx) =>
      idx < 2 ? { ...st, isTrue: false, answerState: 'confirmed' as const } : st
    ),
  });
  assert.equal(evaluateQuestionAnswerState(tfHalf).isMissingKey, true);
  assert.equal(tfHalf.answerConfirmed, false);

  // Confirm ALL 4 statements as false ("Sai") -> valid, confirmed, NOT treated as missing!
  const tfAllFalse = applyTeacherManualAnswer(tfHalf, {
    ...tfHalf,
    statements: tfHalf.statements!.map((st) => ({
      ...st,
      isTrue: false,
      answerState: 'confirmed' as const,
    })),
  });
  assert.equal(evaluateQuestionAnswerState(tfAllFalse).hasValidAnswer, true);
  assert.equal(evaluateQuestionAnswerState(tfAllFalse).isMissingKey, false);
  assert.equal(tfAllFalse.answerProvenance?.status, 'teacher-confirmed');
  const tfExamAfter = wrapQuestionsIntoProject([tfAllFalse], 'Đề Đúng/Sai đã chọn Sai');
  tfExamAfter.confirmedOriginalAnswers = true;
  tfExamAfter.mixConfig.examCount = 1;
  tfExamAfter.mixConfig.customCodeNames = ['101'];
  assert.equal(evaluatePreMixIntegrity(tfExamAfter).status, 'PASS');
  const tfMixed = generateMixedExams(tfExamAfter);
  assert.equal(tfMixed.errors.length, 0);
  assert.equal(tfMixed.versions[0].answerKeyRows[0].answer, 'a:S · b:S · c:S · d:S');

  // 4D. Short answer "0" is valid (never falsy), clearing to "" restores missing with 1 error (no duplicate sa-empty)
  const saQ: MathQuestion = {
    id: makeTestId('mq'),
    code: 'SA-01',
    sectionTitle: 'PHẦN III. Câu trắc nghiệm trả lời ngắn',
    type: 'short-answer',
    topic: 'Tích phân',
    cognitiveLevel: 'van-dung',
    difficultyScore: 3,
    points: 0.5,
    stem: parseMathContent('Tính giá trị $\\int_{-1}^{1} x\\,dx$.'),
    shortAnswer: { answerValue: '', acceptedFormats: [] },
    solutionGuide: parseMathContent(''),
    lockQuestionPosition: false,
    lockOptionShuffle: true,
    allowStatementShuffle: false,
    dependencyFlags: [],
    hasVisualAsset: false,
    answerConfirmed: false,
    answerProvenance: { status: 'missing', note: 'Thiếu đáp án trả lời ngắn.' },
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
  };
  const saMissingReport = evaluatePreMixIntegrity(wrapQuestionsIntoProject([saQ], 'Đề TLN'));
  assert.equal(
    saMissingReport.issues.filter((i) => i.questionId === saQ.id && i.severity === 'error').length,
    1,
    'Short answer missing key must emit 1 error, not duplicate q-prov-missing + sa-empty'
  );

  const saZero = applyTeacherManualAnswer(saQ, {
    ...saQ,
    shortAnswer: { answerValue: '0', rawAnswer: '0', normalizedAnswer: '0', acceptedFormats: ['0'] },
  });
  assert.equal(evaluateQuestionAnswerState(saZero).hasValidAnswer, true);
  assert.equal(evaluateQuestionAnswerState(saZero).isMissingKey, false);
  assert.equal(saZero.answerProvenance?.status, 'teacher-confirmed');

  const saCleared = applyTeacherManualAnswer(saZero, {
    ...saZero,
    shortAnswer: { answerValue: '', rawAnswer: '', normalizedAnswer: '', acceptedFormats: [] },
  });
  assert.equal(evaluateQuestionAnswerState(saCleared).isMissingKey, true);
  assert.equal(saCleared.answerConfirmed, false);

  // 4E. Broken/non-existent correctOptionId must report blocking error again
  const brokenMcq: MathQuestion = {
    ...healedQ,
    correctOptionId: 'non-existent-option-id',
  };
  const brokenReport = evaluatePreMixIntegrity(wrapQuestionsIntoProject([brokenMcq], 'Đề ID hỏng'));
  assert.equal(brokenReport.status, 'BLOCKED');
  assert.ok(
    brokenReport.issues.some((i) => i.questionId === brokenMcq.id && i.id.startsWith('mcq-answer-')),
    'Non-existent correctOptionId must trigger blocking mcq-answer error'
  );
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  MathExamProject,
  MathQuestion,
} from '../types/mathExam';
import {
  auditOriginalExamIntegrity,
  checkDraftExportGate,
  checkExamExportGate,
  computeQuestionVerificationContentHash,
  createMathVisualAsset,
  parseMathContent,
} from './mathIntegrity';
import {
  importUniversalExamFile,
  mergeImportedExamIntoProject,
  parseUniversalExamText,
} from './universalImportEngine';
import {
  applyBulkAnswerKeyUpdates,
  confirmAllSourceMatchedAnswers,
  mapToReliabilityAnswerStatus,
  parseBulkAnswerKeyText,
} from './answerKeyRecovery';
import { generateMixedExams } from './mathShuffleEngine';
import {
  buildDraftStudentExamDocxBuffer,
  buildExamWithSolutionsDocxBuffer,
  buildPerCodeAnswerKeyDocxBuffer,
  buildSourceToOutputTraceabilityReport,
  buildStudentExamDocxBuffer,
  exportMixedExamZipBundle,
  verifyExportedDocxBuffer,
  verifyExportedDocxRoundTrip,
} from './examExportEngine';
import { extractDocxDocument } from './ooxmlParser';

function makeCreateId() {
  let seq = 0;
  return (prefix: string) => `${prefix}-rel-${++seq}`;
}

async function buildMinimalDocxBuffer(params: {
  bodyXml: string;
  relsXml?: string;
  mediaFiles?: Record<string, Uint8Array>;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="emf" ContentType="image/x-emf"/>
  <Default Extension="wdp" ContentType="image/vnd.ms-photo"/>
  <Default Extension="wmf" ContentType="image/x-wmf"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>${params.bodyXml}</w:body>
</w:document>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    params.relsXml ??
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  if (params.mediaFiles) {
    for (const [path, bytes] of Object.entries(params.mediaFiles)) {
      zip.file(path, bytes);
    }
  }
  return zip.generateAsync({ type: 'uint8array' });
}

function makeBaseExamProject(questions: MathQuestion[]): MathExamProject {
  const now = new Date().toISOString();
  return {
    id: 'exam-rel-test',
    title: 'Đề kiểm tra Toán 12 — Kiểm chứng Reliability Engine 1.0',
    subject: 'Toán học',
    subjectId: 'toan',
    schemaVersion: '6.0',
    grade: 'Lớp 12',
    durationMinutes: 90,
    schoolYear: '2025–2026',
    examTypeLabel: 'Kiểm tra giữa kỳ',
    questions,
    questionGroups: [],
    mixConfig: {
      level: 2,
      examCount: 3,
      startCodeNumber: 101,
      customCodeNames: [],
      seed: 'RELIABILITY-SEED-2026',
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
    confirmedOriginalAnswers: false,
    generatedVersions: [],
    lastStep: 2,
    status: 'draft',
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };
}

// 1x1 transparent PNG bytes for valid image fixtures
const TINY_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
);

describe('Exam Reliability Engine 1.0 — Ground-Truth Regression Suite', () => {
  it('RE-01: DOCX with OMML fractions/integrals/roots preserves formulas cleanly across import -> shuffle -> export -> round-trip', async () => {
    const bodyXml = `
      <w:p><w:r><w:t>PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn</w:t></w:r></w:p>
      <w:p>
        <w:r><w:t>Câu 1: Tính đạo hàm của hàm số </w:t></w:r>
        <m:oMath><m:f><m:num><m:r><m:t>x+1</m:t></m:r></m:num><m:den><m:r><m:t>x-2</m:t></m:r></m:den></m:f></m:oMath>
      </w:p>
      <w:p><w:r><w:t>A. $\\frac{-3}{(x-2)^2}$   B. $\\frac{3}{(x-2)^2}$   C. $\\frac{-1}{(x-2)^2}$   D. $\\frac{1}{(x-2)^2}$</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 2: Tính tích phân $I = \\int_0^1 x^2 dx$.</w:t></w:r></w:p>
      <w:p><w:r><w:t>A. $\\frac{1}{2}$   B. $\\frac{1}{3}$   C. $\\frac{1}{4}$   D. $1$</w:t></w:r></w:p>
      <w:p><w:r><w:t>BẢNG ĐÁP ÁN</w:t></w:r></w:p>
      <w:p><w:r><w:t>1.A  2.B</w:t></w:r></w:p>
    `;
    const docx = await buildMinimalDocxBuffer({ bodyXml });
    const imported = await importUniversalExamFile(
      { fileName: 'omml-test.docx', buffer: docx },
      makeCreateId(),
      { subjectId: 'toan' }
    );

    assert.equal(imported.questions.length, 2);
    assert.ok(imported.questions[0].stem.rawSource.includes('\\frac'));
    assert.equal(mapToReliabilityAnswerStatus(imported.questions[0]), 'SOURCE_KEY_FOUND');
    assert.equal(mapToReliabilityAnswerStatus(imported.questions[1]), 'SOURCE_KEY_FOUND');
    assert.ok(imported.sourceDocumentPreview && imported.sourceDocumentPreview.sections.length >= 1);

    let exam = mergeImportedExamIntoProject(makeBaseExamProject([]), imported, {
      replaceExisting: true,
    });
    const confirmedRes = confirmAllSourceMatchedAnswers(exam);
    assert.equal(confirmedRes.confirmedCount, 2);
    exam = { ...confirmedRes.exam, confirmedOriginalAnswers: true };

    const mixed = generateMixedExams(exam);
    assert.equal(mixed.errors.length, 0);
    exam = { ...exam, generatedVersions: mixed.versions };

    for (const ver of exam.generatedVersions) {
      const exportedBytes = await buildStudentExamDocxBuffer(exam, ver);
      const rt = await verifyExportedDocxRoundTrip(exportedBytes, ver, exam);
      assert.equal(rt.passed, true, `Round-trip failed for code ${ver.code}: ${rt.issues.map((i) => i.message).join('; ')}`);
      assert.equal(rt.reimportedQuestionCount, 2);
    }
  });

  it('RE-02: Table-based options (A. ... | B. ... | C. ... | D. ...) strip stray pipe separators without corrupting formulas', async () => {
    const bodyXml = `
      <w:p><w:r><w:t>PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1: Giá trị của $|x|$ khi $x = -5$ là:</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A. $-5$</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B. $5$</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>C. $0$</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>D. $25$</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:r><w:t>Đáp án: B</w:t></w:r></w:p>
    `;
    const docx = await buildMinimalDocxBuffer({ bodyXml });
    const imported = await importUniversalExamFile(
      { fileName: 'table-options.docx', buffer: docx },
      makeCreateId(),
      { subjectId: 'toan' }
    );
    assert.equal(imported.questions.length, 1);
    const q = imported.questions[0];
    assert.equal(q.type, 'mcq');
    assert.equal(q.options?.length, 4);
    assert.equal(q.options?.[0].content.rawSource, '$-5$');
    assert.equal(q.options?.[1].content.rawSource, '$5$');
    assert.equal(q.options?.[2].content.rawSource, '$0$');
    assert.equal(q.options?.[3].content.rawSource, '$25$');
    assert.equal(q.options?.some((o) => o.content.rawSource.includes('|')), false);
  });

  it('RE-03: Incomplete MCQ options (missing D) flag OPTION_PARSE_INCOMPLETE, lock shuffle, NEVER fabricate D, and block both official & draft export', () => {
    const text = `
PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn
Câu 1: Tập xác định của hàm số $y = \\ln x$ là:
A. $(0; +\\infty)$
B. $\\mathbb{R}$
C. $[0; +\\infty)$
    `;
    const imported = parseUniversalExamText(text, makeCreateId(), { subjectId: 'toan' });
    assert.equal(imported.questions.length, 1);
    const q = imported.questions[0];
    assert.equal(q.type, 'mcq', 'Must NOT silently fall through to short-answer');
    assert.equal(q.optionParseIncomplete, true);
    assert.equal(q.lockOptionShuffle, true);
    assert.equal(q.options?.length, 3, 'Must NOT fabricate missing option D');

    const exam = mergeImportedExamIntoProject(makeBaseExamProject([]), imported, {
      replaceExisting: true,
    });
    const issues = auditOriginalExamIntegrity(exam);
    assert.ok(issues.some((i) => i.id.startsWith('q-option-incomplete-')));

    const officialGate = checkExamExportGate(exam);
    assert.equal(officialGate.canExport, false);

    const draftGate = checkDraftExportGate(exam);
    assert.equal(draftGate.canExportDraft, false, 'Structural OPTION_PARSE_INCOMPLETE must block even draft export');
    assert.ok(draftGate.warningMessage.includes('BLOCK OFFICIAL EXPORT'));
  });

  it('RE-04: UNRENDERABLE media (EMF / WDP / corrupt WMF) explicitly marked & blocked; valid mc:AlternateContent PNG fallback succeeds cleanly', async () => {
    // 1. Corrupt/unsupported EMF directly referenced
    const emfDocx = await buildMinimalDocxBuffer({
      bodyXml: `
        <w:p><w:r><w:t>PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn</w:t></w:r></w:p>
        <w:p>
          <w:r><w:t>Câu 1: Quan sát hình vẽ sau:</w:t></w:r>
          <w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImg1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>
        </w:p>
        <w:p><w:r><w:t>A. $1$  B. $2$  C. $3$  D. $4$</w:t></w:r></w:p>
        <w:p><w:r><w:t>Đáp án: A</w:t></w:r></w:p>
      `,
      relsXml: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/diagram1.emf"/>
</Relationships>`,
      mediaFiles: {
        'word/media/diagram1.emf': new Uint8Array([1, 2, 3, 4]),
      },
    });
    const impEmf = await importUniversalExamFile(
      { fileName: 'has-emf.docx', buffer: emfDocx },
      makeCreateId(),
      { subjectId: 'toan' }
    );
    assert.equal(impEmf.questions.length, 1);
    assert.deepEqual(impEmf.questions[0].unrenderableMediaRefs, ['diagram1.emf']);

    const emfExam = mergeImportedExamIntoProject(makeBaseExamProject([]), impEmf, {
      replaceExisting: true,
    });
    const emfIssues = auditOriginalExamIntegrity(emfExam);
    assert.ok(emfIssues.some((i) => i.id.startsWith('q-unrenderable-media-')));
    assert.equal(checkDraftExportGate(emfExam).canExportDraft, false);
    assert.equal(checkExamExportGate(emfExam).canExport, false);

    // 2. mc:AlternateContent with EMF in Choice and valid PNG in Fallback -> must recover PNG cleanly!
    const altDocx = await buildMinimalDocxBuffer({
      bodyXml: `
        <w:p><w:r><w:t>PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn</w:t></w:r></w:p>
        <w:p>
          <w:r><w:t>Câu 1: Quan sát đồ thị:</w:t></w:r>
          <w:r>
            <mc:AlternateContent>
              <mc:Choice Requires="wps">
                <w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdEmf"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>
              </mc:Choice>
              <mc:Fallback>
                <w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdPng"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>
              </mc:Fallback>
            </mc:AlternateContent>
          </w:r>
        </w:p>
        <w:p><w:r><w:t>A. $1$  B. $2$  C. $3$  D. $4$</w:t></w:r></w:p>
        <w:p><w:r><w:t>Đáp án: B</w:t></w:r></w:p>
      `,
      relsXml: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdEmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/fallback_choice.emf"/>
  <Relationship Id="rIdPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/valid_graph.png"/>
</Relationships>`,
      mediaFiles: {
        'word/media/fallback_choice.emf': new Uint8Array([1, 2, 3, 4]),
        'word/media/valid_graph.png': TINY_PNG_BYTES,
      },
    });
    const impAlt = await importUniversalExamFile(
      { fileName: 'alt-fallback.docx', buffer: altDocx },
      makeCreateId(),
      { subjectId: 'toan' }
    );
    assert.equal(impAlt.questions.length, 1);
    assert.equal(impAlt.questions[0].unrenderableMediaRefs, undefined);
    assert.equal(impAlt.questions[0].visualAssets?.length, 1);
  });

  it('RE-05: Missing answer keys NEVER default to A/False, block official export, and allow explicit Draft Export Without Answer Key', async () => {
    const text = `
PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn
Câu 1: Hàm số $y = x^3 - 3x$ đạt cực đại tại:
A. $x = -1$
B. $x = 1$
C. $x = 0$
D. $x = 2$

PHẦN II. Câu trắc nghiệm đúng sai
Câu 1: Cho hàm số $f(x) = x^2 - 4x + 3$.
a) Đạo hàm $f'(x) = 2x - 4$.
b) Hàm số đồng biến trên $(0; 2)$.
c) Giá trị nhỏ nhất bằng $-1$.
d) Phương trình $f(x) = 0$ vô nghiệm.
    `;
    const imported = parseUniversalExamText(text, makeCreateId(), { subjectId: 'toan' });
    assert.equal(imported.questions.length, 2);
    assert.equal(mapToReliabilityAnswerStatus(imported.questions[0]), 'MISSING');
    assert.equal(imported.questions[0].correctOptionId, undefined);
    assert.equal(imported.questions[0].options?.some((o) => o.isCorrect), false);
    assert.equal(mapToReliabilityAnswerStatus(imported.questions[1]), 'MISSING');
    assert.equal(
      imported.questions[1].statements?.every((s) => s.answerState === 'missing'),
      true
    );

    const exam = mergeImportedExamIntoProject(makeBaseExamProject([]), imported, {
      replaceExisting: true,
    });

    // Official export strictly BLOCKED
    assert.equal(checkExamExportGate(exam).canExport, false);
    await assert.rejects(() => exportMixedExamZipBundle(exam));

    // Draft export without answer key ALLOWED because content/structure/formulas are clean!
    const draftGate = checkDraftExportGate(exam);
    assert.equal(draftGate.canExportDraft, true);
    assert.equal(draftGate.missingOrUnconfirmedAnswerCount, 2);

    const draftDocx = await buildDraftStudentExamDocxBuffer(exam);
    const extracted = await extractDocxDocument(draftDocx);
    assert.ok(extracted.plainTextWithMarkers.includes('BẢN NHÁP HỌC SINH'));
    assert.ok(extracted.plainTextWithMarkers.includes('Câu 1:'));
    assert.equal(/Đáp án đúng:|BẢNG ĐÁP ÁN/i.test(extracted.plainTextWithMarkers), false);
  });

  it('RE-06: Answer Key Recovery Bulk Paste supports MCQ, True/False, Short Answer (negative/comma) and never fabricates missing entries', () => {
    const text = `
PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn
Câu 1: Tính $2 + 2$.
A. 3  B. 4  C. 5  D. 6
Câu 2: Tính $3 \\times 3$.
A. 6  B. 8  C. 9  D. 12
Câu 3: Tính $10 - 3$.
A. 5  B. 6  C. 7  D. 8

PHẦN II. Câu trắc nghiệm đúng sai
Câu 1: Xét hàm số $y = x^2$.
a) $y(0) = 0$.
b) $y(-1) = -1$.
c) $y'(x) = 2x$.
d) Đồ thị đi qua $(2; 4)$.

PHẦN III. Câu trắc nghiệm trả lời ngắn
Câu 1: Tìm nghiệm phương trình $10x + 43 = 0$.
Câu 2: Tìm giá trị nhỏ nhất của $x^2$.
    `;
    const imported = parseUniversalExamText(text, makeCreateId(), { subjectId: 'toan' });
    const exam = mergeImportedExamIntoProject(makeBaseExamProject([]), imported, {
      replaceExisting: true,
    });

    // Paste keys for Q1, Q2 (intentionally omit MCQ Q3 to verify no fabrication!)
    const bulkInput = `
Phần I
1B 2C
Phần II
1: Đ-S-Đ-Đ
Phần III
1: -4,3
2: 0
    `;
    const parsed = parseBulkAnswerKeyText(bulkInput, exam.questions);
    assert.equal(parsed.matched.length, 5);

    const updated = applyBulkAnswerKeyUpdates(exam, parsed.matched);
    assert.equal(mapToReliabilityAnswerStatus(updated.questions[0]), 'TEACHER_CONFIRMED');
    assert.equal(updated.questions[0].options?.find((o) => o.isCorrect)?.originalLabel, 'B');
    assert.equal(mapToReliabilityAnswerStatus(updated.questions[1]), 'TEACHER_CONFIRMED');
    assert.equal(updated.questions[1].options?.find((o) => o.isCorrect)?.originalLabel, 'C');
    // MCQ Q3 untouched -> still MISSING!
    assert.equal(mapToReliabilityAnswerStatus(updated.questions[2]), 'MISSING');
    assert.equal(updated.questions[2].correctOptionId, undefined);
    // TF Q1 confirmed Đ-S-Đ-Đ
    assert.equal(mapToReliabilityAnswerStatus(updated.questions[3]), 'TEACHER_CONFIRMED');
    assert.deepEqual(
      updated.questions[3].statements?.map((s) => s.isTrue),
      [true, false, true, true]
    );
    // Short answers preserve -4,3 and 0
    assert.equal(updated.questions[4].shortAnswer?.rawAnswer, '-4,3');
    assert.equal(updated.questions[4].shortAnswer?.normalizedAnswer, '-4.3');
    assert.equal(updated.questions[5].shortAnswer?.rawAnswer, '0');
  });

  it('RE-07: Editing a TEACHER_CONFIRMED question invalidates confirmedContentHash and blocks export until re-confirmed', () => {
    const text = `
PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn
Câu 1: Tính $1 + 1$.
A. 1  B. 2  C. 3  D. 4
Đáp án: B
    `;
    const imported = parseUniversalExamText(text, makeCreateId(), { subjectId: 'toan' });
    let exam = mergeImportedExamIntoProject(makeBaseExamProject([]), imported, {
      replaceExisting: true,
    });
    exam = confirmAllSourceMatchedAnswers(exam).exam;
    assert.equal(mapToReliabilityAnswerStatus(exam.questions[0]), 'TEACHER_CONFIRMED');

    // Mutate question stem without updating confirmedContentHash
    const mutatedExam: MathExamProject = {
      ...exam,
      questions: [
        {
          ...exam.questions[0],
          stem: parseMathContent('Tính $1 + 2$.'),
        },
      ],
    };
    assert.equal(mapToReliabilityAnswerStatus(mutatedExam.questions[0]), 'AMBIGUOUS');
    const issues = auditOriginalExamIntegrity(mutatedExam);
    assert.ok(issues.some((i) => i.id.startsWith('q-prov-stale-confirm-')));
    assert.equal(checkExamExportGate(mutatedExam).canExport, false);
  });

  it('RE-08: Lossless Shuffling + Complete ZIP Export includes per-code Dap_an_<CODE>.docx, Traceability JSON, and strict Solutions-only-from-source', async () => {
    const text = `
PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn
Câu 1: Đạo hàm của $y = x^2$ là:
A. $x$   B. $2x$   C. $x^2$   D. $2$
Câu 2: Đạo hàm của $y = x^3$ là:
A. $3x^2$   B. $x^2$   C. $3x$   D. $x^3$
Câu 3: Phát biểu nào đúng?
A. $2 + 2 = 4$   B. $3 + 3 = 6$   C. Cả A và B đều đúng   D. Không có đáp án nào đúng

PHẦN II. Câu trắc nghiệm đúng sai
Câu 1: Cho $f(x) = x^2 - 1$.
a) $f(1) = 0$.
b) $f(0) = 1$.
c) $f(-1) = 0$.
d) $f'(x) = 2x$.

PHẦN III. Câu trắc nghiệm trả lời ngắn
Câu 1: Giá trị của $-4,5 + 0,2$ là bao nhiêu?

BẢNG ĐÁP ÁN
Phần I
1.B  2.A  3.C
Phần II
1: Đ-S-Đ-Đ
Phần III
1: -4,3
    `;
    const imported = parseUniversalExamText(text, makeCreateId(), {
      subjectId: 'toan',
      fileName: 'toan12-ground-truth.docx',
    });
    let exam = mergeImportedExamIntoProject(makeBaseExamProject([]), imported, {
      replaceExisting: true,
    });
    exam.mixConfig.examCount = 3;
    exam = { ...confirmAllSourceMatchedAnswers(exam).exam, confirmedOriginalAnswers: true };

    const mixed = generateMixedExams(exam);
    assert.equal(mixed.errors.length, 0);
    assert.equal(mixed.versions.length, 3);
    exam = { ...exam, generatedVersions: mixed.versions };

    // Verify "Cả A và B đều đúng" option lock applied on every code
    for (const ver of exam.generatedVersions) {
      const q3Map = ver.permutationMap.find((m) => m.originalOrderNumber === 3);
      assert.ok(q3Map);
      assert.equal(q3Map.lockedOptionShuffleApplied, true);
      assert.equal(q3Map.newCorrectLabel, 'C');
    }

    // Export full ZIP bundle
    const bundle = await exportMixedExamZipBundle(exam);
    assert.equal(bundle.integrity.verified, true);

    const loadedZip = await JSZip.loadAsync(bundle.zipBytes);
    for (const code of ['101', '102', '103']) {
      assert.ok(loadedZip.file(`de-hoc-sinh/Ma_de_${code}.docx`), `Missing Ma_de_${code}.docx`);
      assert.ok(loadedZip.file(`dap-an/Dap_an_${code}.docx`), `Missing Dap_an_${code}.docx`);
    }
    assert.ok(loadedZip.file('dap-an/Dap_an_va_Anh_xa.docx'));
    assert.ok(loadedZip.file('dap-an/Bang_dap_an_tong_hop.csv'));
    assert.ok(loadedZip.file('kiem-chung/Bao_cao_truy_vet_nguon.json'));

    // Verify Traceability JSON content & confirm it does NOT leak into student DOCX
    const traceJson = JSON.parse(
      await loadedZip.file('kiem-chung/Bao_cao_truy_vet_nguon.json')!.async('string')
    ) as ReturnType<typeof buildSourceToOutputTraceabilityReport>;
    assert.equal(traceJson.codes.length, 3);
    assert.ok(traceJson.codes[0].entries[0].sourceLabel.includes('toan12-ground-truth.docx'));
    assert.ok(traceJson.codes[0].entries[0].outputLabel.includes('Output: Mã 101'));

    const student101Text = (
      await extractDocxDocument(
        await loadedZip.file('de-hoc-sinh/Ma_de_101.docx')!.async('uint8array')
      )
    ).plainTextWithMarkers;
    assert.equal(student101Text.includes('sourceQuestionId'), false);

    // Optional solutions DOCX MUST throw when source has no solutions (never fabricate!)
    await assert.rejects(
      () => buildExamWithSolutionsDocxBuffer(exam, exam.generatedVersions[0]),
      /không tự sinh lời giải/i
    );

    // Now add an explicit source solution to Q1 and re-confirm its hash -> Solutions DOCX succeeds!
    const q0WithSol: MathQuestion = {
      ...exam.questions[0],
      solutionGuide: parseMathContent('Áp dụng công thức $(x^n)\' = n x^{n-1}$ ta được $y\' = 2x$.'),
    };
    q0WithSol.answerProvenance = {
      ...q0WithSol.answerProvenance!,
      confirmedContentHash: computeQuestionVerificationContentHash(q0WithSol),
    };
    const examWithSol: MathExamProject = {
      ...exam,
      questions: [q0WithSol, ...exam.questions.slice(1)],
    };
    const mixedSol = generateMixedExams(examWithSol);
    const examWithSolReady = { ...examWithSol, generatedVersions: mixedSol.versions };
    const solDocx = await buildExamWithSolutionsDocxBuffer(
      examWithSolReady,
      examWithSolReady.generatedVersions[0]
    );
    const solText = (await extractDocxDocument(solDocx)).plainTextWithMarkers;
    assert.ok(solText.includes('PHẦN LỜI GIẢI CHI TIẾT'));
    assert.ok(solText.includes('Áp dụng công thức'));

    // Per-code answer DOCX standalone check
    const perCodeBytes = await buildPerCodeAnswerKeyDocxBuffer(
      exam,
      exam.generatedVersions[0]
    );
    const perCodeText = (await extractDocxDocument(perCodeBytes)).plainTextWithMarkers;
    assert.ok(perCodeText.includes('ĐÁP ÁN MÃ ĐỀ 101'));
  });

  it('RE-09: Post-Export Verification catches broken media references AND vanished formulas even when question counts match', async () => {
    const text = `
PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn
Câu 1: Tìm nguyên hàm của $f(x) = 3x^2 + 2x$.
A. $x^3 + x^2 + C$   B. $6x + 2$   C. $x^3 + C$   D. $3x^3 + 2x^2 + C$
Đáp án: A
    `;
    const imported = parseUniversalExamText(text, makeCreateId(), { subjectId: 'toan' });
    let exam = mergeImportedExamIntoProject(makeBaseExamProject([]), imported, {
      replaceExisting: true,
    });
    // Attach a valid PNG asset to Q1
    const pngDataUrl = `data:image/png;base64,${Buffer.from(TINY_PNG_BYTES).toString('base64')}`;
    const imgAsset = createMathVisualAsset({
      id: 'img-test-1',
      kind: 'image',
      label: 'Đồ thị minh họa',
      sourceData: pngDataUrl,
    });
    exam.questions[0] = {
      ...exam.questions[0],
      visualAssets: [imgAsset],
      hasVisualAsset: true,
    };
    exam = { ...confirmAllSourceMatchedAnswers(exam).exam, confirmedOriginalAnswers: true };
    exam.mixConfig.examCount = 1;
    const mixed = generateMixedExams(exam);
    exam = { ...exam, generatedVersions: mixed.versions };

    const validDocx = await buildStudentExamDocxBuffer(exam, exam.generatedVersions[0]);
    const validCheck = await verifyExportedDocxBuffer(validDocx, exam.generatedVersions[0], exam);
    assert.equal(validCheck.passed, true);

    // Tamper 1: Delete media file referenced by word/document.xml -> MUST FAIL with broken media!
    const brokenMediaZip = await JSZip.loadAsync(validDocx);
    const mediaKeys = Object.keys(brokenMediaZip.files).filter((k) => k.startsWith('word/media/'));
    assert.ok(mediaKeys.length >= 1);
    brokenMediaZip.remove(mediaKeys[0]);
    const brokenMediaBytes = await brokenMediaZip.generateAsync({ type: 'uint8array' });
    const brokenMediaCheck = await verifyExportedDocxBuffer(
      brokenMediaBytes,
      exam.generatedVersions[0],
      exam
    );
    assert.equal(brokenMediaCheck.passed, false);
    assert.ok(
      brokenMediaCheck.issues.some((i) => i.id.startsWith('exp-broken-media-')),
      `Expected exp-broken-media-* error, got: ${brokenMediaCheck.issues.map((i) => i.id).join(', ')}`
    );

    // Tamper 2: Strip all `$...$` formula delimiters while keeping `Câu 1:` -> MUST FAIL with exp-formula-loss!
    const strippedFormulaZip = await JSZip.loadAsync(validDocx);
    const docXml = await strippedFormulaZip.file('word/document.xml')!.async('string');
    strippedFormulaZip.file('word/document.xml', docXml.replace(/\$[^$<]+\$/g, ' '));
    const strippedBytes = await strippedFormulaZip.generateAsync({ type: 'uint8array' });
    const strippedCheck = await verifyExportedDocxBuffer(
      strippedBytes,
      exam.generatedVersions[0],
      exam
    );
    assert.equal(strippedCheck.passed, false);
    assert.ok(
      strippedCheck.issues.some((i) => i.id.startsWith('exp-formula-loss-')),
      `Expected exp-formula-loss-* error, got: ${strippedCheck.issues.map((i) => i.id).join(', ')}`
    );
  });
});

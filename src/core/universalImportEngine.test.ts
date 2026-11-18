import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  importUniversalExamFile,
  mergeImportedExamIntoProject,
  parseUniversalExamText,
  parseUniversalHtmlExam,
} from './universalImportEngine';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import { generateMixedExams } from './mathShuffleEngine';

let counter = 0;
const testId = (prefix: string) => `${prefix}-${++counter}`;

async function buildSampleDocxBuffer(options?: {
  includeLegacyOle?: boolean;
}): Promise<Uint8Array> {
  const zip = new JSZip();

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart1.png"/>
</Relationships>`;

  // 1x1 transparent PNG
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>ĐỀ KIỂM TRA HÓA HỌC &amp; TOÁN (DOCX)</w:t></w:r></w:p>
    <w:p>
      <w:r><w:t>Câu 1: Tính giá trị biểu thức </w:t></w:r>
      <m:oMath>
        <m:f>
          <m:num><m:r><m:t>1</m:t></m:r></m:num>
          <m:den><m:rad><m:e><m:r><m:t>x+1</m:t></m:r></m:e></m:rad></m:den>
        </m:f>
      </m:oMath>
      <w:r><w:t> với hình đính kèm:</w:t></w:r>
      <w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r>
    </w:p>
    <w:p><w:r><w:t>A. $1$   B. $2$   C. $3$   D. $4$</w:t></w:r></w:p>
    <w:p><w:r><w:t>Đáp án: B</w:t></w:r></w:p>
    <w:p>
      <w:r><w:t>Câu 2: Hòa tan hoàn toàn 0,1 mol H</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r>
      <w:r><w:t>SO</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>4</w:t></w:r>
      <w:r><w:t> tạo ion SO</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>4</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2-</w:t></w:r>
      <w:r><w:t> tác dụng với Fe</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>3+</w:t></w:r>
      <w:r><w:t>.</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Chất</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Số mol</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>HCl</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>0,2</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>A. 0,1 mol   B. 0,2 mol   C. 0,3 mol   D. Cả A và B</w:t></w:r></w:p>
    <w:p><w:r><w:t>Đáp án: A</w:t></w:r></w:p>
    ${options?.includeLegacyOle ? '<w:p><w:r><w:object/></w:r></w:p>' : ''}
  </w:body>
</w:document>`;

  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', relsXml);
  zip.file('word/media/chart1.png', tinyPngBase64, { base64: true });

  return zip.generateAsync({ type: 'uint8array' });
}

test('Stage 3.1: Extracts real DOCX with OMML raw XML + LaTeX, Unicode subscripts H₂SO₄, embedded PNG image & Word table', async () => {
  const docxBytes = await buildSampleDocxBuffer({ includeLegacyOle: true });
  const result = await importUniversalExamFile(
    { fileName: 'de-mau-thpt.docx', buffer: docxBytes },
    testId
  );

  assert.equal(result.report.sourceFormat, 'docx');
  assert.equal(result.questions.length, 2);
  assert.equal(result.report.ommlCount, 1);
  assert.ok(result.report.assetsAttached >= 2);

  // Câu 1 có công thức OMML -> LaTeX \frac{1}{\sqrt{x+1}} + giữ rawXmlFragment + ảnh PNG
  const q1 = result.questions[0];
  assert.ok(q1.stem.rawSource.includes('\\frac{1}{\\sqrt{x+1}}'));
  assert.ok((q1.originalSnapshot?.rawXmlFragments.length ?? 0) >= 1);
  assert.ok(q1.visualAssets?.some((a) => a.kind === 'image' && a.sourceData.startsWith('data:image/png;base64,')));
  assert.equal(q1.correctOptionId, q1.options?.[1].id);
  assert.equal(q1.answerConfirmed, true);

  // Câu 2 giữ nguyên H₂SO₄, SO₄²⁻, Fe³⁺ và bảng Word
  const q2 = result.questions[1];
  assert.ok(q2.stem.rawSource.includes('H₂SO₄'));
  assert.ok(q2.stem.rawSource.includes('SO₄²⁻'));
  assert.ok(q2.stem.rawSource.includes('Fe³⁺'));
  assert.ok(q2.visualAssets?.some((a) => a.kind === 'data-table'));
  assert.equal(q2.lockOptionShuffle, true); // do "Cả A và B"

  // Cảnh báo minh bạch cho đối tượng OLE legacy
  assert.ok(result.report.warnings.some((w) => /OLE|Equation 3\.0/i.test(w)));
});

test('Stage 3.2: Parses English Reading Comprehension + Dependent English Option Lock + Cloze + Ordering + Answer Key', () => {
  const englishExamText = `
Section I. Reading Comprehension
Read the following passage and mark the letter A, B, C, or D on your answer sheet to indicate the correct answer from Question 1 to Question 2.
Renewable energy plays a vital role in reducing carbon emissions across Southeast Asia.

Question 1: What is the main topic of the passage?
A. Fossil fuels
B. Renewable energy
C. Nuclear physics
D. Both A and B

Question 2: Which factor reduces carbon emissions?
A. Coal burning
B. Clean energy transition
C. Deforestation
D. All of the above

Section II. Cloze Test
Question 3: Complete the gaps: Students have studied English {{1}} five years and look forward {{2}} the exam.

Section III. Sentence Ordering
Question 4: Put the following sentences in the correct logical order:
a. First, brainstorm key ideas.
b. Second, draft the outline.
c. Finally, proofread the essay carefully.

ANSWER KEY
1. B   2. B   3. for; to   4. a - b - c
`;

  const res = parseUniversalExamText(englishExamText, testId);
  assert.equal(res.report.suggestedSubject.suggestedId, 'tieng-anh');
  assert.equal(res.questions.length, 4);
  assert.equal(res.questionGroups.length, 1);
  assert.deepEqual(res.questionGroups[0].questionIds, [
    res.questions[0].id,
    res.questions[1].id,
  ]);

  // Reading MCQ 1 & 2 khóa phương án phụ thuộc tiếng Anh ("Both A and B", "All of the above")
  assert.equal(res.questions[0].lockOptionShuffle, true);
  assert.equal(res.questions[1].lockOptionShuffle, true);
  assert.equal(res.questions[0].answerConfirmed, true);
  assert.equal(res.questions[0].correctOptionId, res.questions[0].options?.[1].id);

  // Cloze Test #3 -> fill-blank với 2 slots
  const qCloze = res.questions[2];
  assert.equal(qCloze.universalType, 'fill-blank');
  assert.equal(qCloze.fillBlank?.slots.length, 2);
  assert.equal(qCloze.fillBlank?.slots[0].acceptedAnswers[0], 'for');
  assert.equal(qCloze.fillBlank?.slots[1].acceptedAnswers[0], 'to');

  // Ordering #4
  const qOrder = res.questions[3];
  assert.equal(qOrder.universalType, 'ordering');
  assert.equal(qOrder.ordering?.items.length, 3);
});

test('Stage 3.3: Parses Chemistry HTML (sub/sup/table), Matching pairs, Multi-Select, True/False & never invents missing answers', () => {
  const htmlInput = `
  <div>
    <h3>Môn: Hóa học</h3>
    <p>Câu 1: (Chọn nhiều đáp án) Chất nào làm quỳ tím hóa đỏ?</p>
    <p>A. H<sub>2</sub>SO<sub>4</sub>   B. NaOH   C. HCl   D. NaCl</p>
    <p>Đáp án: A, C</p>
    <p>Câu 2: Xét phản ứng nhiệt phân CaCO<sub>3</sub> tạo CaO + CO<sub>2</sub>.</p>
    <p>a) Phản ứng thu nhiệt.</p>
    <p>b) Cần nung nóng ở nhiệt độ cao.</p>
    <p>c) Sản phẩm có khí O<sub>2</sub>.</p>
    <p>d) Khối lượng chất rắn sau phản ứng tăng.</p>
    <p>Đáp án: Đ - Đ - S - S</p>
    <p>Câu 3: Phương trình ion rút gọn của phản ứng chưa cân bằng?</p>
    <p>A. H<sup>+</sup> + OH<sup>-</sup> → H<sub>2</sub>O</p>
    <p>B. Ba<sup>2+</sup> + SO<sub>4</sub><sup>2-</sup> → BaSO<sub>4</sub></p>
    <p>C. Ca<sup>2+</sup> + CO<sub>3</sub><sup>2-</sup> → CaCO<sub>3</sub></p>
    <p>D. Fe<sup>3+</sup> + 3OH<sup>-</sup> → Fe(OH)<sub>3</sub></p>
  </div>
  `;

  const parsedHtml = parseUniversalHtmlExam(htmlInput, testId);
  assert.equal(parsedHtml.report.suggestedSubject.suggestedId, 'hoa-hoc');
  assert.equal(parsedHtml.questions.length, 3);

  // Multi-select #1
  const qMulti = parsedHtml.questions[0];
  assert.equal(qMulti.universalType, 'multi-select');
  assert.equal(qMulti.correctOptionIds?.length, 2);
  assert.ok(qMulti.options?.[0].content.rawSource.includes('H₂SO₄'));

  // True/False #2
  const qTf = parsedHtml.questions[1];
  assert.equal(qTf.type, 'true-false');
  assert.deepEqual(
    qTf.statements?.map((s) => s.isTrue),
    [true, true, false, false]
  );

  // Câu 3 thiếu đáp án -> KHÔNG được tự bịa đáp án, phải gắn answerConfirmed=false & cảnh báo
  const qMissing = parsedHtml.questions[2];
  assert.equal(qMissing.answerConfirmed, false);
  assert.equal(parsedHtml.report.unconfirmedAnswerCount, 1);

  // Matching text test
  const matchingRes = parseUniversalExamText(
    `Phần Ghép đôi
Câu 1: Nối tên nguyên tố ở Cột A với ký hiệu hóa học ở Cột B:
1. Natri | a. Na
2. Sắt | b. Fe
3. Đồng | c. Cu
Đáp án: 1-a, 2-b, 3-c`,
    testId
  );
  assert.equal(matchingRes.questions[0].universalType, 'matching');
  assert.equal(matchingRes.questions[0].matching?.leftItems.length, 3);
  assert.equal(matchingRes.questions[0].matching?.correctPairs.length, 3);
});

test('Stage 3.4: Merged imported project mixes cleanly while keeping Math Safety guarantees', async () => {
  const parsed = parseUniversalExamText(
    `
Câu 1: Đạo hàm của hàm số $y = x^3$ là:
A. $3x^2$  B. $x^2$  C. $3x$  D. $x^3$
Đáp án: A

Câu 2: Tích phân $\\int_0^1 2x\\,dx$ bằng:
A. $0$  B. $1$  C. $2$  D. $4$
Đáp án: B
`,
    testId,
    { subjectId: 'toan' }
  );

  const merged = mergeImportedExamIntoProject(structuredClone(DEMO_MATH_EXAM), parsed, {
    replaceExisting: true,
    applySuggestedSubject: false,
  });
  merged.confirmedOriginalAnswers = true;
  merged.mixConfig.examCount = 2;

  const mixed = generateMixedExams(merged);
  assert.equal(mixed.errors.length, 0);
  assert.equal(mixed.versions.length, 2);
  assert.ok(mixed.versions.every((v) => v.integrityPassed));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractDocxDocument } from './ooxmlParser';
import {
  importUniversalExamFile,
  mergeImportedExamIntoProject,
  parseUniversalHtmlExam,
} from './universalImportEngine';
import {
  computeContentHash,
  computeVisualAssetChecksum,
  createMathVisualAsset,
  evaluatePreMixIntegrity,
  verifyVisualAssetIntegrity,
} from './mathIntegrity';
import { generateMixedExams } from './mathShuffleEngine';
import { buildStudentExamDocxBuffer, verifyExportedDocxBuffer } from './examExportEngine';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import { MathExamProject, QuestionGroup } from '../types/mathExam';

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function ommlFrac(num: string, den: string): string {
  return `<m:oMath><m:f><m:num><m:r><m:t>${num}</m:t></m:r></m:num><m:den><m:r><m:t>${den}</m:t></m:r></m:den></m:f></m:oMath>`;
}

/**
 * Tạo fixture .docx mô phỏng cấu trúc tệp thực tế "Đề KTGKI.K12.NH.24-25.Ngọc (1).docx":
 * - 12 ảnh PNG trong word/media (10 ảnh dùng trong thân đề + 2 ảnh dư trong .rels) -> trước đây khiến w:tbl đầu tiên bị đánh số #11
 * - 3 bảng w:tbl thực sự (Bảng 1 ngay tại Câu 1 Phần I, Bảng 2 tại Câu 1 Phần II, Bảng 3 là bảng đáp án trang cuối)
 * - 17 công thức OMML (<m:oMath>)
 * - Các đối tượng MathType OLE cũ (Equation.DSMT4) lồng trong <w:r><w:object> kèm ảnh xem trước .wmf và <w:pict><v:imagedata> .wmf
 * - 45 cấu trúc <w:numPr>
 * - 3 phần: 12 câu Trắc nghiệm + 4 câu Đúng/Sai + 6 câu Trả lời ngắn = 22 câu
 * - Phần BẢNG ĐÁP ÁN + LỜI GIẢI CHI TIẾT ở cuối tài liệu
 */
async function buildRealisticNgocDocxFixture(options?: {
  includeLegacyOleAndWmf?: boolean;
}): Promise<Uint8Array> {
  const includeOle = options?.includeLegacyOleAndWmf ?? true;
  const zip = new JSZip();

  const relEntries: string[] = [];
  for (let i = 1; i <= 12; i++) {
    relEntries.push(
      `<Relationship Id="rIdPng${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i}.png"/>`
    );
    zip.file(`word/media/image${i}.png`, TINY_PNG_BASE64, { base64: true });
  }

  if (includeOle) {
    for (let i = 1; i <= 4; i++) {
      relEntries.push(
        `<Relationship Id="rIdWmf${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/eq_preview_${i}.wmf"/>`
      );
      relEntries.push(
        `<Relationship Id="rIdOle${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject${i}.bin"/>`
      );
      zip.file(`word/media/eq_preview_${i}.wmf`, Uint8Array.from([0xd7, 0xcd, 0xc6, 0x9a, i]));
      zip.file(`word/embeddings/oleObject${i}.bin`, Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, i]));
    }
  }

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relEntries.join('\n  ')}
</Relationships>`;

  const bodyParts: string[] = [];
  const numPrXml = `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>`;

  bodyParts.push(
    `<w:p><w:r><w:t>ĐỀ KIỂM TRA GIỮA HỌC KÌ I — MÔN TOÁN LỚP 12 (NH 24-25)</w:t></w:r></w:p>`
  );

  // PHẦN I: 12 câu MCQ (12 OMML + 10 PNG + 1 w:tbl ngay ở Câu 1 + 1 OLE Equation.DSMT4 ở Câu 2)
  bodyParts.push(`<w:p><w:r><w:t>PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.</w:t></w:r></w:p>`);

  // Câu 1 có BẢNG BIẾN THIÊN (w:tbl #1) + OMML #1 + PNG #1
  bodyParts.push(
    `<w:p>${numPrXml}<w:r><w:t>Câu 1: Cho hàm số $y = f(x)$ có đạo hàm </w:t></w:r>${ommlFrac('x-1', 'x+2')}<w:r><w:t> và bảng biến thiên:</w:t></w:r><w:r><w:drawing><a:blip r:embed="rIdPng1"/></w:drawing></w:r></w:p>`
  );
  bodyParts.push(`
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>-∞</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>+∞</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>f'(x)</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>-</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>0</w:t></w:r></w:p></w:tc>
        <w:tc><w:r><w:t>+</w:t></w:r></w:tc>
      </w:tr>
    </w:tbl>
  `);
  // Note fixed <w:tc><w:p> for the last cell in real XML:
  bodyParts.pop();
  bodyParts.push(`
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>-∞</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>+∞</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>f'(x)</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>-</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>0</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>+</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  `);
  bodyParts.push(`<w:p><w:r><w:t>A. $(1; +\\infty)$   B. $(-\\infty; 1)$   C. $(-2; 1)$   D. $(0; 1)$</w:t></w:r></w:p>`);

  for (let i = 2; i <= 12; i++) {
    const imgMarkup =
      i <= 10
        ? `<w:r><w:drawing><a:blip r:embed="rIdPng${i}"/></w:drawing></w:r>`
        : '';
    const oleMarkup =
      includeOle && i === 2
        ? `<w:r><w:object><v:shape id="_x0000_i1025"><v:imagedata r:id="rIdWmf1"/></v:shape><o:OLEObject Type="Embed" ProgID="Equation.DSMT4" ShapeID="_x0000_i1025" r:id="rIdOle1"/></w:object></w:r>`
        : '';
    const vmlWmfMarkup =
      includeOle && i === 3
        ? `<w:r><w:pict><v:shape id="_x0000_i1026"><v:imagedata r:id="rIdWmf2"/></v:shape></w:pict></w:r>`
        : '';
    bodyParts.push(
      `<w:p>${numPrXml}<w:r><w:t>Câu ${i}: Tìm giá trị biểu thức </w:t></w:r>${ommlFrac(String(i), 'x+1')}${oleMarkup}${vmlWmfMarkup}${imgMarkup}</w:p>`
    );
    bodyParts.push(
      `<w:p><w:r><w:t>A. ${i}   B. ${i + 1}   C. ${i + 2}   D. ${i + 3}</w:t></w:r></w:p>`
    );
  }

  // PHẦN II: 4 câu Đúng/Sai (4 OMML + 1 w:tbl ở Câu 1)
  bodyParts.push(`<w:p><w:r><w:t>PHẦN II. Câu trắc nghiệm đúng sai.</w:t></w:r></w:p>`);
  for (let i = 1; i <= 4; i++) {
    bodyParts.push(
      `<w:p>${numPrXml}<w:r><w:t>Câu ${i}: Xét hàm số $f(x) = x^3 - 3x + ${i}$ với </w:t></w:r>${ommlFrac('a', String(i))}</w:p>`
    );
    if (i === 1) {
      bodyParts.push(`
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Điểm</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>-1</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Giá trị</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>-1</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      `);
    }
    bodyParts.push(`<w:p>${numPrXml}<w:r><w:t>a) Hàm số đồng biến trên $(1; +\\infty)$.</w:t></w:r></w:p>`);
    bodyParts.push(`<w:p>${numPrXml}<w:r><w:t>b) Đạo hàm $f'(x) = 3x^2 - 3$.</w:t></w:r></w:p>`);
    bodyParts.push(`<w:p>${numPrXml}<w:r><w:t>c) Đồ thị cắt trục tung tại điểm $(0; ${i})$.</w:t></w:r></w:p>`);
    bodyParts.push(`<w:p>${numPrXml}<w:r><w:t>d) Giá trị cực tiểu lớn hơn $10$.</w:t></w:r></w:p>`);
  }

  // PHẦN III: 6 câu Trả lời ngắn (1 OMML + 1 OLE Equation.DSMT4)
  bodyParts.push(`<w:p><w:r><w:t>PHẦN III. Câu trắc nghiệm trả lời ngắn.</w:t></w:r></w:p>`);
  for (let i = 1; i <= 6; i++) {
    const ommlOrOle =
      i === 1
        ? ommlFrac('2x+1', 'x-1')
        : includeOle && i === 2
        ? `<w:r><w:object><v:shape id="_x0000_i1030"><v:imagedata r:id="rIdWmf3"/></v:shape><o:OLEObject Type="Embed" ProgID="Equation.DSMT4" r:id="rIdOle3"/></w:object></w:r>`
        : '';
    bodyParts.push(
      `<w:p>${numPrXml}<w:r><w:t>Câu ${i}: Tính tổng nghiệm nguyên nhỏ hơn ${i + 5} của phương trình </w:t></w:r>${ommlOrOle}</w:p>`
    );
  }

  // Trang 5+: BẢNG ĐÁP ÁN (chứa w:tbl thứ 3) + LỜI GIẢI CHI TIẾT
  bodyParts.push(`<w:p><w:r><w:t>BẢNG ĐÁP ÁN VÀ LỜI GIẢI CHI TIẾT</w:t></w:r></w:p>`);
  bodyParts.push(`<w:p><w:r><w:t>PHẦN I. Trắc nghiệm</w:t></w:r></w:p>`);
  bodyParts.push(`
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Câu</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Đáp án</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  `);
  bodyParts.push(`<w:p><w:r><w:t>7.C  8.D  9.A  10.B  11.C  12.D</w:t></w:r></w:p>`);
  bodyParts.push(`<w:p><w:r><w:t>PHẦN II. Đúng / Sai</w:t></w:r></w:p>`);
  bodyParts.push(
    `<w:p><w:r><w:t>Câu 1: Đ-Đ-Đ-S</w:t></w:r></w:p><w:p><w:r><w:t>Câu 2: Đ-Đ-Đ-S</w:t></w:r></w:p><w:p><w:r><w:t>Câu 3: Đ-Đ-Đ-S</w:t></w:r></w:p><w:p><w:r><w:t>Câu 4: Đ-Đ-Đ-S</w:t></w:r></w:p>`
  );
  bodyParts.push(`<w:p><w:r><w:t>PHẦN III. Trả lời ngắn</w:t></w:r></w:p>`);
  bodyParts.push(
    `<w:p><w:r><w:t>1. 12   2. -3,5   3. 7   4. 10   5. 15   6. 21</w:t></w:r></w:p>`
  );
  bodyParts.push(`<w:p><w:r><w:t>LỜI GIẢI CHI TIẾT</w:t></w:r></w:p>`);
  bodyParts.push(
    `<w:p><w:r><w:t>Câu 1: Ta có bảng biến thiên suy ra hàm số đồng biến trên (1; +∞). Chọn A.</w:t></w:r></w:p>`
  );
  bodyParts.push(
    `<w:p><w:r><w:t>Câu 2: Áp dụng đạo hàm thương số ta được đáp án B.</w:t></w:r></w:p>`
  );

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:body>
    ${bodyParts.join('\n    ')}
  </w:body>
</w:document>`;

  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', relsXml);

  return zip.generateAsync({ type: 'uint8array' });
}

test('IMP-01 Root Cause 1 & 2 Verification: Explains why #11 happened and proves 3 w:tbl now get #1..#3 with matching canonical checksums', async () => {
  // Trước sửa lỗi: ooxmlParser tạo nhãn "Bảng dữ liệu DOCX #11" nhưng lại băm "data-table::Bảng::..."
  const sampleBody = 'x | -∞ | 1 | +∞\nf\'(x) | - | 0 | +';
  const legacyBadChecksum = computeContentHash(`data-table::Bảng::${sampleBody}`);
  const canonicalForLabel11 = computeVisualAssetChecksum({
    kind: 'data-table',
    label: 'Bảng dữ liệu DOCX #11',
    sourceData: sampleBody,
  });
  assert.notEqual(
    legacyBadChecksum,
    canonicalForLabel11,
    'Chứng minh công thức cũ băm "Bảng" khác với asset.label gây lỗi IMP-01'
  );

  // Sau sửa lỗi trên fixture 22 câu / 3 phần / 12 PNG + WMF + OLE + 3 w:tbl + Lời giải chi tiết
  const docxBytes = await buildRealisticNgocDocxFixture({ includeLegacyOleAndWmf: true });
  const extracted = await extractDocxDocument(docxBytes);

  assert.equal(extracted.tableCount, 3, 'Chỉ có đúng 3 bảng w:tbl thực sự');
  assert.equal(extracted.supportedImageCount, 10, 'Chỉ nạp 10 ảnh PNG thực sự được tham chiếu trong document.xml');
  assert.equal(extracted.ommlFragments.length, 17, 'Trích xuất đủ 17 công thức OMML');

  const tableAssets = extracted.assets.filter((a) => a.kind === 'data-table');
  assert.equal(tableAssets.length, 3);
  assert.deepEqual(
    tableAssets.map((t) => t.id),
    ['docx-tbl-1', 'docx-tbl-2', 'docx-tbl-3']
  );
  assert.deepEqual(
    tableAssets.map((t) => t.label),
    ['Bảng dữ liệu DOCX #1', 'Bảng dữ liệu DOCX #2', 'Bảng dữ liệu DOCX #3']
  );
  assert.equal(tableAssets[0].sourceLocation, 'w:body/w:tbl[1]');

  for (const asset of extracted.assets) {
    const check = verifyVisualAssetIntegrity(asset);
    assert.equal(check.valid, true, `Tài nguyên ${asset.id} (${asset.label}) phải hợp lệ checksum`);
  }
});

test('IMP-01 Repair & Separation of Concerns: Imports 22-question 3-section DOCX cleanly without IMP-01 false BLOCKED, while keeping OLE/WMF warnings transparent', async () => {
  const docxBytes = await buildRealisticNgocDocxFixture({ includeLegacyOleAndWmf: true });
  const imported = await importUniversalExamFile(
    { fileName: 'De_KTGKI_K12_NH_24-25_Ngoc.docx', buffer: docxBytes },
    nextId,
    { subjectId: 'toan' }
  );

  // 1. Tách đúng 22 câu (12 MCQ + 4 Đúng/Sai + 6 Trả lời ngắn), KHÔNG bị phần "LỜI GIẢI CHI TIẾT" đè thành câu thừa
  assert.equal(imported.questions.length, 22);
  assert.equal(imported.questions.filter((q) => q.type === 'mcq').length, 12);
  assert.equal(imported.questions.filter((q) => q.type === 'true-false').length, 4);
  assert.equal(imported.questions.filter((q) => q.type === 'short-answer').length, 6);

  // 2. Mã câu hỏi không trùng lặp "IMP-01" giữa 3 phần
  const codes = imported.questions.map((q) => q.code);
  assert.equal(new Set(codes).size, 22, 'Mỗi câu trong 3 phần phải có mã duy nhất');
  assert.equal(codes[0], 'IMP-01');
  assert.equal(codes[12], 'IMP-P2-01');
  assert.equal(codes[16], 'IMP-P3-01');

  // 3. Đáp án từ BẢNG ĐÁP ÁN theo từng phần khớp chính xác (không bị Phần III ghi đè Phần I Câu 1)
  assert.equal(imported.questions[0].correctOptionId, imported.questions[0].options?.[0].id); // 1 -> A
  assert.equal(imported.questions[11].correctOptionId, imported.questions[11].options?.[3].id); // 12 -> D
  assert.deepEqual(
    imported.questions[12].statements?.map((s) => s.isTrue),
    [true, true, true, false]
  );
  assert.equal(imported.questions[16].shortAnswer?.answerValue, '12');
  assert.equal(imported.questions[17].shortAnswer?.answerValue, '-3,5');
  assert.equal(imported.report.confirmedAnswerCount, 22);

  // 4. Không gắn nhầm Bảng #3 (bảng đáp án trang cuối) vào Câu 22
  const attachedIds = imported.questions.flatMap((q) => (q.visualAssets ?? []).map((a) => a.id));
  assert.ok(attachedIds.includes('docx-tbl-1'));
  assert.ok(attachedIds.includes('docx-tbl-2'));
  assert.ok(!attachedIds.includes('docx-tbl-3'), 'Bảng đáp án cuối đề không được gắn nhầm vào câu hỏi');

  // 5. Cảnh báo OLE (Equation.DSMT4) & WMF minh bạch, tách biệt hoàn toàn với lỗi checksum
  assert.equal(imported.report.legacyOleCount, 2);
  assert.ok((imported.report.unsupportedMediaCount ?? 0) >= 2);
  assert.ok(imported.report.warnings.some((w) => /Equation\.DSMT4/i.test(w)));
  assert.ok(imported.report.warnings.some((w) => /WMF\/EMF/i.test(w)));

  // Kiểm tra câu chứa <w:r><w:object> (Câu 2 phần I và Câu 2 phần III) thực sự gắn marker [CÔNG_THỨC_OLE_LEGACY]
  assert.ok(imported.questions[1].stem.rawSource.includes('[CÔNG_THỨC_OLE_LEGACY]'));
  assert.ok(imported.questions[17].stem.rawSource.includes('[CÔNG_THỨC_OLE_LEGACY]'));

  // 6. Kiểm tra Integrity Report trên đề vừa nhập: ZERO BLOCKED checksum / IMP-01!
  const project = mergeImportedExamIntoProject(structuredClone(DEMO_MATH_EXAM), imported, {
    replaceExisting: true,
    applySuggestedSubject: false,
  });
  project.confirmedOriginalAnswers = true;

  const preReport = evaluatePreMixIntegrity(project);
  const checksumErrors = preReport.issues.filter((i) => i.id.startsWith('q-asset-checksum-'));
  assert.equal(checksumErrors.length, 0, 'Không còn lỗi giả mạo IMP-01 checksum mismatch');
  assert.equal(
    preReport.status,
    'BLOCKED',
    'P0: Công thức MathType OLE chưa giải mã được ([CÔNG_THỨC_OLE_LEGACY]) bắt buộc bị BLOCKED để không xuất đề mất công thức'
  );
  assert.ok(preReport.issues.some((i) => i.id.startsWith('q-legacy-eq-') && i.severity === 'error'));
});

test('True Integrity Tampering MUST STILL BLOCK: Mutated data-table, asset label, or sharedAssets checksum is blocked', () => {
  const validTable = createMathVisualAsset({
    id: 'docx-tbl-1',
    kind: 'data-table',
    label: 'Bảng dữ liệu DOCX #1',
    sourceData: 'x | 0 | 1\ny | 2 | 4',
    sourceLocation: 'w:body/w:tbl[1]',
  });

  // Case A: Tamper table sourceData without updating checksum -> MUST BLOCK
  const projectTamperedData: MathExamProject = {
    ...structuredClone(DEMO_MATH_EXAM),
    confirmedOriginalAnswers: true,
    questions: [
      {
        ...structuredClone(DEMO_MATH_EXAM.questions[0]),
        visualAssets: [{ ...validTable, sourceData: 'x | 0 | 999\ny | 2 | 4' }],
        hasVisualAsset: true,
      },
    ],
  };
  const reportA = evaluatePreMixIntegrity(projectTamperedData);
  assert.equal(reportA.status, 'BLOCKED');
  assert.equal(reportA.canExport, false);
  const assetErrA = reportA.issues.find((i) => i.id.startsWith('q-asset-checksum-'));
  assert.ok(assetErrA);
  assert.ok(assetErrA.message.includes('id=docx-tbl-1'));
  assert.ok(assetErrA.message.includes('nguồn=w:body/w:tbl[1]'));

  // Case B: Tamper group sharedAssets checksum -> MUST BLOCK
  const badShared = createMathVisualAsset({
    id: 'grp-tbl-1',
    kind: 'data-table',
    label: 'Bảng nhóm #1',
    sourceData: 'A | B\n1 | 2',
  });
  badShared.checksum = '00000000-00000000-99';
  const group: QuestionGroup = {
    id: 'grp-1',
    title: 'Nhóm bảng biểu',
    sharedContext: structuredClone(DEMO_MATH_EXAM.questions[0].stem),
    sharedAssets: [badShared],
    questionIds: [DEMO_MATH_EXAM.questions[0].id, DEMO_MATH_EXAM.questions[1].id],
    lockGroupPosition: false,
    moveAsUnit: true,
  };
  const projectTamperedGroup: MathExamProject = {
    ...structuredClone(DEMO_MATH_EXAM),
    confirmedOriginalAnswers: true,
    questionGroups: [group],
  };
  const reportB = evaluatePreMixIntegrity(projectTamperedGroup);
  assert.equal(reportB.status, 'BLOCKED');
  assert.ok(reportB.issues.some((i) => i.id.startsWith('grp-asset-checksum-')));
});

test('HTML Table Import Regression: HTML <table> uses canonical checksum and passes integrity check', () => {
  const html = `
    <div>
      <p>Câu 1: Cho bảng số liệu hàm số:</p>
      <table>
        <tr><th>x</th><th>0</th><th>1</th></tr>
        <tr><td>y</td><td>2</td><td>5</td></tr>
      </table>
      <p>A. 2   B. 5   C. 7   D. 9</p>
      <p>Đáp án: B</p>
    </div>
  `;
  const parsed = parseUniversalHtmlExam(html, nextId, { subjectId: 'toan' });
  assert.equal(parsed.questions.length, 1);
  const tbl = parsed.questions[0].visualAssets?.find((a) => a.kind === 'data-table');
  assert.ok(tbl);
  assert.equal(verifyVisualAssetIntegrity(tbl).valid, true);

  const project = mergeImportedExamIntoProject(structuredClone(DEMO_MATH_EXAM), parsed, {
    replaceExisting: true,
    applySuggestedSubject: false,
  });
  project.confirmedOriginalAnswers = true;
  const pre = evaluatePreMixIntegrity(project);
  assert.equal(pre.status, 'PASS');
  assert.equal(pre.canExport, true);
});

test('End-to-End 22-question DOCX (without OLE) mixes 4 & 10 exam codes and exports DOCX cleanly with 0 integrity errors', async () => {
  const docxBytes = await buildRealisticNgocDocxFixture({ includeLegacyOleAndWmf: false });
  const imported = await importUniversalExamFile(
    { fileName: 'de-chuan-omml.docx', buffer: docxBytes },
    nextId,
    { subjectId: 'toan' }
  );

  const project = mergeImportedExamIntoProject(structuredClone(DEMO_MATH_EXAM), imported, {
    replaceExisting: true,
    applySuggestedSubject: false,
  });
  project.confirmedOriginalAnswers = true;
  project.mixConfig = {
    ...project.mixConfig,
    level: 2,
    examCount: 10,
    seed: 'NGOC-2425-K12',
  };

  const pre = evaluatePreMixIntegrity(project);
  assert.equal(pre.status, 'PASS');
  assert.equal(pre.canExport, true);

  const mixed = generateMixedExams(project);
  assert.equal(mixed.errors.length, 0);
  assert.equal(mixed.versions.length, 10);
  assert.ok(mixed.versions.every((v) => v.integrityPassed && v.integrityStatus === 'PASS'));

  // Kiểm tra file DOCX xuất ra cho mã đề đầu tiên khôi phục đầy đủ bảng, ảnh và không mất công thức
  const readyExam: MathExamProject = {
    ...project,
    generatedVersions: mixed.versions,
  };
  const studentDocx = await buildStudentExamDocxBuffer(readyExam, readyExam.generatedVersions[0]);
  const verified = await verifyExportedDocxBuffer(studentDocx, readyExam.generatedVersions[0], readyExam);
  assert.equal(verified.passed, true);
  assert.equal(verified.issues.length, 0);
});

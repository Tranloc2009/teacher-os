import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  convertWmfToSvg,
  decodeMathTypeMtef,
  decodeOleFormulaPayload,
  extractOle2Stream,
} from './oleAndWmfDecoder';
import { extractDocxDocument } from './ooxmlParser';
import {
  importUniversalExamFile,
  mergeImportedExamIntoProject,
  parseUniversalExamText,
} from './universalImportEngine';
import { parseLatexExamText } from './mathTextParser';
import {
  checkExamExportGate,
  computeQuestionVerificationContentHash,
  detectDuplicateQuestionGroups,
  evaluatePreMixIntegrity,
} from './mathIntegrity';
import { generateMixedExams } from './mathShuffleEngine';
import {
  buildAnswerKeyDocxBuffer,
  buildConsolidatedAnswerCsv,
  buildMixedExamJsonExportPayload,
  buildStudentExamDocxBuffer,
  exportMixedExamZipBundle,
  verifyExportedAnswerKeyDocxBuffer,
  verifyExportedCsv,
  verifyExportedDocxBuffer,
} from './examExportEngine';
import { normalizeMathExamProject } from '../db/database';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import { MathExamProject } from '../types/mathExam';

let seq = 0;
const makeId = (prefix: string) => `${prefix}-p0-${++seq}`;

/**
 * Helper: build a real minimal CFBF / OLE2 binary file containing an "Equation Native" stream
 * (512-byte sectors, regular sector allocation >= 4096 bytes for clean FAT path).
 */
function buildSyntheticOle2WithEquationNative(eqNativePayload: Uint8Array): Uint8Array {
  const sectorSize = 512;
  // Pad stream to >= 4096 bytes (cutoff) so it resides in regular FAT sectors cleanly
  const paddedStreamLen = Math.max(4096, Math.ceil(eqNativePayload.length / sectorSize) * sectorSize);
  const streamSectors = paddedStreamLen / sectorSize;
  // Sector 0 = FAT, Sector 1 = Directory, Sector 2..(2+streamSectors-1) = Equation Native stream
  const totalSectors = 2 + streamSectors;
  const buf = new Uint8Array((1 + totalSectors) * sectorSize);
  const view = new DataView(buf.buffer);

  // Header magic D0 CF 11 E0 A1 B1 1A E1
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  magic.forEach((b, i) => (buf[i] = b));
  view.setUint16(24, 0x003e, true); // minor version
  view.setUint16(26, 0x0003, true); // major version 3 (512-byte sectors)
  view.setUint16(28, 0xfffe, true); // little-endian
  view.setUint16(30, 9, true); // sector shift 2^9 = 512
  view.setUint16(32, 6, true); // mini sector shift 2^6 = 64
  view.setUint32(44, 1, true); // 1 FAT sector
  view.setUint32(48, 1, true); // first dir sector = 1
  view.setUint32(56, 4096, true); // mini stream cutoff
  view.setUint32(60, 0xfffffffe, true); // no MiniFAT
  view.setUint32(64, 0, true);
  view.setUint32(68, 0xfffffffe, true); // no DIFAT chain
  view.setUint32(72, 0, true);

  // DIFAT[0] = sector 0 (FAT), rest = FREESECT (0xFFFFFFFF)
  view.setUint32(76, 0, true);
  for (let i = 1; i < 109; i++) {
    view.setUint32(76 + i * 4, 0xffffffff, true);
  }

  // Sector 0: FAT
  const fatOffset = sectorSize;
  for (let i = 0; i < 128; i++) {
    view.setUint32(fatOffset + i * 4, 0xffffffff, true);
  }
  view.setUint32(fatOffset + 0 * 4, 0xfffffffd, true); // FATSECT
  view.setUint32(fatOffset + 1 * 4, 0xfffffffe, true); // ENDOFCHAIN (Dir)
  for (let s = 0; s < streamSectors; s++) {
    const cur = 2 + s;
    const next = s + 1 < streamSectors ? cur + 1 : 0xfffffffe;
    view.setUint32(fatOffset + cur * 4, next, true);
  }

  // Sector 1: Directory (Entry 0 = Root Entry, Entry 1 = Equation Native)
  const dirOffset = 2 * sectorSize;
  const writeDirEntry = (
    entryIdx: number,
    name: string,
    objType: number,
    startSector: number,
    streamSize: number,
    childDid = 0xffffffff
  ) => {
    const base = dirOffset + entryIdx * 128;
    for (let i = 0; i < name.length; i++) {
      view.setUint16(base + i * 2, name.charCodeAt(i), true);
    }
    view.setUint16(base + name.length * 2, 0, true);
    view.setUint16(base + 64, (name.length + 1) * 2, true);
    buf[base + 66] = objType;
    buf[base + 67] = 1; // black
    view.setUint32(base + 68, 0xffffffff, true); // left
    view.setUint32(base + 72, 0xffffffff, true); // right
    view.setUint32(base + 76, childDid, true); // child
    view.setUint32(base + 116, startSector, true);
    view.setUint32(base + 120, streamSize, true);
  };

  writeDirEntry(0, 'Root Entry', 5, 0xfffffffe, 0, 1);
  writeDirEntry(1, 'Equation Native', 2, 2, eqNativePayload.length);

  // Sector 2..: Stream bytes
  buf.set(eqNativePayload, 3 * sectorSize);
  return buf;
}

/**
 * Helper: build a real Equation Native payload wrapping MTEF v5 for `\frac{1}{x+1}`.
 */
function buildSyntheticMtefV5Fraction(): Uint8Array {
  const mtefBody: number[] = [
    5, // MTEF version 5
    1, // Windows platform
    1, // MathType product
    6, // product version
    0, // product subversion
    // App key (null-terminated)
    0x4d, 0x54, 0x00,
    0, // equation options = 0
    // LINE record (recordType=1, options=0)
    1, 0,
    // TMPL record (recordType=3, options=0, selector=11 fraction, variation=0, tmplOpts=0)
    3, 0, 11, 0, 0,
    // Numerator slot: LINE -> CHAR '1' -> END
    1, 0,
    2, 0, 1, 0x31, 0x00, // CHAR(typeface=1, utf16='1')
    0, // END numerator LINE
    // Denominator slot: LINE -> CHAR 'x', CHAR '+', CHAR '1' -> END
    1, 0,
    2, 0, 1, 0x78, 0x00,
    2, 0, 1, 0x2b, 0x00,
    2, 0, 1, 0x31, 0x00,
    0, // END denominator LINE
    0, // END TMPL
    0, // END main LINE
    0, // END MTEF
  ];

  // 28-byte Equation Native header
  const header = new Uint8Array(28);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, 28, true); // cbHdr = 28
  hv.setUint32(4, 0x00020000, true); // version
  hv.setUint16(8, 0xc000, true); // cf
  hv.setUint32(12, mtefBody.length, true); // cbObject

  const out = new Uint8Array(28 + mtefBody.length);
  out.set(header, 0);
  out.set(mtefBody, 28);
  return out;
}

/**
 * Helper: build a real binary Aldus Placeable WMF with a polyline + text.
 */
function buildSyntheticPlaceableWmf(): Uint8Array {
  const words: number[] = [];
  const pushU16 = (v: number) => words.push(v & 0xffff);
  const pushI16 = (v: number) => words.push(v < 0 ? (0x10000 + v) & 0xffff : v & 0xffff);
  const pushU32 = (v: number) => {
    pushU16(v & 0xffff);
    pushU16((v >>> 16) & 0xffff);
  };

  // Aldus placeable header (22 bytes = 11 words)
  pushU32(0x9ac6cdd7); // magic
  pushU16(0); // hmf
  pushI16(0); // left
  pushI16(0); // top
  pushI16(400); // right
  pushI16(200); // bottom
  pushU16(1440); // inch
  pushU32(0); // reserved
  pushU16(0); // checksum (not strictly enforced)

  // Standard WMF header (18 bytes = 9 words)
  pushU16(1); // memory metafile
  pushU16(9); // header size in words
  pushU16(0x0300); // Windows 3.0
  pushU32(40); // file size in words
  pushU16(1); // num objects
  pushU32(10); // max record
  pushU16(0); // num params

  // Record 1: META_SETWINDOWORG (0x020B), size=5 words: y=0, x=0
  pushU32(5);
  pushU16(0x020b);
  pushI16(0);
  pushI16(0);

  // Record 2: META_SETWINDOWEXT (0x020C), size=5 words: cy=200, cx=400
  pushU32(5);
  pushU16(0x020c);
  pushI16(200);
  pushI16(400);

  // Record 3: META_POLYLINE (0x0325), size=3+1+2*2 = 8 words: 2 points (10,10) -> (390,190)
  pushU32(8);
  pushU16(0x0325);
  pushU16(2);
  pushI16(10);
  pushI16(10);
  pushI16(390);
  pushI16(190);

  // Record 4: META_EOF (0x0000), size=3 words
  pushU32(3);
  pushU16(0x0000);

  const bytes = new Uint8Array(words.length * 2);
  const dv = new DataView(bytes.buffer);
  words.forEach((w, idx) => dv.setUint16(idx * 2, w, true));
  return bytes;
}

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('P0-1: Static CFBF/OLE2 + MathType MTEF v5 decodes fraction to KaTeX-valid LaTeX & rejects garbage', () => {
  const eqNative = buildSyntheticMtefV5Fraction();
  const ole2Bytes = buildSyntheticOle2WithEquationNative(eqNative);

  const extracted = extractOle2Stream(ole2Bytes, 'Equation Native');
  assert.ok(extracted, 'Must extract Equation Native stream from CFBF container');
  assert.equal(extracted.length, eqNative.length);

  const mtef = decodeMathTypeMtef(extracted);
  assert.equal(mtef.ok, true, `Expected MTEF decode ok, got: ${mtef.reason}`);
  assert.equal(mtef.latex, '\\frac{1}{x+1}');

  const full = decodeOleFormulaPayload({ oleBytes: ole2Bytes, progId: 'Equation.DSMT4' });
  assert.equal(full.mode, 'ole-mtef-latex');
  assert.equal(full.displayable, true);
  assert.equal(full.machineReadable, true);
  assert.equal(full.latex, '\\frac{1}{x+1}');

  // Corrupt / unsupported OLE without preview must be unresolved & non-displayable
  const bad = decodeOleFormulaPayload({
    oleBytes: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
    progId: 'Equation.3',
  });
  assert.equal(bad.mode, 'unresolved-ole');
  assert.equal(bad.displayable, false);
  assert.equal(bad.machineReadable, false);
});

test('P0-2: Static Aldus Placeable WMF converts to verified SVG and rejects empty/corrupt WMF', () => {
  const wmfBytes = buildSyntheticPlaceableWmf();
  const svgRes = convertWmfToSvg(wmfBytes);
  assert.equal(svgRes.ok, true, `Expected WMF->SVG ok, got: ${svgRes.reason}`);
  assert.ok(svgRes.svgMarkup && svgRes.svgMarkup.includes('<svg') && svgRes.svgMarkup.includes('<polyline'));
  assert.ok(svgRes.primitiveCount >= 1);

  // OLE fallback to WMF preview marks displayable=true, machineReadable=false
  const fallback = decodeOleFormulaPayload({
    oleBytes: new Uint8Array([0x00, 0x00]),
    wmfPreviewBytes: wmfBytes,
    progId: 'Equation.3',
  });
  assert.equal(fallback.mode, 'ole-wmf-svg-preview');
  assert.equal(fallback.displayable, true);
  assert.equal(fallback.machineReadable, false);
  assert.ok(fallback.svgMarkup?.includes('<svg'));

  // Corrupt WMF must fail cleanly
  const badWmf = convertWmfToSvg(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  assert.equal(badWmf.ok, false);
});

test('P0-3: DOCX segmentation (MATRIX/EXAM/HẾT/SOLUTION), mc:AlternateContent, wp:anchor, split-run underline vs bold, option images, Part III A.<val>, and conflict detection', async () => {
  const zip = new JSZip();
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdAnchor" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/anchor1.png"/>
  <Relationship Id="rIdOptA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/optA.png"/>
  <Relationship Id="rIdOptB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/optB.png"/>
  <Relationship Id="rIdOptC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/optC.png"/>
  <Relationship Id="rIdOptD" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/optD.png"/>
  <Relationship Id="rIdOle1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/>
</Relationships>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:body>
    <w:p><w:r><w:t>A. MA TRẬN ĐỀ KIỂM TRA TOÁN 12</w:t></w:r></w:p>
    <w:p><w:r><w:t>Câu 1: (Nội dung ma trận phải bị bỏ qua, không lọt vào đề học sinh)</w:t></w:r></w:p>

    <w:p><w:r><w:t>B. ĐỀ KIỂM TRA</w:t></w:r></w:p>
    <w:p><w:r><w:t>PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn. Thí sinh trả lời từ câu 1 đến câu 3.</w:t></w:r></w:p>

    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdAnchor"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Câu 1: Biểu thức OLE MathType </w:t></w:r>
      <mc:AlternateContent>
        <mc:Choice Requires="wps">
          <w:r><w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="rIdOle1"/></w:object></w:r>
        </mc:Choice>
        <mc:Fallback>
          <w:r><w:t>FALLBACK_SHOULD_NOT_DUPLICATE</w:t></w:r>
        </mc:Fallback>
      </mc:AlternateContent>
      <w:r><w:t> có giá trị tại x = 1 là:</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>A. 1</w:t></w:r>
      <w:r><w:tab/><w:t>B. 1/2</w:t></w:r>
      <w:r><w:tab/><w:t>C. 2</w:t></w:r>
      <w:r><w:tab/><w:t>D. 0</w:t></w:r>
    </w:p>

    <w:p><w:r><w:t>Câu 2: Hình nào dưới đây là đồ thị hàm số đã cho?</w:t></w:r></w:p>
    <w:p>
      <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>A</w:t></w:r><w:r><w:t>. </w:t></w:r>
      <w:r><w:drawing><a:blip r:embed="rIdOptA"/></w:drawing></w:r>
      <w:r><w:tab/><w:t>B. </w:t></w:r>
      <w:r><w:drawing><a:blip r:embed="rIdOptB"/></w:drawing></w:r>
      <w:r><w:tab/><w:t>C. </w:t></w:r>
      <w:r><w:drawing><a:blip r:embed="rIdOptC"/></w:drawing></w:r>
      <w:r><w:tab/><w:t>D. </w:t></w:r>
      <w:r><w:drawing><a:blip r:embed="rIdOptD"/></w:drawing></w:r>
    </w:p>

    <w:p><w:r><w:t>Câu 3: Câu kiểm tra xung đột bảng đáp án và lời giải:</w:t></w:r></w:p>
    <w:p><w:r><w:t>A. 10</w:t><w:tab/><w:t>B. 20</w:t><w:tab/><w:t>C. 30</w:t><w:tab/><w:t>D. 40</w:t></w:r></w:p>

    <w:p><w:r><w:t>PHẦN II. Câu trắc nghiệm đúng sai. Thí sinh trả lời từ câu 1 đến câu 1.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Câu 1: Cho hàm số f(x) = x^2 - 1.</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>a)</w:t></w:r><w:r><w:t> f(1) = 0.</w:t></w:r></w:p>
    <w:p><w:r><w:t>b) f(0) = 1.</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>c)</w:t></w:r><w:r><w:t> f(-1) = 0.</w:t></w:r></w:p>
    <w:p><w:r><w:t>d) f(2) = 5.</w:t></w:r></w:p>

    <w:p><w:r><w:t>PHẦN III. Câu trắc nghiệm trả lời ngắn. Thí sinh trả lời từ câu 1 đến câu 2.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Câu 1: Tính giá trị nhỏ nhất (nhập số thập phân âm):</w:t></w:r></w:p>
    <w:p><w:r><w:t>A. −4,3</w:t></w:r></w:p>
    <w:p><w:r><w:t>Câu 2: Tính giá trị của biểu thức tại điểm cân bằng:</w:t></w:r></w:p>

    <w:p><w:r><w:t>--- HẾT ---</w:t></w:r></w:p>
    <w:p><w:r><w:t>C. ĐÁP ÁN VÀ HƯỚNG DẪN GIẢI</w:t></w:r></w:p>
    <w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Câu</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Chọn</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>Câu 3: Câu lặp lại trong phần lời giải không được tạo thành câu mới! Chọn C.</w:t></w:r></w:p>
    <w:p><w:r><w:t>PHẦN III</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Câu</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Đáp án</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>0</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', relsXml);
  zip.file('word/media/anchor1.png', TINY_PNG_B64, { base64: true });
  zip.file('word/media/optA.png', TINY_PNG_B64, { base64: true });
  zip.file('word/media/optB.png', TINY_PNG_B64, { base64: true });
  zip.file('word/media/optC.png', TINY_PNG_B64, { base64: true });
  zip.file('word/media/optD.png', TINY_PNG_B64, { base64: true });
  zip.file(
    'word/embeddings/oleObject1.bin',
    buildSyntheticOle2WithEquationNative(buildSyntheticMtefV5Fraction())
  );

  const docxBytes = await zip.generateAsync({ type: 'uint8array' });
  const result = await importUniversalExamFile({ fileName: 'de-toan-12.docx', buffer: docxBytes }, makeId);

  // Must NOT leak MATRIX or SOLUTION questions -> exactly 3 MCQ + 1 TF + 2 SA = 6 questions
  assert.equal(result.questions.length, 6, `Expected 6 questions, got ${result.questions.length}`);

  // Q1: OLE decoded to LaTeX, mc:Fallback ignored, wp:anchor attached, bold+red on A ignored, table key B verified
  const q1 = result.questions[0];
  assert.ok(q1.stem.rawSource.includes('\\frac{1}{x+1}'));
  assert.ok(!q1.stem.rawSource.includes('FALLBACK_SHOULD_NOT_DUPLICATE'));
  assert.ok((q1.visualAssets?.length ?? 0) >= 1, 'Anchored image before Q1 must attach to Q1');
  assert.equal(q1.correctOptionId, q1.options?.[1].id, 'Table answer B must win; bold/red on A must be ignored');
  assert.equal(q1.answerProvenance?.status, 'source-matched');

  // Q2: Option-level images preserved on each option A/B/C/D (not leaked to stem!), split-run underline A -> needs-review
  const q2 = result.questions[1];
  assert.equal(q2.options?.length, 4);
  for (const opt of q2.options!) {
    assert.ok(opt.visualAsset?.sourceData.startsWith('data:image/png;base64,'), `Option ${opt.originalLabel} must have its own visualAsset`);
  }
  assert.equal(q2.answerProvenance?.status, 'needs-review', 'Underline-only cue must be needs-review');

  // Q3: Answer table says B, Solution says C -> conflict!
  const q3 = result.questions[2];
  assert.equal(q3.answerProvenance?.status, 'conflict', 'Table B vs Solution C must produce conflict');
  assert.equal(q3.answerConfirmed, false);

  // Q4 (Part II TF): Underline on a, c -> candidate/missing, NO silent False inference!
  const q4 = result.questions[3];
  assert.equal(q4.type, 'true-false');
  assert.equal(q4.answerProvenance?.status, 'needs-review');
  assert.equal(q4.answerConfirmed, false);
  assert.equal(q4.statements?.[0].answerState, 'candidate');
  assert.equal(q4.statements?.[1].answerState, 'missing');

  // Q5 (Part III SA #1): Single `A. −4,3` -> short-answer candidate preserving negative sign & comma decimal
  const q5 = result.questions[4];
  assert.equal(q5.type, 'short-answer');
  assert.equal(q5.shortAnswer?.answerValue, '-4,3');
  assert.equal(q5.answerProvenance?.status, 'needs-review');
  assert.equal(q5.answerConfirmed, false);

  // Q6 (Part III SA #2): Answer "0" from table must be preserved, NOT treated as empty!
  const q6 = result.questions[5];
  assert.equal(q6.type, 'short-answer');
  assert.equal(q6.shortAnswer?.answerValue, '0');
  assert.equal(q6.answerProvenance?.status, 'source-matched');
  assert.equal(q6.answerConfirmed, true);
});

test('P0-4: Paste parser never silently defaults missing MCQ answer to A', () => {
  const pasted = parseLatexExamText(
    `Câu 1: Đạo hàm của $x^2$ là:
A. $x$
B. $2x$
C. $x^2$
D. $2$`,
    makeId
  );
  assert.equal(pasted.questions.length, 1);
  const q = pasted.questions[0];
  assert.equal(q.correctOptionId, undefined);
  assert.ok(q.options?.every((o) => o.isCorrect === false));
  assert.equal(q.answerConfirmed, false);
  assert.equal(q.answerProvenance?.status, 'missing');
});

test('P0-5: Legacy DB hygiene flags Part II 666/6666 corruption & invalidates stale generatedVersions', () => {
  const legacyExam: MathExamProject = structuredClone(DEMO_MATH_EXAM);
  legacyExam.isDemo = false;
  legacyExam.confirmedOriginalAnswers = true;
  const tfIdx = legacyExam.questions.findIndex((q) => q.type === 'true-false');
  assert.ok(tfIdx >= 0);
  legacyExam.questions[tfIdx].shortAnswer = {
    answerValue: '6666',
    acceptedFormats: [],
    unit: '',
    domainCondition: '',
  };
  legacyExam.generatedVersions = [
    {
      code: '101',
      seedUsed: 'legacy',
      generatedAt: new Date().toISOString(),
      questions: legacyExam.questions,
      permutationMap: [],
      answerKeyRows: [
        {
          number: 1,
          questionId: legacyExam.questions[tfIdx].id,
          originalCode: legacyExam.questions[tfIdx].code,
          type: 'true-false',
          cognitiveLevel: 'thong-hieu',
          answer: '6666',
        },
      ],
      integrityPassed: true,
      integrityWarnings: [],
    },
  ];

  const cleaned = normalizeMathExamProject(legacyExam);
  assert.equal(cleaned.confirmedOriginalAnswers, false);
  assert.equal(cleaned.generatedVersions.length, 0);
  assert.ok((cleaned.questions[tfIdx].legacyAnomalyReasons?.length ?? 0) > 0);

  const report = evaluatePreMixIntegrity(cleaned);
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.issues.some((i) => i.id.startsWith('q-legacy-anomaly-')));
});

test('P0-6: Integrity audit blocks placeholders, punctuation-only options (while allowing image-only options), stale teacher confirmation, and duplicate content', () => {
  const exam = structuredClone(DEMO_MATH_EXAM);
  exam.isDemo = false;

  // 1. Unresolved OLE placeholder must be BLOCKED (not warning!)
  const oleExam = structuredClone(exam);
  oleExam.questions[0].stem.rawSource = 'Tính giá trị [CÔNG_THỨC_OLE_LEGACY]';
  const oleRep = evaluatePreMixIntegrity(oleExam);
  assert.equal(oleRep.status, 'BLOCKED');
  assert.ok(oleRep.issues.some((i) => i.id.startsWith('q-legacy-eq-') && i.severity === 'error'));
  assert.equal(oleRep.pillars?.length, 4);
  assert.equal(oleRep.pillars?.[0].status, 'BLOCKED');

  // 2. Punctuation-only option `A. .` without visualAsset must be BLOCKED
  const dotExam = structuredClone(exam);
  dotExam.questions[0].options![0].content.rawSource = '.';
  dotExam.questions[0].options![0].visualAsset = undefined;
  const dotRep = evaluatePreMixIntegrity(dotExam);
  assert.equal(dotRep.status, 'BLOCKED');
  assert.ok(dotRep.issues.some((i) => i.id.startsWith('mcq-opt-empty-') && i.severity === 'error'));

  // 3. Image-only option (empty text + valid visualAsset) must PASS option check
  const imgOptExam = structuredClone(exam);
  imgOptExam.questions[0].options![0].content.rawSource = '';
  imgOptExam.questions[0].options![0].visualAsset = {
    id: 'opt-img-1',
    kind: 'image',
    label: 'PA A',
    sourceData: `data:image/png;base64,${TINY_PNG_B64}`,
    checksum: '',
    required: true,
  };
  const imgOptRep = evaluatePreMixIntegrity(imgOptExam);
  assert.ok(!imgOptRep.issues.some((i) => i.id.startsWith('mcq-opt-empty-')));

  // 4. Stale teacher confirmation after content edit must be BLOCKED
  const staleExam = structuredClone(exam);
  const q0 = staleExam.questions[0];
  q0.answerProvenance = {
    status: 'teacher-confirmed',
    primarySource: 'teacher-manual',
    sources: [],
    confirmedAt: new Date().toISOString(),
    confirmedContentHash: computeQuestionVerificationContentHash(q0),
  };
  // Mutate stem after confirmation
  q0.stem.rawSource += ' (đã sửa)';
  const staleRep = evaluatePreMixIntegrity(staleExam);
  assert.equal(staleRep.status, 'BLOCKED');
  assert.ok(staleRep.issues.some((i) => i.id.startsWith('q-prov-stale-confirm-')));

  // 5. Duplicate content across distinct IDs must be BLOCKED
  const dupExam = structuredClone(exam);
  const dupCopy = structuredClone(dupExam.questions[0]);
  dupCopy.id = 'dup-distinct-id';
  dupCopy.code = 'DUP-99';
  dupExam.questions.push(dupCopy);
  assert.equal(detectDuplicateQuestionGroups(dupExam.questions).length, 1);
  const dupRep = evaluatePreMixIntegrity(dupExam);
  assert.equal(dupRep.status, 'BLOCKED');
  assert.ok(dupRep.issues.some((i) => i.id.startsWith('exam-dup-content-')));
});

test('P0-7: Unified Export Gate & Post-Export Readback Verification pass clean exports and catch tampered DOCX/CSV/Answer artifacts', async () => {
  const parsed = parseUniversalExamText(
    `PHẦN I. TRẮC NGHIỆM 4 PHƯƠNG ÁN
Câu 1: Giá trị của $2 + 3$ bằng:
A. $4$   B. $5$   C. $6$   D. $7$
Đáp án: B

Câu 2: Nghiệm của phương trình $x - 3 = 0$ là:
A. $1$   B. $2$   C. $3$   D. $4$
Đáp án: C

PHẦN II. ĐÚNG SAI
Câu 3: Xét số nguyên $n = 4$:
a) $n$ là số chẵn.
b) $n$ là số nguyên tố.
c) $n^2 = 16$.
d) $n < 0$.
Đáp án: Đ - S - Đ - S

PHẦN III. TRẢ LỜI NGẮN
Câu 4: Giá trị của $5 - 5$ là bao nhiêu?
Đáp án: 0`,
    makeId,
    { subjectId: 'toan' }
  );

  const project = mergeImportedExamIntoProject(structuredClone(DEMO_MATH_EXAM), parsed, {
    replaceExisting: true,
    applySuggestedSubject: false,
  });
  project.mixConfig.examCount = 2;

  // Before teacher confirmation -> ALL export paths MUST throw BLOCKED
  const preMixUnconfirmed = generateMixedExams(project);
  const unconfirmedWithVersions: MathExamProject = {
    ...project,
    confirmedOriginalAnswers: false,
    generatedVersions: preMixUnconfirmed.versions,
  };
  assert.equal(checkExamExportGate(unconfirmedWithVersions).canExport, false);
  await assert.rejects(
    () => buildStudentExamDocxBuffer(unconfirmedWithVersions, unconfirmedWithVersions.generatedVersions[0]),
    /BLOCKED/i
  );
  await assert.rejects(() => buildAnswerKeyDocxBuffer(unconfirmedWithVersions), /BLOCKED/i);
  assert.throws(() => buildConsolidatedAnswerCsv(unconfirmedWithVersions), /BLOCKED/i);
  assert.throws(() => buildMixedExamJsonExportPayload(unconfirmedWithVersions), /BLOCKED/i);
  await assert.rejects(() => exportMixedExamZipBundle(unconfirmedWithVersions), /BLOCKED/i);

  // Confirm & export cleanly
  project.confirmedOriginalAnswers = true;
  const mixed = generateMixedExams(project);
  assert.equal(mixed.errors.length, 0);
  const readyExam: MathExamProject = {
    ...project,
    generatedVersions: mixed.versions,
  };

  assert.equal(checkExamExportGate(readyExam).canExport, true);
  const jsonPayload = buildMixedExamJsonExportPayload(readyExam);
  assert.ok(Array.isArray(jsonPayload.versions));

  const zipBundle = await exportMixedExamZipBundle(readyExam);
  assert.equal(zipBundle.integrity.verified, true);
  assert.equal(zipBundle.integrity.status, 'PASS');
  assert.equal(zipBundle.integrity.checks.length, 4);
  assert.ok(zipBundle.integrity.checks.every((c) => c.passed));

  // Negative tamper test 1: Tamper CSV cell -> verifyExportedCsv MUST fail!
  const cleanCsv = buildConsolidatedAnswerCsv(readyExam);
  assert.equal(verifyExportedCsv(cleanCsv, readyExam).passed, true);
  const tamperedCsv = cleanCsv.replace('"B"', '"Z"').replace('"C"', '"Z"');
  const csvCheck = verifyExportedCsv(tamperedCsv, readyExam);
  assert.equal(csvCheck.passed, false);
  assert.ok(csvCheck.issues.some((i) => i.id.startsWith('exp-csv-cell-mismatch-')));

  // Negative tamper test 2: Tamper student DOCX XML with leaked answer & OLE placeholder -> MUST fail!
  const v0 = readyExam.generatedVersions[0];
  const studentBuf = await buildStudentExamDocxBuffer(readyExam, v0);
  const studentZip = await JSZip.loadAsync(studentBuf);
  const docXml = await studentZip.file('word/document.xml')!.async('string');
  const leakedXml = docXml.replace(
    '</w:body>',
    '<w:p><w:r><w:t>Đáp án đúng: A [CÔNG_THỨC_OLE_LEGACY]</w:t></w:r></w:p></w:body>'
  );
  studentZip.file('word/document.xml', leakedXml);
  const leakedBuf = await studentZip.generateAsync({ type: 'uint8array' });
  const leakCheck = await verifyExportedDocxBuffer(leakedBuf, v0, readyExam);
  assert.equal(leakCheck.passed, false);
  assert.ok(leakCheck.issues.some((i) => i.id.startsWith('exp-answer-leak-')));
  assert.ok(leakCheck.issues.some((i) => i.id.startsWith('exp-unresolved-formula-')));

  // Negative tamper test 3: Tamper Answer DOCX by removing version code -> MUST fail!
  const ansBuf = await buildAnswerKeyDocxBuffer(readyExam);
  assert.equal((await verifyExportedAnswerKeyDocxBuffer(ansBuf, readyExam)).passed, true);
  const ansZip = await JSZip.loadAsync(ansBuf);
  const ansXml = await ansZip.file('word/document.xml')!.async('string');
  const brokenAnsXml = ansXml.replaceAll(v0.code, '9999');
  ansZip.file('word/document.xml', brokenAnsXml);
  const brokenAnsBuf = await ansZip.generateAsync({ type: 'uint8array' });
  const ansCheck = await verifyExportedAnswerKeyDocxBuffer(brokenAnsBuf, readyExam);
  assert.equal(ansCheck.passed, false);
  assert.ok(ansCheck.issues.some((i) => i.id.startsWith('exp-ans-docx-missing-code-')));
});

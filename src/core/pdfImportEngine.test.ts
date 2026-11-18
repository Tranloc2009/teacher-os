import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { createEmptyMathExamProject } from '../data/demoMathExams';
import { generateMixedExams } from './mathShuffleEngine';
import { evaluatePreMixIntegrity } from './mathIntegrity';
import { detectFileFormatAndSignature } from './fileTypeDetector';
import {
  confirmAllReviewableQuestions,
  mergeImportedQuestionWithPrevious,
  renumberImportedQuestions,
  runUniversalImportSession,
  splitImportedQuestionAtBreak,
  toggleConfirmImportedQuestion,
} from './universalImportAdapter';

let idSeq = 0;
function makeTestId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-t-${idSeq}`;
}

interface PdfPageSpec {
  width?: number;
  height?: number;
  streamContent: string;
  includeImageXObject?: boolean;
  customToUnicode?: boolean;
}

/**
 * Tạo PDF 1.4 nhị phân hợp lệ chuẩn (đủ xref byte-offset chính xác) để pdfjs-dist đọc trực tiếp trong test.
 */
function buildSyntheticPdf(pages: PdfPageSpec[]): Uint8Array {
  const objects: string[] = [];
  const addObj = (body: string): number => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Obj 1: Catalog (filled after Pages)
  const catalogId = addObj('');
  // Obj 2: Pages (filled after page objects)
  const pagesId = addObj('');
  // Obj 3: Standard Helvetica Type1 Font (WinAnsi)
  const fontStdId = addObj(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  // Obj 4: Second font with custom ToUnicode mapping (e.g. code 0x01 -> U+E001 PUA corruption, 0x02 -> U+222B integral)
  const toUnicodeStream = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    '2 beginbfchar',
    '<41> <E001>',
    '<42> <222B>',
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
  const toUnicodeId = addObj(
    `<< /Length ${toUnicodeStream.length} >>\nstream\n${toUnicodeStream}\nendstream`
  );
  const fontCustomId = addObj(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Symbol /ToUnicode ${toUnicodeId} 0 R >>`
  );

  // Optional 1x1 Image XObject
  const imgData = '\xFF\x00\x00';
  const imgXObjId = addObj(
    `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imgData.length} >>\nstream\n${imgData}\nendstream`
  );

  const pageIds: number[] = [];
  for (const p of pages) {
    const w = p.width ?? 595;
    const h = p.height ?? 842;
    const contentId = addObj(
      `<< /Length ${Buffer.byteLength(p.streamContent, 'latin1')} >>\nstream\n${p.streamContent}\nendstream`
    );
    const xObjPart = p.includeImageXObject ? `/XObject << /Im1 ${imgXObjId} 0 R >>` : '';
    const fontPart = `/Font << /F1 ${fontStdId} 0 R /F2 ${fontCustomId} 0 R >>`;
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << ${fontPart} ${xObjPart} >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [0];
  let bytePos = Buffer.byteLength(chunks[0], 'latin1');

  for (let i = 0; i < objects.length; i++) {
    offsets.push(bytePos);
    const entry = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    chunks.push(entry);
    bytePos += Buffer.byteLength(entry, 'latin1');
  }

  const xrefStart = bytePos;
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i++) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  return new Uint8Array(Buffer.from(chunks.join(''), 'latin1'));
}

function pdfTextLine(x: number, y: number, text: string, fontSize = 11, fontAlias = 'F1'): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  return `BT /${fontAlias} ${fontSize} Tf 1 0 0 1 ${x} ${y} Tm (${escaped}) Tj ET`;
}

test('FileTypeDetector: phan biet magic bytes that, phat hien gia mao duoi va phan loai giai doan 1', async () => {
  // 1. Valid PDF bytes
  const pdfBytes = buildSyntheticPdf([{ streamContent: pdfTextLine(50, 760, 'Question 1: Hello?') }]);
  const pdfDetect = await detectFileFormatAndSignature({ fileName: 'de_thi.pdf', buffer: pdfBytes });
  assert.equal(pdfDetect.detectedFormat, 'pdf');
  assert.equal(pdfDetect.signatureValid, true);
  assert.equal(pdfDetect.status, 'READY');

  // 2. Spoofed .docx containing %PDF- magic bytes -> BLOCKED
  const spoofedDocx = await detectFileFormatAndSignature({ fileName: 'fake.docx', buffer: pdfBytes });
  assert.equal(spoofedDocx.signatureValid, false);
  assert.equal(spoofedDocx.status, 'BLOCKED');

  // 3. Real DOCX vs XLSX inside ZIP container
  const zipDocx = new JSZip();
  zipDocx.file('word/document.xml', '<w:document/>');
  const docxBuf = await zipDocx.generateAsync({ type: 'uint8array' });
  const docxDetect = await detectFileFormatAndSignature({ fileName: 'math.docx', buffer: docxBuf });
  assert.equal(docxDetect.detectedFormat, 'docx');
  assert.equal(docxDetect.status, 'READY');

  const zipXlsx = new JSZip();
  zipXlsx.file('xl/workbook.xml', '<workbook/>');
  const xlsxBuf = await zipXlsx.generateAsync({ type: 'uint8array' });
  const xlsxDetect = await detectFileFormatAndSignature({ fileName: 'bank.xlsx', buffer: xlsxBuf });
  assert.equal(xlsxDetect.detectedFormat, 'xlsx');
  assert.equal(xlsxDetect.status, 'UNSUPPORTED');

  // 4. Executable MZ header -> BLOCKED
  const exeDetect = await detectFileFormatAndSignature({
    fileName: 'virus.txt',
    buffer: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]),
  });
  assert.equal(exeDetect.status, 'BLOCKED');

  // 5. PNG image -> UNSUPPORTED (deferred OCR)
  const pngDetect = await detectFileFormatAndSignature({
    fileName: 'page1.png',
    buffer: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  });
  assert.equal(pngDetect.detectedFormat, 'image');
  assert.equal(pngDetect.status, 'UNSUPPORTED');
});

test('PDF Adapter: nhap PDF 1 cot co lop van ban chuan + tron de + giu nguyen Layer 1', async () => {
  const stream = [
    pdfTextLine(60, 760, 'Question 1: What is the capital of Vietnam?'),
    pdfTextLine(60, 740, 'A. Hanoi   B. Da Nang   C. Hue   D. Can Tho'),
    pdfTextLine(60, 710, 'Question 2: Which planet is closest to the Sun?'),
    pdfTextLine(60, 690, 'A. Venus   B. Mars   C. Mercury   D. Earth'),
    pdfTextLine(60, 650, 'ANSWER KEY'),
    pdfTextLine(60, 630, '1.A   2.C'),
  ].join('\n');

  const pdfBytes = buildSyntheticPdf([{ streamContent: stream }]);
  const session = await runUniversalImportSession(
    { fileName: 'sample-1col.pdf', buffer: pdfBytes },
    makeTestId,
    { renderPreviews: false }
  );

  assert.equal(session.detection.detectedFormat, 'pdf');
  assert.equal(session.compatibilityReport.totalPages, 1);
  assert.equal(session.compatibilityReport.textLayerPages, 1);
  assert.equal(session.questions.length, 2);
  assert.equal(session.questions[0].answerConfirmed, true);
  assert.equal(session.questions[1].answerConfirmed, true);
  assert.equal(session.compatibilityReport.status, 'READY');
  assert.equal(session.compatibilityReport.safeToMixCount, 2);
  assert.ok(session.originalSource.rawBytes && session.originalSource.rawBytes.length === pdfBytes.length);

  // Mix 4 codes safely after verifying project answers
  const baseExam = createEmptyMathExamProject(makeTestId);
  const examToMix = {
    ...baseExam,
    questions: session.questions,
    confirmedOriginalAnswers: true,
    mixConfig: { ...baseExam.mixConfig, examCount: 4, level: 2 as const },
  };
  const preMix = evaluatePreMixIntegrity(examToMix);
  assert.notEqual(preMix.status, 'BLOCKED');

  const mixed = generateMixedExams(examToMix);
  assert.equal(mixed.versions.length, 4);
  assert.ok(mixed.versions.every((v) => v.integrityPassed));
});

test('PDF Adapter: doc dung thu tu PDF 2 cot (cot trai truoc cot phai)', async () => {
  // Left column x=50..240, Right column x=330..520
  const stream = [
    pdfTextLine(50, 760, 'Question 1: Left top question.'),
    pdfTextLine(50, 740, 'A. One  B. Two  C. Three  D. Four'),
    pdfTextLine(50, 700, 'Question 2: Left bottom question.'),
    pdfTextLine(50, 680, 'A. Red  B. Blue  C. Green  D. Yellow'),
    pdfTextLine(330, 760, 'Question 3: Right top question.'),
    pdfTextLine(330, 740, 'A. Cat  B. Dog  C. Bird  D. Fish'),
    pdfTextLine(330, 700, 'Question 4: Right bottom question.'),
    pdfTextLine(330, 680, 'A. North  B. South  C. East  D. West'),
    pdfTextLine(330, 640, 'ANSWER KEY'),
    pdfTextLine(330, 620, '1.A 2.B 3.C 4.D'),
  ].join('\n');

  const pdfBytes = buildSyntheticPdf([{ streamContent: stream }]);
  const session = await runUniversalImportSession(
    { fileName: 'two-col.pdf', buffer: pdfBytes },
    makeTestId,
    { renderPreviews: false }
  );

  assert.equal(session.documentModel.pages[0].columnCount, 2);
  assert.equal(session.questions.length, 4);
  assert.ok(session.questions[0].stem.rawSource.includes('Left top'));
  assert.ok(session.questions[1].stem.rawSource.includes('Left bottom'));
  assert.ok(session.questions[2].stem.rawSource.includes('Right top'));
  assert.ok(session.questions[3].stem.rawSource.includes('Right bottom'));
});

test('PDF Adapter: noi cau trai qua nhieu trang va ghi nhan pageSpan', async () => {
  const page1Stream = [
    pdfTextLine(60, 760, 'Question 1: Solve the linear equation 2x - 6 = 0.'),
    pdfTextLine(60, 740, 'A. x = 2'),
    pdfTextLine(60, 720, 'B. x = 3'),
  ].join('\n');

  const page2Stream = [
    pdfTextLine(60, 760, 'C. x = 4'),
    pdfTextLine(60, 740, 'D. x = 6'),
    pdfTextLine(60, 700, 'ANSWER KEY'),
    pdfTextLine(60, 680, '1.B'),
  ].join('\n');

  const pdfBytes = buildSyntheticPdf([
    { streamContent: page1Stream },
    { streamContent: page2Stream },
  ]);

  const session = await runUniversalImportSession(
    { fileName: 'multipage-split.pdf', buffer: pdfBytes },
    makeTestId,
    { renderPreviews: false }
  );

  assert.equal(session.compatibilityReport.totalPages, 2);
  assert.equal(session.questions.length, 1);
  assert.equal(session.questions[0].options?.length, 4);
  assert.deepEqual(session.questions[0].sourceVerification?.pageSpan, [1, 2]);
  assert.equal(session.compatibilityReport.status, 'REVIEW_REQUIRED');
});

test('PDF Math Protection: bat so mu heuristic va ky tu loi font PUA -> REVIEW_REQUIRED / BLOCKED trong PreMix cho toi khi xac nhan', async () => {
  // Question 1: smaller font Y-shifted exponent ("x" + raised small "2") -> REVIEW_REQUIRED
  // Question 2: PUA glyph from custom ToUnicode font ('A' mapped to U+E001) -> BLOCKED
  const stream = [
    pdfTextLine(60, 760, 'Question 1: Solve x', 11),
    pdfTextLine(162, 765, '2', 7),
    pdfTextLine(170, 760, '= 9 for x > 0.', 11),
    pdfTextLine(60, 740, 'A. 1   B. 2   C. 3   D. 4'),
    pdfTextLine(60, 700, 'Question 2: Compute ', 11),
    pdfTextLine(172, 700, 'AB', 11, 'F2'), // mapped to U+E001 (PUA) and U+222B (integral)
    pdfTextLine(60, 680, 'A. 0   B. 1   C. 2   D. 3'),
    pdfTextLine(60, 640, 'ANSWER KEY'),
    pdfTextLine(60, 620, '1.C   2.B'),
  ].join('\n');

  const pdfBytes = buildSyntheticPdf([{ streamContent: stream }]);
  const session = await runUniversalImportSession(
    { fileName: 'math-risk.pdf', buffer: pdfBytes },
    makeTestId,
    { renderPreviews: false }
  );

  assert.equal(session.questions.length, 2);
  assert.ok(session.questions[0].stem.rawSource.includes('^{2}'));
  assert.equal(session.questions[0].sourceVerification?.verificationStatus, 'REVIEW_REQUIRED');
  assert.equal(session.questions[1].sourceVerification?.verificationStatus, 'BLOCKED');
  assert.equal(session.compatibilityReport.status, 'BLOCKED');
  assert.ok(session.compatibilityReport.formulaRiskCount >= 2);
  assert.equal(session.compatibilityReport.safeToMixCount, 0);

  // Unverified PDF questions MUST be BLOCKED by evaluatePreMixIntegrity!
  const baseExam = createEmptyMathExamProject(makeTestId);
  const unverifiedExam = {
    ...baseExam,
    questions: session.questions,
    confirmedOriginalAnswers: true,
  };
  const preMixBlocked = evaluatePreMixIntegrity(unverifiedExam);
  assert.equal(preMixBlocked.status, 'BLOCKED');
  assert.ok(preMixBlocked.issues.some((i) => i.id.startsWith('q-source-')));

  // Confirming bulk REVIEW only leaves BLOCKED question still blocked!
  let confirmedSess = confirmAllReviewableQuestions(session);
  assert.equal(confirmedSess.questions[0].sourceVerification?.verifiedByTeacher, true);
  assert.equal(confirmedSess.questions[1].sourceVerification?.verifiedByTeacher, false);
  assert.equal(confirmedSess.compatibilityReport.status, 'BLOCKED');

  // Manually verifying the blocked question clears gate once teacher fixed/confirmed it
  confirmedSess = toggleConfirmImportedQuestion(confirmedSess, confirmedSess.questions[1].id, true);
  assert.equal(confirmedSess.compatibilityReport.status, 'READY');
  assert.equal(confirmedSess.compatibilityReport.safeToMixCount, 2);
});

test('PDF Adapter: PDF scan chi co hinh anh (khong co lop van ban) -> UNSUPPORTED, khong bia cau hoi', async () => {
  // Only Do /Im1 image paint op, zero text runs
  const scanStream = 'q 595 0 0 842 0 0 cm /Im1 Do Q';
  const pdfBytes = buildSyntheticPdf([
    { streamContent: scanStream, includeImageXObject: true },
  ]);

  const session = await runUniversalImportSession(
    { fileName: 'scanned-exam.pdf', buffer: pdfBytes },
    makeTestId,
    { renderPreviews: false }
  );

  assert.equal(session.compatibilityReport.totalPages, 1);
  assert.equal(session.compatibilityReport.scannedPages, 1);
  assert.equal(session.compatibilityReport.textLayerPages, 0);
  assert.equal(session.questions.length, 0);
  assert.equal(session.compatibilityReport.status, 'UNSUPPORTED');
  assert.equal(session.compatibilityReport.safeToMixCount, 0);
});

test('UniversalImportAdapter: ho tro tach cau, gop cau va danh lai so thu tu ma khong ghi de Layer 1', async () => {
  const stream = [
    pdfTextLine(60, 760, 'Question 1: First line stem.'),
    pdfTextLine(60, 740, 'Second line split candidate.'),
    pdfTextLine(60, 710, 'Question 2: Continuation line.'),
    pdfTextLine(60, 680, 'ANSWER KEY'),
    pdfTextLine(60, 660, '1. 5   2. 10'),
  ].join('\n');

  const pdfBytes = buildSyntheticPdf([{ streamContent: stream }]);
  let session = await runUniversalImportSession(
    { fileName: 'actions.pdf', buffer: pdfBytes },
    makeTestId,
    { renderPreviews: false }
  );

  const originalRawHash = session.originalSource.contentHash;
  assert.equal(session.questions.length, 2);

  // Merge Question 2 into Question 1
  session = mergeImportedQuestionWithPrevious(session, session.questions[1].id);
  assert.equal(session.questions.length, 1);
  assert.ok(session.questions[0].stem.rawSource.includes('Continuation line'));

  // Split Question 1 back into 2 questions
  session = splitImportedQuestionAtBreak(session, session.questions[0].id, makeTestId);
  assert.equal(session.questions.length, 2);

  // Renumber sequentially
  session = renumberImportedQuestions(session, 1);
  assert.equal(session.questions[0].code, 'PDF-01');
  assert.equal(session.questions[1].code, 'PDF-02');

  // Layer 1 hash remains untouched!
  assert.equal(session.originalSource.contentHash, originalRawHash);
});

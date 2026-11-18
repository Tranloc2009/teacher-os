import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  analyzeFileContentSafe,
  classifyResourceFromAnalysis,
  detectFormatAndSafety,
  UNKNOWN_GRADE_LABEL,
  UNKNOWN_SUBJECT_LABEL,
} from './resourceClassifier';
import {
  applyBulkEditToCandidates,
  BulkInputFile,
  computeSha256Hex,
  createBulkBatchController,
  planBulkCommitEntries,
  runBulkResourceImportBatch,
} from './resourceBulkEngine';
import { formatBytes, materializeBulkCommitPayloads } from './resourceStorage';
import { ResourceItem } from '../types/lesson';

async function buildSampleDocxBytes(
  bodyText: string,
  ommlCount = 2,
  coreTitle?: string
): Promise<Uint8Array> {
  const zip = new JSZip();
  const ommlBlocks = Array.from({ length: ommlCount }, (_, i) => {
    return `<m:oMathPara><m:oMath><m:r><m:t>x^${i + 2}+y_${i + 1}=\\frac{a}{b}</m:t></m:r></m:oMath></m:oMathPara>`;
  }).join('');

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    <w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p>
    ${ommlBlocks}
  </w:body>
</w:document>`
  );
  if (coreTitle) {
    zip.file(
      'docProps/core.xml',
      `<cp:coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><dc:title>${coreTitle}</dc:title></cp:coreProperties>`
    );
  }
  return await zip.generateAsync({ type: 'uint8array' });
}

async function buildSamplePptxBytes(slides: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  slides.forEach((txt, idx) => {
    zip.file(
      `ppt/slides/slide${idx + 1}.xml`,
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${txt}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
  });
  return await zip.generateAsync({ type: 'uint8array' });
}

async function buildSampleXlsxBytes(sheets: string[], strings: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheets
      .map((s, i) => `<sheet name="${s}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</workbook>`
  );
  zip.file(
    'xl/sharedStrings.xml',
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
      .map((t) => `<si><t>${t}</t></si>`)
      .join('')}</sst>`
  );
  return await zip.generateAsync({ type: 'uint8array' });
}

function buildSamplePdfBytes(title: string, snippetText: string, padBytes = 0): Uint8Array {
  const body = `%PDF-1.4
1 0 obj
<< /Title (${title}) /Author (TeacherOS) >>
endobj
2 0 obj
<< /Length 64 >>
stream
BT (${snippetText}) Tj ET
endstream
endobj
${padBytes > 0 ? '%' + 'A'.repeat(padBytes) + '\n' : ''}%%EOF`;
  return new TextEncoder().encode(body);
}

test('detectFormatAndSafety hỗ trợ đúng định dạng và chặn tệp thực thi nguy hiểm', () => {
  assert.equal(detectFormatAndSafety('De_thi.docx').format, 'docx');
  assert.equal(detectFormatAndSafety('Bai_giang.pdf').format, 'pdf');
  assert.equal(detectFormatAndSafety('Slide_1.pptx').format, 'pptx');
  assert.equal(detectFormatAndSafety('Bang_diem.xlsx').format, 'xlsx');
  assert.equal(detectFormatAndSafety('hinh_minh_hoa.png').format, 'image');
  assert.equal(detectFormatAndSafety('de_cuong.ggb').format, 'attachment');
  assert.equal(detectFormatAndSafety('de_cuong.ggb').safeToStore, true);

  for (const dangerous of ['virus.exe', 'script.bat', 'macro.ps1', 'drop.vbs']) {
    const res = detectFormatAndSafety(dangerous);
    assert.equal(res.safeToStore, false, `${dangerous} must be blocked`);
    assert.ok(res.blockedReason);
  }
});

test('analyzeFileContentSafe trích xuất DOCX (OMML), PPTX, XLSX, PDF và giữ nguyên 100% byte gốc', async () => {
  const docxBytes = await buildSampleDocxBytes('Đề kiểm tra giữa kì 1 Toán 10 Chương 2 Hàm số', 3);
  const shaBefore = await computeSha256Hex(docxBytes);
  const docxAnalysis = await analyzeFileContentSafe('De_kiem_tra.docx', docxBytes);
  const shaAfter = await computeSha256Hex(docxBytes);

  assert.equal(shaBefore, shaAfter, 'Original DOCX bytes must remain bit-identical');
  assert.equal(docxAnalysis.format, 'docx');
  assert.equal(docxAnalysis.hasOmml, true);
  assert.equal(docxAnalysis.formulaCount, 3);
  assert.ok(docxAnalysis.extractedTextSnippet.includes('Hàm số'));

  const pptxBytes = await buildSamplePptxBytes(['Bài giảng Vật lí 11', 'Dao động cơ điều hòa']);
  const pptxAnalysis = await analyzeFileContentSafe('Slide_Vat_li_11.pptx', pptxBytes);
  assert.equal(pptxAnalysis.format, 'pptx');
  assert.equal(pptxAnalysis.slideCount, 2);
  assert.ok(pptxAnalysis.extractedTextSnippet.includes('Dao động cơ'));

  const xlsxBytes = await buildSampleXlsxBytes(['MaTranDe', 'DapAn'], ['Toán 12', 'Tích phân']);
  const xlsxAnalysis = await analyzeFileContentSafe('Ma_tran_Toan_12.xlsx', xlsxBytes);
  assert.equal(xlsxAnalysis.format, 'xlsx');
  assert.deepEqual(xlsxAnalysis.sheetNames, ['MaTranDe', 'DapAn']);

  const pdfBytes = buildSamplePdfBytes('Giao an Ngu van 8', 'Doc hieu van ban nghi luan');
  const pdfAnalysis = await analyzeFileContentSafe('tai_lieu.pdf', pdfBytes);
  assert.equal(pdfAnalysis.format, 'pdf');
  assert.equal(pdfAnalysis.extractedTitle, 'Giao an Ngu van 8');
  assert.ok(pdfAnalysis.extractedTextSnippet.includes('Doc hieu'));
});

test('classifyResourceFromAnalysis phân loại chính xác và không tự đoán khi dữ liệu mơ hồ', async () => {
  const docxBytes = await buildSampleDocxBytes('Đề kiểm tra học kì 1 Toán học lớp 10 - Chương 2 Hàm số bậc hai', 2);
  const docxAnalysis = await analyzeFileContentSafe('De_thi_Toan_10_HK1_Chuong_2.docx', docxBytes);
  const mathTestSug = classifyResourceFromAnalysis(
    'De_thi_Toan_10_HK1_Chuong_2.docx',
    'Toan 10/De thi/De_thi_Toan_10_HK1_Chuong_2.docx',
    docxAnalysis
  );
  assert.equal(mathTestSug.subject, 'Toán học');
  assert.equal(mathTestSug.grade, 'Lớp 10');
  assert.equal(mathTestSug.documentCategory, 'de-thi');
  assert.equal(mathTestSug.resourceType, 'question-template');
  assert.ok(mathTestSug.chapterTopic.toLowerCase().includes('chương 2') || mathTestSug.chapterTopic.toLowerCase().includes('chuong 2'));
  assert.ok(mathTestSug.confidence >= 0.75);
  assert.equal(mathTestSug.needsManualReview, false);

  // Giáo án Ngữ văn
  const litPdf = buildSamplePdfBytes('KHBD Ngu van 9', 'Soan bai Truyen Kieu');
  const litAnalysis = await analyzeFileContentSafe('Giao_an_Ngu_van_9_Bai_3.pdf', litPdf);
  const litSug = classifyResourceFromAnalysis(
    'Giao_an_Ngu_van_9_Bai_3.pdf',
    'Giao_an_Ngu_van_9_Bai_3.pdf',
    litAnalysis
  );
  assert.equal(litSug.subject, 'Ngữ văn');
  assert.equal(litSug.grade, 'Lớp 9');
  assert.equal(litSug.documentCategory, 'giao-an');
  assert.equal(litSug.resourceType, 'activity-idea');

  // Unclear scan file -> must NOT guess randomly
  const unclearBytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
  const unclearAnalysis = await analyzeFileContentSafe('scan_2025_001.pdf', unclearBytes);
  const unclearSug = classifyResourceFromAnalysis(
    'scan_2025_001.pdf',
    'scan_2025_001.pdf',
    unclearAnalysis
  );
  assert.equal(unclearSug.subject, UNKNOWN_SUBJECT_LABEL);
  assert.equal(unclearSug.grade, UNKNOWN_GRADE_LABEL);
  assert.equal(unclearSug.documentCategory, 'khac');
  assert.equal(unclearSug.needsManualReview, true);
  assert.ok(unclearSug.confidence < 0.45);
});

test('SHA-256 deduplication, batch edit & commit planner xử lý chính xác skip / keep-both / replace', async () => {
  const sampleBytes = await buildSampleDocxBytes('Bài tập Hóa học 11 este lipit', 1);
  const sampleSha = await computeSha256Hex(sampleBytes);

  const existingResources: ResourceItem[] = [
    {
      id: 'res-existing-1',
      title: 'Bài tập Este có sẵn',
      type: 'question-template',
      subject: 'Hóa học',
      grade: 'Lớp 11',
      tags: ['hóa học'],
      content: 'Nội dung cũ',
      answerOrNote: '',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sourceFile: {
        fileName: 'Bai_tap_Hoa_11.docx',
        relativePath: 'Bai_tap_Hoa_11.docx',
        extension: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: sampleBytes.byteLength,
        sha256: sampleSha,
        storageKind: 'indexeddb',
        fileRecordId: 'rfile-existing-1',
      },
    },
  ];

  const uniqueBytes = new TextEncoder().encode('Đáp án chi tiết Vật lí 12 Chương 1 Dao động cơ');
  const inputs: BulkInputFile[] = [
    {
      fileName: 'Ban_sao_Bai_tap_Hoa_11.docx',
      relativePath: 'Hoa 11/Ban_sao_Bai_tap_Hoa_11.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: sampleBytes.byteLength,
      bytes: sampleBytes,
    },
    {
      fileName: 'Dap_an_Vat_li_12.txt',
      relativePath: 'Vat li 12/Dap_an_Vat_li_12.txt',
      mimeType: 'text/plain',
      sizeBytes: uniqueBytes.byteLength,
      bytes: uniqueBytes,
    },
    {
      fileName: 'Dap_an_Vat_li_12_copy.txt',
      relativePath: 'Vat li 12/Dap_an_Vat_li_12_copy.txt',
      mimeType: 'text/plain',
      sizeBytes: uniqueBytes.byteLength,
      bytes: uniqueBytes,
    },
  ];

  const result = await runBulkResourceImportBatch(inputs, {
    existingResources,
    chunkSize: 2,
    useWorker: false,
  });

  assert.equal(result.progress.totalFiles, 3);
  assert.equal(result.progress.duplicateCount, 2); // 1 against existing + 1 intra-batch
  assert.equal(result.candidates[0].duplicateOfExistingId, 'res-existing-1');
  assert.equal(result.candidates[0].duplicateResolution, 'skip');
  assert.equal(result.candidates[2].duplicateOfBatchTempId, result.candidates[1].tempId);
  assert.equal(result.candidates[2].duplicateResolution, 'skip');

  // Bulk edit candidate[0] to replace existing & update chapter
  const edited = applyBulkEditToCandidates(
    result.candidates,
    new Set([result.candidates[0].tempId]),
    { duplicateResolution: 'replace', chapterTopic: 'Chương 1: Este - Lipit' }
  );
  assert.equal(edited[0].duplicateResolution, 'replace');
  assert.equal(edited[0].editedChapterTopic, 'Chương 1: Este - Lipit');

  let seq = 1;
  const plan = planBulkCommitEntries(edited, (p = 'id') => `${p}-${seq++}`);
  assert.equal(plan.entries.length, 2); // candidate[0] replace + candidate[1] new
  assert.equal(plan.skippedCount, 1); // candidate[2] intra-batch dup skipped
  assert.equal(plan.entries[0].isReplacement, true);
  assert.equal(plan.entries[0].resourceId, 'res-existing-1');

  const materialized = await materializeBulkCommitPayloads(plan.entries, {
    temporaryMode: true,
  });
  assert.equal(materialized.resources.length, 2);
  assert.equal(materialized.resources[0].sourceFile?.sha256, sampleSha);
  assert.equal(materialized.resources[0].sourceFile?.hasOmml, true);
});

test('Batch controller hỗ trợ pause / resume và cancel đúng giữa chừng', async () => {
  const inputs: BulkInputFile[] = Array.from({ length: 24 }, (_, idx) => {
    const content = new TextEncoder().encode(`Đề ôn tập Toán ${idx + 1}`);
    return {
      fileName: `De_on_tap_Toan_8_${idx + 1}.txt`,
      relativePath: `De_on_tap_Toan_8_${idx + 1}.txt`,
      mimeType: 'text/plain',
      sizeBytes: content.byteLength,
      bytes: content,
    };
  });

  const controller = createBulkBatchController();
  let pausedOnce = false;
  let cancelledAt = 0;

  const res = await runBulkResourceImportBatch(inputs, {
    existingResources: [],
    chunkSize: 4,
    useWorker: false,
    controller,
    onProgress: (prog) => {
      if (!pausedOnce && prog.processedFiles >= 4) {
        pausedOnce = true;
        controller.pause();
        setTimeout(() => {
          controller.resume();
        }, 15);
      } else if (pausedOnce && prog.processedFiles >= 12 && !controller.isCancelled()) {
        cancelledAt = prog.processedFiles;
        controller.cancel();
      }
    },
  });

  assert.equal(pausedOnce, true);
  assert.equal(res.progress.status, 'cancelled');
  assert.ok(res.candidates.length >= cancelledAt && res.candidates.length < 24);
});

async function runSyntheticScaleBenchmark(count: number) {
  const sampleDocxTemplate = await buildSampleDocxBytes('Đề kiểm tra Toán học lớp 12 Chương 3 Nguyên hàm Tích phân', 2);
  const samplePptxTemplate = await buildSamplePptxBytes(['Bài giảng Sinh học 10', 'Cấu trúc tế bào']);
  const sampleXlsxTemplate = await buildSampleXlsxBytes(['BangDiem'], ['Vật lí 11', 'Sóng cơ']);

  const subjects = [
    { slug: 'Toan_12', cat: 'De_thi', ext: 'docx' },
    { slug: 'Ngu_van_11', cat: 'Giao_an', ext: 'pdf' },
    { slug: 'Tieng_Anh_9', cat: 'Bai_tap', ext: 'pdf' },
    { slug: 'Vat_li_10', cat: 'Slide', ext: 'pptx' },
    { slug: 'Hoa_hoc_11', cat: 'Dap_an', ext: 'txt' },
    { slug: 'Sinh_hoc_10', cat: 'Bai_giang', ext: 'pptx' },
    { slug: 'Lich_su_12', cat: 'Tham_khao', ext: 'xlsx' },
    { slug: 'scan_khong_ro', cat: 'tai_lieu', ext: 'bin' },
  ];

  const inputs: BulkInputFile[] = [];
  let expectedBlocked = 0;
  let expectedIntraDup = 0;

  const sharedDupBytes = new TextEncoder().encode('Tài liệu trùng SHA-256 dùng để kiểm thử deduplication');
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);

  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      // 1 dangerous blocked file
      expectedBlocked += 1;
      const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
      inputs.push({
        fileName: `installer_${i}.exe`,
        relativePath: `Khac/installer_${i}.exe`,
        mimeType: 'application/x-msdownload',
        sizeBytes: exeBytes.byteLength,
        bytes: exeBytes,
      });
      continue;
    }

    // Inject 10% exact SHA-256 duplicates across different filenames/folders
    if (i > 0 && i % 20 === 0) {
      expectedIntraDup += 1;
      inputs.push({
        fileName: `Tai_lieu_trung_${i}.txt`,
        relativePath: `Trung_lap/Tai_lieu_trung_${i}.txt`,
        mimeType: 'text/plain',
        sizeBytes: sharedDupBytes.byteLength,
        bytes: sharedDupBytes,
      });
      continue;
    }
    if (i === 1) {
      // Seed the original sharedDupBytes
      inputs.push({
        fileName: `Tai_lieu_goc_${i}.txt`,
        relativePath: `Goc/Tai_lieu_goc_${i}.txt`,
        mimeType: 'text/plain',
        sizeBytes: sharedDupBytes.byteLength,
        bytes: sharedDupBytes,
      });
      continue;
    }

    const meta = subjects[i % subjects.length];
    let bytes: Uint8Array;
    let fileName = `${meta.cat}_${meta.slug}_Chuong_${(i % 5) + 1}_so_${i}.${meta.ext}`;
    let mimeType = 'application/octet-stream';

    if (meta.ext === 'docx') {
      // Vary bytes uniquely per file by appending an XML comment while keeping valid DOCX structure on first few,
      // or varying content quickly for large N
      if (i < 40) {
        bytes = await buildSampleDocxBytes(`Đề thi ${meta.slug} mã ${i} có công thức`, 2);
      } else {
        // Clone template + trailing unique zip-safe comment or varied text file sized 2KB..64KB
        const clone = new Uint8Array(sampleDocxTemplate.length + 16);
        clone.set(sampleDocxTemplate);
        new DataView(clone.buffer).setUint32(sampleDocxTemplate.length, i);
        bytes = clone;
      }
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (meta.ext === 'pptx') {
      const clone = new Uint8Array(samplePptxTemplate.length + 8);
      clone.set(samplePptxTemplate);
      new DataView(clone.buffer).setUint32(samplePptxTemplate.length, i);
      bytes = clone;
      mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    } else if (meta.ext === 'xlsx') {
      const clone = new Uint8Array(sampleXlsxTemplate.length + 8);
      clone.set(sampleXlsxTemplate);
      new DataView(clone.buffer).setUint32(sampleXlsxTemplate.length, i);
      bytes = clone;
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (meta.ext === 'pdf') {
      // Vary sizes from ~250 B up to ~64 KB across batch
      const padSize = i % 15 === 0 ? 48 * 1024 : (i % 7) * 1024;
      bytes = buildSamplePdfBytes(`${meta.cat} ${meta.slug}`, `Noi dung so ${i}`, padSize);
      mimeType = 'application/pdf';
    } else if (i % 13 === 0) {
      fileName = `So_do_Toan_10_hinh_${i}.png`;
      bytes = new Uint8Array([...pngHeader, i & 0xff, (i >> 8) & 0xff]);
      mimeType = 'image/png';
    } else {
      bytes = new TextEncoder().encode(`Tài liệu ${fileName} nội dung số ${i}`);
      mimeType = meta.ext === 'txt' ? 'text/plain' : 'application/octet-stream';
    }

    inputs.push({
      fileName,
      relativePath: `${meta.slug}/${fileName}`,
      mimeType,
      sizeBytes: bytes.byteLength,
      bytes,
    });
  }

  let lastProgressCount = 0;
  const result = await runBulkResourceImportBatch(inputs, {
    existingResources: [],
    chunkSize: 25,
    useWorker: false,
    onProgress: (prog) => {
      assert.ok(prog.processedFiles >= lastProgressCount);
      lastProgressCount = prog.processedFiles;
    },
  });

  assert.equal(result.progress.status, 'ready');
  assert.equal(result.progress.totalFiles, count);
  assert.equal(result.progress.processedFiles, count);
  assert.equal(result.candidates.length, count);
  assert.equal(result.progress.blockedCount, expectedBlocked);
  assert.equal(result.progress.duplicateCount, expectedIntraDup);

  let seq = 1;
  const plan = planBulkCommitEntries(result.candidates, (p = 'id') => `${p}-${count}-${seq++}`);
  assert.equal(plan.blockedCount, expectedBlocked);
  assert.equal(plan.skippedCount, expectedIntraDup);
  assert.equal(plan.entries.length, count - expectedBlocked - expectedIntraDup);

  const materialized = await materializeBulkCommitPayloads(plan.entries, {
    temporaryMode: true,
  });
  assert.equal(materialized.resources.length, plan.entries.length);
  return {
    count,
    elapsedMs: result.progress.elapsedMs,
    totalBytes: formatBytes(result.progress.totalBytes),
    imported: materialized.resources.length,
    duplicates: result.progress.duplicateCount,
    blocked: result.progress.blockedCount,
    needsReview: result.progress.needsReviewCount,
  };
}

test('Kiểm thử quy mô lô 100 tệp đa định dạng & kích thước', async () => {
  const stats = await runSyntheticScaleBenchmark(100);
  assert.equal(stats.count, 100);
  assert.ok(stats.imported >= 90);
});

test('Kiểm thử quy mô lô 300 tệp đa định dạng & kích thước', async () => {
  const stats = await runSyntheticScaleBenchmark(300);
  assert.equal(stats.count, 300);
  assert.ok(stats.imported >= 270);
});

test('Kiểm thử quy mô lô 500 tệp đa định dạng & kích thước (mục tiêu tối đa GĐ 1)', async () => {
  const stats = await runSyntheticScaleBenchmark(500);
  assert.equal(stats.count, 500);
  assert.ok(stats.imported >= 450);
  assert.ok(stats.elapsedMs < 30000, `500 files took too long: ${stats.elapsedMs}ms`);
});

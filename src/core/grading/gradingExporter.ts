import JSZip from 'jszip';
import type {
  ExamCodeAnswerKey,
  GradedSheetRecord,
  GradingSession,
} from '../../types/grading';
import { formatRoundingRuleLabel } from './gradingEngine';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSafeFilePart(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function getEvidenceFolderNameForSheet(
  sheet: GradedSheetRecord,
  index: number
): string {
  return sanitizeSafeFilePart(sheet.studentId, `CHUA_GAN_HS_${index + 1}`);
}

export function getSheetStatusLabelVi(status: GradedSheetRecord['status']): string {
  switch (status) {
    case 'confirmed':
      return 'Đã xác nhận';
    case 'auto-graded':
      return 'Đã chấm tự động (chờ duyệt)';
    case 'review-required':
      return 'Cần kiểm tra thủ công';
    case 'error':
      return 'Lỗi / Chưa thể chấm';
    case 'pending':
      return 'Chờ xử lý';
  }
}

interface XlsxCellSpec {
  col: string;
  type: 'str' | 'num';
  value: string | number;
  styleIndex?: number;
}

/**
 * Tạo tệp Excel chuẩn OOXML (.xlsx) hoàn chỉnh bằng JSZip — không dùng thư viện nặng ngoài.
 * Gồm đủ 11 cột bắt buộc + liên kết tương đối (relative hyperlink) đến `Evidence/<studentId>/annotated.png`.
 * TUYỆT ĐỐI không tạo liên kết công khai lên Internet.
 */
export async function buildGradebookXlsxBuffer(
  session: GradingSession
): Promise<Uint8Array> {
  const zip = new JSZip();

  const headers = [
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
  ];
  const colLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

  const rowsXml: string[] = [];
  const hyperlinksXml: string[] = [];
  const relsXml: string[] = [];

  const pushRow = (rowIndex: number, cells: XlsxCellSpec[]) => {
    const cellsStr = cells
      .map((c) => {
        const styleAttr = c.styleIndex !== undefined ? ` s="${c.styleIndex}"` : '';
        if (c.type === 'num') {
          return `<c r="${c.col}${rowIndex}"${styleAttr}><v>${c.value}</v></c>`;
        }
        return `<c r="${c.col}${rowIndex}" t="inlineStr"${styleAttr}><is><t>${escapeXml(
          String(c.value)
        )}</t></is></c>`;
      })
      .join('');
    rowsXml.push(`<row r="${rowIndex}">${cellsStr}</row>`);
  };

  // Row 1: Title
  pushRow(1, [
    {
      col: 'A',
      type: 'str',
      value: `BẢNG ĐIỂM — ${session.examTitle || session.title} (${session.className})`,
      styleIndex: 1,
    },
  ]);

  // Row 2: Formula & local relative hyperlink note
  pushRow(2, [
    {
      col: 'A',
      type: 'str',
      value: `Thang điểm: ${session.gradingRule.maxScore} · Quy tắc làm tròn: ${formatRoundingRuleLabel(session.gradingRule.rounding)} · Lưu ý: Liên kết ảnh minh chứng ở cột K là đường dẫn tương đối cục bộ, hoạt động khi giải nén đầy đủ gói ZIP (không chứa link công khai).`,
      styleIndex: 3,
    },
  ]);

  // Row 3: Blank spacer
  // Row 4: Table headers
  pushRow(
    4,
    headers.map((h, i) => ({
      col: colLetters[i],
      type: 'str' as const,
      value: h,
      styleIndex: 2,
    }))
  );

  // Sort sheets cleanly by student orderNumber (if matched) then studentId / fileName
  const orderLookup = new Map(
    session.students.map((s) => [s.studentId.toUpperCase(), s.orderNumber])
  );
  const sortedSheets = [...session.sheets].sort((a, b) => {
    const oa = orderLookup.get(a.studentId.toUpperCase()) ?? 99999;
    const ob = orderLookup.get(b.studentId.toUpperCase()) ?? 99999;
    if (oa !== ob) return oa - ob;
    return (a.studentId || a.fileName).localeCompare(b.studentId || b.fileName, 'vi');
  });

  // Track unique folder names in case of duplicate studentId
  const folderCounters = new Map<string, number>();

  sortedSheets.forEach((sheet, idx) => {
    const rowNum = 5 + idx;
    const baseFolder = getEvidenceFolderNameForSheet(sheet, idx);
    const seenCount = (folderCounters.get(baseFolder) ?? 0) + 1;
    folderCounters.set(baseFolder, seenCount);
    const folderName = seenCount > 1 ? `${baseFolder}_${seenCount}` : baseFolder;
    const relativeEvidencePath = `Evidence/${folderName}/annotated.png`;

    pushRow(rowNum, [
      { col: 'A', type: 'num', value: idx + 1 },
      { col: 'B', type: 'str', value: sheet.studentId || '(Chưa gán)' },
      { col: 'C', type: 'str', value: sheet.studentName || '(Chưa khớp danh sách)' },
      { col: 'D', type: 'str', value: sheet.className || session.className },
      { col: 'E', type: 'str', value: sheet.examCode || '(Chưa rõ)' },
      { col: 'F', type: 'num', value: sheet.correctCount },
      { col: 'G', type: 'num', value: sheet.wrongCount },
      { col: 'H', type: 'num', value: sheet.blankCount },
      { col: 'I', type: 'num', value: sheet.finalScore, styleIndex: 4 },
      { col: 'J', type: 'str', value: getSheetStatusLabelVi(sheet.status) },
      { col: 'K', type: 'str', value: relativeEvidencePath, styleIndex: 5 },
    ]);

    const rId = `rIdLink${idx + 1}`;
    hyperlinksXml.push(`<hyperlink ref="K${rowNum}" r:id="${rId}" />`);
    relsXml.push(
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(
        relativeEvidencePath
      )}" TargetMode="External"/>`
    );
  });

  const colWidthsXml = [8, 16, 26, 12, 11, 13, 12, 16, 11, 26, 36]
    .map(
      (w, idx) =>
        `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`
    )
    .join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>${colWidthsXml}</cols>
  <sheetData>${rowsXml.join('')}</sheetData>
  ${hyperlinksXml.length > 0 ? `<hyperlinks>${hyperlinksXml.join('')}</hyperlinks>` : ''}
</worksheet>`;

  const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relsXml.join('\n  ')}
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="0.00"/>
  </numFmts>
  <fonts count="5">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/></font>
    <font><u/><sz val="11"/><color rgb="FF1D4ED8"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Bang_diem" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('xl/workbook.xml', workbookXml);
  zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml);
  zip.file('xl/styles.xml', stylesXml);
  zip.file('xl/worksheets/sheet1.xml', sheetXml);
  if (relsXml.length > 0) {
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', sheetRelsXml);
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * Tạo phiếu báo cáo cá nhân dạng HTML độc lập cho riêng 1 học sinh
 * (tuyệt đối KHÔNG chứa điểm của học sinh khác trong lớp).
 */
export function buildIndividualStudentReportHtml(
  session: GradingSession,
  sheet: GradedSheetRecord
): string {
  const rows = sheet.questions
    .map((q) => {
      const statusText = !q.autoGradable
        ? 'Không chấm OMR'
        : q.needsReview
        ? 'Cần xem lại'
        : q.isCorrect
        ? 'Đúng'
        : q.isBlank
        ? 'Bỏ trống'
        : 'Sai';
      return `<tr>
        <td>Câu ${q.questionNumber}</td>
        <td>${escapeXml(q.effectiveChoice ?? '—')}</td>
        <td>${escapeXml(q.correctChoice ?? '—')}</td>
        <td>${escapeXml(statusText)}</td>
        <td>${q.pointsEarned.toFixed(2)}</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Phiếu kết quả cá nhân — ${escapeXml(sheet.studentId || sheet.fileName)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 780px; margin: 24px auto; padding: 0 16px; color: #0F172A; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 16px; }
    .score-box { background: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #E2E8F0; padding: 7px 10px; text-align: left; }
    th { background: #F1F5F9; }
  </style>
</head>
<body>
  <h1>Phiếu kết quả bài kiểm tra</h1>
  <div class="meta">${escapeXml(session.examTitle)} · ${escapeXml(session.subject)} · Lớp ${escapeXml(sheet.className || session.className)}</div>
  <div class="score-box">
    <div><strong>Học sinh:</strong> ${escapeXml(sheet.studentName || '(Chưa gán)')} (${escapeXml(sheet.studentId || '—')})</div>
    <div><strong>Mã đề:</strong> ${escapeXml(sheet.examCode || '—')} · <strong>Điểm:</strong> ${sheet.finalScore} / ${sheet.maxScore}</div>
    <div><strong>Chi tiết:</strong> Đúng ${sheet.correctCount} · Sai ${sheet.wrongCount} · Bỏ trống ${sheet.blankCount} · Trạng thái: ${escapeXml(getSheetStatusLabelVi(sheet.status))}</div>
    <div style="font-size:12px;color:#475569;margin-top:4px;">Công thức: ${escapeXml(sheet.scoreFormulaText)}</div>
  </div>
  <table>
    <thead><tr><th>Câu</th><th>Bài làm</th><th>Đáp án</th><th>Kết quả</th><th>Điểm</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

export interface EvidenceFilesProvider {
  getOriginalBytes: (sheet: GradedSheetRecord) => Promise<Uint8Array | null>;
  getAnnotatedBytes: (sheet: GradedSheetRecord) => Promise<Uint8Array | null>;
}

/**
 * Đóng gói trọn bộ TeacherOS_Grading_Archive.zip gồm:
 * - Bang_diem.xlsx
 * - grading_manifest.json
 * - Evidence/<studentId>/original.jpg
 * - Evidence/<studentId>/annotated.png
 * - Evidence/<studentId>/student_report.html (riêng từng học sinh, bảo mật)
 * Hỗ trợ báo tiến độ thực tế và hủy ngang qua AbortSignal.
 */
export async function buildGradingArchiveZip(params: {
  session: GradingSession;
  answerKeysByCode: Record<string, ExamCodeAnswerKey>;
  evidenceProvider: EvidenceFilesProvider;
  onProgress?: (percent: number, label: string) => void;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const { session, answerKeysByCode, evidenceProvider, onProgress, signal } = params;
  const checkAborted = () => {
    if (signal?.aborted) {
      throw new DOMException('Đã hủy quá trình đóng gói ZIP.', 'AbortError');
    }
  };

  checkAborted();
  onProgress?.(8, 'Đang tạo tệp bảng điểm Excel (Bang_diem.xlsx)...');
  const xlsxBytes = await buildGradebookXlsxBuffer(session);

  checkAborted();
  const zip = new JSZip();
  zip.file('Bang_diem.xlsx', xlsxBytes);

  const orderLookup = new Map(
    session.students.map((s) => [s.studentId.toUpperCase(), s.orderNumber])
  );
  const sortedSheets = [...session.sheets].sort((a, b) => {
    const oa = orderLookup.get(a.studentId.toUpperCase()) ?? 99999;
    const ob = orderLookup.get(b.studentId.toUpperCase()) ?? 99999;
    if (oa !== ob) return oa - ob;
    return (a.studentId || a.fileName).localeCompare(b.studentId || b.fileName, 'vi');
  });

  const manifestEntries: Array<Record<string, unknown>> = [];
  const folderCounters = new Map<string, number>();

  for (let i = 0; i < sortedSheets.length; i += 1) {
    checkAborted();
    const sheet = sortedSheets[i];
    const baseFolder = getEvidenceFolderNameForSheet(sheet, i);
    const seenCount = (folderCounters.get(baseFolder) ?? 0) + 1;
    folderCounters.set(baseFolder, seenCount);
    const folderName = seenCount > 1 ? `${baseFolder}_${seenCount}` : baseFolder;

    const pct = 15 + Math.round(((i + 1) / Math.max(1, sortedSheets.length)) * 65);
    onProgress?.(
      pct,
      `Đang đóng gói minh chứng ${i + 1}/${sortedSheets.length} (${folderName})...`
    );

    const origBytes = await evidenceProvider.getOriginalBytes(sheet);
    const annotBytes = await evidenceProvider.getAnnotatedBytes(sheet);

    const evidencePrefix = `Evidence/${folderName}`;
    if (origBytes && origBytes.byteLength > 0) {
      zip.file(`${evidencePrefix}/original.jpg`, origBytes);
    }
    if (annotBytes && annotBytes.byteLength > 0) {
      zip.file(`${evidencePrefix}/annotated.png`, annotBytes);
    }
    zip.file(
      `${evidencePrefix}/student_report.html`,
      buildIndividualStudentReportHtml(session, sheet)
    );

    manifestEntries.push({
      sheetId: sheet.id,
      studentId: sheet.studentId,
      studentName: sheet.studentName,
      className: sheet.className || session.className,
      examCode: sheet.examCode,
      status: sheet.status,
      confirmedByTeacher: sheet.confirmedByTeacher,
      confirmedAt: sheet.confirmedAt ?? null,
      correctCount: sheet.correctCount,
      wrongCount: sheet.wrongCount,
      blankCount: sheet.blankCount,
      uncertainCount: sheet.uncertainCount,
      rawScore: sheet.rawScore,
      finalScore: sheet.finalScore,
      maxScore: sheet.maxScore,
      scoreFormulaText: sheet.scoreFormulaText,
      manualOverridesCount: sheet.questions.filter((q) => q.manuallyOverridden).length,
      overrideAudit: sheet.questions.flatMap((q) => q.overrideHistory),
      evidenceFiles: {
        original: origBytes ? `${evidencePrefix}/original.jpg` : null,
        annotated: annotBytes ? `${evidencePrefix}/annotated.png` : null,
        individualReport: `${evidencePrefix}/student_report.html`,
      },
    });
  }

  checkAborted();
  const manifest = {
    schemaVersion: '1.0',
    generator: 'TeacherOS Smart Grading Studio 1.0 (Local-First)',
    exportedAt: new Date().toISOString(),
    session: {
      id: session.id,
      title: session.title,
      examId: session.examId,
      examTitle: session.examTitle,
      subject: session.subject,
      grade: session.grade,
      className: session.className,
      selectedExamCodes: session.selectedExamCodes,
      gradingRule: session.gradingRule,
      omrThresholds: session.omrThresholds,
    },
    examCodeKeysSummary: Object.values(answerKeysByCode).map((k) => ({
      examCode: k.examCode,
      valid: k.valid,
      autoGradableCount: k.autoGradableCount,
      unsupportedCount: k.unsupportedCount,
    })),
    sheets: manifestEntries,
  };

  zip.file('grading_manifest.json', JSON.stringify(manifest, null, 2));

  onProgress?.(88, 'Đang nén gói lưu trữ TeacherOS_Grading_Archive.zip...');
  const archive = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  checkAborted();
  onProgress?.(100, 'Hoàn tất đóng gói ZIP minh chứng.');
  return archive;
}

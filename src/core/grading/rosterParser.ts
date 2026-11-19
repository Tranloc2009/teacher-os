import JSZip from 'jszip';
import type { StudentRecord } from '../../types/grading';

export interface RosterImportResult {
  students: StudentRecord[];
  warnings: string[];
  errors: string[];
  skippedRows: number;
}

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Tách dòng CSV an toàn hỗ trợ dấu ngoặc kép, BOM UTF-8, và tự nhận diện dấu phẩy / chấm phẩy.
 */
export function parseCsvTable(rawText: string): string[][] {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  const firstLine = cleaned.split(/\r?\n/, 1)[0] ?? '';
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const semiCount = (firstLine.match(/;/g) ?? []).length;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const delimiter =
    tabCount > commaCount && tabCount > semiCount
      ? '\t'
      : semiCount > commaCount
      ? ';'
      : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r') {
      continue;
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((v) => v.length > 0)) rows.push(row);
  }

  return rows;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i += 1) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

/**
 * Đọc bảng đầu tiên trong tệp Excel .xlsx bằng JSZip + phân tích XML thuần (không thư viện ngoài).
 */
export async function parseXlsxFirstSheetRows(
  buffer: ArrayBuffer | Uint8Array
): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);

  // Đọc sharedStrings nếu có
  const sharedStrings: string[] = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ssXml = await ssFile.async('string');
    const siMatches = ssXml.match(/<si\b[\s\S]*?<\/si>/g) ?? [];
    for (const si of siMatches) {
      const tMatches = [...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
      const combined = tMatches.map((m) => decodeXmlEntities(m[1])).join('');
      sharedStrings.push(combined);
    }
  }

  const sheetFile =
    zip.file('xl/worksheets/sheet1.xml') ??
    Object.values(zip.files).find(
      (f) => !f.dir && /^xl\/worksheets\/sheet\d+\.xml$/i.test(f.name)
    );
  if (!sheetFile) {
    throw new Error('Không tìm thấy trang tính (worksheet) trong tệp XLSX.');
  }

  const sheetXml = await sheetFile.async('string');
  const rows: string[][] = [];
  const rowMatches = sheetXml.match(/<row\b[\s\S]*?<\/row>/g) ?? [];

  for (const rowXml of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) ?? [];
    for (const cellXml of cellMatches) {
      const refMatch = cellXml.match(/\br="([A-Z]+)\d+"/i);
      const colIdx = refMatch ? colLettersToIndex(refMatch[1].toUpperCase()) : cells.length;
      const typeMatch = cellXml.match(/\bt="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : '';

      let value = '';
      if (cellType === 'inlineStr') {
        const tMatches = [...cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
        value = tMatches.map((m) => decodeXmlEntities(m[1])).join('');
      } else {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        const rawV = vMatch ? decodeXmlEntities(vMatch[1]) : '';
        if (cellType === 's') {
          const idx = Number(rawV);
          value = Number.isInteger(idx) ? sharedStrings[idx] ?? '' : '';
        } else {
          value = rawV;
        }
      }

      while (cells.length <= colIdx) cells.push('');
      cells[colIdx] = value.trim();
    }

    if (cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }

  return rows;
}

/**
 * Chuyển đổi mảng hàng (từ CSV hoặc XLSX) thành danh sách học sinh hợp lệ.
 * - Bắt buộc studentId là duy nhất trong lớp (từ chối trùng studentId).
 * - Cho phép trùng họ tên đầy đủ khi studentId khác nhau.
 */
export function buildStudentRosterFromRows(
  rows: string[][],
  defaultClassName: string
): RosterImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const students: StudentRecord[] = [];
  let skippedRows = 0;

  if (rows.length === 0) {
    return {
      students: [],
      warnings,
      errors: ['Tệp danh sách học sinh trống.'],
      skippedRows: 0,
    };
  }

  // Phát hiện dòng tiêu đề cột
  const firstRowNorm = rows[0].map(normalizeHeader);
  let idCol = firstRowNorm.findIndex((h) =>
    ['mahocsinh', 'mahs', 'studentid', 'id', 'sbd', 'sobaodanh', 'ma'].includes(h)
  );
  let nameCol = firstRowNorm.findIndex((h) =>
    ['hovaten', 'hoten', 'tenhocsinh', 'fullname', 'name', 'ten'].includes(h)
  );
  let classCol = firstRowNorm.findIndex((h) =>
    ['lop', 'class', 'classname', 'tenlop'].includes(h)
  );
  let orderCol = firstRowNorm.findIndex((h) =>
    ['stt', 'sothutu', 'order', 'no'].includes(h)
  );

  const hasHeader = idCol !== -1 || nameCol !== -1;
  const startRow = hasHeader ? 1 : 0;

  if (!hasHeader) {
    // Mặc định thứ tự phổ biến: [STT, Mã HS, Họ tên, Lớp] hoặc [Mã HS, Họ tên, Lớp]
    if (rows[0].length >= 4 && /^\d+$/.test(rows[0][0].trim())) {
      orderCol = 0;
      idCol = 1;
      nameCol = 2;
      classCol = 3;
    } else {
      idCol = 0;
      nameCol = 1;
      classCol = rows[0].length >= 3 ? 2 : -1;
    }
  } else {
    if (idCol === -1) idCol = 0;
    if (nameCol === -1) nameCol = idCol === 0 ? 1 : 0;
  }

  const seenIds = new Set<string>();

  for (let r = startRow; r < rows.length; r += 1) {
    const row = rows[r];
    const studentId = (row[idCol] ?? '').trim();
    const fullName = (row[nameCol] ?? '').trim();
    const className =
      (classCol >= 0 ? row[classCol] ?? '' : '').trim() || defaultClassName;
    const rawOrder = orderCol >= 0 ? Number(row[orderCol]) : NaN;

    if (!studentId && !fullName) {
      skippedRows += 1;
      continue;
    }

    if (!studentId) {
      skippedRows += 1;
      warnings.push(`Dòng ${r + 1}: thiếu Mã học sinh cho "${fullName}" — đã bỏ qua.`);
      continue;
    }

    const idKey = studentId.toUpperCase();
    if (seenIds.has(idKey)) {
      skippedRows += 1;
      warnings.push(
        `Dòng ${r + 1}: trùng Mã học sinh "${studentId}" — đã bỏ qua để đảm bảo khóa chính duy nhất.`
      );
      continue;
    }
    seenIds.add(idKey);

    students.push({
      studentId,
      fullName: fullName || `Học sinh ${studentId}`,
      className: className || 'Chưa gắn lớp',
      orderNumber:
        Number.isInteger(rawOrder) && rawOrder > 0
          ? rawOrder
          : students.length + 1,
    });
  }

  if (students.length === 0) {
    errors.push(
      'Không đọc được học sinh hợp lệ nào. Hãy đảm bảo tệp có cột "Mã học sinh" và "Họ và tên".'
    );
  }

  return { students, warnings, errors, skippedRows };
}

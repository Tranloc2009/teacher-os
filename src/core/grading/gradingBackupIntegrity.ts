import type { GradingSession } from '../../types/grading';

export interface VerifiedGradingBackupPayloadV2 {
  schema: 'teacheros-grading-session-v2';
  exportedAt: string;
  deviceNote: string;
  sheetCount: number;
  studentCount: number;
  integrityChecksum: string;
  session: GradingSession;
}

/**
 * Hàm băm kiểm tra toàn vẹn 64-bit (dual FNV-1a) chạy đồng bộ ở mọi trình duyệt
 * và Node.js (không phụ thuộc WebCrypto HTTPS) để phát hiện tệp sao lưu bị cắt/sửa lỗi.
 */
export function computeDeterministicIntegrityHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (code + (i & 0xff)) & 0xffff;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function createVerifiedSessionBackupPayload(
  session: GradingSession,
  deviceNote = 'Local-First Manual Transfer (TeacherOS)'
): VerifiedGradingBackupPayloadV2 {
  const canonicalSessionJson = JSON.stringify(session);
  const integrityChecksum = computeDeterministicIntegrityHex(canonicalSessionJson);

  return {
    schema: 'teacheros-grading-session-v2',
    exportedAt: new Date().toISOString(),
    deviceNote,
    sheetCount: session.sheets.length,
    studentCount: session.students.length,
    integrityChecksum,
    session,
  };
}

export function parseAndVerifySessionBackupJson(rawText: string): {
  valid: boolean;
  session?: GradingSession;
  version?: 'v1' | 'v2';
  warning?: string;
  error?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      valid: false,
      error: 'Tệp sao lưu JSON không hợp lệ hoặc bị hỏng cú pháp.',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: 'Cấu trúc tệp sao lưu không hợp lệ.' };
  }

  const obj = parsed as Record<string, unknown>;
  const session = obj.session as GradingSession | undefined;

  if (
    !session ||
    typeof session !== 'object' ||
    typeof session.id !== 'string' ||
    !Array.isArray(session.sheets) ||
    !Array.isArray(session.students)
  ) {
    return {
      valid: false,
      error: 'Tệp JSON không phải bản sao lưu phiên chấm Smart Grading Studio hợp lệ.',
    };
  }

  if (obj.schema === 'teacheros-grading-session-v2') {
    const expected = typeof obj.integrityChecksum === 'string' ? obj.integrityChecksum : '';
    const actual = computeDeterministicIntegrityHex(JSON.stringify(session));
    if (!expected || expected !== actual) {
      return {
        valid: false,
        error:
          'Kiểm tra mã toàn vẹn (checksum) thất bại: tệp sao lưu đã bị thay đổi hoặc hỏng dữ liệu.',
      };
    }
    return {
      valid: true,
      session,
      version: 'v2',
    };
  }

  // Hỗ trợ tương thích ngược với bản sao lưu v1 trước đó
  return {
    valid: true,
    session,
    version: 'v1',
    warning: 'Đã nạp bản sao lưu định dạng v1 (chưa có mã kiểm tra toàn vẹn v2).',
  };
}

import type { AppRole } from './types';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ROLES = new Set<AppRole>(['admin', 'teacher', 'student']);
const MAX_JSON_BODY_BYTES = 64 * 1024;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

export function isValidRole(value: unknown): value is AppRole {
  return typeof value === 'string' && VALID_ROLES.has(value as AppRole);
}

export async function readValidatedJsonBody(
  request: Request
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string }
> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return {
      ok: false,
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Content-Type phải là application/json.',
    };
  }

  const rawText = await request.text();
  if (rawText.length > MAX_JSON_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Kích thước payload vượt quá giới hạn cho phép (64 KB).',
    };
  }

  try {
    const parsed: unknown = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_JSON_OBJECT',
        message: 'Nội dung JSON phải là một object hợp lệ.',
      };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'MALFORMED_JSON',
      message: 'Không thể phân tích nội dung JSON gửi lên.',
    };
  }
}

export interface CreateClassroomInput {
  name: string;
  subject: string;
  grade: string;
  schoolYear: string;
  joinCode: string;
}

export function validateCreateClassroomInput(
  body: Record<string, unknown>
):
  | { ok: true; value: CreateClassroomInput }
  | { ok: false; details: string[] } {
  const details: string[] = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const subject =
    typeof body.subject === 'string' && body.subject.trim()
      ? body.subject.trim()
      : 'Toán học';
  const grade =
    typeof body.grade === 'string' && body.grade.trim()
      ? body.grade.trim()
      : '12';
  const schoolYear =
    typeof body.schoolYear === 'string' ? body.schoolYear.trim() : '';
  const rawJoinCode =
    typeof body.joinCode === 'string' ? body.joinCode.trim().toUpperCase() : '';

  if (name.length < 1 || name.length > 120) {
    details.push('Tên lớp học phải từ 1 đến 120 ký tự.');
  }
  if (subject.length < 1 || subject.length > 80) {
    details.push('Tên môn học phải từ 1 đến 80 ký tự.');
  }
  if (grade.length < 1 || grade.length > 20) {
    details.push('Khối lớp phải từ 1 đến 20 ký tự.');
  }
  if (schoolYear.length > 32) {
    details.push('Năm học tối đa 32 ký tự.');
  }

  const joinCode = rawJoinCode || generateSecureJoinCode();
  if (!/^[A-Z0-9-]{4,24}$/.test(joinCode)) {
    details.push('Mã tham gia lớp chỉ gồm 4-24 ký tự A-Z, 0-9 hoặc dấu gạch ngang.');
  }

  if (details.length > 0) {
    return { ok: false, details };
  }

  return {
    ok: true,
    value: { name, subject, grade, schoolYear, joinCode },
  };
}

export function validateGrantRoleInput(body: Record<string, unknown>):
  | { ok: true; targetUserId: string; role: AppRole }
  | { ok: false; details: string[] } {
  const details: string[] = [];
  const targetUserId = body.targetUserId;
  const role = body.role;

  if (!isValidUuid(targetUserId)) {
    details.push('targetUserId phải là UUID hợp lệ.');
  }
  if (!isValidRole(role)) {
    details.push('role phải thuộc một trong các giá trị: admin, teacher, student.');
  }

  if (details.length > 0) {
    return { ok: false, details };
  }

  return {
    ok: true,
    targetUserId: (targetUserId as string).trim(),
    role: role as AppRole,
  };
}

export function generateSecureJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return code;
}

import {
  ActivityItem,
  BackupPayload,
  LessonPack,
  PrintSettings,
  QuestionItem,
  QuestionTier,
  RubricCriterion,
  WorksheetVariantConfig,
} from '../types/lesson';

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  payload: BackupPayload | null;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  id: 'default',
  paperSize: 'A4',
  marginPreset: 'standard',
  marginsMm: {
    top: 15,
    right: 15,
    bottom: 15,
    left: 15,
  },
  includeTeacherAnswerKey: true,
  schoolHeader: '',
  teacherName: '',
  updatedAt: new Date(0).toISOString(),
};

export function createBackupPayload(
  lessonPacks: LessonPack[],
  settings: PrintSettings,
  extras?: {
    resources?: BackupPayload['resources'];
    workflows?: BackupPayload['workflows'];
    journals?: BackupPayload['journals'];
    mathExams?: BackupPayload['mathExams'];
    canvasBoards?: BackupPayload['canvasBoards'];
    canvasNodes?: BackupPayload['canvasNodes'];
    canvasEdges?: BackupPayload['canvasEdges'];
    canvasViewSettings?: BackupPayload['canvasViewSettings'];
  }
): BackupPayload {
  return {
    app: 'TeacherOS',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    settings,
    lessonPacks,
    ...(extras?.resources ? { resources: extras.resources } : {}),
    ...(extras?.workflows ? { workflows: extras.workflows } : {}),
    ...(extras?.journals ? { journals: extras.journals } : {}),
    ...(extras?.mathExams ? { mathExams: extras.mathExams } : {}),
    ...(extras?.canvasBoards ? { canvasBoards: extras.canvasBoards } : {}),
    ...(extras?.canvasNodes ? { canvasNodes: extras.canvasNodes } : {}),
    ...(extras?.canvasEdges ? { canvasEdges: extras.canvasEdges } : {}),
    ...(extras?.canvasViewSettings ? { canvasViewSettings: extras.canvasViewSettings } : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidTier(value: unknown): value is QuestionTier {
  return value === 'basic' || value === 'applied' || value === 'extended';
}

function validateActivity(item: unknown, packIdx: number, actIdx: number, errors: string[]): item is ActivityItem {
  if (!isObject(item)) {
    errors.push(`Bộ tiết #${packIdx + 1}, hoạt động #${actIdx + 1}: không đúng định dạng đối tượng.`);
    return false;
  }
  if (!isString(item.id) || !item.id.trim()) {
    errors.push(`Bộ tiết #${packIdx + 1}, hoạt động #${actIdx + 1}: thiếu mã định danh (id).`);
    return false;
  }
  if (!isString(item.title)) {
    errors.push(`Bộ tiết #${packIdx + 1}, hoạt động #${actIdx + 1}: thiếu tiêu đề.`);
    return false;
  }
  if (!isFiniteNumber(item.durationMinutes) || item.durationMinutes < 1 || item.durationMinutes > 90) {
    errors.push(`Bộ tiết #${packIdx + 1}, hoạt động #${actIdx + 1}: thời lượng không hợp lệ.`);
    return false;
  }
  if (!isString(item.instructions) || !isString(item.studentTask) || !isString(item.teacherNote) || !isString(item.grouping)) {
    errors.push(`Bộ tiết #${packIdx + 1}, hoạt động #${actIdx + 1}: thiếu trường hướng dẫn hoặc nhóm.`);
    return false;
  }
  return true;
}

function validateQuestion(item: unknown, packIdx: number, qIdx: number, errors: string[]): item is QuestionItem {
  if (!isObject(item)) {
    errors.push(`Bộ tiết #${packIdx + 1}, câu hỏi #${qIdx + 1}: không đúng định dạng đối tượng.`);
    return false;
  }
  if (!isString(item.id) || !item.id.trim()) {
    errors.push(`Bộ tiết #${packIdx + 1}, câu hỏi #${qIdx + 1}: thiếu mã định danh (id).`);
    return false;
  }
  if (item.code !== undefined && !isString(item.code)) {
    errors.push(`Bộ tiết #${packIdx + 1}, câu hỏi #${qIdx + 1}: mã riêng (code) phải là chuỗi.`);
    return false;
  }
  if (!isValidTier(item.tier)) {
    errors.push(`Bộ tiết #${packIdx + 1}, câu hỏi #${qIdx + 1}: mức độ phải là basic, applied hoặc extended.`);
    return false;
  }
  if (!isString(item.prompt) || !isString(item.answerGuide)) {
    errors.push(`Bộ tiết #${packIdx + 1}, câu hỏi #${qIdx + 1}: thiếu nội dung hoặc gợi ý đáp án.`);
    return false;
  }
  if (!isFiniteNumber(item.points) || item.points < 0) {
    errors.push(`Bộ tiết #${packIdx + 1}, câu hỏi #${qIdx + 1}: điểm phải là số không âm.`);
    return false;
  }
  return true;
}

function validateWorksheetVariant(
  item: unknown,
  packIdx: number,
  vIdx: number,
  errors: string[]
): item is WorksheetVariantConfig {
  if (!isObject(item)) {
    errors.push(`Bộ tiết #${packIdx + 1}, mẫu phiếu #${vIdx + 1}: không đúng định dạng đối tượng.`);
    return false;
  }
  if (item.id !== 'A' && item.id !== 'B' && item.id !== 'C') {
    errors.push(`Bộ tiết #${packIdx + 1}, mẫu phiếu #${vIdx + 1}: mã phiếu phải là A, B hoặc C.`);
    return false;
  }
  if (!isString(item.label)) {
    errors.push(`Bộ tiết #${packIdx + 1}, mẫu phiếu #${vIdx + 1}: thiếu tên nhãn phiếu.`);
    return false;
  }
  if (!isObject(item.distribution)) {
    errors.push(`Bộ tiết #${packIdx + 1}, mẫu phiếu #${vIdx + 1}: thiếu cấu hình số câu.`);
    return false;
  }
  const { basic, applied, extended } = item.distribution;
  if (
    !isFiniteNumber(basic) || basic < 0 ||
    !isFiniteNumber(applied) || applied < 0 ||
    !isFiniteNumber(extended) || extended < 0
  ) {
    errors.push(`Bộ tiết #${packIdx + 1}, mẫu phiếu #${vIdx + 1}: số câu phải là số không âm.`);
    return false;
  }
  return true;
}

function validateRubricCriterion(item: unknown, packIdx: number, rIdx: number, errors: string[]): item is RubricCriterion {
  if (!isObject(item)) {
    errors.push(`Bộ tiết #${packIdx + 1}, tiêu chí rubric #${rIdx + 1}: không đúng định dạng đối tượng.`);
    return false;
  }
  if (!isString(item.id) || !item.id.trim() || !isString(item.name)) {
    errors.push(`Bộ tiết #${packIdx + 1}, tiêu chí rubric #${rIdx + 1}: thiếu mã hoặc tên tiêu chí.`);
    return false;
  }
  if (!isFiniteNumber(item.weightPercent) || item.weightPercent < 0 || item.weightPercent > 100) {
    errors.push(`Bộ tiết #${packIdx + 1}, tiêu chí rubric #${rIdx + 1}: tỷ trọng phải từ 0 đến 100.`);
    return false;
  }
  if (!isObject(item.levels)) {
    errors.push(`Bộ tiết #${packIdx + 1}, tiêu chí rubric #${rIdx + 1}: thiếu bảng mô tả các mức.`);
    return false;
  }
  const { needsSupport, meets, exceeds } = item.levels;
  if (!isString(needsSupport) || !isString(meets) || !isString(exceeds)) {
    errors.push(`Bộ tiết #${packIdx + 1}, tiêu chí rubric #${rIdx + 1}: mô tả 3 mức đạt (needsSupport, meets, exceeds) phải là chuỗi văn bản.`);
    return false;
  }
  return true;
}

function validatePrintSettings(raw: unknown, errors: string[]): raw is PrintSettings {
  if (!isObject(raw)) {
    errors.push('Cấu hình in (settings) không hợp lệ.');
    return false;
  }
  if (raw.paperSize !== 'A4') {
    errors.push('Khổ giấy (paperSize) trong bản sao lưu phải là "A4".');
    return false;
  }
  if (!isObject(raw.marginsMm)) {
    errors.push('Thiếu thông số lề in (marginsMm).');
    return false;
  }
  const { top, right, bottom, left } = raw.marginsMm;
  const margins = [top, right, bottom, left];
  if (margins.some((m) => !isFiniteNumber(m) || m < 5 || m > 40)) {
    errors.push('Lề in (top/right/bottom/left) phải nằm trong khoảng 5mm đến 40mm.');
    return false;
  }
  if (typeof raw.includeTeacherAnswerKey !== 'boolean') {
    errors.push('Trường includeTeacherAnswerKey phải là boolean.');
    return false;
  }
  return true;
}

/**
 * Kiểm tra schema chặt chẽ cho file JSON sao lưu trước khi cho phép người dùng xác nhận khôi phục.
 */
export function validateBackupPayload(rawInput: string | unknown): BackupValidationResult {
  const errors: string[] = [];
  let parsed: unknown = rawInput;

  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      return {
        valid: false,
        errors: ['Tệp không phải định dạng JSON hợp lệ. Vui lòng kiểm tra lại tệp sao lưu.'],
        payload: null,
      };
    }
  }

  if (!isObject(parsed)) {
    return {
      valid: false,
      errors: ['Dữ liệu gốc của bản sao lưu phải là một đối tượng JSON.'],
      payload: null,
    };
  }

  if (parsed.app !== 'TeacherOS') {
    errors.push('Tệp sao lưu không thuộc định dạng của TeacherOS (thiếu trường app: "TeacherOS").');
  }
  if (parsed.schemaVersion !== 2) {
    errors.push('Phiên bản cấu trúc dữ liệu (schemaVersion) phải là 2.');
  }
  if (!isString(parsed.exportedAt) || Number.isNaN(Date.parse(parsed.exportedAt))) {
    errors.push('Thời điểm xuất bản sao lưu (exportedAt) không hợp lệ.');
  }

  validatePrintSettings(parsed.settings, errors);

  if (!Array.isArray(parsed.lessonPacks)) {
    errors.push('Danh sách bộ tiết dạy (lessonPacks) phải là một mảng.');
  } else {
    const seenIds = new Set<string>();
    parsed.lessonPacks.forEach((pack, idx) => {
      if (!isObject(pack)) {
        errors.push(`Bộ tiết #${idx + 1}: không đúng định dạng đối tượng.`);
        return;
      }
      if (!isString(pack.id) || !pack.id.trim()) {
        errors.push(`Bộ tiết #${idx + 1}: thiếu mã định danh (id).`);
      } else if (seenIds.has(pack.id)) {
        errors.push(`Bộ tiết #${idx + 1}: trùng mã định danh "${pack.id}".`);
      } else {
        seenIds.add(pack.id);
      }

      if (!isString(pack.title) || !isString(pack.subject) || !isString(pack.grade)) {
        errors.push(`Bộ tiết #${idx + 1}: thiếu tiêu đề, môn học hoặc khối lớp.`);
      }
      if (pack.duration !== 45 && pack.duration !== 90) {
        errors.push(`Bộ tiết #${idx + 1}: thời lượng phải là 45 hoặc 90 phút.`);
      }
      if (pack.status !== 'draft' && pack.status !== 'completed') {
        errors.push(`Bộ tiết #${idx + 1}: trạng thái phải là "draft" hoặc "completed".`);
      }
      if (!Array.isArray(pack.objectives) || pack.objectives.some((o) => !isString(o))) {
        errors.push(`Bộ tiết #${idx + 1}: mục tiêu bài học phải là mảng chuỗi.`);
      }
      if (!Array.isArray(pack.activities)) {
        errors.push(`Bộ tiết #${idx + 1}: danh sách hoạt động phải là mảng.`);
      } else {
        pack.activities.forEach((act, aIdx) => validateActivity(act, idx, aIdx, errors));
      }
      if (!Array.isArray(pack.questions)) {
        errors.push(`Bộ tiết #${idx + 1}: danh sách câu hỏi phải là mảng.`);
      } else {
        pack.questions.forEach((q, qIdx) => validateQuestion(q, idx, qIdx, errors));
      }
      if (!isObject(pack.distribution)) {
        errors.push(`Bộ tiết #${idx + 1}: thiếu cấu hình phân bổ câu hỏi.`);
      } else {
        const { basic, applied, extended } = pack.distribution;
        if (
          !isFiniteNumber(basic) || basic < 0 ||
          !isFiniteNumber(applied) || applied < 0 ||
          !isFiniteNumber(extended) || extended < 0
        ) {
          errors.push(`Bộ tiết #${idx + 1}: số lượng phân bổ Cơ bản / Vận dụng / Mở rộng phải là số không âm.`);
        }
      }
      if (pack.worksheetVariants !== undefined) {
        if (!Array.isArray(pack.worksheetVariants)) {
          errors.push(`Bộ tiết #${idx + 1}: danh sách 3 mẫu phiếu (worksheetVariants) phải là mảng.`);
        } else {
          pack.worksheetVariants.forEach((v, vIdx) => validateWorksheetVariant(v, idx, vIdx, errors));
        }
      }
      if (!Array.isArray(pack.rubric)) {
        errors.push(`Bộ tiết #${idx + 1}: rubric phải là mảng tiêu chí.`);
      } else {
        pack.rubric.forEach((r, rIdx) => validateRubricCriterion(r, idx, rIdx, errors));
      }
    });
  }

  if (parsed.canvasBoards !== undefined) {
    if (!Array.isArray(parsed.canvasBoards)) {
      errors.push('Danh sách bảng Canvas (canvasBoards) phải là một mảng.');
    } else {
      parsed.canvasBoards.forEach((b, idx) => {
        if (!isObject(b) || !isString(b.id) || !b.id.trim()) {
          errors.push(`Bảng Canvas #${idx + 1}: thiếu mã định danh (id).`);
        }
      });
    }
  }

  if (parsed.canvasNodes !== undefined) {
    if (!Array.isArray(parsed.canvasNodes)) {
      errors.push('Danh sách node Canvas (canvasNodes) phải là một mảng.');
    } else {
      parsed.canvasNodes.forEach((n, idx) => {
        if (!isObject(n) || !isString(n.id) || !n.id.trim() || !isString(n.boardId)) {
          errors.push(`Node Canvas #${idx + 1}: thiếu id hoặc boardId hợp lệ.`);
        }
      });
    }
  }

  if (parsed.canvasEdges !== undefined) {
    if (!Array.isArray(parsed.canvasEdges)) {
      errors.push('Danh sách liên kết Canvas (canvasEdges) phải là một mảng.');
    } else {
      parsed.canvasEdges.forEach((e, idx) => {
        if (
          !isObject(e) ||
          !isString(e.id) ||
          !isString(e.boardId) ||
          !isString(e.source) ||
          !isString(e.target)
        ) {
          errors.push(`Liên kết Canvas #${idx + 1}: thiếu id, boardId, source hoặc target.`);
        }
      });
    }
  }

  if (parsed.canvasViewSettings !== undefined && !Array.isArray(parsed.canvasViewSettings)) {
    errors.push('Cấu hình hiển thị Canvas (canvasViewSettings) phải là một mảng.');
  }

  if (errors.length > 0) {
    return { valid: false, errors, payload: null };
  }

  return {
    valid: true,
    errors: [],
    payload: parsed as unknown as BackupPayload,
  };
}

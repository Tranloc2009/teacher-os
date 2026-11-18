import {
  LessonPack,
  QuestionItem,
  QuestionTier,
  RUBRIC_MAX_CRITERIA,
  RUBRIC_MIN_CRITERIA,
  TierDistribution,
  ValidationErrors,
  WorksheetVariantConfig,
  WorksheetVariantId,
} from '../types/lesson';

export interface AllocatedWorksheet {
  sections: Record<QuestionTier, QuestionItem[]>;
  orderedQuestions: QuestionItem[];
  requestedCounts: TierDistribution;
  actualCounts: TierDistribution;
  shortfalls: TierDistribution;
  totalQuestions: number;
  totalPoints: number;
  warnings: string[];
}

export interface AllocatedVariantResult {
  variant: WorksheetVariantConfig;
  allocated: AllocatedWorksheet;
}

const TIER_ORDER: QuestionTier[] = ['basic', 'applied', 'extended'];

const TIER_VI_LABEL: Record<QuestionTier, string> = {
  basic: 'Cơ bản',
  applied: 'Vận dụng',
  extended: 'Mở rộng',
};

export function createDefaultWorksheetVariants(
  baseDist: TierDistribution = { basic: 2, applied: 1, extended: 1 }
): WorksheetVariantConfig[] {
  return [
    {
      id: 'A',
      label: 'Phiếu A (Củng cố cơ bản)',
      distribution: {
        basic: Math.max(0, baseDist.basic),
        applied: 0,
        extended: 0,
      },
    },
    {
      id: 'B',
      label: 'Phiếu B (Chuẩn tiết học)',
      distribution: {
        basic: Math.max(0, baseDist.basic),
        applied: Math.max(0, baseDist.applied),
        extended: 0,
      },
    },
    {
      id: 'C',
      label: 'Phiếu C (Phân hóa mở rộng)',
      distribution: {
        basic: Math.max(0, baseDist.basic),
        applied: Math.max(0, baseDist.applied),
        extended: Math.max(0, baseDist.extended),
      },
    },
  ];
}

export function normalizeWorksheetVariants(
  pack: Pick<LessonPack, 'distribution' | 'worksheetVariants'>
): WorksheetVariantConfig[] {
  const defaults = createDefaultWorksheetVariants(pack.distribution);
  if (!Array.isArray(pack.worksheetVariants) || pack.worksheetVariants.length === 0) {
    return defaults;
  }
  const byId = new Map<WorksheetVariantId, WorksheetVariantConfig>();
  for (const item of pack.worksheetVariants) {
    if (item && (item.id === 'A' || item.id === 'B' || item.id === 'C')) {
      byId.set(item.id, item);
    }
  }
  return defaults.map((def) => byId.get(def.id) ?? def);
}

/**
 * Tính toán phân bổ câu hỏi vào 1 bản phiếu học sinh theo cấu hình Cơ bản / Vận dụng / Mở rộng.
 * Tuyệt đối KHÔNG tự tạo câu giả khi ngân hàng thiếu câu hỏi; chỉ ghi nhận cảnh báo thiếu.
 */
export function allocateQuestions(
  questions: QuestionItem[],
  distribution: TierDistribution
): AllocatedWorksheet {
  const byTier: Record<QuestionTier, QuestionItem[]> = {
    basic: [],
    applied: [],
    extended: [],
  };

  for (const q of questions) {
    if (byTier[q.tier]) {
      byTier[q.tier].push(q);
    }
  }

  const sections: Record<QuestionTier, QuestionItem[]> = {
    basic: [],
    applied: [],
    extended: [],
  };
  const shortfalls: TierDistribution = { basic: 0, applied: 0, extended: 0 };
  const warnings: string[] = [];

  for (const tier of TIER_ORDER) {
    const requested = Math.max(0, Math.floor(Number(distribution[tier]) || 0));
    const available = byTier[tier];
    const selected = available.slice(0, requested);
    sections[tier] = selected;

    if (requested > available.length) {
      const missing = requested - available.length;
      shortfalls[tier] = missing;
      warnings.push(
        `Thiếu ${missing} câu mức ${TIER_VI_LABEL[tier]} (yêu cầu ${requested} câu nhưng hiện chỉ có ${available.length} câu). Hệ thống không tự tạo câu giả.`
      );
    }
  }

  const orderedQuestions = [
    ...sections.basic,
    ...sections.applied,
    ...sections.extended,
  ];

  const actualCounts: TierDistribution = {
    basic: sections.basic.length,
    applied: sections.applied.length,
    extended: sections.extended.length,
  };

  const totalQuestions = orderedQuestions.length;
  const totalPoints = orderedQuestions.reduce(
    (sum, q) => sum + (Number.isFinite(q.points) && q.points > 0 ? q.points : 0),
    0
  );

  if (totalQuestions === 0) {
    warnings.push('Bản phiếu này chưa có câu hỏi nào được chọn.');
  }

  return {
    sections,
    orderedQuestions,
    requestedCounts: {
      basic: Math.max(0, Math.floor(Number(distribution.basic) || 0)),
      applied: Math.max(0, Math.floor(Number(distribution.applied) || 0)),
      extended: Math.max(0, Math.floor(Number(distribution.extended) || 0)),
    },
    actualCounts,
    shortfalls,
    totalQuestions,
    totalPoints: Math.round(totalPoints * 100) / 100,
    warnings,
  };
}

/**
 * Phân bổ đồng thời 3 mẫu phiếu A4 (Phiếu A, Phiếu B, Phiếu C) từ ngân hàng câu hỏi hiện có.
 */
export function allocateThreeWorksheets(
  questions: QuestionItem[],
  variants: WorksheetVariantConfig[]
): AllocatedVariantResult[] {
  return variants.map((variant) => ({
    variant,
    allocated: allocateQuestions(questions, variant.distribution),
  }));
}

export function countAvailableByTier(questions: QuestionItem[]): TierDistribution {
  const counts: TierDistribution = { basic: 0, applied: 0, extended: 0 };
  for (const q of questions) {
    if (q.tier in counts) {
      counts[q.tier] += 1;
    }
  }
  return counts;
}

export function generateNextQuestionCode(
  questions: QuestionItem[],
  tier: QuestionTier
): string {
  const prefix = tier === 'basic' ? 'CB' : tier === 'applied' ? 'VD' : 'MR';
  const existingCodes = new Set(questions.map((q) => q.code.trim().toUpperCase()));
  let num = 1;
  while (existingCodes.has(`${prefix}-${String(num).padStart(2, '0')}`)) {
    num += 1;
  }
  return `${prefix}-${String(num).padStart(2, '0')}`;
}

export function calculateActivityMinutes(pack: Pick<LessonPack, 'activities'>): number {
  return pack.activities.reduce(
    (sum, act) => sum + (Number.isFinite(act.durationMinutes) ? act.durationMinutes : 0),
    0
  );
}

export function validateStep1(pack: LessonPack): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!pack.subject.trim()) {
    errors.subject = 'Vui lòng chọn hoặc nhập môn học.';
  }
  if (!pack.grade.trim()) {
    errors.grade = 'Vui lòng chọn khối lớp.';
  }
  if (!pack.title.trim()) {
    errors.title = 'Vui lòng nhập tên chủ đề hoặc tên bài dạy.';
  } else if (pack.title.trim().length < 4) {
    errors.title = 'Tên chủ đề cần ít nhất 4 ký tự.';
  }
  if (pack.duration !== 45 && pack.duration !== 90) {
    errors.duration = 'Thời lượng tiết dạy phải là 45 phút hoặc 90 phút.';
  }
  const validObjectives = pack.objectives.map((o) => o.trim()).filter(Boolean);
  if (validObjectives.length === 0) {
    errors.objectives = 'Vui lòng nhập ít nhất 1 mục tiêu bài học.';
  }
  return errors;
}

export function validateStep2(pack: LessonPack): ValidationErrors {
  const errors: ValidationErrors = {};
  if (pack.activities.length === 0) {
    errors.activities = 'Vui lòng chọn hoặc tạo ít nhất 1 hoạt động lớp học.';
    return errors;
  }
  for (let i = 0; i < pack.activities.length; i++) {
    const act = pack.activities[i];
    if (!act.title.trim()) {
      errors[`activity_${act.id}_title`] = `Hoạt động #${i + 1} chưa có tiêu đề.`;
    }
    if (!Number.isFinite(act.durationMinutes) || act.durationMinutes < 1 || act.durationMinutes > 45) {
      errors[`activity_${act.id}_duration`] = `Thời lượng hoạt động #${i + 1} phải từ 1 đến 45 phút.`;
    }
    if (!act.instructions.trim() && !act.studentTask.trim()) {
      errors[`activity_${act.id}_body`] = `Hoạt động #${i + 1} cần có hướng dẫn tổ chức hoặc nhiệm vụ học sinh.`;
    }
  }
  return errors;
}

export function validateStep3(pack: LessonPack): ValidationErrors {
  const errors: ValidationErrors = {};
  if (pack.questions.length === 0) {
    errors.questions = 'Vui lòng nhập ít nhất 1 câu hỏi cho phiếu bài tập.';
    return errors;
  }

  const seenCodes = new Map<string, string>();
  for (let i = 0; i < pack.questions.length; i++) {
    const q = pack.questions[i];
    const cleanCode = q.code.trim();
    if (!cleanCode) {
      errors[`question_${q.id}_code`] = `Câu hỏi #${i + 1} chưa có mã riêng.`;
    } else {
      const upper = cleanCode.toUpperCase();
      if (seenCodes.has(upper)) {
        errors[`question_${q.id}_code`] = `Mã "${cleanCode}" bị trùng với một câu hỏi khác.`;
      } else {
        seenCodes.set(upper, q.id);
      }
    }

    if (!q.prompt.trim()) {
      errors[`question_${q.id}_prompt`] = `Câu hỏi #${i + 1} chưa có nội dung.`;
    }
    if (!Number.isFinite(q.points) || q.points < 0) {
      errors[`question_${q.id}_points`] = `Điểm câu hỏi #${i + 1} không hợp lệ.`;
    }
  }

  const variants = normalizeWorksheetVariants(pack);
  const results = allocateThreeWorksheets(pack.questions, variants);
  const totalAcrossAll = results.reduce((s, r) => s + r.allocated.totalQuestions, 0);
  if (totalAcrossAll === 0) {
    errors.distribution = 'Cả 3 mẫu phiếu hiện đang chọn 0 câu hỏi. Hãy chọn số câu cho ít nhất một bản phiếu.';
  }

  for (const res of results) {
    const { shortfalls } = res.allocated;
    if (shortfalls.basic > 0 || shortfalls.applied > 0 || shortfalls.extended > 0) {
      errors[`variant_${res.variant.id}_shortfall`] =
        `${res.variant.label}: số câu yêu cầu vượt quá ngân hàng câu hỏi hiện có.`;
    }
  }

  return errors;
}

export function validateStep4(pack: LessonPack): ValidationErrors {
  const errors: ValidationErrors = {};
  if (pack.rubric.length < RUBRIC_MIN_CRITERIA || pack.rubric.length > RUBRIC_MAX_CRITERIA) {
    errors.rubric = `Rubric cần có từ ${RUBRIC_MIN_CRITERIA} đến ${RUBRIC_MAX_CRITERIA} tiêu chí (hiện có ${pack.rubric.length} tiêu chí).`;
  }

  let weightSum = 0;
  for (let i = 0; i < pack.rubric.length; i++) {
    const c = pack.rubric[i];
    if (!c.name.trim()) {
      errors[`rubric_${c.id}_name`] = `Tiêu chí #${i + 1} chưa có tên.`;
    }
    if (
      !c.levels.needsSupport.trim() ||
      !c.levels.meets.trim() ||
      !c.levels.exceeds.trim()
    ) {
      errors[`rubric_${c.id}_levels`] = `Tiêu chí "${c.name || `#${i + 1}`}" cần điền đủ mô tả cho cả 3 mức đạt.`;
    }
    weightSum += Number(c.weightPercent) || 0;
  }

  if (pack.rubric.length > 0 && weightSum !== 100) {
    errors.weightSum = `Tổng tỷ trọng các tiêu chí hiện là ${weightSum}% (khuyến nghị đủ 100%).`;
  }
  return errors;
}

export function validateFullLessonPack(pack: LessonPack): ValidationErrors {
  return {
    ...validateStep1(pack),
    ...validateStep2(pack),
    ...validateStep3(pack),
    ...validateStep4(pack),
  };
}

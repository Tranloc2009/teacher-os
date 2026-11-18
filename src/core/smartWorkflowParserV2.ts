import { APP_REGISTRY, AppId } from './appRegistry';
import {
  AnalyzedTask,
  NegationConstraint,
  OptionalTemplateSuggestion,
  ParsedDeadlineInfo,
  ParsedGradeInfo,
  ParsedQuantity,
  ParsedSubjectInfo,
  ParsedWorkflowPlan,
  TaskDependency,
  WorkCategoryV2,
  WorkflowGroupKey,
  WorkflowTaskGroup,
} from './workflowTypes';

export interface SmartWorkflowParserOptions {
  referenceDate?: Date;
}

export function normalizeVietnamese(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholePhrase(normalizedText: string, phrase: string): boolean {
  const re = new RegExp(
    `(?:^|[\\s,.;:!?()\\-–/])${escapeRegExp(phrase)}(?=$|[\\s,.;:!?()\\-–/])`,
    'i'
  );
  return re.test(normalizedText);
}

function capitalizeFirst(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): Date {
  const copy = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getReadyApp(appId: AppId) {
  const app = APP_REGISTRY.find((item) => item.id === appId);
  if (!app || app.status !== 'ready') return null;
  return app;
}

interface SubjectRule {
  shortName: string;
  canonical: string;
  aliases: string[];
  shortBeforeGradeAliases?: string[];
}

const SUBJECT_RULES: SubjectRule[] = [
  {
    shortName: 'Toán',
    canonical: 'Toán học',
    aliases: ['toan hoc', 'giai tich', 'hinh hoc', 'dai so', 'toan'],
    shortBeforeGradeAliases: ['toan'],
  },
  {
    shortName: 'Văn',
    canonical: 'Ngữ văn',
    aliases: ['ngu van', 'van hoc', 'van'],
    shortBeforeGradeAliases: ['van'],
  },
  {
    shortName: 'Tiếng Anh',
    canonical: 'Tiếng Anh',
    aliases: ['tieng anh', 'anh van', 'english'],
    shortBeforeGradeAliases: ['anh'],
  },
  {
    shortName: 'Vật lí',
    canonical: 'Vật lí',
    aliases: ['vat li', 'vat ly'],
    shortBeforeGradeAliases: ['li', 'ly'],
  },
  {
    shortName: 'Hóa học',
    canonical: 'Hóa học',
    aliases: ['hoa hoc'],
    shortBeforeGradeAliases: ['hoa'],
  },
  {
    shortName: 'Sinh học',
    canonical: 'Sinh học',
    aliases: ['sinh hoc'],
    shortBeforeGradeAliases: ['sinh'],
  },
  {
    shortName: 'KHTN',
    canonical: 'Khoa học tự nhiên',
    aliases: ['khoa hoc tu nhien', 'khtn'],
  },
  {
    shortName: 'Lịch sử',
    canonical: 'Lịch sử',
    aliases: ['lich su'],
    shortBeforeGradeAliases: ['su'],
  },
  {
    shortName: 'Địa lí',
    canonical: 'Địa lí',
    aliases: ['dia li', 'dia ly'],
    shortBeforeGradeAliases: ['dia'],
  },
  {
    shortName: 'Tin học',
    canonical: 'Tin học',
    aliases: ['tin hoc'],
    shortBeforeGradeAliases: ['tin'],
  },
  {
    shortName: 'GDCD',
    canonical: 'GDCD',
    aliases: ['gdcd', 'giao duc cong dan', 'ktpl', 'kinh te phap luat'],
  },
  {
    shortName: 'Công nghệ',
    canonical: 'Công nghệ',
    aliases: ['cong nghe'],
  },
];

function extractSubjectAndGrade(normalizedText: string): {
  subject: ParsedSubjectInfo;
  grade: ParsedGradeInfo;
} {
  let subject: ParsedSubjectInfo = {
    value: null,
    canonical: null,
    confidence: 0,
  };
  let grade: ParsedGradeInfo = {
    value: null,
    label: null,
    confidence: 0,
  };

  for (const rule of SUBJECT_RULES) {
    if (rule.shortBeforeGradeAliases) {
      for (const shortAlias of rule.shortBeforeGradeAliases) {
        const re = new RegExp(
          `(?:^|[\\s,.;:!?()\\-–/])${escapeRegExp(shortAlias)}\\s+(1[0-2]|[1-9])(?=$|[\\s,.;:!?()\\-–/])`,
          'i'
        );
        const match = normalizedText.match(re);
        if (match) {
          const gradeNum = Number(match[1]);
          subject = {
            value: rule.shortName,
            canonical: rule.canonical,
            confidence: 0.96,
            sourceText: match[0].trim(),
          };
          grade = {
            value: gradeNum,
            label: `Lớp ${gradeNum}`,
            confidence: 0.96,
            sourceText: match[0].trim(),
          };
          break;
        }
      }
    }
    if (subject.value) break;
  }

  if (!subject.value) {
    for (const rule of SUBJECT_RULES) {
      for (const alias of rule.aliases) {
        if (containsWholePhrase(normalizedText, alias)) {
          subject = {
            value: rule.shortName,
            canonical: rule.canonical,
            confidence: alias.length > 3 ? 0.94 : 0.85,
            sourceText: alias,
          };
          break;
        }
      }
      if (subject.value) break;
    }
  }

  if (grade.value === null) {
    const gradeMatch = normalizedText.match(
      /(?:^|[\s,.;:!?()\-–/])(?:lop|khoi)\s+(1[0-2]|[1-9])(?:[a-z]\d*)?(?=$|[\s,.;:!?()\-–/])/i
    );
    if (gradeMatch) {
      const gradeNum = Number(gradeMatch[1]);
      grade = {
        value: gradeNum,
        label: `Lớp ${gradeNum}`,
        confidence: 0.95,
        sourceText: gradeMatch[0].trim(),
      };
    } else if (containsWholePhrase(normalizedText, 'thpt')) {
      grade = { value: null, label: 'THPT', confidence: 0.8, sourceText: 'thpt' };
    } else if (containsWholePhrase(normalizedText, 'thcs')) {
      grade = { value: null, label: 'THCS', confidence: 0.8, sourceText: 'thcs' };
    } else if (containsWholePhrase(normalizedText, 'tieu hoc')) {
      grade = {
        value: null,
        label: 'Tiểu học',
        confidence: 0.8,
        sourceText: 'tieu hoc',
      };
    }
  }

  return { subject, grade };
}

const WEEKDAY_SPECS: Array<{ re: RegExp; dayOfWeek: number; label: string }> = [
  { re: /(?:^|[\s,.;:!?()\-–/])(chu nhat|cn)(?=$|[\s,.;:!?()\-–/])/i, dayOfWeek: 0, label: 'Chủ nhật' },
  { re: /(?:^|[\s,.;:!?()\-–/])thu\s*(hai|2)(?=$|[\s,.;:!?()\-–/])/i, dayOfWeek: 1, label: 'Thứ Hai' },
  { re: /(?:^|[\s,.;:!?()\-–/])thu\s*(ba|3)(?=$|[\s,.;:!?()\-–/])/i, dayOfWeek: 2, label: 'Thứ Ba' },
  { re: /(?:^|[\s,.;:!?()\-–/])thu\s*(tu|bon|4)(?=$|[\s,.;:!?()\-–/])/i, dayOfWeek: 3, label: 'Thứ Tư' },
  { re: /(?:^|[\s,.;:!?()\-–/])thu\s*(nam|5)(?=$|[\s,.;:!?()\-–/])/i, dayOfWeek: 4, label: 'Thứ Năm' },
  { re: /(?:^|[\s,.;:!?()\-–/])thu\s*(sau|6)(?=$|[\s,.;:!?()\-–/])/i, dayOfWeek: 5, label: 'Thứ Sáu' },
  { re: /(?:^|[\s,.;:!?()\-–/])thu\s*(bay|7)(?=$|[\s,.;:!?()\-–/])/i, dayOfWeek: 6, label: 'Thứ Bảy' },
];

function extractDeadline(
  rawText: string,
  normalizedText: string,
  referenceDate: Date
): ParsedDeadlineInfo {
  let timeHint: string | undefined;
  const clockMatch = rawText.match(/(?:^|\s)(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?=$|[\s,.;!?])/i);
  if (clockMatch) {
    const hh = Number(clockMatch[1]);
    const mm = Number(clockMatch[2] ?? '0');
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      timeHint = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  } else if (containsWholePhrase(normalizedText, 'buoi sang')) {
    timeHint = 'Buổi sáng';
  } else if (containsWholePhrase(normalizedText, 'buoi chieu')) {
    timeHint = 'Buổi chiều';
  } else if (containsWholePhrase(normalizedText, 'buoi toi')) {
    timeHint = 'Buổi tối';
  }

  // 1. Explicit numeric date dd/mm/yyyy or dd/mm
  const explicitDateMatch = normalizedText.match(
    /(?:^|[\s,.;:!?()\-–])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?=$|[\s,.;:!?()\-–])/
  );
  if (explicitDateMatch) {
    const day = Number(explicitDateMatch[1]);
    const month = Number(explicitDateMatch[2]);
    const rawYear = explicitDateMatch[3];
    const year = rawYear
      ? rawYear.length === 2
        ? 2000 + Number(rawYear)
        : Number(rawYear)
      : referenceDate.getFullYear();

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const candidate = new Date(year, month - 1, day);
      if (candidate.getDate() === day && candidate.getMonth() === month - 1) {
        if (!rawYear) {
          return {
            isoDate: null,
            text: explicitDateMatch[0].trim(),
            timeHint,
            needsConfirmation: true,
            confidence: 0.72,
            ambiguityReason: `Ngày "${explicitDateMatch[0].trim()}" chưa ghi rõ năm.`,
          };
        }
        return {
          isoDate: formatIsoDate(candidate),
          text: explicitDateMatch[0].trim(),
          timeHint,
          needsConfirmation: false,
          confidence: 0.96,
        };
      }
    }
  }

  // 2. Unambiguous relative day keywords
  if (containsWholePhrase(normalizedText, 'hom nay')) {
    return {
      isoDate: formatIsoDate(addDays(referenceDate, 0)),
      text: 'hôm nay',
      timeHint,
      needsConfirmation: false,
      confidence: 0.95,
    };
  }
  if (
    containsWholePhrase(normalizedText, 'ngay mai') ||
    containsWholePhrase(normalizedText, 'sang mai') ||
    containsWholePhrase(normalizedText, 'chieu mai') ||
    containsWholePhrase(normalizedText, 'toi mai')
  ) {
    return {
      isoDate: formatIsoDate(addDays(referenceDate, 1)),
      text: 'ngày mai',
      timeHint,
      needsConfirmation: false,
      confidence: 0.95,
    };
  }
  if (
    containsWholePhrase(normalizedText, 'ngay kia') ||
    containsWholePhrase(normalizedText, 'ngay mot')
  ) {
    return {
      isoDate: formatIsoDate(addDays(referenceDate, 2)),
      text: 'ngày kia',
      timeHint,
      needsConfirmation: false,
      confidence: 0.9,
    };
  }

  // 3. Weekday phrase ("thứ Sáu", "thứ Sáu tuần này", "thứ Sáu tuần sau")
  for (const spec of WEEKDAY_SPECS) {
    const matched = normalizedText.match(spec.re);
    if (!matched) continue;

    const hasThisWeek = containsWholePhrase(normalizedText, 'tuan nay');
    const hasNextWeek =
      containsWholePhrase(normalizedText, 'tuan sau') ||
      containsWholePhrase(normalizedText, 'tuan toi');

    if (hasThisWeek || hasNextWeek) {
      const refDow = referenceDate.getDay();
      let delta = (spec.dayOfWeek - refDow + 7) % 7;
      if (hasNextWeek) {
        const daysToNextMonday = refDow === 0 ? 1 : 8 - refDow;
        const offsetFromMon = spec.dayOfWeek === 0 ? 6 : spec.dayOfWeek - 1;
        delta = daysToNextMonday + offsetFromMon;
      }
      return {
        isoDate: formatIsoDate(addDays(referenceDate, delta)),
        text: `${spec.label} ${hasNextWeek ? 'tuần sau' : 'tuần này'}`.trim(),
        weekdayText: spec.label,
        timeHint,
        needsConfirmation: false,
        confidence: 0.9,
      };
    }

    // Bare weekday without week context -> NEVER guess an ISO calendar date
    const rawPhraseMatch = rawText.match(
      /(?:chủ\s+nhật|chu\s+nhat|thứ\s+(?:hai|ba|tư|bốn|năm|sáu|bảy|2|3|4|5|6|7)|thu\s+(?:hai|ba|tu|bon|nam|sau|bay|2|3|4|5|6|7))/i
    );
    return {
      isoDate: null,
      text: rawPhraseMatch ? rawPhraseMatch[0] : spec.label,
      weekdayText: spec.label,
      timeHint,
      needsConfirmation: true,
      confidence: 0.45,
      ambiguityReason: `Mốc "${rawPhraseMatch ? rawPhraseMatch[0] : spec.label}" chưa nêu rõ thuộc tuần này hay tuần sau nên hệ thống không tự suy đoán ngày cụ thể.`,
    };
  }

  if (
    containsWholePhrase(normalizedText, 'tuan sau') ||
    containsWholePhrase(normalizedText, 'tuan toi')
  ) {
    return {
      isoDate: null,
      text: 'tuần sau',
      timeHint,
      needsConfirmation: true,
      confidence: 0.4,
      ambiguityReason: 'Chỉ nêu "tuần sau" nhưng chưa rõ thứ hoặc ngày cụ thể.',
    };
  }

  return {
    isoDate: null,
    text: null,
    timeHint,
    needsConfirmation: false,
    confidence: 0,
  };
}

function extractQuantities(rawText: string): ParsedQuantity[] {
  const results: ParsedQuantity[] = [];
  const norm = normalizeVietnamese(rawText);
  const unitMap: Array<{ pattern: RegExp; canonicalUnit: string; normalizedUnit: string }> = [
    { pattern: /ma\s+de/i, canonicalUnit: 'mã đề', normalizedUnit: 'ma de' },
    { pattern: /de\s+thi|de\s+kiem\s+tra/i, canonicalUnit: 'đề thi', normalizedUnit: 'de thi' },
    { pattern: /phieu\s+hoc\s+tap/i, canonicalUnit: 'phiếu học tập', normalizedUnit: 'phieu hoc tap' },
    { pattern: /phieu/i, canonicalUnit: 'phiếu', normalizedUnit: 'phieu' },
    { pattern: /cau\s+hoi/i, canonicalUnit: 'câu hỏi', normalizedUnit: 'cau hoi' },
    { pattern: /cau/i, canonicalUnit: 'câu', normalizedUnit: 'cau' },
    { pattern: /tiet/i, canonicalUnit: 'tiết', normalizedUnit: 'tiet' },
    { pattern: /buoi/i, canonicalUnit: 'buổi', normalizedUnit: 'buoi' },
    { pattern: /phut/i, canonicalUnit: 'phút', normalizedUnit: 'phut' },
    { pattern: /bai/i, canonicalUnit: 'bài', normalizedUnit: 'bai' },
    { pattern: /ban\s+in/i, canonicalUnit: 'bản in', normalizedUnit: 'ban in' },
    { pattern: /nhom/i, canonicalUnit: 'nhóm', normalizedUnit: 'nhom' },
    { pattern: /hoc\s+sinh/i, canonicalUnit: 'học sinh', normalizedUnit: 'hoc sinh' },
    { pattern: /rubric/i, canonicalUnit: 'rubric', normalizedUnit: 'rubric' },
    { pattern: /de/i, canonicalUnit: 'đề', normalizedUnit: 'de' },
  ];

  const regex =
    /(?:^|[\s,.;:!?()\-–])(\d+)\s+(ma\s+de|de\s+thi|de\s+kiem\s+tra|de|cau\s+hoi|cau|phieu\s+hoc\s+tap|phieu|tiet|buoi|phut|bai|ban\s+in|nhom|hoc\s+sinh|rubric)(?=$|[\s,.;:!?()\-–])/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(norm)) !== null) {
    const value = Number(match[1]);
    const matchedUnit = match[2].replace(/\s+/g, ' ').trim();
    const spec = unitMap.find((u) => u.pattern.test(matchedUnit));
    const displayUnit = spec ? spec.canonicalUnit : matchedUnit;
    const normalizedUnit = spec ? spec.normalizedUnit : matchedUnit;
    const raw = `${value} ${displayUnit}`;
    if (!results.some((q) => normalizeVietnamese(q.raw) === normalizeVietnamese(raw))) {
      results.push({ raw, value, unit: displayUnit, normalizedUnit });
    }
  }
  return results;
}

export function classifyWorkCategoryV2(text: string): WorkCategoryV2 {
  const norm = normalizeVietnamese(text);
  if (!norm) return 'unclassified';

  // Review verbs first (excluding exam nouns like "kiểm tra Toán 12", "kiểm tra 45 phút")
  const withoutExamNoun = norm.replace(
    /kiem tra\s+(?:toan|ngu van|van|tieng anh|anh|vat li|vat ly|hoa|sinh|su|dia|tin|khtn|gdcd|\d+\s*phut|1\s*tiet|giua\s*k[yi]|cuoi\s*k[yi]|hoc\s*k[yi])/g,
    ''
  );
  if (
    /^(?:kiem tra|ra soat|doi chieu|duyet|tham dinh|xac nhan|chinh sua|danh gia lai)(?=$|\s)/.test(
      withoutExamNoun
    )
  ) {
    return 'review';
  }

  if (
    /^(?:in|xuat pdf|xuat ban|nop|ban giao|hoan thanh|hoan tat|ket thuc|tong ket|luu tru)(?=$|\s)/.test(
      norm
    )
  ) {
    return 'complete';
  }

  if (
    /^(?:chuan bi|soan|tim|suu tam|thu thap|thiet ke|tao|xay dung|lap ke hoach|viet|len khung)(?=$|\s)/.test(
      norm
    )
  ) {
    return 'prepare';
  }

  if (
    /^(?:tron|sinh ma|to chuc|trien khai|giang day|day|trinh bay|thuc hien|thao luan|huong dan|cham|ghi)(?=$|\s)/.test(
      norm
    )
  ) {
    return 'execute';
  }

  if (
    /(?:^|\s)(?:kiem tra|ra soat|doi chieu|duyet|tham dinh|xac nhan)(?=$|\s)/.test(
      withoutExamNoun
    )
  ) {
    return 'review';
  }

  if (
    /(?:^|\s)(?:in de|in tai lieu|in phieu|in a4|xuat pdf|nop|ban giao|hoan thanh|hoan tat|tong ket)(?=$|\s)/.test(
      norm
    )
  ) {
    return 'complete';
  }

  if (
    /(?:^|\s)(?:tron|sinh ma|to chuc|trien khai|giang day|day hoc|thuc hien|cham bai|ghi nhat ky)(?=$|\s)/.test(
      norm
    )
  ) {
    return 'execute';
  }

  if (
    /(?:^|\s)(?:soan|chuan bi|tim|thiet ke|xay dung|tao phieu|tao de|lap ke hoach)(?=$|\s)/.test(
      norm
    )
  ) {
    return 'prepare';
  }

  return 'unclassified';
}

export function categoryToGroupInfo(category: WorkCategoryV2): {
  key: WorkflowGroupKey;
  title: string;
  order: number;
} {
  switch (category) {
    case 'prepare':
      return { key: 'preparation', title: 'Chuẩn bị & Thiết kế', order: 1 };
    case 'review':
      return { key: 'verification', title: 'Kiểm tra & Rà soát', order: 2 };
    case 'execute':
      return { key: 'execution', title: 'Thực hiện & Triển khai', order: 3 };
    case 'complete':
      return { key: 'completion', title: 'Hoàn tất & Xuất bản', order: 4 };
    default:
      return { key: 'general', title: 'Công việc chung', order: 5 };
  }
}

export function extractActionObjectSemantics(text: string): {
  verbAction: string;
  objectTarget: string;
  canonicalConcept: string;
} {
  const norm = normalizeVietnamese(text);
  const withoutExamAdjective = norm.replace(/\bkiem tra\b/g, (m, offset) => {
    const before = norm.slice(0, offset).trim();
    if (/(?:de|bai|chuan bi|lich)$/.test(before)) return 'exam_type';
    return m;
  });

  let verbAction = 'general';
  if (/^(?:soan|chuan bi|tao|ra|viet|xay dung|lap)\b/.test(withoutExamAdjective) || /\b(?:soan|chuan bi|tao|xay dung)\b/.test(withoutExamAdjective)) {
    verbAction = 'prepare_create';
  }
  if (/^(?:tron|sinh ma|dao)\b/.test(norm) || /\b(?:tron|sinh ma|xao tron)\b/.test(norm)) {
    verbAction = 'mix_shuffle';
  }
  if (/^(?:kiem tra|ra soat|doi chieu|duyet|tham dinh|xac nhan)\b/.test(withoutExamAdjective)) {
    verbAction = 'review_check';
  }
  if (/^(?:in|xuat pdf|xuat ban|photo)\b/.test(norm) || /\b(?:in de|in tai lieu|in phieu|in a4|xuat pdf)\b/.test(norm)) {
    verbAction = 'print_publish';
  }
  if (/^(?:tim|suu tam|thu thap|chon|tai)\b/.test(norm)) {
    verbAction = 'find_collect';
  }
  if (/^(?:thiet ke|xay dung hoat dong)\b/.test(norm)) {
    verbAction = 'design_create';
  }
  if (/^(?:to chuc|trien khai|giang day|day|cham|ghi)\b/.test(norm)) {
    verbAction = 'execute_deliver';
  }

  let objectTarget = 'generic';
  if (/\b(?:dap an|loi giai|huong dan cham|bieu diem)\b/.test(norm)) {
    objectTarget = 'answer_key';
  } else if (/\b(?:phieu hoc tap|phieu bai tap|phieu)\b/.test(norm)) {
    objectTarget = 'worksheet';
  } else if (/\b(?:ngu lieu|hoc lieu|tai lieu|tu lieu|van ban)\b/.test(norm)) {
    // Distinguish "in tai lieu" vs "tim ngu lieu / tai lieu"
    if (verbAction === 'print_publish') {
      objectTarget = 'document_print';
    } else {
      objectTarget = 'resource_material';
    }
  } else if (/\b(?:hoat dong|tinh huong|tro choi)\b/.test(norm)) {
    objectTarget = 'activity';
  } else if (/\b(?:rubric|tieu chi danh gia)\b/.test(norm)) {
    objectTarget = 'rubric';
  } else if (/\b(?:giao an|bai day|tiet day)\b/.test(norm)) {
    objectTarget = 'lesson_plan';
  } else if (/\b(?:ma de|de kiem tra|de thi|de)\b/.test(norm)) {
    objectTarget = 'exam';
  } else if (/\b(?:nhat ky|kinh nghiem)\b/.test(norm)) {
    objectTarget = 'journal';
  }

  // "tạo phiếu học tập" and "thiết kế phiếu học tập" share design_create/prepare_create nuances cleanly
  if (objectTarget === 'worksheet' && (verbAction === 'prepare_create' || verbAction === 'design_create')) {
    verbAction = 'create_build';
  }

  return {
    verbAction,
    objectTarget,
    canonicalConcept: `${verbAction}:${objectTarget}`,
  };
}

export function inferTeacherOSAppLink(
  taskText: string,
  context: { subjectCanonical?: string | null; fullInputNorm?: string } = {}
): { appId?: AppId; appName?: string } {
  const norm = normalizeVietnamese(taskText);
  const fullNorm = context.fullInputNorm ?? '';
  const isMathOrExamCodes =
    context.subjectCanonical === 'Toán học' ||
    /(?:^|\s)(?:toan|ma de|tron \d* ?ma de|latex|katex)(?=$|\s)/.test(fullNorm);

  let candidateId: AppId | null = null;

  if (
    /(?:tron\s+\d*\s*ma\s+de|tron\s+de|sinh\s+ma\s+de|math\s+lock)/.test(norm) ||
    (isMathOrExamCodes && /(?:kiem tra dap an|ra soat dap an|dap an ma de)/.test(norm))
  ) {
    candidateId = 'math-mixer';
  } else if (
    /(?:^|\s)(?:in\s+de|in\s+tai\s+lieu|in\s+phieu|in\s+a4|xuat\s+pdf|ban\s+in|in)(?=$|\s)/.test(
      norm
    )
  ) {
    candidateId = 'print-studio';
  } else if (
    /(?:tim\s+ngu\s+lieu|ngu\s+lieu|tim\s+tai\s+lieu|tim\s+hoc\s+lieu|hoc\s+lieu|tu\s+lieu|ngan\s+hang\s+cau\s+hoi|tai\s+lieu\s+tham\s+khao)/.test(
      norm
    )
  ) {
    candidateId = 'resource-vault';
  } else if (
    /(?:nhat\s+ky|ghi\s+nhan\s+kinh\s+nghiem|rut\s+kinh\s+nghiem)/.test(norm)
  ) {
    candidateId = 'teaching-journal';
  } else if (
    /(?:soan\s+de|chuan\s+bi\s+de|tao\s+de|soan\s+bai|soan\s+giao\s+an|giao\s+an|phieu\s+hoc\s+tap|tao\s+phieu|soan\s+phieu|rubric|thiet\s+ke\s+hoat\s+dong|hoat\s+dong)/.test(
      norm
    )
  ) {
    candidateId = 'lesson-studio';
  } else if (/(?:quy\s+trinh|tien\s+do|dieu\s+phoi)/.test(norm)) {
    candidateId = 'workflow-center';
  }

  if (!candidateId) return {};
  const ready = getReadyApp(candidateId);
  if (!ready) return {};
  return { appId: ready.id, appName: ready.name };
}

function stripTemporalFragments(text: string): string {
  return text
    .replace(
      /(?:^|\s)(?:vào|vao)?\s*(?:hôm\s+nay|hom\s+nay|ngày\s+mai|ngay\s+mai|ngày\s+kia|ngay\s+kia|tuần\s+này|tuan\s+nay|tuần\s+sau|tuan\s+sau|tuần\s+tới|tuan\s+toi)(?=$|[\s,.;!?])/gi,
      ' '
    )
    .replace(
      /(?:^|\s)(?:vào|vao)?\s*(?:thứ|thu)\s+(?:hai|ba|tư|tu|bốn|bon|năm|nam|sáu|sau|bảy|bay|2|3|4|5|6|7)(?:\s+(?:tuần|tuan)\s+(?:này|nay|sau|tới|toi))?(?=$|[\s,.;!?])/gi,
      ' '
    )
    .replace(
      /(?:^|\s)(?:vào|vao)?\s*(?:chủ\s+nhật|chu\s+nhat)(?:\s+(?:tuần|tuan)\s+(?:này|nay|sau|tới|toi))?(?=$|[\s,.;!?])/gi,
      ' '
    )
    .replace(/(?:^|\s)(?:trước|truoc|vào|vao|ngày|ngay)?\s*\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?(?=$|[\s,.;!?])/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,.\s:;-]+|[,.\s:;-]+$/g, '')
    .trim();
}

function stripSubjectModalLead(text: string): string {
  return text
    .trim()
    .replace(
      /^(?:hãy|hay\s+)?(?:tôi|toi|mình|minh|em|thầy|thay|cô|co|chúng\s+ta|chung\s+ta)\s+(?:cần|can|muốn|muon|sẽ|se|phải|phai|nên|nen)\s+/i,
      ''
    )
    .replace(/^(?:phải|phai|cần|can|nên|nen)\s+/i, '')
    .replace(/[:.。]+$/g, '')
    .trim();
}

function extractLeadingSequentialCue(text: string): {
  cleaned: string;
  cue?: string;
} {
  const working = text.trim().replace(/^[.,;:\-–•*]+\s*/, '');
  const patterns: Array<{ re: RegExp; cue: string }> = [
    { re: /^(?:và\s+|va\s+)?(?:cuối\s+cùng|cuoi\s+cung)(?:\s+(?:là|la))?[:,]?\s+/i, cue: 'cuối cùng' },
    { re: /^(?:và\s+|va\s+)?(?:sau\s+đó|sau\s+do)(?:\s+(?:thì|thi))?[:,]?\s+/i, cue: 'sau đó' },
    { re: /^(?:và\s+|va\s+)?(?:tiếp\s+theo|tiep\s+theo)(?:\s+(?:là|la))?[:,]?\s+/i, cue: 'tiếp theo' },
    { re: /^(?:và\s+|va\s+)?(?:kế\s+tiếp|ke\s+tiep)(?:\s+(?:là|la))?[:,]?\s+/i, cue: 'kế tiếp' },
    { re: /^(?:và\s+|va\s+)?(?:rồi|roi)(?:\s+(?:mới|moi))?[:,]?\s+/i, cue: 'rồi' },
    { re: /^(?:trước\s+hết|truoc\s+het|trước\s+tiên|truoc\s+tien)[:,]?\s+/i, cue: 'trước hết' },
  ];

  for (const p of patterns) {
    if (p.re.test(working)) {
      return {
        cleaned: working.replace(p.re, '').trim(),
        cue: p.cue,
      };
    }
  }
  return { cleaned: working };
}

interface NegationExtractionResult {
  negations: NegationConstraint[];
  nonNegatedSegments: string[];
}

const NEGATION_PATTERNS: Array<{ re: RegExp; cue: string }> = [
  { re: /^(?:nhưng\s+|nhung\s+|và\s+|va\s+)?(?:không\s+cần|khong\s+can)\s+(.+)$/i, cue: 'không cần' },
  { re: /^(?:nhưng\s+|nhung\s+|và\s+|va\s+)?(?:chưa\s+cần|chua\s+can)\s+(.+)$/i, cue: 'chưa cần' },
  { re: /^(?:nhưng\s+|nhung\s+|và\s+|va\s+)?(?:không\s+phải|khong\s+phai)\s+(.+)$/i, cue: 'không phải' },
  { re: /^(?:nhưng\s+|nhung\s+|và\s+|va\s+)?(?:bỏ\s+qua|bo\s+qua)\s+(.+)$/i, cue: 'bỏ qua' },
  { re: /^(?:nhưng\s+|nhung\s+|và\s+|va\s+)?(?:khỏi\s+cần|khoi\s+can|khỏi|khoi)\s+(.+)$/i, cue: 'khỏi cần' },
  { re: /^(?:nhưng\s+|nhung\s+|và\s+|va\s+)?(?:trừ|tru)\s+(?:việc\s+|viec\s+)?(.+)$/i, cue: 'trừ' },
  { re: /^(?:nhưng\s+|nhung\s+|và\s+|va\s+)?(?:không|khong)\s+(?!ngừng|ngung|bao\s+gồm)(.+)$/i, cue: 'không' },
];

function extractNegationConstraintsFromSentences(sentences: string[]): NegationExtractionResult {
  const negations: NegationConstraint[] = [];
  const nonNegatedSegments: string[] = [];
  let negCounter = 1;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Check inline negation clause like "soạn đề, không cần trộn mã đề" or "soạn đề nhưng không cần trộn mã đề"
    const inlineSplit = trimmed.match(
      /^(.+?)(?:,\s*|\s+(?:nhưng|nhung)\s+)((?:không\s+cần|khong\s+can|chưa\s+cần|chua\s+can|không\s+phải|khong\s+phai|bỏ\s+qua|bo\s+qua|khỏi\s+cần|khoi\s+can|không\s+(?:trộn|in|tạo|làm|chấm)|khong\s+(?:tron|in|tao|lam|cham)).+)$/i
    );

    if (inlineSplit) {
      nonNegatedSegments.push(inlineSplit[1].trim());
      const negPart = inlineSplit[2].trim();
      const matchedNeg = parseSingleNegation(negPart, `neg-${negCounter++}`);
      if (matchedNeg) {
        negations.push(matchedNeg);
      }
      continue;
    }

    const wholeNeg = parseSingleNegation(trimmed, `neg-${negCounter}`);
    if (wholeNeg) {
      negCounter++;
      negations.push(wholeNeg);
      continue;
    }

    nonNegatedSegments.push(trimmed);
  }

  return { negations, nonNegatedSegments };
}

function parseSingleNegation(segment: string, id: string): NegationConstraint | null {
  const clean = segment.replace(/[.。]+$/g, '').trim();
  for (const spec of NEGATION_PATTERNS) {
    const m = clean.match(spec.re);
    if (m) {
      const actionPhrase = m[1]
        .replace(/^(?:việc|viec|bước|buoc)\s+/i, '')
        .trim();
      if (!actionPhrase) continue;
      const sem = extractActionObjectSemantics(actionPhrase);
      return {
        id,
        rawText: clean,
        actionPhrase,
        canonicalConcept:
          sem.verbAction !== 'general' || sem.objectTarget !== 'generic'
            ? sem.canonicalConcept
            : null,
        negationCue: spec.cue,
        confidence: 0.95,
      };
    }
  }
  return null;
}

interface RawTaskFragment {
  text: string;
  subSteps: string[];
  explicitOrderCue?: string;
  explicitPrecedesNext?: boolean;
  explicitAfterPrev?: boolean;
}

function splitConnectorClause(clause: string): RawTaskFragment[] {
  const trimmed = clause.trim();
  if (!trimmed) return [];

  // Handle "A trước khi B" cleanly
  const beforeMatch = trimmed.match(/^(.+?)\s+(?:trước\s+khi|truoc\s+khi)\s+(.+)$/i);
  if (beforeMatch) {
    const leftParts = splitConnectorClause(beforeMatch[1]);
    const rightParts = splitConnectorClause(beforeMatch[2]);
    if (leftParts.length > 0 && rightParts.length > 0) {
      leftParts[leftParts.length - 1].explicitPrecedesNext = true;
      rightParts[0].explicitAfterPrev = true;
      rightParts[0].explicitOrderCue = rightParts[0].explicitOrderCue ?? 'trước khi';
    }
    return [...leftParts, ...rightParts];
  }

  // Split sequential markers even when not preceded by a comma ("trộn 4 mã đề rồi in đề")
  const seqMarked = trimmed.replace(
    /,?\s+(sau\s+đó|sau\s+do|tiếp\s+theo|tiep\s+theo|kế\s+tiếp|ke\s+tiep|cuối\s+cùng|cuoi\s+cung|rồi|roi)(?=\s|$)/gi,
    '\n$1'
  );
  const chunks = seqMarked
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const output: RawTaskFragment[] = [];

  for (const chunk of chunks) {
    const leadInfo = extractLeadingSequentialCue(chunk);
    const hasSeqLead = Boolean(leadInfo.cue);

    // Split comma-separated items inside chunk
    const commaChunks = leadInfo.cleaned
      .replace(/,\s*(?:và|va|&)\s+/gi, '\n')
      .replace(/,\s+/g, '\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    commaChunks.forEach((commaChunk, idx) => {
      // Split "X và Y" if both sides represent distinct task phrases
      const vaMatch = commaChunk.match(/^(.+?)\s+(?:và|va)\s+(.+)$/i);
      if (vaMatch) {
        const left = vaMatch[1].trim();
        const right = vaMatch[2].trim();
        const rightCat = classifyWorkCategoryV2(right);
        const leftCat = classifyWorkCategoryV2(left);
        const rightLooksAction =
          rightCat !== 'unclassified' ||
          /^(?:in|soan|tron|kiem|tim|tao|lam|chuan|thiet|gui|nop|duyet|ghi|cham)\b/i.test(
            normalizeVietnamese(right)
          );
        const leftLooksAction =
          leftCat !== 'unclassified' || left.split(/\s+/).length >= 2;

        if (leftLooksAction && rightLooksAction) {
          output.push({
            text: left,
            subSteps: [],
            explicitOrderCue: idx === 0 ? leadInfo.cue : undefined,
            explicitAfterPrev: idx === 0 && hasSeqLead,
          });
          output.push({
            text: right,
            subSteps: [],
          });
          return;
        }
      }

      output.push({
        text: commaChunk,
        subSteps: [],
        explicitOrderCue: idx === 0 ? leadInfo.cue : undefined,
        explicitAfterPrev: idx === 0 && hasSeqLead,
      });
    });
  }

  return output;
}

function isSentenceLikelyGoalLeadIn(
  firstSentence: string,
  remainingNonNegatedSentences: string[]
): boolean {
  if (remainingNonNegatedSentences.length === 0) return false;
  const remainingTasksCount = remainingNonNegatedSentences.reduce(
    (acc, sent) => acc + splitConnectorClause(sent).length,
    0
  );
  if (remainingTasksCount < 2) return false;

  // Check if sentence 1 itself contains multiple tasks (e.g., Test 3: "Tôi cần soạn đề, chuẩn bị đề kiểm tra, rồi in đề.")
  const firstParts = splitConnectorClause(firstSentence);
  if (firstParts.length >= 2) return false;

  const norm = normalizeVietnamese(stripTemporalFragments(stripSubjectModalLead(firstSentence)));
  return (
    /^(?:chuan bi|lap ke hoach|ke hoach|muc tieu|to chuc|xay dung|on tap|du an)\b/.test(
      norm
    ) ||
    /(?:^|\s)(?:kiem tra|tiet day|bai day|chuyen de|ngoai khoa)\b/.test(norm)
  );
}

function isLikelyMeaningfulVietnamese(text: string): boolean {
  const norm = normalizeVietnamese(text);
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1 && !/[aeiouy]/.test(words[0])) return false;

  const hasDomainSignal =
    classifyWorkCategoryV2(text) !== 'unclassified' ||
    Boolean(inferTeacherOSAppLink(text).appId) ||
    Boolean(extractSubjectAndGrade(norm).subject.value) ||
    /\b(?:bai|tiet|lop|de|phieu|hoc|sinh|giao|vien|chuyen|mon|hop|ke|hoach|on|tap|kiem|tra|thi|du|an|chu|de|ngoai|khoa|hoat|dong)\b/.test(
      norm
    );
  if (hasDomainSignal) return true;
  const realWords = words.filter((w) => w.length >= 2 && /[aeiouy]/.test(w));
  return realWords.length >= 2;
}

function isTaskExcludedByNegation(
  taskNorm: string,
  taskConcept: string,
  negations: NegationConstraint[]
): boolean {
  for (const neg of negations) {
    const negActionNorm = normalizeVietnamese(neg.actionPhrase);
    if (!negActionNorm) continue;
    if (
      taskNorm === negActionNorm ||
      taskNorm.includes(negActionNorm) ||
      negActionNorm.includes(taskNorm)
    ) {
      return true;
    }
    if (neg.canonicalConcept && neg.canonicalConcept === taskConcept) {
      // Be careful: e.g. negation "trộn mã đề" (`mix_shuffle:exam`) excludes `mix_shuffle:exam`,
      // NOT `prepare_create:exam` or `print_publish:exam`!
      return true;
    }
  }
  return false;
}

function buildOptionalSuggestions(normInput: string): OptionalTemplateSuggestion[] {
  const suggestions: OptionalTemplateSuggestion[] = [
    {
      id: 'tpl-extracurricular',
      title: 'Kế hoạch tổ chức hoạt động ngoại khóa (Gợi ý)',
      subtitle: 'Xác định mục tiêu & đối tượng → Xin duyệt kế hoạch & dự trù → Phân công & chuẩn bị vật tư → Tổng kết.',
      badgeLabel: 'Gợi ý bổ sung',
      isOptionalSuggestion: true,
      suggestedSteps: [
        { title: 'Xác định mục tiêu, thời gian & đối tượng học sinh', category: 'prepare', linkedAppId: 'workflow-center' },
        { title: 'Lập kế hoạch chi tiết & dự trù kinh phí', category: 'prepare', linkedAppId: 'lesson-studio' },
        { title: 'Phân công giáo viên phụ trách & kiểm tra điều kiện an toàn', category: 'review', linkedAppId: 'workflow-center' },
        { title: 'Tổ chức hoạt động & ghi nhận tổng kết', category: 'complete', linkedAppId: 'teaching-journal' },
      ],
    },
    {
      id: 'tpl-lesson-45-90',
      title: 'Chuẩn bị tiết dạy 45/90p & Phiếu A/B/C',
      subtitle: 'Tìm học liệu → Thiết kế hoạt động → Tạo phiếu & rubric → In tài liệu.',
      badgeLabel: 'Gợi ý bổ sung',
      isOptionalSuggestion: true,
      suggestedSteps: [
        { title: 'Tìm học liệu & ngữ liệu minh họa', category: 'prepare', linkedAppId: 'resource-vault' },
        { title: 'Thiết kế tiến trình hoạt động bài dạy', category: 'prepare', linkedAppId: 'lesson-studio' },
        { title: 'Tạo phiếu học tập & rubric đánh giá', category: 'prepare', linkedAppId: 'lesson-studio' },
        { title: 'In phiếu học tập & tài liệu lên lớp', category: 'complete', linkedAppId: 'print-studio' },
      ],
    },
    {
      id: 'tpl-math-exam',
      title: 'Quy trình chuẩn bị & trộn đề kiểm tra',
      subtitle: 'Soạn đề → Kiểm tra đáp án → Trộn mã đề → In đề.',
      badgeLabel: 'Gợi ý bổ sung',
      isOptionalSuggestion: true,
      suggestedSteps: [
        { title: 'Soạn đề kiểm tra & ma trận', category: 'prepare', linkedAppId: 'lesson-studio' },
        { title: 'Kiểm tra đáp án & lời giải chi tiết', category: 'review', linkedAppId: 'math-mixer' },
        { title: 'Trộn mã đề bảo toàn công thức', category: 'execute', linkedAppId: 'math-mixer' },
        { title: 'In đề & đáp án chuẩn A4', category: 'complete', linkedAppId: 'print-studio' },
      ],
    },
  ];

  // Prioritize matching optional template to top
  if (/(?:ngoai\s+khoa|sinh\s+hoat|trai\s+nghiem|chuyen\s+de)/.test(normInput)) {
    return suggestions;
  }
  if (/(?:kiem\s+tra|tron\s+de|ma\s+de)/.test(normInput)) {
    return [suggestions[2], suggestions[1], suggestions[0]];
  }
  return [suggestions[1], suggestions[2], suggestions[0]];
}

export function parseVietnameseWorkflowV2(
  inputText: string,
  options?: SmartWorkflowParserOptions
): ParsedWorkflowPlan {
  const rawInput = inputText ?? '';
  const trimmed = rawInput.trim();
  const normalizedInput = normalizeVietnamese(trimmed);
  const referenceDate = options?.referenceDate ?? new Date();

  if (!trimmed) {
    return {
      rawInput,
      normalizedInput: '',
      isEmpty: true,
      isLowDetail: false,
      needsConfirmation: false,
      goal: { value: '', confidence: 0 },
      subject: { value: null, canonical: null, confidence: 0 },
      grade: { value: null, label: null, confidence: 0 },
      deadline: {
        isoDate: null,
        text: null,
        needsConfirmation: false,
        confidence: 0,
      },
      tasks: [],
      taskGroups: [],
      quantities: [],
      negations: [],
      dependencies: [],
      unknowns: ['Chưa nhập nội dung mô tả công việc.'],
      overallConfidence: 0,
      templateSuggestions: buildOptionalSuggestions(''),
    };
  }

  const { subject, grade } = extractSubjectAndGrade(normalizedInput);
  const deadline = extractDeadline(trimmed, normalizedInput, referenceDate);
  const quantities = extractQuantities(trimmed);
  const unknowns: string[] = [];

  if (deadline.ambiguityReason) {
    unknowns.push(deadline.ambiguityReason);
  } else if (!deadline.text) {
    unknowns.push('Chưa xác định thời hạn hoặc mốc ngày hoàn thành cụ thể.');
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);

  const hasMultilineBullets =
    lines.length >= 2 &&
    lines.some((l) => /^\s*(?:[-*•–+]|\d+[.)]|bước\s+\d+|buoc\s+\d+)/i.test(l));

  let goalText = '';
  let goalConfidence = 0.8;
  let negations: NegationConstraint[] = [];
  const rawFragments: RawTaskFragment[] = [];

  if (hasMultilineBullets) {
    const bulletItems: RawTaskFragment[] = [];
    let headerLine: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const indent = line.search(/\S|$/);
      const tLine = line.trim();
      const bulletMatch = tLine.match(
        /^(?:[-*•–+]|(\d+)[.)]|(?:bước|buoc)\s+(\d+)[:.]?)\s+(.+)$/i
      );
      if (!bulletMatch) {
        if (i === 0 && !headerLine) {
          headerLine = tLine.replace(/:+$/, '').trim();
        } else {
          const negCheck = extractNegationConstraintsFromSentences([tLine]);
          negations.push(...negCheck.negations);
          if (negCheck.nonNegatedSegments.length > 0) {
            bulletItems.push({ text: tLine, subSteps: [] });
          }
        }
        continue;
      }

      const content = bulletMatch[3].trim();
      const isNumbered = Boolean(bulletMatch[1] || bulletMatch[2]);
      if (indent >= 2 && bulletItems.length > 0) {
        bulletItems[bulletItems.length - 1].subSteps.push(content);
      } else {
        const negCheck = extractNegationConstraintsFromSentences([content]);
        negations.push(...negCheck.negations);
        if (negCheck.nonNegatedSegments.length > 0) {
          bulletItems.push({
            text: content,
            subSteps: [],
            explicitAfterPrev: isNumbered && bulletItems.length > 0,
            explicitOrderCue: isNumbered ? 'số thứ tự' : undefined,
          });
        }
      }
    }

    goalText = capitalizeFirst(
      stripTemporalFragments(stripSubjectModalLead(headerLine ?? '')) ||
        (subject.value
          ? `Kế hoạch ${subject.value}${grade.value ? ` ${grade.value}` : ''}`
          : 'Quy trình công việc')
    );
    goalConfidence = headerLine ? 0.92 : 0.78;
    rawFragments.push(...bulletItems);
  } else {
    // Prose mode: split into sentences first (". ", ";", newlines)
    const rawSentences = trimmed
      .replace(/;\s*/g, '\n')
      .replace(/(?<!\d)\.(?:\s+|$)/g, '\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const negResult = extractNegationConstraintsFromSentences(rawSentences);
    negations = negResult.negations;
    const activeSentences = negResult.nonNegatedSegments;

    if (activeSentences.length > 0) {
      // Check colon or "gồm / bao gồm" list syntax inside first active sentence
      const listIntroMatch = activeSentences[0].match(
        /^(.+?)(?:\s+(?:bao\s+gồm|bao\s+gom|gồm\s+có|gom\s+co|gồm|gom)\s+|:\s*)(.+)$/i
      );

      if (listIntroMatch && activeSentences.length === 1) {
        const rawGoal = stripTemporalFragments(stripSubjectModalLead(listIntroMatch[1]));
        goalText = capitalizeFirst(rawGoal || stripSubjectModalLead(listIntroMatch[1]));
        goalConfidence = 0.93;
        rawFragments.push(...splitConnectorClause(listIntroMatch[2]));
      } else if (
        activeSentences.length >= 2 &&
        isSentenceLikelyGoalLeadIn(activeSentences[0], activeSentences.slice(1))
      ) {
        // Sentence 1 frames the main goal; remaining sentences contain the enumerated steps
        const rawGoal = stripTemporalFragments(
          stripSubjectModalLead(activeSentences[0].replace(/:+$/, ''))
        );
        goalText = capitalizeFirst(rawGoal || stripSubjectModalLead(activeSentences[0]));
        goalConfidence = 0.93;
        for (let i = 1; i < activeSentences.length; i++) {
          const sentBody = stripSubjectModalLead(activeSentences[i]);
          rawFragments.push(...splitConnectorClause(sentBody));
        }
      } else {
        // Every active sentence contains tasks or single high-level goal
        const collected: RawTaskFragment[] = [];
        for (const sent of activeSentences) {
          const sentListMatch = sent.match(
            /^(.+?)(?:\s+(?:bao\s+gồm|bao\s+gom|gồm\s+có|gom\s+co|gồm|gom)\s+|:\s*)(.+)$/i
          );
          if (sentListMatch) {
            if (!goalText) {
              goalText = capitalizeFirst(
                stripTemporalFragments(stripSubjectModalLead(sentListMatch[1]))
              );
              goalConfidence = 0.9;
            }
            collected.push(...splitConnectorClause(sentListMatch[2]));
          } else {
            const sentBody = stripSubjectModalLead(sent);
            collected.push(...splitConnectorClause(sentBody));
          }
        }
        rawFragments.push(...collected);
      }
    }
  }

  // Convert fragments to AnalyzedTask[], applying negation filter strictly
  const tasks: AnalyzedTask[] = [];
  const rawDependencies: TaskDependency[] = [];
  const fragmentToTaskId = new Map<number, string>();

  rawFragments.forEach((frag, idx) => {
    const cleaned = stripTemporalFragments(stripSubjectModalLead(frag.text));
    const title = capitalizeFirst(cleaned || frag.text);
    const normTitle = normalizeVietnamese(title);
    if (!normTitle) return;

    const semantics = extractActionObjectSemantics(title);
    if (isTaskExcludedByNegation(normTitle, semantics.canonicalConcept, negations)) {
      return;
    }

    const category = classifyWorkCategoryV2(title);
    const groupInfo = categoryToGroupInfo(category);
    const taskQuantities = quantities.filter((q) =>
      normTitle.includes(normalizeVietnamese(q.raw))
    );
    const appLink = inferTeacherOSAppLink(title, {
      subjectCanonical: subject.canonical,
      fullInputNorm: normalizedInput,
    });

    const taskId = `task-${tasks.length + 1}`;
    const meaningful = isLikelyMeaningfulVietnamese(title);
    const confidence =
      category !== 'unclassified' && appLink.appId
        ? 0.94
        : category !== 'unclassified'
        ? 0.85
        : meaningful
        ? 0.72
        : 0.35;

    tasks.push({
      id: taskId,
      title,
      normalizedTitle: normTitle,
      verbAction: semantics.verbAction,
      objectTarget: semantics.objectTarget,
      canonicalConcept: semantics.canonicalConcept,
      category,
      groupKey: groupInfo.key,
      subSteps: frag.subSteps.map((s) => capitalizeFirst(s)).filter(Boolean),
      quantities: taskQuantities,
      linkedAppId: appLink.appId,
      linkedAppName: appLink.appName,
      priority: category === 'review' ? 'high' : 'medium',
      status: 'todo',
      confidence,
      sourceText: frag.text.trim(),
      sourceOrder: idx,
      explicitOrderCue: frag.explicitOrderCue,
    });
    fragmentToTaskId.set(idx, taskId);
  });

  // Low-detail / vague single-phrase handling (Test 4 + gibberish protection)
  let isLowDetail = false;
  let needsConfirmation = deadline.needsConfirmation;

  if (tasks.length <= 1 && rawFragments.length <= 1 && !hasMultilineBullets) {
    const singleCandidate = tasks[0]?.title || stripTemporalFragments(stripSubjectModalLead(trimmed));
    const meaningful = isLikelyMeaningfulVietnamese(singleCandidate);

    isLowDetail = true;
    needsConfirmation = true;
    goalText = capitalizeFirst(singleCandidate || trimmed);
    goalConfidence = meaningful ? 0.55 : 0.25;

    // Single high-level goal without concrete split steps -> clear tasks so zero steps are hallucinated!
    tasks.length = 0;

    if (!meaningful) {
      unknowns.unshift(
        'Văn bản chưa rõ nghĩa hoặc không nhận diện được tác vụ giảng dạy cụ thể.'
      );
    } else {
      unknowns.unshift(
        'Mô tả mới nêu mục tiêu chung, chưa liệt kê các đầu việc cụ thể cần thực hiện.'
      );
    }
    if (!subject.value && !grade.label) {
      unknowns.push('Chưa rõ môn học, khối lớp hoặc đối tượng học sinh tham gia.');
    }
  } else if (!goalText) {
    goalText =
      subject.value && grade.value
        ? `Kế hoạch ${subject.value} ${grade.value}`
        : subject.value
        ? `Kế hoạch ${subject.value}`
        : `Quy trình: ${tasks
            .slice(0, 2)
            .map((t) => t.title)
            .join(' → ')}`;
    goalConfidence = subject.value ? 0.84 : 0.74;
  }

  // Build explicit dependencies detected from connectors ("rồi", "sau đó", "trước khi", numbered bullets)
  if (tasks.length >= 2) {
    let depSeq = 1;
    let prevTaskId: string | null = null;
    for (let fIdx = 0; fIdx < rawFragments.length; fIdx++) {
      const currentTaskId = fragmentToTaskId.get(fIdx);
      if (!currentTaskId) continue;

      const frag = rawFragments[fIdx];
      const prevFrag = fIdx > 0 ? rawFragments[fIdx - 1] : null;
      if (prevTaskId && (frag.explicitAfterPrev || prevFrag?.explicitPrecedesNext)) {
        rawDependencies.push({
          id: `dep-exp-${depSeq++}`,
          fromTaskId: prevTaskId,
          toTaskId: currentTaskId,
          kind: 'explicit',
          reason: `Từ nối trình tự "${frag.explicitOrderCue ?? 'trước khi'}"`,
          confidence: 0.92,
        });
      }
      prevTaskId = currentTaskId;
    }
  }

  // Build initial task groups by category
  const groupBuckets = new Map<WorkflowGroupKey, WorkflowTaskGroup>();
  for (const task of tasks) {
    const meta = categoryToGroupInfo(task.category);
    const existing = groupBuckets.get(meta.key);
    if (existing) {
      existing.taskIds.push(task.id);
    } else {
      groupBuckets.set(meta.key, {
        id: `grp-${meta.key}`,
        key: meta.key,
        title: meta.title,
        category: task.category,
        taskIds: [task.id],
        order: meta.order,
      });
    }
  }
  const taskGroups = Array.from(groupBuckets.values()).sort((a, b) => a.order - b.order);

  // Overall confidence calculation
  const taskAvgConfidence =
    tasks.length > 0
      ? tasks.reduce((sum, t) => sum + t.confidence, 0) / tasks.length
      : goalConfidence;
  const deadlinePenalty = deadline.needsConfirmation ? 0.08 : 0;
  const lowDetailPenalty = isLowDetail ? 0.25 : 0;
  const overallConfidence = Number(
    Math.max(
      0.15,
      Math.min(0.98, taskAvgConfidence * 0.7 + goalConfidence * 0.3 - deadlinePenalty - lowDetailPenalty)
    ).toFixed(2)
  );

  return {
    rawInput,
    normalizedInput,
    isEmpty: false,
    isLowDetail,
    needsConfirmation,
    goal: {
      value: goalText,
      confidence: Number(goalConfidence.toFixed(2)),
      sourceText: trimmed,
    },
    subject,
    grade,
    deadline,
    tasks,
    taskGroups,
    quantities,
    negations,
    dependencies: rawDependencies,
    unknowns,
    overallConfidence,
    templateSuggestions: buildOptionalSuggestions(normalizedInput),
  };
}

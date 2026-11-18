import { APP_REGISTRY, AppId } from './appRegistry';
import {
  normalizeVietnameseText,
  wouldCreateEdgeCycle,
} from './canvasEngine';
import {
  WORKFLOW_CANVAS_TEMPLATES,
  applyCanvasAutoLayout,
  instantiateWorkflowTemplate,
} from './canvasLayout';
import {
  CanvasColorKey,
  CanvasEdgeRecord,
  CanvasLayoutMode,
  CanvasNodeRecord,
  CanvasNodeType,
  CanvasPriority,
} from '../types/canvas';

export type WorkCategory =
  | 'prepare'
  | 'execute'
  | 'review'
  | 'complete'
  | 'unclassified';

export type DraftNodeSource = 'parsed' | 'template' | 'manual';

export interface SmartWorkflowQuantity {
  raw: string;
  value: number;
  unit: string;
}

export interface SmartWorkflowWarning {
  id: string;
  severity: 'info' | 'warning';
  code:
    | 'low_detail'
    | 'unclear_input'
    | 'ambiguous_date'
    | 'ambiguous_sequence'
    | 'duplicate_detected'
    | 'no_deadline';
  message: string;
}

export interface SmartWorkflowDraftNode {
  id: string;
  type: CanvasNodeType;
  title: string;
  description: string;
  parentId: string | null;
  category: WorkCategory;
  priority: CanvasPriority;
  dueDate?: string;
  dueDateLabel?: string;
  quantityLabel?: string;
  suggestedAppId?: AppId;
  suggestedAppName?: string;
  color: CanvasColorKey;
  source: DraftNodeSource;
  checklist?: Array<{ id: string; label: string; done: boolean }>;
  position: { x: number; y: number };
  orderIndex: number;
  duplicateOfNodeId?: string;
}

export interface SmartWorkflowDraftEdge {
  id: string;
  source: string;
  target: string;
  edgeType: 'parent' | 'dependency';
  label?: string;
  sourceKind: DraftNodeSource;
}

export interface SmartWorkflowMetadata {
  mainGoal: string;
  subject?: string;
  grade?: string;
  dueDate?: string;
  dueDateLabel?: string;
  timeHint?: string;
  quantities: SmartWorkflowQuantity[];
}

export interface SmartWorkflowTemplateSuggestion {
  id: string;
  title: string;
  subtitle: string;
  stepsCount: number;
  badgeLabel: 'Gợi ý bổ sung';
}

export interface SmartWorkflowParseResult {
  rawInput: string;
  isEmpty: boolean;
  isLowDetail: boolean;
  needsConfirmation: boolean;
  metadata: SmartWorkflowMetadata;
  nodes: SmartWorkflowDraftNode[];
  edges: SmartWorkflowDraftEdge[];
  warnings: SmartWorkflowWarning[];
  templateSuggestions: SmartWorkflowTemplateSuggestion[];
  duplicateMatches: Array<{ draftNodeId: string; existingNodeId: string; title: string }>;
}

export const WORK_CATEGORY_META: Record<
  WorkCategory,
  { label: string; defaultColor: CanvasColorKey }
> = {
  prepare: { label: 'Chuẩn bị', defaultColor: 'blue' },
  execute: { label: 'Thực hiện', defaultColor: 'indigo' },
  review: { label: 'Kiểm tra', defaultColor: 'amber' },
  complete: { label: 'Hoàn thành', defaultColor: 'emerald' },
  unclassified: { label: 'Chưa phân loại', defaultColor: 'slate' },
};

const SUBJECT_RULES: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: 'Toán học',
    aliases: ['toan hoc', 'giai tich', 'hinh hoc', 'dai so', 'toan'],
  },
  {
    canonical: 'Ngữ văn',
    aliases: ['ngu van', 'van hoc', 'van'],
  },
  {
    canonical: 'Tiếng Anh',
    aliases: ['tieng anh', 'anh van', 'english'],
  },
  {
    canonical: 'Vật lí',
    aliases: ['vat li', 'vat ly'],
  },
  {
    canonical: 'Hóa học',
    aliases: ['hoa hoc'],
  },
  {
    canonical: 'Sinh học',
    aliases: ['sinh hoc'],
  },
  {
    canonical: 'Khoa học tự nhiên',
    aliases: ['khoa hoc tu nhien', 'khtn'],
  },
  {
    canonical: 'Lịch sử',
    aliases: ['lich su'],
  },
  {
    canonical: 'Địa lí',
    aliases: ['dia li', 'dia ly'],
  },
  {
    canonical: 'Tin học',
    aliases: ['tin hoc'],
  },
  {
    canonical: 'GDCD',
    aliases: ['gdcd', 'giao duc cong dan', 'ktpl', 'kinh te phap luat'],
  },
  {
    canonical: 'Công nghệ',
    aliases: ['cong nghe'],
  },
];

const SHORT_SUBJECT_BEFORE_GRADE: Array<{ alias: string; canonical: string }> = [
  { alias: 'toan', canonical: 'Toán học' },
  { alias: 'van', canonical: 'Ngữ văn' },
  { alias: 'anh', canonical: 'Tiếng Anh' },
  { alias: 'li', canonical: 'Vật lí' },
  { alias: 'ly', canonical: 'Vật lí' },
  { alias: 'hoa', canonical: 'Hóa học' },
  { alias: 'sinh', canonical: 'Sinh học' },
  { alias: 'su', canonical: 'Lịch sử' },
  { alias: 'dia', canonical: 'Địa lí' },
  { alias: 'tin', canonical: 'Tin học' },
];

const WEEKDAY_NAMES_VI: Record<number, string> = {
  0: 'Chủ nhật',
  1: 'Thứ Hai',
  2: 'Thứ Ba',
  3: 'Thứ Tư',
  4: 'Thứ Năm',
  5: 'Thứ Sáu',
  6: 'Thứ Bảy',
};

const WEEKDAY_PATTERNS: Array<{ pattern: RegExp; dayOfWeek: number; label: string }> = [
  { pattern: /\b(chu nhat|cn)\b/i, dayOfWeek: 0, label: 'Chủ nhật' },
  { pattern: /\bthu\s*(hai|2)\b/i, dayOfWeek: 1, label: 'Thứ Hai' },
  { pattern: /\bthu\s*(ba|3)\b/i, dayOfWeek: 2, label: 'Thứ Ba' },
  { pattern: /\bthu\s*(tu|bon|4)\b/i, dayOfWeek: 3, label: 'Thứ Tư' },
  { pattern: /\bthu\s*(nam|5)\b/i, dayOfWeek: 4, label: 'Thứ Năm' },
  { pattern: /\bthu\s*(sau|6)\b/i, dayOfWeek: 5, label: 'Thứ Sáu' },
  { pattern: /\bthu\s*(bay|7)\b/i, dayOfWeek: 6, label: 'Thứ Bảy' },
];

function getReadyAppDefinition(appId: AppId) {
  const found = APP_REGISTRY.find((app) => app.id === appId);
  if (!found || found.status !== 'ready') return null;
  return found;
}

export function getReadyTeacherOSApps() {
  return APP_REGISTRY.filter((app) => app.status === 'ready');
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDateVi(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function addDays(base: Date, days: number): Date {
  const copy = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalizeSentenceStart(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function detectSubjectAndGrade(normalizedText: string): {
  subject?: string;
  grade?: string;
} {
  let subject: string | undefined;
  let grade: string | undefined;

  for (const rule of SUBJECT_RULES) {
    for (const alias of rule.aliases) {
      const re = new RegExp(`(?:^|\\s|[.,;:(])${escapeRegExp(alias)}(?:$|\\s|[.,;:)])`, 'i');
      if (re.test(normalizedText)) {
        subject = rule.canonical;
        break;
      }
    }
    if (subject) break;
  }

  for (const item of SHORT_SUBJECT_BEFORE_GRADE) {
    const re = new RegExp(`\\b${escapeRegExp(item.alias)}\\s+(1[0-2]|[1-9])\\b`, 'i');
    const match = normalizedText.match(re);
    if (match) {
      if (!subject) subject = item.canonical;
      grade = `Lớp ${match[1]}`;
      break;
    }
  }

  if (!grade) {
    const explicitGradeMatch = normalizedText.match(/\b(?:lop|khoi)\s+(1[0-2]|[1-9])(?:[a-z]\d*)?\b/i);
    if (explicitGradeMatch) {
      grade = `Lớp ${explicitGradeMatch[1]}`;
    } else if (/\bthpt\b/i.test(normalizedText)) {
      grade = 'THPT';
    } else if (/\bthcs\b/i.test(normalizedText)) {
      grade = 'THCS';
    } else if (/\btieu hoc\b/i.test(normalizedText)) {
      grade = 'Tiểu học';
    }
  }

  return { subject, grade };
}

function extractTemporalInfo(
  rawText: string,
  normalizedText: string,
  referenceDate: Date
): {
  dueDate?: string;
  dueDateLabel?: string;
  timeHint?: string;
  ambiguousDateWarning?: string;
} {
  let dueDate: string | undefined;
  let dueDateLabel: string | undefined;
  let timeHint: string | undefined;
  let ambiguousDateWarning: string | undefined;

  // Time hint (e.g. "7h30", "14:00", "buổi sáng")
  const clockMatch = rawText.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/i);
  if (clockMatch) {
    const hh = clockMatch[1].padStart(2, '0');
    const mm = (clockMatch[2] ?? '00').padStart(2, '0');
    timeHint = `${hh}:${mm}`;
  } else if (/\bbuoi\s+sang|\bsang\s+(?:nay|mai|thu)\b/i.test(normalizedText)) {
    timeHint = 'Buổi sáng';
  } else if (/\bbuoi\s+chieu|\bchieu\s+(?:nay|mai|thu)\b/i.test(normalizedText)) {
    timeHint = 'Buổi chiều';
  } else if (/\bbuoi\s+toi|\btoi\s+(?:nay|mai|thu)\b/i.test(normalizedText)) {
    timeHint = 'Buổi tối';
  }

  // 1. Explicit date dd/mm/yyyy or dd/mm
  const explicitDateMatch = normalizedText.match(
    /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/
  );
  if (explicitDateMatch) {
    const day = Number(explicitDateMatch[1]);
    const month = Number(explicitDateMatch[2]);
    const rawYear = explicitDateMatch[3];
    let year = referenceDate.getFullYear();
    if (rawYear) {
      year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      let resolved = new Date(year, month - 1, day);
      if (
        !rawYear &&
        resolved.getTime() <
          new Date(
            referenceDate.getFullYear(),
            referenceDate.getMonth(),
            referenceDate.getDate()
          ).getTime()
      ) {
        resolved = new Date(year + 1, month - 1, day);
        ambiguousDateWarning = `Ngày ${day}/${month} không nêu năm, hệ thống tạm tính là ${formatDisplayDateVi(resolved)}.`;
      }
      if (resolved.getDate() === day && resolved.getMonth() === month - 1) {
        dueDate = formatIsoDate(resolved);
        dueDateLabel = `${WEEKDAY_NAMES_VI[resolved.getDay()]} ${formatDisplayDateVi(resolved)}`;
        return { dueDate, dueDateLabel, timeHint, ambiguousDateWarning };
      }
    }
  }

  // 2. Relative day keywords
  if (/\bhom\s+nay\b/i.test(normalizedText)) {
    const target = addDays(referenceDate, 0);
    dueDate = formatIsoDate(target);
    dueDateLabel = `Hôm nay (${formatDisplayDateVi(target)})`;
    return { dueDate, dueDateLabel, timeHint };
  }

  if (/\bngay\s+mai\b|\bsang\s+mai\b|\bchieu\s+mai\b|\btoi\s+mai\b/i.test(normalizedText)) {
    const target = addDays(referenceDate, 1);
    dueDate = formatIsoDate(target);
    dueDateLabel = `Ngày mai (${formatDisplayDateVi(target)})`;
    return { dueDate, dueDateLabel, timeHint };
  }

  if (/\bngay\s+(?:kia|mot)\b/i.test(normalizedText)) {
    const target = addDays(referenceDate, 2);
    dueDate = formatIsoDate(target);
    dueDateLabel = `Ngày kia (${formatDisplayDateVi(target)})`;
    return { dueDate, dueDateLabel, timeHint };
  }

  // 3. Weekday reference ("thứ Sáu", "thứ Ba tuần sau", ...)
  for (const wp of WEEKDAY_PATTERNS) {
    if (wp.pattern.test(normalizedText)) {
      const refDow = referenceDate.getDay();
      const hasNextWeek = /\btuan\s+(?:sau|toi)\b/i.test(normalizedText);
      const hasThisWeek = /\btuan\s+nay\b/i.test(normalizedText);
      let delta = (wp.dayOfWeek - refDow + 7) % 7;

      if (hasNextWeek) {
        const daysToNextMonday = refDow === 0 ? 1 : 8 - refDow;
        const offsetFromMon = wp.dayOfWeek === 0 ? 6 : wp.dayOfWeek - 1;
        delta = daysToNextMonday + offsetFromMon;
      } else if (delta === 0 && !hasThisWeek) {
        // Same weekday as today without "tuần này": keep today but warn teacher to verify
        ambiguousDateWarning = `Mô tả nhắc tới "${wp.label}" trùng với thứ của hôm nay (${formatDisplayDateVi(referenceDate)}). Thầy/cô hãy kiểm tra lại nếu muốn đặt cho tuần sau.`;
      } else if (!hasThisWeek && wp.dayOfWeek < refDow && wp.dayOfWeek !== 0) {
        ambiguousDateWarning = `"${wp.label}" được tự động tính cho tuần kế tiếp (${formatDisplayDateVi(addDays(referenceDate, delta))}).`;
      }

      const target = addDays(referenceDate, delta);
      dueDate = formatIsoDate(target);
      dueDateLabel = `${wp.label} (${formatDisplayDateVi(target)})`;
      return { dueDate, dueDateLabel, timeHint, ambiguousDateWarning };
    }
  }

  if (/\btuan\s+(?:sau|toi)\b/i.test(normalizedText)) {
    const refDow = referenceDate.getDay();
    const daysToNextMonday = refDow === 0 ? 1 : 8 - refDow;
    const target = addDays(referenceDate, daysToNextMonday);
    dueDate = formatIsoDate(target);
    dueDateLabel = `Đầu tuần sau (${formatDisplayDateVi(target)})`;
    ambiguousDateWarning =
      'Chỉ nêu "tuần sau" mà chưa rõ thứ cụ thể; tạm đặt vào Thứ Hai tuần sau để thầy/cô chỉnh lại.';
  }

  return { dueDate, dueDateLabel, timeHint, ambiguousDateWarning };
}

function extractQuantities(rawText: string): SmartWorkflowQuantity[] {
  const results: SmartWorkflowQuantity[] = [];
  const regex =
    /(?:^|[\s,.;:!?()\-–])(\d+)\s+(mã\s+đề|đề\s+thi|đề|câu\s+hỏi|câu|phiếu\s+học\s+tập|phiếu|tiết|buổi|phút|bài|bản\s+in|nhóm|học\s+sinh|rubric)(?=$|[\s,.;:!?()\-–])/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawText)) !== null) {
    const value = Number(match[1]);
    const unit = match[2].replace(/\s+/g, ' ').trim();
    const raw = `${value} ${unit}`;
    if (!results.some((q) => normalizeVietnameseText(q.raw) === normalizeVietnameseText(raw))) {
      results.push({ raw, value, unit });
    }
  }
  return results;
}

export function classifyWorkCategory(text: string): WorkCategory {
  const norm = normalizeVietnameseText(text);
  if (!norm) return 'unclassified';

  // Explicit preparation phrase at start or exam noun phrase ("chuẩn bị kiểm tra Toán 12", "kiểm tra 45 phút")
  if (
    /^(?:chuan bi|soan|tim|thiet ke|lap ke hoach|tao phieu|tao de|xay dung)\b/.test(
      norm
    )
  ) {
    return 'prepare';
  }

  // Review verbs (exclude "kiểm tra Toán/Văn/45 phút/15 phút/giữa kỳ/cuối kỳ/học kỳ" exam nouns)
  const strippedExamNoun = norm.replace(
    /\bkiem tra\s+(?:toan|ngu van|van|tieng anh|anh|vat li|vat ly|hoa|sinh|su|dia|tin|khtn|gdcd|\d+\s*phut|1\s*tiet|giua\s*k[yi]|cuoi\s*k[yi]|hoc\s*k[yi])\b/g,
    ''
  );
  if (
    /\b(kiem tra|ra soat|doi chieu|duyet|tham dinh|xac nhan|danh gia lai)\b/.test(
      strippedExamNoun
    )
  ) {
    return 'review';
  }
  // Complete / publish / finish keywords
  if (
    /\b(in de|in tai lieu|in phieu|in a4|in\b|xuat pdf|xuat ban|nop|ban giao|hoan thanh|hoan tat|ket thuc|tong ket|luu tru)\b/.test(
      norm
    )
  ) {
    return 'complete';
  }
  // Execute keywords
  if (
    /\b(tron|sinh ma|to chuc|trien khai|giang day|day hoc|trinh bay|thuc hien|thao luan|huong dan|cham bai|ghi nhan|ghi nhat ky|rut kinh nghiem)\b/.test(
      norm
    )
  ) {
    return 'execute';
  }
  // Prepare keywords anywhere else
  if (
    /\b(soan|chuan bi|tim|thu thap|thiet ke|xay dung|lap ke hoach|tao phieu|tao de|viet|len khung)\b/.test(
      norm
    )
  ) {
    return 'prepare';
  }

  return 'unclassified';
}

export function inferSafeTeacherOSApp(
  taskText: string,
  context: { subject?: string; fullInput?: string } = {}
): { appId?: AppId; appName?: string } {
  const norm = normalizeVietnameseText(taskText);
  const fullNorm = normalizeVietnameseText(context.fullInput ?? '');
  const isMathContext =
    context.subject === 'Toán học' ||
    /\b(toan|ma de|math lock|katex|latex)\b/.test(fullNorm);

  let candidateId: AppId | null = null;

  if (
    /\b(tron\s+\d*\s*ma\s+de|tron\s+de|sinh\s+ma\s+de|math\s+lock|math\s+integrity)\b/.test(
      norm
    ) ||
    (isMathContext && /\b(kiem tra dap an|dap an ma de|tron)\b/.test(norm))
  ) {
    candidateId = 'math-mixer';
  } else if (
    /\b(in\s+de|in\s+tai\s+lieu|in\s+phieu|in\s+a4|in\b|ban\s+in|xuat\s+pdf|xem\s+truoc\s+in)\b/.test(
      norm
    )
  ) {
    candidateId = 'print-studio';
  } else if (
    /\b(tim\s+tai\s+lieu|tim\s+hoc\s+lieu|hoc\s+lieu|ngan\s+hang\s+cau\s+hoi|tai\s+lieu\s+tham\s+khao)\b/.test(
      norm
    )
  ) {
    candidateId = 'resource-vault';
  } else if (
    /\b(nhat\s+ky|ghi\s+nhan\s+kinh\s+nghiem|rut\s+kinh\s+nghiem|phan\s+hoi\s+sau\s+tiet)\b/.test(
      norm
    )
  ) {
    candidateId = 'teaching-journal';
  } else if (
    /\b(soan\s+bai|soan\s+giao\s+an|giao\s+an|phieu\s+hoc\s+tap|tao\s+phieu|soan\s+phieu|rubric|thiet\s+ke\s+hoat\s+dong|hoat\s+dong\s+hoc|soan\s+de)\b/.test(
      norm
    )
  ) {
    candidateId = 'lesson-studio';
  } else if (
    /\b(quan\s+ly\s+tien\s+do|tien\s+do|quy\s+trinh|sinh\s+hoat\s+chuyen\s+mon|dieu\s+phoi)\b/.test(
      norm
    )
  ) {
    candidateId = 'workflow-center';
  }

  if (!candidateId) return {};
  const readyApp = getReadyAppDefinition(candidateId);
  if (!readyApp) return {};
  return { appId: readyApp.id, appName: readyApp.name };
}

function inferNodeType(
  taskText: string,
  category: WorkCategory,
  hasSubChecklist: boolean,
  isExplicitMilestone: boolean
): CanvasNodeType {
  if (hasSubChecklist) return 'checklist';
  const norm = normalizeVietnameseText(taskText);
  if (
    isExplicitMilestone ||
    category === 'complete' ||
    /\b(hoan thanh|hoan tat|moc|duyet|tong ket|nop|ban giao)\b/.test(norm)
  ) {
    return 'milestone';
  }
  return 'task';
}

function stripLeadingConnectors(segment: string): {
  cleaned: string;
  hasSequentialLead: boolean;
  isFinalLead: boolean;
  leadWord?: string;
} {
  let working = segment.trim().replace(/^[.,;:\-–•*]+\s*/, '');
  let hasSequentialLead = false;
  let isFinalLead = false;
  let leadWord: string | undefined;

  const seqPatterns: Array<{ re: RegExp; isFinal?: boolean; label: string }> = [
    { re: /^(?:và\s+)?cuối\s+cùng(?:\s+là)?[:,]?\s+/i, isFinal: true, label: 'Cuối cùng' },
    { re: /^(?:và\s+)?sau\s+đó(?:\s+thì)?[:,]?\s+/i, label: 'Sau đó' },
    { re: /^(?:và\s+)?tiếp\s+theo(?:\s+là)?[:,]?\s+/i, label: 'Tiếp theo' },
    { re: /^(?:và\s+)?kế\s+tiếp(?:\s+là)?[:,]?\s+/i, label: 'Kế tiếp' },
    { re: /^(?:và\s+)?rồi(?:\s+mới)?[:,]?\s+/i, label: 'Tiếp theo' },
    { re: /^trước\s+(?:hết|tiên)[:,]?\s+/i, label: 'Trước hết' },
    { re: /^sau\s+khi\s+/i, label: 'Sau khi' },
  ];

  for (const sp of seqPatterns) {
    if (sp.re.test(working)) {
      working = working.replace(sp.re, '').trim();
      hasSequentialLead = true;
      isFinalLead = Boolean(sp.isFinal);
      leadWord = sp.label;
      break;
    }
  }

  working = working
    .replace(/^(?:tôi|mình|em|thầy|cô|chúng ta)\s+(?:cần|muốn|sẽ|phải)\s+/i, '')
    .replace(/^(?:cần|phải)\s+/i, '')
    .replace(/[.。]+$/g, '')
    .trim();

  return {
    cleaned: working,
    hasSequentialLead,
    isFinalLead,
    leadWord,
  };
}

function stripGoalLeadIn(text: string): string {
  return text
    .trim()
    .replace(
      /^(?:hãy\s+)?(?:giúp\s+(?:tôi|mình)\s+)?(?:tôi|mình|em|thầy|cô|chúng ta)\s+(?:cần|muốn|sẽ|phải)\s+/i,
      ''
    )
    .replace(/^(?:cần|muốn|lập kế hoạch)\s+/i, '')
    .replace(/[:.]+$/g, '')
    .trim();
}

function splitListPhrase(listText: string): string[] {
  // Replace ", và " / " và " with a marker only when separating distinct items
  const normalizedSeparators = listText
    .replace(/;\s*/g, '\n')
    .replace(/,\s*(?:và|&)\s+/gi, '\n')
    .replace(/,\s+/g, '\n');

  const rawChunks = normalizedSeparators.split('\n');
  const out: string[] = [];

  for (const chunk of rawChunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    // Split "kiểm tra đáp án và in đề" if "và" joins two verb phrases
    const vaMatch = trimmed.match(/^(.+?)\s+và\s+(.+)$/i);
    if (vaMatch) {
      const left = vaMatch[1].trim();
      const right = vaMatch[2].trim();
      const leftCategory = classifyWorkCategory(left);
      const rightCategory = classifyWorkCategory(right);
      const rightStartsWithAction =
        rightCategory !== 'unclassified' ||
        /^(?:sau\s+đó|tiếp\s+theo|cuối\s+cùng|in|soạn|trộn|kiểm|tìm|tạo|làm|chọn|gửi|nộp|duyệt|ghi)\b/i.test(
          right
        );
      if (rightStartsWithAction && (leftCategory !== 'unclassified' || left.split(/\s+/).length >= 2)) {
        out.push(left, right);
        continue;
      }
    }

    out.push(trimmed);
  }

  return out;
}

function removeTemporalPhrasesFromTask(segment: string): string {
  return segment
    .replace(
      /\b(?:vào\s+)?(?:hôm\s+nay|ngày\s+mai|ngày\s+kia|ngày\s+mốt|tuần\s+này|tuần\s+sau|tuần\s+tới)\b/gi,
      ''
    )
    .replace(
      /\b(?:vào\s+)?thứ\s+(?:hai|ba|tư|bốn|năm|sáu|bảy|2|3|4|5|6|7)(?:\s+tuần\s+(?:này|sau|tới))?\b/gi,
      ''
    )
    .replace(/\b(?:vào\s+)?chủ\s+nhật(?:\s+tuần\s+(?:này|sau|tới))?\b/gi, '')
    .replace(/\b(?:ngày\s+)?\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
}

function isLikelyMeaningfulVietnamese(text: string): boolean {
  const norm = normalizeVietnameseText(text);
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  // If single long token of random consonants/letters without vowels or known words
  if (words.length === 1 && !/[aeiouy]/.test(words[0])) return false;
  const hasKnownKeyword =
    classifyWorkCategory(text) !== 'unclassified' ||
    Boolean(inferSafeTeacherOSApp(text).appId) ||
    Boolean(detectSubjectAndGrade(norm).subject) ||
    /\b(bai|tiet|lop|de|phieu|hoc|sinh|giao|vien|chuyen|mon|hop|ke|hoach|on|tap|kiem|tra|thi|chuyen|de|du|an|chu|de|tuan|ngay)\b/.test(
      norm
    );
  if (hasKnownKeyword) return true;
  // Check at least 2 real alphabetic words containing vowels
  const realWords = words.filter((w) => w.length >= 2 && /[aeiouy]/.test(w));
  return realWords.length >= 2;
}

interface ParsedBulletItem {
  title: string;
  indent: number;
  numberedOrder: number | null;
  subItems: string[];
}

function parseBulletLines(lines: string[]): {
  headerLine?: string;
  items: ParsedBulletItem[];
} {
  let headerLine: string | undefined;
  const items: ParsedBulletItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const indent = rawLine.search(/\S|$/);
    const bulletMatch = trimmed.match(/^(?:[-*•–+]|(\d+)[.)]|bước\s+(\d+)[:.]?)\s+(.+)$/i);

    if (!bulletMatch) {
      if (i === 0 && !headerLine) {
        headerLine = trimmed.replace(/:+$/, '').trim();
        continue;
      }
      // Treat non-bullet line as plain item
      items.push({
        title: trimmed,
        indent,
        numberedOrder: null,
        subItems: [],
      });
      continue;
    }

    const numStr = bulletMatch[1] || bulletMatch[2];
    const numberedOrder = numStr ? Number(numStr) : null;
    const itemText = bulletMatch[3].trim();

    if (indent >= 2 && items.length > 0 && items[items.length - 1].indent < indent) {
      items[items.length - 1].subItems.push(itemText);
    } else {
      items.push({
        title: itemText,
        indent,
        numberedOrder,
        subItems: [],
      });
    }
  }

  return { headerLine, items };
}

export function buildTemplateSuggestions(): SmartWorkflowTemplateSuggestion[] {
  const baseTemplates: SmartWorkflowTemplateSuggestion[] = WORKFLOW_CANVAS_TEMPLATES.map(
    (tpl) => ({
      id: tpl.id,
      title: tpl.title,
      subtitle: tpl.subtitle,
      stepsCount: tpl.stepsCount,
      badgeLabel: 'Gợi ý bổ sung',
    })
  );

  baseTemplates.push({
    id: 'tpl-department-meeting',
    title: 'Tổ chức buổi sinh hoạt chuyên môn tổ',
    subtitle: 'Chốt chủ đề & phân công báo cáo → Chuẩn bị minh họa → Điều hành & Biên bản → Lưu hồ sơ.',
    stepsCount: 4,
    badgeLabel: 'Gợi ý bổ sung',
  });

  return baseTemplates;
}

function makeDraftNode(params: {
  id: string;
  type: CanvasNodeType;
  title: string;
  description?: string;
  parentId: string | null;
  category: WorkCategory;
  priority?: CanvasPriority;
  dueDate?: string;
  dueDateLabel?: string;
  quantityLabel?: string;
  suggestedAppId?: AppId;
  suggestedAppName?: string;
  source: DraftNodeSource;
  checklist?: Array<{ id: string; label: string; done: boolean }>;
  orderIndex: number;
}): SmartWorkflowDraftNode {
  return {
    id: params.id,
    type: params.type,
    title: params.title,
    description: params.description ?? '',
    parentId: params.parentId,
    category: params.category,
    priority: params.priority ?? (params.category === 'review' ? 'high' : 'medium'),
    dueDate: params.dueDate,
    dueDateLabel: params.dueDateLabel,
    quantityLabel: params.quantityLabel,
    suggestedAppId: params.suggestedAppId,
    suggestedAppName: params.suggestedAppName,
    color:
      params.type === 'root'
        ? 'blue'
        : params.type === 'milestone'
        ? 'emerald'
        : WORK_CATEGORY_META[params.category].defaultColor,
    source: params.source,
    checklist: params.checklist,
    position: { x: 0, y: 0 },
    orderIndex: params.orderIndex,
  };
}

export function applyDraftAutoLayout(
  nodes: SmartWorkflowDraftNode[],
  edges: SmartWorkflowDraftEdge[],
  layoutMode: Exclude<CanvasLayoutMode, 'free'> = 'tree-tb'
): SmartWorkflowDraftNode[] {
  if (nodes.length === 0) return [];
  const asRecords: CanvasNodeRecord[] = nodes.map((n) => ({
    id: n.id,
    boardId: 'preview-board',
    type: n.type,
    title: n.title,
    description: n.description,
    parentId: n.parentId,
    position: n.position,
    color: n.color,
    createdAt: '',
    updatedAt: '',
  }));
  const asEdges: CanvasEdgeRecord[] = edges.map((e) => ({
    id: e.id,
    boardId: 'preview-board',
    source: e.source,
    target: e.target,
    edgeType: e.edgeType,
    label: e.label,
  }));

  const laidOut = applyCanvasAutoLayout(asRecords, asEdges, layoutMode);
  const posById = new Map(laidOut.map((n) => [n.id, n.position]));
  return nodes.map((n) => ({
    ...n,
    position: posById.get(n.id) ?? n.position,
  }));
}

export function validateDraftGraph(
  nodes: SmartWorkflowDraftNode[],
  edges: SmartWorkflowDraftEdge[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const checkEdges: CanvasEdgeRecord[] = [];

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(`Liên kết "${edge.id}" tham chiếu tới node không tồn tại.`);
      continue;
    }
    if (wouldCreateEdgeCycle(checkEdges, edge.source, edge.target, edge.edgeType)) {
      errors.push(
        `Phát hiện vòng lặp ${edge.edgeType === 'dependency' ? 'phụ thuộc' : 'cha–con'} tại "${edge.source} -> ${edge.target}".`
      );
      continue;
    }
    checkEdges.push({
      id: edge.id,
      boardId: 'preview-board',
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
    });
  }

  return { valid: errors.length === 0, errors };
}

export function detectDuplicateDraftNodes(
  draftNodes: SmartWorkflowDraftNode[],
  existingBoardNodes: CanvasNodeRecord[]
): Array<{ draftNodeId: string; existingNodeId: string; title: string }> {
  if (existingBoardNodes.length === 0) return [];
  const existingMap = new Map<string, CanvasNodeRecord>();
  for (const existing of existingBoardNodes) {
    const key = normalizeVietnameseText(existing.title);
    if (key && !existingMap.has(key)) {
      existingMap.set(key, existing);
    }
  }

  const matches: Array<{ draftNodeId: string; existingNodeId: string; title: string }> = [];
  for (const node of draftNodes) {
    const key = normalizeVietnameseText(node.title);
    const found = existingMap.get(key);
    if (found) {
      matches.push({
        draftNodeId: node.id,
        existingNodeId: found.id,
        title: node.title,
      });
    }
  }
  return matches;
}

export function parseVietnameseWorkflow(
  inputText: string,
  options?: {
    referenceDate?: Date;
    existingBoardNodes?: CanvasNodeRecord[];
    layoutMode?: Exclude<CanvasLayoutMode, 'free'>;
  }
): SmartWorkflowParseResult {
  const rawInput = inputText ?? '';
  const trimmed = rawInput.trim();
  const referenceDate = options?.referenceDate ?? new Date();
  const existingBoardNodes = options?.existingBoardNodes ?? [];
  const layoutMode = options?.layoutMode ?? 'tree-tb';
  const templateSuggestions = buildTemplateSuggestions();

  if (!trimmed) {
    return {
      rawInput,
      isEmpty: true,
      isLowDetail: false,
      needsConfirmation: false,
      metadata: {
        mainGoal: '',
        quantities: [],
      },
      nodes: [],
      edges: [],
      warnings: [],
      templateSuggestions,
      duplicateMatches: [],
    };
  }

  const normalized = normalizeVietnameseText(trimmed);
  const { subject, grade } = detectSubjectAndGrade(normalized);
  const temporal = extractTemporalInfo(trimmed, normalized, referenceDate);
  const quantities = extractQuantities(trimmed);
  const warnings: SmartWorkflowWarning[] = [];

  if (temporal.ambiguousDateWarning) {
    warnings.push({
      id: 'warn-date-ambiguous',
      severity: 'warning',
      code: 'ambiguous_date',
      message: temporal.ambiguousDateWarning,
    });
  }

  let seq = 1;
  const nextId = (prefix: string) => `${prefix}-${seq++}`;

  const draftNodes: SmartWorkflowDraftNode[] = [];
  const draftEdges: SmartWorkflowDraftEdge[] = [];

  const attachQuantityForSegment = (segmentText: string): string | undefined => {
    const segNorm = normalizeVietnameseText(segmentText);
    const matched = quantities.find((q) =>
      segNorm.includes(normalizeVietnameseText(q.raw))
    );
    return matched?.raw;
  };

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);

  const hasMultilineBullets =
    lines.length >= 2 &&
    lines.some((l) => /^\s*(?:[-*•–+]|\d+[.)]|bước\s+\d+)/i.test(l));

  let mainGoal = '';
  let isLowDetail = false;
  let needsConfirmation = false;

  if (hasMultilineBullets) {
    const { headerLine, items } = parseBulletLines(lines);
    const rawHeader = headerLine ? stripGoalLeadIn(headerLine) : '';
    mainGoal = capitalizeSentenceStart(
      rawHeader || (subject ? `Quy trình ${subject}${grade ? ` ${grade}` : ''}` : 'Quy trình công việc mới')
    );

    const rootNode = makeDraftNode({
      id: nextId('draft'),
      type: 'root',
      title: mainGoal,
      description: [subject, grade, temporal.dueDateLabel]
        .filter(Boolean)
        .join(' · '),
      parentId: null,
      category: classifyWorkCategory(mainGoal),
      dueDate: temporal.dueDate,
      dueDateLabel: temporal.dueDateLabel,
      source: 'parsed',
      orderIndex: 0,
    });
    draftNodes.push(rootNode);

    const createdTaskIds: string[] = [];
    const hasExplicitStepNumbers = items.some((it) => it.numberedOrder !== null);

    items.forEach((item, idx) => {
      const lead = stripLeadingConnectors(item.title);
      const taskText = removeTemporalPhrasesFromTask(lead.cleaned) || lead.cleaned;
      const itemTitle = capitalizeSentenceStart(taskText);
      const itemTemporal = extractTemporalInfo(
        item.title,
        normalizeVietnameseText(item.title),
        referenceDate
      );
      const category = classifyWorkCategory(itemTitle);
      const appInfo = inferSafeTeacherOSApp(itemTitle, {
        subject,
        fullInput: trimmed,
      });
      const checklistItems =
        item.subItems.length > 0
          ? item.subItems.map((sub, sIdx) => ({
              id: `chk-${idx + 1}-${sIdx + 1}`,
              label: capitalizeSentenceStart(sub),
              done: false,
            }))
          : undefined;
      const nodeType = inferNodeType(
        itemTitle,
        category,
        Boolean(checklistItems),
        lead.isFinalLead
      );

      const node = makeDraftNode({
        id: nextId('draft'),
        type: nodeType,
        title: itemTitle,
        description: appInfo.appName ? `Công cụ phù hợp: ${appInfo.appName}` : '',
        parentId: rootNode.id,
        category,
        dueDate: itemTemporal.dueDate ?? temporal.dueDate,
        dueDateLabel: itemTemporal.dueDateLabel ?? temporal.dueDateLabel,
        quantityLabel: attachQuantityForSegment(item.title),
        suggestedAppId: appInfo.appId,
        suggestedAppName: appInfo.appName,
        source: 'parsed',
        checklist: checklistItems,
        orderIndex: idx + 1,
      });

      draftNodes.push(node);
      draftEdges.push({
        id: nextId('dedge'),
        source: rootNode.id,
        target: node.id,
        edgeType: 'parent',
        sourceKind: 'parsed',
      });

      // Add dependency only if explicit numbering or sequential connector exists
      if (
        createdTaskIds.length > 0 &&
        (hasExplicitStepNumbers || lead.hasSequentialLead)
      ) {
        draftEdges.push({
          id: nextId('dedge'),
          source: createdTaskIds[createdTaskIds.length - 1],
          target: node.id,
          edgeType: 'dependency',
          label: lead.leadWord ?? 'Tiếp theo',
          sourceKind: 'parsed',
        });
      }

      createdTaskIds.push(node.id);
    });
  } else {
    // Prose mode (single line or paragraph)
    // Check for explicit "gồm / bao gồm / :" list pattern
    const colonOrListMatch = trimmed.match(
      /^(.+?)(?:\s+(?:bao\s+gồm|gồm\s+có|gồm)\s+|:\s*)(.+)$/i
    );

    if (colonOrListMatch) {
      const prefixRaw = removeTemporalPhrasesFromTask(
        stripGoalLeadIn(colonOrListMatch[1])
      );
      mainGoal = capitalizeSentenceStart(prefixRaw || stripGoalLeadIn(colonOrListMatch[1]));

      const rootNode = makeDraftNode({
        id: nextId('draft'),
        type: 'root',
        title: mainGoal,
        description: [subject, grade, temporal.dueDateLabel]
          .filter(Boolean)
          .join(' · '),
        parentId: null,
        category: classifyWorkCategory(mainGoal),
        dueDate: temporal.dueDate,
        dueDateLabel: temporal.dueDateLabel,
        source: 'parsed',
        orderIndex: 0,
      });
      draftNodes.push(rootNode);

      const listSegments = splitListPhrase(colonOrListMatch[2]);
      const createdIds: string[] = [];

      listSegments.forEach((seg, idx) => {
        const lead = stripLeadingConnectors(seg);
        const cleanTask = removeTemporalPhrasesFromTask(lead.cleaned) || lead.cleaned;
        if (!cleanTask) return;
        const itemTitle = capitalizeSentenceStart(cleanTask);
        const category = classifyWorkCategory(itemTitle);
        const appInfo = inferSafeTeacherOSApp(itemTitle, {
          subject,
          fullInput: trimmed,
        });
        const itemTemporal = extractTemporalInfo(
          seg,
          normalizeVietnameseText(seg),
          referenceDate
        );
        const node = makeDraftNode({
          id: nextId('draft'),
          type: inferNodeType(itemTitle, category, false, lead.isFinalLead),
          title: itemTitle,
          description: appInfo.appName ? `Công cụ phù hợp: ${appInfo.appName}` : '',
          parentId: rootNode.id,
          category,
          dueDate: itemTemporal.dueDate ?? temporal.dueDate,
          dueDateLabel: itemTemporal.dueDateLabel ?? temporal.dueDateLabel,
          quantityLabel: attachQuantityForSegment(seg),
          suggestedAppId: appInfo.appId,
          suggestedAppName: appInfo.appName,
          source: 'parsed',
          orderIndex: idx + 1,
        });
        draftNodes.push(node);
        draftEdges.push({
          id: nextId('dedge'),
          source: rootNode.id,
          target: node.id,
          edgeType: 'parent',
          sourceKind: 'parsed',
        });

        if (createdIds.length > 0 && lead.hasSequentialLead) {
          draftEdges.push({
            id: nextId('dedge'),
            source: createdIds[createdIds.length - 1],
            target: node.id,
            edgeType: 'dependency',
            label: lead.leadWord ?? 'Sau đó',
            sourceKind: 'parsed',
          });
        }
        createdIds.push(node.id);
      });
    } else {
      // Split by sentence/sequential boundary ("sau đó", "tiếp theo", "rồi", "cuối cùng", "trước khi", ";", ".")
      const marked = trimmed
        .replace(/;\s*/g, '\n')
        .replace(/\.\s+/g, '\n')
        .replace(
          /,?\s+(sau\s+đó|tiếp\s+theo|kế\s+tiếp|cuối\s+cùng|rồi)\b/gi,
          '\n$1'
        );

      const rawClauses = marked
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean);

      // Handle "A trước khi B" inside a single clause
      const expandedClauses: Array<{
        text: string;
        hasSeq: boolean;
        isFinal: boolean;
        seqLabel?: string;
      }> = [];

      for (const clause of rawClauses) {
        const beforeMatch = clause.match(/^(.+?)\s+trước\s+khi\s+(.+)$/i);
        if (beforeMatch) {
          const firstLead = stripLeadingConnectors(beforeMatch[1]);
          const secondLead = stripLeadingConnectors(beforeMatch[2]);
          expandedClauses.push({
            text: firstLead.cleaned,
            hasSeq: firstLead.hasSequentialLead,
            isFinal: false,
            seqLabel: firstLead.leadWord,
          });
          expandedClauses.push({
            text: secondLead.cleaned,
            hasSeq: true,
            isFinal: false,
            seqLabel: 'Trước khi tiếp tục',
          });
          continue;
        }

        const lead = stripLeadingConnectors(clause);
        // Check if single clause actually lists comma-separated actions
        const commaItems =
          rawClauses.length === 1 && /,/.test(lead.cleaned)
            ? splitListPhrase(lead.cleaned)
            : [lead.cleaned];

        commaItems.forEach((sub, subIdx) => {
          const subLead = stripLeadingConnectors(sub);
          if (!subLead.cleaned) return;
          expandedClauses.push({
            text: subLead.cleaned,
            hasSeq: subIdx === 0 ? lead.hasSequentialLead || subLead.hasSequentialLead : subLead.hasSequentialLead,
            isFinal: lead.isFinalLead || subLead.isFinalLead,
            seqLabel: subIdx === 0 ? lead.leadWord ?? subLead.leadWord : subLead.leadWord,
          });
        });
      }

      if (expandedClauses.length >= 2) {
        const cleanedTitles = expandedClauses.map((c) =>
          capitalizeSentenceStart(removeTemporalPhrasesFromTask(c.text) || c.text)
        );
        mainGoal =
          subject && grade
            ? `Kế hoạch ${subject} ${grade}`
            : subject
            ? `Kế hoạch ${subject}`
            : `Kế hoạch: ${cleanedTitles.slice(0, 2).join(' → ')}`;

        const rootNode = makeDraftNode({
          id: nextId('draft'),
          type: 'root',
          title: mainGoal,
          description: [subject, grade, temporal.dueDateLabel]
            .filter(Boolean)
            .join(' · '),
          parentId: null,
          category: 'prepare',
          dueDate: temporal.dueDate,
          dueDateLabel: temporal.dueDateLabel,
          source: 'parsed',
          orderIndex: 0,
        });
        draftNodes.push(rootNode);

        const createdIds: string[] = [];
        expandedClauses.forEach((clause, idx) => {
          const title = cleanedTitles[idx];
          const category = classifyWorkCategory(title);
          const appInfo = inferSafeTeacherOSApp(title, {
            subject,
            fullInput: trimmed,
          });
          const node = makeDraftNode({
            id: nextId('draft'),
            type: inferNodeType(title, category, false, clause.isFinal),
            title,
            description: appInfo.appName ? `Công cụ phù hợp: ${appInfo.appName}` : '',
            parentId: rootNode.id,
            category,
            dueDate: temporal.dueDate,
            dueDateLabel: temporal.dueDateLabel,
            quantityLabel: attachQuantityForSegment(clause.text),
            suggestedAppId: appInfo.appId,
            suggestedAppName: appInfo.appName,
            source: 'parsed',
            orderIndex: idx + 1,
          });
          draftNodes.push(node);
          draftEdges.push({
            id: nextId('dedge'),
            source: rootNode.id,
            target: node.id,
            edgeType: 'parent',
            sourceKind: 'parsed',
          });

          if (createdIds.length > 0 && clause.hasSeq) {
            draftEdges.push({
              id: nextId('dedge'),
              source: createdIds[createdIds.length - 1],
              target: node.id,
              edgeType: 'dependency',
              label: clause.seqLabel ?? 'Sau đó',
              sourceKind: 'parsed',
            });
          }
          createdIds.push(node.id);
        });
      } else {
        // Single vague goal or gibberish / unclear input -> DO NOT invent tasks!
        const singleText = expandedClauses[0]?.text || stripGoalLeadIn(trimmed);
        const meaningful = isLikelyMeaningfulVietnamese(singleText);
        mainGoal = capitalizeSentenceStart(singleText || trimmed);
        isLowDetail = true;
        needsConfirmation = true;

        const category: WorkCategory = meaningful
          ? classifyWorkCategory(mainGoal)
          : 'unclassified';
        const appInfo = meaningful
          ? inferSafeTeacherOSApp(mainGoal, { subject, fullInput: trimmed })
          : {};

        const singleNode = makeDraftNode({
          id: nextId('draft'),
          type: meaningful ? 'task' : 'note',
          title: mainGoal,
          description: meaningful
            ? 'Mô tả mới nêu mục tiêu chung; thầy/cô có thể bổ sung các bước cụ thể hoặc chọn Gợi ý bổ sung.'
            : 'Chưa nhận diện được cấu trúc công việc rõ ràng; giữ nguyên thành 1 node để thầy/cô xác nhận.',
          parentId: null,
          category,
          dueDate: temporal.dueDate,
          dueDateLabel: temporal.dueDateLabel,
          quantityLabel: quantities[0]?.raw,
          suggestedAppId: appInfo.appId,
          suggestedAppName: appInfo.appName,
          source: 'parsed',
          orderIndex: 0,
        });
        draftNodes.push(singleNode);

        if (!meaningful) {
          warnings.push({
            id: 'warn-unclear-input',
            severity: 'warning',
            code: 'unclear_input',
            message:
              'Không phân tích được đầu việc cụ thể từ câu này. Hệ thống giữ nguyên 1 node chưa phân loại (không tự bịa thêm công việc) để thầy/cô tự chỉnh sửa.',
          });
        } else {
          warnings.push({
            id: 'warn-low-detail',
            severity: 'info',
            code: 'low_detail',
            message:
              'Yêu cầu mới nêu mục tiêu tổng quát, chưa liệt kê các đầu việc con. Thầy/cô có thể tự thêm bước hoặc chọn một mẫu "Gợi ý bổ sung" bên dưới.',
          });
        }
      }
    }
  }

  // Deduplication scan against active board nodes
  const duplicateMatches = detectDuplicateDraftNodes(draftNodes, existingBoardNodes);
  const dupByDraftId = new Map(
    duplicateMatches.map((m) => [m.draftNodeId, m.existingNodeId])
  );
  const flaggedNodes = draftNodes.map((n) =>
    dupByDraftId.has(n.id)
      ? { ...n, duplicateOfNodeId: dupByDraftId.get(n.id) }
      : n
  );

  if (duplicateMatches.length > 0) {
    warnings.push({
      id: 'warn-duplicate-nodes',
      severity: 'warning',
      code: 'duplicate_detected',
      message: `Phát hiện ${duplicateMatches.length} node có tiêu đề trùng với sơ đồ hiện có trên bảng (${duplicateMatches
        .slice(0, 2)
        .map((m) => `"${m.title}"`)
        .join(', ')}).`,
    });
  }

  const laidOutNodes = applyDraftAutoLayout(flaggedNodes, draftEdges, layoutMode);

  return {
    rawInput,
    isEmpty: false,
    isLowDetail,
    needsConfirmation,
    metadata: {
      mainGoal,
      subject,
      grade,
      dueDate: temporal.dueDate,
      dueDateLabel: temporal.dueDateLabel,
      timeHint: temporal.timeHint,
      quantities,
    },
    nodes: laidOutNodes,
    edges: draftEdges,
    warnings,
    templateSuggestions,
    duplicateMatches,
  };
}

/**
 * Gắn thêm các node từ template TeacherOS vào bản xem trước,
 * luôn đánh dấu rõ `source: 'template'` ("Gợi ý bổ sung") và không ghi đè node giáo viên đã nhập.
 */
export function appendTemplateSuggestionToDraft(
  draft: SmartWorkflowParseResult,
  templateId: string,
  layoutMode: Exclude<CanvasLayoutMode, 'free'> = 'tree-tb'
): SmartWorkflowParseResult {
  const existingTitles = new Set(
    draft.nodes.map((n) => normalizeVietnameseText(n.title))
  );
  const rootNode = draft.nodes.find((n) => n.type === 'root') ?? draft.nodes[0] ?? null;

  let seq = draft.nodes.length + draft.edges.length + 100;
  const factory = (prefix: string) => `${prefix}-tpl-${seq++}`;

  let rawTemplateNodes: Array<{
    title: string;
    description: string;
    type: CanvasNodeType;
    checklist?: Array<{ id: string; label: string; done: boolean }>;
  }> = [];

  if (templateId === 'tpl-department-meeting') {
    rawTemplateNodes = [
      {
        title: 'Chốt chủ đề & phân công báo cáo viên',
        description: 'Gợi ý bổ sung cho buổi sinh hoạt chuyên môn tổ.',
        type: 'task',
      },
      {
        title: 'Chuẩn bị bài dạy / chuyên đề minh họa',
        description: 'Soạn giáo án minh họa và phiếu dự giờ.',
        type: 'task',
      },
      {
        title: 'Tổ chức thảo luận & ghi biên bản chuyên môn',
        description: 'Tổng hợp góp ý phương pháp giảng dạy của tổ.',
        type: 'checklist',
        checklist: [
          { id: 'shcm-1', label: 'Thống nhất nội dung trọng tâm', done: false },
          { id: 'shcm-2', label: 'Ghi nhận điều chỉnh áp dụng cho các lớp', done: false },
        ],
      },
      {
        title: 'Lưu hồ sơ & Nhật ký chuyên môn',
        description: 'Hoàn tất biên bản buổi sinh hoạt.',
        type: 'milestone',
      },
    ];
  } else {
    const built = instantiateWorkflowTemplate({
      templateId,
      boardId: 'preview-board',
      mode: 'workflow',
      origin: { x: 0, y: 0 },
      idFactory: factory,
    });
    rawTemplateNodes = built.nodes.map((n) => ({
      title: n.title.replace(/^\d+\.\s*/, ''),
      description: n.description ?? '',
      type: n.type,
      checklist: n.checklist,
    }));
  }

  const nextNodes = [...draft.nodes];
  const nextEdges = [...draft.edges];
  let prevTplNodeId: string | null = null;
  let orderCursor = draft.nodes.length;

  for (const item of rawTemplateNodes) {
    if (existingTitles.has(normalizeVietnameseText(item.title))) {
      continue;
    }
    const id = factory('draft');
    const category = classifyWorkCategory(item.title);
    const appInfo = inferSafeTeacherOSApp(item.title, {
      subject: draft.metadata.subject,
      fullInput: draft.rawInput,
    });

    const node = makeDraftNode({
      id,
      type: item.type,
      title: item.title,
      description: item.description,
      parentId: rootNode ? rootNode.id : null,
      category,
      dueDate: draft.metadata.dueDate,
      dueDateLabel: draft.metadata.dueDateLabel,
      suggestedAppId: appInfo.appId,
      suggestedAppName: appInfo.appName,
      source: 'template',
      checklist: item.checklist,
      orderIndex: orderCursor++,
    });
    nextNodes.push(node);
    existingTitles.add(normalizeVietnameseText(item.title));

    if (rootNode) {
      nextEdges.push({
        id: factory('dedge'),
        source: rootNode.id,
        target: node.id,
        edgeType: 'parent',
        sourceKind: 'template',
      });
    }

    if (prevTplNodeId) {
      nextEdges.push({
        id: factory('dedge'),
        source: prevTplNodeId,
        target: node.id,
        edgeType: 'dependency',
        label: 'Gợi ý thứ tự',
        sourceKind: 'template',
      });
    }
    prevTplNodeId = node.id;
  }

  const laidOut = applyDraftAutoLayout(nextNodes, nextEdges, layoutMode);
  return {
    ...draft,
    isLowDetail: false,
    needsConfirmation: false,
    nodes: laidOut,
    edges: nextEdges,
  };
}

export interface BuildCanvasCommitBundleParams {
  draft: SmartWorkflowParseResult;
  boardId: string;
  existingBoardNodes: CanvasNodeRecord[];
  skipDuplicates?: boolean;
  idFactory: (prefix?: string) => string;
}

export interface BuildCanvasCommitBundleResult {
  nodes: CanvasNodeRecord[];
  edges: CanvasEdgeRecord[];
  skippedTitles: string[];
  validationErrors: string[];
}

export function buildCanvasCommitBundle({
  draft,
  boardId,
  existingBoardNodes,
  skipDuplicates = true,
  idFactory,
}: BuildCanvasCommitBundleParams): BuildCanvasCommitBundleResult {
  if (!draft || draft.isEmpty || draft.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      skippedTitles: [],
      validationErrors: ['Chưa có node hợp lệ trong bản xem trước để chèn vào Workspace.'],
    };
  }

  const validation = validateDraftGraph(draft.nodes, draft.edges);
  if (!validation.valid) {
    return {
      nodes: [],
      edges: [],
      skippedTitles: [],
      validationErrors: validation.errors,
    };
  }

  const existingTitleSet = new Set(
    existingBoardNodes
      .map((n) => normalizeVietnameseText(n.title))
      .filter(Boolean)
  );

  const skippedIds = new Set<string>();
  const skippedTitles: string[] = [];
  if (skipDuplicates && existingTitleSet.size > 0) {
    for (const node of draft.nodes) {
      const normTitle = normalizeVietnameseText(node.title);
      if (normTitle && existingTitleSet.has(normTitle)) {
        skippedIds.add(node.id);
        skippedTitles.push(node.title);
      }
    }
  }

  const draftNodeMap = new Map(draft.nodes.map((n) => [n.id, n]));
  const resolveKeptParent = (parentId: string | null): string | null => {
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (!skippedIds.has(cursor)) {
        return cursor;
      }
      visited.add(cursor);
      cursor = draftNodeMap.get(cursor)?.parentId ?? null;
    }
    return null;
  };

  let keptNodes = draft.nodes
    .filter((n) => !skippedIds.has(n.id))
    .map((n) => ({
      ...n,
      parentId: resolveKeptParent(n.parentId),
    }));

  if (keptNodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      skippedTitles,
      validationErrors: [],
    };
  }

  const keptIds = new Set(keptNodes.map((n) => n.id));
  const survivingDraftEdges: SmartWorkflowDraftEdge[] = [];
  const edgeKeys = new Set<string>();

  for (const edge of draft.edges) {
    if (!keptIds.has(edge.target)) continue;
    let resolvedSource = edge.source;
    if (skippedIds.has(resolvedSource)) {
      if (edge.edgeType === 'parent') {
        const ancestor = resolveKeptParent(resolvedSource);
        if (!ancestor) continue;
        resolvedSource = ancestor;
      } else {
        continue;
      }
    }
    if (!keptIds.has(resolvedSource) || resolvedSource === edge.target) continue;
    const key = `${resolvedSource}->${edge.target}:${edge.edgeType}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    survivingDraftEdges.push({
      ...edge,
      source: resolvedSource,
    });
  }

  // Re-run layout cleanly if skipped duplicates changed tree shape
  if (skippedIds.size > 0) {
    keptNodes = applyDraftAutoLayout(keptNodes, survivingDraftEdges, 'tree-tb');
  }

  // Compute safe non-overlapping placement relative to existing board nodes
  const minDraftX = Math.min(...keptNodes.map((n) => n.position.x));
  const minDraftY = Math.min(...keptNodes.map((n) => n.position.y));
  const targetOriginX =
    existingBoardNodes.length > 0
      ? Math.round(Math.min(...existingBoardNodes.map((n) => n.position.x)))
      : 80;
  const targetOriginY =
    existingBoardNodes.length > 0
      ? Math.round(
          Math.max(...existingBoardNodes.map((n) => n.position.y + 152)) + 80
        )
      : 80;

  const idMap = new Map<string, string>();
  for (const node of keptNodes) {
    idMap.set(node.id, idFactory('cnode'));
  }

  const now = new Date().toISOString();
  const committedNodes: CanvasNodeRecord[] = keptNodes.map((node) => {
    const newId = idMap.get(node.id)!;
    const mappedParentId =
      node.type === 'root' || !node.parentId
        ? null
        : idMap.get(node.parentId) ?? null;
    const readyApp = node.suggestedAppId
      ? getReadyAppDefinition(node.suggestedAppId)
      : null;

    const descParts: string[] = [];
    if (node.description.trim()) {
      descParts.push(node.description.trim());
    }
    if (
      node.quantityLabel &&
      !normalizeVietnameseText(node.description).includes(
        normalizeVietnameseText(node.quantityLabel)
      )
    ) {
      descParts.push(`Số lượng: ${node.quantityLabel}`);
    }
    if (node.source === 'template') {
      descParts.push('Gợi ý bổ sung');
    }

    const supportsStatus =
      node.type === 'task' ||
      node.type === 'checklist' ||
      node.type === 'milestone' ||
      node.type === 'workflow';

    return {
      id: newId,
      boardId,
      type: node.type,
      title: node.title.trim() || 'Đầu việc mới',
      description: descParts.join(' · '),
      parentId: mappedParentId,
      position: {
        x: Math.round(targetOriginX + (node.position.x - minDraftX)),
        y: Math.round(targetOriginY + (node.position.y - minDraftY)),
      },
      ...(supportsStatus ? { status: 'todo' as const, priority: node.priority } : {}),
      ...(node.dueDate ? { dueDate: node.dueDate } : {}),
      color: node.color,
      ...(readyApp ? { suggestedAppId: readyApp.id } : {}),
      ...(node.checklist && node.checklist.length > 0
        ? {
            checklist: node.checklist.map((item, idx) => ({
              id: `${newId}-chk-${idx + 1}`,
              label: item.label,
              done: Boolean(item.done),
            })),
          }
        : {}),
      collapsed: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    };
  });

  const committedEdges: CanvasEdgeRecord[] = [];
  for (const edge of survivingDraftEdges) {
    const mappedSource = idMap.get(edge.source);
    const mappedTarget = idMap.get(edge.target);
    if (!mappedSource || !mappedTarget || mappedSource === mappedTarget) continue;
    if (wouldCreateEdgeCycle(committedEdges, mappedSource, mappedTarget, edge.edgeType)) {
      continue;
    }
    committedEdges.push({
      id: idFactory('edge'),
      boardId,
      source: mappedSource,
      target: mappedTarget,
      edgeType: edge.edgeType,
      ...(edge.label ? { label: edge.label } : {}),
    });
  }

  return {
    nodes: committedNodes,
    edges: committedEdges,
    skippedTitles,
    validationErrors: [],
  };
}


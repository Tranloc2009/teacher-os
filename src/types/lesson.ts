export type LessonDuration = 45 | 90;

export type QuestionTier = 'basic' | 'applied' | 'extended';

export type LessonStatus = 'draft' | 'completed';

export interface ActivityTemplate {
  id: string;
  name: string;
  suggestedMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  grouping: string;
  purpose: string;
  steps: string[];
  teacherNote: string;
}

export interface ActivityItem {
  id: string;
  templateId: string | null;
  title: string;
  durationMinutes: number;
  grouping: string;
  instructions: string;
  studentTask: string;
  teacherNote: string;
}

export interface QuestionItem {
  id: string;
  code: string; // Mã riêng do giáo viên quản lý (VD: CB-01, VD-02)
  tier: QuestionTier;
  prompt: string;
  answerGuide: string; // Đáp án tùy chọn
  points: number;
}

export interface TierDistribution {
  basic: number;
  applied: number;
  extended: number;
}

export type WorksheetVariantId = 'A' | 'B' | 'C';

export interface WorksheetVariantConfig {
  id: WorksheetVariantId;
  label: string;
  distribution: TierDistribution;
}

export interface RubricLevelDescriptions {
  needsSupport: string; // Mức 1: Cần cố gắng
  meets: string;        // Mức 2: Đạt
  exceeds: string;      // Mức 3: Tốt
}

export interface RubricCriterion {
  id: string;
  name: string;
  weightPercent: number;
  levels: RubricLevelDescriptions;
}

export interface LessonPack {
  id: string;
  title: string;
  subject: string;
  grade: string;
  duration: LessonDuration;
  objectives: string[];
  activities: ActivityItem[];
  questions: QuestionItem[];
  distribution: TierDistribution;
  worksheetVariants?: WorksheetVariantConfig[];
  rubric: RubricCriterion[];
  status: LessonStatus;
  isDemo: boolean;
  lastStep: number; // 1..5
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

export type MarginPreset = 'narrow' | 'standard' | 'wide' | 'custom';

export interface PrintMarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PrintSettings {
  id: 'default';
  paperSize: 'A4';
  marginPreset: MarginPreset;
  marginsMm: PrintMarginsMm;
  includeTeacherAnswerKey: boolean;
  schoolHeader: string;
  teacherName: string;
  updatedAt: string;
}

export type ResourceType =
  | 'question-template'
  | 'activity-idea'
  | 'reading-passage'
  | 'formula-sheet';

export type ResourceDocumentCategory =
  | 'giao-an'
  | 'de-thi'
  | 'bai-tap'
  | 'dap-an'
  | 'bai-giang'
  | 'slide'
  | 'tham-khao'
  | 'khac';

export interface ResourceSourceFileMeta {
  fileName: string;
  relativePath: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKind: 'opfs' | 'indexeddb' | 'metadata-only';
  fileRecordId: string;
  opfsKey?: string;
  hasOmml?: boolean;
  formulaCount?: number;
  slideCount?: number;
}

export interface ResourceItem {
  id: string;
  title: string;
  type: ResourceType;
  subject: string;
  grade: string;
  tier?: QuestionTier;
  tags: string[];
  content: string;
  answerOrNote: string;
  points?: number;
  suggestedMinutes?: number;
  updatedAt: string;
  documentCategory?: ResourceDocumentCategory;
  chapterTopic?: string;
  classificationConfidence?: number;
  classificationReason?: string;
  sourceFile?: ResourceSourceFileMeta;
}

export type WorkflowPhase = 'pre-class' | 'in-class' | 'post-class';

export interface WorkflowStepItem {
  id: string;
  phase: WorkflowPhase;
  label: string;
  done: boolean;
  targetApp?:
    | 'lesson-studio'
    | 'print-studio'
    | 'resource-vault'
    | 'teaching-journal'
    | 'math-mixer';
  description?: string;
  status?: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string;
  notes?: string;
  linkedResourceId?: string;
}

export interface WorkflowRun {
  id: string;
  title: string;
  description?: string;
  linkedPackId: string; // '' if general
  steps: WorkflowStepItem[];
  canvasBoardId?: string;
  templateId?: string;
  archived?: boolean;
  updatedAt: string;
}

export type PacingRating = 'thieu-gio' | 'vua-khit' | 'du-gio';

export interface JournalEntry {
  id: string;
  packId: string;
  classLabel: string;
  taughtDate: string;
  pacingRating: PacingRating;
  whatWorked: string;
  bottlenecks: string;
  nextAdjustment: string;
  updatedAt: string;
}

import type { MathExamProject } from './mathExam';
import type {
  CanvasBoard,
  CanvasEdgeRecord,
  CanvasNodeRecord,
  CanvasViewSettings,
} from './canvas';

export interface BackupPayload {
  app: 'TeacherOS';
  schemaVersion: 2;
  exportedAt: string;
  settings: PrintSettings;
  lessonPacks: LessonPack[];
  resources?: ResourceItem[];
  workflows?: WorkflowRun[];
  journals?: JournalEntry[];
  mathExams?: MathExamProject[];
  canvasBoards?: CanvasBoard[];
  canvasNodes?: CanvasNodeRecord[];
  canvasEdges?: CanvasEdgeRecord[];
  canvasViewSettings?: CanvasViewSettings[];
}

export interface ValidationErrors {
  [field: string]: string;
}

export const SUBJECT_OPTIONS = [
  'Toán học',
  'Ngữ văn',
  'Tiếng Anh',
  'Khoa học tự nhiên',
  'Vật lí',
  'Hóa học',
  'Sinh học',
  'Lịch sử',
  'Địa lí',
  'Giáo dục công dân',
  'Tin học',
  'Công nghệ',
  'Hoạt động trải nghiệm',
  'Khác',
] as const;

export const GRADE_OPTIONS = [
  'Lớp 1',
  'Lớp 2',
  'Lớp 3',
  'Lớp 4',
  'Lớp 5',
  'Lớp 6',
  'Lớp 7',
  'Lớp 8',
  'Lớp 9',
  'Lớp 10',
  'Lớp 11',
  'Lớp 12',
] as const;

export const TIER_LABELS: Record<QuestionTier, string> = {
  basic: 'Cơ bản',
  applied: 'Vận dụng',
  extended: 'Mở rộng',
};

export const RUBRIC_MIN_CRITERIA = 3;
export const RUBRIC_MAX_CRITERIA = 5;

export const RUBRIC_LEVEL_HEADERS: Array<{
  key: keyof RubricLevelDescriptions;
  label: string;
  scoreHint: string;
}> = [
  { key: 'needsSupport', label: 'Mức 1: Cần cố gắng', scoreHint: 'Chưa đạt yêu cầu' },
  { key: 'meets', label: 'Mức 2: Đạt', scoreHint: 'Đạt chuẩn cơ bản' },
  { key: 'exceeds', label: 'Mức 3: Tốt', scoreHint: 'Vượt mức mong đợi' },
];

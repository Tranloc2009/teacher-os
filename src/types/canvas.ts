import type { AppId } from '../core/appRegistry';

export type CanvasMode = 'workspace' | 'workflow';

export type CanvasNodeType =
  | 'root'
  | 'workspace'
  | 'task'
  | 'lesson'
  | 'resource'
  | 'document'
  | 'checklist'
  | 'note'
  | 'milestone'
  | 'workflow';

export type CanvasTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

export type CanvasPriority = 'low' | 'medium' | 'high';

export type CanvasEdgeType = 'parent' | 'dependency' | 'reference';

export type CanvasEntityKind =
  | 'LessonPack'
  | 'ResourceItem'
  | 'JournalEntry'
  | 'WorkflowRun'
  | 'MathExamProject';

export type CanvasColorKey =
  | 'slate'
  | 'blue'
  | 'indigo'
  | 'teal'
  | 'emerald'
  | 'amber'
  | 'rose';

export interface CanvasEntityRef {
  kind: CanvasEntityKind;
  entityId: string;
  cachedLabel?: string;
  cachedMeta?: string;
}

export interface CanvasChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface CanvasNodeRecord {
  id: string;
  boardId: string;
  type: CanvasNodeType;
  title: string;
  description?: string;
  parentId?: string | null;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  status?: CanvasTaskStatus;
  priority?: CanvasPriority;
  dueDate?: string;
  color?: CanvasColorKey;
  icon?: string;
  entityRef?: CanvasEntityRef | null;
  suggestedAppId?: AppId;
  checklist?: CanvasChecklistItem[];
  orderIndex?: number;
  notes?: string;
  linkedResourceId?: string;
  collapsed?: boolean;
  locked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasEdgeRecord {
  id: string;
  boardId: string;
  source: string;
  target: string;
  edgeType: CanvasEdgeType;
  label?: string;
}

export interface CanvasBoard {
  id: string;
  mode: CanvasMode;
  title: string;
  description?: string;
  subject?: string;
  grade?: string;
  linkedWorkflowId?: string;
  linkedPackId?: string;
  templateId?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export type CanvasLayoutMode = 'free' | 'tree-tb' | 'tree-lr' | 'mindmap';

export interface CanvasViewSettings {
  boardId: string;
  viewport: CanvasViewport;
  snapToGrid: boolean;
  showMiniMap: boolean;
  showGrid: boolean;
  focusSubtreeRootId?: string | null;
  layoutMode?: CanvasLayoutMode;
}

export interface CanvasNodeCatalogItem {
  type: CanvasNodeType;
  label: string;
  shortLabel: string;
  description: string;
  category: 'structure' | 'execution' | 'reference';
  defaultColor: CanvasColorKey;
  supportsStatus: boolean;
}

export const CANVAS_NODE_CATALOG: CanvasNodeCatalogItem[] = [
  {
    type: 'root',
    label: 'Chủ đề gốc (Root)',
    shortLabel: 'Root',
    description: 'Nút trung tâm khởi nguồn cho sơ đồ cây hoặc quy trình.',
    category: 'structure',
    defaultColor: 'blue',
    supportsStatus: false,
  },
  {
    type: 'workspace',
    label: 'Nhánh không gian (Branch)',
    shortLabel: 'Nhánh',
    description: 'Nhóm chủ đề, chương học hoặc cụm công việc lớn.',
    category: 'structure',
    defaultColor: 'indigo',
    supportsStatus: false,
  },
  {
    type: 'note',
    label: 'Ghi chú sư phạm',
    shortLabel: 'Ghi chú',
    description: 'Lưu ý nhanh, nhắc nhở lớp học hoặc ý tưởng bài giảng.',
    category: 'structure',
    defaultColor: 'amber',
    supportsStatus: false,
  },
  {
    type: 'task',
    label: 'Nhiệm vụ (Task)',
    shortLabel: 'Nhiệm vụ',
    description: 'Đầu việc cụ thể có trạng thái, mức ưu tiên và hạn hoàn thành.',
    category: 'execution',
    defaultColor: 'blue',
    supportsStatus: true,
  },
  {
    type: 'checklist',
    label: 'Danh mục kiểm (Checklist)',
    shortLabel: 'Checklist',
    description: 'Gồm nhiều đầu mục kiểm tra nhỏ và tự tính tỷ lệ hoàn thành.',
    category: 'execution',
    defaultColor: 'teal',
    supportsStatus: true,
  },
  {
    type: 'milestone',
    label: 'Mốc hoàn thành (Milestone)',
    shortLabel: 'Mốc',
    description: 'Cột mốc kiểm soát tiến độ (VD: Sẵn sàng in A4, Đã lên lớp).',
    category: 'execution',
    defaultColor: 'emerald',
    supportsStatus: true,
  },
  {
    type: 'workflow',
    label: 'Quy trình liên kết',
    shortLabel: 'Quy trình',
    description: 'Liên kết tới một quy trình chuẩn bị tiết dạy từ Workflow Center.',
    category: 'execution',
    defaultColor: 'indigo',
    supportsStatus: true,
  },
  {
    type: 'lesson',
    label: 'Bộ tiết dạy (LessonPack)',
    shortLabel: 'Bài dạy',
    description: 'Tham chiếu trực tiếp tới Bộ tiết dạy trong Lesson Studio.',
    category: 'reference',
    defaultColor: 'blue',
    supportsStatus: false,
  },
  {
    type: 'resource',
    label: 'Học liệu (Resource)',
    shortLabel: 'Học liệu',
    description: 'Tham chiếu tới câu hỏi mẫu, hoạt động, công thức trong Resource Vault.',
    category: 'reference',
    defaultColor: 'teal',
    supportsStatus: false,
  },
  {
    type: 'document',
    label: 'Tài liệu / Đề / Nhật ký',
    shortLabel: 'Tài liệu',
    description: 'Tham chiếu tới Đề Toán hoặc Nhật ký giảng dạy.',
    category: 'reference',
    defaultColor: 'slate',
    supportsStatus: false,
  },
];

export const CANVAS_STATUS_META: Record<
  CanvasTaskStatus,
  { label: string; dotClass: string; badgeClass: string }
> = {
  todo: {
    label: 'Chưa làm',
    dotClass: 'bg-slate-400 dark:bg-slate-500',
    badgeClass:
      'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  },
  in_progress: {
    label: 'Đang làm',
    dotClass: 'bg-blue-600 dark:bg-blue-400',
    badgeClass:
      'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/70 text-blue-800 dark:text-blue-200',
  },
  done: {
    label: 'Hoàn thành',
    dotClass: 'bg-emerald-600 dark:bg-emerald-400',
    badgeClass:
      'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200',
  },
  blocked: {
    label: 'Bị chặn',
    dotClass: 'bg-rose-600 dark:bg-rose-400',
    badgeClass:
      'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/70 text-rose-800 dark:text-rose-200',
  },
};

export const CANVAS_PRIORITY_META: Record<
  CanvasPriority,
  { label: string; textClass: string }
> = {
  low: { label: 'Thấp', textClass: 'text-slate-500 dark:text-slate-400' },
  medium: { label: 'Trung bình', textClass: 'text-amber-700 dark:text-amber-400' },
  high: { label: 'Cao', textClass: 'text-rose-700 dark:text-rose-400' },
};

export const CANVAS_EDGE_META: Record<
  CanvasEdgeType,
  { label: string; description: string }
> = {
  parent: {
    label: 'Cây phân nhánh',
    description: 'Quan hệ cha – con trong sơ đồ cây kiến thức hoặc cấu trúc.',
  },
  dependency: {
    label: 'Phụ thuộc nhiệm vụ',
    description: 'Nhiệm vụ nguồn phải xong trước hoặc kích hoạt nhiệm vụ đích (không vòng lặp).',
  },
  reference: {
    label: 'Liên kết tham khảo',
    description: 'Đường nối tham khảo mềm giữa tài liệu, ghi chú và nhiệm vụ.',
  },
};

export const CANVAS_COLOR_SWATCHES: Array<{
  key: CanvasColorKey;
  label: string;
  headerBg: string;
  accentBorder: string;
  swatchClass: string;
}> = [
  {
    key: 'slate',
    label: 'Xám đá',
    headerBg: 'bg-slate-100/80 dark:bg-slate-800/80',
    accentBorder: 'border-slate-300 dark:border-slate-700',
    swatchClass: 'bg-slate-500',
  },
  {
    key: 'blue',
    label: 'Xanh lam',
    headerBg: 'bg-blue-50/90 dark:bg-blue-950/50',
    accentBorder: 'border-blue-300 dark:border-blue-800',
    swatchClass: 'bg-blue-700',
  },
  {
    key: 'indigo',
    label: 'Chàm',
    headerBg: 'bg-indigo-50/90 dark:bg-indigo-950/50',
    accentBorder: 'border-indigo-300 dark:border-indigo-800',
    swatchClass: 'bg-indigo-600',
  },
  {
    key: 'teal',
    label: 'Xanh ngọc',
    headerBg: 'bg-teal-50/90 dark:bg-teal-950/50',
    accentBorder: 'border-teal-300 dark:border-teal-800',
    swatchClass: 'bg-teal-600',
  },
  {
    key: 'emerald',
    label: 'Lục bảo',
    headerBg: 'bg-emerald-50/90 dark:bg-emerald-950/50',
    accentBorder: 'border-emerald-300 dark:border-emerald-800',
    swatchClass: 'bg-emerald-600',
  },
  {
    key: 'amber',
    label: 'Hổ phách',
    headerBg: 'bg-amber-50/90 dark:bg-amber-950/50',
    accentBorder: 'border-amber-300 dark:border-amber-800',
    swatchClass: 'bg-amber-600',
  },
  {
    key: 'rose',
    label: 'Đỏ san hô',
    headerBg: 'bg-rose-50/90 dark:bg-rose-950/50',
    accentBorder: 'border-rose-300 dark:border-rose-800',
    swatchClass: 'bg-rose-600',
  },
];

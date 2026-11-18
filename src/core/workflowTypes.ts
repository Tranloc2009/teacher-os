import { AppId } from './appRegistry';
import { CanvasColorKey, CanvasNodeType, CanvasPriority, CanvasTaskStatus } from '../types/canvas';

export type WorkCategoryV2 =
  | 'prepare'
  | 'execute'
  | 'review'
  | 'complete'
  | 'unclassified';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface AnalyzedField<T> {
  value: T;
  confidence: number;
  sourceText?: string;
}

export interface ParsedSubjectInfo {
  /** Tên môn ngắn gọn chuẩn phổ thông, ví dụ: "Toán", "Văn", "Tiếng Anh" */
  value: string | null;
  /** Tên môn đầy đủ, ví dụ: "Toán học", "Ngữ văn" */
  canonical: string | null;
  confidence: number;
  sourceText?: string;
}

export interface ParsedGradeInfo {
  /** Số khối lớp (1..12) nếu xác định được */
  value: number | null;
  /** Nhãn hiển thị, ví dụ: "Lớp 12", "THPT" */
  label: string | null;
  confidence: number;
  sourceText?: string;
}

export interface ParsedDeadlineInfo {
  /** Chỉ có giá trị ISO YYYY-MM-DD khi đủ ngữ cảnh (ngày cụ thể hoặc "hôm nay"/"ngày mai"/"tuần này"/"tuần sau") */
  isoDate: string | null;
  /** Cụm từ thời gian gốc trong câu, ví dụ: "thứ Sáu", "25/11/2026" */
  text: string | null;
  /** Nhãn thứ nếu có, ví dụ: "Thứ Sáu" */
  weekdayText?: string;
  timeHint?: string;
  needsConfirmation: boolean;
  confidence: number;
  ambiguityReason?: string;
}

export interface ParsedQuantity {
  raw: string;
  value: number;
  unit: string;
  normalizedUnit: string;
}

export interface NegationConstraint {
  id: string;
  rawText: string;
  actionPhrase: string;
  canonicalConcept: string | null;
  negationCue: string;
  confidence: number;
}

export interface AnalyzedTask {
  id: string;
  title: string;
  normalizedTitle: string;
  verbAction: string;
  objectTarget: string;
  canonicalConcept: string;
  category: WorkCategoryV2;
  groupKey: WorkflowGroupKey;
  subSteps: string[];
  quantities: ParsedQuantity[];
  linkedAppId?: AppId;
  linkedAppName?: string;
  priority: CanvasPriority;
  status: CanvasTaskStatus;
  confidence: number;
  sourceText: string;
  sourceOrder: number;
  /** Gợi ý trình tự rõ ràng từ câu văn ("trước", "sau đó", "rồi", "cuối cùng", "trước khi") */
  explicitOrderCue?: string;
  mergedFromTitles?: string[];
}

export type WorkflowDependencyKind = 'explicit' | 'logical';

export interface TaskDependency {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  kind: WorkflowDependencyKind;
  reason: string;
  confidence: number;
}

export type WorkflowGroupKey =
  | 'preparation'
  | 'execution'
  | 'verification'
  | 'completion'
  | 'general';

export interface WorkflowTaskGroup {
  id: string;
  key: WorkflowGroupKey;
  title: string;
  category: WorkCategoryV2;
  taskIds: string[];
  order: number;
}

export interface OptionalTemplateSuggestion {
  id: string;
  title: string;
  subtitle: string;
  badgeLabel: 'Gợi ý bổ sung';
  isOptionalSuggestion: true;
  suggestedSteps: Array<{
    title: string;
    category: WorkCategoryV2;
    linkedAppId?: AppId;
  }>;
}

export interface ParsedWorkflowPlan {
  rawInput: string;
  normalizedInput: string;
  isEmpty: boolean;
  isLowDetail: boolean;
  needsConfirmation: boolean;
  goal: AnalyzedField<string>;
  subject: ParsedSubjectInfo;
  grade: ParsedGradeInfo;
  deadline: ParsedDeadlineInfo;
  tasks: AnalyzedTask[];
  taskGroups: WorkflowTaskGroup[];
  quantities: ParsedQuantity[];
  negations: NegationConstraint[];
  dependencies: TaskDependency[];
  unknowns: string[];
  overallConfidence: number;
  templateSuggestions: OptionalTemplateSuggestion[];
}

export interface MergeSuggestion {
  id: string;
  sourceTaskIds: string[];
  sourceTitles: string[];
  canonicalTitle: string;
  canonicalConcept: string;
  similarityScore: number;
  reason: string;
  mergedSubSteps: string[];
  mergedQuantities: ParsedQuantity[];
  mergedSourceTexts: string[];
}

export interface DuplicateGroup {
  id: string;
  taskIds: string[];
  canonicalConcept: string;
  similarityScore: number;
  reason: string;
}

export interface ParallelTaskLayer {
  level: number;
  taskIds: string[];
  taskTitles: string[];
  canRunInParallel: boolean;
}

export interface TaskChecklistBlueprint {
  taskId: string;
  taskTitle: string;
  items: Array<{
    id: string;
    label: string;
    done: boolean;
  }>;
}

export interface NextRecommendedAction {
  taskId: string;
  title: string;
  category: WorkCategoryV2;
  priority: CanvasPriority;
  reason: string;
  linkedAppId?: AppId;
  linkedAppName?: string;
  blockedByCount: number;
  unlocksCount: number;
}

export interface TreeBlueprintNode {
  id: string;
  kind: 'root' | 'branch' | 'task';
  canvasType: CanvasNodeType;
  title: string;
  description: string;
  parentId: string | null;
  color: CanvasColorKey;
  category: WorkCategoryV2;
  priority: CanvasPriority;
  status?: CanvasTaskStatus;
  linkedAppId?: AppId;
  linkedAppName?: string;
  quantityLabel?: string;
  checklist?: Array<{ id: string; label: string; done: boolean }>;
  confidence: number;
  orderIndex: number;
}

export interface TreeBlueprintEdge {
  id: string;
  source: string;
  target: string;
  edgeType: 'parent' | 'dependency';
  label?: string;
  kind?: WorkflowDependencyKind;
}

export interface WorkflowTreeBlueprint {
  rootNodeId: string;
  nodes: TreeBlueprintNode[];
  edges: TreeBlueprintEdge[];
}

export interface OptimizedWorkflowPlan {
  /** Tham chiếu kế hoạch gốc (không bị mutate) */
  sourcePlan: ParsedWorkflowPlan;
  tasks: AnalyzedTask[];
  groups: WorkflowTaskGroup[];
  dependencies: TaskDependency[];
  topologicalOrder: string[];
  orderedTasks: AnalyzedTask[];
  parallelGroups: ParallelTaskLayer[];
  duplicateGroups: DuplicateGroup[];
  mergeSuggestions: MergeSuggestion[];
  checklists: TaskChecklistBlueprint[];
  nextRecommendedActions: NextRecommendedAction[];
  treeBlueprint: WorkflowTreeBlueprint;
  hasCycle: boolean;
  optimizationSummary: {
    originalTaskCount: number;
    optimizedTaskCount: number;
    mergedGroupCount: number;
    dependencyCount: number;
    parallelLayerCount: number;
    negatedExclusionCount: number;
  };
}

import type { AppId } from '../core/appRegistry';

export type ConnectedWorkflowStageId =
  | 'source'
  | 'select'
  | 'generate'
  | 'review'
  | 'mix'
  | 'print'
  | 'grade'
  | 'summary';

export type ConnectedWorkflowStageStatus =
  | 'not-started'
  | 'in-progress'
  | 'needs-review'
  | 'completed'
  | 'blocked';

export interface WorkflowHistoryEntry {
  id: string;
  timestamp: string;
  stage: ConnectedWorkflowStageId;
  appId: AppId;
  summary: string;
}

/**
 * Shared Workflow Context (Section 8.2) — chỉ lưu stable IDs và metadata nhẹ,
 * tuyệt đối không nhúng file binary hay bản sao lớn vào React state.
 */
export interface ConnectedWorkflowContext {
  workflowId: string;
  title: string;
  resourceId?: string;
  resourceTitle?: string;
  questionSelectionIds: string[];
  examDraftId?: string;
  examDraftTitle?: string;
  examDraftQuestionCount?: number;
  examDraftConfirmedCount?: number;
  examDraftBlockedCount?: number;
  generatedExamId?: string;
  generatedExamTitle?: string;
  examVersionIds: string[];
  examVersionCodes: string[];
  examFormId?: string;
  examFormLabel?: string;
  printedAt?: string;
  gradingSessionId?: string;
  gradingSessionTitle?: string;
  studentClassId?: string;
  gradedSheetCount?: number;
  pendingGradingReviewCount?: number;
  finalizedGradebookCount?: number;
  lastActiveApp: AppId;
  createdAt: string;
  updatedAt: string;
  history: WorkflowHistoryEntry[];
}

export interface WorkflowStageEvaluation {
  id: ConnectedWorkflowStageId;
  order: number;
  label: string;
  shortLabel: string;
  appId: AppId;
  status: ConnectedWorkflowStageStatus;
  detail: string;
  canNavigate: boolean;
}

export interface DashboardNextStepSuggestion {
  id: string;
  priority: number;
  title: string;
  description: string;
  badgeText: string;
  primaryActionLabel: string;
  targetApp: AppId;
  secondaryActionLabel?: string;
  secondaryTargetApp?: AppId;
  examId?: string;
  resourceId?: string;
}

export type UniversalCommandCategory = 'workflow' | 'navigation';

export type UniversalCommandIntent =
  | 'nl-generate-exam'
  | 'open-bank-topic'
  | 'mix-current-exam'
  | 'create-omr-sheet'
  | 'open-latest-grading'
  | 'print-exam-form'
  | 'open-azota-bridge'
  | 'open-app';

export interface ParsedUniversalCommand {
  id: string;
  category: UniversalCommandCategory;
  intent: UniversalCommandIntent;
  title: string;
  subtitle: string;
  badgeText: string;
  targetApp: AppId;
  requiresConfirmation: boolean;
  confirmationTitle?: string;
  confirmationDescription?: string;
  payload: {
    rawCommand: string;
    promptText?: string;
    topicQuery?: string;
    examId?: string;
    resourceId?: string;
    versionCount?: number;
    className?: string;
    formLabel?: string;
    gradingTab?: 'dashboard' | 'sheet-gen' | 'gradebook' | 'export' | 'azota';
  };
}

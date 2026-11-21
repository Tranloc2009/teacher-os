import type { AppId } from '../core/appRegistry';
import type { MathExamStep } from './mathExam';

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

export type WorkflowValidationStatus =
  | 'valid'
  | 'needs-review'
  | 'blocked'
  | 'missing-reference';

export type MathMixerSubView = 'editor' | 'import-doctor' | 'answer-studio';

export type GradingTargetTab =
  | 'dashboard'
  | 'roster'
  | 'sheet-gen'
  | 'upload'
  | 'review'
  | 'gradebook'
  | 'export'
  | 'azota';

export type GeneratorTargetTab =
  | 'dashboard'
  | 'natural-language'
  | 'wizard'
  | 'bank'
  | 'templates';

export interface WorkflowHistoryEntry {
  id: string;
  timestamp: string;
  stage: ConnectedWorkflowStageId;
  appId: AppId;
  summary: string;
}

/**
 * Shared Workflow Context (Phase 1 + Phase 2) — chỉ lưu stable IDs và metadata nhẹ,
 * tuyệt đối không nhúng file binary hay bản sao lớn vào React state.
 */
export interface ConnectedWorkflowContext {
  workflowId: string;
  title: string;
  revision?: number;
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
  currentStep?: ConnectedWorkflowStageId;
  completedSteps?: ConnectedWorkflowStageId[];
  pendingActions?: string[];
  validationStatus?: WorkflowValidationStatus;
  createdAt: string;
  updatedAt: string;
  history: WorkflowHistoryEntry[];
}

/**
 * Multi-workflow persisted store (Phase 2 — Section 4 & 9).
 * Hỗ trợ nhiều quy trình độc lập mà không ghi đè hoặc làm mất phiên cũ.
 */
export interface ConnectedWorkflowStore {
  version: 2;
  activeWorkflowId: string;
  workflows: ConnectedWorkflowContext[];
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

export interface WorkflowMissingReference {
  entityType: 'resource' | 'draft' | 'exam' | 'grading-session';
  requestedId: string;
  label: string;
  recoveryHint: string;
}

export interface WorkflowValidationReport {
  status: WorkflowValidationStatus;
  canMix: boolean;
  canExportOfficial: boolean;
  canGradeOmr: boolean;
  canExportConfirmedGradebook: boolean;
  blockedReasons: string[];
  reviewReasons: string[];
  missingReferences: WorkflowMissingReference[];
  recommendedFixView?: 'import-doctor' | 'answer-studio' | 'exam-generator' | 'resource-vault';
}

export interface SmartActionItem {
  id: string;
  label: string;
  description: string;
  tone: 'primary' | 'warning' | 'blocked' | 'secondary';
  targetApp: AppId;
  targetStep?: MathExamStep;
  targetSubView?: MathMixerSubView;
  targetGeneratorTab?: GeneratorTargetTab;
  targetGradingTab?: GradingTargetTab;
  examId?: string;
  resourceId?: string;
  gradingSessionId?: string;
  examCode?: string;
  className?: string;
  disabled?: boolean;
  blockedReason?: string;
}

export interface SmartActionBarModel {
  validation: WorkflowValidationReport;
  primaryAction: SmartActionItem | null;
  secondaryActions: SmartActionItem[];
  blockedBanner?: {
    title: string;
    reason: string;
    fixAction: SmartActionItem;
  };
  missingReferenceBanner?: {
    title: string;
    detail: string;
    recoveryAction: SmartActionItem;
  };
}

export interface DashboardNextStepSuggestion {
  id: string;
  priority: number;
  title: string;
  description: string;
  badgeText: string;
  primaryActionLabel: string;
  targetApp: AppId;
  targetStep?: MathExamStep;
  targetSubView?: MathMixerSubView;
  targetGradingTab?: GradingTargetTab;
  secondaryActionLabel?: string;
  secondaryTargetApp?: AppId;
  examId?: string;
  resourceId?: string;
  gradingSessionId?: string;
}

export interface ConnectedWorkspaceWorkflowSummary {
  workflow: ConnectedWorkflowContext;
  isActive: boolean;
  stages: WorkflowStageEvaluation[];
  validation: WorkflowValidationReport;
  completedStageCount: number;
  totalStageCount: number;
  resumeLabel: string;
  resumeAction: SmartActionItem;
  fiveStepProgress: Array<{
    key: 'source' | 'generate' | 'review' | 'mix' | 'grade';
    label: string;
    status: ConnectedWorkflowStageStatus;
  }>;
}

export type UniversalCommandCategory = 'workflow' | 'navigation';

export type UniversalCommandIntent =
  | 'nl-generate-exam'
  | 'open-bank-topic'
  | 'mix-current-exam'
  | 'create-omr-sheet'
  | 'open-latest-grading'
  | 'open-grading-review'
  | 'export-confirmed-gradebook'
  | 'print-exam-form'
  | 'open-azota-bridge'
  | 'open-latest-exam'
  | 'open-exam-answer-key'
  | 'open-answer-key-studio'
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
  blockedReason?: string;
  payload: {
    rawCommand: string;
    promptText?: string;
    topicQuery?: string;
    examId?: string;
    examCode?: string;
    resourceId?: string;
    gradingSessionId?: string;
    versionCount?: number;
    className?: string;
    formLabel?: string;
    mixerStep?: MathExamStep;
    mixerSubView?: MathMixerSubView;
    gradingTab?: GradingTargetTab;
  };
}

export interface SupportedUniversalCommandHint {
  example: string;
  description: string;
  category: UniversalCommandCategory;
}

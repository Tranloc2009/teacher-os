import { AppId } from '../core/appRegistry';

export type TutorialActionType = 'info' | 'click' | 'input' | 'custom';

export type TutorialPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right' | 'center';

export type WelcomeDismissAction = 'started' | 'later' | 'skipped';

export interface TutorialStepDef {
  stepId: string;
  title: string;
  description: string;
  /** Primary data-tour-id value, or 'center' for centered dialog steps */
  target: string;
  /** Optional fallback data-tour-id values when primary target is hidden on smaller viewports */
  fallbackTargets?: string[];
  placement: TutorialPlacement;
  actionType: TutorialActionType;
  hint?: string;
  example?: string;
  completionEvent?: string;
  skippable: boolean;
  /** Optional AppId guard — step is skipped automatically if app is missing or not ready */
  requiredAppId?: AppId;
}

export interface TutorialDefinition {
  tutorialId: string;
  version: string;
  applicationId: AppId;
  title: string;
  subtitle: string;
  estimatedMinutes: number;
  completionTitle: string;
  completionMessage: string;
  completionCtaLabel: string;
  steps: TutorialStepDef[];
}

export interface TutorialProgressRecord {
  seen: boolean;
  completed: boolean;
  skipped: boolean;
  currentStepIndex: number;
  version: string;
  updatedAt: string;
}

export interface TutorialPersistenceState {
  schemaVersion: number;
  autoShowEnabled: boolean;
  welcomeSeen: boolean;
  welcomeDismissedAction?: WelcomeDismissAction;
  pausedTutorialId: string | null;
  tutorials: Record<string, TutorialProgressRecord>;
  dismissedHints?: string[];
}

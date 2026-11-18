import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppId } from '../../core/appRegistry';
import {
  completeTutorialState,
  dismissTutorialHintState,
  loadTutorialState,
  markWelcomeAction,
  pauseTutorialState,
  resetTutorialState,
  saveTutorialState,
  shouldAutoShowWelcome,
  skipTutorialEntirelyState,
  startTutorialState,
  updateTutorialStepIndex,
} from '../../core/tutorialPersistence';
import {
  canAdvanceFromStep,
  getTutorialById,
} from '../../core/tutorialRegistry';
import {
  TutorialDefinition,
  TutorialPersistenceState,
  TutorialStepDef,
  WelcomeDismissAction,
} from '../../types/tutorial';

export interface TutorialContextValue {
  persistence: TutorialPersistenceState;
  welcomeOpen: boolean;
  launcherOpen: boolean;
  activeTutorial: TutorialDefinition | null;
  currentStep: TutorialStepDef | null;
  currentStepIndex: number;
  totalSteps: number;
  stepActionCompleted: boolean;
  canAdvanceCurrentStep: boolean;
  openLauncher: () => void;
  closeLauncher: () => void;
  handleWelcomeAction: (action: WelcomeDismissAction) => void;
  startTutorial: (tutorialId: string, options?: { restart?: boolean }) => void;
  resumePausedTutorial: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipStep: () => void;
  pauseTutorial: () => void;
  exitTutorial: () => void;
  completeActiveTutorial: () => void;
  emitTutorialEvent: (eventName: string) => void;
  dismissContextualHint: (tutorialId: string) => void;
  toggleAutoShowWelcome: (enabled: boolean) => void;
  resetAllTutorials: () => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

interface TutorialProviderProps {
  children: ReactNode;
  appReady: boolean;
  activeApp: AppId;
  onNavigateApp: (appId: AppId) => void;
  onCleanupShellOverlays?: () => void;
}

export function TutorialProvider({
  children,
  appReady,
  activeApp,
  onNavigateApp,
  onCleanupShellOverlays,
}: TutorialProviderProps) {
  const [persistence, setPersistence] = useState<TutorialPersistenceState>(() =>
    loadTutorialState()
  );
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [activeTutorialId, setActiveTutorialId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepActionCompleted, setStepActionCompleted] = useState(false);
  const didCheckWelcomeRef = useRef(false);
  const expectedAppRef = useRef<AppId | null>(null);

  const persistAndSet = useCallback(
    (updater: (prev: TutorialPersistenceState) => TutorialPersistenceState) => {
      setPersistence((prev) => {
        const next = updater(prev);
        return saveTutorialState(next);
      });
    },
    []
  );

  // Trigger first-run welcome modal exactly once after initial DB load settles
  useEffect(() => {
    if (!appReady || didCheckWelcomeRef.current) return;
    didCheckWelcomeRef.current = true;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    if (shouldAutoShowWelcome(persistence, search)) {
      setWelcomeOpen(true);
    }
  }, [appReady, persistence]);

  const activeTutorial = useMemo(() => {
    if (!activeTutorialId) return null;
    return getTutorialById(activeTutorialId) ?? null;
  }, [activeTutorialId]);

  const totalSteps = activeTutorial?.steps.length ?? 0;
  const safeIndex =
    totalSteps > 0 ? Math.min(Math.max(0, currentStepIndex), totalSteps - 1) : 0;
  const currentStep = activeTutorial?.steps[safeIndex] ?? null;

  const pauseTutorial = useCallback(() => {
    if (!activeTutorial) {
      setActiveTutorialId(null);
      return;
    }
    expectedAppRef.current = null;
    persistAndSet((prev) =>
      pauseTutorialState(
        prev,
        activeTutorial.tutorialId,
        activeTutorial.version,
        safeIndex
      )
    );
    setActiveTutorialId(null);
    setStepActionCompleted(false);
    onCleanupShellOverlays?.();
  }, [activeTutorial, onCleanupShellOverlays, persistAndSet, safeIndex]);

  // Safety guard: if teacher navigates to a different app while a tutorial is open,
  // pause cleanly instead of leaving a hanging spotlight overlay on an unrelated screen.
  useEffect(() => {
    if (!activeTutorial) {
      expectedAppRef.current = null;
      return;
    }
    if (expectedAppRef.current && activeApp !== expectedAppRef.current) {
      pauseTutorial();
    }
  }, [activeApp, activeTutorial, pauseTutorial]);

  const startTutorial = useCallback(
    (tutorialId: string, options?: { restart?: boolean }) => {
      const def = getTutorialById(tutorialId);
      if (!def || def.steps.length === 0) return;

      const savedRecord = persistence.tutorials[tutorialId];
      const shouldResume =
        !options?.restart &&
        savedRecord &&
        !savedRecord.completed &&
        !savedRecord.skipped &&
        savedRecord.currentStepIndex > 0 &&
        savedRecord.currentStepIndex < def.steps.length;

      const startIdx = shouldResume ? savedRecord.currentStepIndex : 0;

      onCleanupShellOverlays?.();
      setWelcomeOpen(false);
      setLauncherOpen(false);
      setStepActionCompleted(false);

      expectedAppRef.current = def.applicationId;
      if (activeApp !== def.applicationId) {
        onNavigateApp(def.applicationId);
      }

      setActiveTutorialId(def.tutorialId);
      setCurrentStepIndex(startIdx);
      persistAndSet((prev) =>
        startTutorialState(prev, def.tutorialId, def.version, startIdx)
      );
    },
    [
      activeApp,
      onCleanupShellOverlays,
      onNavigateApp,
      persistAndSet,
      persistence.tutorials,
    ]
  );

  const resumePausedTutorial = useCallback(() => {
    if (!persistence.pausedTutorialId) return;
    startTutorial(persistence.pausedTutorialId, { restart: false });
  }, [persistence.pausedTutorialId, startTutorial]);

  const handleWelcomeAction = useCallback(
    (action: WelcomeDismissAction) => {
      setWelcomeOpen(false);
      persistAndSet((prev) => markWelcomeAction(prev, action));
      if (action === 'started') {
        // Start directly at step 0 without resuming stale indices
        const def = getTutorialById('tutorial.desktop');
        if (!def || def.steps.length === 0) return;
        onCleanupShellOverlays?.();
        expectedAppRef.current = def.applicationId;
        if (activeApp !== def.applicationId) {
          onNavigateApp(def.applicationId);
        }
        setActiveTutorialId(def.tutorialId);
        setCurrentStepIndex(0);
        setStepActionCompleted(false);
        persistAndSet((prev) =>
          startTutorialState(markWelcomeAction(prev, 'started'), def.tutorialId, def.version, 0)
        );
      }
    },
    [activeApp, onCleanupShellOverlays, onNavigateApp, persistAndSet]
  );

  const completeActiveTutorial = useCallback(() => {
    if (!activeTutorial) return;
    onCleanupShellOverlays?.();
    expectedAppRef.current = null;
    persistAndSet((prev) =>
      completeTutorialState(
        prev,
        activeTutorial.tutorialId,
        activeTutorial.version,
        Math.max(0, totalSteps - 1)
      )
    );
    setActiveTutorialId(null);
    setCurrentStepIndex(0);
    setStepActionCompleted(false);
  }, [activeTutorial, onCleanupShellOverlays, persistAndSet, totalSteps]);

  const moveToStep = useCallback(
    (targetIdx: number) => {
      if (!activeTutorial) return;
      onCleanupShellOverlays?.();
      if (targetIdx >= totalSteps) {
        completeActiveTutorial();
        return;
      }
      const clamped = Math.max(0, Math.min(targetIdx, totalSteps - 1));
      setCurrentStepIndex(clamped);
      setStepActionCompleted(false);
      persistAndSet((prev) =>
        updateTutorialStepIndex(
          prev,
          activeTutorial.tutorialId,
          activeTutorial.version,
          clamped
        )
      );
    },
    [
      activeTutorial,
      completeActiveTutorial,
      onCleanupShellOverlays,
      persistAndSet,
      totalSteps,
    ]
  );

  const canAdvanceCurrentStep = canAdvanceFromStep(
    currentStep ?? undefined,
    stepActionCompleted
  );

  const nextStep = useCallback(() => {
    if (!activeTutorial || !currentStep) return;
    if (!canAdvanceCurrentStep) return;
    if (safeIndex + 1 >= totalSteps) {
      completeActiveTutorial();
      return;
    }
    moveToStep(safeIndex + 1);
  }, [
    activeTutorial,
    canAdvanceCurrentStep,
    completeActiveTutorial,
    currentStep,
    moveToStep,
    safeIndex,
    totalSteps,
  ]);

  const skipStep = useCallback(() => {
    if (!activeTutorial || !currentStep || !currentStep.skippable) return;
    if (safeIndex + 1 >= totalSteps) {
      completeActiveTutorial();
      return;
    }
    moveToStep(safeIndex + 1);
  }, [
    activeTutorial,
    completeActiveTutorial,
    currentStep,
    moveToStep,
    safeIndex,
    totalSteps,
  ]);

  const prevStep = useCallback(() => {
    if (!activeTutorial || safeIndex <= 0) return;
    moveToStep(safeIndex - 1);
  }, [activeTutorial, moveToStep, safeIndex]);

  const exitTutorial = useCallback(() => {
    if (!activeTutorial) {
      setActiveTutorialId(null);
      return;
    }
    onCleanupShellOverlays?.();
    expectedAppRef.current = null;
    persistAndSet((prev) =>
      skipTutorialEntirelyState(
        prev,
        activeTutorial.tutorialId,
        activeTutorial.version,
        safeIndex
      )
    );
    setActiveTutorialId(null);
    setStepActionCompleted(false);
  }, [activeTutorial, onCleanupShellOverlays, persistAndSet, safeIndex]);

  const emitTutorialEvent = useCallback(
    (eventName: string) => {
      if (!activeTutorial || !currentStep) return;
      if (currentStep.completionEvent === eventName) {
        setStepActionCompleted(true);
      }
    },
    [activeTutorial, currentStep]
  );

  const dismissContextualHint = useCallback(
    (tutorialId: string) => {
      persistAndSet((prev) => dismissTutorialHintState(prev, tutorialId));
    },
    [persistAndSet]
  );

  const toggleAutoShowWelcome = useCallback(
    (enabled: boolean) => {
      persistAndSet((prev) => ({
        ...prev,
        autoShowEnabled: enabled,
      }));
    },
    [persistAndSet]
  );

  const resetAllTutorials = useCallback(() => {
    onCleanupShellOverlays?.();
    expectedAppRef.current = null;
    setActiveTutorialId(null);
    setCurrentStepIndex(0);
    setStepActionCompleted(false);
    setPersistence(resetTutorialState());
  }, [onCleanupShellOverlays]);

  const openLauncher = useCallback(() => {
    setWelcomeOpen(false);
    setLauncherOpen(true);
  }, []);

  const closeLauncher = useCallback(() => {
    setLauncherOpen(false);
  }, []);

  const value = useMemo<TutorialContextValue>(
    () => ({
      persistence,
      welcomeOpen,
      launcherOpen,
      activeTutorial,
      currentStep,
      currentStepIndex: safeIndex,
      totalSteps,
      stepActionCompleted,
      canAdvanceCurrentStep,
      openLauncher,
      closeLauncher,
      handleWelcomeAction,
      startTutorial,
      resumePausedTutorial,
      nextStep,
      prevStep,
      skipStep,
      pauseTutorial,
      exitTutorial,
      completeActiveTutorial,
      emitTutorialEvent,
      dismissContextualHint,
      toggleAutoShowWelcome,
      resetAllTutorials,
    }),
    [
      activeTutorial,
      canAdvanceCurrentStep,
      closeLauncher,
      completeActiveTutorial,
      currentStep,
      dismissContextualHint,
      emitTutorialEvent,
      exitTutorial,
      handleWelcomeAction,
      launcherOpen,
      nextStep,
      openLauncher,
      pauseTutorial,
      persistence,
      prevStep,
      resetAllTutorials,
      resumePausedTutorial,
      safeIndex,
      skipStep,
      startTutorial,
      stepActionCompleted,
      toggleAutoShowWelcome,
      totalSteps,
      welcomeOpen,
    ]
  );

  return (
    <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>
  );
}

export function useOptionalTutorial(): TutorialContextValue | null {
  return useContext(TutorialContext);
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error('useTutorial must be used inside TutorialProvider');
  }
  return ctx;
}

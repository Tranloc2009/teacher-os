import {
  TutorialPersistenceState,
  TutorialProgressRecord,
  WelcomeDismissAction,
} from '../types/tutorial';

export const TUTORIAL_STORAGE_KEY = 'teacheros_academy_state_v1';
export const TUTORIAL_SCHEMA_VERSION = 1;

export interface KeyValueStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getSafeStorage(storage?: KeyValueStorageLike): KeyValueStorageLike | null {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function createDefaultTutorialState(): TutorialPersistenceState {
  return {
    schemaVersion: TUTORIAL_SCHEMA_VERSION,
    autoShowEnabled: true,
    welcomeSeen: false,
    pausedTutorialId: null,
    tutorials: {},
    dismissedHints: [],
  };
}

export function loadTutorialState(storage?: KeyValueStorageLike): TutorialPersistenceState {
  const store = getSafeStorage(storage);
  if (!store) return createDefaultTutorialState();

  try {
    const raw = store.getItem(TUTORIAL_STORAGE_KEY);
    if (!raw) return createDefaultTutorialState();
    const parsed = JSON.parse(raw) as Partial<TutorialPersistenceState> | null;
    if (!parsed || typeof parsed !== 'object') return createDefaultTutorialState();

    const tutorials: Record<string, TutorialProgressRecord> = {};
    if (parsed.tutorials && typeof parsed.tutorials === 'object') {
      for (const [id, rec] of Object.entries(parsed.tutorials)) {
        if (!rec || typeof rec !== 'object') continue;
        tutorials[id] = {
          seen: Boolean(rec.seen),
          completed: Boolean(rec.completed),
          skipped: Boolean(rec.skipped),
          currentStepIndex:
            typeof rec.currentStepIndex === 'number' && rec.currentStepIndex >= 0
              ? Math.floor(rec.currentStepIndex)
              : 0,
          version: typeof rec.version === 'string' ? rec.version : '1.0.0',
          updatedAt:
            typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date().toISOString(),
        };
      }
    }

    const dismissedHints = Array.isArray(parsed.dismissedHints)
      ? parsed.dismissedHints.filter((id): id is string => typeof id === 'string')
      : [];

    return {
      schemaVersion: TUTORIAL_SCHEMA_VERSION,
      autoShowEnabled:
        typeof parsed.autoShowEnabled === 'boolean' ? parsed.autoShowEnabled : true,
      welcomeSeen: Boolean(parsed.welcomeSeen),
      welcomeDismissedAction:
        parsed.welcomeDismissedAction === 'started' ||
        parsed.welcomeDismissedAction === 'later' ||
        parsed.welcomeDismissedAction === 'skipped'
          ? parsed.welcomeDismissedAction
          : undefined,
      pausedTutorialId:
        typeof parsed.pausedTutorialId === 'string' ? parsed.pausedTutorialId : null,
      tutorials,
      dismissedHints,
    };
  } catch {
    return createDefaultTutorialState();
  }
}

export function saveTutorialState(
  state: TutorialPersistenceState,
  storage?: KeyValueStorageLike
): TutorialPersistenceState {
  const store = getSafeStorage(storage);
  if (store) {
    try {
      store.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota / private mode failures cleanly
    }
  }
  return state;
}

export function shouldAutoShowWelcome(
  state: TutorialPersistenceState,
  searchQuery = typeof window !== 'undefined' ? window.location.search : ''
): boolean {
  if (searchQuery) {
    try {
      const params = new URLSearchParams(searchQuery);
      if (params.get('autostart') === '1') {
        return false;
      }
    } catch {
      // Ignore malformed query string
    }
  }
  return state.autoShowEnabled && !state.welcomeSeen;
}

export function markWelcomeAction(
  state: TutorialPersistenceState,
  action: WelcomeDismissAction,
  now = new Date().toISOString()
): TutorialPersistenceState {
  const base: TutorialPersistenceState = {
    ...state,
    welcomeSeen: true,
    welcomeDismissedAction: action,
    autoShowEnabled: action === 'skipped' ? false : state.autoShowEnabled,
  };

  if (action === 'skipped') {
    const existing = state.tutorials['tutorial.desktop'];
    return {
      ...base,
      pausedTutorialId: null,
      tutorials: {
        ...state.tutorials,
        'tutorial.desktop': {
          seen: true,
          completed: existing?.completed ?? false,
          skipped: true,
          currentStepIndex: existing?.currentStepIndex ?? 0,
          version: existing?.version ?? '1.0.0',
          updatedAt: now,
        },
      },
    };
  }

  return base;
}

export function startTutorialState(
  state: TutorialPersistenceState,
  tutorialId: string,
  version: string,
  startIndex = 0,
  now = new Date().toISOString()
): TutorialPersistenceState {
  const safeIndex = Math.max(0, Math.floor(startIndex));
  return {
    ...state,
    welcomeSeen: true,
    pausedTutorialId: state.pausedTutorialId === tutorialId ? null : state.pausedTutorialId,
    tutorials: {
      ...state.tutorials,
      [tutorialId]: {
        seen: true,
        completed: false,
        skipped: false,
        currentStepIndex: safeIndex,
        version,
        updatedAt: now,
      },
    },
  };
}

export function updateTutorialStepIndex(
  state: TutorialPersistenceState,
  tutorialId: string,
  version: string,
  stepIndex: number,
  now = new Date().toISOString()
): TutorialPersistenceState {
  const prev = state.tutorials[tutorialId];
  return {
    ...state,
    tutorials: {
      ...state.tutorials,
      [tutorialId]: {
        seen: true,
        completed: prev?.completed ?? false,
        skipped: false,
        currentStepIndex: Math.max(0, Math.floor(stepIndex)),
        version,
        updatedAt: now,
      },
    },
  };
}

export function pauseTutorialState(
  state: TutorialPersistenceState,
  tutorialId: string,
  version: string,
  stepIndex: number,
  now = new Date().toISOString()
): TutorialPersistenceState {
  const prev = state.tutorials[tutorialId];
  return {
    ...state,
    pausedTutorialId: tutorialId,
    tutorials: {
      ...state.tutorials,
      [tutorialId]: {
        seen: true,
        completed: prev?.completed ?? false,
        skipped: prev?.skipped ?? false,
        currentStepIndex: Math.max(0, Math.floor(stepIndex)),
        version,
        updatedAt: now,
      },
    },
  };
}

export function completeTutorialState(
  state: TutorialPersistenceState,
  tutorialId: string,
  version: string,
  finalStepIndex: number,
  now = new Date().toISOString()
): TutorialPersistenceState {
  return {
    ...state,
    welcomeSeen: true,
    pausedTutorialId: state.pausedTutorialId === tutorialId ? null : state.pausedTutorialId,
    tutorials: {
      ...state.tutorials,
      [tutorialId]: {
        seen: true,
        completed: true,
        skipped: false,
        currentStepIndex: Math.max(0, Math.floor(finalStepIndex)),
        version,
        updatedAt: now,
      },
    },
  };
}

export function skipTutorialEntirelyState(
  state: TutorialPersistenceState,
  tutorialId: string,
  version: string,
  stepIndex: number,
  now = new Date().toISOString()
): TutorialPersistenceState {
  const prev = state.tutorials[tutorialId];
  return {
    ...state,
    welcomeSeen: true,
    pausedTutorialId: state.pausedTutorialId === tutorialId ? null : state.pausedTutorialId,
    tutorials: {
      ...state.tutorials,
      [tutorialId]: {
        seen: true,
        completed: prev?.completed ?? false,
        skipped: true,
        currentStepIndex: Math.max(0, Math.floor(stepIndex)),
        version,
        updatedAt: now,
      },
    },
  };
}

export function dismissTutorialHintState(
  state: TutorialPersistenceState,
  tutorialId: string
): TutorialPersistenceState {
  const prev = state.dismissedHints ?? [];
  if (prev.includes(tutorialId)) return state;
  return {
    ...state,
    dismissedHints: [...prev, tutorialId],
  };
}

export function resetTutorialState(
  storage?: KeyValueStorageLike
): TutorialPersistenceState {
  const fresh = createDefaultTutorialState();
  return saveTutorialState(fresh, storage);
}

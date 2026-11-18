import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_REGISTRY, AppDefinition } from './appRegistry';
import {
  DESKTOP_OVERVIEW_TUTORIAL,
  TUTORIAL_REGISTRY,
  WORKFLOW_CENTER_TUTORIAL,
  WORKSPACE_TUTORIAL,
  canAdvanceFromStep,
  getActiveTutorialSteps,
  getTutorialById,
  getTutorialForApp,
} from './tutorialRegistry';
import {
  dismissTutorialHintState,
  KeyValueStorageLike,
  TUTORIAL_STORAGE_KEY,
  completeTutorialState,
  createDefaultTutorialState,
  loadTutorialState,
  markWelcomeAction,
  pauseTutorialState,
  resetTutorialState,
  saveTutorialState,
  shouldAutoShowWelcome,
  skipTutorialEntirelyState,
  startTutorialState,
  updateTutorialStepIndex,
} from './tutorialPersistence';
import { computeTooltipPosition } from './tutorialPositioning';

function createMemoryStorage(): KeyValueStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test('first-run welcome shows automatically unless already seen, skipped, or autostart=1', () => {
  const initial = createDefaultTutorialState();
  assert.equal(shouldAutoShowWelcome(initial, ''), true);
  assert.equal(shouldAutoShowWelcome(initial, '?autostart=1'), false);

  const afterLater = markWelcomeAction(initial, 'later');
  assert.equal(afterLater.welcomeSeen, true);
  assert.equal(shouldAutoShowWelcome(afterLater, ''), false);

  const afterSkip = markWelcomeAction(initial, 'skipped');
  assert.equal(afterSkip.welcomeSeen, true);
  assert.equal(afterSkip.autoShowEnabled, false);
  assert.equal(afterSkip.tutorials['tutorial.desktop']?.skipped, true);
  assert.equal(shouldAutoShowWelcome(afterSkip, ''), false);
});

test('tutorial persistence handles round-trip, pause/resume, complete, dismissed hints, and corrupted JSON safely', () => {
  const storage = createMemoryStorage();
  storage.setItem(TUTORIAL_STORAGE_KEY, '{broken json');
  const recovered = loadTutorialState(storage);
  assert.equal(recovered.welcomeSeen, false);
  assert.deepEqual(recovered.tutorials, {});
  assert.deepEqual(recovered.dismissedHints, []);

  let state = startTutorialState(recovered, 'tutorial.desktop', '1.0.0', 0);
  state = updateTutorialStepIndex(state, 'tutorial.desktop', '1.0.0', 3);
  state = pauseTutorialState(state, 'tutorial.desktop', '1.0.0', 3);
  state = dismissTutorialHintState(state, 'tutorial.workflow-center');
  state = dismissTutorialHintState(state, 'tutorial.workflow-center');
  assert.deepEqual(state.dismissedHints, ['tutorial.workflow-center']);
  saveTutorialState(state, storage);

  const reloaded = loadTutorialState(storage);
  assert.equal(reloaded.pausedTutorialId, 'tutorial.desktop');
  assert.equal(reloaded.tutorials['tutorial.desktop']?.currentStepIndex, 3);
  assert.equal(reloaded.tutorials['tutorial.desktop']?.completed, false);
  assert.deepEqual(reloaded.dismissedHints, ['tutorial.workflow-center']);

  const completed = completeTutorialState(reloaded, 'tutorial.desktop', '1.0.0', 7);
  assert.equal(completed.pausedTutorialId, null);
  assert.equal(completed.tutorials['tutorial.desktop']?.completed, true);

  const skipped = skipTutorialEntirelyState(state, 'tutorial.desktop', '1.0.0', 2);
  assert.equal(skipped.pausedTutorialId, null);
  assert.equal(skipped.tutorials['tutorial.desktop']?.skipped, true);

  const reset = resetTutorialState(storage);
  assert.equal(reset.welcomeSeen, false);
  assert.deepEqual(reset.dismissedHints, []);
  assert.equal(shouldAutoShowWelcome(reset, ''), true);
});

test('tutorial registry validates all 8 module tutorials, unique stepIds, and app filtering', () => {
  assert.equal(TUTORIAL_REGISTRY.length, 8);

  const tutorialIds = new Set(TUTORIAL_REGISTRY.map((t) => t.tutorialId));
  assert.equal(tutorialIds.size, 8);

  const expectedAppIds = [
    'desktop',
    'lesson-studio',
    'print-studio',
    'workspace',
    'resource-vault',
    'workflow-center',
    'teaching-journal',
    'math-mixer',
  ] as const;

  for (const appId of expectedAppIds) {
    const appTutorial = getTutorialForApp(appId, APP_REGISTRY);
    assert.ok(appTutorial, `Expected tutorial for app ${appId}`);
    assert.ok(appTutorial.steps.length >= 5, `Expected >= 5 steps for ${appId}`);
    const stepIds = new Set(appTutorial.steps.map((s) => s.stepId));
    assert.equal(
      stepIds.size,
      appTutorial.steps.length,
      `Duplicate stepId found in ${appId}`
    );
  }

  const tutorial = getTutorialById('tutorial.desktop', APP_REGISTRY);
  assert.ok(tutorial);
  assert.equal(tutorial.steps.length, 8);
  assert.equal(tutorial.steps[0].stepId, 'desktop-home');
  assert.equal(tutorial.steps[1].actionType, 'click');
  assert.equal(tutorial.steps[7].stepId, 'overview-complete');

  const wfTutorial = getTutorialForApp('workflow-center', APP_REGISTRY);
  assert.ok(wfTutorial);
  assert.equal(wfTutorial.tutorialId, WORKFLOW_CENTER_TUTORIAL.tutorialId);
  assert.equal(wfTutorial.steps.length, 6);
  assert.equal(wfTutorial.steps[1].actionType, 'click');
  assert.equal(wfTutorial.steps[1].completionEvent, 'workflow-task-or-template-used');

  const wsTutorial = getTutorialForApp('workspace', APP_REGISTRY);
  assert.ok(wsTutorial);
  assert.equal(wsTutorial.tutorialId, WORKSPACE_TUTORIAL.tutorialId);
  assert.equal(wsTutorial.steps.length, 5);
  assert.equal(wsTutorial.steps[1].actionType, 'click');
  assert.equal(wsTutorial.steps[1].completionEvent, 'workspace-tree-or-branch-added');

  const disabledApps: AppDefinition[] = APP_REGISTRY.map((a) =>
    a.id === 'workflow-center' ? { ...a, status: 'phase4' } : a
  );
  const filtered = getActiveTutorialSteps(DESKTOP_OVERVIEW_TUTORIAL, disabledApps);
  assert.equal(filtered.length, 7);
  assert.equal(
    filtered.some((s) => s.stepId === 'workflow-center'),
    false
  );
});

test('interaction-based steps across all modules block Next until action completes', () => {
  const infoStep = DESKTOP_OVERVIEW_TUTORIAL.steps[0];
  assert.equal(canAdvanceFromStep(infoStep, false), true);

  for (const tutorial of TUTORIAL_REGISTRY) {
    const clickSteps = tutorial.steps.filter((s) => s.actionType === 'click');
    assert.ok(
      clickSteps.length >= 1,
      `Expected at least one interactive click step in ${tutorial.tutorialId}`
    );
    for (const clickStep of clickSteps) {
      assert.ok(
        Boolean(clickStep.completionEvent),
        `Missing completionEvent on ${clickStep.stepId}`
      );
      assert.equal(canAdvanceFromStep(clickStep, false), false);
      assert.equal(canAdvanceFromStep(clickStep, true), true);
    }
  }
});

test('tooltip positioning avoids overlapping target rect and clamps within desktop & mobile viewports', () => {
  const topButton = { top: 10, left: 160, width: 110, height: 34 };
  const desktopPos = computeTooltipPosition({
    targetRect: topButton,
    tooltipWidth: 376,
    tooltipHeight: 240,
    viewport: { width: 1280, height: 800 },
    preferredPlacement: 'bottom',
  });
  assert.equal(desktopPos.resolvedPlacement, 'bottom');
  assert.ok(desktopPos.top >= topButton.top + topButton.height + 8);
  assert.ok(desktopPos.left >= 12 && desktopPos.left + 376 <= 1280 - 12);

  // Mobile edge clamp near right corner
  const mobileRightBtn = { top: 520, left: 310, width: 64, height: 40 };
  const mobilePos = computeTooltipPosition({
    targetRect: mobileRightBtn,
    tooltipWidth: 376,
    tooltipHeight: 240,
    viewport: { width: 390, height: 844 },
    preferredPlacement: 'auto',
  });
  assert.ok(mobilePos.left >= 12);
  assert.ok(mobilePos.top >= 12);
  assert.ok(mobilePos.top + 240 <= 844 - 12);

  // Null target falls back cleanly to center
  const fallbackPos = computeTooltipPosition({
    targetRect: null,
    tooltipWidth: 360,
    tooltipHeight: 240,
    viewport: { width: 390, height: 844 },
    preferredPlacement: 'bottom',
  });
  assert.equal(fallbackPos.resolvedPlacement, 'center');
  assert.equal(fallbackPos.centeredFallback, true);
});

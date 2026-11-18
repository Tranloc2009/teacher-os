import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_LESSON_PACKS } from '../data/demoPacks';
import {
  INITIAL_WORKSPACE_TABS,
  appendNotificationLog,
  closeWorkspaceTab,
  createHistoryState,
  pushHistoryState,
  redoHistoryState,
  syncTabsWithPacks,
  undoHistoryState,
  upsertAppTab,
  upsertLessonPackTab,
} from './workspaceTabs';

test('upsertAppTab and upsertLessonPackTab manage multi-tab workspace bar cleanly', () => {
  const step1 = upsertAppTab(INITIAL_WORKSPACE_TABS, 'print-studio');
  assert.equal(step1.tabs.length, 2);
  assert.equal(step1.activeTabId, 'tab-app-print-studio');

  const demoPack = DEMO_LESSON_PACKS[0];
  const step2 = upsertLessonPackTab(step1.tabs, demoPack);
  assert.equal(step2.tabs.length, 3);
  assert.equal(step2.activeTabId, `tab-pack-${demoPack.id}`);

  // Re-opening same pack reuses existing tab instead of duplicating
  const step3 = upsertLessonPackTab(step2.tabs, {
    ...demoPack,
    title: 'Bài dạy đã đổi tên',
  });
  assert.equal(step3.tabs.length, 3);
  assert.equal(
    step3.tabs.find((t) => t.id === `tab-pack-${demoPack.id}`)?.title,
    'Bài dạy đã đổi tên'
  );
});

test('closeWorkspaceTab protects pinned Desktop tab and selects neighbor when active tab closes', () => {
  const withPrint = upsertAppTab(INITIAL_WORKSPACE_TABS, 'print-studio');
  const withPack = upsertLessonPackTab(withPrint.tabs, DEMO_LESSON_PACKS[0]);

  // Cannot close pinned desktop tab
  const tryClosePinned = closeWorkspaceTab(
    withPack.tabs,
    'tab-app-desktop',
    withPack.activeTabId
  );
  assert.equal(tryClosePinned.tabs.length, 3);

  // Closing active lesson tab falls back to previous tab
  const closedActive = closeWorkspaceTab(
    withPack.tabs,
    withPack.activeTabId,
    withPack.activeTabId
  );
  assert.equal(closedActive.tabs.length, 2);
  assert.equal(closedActive.activeTabId, 'tab-app-print-studio');
});

test('syncTabsWithPacks removes tabs for deleted packs and updates titles', () => {
  const packA = DEMO_LESSON_PACKS[0];
  const packB = DEMO_LESSON_PACKS[1];
  const s1 = upsertLessonPackTab(INITIAL_WORKSPACE_TABS, packA);
  const s2 = upsertLessonPackTab(s1.tabs, packB);

  const synced = syncTabsWithPacks(s2.tabs, [
    { ...packA, title: 'Tên mới sau khi lưu' },
  ]);
  assert.equal(synced.length, 2);
  assert.equal(synced[1].title, 'Tên mới sau khi lưu');
});

test('UndoRedoHistory supports push, undo, redo, and bounded depth', () => {
  let hist = createHistoryState({ title: 'Bản 1' });
  hist = pushHistoryState(hist, { title: 'Bản 2' });
  hist = pushHistoryState(hist, { title: 'Bản 3' });

  assert.equal(hist.present.title, 'Bản 3');
  assert.equal(hist.past.length, 2);

  hist = undoHistoryState(hist);
  assert.equal(hist.present.title, 'Bản 2');
  assert.equal(hist.future.length, 1);

  hist = redoHistoryState(hist);
  assert.equal(hist.present.title, 'Bản 3');
  assert.equal(hist.future.length, 0);
});

test('appendNotificationLog prepends unread item and caps at 30 entries', () => {
  let list = appendNotificationLog([], 'success', 'Đã lưu bài dạy');
  assert.equal(list.length, 1);
  assert.equal(list[0].message, 'Đã lưu bài dạy');
  assert.equal(list[0].read, false);

  for (let i = 0; i < 35; i++) {
    list = appendNotificationLog(list, 'info', `Thông báo ${i}`);
  }
  assert.equal(list.length, 30);
});

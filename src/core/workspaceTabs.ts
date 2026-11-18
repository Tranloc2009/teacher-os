import { LessonPack } from '../types/lesson';
import { AppId, getAppById } from './appRegistry';

export interface WorkspaceTab {
  id: string;
  kind: 'app' | 'lesson';
  appId: AppId;
  packId?: string;
  title: string;
  pinned?: boolean;
}

export type AutosaveState = 'saved' | 'saving' | 'dirty' | 'error';

export interface InternalNotificationItem {
  id: string;
  tone: 'success' | 'info' | 'error';
  message: string;
  timestamp: string;
  read: boolean;
}

export interface UndoRedoHistory<T> {
  past: T[];
  present: T;
  future: T[];
}

export const INITIAL_WORKSPACE_TABS: WorkspaceTab[] = [
  {
    id: 'tab-app-desktop',
    kind: 'app',
    appId: 'desktop',
    title: 'Desktop Home',
    pinned: true,
  },
];

/**
 * Mở hoặc kích hoạt tab cho một ứng dụng hệ thống (Desktop, Print Studio, Settings, ...).
 */
export function upsertAppTab(
  tabs: WorkspaceTab[],
  appId: AppId
): { tabs: WorkspaceTab[]; activeTabId: string } {
  const tabId = `tab-app-${appId}`;
  const existing = tabs.find((t) => t.id === tabId);
  if (existing) {
    return { tabs, activeTabId: existing.id };
  }
  const appDef = getAppById(appId);
  const newTab: WorkspaceTab = {
    id: tabId,
    kind: 'app',
    appId,
    title: appDef.shortName,
    pinned: appId === 'desktop',
  };
  return {
    tabs: [...tabs, newTab],
    activeTabId: newTab.id,
  };
}

/**
 * Mở hoặc kích hoạt tab cho một Bộ tiết dạy cụ thể trong Lesson Studio.
 */
export function upsertLessonPackTab(
  tabs: WorkspaceTab[],
  pack: LessonPack
): { tabs: WorkspaceTab[]; activeTabId: string } {
  const tabId = `tab-pack-${pack.id}`;
  const cleanTitle = (pack.title || 'Bộ tiết dạy mới').trim();
  const existing = tabs.find((t) => t.id === tabId);
  if (existing) {
    return {
      tabs: tabs.map((t) =>
        t.id === tabId ? { ...t, title: cleanTitle } : t
      ),
      activeTabId: tabId,
    };
  }
  const newTab: WorkspaceTab = {
    id: tabId,
    kind: 'lesson',
    appId: 'lesson-studio',
    packId: pack.id,
    title: cleanTitle,
    pinned: false,
  };
  return {
    tabs: [...tabs, newTab],
    activeTabId: newTab.id,
  };
}

/**
 * Đóng 1 tab đang mở (không đóng tab Desktop được ghim).
 * Trả về danh sách tab mới và tab tiếp theo được chọn.
 */
export function closeWorkspaceTab(
  tabs: WorkspaceTab[],
  targetTabId: string,
  currentActiveTabId: string
): { tabs: WorkspaceTab[]; activeTabId: string } {
  const target = tabs.find((t) => t.id === targetTabId);
  if (!target || target.pinned) {
    return { tabs, activeTabId: currentActiveTabId };
  }
  const idx = tabs.findIndex((t) => t.id === targetTabId);
  const nextTabs = tabs.filter((t) => t.id !== targetTabId);
  if (nextTabs.length === 0) {
    return {
      tabs: INITIAL_WORKSPACE_TABS,
      activeTabId: INITIAL_WORKSPACE_TABS[0].id,
    };
  }
  if (currentActiveTabId !== targetTabId) {
    return { tabs: nextTabs, activeTabId: currentActiveTabId };
  }
  const fallbackIdx = Math.max(0, Math.min(idx - 1, nextTabs.length - 1));
  return {
    tabs: nextTabs,
    activeTabId: nextTabs[fallbackIdx].id,
  };
}

/**
 * Đồng bộ tiêu đề tab khi bộ tiết dạy đổi tên hoặc bị xóa.
 */
export function syncTabsWithPacks(
  tabs: WorkspaceTab[],
  packs: LessonPack[],
  activePack?: LessonPack
): WorkspaceTab[] {
  const map = new Map(packs.map((p) => [p.id, p]));
  if (activePack) {
    map.set(activePack.id, activePack);
  }
  return tabs
    .filter((tab) => {
      if (tab.kind !== 'lesson' || !tab.packId) return true;
      return map.has(tab.packId);
    })
    .map((tab) => {
      if (tab.kind === 'lesson' && tab.packId) {
        const found = map.get(tab.packId);
        if (found) {
          return {
            ...tab,
            title: (found.title || 'Bộ tiết dạy mới').trim(),
          };
        }
      }
      return tab;
    });
}

/**
 * Quản lý ngăn xếp Hoàn tác / Làm lại (Undo / Redo) giới hạn dung lượng.
 */
export function createHistoryState<T>(initial: T): UndoRedoHistory<T> {
  return {
    past: [],
    present: structuredClone(initial),
    future: [],
  };
}

export function pushHistoryState<T>(
  history: UndoRedoHistory<T>,
  next: T,
  maxDepth = 25
): UndoRedoHistory<T> {
  const nextPast = [...history.past, structuredClone(history.present)];
  if (nextPast.length > maxDepth) {
    nextPast.shift();
  }
  return {
    past: nextPast,
    present: structuredClone(next),
    future: [],
  };
}

export function undoHistoryState<T>(
  history: UndoRedoHistory<T>
): UndoRedoHistory<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, -1);
  return {
    past: newPast,
    present: structuredClone(previous),
    future: [structuredClone(history.present), ...history.future],
  };
}

export function redoHistoryState<T>(
  history: UndoRedoHistory<T>
): UndoRedoHistory<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  const newFuture = history.future.slice(1);
  return {
    past: [...history.past, structuredClone(history.present)],
    present: structuredClone(next),
    future: newFuture,
  };
}

/**
 * Thêm bản ghi vào trung tâm thông báo nội bộ (giới hạn 30 mục gần nhất).
 */
export function appendNotificationLog(
  items: InternalNotificationItem[],
  tone: InternalNotificationItem['tone'],
  message: string,
  nowIso = new Date().toISOString()
): InternalNotificationItem[] {
  const entry: InternalNotificationItem = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tone,
    message,
    timestamp: nowIso,
    read: false,
  };
  return [entry, ...items].slice(0, 30);
}

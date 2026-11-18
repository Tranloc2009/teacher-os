import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StorageAccessError,
  classifyStorageError,
  createResilientSessionGuard,
  executeStorageOperation,
  isIndexedDBAvailable,
} from './storageResilience.ts';
import { DEFAULT_PRINT_SETTINGS, createBackupPayload, validateBackupPayload } from './backup.ts';
import type { LessonPack } from '../types/lesson.ts';

function makeSamplePack(id: string, title: string): LessonPack {
  const now = '2026-04-01T08:00:00.000Z';
  return {
    id,
    title,
    subject: 'Ngữ văn',
    grade: 'Lớp 8',
    duration: 45,
    objectives: ['Phân tích được luận điểm và dẫn chứng tiếng Việt có dấu rõ ràng.'],
    activities: [],
    questions: [],
    distribution: { basic: 1, applied: 0, extended: 0 },
    worksheetVariants: [
      { id: 'A', label: 'Phiếu A (Chuẩn)', distribution: { basic: 1, applied: 0, extended: 0 } },
      { id: 'B', label: 'Phiếu B (Cơ bản)', distribution: { basic: 1, applied: 0, extended: 0 } },
      { id: 'C', label: 'Phiếu C (Nâng cao)', distribution: { basic: 1, applied: 0, extended: 0 } },
    ],
    rubric: [
      {
        id: 'rub-1',
        name: 'Nội dung',
        weightPercent: 40,
        levels: { needsSupport: 'Chưa đạt', meets: 'Đạt', exceeds: 'Tốt' },
      },
      {
        id: 'rub-2',
        name: 'Lập luận',
        weightPercent: 30,
        levels: { needsSupport: 'Yếu', meets: 'Khá', exceeds: 'Chặt chẽ' },
      },
      {
        id: 'rub-3',
        name: 'Diễn đạt',
        weightPercent: 30,
        levels: { needsSupport: 'Lủng củng', meets: 'Rõ', exceeds: 'Mạch lạc' },
      },
    ],
    status: 'draft',
    isDemo: false,
    lastStep: 1,
    createdAt: now,
    updatedAt: now,
  };
}

test('isIndexedDBAvailable safely handles missing API or throwing getter', () => {
  assert.equal(isIndexedDBAvailable({}), false);
  assert.equal(isIndexedDBAvailable({ indexedDB: null }), false);
  assert.equal(isIndexedDBAvailable({ indexedDB: { open: () => ({}) } }), true);

  const blockedScope = {};
  Object.defineProperty(blockedScope, 'indexedDB', {
    get() {
      const err = new Error('The operation is insecure.');
      err.name = 'SecurityError';
      throw err;
    },
  });
  assert.equal(isIndexedDBAvailable(blockedScope), false);
});

test('classifyStorageError maps DOM and Dexie IndexedDB errors to Vietnamese guidance', () => {
  const sec = Object.assign(new Error('Access denied for this document'), {
    name: 'SecurityError',
  });
  assert.equal(classifyStorageError(sec).code, 'PERMISSION_BLOCKED');

  const quota = Object.assign(new Error('Quota exceeded'), {
    name: 'QuotaExceededError',
  });
  assert.equal(classifyStorageError(quota).code, 'QUOTA_EXCEEDED');

  const geckoQuota = Object.assign(new Error('Storage limit reached'), {
    name: 'NS_ERROR_DOM_QUOTA_REACHED',
  });
  assert.equal(classifyStorageError(geckoQuota).code, 'QUOTA_EXCEEDED');

  const closed = Object.assign(new Error('Database has been closed'), {
    name: 'DatabaseClosedError',
  });
  assert.equal(classifyStorageError(closed).code, 'CONNECTION_CLOSED');

  const aborted = Object.assign(new Error('Transaction was aborted'), {
    name: 'AbortError',
  });
  assert.equal(classifyStorageError(aborted).code, 'TRANSACTION_ABORTED');

  const version = Object.assign(new Error('Version conflict'), {
    name: 'VersionError',
  });
  assert.equal(classifyStorageError(version).code, 'VERSION_MISMATCH');

  assert.equal(classifyStorageError(new Error('IDB_UNAVAILABLE')).code, 'IDB_UNAVAILABLE');
  assert.equal(classifyStorageError(new Error('Random glitch')).code, 'UNKNOWN_STORAGE_ERROR');
});

test('executeStorageOperation blocks execution when IndexedDB is unavailable and normalizes thrown errors', async () => {
  let called = false;
  await assert.rejects(
    () =>
      executeStorageOperation(
        async () => {
          called = true;
          return 'ok';
        },
        () => false
      ),
    (err: unknown) =>
      err instanceof StorageAccessError && err.info.code === 'IDB_UNAVAILABLE'
  );
  assert.equal(called, false);

  await assert.rejects(
    () =>
      executeStorageOperation(
        async () => {
          const domErr = new Error('Simulated quota full');
          domErr.name = 'QuotaExceededError';
          throw domErr;
        },
        () => true
      ),
    (err: unknown) =>
      err instanceof StorageAccessError && err.info.code === 'QUOTA_EXCEEDED'
  );

  const healthy = await executeStorageOperation(async () => 42, () => true);
  assert.equal(healthy, 42);
});

test('controlled simulation: startup IndexedDB blocked allows temporary mode without losing typed data', async () => {
  const realStoreSnapshot = [makeSamplePack('real-1', 'Dữ liệu thật được bảo vệ')];

  const guard = createResilientSessionGuard(
    {
      async loadAll() {
        const secErr = new Error('Blocked by browser privacy setting');
        secErr.name = 'SecurityError';
        throw secErr;
      },
      async savePack() {
        throw new Error('Should not hit IndexedDB in temporary mode');
      },
    },
    [makeSamplePack('demo-1', '[DEMO] Bộ mẫu tạm thời')],
    DEFAULT_PRINT_SETTINGS
  );

  const initResult = await guard.init();
  assert.equal(initResult.ok, false);
  assert.equal(initResult.error?.code, 'PERMISSION_BLOCKED');

  guard.enterTemporaryMode();
  const draft = makeSamplePack('temp-new', 'Tiết dạy Văn lớp 8: Nghệ thuật lập luận');
  const saveRes = await guard.saveDraft(draft);

  assert.equal(saveRes.error, null);
  assert.equal(saveRes.savedToPersistentStore, false);
  assert.equal(guard.getState().temporaryMode, true);
  assert.equal(
    guard.getState().packs.some((p) => p.title === 'Tiết dạy Văn lớp 8: Nghệ thuật lập luận'),
    true
  );

  // Dữ liệu mô phỏng thật bên ngoài hoàn toàn không bị đụng chạm
  assert.equal(realStoreSnapshot[0].title, 'Dữ liệu thật được bảo vệ');

  // Có thể xuất JSON khẩn cấp từ chế độ tạm thời và vượt qua schema validation
  const backup = createBackupPayload(guard.getState().packs, guard.getState().settings);
  const validated = validateBackupPayload(JSON.stringify(backup));
  assert.equal(validated.valid, true);
});

test('controlled simulation: mid-session write error preserves unsaved draft in memory and does not corrupt existing store', async () => {
  const persistentStore: LessonPack[] = [
    makeSamplePack('existing-1', 'Bộ tiết dạy Toán đã lưu an toàn'),
  ];
  let failNextWrite = true;

  const guard = createResilientSessionGuard(
    {
      async loadAll() {
        return {
          packs: structuredClone(persistentStore),
          settings: DEFAULT_PRINT_SETTINGS,
        };
      },
      async savePack(pack) {
        if (failNextWrite) {
          const quotaErr = new Error('Simulated QuotaExceededError');
          quotaErr.name = 'QuotaExceededError';
          throw quotaErr;
        }
        const idx = persistentStore.findIndex((p) => p.id === pack.id);
        if (idx >= 0) {
          persistentStore[idx] = structuredClone(pack);
        } else {
          persistentStore.unshift(structuredClone(pack));
        }
        return structuredClone(pack);
      },
    },
    [],
    DEFAULT_PRINT_SETTINGS
  );

  const initRes = await guard.init();
  assert.equal(initRes.ok, true);

  // Người dùng sửa nội dung và gặp lỗi QuotaExceededError khi lưu
  const editedDraft = makeSamplePack('draft-2', 'Bài đang soạn dở tiếng Việt có dấu ă â ê ô ơ ư đ');
  const failedSave = await guard.saveDraft(editedDraft);

  assert.equal(failedSave.savedToPersistentStore, false);
  assert.equal(failedSave.error?.code, 'QUOTA_EXCEEDED');
  // Nội dung đang nhập vẫn còn nguyên trong session state (không mất dữ liệu!)
  assert.equal(
    guard.getState().packs.find((p) => p.id === 'draft-2')?.title,
    'Bài đang soạn dở tiếng Việt có dấu ă â ê ô ơ ư đ'
  );
  // Kho lưu trữ thật trước đó không bị hỏng
  assert.equal(persistentStore.length, 1);
  assert.equal(persistentStore[0].title, 'Bộ tiết dạy Toán đã lưu an toàn');

  // Khi dung lượng được giải phóng và người dùng bấm Thử lưu lại
  failNextWrite = false;
  const retrySave = await guard.saveDraft(editedDraft);
  assert.equal(retrySave.savedToPersistentStore, true);
  assert.equal(retrySave.error, null);
  assert.equal(persistentStore.length, 2);
});

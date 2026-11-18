import {
  BackupPayload,
  JournalEntry,
  LessonPack,
  PrintSettings,
  ResourceItem,
  WorkflowRun,
} from '../types/lesson';
import { createBackupPayload } from './backup';

export type StorageErrorCode =
  | 'IDB_UNAVAILABLE'
  | 'PERMISSION_BLOCKED'
  | 'QUOTA_EXCEEDED'
  | 'CONNECTION_CLOSED'
  | 'TRANSACTION_ABORTED'
  | 'VERSION_MISMATCH'
  | 'UNKNOWN_STORAGE_ERROR';

export interface StorageFailureInfo {
  code: StorageErrorCode;
  title: string;
  message: string;
  guidance: string;
  originalName?: string;
}

export class StorageAccessError extends Error {
  readonly info: StorageFailureInfo;

  constructor(info: StorageFailureInfo, cause?: unknown) {
    super(info.message);
    this.name = 'StorageAccessError';
    this.info = info;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function extractErrorDetails(err: unknown): { name: string; message: string } {
  if (err instanceof StorageAccessError) {
    return {
      name: err.info.originalName || err.name,
      message: err.info.message,
    };
  }
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    const inner = rec.inner as Record<string, unknown> | undefined;
    const name =
      (typeof rec.name === 'string' && rec.name) ||
      (inner && typeof inner.name === 'string' ? inner.name : '') ||
      'Error';
    const message =
      (typeof rec.message === 'string' && rec.message) ||
      (inner && typeof inner.message === 'string' ? inner.message : '') ||
      '';
    return { name, message };
  }
  return {
    name: 'Error',
    message: typeof err === 'string' ? err : '',
  };
}

/**
 * Kiểm tra an toàn xem trình duyệt có hỗ trợ và cho phép truy cập IndexedDB hay không.
 * Lưu ý: Ở một số trình duyệt chặn quyền lưu trữ nghiêm ngặt, chỉ riêng việc đọc `globalThis.indexedDB`
 * cũng có thể ném ra SecurityError.
 */
export function isIndexedDBAvailable(scope: unknown = globalThis): boolean {
  try {
    if (!scope || typeof scope !== 'object') return false;
    const idb = (scope as { indexedDB?: unknown }).indexedDB;
    if (!idb || typeof idb !== 'object') return false;
    return typeof (idb as { open?: unknown }).open === 'function';
  } catch {
    return false;
  }
}

/**
 * Chuẩn hóa lỗi IndexedDB / Dexie thành thông báo tiếng Việt rõ ràng để hiển thị cho giáo viên.
 */
export function classifyStorageError(err: unknown): StorageFailureInfo {
  if (err instanceof StorageAccessError) {
    return err.info;
  }

  const { name, message } = extractErrorDetails(err);
  const lower = `${name} ${message}`.toLowerCase();

  if (
    lower.includes('idb_unavailable') ||
    lower.includes('indexeddb not supported') ||
    lower.includes('missingapierror')
  ) {
    return {
      code: 'IDB_UNAVAILABLE',
      title: 'Trình duyệt không hỗ trợ hoặc đã tắt IndexedDB',
      message:
        'Không tìm thấy bộ nhớ cục bộ IndexedDB trên trình duyệt này nên dữ liệu chưa thể tự động lưu.',
      guidance:
        'Bạn có thể tiếp tục ở chế độ tạm thời để soạn, in A4 và tải bản sao lưu JSON trước khi đóng tab.',
      originalName: name,
    };
  }

  if (
    name === 'SecurityError' ||
    lower.includes('securityerror') ||
    lower.includes('permission') ||
    lower.includes('access denied') ||
    lower.includes('the operation is insecure') ||
    lower.includes('blocked') ||
    lower.includes('private mode') ||
    lower.includes('incognito')
  ) {
    return {
      code: 'PERMISSION_BLOCKED',
      title: 'Quyền lưu trữ trình duyệt đang bị chặn',
      message:
        'Trình duyệt đang chặn quyền đọc/ghi IndexedDB (thường gặp ở chế độ ẩn danh, iframe hạn chế hoặc khi tắt dữ liệu trang web).',
      guidance:
        'Hãy kiểm tra cài đặt Site Data / Cookie, mở bằng cửa sổ thường hoặc dùng chế độ tạm thời và tải bản sao lưu JSON.',
      originalName: name,
    };
  }

  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    lower.includes('quota') ||
    lower.includes('storage limit') ||
    lower.includes('disk full')
  ) {
    return {
      code: 'QUOTA_EXCEEDED',
      title: 'Bộ nhớ trình duyệt đã đầy',
      message:
        'Không đủ dung lượng lưu trữ cục bộ (QuotaExceededError) để ghi bộ tiết dạy vào IndexedDB.',
      guidance:
        'Dữ liệu đang nhập vẫn được giữ trên màn hình. Hãy bấm "Xuất JSON khẩn cấp" ngay để không mất bài, sau đó xóa bớt dữ liệu cũ.',
      originalName: name,
    };
  }

  if (
    name === 'InvalidStateError' ||
    name === 'DatabaseClosedError' ||
    lower.includes('database has been closed') ||
    lower.includes('invalidstateerror') ||
    lower.includes('closing')
  ) {
    return {
      code: 'CONNECTION_CLOSED',
      title: 'Kết nối bộ nhớ cục bộ bị gián đoạn',
      message:
        'Kết nối tới IndexedDB đã bị đóng hoặc bị trình duyệt thu hồi giữa phiên làm việc.',
      guidance:
        'Dữ liệu hiện tại vẫn còn trên màn hình. Hãy thử lưu lại hoặc xuất tệp sao lưu JSON.',
      originalName: name,
    };
  }

  if (name === 'VersionError' || lower.includes('versionerror')) {
    return {
      code: 'VERSION_MISMATCH',
      title: 'Xung đột phiên bản dữ liệu trên trình duyệt',
      message:
        'Một tab khác đang mở phiên bản dữ liệu mới hơn hoặc cấu trúc IndexedDB bị xung đột.',
      guidance:
        'Hãy tải tệp sao lưu JSON trước, đóng các tab TeacherOS 2.0 khác rồi thử lại.',
      originalName: name,
    };
  }

  if (name === 'AbortError' || lower.includes('aborterror') || lower.includes('aborted')) {
    return {
      code: 'TRANSACTION_ABORTED',
      title: 'Giao dịch lưu dữ liệu bị hủy ngang',
      message:
        'Thao tác ghi IndexedDB bị hủy trước khi hoàn tất nên thay đổi chưa được xác nhận lưu.',
      guidance:
        'Dữ liệu trên màn hình chưa bị xóa. Vui lòng thử lưu lại hoặc tải bản sao lưu JSON.',
      originalName: name,
    };
  }

  return {
    code: 'UNKNOWN_STORAGE_ERROR',
    title: 'Phát sinh lỗi đọc/ghi bộ nhớ cục bộ',
    message: message
      ? `Không thể hoàn tất thao tác với IndexedDB (${message}).`
      : 'Không thể hoàn tất thao tác đọc/ghi IndexedDB trên trình duyệt này.',
    guidance:
      'Hãy thử lưu lại hoặc xuất bản sao lưu JSON để đảm bảo an toàn cho nội dung đang soạn.',
    originalName: name,
  };
}

/**
 * Thực thi thao tác IndexedDB an toàn: kiểm tra khả năng truy cập trước và chuẩn hóa mọi lỗi phát sinh.
 */
export async function executeStorageOperation<T>(
  operation: () => Promise<T>,
  availabilityCheck: () => boolean = () => isIndexedDBAvailable()
): Promise<T> {
  if (!availabilityCheck()) {
    throw new StorageAccessError(classifyStorageError(new Error('IDB_UNAVAILABLE')));
  }
  try {
    return await operation();
  } catch (err) {
    throw new StorageAccessError(classifyStorageError(err), err);
  }
}

export interface ResilientStorageAdapter {
  loadAll: () => Promise<{ packs: LessonPack[]; settings: PrintSettings }>;
  savePack: (pack: LessonPack) => Promise<LessonPack>;
}

/**
 * Bộ điều phối trạng thái bền vững dùng cho luồng soạn thảo và kiểm thử tự động:
 * khi IndexedDB lỗi đọc/ghi, giữ nguyên bản nháp trong bộ nhớ phiên làm việc và báo lỗi rõ ràng.
 */
export function createResilientSessionGuard(
  adapter: ResilientStorageAdapter,
  fallbackPacks: LessonPack[],
  fallbackSettings: PrintSettings
) {
  let sessionPacks: LessonPack[] = structuredClone(fallbackPacks);
  let sessionSettings: PrintSettings = structuredClone(fallbackSettings);
  let temporaryMode = false;
  let lastError: StorageFailureInfo | null = null;

  return {
    getState() {
      return {
        packs: sessionPacks,
        settings: sessionSettings,
        temporaryMode,
        lastError,
      };
    },
    async init(): Promise<{ ok: boolean; error: StorageFailureInfo | null }> {
      try {
        const loaded = await adapter.loadAll();
        sessionPacks = loaded.packs;
        sessionSettings = loaded.settings;
        temporaryMode = false;
        lastError = null;
        return { ok: true, error: null };
      } catch (err) {
        const info = classifyStorageError(err);
        lastError = info;
        return { ok: false, error: info };
      }
    },
    enterTemporaryMode() {
      temporaryMode = true;
    },
    async saveDraft(draft: LessonPack): Promise<{
      savedToPersistentStore: boolean;
      pack: LessonPack;
      error: StorageFailureInfo | null;
    }> {
      const nextPack: LessonPack = {
        ...structuredClone(draft),
        updatedAt: new Date().toISOString(),
      };

      // Luôn bảo toàn dữ liệu người dùng vừa nhập trong phiên làm việc trước khi thử ghi bền vững
      const upsertSession = (item: LessonPack) => {
        const idx = sessionPacks.findIndex((p) => p.id === item.id);
        if (idx >= 0) {
          sessionPacks = sessionPacks.map((p) => (p.id === item.id ? item : p));
        } else {
          sessionPacks = [item, ...sessionPacks];
        }
      };

      if (temporaryMode) {
        upsertSession(nextPack);
        return { savedToPersistentStore: false, pack: nextPack, error: null };
      }

      try {
        const persisted = await adapter.savePack(nextPack);
        upsertSession(persisted);
        lastError = null;
        return { savedToPersistentStore: true, pack: persisted, error: null };
      } catch (err) {
        const info = classifyStorageError(err);
        lastError = info;
        upsertSession(nextPack);
        return { savedToPersistentStore: false, pack: nextPack, error: info };
      }
    },
  };
}

/**
 * Tải xuống tệp sao lưu JSON chuẩn schema v2 (dùng chung cho Cài đặt và nút Xuất JSON khẩn cấp).
 */
export function exportJsonBackupFile(
  packs: LessonPack[],
  settings: PrintSettings,
  filenamePrefix = 'teacheros-4-backup',
  extras?: {
    resources?: ResourceItem[];
    workflows?: WorkflowRun[];
    journals?: JournalEntry[];
    mathExams?: BackupPayload['mathExams'];
    canvasBoards?: BackupPayload['canvasBoards'];
    canvasNodes?: BackupPayload['canvasNodes'];
    canvasEdges?: BackupPayload['canvasEdges'];
    canvasViewSettings?: BackupPayload['canvasViewSettings'];
  }
): string {
  const payload = createBackupPayload(packs, settings, extras);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `${filenamePrefix}-${dateStamp}.json`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export interface BrowserStorageEstimate {
  supported: boolean;
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
}

/**
 * Ước tính dung lượng IndexedDB / bộ nhớ trình duyệt đang dùng (StorageManager API).
 */
export async function estimateBrowserStorage(): Promise<BrowserStorageEstimate> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.estimate === 'function'
    ) {
      const est = await navigator.storage.estimate();
      const usageBytes = typeof est.usage === 'number' ? est.usage : 0;
      const quotaBytes = typeof est.quota === 'number' && est.quota > 0 ? est.quota : 0;
      const usagePercent =
        quotaBytes > 0 ? Math.min(100, Math.round((usageBytes / quotaBytes) * 10000) / 100) : 0;
      return {
        supported: true,
        usageBytes,
        quotaBytes,
        usagePercent,
      };
    }
  } catch {
    // Fallback below if blocked
  }
  return {
    supported: false,
    usageBytes: 0,
    quotaBytes: 0,
    usagePercent: 0,
  };
}

/**
 * Xuất nhanh 1 bộ tiết dạy thành tệp JSON hợp lệ schema v2 (dùng cho Context Menu chuột phải).
 */
export function exportSinglePackJson(
  pack: LessonPack,
  settings: PrintSettings
): string {
  const safeSlug = (pack.title || 'bo-tiet-day')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return exportJsonBackupFile(
    [pack],
    settings,
    `teacheros-pack-${safeSlug || 'bai-day'}`
  );
}

/**
 * Xuất Bộ bàn giao chuyên môn (Handover Kit .json) theo môn/khối (gồm bộ tiết dạy, học liệu liên kết, quy trình và nhật ký).
 */
export function exportHandoverKitJson(
  scopeLabel: string,
  packs: LessonPack[],
  settings: PrintSettings,
  resources: ResourceItem[],
  workflows: WorkflowRun[],
  journals: JournalEntry[]
): string {
  const safeSlug = (scopeLabel || 'toan-bo')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return exportJsonBackupFile(
    packs,
    settings,
    `teacheros-handover-kit-${safeSlug || 'chuyen-mon'}`,
    { resources, workflows, journals }
  );
}


import { ResourceItem } from '../types/lesson';
import {
  BulkCommitResult,
  DOCUMENT_CATEGORY_LABELS,
  StorageQuotaStatus,
  StoredResourceFileRecord,
} from '../types/resourceBulk';
import { PreparedBulkCommitEntry } from './resourceBulkEngine';

export const OPFS_DIR_NAME = 'teacheros-resource-vault';
export const OPFS_SIZE_THRESHOLD_BYTES = 512 * 1024; // 512 KB

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.storage) &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

export async function estimateStorageQuota(
  pendingBytes = 0
): Promise<StorageQuotaStatus> {
  const opfsSupported = isOpfsSupported();
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return {
      supported: false,
      opfsSupported,
      usageBytes: 0,
      quotaBytes: 0,
      remainingBytes: 0,
      usagePercent: 0,
      warningLevel: 'ok',
    };
  }

  try {
    const est = await navigator.storage.estimate();
    const usageBytes = Math.max(0, est.usage ?? 0);
    const quotaBytes = Math.max(0, est.quota ?? 0);
    const remainingBytes = Math.max(0, quotaBytes - usageBytes);
    const usagePercent =
      quotaBytes > 0 ? Math.min(100, Math.round((usageBytes / quotaBytes) * 100)) : 0;

    let warningLevel: StorageQuotaStatus['warningLevel'] = 'ok';
    let warningMessage: string | undefined;

    if (quotaBytes > 0 && pendingBytes > remainingBytes) {
      warningLevel = 'critical';
      warningMessage = `Không đủ dung lượng lưu trữ cục bộ: đợt nhập cần ${formatBytes(
        pendingBytes
      )}, nhưng trình duyệt chỉ còn trống ${formatBytes(remainingBytes)}. Hãy bỏ bớt tệp hoặc giải phóng bộ nhớ.`;
    } else if (
      quotaBytes > 0 &&
      (remainingBytes < 10 * 1024 * 1024 ||
        usagePercent >= 92 ||
        (pendingBytes > 0 && pendingBytes > remainingBytes * 0.85))
    ) {
      warningLevel = 'critical';
      warningMessage = `Bộ nhớ trình duyệt gần đầy (${usagePercent}% đã dùng, còn ${formatBytes(
        remainingBytes
      )}). Nên sao lưu và dọn bớt tệp lớn trước khi nhập thêm.`;
    } else if (
      quotaBytes > 0 &&
      (usagePercent >= 78 || (pendingBytes > 0 && pendingBytes > remainingBytes * 0.55))
    ) {
      warningLevel = 'warning';
      warningMessage = `Dung lượng lưu trữ đã dùng ${usagePercent}% (còn trống ${formatBytes(
        remainingBytes
      )}). Các tệp lớn sẽ được ưu tiên lưu qua OPFS nếu trình duyệt hỗ trợ.`;
    }

    return {
      supported: true,
      opfsSupported,
      usageBytes,
      quotaBytes,
      remainingBytes,
      usagePercent,
      warningLevel,
      warningMessage,
    };
  } catch {
    return {
      supported: false,
      opfsSupported,
      usageBytes: 0,
      quotaBytes: 0,
      remainingBytes: 0,
      usagePercent: 0,
      warningLevel: 'ok',
    };
  }
}

async function getOpfsVaultDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
  } catch {
    return null;
  }
}

export async function writeBlobToOpfs(
  opfsKey: string,
  payload: Blob
): Promise<boolean> {
  try {
    const dir = await getOpfsVaultDir();
    if (!dir) return false;
    const fileHandle = await dir.getFileHandle(opfsKey, { create: true });
    if (typeof fileHandle.createWritable !== 'function') return false;
    const writable = await fileHandle.createWritable();
    await writable.write(payload);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function readBlobFromOpfs(opfsKey: string): Promise<Blob | null> {
  try {
    const dir = await getOpfsVaultDir();
    if (!dir) return null;
    const fileHandle = await dir.getFileHandle(opfsKey);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function deleteBlobFromOpfs(opfsKey: string): Promise<void> {
  try {
    const dir = await getOpfsVaultDir();
    if (!dir) return;
    await dir.removeEntry(opfsKey);
  } catch {
    // Ignore missing OPFS file
  }
}

export function buildBlobFromEntry(
  candidate: PreparedBulkCommitEntry['candidate']
): Blob | null {
  if (candidate.fileRef) return candidate.fileRef;
  if (candidate.rawBytesRef) {
    const copy = new Uint8Array(candidate.rawBytesRef.byteLength);
    copy.set(candidate.rawBytesRef);
    return new Blob([copy.buffer], {
      type: candidate.mimeType || 'application/octet-stream',
    });
  }
  return null;
}

export async function materializeBulkCommitPayloads(
  entries: PreparedBulkCommitEntry[],
  options: {
    temporaryMode?: boolean;
    opfsThresholdBytes?: number;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<{
  resources: ResourceItem[];
  fileRecords: StoredResourceFileRecord[];
  opfsStoredCount: number;
  indexedDbStoredCount: number;
  errors: string[];
}> {
  const threshold = options.opfsThresholdBytes ?? OPFS_SIZE_THRESHOLD_BYTES;
  const resources: ResourceItem[] = [];
  const fileRecords: StoredResourceFileRecord[] = [];
  const errors: string[] = [];
  let opfsStoredCount = 0;
  let indexedDbStoredCount = 0;
  const now = new Date().toISOString();
  const canOpfs = !options.temporaryMode && isOpfsSupported();

  for (let i = 0; i < entries.length; i++) {
    const { candidate: c, resourceId, fileRecordId } = entries[i];
    const blob = buildBlobFromEntry(c);
    let storageKind: 'opfs' | 'indexeddb' | 'metadata-only' = 'metadata-only';
    let opfsKey: string | undefined;

    if (blob && !options.temporaryMode) {
      if (canOpfs && c.sizeBytes >= threshold) {
        const candidateKey = `${fileRecordId}_${c.sha256.slice(0, 16)}.bin`;
        const ok = await writeBlobToOpfs(candidateKey, blob);
        if (ok) {
          storageKind = 'opfs';
          opfsKey = candidateKey;
          opfsStoredCount += 1;
        }
      }

      if (storageKind !== 'opfs') {
        storageKind = 'indexeddb';
        indexedDbStoredCount += 1;
      }

      fileRecords.push({
        id: fileRecordId,
        resourceId,
        sha256: c.sha256,
        fileName: c.fileName,
        relativePath: c.relativePath,
        mimeType: c.mimeType,
        sizeBytes: c.sizeBytes,
        storageKind,
        opfsKey,
        blob: storageKind === 'indexeddb' ? blob : undefined,
        updatedAt: now,
      });
    } else if (blob && options.temporaryMode) {
      storageKind = 'indexeddb';
      indexedDbStoredCount += 1;
    }

    const catLabel = DOCUMENT_CATEGORY_LABELS[c.editedDocumentCategory];
    const detailNotes: string[] = [];
    if (c.relativePath && c.relativePath !== c.fileName) {
      detailNotes.push(`Thư mục: ${c.relativePath}`);
    } else {
      detailNotes.push(`Tệp gốc: ${c.fileName} (${formatBytes(c.sizeBytes)})`);
    }
    if (c.analysis.hasOmml) {
      detailNotes.push(`Bảo toàn ${c.analysis.formulaCount} công thức toán OMML nguyên bản`);
    }
    if (c.analysis.slideCount !== undefined && c.analysis.slideCount > 0) {
      detailNotes.push(`${c.analysis.slideCount} trang slide`);
    }
    if (c.analysis.sheetNames && c.analysis.sheetNames.length > 0) {
      detailNotes.push(`Bảng tính: ${c.analysis.sheetNames.join(', ')}`);
    }
    if (c.suggestion.reasons.length > 0) {
      detailNotes.push(`Gợi ý phân loại (${Math.round(c.suggestion.confidence * 100)}%): ${c.suggestion.reasons.join('; ')}`);
    }
    if (c.analysis.warnings.length > 0) {
      detailNotes.push(`Lưu ý: ${c.analysis.warnings.join(' | ')}`);
    }

    const snippet = c.analysis.extractedTextSnippet.trim();
    const contentText = snippet
      ? snippet
      : `Tài liệu đính kèm "${c.fileName}" (${catLabel} · ${formatBytes(c.sizeBytes)}).`;

    const resource: ResourceItem = {
      id: resourceId,
      title: c.editedTitle.trim() || c.fileName,
      type: c.editedResourceType,
      subject: c.editedSubject,
      grade: c.editedGrade,
      tier: c.editedResourceType === 'question-template' ? 'applied' : undefined,
      tags: c.editedTags,
      content: contentText,
      answerOrNote: detailNotes.join(' · '),
      points: c.editedResourceType === 'question-template' ? 2 : undefined,
      suggestedMinutes: c.editedResourceType !== 'question-template' ? 10 : undefined,
      updatedAt: now,
      documentCategory: c.editedDocumentCategory,
      chapterTopic: c.editedChapterTopic.trim() || undefined,
      classificationConfidence: c.suggestion.confidence,
      classificationReason: c.suggestion.reasons.join('; '),
      sourceFile: {
        fileName: c.fileName,
        relativePath: c.relativePath,
        extension: c.extension,
        mimeType: c.mimeType,
        sizeBytes: c.sizeBytes,
        sha256: c.sha256,
        storageKind,
        fileRecordId,
        opfsKey,
        hasOmml: c.analysis.hasOmml,
        formulaCount: c.analysis.formulaCount,
        slideCount: c.analysis.slideCount,
      },
    };

    resources.push(resource);
    options.onProgress?.(i + 1, entries.length);
  }

  return {
    resources,
    fileRecords,
    opfsStoredCount,
    indexedDbStoredCount,
    errors,
  };
}

export function createEmptyCommitResult(): BulkCommitResult {
  return {
    importedCount: 0,
    replacedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    opfsStoredCount: 0,
    indexedDbStoredCount: 0,
    errors: [],
    savedResources: [],
  };
}

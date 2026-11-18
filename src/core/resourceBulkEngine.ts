import {
  ResourceDocumentCategory,
  ResourceItem,
  ResourceType,
} from '../types/lesson';
import {
  BulkImportCandidate,
  BulkImportProgress,
  DuplicateResolution,
  ExtractedFileAnalysis,
  ResourceClassificationSuggestion,
  SupportedResourceFormat,
} from '../types/resourceBulk';
import {
  analyzeFileContentSafe,
  classifyResourceFromAnalysis,
} from './resourceClassifier';
import type {
  WorkerAnalyzeRequest,
  WorkerAnalyzeResponse,
  WorkerAnalyzeResultItem,
} from '../workers/resourceBulkWorker';

export interface BulkInputFile {
  tempId?: string;
  fileName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  file?: File;
  bytes?: Uint8Array;
}

export interface BulkBatchController {
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  isPaused: () => boolean;
  isCancelled: () => boolean;
}

export function createBulkBatchController(): BulkBatchController & {
  waitIfPaused: () => Promise<boolean>;
  reset: () => void;
} {
  let paused = false;
  let cancelled = false;
  let resumeResolvers: Array<() => void> = [];

  const flushResolvers = () => {
    const list = resumeResolvers;
    resumeResolvers = [];
    for (const r of list) r();
  };

  return {
    pause() {
      if (!cancelled) paused = true;
    },
    resume() {
      paused = false;
      flushResolvers();
    },
    cancel() {
      cancelled = true;
      paused = false;
      flushResolvers();
    },
    isPaused() {
      return paused;
    },
    isCancelled() {
      return cancelled;
    },
    reset() {
      paused = false;
      cancelled = false;
      flushResolvers();
    },
    async waitIfPaused(): Promise<boolean> {
      if (cancelled) return false;
      while (paused && !cancelled) {
        await new Promise<void>((resolve) => {
          resumeResolvers.push(resolve);
        });
      }
      return !cancelled;
    },
  };
}

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const viewCopy = new Uint8Array(bytes.byteLength);
  viewCopy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', viewCopy.buffer);
  const out = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < out.length; i++) {
    hex += out[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Đọc đệ quy FileSystemEntry để hỗ trợ kéo thả cả thư mục lẫn danh sách nhiều tệp.
 */
async function readEntryFilesRecursive(
  entry: FileSystemEntry,
  prefix = ''
): Promise<BulkInputFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    const rel = prefix ? `${prefix}/${file.name}` : file.name;
    return [
      {
        fileName: file.name,
        relativePath: rel,
        mimeType: file.type || '',
        sizeBytes: file.size,
        file,
      },
    ];
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const allEntries: FileSystemEntry[] = [];
    // readEntries() only returns up to 100 entries per call in Chromium
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!batch || batch.length === 0) break;
      allEntries.push(...batch);
    }
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const collected: BulkInputFile[] = [];
    for (const child of allEntries) {
      const childFiles = await readEntryFilesRecursive(child, nextPrefix);
      collected.push(...childFiles);
    }
    return collected;
  }

  return [];
}

export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<BulkInputFile[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (entries.length > 0) {
    const results: BulkInputFile[] = [];
    for (const entry of entries) {
      const list = await readEntryFilesRecursive(entry, '');
      results.push(...list);
    }
    return results;
  }

  return normalizeBrowserFileList(dataTransfer.files);
}

export function normalizeBrowserFileList(fileList: FileList | File[]): BulkInputFile[] {
  return Array.from(fileList).map((file) => {
    const withPath = file as File & { webkitRelativePath?: string };
    return {
      fileName: file.name,
      relativePath:
        withPath.webkitRelativePath && withPath.webkitRelativePath.trim()
          ? withPath.webkitRelativePath
          : file.name,
      mimeType: file.type || '',
      sizeBytes: file.size,
      file,
    };
  });
}

function createWorkerInstance(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('../workers/resourceBulkWorker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

async function analyzeChunkWithWorker(
  worker: Worker,
  chunk: Array<{
    tempId: string;
    fileName: string;
    relativePath: string;
    mimeType: string;
    file: File;
  }>,
  requestId: string
): Promise<WorkerAnalyzeResultItem[]> {
  return new Promise((resolve, reject) => {
    const handleMessage = (ev: MessageEvent<WorkerAnalyzeResponse>) => {
      if (ev.data?.requestId !== requestId) return;
      cleanup();
      if (ev.data.error) {
        reject(new Error(ev.data.error));
      } else {
        resolve(ev.data.results);
      }
    };
    const handleError = (err: ErrorEvent) => {
      cleanup();
      reject(new Error(err.message || 'Web Worker gặp sự cố khi xử lý tệp.'));
    };
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);

    const payload: WorkerAnalyzeRequest = {
      requestId,
      items: chunk,
    };
    worker.postMessage(payload);
  });
}

async function analyzeSingleItemMainThread(item: BulkInputFile, tempId: string): Promise<{
  tempId: string;
  sizeBytes: number;
  sha256: string;
  format: SupportedResourceFormat;
  safeToStore: boolean;
  blockedReason?: string;
  analysis: ExtractedFileAnalysis;
  suggestion: ResourceClassificationSuggestion;
}> {
  let bytes: Uint8Array;
  if (item.bytes) {
    bytes = item.bytes;
  } else if (item.file) {
    bytes = new Uint8Array(await item.file.arrayBuffer());
  } else {
    bytes = new Uint8Array(0);
  }

  const sha256 = await computeSha256Hex(bytes);
  const analysis = await analyzeFileContentSafe(item.fileName, bytes, item.mimeType);
  const suggestion = classifyResourceFromAnalysis(
    item.fileName,
    item.relativePath,
    analysis
  );
  return {
    tempId,
    sizeBytes: bytes.byteLength,
    sha256,
    format: analysis.format,
    safeToStore: analysis.safeToStore,
    blockedReason: analysis.blockedReason,
    analysis,
    suggestion,
  };
}

export interface BulkProcessOptions {
  existingResources: ResourceItem[];
  chunkSize?: number;
  useWorker?: boolean;
  controller?: ReturnType<typeof createBulkBatchController>;
  onProgress?: (progress: BulkImportProgress) => void;
  onBatchProcessed?: (batchCandidates: BulkImportCandidate[]) => void;
}

export interface BulkProcessResult {
  candidates: BulkImportCandidate[];
  progress: BulkImportProgress;
}

export async function runBulkResourceImportBatch(
  inputs: BulkInputFile[],
  options: BulkProcessOptions
): Promise<BulkProcessResult> {
  const chunkSize = Math.max(1, Math.min(50, options.chunkSize ?? 15));
  const startedAtMs = Date.now();
  const totalFiles = inputs.length;
  const totalBytes = inputs.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

  // Build hash index of existing Resource Vault items
  const existingHashMap = new Map<string, { id: string; title: string }>();
  for (const res of options.existingResources) {
    const hash = res.sourceFile?.sha256;
    if (hash) {
      existingHashMap.set(hash, { id: res.id, title: res.title });
    }
  }

  const batchHashMap = new Map<string, string>(); // sha256 -> first tempId
  const candidates: BulkImportCandidate[] = [];

  let processedFiles = 0;
  let processedBytes = 0;
  let duplicateCount = 0;
  let needsReviewCount = 0;
  let blockedCount = 0;

  const canTryWorker =
    options.useWorker !== false &&
    inputs.every((i) => Boolean(i.file)) &&
    typeof Worker !== 'undefined';
  const worker = canTryWorker ? createWorkerInstance() : null;
  let usedWorker = Boolean(worker);

  const emitProgress = (status: BulkImportProgress['status'], currentFileName?: string) => {
    const elapsedMs = Date.now() - startedAtMs;
    const rate = processedFiles > 0 ? elapsedMs / processedFiles : 0;
    const estimatedRemainingMs =
      processedFiles > 0 && processedFiles < totalFiles
        ? Math.round(rate * (totalFiles - processedFiles))
        : processedFiles >= totalFiles
        ? 0
        : null;
    options.onProgress?.({
      status,
      totalFiles,
      processedFiles,
      totalBytes,
      processedBytes,
      duplicateCount,
      needsReviewCount,
      blockedCount,
      startedAtMs,
      elapsedMs,
      estimatedRemainingMs,
      usedWorker,
      currentFileName,
    });
  };

  emitProgress(totalFiles > 0 ? 'scanning' : 'ready');

  try {
    for (let offset = 0; offset < inputs.length; offset += chunkSize) {
      if (options.controller) {
        if (options.controller.isPaused()) {
          emitProgress('paused');
        }
        const ok = await options.controller.waitIfPaused();
        if (!ok) {
          emitProgress('cancelled');
          return {
            candidates,
            progress: {
              status: 'cancelled',
              totalFiles,
              processedFiles,
              totalBytes,
              processedBytes,
              duplicateCount,
              needsReviewCount,
              blockedCount,
              startedAtMs,
              elapsedMs: Date.now() - startedAtMs,
              estimatedRemainingMs: null,
              usedWorker,
            },
          };
        }
      }

      const slice = inputs.slice(offset, offset + chunkSize);
      const indexedSlice = slice.map((item, idx) => ({
        item,
        tempId: item.tempId || `bulk-${offset + idx}-${Date.now().toString(36)}`,
      }));

      let analyzedResults: Array<{
        tempId: string;
        sizeBytes: number;
        sha256: string;
        format: SupportedResourceFormat;
        safeToStore: boolean;
        blockedReason?: string;
        analysis: ExtractedFileAnalysis;
        suggestion: ResourceClassificationSuggestion;
      }>;

      if (worker && indexedSlice.every((s) => Boolean(s.item.file))) {
        try {
          analyzedResults = await analyzeChunkWithWorker(
            worker,
            indexedSlice.map((s) => ({
              tempId: s.tempId,
              fileName: s.item.fileName,
              relativePath: s.item.relativePath,
              mimeType: s.item.mimeType,
              file: s.item.file!,
            })),
            `req-${offset}-${Date.now()}`
          );
        } catch {
          usedWorker = false;
          analyzedResults = await Promise.all(
            indexedSlice.map((s) => analyzeSingleItemMainThread(s.item, s.tempId))
          );
        }
      } else {
        analyzedResults = [];
        for (const s of indexedSlice) {
          analyzedResults.push(await analyzeSingleItemMainThread(s.item, s.tempId));
        }
      }

      const batchCandidates: BulkImportCandidate[] = [];
      for (let i = 0; i < indexedSlice.length; i++) {
        const input = indexedSlice[i].item;
        const analyzed = analyzedResults[i];
        const existingDup = analyzed.safeToStore
          ? existingHashMap.get(analyzed.sha256)
          : undefined;
        const batchDupTempId = analyzed.safeToStore
          ? batchHashMap.get(analyzed.sha256)
          : undefined;

        if (analyzed.safeToStore && !batchHashMap.has(analyzed.sha256)) {
          batchHashMap.set(analyzed.sha256, analyzed.tempId);
        }

        const isDup = Boolean(existingDup || batchDupTempId);
        if (isDup) duplicateCount += 1;
        if (!analyzed.safeToStore) blockedCount += 1;
        if (analyzed.suggestion.needsManualReview) needsReviewCount += 1;

        const candidate: BulkImportCandidate = {
          tempId: analyzed.tempId,
          fileName: input.fileName,
          relativePath: input.relativePath,
          extension: analyzed.analysis.extension,
          mimeType: input.mimeType || 'application/octet-stream',
          sizeBytes: analyzed.sizeBytes,
          sha256: analyzed.sha256,
          format: analyzed.format,
          safeToStore: analyzed.safeToStore,
          blockedReason: analyzed.blockedReason,
          analysis: analyzed.analysis,
          suggestion: analyzed.suggestion,
          editedTitle: analyzed.suggestion.suggestedTitle,
          editedSubject: analyzed.suggestion.subject,
          editedGrade: analyzed.suggestion.grade,
          editedChapterTopic: analyzed.suggestion.chapterTopic,
          editedDocumentCategory: analyzed.suggestion.documentCategory,
          editedResourceType: analyzed.suggestion.resourceType,
          editedTags: [...analyzed.suggestion.tags],
          duplicateOfExistingId: existingDup?.id,
          duplicateOfExistingTitle: existingDup?.title,
          duplicateOfBatchTempId: batchDupTempId,
          duplicateResolution: isDup ? 'skip' : 'keep-new',
          fileRef: input.file,
          rawBytesRef: input.bytes,
          selected: analyzed.safeToStore && !isDup,
        };

        candidates.push(candidate);
        batchCandidates.push(candidate);
        processedFiles += 1;
        processedBytes += analyzed.sizeBytes;
      }

      options.onBatchProcessed?.(batchCandidates);
      emitProgress(
        processedFiles >= totalFiles ? 'ready' : 'scanning',
        indexedSlice[indexedSlice.length - 1]?.item.fileName
      );

      if (processedFiles < totalFiles) {
        await yieldToMainThread();
      }
    }
  } finally {
    worker?.terminate();
  }

  const finalProgress: BulkImportProgress = {
    status: 'ready',
    totalFiles,
    processedFiles,
    totalBytes,
    processedBytes,
    duplicateCount,
    needsReviewCount,
    blockedCount,
    startedAtMs,
    elapsedMs: Date.now() - startedAtMs,
    estimatedRemainingMs: 0,
    usedWorker,
  };
  options.onProgress?.(finalProgress);

  return { candidates, progress: finalProgress };
}

export interface BulkEditPatch {
  subject?: string;
  grade?: string;
  chapterTopic?: string;
  documentCategory?: ResourceDocumentCategory;
  resourceType?: ResourceType;
  duplicateResolution?: DuplicateResolution;
  addTags?: string[];
}

export function applyBulkEditToCandidates(
  candidates: BulkImportCandidate[],
  targetTempIds: Set<string>,
  patch: BulkEditPatch
): BulkImportCandidate[] {
  return candidates.map((c) => {
    if (!targetTempIds.has(c.tempId)) return c;
    const nextTags = patch.addTags?.length
      ? Array.from(new Set([...c.editedTags, ...patch.addTags]))
      : c.editedTags;
    return {
      ...c,
      editedSubject: patch.subject !== undefined ? patch.subject : c.editedSubject,
      editedGrade: patch.grade !== undefined ? patch.grade : c.editedGrade,
      editedChapterTopic:
        patch.chapterTopic !== undefined ? patch.chapterTopic : c.editedChapterTopic,
      editedDocumentCategory:
        patch.documentCategory !== undefined
          ? patch.documentCategory
          : c.editedDocumentCategory,
      editedResourceType:
        patch.resourceType !== undefined ? patch.resourceType : c.editedResourceType,
      duplicateResolution:
        patch.duplicateResolution !== undefined &&
        (c.duplicateOfExistingId || c.duplicateOfBatchTempId)
          ? patch.duplicateResolution
          : c.duplicateResolution,
      editedTags: nextTags,
    };
  });
}

export interface PreparedBulkCommitEntry {
  candidate: BulkImportCandidate;
  resourceId: string;
  fileRecordId: string;
  isReplacement: boolean;
}

export function planBulkCommitEntries(
  candidates: BulkImportCandidate[],
  idGenerator: (prefix?: string) => string
): {
  entries: PreparedBulkCommitEntry[];
  skippedCount: number;
  blockedCount: number;
} {
  const entries: PreparedBulkCommitEntry[] = [];
  let skippedCount = 0;
  let blockedCount = 0;

  for (const c of candidates) {
    if (!c.safeToStore) {
      blockedCount += 1;
      continue;
    }
    if (c.duplicateResolution === 'skip') {
      skippedCount += 1;
      continue;
    }
    const isReplacement =
      c.duplicateResolution === 'replace' && Boolean(c.duplicateOfExistingId);
    const resourceId = isReplacement
      ? c.duplicateOfExistingId!
      : idGenerator('res');
    const fileRecordId = idGenerator('rfile');

    entries.push({
      candidate: c,
      resourceId,
      fileRecordId,
      isReplacement,
    });
  }

  return { entries, skippedCount, blockedCount };
}

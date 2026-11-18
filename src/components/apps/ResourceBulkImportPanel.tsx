import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import { Button } from '../ui/DesignSystem';
import {
  GRADE_OPTIONS,
  ResourceDocumentCategory,
  ResourceItem,
  SUBJECT_OPTIONS,
} from '../../types/lesson';
import {
  BulkImportCandidate,
  BulkImportProgress,
  DOCUMENT_CATEGORY_LABELS,
  DuplicateResolution,
  StorageQuotaStatus,
  StoredResourceFileRecord,
} from '../../types/resourceBulk';
import {
  BulkInputFile,
  applyBulkEditToCandidates,
  collectFilesFromDataTransfer,
  createBulkBatchController,
  normalizeBrowserFileList,
  planBulkCommitEntries,
  runBulkResourceImportBatch,
} from '../../core/resourceBulkEngine';
import {
  UNKNOWN_GRADE_LABEL,
  UNKNOWN_SUBJECT_LABEL,
} from '../../core/resourceClassifier';
import {
  estimateStorageQuota,
  formatBytes,
  materializeBulkCommitPayloads,
} from '../../core/resourceStorage';
import { createId } from '../../db/database';

interface ResourceBulkImportPanelProps {
  existingResources: ResourceItem[];
  temporaryMode?: boolean;
  onCommitResources: (
    items: ResourceItem[],
    fileRecords: StoredResourceFileRecord[]
  ) => Promise<void>;
  onClose: () => void;
  onCompletedSummary?: (summary: string) => void;
}

type PreviewFilterTab =
  | 'all'
  | 'ready'
  | 'needs-review'
  | 'duplicate'
  | 'blocked';

const PAGE_SIZE = 50;

const SUBJECT_CHOICES = [UNKNOWN_SUBJECT_LABEL, ...SUBJECT_OPTIONS];
const GRADE_CHOICES = [UNKNOWN_GRADE_LABEL, ...GRADE_OPTIONS];
const CATEGORY_KEYS = Object.keys(DOCUMENT_CATEGORY_LABELS) as ResourceDocumentCategory[];

function mapDocCategoryToResourceType(
  category: ResourceDocumentCategory
): ResourceItem['type'] {
  switch (category) {
    case 'de-thi':
    case 'bai-tap':
    case 'dap-an':
      return 'question-template';
    case 'giao-an':
    case 'slide':
      return 'activity-idea';
    case 'bai-giang':
      return 'reading-passage';
    case 'tham-khao':
    case 'khac':
    default:
      return 'formula-sheet';
  }
}

export function ResourceBulkImportPanel({
  existingResources,
  temporaryMode = false,
  onCommitResources,
  onClose,
  onCompletedSummary,
}: ResourceBulkImportPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [candidates, setCandidates] = useState<BulkImportCandidate[]>([]);
  const [progress, setProgress] = useState<BulkImportProgress>({
    status: 'idle',
    totalFiles: 0,
    processedFiles: 0,
    totalBytes: 0,
    processedBytes: 0,
    duplicateCount: 0,
    needsReviewCount: 0,
    blockedCount: 0,
    startedAtMs: 0,
    elapsedMs: 0,
    estimatedRemainingMs: null,
    usedWorker: false,
  });
  const [quota, setQuota] = useState<StorageQuotaStatus | null>(null);
  const [filterTab, setFilterTab] = useState<PreviewFilterTab>('all');
  const [page, setPage] = useState(0);
  const [commitProgress, setCommitProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Bulk edit bar state
  const [bulkSubject, setBulkSubject] = useState<string>('');
  const [bulkGrade, setBulkGrade] = useState<string>('');
  const [bulkChapter, setBulkChapter] = useState<string>('');
  const [bulkCategory, setBulkCategory] = useState<string>('');
  const [bulkDupResolution, setBulkDupResolution] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef(createBulkBatchController());
  const folderInputProps: Record<string, string> = {
    webkitdirectory: '',
    directory: '',
  };

  useEffect(() => {
    void estimateStorageQuota(0).then(setQuota);
    return () => {
      controllerRef.current.cancel();
    };
  }, []);

  const totalPendingBytes = useMemo(
    () =>
      candidates
        .filter((c) => c.safeToStore && c.duplicateResolution !== 'skip')
        .reduce((sum, c) => sum + c.sizeBytes, 0),
    [candidates]
  );

  useEffect(() => {
    void estimateStorageQuota(totalPendingBytes).then(setQuota);
  }, [totalPendingBytes]);

  const startBatchScan = async (inputs: BulkInputFile[]) => {
    if (inputs.length === 0) return;
    setErrorBanner(null);
    controllerRef.current.reset();
    setCandidates([]);
    setFilterTab('all');
    setPage(0);

    const estBytes = inputs.reduce((s, f) => s + (f.sizeBytes || 0), 0);
    const q = await estimateStorageQuota(estBytes);
    setQuota(q);

    try {
      const result = await runBulkResourceImportBatch(inputs, {
        existingResources,
        chunkSize: 15,
        useWorker: true,
        controller: controllerRef.current,
        onProgress: (nextProg) => {
          setProgress(nextProg);
        },
        onBatchProcessed: (batchItems) => {
          setCandidates((prev) => [...prev, ...batchItems]);
        },
      });
      setCandidates(result.candidates);
      setProgress(result.progress);
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Không thể phân tích lô tệp vừa chọn.'
      );
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const collected = await collectFilesFromDataTransfer(e.dataTransfer);
    await startBatchScan(collected);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const normalized = normalizeBrowserFileList(files);
    e.target.value = '';
    await startBatchScan(normalized);
  };

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (filterTab === 'blocked') return !c.safeToStore;
      if (filterTab === 'duplicate') {
        return Boolean(c.duplicateOfExistingId || c.duplicateOfBatchTempId);
      }
      if (filterTab === 'needs-review') {
        return c.safeToStore && c.suggestion.needsManualReview;
      }
      if (filterTab === 'ready') {
        return c.safeToStore && c.duplicateResolution !== 'skip';
      }
      return true;
    });
  }, [candidates, filterTab]);

  const pageCount = Math.max(1, Math.ceil(filteredCandidates.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedCandidates = useMemo(
    () =>
      filteredCandidates.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filteredCandidates, safePage]
  );

  const selectedIds = useMemo(
    () => new Set(candidates.filter((c) => c.selected).map((c) => c.tempId)),
    [candidates]
  );

  const readyToImportCount = useMemo(
    () =>
      candidates.filter((c) => c.safeToStore && c.duplicateResolution !== 'skip')
        .length,
    [candidates]
  );

  const toggleSelectAllVisible = () => {
    const visibleIds = new Set(pagedCandidates.map((c) => c.tempId));
    const allVisibleSelected =
      pagedCandidates.length > 0 && pagedCandidates.every((c) => c.selected);
    setCandidates((prev) =>
      prev.map((c) =>
        visibleIds.has(c.tempId) ? { ...c, selected: !allVisibleSelected } : c
      )
    );
  };

  const handleApplyBulkEdit = () => {
    if (selectedIds.size === 0) return;
    const cat = bulkCategory
      ? (bulkCategory as ResourceDocumentCategory)
      : undefined;
    setCandidates((prev) =>
      applyBulkEditToCandidates(prev, selectedIds, {
        subject: bulkSubject || undefined,
        grade: bulkGrade || undefined,
        chapterTopic: bulkChapter.trim() ? bulkChapter.trim() : undefined,
        documentCategory: cat,
        resourceType: cat ? mapDocCategoryToResourceType(cat) : undefined,
        duplicateResolution: bulkDupResolution
          ? (bulkDupResolution as DuplicateResolution)
          : undefined,
      })
    );
    setBulkSubject('');
    setBulkGrade('');
    setBulkChapter('');
    setBulkCategory('');
    setBulkDupResolution('');
  };

  const handleConfirmCommit = async () => {
    const plan = planBulkCommitEntries(candidates, createId);
    if (plan.entries.length === 0) {
      setErrorBanner(
        'Chưa có tệp hợp lệ nào được đánh dấu nhập (các tệp trùng đang đặt "Bỏ qua" hoặc định dạng bị chặn).'
      );
      return;
    }

    if (quota?.supported && quota.quotaBytes > 0 && totalPendingBytes > quota.remainingBytes) {
      setErrorBanner(
        `Dung lượng đợt nhập (${formatBytes(totalPendingBytes)}) vượt quá bộ nhớ khả dụng (${formatBytes(quota.remainingBytes)}). Vui lòng bỏ chọn bớt tệp lớn.`
      );
      return;
    }

    setErrorBanner(null);
    setProgress((p) => ({ ...p, status: 'committing' }));
    setCommitProgress({ done: 0, total: plan.entries.length });

    try {
      const materialized = await materializeBulkCommitPayloads(plan.entries, {
        temporaryMode,
        onProgress: (done, total) => setCommitProgress({ done, total }),
      });

      await onCommitResources(materialized.resources, materialized.fileRecords);
      setProgress((p) => ({ ...p, status: 'completed' }));
      setCommitProgress(null);

      const summary = `Đã nhập ${materialized.resources.length} tài liệu (${materialized.opfsStoredCount} OPFS, ${materialized.indexedDbStoredCount} IndexedDB, bỏ qua ${plan.skippedCount} bản trùng).`;
      onCompletedSummary?.(summary);
      setCandidates([]);
      onClose();
    } catch (err) {
      setCommitProgress(null);
      setProgress((p) => ({ ...p, status: 'ready' }));
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Không thể lưu lô tài liệu vào bộ nhớ cục bộ.'
      );
    }
  };

  const isScanning = progress.status === 'scanning' || progress.status === 'paused';
  const percent =
    progress.totalFiles > 0
      ? Math.round((progress.processedFiles / progress.totalFiles) * 100)
      : 0;

  return (
    <section
      aria-label="Nhập hàng loạt thông minh Resource Vault"
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Nhập hàng loạt thông minh (Smart Bulk Import 1.0)
          </h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Kéo thả 100–500 tệp hoặc cả thư mục. Xử lý hoàn toàn ngoại tuyến, tự băm SHA-256 phát hiện trùng và phân loại an toàn không chỉnh sửa tệp gốc.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            controllerRef.current.cancel();
            onClose();
          }}
          aria-label="Đóng khung nhập hàng loạt"
          className="inline-flex items-center gap-1 rounded-[10px] border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Đóng</span>
        </button>
      </div>

      {/* Storage Quota Status */}
      {quota?.supported && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
            quota.warningLevel === 'critical'
              ? 'border-red-300 dark:border-red-800 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-300'
              : quota.warningLevel === 'warning'
              ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
              : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {quota.warningLevel !== 'ok' && (
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {quota.warningMessage ||
                `Bộ nhớ khả dụng: còn trống ${formatBytes(quota.remainingBytes)} / ${formatBytes(quota.quotaBytes)} (${quota.opfsSupported ? 'Hỗ trợ OPFS cho tệp lớn' : 'Lưu qua IndexedDB'})`}
            </span>
          </div>
          {totalPendingBytes > 0 && (
            <span className="font-mono-num font-semibold whitespace-nowrap">
              Đợt nhập: {formatBytes(totalPendingBytes)}
            </span>
          )}
        </div>
      )}

      {errorBanner && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs font-medium text-red-800 dark:text-red-300"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorBanner}</span>
        </div>
      )}

      {/* Dropzone */}
      <div
        data-testid="bulk-import-dropzone"
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(e) => void handleDrop(e)}
        className={`rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          isDragging
            ? 'border-blue-600 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/30'
            : 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/30'
        }`}
      >
        <UploadCloud
          className="mx-auto h-8 w-8 text-blue-600 dark:text-blue-400"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
          Kéo thả nhiều tệp hoặc cả thư mục tài liệu vào đây
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Hỗ trợ DOCX (giữ nguyên OMML), PDF, PPTX, XLSX, hình ảnh (PNG/JPG/WEBP/SVG) và tệp đính kèm an toàn
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            aria-label="Chọn nhiều tệp để nhập vào Resource Vault"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            {...folderInputProps}
            aria-label="Chọn cả thư mục để nhập vào Resource Vault"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={progress.status === 'committing'}
          >
            <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Chọn nhiều tệp</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => folderInputRef.current?.click()}
            disabled={progress.status === 'committing'}
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Chọn cả thư mục</span>
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      {progress.totalFiles > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-200">
              <span className="font-semibold">
                {progress.status === 'scanning'
                  ? 'Đang quét & phân tích theo lô'
                  : progress.status === 'paused'
                  ? 'Đang tạm dừng'
                  : progress.status === 'cancelled'
                  ? 'Đã hủy quét'
                  : progress.status === 'committing'
                  ? 'Đang ghi vào thư viện cục bộ'
                  : 'Hoàn tất phân tích'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">
                {progress.processedFiles}/{progress.totalFiles} tệp ({percent}%)
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">{formatBytes(progress.processedBytes)}</span>
              {progress.duplicateCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-amber-700 dark:text-amber-400 font-mono-num">
                    Trùng SHA-256: {progress.duplicateCount}
                  </span>
                </>
              )}
              {progress.needsReviewCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-600 dark:text-slate-400 font-mono-num">
                    Cần kiểm tra: {progress.needsReviewCount}
                  </span>
                </>
              )}
            </div>

            {isScanning && (
              <div className="flex items-center gap-1.5">
                {progress.status === 'paused' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => controllerRef.current.resume()}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tiếp tục</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => controllerRef.current.pause()}
                  >
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tạm dừng</span>
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => controllerRef.current.cancel()}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Hủy</span>
                </Button>
              </div>
            )}
          </div>

          <div
            role="progressbar"
            aria-valuenow={commitProgress ? Math.round((commitProgress.done / Math.max(1, commitProgress.total)) * 100) : percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Tiến trình nhập hàng loạt tài liệu"
            className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
          >
            <div
              className="h-full bg-blue-600 transition-all duration-150"
              style={{
                width: `${
                  commitProgress
                    ? Math.round((commitProgress.done / Math.max(1, commitProgress.total)) * 100)
                    : percent
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Preview Table & Batch Edit */}
      {candidates.length > 0 && (
        <div className="space-y-3">
          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              {(
                [
                  { id: 'all', label: `Tất cả (${candidates.length})` },
                  { id: 'ready', label: `Sẵn sàng nhập (${readyToImportCount})` },
                  {
                    id: 'needs-review',
                    label: `Cần kiểm tra (${candidates.filter((c) => c.safeToStore && c.suggestion.needsManualReview).length})`,
                  },
                  {
                    id: 'duplicate',
                    label: `Trùng SHA-256 (${candidates.filter((c) => c.duplicateOfExistingId || c.duplicateOfBatchTempId).length})`,
                  },
                  {
                    id: 'blocked',
                    label: `Bị chặn (${candidates.filter((c) => !c.safeToStore).length})`,
                  },
                ] as Array<{ id: PreviewFilterTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setFilterTab(tab.id);
                    setPage(0);
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    filterTab === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                controllerRef.current.cancel();
                setCandidates([]);
                setProgress((p) => ({ ...p, status: 'idle', totalFiles: 0, processedFiles: 0 }));
              }}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Xóa danh sách xem trước</span>
            </button>
          </div>

          {/* Bulk Edit Controls */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/35 p-3">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap font-mono-num">
              Sửa hàng loạt ({selectedIds.size} đã chọn):
            </span>
            <select
              aria-label="Sửa hàng loạt môn học"
              value={bulkSubject}
              onChange={(e) => setBulkSubject(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
            >
              <option value="">-- Môn học --</option>
              {SUBJECT_CHOICES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              aria-label="Sửa hàng loạt khối lớp"
              value={bulkGrade}
              onChange={(e) => setBulkGrade(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
            >
              <option value="">-- Khối lớp --</option>
              {GRADE_CHOICES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Sửa hàng loạt chương hoặc chủ đề"
              value={bulkChapter}
              onChange={(e) => setBulkChapter(e.target.value)}
              placeholder="Chương / Chủ đề..."
              className="w-36 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
            />
            <select
              aria-label="Sửa hàng loạt loại tài liệu"
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
            >
              <option value="">-- Loại tài liệu --</option>
              {CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_CATEGORY_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              aria-label="Xử lý trùng hàng loạt"
              value={bulkDupResolution}
              onChange={(e) => setBulkDupResolution(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
            >
              <option value="">-- Xử lý trùng --</option>
              <option value="skip">Bỏ qua bản trùng</option>
              <option value="keep-both">Giữ cả hai</option>
              <option value="replace">Thay thế bản cũ</option>
            </select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={selectedIds.size === 0}
              onClick={handleApplyBulkEdit}
            >
              Áp dụng
            </Button>
          </div>

          {/* Classification Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="w-8 px-2 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả tệp trong trang này"
                      checked={
                        pagedCandidates.length > 0 &&
                        pagedCandidates.every((c) => c.selected)
                      }
                      onChange={toggleSelectAllVisible}
                    />
                  </th>
                  <th className="px-2 py-2.5 font-semibold">Tài liệu &amp; Đường dẫn</th>
                  <th className="px-2 py-2.5 font-semibold">Môn học</th>
                  <th className="px-2 py-2.5 font-semibold">Lớp</th>
                  <th className="px-2 py-2.5 font-semibold">Chương / Chủ đề</th>
                  <th className="px-2 py-2.5 font-semibold">Loại tài liệu</th>
                  <th className="px-2 py-2.5 font-semibold">Độ tin cậy</th>
                  <th className="px-2 py-2.5 font-semibold">Trùng / Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pagedCandidates.map((item) => {
                  const isDup = Boolean(
                    item.duplicateOfExistingId || item.duplicateOfBatchTempId
                  );
                  const confPct = Math.round(item.suggestion.confidence * 100);
                  return (
                    <tr
                      key={item.tempId}
                      className={`${
                        !item.safeToStore
                          ? 'bg-red-50/40 dark:bg-red-950/20'
                          : isDup && item.duplicateResolution === 'skip'
                          ? 'bg-slate-50/70 dark:bg-slate-900/60 opacity-75'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/35'
                      }`}
                    >
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Chọn tệp ${item.fileName}`}
                          checked={item.selected}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setCandidates((prev) =>
                              prev.map((c) =>
                                c.tempId === item.tempId ? { ...c, selected: checked } : c
                              )
                            );
                          }}
                        />
                      </td>
                      <td className="px-2 py-2 align-top min-w-[160px] max-w-[210px]">
                        <input
                          type="text"
                          aria-label={`Tiêu đề cho ${item.fileName}`}
                          value={item.editedTitle}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCandidates((prev) =>
                              prev.map((c) =>
                                c.tempId === item.tempId ? { ...c, editedTitle: val } : c
                              )
                            );
                          }}
                          className="w-full rounded border border-transparent hover:border-slate-300 focus:border-blue-500 bg-transparent px-1 py-0.5 font-medium text-slate-900 dark:text-slate-100 focus:outline-none"
                        />
                        <div className="mt-0.5 px-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          <span>{item.extension.toUpperCase()}</span>
                          <span className="mx-1" aria-hidden="true">·</span>
                          <span className="font-mono-num">{formatBytes(item.sizeBytes)}</span>
                          {item.analysis.hasOmml && (
                            <>
                              <span className="mx-1" aria-hidden="true">·</span>
                              <span className="text-blue-600 dark:text-blue-400">
                                {item.analysis.formulaCount} OMML
                              </span>
                            </>
                          )}
                          {item.relativePath !== item.fileName && (
                            <>
                              <span className="mx-1" aria-hidden="true">·</span>
                              <span title={item.relativePath}>{item.relativePath}</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          aria-label={`Môn học cho ${item.fileName}`}
                          value={item.editedSubject}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCandidates((prev) =>
                              prev.map((c) =>
                                c.tempId === item.tempId ? { ...c, editedSubject: val } : c
                              )
                            );
                          }}
                          className="max-w-[128px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 text-xs"
                        >
                          {SUBJECT_CHOICES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          aria-label={`Khối lớp cho ${item.fileName}`}
                          value={item.editedGrade}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCandidates((prev) =>
                              prev.map((c) =>
                                c.tempId === item.tempId ? { ...c, editedGrade: val } : c
                              )
                            );
                          }}
                          className="w-[82px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 text-xs"
                        >
                          {GRADE_CHOICES.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="text"
                          aria-label={`Chương chủ đề cho ${item.fileName}`}
                          value={item.editedChapterTopic}
                          placeholder="Chưa rõ"
                          onChange={(e) => {
                            const val = e.target.value;
                            setCandidates((prev) =>
                              prev.map((c) =>
                                c.tempId === item.tempId
                                  ? { ...c, editedChapterTopic: val }
                                  : c
                              )
                            );
                          }}
                          className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          aria-label={`Loại tài liệu cho ${item.fileName}`}
                          value={item.editedDocumentCategory}
                          onChange={(e) => {
                            const nextCat = e.target.value as ResourceDocumentCategory;
                            setCandidates((prev) =>
                              prev.map((c) =>
                                c.tempId === item.tempId
                                  ? {
                                      ...c,
                                      editedDocumentCategory: nextCat,
                                      editedResourceType:
                                        mapDocCategoryToResourceType(nextCat),
                                    }
                                  : c
                              )
                            );
                          }}
                          className="max-w-[136px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 text-xs"
                        >
                          {CATEGORY_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {DOCUMENT_CATEGORY_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top whitespace-nowrap">
                        <div className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                          {confPct}% ·{' '}
                          <span
                            className={
                              item.suggestion.needsManualReview
                                ? 'text-amber-700 dark:text-amber-400'
                                : confPct >= 75
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-600 dark:text-slate-300'
                            }
                          >
                            {item.suggestion.needsManualReview
                              ? 'Cần kiểm tra'
                              : confPct >= 75
                              ? 'Cao'
                              : 'Trung bình'}
                          </span>
                        </div>
                        <p
                          title={item.suggestion.reasons.join('; ')}
                          className="mt-0.5 max-w-[130px] truncate text-[11px] text-slate-500 dark:text-slate-400"
                        >
                          {item.suggestion.reasons.join(' · ')}
                        </p>
                      </td>
                      <td className="px-2 py-2 align-top whitespace-nowrap">
                        {!item.safeToStore ? (
                          <span className="font-medium text-red-700 dark:text-red-400">
                            Bị chặn an toàn
                          </span>
                        ) : isDup ? (
                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              {item.duplicateOfExistingTitle
                                ? `Trùng "${item.duplicateOfExistingTitle}"`
                                : 'Trùng trong lô'}
                            </div>
                            <select
                              aria-label={`Xử lý trùng cho ${item.fileName}`}
                              value={item.duplicateResolution}
                              onChange={(e) => {
                                const res = e.target.value as DuplicateResolution;
                                setCandidates((prev) =>
                                  prev.map((c) =>
                                    c.tempId === item.tempId
                                      ? { ...c, duplicateResolution: res }
                                      : c
                                  )
                                );
                              }}
                              className="rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[11px]"
                            >
                              <option value="skip">Bỏ qua</option>
                              <option value="keep-both">Giữ cả hai</option>
                              {item.duplicateOfExistingId && (
                                <option value="replace">Thay thế bản cũ</option>
                              )}
                            </select>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Sẵn sàng</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination + Primary Confirm CTA */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              {pageCount > 1 && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Trang trước
                  </Button>
                  <span className="font-mono-num">
                    Trang {safePage + 1}/{pageCount}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    Trang sau
                  </Button>
                </>
              )}
              <span className="font-mono-num">
                Sẽ nhập {readyToImportCount}/{candidates.length} tài liệu ({formatBytes(totalPendingBytes)})
              </span>
            </div>

            <Button
              type="button"
              variant="primary"
              disabled={
                isScanning ||
                progress.status === 'committing' ||
                readyToImportCount === 0
              }
              onClick={() => void handleConfirmCommit()}
            >
              <span>
                {progress.status === 'committing'
                  ? `Đang nhập (${commitProgress?.done ?? 0}/${commitProgress?.total ?? 0})...`
                  : 'Xác nhận nhập thư viện'}
              </span>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

import type { BatchQueueItem, GradedSheetRecord } from '../../types/grading';

export const MAX_SAFE_MOBILE_QUEUE_ITEMS = 60;

export interface BatchQueueSummary {
  total: number;
  waiting: number;
  processing: number;
  graded: number;
  reviewRequired: number;
  failed: number;
  inFlight: number;
}

export function enqueueBatchItem(
  queue: BatchQueueItem[],
  item: Omit<BatchQueueItem, 'status'>
): { queue: BatchQueueItem[]; warning?: string } {
  const nextItem: BatchQueueItem = {
    ...item,
    status: 'waiting',
  };
  const nextQueue = [...queue, nextItem];
  const activeCount = nextQueue.filter(
    (q) => q.status === 'waiting' || q.status === 'processing'
  ).length;
  const warning =
    activeCount >= MAX_SAFE_MOBILE_QUEUE_ITEMS
      ? `Hàng đợi đang có ${activeCount} phiếu chờ xử lý. Nên chờ xử lý bớt để tránh tràn bộ nhớ điện thoại.`
      : undefined;
  return { queue: nextQueue, warning };
}

export function markQueueItemProcessing(
  queue: BatchQueueItem[],
  itemId: string
): BatchQueueItem[] {
  return queue.map((item) =>
    item.id === itemId
      ? { ...item, status: 'processing', errorMessage: undefined }
      : item
  );
}

export function markQueueItemCompleted(
  queue: BatchQueueItem[],
  itemId: string,
  sheet: GradedSheetRecord
): BatchQueueItem[] {
  const nextStatus: BatchQueueItem['status'] =
    sheet.status === 'auto-graded' || sheet.status === 'confirmed'
      ? 'graded'
      : 'review-required';
  return queue.map((item) =>
    item.id === itemId
      ? {
          ...item,
          status: nextStatus,
          gradedSheetId: sheet.id,
          finalScore: sheet.finalScore,
          maxScore: sheet.maxScore,
          studentId: sheet.studentId,
          examCode: sheet.examCode,
          thumbnailDataUrl: sheet.thumbnailDataUrl || item.thumbnailDataUrl,
          errorMessage: undefined,
        }
      : item
  );
}

export function markQueueItemFailed(
  queue: BatchQueueItem[],
  itemId: string,
  errorMessage: string
): BatchQueueItem[] {
  return queue.map((item) =>
    item.id === itemId
      ? { ...item, status: 'failed', errorMessage }
      : item
  );
}

export function retryFailedQueueItem(
  queue: BatchQueueItem[],
  itemId: string
): BatchQueueItem[] {
  return queue.map((item) =>
    item.id === itemId && item.status === 'failed'
      ? { ...item, status: 'waiting', errorMessage: undefined }
      : item
  );
}

export function cancelWaitingQueueItems(
  queue: BatchQueueItem[]
): BatchQueueItem[] {
  return queue.filter((item) => item.status !== 'waiting');
}

export function clearFinishedQueueItems(
  queue: BatchQueueItem[]
): BatchQueueItem[] {
  return queue.filter(
    (item) => item.status === 'waiting' || item.status === 'processing'
  );
}

export function summarizeBatchQueue(queue: BatchQueueItem[]): BatchQueueSummary {
  let waiting = 0;
  let processing = 0;
  let graded = 0;
  let reviewRequired = 0;
  let failed = 0;

  for (const item of queue) {
    switch (item.status) {
      case 'waiting':
        waiting += 1;
        break;
      case 'processing':
        processing += 1;
        break;
      case 'graded':
        graded += 1;
        break;
      case 'review-required':
        reviewRequired += 1;
        break;
      case 'failed':
        failed += 1;
        break;
    }
  }

  return {
    total: queue.length,
    waiting,
    processing,
    graded,
    reviewRequired,
    failed,
    inFlight: waiting + processing,
  };
}

export interface StorageQuotaEvaluation {
  usageMb: number;
  quotaMb: number;
  percentUsed: number;
  remainingMb: number;
  isLowStorage: boolean;
  warning?: string;
}

export function evaluateStorageQuota(
  usageBytes: number,
  quotaBytes: number
): StorageQuotaEvaluation {
  const safeQuota = Math.max(1, quotaBytes);
  const safeUsage = Math.max(0, usageBytes);
  const usageMb = Math.round((safeUsage / (1024 * 1024)) * 10) / 10;
  const quotaMb = Math.round((safeQuota / (1024 * 1024)) * 10) / 10;
  const remainingMb = Math.max(0, Math.round(((safeQuota - safeUsage) / (1024 * 1024)) * 10) / 10);
  const percentUsed = Math.min(100, Math.round((safeUsage / safeQuota) * 100));
  const isLowStorage = percentUsed >= 82 || remainingMb < 45;

  return {
    usageMb,
    quotaMb,
    percentUsed,
    remainingMb,
    isLowStorage,
    warning: isLowStorage
      ? `Bộ nhớ cục bộ trình duyệt sắp đầy (còn ~${remainingMb} MB). Hãy xuất ZIP lưu trữ và dọn các phiên chấm cũ.`
      : undefined,
  };
}

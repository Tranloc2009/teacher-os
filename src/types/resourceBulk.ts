import {
  ResourceDocumentCategory,
  ResourceItem,
  ResourceType,
} from './lesson';

export type SupportedResourceFormat =
  | 'docx'
  | 'pdf'
  | 'pptx'
  | 'xlsx'
  | 'image'
  | 'text'
  | 'attachment';

export type DuplicateResolution = 'keep-new' | 'skip' | 'keep-both' | 'replace';

export type BatchImportStatus =
  | 'idle'
  | 'scanning'
  | 'paused'
  | 'cancelled'
  | 'ready'
  | 'committing'
  | 'completed';

export interface ExtractedFileAnalysis {
  format: SupportedResourceFormat;
  extension: string;
  safeToStore: boolean;
  blockedReason?: string;
  extractedTitle?: string;
  extractedTextSnippet: string;
  metadataSubject?: string;
  metadataAuthor?: string;
  metadataKeywords?: string;
  hasOmml: boolean;
  formulaCount: number;
  slideCount?: number;
  sheetNames?: string[];
  warnings: string[];
}

export interface ResourceClassificationSuggestion {
  subject: string;
  grade: string;
  chapterTopic: string;
  documentCategory: ResourceDocumentCategory;
  resourceType: ResourceType;
  suggestedTitle: string;
  tags: string[];
  confidence: number; // 0..1
  needsManualReview: boolean;
  reasons: string[];
}

export interface BulkImportCandidate {
  tempId: string;
  fileName: string;
  relativePath: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  format: SupportedResourceFormat;
  safeToStore: boolean;
  blockedReason?: string;
  analysis: ExtractedFileAnalysis;
  suggestion: ResourceClassificationSuggestion;
  /** User-editable values before confirming import */
  editedTitle: string;
  editedSubject: string;
  editedGrade: string;
  editedChapterTopic: string;
  editedDocumentCategory: ResourceDocumentCategory;
  editedResourceType: ResourceType;
  editedTags: string[];
  /** Duplicate detection state */
  duplicateOfExistingId?: string;
  duplicateOfExistingTitle?: string;
  duplicateOfBatchTempId?: string;
  duplicateResolution: DuplicateResolution;
  /** Keep zero-copy File reference in browser; optional raw bytes in tests */
  fileRef?: File;
  rawBytesRef?: Uint8Array;
  selected: boolean;
}

export interface BulkImportProgress {
  status: BatchImportStatus;
  totalFiles: number;
  processedFiles: number;
  totalBytes: number;
  processedBytes: number;
  duplicateCount: number;
  needsReviewCount: number;
  blockedCount: number;
  startedAtMs: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  usedWorker: boolean;
  currentFileName?: string;
}

export interface StorageQuotaStatus {
  supported: boolean;
  opfsSupported: boolean;
  usageBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  usagePercent: number;
  warningLevel: 'ok' | 'warning' | 'critical';
  warningMessage?: string;
}

export interface StoredResourceFileRecord {
  id: string;
  resourceId: string;
  sha256: string;
  fileName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  storageKind: 'opfs' | 'indexeddb';
  opfsKey?: string;
  blob?: Blob;
  updatedAt: string;
}

export interface BulkCommitResult {
  importedCount: number;
  replacedCount: number;
  skippedCount: number;
  failedCount: number;
  opfsStoredCount: number;
  indexedDbStoredCount: number;
  errors: string[];
  savedResources: ResourceItem[];
}

export const DOCUMENT_CATEGORY_LABELS: Record<ResourceDocumentCategory, string> = {
  'giao-an': 'Giáo án / KHBD',
  'de-thi': 'Đề thi / Kiểm tra',
  'bai-tap': 'Bài tập / Phiếu HT',
  'dap-an': 'Đáp án / Hướng dẫn',
  'bai-giang': 'Bài giảng',
  slide: 'Slide trình chiếu',
  'tham-khao': 'Tài liệu tham khảo',
  khac: 'Tài liệu khác / Đính kèm',
};

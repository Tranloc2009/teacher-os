import {
  MathQuestion,
  MathVisualAsset,
  NormalizedPdfBBox,
  QuestionGroup,
  SubjectDetectionSuggestion,
  UniversalQuestionType,
} from './mathExam';

export type SupportedImportFormat =
  | 'docx'
  | 'pdf'
  | 'latex'
  | 'txt'
  | 'markdown'
  | 'html'
  | 'image'
  | 'xlsx'
  | 'csv'
  | 'pptx'
  | 'odt'
  | 'rtf'
  | 'unknown';

export type CompatibilityStatus =
  | 'READY'
  | 'REVIEW_REQUIRED'
  | 'UNSUPPORTED'
  | 'BLOCKED';

export interface FileDetectionResult {
  fileName: string;
  extension: string;
  declaredMimeType: string;
  detectedFormat: SupportedImportFormat;
  magicSignature: string;
  signatureValid: boolean;
  sizeBytes: number;
  contentHash: string;
  supportTier: 'supported' | 'deferred' | 'blocked';
  status: CompatibilityStatus;
  reason: string;
  securityWarnings: string[];
}

/**
 * Layer 1: Bản ghi nguồn gốc bất biến (Original Source).
 * Tuyệt đối không bị ghi đè khi giáo viên chỉnh sửa ở tầng xử lý.
 */
export interface OriginalSourceRecord {
  sourceId: string;
  fileName: string;
  mimeType: string;
  detectedFormat: SupportedImportFormat;
  sizeBytes: number;
  contentHash: string;
  signatureValid: boolean;
  importedAt: string;
  rawBytes?: Uint8Array;
  rawText?: string;
}

export interface PdfRiskRegion {
  id: string;
  pageNumber: number;
  bbox: NormalizedPdfBBox;
  kind:
    | 'pua-glyph'
    | 'math-font'
    | 'sub-sup-heuristic'
    | 'fraction-layout'
    | 'vector-diagram'
    | 'image-only-page'
    | 'sparse-text';
  severity: 'review' | 'blocked';
  message: string;
  sampleText?: string;
}

export interface PdfPageExtractionRecord {
  pageNumber: number;
  width: number;
  height: number;
  columnCount: 1 | 2;
  textItemCount: number;
  meaningfulCharCount: number;
  imageOpsCount: number;
  vectorOpsCount: number;
  hasTextLayer: boolean;
  isScannedLikely: boolean;
  reconstructedText: string;
  fontNames: string[];
  riskRegions: PdfRiskRegion[];
  /** PNG/JPEG Data URL trang PDF gốc dùng cho đối chiếu 2 cột trên trình duyệt */
  previewImageDataUrl?: string;
}

export interface UniversalDocumentBlock {
  id: string;
  kind: 'section' | 'passage' | 'question' | 'answer-key' | 'unmapped' | 'image-region';
  orderIndex: number;
  sourceLocation: {
    pageNumber?: number;
    pageSpan?: number[];
    columnIndex?: number;
    bbox?: NormalizedPdfBBox;
    partPath?: string;
  };
  immutableSourceText: string;
  relatedAssetIds: string[];
  checksum: string;
  recognitionStatus: 'parsed' | 'partial' | 'unparsed' | 'scanned';
  verificationStatus: CompatibilityStatus;
  mixable: boolean;
  exportable: boolean;
  mathProtectionFlags: string[];
  questionId?: string;
}

/**
 * Layer 2: Biểu diễn xử lý chuẩn hóa (Processed Representation).
 */
export interface UniversalDocumentModel {
  modelId: string;
  sourceId: string;
  sourceFormat: SupportedImportFormat;
  blocks: UniversalDocumentBlock[];
  pages: PdfPageExtractionRecord[];
  assets: MathVisualAsset[];
  warnings: string[];
}

export interface DocumentCompatibilityReport {
  status: CompatibilityStatus;
  detectedFormat: SupportedImportFormat;
  fileName: string;
  totalPages: number;
  textLayerPages: number;
  scannedPages: number;
  totalDetectedQuestions: number;
  validQuestions: number;
  reviewRequiredQuestions: number;
  blockedQuestions: number;
  formulaCount: number;
  formulaRiskCount: number;
  imageCount: number;
  unsupportedObjectCount: number;
  safeToMixCount: number;
  blockedCount: number;
  countsByType: Record<UniversalQuestionType, number>;
  suggestedSubject: SubjectDetectionSuggestion;
  warnings: string[];
  technicalDetails: string[];
  recommendations: string[];
}

export interface UniversalImportResultLegacy {
  questions: MathQuestion[];
  questionGroups: QuestionGroup[];
  report: {
    sourceFormat: 'docx' | 'html' | 'text';
    fileName?: string;
    suggestedSubject: SubjectDetectionSuggestion;
    totalParsed: number;
    countsByType: Record<UniversalQuestionType, number>;
    groupsCreated: number;
    assetsAttached: number;
    ommlCount: number;
    legacyOleCount?: number;
    unsupportedMediaCount?: number;
    confirmedAnswerCount: number;
    unconfirmedAnswerCount: number;
    warnings: string[];
    unparsedSegments: string[];
    canImport: boolean;
  };
}

export interface UniversalImportSession {
  sessionId: string;
  detection: FileDetectionResult;
  originalSource: OriginalSourceRecord;
  documentModel: UniversalDocumentModel;
  compatibilityReport: DocumentCompatibilityReport;
  questions: MathQuestion[];
  questionGroups: QuestionGroup[];
  canCommitToProject: boolean;
}

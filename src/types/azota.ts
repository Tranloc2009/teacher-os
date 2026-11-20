import type { GradingSession, StudentRecord } from './grading';
import type { MathExamProject, MixedExamVersion } from './mathExam';
import type { ExamFormTemplate } from './examForm';

export type AzotaOfficialApiStatus =
  | 'NOT_AVAILABLE_OR_NOT_VERIFIED'
  | 'OFFICIAL_VERIFIED';

export type AzotaProviderOperation =
  | 'CheckAvailability'
  | 'Connect'
  | 'Disconnect'
  | 'ImportQuestions'
  | 'ExportExam'
  | 'ImportResults'
  | 'SyncMetadata';

export type AzotaOperationStatus =
  | 'OK'
  | 'NOT_SUPPORTED'
  | 'CONSENT_REQUIRED'
  | 'VALIDATION_ERROR';

export interface AzotaOperationCapability {
  operation: AzotaProviderOperation;
  labelVi: string;
  directApiStatus: 'NOT_SUPPORTED' | 'SUPPORTED';
  fileFallbackStatus: 'SUPPORTED' | 'MANUAL_IN_TOOL' | 'NOT_APPLICABLE';
  summaryVi: string;
}

export interface AzotaAvailabilityReport {
  providerId: 'azota';
  displayName: string;
  officialApiStatus: AzotaOfficialApiStatus;
  officialStatusBanner: string;
  directApiEnabled: boolean;
  fileFallbackSupported: boolean;
  checkedAt: string;
  verificationNotes: string[];
  securityGuarantees: string[];
  capabilities: AzotaOperationCapability[];
}

export interface AzotaOperationResult<T = unknown> {
  operation: AzotaProviderOperation;
  status: AzotaOperationStatus;
  code: string;
  messageVi: string;
  mode: 'direct-api' | 'file-based';
  data?: T;
  warnings?: string[];
}

export type AzotaResultColumnRole =
  | 'stt'
  | 'studentId'
  | 'fullName'
  | 'className'
  | 'examCode'
  | 'score'
  | 'correctCount'
  | 'notes'
  | 'ignore';

export interface AzotaResultColumnMapping {
  columnIndex: number;
  headerText: string;
  role: AzotaResultColumnRole;
  sampleValues: string[];
}

export type AzotaRowScoreStatus = 'valid' | 'empty' | 'absent' | 'invalid';

export type AzotaRowMatchState =
  | 'MATCHED_ID'
  | 'MATCHED_NAME'
  | 'AMBIGUOUS'
  | 'UNMATCHED'
  | 'NO_ROSTER';

export interface AzotaParsedResultRow {
  rowIndex: number;
  rawCells: string[];
  studentId: string;
  fullName: string;
  className: string;
  examCode: string;
  rawScoreText: string;
  numericScore: number | null;
  scoreStatus: AzotaRowScoreStatus;
  correctCount: number | null;
  notes: string;
  matchState: AzotaRowMatchState;
  matchedStudentId: string | null;
  matchedStudentName: string | null;
  warnings: string[];
}

export interface AzotaResultImportPreview {
  fileName: string;
  fileType: 'xlsx' | 'csv';
  maxScore: number;
  rawRows: string[][];
  headerRowIndex: number;
  columns: AzotaResultColumnMapping[];
  rows: AzotaParsedResultRow[];
  validScoreCount: number;
  emptyScoreCount: number;
  invalidScoreCount: number;
  matchedCount: number;
  unmatchedCount: number;
  warnings: string[];
  errors: string[];
}

export interface AzotaExamExportRequest {
  mode: 'direct-api' | 'file-based';
  exam: MathExamProject;
  /** Nếu null/undefined: xuất từ đề gốc dưới dạng bản xem chỉ đọc (không thay đổi đề gốc) */
  version?: MixedExamVersion | null;
  formTemplate?: ExamFormTemplate | null;
  includeTrailingAnswerKey: boolean;
  includeConsolidatedCsv: boolean;
  /** Bắt buộc giáo viên xác nhận rõ ràng trước khi xuất tệp */
  teacherConfirmedConsent: boolean;
}

export interface AzotaExamExportOutput {
  docxBuffer: Uint8Array;
  docxFileName: string;
  answerCsvText?: string;
  answerCsvFileName?: string;
  examCodeLabel: string;
  questionCount: number;
  embeddedMediaCount: number;
  manualUploadStepsVi: string[];
  warnings: string[];
}

export interface AzotaResultImportRequest {
  mode: 'direct-api' | 'file-based';
  fileName: string;
  fileBuffer?: ArrayBuffer | Uint8Array;
  rawCsvText?: string;
  roster?: StudentRecord[];
  maxScore?: number;
  columnOverrides?: Record<number, AzotaResultColumnRole>;
}

export interface AzotaCommitResult {
  updatedSession: GradingSession;
  importedCount: number;
  skippedEmptyCount: number;
  skippedInvalidCount: number;
  newAuditEntriesCount: number;
}

/**
 * Provider Adapter theo kiến trúc mở rộng Mục 11.2.
 * Mọi phương thức API trực tiếp chưa được Azota xác minh phải trả về NOT_SUPPORTED rõ ràng.
 */
export interface AzotaIntegrationProvider {
  readonly providerId: 'azota';
  checkAvailability(): Promise<AzotaOperationResult<AzotaAvailabilityReport>>;
  connect(params?: Record<string, unknown>): Promise<AzotaOperationResult<never>>;
  disconnect(): Promise<AzotaOperationResult<never>>;
  importQuestions(params?: {
    mode?: 'direct-api' | 'file-based';
  }): Promise<AzotaOperationResult<never>>;
  exportExam(
    request: AzotaExamExportRequest
  ): Promise<AzotaOperationResult<AzotaExamExportOutput>>;
  importResults(
    request: AzotaResultImportRequest
  ): Promise<AzotaOperationResult<AzotaResultImportPreview>>;
  syncMetadata(): Promise<AzotaOperationResult<never>>;
}

export interface AzotaLocalActivityEntry {
  id: string;
  timestamp: string;
  action: 'availability-check' | 'file-export' | 'file-import' | 'gradebook-commit';
  summary: string;
  fileName?: string;
}

/**
 * Cấu hình tích hợp ngoài lưu cục bộ (Mục 14: ExternalIntegrationConfig).
 * TUYỆT ĐỐI KHÔNG chứa mật khẩu, cookie, token, client secret hay thông tin đăng nhập.
 */
export interface ExternalIntegrationConfig {
  schemaVersion: '1.0';
  azota: {
    providerId: 'azota';
    activeMode: 'file-fallback';
    officialApiStatus: AzotaOfficialApiStatus;
    lastCheckedAt: string | null;
    lastExportAt: string | null;
    lastImportAt: string | null;
    preferredIncludeTrailingAnswerKey: boolean;
    preferredIncludeAnswerCsv: boolean;
    recentActivities: AzotaLocalActivityEntry[];
  };
}

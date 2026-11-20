import type { McqOptionLabel, UniversalQuestionType } from './mathExam';

export type OmrBubbleChoice = McqOptionLabel; // 'A' | 'B' | 'C' | 'D'

export const OMR_CHOICES: readonly OmrBubbleChoice[] = ['A', 'B', 'C', 'D'] as const;

export type BubbleRecognitionStatus =
  | 'selected'
  | 'blank'
  | 'multiple'
  | 'uncertain'
  | 'unreadable';

export type SheetGradingStatus =
  | 'pending'
  | 'auto-graded'
  | 'review-required'
  | 'confirmed'
  | 'error';

export type RoundingRule = 'none' | '0.01' | '0.1' | '0.25' | '0.5';

export interface GradingRuleConfig {
  /** Thang điểm tối đa (mặc định 10) */
  maxScore: number;
  /** Quy tắc làm tròn minh bạch */
  rounding: RoundingRule;
  /** Trọng số điểm riêng theo số thứ tự câu (nếu trống: chia đều hoặc dùng điểm câu từ đề) */
  useExamQuestionPoints: boolean;
}

export const DEFAULT_GRADING_RULE: GradingRuleConfig = {
  maxScore: 10,
  rounding: '0.25',
  useExamQuestionPoints: false,
};

export interface OmrThresholdsConfig {
  /** Ngưỡng mật độ mực tối thiểu để coi một ô là đã tô (0..1) */
  filledThreshold: number;
  /** Ngưỡng tối đa để coi tất cả ô đều bỏ trống (0..1) */
  blankMaxThreshold: number;
  /** Khoảng chênh lệch tối thiểu giữa ô đậm nhất và ô đậm thứ hai để tự động chấp nhận */
  minMarginToSecond: number;
  /** Ngưỡng độ tương phản tối thiểu giữa lòng ô và nền xung quanh */
  minContrastDelta: number;
  /** Ngưỡng độ sắc nét (phương sai Laplacian chuẩn hóa) tối thiểu; thấp hơn sẽ báo mờ */
  minSharpnessScore: number;
}

export const DEFAULT_OMR_THRESHOLDS: OmrThresholdsConfig = {
  filledThreshold: 0.42,
  blankMaxThreshold: 0.16,
  minMarginToSecond: 0.16,
  minContrastDelta: 0.14,
  minSharpnessScore: 18,
};

export interface StudentRecord {
  /** Khóa chính bắt buộc — không bao giờ dùng họ tên làm khóa chính */
  studentId: string;
  fullName: string;
  className: string;
  orderNumber: number;
}

export interface StudentRoster {
  id: string;
  className: string;
  schoolYear?: string;
  students: StudentRecord[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload mã định danh quang học (QR/2D Code) trên phiếu trả lời chuẩn TeacherOS.
 * QUY TẮC BẢO MẬT: Tuyệt đối KHÔNG chứa đáp án, điểm số, họ tên đầy đủ hay nội dung đề.
 */
export interface SheetOpticalIdPayloadV1 {
  /** Phiên bản schema */
  v: 1;
  /** Exam Session ID (ngắn gọn, opaque) */
  sid: string;
  /** Exam Code (ví dụ '101', '102') */
  ec: string;
  /** Opaque Student ID (tùy chọn, nếu phiếu in theo danh sách lớp) */
  st?: string;
  /** Sheet ID */
  sh?: string;
  /** Page number (mặc định 1) */
  p: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OmrBubbleGeometry {
  questionNumber: number;
  choice: OmrBubbleChoice;
  /** Tâm ô chuẩn hóa theo tọa độ trang A4 [0..1] */
  cx: number;
  cy: number;
  /** Bán kính chuẩn hóa theo chiều rộng trang A4 */
  radiusNormX: number;
  /** Bán kính chuẩn hóa theo chiều cao trang A4 */
  radiusNormY: number;
}

export interface OmrFiducialMarkers {
  topLeft: NormalizedPoint;
  topRight: NormalizedPoint;
  bottomRight: NormalizedPoint;
  bottomLeft: NormalizedPoint;
  /** Điểm đánh dấu hướng bất đối xứng gần góc trên-trái để tự nhận diện xoay 0/90/180/270° */
  orientationDot: NormalizedPoint;
  /** Kích thước cạnh dấu định vị chuẩn hóa theo chiều rộng trang */
  markerSizeNormX: number;
  markerSizeNormY: number;
}

export interface OmrSheetLayoutSpec {
  schemaVersion: '1.0';
  paper: 'A4';
  aspectRatioHeightOverWidth: number; // 297 / 210
  questionCount: number;
  columns: number;
  rowsPerColumn: number;
  fiducials: OmrFiducialMarkers;
  opticalCodeBox: NormalizedRect;
  bubbles: OmrBubbleGeometry[];
}

export interface ExamCodeQuestionKey {
  /** Số thứ tự câu trên mã đề đã trộn (1-based) */
  orderNumber: number;
  questionId: string;
  originalCode: string;
  universalType: UniversalQuestionType;
  /** Chỉ câu trắc nghiệm 1 đáp án (A/B/C/D) được chấm tự động ở Giai đoạn 1 */
  autoGradable: boolean;
  /** Đáp án đúng SAU KHI ĐẢO PHƯƠNG ÁN của mã đề này */
  correctChoice?: OmrBubbleChoice;
  /** Điểm gốc của câu trong đề (nếu dùng chế độ điểm theo đề) */
  points: number;
  /** Lý do nếu không hỗ trợ chấm tự động */
  unsupportedReason?: string;
}

export interface ExamCodeAnswerKey {
  examId: string;
  examTitle: string;
  examCode: string;
  versionIntegrityPassed: boolean;
  valid: boolean;
  blockingErrors: string[];
  warnings: string[];
  totalQuestions: number;
  autoGradableCount: number;
  unsupportedCount: number;
  questions: ExamCodeQuestionKey[];
  /** Bản đồ nhanh số thứ tự câu -> đáp án đúng A/B/C/D cho câu tự động chấm */
  mcqAnswerByOrder: Record<number, OmrBubbleChoice>;
}

export interface BubbleOptionScore {
  choice: OmrBubbleChoice;
  fillRatio: number;
  contrastDelta: number;
}

export interface ManualOverrideAuditEntry {
  questionNumber: number;
  originalRecognized: OmrBubbleChoice | null;
  originalStatus: BubbleRecognitionStatus;
  confirmedValue: OmrBubbleChoice | null;
  editedAt: string;
  reason?: string;
}

export interface QuestionGradingResult {
  questionNumber: number;
  autoGradable: boolean;
  unsupportedReason?: string;
  /** Kết quả OMR gốc — luôn giữ nguyên để đối soát */
  recognizedChoice: OmrBubbleChoice | null;
  recognizedStatus: BubbleRecognitionStatus;
  /** Giá trị cuối dùng để tính điểm (bằng recognizedChoice hoặc giá trị giáo viên sửa) */
  effectiveChoice: OmrBubbleChoice | null;
  /** Đáp án đúng của mã đề tương ứng (null nếu chưa chọn mã đề hoặc câu không chấm tự động) */
  correctChoice: OmrBubbleChoice | null;
  isCorrect: boolean;
  isBlank: boolean;
  pointsEarned: number;
  maxPoints: number;
  /** Độ tin cậy nhận diện ô (0..1) */
  confidence: number;
  /** Chi tiết mật độ tô của từng phương án A/B/C/D */
  optionMetrics: BubbleOptionScore[];
  /** Cần giáo viên kiểm tra thủ công */
  needsReview: boolean;
  reviewReasons: string[];
  /** Đã được giáo viên chỉnh tay */
  manuallyOverridden: boolean;
  overrideHistory: ManualOverrideAuditEntry[];
}

export interface OmrAlignmentDiagnostics {
  aligned: boolean;
  detectedRotationDeg: 0 | 90 | 180 | 270;
  sharpnessScore: number;
  lowSharpness: boolean;
  /** 4 tọa độ góc tìm được trên ảnh đã xoay về chuẩn (chuẩn hóa [0..1]) */
  detectedCorners?: {
    topLeft: NormalizedPoint;
    topRight: NormalizedPoint;
    bottomRight: NormalizedPoint;
    bottomLeft: NormalizedPoint;
  };
  /** Phép biến đổi homography nghịch đảo (từ tọa độ chuẩn A4 về ảnh đã xoay) để vẽ overlay khớp tuyệt đối */
  inverseHomography?: number[];
  opticalCodeStatus: 'decoded' | 'unreadable' | 'corrupted' | 'absent';
  opticalCodePayload?: SheetOpticalIdPayloadV1;
  warnings: string[];
  processingTimeMs: number;
}

export interface StudentMatchStatus {
  matched: boolean;
  studentId: string;
  studentName: string;
  className: string;
  warning?: string;
}

export interface GradedSheetRecord {
  id: string;
  sessionId: string;
  fileName: string;
  uploadedAt: string;
  /** Mã bài/đề được đọc hoặc giáo viên chọn thủ công */
  examCode: string;
  examCodeSource: 'optical-code' | 'manual' | 'default';
  /** Mã học sinh — khóa chính liên kết danh sách lớp */
  studentId: string;
  studentName: string;
  className: string;
  studentMatch: StudentMatchStatus;
  /** Khóa tham chiếu tới bảng nhị phân gradingEvidenceBlobs (không lưu ảnh lớn trong state) */
  originalBlobId: string;
  annotatedBlobId?: string;
  /** Ảnh xem trước siêu nhỏ (thumbnail ~160px) để hiển thị danh sách nhanh */
  thumbnailDataUrl?: string;
  imageWidth: number;
  imageHeight: number;
  /** Góc xoay hiển thị bổ sung do giáo viên chỉnh trong giao diện duyệt */
  manualViewRotationDeg: 0 | 90 | 180 | 270;
  status: SheetGradingStatus;
  confirmedByTeacher: boolean;
  confirmedAt?: string;
  alignment: OmrAlignmentDiagnostics;
  questions: QuestionGradingResult[];
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  uncertainCount: number;
  unsupportedCount: number;
  rawScore: number;
  finalScore: number;
  maxScore: number;
  scoreFormulaText: string;
  duplicateStudentWarning?: string;
  /** Phase 3: Vân tay ảnh 64-bit dHash để phát hiện chụp trùng gần giống nhau */
  imageDHash?: string;
  /** Phase 3: Nguồn nhập ảnh ('camera' | 'upload') */
  captureSource?: 'camera' | 'upload';
  /** Phase 3: Giáo viên đánh dấu cần chụp lại phiếu này */
  retakeRequested?: boolean;
  /** Phase 3: Phiếu được lưu trữ ẩn sau khi xử lý trùng (không tự động xóa mất dữ liệu) */
  archivedByDuplicateResolution?: boolean;
  replacedBySheetId?: string;
  notes?: string;
  updatedAt: string;
}

export interface GradingSession {
  id: string;
  title: string;
  examId: string;
  examTitle: string;
  subject: string;
  grade: string;
  className: string;
  rosterId?: string;
  /** Các mã đề được chọn từ Exam Mixer Pro */
  selectedExamCodes: string[];
  /** Số câu trắc nghiệm chuẩn của phiếu OMR */
  omrQuestionCount: number;
  gradingRule: GradingRuleConfig;
  omrThresholds: OmrThresholdsConfig;
  students: StudentRecord[];
  sheets: GradedSheetRecord[];
  /** Các bản nhập ảnh bảng điểm lớp (Phase 2 — Photo Gradebook OCR) */
  photoGradebooks?: PhotoGradebookImportRecord[];
  /** Sổ điểm thông minh hợp nhất OMR + Ảnh bảng điểm (Phase 2) */
  gradebookEntries?: IntelligentGradebookEntry[];
  /** Nhật ký kiểm toán mọi thay đổi điểm chính thức (Phase 2 — không bao giờ xóa lịch sử cũ) */
  gradeAuditTrail?: OfficialGradeAuditEntry[];
  /** Phase 3: Nhật ký xử lý phiếu trùng / thay thế */
  duplicateResolutionHistory?: DuplicateResolutionEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceBlobRecord {
  id: string;
  sessionId: string;
  sheetId: string;
  kind: 'original' | 'annotated' | 'gradebook-photo';
  mimeType: string;
  byteSize: number;
  blob: Blob;
  updatedAt: string;
}

export interface GradingDashboardMetrics {
  totalSheets: number;
  autoGradedCount: number;
  reviewRequiredCount: number;
  confirmedCount: number;
  errorCount: number;
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
  scoreDistribution: Array<{
    bucketLabel: string;
    minInclusive: number;
    maxExclusive: number;
    count: number;
  }>;
}

export interface RgbaImageBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// ============================================================================
// SMART GRADING STUDIO 2.0 — PHASE 2: INTELLIGENT GRADEBOOK & PHOTO OCR TYPES
// ============================================================================

export type GradebookColumnRole =
  | 'stt'
  | 'studentId'
  | 'fullName'
  | 'lastName'
  | 'firstName'
  | 'className'
  | 'examCode'
  | 'score'
  | 'notes'
  | 'ignore';

export interface GradebookColumnMapping {
  columnIndex: number;
  headerText: string;
  customLabel: string;
  role: GradebookColumnRole;
  displayOrder: number;
}

export type ScoreParseStatus =
  | 'valid'
  | 'empty'
  | 'absent'
  | 'uncertain'
  | 'unreadable'
  | 'invalid';

export interface ParsedScoreResult {
  rawText: string;
  normalizedText: string;
  status: ScoreParseStatus;
  /** Giá trị số chính xác (chỉ khác null khi status === 'valid') — tuyệt đối không biến ô trống thành 0 */
  numericScore: number | null;
  confidence: number;
  needsReview: boolean;
  warning?: string;
}

export interface OcrTableCell {
  rowIndex: number;
  columnIndex: number;
  rawText: string;
  editedText?: string;
  confidence: number;
  bbox: NormalizedRect;
  unreadable: boolean;
  uncertain: boolean;
}

export type StudentRowMatchState =
  | 'MATCHED'
  | 'UNMATCHED'
  | 'AMBIGUOUS'
  | 'REVIEW_REQUIRED';

export interface OcrGradebookRow {
  id: string;
  rowIndex: number;
  bbox: NormalizedRect;
  cells: OcrTableCell[];
  /** Dữ liệu trích xuất sau khi áp dụng Smart Column Mapping */
  extractedOrderNumber?: number;
  extractedStudentId: string;
  extractedFullName: string;
  extractedClassName: string;
  extractedExamCode: string;
  extractedNotes: string;
  parsedScore: ParsedScoreResult;
  /** Kết quả ghép học sinh với Student Roster */
  matchState: StudentRowMatchState;
  matchedStudentId: string | null;
  suggestedStudentIds: string[];
  matchWarning?: string;
  /** Xác nhận thủ công của giáo viên cho dòng OCR này */
  confirmedByTeacher: boolean;
  confirmedAt?: string;
  reviewNote?: string;
}

export interface PhotoCropRegion {
  /** Vùng chọn bảng chuẩn hóa [0..1] trên ảnh đã xoay */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoGradebookImportRecord {
  id: string;
  sessionId: string;
  fileName: string;
  uploadedAt: string;
  photoBlobId: string;
  thumbnailDataUrl?: string;
  imageWidth: number;
  imageHeight: number;
  rotationDeg: 0 | 90 | 180 | 270;
  detectedSkewDeg: number;
  cropRegion: PhotoCropRegion;
  ocrEngineLabel: string;
  isHandwrittenSuspected: boolean;
  headerCells: string[];
  columnMappings: GradebookColumnMapping[];
  columnMappingConfirmed: boolean;
  rows: OcrGradebookRow[];
  processingTimeMs: number;
  warnings: string[];
  updatedAt: string;
}

export type GradeReconciliationStatus =
  | 'MATCHED'
  | 'MISMATCH'
  | 'MISSING'
  | 'REVIEW_REQUIRED'
  | 'CONFIRMED';

export type OfficialScoreSource =
  | 'omr'
  | 'photo-ocr'
  | 'reconciled-both'
  | 'manual'
  | 'unassigned';

export interface OfficialGradeAuditEntry {
  id: string;
  studentId: string;
  assessmentId: string;
  previousScore: number | null;
  newScore: number | null;
  source: 'omr' | 'photo-ocr' | 'manual' | 'undo';
  timestamp: string;
  reason: string;
  confirmedStatus: GradeReconciliationStatus;
}

export interface IntelligentGradebookEntry {
  id: string;
  sessionId: string;
  orderNumber: number;
  studentId: string;
  fullName: string;
  className: string;
  examCode: string;
  /** Nguồn A: Điểm từ phiếu OMR */
  omrSheetId?: string;
  omrScore: number | null;
  omrStatus?: SheetGradingStatus;
  /** Nguồn B: Điểm đọc từ ảnh bảng điểm */
  photoImportId?: string;
  photoRowId?: string;
  photoScore: number | null;
  photoRawText?: string;
  photoParseStatus?: ScoreParseStatus;
  /** Chênh lệch tuyệt đối |omrScore - photoScore| khi có cả 2 nguồn */
  scoreDelta: number | null;
  /** Điểm chính thức (chỉ được gán tự động khi không có xung đột và không có cờ REVIEW_REQUIRED) */
  officialScore: number | null;
  officialScoreSource: OfficialScoreSource;
  reconciliationStatus: GradeReconciliationStatus;
  confirmedByTeacher: boolean;
  confirmedAt?: string;
  notes: string;
  hasOmrEvidence: boolean;
  hasPhotoEvidence: boolean;
  updatedAt: string;
}

export interface IntelligentGradebookStats {
  totalEntries: number;
  confirmedValidCount: number;
  matchedCount: number;
  mismatchCount: number;
  missingCount: number;
  reviewRequiredCount: number;
  /** Chỉ tính từ tập dữ liệu hợp lệ và đã xác nhận (confirmedByTeacher && officialScore !== null) */
  confirmedAverageScore: number | null;
  confirmedHighestScore: number | null;
  confirmedLowestScore: number | null;
}

// ============================================================================
// SMART GRADING STUDIO 3.0 — PHASE 3: MOBILE SCANNER, BATCH QUEUE & DUPLICATES
// ============================================================================

export type DuplicateReason =
  | 'same-sheet-id'
  | 'same-optical-code'
  | 'same-student-id'
  | 'similar-image-hash';

export type DuplicateResolutionAction =
  | 'keep-new'
  | 'keep-old'
  | 'keep-both'
  | 'mark-retake';

export interface DuplicateResolutionEntry {
  id: string;
  timestamp: string;
  reason: DuplicateReason;
  action: DuplicateResolutionAction;
  keptSheetId?: string;
  affectedSheetIds: string[];
  studentId?: string;
  note?: string;
}

export interface DuplicateGroup {
  id: string;
  reason: DuplicateReason;
  reasonLabel: string;
  sheetIds: string[];
  studentId?: string;
  opticalKey?: string;
  hammingDistance?: number;
}

export type BatchQueueItemStatus =
  | 'waiting'
  | 'processing'
  | 'graded'
  | 'review-required'
  | 'failed';

export interface BatchQueueItem {
  id: string;
  fileName: string;
  createdAt: string;
  status: BatchQueueItemStatus;
  captureSource: 'camera' | 'upload';
  thumbnailDataUrl?: string;
  gradedSheetId?: string;
  finalScore?: number;
  maxScore?: number;
  studentId?: string;
  examCode?: string;
  errorMessage?: string;
  retakeForSheetId?: string;
}



export type ExamFormPresetKind =
  | 'quiz-15m'
  | 'test-45m'
  | 'midterm'
  | 'final'
  | 'practice'
  | 'mock-exam'
  | 'mcq-only'
  | 'essay-only'
  | 'hybrid'
  | 'custom';

export type ExamCodeBadgePosition = 'header-right' | 'header-center' | 'top-box';
export type ExamOptionLayout = 'auto' | '1-col' | '2-col' | '4-col';
export type ExamOptionLabelStyle = 'dot' | 'paren';
export type ExamImageAlignment = 'left' | 'center' | 'inline-below';
export type ExamFontFamily = 'Times New Roman' | 'Be Vietnam Pro' | 'Arial';
export type ExamBodyAlignment = 'left' | 'justify';
export type ExamPageNumberFormat = 'page-only' | 'page-of-total';
export type ExamShortAnswerBoxStyle = 'box' | 'dotted-line' | 'none';
export type ExamEssayLineStyle = 'lined' | 'dotted' | 'blank';
export type ExamAnswerTableStyle =
  | 'horizontal'
  | 'multi-column'
  | 'by-section'
  | 'per-code';
export type ExamFormBlockId =
  | 'header'
  | 'student'
  | 'questions'
  | 'footer'
  | 'answer-key';

export interface ExamFormPageSettings {
  paperSize: 'A4';
  orientation: 'portrait' | 'landscape';
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  fontFamily: ExamFontFamily;
  fontSizePt: number; // 11..14
  lineHeight: number; // 1.15..1.8
  questionSpacingPx: number; // 8..24
  paragraphSpacingPt?: number; // 2..12
  bodyAlignment?: ExamBodyAlignment;
  columns: 1 | 2;
  showPageNumbers: boolean;
  pageNumberFormat?: ExamPageNumberFormat;
  showPageBreaks?: boolean;
  examCodePosition: ExamCodeBadgePosition;
}

export interface ExamFormHeaderSettings {
  departmentName: string;
  schoolName: string;
  subjectGroupName: string;
  schoolYear: string;
  examTitle: string;
  subjectOverride: string;
  gradeOverride: string;
  durationOverrideMinutes: number | null;
  showExamCode: boolean;
  showQuestionCountSubtitle: boolean;
  headerNote: string;
  /** Logo trường dạng Data URL (PNG/JPG/SVG) — tùy chọn */
  schoolLogoDataUrl?: string;
  /** Chiều rộng hiển thị logo (px) */
  schoolLogoWidthPx?: number;
}

export interface ExamFormStudentInfoSettings {
  showStudentBlock: boolean;
  showFullName: boolean;
  showClassName: boolean;
  showExamNumber: boolean; // Số báo danh
  showStudentId: boolean; // Mã học sinh
  showExamDate: boolean; // Ngày kiểm tra
}

export interface ExamFormBodySettings {
  showSectionTitles: boolean;
  showSectionInstructions: boolean;
  sectionInstructionsOverride: string;
  showPointsPerQuestion: boolean;
  showSectionPointsSummary: boolean;
  questionNumberPrefix: string; // e.g., "Câu"
  optionLayout: ExamOptionLayout;
  optionLabelStyle: ExamOptionLabelStyle;
  imageAlignment: ExamImageAlignment;
  formulaDisplayMode: 'preserve-original' | 'emphasize-block';
  /** Vùng ghi đáp số cho câu trả lời ngắn */
  shortAnswerBoxStyle?: ExamShortAnswerBoxStyle;
  shortAnswerBlankLines?: number; // 0..4
  /** Vùng dòng kẻ làm bài cho câu tự luận */
  essayAnswerLines?: number; // 0..12
  essayLineStyle?: ExamEssayLineStyle;
}

export interface ExamFormAnswerLayout {
  includeSeparateAnswerKey: boolean;
  includePerCodeAnswerTable: boolean;
  includeDetailedSolutions: boolean;
  includeScoringRubric: boolean;
  includeMappingAuditTable: boolean;
  /** Kiểu bảng đáp án giáo viên */
  answerTableStyle?: ExamAnswerTableStyle;
  /** Số cột khi dùng kiểu bảng đáp án nhiều cột */
  answerColumns?: 2 | 4 | 5;
}

export interface ExamFormFooterSettings {
  showEndMarker: boolean;
  endMarkerText: string;
  footerNote: string;
  showCodeInFooter: boolean;
}

/**
 * ExamFormTemplate (Phase 3) — Structured Layout Schema.
 * Mẫu trình bày KHÔNG BAO GIỜ thay đổi nội dung câu hỏi, công thức, hình ảnh hay đáp án.
 */
export interface ExamFormTemplate {
  id: string;
  name: string;
  description: string;
  presetKind: ExamFormPresetKind;
  version: string;
  isBuiltIn: boolean;
  isDefault: boolean;
  /** Thông báo minh bạch rằng đây là cấu hình trình bày gợi ý */
  disclaimer: string;
  pageSettings: ExamFormPageSettings;
  headerSettings: ExamFormHeaderSettings;
  studentInfoSettings: ExamFormStudentInfoSettings;
  bodySettings: ExamFormBodySettings;
  answerLayout: ExamFormAnswerLayout;
  footerSettings: ExamFormFooterSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ExamFormExportWarning {
  id: string;
  severity: 'warning' | 'blocking';
  message: string;
  recommendation: string;
}

export interface ExamFormPlaceholderContext {
  schoolName: string;
  departmentName: string;
  subjectGroupName: string;
  examTitle: string;
  subject: string;
  grade: string;
  duration: string;
  schoolYear: string;
  examCode: string;
}

export interface ExamFormPlaceholderToken {
  token: string;
  key: keyof ExamFormPlaceholderContext;
  label: string;
  example: string;
}

export interface ExamFormPaginationEstimate {
  estimatedPages: number;
  pageBreakBeforeIndices: number[];
  hasOverflowRisk: boolean;
  densityLevel: 'comfortable' | 'balanced' | 'dense';
  usableHeightMm: number;
  usableWidthMm: number;
}

export interface ExamFormPostExportAuditReport {
  checkedAt: string;
  examCode: string;
  ooxmlValid: boolean;
  questionCountMatched: boolean;
  expectedQuestions: number;
  foundQuestions: number;
  ommlCount: number;
  mathTypeCount: number;
  embeddedMediaCount: number;
  hasLogoMedia: boolean;
  zeroAnswerLeak: boolean;
  roundTripPassed: boolean;
  answerMappingIntact: boolean;
  /** Trung thực: trình duyệt không chạy Microsoft Word / LibreOffice để kiểm tra render thị giác */
  visualRenderStatus: 'NOT_TESTED';
  visualRenderNote: string;
  errors: string[];
  warnings: string[];
}

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
export type ExamOptionLayout = '1-col' | '2-col' | '4-col';
export type ExamOptionLabelStyle = 'dot' | 'paren';
export type ExamImageAlignment = 'left' | 'center' | 'inline-below';
export type ExamFontFamily = 'Times New Roman' | 'Be Vietnam Pro' | 'Arial';

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
  columns: 1 | 2;
  showPageNumbers: boolean;
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
}

export interface ExamFormAnswerLayout {
  includeSeparateAnswerKey: boolean;
  includePerCodeAnswerTable: boolean;
  includeDetailedSolutions: boolean;
  includeScoringRubric: boolean;
  includeMappingAuditTable: boolean;
}

export interface ExamFormFooterSettings {
  showEndMarker: boolean;
  endMarkerText: string;
  footerNote: string;
  showCodeInFooter: boolean;
}

/**
 * ExamFormTemplate (Section 12.4) — Structured Layout Schema.
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

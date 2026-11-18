export type MathQuestionType = 'mcq' | 'true-false' | 'short-answer' | 'essay';

/**
 * 12 nhóm môn học chuẩn THCS / THPT cho Exam Mixer Pro 6.0.
 * Tương thích hoàn toàn với dữ liệu môn 'Toán học' trước đây.
 */
export type ExamSubjectId =
  | 'toan'
  | 'vat-ly'
  | 'hoa-hoc'
  | 'sinh-hoc'
  | 'ngu-van'
  | 'tieng-anh'
  | 'lich-su'
  | 'dia-ly'
  | 'gdkt-pl'
  | 'tin-hoc'
  | 'cong-nghe'
  | 'khac';

export type SubjectProtectionLevel =
  | 'strict-math'
  | 'scientific-formula'
  | 'passage-context'
  | 'chronology-data'
  | 'code-logic'
  | 'flexible';

/**
 * Mô hình câu hỏi tổng quát cho mọi môn học (10 dạng chuẩn + mở rộng nhóm dữ kiện).
 * Bốn dạng cốt lõi của Math Exam Mixer 5.0 là tập con trực tiếp của UniversalQuestionType.
 */
export type UniversalQuestionType =
  | MathQuestionType
  | 'multi-select'
  | 'fill-blank'
  | 'matching'
  | 'ordering'
  | 'reading-comprehension'
  | 'shared-context';

export type CognitiveLevel =
  | 'nhan-biet'
  | 'thong-hieu'
  | 'van-dung'
  | 'van-dung-cao';

export type MixLevel = 0 | 1 | 2 | 3 | 4;

export type McqOptionLabel = 'A' | 'B' | 'C' | 'D';
export type TrueFalseLabel = 'a' | 'b' | 'c' | 'd';

export type MathBlockKind =
  | 'text'
  | 'latex'
  | 'mathml'
  | 'omml-raw'
  | 'chemical'
  | 'code'
  | 'ipa'
  | 'poetry'
  | 'audio-ref'
  | 'image'
  | 'table'
  | 'graph-note';

export interface MathContentBlock {
  id: string;
  kind: MathBlockKind;
  /** Nội dung gốc bất biến — engine trộn đề tuyệt đối không sửa chuỗi này */
  content: string;
  displayMode?: boolean;
  caption?: string;
  altText?: string;
  /** Đoạn XML gốc (ví dụ <m:oMath> hoặc drawing XML từ .docx) để bảo toàn nguyên trạng */
  rawXmlFragment?: string;
  /** Checksum kiểm chứng bất biến cho block gốc */
  checksum?: string;
  /** Giữ nguyên xuống dòng và thụt lề (bắt buộc cho thơ Ngữ văn, mã nguồn Tin học) */
  preserveExactWhitespace?: boolean;
}

export interface MathContentPayload {
  /** Chuỗi nguồn gốc giáo viên nhập (hỗ trợ $...$ và $$...$$) */
  rawSource: string;
  blocks: MathContentBlock[];
}

export type MathVisualAssetKind =
  | 'image'
  | 'geometry-svg'
  | 'variation-table'
  | 'data-table';

export interface MathVisualAsset {
  id: string;
  kind: MathVisualAssetKind;
  label: string;
  /** Data URL ảnh, mã SVG hình học / bảng biến thiên hoặc nội dung bảng */
  sourceData: string;
  altText: string;
  required: boolean;
  checksum: string;
  /** Thông tin truy vết nguồn gốc tài nguyên (phần DOCX, rId, thứ tự bảng/ảnh) */
  sourcePartPath?: string;
  sourceRelationshipId?: string;
  sourceOrdinal?: number;
  sourceLocation?: string;
  contentHash?: string;
}

export interface McqOption {
  id: string;
  originalLabel: McqOptionLabel;
  content: MathContentPayload;
  isCorrect: boolean;
  /** Khóa vị trí phương án này (A/B/C/D) khi trộn */
  lockPosition?: boolean;
}

export interface MultiSelectOption {
  id: string;
  originalLabel: string;
  content: MathContentPayload;
  isCorrect: boolean;
  lockPosition?: boolean;
}

export interface TrueFalseStatement {
  id: string;
  originalLabel: TrueFalseLabel;
  content: MathContentPayload;
  isTrue: boolean;
}

export interface ShortAnswerSpec {
  answerValue: string;
  acceptedFormats: string[];
  unit?: string;
  domainCondition?: string;
}

export interface FillBlankSlot {
  id: string;
  /** Số thứ tự chỗ trống trong đoạn văn/công thức (ví dụ 1 ứng với {{1}} hoặc (1)) */
  slotNumber: number;
  placeholderToken: string;
  acceptedAnswers: string[];
  caseSensitive?: boolean;
  lockOrder?: boolean;
}

export interface FillBlankSpec {
  slots: FillBlankSlot[];
  /** Ngân hàng từ tùy chọn nếu là bài Cloze Test chọn từ điền khuyết */
  wordBank?: Array<{
    id: string;
    originalLabel: string;
    content: MathContentPayload;
    lockPosition?: boolean;
  }>;
  allowShuffleWordBank?: boolean;
}

export interface MatchingColumnItem {
  id: string;
  originalLabel: string;
  content: MathContentPayload;
}

export interface MatchingPairMapping {
  id: string;
  leftItemId: string;
  rightItemId: string;
}

export interface MatchingSpec {
  leftItems: MatchingColumnItem[];
  rightItems: MatchingColumnItem[];
  /** Ánh xạ đúng theo ID ổn định hai cột — bất biến khi đảo vị trí cột phải */
  correctPairs: MatchingPairMapping[];
  allowShuffleLeft: boolean;
  allowShuffleRight: boolean;
}

export interface OrderingStepItem {
  id: string;
  originalLabel: string;
  content: MathContentPayload;
  /** Thứ tự đúng gốc (1-based) gắn chặt theo item.id */
  correctRank: number;
}

export interface OrderingSpec {
  items: OrderingStepItem[];
  requireExactSequence: boolean;
}

export interface PassageContextSpec {
  passageId: string;
  title: string;
  authorOrSource?: string;
  preserveLineBreaks: boolean;
  preserveStanzaStructure?: boolean;
  content: MathContentPayload;
  childQuestionIds: string[];
}

export interface EssayPart {
  id: string;
  label: string;
  content: MathContentPayload;
  points: number;
  solutionOutline: MathContentPayload;
}

/**
 * Hệ thống 5 lớp khóa phổ quát cho Exam Mixer Pro 6.0.
 * - contentLocked luôn là true: công thức/OMML/LaTeX/hình/ký hiệu khoa học bất biến.
 */
export interface UniversalLockState {
  /** Bắt buộc true: tuyệt đối không làm biến đổi biểu thức toán/khoa học */
  contentLocked: true;
  /** Khóa vị trí câu hỏi trong đề */
  positionLock: boolean;
  /** Khóa nhóm câu hỏi dùng chung ngữ liệu/đoạn văn/hình */
  groupLockMode: 'none' | 'move-as-unit' | 'lock-position';
  /** Khóa không đảo phương án/ý con bên trong câu */
  optionShuffleLock: boolean;
  /** Danh sách ID phương án lẻ bị khóa cứng tại vị trí gốc */
  lockedOptionIds: string[];
  /** Lý do khóa tham chiếu chéo ("Cả A và B", "All of the above", "Từ ý a",...) */
  referenceLockReasons: string[];
}

export interface QuestionOriginalSnapshot {
  rawXmlFragments: string[];
  rawContentChecksum: string;
  capturedAt: string;
}

export interface QuestionGroup {
  id: string;
  title: string;
  sharedContext: MathContentPayload;
  sharedAssets: MathVisualAsset[];
  questionIds: string[];
  /** true: giữ cố định vị trí nhóm; false: di chuyển cả nhóm như 1 khối liền kề nếu moveAsUnit=true */
  lockGroupPosition: boolean;
  moveAsUnit: boolean;
  /** Mở rộng cho ngữ liệu đọc hiểu / thí nghiệm / đoạn thơ đa môn */
  contextKind?: 'passage' | 'poetry' | 'cloze-text' | 'experiment' | 'figure-data' | 'case-study';
  lockInternalQuestionOrder?: boolean;
}

export interface MathQuestion {
  id: string;
  code: string;
  sectionTitle: string;
  type: MathQuestionType;
  /** Dạng câu hỏi mở rộng cho kiến trúc đa môn 6.0 (mặc định suy ra từ type) */
  universalType?: UniversalQuestionType;
  subjectId?: ExamSubjectId;
  topic: string;
  cognitiveLevel: CognitiveLevel;
  difficultyScore: 1 | 2 | 3 | 4;
  points: number;
  stem: MathContentPayload;
  options?: McqOption[];
  correctOptionId?: string;
  multiSelectOptions?: MultiSelectOption[];
  correctOptionIds?: string[];
  statements?: TrueFalseStatement[];
  shortAnswer?: ShortAnswerSpec;
  fillBlank?: FillBlankSpec;
  matching?: MatchingSpec;
  ordering?: OrderingSpec;
  passageContext?: PassageContextSpec;
  essayParts?: EssayPart[];
  solutionGuide: MathContentPayload;
  /** Tài nguyên hình vẽ, đồ thị, bảng biến thiên gắn với câu */
  visualAssets?: MathVisualAsset[];
  /** Mã nhóm nếu thuộc nhóm câu hỏi dùng chung dữ kiện/hình/đoạn văn */
  groupId?: string;
  lockQuestionPosition: boolean;
  lockOptionShuffle: boolean;
  allowStatementShuffle: boolean;
  /** Cấu trúc khóa 5 lớp thống nhất */
  universalLock?: UniversalLockState;
  /** Snapshot nội dung gốc bất biến và mảnh OOXML kèm theo */
  originalSnapshot?: QuestionOriginalSnapshot;
  dependencyFlags: string[];
  hasVisualAsset: boolean;
  answerConfirmed: boolean;
  /** Truy vết & cổng bảo toàn toán học khi nhập từ PDF hoặc các định dạng đa nguồn */
  sourceVerification?: QuestionSourceVerification;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedPdfBBox {
  /** Tọa độ chuẩn hóa [0..1] theo trang PDF gốc để highlight chính xác */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuestionSourceVerification {
  sourceFormat: string;
  sourceBlockId?: string;
  pageNumber?: number;
  pageSpan?: number[];
  columnIndex?: number;
  bbox?: NormalizedPdfBBox;
  /** READY: an toàn; REVIEW_REQUIRED: cần đối chiếu trang PDF; UNSUPPORTED/BLOCKED: không được phép trộn tự động */
  verificationStatus: 'READY' | 'REVIEW_REQUIRED' | 'UNSUPPORTED' | 'BLOCKED';
  verifiedByTeacher: boolean;
  verifiedAt?: string;
  formulaRiskFlags: string[];
  reasons: string[];
  extractedRawText?: string;
}

export interface QuestionTypeMixPolicy {
  type: UniversalQuestionType;
  label: string;
  shortLabel: string;
  supportsOptionShuffle: boolean;
  supportsInternalItemShuffle: boolean;
  requiresGroupContext: boolean;
  defaultLockOptionShuffle: boolean;
  answerMappingMode:
    | 'option-id'
    | 'multi-option-ids'
    | 'statement-id-map'
    | 'exact-text'
    | 'blank-slot-id'
    | 'pair-id-map'
    | 'rank-id-sequence'
    | 'rubric-outline';
  policySummary: string;
}

export interface ProtectedSymbolPattern {
  id: string;
  label: string;
  description: string;
  example: string;
}

export interface SubjectProfile {
  id: ExamSubjectId;
  name: string;
  shortName: string;
  aliases: string[];
  protectionLevel: SubjectProtectionLevel;
  commonQuestionTypes: UniversalQuestionType[];
  defaultSections: Array<{
    type: UniversalQuestionType;
    title: string;
  }>;
  protectedSymbolPatterns: ProtectedSymbolPattern[];
  groupRules: {
    preferPassageGrouping: boolean;
    lockInternalGroupOrder: boolean;
    preserveStanzaOrChronology: boolean;
    description: string;
  };
  answerConstraints: {
    detectEnglishDependentOptions: boolean;
    detectCrossStatementRefs: boolean;
    lockSequenceDependentOrdering: boolean;
  };
  presentationRules: {
    preserveLineBreaksInPoetryOrCode: boolean;
    preserveIpaPhonetics: boolean;
    fontRecommendation: string;
  };
  warningRules: string[];
  defaultMixPolicy: {
    recommendedLevel: MixLevel;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    shufflePerSectionOnly: boolean;
    lockSharedPassageGroups: boolean;
  };
}

export interface SubjectProfileOverride {
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  shufflePerSectionOnly?: boolean;
  lockSharedPassageGroups?: boolean;
  lockInternalGroupOrder?: boolean;
  preserveLineBreaksInPoetryOrCode?: boolean;
  detectEnglishDependentOptions?: boolean;
}

export interface SubjectDetectionSuggestion {
  suggestedId: ExamSubjectId;
  suggestedName: string;
  confidence: 'high' | 'medium' | 'low';
  matchedSignals: string[];
  /** Hệ thống chỉ gợi ý — giáo viên luôn có quyền xác nhận hoặc đổi môn */
  requiresTeacherConfirmation: true;
}

export interface ExamMatrixRule {
  id: string;
  type: MathQuestionType;
  universalType?: UniversalQuestionType;
  topic: string; // 'Tất cả' hoặc tên chuyên đề cụ thể
  cognitiveLevel: CognitiveLevel;
  count: number;
}

export interface MixConfig {
  level: MixLevel;
  examCount: number;
  startCodeNumber: number;
  customCodeNames: string[];
  seed: string;
  shuffleQuestions: boolean;
  shuffleMcqOptions: boolean;
  keepVdcPositions: boolean;
  preserveTopicRatios: boolean;
  shufflePerSectionOnly: boolean;
  shuffleIndependentTrueFalseStatements: boolean;
  lockedQuestionIds: string[];
  matrixRules: ExamMatrixRule[];
}

export interface OptionPermutationEntry {
  newLabel: McqOptionLabel;
  originalLabel: McqOptionLabel;
  optionId: string;
  locked?: boolean;
}

export interface StatementPermutationEntry {
  newLabel: TrueFalseLabel;
  originalLabel: TrueFalseLabel;
  statementId: string;
  isTrue: boolean;
}

export interface MixedQuestionMapping {
  newOrderNumber: number;
  originalOrderNumber: number;
  questionId: string;
  originalCode: string;
  sectionTitle: string;
  type: MathQuestionType;
  universalType?: UniversalQuestionType;
  cognitiveLevel: CognitiveLevel;
  topic: string;
  groupId?: string;
  optionPermutation?: OptionPermutationEntry[];
  multiSelectPermutation?: Array<{
    newLabel: string;
    originalLabel: string;
    optionId: string;
    isCorrect: boolean;
    locked?: boolean;
  }>;
  statementPermutation?: StatementPermutationEntry[];
  matchingRightPermutation?: Array<{
    newLabel: string;
    originalLabel: string;
    rightItemId: string;
  }>;
  orderingPermutation?: Array<{
    newLabel: string;
    originalLabel: string;
    itemId: string;
    correctRank: number;
  }>;
  wordBankPermutation?: Array<{
    newLabel: string;
    originalLabel: string;
    itemId: string;
  }>;
  newCorrectLabel?: McqOptionLabel;
  originalCorrectLabel?: McqOptionLabel;
  newCorrectLabels?: string[];
  exactAnswerSummary: string;
  lockedPositionApplied: boolean;
  lockedOptionShuffleApplied: boolean;
}

export interface MixedExamAnswerRow {
  number: number;
  questionId: string;
  originalCode: string;
  type: MathQuestionType;
  universalType?: UniversalQuestionType;
  cognitiveLevel: CognitiveLevel;
  answer: string;
}

export type MathIntegrityStatus = 'PASS' | 'WARNING' | 'BLOCKED';

export type IntegrityCheckCategory =
  | 'formula'
  | 'asset'
  | 'structure'
  | 'answer'
  | 'lock'
  | 'layout';

export interface IntegrityCategorySummary {
  category: IntegrityCheckCategory;
  label: string;
  status: MathIntegrityStatus;
  detail: string;
}

export interface OriginalQuestionFingerprint {
  questionId: string;
  code: string;
  type: MathQuestionType;
  universalType?: UniversalQuestionType;
  stemHash: string;
  solutionHash: string;
  correctOptionId?: string;
  correctOptionIds?: string[];
  optionHashes: Record<string, string>;
  multiSelectHashes?: Record<string, { contentHash: string; isCorrect: boolean }>;
  statementHashes: Record<string, { contentHash: string; isTrue: boolean }>;
  fillBlankSlotHash?: string;
  fillBlankWordBankHashes?: Record<string, string>;
  matchingLeftHash?: string;
  matchingRightHashes?: Record<string, string>;
  matchingPairsHash?: string;
  orderingItemsHashes?: Record<string, { contentHash: string; correctRank: number }>;
  shortAnswerHash: string;
  essayPartsHash: string;
  assetChecksums: Record<string, string>;
  lockedPositionIndex: number | null;
  lockedOptionSlots: Record<string, number>;
}

export interface OriginalGroupFingerprint {
  groupId: string;
  questionIds: string[];
  contextHash: string;
  assetChecksums: Record<string, string>;
  lockGroupPosition: boolean;
  moveAsUnit: boolean;
  startIndex: number;
}

export interface OriginalExamSnapshot {
  snapshotId: string;
  createdAt: string;
  examTitle: string;
  questionCount: number;
  confirmedOriginalAnswers: boolean;
  examContentHash: string;
  fingerprintsByQuestionId: Record<string, OriginalQuestionFingerprint>;
  groupFingerprints: Record<string, OriginalGroupFingerprint>;
}

export interface MathIntegrityIssue {
  id: string;
  severity: 'error' | 'warning';
  tier?: 'BLOCKED' | 'WARNING';
  scope:
    | 'exam'
    | 'question'
    | 'option'
    | 'statement'
    | 'latex'
    | 'matrix'
    | 'asset'
    | 'lock'
    | 'group'
    | 'layout'
    | 'export';
  questionId?: string;
  questionNumber?: number;
  code?: string;
  message: string;
  recommendation: string;
}

export interface MathIntegrityReport {
  status: MathIntegrityStatus;
  checkedAt: string;
  canExport: boolean;
  limitationNotice: string;
  categories: IntegrityCategorySummary[];
  issues: MathIntegrityIssue[];
  stats: {
    totalQuestions: number;
    lockedQuestions: number;
    lockedOptions: number;
    lockedGroups: number;
    visualAssetsCount: number;
  };
}

export interface MixedExamVersion {
  code: string;
  seedUsed: string;
  generatedAt: string;
  questions: MathQuestion[];
  permutationMap: MixedQuestionMapping[];
  answerKeyRows: MixedExamAnswerRow[];
  integrityPassed: boolean;
  integrityStatus?: MathIntegrityStatus;
  integrityReport?: MathIntegrityReport;
  integrityWarnings: string[];
}

export type MathExamStep = 1 | 2 | 3 | 4 | 5;

export interface ExamExportSettings {
  departmentName: string;
  schoolName: string;
  examTitleOverride: string;
  headerNote: string;
  footerNote: string;
  paperMarginMm: 10 | 15 | 20;
  fontFamily: 'Be Vietnam Pro' | 'Times New Roman';
  includeAnswerKey: boolean;
  includeAnswerMatrix: boolean;
  includeMappingTable: boolean;
  includeIntegritySummary: boolean;
  separateAnswerKeySection: boolean;
}

export interface ExportIntegrityResult {
  verified: boolean;
  status: MathIntegrityStatus;
  checkedAt: string;
  format: 'pdf-print' | 'docx' | 'zip' | 'json' | 'csv';
  fileCount: number;
  verifiedCodes: string[];
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  issues: MathIntegrityIssue[];
}

export interface MathExamProject {
  id: string;
  title: string;
  /** Tên môn học hiển thị (mặc định 'Toán học' cho đề Toán cũ) */
  subject: string;
  /** Mã hồ sơ môn học chuẩn hóa của Exam Mixer Pro 6.0 */
  subjectId?: ExamSubjectId;
  schemaVersion?: '5.0' | '6.0';
  subjectProfileOverrides?: SubjectProfileOverride;
  exportSettings?: ExamExportSettings;
  grade: string;
  durationMinutes: number;
  schoolYear: string;
  examTypeLabel: string;
  questions: MathQuestion[];
  questionGroups?: QuestionGroup[];
  mixConfig: MixConfig;
  confirmedOriginalAnswers: boolean;
  generatedVersions: MixedExamVersion[];
  lastIntegrityReport?: MathIntegrityReport;
  lastStep: MathExamStep;
  status: 'draft' | 'ready';
  isDemo: boolean;
  /** Hồ sơ nguồn gốc tài liệu nhập gần nhất (Layer 1 provenance) */
  sourceRecord?: {
    sourceId: string;
    fileName: string;
    detectedFormat: string;
    sizeBytes: number;
    contentHash: string;
    importedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const MATH_QUESTION_TYPE_LABELS: Record<MathQuestionType, string> = {
  mcq: 'Trắc nghiệm 4 phương án',
  'true-false': 'Trắc nghiệm Đúng/Sai (4 ý)',
  'short-answer': 'Trả lời ngắn',
  essay: 'Tự luận',
};

export const UNIVERSAL_QUESTION_TYPE_LABELS: Record<UniversalQuestionType, string> = {
  mcq: 'Trắc nghiệm 1 đáp án đúng',
  'multi-select': 'Trắc nghiệm nhiều đáp án đúng',
  'true-false': 'Đúng / Sai nhiều ý',
  'short-answer': 'Trả lời ngắn',
  'fill-blank': 'Điền khuyết / Cloze Test',
  matching: 'Ghép đôi hai cột',
  ordering: 'Sắp xếp đúng trình tự',
  'reading-comprehension': 'Đọc hiểu theo đoạn văn / ngữ liệu',
  essay: 'Tự luận / Trình bày giải chi tiết',
  'shared-context': 'Nhóm câu hỏi dùng chung ngữ liệu / hình',
};

export const MATH_SECTION_TITLES: Record<MathQuestionType, string> = {
  mcq: 'Phần I. Câu trắc nghiệm nhiều phương án lựa chọn',
  'true-false': 'Phần II. Câu trắc nghiệm đúng sai',
  'short-answer': 'Phần III. Câu trắc nghiệm trả lời ngắn',
  essay: 'Phần IV. Tự luận',
};

export const COGNITIVE_LEVEL_LABELS: Record<CognitiveLevel, string> = {
  'nhan-biet': 'Nhận biết',
  'thong-hieu': 'Thông hiểu',
  'van-dung': 'Vận dụng',
  'van-dung-cao': 'Vận dụng cao',
};

export const MATH_TOPICS = [
  'Hàm số & Đạo hàm',
  'Nguyên hàm & Tích phân',
  'Mũ & Logarit',
  'Hình học không gian Oxyz',
  'Hình học phẳng & Lượng giác',
  'Xác suất & Thống kê',
  'Tổ hợp & Dãy số',
  'Phương trình & Bất phương trình',
  'Khác',
] as const;

export const MIX_LEVEL_DESCRIPTIONS: Array<{
  level: MixLevel;
  title: string;
  summary: string;
}> = [
  {
    level: 0,
    title: 'Mức 0 — Giữ nguyên đề gốc',
    summary: 'Không đảo câu hỏi, không đảo đáp án A/B/C/D; chuẩn hóa mã đề và bảng đáp án gốc.',
  },
  {
    level: 1,
    title: 'Mức 1 — Chỉ trộn thứ tự câu hỏi',
    summary: 'Hoán vị thứ tự câu trong từng phần, giữ nguyên thứ tự phương án A/B/C/D.',
  },
  {
    level: 2,
    title: 'Mức 2 — Trộn câu + trộn phương án A/B/C/D',
    summary: 'Trộn câu hỏi và trộn độc lập 4 phương án A/B/C/D (tôn trọng khóa phương án & "Cả A và B").',
  },
  {
    level: 3,
    title: 'Mức 3 — Trộn theo Ma trận & Mức độ nhận thức',
    summary: 'Rút đúng số lượng câu theo bảng ma trận (NB/TH/VD/VDC & chuyên đề) rồi trộn an toàn.',
  },
  {
    level: 4,
    title: 'Mức 4 — Tùy chỉnh quy tắc nâng cao',
    summary: 'Kiểm soát chi tiết khóa câu chỉ định, khóa nhóm, giữ vị trí VDC, khóa chuyên đề và ý Đúng/Sai.',
  },
];

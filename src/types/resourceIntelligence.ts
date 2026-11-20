import type {
  CognitiveLevel,
  ExamSubjectId,
  MathQuestionType,
} from './mathExam';
import type {
  BankQuestionRecord,
  ExamGenerationMode,
  GeneratedExamDraft,
  MatrixShortfallDetail,
} from './examGenerator';

export type QuestionAnswerStatus = 'confirmed' | 'unconfirmed' | 'missing';

export type QuestionSourceVerificationState =
  | 'READY'
  | 'REVIEW_REQUIRED'
  | 'BLOCKED';

export interface QuestionSourceProvenance {
  resourceId: string;
  resourceTitle: string;
  fileName: string;
  folderPath?: string;
  /** Only set when extractor detects an actual PDF page number — never fabricated */
  sourcePage?: number;
  /** Real section/paragraph marker when available (DOCX/text) */
  sourceSection?: string;
  /** Excerpt around original question from source document */
  sourceExcerpt?: string;
  sourceQuestionId: string;
  contentHash: string;
  sourceFileSha256?: string;
  resourceUpdatedAt: string;
  subjectName: string;
  grade: string;
  chapter?: string;
  topic: string;
  questionType: MathQuestionType;
  cognitiveLevel: CognitiveLevel;
  answerStatus: QuestionAnswerStatus;
  verificationStatus: QuestionSourceVerificationState;
  hasMathFormula: boolean;
  visualAssetCount: number;
  ommlWarning?: boolean;
  /** True once a teacher edits or confirms this indexed question; prevents auto-overwrite on re-index */
  teacherEdited?: boolean;
  indexedAt: string;
}

export interface ResourceExtractionWarning {
  resourceId: string;
  fileName: string;
  severity: 'info' | 'warning' | 'blocked';
  message: string;
}

export interface ResourceQuestionIndexSummary {
  resourceId: string;
  resourceTitle: string;
  fileName: string;
  folderPath?: string;
  detectedFormat: string;
  extractedCount: number;
  addedCount: number;
  updatedCount: number;
  skippedDuplicateCount: number;
  preservedTeacherEditedCount: number;
  unconfirmedAnswerCount: number;
  blockedForVariantCount: number;
  warnings: string[];
  indexedAt: string;
  sourceResourceUpdatedAt: string;
  sourceFileSha256?: string;
}

export interface ResourceExtractionOutcome {
  items: BankQuestionRecord[];
  summary: ResourceQuestionIndexSummary;
}

export type RetrievalAnswerConfidence =
  | 'verified-engine'
  | 'teacher-confirmed'
  | 'source-extracted'
  | 'unconfirmed';

export interface SmartRetrievalQuery {
  queryText?: string;
  subjectId?: ExamSubjectId;
  grade?: string;
  chaptersOrTopics?: string[];
  questionTypes?: MathQuestionType[];
  cognitiveLevels?: CognitiveLevel[];
  /** Restrict to specific Resource Vault document IDs */
  resourceIds?: string[];
  /** Match Resource Vault folder path / title keyword */
  resourceFolderKeyword?: string;
  /** Restrict to specific source kinds */
  sourceKinds?: Array<'resource-vault' | 'generator-bank' | 'exam-project'>;
  onlyVariantCapable?: boolean;
  excludeIds?: string[];
  excludeContentHashes?: string[];
  limit?: number;
}

export interface SmartRetrievalCandidate {
  record: BankQuestionRecord;
  /** Combined ranking score */
  totalScore: number;
  /** Content match score (0..100), distinct from answer confidence */
  contentRelevancePercent: number;
  /** Distinct answer trustworthiness signal */
  answerConfidence: RetrievalAnswerConfidence;
  answerConfidenceLabel: string;
  matchReasons: string[];
  canGenerateVariant: boolean;
  variantEligibilityReason: string;
  matchedTemplateId?: string;
  sourceLabel: string;
  isDuplicateOfSelected?: boolean;
}

export interface SmartRetrievalResult {
  candidates: SmartRetrievalCandidate[];
  totalPoolScanned: number;
  filteredCount: number;
  duplicateCollapsedCount: number;
  blockedVariantCount: number;
}

export type ParsedCommandIntent =
  | 'generate-exam'
  | 'search-questions'
  | 'unknown';

export interface DifficultyDistributionSpec {
  nhanBietPercent?: number;
  thongHieuPercent?: number;
  vanDungPercent?: number;
  vanDungCaoPercent?: number;
}

export interface ParsedTypeCountsSpec {
  mcq?: number;
  'true-false'?: number;
  'short-answer'?: number;
  essay?: number;
}

export interface ParsedExamCommand {
  rawPrompt: string;
  intent: ParsedCommandIntent;
  subjectId?: ExamSubjectId;
  subjectName?: string;
  grade?: string;
  examType?: string;
  durationMinutes?: number;
  requestedTotalCount?: number;
  typeCounts: ParsedTypeCountsSpec;
  chaptersOrTopics: string[];
  difficultyDistribution: DifficultyDistributionSpec;
  resourceVaultScope: {
    requested: boolean;
    folderOrDocumentQuery?: string;
    matchedResourceIds: string[];
    matchedResourceTitles: string[];
    includeQuestionBankFallback: boolean;
  };
  variationMode: ExamGenerationMode;
  variationExplicitlyRequested: boolean;
  examVersionCount?: number;
  examVersionCodes: string[];
  examFormLabel?: string;
  exportFormat?: 'docx' | 'pdf' | 'both';
  /** Fields missing from the teacher's Vietnamese request — never silently fabricated */
  missingFields: Array<{
    field: string;
    label: string;
    reason: string;
  }>;
  /** Contradictions that MUST be fixed before generation starts */
  conflicts: string[];
  /** Human-readable summary highlights */
  parsedHighlights: string[];
  /** Honest parser limits / notes */
  notes: string[];
}

export interface NaturalLanguageShortfallAdvice {
  shortfalls: MatrixShortfallDetail[];
  totalFoundMatching: number;
  totalBlockedFromVariants: number;
  suggestedRelaxations: string[];
}

export interface NaturalLanguageExamBuildResult {
  draft: GeneratedExamDraft;
  retrievalByItemId: Record<string, SmartRetrievalCandidate>;
  shortfallAdvice: NaturalLanguageShortfallAdvice;
  sourceResourceIdsUsed: string[];
}

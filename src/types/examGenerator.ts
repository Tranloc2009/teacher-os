import type {
  CognitiveLevel,
  MathQuestion,
  MathQuestionType,
  McqOptionLabel,
  ExamSubjectId,
} from './mathExam';

export type GeneratorQuestionStatus =
  | 'ORIGINAL'
  | 'VARIANT_READY'
  | 'REVIEW_REQUIRED'
  | 'UNSUPPORTED'
  | 'BLOCKED';

export type ExamGenerationMode = 'bank-only' | 'verified-variants' | 'hybrid';

export type VerifiedTemplateFamilyId =
  | 'linear-equation'
  | 'arithmetic-expression'
  | 'algebraic-eval'
  | 'percentage-problem'
  | 'proportion-ratio'
  | 'arithmetic-sequence'
  | 'physics-motion'
  | 'quadratic-equation'
  | 'linear-system-2x2'
  | 'polynomial-derivative'
  | 'quadratic-graph'
  | 'cubic-monotonicity'
  | 'cubic-extrema'
  | 'rational-asymptotes'
  | 'rational-monotonicity'
  | 'graph-variation-table';

export type TemplateCategoryId =
  | 'basic-level-1'
  | 'advanced-algebra-level-2'
  | 'calculus-level-2'
  | 'calculus-graph-level-3';

export type DynamicFunctionFamilyId = 'quadratic' | 'cubic' | 'rational';

export type GraphQuestionSubMode =
  | 'monotonicity-increasing'
  | 'monotonicity-decreasing'
  | 'extrema-points'
  | 'extrema-value'
  | 'asymptotes'
  | 'read-graph'
  | 'choose-variation-table'
  | 'choose-graph';

export type CubicCriticalCasePolicy = 'two-extrema' | 'double-root' | 'no-extrema' | 'any';

export type QuadraticQuestionSubMode =
  | 'solution-set'
  | 'larger-root'
  | 'sum-of-roots'
  | 'double-root';

export type LinearSystemQuestionSubMode =
  | 'ordered-pair'
  | 'sum-xy'
  | 'linear-expr';

export type DerivativeQuestionSubMode =
  | 'derivative-poly'
  | 'value-at-x0'
  | 'term-coefficient';

export interface AdvancedTemplateFamilyConfig {
  /** Quadratic Equation options */
  quadraticMode?: QuadraticQuestionSubMode;
  rootPolicy?: 'distinct' | 'double';
  /** Linear System 2x2 options */
  linearSystemMode?: LinearSystemQuestionSubMode;
  exprP?: number;
  exprQ?: number;
  /** Polynomial Derivative options */
  derivativeMode?: DerivativeQuestionSubMode;
  polynomialDegree?: 2 | 3 | 4;
  targetTermDegree?: number;
  /** Phase 3: Dynamic Function & Graph options */
  graphFunctionFamily?: DynamicFunctionFamilyId;
  graphQuestionMode?: GraphQuestionSubMode;
  cubicCasePolicy?: CubicCriticalCasePolicy;
  /** Shared coefficient magnitude bound */
  maxCoeffMagnitude?: number;
}

export type ParameterValueKind = 'integer' | 'decimal';

export interface ParameterConstraint {
  name: string;
  label: string;
  kind: ParameterValueKind;
  min: number;
  max: number;
  nonZero?: boolean;
  positive?: boolean;
  negative?: boolean;
  allowedSet?: number[];
  uniqueWith?: string[];
  divisibleBy?: string | number;
  decimalPlaces?: number;
  unit?: string;
}

export interface ParameterValidationResult {
  valid: boolean;
  errors: string[];
}

export interface QuestionTemplateDefinition {
  id: string;
  code: string;
  title: string;
  familyId: VerifiedTemplateFamilyId;
  subjectId: ExamSubjectId;
  subjectName: string;
  grade: string;
  topic: string;
  cognitiveLevel: CognitiveLevel;
  questionType: 'mcq' | 'short-answer';
  points: number;
  stemTemplate: string;
  explanationTemplate: string;
  unit?: string;
  decimalPlaces?: number;
  parameters: ParameterConstraint[];
  resultMin?: number;
  resultMax?: number;
  /** Phase 2 optional advanced family configuration (additive, compatible with IndexedDB v8) */
  familyConfig?: AdvancedTemplateFamilyConfig;
  /** Optional link to an original bank question */
  sourceQuestionId?: string;
  verifiedTemplate: boolean;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SymbolicNumberLabel {
  value: number;
  latex: string;
  plain: string;
  isExactRational: boolean;
}

export interface MonotonicityInterval {
  fromLatex: string;
  toLatex: string;
  fromValue: number | null; // null = -Infinity
  toValue: number | null; // null = +Infinity
  sign: '+' | '-';
  trend: 'increasing' | 'decreasing';
  latex: string;
}

export interface CriticalPointInfo {
  x: SymbolicNumberLabel;
  y: SymbolicNumberLabel;
  kind: 'local-max' | 'local-min' | 'stationary-inflection';
  isExtremum: boolean;
}

export interface AsymptoteInfo {
  vertical?: {
    x: SymbolicNumberLabel;
    equationLatex: string;
    leftLimit: '+∞' | '-∞';
    rightLimit: '+∞' | '-∞';
  };
  horizontal?: {
    y: SymbolicNumberLabel;
    equationLatex: string;
  };
}

export interface DynamicFunctionAnalysis {
  family: DynamicFunctionFamilyId;
  params: Record<string, number>;
  fingerprint: string;
  functionLatex: string;
  derivativeLatex: string;
  domainLatex: string;
  excludedPoint?: SymbolicNumberLabel;
  cubicCase?: 'two-extrema' | 'double-root' | 'no-extrema';
  vertex?: { x: SymbolicNumberLabel; y: SymbolicNumberLabel; axisLatex: string };
  criticalPoints: CriticalPointInfo[];
  extrema: CriticalPointInfo[];
  monotonicityIntervals: MonotonicityInterval[];
  asymptotes: AsymptoteInfo;
  yIntercept?: { x: number; y: SymbolicNumberLabel };
  xIntercepts: SymbolicNumberLabel[];
  limitNegInf: string;
  limitPosInf: string;
  verificationPassed: boolean;
  verificationProof: string;
  verificationErrors: string[];
}

export interface VariationTableColumn {
  kind: 'boundary' | 'interval' | 'critical' | 'discontinuity';
  xLabel: string;
  xLatex: string;
  derivSymbol: '' | '+' | '-' | '0' | '||';
  valueLabel?: string;
  valueLatex?: string;
  leftLimitLabel?: string;
  rightLimitLabel?: string;
  trend?: 'up' | 'down';
  extremumBadge?: 'CĐ' | 'CT';
  yPositionHint?: 'high' | 'mid' | 'low';
}

export interface VariationTableModel {
  fingerprint: string;
  functionLatex: string;
  derivativeLatex: string;
  columns: VariationTableColumn[];
}

export interface VariantValidationChecklist {
  dataValid: boolean;
  solutionVerified: boolean;
  optionsDistinct: boolean;
  explanationAligned: boolean;
  canExportExam: boolean;
  requiresTeacherConfirmation: boolean;
  graphConsistent?: boolean;
  variationTableConsistent?: boolean;
}

export interface VariantVerificationProof {
  passed: boolean;
  independentCheckSummary: string;
  distractorCheckPassed: boolean;
  uniqueOptionCount: number;
  validOptionCount: number;
  reasons: string[];
  checklist?: VariantValidationChecklist;
}

export interface GeneratedQuestionVariant {
  id: string;
  variantCode: string;
  parentQuestionId: string;
  templateId: string;
  familyId: VerifiedTemplateFamilyId;
  seed: string;
  parameterSignature: string;
  parameterValues: Record<string, number>;
  question: MathQuestion;
  correctValue: number;
  correctFormatted: string;
  correctCanonicalKey?: string;
  normalizedContentKey?: string;
  correctOptionLabel?: McqOptionLabel;
  explanationText: string;
  status: GeneratorQuestionStatus;
  verification: VariantVerificationProof;
  /** Phase 3: Dynamic Function Graph & Variation Table binding */
  graphFingerprint?: string;
  functionAnalysis?: DynamicFunctionAnalysis;
  graphSvg?: string;
  variationTable?: VariationTableModel;
  variationTableSvg?: string;
  attemptsUsed: number;
  generatedAt: string;
}

export interface VariantGenerationOutcome {
  ok: boolean;
  status: GeneratorQuestionStatus;
  variant?: GeneratedQuestionVariant;
  blockingReasons: string[];
  attemptsUsed: number;
}

export interface BankQuestionRecord {
  id: string;
  code: string;
  subjectId: ExamSubjectId;
  subjectName: string;
  grade: string;
  topic: string;
  cognitiveLevel: CognitiveLevel;
  type: MathQuestionType;
  points: number;
  /** Source origin: dedicated generator bank, read-only mirror from MathExamProject, or indexed from Resource Vault */
  sourceKind: 'generator-bank' | 'exam-project' | 'resource-vault';
  sourceExamId?: string;
  sourceExamTitle?: string;
  /** Resource Vault provenance (additive, optional, Dexie v8 compatible) */
  sourceProvenance?: import('./resourceIntelligence').QuestionSourceProvenance;
  templateId?: string;
  /** Explicit integrity flags */
  hasBinaryFormulaOrOmml?: boolean;
  hasNonUpdatableVisualAsset?: boolean;
  question: MathQuestion;
  createdAt: string;
  updatedAt: string;
}

export interface ExamMatrixBlueprintRow {
  id: string;
  topic: string; // 'Tất cả' or specific topic name
  type: MathQuestionType;
  cognitiveLevel: CognitiveLevel;
  count: number;
  pointsPerQuestion: number;
}

export interface ExamBlueprintConfig {
  title: string;
  subjectId: ExamSubjectId;
  subjectName: string;
  grade: string;
  durationMinutes: number;
  selectedTopics: string[];
  selectedTypes: MathQuestionType[];
  selectedCognitiveLevels: CognitiveLevel[];
  matrixRows: ExamMatrixBlueprintRow[];
  mode: ExamGenerationMode;
  /** Used in hybrid mode: percentage (0..100) of requested slots that prefer verified variants */
  variantRatioPercent: number;
  seed: string;
  examDraftCount: 1 | 2 | 4 | 10;
  allowMultipleVariantsPerTemplate: boolean;
}

export interface MatrixShortfallDetail {
  rowId: string;
  topic: string;
  type: MathQuestionType;
  cognitiveLevel: CognitiveLevel;
  requested: number;
  fulfilled: number;
  shortfall: number;
  reason: string;
}

export interface GeneratedDraftItem {
  id: string;
  orderNumber: number;
  origin: 'bank-original' | 'verified-variant';
  status: GeneratorQuestionStatus;
  parentQuestionId: string;
  templateId?: string;
  variantId?: string;
  variantCode?: string;
  parameterSignature?: string;
  parameterValues?: Record<string, number>;
  graphFingerprint?: string;
  functionAnalysis?: DynamicFunctionAnalysis;
  variationTable?: VariationTableModel;
  /** Optional provenance & retrieval transparency when built via Resource Vault / NL Builder */
  sourceProvenance?: import('./resourceIntelligence').QuestionSourceProvenance;
  selectionReasons?: string[];
  contentRelevancePercent?: number;
  verificationSummary: string;
  locked: boolean;
  teacherConfirmed: boolean;
  question: MathQuestion;
}

export interface ExamGenerationReport {
  requestedTotal: number;
  generatedTotal: number;
  originalCount: number;
  variantCount: number;
  reviewRequiredCount: number;
  unsupportedCount: number;
  blockedCount: number;
  shortfalls: MatrixShortfallDetail[];
  warnings: string[];
  cancelled: boolean;
  seedUsed: string;
  generatedAt: string;
}

export interface GeneratedExamDraft {
  id: string;
  draftNumber: number;
  draftLabel: string;
  title: string;
  subjectId: ExamSubjectId;
  subjectName: string;
  grade: string;
  durationMinutes: number;
  mode: ExamGenerationMode;
  seed: string;
  totalPoints: number;
  status: 'draft' | 'reviewed' | 'exported';
  allAnswersConfirmed: boolean;
  items: GeneratedDraftItem[];
  report: ExamGenerationReport;
  exportedExamProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratorBackupBundle {
  version: 'smart-exam-generator-2.0-phase1';
  exportedAt: string;
  bankQuestions: BankQuestionRecord[];
  templates: QuestionTemplateDefinition[];
  drafts: GeneratedExamDraft[];
}

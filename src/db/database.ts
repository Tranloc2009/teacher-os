import Dexie, { type Table } from 'dexie';
import {
  JournalEntry,
  LessonPack,
  PrintSettings,
  ResourceItem,
  RubricCriterion,
  WorkflowRun,
} from '../types/lesson';
import { StoredResourceFileRecord } from '../types/resourceBulk';
import type {
  EvidenceBlobRecord,
  GradingSession,
  StudentRoster,
} from '../types/grading';
import type {
  BankQuestionRecord,
  GeneratedExamDraft,
  GeneratorBackupBundle,
  QuestionTemplateDefinition,
} from '../types/examGenerator';
import type {
  ConnectedWorkflowContext,
  ConnectedWorkflowStore,
} from '../types/connectedWorkflow';
import {
  CONNECTED_WORKFLOW_META_KEY,
  CONNECTED_WORKFLOW_STORE_KEY,
  createInitialWorkflowContext,
  getActiveWorkflowFromStore,
  normalizeStoredWorkflowContext,
  normalizeStoredWorkflowStore,
} from '../core/connectedWorkflowEngine';
import type { ExamFormTemplate } from '../types/examForm';
import {
  BUILT_IN_EXAM_FORM_PRESETS,
  EXAM_FORM_TEMPLATES_META_KEY,
  mergeStoredExamFormTemplates,
} from '../core/examFormEngine';
import type { ExternalIntegrationConfig } from '../types/azota';
import {
  createDefaultExternalIntegrationConfig,
  sanitizeExternalIntegrationConfig,
} from '../core/azotaIntegrationEngine';
import {
  DEMO_GENERATOR_BANK,
  DEMO_GENERATOR_TEMPLATES,
  PHASE2_DEMO_BANK,
  PHASE2_DEMO_TEMPLATES,
  PHASE3_DEMO_BANK,
  PHASE3_DEMO_TEMPLATES,
} from '../data/demoExamGeneratorData';
import { deleteBlobFromOpfs, readBlobFromOpfs } from '../core/resourceStorage';
import { DEMO_LESSON_PACKS } from '../data/demoPacks';
import { DEMO_MATH_EXAM } from '../data/demoMathExams';
import {
  DEFAULT_CANVAS_BOARDS,
  DEFAULT_CANVAS_EDGES,
  DEFAULT_CANVAS_NODES,
  DEFAULT_CANVAS_VIEW_SETTINGS,
} from '../data/demoCanvas';
import {
  normalizeCanvasBoard,
  normalizeCanvasEdge,
  normalizeCanvasNode,
  normalizeCanvasViewSettings,
} from '../core/canvasEngine';
import {
  CanvasBoard,
  CanvasEdgeRecord,
  CanvasNodeRecord,
  CanvasViewSettings,
} from '../types/canvas';
import { MathExamProject } from '../types/mathExam';
import {
  buildUniversalLockState,
  getSubjectProfile,
  getUniversalQuestionType,
  resolveSubjectId,
} from '../core/subjectProfileRegistry';
import { reconcileLegacyQuestionAnswerState } from '../core/mathAnswerState';
import {
  DEFAULT_JOURNALS,
  DEFAULT_RESOURCES,
  DEFAULT_WORKFLOWS,
  PHASE_A_VAULT_EXAM_RESOURCES,
} from '../core/workspaceModules';
import {
  createDefaultWorksheetVariants,
  generateNextQuestionCode,
  normalizeWorksheetVariants,
} from '../utils/allocation';
import { DEFAULT_PRINT_SETTINGS } from '../utils/backup';
import { executeStorageOperation } from '../utils/storageResilience';

interface MetaRecord {
  key: string;
  value: string;
}

export interface LocalSnapshotRecord {
  version: '4.0-snapshot';
  label: string;
  createdAt: string;
  packCount: number;
  lessonPacks: LessonPack[];
  settings: PrintSettings;
  resources?: ResourceItem[];
  workflows?: WorkflowRun[];
  journals?: JournalEntry[];
  mathExams?: MathExamProject[];
  canvasBoards?: CanvasBoard[];
  canvasNodes?: CanvasNodeRecord[];
  canvasEdges?: CanvasEdgeRecord[];
  canvasViewSettings?: CanvasViewSettings[];
}

export interface LocalSnapshotSummary {
  exists: boolean;
  label: string;
  createdAt: string;
  packCount: number;
}

const SNAPSHOT_META_KEY = 'snapshot_pre_v4_0';

class TeacherOSDatabase extends Dexie {
  lessonPacks!: Table<LessonPack, string>;
  settings!: Table<PrintSettings, string>;
  meta!: Table<MetaRecord, string>;
  resources!: Table<ResourceItem, string>;
  workflows!: Table<WorkflowRun, string>;
  journals!: Table<JournalEntry, string>;
  mathExams!: Table<MathExamProject, string>;
  canvasBoards!: Table<CanvasBoard, string>;
  canvasNodes!: Table<CanvasNodeRecord, string>;
  canvasEdges!: Table<CanvasEdgeRecord, string>;
  canvasViewSettings!: Table<CanvasViewSettings, string>;
  resourceFiles!: Table<StoredResourceFileRecord, string>;
  gradingSessions!: Table<GradingSession, string>;
  gradingRosters!: Table<StudentRoster, string>;
  gradingEvidenceBlobs!: Table<EvidenceBlobRecord, string>;
  examGeneratorBank!: Table<BankQuestionRecord, string>;
  examGeneratorTemplates!: Table<QuestionTemplateDefinition, string>;
  examGeneratorDrafts!: Table<GeneratedExamDraft, string>;

  constructor() {
    super('TeacherOS2DB');
    this.version(1).stores({
      lessonPacks: 'id, subject, grade, status, isDemo, updatedAt',
      settings: 'id',
      meta: 'key',
    });
    // Phiên bản 2 (TeacherOS 4.0 GĐ 1-2): giữ nguyên 100% dữ liệu v1
    this.version(2).stores({
      lessonPacks: 'id, subject, grade, status, isDemo, updatedAt',
      settings: 'id',
      meta: 'key',
    });
    // Phiên bản 3 (TeacherOS 4.0 GĐ 3-5): bổ sung bảng mở rộng không phá hủy dữ liệu v1/v2
    this.version(3).stores({
      lessonPacks: 'id, subject, grade, status, isDemo, updatedAt',
      settings: 'id',
      meta: 'key',
      resources: 'id, type, subject, grade, updatedAt',
      workflows: 'id, linkedPackId, updatedAt',
      journals: 'id, packId, taughtDate, updatedAt',
    });
    // Phiên bản 4 (Math Exam Mixer Pro): bổ sung bảng mathExams cộng thêm, giữ nguyên toàn bộ bảng cũ
    this.version(4).stores({
      lessonPacks: 'id, subject, grade, status, isDemo, updatedAt',
      settings: 'id',
      meta: 'key',
      resources: 'id, type, subject, grade, updatedAt',
      workflows: 'id, linkedPackId, updatedAt',
      journals: 'id, packId, taughtDate, updatedAt',
      mathExams: 'id, grade, status, updatedAt',
    });
    // Phiên bản 5 (Visual Workspace Engine): bổ sung 4 bảng Canvas cộng thêm, giữ nguyên 100% dữ liệu v1-v4
    this.version(5).stores({
      lessonPacks: 'id, subject, grade, status, isDemo, updatedAt',
      settings: 'id',
      meta: 'key',
      resources: 'id, type, subject, grade, updatedAt',
      workflows: 'id, linkedPackId, updatedAt',
      journals: 'id, packId, taughtDate, updatedAt',
      mathExams: 'id, grade, status, updatedAt',
      canvasBoards: 'id, mode, updatedAt',
      canvasNodes: 'id, boardId, type, parentId, updatedAt',
      canvasEdges: 'id, boardId, source, target, edgeType',
      canvasViewSettings: 'boardId',
    });
    // Phiên bản 6 (Resource Vault Smart Bulk Import 1.0): bổ sung bảng resourceFiles lưu tệp đính kèm nhị phân, giữ nguyên 100% dữ liệu v1-v5
    this.version(6).stores({
      lessonPacks: 'id, subject, grade, status, isDemo, updatedAt',
      settings: 'id',
      meta: 'key',
      resources: 'id, type, subject, grade, updatedAt',
      workflows: 'id, linkedPackId, updatedAt',
      journals: 'id, packId, taughtDate, updatedAt',
      mathExams: 'id, grade, status, updatedAt',
      canvasBoards: 'id, mode, updatedAt',
      canvasNodes: 'id, boardId, type, parentId, updatedAt',
      canvasEdges: 'id, boardId, source, target, edgeType',
      canvasViewSettings: 'boardId',
      resourceFiles: 'id, resourceId, sha256, storageKind, updatedAt',
    });
    // Phiên bản 7 (Smart Grading Studio 1.0): bổ sung bảng chấm OMR & ảnh minh chứng nhị phân, giữ nguyên 100% dữ liệu v1-v6
    this.version(7).stores({
      lessonPacks: 'id, subject, grade, status, isDemo, updatedAt',
      settings: 'id',
      meta: 'key',
      resources: 'id, type, subject, grade, updatedAt',
      workflows: 'id, linkedPackId, updatedAt',
      journals: 'id, packId, taughtDate, updatedAt',
      mathExams: 'id, grade, status, updatedAt',
      canvasBoards: 'id, mode, updatedAt',
      canvasNodes: 'id, boardId, type, parentId, updatedAt',
      canvasEdges: 'id, boardId, source, target, edgeType',
      canvasViewSettings: 'boardId',
      resourceFiles: 'id, resourceId, sha256, storageKind, updatedAt',
      gradingSessions: 'id, examId, className, updatedAt',
      gradingRosters: 'id, className, updatedAt',
      gradingEvidenceBlobs: 'id, sessionId, sheetId, kind, updatedAt',
    });
    // Phiên bản 8 (Smart Exam Generator 2.0 — Phase 1): bổ sung 3 bảng ngân hàng câu hỏi, mẫu tham số và đề tạo tự động, giữ nguyên 100% dữ liệu v1-v7
    this.version(8).stores({
      lessonPacks: 'id, subject, grade, status, isDemo, updatedAt',
      settings: 'id',
      meta: 'key',
      resources: 'id, type, subject, grade, updatedAt',
      workflows: 'id, linkedPackId, updatedAt',
      journals: 'id, packId, taughtDate, updatedAt',
      mathExams: 'id, grade, status, updatedAt',
      canvasBoards: 'id, mode, updatedAt',
      canvasNodes: 'id, boardId, type, parentId, updatedAt',
      canvasEdges: 'id, boardId, source, target, edgeType',
      canvasViewSettings: 'boardId',
      resourceFiles: 'id, resourceId, sha256, storageKind, updatedAt',
      gradingSessions: 'id, examId, className, updatedAt',
      gradingRosters: 'id, className, updatedAt',
      gradingEvidenceBlobs: 'id, sessionId, sheetId, kind, updatedAt',
      examGeneratorBank: 'id, subjectId, grade, topic, cognitiveLevel, type, updatedAt',
      examGeneratorTemplates: 'id, familyId, subjectId, grade, updatedAt',
      examGeneratorDrafts: 'id, subjectId, grade, status, updatedAt',
    });
  }
}

export const db = new TeacherOSDatabase();

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Rubric mặc định gồm 3 tiêu chí (trong khung 3–5 tiêu chí) và 3 mức đạt.
 */
export function createDefaultRubric(): RubricCriterion[] {
  return [
    {
      id: createId('rub'),
      name: 'Mức độ nắm vững kiến thức trọng tâm',
      weightPercent: 40,
      levels: {
        needsSupport: 'Chưa nhận diện được ý chính của bài, còn thiếu nhiều nội dung cơ bản.',
        meets: 'Nắm được kiến thức cơ bản theo yêu cầu nhưng giải thích đôi chỗ chưa trọn vẹn.',
        exceeds: 'Trình bày chính xác, đầy đủ và biết liên hệ hoặc mở rộng hợp lý.',
      },
    },
    {
      id: createId('rub'),
      name: 'Phương pháp lập luận và giải quyết vấn đề',
      weightPercent: 35,
      levels: {
        needsSupport: 'Các bước làm rời rạc, chưa nêu được cách tiếp cận hoặc lập luận.',
        meets: 'Thực hiện đúng trình tự các bước giải quyết nhiệm vụ học tập.',
        exceeds: 'Lập luận chặt chẽ, chọn cách làm gọn gàng và có kiểm chứng kết quả.',
      },
    },
    {
      id: createId('rub'),
      name: 'Trình bày sản phẩm và diễn đạt tiếng Việt',
      weightPercent: 25,
      levels: {
        needsSupport: 'Trình bày thiếu rõ ràng, còn mắc nhiều lỗi chính tả hoặc thuật ngữ.',
        meets: 'Chữ viết/sơ đồ dễ theo dõi, dùng từ đúng ngữ pháp và thuật ngữ cơ bản.',
        exceeds: 'Trình bày khoa học, mạch lạc, chuẩn xác thuật ngữ và sạch đẹp.',
      },
    },
  ];
}

export function createEmptyLessonPack(): LessonPack {
  const now = new Date().toISOString();
  const baseDistribution = { basic: 2, applied: 1, extended: 1 };
  return {
    id: createId('pack'),
    title: '',
    subject: 'Toán học',
    grade: 'Lớp 8',
    duration: 45,
    objectives: [''],
    activities: [],
    questions: [],
    distribution: baseDistribution,
    worksheetVariants: createDefaultWorksheetVariants(baseDistribution),
    rubric: createDefaultRubric(),
    status: 'draft',
    isDemo: false,
    lastStep: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Chuẩn hóa bản ghi cũ trong IndexedDB (nếu được tạo trước khi nâng cấp F03/F04)
 * để không làm lỗi khi người dùng mở lại bản nháp cũ.
 */
export function normalizeLegacyLessonPack(raw: LessonPack): LessonPack {
  const normalizedQuestions = [...(raw.questions || [])];
  for (let i = 0; i < normalizedQuestions.length; i++) {
    const q = normalizedQuestions[i];
    if (!q.code || !q.code.trim()) {
      normalizedQuestions[i] = {
        ...q,
        code: generateNextQuestionCode(normalizedQuestions.slice(0, i), q.tier),
      };
    }
  }

  const normalizedRubric: RubricCriterion[] = (raw.rubric || []).map((c) => {
    const rawLevels = c.levels as unknown as Record<string, string>;
    if (
      typeof rawLevels.needsSupport === 'string' &&
      typeof rawLevels.meets === 'string' &&
      typeof rawLevels.exceeds === 'string'
    ) {
      return c;
    }
    return {
      ...c,
      levels: {
        needsSupport: rawLevels.emerging || '',
        meets: rawLevels.developing || rawLevels.proficient || '',
        exceeds: rawLevels.exemplary || rawLevels.proficient || '',
      },
    };
  });

  return {
    ...raw,
    questions: normalizedQuestions,
    worksheetVariants: normalizeWorksheetVariants(raw),
    rubric: normalizedRubric,
  };
}

/**
 * Phát hiện dữ liệu lỗi từ phiên bản nhập cũ trong IndexedDB (VD: câu Đúng/Sai bị chấm
 * bằng chuỗi lỗi 666/6666, thiếu mệnh đề, hoặc MCQ thiếu/lệch đáp án đúng).
 */
function detectLegacyQuestionAnomalies(q: MathExamProject['questions'][number]): string[] {
  const reasons: string[] = [...(q.legacyAnomalyReasons ?? [])];
  const pushUnique = (msg: string) => {
    if (!reasons.includes(msg)) reasons.push(msg);
  };

  if (q.type === 'true-false') {
    const saVal = q.shortAnswer?.answerValue?.trim() ?? '';
    const solVal = q.solutionGuide?.rawSource?.trim() ?? '';
    if (/^6{3,}$/.test(saVal) || /\b6666?\b/.test(solVal)) {
      pushUnique(
        'Phát hiện dấu hiệu đáp án lỗi legacy (chuỗi 666/6666) trong câu Đúng–Sai — bắt buộc rà soát lại 4 mệnh đề a/b/c/d.'
      );
    }
    const sts = q.statements ?? [];
    if (sts.length !== 4) {
      pushUnique(`Câu Đúng–Sai dữ liệu cũ có ${sts.length}/4 mệnh đề — cần rà soát lại cấu trúc.`);
    }
    if (sts.some((s) => /^6{3,}$/.test(s.content?.rawSource?.trim() ?? ''))) {
      pushUnique('Phát hiện nội dung mệnh đề Đúng–Sai bị hỏng (666/6666) từ bản lưu cũ.');
    }
  }

  if (q.type === 'short-answer') {
    const saVal = q.shortAnswer?.answerValue?.trim() ?? '';
    const uType = q.universalType ?? q.type;
    const isPartI = /PHẦN\s*(?:I|1)\b|NHIỀU\s*PHƯƠNG\s*ÁN|4\s*PHƯƠNG\s*ÁN|MỘT\s*PHƯƠNG\s*ÁN/i.test(
      q.sectionTitle || ''
    );
    const isPurePartII =
      /PHẦN\s*II\b|ĐÚNG\s*[-–/]\s*SAI/i.test(q.sectionTitle || '') &&
      !/NỐI|GHÉP|MATCHING|ĐIỀN\s*KHUYẾT|SẮP\s*XẾP/i.test(q.sectionTitle || '');
    if (
      uType === 'short-answer' &&
      isPartI &&
      !/TRẢ\s*LỜI\s*NGẮN|TỰ\s*LUẬN|PHẦN\s*(?:II|III|IV)\b/i.test(q.sectionTitle || '')
    ) {
      pushUnique(
        `Câu Trả lời ngắn nằm lạc trong Phần I Trắc nghiệm nhiều phương án ("${q.sectionTitle}") — cần chuyển đúng loại câu hoặc chuyển phần.`
      );
    }
    if ((isPurePartII && uType === 'short-answer') || /^6{3,}$/.test(saVal)) {
      pushUnique(
        `Câu Trả lời ngắn mang dấu hiệu sai kiểu/đáp án legacy (${saVal || 'thuộc Phần II Đúng–Sai'}) — cần kiểm tra lại.`
      );
    }
  }

  if (q.type === 'mcq') {
    const opts = q.options ?? [];
    const correctOpts = opts.filter((o) => o.isCorrect);
    const isPartISingleChoice =
      /PHẦN\s*(?:I|1)\b|NHIỀU\s*PHƯƠNG\s*ÁN|MỘT\s*PHƯƠNG\s*ÁN/i.test(q.sectionTitle || '') &&
      !/NHIỀU\s*ĐÁP\s*ÁN|CHỌN\s*NHIỀU|MULTI/i.test(q.sectionTitle || '');
    const hasValidMultiSelect = Boolean(
      q.multiSelectOptions && q.multiSelectOptions.filter((o) => o.isCorrect).length >= 2
    );
    if (isPartISingleChoice && q.universalType === 'multi-select' && !hasValidMultiSelect) {
      pushUnique(
        'Câu thuộc Phần I Trắc nghiệm 1 đáp án nhưng đang mang kiểu universalType="multi-select" (lỗi phân loại legacy) — cần đồng bộ lại kiểu câu.'
      );
    }
    if (q.correctOptionId && !opts.some((o) => o.id === q.correctOptionId)) {
      pushUnique('Mã correctOptionId của câu MCQ cũ không khớp phương án nào.');
    }
    if (correctOpts.length > 1) {
      pushUnique(`Câu MCQ cũ có ${correctOpts.length} phương án cùng đánh dấu đúng.`);
    }
  }

  return reasons;
}

/**
 * Chuẩn hóa đề Toán/đa môn trong IndexedDB (v4/v5/v6) để bổ sung Subject Profile,
 * Universal Question Type, Universal Lock 5 lớp, Visual Asset, Question Group
 * và vệ sinh các bản ghi lỗi từ phiên bản cũ (legacy hygiene) mà không xóa dữ liệu giáo viên.
 */
export function normalizeMathExamProject(raw: MathExamProject): MathExamProject {
  const resolvedSubjectId = resolveSubjectId(raw.subjectId || raw.subject || 'Toán học');
  const subjectProfile = getSubjectProfile(resolvedSubjectId);
  const resolvedSubjectName =
    typeof raw.subject === 'string' && raw.subject.trim()
      ? raw.subject
      : subjectProfile.name;

  let detectedCorruptLegacy = false;

  const normalizedQuestions = (raw.questions || []).map((q) => {
    const normalizedOptions = q.options?.map((o) => ({
      ...o,
      lockPosition: Boolean(o.lockPosition),
    }));
    const legacyAnomalies = detectLegacyQuestionAnomalies(q);
    if (legacyAnomalies.length > 0) {
      detectedCorruptLegacy = true;
    }

    let answerProvenance = q.answerProvenance;
    let answerConfirmed = q.answerConfirmed;

    if (legacyAnomalies.length > 0) {
      answerConfirmed = false;
      answerProvenance = {
        status: 'needs-review',
        sourceKind: 'legacy-unverified',
        rawEvidence: answerProvenance?.rawEvidence,
        note: legacyAnomalies.join(' '),
      };
    } else if (!answerProvenance && raw.isDemo && q.answerConfirmed) {
      answerProvenance = {
        status: 'teacher-confirmed',
        sourceKind: 'seed-demo',
        note: 'Dữ liệu đề mẫu chuẩn của hệ thống.',
      };
    }

    const normalizedQuestion = reconcileLegacyQuestionAnswerState({
      ...q,
      subjectId: q.subjectId ?? resolvedSubjectId,
      universalType: getUniversalQuestionType(q),
      visualAssets: Array.isArray(q.visualAssets) ? q.visualAssets : [],
      options: normalizedOptions,
      answerConfirmed,
      answerProvenance,
      legacyAnomalyReasons: legacyAnomalies.length > 0 ? legacyAnomalies : undefined,
    });
    return {
      ...normalizedQuestion,
      universalLock: buildUniversalLockState(normalizedQuestion, subjectProfile),
    };
  });

  // Kiểm tra thêm bản mã đề cũ có chứa khóa lỗi 666/6666 ở câu Đúng/Sai không
  const existingVersions = Array.isArray(raw.generatedVersions) ? raw.generatedVersions : [];
  const hasCorruptGeneratedVersions = existingVersions.some((ver) =>
    (ver.answerKeyRows ?? []).some(
      (row) => row.type === 'true-false' && /\b6{3,}\b/.test(row.answer ?? '')
    )
  );
  if (hasCorruptGeneratedVersions) {
    detectedCorruptLegacy = true;
  }

  return {
    ...raw,
    subject: resolvedSubjectName,
    subjectId: resolvedSubjectId,
    schemaVersion: raw.schemaVersion ?? '5.0',
    questionGroups: Array.isArray(raw.questionGroups) ? raw.questionGroups : [],
    questions: normalizedQuestions,
    confirmedOriginalAnswers: detectedCorruptLegacy ? false : raw.confirmedOriginalAnswers,
    mixConfig: {
      ...raw.mixConfig,
      keepDependentGroups: raw.mixConfig?.keepDependentGroups ?? true,
      lockedQuestionIds: Array.isArray(raw.mixConfig?.lockedQuestionIds)
        ? raw.mixConfig.lockedQuestionIds
        : [],
      customCodeNames: Array.isArray(raw.mixConfig?.customCodeNames)
        ? raw.mixConfig.customCodeNames
        : [],
      matrixRules: Array.isArray(raw.mixConfig?.matrixRules)
        ? raw.mixConfig.matrixRules
        : [],
    },
    generatedVersions: detectedCorruptLegacy ? [] : existingVersions,
  };
}

export async function initializeDatabase(): Promise<{
  packs: LessonPack[];
  settings: PrintSettings;
  resources: ResourceItem[];
  workflows: WorkflowRun[];
  journals: JournalEntry[];
  mathExams: MathExamProject[];
  canvasBoards: CanvasBoard[];
  canvasNodes: CanvasNodeRecord[];
  canvasEdges: CanvasEdgeRecord[];
  canvasViewSettings: CanvasViewSettings[];
}> {
  return executeStorageOperation(async () => {
    await db.transaction(
      'rw',
      [
        db.lessonPacks,
        db.settings,
        db.meta,
        db.resources,
        db.workflows,
        db.journals,
        db.mathExams,
        db.canvasBoards,
        db.canvasNodes,
        db.canvasEdges,
        db.canvasViewSettings,
      ],
      async () => {
        const seededMeta = await db.meta.get('demo_seeded_v1');
        if (!seededMeta) {
          const existingCount = await db.lessonPacks.count();
          if (existingCount === 0) {
            await db.lessonPacks.bulkPut(DEMO_LESSON_PACKS);
          }
          await db.meta.put({ key: 'demo_seeded_v1', value: 'true' });
        } else {
          const existingAll = await db.lessonPacks.toArray();
          for (const item of existingAll) {
            if (item.isDemo) {
              const freshDemo = DEMO_LESSON_PACKS.find((d) => d.id === item.id);
              if (
                freshDemo &&
                (!item.worksheetVariants ||
                  (item.rubric[0]?.levels as unknown as Record<string, unknown>)?.emerging !==
                    undefined)
              ) {
                await db.lessonPacks.put(freshDemo);
              }
            }
          }
        }

        const existingSettings = await db.settings.get('default');
        if (!existingSettings) {
          await db.settings.put({
            ...DEFAULT_PRINT_SETTINGS,
            updatedAt: new Date().toISOString(),
          });
        }

        // Khởi tạo dữ liệu mẫu cho GĐ 3-4 (Resource Vault, Workflow Center, Teaching Journal) một lần duy nhất
        const modulesSeeded = await db.meta.get('modules_seeded_v4');
        if (!modulesSeeded) {
          const [resCount, wfCount, jrnCount] = await Promise.all([
            db.resources.count(),
            db.workflows.count(),
            db.journals.count(),
          ]);
          if (resCount === 0) {
            await db.resources.bulkPut(DEFAULT_RESOURCES);
          }
          if (wfCount === 0) {
            await db.workflows.bulkPut(DEFAULT_WORKFLOWS);
          }
          if (jrnCount === 0) {
            await db.journals.bulkPut(DEFAULT_JOURNALS);
          }
          await db.meta.put({ key: 'modules_seeded_v4', value: 'true' });
        }

        // Bổ sung tài liệu đề Toán 12 cho Resource Vault Intelligence (chỉ thêm nếu chưa có, không ghi đè dữ liệu người dùng)
        const phaseAVaultSeeded = await db.meta.get('resource_vault_phase_a_v1');
        if (!phaseAVaultSeeded) {
          for (const resItem of PHASE_A_VAULT_EXAM_RESOURCES) {
            const exists = await db.resources.get(resItem.id);
            if (!exists) {
              await db.resources.put(structuredClone(resItem));
            }
          }
          await db.meta.put({ key: 'resource_vault_phase_a_v1', value: 'true' });
        }

        // Khởi tạo đề Toán mẫu GDPT 2018 cho Math Exam Mixer Pro (1 lần duy nhất)
        const mathSeeded = await db.meta.get('math_exam_seeded_v1');
        if (!mathSeeded) {
          const mathCount = await db.mathExams.count();
          if (mathCount === 0) {
            await db.mathExams.put(structuredClone(DEMO_MATH_EXAM));
          }
          await db.meta.put({ key: 'math_exam_seeded_v1', value: 'true' });
        } else {
          // Bổ sung cấu trúc Math Safety Engine cho đề demo gốc nếu chưa chỉnh sửa nhóm/tài nguyên
          const existingMath = await db.mathExams.toArray();
          for (const ex of existingMath) {
            if (ex.isDemo && ex.id === DEMO_MATH_EXAM.id && !Array.isArray(ex.questionGroups)) {
              await db.mathExams.put(structuredClone(DEMO_MATH_EXAM));
            }
          }
        }

        // Tạo bản chụp an toàn (pre-migration snapshot) nếu chưa có để hỗ trợ Rollback tức thì
        const existingSnapshot = await db.meta.get(SNAPSHOT_META_KEY);
        if (!existingSnapshot) {
          const currentPacks = (await db.lessonPacks.toArray()).map(normalizeLegacyLessonPack);
          const currentSettings =
            (await db.settings.get('default')) ?? {
              ...DEFAULT_PRINT_SETTINGS,
              updatedAt: new Date().toISOString(),
            };
          const snapshotPayload: LocalSnapshotRecord = {
            version: '4.0-snapshot',
            label: 'Bản chụp tự động khi nâng cấp TeacherOS 4.0',
            createdAt: new Date().toISOString(),
            packCount: currentPacks.length,
            lessonPacks: currentPacks,
            settings: currentSettings,
          };
          await db.meta.put({
            key: SNAPSHOT_META_KEY,
            value: JSON.stringify(snapshotPayload),
          });
        }

        // Khởi tạo dữ liệu mẫu cho Visual Workspace Engine (1 lần duy nhất, không ghi đè dữ liệu người dùng)
        const canvasSeeded = await db.meta.get('canvas_seeded_v1');
        if (!canvasSeeded) {
          const boardCount = await db.canvasBoards.count();
          if (boardCount === 0) {
            await db.canvasBoards.bulkPut(structuredClone(DEFAULT_CANVAS_BOARDS));
            await db.canvasNodes.bulkPut(structuredClone(DEFAULT_CANVAS_NODES));
            await db.canvasEdges.bulkPut(structuredClone(DEFAULT_CANVAS_EDGES));
            await db.canvasViewSettings.bulkPut(structuredClone(DEFAULT_CANVAS_VIEW_SETTINGS));
          }
          await db.meta.put({ key: 'canvas_seeded_v1', value: 'true' });
        }
      }
    );

    const [
      packs,
      settings,
      resources,
      workflows,
      journals,
      mathExams,
      canvasBoards,
      canvasNodes,
      canvasEdges,
      canvasViewSettings,
    ] = await Promise.all([
      listLessonPacks(),
      getPrintSettings(),
      listResources(),
      listWorkflows(),
      listJournals(),
      listMathExams(),
      listCanvasBoards(),
      listCanvasNodes(),
      listCanvasEdges(),
      listCanvasViewSettings(),
    ]);
    return {
      packs,
      settings,
      resources,
      workflows,
      journals,
      mathExams,
      canvasBoards,
      canvasNodes,
      canvasEdges,
      canvasViewSettings,
    };
  });
}

export async function listLessonPacks(): Promise<LessonPack[]> {
  return executeStorageOperation(async () => {
    const all = await db.lessonPacks.toArray();
    return all
      .map(normalizeLegacyLessonPack)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function saveLessonPack(pack: LessonPack): Promise<LessonPack> {
  return executeStorageOperation(async () => {
    const normalized: LessonPack = {
      ...normalizeLegacyLessonPack(pack),
      updatedAt: new Date().toISOString(),
    };
    await db.lessonPacks.put(normalized);
    return normalized;
  });
}

export async function duplicateLessonPack(source: LessonPack): Promise<LessonPack> {
  return executeStorageOperation(async () => {
    const now = new Date().toISOString();
    const cleanTitle = source.title.replace(/^\[DEMO\]\s*/i, '');
    const copy: LessonPack = {
      ...structuredClone(normalizeLegacyLessonPack(source)),
      id: createId('pack'),
      title: `${cleanTitle} (Bản sao)`,
      isDemo: false,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    await db.lessonPacks.put(copy);
    return copy;
  });
}

export async function deleteLessonPack(id: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.lessonPacks.delete(id);
  });
}

export async function clearDemoPacks(): Promise<number> {
  return executeStorageOperation(async () => {
    const demos = await db.lessonPacks.filter((p) => p.isDemo).toArray();
    const ids = demos.map((d) => d.id);
    if (ids.length > 0) {
      await db.lessonPacks.bulkDelete(ids);
    }
    return ids.length;
  });
}

export async function restoreDemoPacks(): Promise<void> {
  return executeStorageOperation(async () => {
    await db.lessonPacks.bulkPut(DEMO_LESSON_PACKS);
  });
}

export async function getPrintSettings(): Promise<PrintSettings> {
  return executeStorageOperation(async () => {
    const found = await db.settings.get('default');
    if (found) return found;
    const fresh = { ...DEFAULT_PRINT_SETTINGS, updatedAt: new Date().toISOString() };
    await db.settings.put(fresh);
    return fresh;
  });
}

export async function savePrintSettings(settings: PrintSettings): Promise<PrintSettings> {
  return executeStorageOperation(async () => {
    const normalized: PrintSettings = {
      ...settings,
      id: 'default',
      paperSize: 'A4',
      updatedAt: new Date().toISOString(),
    };
    await db.settings.put(normalized);
    return normalized;
  });
}

// --- Resource Vault CRUD ---
export async function listResources(): Promise<ResourceItem[]> {
  return executeStorageOperation(async () => {
    const all = await db.resources.toArray();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function saveResource(item: ResourceItem): Promise<ResourceItem> {
  return executeStorageOperation(async () => {
    const updated: ResourceItem = {
      ...item,
      updatedAt: new Date().toISOString(),
    };
    await db.resources.put(updated);
    return updated;
  });
}

export async function bulkSaveResourcesWithFiles(
  items: ResourceItem[],
  fileRecords: StoredResourceFileRecord[]
): Promise<void> {
  return executeStorageOperation(async () => {
    if (items.length === 0 && fileRecords.length === 0) return;
    const staleOpfsKeys: string[] = [];
    await db.transaction('rw', [db.resources, db.resourceFiles], async () => {
      // If replacing existing resources, remove old file records first
      const resourceIds = items.map((i) => i.id);
      if (resourceIds.length > 0) {
        const oldFiles = await db.resourceFiles
          .where('resourceId')
          .anyOf(resourceIds)
          .toArray();
        const replacedFiles = oldFiles.filter(
          (f) => !fileRecords.some((nf) => nf.id === f.id)
        );
        for (const old of replacedFiles) {
          if (old.storageKind === 'opfs' && old.opfsKey) {
            staleOpfsKeys.push(old.opfsKey);
          }
        }
        const replacedFileIds = replacedFiles.map((f) => f.id);
        if (replacedFileIds.length > 0) {
          await db.resourceFiles.bulkDelete(replacedFileIds);
        }
        await db.resources.bulkPut(items);
      }
      if (fileRecords.length > 0) {
        await db.resourceFiles.bulkPut(fileRecords);
      }
    });
    for (const key of staleOpfsKeys) {
      await deleteBlobFromOpfs(key);
    }
  });
}

export async function readResourceAttachmentBlob(
  resource: ResourceItem
): Promise<Blob | null> {
  return executeStorageOperation(async () => {
    if (!resource.sourceFile) return null;
    const rec = await db.resourceFiles.get(resource.sourceFile.fileRecordId);
    if (rec?.storageKind === 'opfs' && rec.opfsKey) {
      return await readBlobFromOpfs(rec.opfsKey);
    }
    if (rec?.blob) return rec.blob;
    if (resource.sourceFile.opfsKey) {
      return await readBlobFromOpfs(resource.sourceFile.opfsKey);
    }
    return null;
  });
}

export async function deleteResource(id: string): Promise<void> {
  return executeStorageOperation(async () => {
    const linkedFiles = await db.resourceFiles.where('resourceId').equals(id).toArray();
    for (const f of linkedFiles) {
      if (f.storageKind === 'opfs' && f.opfsKey) {
        await deleteBlobFromOpfs(f.opfsKey);
      }
    }
    await db.transaction('rw', [db.resources, db.resourceFiles], async () => {
      await db.resources.delete(id);
      if (linkedFiles.length > 0) {
        await db.resourceFiles.bulkDelete(linkedFiles.map((f) => f.id));
      }
    });
  });
}

// --- Workflow Center CRUD ---
export async function listWorkflows(): Promise<WorkflowRun[]> {
  return executeStorageOperation(async () => {
    const all = await db.workflows.toArray();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function saveWorkflow(item: WorkflowRun): Promise<WorkflowRun> {
  return executeStorageOperation(async () => {
    const updated: WorkflowRun = {
      ...item,
      updatedAt: new Date().toISOString(),
    };
    await db.workflows.put(updated);
    return updated;
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.workflows.delete(id);
  });
}

// --- Teaching Journal CRUD ---
export async function listJournals(): Promise<JournalEntry[]> {
  return executeStorageOperation(async () => {
    const all = await db.journals.toArray();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function saveJournal(item: JournalEntry): Promise<JournalEntry> {
  return executeStorageOperation(async () => {
    const updated: JournalEntry = {
      ...item,
      updatedAt: new Date().toISOString(),
    };
    await db.journals.put(updated);
    return updated;
  });
}

export async function deleteJournal(id: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.journals.delete(id);
  });
}

// --- Math Exam Mixer Pro CRUD ---
export async function listMathExams(): Promise<MathExamProject[]> {
  return executeStorageOperation(async () => {
    const all = await db.mathExams.toArray();
    return all
      .map(normalizeMathExamProject)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function saveMathExam(exam: MathExamProject): Promise<MathExamProject> {
  return executeStorageOperation(async () => {
    const updated: MathExamProject = {
      ...normalizeMathExamProject(exam),
      updatedAt: new Date().toISOString(),
    };
    await db.mathExams.put(updated);
    return updated;
  });
}

export async function deleteMathExam(id: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.mathExams.delete(id);
  });
}

export async function duplicateMathExam(source: MathExamProject): Promise<MathExamProject> {
  return executeStorageOperation(async () => {
    const now = new Date().toISOString();
    const cleanTitle = source.title.replace(/^\[DEMO\]\s*/i, '');
    const copy: MathExamProject = {
      ...structuredClone(normalizeMathExamProject(source)),
      id: createId('mexam'),
      title: `${cleanTitle} (Bản sao)`,
      isDemo: false,
      status: 'draft',
      generatedVersions: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.mathExams.put(copy);
    return copy;
  });
}

// --- Visual Workspace Canvas CRUD ---
export async function listCanvasBoards(): Promise<CanvasBoard[]> {
  return executeStorageOperation(async () => {
    const all = await db.canvasBoards.toArray();
    return all
      .map(normalizeCanvasBoard)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function saveCanvasBoard(board: CanvasBoard): Promise<CanvasBoard> {
  return executeStorageOperation(async () => {
    const updated: CanvasBoard = {
      ...normalizeCanvasBoard(board),
      updatedAt: new Date().toISOString(),
    };
    await db.canvasBoards.put(updated);
    return updated;
  });
}

export async function deleteCanvasBoard(boardId: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.transaction(
      'rw',
      [db.canvasBoards, db.canvasNodes, db.canvasEdges, db.canvasViewSettings],
      async () => {
        await db.canvasBoards.delete(boardId);
        await db.canvasNodes.where('boardId').equals(boardId).delete();
        await db.canvasEdges.where('boardId').equals(boardId).delete();
        await db.canvasViewSettings.delete(boardId);
      }
    );
  });
}

export async function listCanvasNodes(): Promise<CanvasNodeRecord[]> {
  return executeStorageOperation(async () => {
    const all = await db.canvasNodes.toArray();
    return all.map(normalizeCanvasNode);
  });
}

export async function saveCanvasNode(node: CanvasNodeRecord): Promise<CanvasNodeRecord> {
  return executeStorageOperation(async () => {
    const updated: CanvasNodeRecord = {
      ...normalizeCanvasNode(node),
      updatedAt: new Date().toISOString(),
    };
    await db.canvasNodes.put(updated);
    return updated;
  });
}

export async function bulkSaveCanvasNodes(nodes: CanvasNodeRecord[]): Promise<void> {
  return executeStorageOperation(async () => {
    if (nodes.length === 0) return;
    const now = new Date().toISOString();
    await db.canvasNodes.bulkPut(
      nodes.map((n) => ({
        ...normalizeCanvasNode(n),
        updatedAt: now,
      }))
    );
  });
}

export async function deleteCanvasNode(nodeId: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.transaction('rw', [db.canvasNodes, db.canvasEdges], async () => {
      await db.canvasNodes.delete(nodeId);
      await db.canvasEdges.where('source').equals(nodeId).delete();
      await db.canvasEdges.where('target').equals(nodeId).delete();
    });
  });
}

export async function listCanvasEdges(): Promise<CanvasEdgeRecord[]> {
  return executeStorageOperation(async () => {
    const all = await db.canvasEdges.toArray();
    return all.map(normalizeCanvasEdge);
  });
}

export async function saveCanvasEdge(edge: CanvasEdgeRecord): Promise<CanvasEdgeRecord> {
  return executeStorageOperation(async () => {
    const normalized = normalizeCanvasEdge(edge);
    await db.canvasEdges.put(normalized);
    return normalized;
  });
}

export async function deleteCanvasEdge(edgeId: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.canvasEdges.delete(edgeId);
  });
}

export async function bulkSaveCanvasBundle(
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[],
  removedEdgeIds: string[] = []
): Promise<void> {
  return executeStorageOperation(async () => {
    if (nodes.length === 0 && edges.length === 0 && removedEdgeIds.length === 0) return;
    const now = new Date().toISOString();
    await db.transaction('rw', [db.canvasNodes, db.canvasEdges], async () => {
      if (removedEdgeIds.length > 0) {
        await db.canvasEdges.bulkDelete(removedEdgeIds);
      }
      if (nodes.length > 0) {
        await db.canvasNodes.bulkPut(
          nodes.map((n) => ({
            ...normalizeCanvasNode(n),
            updatedAt: now,
          }))
        );
      }
      if (edges.length > 0) {
        await db.canvasEdges.bulkPut(edges.map(normalizeCanvasEdge));
      }
    });
  });
}

export async function bulkDeleteCanvasNodes(nodeIds: string[]): Promise<void> {
  return executeStorageOperation(async () => {
    if (nodeIds.length === 0) return;
    await db.transaction('rw', [db.canvasNodes, db.canvasEdges], async () => {
      await db.canvasNodes.bulkDelete(nodeIds);
      await db.canvasEdges.where('source').anyOf(nodeIds).delete();
      await db.canvasEdges.where('target').anyOf(nodeIds).delete();
    });
  });
}

export async function replaceBoardCanvasState(
  boardId: string,
  nodes: CanvasNodeRecord[],
  edges: CanvasEdgeRecord[]
): Promise<void> {
  return executeStorageOperation(async () => {
    const now = new Date().toISOString();
    await db.transaction('rw', [db.canvasNodes, db.canvasEdges], async () => {
      await db.canvasNodes.where('boardId').equals(boardId).delete();
      await db.canvasEdges.where('boardId').equals(boardId).delete();
      if (nodes.length > 0) {
        await db.canvasNodes.bulkPut(
          nodes.map((n) => ({
            ...normalizeCanvasNode(n),
            boardId,
            updatedAt: now,
          }))
        );
      }
      if (edges.length > 0) {
        await db.canvasEdges.bulkPut(
          edges.map((e) => ({
            ...e,
            boardId,
          }))
        );
      }
    });
  });
}

export async function listCanvasViewSettings(): Promise<CanvasViewSettings[]> {
  return executeStorageOperation(async () => {
    const all = await db.canvasViewSettings.toArray();
    return all.map((v) => normalizeCanvasViewSettings(v, v.boardId));
  });
}

export async function saveCanvasViewSettings(
  view: CanvasViewSettings
): Promise<CanvasViewSettings> {
  return executeStorageOperation(async () => {
    const normalized = normalizeCanvasViewSettings(view, view.boardId);
    await db.canvasViewSettings.put(normalized);
    return normalized;
  });
}

export async function replaceAllFromBackup(
  packs: LessonPack[],
  settings: PrintSettings,
  extras?: {
    resources?: ResourceItem[];
    workflows?: WorkflowRun[];
    journals?: JournalEntry[];
    mathExams?: MathExamProject[];
    canvasBoards?: CanvasBoard[];
    canvasNodes?: CanvasNodeRecord[];
    canvasEdges?: CanvasEdgeRecord[];
    canvasViewSettings?: CanvasViewSettings[];
  }
): Promise<void> {
  return executeStorageOperation(async () => {
    const normalizedPacks = packs.map(normalizeLegacyLessonPack);
    const staleOpfsKeys: string[] = [];
    if (Array.isArray(extras?.resources)) {
      const keepIds = new Set(extras.resources.map((r) => r.id));
      const currentFiles = await db.resourceFiles.toArray();
      for (const f of currentFiles) {
        if (!keepIds.has(f.resourceId) && f.storageKind === 'opfs' && f.opfsKey) {
          staleOpfsKeys.push(f.opfsKey);
        }
      }
    }
    await db.transaction(
      'rw',
      [
        db.lessonPacks,
        db.settings,
        db.meta,
        db.resources,
        db.resourceFiles,
        db.workflows,
        db.journals,
        db.mathExams,
        db.canvasBoards,
        db.canvasNodes,
        db.canvasEdges,
        db.canvasViewSettings,
      ],
      async () => {
        await db.lessonPacks.clear();
        if (normalizedPacks.length > 0) {
          await db.lessonPacks.bulkPut(normalizedPacks);
        }
        await db.settings.put({
          ...settings,
          id: 'default',
          paperSize: 'A4',
          updatedAt: new Date().toISOString(),
        });
        if (Array.isArray(extras?.resources)) {
          await db.resources.clear();
          const keepIds = new Set(extras.resources.map((r) => r.id));
          const currentFiles = await db.resourceFiles.toArray();
          const removeFileIds = currentFiles
            .filter((f) => !keepIds.has(f.resourceId))
            .map((f) => f.id);
          if (removeFileIds.length > 0) {
            await db.resourceFiles.bulkDelete(removeFileIds);
          }
          if (extras.resources.length > 0) {
            await db.resources.bulkPut(extras.resources);
          }
        }
        if (Array.isArray(extras?.workflows)) {
          await db.workflows.clear();
          if (extras.workflows.length > 0) {
            await db.workflows.bulkPut(extras.workflows);
          }
        }
        if (Array.isArray(extras?.journals)) {
          await db.journals.clear();
          if (extras.journals.length > 0) {
            await db.journals.bulkPut(extras.journals);
          }
        }
        if (Array.isArray(extras?.mathExams)) {
          await db.mathExams.clear();
          if (extras.mathExams.length > 0) {
            await db.mathExams.bulkPut(extras.mathExams.map(normalizeMathExamProject));
          }
        }
        if (Array.isArray(extras?.canvasBoards)) {
          await db.canvasBoards.clear();
          if (extras.canvasBoards.length > 0) {
            await db.canvasBoards.bulkPut(extras.canvasBoards.map(normalizeCanvasBoard));
          }
        }
        if (Array.isArray(extras?.canvasNodes)) {
          await db.canvasNodes.clear();
          if (extras.canvasNodes.length > 0) {
            await db.canvasNodes.bulkPut(extras.canvasNodes.map(normalizeCanvasNode));
          }
        }
        if (Array.isArray(extras?.canvasEdges)) {
          await db.canvasEdges.clear();
          if (extras.canvasEdges.length > 0) {
            await db.canvasEdges.bulkPut(extras.canvasEdges);
          }
        }
        if (Array.isArray(extras?.canvasViewSettings)) {
          await db.canvasViewSettings.clear();
          if (extras.canvasViewSettings.length > 0) {
            await db.canvasViewSettings.bulkPut(
              extras.canvasViewSettings.map((v) => normalizeCanvasViewSettings(v, v.boardId))
            );
          }
        }
        await db.meta.put({ key: 'demo_seeded_v1', value: 'true' });
        await db.meta.put({ key: 'modules_seeded_v4', value: 'true' });
        await db.meta.put({ key: 'math_exam_seeded_v1', value: 'true' });
        await db.meta.put({ key: 'canvas_seeded_v1', value: 'true' });
      }
    );
    for (const key of staleOpfsKeys) {
      await deleteBlobFromOpfs(key);
    }
  });
}

export async function getSnapshotSummary(): Promise<LocalSnapshotSummary> {
  return executeStorageOperation(async () => {
    const rec = await db.meta.get(SNAPSHOT_META_KEY);
    if (!rec || !rec.value) {
      return {
        exists: false,
        label: '',
        createdAt: '',
        packCount: 0,
      };
    }
    try {
      const parsed = JSON.parse(rec.value) as LocalSnapshotRecord;
      return {
        exists: true,
        label: parsed.label || 'Bản chụp cục bộ',
        createdAt: parsed.createdAt || '',
        packCount: Array.isArray(parsed.lessonPacks) ? parsed.lessonPacks.length : 0,
      };
    } catch {
      return {
        exists: false,
        label: '',
        createdAt: '',
        packCount: 0,
      };
    }
  });
}

export async function createManualSnapshot(
  label = 'Điểm khôi phục cục bộ do giáo viên tạo'
): Promise<LocalSnapshotSummary> {
  return executeStorageOperation(async () => {
    const [
      packs,
      settings,
      resources,
      workflows,
      journals,
      mathExams,
      canvasBoards,
      canvasNodes,
      canvasEdges,
      canvasViewSettings,
    ] = await Promise.all([
      listLessonPacks(),
      getPrintSettings(),
      listResources(),
      listWorkflows(),
      listJournals(),
      listMathExams(),
      listCanvasBoards(),
      listCanvasNodes(),
      listCanvasEdges(),
      listCanvasViewSettings(),
    ]);
    const record: LocalSnapshotRecord = {
      version: '4.0-snapshot',
      label,
      createdAt: new Date().toISOString(),
      packCount: packs.length,
      lessonPacks: packs,
      settings,
      resources,
      workflows,
      journals,
      mathExams,
      canvasBoards,
      canvasNodes,
      canvasEdges,
      canvasViewSettings,
    };
    await db.meta.put({
      key: SNAPSHOT_META_KEY,
      value: JSON.stringify(record),
    });
    return {
      exists: true,
      label: record.label,
      createdAt: record.createdAt,
      packCount: record.packCount,
    };
  });
}

export async function rollbackToSnapshot(): Promise<{
  packs: LessonPack[];
  settings: PrintSettings;
  resources: ResourceItem[];
  workflows: WorkflowRun[];
  journals: JournalEntry[];
  mathExams: MathExamProject[];
  canvasBoards: CanvasBoard[];
  canvasNodes: CanvasNodeRecord[];
  canvasEdges: CanvasEdgeRecord[];
  canvasViewSettings: CanvasViewSettings[];
  label: string;
}> {
  return executeStorageOperation(async () => {
    const rec = await db.meta.get(SNAPSHOT_META_KEY);
    if (!rec || !rec.value) {
      throw new Error('Không tìm thấy bản chụp khôi phục cục bộ trong IndexedDB.');
    }
    const parsed = JSON.parse(rec.value) as LocalSnapshotRecord;
    const normalizedPacks = (parsed.lessonPacks || []).map(normalizeLegacyLessonPack);
    const normalizedSettings: PrintSettings = {
      ...(parsed.settings || DEFAULT_PRINT_SETTINGS),
      id: 'default',
      paperSize: 'A4',
      updatedAt: new Date().toISOString(),
    };
    await db.transaction(
      'rw',
      [
        db.lessonPacks,
        db.settings,
        db.meta,
        db.resources,
        db.workflows,
        db.journals,
        db.mathExams,
        db.canvasBoards,
        db.canvasNodes,
        db.canvasEdges,
        db.canvasViewSettings,
      ],
      async () => {
        await db.lessonPacks.clear();
        if (normalizedPacks.length > 0) {
          await db.lessonPacks.bulkPut(normalizedPacks);
        }
        await db.settings.put(normalizedSettings);
        if (Array.isArray(parsed.resources)) {
          await db.resources.clear();
          if (parsed.resources.length > 0) {
            await db.resources.bulkPut(parsed.resources);
          }
        }
        if (Array.isArray(parsed.workflows)) {
          await db.workflows.clear();
          if (parsed.workflows.length > 0) {
            await db.workflows.bulkPut(parsed.workflows);
          }
        }
        if (Array.isArray(parsed.journals)) {
          await db.journals.clear();
          if (parsed.journals.length > 0) {
            await db.journals.bulkPut(parsed.journals);
          }
        }
        if (Array.isArray(parsed.mathExams)) {
          await db.mathExams.clear();
          if (parsed.mathExams.length > 0) {
            await db.mathExams.bulkPut(parsed.mathExams.map(normalizeMathExamProject));
          }
        }
        if (Array.isArray(parsed.canvasBoards)) {
          await db.canvasBoards.clear();
          if (parsed.canvasBoards.length > 0) {
            await db.canvasBoards.bulkPut(parsed.canvasBoards.map(normalizeCanvasBoard));
          }
        }
        if (Array.isArray(parsed.canvasNodes)) {
          await db.canvasNodes.clear();
          if (parsed.canvasNodes.length > 0) {
            await db.canvasNodes.bulkPut(parsed.canvasNodes.map(normalizeCanvasNode));
          }
        }
        if (Array.isArray(parsed.canvasEdges)) {
          await db.canvasEdges.clear();
          if (parsed.canvasEdges.length > 0) {
            await db.canvasEdges.bulkPut(parsed.canvasEdges);
          }
        }
        if (Array.isArray(parsed.canvasViewSettings)) {
          await db.canvasViewSettings.clear();
          if (parsed.canvasViewSettings.length > 0) {
            await db.canvasViewSettings.bulkPut(
              parsed.canvasViewSettings.map((v) => normalizeCanvasViewSettings(v, v.boardId))
            );
          }
        }
        await db.meta.put({ key: 'demo_seeded_v1', value: 'true' });
      }
    );
    const [
      resources,
      workflows,
      journals,
      mathExams,
      canvasBoards,
      canvasNodes,
      canvasEdges,
      canvasViewSettings,
    ] = await Promise.all([
      listResources(),
      listWorkflows(),
      listJournals(),
      listMathExams(),
      listCanvasBoards(),
      listCanvasNodes(),
      listCanvasEdges(),
      listCanvasViewSettings(),
    ]);
    return {
      packs: normalizedPacks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      settings: normalizedSettings,
      resources,
      workflows,
      journals,
      mathExams,
      canvasBoards,
      canvasNodes,
      canvasEdges,
      canvasViewSettings,
      label: parsed.label || 'Bản chụp cục bộ',
    };
  });
}

// ---------------------------------------------------------------------------
// Smart Grading Studio 1.0 — Local IndexedDB Storage (v7 additive tables)
// ---------------------------------------------------------------------------

export async function listGradingSessions(): Promise<GradingSession[]> {
  return executeStorageOperation(async () => {
    const all = await db.gradingSessions.toArray();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function saveGradingSession(session: GradingSession): Promise<void> {
  return executeStorageOperation(async () => {
    await db.gradingSessions.put(session);
  });
}

export async function deleteGradingSession(sessionId: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.transaction(
      'rw',
      [db.gradingSessions, db.gradingEvidenceBlobs],
      async () => {
        await db.gradingEvidenceBlobs.where('sessionId').equals(sessionId).delete();
        await db.gradingSessions.delete(sessionId);
      }
    );
  });
}

export async function saveEvidenceBlob(record: EvidenceBlobRecord): Promise<void> {
  return executeStorageOperation(async () => {
    await db.gradingEvidenceBlobs.put(record);
  });
}

export async function getEvidenceBlob(
  blobId: string
): Promise<EvidenceBlobRecord | undefined> {
  return executeStorageOperation(async () => {
    return db.gradingEvidenceBlobs.get(blobId);
  });
}

export async function deleteSheetEvidenceBlobs(sheetId: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.gradingEvidenceBlobs.where('sheetId').equals(sheetId).delete();
  });
}

// ---------------------------------------------------------------------------
// Smart Exam Generator 2.0 (Phase 1) — Local IndexedDB Storage (v8 additive)
// ---------------------------------------------------------------------------

const EXAM_GENERATOR_SEED_KEY = 'exam_generator_seeded_v1';
const EXAM_GENERATOR_PHASE2_SEED_KEY = 'exam_generator_phase2_seeded_v1';
const EXAM_GENERATOR_PHASE3_SEED_KEY = 'exam_generator_phase3_seeded_v1';

export async function initializeExamGeneratorStore(): Promise<{
  bank: BankQuestionRecord[];
  templates: QuestionTemplateDefinition[];
  drafts: GeneratedExamDraft[];
}> {
  return executeStorageOperation(async () => {
    const seededMeta = await db.meta.get(EXAM_GENERATOR_SEED_KEY);
    if (!seededMeta) {
      const existingBankCount = await db.examGeneratorBank.count();
      const existingTemplateCount = await db.examGeneratorTemplates.count();
      await db.transaction(
        'rw',
        [db.examGeneratorBank, db.examGeneratorTemplates, db.meta],
        async () => {
          if (existingBankCount === 0) {
            await db.examGeneratorBank.bulkPut(structuredClone(DEMO_GENERATOR_BANK));
          }
          if (existingTemplateCount === 0) {
            await db.examGeneratorTemplates.bulkPut(
              structuredClone(DEMO_GENERATOR_TEMPLATES)
            );
          }
          await db.meta.put({ key: EXAM_GENERATOR_SEED_KEY, value: 'true' });
          await db.meta.put({ key: EXAM_GENERATOR_PHASE2_SEED_KEY, value: 'true' });
          await db.meta.put({ key: EXAM_GENERATOR_PHASE3_SEED_KEY, value: 'true' });
        }
      );
    } else {
      // Additive Phase 2 seeding for existing v8 users — NEVER overwrites or deletes user records
      const phase2Meta = await db.meta.get(EXAM_GENERATOR_PHASE2_SEED_KEY);
      if (!phase2Meta) {
        await db.transaction(
          'rw',
          [db.examGeneratorBank, db.examGeneratorTemplates, db.meta],
          async () => {
            for (const item of PHASE2_DEMO_BANK) {
              const exists = await db.examGeneratorBank.get(item.id);
              if (!exists) {
                await db.examGeneratorBank.put(structuredClone(item));
              }
            }
            for (const tpl of PHASE2_DEMO_TEMPLATES) {
              const exists = await db.examGeneratorTemplates.get(tpl.id);
              if (!exists) {
                await db.examGeneratorTemplates.put(structuredClone(tpl));
              }
            }
            await db.meta.put({ key: EXAM_GENERATOR_PHASE2_SEED_KEY, value: 'true' });
          }
        );
      }

      // Additive Phase 3 seeding for existing v8 users — NEVER overwrites or deletes user records
      const phase3Meta = await db.meta.get(EXAM_GENERATOR_PHASE3_SEED_KEY);
      if (!phase3Meta) {
        await db.transaction(
          'rw',
          [db.examGeneratorBank, db.examGeneratorTemplates, db.meta],
          async () => {
            for (const item of PHASE3_DEMO_BANK) {
              const exists = await db.examGeneratorBank.get(item.id);
              if (!exists) {
                await db.examGeneratorBank.put(structuredClone(item));
              }
            }
            for (const tpl of PHASE3_DEMO_TEMPLATES) {
              const exists = await db.examGeneratorTemplates.get(tpl.id);
              if (!exists) {
                await db.examGeneratorTemplates.put(structuredClone(tpl));
              }
            }
            await db.meta.put({ key: EXAM_GENERATOR_PHASE3_SEED_KEY, value: 'true' });
          }
        );
      }
    }

    const [bank, templates, drafts] = await Promise.all([
      db.examGeneratorBank.toArray(),
      db.examGeneratorTemplates.toArray(),
      db.examGeneratorDrafts.toArray(),
    ]);

    return {
      bank: bank.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      templates: templates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  });
}

export async function saveGeneratorBankItem(
  item: BankQuestionRecord
): Promise<BankQuestionRecord> {
  return executeStorageOperation(async () => {
    const updated: BankQuestionRecord = {
      ...item,
      updatedAt: new Date().toISOString(),
    };
    await db.examGeneratorBank.put(updated);
    return updated;
  });
}

export async function bulkSaveGeneratorBankItems(
  items: BankQuestionRecord[]
): Promise<BankQuestionRecord[]> {
  if (items.length === 0) return [];
  return executeStorageOperation(async () => {
    const now = new Date().toISOString();
    const updated = items.map((item) => ({
      ...item,
      updatedAt: item.updatedAt || now,
    }));
    await db.transaction('rw', db.examGeneratorBank, async () => {
      await db.examGeneratorBank.bulkPut(updated);
    });
    return updated;
  });
}

export async function deleteGeneratorBankItem(id: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.examGeneratorBank.delete(id);
  });
}

export async function saveGeneratorTemplate(
  tpl: QuestionTemplateDefinition
): Promise<QuestionTemplateDefinition> {
  return executeStorageOperation(async () => {
    const updated: QuestionTemplateDefinition = {
      ...tpl,
      updatedAt: new Date().toISOString(),
    };
    await db.examGeneratorTemplates.put(updated);
    return updated;
  });
}

export async function deleteGeneratorTemplate(id: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.examGeneratorTemplates.delete(id);
  });
}

export async function saveGeneratorDraft(
  draft: GeneratedExamDraft
): Promise<GeneratedExamDraft> {
  return executeStorageOperation(async () => {
    const updated: GeneratedExamDraft = {
      ...draft,
      updatedAt: new Date().toISOString(),
    };
    await db.examGeneratorDrafts.put(updated);
    return updated;
  });
}

export async function deleteGeneratorDraft(id: string): Promise<void> {
  return executeStorageOperation(async () => {
    await db.examGeneratorDrafts.delete(id);
  });
}

export async function restoreGeneratorBackupBundle(
  bundle: GeneratorBackupBundle
): Promise<{
  bank: BankQuestionRecord[];
  templates: QuestionTemplateDefinition[];
  drafts: GeneratedExamDraft[];
}> {
  return executeStorageOperation(async () => {
    await db.transaction(
      'rw',
      [
        db.examGeneratorBank,
        db.examGeneratorTemplates,
        db.examGeneratorDrafts,
        db.meta,
      ],
      async () => {
        if (Array.isArray(bundle.bankQuestions)) {
          await db.examGeneratorBank.clear();
          if (bundle.bankQuestions.length > 0) {
            await db.examGeneratorBank.bulkPut(bundle.bankQuestions);
          }
        }
        if (Array.isArray(bundle.templates)) {
          await db.examGeneratorTemplates.clear();
          if (bundle.templates.length > 0) {
            await db.examGeneratorTemplates.bulkPut(bundle.templates);
          }
        }
        if (Array.isArray(bundle.drafts)) {
          await db.examGeneratorDrafts.clear();
          if (bundle.drafts.length > 0) {
            await db.examGeneratorDrafts.bulkPut(bundle.drafts);
          }
        }
        await db.meta.put({ key: EXAM_GENERATOR_SEED_KEY, value: 'true' });
      }
    );
    return initializeExamGeneratorStore();
  });
}

// ============================================================================
// Connected Workflow Context Persistence (reuses existing Dexie meta table)
// ============================================================================

export async function loadConnectedWorkflowContext(): Promise<ConnectedWorkflowContext> {
  try {
    const rec = await db.meta.get(CONNECTED_WORKFLOW_META_KEY);
    if (rec?.value) {
      return normalizeStoredWorkflowContext(JSON.parse(rec.value));
    }
  } catch {
    // Fall back to localStorage below if IndexedDB read is unavailable
  }
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(CONNECTED_WORKFLOW_META_KEY);
      if (raw) {
        return normalizeStoredWorkflowContext(JSON.parse(raw));
      }
    } catch {
      // Ignore malformed localStorage
    }
  }
  return createInitialWorkflowContext();
}

export async function saveConnectedWorkflowContext(
  ctx: ConnectedWorkflowContext
): Promise<ConnectedWorkflowContext> {
  const serialized = JSON.stringify(ctx);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CONNECTED_WORKFLOW_META_KEY, serialized);
    } catch {
      // Ignore quota errors on localStorage fallback
    }
  }
  try {
    await db.meta.put({ key: CONNECTED_WORKFLOW_META_KEY, value: serialized });
  } catch {
    // Keep in-memory & localStorage fallback if IndexedDB is temporarily unavailable
  }
  return ctx;
}

export async function loadConnectedWorkflowStore(): Promise<ConnectedWorkflowStore> {
  let rawStore: unknown = null;
  let legacyRaw: unknown = null;

  try {
    const rec = await db.meta.get(CONNECTED_WORKFLOW_STORE_KEY);
    if (rec?.value) {
      rawStore = JSON.parse(rec.value);
    }
  } catch {
    // Fallback to localStorage below
  }

  if (!rawStore && typeof window !== 'undefined') {
    try {
      const lsRaw = window.localStorage.getItem(CONNECTED_WORKFLOW_STORE_KEY);
      if (lsRaw) {
        rawStore = JSON.parse(lsRaw);
      }
    } catch {
      // Ignore malformed localStorage
    }
  }

  if (!rawStore) {
    try {
      const legacyRec = await db.meta.get(CONNECTED_WORKFLOW_META_KEY);
      if (legacyRec?.value) {
        legacyRaw = JSON.parse(legacyRec.value);
      }
    } catch {
      // Fallback below
    }
    if (!legacyRaw && typeof window !== 'undefined') {
      try {
        const legacyLs = window.localStorage.getItem(CONNECTED_WORKFLOW_META_KEY);
        if (legacyLs) {
          legacyRaw = JSON.parse(legacyLs);
        }
      } catch {
        // Ignore malformed legacy localStorage
      }
    }
  }

  return normalizeStoredWorkflowStore(rawStore, legacyRaw);
}

export async function saveConnectedWorkflowStore(
  store: ConnectedWorkflowStore
): Promise<ConnectedWorkflowStore> {
  const normalized = normalizeStoredWorkflowStore(store);
  const serialized = JSON.stringify(normalized);
  const activeCtx = getActiveWorkflowFromStore(normalized);
  const activeSerialized = JSON.stringify(activeCtx);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CONNECTED_WORKFLOW_STORE_KEY, serialized);
      window.localStorage.setItem(CONNECTED_WORKFLOW_META_KEY, activeSerialized);
    } catch {
      // Ignore quota errors on localStorage fallback
    }
  }
  try {
    await db.meta.put({ key: CONNECTED_WORKFLOW_STORE_KEY, value: serialized });
    await db.meta.put({ key: CONNECTED_WORKFLOW_META_KEY, value: activeSerialized });
  } catch {
    // Keep in-memory & localStorage fallback if IndexedDB is temporarily unavailable
  }
  return normalized;
}

// ============================================================================
// Exam Form Designer Templates Persistence (reuses existing Dexie meta table)
// ============================================================================

export async function loadExamFormTemplates(): Promise<ExamFormTemplate[]> {
  try {
    const rec = await db.meta.get(EXAM_FORM_TEMPLATES_META_KEY);
    if (rec?.value) {
      return mergeStoredExamFormTemplates(JSON.parse(rec.value));
    }
  } catch {
    // Fall back to localStorage below if IndexedDB read is unavailable
  }
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(EXAM_FORM_TEMPLATES_META_KEY);
      if (raw) {
        return mergeStoredExamFormTemplates(JSON.parse(raw));
      }
    } catch {
      // Ignore malformed localStorage
    }
  }
  return structuredClone(BUILT_IN_EXAM_FORM_PRESETS);
}

export async function saveExamFormTemplates(
  templates: ExamFormTemplate[]
): Promise<ExamFormTemplate[]> {
  const merged = mergeStoredExamFormTemplates(templates);
  const serialized = JSON.stringify(merged);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(EXAM_FORM_TEMPLATES_META_KEY, serialized);
    } catch {
      // Ignore quota errors on localStorage fallback
    }
  }
  try {
    await db.meta.put({ key: EXAM_FORM_TEMPLATES_META_KEY, value: serialized });
  } catch {
    // Keep in-memory & localStorage fallback if IndexedDB is temporarily unavailable
  }
  return merged;
}

// ============================================================================
// External Integration Config Persistence (Section 14 — zero credentials stored)
// ============================================================================

export const EXTERNAL_INTEGRATION_META_KEY = 'external_integrations_v1';

export async function loadExternalIntegrationConfig(): Promise<ExternalIntegrationConfig> {
  try {
    const rec = await db.meta.get(EXTERNAL_INTEGRATION_META_KEY);
    if (rec?.value) {
      return sanitizeExternalIntegrationConfig(JSON.parse(rec.value));
    }
  } catch {
    // Fall back to localStorage below
  }
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(EXTERNAL_INTEGRATION_META_KEY);
      if (raw) {
        return sanitizeExternalIntegrationConfig(JSON.parse(raw));
      }
    } catch {
      // Ignore malformed localStorage
    }
  }
  return createDefaultExternalIntegrationConfig();
}

export async function saveExternalIntegrationConfig(
  config: ExternalIntegrationConfig
): Promise<ExternalIntegrationConfig> {
  const sanitized = sanitizeExternalIntegrationConfig(config);
  const serialized = JSON.stringify(sanitized);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(EXTERNAL_INTEGRATION_META_KEY, serialized);
    } catch {
      // Ignore quota errors
    }
  }
  try {
    await db.meta.put({ key: EXTERNAL_INTEGRATION_META_KEY, value: serialized });
  } catch {
    // Keep in-memory & localStorage fallback
  }
  return sanitized;
}





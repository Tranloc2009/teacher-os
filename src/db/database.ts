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
import {
  DEFAULT_JOURNALS,
  DEFAULT_RESOURCES,
  DEFAULT_WORKFLOWS,
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
 * Chuẩn hóa đề Toán/đa môn trong IndexedDB (v4/v5/v6) để bổ sung Subject Profile,
 * Universal Question Type, Universal Lock 5 lớp, Visual Asset & Question Group
 * mà không làm mất dữ liệu câu hỏi hoặc mã đề đã tạo trước đó.
 */
export function normalizeMathExamProject(raw: MathExamProject): MathExamProject {
  const resolvedSubjectId = resolveSubjectId(raw.subjectId || raw.subject || 'Toán học');
  const subjectProfile = getSubjectProfile(resolvedSubjectId);
  const resolvedSubjectName =
    typeof raw.subject === 'string' && raw.subject.trim()
      ? raw.subject
      : subjectProfile.name;

  return {
    ...raw,
    subject: resolvedSubjectName,
    subjectId: resolvedSubjectId,
    schemaVersion: raw.schemaVersion ?? '5.0',
    questionGroups: Array.isArray(raw.questionGroups) ? raw.questionGroups : [],
    questions: (raw.questions || []).map((q) => {
      const normalizedOptions = q.options?.map((o) => ({
        ...o,
        lockPosition: Boolean(o.lockPosition),
      }));
      const normalizedQuestion = {
        ...q,
        subjectId: q.subjectId ?? resolvedSubjectId,
        universalType: getUniversalQuestionType(q),
        visualAssets: Array.isArray(q.visualAssets) ? q.visualAssets : [],
        options: normalizedOptions,
      };
      return {
        ...normalizedQuestion,
        universalLock: buildUniversalLockState(normalizedQuestion, subjectProfile),
      };
    }),
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
    generatedVersions: Array.isArray(raw.generatedVersions) ? raw.generatedVersions : [],
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


import type { AppId } from './appRegistry';
import type {
  ConnectedWorkflowContext,
  ConnectedWorkflowStageId,
  ConnectedWorkflowStageStatus,
  ConnectedWorkflowStore,
  ConnectedWorkspaceWorkflowSummary,
  DashboardNextStepSuggestion,
  ParsedUniversalCommand,
  SmartActionBarModel,
  SmartActionItem,
  SupportedUniversalCommandHint,
  WorkflowMissingReference,
  WorkflowStageEvaluation,
  WorkflowValidationReport,
} from '../types/connectedWorkflow';
import type { ResourceItem } from '../types/lesson';
import type { MathExamProject, MathQuestion } from '../types/mathExam';
import type { GradingSession } from '../types/grading';
import type { GeneratedExamDraft } from '../types/examGenerator';
import { normalizeVietnameseText } from './examGenerator/smartQuestionRetrieval';
import {
  auditOriginalExamIntegrity,
  checkExamExportGate,
} from './mathIntegrity';
import { verifyDraftDynamicGraphBindings } from './examGenerator/examBuilderEngine';
import { verifyDynamicGraphBinding } from './examGenerator/level3GraphTemplates';
import { buildExamAnswerKeyMap } from './grading/examMixerBridge';

export const CONNECTED_WORKFLOW_META_KEY = 'connected_workflow_context_v1';
export const CONNECTED_WORKFLOW_STORE_KEY = 'connected_workflow_store_v2';
const MAX_STORED_WORKFLOWS = 16;

export interface WorkflowEvaluationSnapshot {
  resources: ResourceItem[];
  mathExams: MathExamProject[];
  gradingSessions?: GradingSession[];
  drafts?: GeneratedExamDraft[];
}

export const SUPPORTED_UNIVERSAL_COMMANDS: SupportedUniversalCommandHint[] = [
  {
    example: 'Mở Resource Vault',
    description: 'Mở kho tài liệu nguồn học liệu & đề thi cục bộ',
    category: 'navigation',
  },
  {
    example: 'Tạo đề Toán 12 từ tài liệu đang chọn',
    description: 'Mở Smart Exam Generator và nạp sẵn tài liệu đang chọn',
    category: 'workflow',
  },
  {
    example: 'Mở đề kiểm tra gần nhất',
    description: 'Mở đề kiểm tra gần nhất trong Exam Mixer Pro',
    category: 'navigation',
  },
  {
    example: 'Mở Answer Key Studio',
    description: 'Mở thẳng bước kiểm tra & xác nhận đáp án gốc',
    category: 'navigation',
  },
  {
    example: 'Trộn đề hiện tại thành 4 mã',
    description: 'Mở Exam Mixer Pro bước 3 để kiểm chứng và tạo 4 mã đề',
    category: 'workflow',
  },
  {
    example: 'Mở bảng đáp án mã 101',
    description: 'Mở bảng đáp án đúng theo mã đề 101 đã trộn',
    category: 'navigation',
  },
  {
    example: 'Tạo phiếu trả lời cho lớp 12A2',
    description: 'Mở Smart Grading Studio để tạo phiếu OMR cho lớp 12A2',
    category: 'workflow',
  },
  {
    example: 'Mở danh sách bài cần duyệt',
    description: 'Mở tab Duyệt phiếu OMR cần giáo viên xác nhận',
    category: 'navigation',
  },
  {
    example: 'Xuất bảng điểm đã xác nhận',
    description: 'Mở tab Xuất báo cáo / bảng điểm đã chốt trong Smart Grading Studio',
    category: 'workflow',
  },
  {
    example: 'Xuất đề theo mẫu giữa học kỳ',
    description: 'Mở Print Studio chế độ Đề kiểm tra A4 theo mẫu chuẩn',
    category: 'workflow',
  },
  {
    example: 'Thiết kế mẫu đề',
    description: 'Mở Professional Exam Form Designer để tùy biến bố cục A4 & xuất DOCX',
    category: 'workflow',
  },
];

// ============================================================================
// Strict Entity Lookup & Idempotency Helpers (Section 4 & 12)
// ============================================================================

export interface StrictEntityLookupResult<T> {
  entity?: T;
  missing: boolean;
  requestedId?: string;
}

/**
 * Tra cứu thực thể theo ID nghiêm ngặt — TUYỆT ĐỐI không tự mở phần tử đầu tiên (list[0])
 * khi ID được yêu cầu không còn tồn tại.
 */
export function resolveStrictEntityById<T extends { id: string }>(
  list: readonly T[] | undefined,
  requestedId: string | undefined | null
): StrictEntityLookupResult<T> {
  if (!requestedId || !requestedId.trim()) {
    return { entity: undefined, missing: false };
  }
  const found = (list ?? []).find((item) => item.id === requestedId);
  if (found) {
    return { entity: found, missing: false, requestedId };
  }
  return { entity: undefined, missing: true, requestedId };
}

/**
 * Idempotency helper: tìm đề MathExamProject đã xuất từ cùng một draft để chống double-click tạo trùng.
 */
export function findExistingExamForDraft(
  mathExams: readonly MathExamProject[],
  draft: Pick<GeneratedExamDraft, 'id' | 'exportedExamProjectId' | 'title'>
): MathExamProject | undefined {
  if (draft.exportedExamProjectId) {
    const exact = mathExams.find((e) => e.id === draft.exportedExamProjectId);
    if (exact) return exact;
  }
  const byGeneratedId = mathExams.find(
    (e) => e.id === `gen-mexam-${draft.id}` || e.id === `mexam-gen-${draft.id}`
  );
  if (byGeneratedId) return byGeneratedId;
  return undefined;
}

/**
 * Idempotency helper: tìm phiên chấm trùng (examId + className + cùng tập mã đề) để chống tạo trùng khi bấm đúp.
 */
export function findExistingGradingSession(
  sessions: readonly GradingSession[],
  examId: string,
  className: string,
  selectedCodes?: readonly string[]
): GradingSession | undefined {
  const normClass = className.trim().toLowerCase();
  const codeSig = selectedCodes
    ? [...selectedCodes].sort().join(',')
    : null;
  return sessions.find((s) => {
    if (s.examId !== examId) return false;
    if (s.className.trim().toLowerCase() !== normClass) return false;
    if (codeSig !== null) {
      const existingSig = [...s.selectedExamCodes].sort().join(',');
      if (existingSig !== codeSig) return false;
    }
    return true;
  });
}

// ============================================================================
// Context & Multi-Workflow Store Management (Section 4 & 9)
// ============================================================================

let workflowSeq = 0;

export function createInitialWorkflowContext(
  nowIso = new Date().toISOString()
): ConnectedWorkflowContext {
  workflowSeq += 1;
  return {
    workflowId: `wf-ctx-${Date.now().toString(36)}-${workflowSeq.toString(36)}`,
    title: 'Luồng tạo & chấm đề kiểm tra',
    revision: 1,
    questionSelectionIds: [],
    examVersionIds: [],
    examVersionCodes: [],
    lastActiveApp: 'desktop',
    currentStep: 'source',
    completedSteps: [],
    pendingActions: [],
    validationStatus: 'valid',
    createdAt: nowIso,
    updatedAt: nowIso,
    history: [],
  };
}

/**
 * Cập nhật ngữ cảnh liên ứng dụng bất biến, bảo toàn toàn bộ ID ở các bước trước
 * và tăng monotonic revision để chặn workflow cũ ghi đè workflow mới.
 */
export function patchWorkflowContext(
  prev: ConnectedWorkflowContext,
  patch: Partial<
    Omit<ConnectedWorkflowContext, 'workflowId' | 'createdAt' | 'history'>
  >,
  historyItem?: {
    stage: ConnectedWorkflowStageId;
    appId: AppId;
    summary: string;
  },
  nowIso = new Date().toISOString()
): ConnectedWorkflowContext {
  const nextHistory = historyItem
    ? [
        {
          id: `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: nowIso,
          stage: historyItem.stage,
          appId: historyItem.appId,
          summary: historyItem.summary,
        },
        ...prev.history,
      ].slice(0, 30)
    : prev.history;

  const derivedTitle =
    patch.title ??
    patch.generatedExamTitle ??
    patch.examDraftTitle ??
    (prev.title === 'Luồng tạo & chấm đề kiểm tra' && patch.resourceTitle
      ? `Luồng đề từ: ${patch.resourceTitle}`
      : prev.title);

  return {
    ...prev,
    ...patch,
    title: derivedTitle,
    revision: (prev.revision ?? 1) + 1,
    currentStep: patch.currentStep ?? historyItem?.stage ?? prev.currentStep ?? 'source',
    questionSelectionIds: patch.questionSelectionIds ?? prev.questionSelectionIds,
    examVersionIds: patch.examVersionIds ?? prev.examVersionIds,
    examVersionCodes: patch.examVersionCodes ?? prev.examVersionCodes,
    updatedAt: nowIso,
    history: nextHistory,
  };
}

export function normalizeStoredWorkflowContext(
  raw: unknown
): ConnectedWorkflowContext {
  if (!raw || typeof raw !== 'object') {
    return createInitialWorkflowContext();
  }
  const obj = raw as Partial<ConnectedWorkflowContext>;
  const base = createInitialWorkflowContext();
  return {
    ...base,
    ...obj,
    workflowId:
      typeof obj.workflowId === 'string' && obj.workflowId.trim()
        ? obj.workflowId
        : base.workflowId,
    title:
      typeof obj.title === 'string' && obj.title.trim()
        ? obj.title
        : base.title,
    revision:
      typeof obj.revision === 'number' && Number.isFinite(obj.revision) && obj.revision >= 1
        ? Math.floor(obj.revision)
        : 1,
    questionSelectionIds: Array.isArray(obj.questionSelectionIds)
      ? obj.questionSelectionIds.filter((x): x is string => typeof x === 'string')
      : [],
    examVersionIds: Array.isArray(obj.examVersionIds)
      ? obj.examVersionIds.filter((x): x is string => typeof x === 'string')
      : [],
    examVersionCodes: Array.isArray(obj.examVersionCodes)
      ? obj.examVersionCodes.filter((x): x is string => typeof x === 'string')
      : [],
    completedSteps: Array.isArray(obj.completedSteps) ? obj.completedSteps : [],
    pendingActions: Array.isArray(obj.pendingActions)
      ? obj.pendingActions.filter((x): x is string => typeof x === 'string')
      : [],
    history: Array.isArray(obj.history) ? obj.history.slice(0, 30) : [],
    lastActiveApp: obj.lastActiveApp ?? 'desktop',
  };
}

export function createInitialWorkflowStore(
  initialContext?: ConnectedWorkflowContext
): ConnectedWorkflowStore {
  const ctx = initialContext ?? createInitialWorkflowContext();
  return {
    version: 2,
    activeWorkflowId: ctx.workflowId,
    workflows: [ctx],
  };
}

export function normalizeStoredWorkflowStore(
  rawStore: unknown,
  legacySingleRaw?: unknown
): ConnectedWorkflowStore {
  if (rawStore && typeof rawStore === 'object') {
    const obj = rawStore as Partial<ConnectedWorkflowStore>;
    if (Array.isArray(obj.workflows) && obj.workflows.length > 0) {
      const deduped = new Map<string, ConnectedWorkflowContext>();
      for (const item of obj.workflows) {
        const normalized = normalizeStoredWorkflowContext(item);
        const existing = deduped.get(normalized.workflowId);
        if (!existing || (normalized.revision ?? 1) >= (existing.revision ?? 1)) {
          deduped.set(normalized.workflowId, normalized);
        }
      }
      const list = Array.from(deduped.values())
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .slice(0, MAX_STORED_WORKFLOWS);
      const activeId =
        typeof obj.activeWorkflowId === 'string' &&
        list.some((w) => w.workflowId === obj.activeWorkflowId)
          ? obj.activeWorkflowId
          : list[0].workflowId;
      return {
        version: 2,
        activeWorkflowId: activeId,
        workflows: list,
      };
    }
  }
  if (legacySingleRaw) {
    return createInitialWorkflowStore(normalizeStoredWorkflowContext(legacySingleRaw));
  }
  return createInitialWorkflowStore();
}

export function getActiveWorkflowFromStore(
  store: ConnectedWorkflowStore
): ConnectedWorkflowContext {
  return (
    store.workflows.find((w) => w.workflowId === store.activeWorkflowId) ??
    store.workflows[0] ??
    createInitialWorkflowContext()
  );
}

/**
 * Lưu hoặc cập nhật một workflow vào store.
 * Chặn ghi đè ngược khi incoming.revision < existing.revision (stale workflow protection).
 */
export function upsertWorkflowInStore(
  store: ConnectedWorkflowStore,
  incoming: ConnectedWorkflowContext,
  options?: { setActive?: boolean }
): { store: ConnectedWorkflowStore; applied: boolean; reason?: string } {
  const existing = store.workflows.find((w) => w.workflowId === incoming.workflowId);
  if (existing) {
    const existingRev = existing.revision ?? 1;
    const incomingRev = incoming.revision ?? 1;
    if (incomingRev < existingRev) {
      return {
        store,
        applied: false,
        reason: `Bỏ qua bản cập nhật cũ (rev ${incomingRev} < rev ${existingRev}) để không ghi đè dữ liệu mới hơn.`,
      };
    }
  }

  const nextList = [
    incoming,
    ...store.workflows.filter((w) => w.workflowId !== incoming.workflowId),
  ]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, MAX_STORED_WORKFLOWS);

  return {
    applied: true,
    store: {
      version: 2,
      activeWorkflowId:
        options?.setActive === false ? store.activeWorkflowId : incoming.workflowId,
      workflows: nextList,
    },
  };
}

/**
 * Chuyển sang một workflow theo workflowId. Trả về lỗi rõ ràng nếu workflowId không tồn tại.
 */
export function switchActiveWorkflow(
  store: ConnectedWorkflowStore,
  workflowId: string
): {
  store: ConnectedWorkflowStore;
  found: boolean;
  workflow?: ConnectedWorkflowContext;
  error?: string;
} {
  const found = store.workflows.find((w) => w.workflowId === workflowId);
  if (!found) {
    return {
      store,
      found: false,
      error: `Không tìm thấy phiên làm việc "${workflowId}". Phiên có thể đã bị xóa hoặc chưa được lưu.`,
    };
  }
  return {
    found: true,
    workflow: found,
    store: {
      ...store,
      activeWorkflowId: found.workflowId,
    },
  };
}

/**
 * Khởi tạo một workflow mới độc lập mà KHÔNG xóa/ghi đè các workflow đang có.
 */
export function createNewWorkflowInStore(
  store: ConnectedWorkflowStore,
  seed?: Partial<Omit<ConnectedWorkflowContext, 'workflowId' | 'createdAt' | 'history'>>,
  nowIso = new Date().toISOString()
): { store: ConnectedWorkflowStore; workflow: ConnectedWorkflowContext } {
  const base = createInitialWorkflowContext(nowIso);
  const created = seed ? patchWorkflowContext(base, seed, undefined, nowIso) : base;
  const nextList = [created, ...store.workflows].slice(0, MAX_STORED_WORKFLOWS);
  return {
    workflow: created,
    store: {
      version: 2,
      activeWorkflowId: created.workflowId,
      workflows: nextList,
    },
  };
}

// ============================================================================
// Integrity Gate & Validation Engine (Section 6, 11, 12)
// ============================================================================

function hasQuestionHardIntegrityBlocker(q: MathQuestion): string | null {
  if (q.sourceVerification?.verificationStatus === 'BLOCKED') {
    return (
      q.sourceVerification.reasons?.[0] ||
      `Câu ${q.code} đang bị BLOCKED cần xác minh trước khi trộn/xuất.`
    );
  }
  if (q.optionParseIncomplete) {
    return `Câu ${q.code}: OPTION_PARSE_INCOMPLETE (${q.optionParseReason || 'thiếu phương án A/B/C/D'}).`;
  }
  if (q.unrenderableMediaRefs && q.unrenderableMediaRefs.length > 0) {
    return `Câu ${q.code} chứa tài nguyên UNRENDERABLE (${q.unrenderableMediaRefs[0]}) chưa thể hiển thị an toàn.`;
  }
  const rawTexts: string[] = [
    q.stem?.rawSource ?? '',
    ...(q.options ?? []).map((o) => o.content?.rawSource ?? ''),
    ...(q.statements ?? []).map((s) => s.content?.rawSource ?? ''),
  ];
  if (rawTexts.some((t) => t.includes('[TÀI_NGUYÊN_UNRENDERABLE:'))) {
    return `Câu ${q.code} chứa tài nguyên UNRENDERABLE chưa thể hiển thị an toàn.`;
  }
  const graphCheck = verifyDynamicGraphBinding({ question: q });
  if (!graphCheck.valid) {
    return `Câu ${q.code}: ${graphCheck.reason ?? 'BLOCK EXPORT — STALE GRAPH DATA'}`;
  }
  return null;
}

/**
 * Kiểm tra toàn vẹn nghiêm ngặt của một workflow trên dữ liệu thực tế trong IndexedDB.
 * TUYỆT ĐỐI không bỏ qua Integrity Gate, Answer Confirmation Gate, OPTION_PARSE_INCOMPLETE,
 * UNRENDERABLE Media, STALE GRAPH DATA hay Answer Mapping Validation.
 */
export function validateWorkflowContext(
  ctx: ConnectedWorkflowContext,
  snapshot: WorkflowEvaluationSnapshot
): WorkflowValidationReport {
  const blockedReasons: string[] = [];
  const reviewReasons: string[] = [];
  const missingReferences: WorkflowMissingReference[] = [];
  let recommendedFixView: WorkflowValidationReport['recommendedFixView'];

  const resLookup = resolveStrictEntityById(snapshot.resources, ctx.resourceId);
  const draftLookup = snapshot.drafts
    ? resolveStrictEntityById(snapshot.drafts, ctx.examDraftId)
    : { entity: undefined, missing: false };
  const examLookup = resolveStrictEntityById(snapshot.mathExams, ctx.generatedExamId);
  const sessionLookup = snapshot.gradingSessions
    ? resolveStrictEntityById(snapshot.gradingSessions, ctx.gradingSessionId)
    : { entity: undefined, missing: false };

  if (resLookup.missing && ctx.resourceId) {
    missingReferences.push({
      entityType: 'resource',
      requestedId: ctx.resourceId,
      label: ctx.resourceTitle || ctx.resourceId,
      recoveryHint:
        'Tài liệu nguồn trong Resource Vault không còn tồn tại. Vui lòng chọn lại tài liệu nguồn hoặc tiếp tục từ đề đã tạo.',
    });
  }

  if (examLookup.missing && ctx.generatedExamId) {
    missingReferences.push({
      entityType: 'exam',
      requestedId: ctx.generatedExamId,
      label: ctx.generatedExamTitle || ctx.generatedExamId,
      recoveryHint:
        'Đề kiểm tra gắn với quy trình này không còn trong Exam Mixer Pro (có thể đã bị xóa). Vui lòng chọn đề khác hoặc tạo đề mới.',
    });
  }

  if (draftLookup.missing && ctx.examDraftId && !examLookup.entity) {
    missingReferences.push({
      entityType: 'draft',
      requestedId: ctx.examDraftId,
      label: ctx.examDraftTitle || ctx.examDraftId,
      recoveryHint:
        'Bản nháp đề kiểm tra không còn trong Smart Exam Generator. Bạn có thể tạo bản nháp mới từ ngân hàng câu hỏi.',
    });
  }

  if (sessionLookup.missing && ctx.gradingSessionId) {
    missingReferences.push({
      entityType: 'grading-session',
      requestedId: ctx.gradingSessionId,
      label: ctx.gradingSessionTitle || ctx.gradingSessionId,
      recoveryHint:
        'Phiên chấm OMR gắn với quy trình này không còn tồn tại. Vui lòng tạo phiên chấm mới sau khi xác minh mã đề.',
    });
  }

  const activeDraft = draftLookup.entity;
  const activeExam = examLookup.entity;
  const activeSession =
    sessionLookup.entity ??
    (activeExam && snapshot.gradingSessions
      ? snapshot.gradingSessions.find((s) => s.examId === activeExam.id)
      : undefined);

  let canMix = false;
  let canExportOfficial = false;
  let canGradeOmr = false;
  let canExportConfirmedGradebook = false;

  // 1. Validate Draft (Smart Exam Generator)
  if (activeDraft) {
    const graphCheck = verifyDraftDynamicGraphBindings(activeDraft);
    if (!graphCheck.valid) {
      blockedReasons.push(graphCheck.reason ?? 'BLOCK EXPORT — STALE GRAPH DATA');
      recommendedFixView = recommendedFixView ?? 'exam-generator';
    }
    const draftBlockedItems = activeDraft.items.filter((it) => it.status === 'BLOCKED');
    if (draftBlockedItems.length > 0) {
      blockedReasons.push(
        `Đề nháp "${activeDraft.title}" có ${draftBlockedItems.length} câu đang bị BLOCKED cần xử lý.`
      );
      recommendedFixView = recommendedFixView ?? 'exam-generator';
    }
    const unconfirmedDraftItems = activeDraft.items.filter(
      (it) => !it.teacherConfirmed || !it.question.answerConfirmed
    );
    if (unconfirmedDraftItems.length > 0 && !activeExam) {
      reviewReasons.push(
        `Đề nháp còn ${unconfirmedDraftItems.length}/${activeDraft.items.length} câu chưa xác nhận đáp án.`
      );
    }
  }

  // 2. Validate Exam (Exam Mixer Pro — full Integrity Gate + Answer Mapping)
  if (activeExam) {
    const origIssues = auditOriginalExamIntegrity(activeExam);
    const exportGate = checkExamExportGate(activeExam);

    const hasDocDoctorIssue = origIssues.some(
      (iss) =>
        iss.severity === 'error' &&
        (iss.code === 'UNRENDERABLE_MEDIA' ||
          iss.code === 'OPTION_PARSE_INCOMPLETE' ||
          iss.code === 'BROKEN_FORMULA' ||
          iss.code === 'STALE_GRAPH_DATA' ||
          iss.code === 'SOURCE_BLOCKED' ||
          iss.message.includes('UNRENDERABLE') ||
          iss.message.includes('OPTION_PARSE_INCOMPLETE') ||
          iss.message.includes('STALE GRAPH'))
    );

    for (const q of activeExam.questions) {
      const hardErr = hasQuestionHardIntegrityBlocker(q);
      if (hardErr) {
        blockedReasons.push(hardErr);
        recommendedFixView = 'import-doctor';
      }
    }

    for (const iss of origIssues) {
      if (iss.severity === 'error') {
        if (!blockedReasons.includes(iss.message)) {
          blockedReasons.push(iss.message);
        }
        if (hasDocDoctorIssue) {
          recommendedFixView = 'import-doctor';
        }
      }
    }

    const unconfirmedCount = activeExam.questions.filter((q) => !q.answerConfirmed).length;
    if (unconfirmedCount > 0 || !activeExam.confirmedOriginalAnswers) {
      reviewReasons.push(
        unconfirmedCount > 0
          ? `Còn ${unconfirmedCount}/${activeExam.questions.length} câu chưa xác nhận đáp án trong Answer Key Studio.`
          : 'Chưa bấm Xác nhận toàn bộ đáp án gốc (Bước 2).'
      );
      if (!recommendedFixView) {
        recommendedFixView = 'answer-studio';
      }
    }

    canMix = blockedReasons.length === 0 && unconfirmedCount === 0 && activeExam.confirmedOriginalAnswers && activeExam.questions.length > 0;
    canExportOfficial = exportGate.canExport && blockedReasons.length === 0;

    if (!exportGate.canExport && activeExam.generatedVersions.length > 0) {
      for (const reason of exportGate.blockingReasons) {
        if (!blockedReasons.includes(reason) && !reviewReasons.includes(reason)) {
          if (
            reason.includes('BLOCK') ||
            reason.includes('UNRENDERABLE') ||
            reason.includes('STALE') ||
            reason.includes('OPTION_PARSE_INCOMPLETE') ||
            reason.includes('lệch')
          ) {
            blockedReasons.push(reason);
          } else {
            reviewReasons.push(reason);
          }
        }
      }
    }

    // Kiểm chứng Answer Mapping cho từng mã đề trước khi cho phép chấm OMR
    if (activeExam.generatedVersions.length > 0) {
      const answerMap = buildExamAnswerKeyMap(activeExam);
      const keyList = Object.values(answerMap);
      const invalidKeys = keyList.filter((k) => !k.valid);
      if (invalidKeys.length > 0) {
        for (const inv of invalidKeys) {
          const msg =
            inv.blockingErrors[0] ??
            `Mã đề ${inv.examCode} có lỗi ánh xạ đáp án — chặn chấm OMR.`;
          if (!blockedReasons.includes(msg)) {
            blockedReasons.push(msg);
          }
        }
        canGradeOmr = false;
      } else if (keyList.length > 0 && canExportOfficial) {
        canGradeOmr = true;
      }
    }
  }

  // 3. Validate Grading Session
  if (activeSession) {
    const activeSheets = activeSession.sheets.filter((s) => !s.archivedByDuplicateResolution);
    const pendingReview = activeSheets.filter(
      (s) =>
        !s.confirmedByTeacher &&
        (s.status === 'review-required' || s.status === 'error' || s.uncertainCount > 0)
    ).length;
    if (pendingReview > 0) {
      reviewReasons.push(
        `Phiên chấm "${activeSession.title}" còn ${pendingReview} phiếu OMR cần giáo viên duyệt tay.`
      );
    }
    const officialCount =
      activeSession.gradebookEntries?.filter((g) => g.officialScore !== null).length ??
      (pendingReview === 0 ? activeSheets.length : 0);
    canExportConfirmedGradebook =
      activeSheets.length > 0 && pendingReview === 0 && officialCount > 0;
  }

  const status: WorkflowValidationReport['status'] =
    missingReferences.length > 0
      ? 'missing-reference'
      : blockedReasons.length > 0
      ? 'blocked'
      : reviewReasons.length > 0
      ? 'needs-review'
      : 'valid';

  return {
    status,
    canMix,
    canExportOfficial,
    canGradeOmr,
    canExportConfirmedGradebook,
    blockedReasons: Array.from(new Set(blockedReasons)),
    reviewReasons: Array.from(new Set(reviewReasons)),
    missingReferences,
    recommendedFixView,
  };
}

/**
 * Đánh giá trung thực trạng thái 8 chặng của Connected Workflow:
 * Nguồn tài liệu -> Chọn câu -> Tạo đề -> Duyệt -> Trộn mã đề -> In -> Chấm -> Tổng hợp.
 * Quy tắc bắt buộc: KHÔNG đánh dấu Completed khi thiếu dữ liệu, bị BLOCKED hoặc chưa được xác nhận.
 */
export function evaluateConnectedWorkflowProgress(
  ctx: ConnectedWorkflowContext,
  snapshot: WorkflowEvaluationSnapshot
): WorkflowStageEvaluation[] {
  const resLookup = resolveStrictEntityById(snapshot.resources, ctx.resourceId);
  const activeResource = resLookup.entity;

  const activeDraft = ctx.examDraftId
    ? snapshot.drafts?.find((d) => d.id === ctx.examDraftId)
    : undefined;

  const examLookup = resolveStrictEntityById(snapshot.mathExams, ctx.generatedExamId);
  const activeExam = examLookup.entity;

  const activeSession = (() => {
    const sessions = snapshot.gradingSessions ?? [];
    if (ctx.gradingSessionId) {
      const exact = sessions.find((s) => s.id === ctx.gradingSessionId);
      if (exact) return exact;
    }
    if (activeExam) {
      return sessions.find((s) => s.examId === activeExam.id);
    }
    return undefined;
  })();

  // 1. Nguồn tài liệu
  const sourceStatus: ConnectedWorkflowStageStatus = resLookup.missing
    ? 'blocked'
    : activeResource
    ? 'completed'
    : snapshot.resources.length > 0 && (activeDraft || activeExam)
    ? 'completed'
    : snapshot.resources.length > 0
    ? 'in-progress'
    : 'not-started';

  const sourceDetail = resLookup.missing
    ? `Tài liệu nguồn "${ctx.resourceTitle || ctx.resourceId}" đã bị xóa — cần chọn lại`
    : activeResource
    ? activeResource.title
    : snapshot.resources.length > 0
    ? `${snapshot.resources.length} tài liệu sẵn sàng trong Resource Vault`
    : 'Chưa có tài liệu nguồn trong Resource Vault';

  // 2. Chọn câu
  const selectedCount =
    activeDraft?.items.length ??
    (ctx.questionSelectionIds.length > 0
      ? ctx.questionSelectionIds.length
      : activeExam?.questions.length ?? 0);
  const selectStatus: ConnectedWorkflowStageStatus =
    selectedCount > 0
      ? 'completed'
      : activeResource
      ? 'in-progress'
      : 'not-started';
  const selectDetail =
    selectedCount > 0
      ? `${selectedCount} câu hỏi đã chọn`
      : 'Chưa chọn câu hỏi cho đề kiểm tra';

  // 3. Tạo đề
  const hasGeneratedDraftOrExam = Boolean(
    activeDraft || activeExam || ctx.examDraftId || ctx.generatedExamId
  );
  const draftBlockedCount = activeDraft
    ? activeDraft.items.filter((it) => it.status === 'BLOCKED').length
    : ctx.examDraftBlockedCount ?? 0;
  const draftGraphStale = activeDraft
    ? !verifyDraftDynamicGraphBindings(activeDraft).valid
    : false;

  const generateStatus: ConnectedWorkflowStageStatus = examLookup.missing
    ? 'blocked'
    : !hasGeneratedDraftOrExam
    ? 'not-started'
    : selectedCount === 0
    ? 'in-progress'
    : 'completed';
  const generateDetail = examLookup.missing
    ? `Đề "${ctx.generatedExamTitle || ctx.generatedExamId}" không còn tồn tại — cần khôi phục`
    : activeDraft
    ? `${activeDraft.title} (${activeDraft.items.length} câu)`
    : activeExam
    ? `${activeExam.title} (${activeExam.questions.length} câu)`
    : ctx.examDraftTitle || ctx.generatedExamTitle || 'Chưa tạo đề nháp';

  // 4. Duyệt (Strict: NEVER Completed if unconfirmed, BLOCKED, OPTION_PARSE_INCOMPLETE, UNRENDERABLE, or STALE GRAPH!)
  let reviewStatus: ConnectedWorkflowStageStatus = 'not-started';
  let reviewDetail = 'Chờ tạo đề để duyệt đáp án';

  if (activeDraft && !activeExam) {
    const total = activeDraft.items.length;
    const confirmed = activeDraft.items.filter(
      (it) => it.teacherConfirmed && it.question.answerConfirmed
    ).length;
    if (draftBlockedCount > 0 || draftGraphStale) {
      reviewStatus = 'blocked';
      reviewDetail = draftGraphStale
        ? 'BLOCK EXPORT — STALE GRAPH DATA: cần cập nhật đồ thị đồng bộ'
        : `${draftBlockedCount} câu bị BLOCKED — cần xử lý trước khi xuất`;
    } else if (total > 0 && confirmed === total) {
      reviewStatus = 'completed';
      reviewDetail = `Đã xác nhận đủ ${confirmed}/${total} đáp án`;
    } else if (total > 0) {
      reviewStatus = 'needs-review';
      reviewDetail = `Mới duyệt ${confirmed}/${total} câu — cần giáo viên xác nhận`;
    }
  } else if (activeExam) {
    const total = activeExam.questions.length;
    const confirmed = activeExam.questions.filter((q) => q.answerConfirmed).length;
    const hardBlockedQuestions = activeExam.questions.filter(
      (q) => hasQuestionHardIntegrityBlocker(q) !== null
    );
    if (hardBlockedQuestions.length > 0) {
      reviewStatus = 'blocked';
      reviewDetail =
        hasQuestionHardIntegrityBlocker(hardBlockedQuestions[0]) ||
        `${hardBlockedQuestions.length} câu đang BLOCKED trong đề gốc`;
    } else if (total > 0 && confirmed === total) {
      reviewStatus = 'completed';
      reviewDetail = `Đã xác nhận ${confirmed}/${total} đáp án gốc`;
    } else if (total > 0) {
      reviewStatus = 'needs-review';
      reviewDetail = `Đã duyệt ${confirmed}/${total} câu gốc — cần kiểm tra thêm`;
    }
  } else if (ctx.examDraftId && (ctx.examDraftQuestionCount ?? 0) > 0) {
    const total = ctx.examDraftQuestionCount ?? 0;
    const confirmed = ctx.examDraftConfirmedCount ?? 0;
    if ((ctx.examDraftBlockedCount ?? 0) > 0) {
      reviewStatus = 'blocked';
      reviewDetail = `${ctx.examDraftBlockedCount} câu đang BLOCKED`;
    } else if (confirmed >= total) {
      reviewStatus = 'completed';
      reviewDetail = `Đã duyệt ${confirmed}/${total} câu`;
    } else {
      reviewStatus = 'needs-review';
      reviewDetail = `Đã duyệt ${confirmed}/${total} câu — chưa hoàn tất`;
    }
  }

  // 5. Trộn mã đề
  const versionCodes = activeExam
    ? activeExam.generatedVersions.map((v) => v.code)
    : examLookup.missing
    ? []
    : ctx.examVersionCodes;
  const hasInvalidVersionMapping = Boolean(
    activeExam &&
      activeExam.generatedVersions.length > 0 &&
      activeExam.generatedVersions.some(
        (v) =>
          v.integrityPassed === false ||
          v.integrityStatus === 'BLOCKED' ||
          (v.questions.length > 0 && !buildExamAnswerKeyMap(activeExam, [v.code])[v.code]?.valid)
      )
  );
  const mixStatus: ConnectedWorkflowStageStatus =
    (reviewStatus === 'blocked' && versionCodes.length === 0) || hasInvalidVersionMapping
      ? 'blocked'
      : versionCodes.length > 0
      ? 'completed'
      : activeExam
      ? 'in-progress'
      : 'not-started';
  const mixDetail = hasInvalidVersionMapping
    ? 'Mã đề bị lỗi toàn vẹn/ánh xạ đáp án — cần trộn lại sau khi sửa đề gốc'
    : versionCodes.length > 0
    ? `Đã tạo ${versionCodes.length} mã đề (${versionCodes.slice(0, 4).join(', ')})`
    : activeExam
    ? 'Đề đã mở trong Exam Mixer — chưa tạo mã đề'
    : 'Chưa chuyển sang Exam Mixer Pro';

  // 6. In / Xuất theo mẫu
  const printStatus: ConnectedWorkflowStageStatus =
    reviewStatus === 'blocked' || mixStatus === 'blocked'
      ? 'blocked'
      : ctx.printedAt
      ? 'completed'
      : versionCodes.length > 0 || activeExam
      ? 'in-progress'
      : 'not-started';
  const printDetail =
    printStatus === 'blocked'
      ? 'Bị chặn xuất bản chính thức do đề gốc hoặc mã đề chưa đạt kiểm chứng'
      : ctx.printedAt
      ? ctx.examFormLabel
        ? `Đã xuất/in (${ctx.examFormLabel})`
        : 'Đã mở xem trước & xuất in A4'
      : versionCodes.length > 0
      ? `Sẵn sàng in ${versionCodes.length} mã đề trong Print Studio`
      : 'Chờ tạo đề / mã đề trước khi in';

  // 7. Chấm bài OMR
  const activeSheets = activeSession
    ? activeSession.sheets.filter((s) => !s.archivedByDuplicateResolution)
    : [];
  const gradedCount = activeSession
    ? activeSheets.length
    : ctx.gradedSheetCount ?? 0;
  const pendingReviewSheets = activeSession
    ? activeSheets.filter(
        (s) =>
          !s.confirmedByTeacher &&
          (s.status === 'review-required' || s.status === 'error' || s.uncertainCount > 0)
      ).length
    : ctx.pendingGradingReviewCount ?? 0;

  const gradeStatus: ConnectedWorkflowStageStatus =
    mixStatus === 'blocked' && gradedCount === 0
      ? 'blocked'
      : gradedCount > 0 && pendingReviewSheets === 0
      ? 'completed'
      : gradedCount > 0 && pendingReviewSheets > 0
      ? 'needs-review'
      : activeSession || ctx.gradingSessionId
      ? 'in-progress'
      : 'not-started';
  const gradeDetail =
    gradeStatus === 'blocked'
      ? 'Chặn chấm OMR cho tới khi mã đề và bảng đáp án hợp lệ'
      : gradedCount > 0
      ? pendingReviewSheets > 0
        ? `Đã chấm ${gradedCount} bài · ${pendingReviewSheets} bài cần duyệt tay`
        : `Đã chấm và duyệt ${gradedCount} phiếu OMR`
      : activeSession
      ? `Phiên chấm "${activeSession.title}" đang chờ ảnh phiếu`
      : 'Chưa tạo phiên chấm trong Smart Grading Studio';

  // 8. Tổng hợp bảng điểm
  const officialCount = activeSession
    ? activeSession.gradebookEntries?.filter((g) => g.officialScore !== null).length ??
      (pendingReviewSheets === 0 ? gradedCount : 0)
    : ctx.finalizedGradebookCount ?? 0;

  const summaryStatus: ConnectedWorkflowStageStatus =
    gradedCount > 0 && pendingReviewSheets === 0 && officialCount > 0
      ? 'completed'
      : gradedCount > 0
      ? 'needs-review'
      : 'not-started';
  const summaryDetail =
    summaryStatus === 'completed'
      ? `Bảng điểm đã chốt ${officialCount} học sinh`
      : gradedCount > 0
      ? 'Cần duyệt hết phiếu cảnh báo trước khi chốt bảng điểm'
      : 'Chưa có bảng điểm tổng hợp';

  return [
    {
      id: 'source',
      order: 1,
      label: 'Nguồn tài liệu',
      shortLabel: 'Nguồn',
      appId: 'resource-vault',
      status: sourceStatus,
      detail: sourceDetail,
      canNavigate: true,
    },
    {
      id: 'select',
      order: 2,
      label: 'Chọn câu hỏi',
      shortLabel: 'Chọn câu',
      appId: 'exam-generator',
      status: selectStatus,
      detail: selectDetail,
      canNavigate: true,
    },
    {
      id: 'generate',
      order: 3,
      label: 'Tạo đề kiểm tra',
      shortLabel: 'Tạo đề',
      appId: 'exam-generator',
      status: generateStatus,
      detail: generateDetail,
      canNavigate: true,
    },
    {
      id: 'review',
      order: 4,
      label: 'Duyệt đáp án',
      shortLabel: 'Duyệt',
      appId: activeExam ? 'math-mixer' : 'exam-generator',
      status: reviewStatus,
      detail: reviewDetail,
      canNavigate: true,
    },
    {
      id: 'mix',
      order: 5,
      label: 'Trộn mã đề',
      shortLabel: 'Trộn mã',
      appId: 'math-mixer',
      status: mixStatus,
      detail: mixDetail,
      canNavigate: true,
    },
    {
      id: 'print',
      order: 6,
      label: 'In & Xuất đề',
      shortLabel: 'In đề',
      appId: 'print-studio',
      status: printStatus,
      detail: printDetail,
      canNavigate: true,
    },
    {
      id: 'grade',
      order: 7,
      label: 'Chấm phiếu OMR',
      shortLabel: 'Chấm bài',
      appId: 'grading-studio',
      status: gradeStatus,
      detail: gradeDetail,
      canNavigate: true,
    },
    {
      id: 'summary',
      order: 8,
      label: 'Tổng hợp điểm',
      shortLabel: 'Tổng hợp',
      appId: 'grading-studio',
      status: summaryStatus,
      detail: summaryDetail,
      canNavigate: true,
    },
  ];
}

// ============================================================================
// Smart Action Bar Engine (Phase 2 — Section 6)
// ============================================================================

/**
 * Tính toán hành động tiếp theo hợp lệ nhất ("Smart Action Bar") dựa trên dữ liệu thực tế
 * và Integrity Gate. KHÔNG BAO GIỜ đề xuất chấm OMR hay xuất chính thức khi đề bị chặn hoặc thiếu đáp án.
 */
export function computeSmartActionBar(
  ctx: ConnectedWorkflowContext,
  snapshot: WorkflowEvaluationSnapshot,
  activeApp: AppId
): SmartActionBarModel {
  const validation = validateWorkflowContext(ctx, snapshot);
  const resLookup = resolveStrictEntityById(snapshot.resources, ctx.resourceId);
  const draftLookup = snapshot.drafts
    ? resolveStrictEntityById(snapshot.drafts, ctx.examDraftId)
    : { entity: undefined, missing: false };
  const examLookup = resolveStrictEntityById(snapshot.mathExams, ctx.generatedExamId);
  const sessionLookup = snapshot.gradingSessions
    ? resolveStrictEntityById(snapshot.gradingSessions, ctx.gradingSessionId)
    : { entity: undefined, missing: false };

  const activeResource = resLookup.entity;
  const activeDraft = draftLookup.entity;
  const activeExam = examLookup.entity;
  const activeSession =
    sessionLookup.entity ??
    (activeExam && snapshot.gradingSessions
      ? snapshot.gradingSessions.find((s) => s.examId === activeExam.id)
      : undefined);

  const secondaryActions: SmartActionItem[] = [];

  // Case 0: Missing entity reference (e.g., deleted exam or deleted resource) -> explicit recovery banner
  if (validation.missingReferences.length > 0) {
    const firstMissing = validation.missingReferences[0];
    const recoveryAction: SmartActionItem =
      firstMissing.entityType === 'resource'
        ? {
            id: 'smart-recover-resource',
            label: 'Chọn lại tài liệu trong Resource Vault',
            description: firstMissing.recoveryHint,
            tone: 'warning',
            targetApp: 'resource-vault',
          }
        : firstMissing.entityType === 'exam'
        ? {
            id: 'smart-recover-exam',
            label: 'Mở Smart Exam Generator để tạo đề mới',
            description: firstMissing.recoveryHint,
            tone: 'warning',
            targetApp: 'exam-generator',
            targetGeneratorTab: 'natural-language',
            resourceId: activeResource?.id,
          }
        : {
            id: 'smart-recover-grading',
            label: 'Mở Exam Mixer kiểm tra mã đề',
            description: firstMissing.recoveryHint,
            tone: 'warning',
            targetApp: 'math-mixer',
            targetStep: 3,
            examId: activeExam?.id,
          };

    return {
      validation,
      primaryAction: recoveryAction,
      secondaryActions: [
        {
          id: 'smart-open-vault-fallback',
          label: 'Mở Resource Vault',
          description: 'Chọn tài liệu nguồn mới',
          tone: 'secondary',
          targetApp: 'resource-vault',
        },
      ],
      missingReferenceBanner: {
        title: `Không tìm thấy ${
          firstMissing.entityType === 'exam'
            ? 'đề kiểm tra'
            : firstMissing.entityType === 'resource'
            ? 'tài liệu nguồn'
            : firstMissing.entityType === 'draft'
            ? 'bản nháp đề'
            : 'phiên chấm OMR'
        } "${firstMissing.label}"`,
        detail: firstMissing.recoveryHint,
        recoveryAction,
      },
    };
  }

  // Case 1: BLOCKED by Integrity Gate (OPTION_PARSE_INCOMPLETE / UNRENDERABLE / STALE GRAPH / Answer Mapping)
  if (validation.status === 'blocked') {
    const topReason = validation.blockedReasons[0] ?? 'Đề đang bị chặn bởi cổng kiểm chứng toàn vẹn.';
    const fixAction: SmartActionItem =
      validation.recommendedFixView === 'exam-generator' && activeDraft && !activeExam
        ? {
            id: 'smart-fix-draft-blocked',
            label: 'Sửa câu bị chặn trong Exam Generator',
            description: topReason,
            tone: 'blocked',
            targetApp: 'exam-generator',
            targetGeneratorTab: 'wizard',
          }
        : validation.recommendedFixView === 'import-doctor' && activeExam
        ? {
            id: 'smart-fix-import-doctor',
            label: 'Mở Document Import Doctor để sửa',
            description: topReason,
            tone: 'blocked',
            targetApp: 'math-mixer',
            targetStep: 2,
            targetSubView: 'import-doctor',
            examId: activeExam.id,
          }
        : {
            id: 'smart-fix-answer-studio',
            label: 'Mở Answer Key Studio để xác minh',
            description: topReason,
            tone: 'blocked',
            targetApp: 'math-mixer',
            targetStep: 2,
            targetSubView: 'answer-studio',
            examId: activeExam?.id,
          };

    if (activeExam) {
      secondaryActions.push({
        id: 'smart-open-answer-studio-sec',
        label: 'Mở Answer Key Studio',
        description: 'Kiểm tra và xác nhận toàn bộ đáp án gốc',
        tone: 'secondary',
        targetApp: 'math-mixer',
        targetStep: 2,
        targetSubView: 'answer-studio',
        examId: activeExam.id,
      });
    }

    return {
      validation,
      primaryAction: fixAction,
      secondaryActions,
      blockedBanner: {
        title: 'Đang chặn trộn/xuất/chấm OMR do lỗi toàn vẹn dữ liệu',
        reason: topReason,
        fixAction,
      },
    };
  }

  // Case 2: Grading session active & has sheets needing review
  if (activeSession) {
    const activeSheets = activeSession.sheets.filter((s) => !s.archivedByDuplicateResolution);
    const pendingReview = activeSheets.filter(
      (s) =>
        !s.confirmedByTeacher &&
        (s.status === 'review-required' || s.status === 'error' || s.uncertainCount > 0)
    ).length;

    if (pendingReview > 0) {
      return {
        validation,
        primaryAction: {
          id: 'smart-review-omr-sheets',
          label: `Duyệt ${pendingReview} phiếu OMR cần kiểm tra`,
          description: `Xác nhận ô tô mờ/trùng trong phiên "${activeSession.title}" trước khi chốt bảng điểm.`,
          tone: 'warning',
          targetApp: 'grading-studio',
          targetGradingTab: 'review',
          examId: activeSession.examId,
          gradingSessionId: activeSession.id,
        },
        secondaryActions: [
          {
            id: 'smart-open-gradebook-sec',
            label: 'Xem sổ điểm đối chiếu',
            description: 'Mở bảng tổng hợp điểm hiện tại',
            tone: 'secondary',
            targetApp: 'grading-studio',
            targetGradingTab: 'gradebook',
            examId: activeSession.examId,
            gradingSessionId: activeSession.id,
          },
        ],
      };
    }

    if (validation.canExportConfirmedGradebook) {
      return {
        validation,
        primaryAction: {
          id: 'smart-export-gradebook',
          label: 'Xuất bảng điểm đã xác nhận',
          description: `Toàn bộ ${activeSheets.length} phiếu đã được duyệt. Xuất Excel/CSV bảng điểm lớp ${activeSession.className}.`,
          tone: 'primary',
          targetApp: 'grading-studio',
          targetGradingTab: 'export',
          examId: activeSession.examId,
          gradingSessionId: activeSession.id,
        },
        secondaryActions: activeExam
          ? [
              {
                id: 'smart-reopen-print-sec',
                label: 'Mở lại Print Studio',
                description: 'Xem lại bản in đề & bảng đáp án',
                tone: 'secondary',
                targetApp: 'print-studio',
                examId: activeExam.id,
              },
            ]
          : [],
      };
    }
  }

  // Case 3: Active exam in Exam Mixer
  if (activeExam) {
    const unconfirmedCount = activeExam.questions.filter((q) => !q.answerConfirmed).length;
    if (unconfirmedCount > 0 || !activeExam.confirmedOriginalAnswers) {
      return {
        validation,
        primaryAction: {
          id: 'smart-confirm-answers',
          label:
            unconfirmedCount > 0
              ? `Xác nhận ${unconfirmedCount} đáp án (Answer Key Studio)`
              : 'Xác nhận toàn bộ đáp án gốc (Bước 2)',
          description:
            'Bắt buộc xác nhận đáp án gốc trước khi trộn mã đề, xuất đề chính thức hoặc chấm OMR.',
          tone: 'warning',
          targetApp: 'math-mixer',
          targetStep: 2,
          targetSubView: 'answer-studio',
          examId: activeExam.id,
        },
        secondaryActions: [
          {
            id: 'smart-open-doctor-sec',
            label: 'Kiểm tra công thức (Import Doctor)',
            description: 'Rà soát công thức toán & hình ảnh trước khi trộn',
            tone: 'secondary',
            targetApp: 'math-mixer',
            targetStep: 2,
            targetSubView: 'import-doctor',
            examId: activeExam.id,
          },
        ],
      };
    }

    if (activeExam.generatedVersions.length === 0) {
      return {
        validation,
        primaryAction: {
          id: 'smart-mix-4-codes',
          label: 'Tạo 4 mã đề (101–104)',
          description: `Đề "${activeExam.title}" đã xác nhận đủ đáp án. Chuyển sang Bước 3 để trộn mã đề chuẩn.`,
          tone: 'primary',
          targetApp: 'math-mixer',
          targetStep: 3,
          examId: activeExam.id,
        },
        secondaryActions: [
          {
            id: 'smart-preview-print-sec',
            label: 'Xem bản in đề gốc',
            description: 'Mở Print Studio xem trang A4 đề gốc',
            tone: 'secondary',
            targetApp: 'print-studio',
            examId: activeExam.id,
          },
        ],
      };
    }

    // Exam has valid mixed versions & passes export gate
    if (validation.canGradeOmr && validation.canExportOfficial) {
      const versionCount = activeExam.generatedVersions.length;
      const firstCode = activeExam.generatedVersions[0]?.code;
      if (activeApp === 'print-studio' || ctx.printedAt) {
        return {
          validation,
          primaryAction: {
            id: 'smart-create-omr-sheet',
            label: 'Tạo phiếu OMR & chấm bài',
            description: `Mở Smart Grading Studio với ${versionCount} mã đề đã kiểm chứng ánh xạ đáp án.`,
            tone: 'primary',
            targetApp: 'grading-studio',
            targetGradingTab: 'sheet-gen',
            examId: activeExam.id,
            className: ctx.studentClassId,
          },
          secondaryActions: [
            {
              id: 'smart-open-answer-key-code',
              label: firstCode ? `Xem bảng đáp án mã ${firstCode}` : 'Xem bảng đáp án',
              description: 'Kiểm tra đáp án chi tiết theo từng mã đề',
              tone: 'secondary',
              targetApp: 'math-mixer',
              targetStep: 4,
              examId: activeExam.id,
              examCode: firstCode,
            },
          ],
        };
      }

      return {
        validation,
        primaryAction: {
          id: 'smart-open-print-studio',
          label: `Chọn mẫu in (${versionCount} mã đề)`,
          description: `Đề "${activeExam.title}" đã đạt kiểm chứng toàn vẹn. Mở Print Studio để in A4/DOCX.`,
          tone: 'primary',
          targetApp: 'print-studio',
          examId: activeExam.id,
        },
        secondaryActions: [
          {
            id: 'smart-open-omr-sec',
            label: 'Tạo phiếu OMR',
            description: 'Chuyển thẳng sang Smart Grading Studio để in phiếu tô & chấm bài',
            tone: 'secondary',
            targetApp: 'grading-studio',
            targetGradingTab: 'sheet-gen',
            examId: activeExam.id,
            className: ctx.studentClassId,
          },
          ...(firstCode
            ? [
                {
                  id: 'smart-view-code-key-sec',
                  label: `Bảng đáp án mã ${firstCode}`,
                  description: `Mở bảng đáp án của mã đề ${firstCode}`,
                  tone: 'secondary' as const,
                  targetApp: 'math-mixer' as const,
                  targetStep: 4 as const,
                  examId: activeExam.id,
                  examCode: firstCode,
                },
              ]
            : []),
        ],
      };
    }
  }

  // Case 4: Active draft in Smart Exam Generator not yet sent to Exam Mixer
  if (activeDraft) {
    const unconfirmedDraft = activeDraft.items.filter(
      (it) => !it.teacherConfirmed || !it.question.answerConfirmed
    ).length;
    if (unconfirmedDraft > 0) {
      return {
        validation,
        primaryAction: {
          id: 'smart-review-draft-answers',
          label: `Duyệt ${unconfirmedDraft} đáp án đề nháp`,
          description: `Mở Bước 5 của "${activeDraft.title}" để xác nhận đáp án trước khi sang Exam Mixer Pro.`,
          tone: 'warning',
          targetApp: 'exam-generator',
          targetGeneratorTab: 'wizard',
        },
        secondaryActions: [],
      };
    }
    return {
      validation,
      primaryAction: {
        id: 'smart-send-draft-mixer',
        label: 'Mở đề trong Exam Mixer Pro',
        description: `Đề nháp "${activeDraft.title}" đã sẵn sàng trộn thành nhiều mã đề.`,
        tone: 'primary',
        targetApp: 'exam-generator',
        targetGeneratorTab: 'wizard',
      },
      secondaryActions: [],
    };
  }

  // Case 5: Resource selected, no draft/exam yet
  if (activeResource) {
    return {
      validation,
      primaryAction: {
        id: 'smart-generate-from-resource',
        label: 'Tạo đề từ tài liệu đang chọn',
        description: `Chuyển "${activeResource.title}" sang Smart Exam Generator để tạo đề kiểm tra.`,
        tone: 'primary',
        targetApp: 'exam-generator',
        targetGeneratorTab: 'natural-language',
        resourceId: activeResource.id,
      },
      secondaryActions: [
        {
          id: 'smart-open-bank-sec',
          label: 'Mở Ngân hàng câu hỏi',
          description: 'Xem và chọn câu hỏi trực tiếp từ ngân hàng hợp nhất',
          tone: 'secondary',
          targetApp: 'exam-generator',
          targetGeneratorTab: 'bank',
        },
      ],
    };
  }

  // Case 6: Fresh workflow — guide teacher to pick a resource or start generating
  return {
    validation,
    primaryAction:
      snapshot.resources.length > 0
        ? {
            id: 'smart-start-from-vault',
            label: 'Chọn tài liệu nguồn để tạo đề',
            description: `Có ${snapshot.resources.length} tài liệu sẵn sàng trong Resource Vault.`,
            tone: 'primary',
            targetApp: activeApp === 'resource-vault' ? 'exam-generator' : 'resource-vault',
            targetGeneratorTab: activeApp === 'resource-vault' ? 'natural-language' : undefined,
            resourceId: snapshot.resources[0]?.id,
          }
        : {
            id: 'smart-open-generator-fresh',
            label: 'Tạo đề kiểm tra mới',
            description: 'Mở Smart Exam Generator để tạo đề từ ngân hàng câu hỏi cục bộ.',
            tone: 'primary',
            targetApp: 'exam-generator',
            targetGeneratorTab: 'natural-language',
          },
    secondaryActions:
      snapshot.mathExams.length > 0
        ? [
            {
              id: 'smart-open-latest-exam-sec',
              label: 'Mở đề gần nhất trong Exam Mixer',
              description: `Tiếp tục với "${snapshot.mathExams[0].title}"`,
              tone: 'secondary',
              targetApp: 'math-mixer',
              targetStep: 2,
              examId: snapshot.mathExams[0].id,
            },
          ]
        : [],
  };
}

// ============================================================================
// Connected Workspace Dashboard Summary (Phase 2 — Section 8)
// ============================================================================

export function buildConnectedWorkspaceSummaries(
  store: ConnectedWorkflowStore,
  snapshot: WorkflowEvaluationSnapshot
): ConnectedWorkspaceWorkflowSummary[] {
  return store.workflows.map((workflow) => {
    const stages = evaluateConnectedWorkflowProgress(workflow, snapshot);
    const smartBar = computeSmartActionBar(workflow, snapshot, workflow.lastActiveApp);
    const byId = Object.fromEntries(stages.map((s) => [s.id, s])) as Record<
      ConnectedWorkflowStageId,
      WorkflowStageEvaluation
    >;

    const resumeAction: SmartActionItem = smartBar.primaryAction ?? {
      id: `resume-${workflow.workflowId}`,
      label: 'Tiếp tục công việc',
      description: 'Mở lại ứng dụng gần nhất của quy trình này',
      tone: 'primary',
      targetApp: workflow.lastActiveApp === 'desktop' ? 'exam-generator' : workflow.lastActiveApp,
      examId: workflow.generatedExamId,
      resourceId: workflow.resourceId,
      gradingSessionId: workflow.gradingSessionId,
    };

    const gradeCombinedStatus: ConnectedWorkflowStageStatus =
      byId.summary.status === 'completed'
        ? 'completed'
        : byId.grade.status === 'blocked' || byId.print.status === 'blocked'
        ? 'blocked'
        : byId.grade.status === 'needs-review' || byId.summary.status === 'needs-review'
        ? 'needs-review'
        : byId.grade.status === 'completed' || byId.print.status === 'completed'
        ? 'in-progress'
        : byId.grade.status;

    return {
      workflow,
      isActive: workflow.workflowId === store.activeWorkflowId,
      stages,
      validation: smartBar.validation,
      completedStageCount: stages.filter((s) => s.status === 'completed').length,
      totalStageCount: stages.length,
      resumeLabel: resumeAction.label,
      resumeAction,
      fiveStepProgress: [
        { key: 'source', label: 'Nguồn', status: byId.source.status },
        { key: 'generate', label: 'Tạo đề', status: byId.generate.status },
        { key: 'review', label: 'Đáp án', status: byId.review.status },
        { key: 'mix', label: 'Trộn mã', status: byId.mix.status },
        { key: 'grade', label: 'Xuất & Chấm', status: gradeCombinedStatus },
      ],
    };
  });
}

// ============================================================================
// Dashboard Next-Step Suggestions (100% Real Data + Integrity Gate Aware)
// ============================================================================

function hasExamStrictBlockerForMixedSuggestion(exam: MathExamProject): boolean {
  if (exam.questions.some((q) => hasQuestionHardIntegrityBlocker(q) !== null)) {
    return true;
  }
  if (
    exam.generatedVersions.some(
      (v) => v.integrityPassed === false || v.integrityStatus === 'BLOCKED'
    )
  ) {
    return true;
  }
  // Nếu mã đề đã sinh câu hỏi thực tế thì bắt buộc phải vượt qua cổng kiểm chứng xuất & ánh xạ đáp án
  const hasPopulatedVersions = exam.generatedVersions.some((v) => v.questions.length > 0);
  if (hasPopulatedVersions) {
    const gate = checkExamExportGate(exam);
    if (!gate.canExport) return true;
    const keys = buildExamAnswerKeyMap(exam);
    if (Object.values(keys).some((k) => !k.valid)) return true;
  }
  return false;
}

/**
 * Gợi ý bước tiếp theo trên Trang chủ dựa 100% trên trạng thái dữ liệu thực trong IndexedDB
 * và tôn trọng tuyệt đối cổng kiểm chứng toàn vẹn (Integrity Gate).
 */
export function computeDashboardNextSteps(
  ctx: ConnectedWorkflowContext,
  snapshot: WorkflowEvaluationSnapshot
): DashboardNextStepSuggestion[] {
  const suggestions: DashboardNextStepSuggestion[] = [];

  // 0. Có đề đang bị BLOCKED bởi Integrity Gate -> ưu tiên cảnh báo & sửa ngay
  const blockedExam = snapshot.mathExams.find((e) =>
    hasExamStrictBlockerForMixedSuggestion(e)
  );
  if (blockedExam) {
    const firstQBlocker = blockedExam.questions
      .map((q) => hasQuestionHardIntegrityBlocker(q))
      .find((msg): msg is string => Boolean(msg));
    suggestions.push({
      id: `next-blocked-${blockedExam.id}`,
      priority: 110,
      title: `Đề "${blockedExam.title}" đang bị chặn bởi cổng kiểm chứng`,
      description:
        firstQBlocker ||
        'Đề chưa xác nhận đủ đáp án hoặc mã đề có lỗi ánh xạ. Mở Exam Mixer Pro để xử lý trước khi in hoặc chấm OMR.',
      badgeText: 'Cần sửa lỗi toàn vẹn',
      primaryActionLabel: 'Mở Answer Key / Import Doctor',
      targetApp: 'math-mixer',
      targetStep: 2,
      targetSubView: firstQBlocker ? 'import-doctor' : 'answer-studio',
      examId: blockedExam.id,
    });
  }

  // 1. Có đề vừa trộn mã đề hợp lệ -> gợi ý In đề hoặc Tạo phiếu OMR
  const latestMixedExam =
    (ctx.generatedExamId
      ? snapshot.mathExams.find(
          (e) =>
            e.id === ctx.generatedExamId &&
            e.generatedVersions.length > 0 &&
            !hasExamStrictBlockerForMixedSuggestion(e)
        )
      : undefined) ??
    snapshot.mathExams.find(
      (e) =>
        e.generatedVersions.length > 0 &&
        !hasExamStrictBlockerForMixedSuggestion(e)
    );

  if (latestMixedExam) {
    const versionCount = latestMixedExam.generatedVersions.length;
    const codes = latestMixedExam.generatedVersions
      .map((v) => v.code)
      .slice(0, 4)
      .join(', ');
    suggestions.push({
      id: `next-mixed-${latestMixedExam.id}`,
      priority: 100,
      title: `Bạn đã có ${versionCount} mã đề (${codes}) cho "${latestMixedExam.title}"`,
      description:
        'Bước tiếp theo: Mở Print Studio để in bộ đề A4 hoặc tạo phiếu OMR chuẩn trong Smart Grading Studio.',
      badgeText: `${versionCount} mã đề sẵn sàng`,
      primaryActionLabel: 'In đề trong Print Studio',
      targetApp: 'print-studio',
      secondaryActionLabel: 'Tạo phiếu OMR',
      secondaryTargetApp: 'grading-studio',
      examId: latestMixedExam.id,
    });
  }

  // 2. Có đề đang có câu chưa duyệt đáp án hoặc chưa trộn mã
  const unmixedExam = snapshot.mathExams.find(
    (e) =>
      e.id !== blockedExam?.id &&
      e.questions.length > 0 &&
      e.generatedVersions.length === 0
  );
  if (unmixedExam) {
    const unconfirmed = unmixedExam.questions.filter((q) => !q.answerConfirmed).length;
    suggestions.push({
      id: `next-unmixed-${unmixedExam.id}`,
      priority: 90,
      title:
        unconfirmed > 0
          ? `"${unmixedExam.title}" còn ${unconfirmed} câu chưa xác nhận đáp án`
          : `"${unmixedExam.title}" đã sẵn sàng trộn thành nhiều mã đề`,
      description:
        unconfirmed > 0
          ? 'Bước tiếp theo: Mở Answer Key Studio để kiểm tra và xác nhận đáp án gốc trước khi trộn.'
          : 'Bước tiếp theo: Trộn thành 4 mã đề chuẩn với ánh xạ đáp án tự động.',
      badgeText: unconfirmed > 0 ? 'Cần duyệt đáp án' : 'Sẵn sàng trộn',
      primaryActionLabel:
        unconfirmed > 0 ? 'Mở Answer Key Studio' : 'Mở Exam Mixer Pro',
      targetApp: 'math-mixer',
      targetStep: unconfirmed > 0 ? 2 : 3,
      targetSubView: unconfirmed > 0 ? 'answer-studio' : undefined,
      examId: unmixedExam.id,
    });
  }

  // 3. Có phiên chấm đang còn phiếu cần duyệt tay
  const isSheetNeedingReview = (sh: GradingSession['sheets'][number]) =>
    !sh.archivedByDuplicateResolution &&
    !sh.confirmedByTeacher &&
    (sh.status === 'review-required' || sh.status === 'error' || sh.uncertainCount > 0);
  const pendingSession = (snapshot.gradingSessions ?? []).find((s) =>
    s.sheets.some(isSheetNeedingReview)
  );
  if (pendingSession) {
    const reviewCnt = pendingSession.sheets.filter(isSheetNeedingReview).length;
    suggestions.push({
      id: `next-grade-${pendingSession.id}`,
      priority: 95,
      title: `Phiên chấm "${pendingSession.title}" có ${reviewCnt} phiếu cần giáo viên duyệt`,
      description:
        'Bước tiếp theo: Mở Smart Grading Studio để xác nhận các ô tô mờ/trùng và chốt bảng điểm lớp.',
      badgeText: `${reviewCnt} phiếu cần duyệt`,
      primaryActionLabel: 'Duyệt phiếu OMR',
      targetApp: 'grading-studio',
      targetGradingTab: 'review',
      examId: pendingSession.examId,
      gradingSessionId: pendingSession.id,
    });
  }

  // 4. Có tài liệu đề thi trong Resource Vault -> gợi ý tạo đề bằng yêu cầu tiếng Việt
  const examVaultDocs = snapshot.resources.filter(
    (r) => r.documentCategory === 'de-thi' || r.documentCategory === 'bai-tap'
  );
  if (examVaultDocs.length > 0) {
    const firstDoc = examVaultDocs[0];
    suggestions.push({
      id: `next-vault-${firstDoc.id}`,
      priority: 75,
      title: `Resource Vault có ${examVaultDocs.length} tài liệu đề thi & bài tập sẵn sàng`,
      description: `Bước tiếp theo: Tạo đề kiểm tra mới bằng yêu cầu tiếng Việt từ "${firstDoc.title}" hoặc sinh biến thể đổi số kiểm chứng.`,
      badgeText: `${examVaultDocs.length} nguồn đề`,
      primaryActionLabel: 'Tạo đề tiếng Việt ngay',
      targetApp: 'exam-generator',
      secondaryActionLabel: 'Mở Resource Vault',
      secondaryTargetApp: 'resource-vault',
      resourceId: firstDoc.id,
    });
  }

  return suggestions.sort((a, b) => b.priority - a.priority).slice(0, 3);
}

// ============================================================================
// Universal Command Center Parser (Phase 2 — Section 7)
// ============================================================================

/**
 * Universal Command Bar Parser — 100% Local-First rule-based parser (zero AI API).
 * Hỗ trợ đầy đủ lệnh tiếng Việt cho toàn bộ luồng TeacherOS, có bước xác nhận an toàn,
 * kiểm tra Integrity Gate và tuyệt đối không thực thi lệnh phá hủy / gửi dữ liệu ra ngoài.
 */
export function parseUniversalCommand(
  rawInput: string,
  params: {
    ctx: ConnectedWorkflowContext;
    resources: ResourceItem[];
    mathExams: MathExamProject[];
    gradingSessions?: GradingSession[];
  }
): ParsedUniversalCommand[] {
  const trimmed = rawInput.trim();
  const norm = normalizeVietnameseText(trimmed);
  const commands: ParsedUniversalCommand[] = [];

  const strictExam = resolveStrictEntityById(
    params.mathExams,
    params.ctx.generatedExamId
  );
  // Chỉ dùng mathExams[0] khi workflow chưa gắn ID cụ thể; nếu ID gắn trong ctx đã bị xóa thì KHÔNG mở nhầm đề khác
  const activeExam = strictExam.missing
    ? undefined
    : strictExam.entity ?? params.mathExams[0];
  const latestExam = params.mathExams[0];

  const strictResource = resolveStrictEntityById(
    params.resources,
    params.ctx.resourceId
  );
  const selectedResource = strictResource.entity;
  const latestSession = (params.gradingSessions ?? [])[0];

  // Khi ô tìm kiếm trống -> cung cấp danh sách lệnh quy trình mẫu có thể bấm ngay
  if (!trimmed) {
    commands.push(
      {
        id: 'wf-sample-nl-toan12',
        category: 'workflow',
        intent: 'nl-generate-exam',
        title: 'Tạo đề Toán 12 từ Resource Vault',
        subtitle:
          'Mở Natural Language Exam Builder với câu lệnh Toán 12 (Hàm số & Đạo hàm) để xác nhận trước khi sinh đề',
        badgeText: 'Lệnh quy trình',
        targetApp: 'exam-generator',
        requiresConfirmation: true,
        confirmationTitle: 'Khởi tạo đề Toán 12 từ Resource Vault?',
        confirmationDescription:
          'Hệ thống sẽ mở Smart Exam Generator (tab Tạo đề tiếng Việt), nạp sẵn yêu cầu Toán 12 từ Resource Vault để bạn kiểm tra và xác nhận trước khi sinh đề.',
        payload: {
          rawCommand: 'Tạo đề Toán 12 từ Resource Vault',
          resourceId: selectedResource?.id,
          promptText:
            'Tạo cho tôi một đề kiểm tra Toán 12 giữa học kỳ 1, thời gian 45 phút, gồm 4 câu trắc nghiệm, 2 câu đúng sai và 2 câu trả lời ngắn. Lấy câu hỏi từ thư mục Toán 12 trong Resource Vault. Ưu tiên chương Hàm số và Đạo hàm. Những câu toán phù hợp hãy đổi số để tạo câu mới, tính lại đáp án.',
        },
      },
      {
        id: 'wf-sample-bank-hamso',
        category: 'navigation',
        intent: 'open-bank-topic',
        title: 'Mở ngân hàng câu hỏi chương Hàm số',
        subtitle:
          'Mở tab Ngân hàng câu hỏi trong Smart Exam Generator và lọc sẵn từ khóa "Hàm số"',
        badgeText: 'Điều hướng',
        targetApp: 'exam-generator',
        requiresConfirmation: false,
        payload: {
          rawCommand: 'Mở ngân hàng câu hỏi chương Hàm số',
          topicQuery: 'Hàm số',
        },
      },
      {
        id: 'wf-sample-mix-4',
        category: 'workflow',
        intent: 'mix-current-exam',
        title: activeExam
          ? `Trộn đề "${activeExam.title}" thành 4 mã`
          : 'Trộn đề kiểm tra thành 4 mã đề',
        subtitle: activeExam
          ? 'Mở Exam Mixer Pro với đề đang chọn và thiết lập 4 mã đề (101–104)'
          : 'Mở Exam Mixer Pro để chọn hoặc nhập đề cần trộn',
        badgeText: 'Lệnh quy trình',
        targetApp: 'math-mixer',
        requiresConfirmation: true,
        confirmationTitle: 'Chuyển sang Exam Mixer Pro với cấu hình 4 mã đề?',
        confirmationDescription: activeExam
          ? `Đề "${activeExam.title}" sẽ được mở trong Exam Mixer Pro để bạn kiểm tra tính toàn vẹn và bấm tạo 4 mã đề.`
          : 'Mở Exam Mixer Pro để chọn đề cần trộn.',
        payload: {
          rawCommand: 'Trộn đề này thành 4 mã',
          examId: activeExam?.id,
          versionCount: 4,
          mixerStep: 3,
        },
      },
      {
        id: 'wf-sample-omr-12a2',
        category: 'workflow',
        intent: 'create-omr-sheet',
        title: 'Tạo phiếu trả lời OMR cho lớp 12A2',
        subtitle:
          'Mở Smart Grading Studio (tab Tạo phiếu OMR), điền sẵn lớp 12A2 và gắn với bài kiểm tra hiện tại',
        badgeText: 'Lệnh quy trình',
        targetApp: 'grading-studio',
        requiresConfirmation: true,
        confirmationTitle: 'Tạo phiếu trả lời OMR cho lớp 12A2?',
        confirmationDescription: activeExam
          ? `Mở Smart Grading Studio với đề "${activeExam.title}" và lớp 12A2 để xem trước và in phiếu OMR.`
          : 'Mở Smart Grading Studio với lớp 12A2.',
        payload: {
          rawCommand: 'Tạo phiếu trả lời cho lớp 12A2',
          examId: activeExam?.id,
          className: '12A2',
          gradingTab: 'sheet-gen',
        },
      },
      {
        id: 'wf-sample-print-gk',
        category: 'workflow',
        intent: 'print-exam-form',
        title: 'Xuất & in đề theo mẫu giữa học kỳ',
        subtitle:
          'Mở Print Studio ở chế độ Đề kiểm tra với bài thi hiện tại để xem trước trang A4 và xuất DOCX/PDF',
        badgeText: 'Lệnh quy trình',
        targetApp: 'print-studio',
        requiresConfirmation: true,
        confirmationTitle: 'Mở Print Studio để xuất đề theo mẫu giữa học kỳ?',
        confirmationDescription: activeExam
          ? `Đề "${activeExam.title}" sẽ được mở trực tiếp trong Print Studio (chế độ Đề kiểm tra A4) mà không cần chọn lại.`
          : 'Mở Print Studio để chọn đề kiểm tra hoặc giáo án cần in.',
        payload: {
          rawCommand: 'Xuất đề theo mẫu giữa học kỳ',
          examId: activeExam?.id,
          formLabel: 'Mẫu kiểm tra giữa học kỳ',
        },
      }
    );
    return commands;
  }

  // Từ chối an toàn các câu lệnh phá hủy / gửi dữ liệu ngoài (Section 7 & 12)
  if (
    /\b(xoa\s+het|xoa\s+toan\s+bo|xoa\s+tat\s+ca|reset|format|xuat\s+ban\s+cong\s+khai|gui\s+len|upload\s+toan\s+bo|bo\s+qua\s+kiem\s+chung|tu\s+xac\s+nhan\s+dap\s+an)\b/.test(
      norm
    )
  ) {
    return [];
  }

  // A. Lệnh mở ứng dụng trực tiếp ("Mở Resource Vault", "Mở Exam Mixer", "Mở Print Studio", "Mở Smart Grading")
  if (/^(mo|vao|chuyen\s+sang)\s+(resource\s+vault|kho\s+tai\s+lieu)\b/.test(norm)) {
    commands.push({
      id: 'nav-cmd-open-vault',
      category: 'navigation',
      intent: 'open-app',
      title: 'Mở Resource Vault (Kho tài liệu)',
      subtitle: `${params.resources.length} tài liệu học tập và đề thi cục bộ`,
      badgeText: 'Điều hướng',
      targetApp: 'resource-vault',
      requiresConfirmation: false,
      payload: { rawCommand: trimmed },
    });
  } else if (/^(mo|vao|chuyen\s+sang)\s+(exam\s+mixer|tron\s+de)\b/.test(norm)) {
    commands.push({
      id: 'nav-cmd-open-mixer',
      category: 'navigation',
      intent: 'open-app',
      title: 'Mở Exam Mixer Pro',
      subtitle: `${params.mathExams.length} đề kiểm tra trong hệ thống cục bộ`,
      badgeText: 'Điều hướng',
      targetApp: 'math-mixer',
      requiresConfirmation: false,
      payload: { rawCommand: trimmed, examId: activeExam?.id },
    });
  } else if (/^(mo|vao|chuyen\s+sang)\s+(print\s+studio|in\s+an)\b/.test(norm)) {
    commands.push({
      id: 'nav-cmd-open-print',
      category: 'navigation',
      intent: 'open-app',
      title: 'Mở Print Studio',
      subtitle: 'Xem trước trang A4, xuất đề kiểm tra và giáo án',
      badgeText: 'Điều hướng',
      targetApp: 'print-studio',
      requiresConfirmation: false,
      payload: { rawCommand: trimmed, examId: activeExam?.id },
    });
  } else if (/^(mo|vao|chuyen\s+sang)\s+(smart\s+grading|cham\s+bai)\b/.test(norm)) {
    commands.push({
      id: 'nav-cmd-open-grading',
      category: 'navigation',
      intent: 'open-app',
      title: 'Mở Smart Grading Studio',
      subtitle: 'Tạo phiếu OMR, chấm bài tự động và chốt bảng điểm',
      badgeText: 'Điều hướng',
      targetApp: 'grading-studio',
      requiresConfirmation: false,
      payload: { rawCommand: trimmed, examId: activeExam?.id },
    });
  }

  // B. Lệnh: "Mở đề kiểm tra gần nhất"
  if (/\b(mo\s+de\s+(kiem\s+tra\s+)?gan\s+nhat|de\s+gan\s+nhat)\b/.test(norm)) {
    commands.push({
      id: 'nav-cmd-latest-exam',
      category: 'navigation',
      intent: 'open-latest-exam',
      title: latestExam
        ? `Mở đề kiểm tra gần nhất: "${latestExam.title}"`
        : 'Chưa có đề kiểm tra nào trong Exam Mixer Pro',
      subtitle: latestExam
        ? `${latestExam.subject || 'Toán học'} · ${latestExam.questions.length} câu · ${latestExam.generatedVersions.length} mã đề`
        : 'Mở Exam Mixer Pro để nhập hoặc tạo đề kiểm tra đầu tiên',
      badgeText: 'Điều hướng',
      targetApp: 'math-mixer',
      requiresConfirmation: false,
      payload: {
        rawCommand: trimmed,
        examId: latestExam?.id,
        mixerStep: 2,
      },
    });
  }

  // C. Lệnh: "Mở bảng đáp án mã 101" / "Xem đáp án mã 102"
  const answerKeyCodeMatch = norm.match(
    /\b(?:bang\s+dap\s+an|dap\s+an)\s*(?:ma\s*(?:de\s*)?)?(\d{2,4})\b/
  );
  if (answerKeyCodeMatch) {
    const requestedCode = answerKeyCodeMatch[1];
    const examWithCode =
      (activeExam?.generatedVersions.some((v) => v.code === requestedCode)
        ? activeExam
        : undefined) ??
      params.mathExams.find((e) =>
        e.generatedVersions.some((v) => v.code === requestedCode)
      );
    commands.push({
      id: `nav-cmd-answer-key-${requestedCode}`,
      category: 'navigation',
      intent: 'open-exam-answer-key',
      title: examWithCode
        ? `Mở bảng đáp án mã ${requestedCode} · "${examWithCode.title}"`
        : `Tìm bảng đáp án mã ${requestedCode} (chưa thấy mã ${requestedCode})`,
      subtitle: examWithCode
        ? `Mở Exam Mixer Pro (Bước 4 — Bảng đáp án mã ${requestedCode})`
        : 'Chưa có đề nào đã trộn sinh ra mã đề này. Mở Exam Mixer Pro để kiểm tra danh sách mã đề.',
      badgeText: examWithCode ? `Mã ${requestedCode}` : 'Thiếu mã đề',
      targetApp: 'math-mixer',
      requiresConfirmation: false,
      blockedReason: examWithCode
        ? undefined
        : `Không tìm thấy mã đề ${requestedCode} trong các đề đã trộn.`,
      payload: {
        rawCommand: trimmed,
        examId: examWithCode?.id ?? activeExam?.id,
        examCode: requestedCode,
        mixerStep: 4,
      },
    });
  }

  // D. Lệnh: "Mở Answer Key Studio" / "Kiểm tra đáp án gốc"
  if (
    !answerKeyCodeMatch &&
    /\b(answer\s+key\s+studio|xac\s+nhan\s+dap\s+an|kiem\s+tra\s+dap\s+an)\b/.test(norm)
  ) {
    commands.push({
      id: 'nav-cmd-answer-key-studio',
      category: 'navigation',
      intent: 'open-answer-key-studio',
      title: activeExam
        ? `Mở Answer Key Studio · "${activeExam.title}"`
        : 'Mở Answer Key Studio (Exam Mixer Pro)',
      subtitle: 'Kiểm tra và xác nhận toàn bộ đáp án gốc trước khi trộn đề',
      badgeText: 'Điều hướng',
      targetApp: 'math-mixer',
      requiresConfirmation: false,
      payload: {
        rawCommand: trimmed,
        examId: activeExam?.id,
        mixerStep: 2,
        mixerSubView: 'answer-studio',
      },
    });
  }

  // E. Lệnh: "Mở danh sách bài cần duyệt" / "Duyệt phiếu OMR"
  if (/\b(danh\s+sach\s+bai\s+can\s+duyet|phieu\s+can\s+duyet|duyet\s+phieu\s+omr|bai\s+can\s+duyet)\b/.test(norm)) {
    const pendingSession =
      (params.gradingSessions ?? []).find((s) =>
        s.sheets.some(
          (sh) =>
            !sh.archivedByDuplicateResolution &&
            !sh.confirmedByTeacher &&
            (sh.status === 'review-required' || sh.status === 'error' || sh.uncertainCount > 0)
        )
      ) ?? latestSession;
    commands.push({
      id: 'nav-cmd-grading-review',
      category: 'navigation',
      intent: 'open-grading-review',
      title: pendingSession
        ? `Mở danh sách bài cần duyệt · "${pendingSession.title}"`
        : 'Mở danh sách bài cần duyệt (Smart Grading Studio)',
      subtitle: pendingSession
        ? `Lớp ${pendingSession.className} · Mở thẳng tab Duyệt phiếu OMR`
        : 'Chuyển thẳng tới tab Duyệt phiếu trong Smart Grading Studio',
      badgeText: 'Duyệt phiếu',
      targetApp: 'grading-studio',
      requiresConfirmation: false,
      payload: {
        rawCommand: trimmed,
        examId: pendingSession?.examId ?? activeExam?.id,
        gradingSessionId: pendingSession?.id,
        gradingTab: 'review',
      },
    });
  }

  // F. Lệnh: "Xuất bảng điểm đã xác nhận"
  if (/\b(xuat\s+bang\s+diem|tai\s+bang\s+diem|bang\s+diem\s+da\s+xac\s+nhan)\b/.test(norm)) {
    const pendingSheetsCount = latestSession
      ? latestSession.sheets.filter(
          (sh) =>
            !sh.archivedByDuplicateResolution &&
            !sh.confirmedByTeacher &&
            (sh.status === 'review-required' || sh.status === 'error' || sh.uncertainCount > 0)
        ).length
      : 0;
    const blockedReason = !latestSession
      ? 'Chưa có phiên chấm OMR nào để xuất bảng điểm.'
      : pendingSheetsCount > 0
      ? `Còn ${pendingSheetsCount} phiếu chưa được giáo viên duyệt — cần duyệt trước khi xuất bảng điểm chính thức.`
      : undefined;

    commands.push({
      id: 'wf-cmd-export-gradebook',
      category: 'workflow',
      intent: 'export-confirmed-gradebook',
      title: latestSession
        ? `Xuất bảng điểm đã xác nhận · "${latestSession.title}"`
        : 'Xuất bảng điểm đã xác nhận',
      subtitle: blockedReason
        ? blockedReason
        : `Mở Smart Grading Studio (tab Xuất báo cáo) cho lớp ${latestSession?.className ?? ''}`,
      badgeText: blockedReason ? 'Cần duyệt trước' : 'Xuất bảng điểm',
      targetApp: 'grading-studio',
      requiresConfirmation: !blockedReason,
      confirmationTitle: 'Mở trình xuất bảng điểm đã xác nhận?',
      confirmationDescription: latestSession
        ? `Hệ thống sẽ mở tab Xuất báo cáo của phiên "${latestSession.title}" (lớp ${latestSession.className}) để bạn tải Excel/CSV.`
        : 'Mở Smart Grading Studio để chọn phiên chấm.',
      blockedReason,
      payload: {
        rawCommand: trimmed,
        examId: latestSession?.examId ?? activeExam?.id,
        gradingSessionId: latestSession?.id,
        gradingTab: blockedReason && latestSession ? 'review' : 'export',
      },
    });
  }

  // 1. Lệnh: "Tạo đề ..." / "Soạn đề ..." / "Sinh đề ..."
  if (/\b(tao|sinh|lap|soan)\s+(de|bai\s+kiem\s+tra)\b/.test(norm)) {
    const wantsSelectedDoc = /\b(tai\s+lieu\s+dang\s+chon|nguon\s+dang\s+chon)\b/.test(norm);
    const matchedRes =
      (wantsSelectedDoc ? selectedResource : undefined) ??
      params.resources.find((r) => {
        const rNorm = normalizeVietnameseText(
          `${r.title} ${r.sourceFile?.relativePath ?? ''} ${r.chapterTopic ?? ''}`
        );
        return (
          (norm.includes('toan 12') && rNorm.includes('toan 12')) ||
          (norm.includes('ham so') && rNorm.includes('ham so')) ||
          (norm.includes('dao ham') && rNorm.includes('dao ham'))
        );
      }) ??
      selectedResource;

    commands.push({
      id: 'wf-cmd-nl-generate',
      category: 'workflow',
      intent: 'nl-generate-exam',
      title: `Tạo đề từ yêu cầu: "${trimmed}"`,
      subtitle: matchedRes
        ? `Nạp sẵn tài liệu "${matchedRes.title}" vào Smart Exam Generator để xác nhận trước khi tạo đề`
        : 'Chuyển thẳng vào Natural Language Exam Builder để phân tích cấu hình & xác nhận trước khi tạo đề',
      badgeText: 'Lệnh quy trình',
      targetApp: 'exam-generator',
      requiresConfirmation: true,
      confirmationTitle: 'Xác nhận mở bộ Tạo đề bằng yêu cầu tiếng Việt?',
      confirmationDescription: `Hệ thống sẽ phân tích câu lệnh "${trimmed}" trong Smart Exam Generator. Bạn vẫn có quyền chỉnh mọi thông số trước khi sinh đề.`,
      payload: {
        rawCommand: trimmed,
        promptText: trimmed,
        resourceId: matchedRes?.id,
      },
    });
  }

  // 2. Lệnh: "Mở ngân hàng câu hỏi ..."
  if (/\b(ngan\s+hang\s+cau\s+hoi|tim\s+cau\s+hoi)\b/.test(norm)) {
    const topicMatch = trimmed.match(
      /(?:chương|chuong|chủ đề|chu de|về|ve)\s+([^.,;!?]+)/i
    );
    const topicQuery = topicMatch?.[1]?.trim() ?? '';
    commands.push({
      id: 'nav-cmd-bank-topic',
      category: 'navigation',
      intent: 'open-bank-topic',
      title: topicQuery
        ? `Mở Ngân hàng câu hỏi · lọc "${topicQuery}"`
        : 'Mở Ngân hàng câu hỏi hợp nhất',
      subtitle: 'Điều hướng thẳng tới tab Ngân hàng câu hỏi trong Smart Exam Generator',
      badgeText: 'Điều hướng',
      targetApp: 'exam-generator',
      requiresConfirmation: false,
      payload: {
        rawCommand: trimmed,
        topicQuery,
      },
    });
  }

  // 3. Lệnh: "Trộn đề ... thành X mã"
  if (
    !answerKeyCodeMatch &&
    /\b(tron\s+de|tao\s+\d+\s+ma\s+de)\b/.test(norm)
  ) {
    const countMatch = norm.match(/(\d{1,2})\s*ma\b/);
    const versionCount = countMatch?.[1]
      ? Math.max(1, Math.min(24, Number(countMatch[1])))
      : 4;
    commands.push({
      id: 'wf-cmd-mix-exam',
      category: 'workflow',
      intent: 'mix-current-exam',
      title: activeExam
        ? `Trộn "${activeExam.title}" thành ${versionCount} mã đề`
        : `Mở Exam Mixer Pro để trộn ${versionCount} mã đề`,
      subtitle: 'Giữ nguyên đề đang làm việc trong Shared Context — không cần nhập lại',
      badgeText: 'Lệnh quy trình',
      targetApp: 'math-mixer',
      requiresConfirmation: true,
      confirmationTitle: `Xác nhận trộn đề thành ${versionCount} mã?`,
      confirmationDescription: activeExam
        ? `Mở đề "${activeExam.title}" trong Exam Mixer Pro với cấu hình ${versionCount} mã đề để kiểm tra toàn vẹn trước khi trộn.`
        : 'Mở Exam Mixer Pro để chọn đề cần trộn.',
      payload: {
        rawCommand: trimmed,
        examId: activeExam?.id,
        versionCount,
        mixerStep: 3,
      },
    });
  }

  // 4. Lệnh: "Tạo phiếu trả lời / OMR cho lớp 12A2"
  if (/\b(phieu\s+tra\s+loi|phieu\s+omr|phieu\s+cham|tao\s+phieu)\b/.test(norm)) {
    const classMatch =
      trimmed.match(/lớp\s+([0-9]{1,2}[A-Za-z0-9]{1,4})/i) ??
      trimmed.match(/\b([0-9]{1,2}[A-Za-z][0-9]{1,2})\b/);
    const className = classMatch?.[1]?.toUpperCase();
    const blockedReason =
      activeExam && hasExamStrictBlockerForMixedSuggestion(activeExam)
        ? `Đề "${activeExam.title}" đang bị chặn kiểm chứng — cần xác nhận đáp án/sửa lỗi trước khi chấm OMR.`
        : undefined;

    commands.push({
      id: 'wf-cmd-omr-sheet',
      category: 'workflow',
      intent: 'create-omr-sheet',
      title: className
        ? `Tạo phiếu trả lời OMR cho lớp ${className}`
        : 'Tạo phiếu trả lời OMR chuẩn',
      subtitle: blockedReason
        ? blockedReason
        : activeExam
        ? `Gắn trực tiếp với đề "${activeExam.title}" trong Smart Grading Studio`
        : 'Mở công cụ tạo phiếu OMR trong Smart Grading Studio',
      badgeText: blockedReason ? 'Cần xác minh đề' : 'Lệnh quy trình',
      targetApp: blockedReason ? 'math-mixer' : 'grading-studio',
      requiresConfirmation: true,
      confirmationTitle: className
        ? `Tạo phiếu OMR cho lớp ${className}?`
        : 'Mở trình tạo phiếu trả lời OMR?',
      confirmationDescription: blockedReason
        ? `${blockedReason} Hệ thống sẽ mở Exam Mixer Pro để bạn xử lý trước.`
        : activeExam
        ? `Smart Grading Studio sẽ mở sẵn đề "${activeExam.title}"${className ? ` và điền lớp ${className}` : ''} để bạn kiểm tra và in phiếu.`
        : 'Mở Smart Grading Studio ở mục Tạo phiếu OMR.',
      blockedReason,
      payload: {
        rawCommand: trimmed,
        examId: activeExam?.id,
        className,
        gradingTab: 'sheet-gen',
        mixerStep: blockedReason ? 2 : undefined,
        mixerSubView: blockedReason ? 'answer-studio' : undefined,
      },
    });
  }

  // 5. Lệnh: "Mở kết quả chấm bài gần nhất" / "Xem bảng điểm"
  if (
    !commands.some((c) => c.intent === 'export-confirmed-gradebook') &&
    /\b(ket\s+qua\s+cham|bang\s+diem|cham\s+bai\s+gan\s+nhat)\b/.test(norm)
  ) {
    commands.push({
      id: 'nav-cmd-latest-grading',
      category: 'navigation',
      intent: 'open-latest-grading',
      title: latestSession
        ? `Mở kết quả chấm bài: "${latestSession.title}"`
        : 'Mở Smart Grading Studio · Bảng điểm gần nhất',
      subtitle: latestSession
        ? `Lớp ${latestSession.className} · ${latestSession.sheets.filter((s) => !s.archivedByDuplicateResolution).length} phiếu đã chấm`
        : 'Xem phiên chấm và bảng điểm trong Smart Grading Studio',
      badgeText: 'Điều hướng',
      targetApp: 'grading-studio',
      requiresConfirmation: false,
      payload: {
        rawCommand: trimmed,
        examId: latestSession?.examId ?? activeExam?.id,
        gradingSessionId: latestSession?.id,
        gradingTab: 'gradebook',
      },
    });
  }

  // 6. Lệnh: "Azota" / "Xuất đề sang Azota" / "Nhập bảng điểm từ Azota"
  if (/\bazota\b/.test(norm)) {
    commands.push({
      id: 'wf-cmd-azota-bridge',
      category: 'workflow',
      intent: 'open-azota-bridge',
      title: 'Mở Tích hợp Azota (Chế độ trao đổi tệp tin cục bộ)',
      subtitle:
        'Xuất đề .DOCX tương thích Azota hoặc nhập bảng điểm .XLSX/.CSV từ Azota (API trực tiếp chưa công bố)',
      badgeText: 'Tích hợp tệp tin',
      targetApp: 'grading-studio',
      requiresConfirmation: false,
      payload: {
        rawCommand: trimmed,
        examId: activeExam?.id,
        gradingTab: 'azota',
      },
    });
  }

  // 7. Lệnh: "Xuất đề theo mẫu ..." / "Thiết kế mẫu đề" / "Exam Form Designer" / "In đề ..."
  if (
    !/\bazota\b/.test(norm) &&
    /\b(thiet\s+ke\s+mau\s+de|exam\s+form\s+designer|form\s+designer|xuat\s+de|in\s+de|mau\s+de|mau\s+giua\s+hoc\s+ky|mau\s+cuoi\s+hoc\s+ky)\b/.test(
      norm
    )
  ) {
    const formMatch = trimmed.match(/(?:theo\s*)?mẫu\s+([^.,;!?]+)/i);
    const formLabel =
      formMatch?.[1] && !/^đề\s*$/i.test(formMatch[1].trim())
        ? `Mẫu ${formMatch[1].trim()}`
        : 'Mẫu đề kiểm tra chuẩn';
    commands.push({
      id: 'wf-cmd-print-exam',
      category: 'workflow',
      intent: 'print-exam-form',
      title: activeExam
        ? `Thiết kế mẫu & Xuất "${activeExam.title}" (${formLabel})`
        : `Mở Exam Form Designer · ${formLabel}`,
      subtitle: 'Mở Print Studio ở chế độ Exam Form Designer A4 và giữ nguyên đề hiện tại',
      badgeText: 'Lệnh quy trình',
      targetApp: 'print-studio',
      requiresConfirmation: true,
      confirmationTitle: `Mở Exam Form Designer với ${formLabel}?`,
      confirmationDescription: activeExam
        ? `Đề "${activeExam.title}" sẽ mở sẵn trong Exam Form Designer để bạn thiết kế bố cục A4 trước khi xuất DOCX/ZIP hoặc in PDF.`
        : 'Mở Exam Form Designer trong Print Studio để chọn đề kiểm tra.',
      payload: {
        rawCommand: trimmed,
        examId: activeExam?.id,
        formLabel,
      },
    });
  }

  return commands;
}

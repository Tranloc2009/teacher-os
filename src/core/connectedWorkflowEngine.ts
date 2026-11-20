import type { AppId } from './appRegistry';
import type {
  ConnectedWorkflowContext,
  ConnectedWorkflowStageId,
  ConnectedWorkflowStageStatus,
  DashboardNextStepSuggestion,
  ParsedUniversalCommand,
  WorkflowStageEvaluation,
} from '../types/connectedWorkflow';
import type { ResourceItem } from '../types/lesson';
import type { MathExamProject } from '../types/mathExam';
import type { GradingSession } from '../types/grading';
import type { GeneratedExamDraft } from '../types/examGenerator';
import { normalizeVietnameseText } from './examGenerator/smartQuestionRetrieval';

export const CONNECTED_WORKFLOW_META_KEY = 'connected_workflow_context_v1';

export interface WorkflowEvaluationSnapshot {
  resources: ResourceItem[];
  mathExams: MathExamProject[];
  gradingSessions?: GradingSession[];
  drafts?: GeneratedExamDraft[];
}

export function createInitialWorkflowContext(
  nowIso = new Date().toISOString()
): ConnectedWorkflowContext {
  return {
    workflowId: `wf-ctx-${Date.now().toString(36)}`,
    title: 'Luồng tạo & chấm đề kiểm tra',
    questionSelectionIds: [],
    examVersionIds: [],
    examVersionCodes: [],
    lastActiveApp: 'desktop',
    createdAt: nowIso,
    updatedAt: nowIso,
    history: [],
  };
}

/**
 * Cập nhật ngữ cảnh liên ứng dụng bất biến, bảo toàn toàn bộ ID ở các bước trước
 * để giáo viên có thể quay lại bất kỳ bước nào mà không mất dữ liệu.
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

  return {
    ...prev,
    ...patch,
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
    questionSelectionIds: Array.isArray(obj.questionSelectionIds)
      ? obj.questionSelectionIds.filter((x): x is string => typeof x === 'string')
      : [],
    examVersionIds: Array.isArray(obj.examVersionIds)
      ? obj.examVersionIds.filter((x): x is string => typeof x === 'string')
      : [],
    examVersionCodes: Array.isArray(obj.examVersionCodes)
      ? obj.examVersionCodes.filter((x): x is string => typeof x === 'string')
      : [],
    history: Array.isArray(obj.history) ? obj.history.slice(0, 30) : [],
    lastActiveApp: obj.lastActiveApp ?? 'desktop',
  };
}

/**
 * Đánh giá trung thực trạng thái 8 chặng của Connected Workflow (Section 8.4):
 * Nguồn tài liệu -> Chọn câu -> Tạo đề -> Duyệt -> Trộn mã đề -> In -> Chấm -> Tổng hợp.
 * Quy tắc bắt buộc: KHÔNG đánh dấu Completed khi thiếu dữ liệu hoặc chưa được xác nhận.
 */
export function evaluateConnectedWorkflowProgress(
  ctx: ConnectedWorkflowContext,
  snapshot: WorkflowEvaluationSnapshot
): WorkflowStageEvaluation[] {
  const activeResource = ctx.resourceId
    ? snapshot.resources.find((r) => r.id === ctx.resourceId)
    : undefined;

  const activeDraft = ctx.examDraftId
    ? snapshot.drafts?.find((d) => d.id === ctx.examDraftId)
    : undefined;

  const activeExam = ctx.generatedExamId
    ? snapshot.mathExams.find((e) => e.id === ctx.generatedExamId)
    : undefined;

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
  const sourceStatus: ConnectedWorkflowStageStatus = activeResource
    ? 'completed'
    : snapshot.resources.length > 0 && (activeDraft || activeExam)
    ? 'completed'
    : snapshot.resources.length > 0
    ? 'in-progress'
    : 'not-started';

  const sourceDetail = activeResource
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

  const generateStatus: ConnectedWorkflowStageStatus = !hasGeneratedDraftOrExam
    ? 'not-started'
    : selectedCount === 0
    ? 'in-progress'
    : 'completed';
  const generateDetail = activeDraft
    ? `${activeDraft.title} (${activeDraft.items.length} câu)`
    : activeExam
    ? `${activeExam.title} (${activeExam.questions.length} câu)`
    : ctx.examDraftTitle || ctx.generatedExamTitle || 'Chưa tạo đề nháp';

  // 4. Duyệt (Strict: NEVER Completed if unconfirmed or BLOCKED!)
  let reviewStatus: ConnectedWorkflowStageStatus = 'not-started';
  let reviewDetail = 'Chờ tạo đề để duyệt đáp án';

  if (activeDraft) {
    const total = activeDraft.items.length;
    const confirmed = activeDraft.items.filter(
      (it) => it.teacherConfirmed && it.question.answerConfirmed
    ).length;
    if (draftBlockedCount > 0) {
      reviewStatus = 'blocked';
      reviewDetail = `${draftBlockedCount} câu bị BLOCKED — cần xử lý trước khi xuất`;
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
    const blocked = activeExam.questions.filter(
      (q) => q.sourceVerification?.verificationStatus === 'BLOCKED'
    ).length;
    if (blocked > 0) {
      reviewStatus = 'blocked';
      reviewDetail = `${blocked} câu đang BLOCKED trong đề gốc`;
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
    : ctx.examVersionCodes;
  const mixStatus: ConnectedWorkflowStageStatus =
    reviewStatus === 'blocked' && versionCodes.length === 0
      ? 'blocked'
      : versionCodes.length > 0
      ? 'completed'
      : activeExam
      ? 'in-progress'
      : 'not-started';
  const mixDetail =
    versionCodes.length > 0
      ? `Đã tạo ${versionCodes.length} mã đề (${versionCodes.slice(0, 4).join(', ')})`
      : activeExam
      ? 'Đề đã mở trong Exam Mixer — chưa tạo mã đề'
      : 'Chưa chuyển sang Exam Mixer Pro';

  // 6. In / Xuất theo mẫu
  const printStatus: ConnectedWorkflowStageStatus = ctx.printedAt
    ? 'completed'
    : versionCodes.length > 0 || activeExam
    ? 'in-progress'
    : 'not-started';
  const printDetail = ctx.printedAt
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
    gradedCount > 0 && pendingReviewSheets === 0
      ? 'completed'
      : gradedCount > 0 && pendingReviewSheets > 0
      ? 'needs-review'
      : activeSession || ctx.gradingSessionId
      ? 'in-progress'
      : 'not-started';
  const gradeDetail =
    gradedCount > 0
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

/**
 * Gợi ý bước tiếp theo trên Trang chủ dựa 100% trên trạng thái dữ liệu thực trong IndexedDB
 * (Section 10 — Không dùng AI đoán hành vi).
 */
export function computeDashboardNextSteps(
  ctx: ConnectedWorkflowContext,
  snapshot: WorkflowEvaluationSnapshot
): DashboardNextStepSuggestion[] {
  const suggestions: DashboardNextStepSuggestion[] = [];

  // 1. Có đề vừa trộn mã đề -> gợi ý In đề hoặc Tạo phiếu OMR
  const latestMixedExam =
    (ctx.generatedExamId
      ? snapshot.mathExams.find(
          (e) => e.id === ctx.generatedExamId && e.generatedVersions.length > 0
        )
      : undefined) ??
    snapshot.mathExams.find((e) => e.generatedVersions.length > 0);

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
    (e) => e.questions.length > 0 && e.generatedVersions.length === 0
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
          ? 'Bước tiếp theo: Mở Exam Mixer Pro để kiểm tra và xác nhận đáp án gốc trước khi trộn.'
          : 'Bước tiếp theo: Trộn thành 4 mã đề chuẩn với ánh xạ đáp án tự động.',
      badgeText: unconfirmed > 0 ? 'Cần duyệt đáp án' : 'Sẵn sàng trộn',
      primaryActionLabel: 'Mở Exam Mixer Pro',
      targetApp: 'math-mixer',
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
      examId: pendingSession.examId,
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

/**
 * Universal Command Bar Parser (Section 9) — 100% Local-First rule-based parser.
 * Phân tách rõ 2 nhóm: Workflow Commands (cần xác nhận khi thay đổi/khởi tạo dữ liệu)
 * và Navigation Commands. Tuyệt đối KHÔNG thực hiện thao tác xóa/xuất bản/gửi ngoài từ lệnh mơ hồ.
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

  const activeExam =
    (params.ctx.generatedExamId
      ? params.mathExams.find((e) => e.id === params.ctx.generatedExamId)
      : undefined) ?? params.mathExams[0];

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
          promptText:
            'Tạo cho tôi một đề kiểm tra Toán 12 giữa học kỳ 1, thời gian 45 phút, gồm 4 câu trắc nghiệm, 2 câu đúng sai và 2 câu trả lời ngắn. Lấy câu hỏi từ thư mục Toán 12 trong Resource Vault. Ưu tiên chương Hàm số và Đạo hàm. Những câu toán phù hợp hãy đổi số để tạo câu mới, tính lại đáp án.',
        },
      },
      {
        id: 'wf-sample-bank-hamso',
        category: 'navigation',
        intent: 'open-bank-topic',
        title: 'Mở ngân hàng câu hỏi chương Hàm số',
        subtitle: 'Mở tab Ngân hàng câu hỏi trong Smart Exam Generator và lọc sẵn từ khóa "Hàm số"',
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
          ? `Mở Exam Mixer Pro với đề đang chọn và thiết lập 4 mã đề (101–104)`
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

  // Từ chối an toàn các câu lệnh phá hủy / gửi dữ liệu ngoài (Section 9)
  if (
    /\b(xoa\s+het|xoa\s+toan\s+bo|reset|format|xuat\s+ban\s+cong\s+khai|gui\s+len|upload\s+toan\s+bo)\b/.test(
      norm
    )
  ) {
    return [];
  }

  // 1. Lệnh: "Tạo đề ..." / "Soạn đề ..." / "Sinh đề ..."
  if (/\b(tao|sinh|lap|soan)\s+(de|bai\s+kiem\s+tra)\b/.test(norm)) {
    const matchedRes = params.resources.find((r) => {
      const rNorm = normalizeVietnameseText(
        `${r.title} ${r.sourceFile?.relativePath ?? ''} ${r.chapterTopic ?? ''}`
      );
      return (
        (norm.includes('toan 12') && rNorm.includes('toan 12')) ||
        (norm.includes('ham so') && rNorm.includes('ham so')) ||
        (norm.includes('dao ham') && rNorm.includes('dao ham'))
      );
    });
    commands.push({
      id: 'wf-cmd-nl-generate',
      category: 'workflow',
      intent: 'nl-generate-exam',
      title: `Tạo đề từ yêu cầu: "${trimmed}"`,
      subtitle:
        'Chuyển thẳng vào Natural Language Exam Builder để phân tích cấu hình & xác nhận trước khi tạo đề',
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
  if (/\b(tron\s+de|tao\s+\d+\s+ma\s+de|ma\s+de)\b/.test(norm)) {
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
      },
    });
  }

  // 4. Lệnh: "Tạo phiếu trả lời / OMR cho lớp 12A2"
  if (/\b(phieu\s+tra\s+loi|phieu\s+omr|phieu\s+cham|tao\s+phieu)\b/.test(norm)) {
    const classMatch = trimmed.match(/lớp\s+([0-9]{1,2}[A-Za-z0-9]{1,4})/i) ??
      trimmed.match(/\b([0-9]{1,2}[A-Za-z][0-9]{1,2})\b/);
    const className = classMatch?.[1]?.toUpperCase();
    commands.push({
      id: 'wf-cmd-omr-sheet',
      category: 'workflow',
      intent: 'create-omr-sheet',
      title: className
        ? `Tạo phiếu trả lời OMR cho lớp ${className}`
        : 'Tạo phiếu trả lời OMR chuẩn',
      subtitle: activeExam
        ? `Gắn trực tiếp với đề "${activeExam.title}" trong Smart Grading Studio`
        : 'Mở công cụ tạo phiếu OMR trong Smart Grading Studio',
      badgeText: 'Lệnh quy trình',
      targetApp: 'grading-studio',
      requiresConfirmation: true,
      confirmationTitle: className
        ? `Tạo phiếu OMR cho lớp ${className}?`
        : 'Mở trình tạo phiếu trả lời OMR?',
      confirmationDescription: activeExam
        ? `Smart Grading Studio sẽ mở sẵn đề "${activeExam.title}"${className ? ` và điền lớp ${className}` : ''} để bạn kiểm tra và in phiếu.`
        : 'Mở Smart Grading Studio ở mục Tạo phiếu OMR.',
      payload: {
        rawCommand: trimmed,
        examId: activeExam?.id,
        className,
        gradingTab: 'sheet-gen',
      },
    });
  }

  // 5. Lệnh: "Mở kết quả chấm bài gần nhất" / "Xem bảng điểm"
  if (/\b(ket\s+qua\s+cham|bang\s+diem|cham\s+bai\s+gan\s+nhat)\b/.test(norm)) {
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

  // 7. Lệnh: "Xuất đề theo mẫu ..." / "In đề ..."
  if (
    !/\bazota\b/.test(norm) &&
    /\b(xuat\s+de|in\s+de|mau\s+de|mau\s+giua\s+hoc\s+ky|mau\s+cuoi\s+hoc\s+ky)\b/.test(norm)
  ) {
    const formMatch = trimmed.match(/(?:theo\s*)?mẫu\s+([^.,;!?]+)/i);
    const formLabel = formMatch?.[1]
      ? `Mẫu ${formMatch[1].trim()}`
      : 'Mẫu đề kiểm tra chuẩn';
    commands.push({
      id: 'wf-cmd-print-exam',
      category: 'workflow',
      intent: 'print-exam-form',
      title: activeExam
        ? `Xuất/In "${activeExam.title}" (${formLabel})`
        : `Mở Print Studio · ${formLabel}`,
      subtitle: 'Mở Print Studio ở chế độ Đề kiểm tra A4 và giữ nguyên đề hiện tại',
      badgeText: 'Lệnh quy trình',
      targetApp: 'print-studio',
      requiresConfirmation: true,
      confirmationTitle: `Mở Print Studio với ${formLabel}?`,
      confirmationDescription: activeExam
        ? `Đề "${activeExam.title}" sẽ mở sẵn trong Print Studio để bạn kiểm tra trang in A4 trước khi tải DOCX hoặc in PDF.`
        : 'Mở Print Studio để chọn đề kiểm tra cần in.',
      payload: {
        rawCommand: trimmed,
        examId: activeExam?.id,
        formLabel,
      },
    });
  }

  return commands;
}

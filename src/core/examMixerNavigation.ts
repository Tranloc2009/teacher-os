import type {
  MathExamProject,
  MathExamStep,
  MathIntegrityIssue,
} from '../types/mathExam';
import { auditOriginalExamIntegrity } from './mathIntegrity';

export interface StepTransitionCheckResult {
  allowed: boolean;
  reasonCode:
    | 'ok'
    | 'no-exam'
    | 'no-questions'
    | 'integrity-blocked'
    | 'answers-unconfirmed';
  title: string;
  message: string;
  blockingIssues: MathIntegrityIssue[];
  firstBlockingQuestionId: string | null;
}

export interface PreferredExamTarget {
  requestId?: number;
  examId?: string | null;
  step?: MathExamStep | null;
  step2SubView?: 'editor' | 'import-doctor' | 'answer-studio' | null;
  examCode?: string | null;
}

export type ExamMixerNavigationRequest = PreferredExamTarget & { requestId: number };

export interface PreferredTargetResolution {
  action: 'noop' | 'apply' | 'missing-exam';
  targetKey: string | null;
  selectedExamId?: string;
  nextStep?: MathExamStep;
  nextStep2Tab?: 'editor' | 'import-doctor' | 'answer-studio';
  nextSelectedCodeTab?: string;
  nextStep4ViewMode?: 'compare' | 'compare-codes' | 'answer-matrix';
  missingExamId?: string | null;
  missingCodeNotice?: string | null;
  shouldClearPreferredTarget: boolean;
}

/**
 * Cổng kiểm tra chuyển từ Bước 2 (hoặc Bước 1) sang Bước 3 — Trộn mã đề.
 * TUYỆT ĐỐI giữ nguyên Integrity Gate: không cho bỏ qua lỗi thiếu khóa, công thức,
 * phương án rỗng, hình ảnh hỏng hoặc chưa xác nhận đáp án gốc.
 * Khi bị chặn, luôn trả về thông báo tiếng Việt cụ thể kèm danh sách câu/trường cần sửa.
 */
export function evaluateStep2ToStep3Transition(
  exam: MathExamProject | null
): StepTransitionCheckResult {
  if (!exam) {
    return {
      allowed: false,
      reasonCode: 'no-exam',
      title: 'Chưa chọn đề kiểm tra',
      message: 'Vui lòng tạo mới hoặc chọn một đề kiểm tra trước khi chuyển sang Bước 3.',
      blockingIssues: [],
      firstBlockingQuestionId: null,
    };
  }

  if (exam.questions.length === 0) {
    return {
      allowed: false,
      reasonCode: 'no-questions',
      title: 'Đề gốc chưa có câu hỏi',
      message:
        'Đề hiện chưa có câu hỏi nào. Hãy nhập tệp DOCX hoặc thêm câu hỏi ở Bước 1 trước khi trộn mã đề.',
      blockingIssues: [],
      firstBlockingQuestionId: null,
    };
  }

  const issues = auditOriginalExamIntegrity(exam);
  const blockingIssues = issues.filter((issue) => issue.severity === 'error');
  if (blockingIssues.length > 0) {
    const first = blockingIssues[0];
    const summaryList = blockingIssues
      .slice(0, 3)
      .map((i) => i.message)
      .join(' • ');
    const moreSuffix =
      blockingIssues.length > 3
        ? ` (và còn ${blockingIssues.length - 3} lỗi khác trong báo cáo Kiểm tra toàn vẹn)`
        : '';

    return {
      allowed: false,
      reasonCode: 'integrity-blocked',
      title: `Chưa thể sang Bước 3: còn ${blockingIssues.length} lỗi toàn vẹn cần sửa`,
      message: `${summaryList}${moreSuffix}`,
      blockingIssues,
      firstBlockingQuestionId: first.questionId ?? null,
    };
  }

  if (!exam.confirmedOriginalAnswers) {
    return {
      allowed: false,
      reasonCode: 'answers-unconfirmed',
      title: 'Chưa xác nhận toàn bộ đáp án gốc ở Bước 2',
      message:
        'Đề gốc đã hết lỗi toàn vẹn nhưng bạn chưa bấm nút "Xác nhận toàn bộ đáp án gốc" ở Bước 2. Vui lòng bấm xác nhận để khóa đáp án gốc trước khi chuyển sang Bước 3.',
      blockingIssues: [],
      firstBlockingQuestionId: null,
    };
  }

  return {
    allowed: true,
    reasonCode: 'ok',
    title: 'Đủ điều kiện chuyển sang Bước 3',
    message: 'Đề gốc hợp lệ và đã xác nhận đáp án.',
    blockingIssues: [],
    firstBlockingQuestionId: null,
  };
}

/**
 * Kiểm tra điều hướng giữa 5 bước của Exam Mixer Pro.
 * - Quay về Bước 1 hoặc Bước 2 luôn được phép (không làm mất dữ liệu đang nhập).
 * - Chuyển sang Bước 3 bắt buộc qua Integrity Gate + xác nhận đáp án gốc, kèm lý do rõ ràng nếu bị chặn.
 */
export function evaluateStepNavigationGuard(
  exam: MathExamProject | null,
  _currentStep: MathExamStep,
  targetStep: MathExamStep
): StepTransitionCheckResult {
  if (targetStep === 3) {
    return evaluateStep2ToStep3Transition(exam);
  }
  return {
    allowed: true,
    reasonCode: 'ok',
    title: 'Cho phép chuyển bước',
    message: '',
    blockingIssues: [],
    firstBlockingQuestionId: null,
  };
}

/**
 * Tạo khóa định danh cho một yêu cầu điều hướng từ bên ngoài vào Exam Mixer Pro.
 * Trả về null khi không có yêu cầu điều hướng nào đang chờ xử lý.
 */
export function buildPreferredTargetKey(
  target: PreferredExamTarget
): string | null {
  const hasAnyTarget =
    Boolean(target.examId) ||
    target.step !== null && target.step !== undefined ||
    Boolean(target.step2SubView) ||
    Boolean(target.examCode);

  if (!hasAnyTarget) {
    return null;
  }

  if (target.requestId !== undefined) {
    return String(target.requestId);
  }

  return [
    target.examId ?? '',
    target.step ?? '',
    target.step2SubView ?? '',
    target.examCode ?? '',
  ].join('|');
}

/**
 * Giải quyết yêu cầu điều hướng từ ngoài vào (Connected Workflow, Generator, Print, Grading)
 * theo cơ chế **chỉ áp dụng duy nhất 1 lần cho mỗi yêu cầu (one-shot)**.
 *
 * Ngăn triệt để lỗi: khi `mathExams` thay đổi sau lúc lưu/xác nhận đáp án ở Bước 2
 * hoặc chỉnh cấu hình ở Bước 3, effect KHÔNG BAO GIỜ ghi đè `step` quay ngược về Bước 2.
 */
export function resolvePreferredTargetNavigation(params: {
  target: PreferredExamTarget;
  lastConsumedTargetKey: string | null;
  mathExams: MathExamProject[];
  currentSelectedExamId: string;
}): PreferredTargetResolution {
  const { target, lastConsumedTargetKey, mathExams, currentSelectedExamId } = params;
  const targetKey = buildPreferredTargetKey(target);

  if (!targetKey) {
    return {
      action: 'noop',
      targetKey: null,
      shouldClearPreferredTarget: false,
    };
  }

  // Yêu cầu này đã được tiêu thụ trước đó -> bỏ qua hoàn toàn dù mathExams có cập nhật!
  if (lastConsumedTargetKey === targetKey) {
    return {
      action: 'noop',
      targetKey,
      shouldClearPreferredTarget: false,
    };
  }

  if (target.examId) {
    const exactExam = mathExams.find((e) => e.id === target.examId);
    if (!exactExam) {
      return {
        action: 'missing-exam',
        targetKey,
        missingExamId: target.examId,
        shouldClearPreferredTarget: false,
      };
    }

    let nextStep: MathExamStep = target.step ?? 2;
    let nextSelectedCodeTab: string | undefined;
    let nextStep4ViewMode: 'compare' | 'compare-codes' | 'answer-matrix' | undefined;
    let missingCodeNotice: string | null = null;

    if (target.examCode) {
      const hasCode = exactExam.generatedVersions.some((v) => v.code === target.examCode);
      if (hasCode) {
        nextSelectedCodeTab = target.examCode;
        nextStep = 4;
        nextStep4ViewMode = 'answer-matrix';
      } else {
        missingCodeNotice = `Mã đề ${target.examCode} chưa tồn tại trong "${exactExam.title}". Hãy trộn mã đề ở Bước 3 trước khi xem bảng đáp án mã ${target.examCode}.`;
      }
    }

    return {
      action: 'apply',
      targetKey,
      selectedExamId: exactExam.id,
      nextStep,
      nextStep2Tab: target.step2SubView ?? undefined,
      nextSelectedCodeTab,
      nextStep4ViewMode,
      missingExamId: null,
      missingCodeNotice,
      shouldClearPreferredTarget: true,
    };
  }

  // Không chỉ định examId cụ thể, chỉ điều hướng theo step / subView / examCode
  const currentExam =
    mathExams.find((e) => e.id === currentSelectedExamId) ?? mathExams[0] ?? null;

  let nextStep: MathExamStep | undefined = target.step ?? undefined;
  let nextSelectedCodeTab: string | undefined;
  let nextStep4ViewMode: 'compare' | 'compare-codes' | 'answer-matrix' | undefined;
  let missingCodeNotice: string | null = null;

  if (target.examCode) {
    if (currentExam?.generatedVersions.some((v) => v.code === target.examCode)) {
      nextSelectedCodeTab = target.examCode;
      nextStep = 4;
      nextStep4ViewMode = 'answer-matrix';
    } else {
      missingCodeNotice = `Không tìm thấy mã đề ${target.examCode} trong đề đang mở.`;
    }
  }

  return {
    action: 'apply',
    targetKey,
    nextStep,
    nextStep2Tab: target.step2SubView ?? undefined,
    nextSelectedCodeTab,
    nextStep4ViewMode,
    missingExamId: null,
    missingCodeNotice,
    shouldClearPreferredTarget: true,
  };
}

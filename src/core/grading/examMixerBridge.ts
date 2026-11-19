import type { MathExamProject, McqOptionLabel, MixedExamVersion } from '../../types/mathExam';
import type { ExamCodeAnswerKey, ExamCodeQuestionKey } from '../../types/grading';
import { getUniversalQuestionType } from '../subjectProfileRegistry';

const VALID_MCQ_LABELS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D']);

function normalizeMcqLabel(raw: string | undefined): McqOptionLabel | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toUpperCase();
  if (VALID_MCQ_LABELS.has(trimmed)) {
    return trimmed as McqOptionLabel;
  }
  return undefined;
}

/**
 * Trích xuất và kiểm chứng đáp án của một mã đề cụ thể từ Exam Mixer Pro.
 * QUY TẮC AN TOÀN:
 * - Luôn đọc đúng đáp án đã đảo phương án và đúng thứ tự câu của mã đề (KHÔNG dùng thứ tự đề gốc).
 * - Đối chiếu chéo giữa version.questions, version.permutationMap và version.answerKeyRows.
 * - Nếu sai lệch ánh xạ hoặc mã đề bị chặn toàn vẹn -> đánh dấu valid=false và chặn tự động chấm.
 */
export function extractExamCodeAnswerKey(
  exam: MathExamProject,
  version: MixedExamVersion
): ExamCodeAnswerKey {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];

  const versionIntegrityPassed =
    version.integrityPassed !== false && version.integrityStatus !== 'BLOCKED';

  if (!versionIntegrityPassed) {
    blockingErrors.push(
      `Mã đề ${version.code} chưa đạt kiểm chứng toàn vẹn trong Exam Mixer Pro (trạng thái: ${version.integrityStatus ?? 'BLOCKED'}).`
    );
  }

  if (!Array.isArray(version.questions) || version.questions.length === 0) {
    blockingErrors.push(`Mã đề ${version.code} không có danh sách câu hỏi.`);
  }

  if (
    version.permutationMap.length !== version.questions.length ||
    version.answerKeyRows.length !== version.questions.length
  ) {
    blockingErrors.push(
      `Mã đề ${version.code} lệch số lượng giữa câu hỏi (${version.questions.length}), bảng ánh xạ (${version.permutationMap.length}) và bảng đáp án (${version.answerKeyRows.length}).`
    );
  }

  const questions: ExamCodeQuestionKey[] = [];
  const mcqAnswerByOrder: Record<number, McqOptionLabel> = {};
  let autoGradableCount = 0;
  let unsupportedCount = 0;

  for (let i = 0; i < version.questions.length; i += 1) {
    const q = version.questions[i];
    const orderNumber = i + 1;
    const uType = getUniversalQuestionType(q);
    const mapEntry = version.permutationMap[i];
    const rowEntry = version.answerKeyRows[i];

    if (mapEntry && mapEntry.questionId !== q.id) {
      blockingErrors.push(
        `Câu ${orderNumber} (Mã đề ${version.code}): questionId không khớp với bảng ánh xạ (${q.id} ≠ ${mapEntry.questionId}).`
      );
    }
    if (rowEntry && rowEntry.questionId !== q.id) {
      blockingErrors.push(
        `Câu ${orderNumber} (Mã đề ${version.code}): questionId không khớp với bảng đáp án (${q.id} ≠ ${rowEntry.questionId}).`
      );
    }

    if (uType === 'mcq') {
      const options = q.options ?? [];
      if (options.length !== 4) {
        blockingErrors.push(
          `Câu ${orderNumber} (${q.code}, Mã đề ${version.code}): cần đúng 4 phương án A/B/C/D để chấm OMR (hiện có ${options.length}).`
        );
      }

      const correctIndex = options.findIndex(
        (opt) => opt.id === q.correctOptionId || opt.isCorrect
      );
      const labelFromShuffledOptions: McqOptionLabel | undefined =
        correctIndex >= 0 && correctIndex < 4
          ? (['A', 'B', 'C', 'D'][correctIndex] as McqOptionLabel)
          : undefined;

      const labelFromAnswerRow = normalizeMcqLabel(rowEntry?.answer);
      const labelFromPermutation = normalizeMcqLabel(mapEntry?.newCorrectLabel);

      if (!labelFromShuffledOptions) {
        blockingErrors.push(
          `Câu ${orderNumber} (${q.code}, Mã đề ${version.code}): không xác định được phương án đúng trong danh sách đã trộn.`
        );
      }

      if (
        labelFromShuffledOptions &&
        labelFromAnswerRow &&
        labelFromShuffledOptions !== labelFromAnswerRow
      ) {
        blockingErrors.push(
          `Câu ${orderNumber} (${q.code}, Mã đề ${version.code}): đáp án đã trộn (${labelFromShuffledOptions}) không khớp bảng đáp án (${labelFromAnswerRow}).`
        );
      }

      if (
        labelFromShuffledOptions &&
        labelFromPermutation &&
        labelFromShuffledOptions !== labelFromPermutation
      ) {
        blockingErrors.push(
          `Câu ${orderNumber} (${q.code}, Mã đề ${version.code}): đáp án đã trộn (${labelFromShuffledOptions}) không khớp bảng ánh xạ (${labelFromPermutation}).`
        );
      }

      const resolvedChoice = labelFromShuffledOptions ?? labelFromAnswerRow;
      if (resolvedChoice) {
        mcqAnswerByOrder[orderNumber] = resolvedChoice;
        autoGradableCount += 1;
      }

      questions.push({
        orderNumber,
        questionId: q.id,
        originalCode: q.code,
        universalType: uType,
        autoGradable: true,
        correctChoice: resolvedChoice,
        points: Number.isFinite(q.points) && q.points > 0 ? q.points : 1,
      });
    } else {
      unsupportedCount += 1;
      questions.push({
        orderNumber,
        questionId: q.id,
        originalCode: q.code,
        universalType: uType,
        autoGradable: false,
        points: Number.isFinite(q.points) && q.points > 0 ? q.points : 1,
        unsupportedReason:
          'Giai đoạn 1 chỉ chấm OMR tự động cho câu trắc nghiệm 1 đáp án (A/B/C/D). Dạng câu này không chấm tự động.',
      });
    }
  }

  if (autoGradableCount === 0) {
    blockingErrors.push(
      `Mã đề ${version.code} không có câu trắc nghiệm 1 đáp án (A/B/C/D) nào để chấm OMR tự động.`
    );
  }

  if (unsupportedCount > 0) {
    warnings.push(
      `Mã đề ${version.code} có ${unsupportedCount} câu không phải trắc nghiệm 1 đáp án (Đúng/Sai, Trả lời ngắn hoặc Tự luận); hệ thống chỉ tự chấm ${autoGradableCount} câu trắc nghiệm A/B/C/D.`
    );
  }

  return {
    examId: exam.id,
    examTitle: exam.title,
    examCode: version.code,
    versionIntegrityPassed,
    valid: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    totalQuestions: version.questions.length,
    autoGradableCount,
    unsupportedCount,
    questions,
    mcqAnswerByOrder,
  };
}

/**
 * Xây dựng bản đồ đáp án cho toàn bộ các mã đề đã tạo của một dự án Exam Mixer Pro.
 */
export function buildExamAnswerKeyMap(
  exam: MathExamProject,
  filterCodes?: string[]
): Record<string, ExamCodeAnswerKey> {
  const allowed =
    filterCodes && filterCodes.length > 0 ? new Set(filterCodes) : null;
  const result: Record<string, ExamCodeAnswerKey> = {};

  for (const version of exam.generatedVersions ?? []) {
    if (allowed && !allowed.has(version.code)) continue;
    result[version.code] = extractExamCodeAnswerKey(exam, version);
  }
  return result;
}

/**
 * Lấy danh sách đề từ Exam Mixer đã có ít nhất 1 mã đề được sinh ra.
 */
export function listGradableExams(exams: MathExamProject[]): MathExamProject[] {
  return exams.filter(
    (exam) => Array.isArray(exam.generatedVersions) && exam.generatedVersions.length > 0
  );
}

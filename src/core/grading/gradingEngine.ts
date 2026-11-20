import type {
  ExamCodeAnswerKey,
  GradedSheetRecord,
  GradingDashboardMetrics,
  GradingRuleConfig,
  ManualOverrideAuditEntry,
  OmrBubbleChoice,
  QuestionGradingResult,
  RoundingRule,
  SheetGradingStatus,
  StudentMatchStatus,
  StudentRecord,
} from '../../types/grading';
import type { OmrRecognitionResult } from './omrVisionEngine';

/**
 * Làm tròn điểm minh bạch theo đúng quy tắc giáo viên chọn.
 */
export function applyScoreRounding(rawScore: number, rule: RoundingRule): number {
  if (!Number.isFinite(rawScore) || rawScore <= 0) return 0;
  switch (rule) {
    case 'none':
      return Math.round(rawScore * 10000) / 10000;
    case '0.01':
      return Math.round(rawScore * 100) / 100;
    case '0.1':
      return Math.round(rawScore * 10) / 10;
    case '0.25':
      return Math.round(rawScore * 4) / 4;
    case '0.5':
      return Math.round(rawScore * 2) / 2;
  }
}

export function formatRoundingRuleLabel(rule: RoundingRule): string {
  switch (rule) {
    case 'none':
      return 'Không làm tròn';
    case '0.01':
      return 'Làm tròn 0.01';
    case '0.1':
      return 'Làm tròn 0.1';
    case '0.25':
      return 'Làm tròn 0.25';
    case '0.5':
      return 'Làm tròn 0.5';
  }
}

/**
 * Đối chiếu học sinh theo khóa chính studentId (KHÔNG dùng họ tên làm khóa chính).
 * Hỗ trợ nhiều học sinh trùng họ tên nhưng khác mã học sinh.
 */
export function matchStudentById(
  rawStudentId: string | undefined,
  students: StudentRecord[]
): StudentMatchStatus {
  const cleanId = (rawStudentId ?? '').trim();
  if (!cleanId) {
    return {
      matched: false,
      studentId: '',
      studentName: '',
      className: '',
      warning: 'Chưa xác định Mã học sinh. Vui lòng chọn học sinh từ danh sách lớp.',
    };
  }

  const normalized = cleanId.toUpperCase();
  const found = students.find(
    (s) => s.studentId.trim().toUpperCase() === normalized
  );
  if (!found) {
    return {
      matched: false,
      studentId: cleanId,
      studentName: '',
      className: '',
      warning: `Mã học sinh "${cleanId}" không tồn tại trong danh sách lớp. Vui lòng kiểm tra hoặc gán lại.`,
    };
  }

  return {
    matched: true,
    studentId: found.studentId,
    studentName: found.fullName,
    className: found.className,
  };
}

/**
 * Chấm điểm từ kết quả nhận diện OMR + đáp án ĐÃ TRỘN của đúng mã đề.
 * Không bao giờ dùng đáp án thứ tự đề gốc!
 */
export function gradeRecognizedSheet(params: {
  sheetId: string;
  sessionId: string;
  fileName: string;
  uploadedAt?: string;
  originalBlobId: string;
  thumbnailDataUrl?: string;
  recognition: OmrRecognitionResult;
  answerKeysByCode: Record<string, ExamCodeAnswerKey>;
  students: StudentRecord[];
  gradingRule: GradingRuleConfig;
  fallbackExamCode?: string;
  manualExamCode?: string;
  manualStudentId?: string;
  existingOverrides?: Record<number, { value: OmrBubbleChoice | null; history: ManualOverrideAuditEntry[] }>;
  confirmedByTeacher?: boolean;
  confirmedAt?: string;
  manualViewRotationDeg?: 0 | 90 | 180 | 270;
  notes?: string;
}): GradedSheetRecord {
  const now = new Date().toISOString();
  const { recognition, answerKeysByCode, students, gradingRule } = params;
  const opticalPayload = recognition.alignment.opticalCodePayload;

  // Xác định mã đề: ưu tiên giáo viên chọn thủ công -> mã quang học đọc được -> mã mặc định (nếu có)
  let examCode = '';
  let examCodeSource: GradedSheetRecord['examCodeSource'] = 'default';
  if (params.manualExamCode && params.manualExamCode.trim()) {
    examCode = params.manualExamCode.trim();
    examCodeSource = 'manual';
  } else if (opticalPayload?.ec) {
    examCode = opticalPayload.ec.trim();
    examCodeSource = 'optical-code';
  } else if (params.fallbackExamCode && params.fallbackExamCode.trim()) {
    examCode = params.fallbackExamCode.trim();
    examCodeSource = 'default';
  }

  const rawStudentId =
    params.manualStudentId !== undefined
      ? params.manualStudentId
      : opticalPayload?.st ?? '';
  const studentMatch = matchStudentById(rawStudentId, students);

  const answerKey = examCode ? answerKeysByCode[examCode] : undefined;
  const keyValid = Boolean(answerKey && answerKey.valid);

  // Tính trọng số từng câu tự động chấm
  const autoGradableQuestions =
    answerKey?.questions.filter((q) => q.autoGradable) ?? [];
  const totalExamPoints = autoGradableQuestions.reduce(
    (sum, q) => sum + (q.points > 0 ? q.points : 1),
    0
  );
  const autoGradableCount = autoGradableQuestions.length;

  const questionResults: QuestionGradingResult[] = [];
  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;
  let uncertainCount = 0;
  let unsupportedCount = 0;
  let earnedWeight = 0;
  let totalWeight = 0;

  for (const rec of recognition.questions) {
    const keyItem = answerKey?.questions.find(
      (k) => k.orderNumber === rec.questionNumber
    );
    const override = params.existingOverrides?.[rec.questionNumber];
    const manuallyOverridden = Boolean(override && override.history.length > 0);
    const effectiveChoice = manuallyOverridden
      ? override!.value
      : rec.recognizedChoice;

    if (keyItem && !keyItem.autoGradable) {
      unsupportedCount += 1;
      questionResults.push({
        questionNumber: rec.questionNumber,
        autoGradable: false,
        unsupportedReason: keyItem.unsupportedReason,
        recognizedChoice: rec.recognizedChoice,
        recognizedStatus: rec.recognizedStatus,
        effectiveChoice: null,
        correctChoice: null,
        isCorrect: false,
        isBlank: true,
        pointsEarned: 0,
        maxPoints: 0,
        confidence: rec.confidence,
        optionMetrics: rec.optionMetrics,
        needsReview: false,
        reviewReasons: [],
        manuallyOverridden: false,
        overrideHistory: [],
      });
      continue;
    }

    const qWeight =
      gradingRule.useExamQuestionPoints && keyItem
        ? keyItem.points
        : 1;
    const maxPoints =
      autoGradableCount > 0 && keyValid
        ? gradingRule.useExamQuestionPoints && totalExamPoints > 0
          ? (qWeight / totalExamPoints) * gradingRule.maxScore
          : gradingRule.maxScore / autoGradableCount
        : 0;

    if (keyValid && keyItem?.autoGradable) {
      totalWeight += qWeight;
    }

    const correctChoice = keyValid && keyItem?.correctChoice ? keyItem.correctChoice : null;
    const isUnresolvedAmbiguous =
      !manuallyOverridden &&
      (rec.recognizedStatus === 'multiple' ||
        rec.recognizedStatus === 'uncertain' ||
        rec.recognizedStatus === 'unreadable');

    const isBlank = !isUnresolvedAmbiguous && effectiveChoice === null;
    const isCorrect =
      !isUnresolvedAmbiguous &&
      correctChoice !== null &&
      effectiveChoice !== null &&
      effectiveChoice === correctChoice;

    let pointsEarned = 0;
    if (keyValid && keyItem?.autoGradable) {
      if (isUnresolvedAmbiguous) {
        uncertainCount += 1;
      } else if (isBlank) {
        blankCount += 1;
      } else if (isCorrect) {
        correctCount += 1;
        earnedWeight += qWeight;
        pointsEarned = maxPoints;
      } else {
        wrongCount += 1;
      }
    } else if (isUnresolvedAmbiguous) {
      uncertainCount += 1;
    } else if (isBlank) {
      blankCount += 1;
    }

    questionResults.push({
      questionNumber: rec.questionNumber,
      autoGradable: keyItem ? keyItem.autoGradable : true,
      recognizedChoice: rec.recognizedChoice,
      recognizedStatus: rec.recognizedStatus,
      effectiveChoice,
      correctChoice,
      isCorrect,
      isBlank,
      pointsEarned: Math.round(pointsEarned * 1000) / 1000,
      maxPoints: Math.round(maxPoints * 1000) / 1000,
      confidence: rec.confidence,
      optionMetrics: rec.optionMetrics,
      needsReview: isUnresolvedAmbiguous,
      reviewReasons: isUnresolvedAmbiguous ? rec.reviewReasons : [],
      manuallyOverridden,
      overrideHistory: override?.history ?? [],
    });
  }

  const rawScore =
    keyValid && totalWeight > 0
      ? (earnedWeight / totalWeight) * gradingRule.maxScore
      : 0;
  const finalScore = keyValid
    ? applyScoreRounding(rawScore, gradingRule.rounding)
    : 0;

  const perQPoints =
    autoGradableCount > 0 ? gradingRule.maxScore / autoGradableCount : 0;
  const scoreFormulaText = !answerKey
    ? `Chưa khớp mã đề "${examCode || '(trống)'}" trong đề đã trộn.`
    : !answerKey.valid
    ? `Bị chặn chấm tự động: ${answerKey.blockingErrors[0] ?? 'Đáp án mã đề không hợp lệ.'}`
    : gradingRule.useExamQuestionPoints
    ? `${correctCount}/${autoGradableCount} câu (trọng số ${earnedWeight.toFixed(2)}/${totalWeight.toFixed(2)}) × ${gradingRule.maxScore} = ${rawScore.toFixed(3)} → ${finalScore} (${formatRoundingRuleLabel(gradingRule.rounding)})`
    : `${correctCount}/${autoGradableCount} câu × ${perQPoints.toFixed(3)}đ = ${rawScore.toFixed(3)} → ${finalScore}/${gradingRule.maxScore} (${formatRoundingRuleLabel(gradingRule.rounding)})`;

  // Xác định trạng thái trung thực: không bao giờ tự đánh dấu hoàn tất khi còn lỗi/mờ/thiếu mã đề/chưa khớp HS
  let status: SheetGradingStatus;
  const hasBlockingError = !recognition.alignment.aligned || !keyValid;
  const hasReviewIssue =
    uncertainCount > 0 ||
    recognition.alignment.lowSharpness ||
    !studentMatch.matched ||
    recognition.alignment.opticalCodeStatus === 'corrupted';

  if (params.confirmedByTeacher && !hasBlockingError && studentMatch.matched) {
    status = 'confirmed';
  } else if (hasBlockingError) {
    status = 'error';
  } else if (hasReviewIssue) {
    status = 'review-required';
  } else {
    status = 'auto-graded';
  }

  return {
    id: params.sheetId,
    sessionId: params.sessionId,
    fileName: params.fileName,
    uploadedAt: params.uploadedAt ?? now,
    examCode,
    examCodeSource,
    studentId: studentMatch.studentId,
    studentName: studentMatch.studentName,
    className: studentMatch.className,
    studentMatch,
    originalBlobId: params.originalBlobId,
    thumbnailDataUrl: params.thumbnailDataUrl,
    imageWidth: recognition.rotatedWidth,
    imageHeight: recognition.rotatedHeight,
    manualViewRotationDeg: params.manualViewRotationDeg ?? 0,
    status,
    confirmedByTeacher: status === 'confirmed',
    confirmedAt: status === 'confirmed' ? params.confirmedAt ?? now : undefined,
    alignment: recognition.alignment,
    questions: questionResults,
    correctCount,
    wrongCount,
    blankCount,
    uncertainCount,
    unsupportedCount,
    rawScore: Math.round(rawScore * 10000) / 10000,
    finalScore,
    maxScore: gradingRule.maxScore,
    scoreFormulaText,
    notes: params.notes,
    updatedAt: now,
  };
}

/**
 * Áp dụng chỉnh sửa thủ công cho 1 câu hỏi của bài làm.
 * - Lưu đầy đủ audit trail (giá trị gốc OMR, giá trị giáo viên chốt, thời điểm, lý do).
 * - TUYỆT ĐỐI KHÔNG làm thay đổi đáp án gốc của mã đề.
 */
export function overrideSheetQuestion(
  sheet: GradedSheetRecord,
  questionNumber: number,
  newValue: OmrBubbleChoice | null,
  reason: string | undefined,
  answerKeysByCode: Record<string, ExamCodeAnswerKey>,
  students: StudentRecord[],
  gradingRule: GradingRuleConfig
): GradedSheetRecord {
  const editedAt = new Date().toISOString();
  const overrides: Record<
    number,
    { value: OmrBubbleChoice | null; history: ManualOverrideAuditEntry[] }
  > = {};

  for (const q of sheet.questions) {
    if (q.questionNumber === questionNumber) {
      const entry: ManualOverrideAuditEntry = {
        questionNumber,
        originalRecognized: q.recognizedChoice,
        originalStatus: q.recognizedStatus,
        confirmedValue: newValue,
        editedAt,
        reason: reason?.trim() || undefined,
      };
      overrides[q.questionNumber] = {
        value: newValue,
        history: [...q.overrideHistory, entry],
      };
    } else if (q.manuallyOverridden) {
      overrides[q.questionNumber] = {
        value: q.effectiveChoice,
        history: q.overrideHistory,
      };
    }
  }

  return recalculateSheetRecord(
    sheet,
    answerKeysByCode,
    students,
    gradingRule,
    { overrides, resetConfirmation: true }
  );
}

/**
 * Tính lại toàn bộ điểm và trạng thái của 1 phiếu (khi đổi mã đề, đổi học sinh, đổi quy tắc làm tròn hoặc sửa đáp án).
 */
export function recalculateSheetRecord(
  sheet: GradedSheetRecord,
  answerKeysByCode: Record<string, ExamCodeAnswerKey>,
  students: StudentRecord[],
  gradingRule: GradingRuleConfig,
  options?: {
    manualExamCode?: string;
    manualStudentId?: string;
    overrides?: Record<
      number,
      { value: OmrBubbleChoice | null; history: ManualOverrideAuditEntry[] }
    >;
    confirmedByTeacher?: boolean;
    resetConfirmation?: boolean;
    manualViewRotationDeg?: 0 | 90 | 180 | 270;
    notes?: string;
  }
): GradedSheetRecord {
  const existingOverrides =
    options?.overrides ??
    Object.fromEntries(
      sheet.questions
        .filter((q) => q.manuallyOverridden)
        .map((q) => [
          q.questionNumber,
          { value: q.effectiveChoice, history: q.overrideHistory },
        ])
    );

  const syntheticRecognition: OmrRecognitionResult = {
    alignment: sheet.alignment,
    rotatedWidth: sheet.imageWidth,
    rotatedHeight: sheet.imageHeight,
    questions: sheet.questions.map((q) => ({
      questionNumber: q.questionNumber,
      recognizedChoice: q.recognizedChoice,
      recognizedStatus: q.recognizedStatus,
      confidence: q.confidence,
      optionMetrics: q.optionMetrics,
      needsReview:
        q.recognizedStatus === 'multiple' ||
        q.recognizedStatus === 'uncertain' ||
        q.recognizedStatus === 'unreadable',
      reviewReasons: q.reviewReasons,
    })),
  };

  const confirmedByTeacher = options?.resetConfirmation
    ? false
    : options?.confirmedByTeacher ?? sheet.confirmedByTeacher;

  const updated = gradeRecognizedSheet({
    sheetId: sheet.id,
    sessionId: sheet.sessionId,
    fileName: sheet.fileName,
    uploadedAt: sheet.uploadedAt,
    originalBlobId: sheet.originalBlobId,
    thumbnailDataUrl: sheet.thumbnailDataUrl,
    recognition: syntheticRecognition,
    answerKeysByCode,
    students,
    gradingRule,
    manualExamCode:
      options?.manualExamCode !== undefined
        ? options.manualExamCode
        : sheet.examCodeSource === 'manual'
        ? sheet.examCode
        : undefined,
    fallbackExamCode:
      sheet.examCodeSource === 'default' ? sheet.examCode : undefined,
    manualStudentId:
      options?.manualStudentId !== undefined
        ? options.manualStudentId
        : sheet.studentId,
    existingOverrides,
    confirmedByTeacher,
    confirmedAt: confirmedByTeacher ? sheet.confirmedAt : undefined,
    manualViewRotationDeg:
      options?.manualViewRotationDeg ?? sheet.manualViewRotationDeg,
    notes: options?.notes !== undefined ? options.notes : sheet.notes,
  });

  return {
    ...updated,
    annotatedBlobId: sheet.annotatedBlobId,
    imageDHash: sheet.imageDHash,
    captureSource: sheet.captureSource,
    retakeRequested: sheet.retakeRequested,
    archivedByDuplicateResolution: sheet.archivedByDuplicateResolution,
    replacedBySheetId: sheet.replacedBySheetId,
  };
}

/**
 * Phát hiện nhiều phiếu cùng gắn một studentId trong phiên chấm (cảnh báo minh bạch, không ghi đè âm thầm).
 */
export function annotateDuplicateStudentWarnings(
  sheets: GradedSheetRecord[]
): GradedSheetRecord[] {
  const counts = new Map<string, number>();
  for (const s of sheets) {
    if (s.archivedByDuplicateResolution) continue;
    const key = s.studentId.trim().toUpperCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return sheets.map((s) => {
    if (s.archivedByDuplicateResolution) {
      if (!s.duplicateStudentWarning) return s;
      const cleaned = { ...s };
      delete cleaned.duplicateStudentWarning;
      return cleaned;
    }
    const key = s.studentId.trim().toUpperCase();
    const count = key ? counts.get(key) ?? 0 : 0;
    if (count > 1) {
      return {
        ...s,
        duplicateStudentWarning: `Phát hiện ${count} phiếu cùng gắn Mã học sinh "${s.studentId}". Vui lòng kiểm tra để tránh chấm trùng.`,
      };
    }
    if (s.duplicateStudentWarning) {
      const next = { ...s };
      delete next.duplicateStudentWarning;
      return next;
    }
    return s;
  });
}

/**
 * Tính toán chỉ số Dashboard hoàn toàn từ dữ liệu chấm thực tế (KHÔNG số giả).
 */
export function computeGradingDashboardMetrics(
  sheets: GradedSheetRecord[],
  maxScore = 10
): GradingDashboardMetrics {
  const activeSheets = sheets.filter((s) => !s.archivedByDuplicateResolution);
  const totalSheets = activeSheets.length;
  let autoGradedCount = 0;
  let reviewRequiredCount = 0;
  let confirmedCount = 0;
  let errorCount = 0;

  const validScores: number[] = [];

  for (const s of activeSheets) {
    if (s.status === 'confirmed') confirmedCount += 1;
    else if (s.status === 'auto-graded') autoGradedCount += 1;
    else if (s.status === 'review-required') reviewRequiredCount += 1;
    else if (s.status === 'error') errorCount += 1;

    if (s.status !== 'error' && s.status !== 'pending') {
      validScores.push(s.finalScore);
    }
  }

  const averageScore =
    validScores.length > 0
      ? Math.round(
          (validScores.reduce((a, b) => a + b, 0) / validScores.length) * 100
        ) / 100
      : null;
  const highestScore =
    validScores.length > 0 ? Math.max(...validScores) : null;
  const lowestScore =
    validScores.length > 0 ? Math.min(...validScores) : null;

  const step = maxScore / 5;
  const scoreDistribution = [0, 1, 2, 3, 4].map((idx) => {
    const minInclusive = Math.round(idx * step * 100) / 100;
    const maxExclusive = Math.round((idx + 1) * step * 100) / 100;
    const isLast = idx === 4;
    const count = validScores.filter((sc) =>
      isLast ? sc >= minInclusive && sc <= maxScore + 0.001 : sc >= minInclusive && sc < maxExclusive
    ).length;
    return {
      bucketLabel: isLast
        ? `${minInclusive}–${maxScore}`
        : `${minInclusive}–<${maxExclusive}`,
      minInclusive,
      maxExclusive,
      count,
    };
  });

  return {
    totalSheets,
    autoGradedCount,
    reviewRequiredCount,
    confirmedCount,
    errorCount,
    averageScore,
    highestScore,
    lowestScore,
    scoreDistribution,
  };
}

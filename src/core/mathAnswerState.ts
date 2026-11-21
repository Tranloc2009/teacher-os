import type {
  AnswerProvenance,
  AnswerProvenanceStatus,
  MathQuestion,
  McqOptionLabel,
  TrueFalseLabel,
} from '../types/mathExam';

const MCQ_LABELS: McqOptionLabel[] = ['A', 'B', 'C', 'D'];
const TF_LABELS: TrueFalseLabel[] = ['a', 'b', 'c', 'd'];

export type StructuralAnswerStatus =
  | 'valid'
  | 'missing'
  | 'candidate'
  | 'invalid'
  | 'not-applicable';

export type EffectiveAnswerProvenanceStatus = AnswerProvenanceStatus | 'none';

export interface StructuralAnswerInspection {
  status: StructuralAnswerStatus;
  selectedLabel?: string;
  selectedOptionIndex?: number;
  missingStatementLabels: TrueFalseLabel[];
  candidateStatementLabels: TrueFalseLabel[];
  reason?: string;
}

export interface QuestionAnswerEvaluation {
  structural: StructuralAnswerInspection;
  effectiveStatus: EffectiveAnswerProvenanceStatus;
  hasValidAnswer: boolean;
  isMissingKey: boolean;
  isNeedsReview: boolean;
  isConflict: boolean;
  isUnsupported: boolean;
  isStaleConfirmation: boolean;
  isInvalidAnswer: boolean;
  reconciledFromStaleMissing: boolean;
  needsTeacherConfirmation: boolean;
}

export function computeContentHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 = ((h2 << 5) + h2) ^ ch;
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}-${(h2 >>> 0).toString(16).padStart(8, '0')}-${input.length}`;
}

/**
 * Hash toàn bộ nội dung + khóa đáp án của một câu hỏi để phát hiện khi giáo viên
 * chỉnh sửa câu sau khi đã bấm xác nhận (tự động hủy trạng thái teacher-confirmed).
 */
export function computeQuestionVerificationContentHash(q: MathQuestion): string {
  const parts: string[] = [
    q.type,
    q.universalType ?? q.type,
    q.stem?.rawSource ?? '',
    q.correctOptionId ?? '',
    (q.correctOptionIds ?? []).join(','),
    (q.options ?? [])
      .map(
        (o) =>
          `${o.id}|${o.content?.rawSource ?? ''}|${o.isCorrect ? '1' : '0'}|${o.visualAsset?.checksum ?? ''}`
      )
      .join(';;'),
    (q.multiSelectOptions ?? [])
      .map(
        (o) =>
          `${o.id}|${o.content?.rawSource ?? ''}|${o.isCorrect ? '1' : '0'}|${o.visualAsset?.checksum ?? ''}`
      )
      .join(';;'),
    (q.statements ?? [])
      .map(
        (s) =>
          `${s.id}|${s.content?.rawSource ?? ''}|${s.isTrue ? '1' : '0'}|${s.answerState ?? ''}`
      )
      .join(';;'),
    q.shortAnswer
      ? `${q.shortAnswer.answerValue ?? ''}|${q.shortAnswer.rawAnswer ?? ''}|${q.shortAnswer.normalizedAnswer ?? ''}|${q.shortAnswer.unit ?? ''}`
      : '',
    (q.essayParts ?? [])
      .map((p) => `${p.id}|${p.label}|${p.points}|${p.content?.rawSource ?? ''}`)
      .join(';;'),
    q.solutionGuide?.rawSource ?? '',
    (q.visualAssets ?? []).map((a) => `${a.id}:${a.checksum}`).join(','),
  ];
  return computeContentHash(parts.join('###'));
}

/**
 * Kiểm tra cấu trúc khóa đáp án hiện tại của câu hỏi theo ID ổn định.
 * Tuyệt đối không dùng kiểm tra truthy trên chỉ số 0 (phương án A), boolean false (Sai)
 * hay chuỗi "0" (trả lời ngắn).
 */
export function inspectQuestionAnswerStructure(
  q: MathQuestion
): StructuralAnswerInspection {
  const uType = q.universalType ?? q.type;

  if (q.type === 'essay') {
    return {
      status: 'not-applicable',
      missingStatementLabels: [],
      candidateStatementLabels: [],
    };
  }

  if (uType === 'multi-select') {
    const opts = q.multiSelectOptions ?? q.options ?? [];
    const optIds = new Set(opts.map((o) => o.id));
    const markedOpts = opts.filter((o) => o.isCorrect);
    const declaredIds = Array.isArray(q.correctOptionIds)
      ? q.correctOptionIds.filter((id) => typeof id === 'string' && id.length > 0)
      : [];

    if (declaredIds.length === 0 && markedOpts.length === 0) {
      return {
        status: 'missing',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Chưa chọn ít nhất 1 phương án đúng cho câu hỏi nhiều đáp án.',
      };
    }

    const effectiveIds = declaredIds.length > 0 ? declaredIds : markedOpts.map((o) => o.id);
    const hasUnknownId = effectiveIds.some((id) => !optIds.has(id));
    if (hasUnknownId) {
      return {
        status: 'invalid',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Danh sách correctOptionIds chứa ID phương án không tồn tại.',
      };
    }

    if (declaredIds.length > 0 && markedOpts.length > 0) {
      const markedSet = new Set(markedOpts.map((o) => o.id));
      const matches =
        markedSet.size === declaredIds.length &&
        declaredIds.every((id) => markedSet.has(id));
      if (!matches) {
        return {
          status: 'invalid',
          missingStatementLabels: [],
          candidateStatementLabels: [],
          reason: 'Các phương án đánh dấu đúng không khớp với correctOptionIds.',
        };
      }
    }

    return {
      status: 'valid',
      selectedLabel: opts
        .map((o, idx) => (effectiveIds.includes(o.id) ? String.fromCharCode(65 + idx) : null))
        .filter(Boolean)
        .join(', '),
      missingStatementLabels: [],
      candidateStatementLabels: [],
    };
  }

  if (q.type === 'mcq') {
    const opts = q.options ?? [];
    const correctId = typeof q.correctOptionId === 'string' ? q.correctOptionId.trim() : '';
    const markedCorrect = opts.filter((o) => o.isCorrect);
    const matchedIdx = correctId.length > 0 ? opts.findIndex((o) => o.id === correctId) : -1;

    if (correctId.length === 0 && markedCorrect.length === 0) {
      return {
        status: 'missing',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Chưa chọn đáp án đúng cho câu trắc nghiệm.',
      };
    }

    if (matchedIdx < 0) {
      return {
        status: 'invalid',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'correctOptionId không khớp với bất kỳ phương án hiện có nào.',
      };
    }

    if (markedCorrect.length !== 1 || markedCorrect[0].id !== correctId) {
      return {
        status: 'invalid',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Phải có duy nhất 1 phương án isCorrect khớp với correctOptionId.',
      };
    }

    const matchedOpt = opts[matchedIdx];
    return {
      status: 'valid',
      selectedOptionIndex: matchedIdx,
      selectedLabel: matchedOpt.originalLabel ?? MCQ_LABELS[matchedIdx] ?? String.fromCharCode(65 + matchedIdx),
      missingStatementLabels: [],
      candidateStatementLabels: [],
    };
  }

  if (q.type === 'true-false') {
    const sts = q.statements ?? [];
    if (sts.length !== 4) {
      return {
        status: 'missing',
        missingStatementLabels: TF_LABELS.slice(sts.length),
        candidateStatementLabels: [],
        reason: 'Câu Đúng/Sai chưa có đủ 4 mệnh đề a, b, c, d.',
      };
    }

    const missingLabels: TrueFalseLabel[] = [];
    const candidateLabels: TrueFalseLabel[] = [];
    const nonBooleanLabels: TrueFalseLabel[] = [];

    sts.forEach((st, idx) => {
      const lbl = st.originalLabel ?? TF_LABELS[idx] ?? 'a';
      if (st.answerState === 'missing') {
        missingLabels.push(lbl);
      } else if (st.answerState === 'candidate') {
        candidateLabels.push(lbl);
      } else if (typeof st.isTrue !== 'boolean') {
        nonBooleanLabels.push(lbl);
      }
    });

    if (nonBooleanLabels.length > 0) {
      return {
        status: 'invalid',
        missingStatementLabels: missingLabels,
        candidateStatementLabels: candidateLabels,
        reason: `Ý ${nonBooleanLabels.map((l) => `${l})`).join(', ')} chưa có giá trị Đúng/Sai hợp lệ.`,
      };
    }

    if (missingLabels.length > 0) {
      return {
        status: 'missing',
        missingStatementLabels: missingLabels,
        candidateStatementLabels: candidateLabels,
        reason: `Thiếu đáp án Đúng/Sai cho ý ${missingLabels.map((l) => `${l})`).join(', ')}.`,
      };
    }

    if (candidateLabels.length > 0) {
      return {
        status: 'candidate',
        missingStatementLabels: [],
        candidateStatementLabels: candidateLabels,
        reason: `Ý ${candidateLabels.map((l) => `${l})`).join(', ')} mới là ứng viên từ dấu gạch chân, chưa xác nhận.`,
      };
    }

    return {
      status: 'valid',
      selectedLabel: sts
        .map((st, idx) => `${st.originalLabel ?? TF_LABELS[idx]}:${st.isTrue ? 'Đ' : 'S'}`)
        .join(' · '),
      missingStatementLabels: [],
      candidateStatementLabels: [],
    };
  }

  if (uType === 'fill-blank') {
    const slots = q.fillBlank?.slots ?? [];
    const hasSlotAnswer =
      slots.length > 0 &&
      slots.every((sl) => sl.acceptedAnswers.some((ans) => ans.trim().length > 0));
    const hasPartialSlot =
      slots.length > 0 &&
      slots.some((sl) => sl.acceptedAnswers.some((ans) => ans.trim().length > 0));
    const fallbackVal = typeof q.shortAnswer?.answerValue === 'string'
      ? q.shortAnswer.answerValue.trim()
      : '';

    if (hasSlotAnswer || (slots.length === 0 && fallbackVal.length > 0)) {
      return {
        status: 'valid',
        selectedLabel:
          slots.length > 0
            ? slots.map((sl, idx) => `(${sl.slotNumber || idx + 1}) ${sl.acceptedAnswers[0]}`).join('; ')
            : fallbackVal,
        missingStatementLabels: [],
        candidateStatementLabels: [],
      };
    }

    if (hasPartialSlot) {
      return {
        status: 'missing',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Còn chỗ trống Điền khuyết chưa có đáp án.',
      };
    }

    return {
      status: 'missing',
      missingStatementLabels: [],
      candidateStatementLabels: [],
      reason: 'Câu Điền khuyết chưa có đáp án.',
    };
  }

  if (uType === 'matching') {
    const matching = q.matching;
    if (!matching || matching.leftItems.length < 2 || matching.rightItems.length < 2) {
      return {
        status: 'invalid',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Câu Ghép đôi phải có ít nhất 2 mục ở mỗi cột.',
      };
    }
    const leftSet = new Set(matching.leftItems.map((i) => i.id));
    const rightSet = new Set(matching.rightItems.map((i) => i.id));
    const validPairs = matching.correctPairs.filter(
      (p) => leftSet.has(p.leftItemId) && rightSet.has(p.rightItemId)
    );
    if (validPairs.length === 0) {
      return {
        status: 'missing',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Câu Ghép đôi chưa có cặp nối đúng hợp lệ theo ID.',
      };
    }
    return {
      status: 'valid',
      missingStatementLabels: [],
      candidateStatementLabels: [],
    };
  }

  if (uType === 'ordering') {
    const items = q.ordering?.items ?? [];
    if (items.length < 2) {
      return {
        status: 'invalid',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Câu Sắp xếp cần ít nhất 2 bước.',
      };
    }
    const ranks = new Set(items.map((it) => it.correctRank));
    if (ranks.size !== items.length) {
      return {
        status: 'invalid',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Thứ tự đúng (correctRank) bị trùng.',
      };
    }
    return {
      status: 'valid',
      missingStatementLabels: [],
      candidateStatementLabels: [],
    };
  }

  if (q.type === 'short-answer') {
    const rawVal = typeof q.shortAnswer?.answerValue === 'string' ? q.shortAnswer.answerValue : '';
    const trimmed = rawVal.trim();
    if (trimmed.length === 0) {
      return {
        status: 'missing',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Chưa nhập đáp án Trả lời ngắn.',
      };
    }
    if (/\[\[ASSET:|\[CÔNG_THỨC_/.test(trimmed)) {
      return {
        status: 'invalid',
        missingStatementLabels: [],
        candidateStatementLabels: [],
        reason: 'Đáp án Trả lời ngắn còn chứa mã placeholder chưa giải mã.',
      };
    }
    return {
      status: 'valid',
      selectedLabel: trimmed,
      missingStatementLabels: [],
      candidateStatementLabels: [],
    };
  }

  return {
    status: 'not-applicable',
    missingStatementLabels: [],
    candidateStatementLabels: [],
  };
}

/**
 * Nguồn sự thật duy nhất (Single Canonical Source of Truth) về trạng thái khóa đáp án
 * hiện tại của một câu hỏi cho mọi consumer:
 * - Editor (thẻ phương án, danh sách câu, bảng Bước 2)
 * - MathIntegrityReportPanel & auditOriginalExamIntegrity & computeLockStats
 * - checkExamExportGate & checkDraftExportGate
 * - AnswerKeyStudioPanel & DocumentImportDoctorPanel & mapToReliabilityAnswerStatus
 */
export function evaluateQuestionAnswerState(
  q: MathQuestion
): QuestionAnswerEvaluation {
  const structural = inspectQuestionAnswerStructure(q);
  const prov = q.answerProvenance;
  const provStatus = prov?.status;

  if (q.type === 'essay') {
    const effectiveStatus: EffectiveAnswerProvenanceStatus =
      provStatus ?? (q.answerConfirmed ? 'teacher-confirmed' : 'none');
    return {
      structural,
      effectiveStatus,
      hasValidAnswer: true,
      isMissingKey: false,
      isNeedsReview: false,
      isConflict: false,
      isUnsupported: false,
      isStaleConfirmation: false,
      isInvalidAnswer: false,
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: false,
    };
  }

  if (provStatus === 'conflict') {
    return {
      structural,
      effectiveStatus: 'conflict',
      hasValidAnswer: false,
      isMissingKey: false,
      isNeedsReview: false,
      isConflict: true,
      isUnsupported: false,
      isStaleConfirmation: false,
      isInvalidAnswer: structural.status === 'invalid',
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: true,
    };
  }

  if (provStatus === 'unsupported') {
    return {
      structural,
      effectiveStatus: 'unsupported',
      hasValidAnswer: false,
      isMissingKey: false,
      isNeedsReview: false,
      isConflict: false,
      isUnsupported: true,
      isStaleConfirmation: false,
      isInvalidAnswer: structural.status === 'invalid',
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: true,
    };
  }

  if (provStatus === 'needs-review') {
    return {
      structural,
      effectiveStatus: 'needs-review',
      hasValidAnswer: false,
      isMissingKey: false,
      isNeedsReview: true,
      isConflict: false,
      isUnsupported: false,
      isStaleConfirmation: false,
      isInvalidAnswer: structural.status === 'invalid',
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: true,
    };
  }

  // Trường hợp cấu trúc đáp án bị sai/hỏng (VD: correctOptionId trỏ vào ID không tồn tại hoặc chọn 2 đáp án)
  if (structural.status === 'invalid') {
    return {
      structural,
      effectiveStatus: provStatus ?? 'none',
      hasValidAnswer: false,
      isMissingKey: false,
      isNeedsReview: false,
      isConflict: false,
      isUnsupported: false,
      isStaleConfirmation: false,
      isInvalidAnswer: true,
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: true,
    };
  }

  // Trường hợp cấu trúc có ứng viên Đúng/Sai chưa xác nhận
  if (structural.status === 'candidate') {
    return {
      structural,
      effectiveStatus: 'needs-review',
      hasValidAnswer: false,
      isMissingKey: false,
      isNeedsReview: true,
      isConflict: false,
      isUnsupported: false,
      isStaleConfirmation: false,
      isInvalidAnswer: false,
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: true,
    };
  }

  // Trường hợp thực sự thiếu khóa đáp án (kể cả khi provenance bị xóa hoặc trước đó từng có khóa nhưng đã xóa đi)
  if (structural.status === 'missing') {
    return {
      structural,
      effectiveStatus: 'missing',
      hasValidAnswer: false,
      isMissingKey: true,
      isNeedsReview: false,
      isConflict: false,
      isUnsupported: false,
      isStaleConfirmation: false,
      isInvalidAnswer: false,
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: true,
    };
  }

  // Từ đây structural.status === 'valid': câu hỏi có khóa đáp án hiện tại hợp lệ theo ID.
  // Xử lý tương thích bản nháp cũ từng chọn đáp án thủ công nhưng provenance vẫn bị kẹt 'missing'.
  const hasLegacyAnomaly = Boolean(q.legacyAnomalyReasons && q.legacyAnomalyReasons.length > 0);
  if (provStatus === 'missing') {
    if (!q.optionParseIncomplete && !hasLegacyAnomaly) {
      return {
        structural,
        effectiveStatus: 'teacher-confirmed',
        hasValidAnswer: true,
        isMissingKey: false,
        isNeedsReview: false,
        isConflict: false,
        isUnsupported: false,
        isStaleConfirmation: false,
        isInvalidAnswer: false,
        reconciledFromStaleMissing: true,
        needsTeacherConfirmation: false,
      };
    }
    return {
      structural,
      effectiveStatus: 'needs-review',
      hasValidAnswer: false,
      isMissingKey: false,
      isNeedsReview: true,
      isConflict: false,
      isUnsupported: false,
      isStaleConfirmation: false,
      isInvalidAnswer: false,
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: true,
    };
  }

  // Kiểm tra hash chống chỉnh sửa nội dung sau khi giáo viên đã xác nhận
  if (
    provStatus === 'teacher-confirmed' &&
    prov?.confirmedContentHash &&
    prov.confirmedContentHash !== computeQuestionVerificationContentHash(q)
  ) {
    return {
      structural,
      effectiveStatus: 'needs-review',
      hasValidAnswer: false,
      isMissingKey: false,
      isNeedsReview: true,
      isConflict: false,
      isUnsupported: false,
      isStaleConfirmation: true,
      isInvalidAnswer: false,
      reconciledFromStaleMissing: false,
      needsTeacherConfirmation: true,
    };
  }

  const effectiveStatus: EffectiveAnswerProvenanceStatus =
    provStatus ?? (q.answerConfirmed ? 'teacher-confirmed' : 'none');

  const isConfirmedOrMatched =
    effectiveStatus === 'teacher-confirmed' ||
    effectiveStatus === 'source-matched' ||
    Boolean(q.answerConfirmed);

  return {
    structural,
    effectiveStatus,
    hasValidAnswer: !q.optionParseIncomplete,
    isMissingKey: false,
    isNeedsReview: false,
    isConflict: false,
    isUnsupported: false,
    isStaleConfirmation: false,
    isInvalidAnswer: false,
    reconciledFromStaleMissing: false,
    needsTeacherConfirmation: !isConfirmedOrMatched,
  };
}

/**
 * Áp dụng thao tác chọn/nhập/xóa đáp án thủ công của giáo viên lên một câu hỏi,
 * đồng bộ nhất quán giữa khóa đáp án hiện tại, answerConfirmed và answerProvenance,
 * đồng thời giữ nguyên siêu dữ liệu truy vết từ tệp DOCX gốc (sourceFileHash, sourceLocation, rawEvidence).
 */
export function applyTeacherManualAnswer(
  previousQuestion: MathQuestion,
  updatedQuestion: MathQuestion,
  options?: {
    now?: string;
    sourceLocation?: string;
    selectionSummary?: string;
  }
): MathQuestion {
  const now = options?.now ?? new Date().toISOString();
  const prevProv = previousQuestion.answerProvenance;
  const candidate: MathQuestion = {
    ...updatedQuestion,
    updatedAt: now,
  };
  const structural = inspectQuestionAnswerStructure(candidate);

  const preservedMeta: Partial<AnswerProvenance> = {
    sourceFileHash: prevProv?.sourceFileHash ?? previousQuestion.sourceTrace?.sourceFileHash,
    sourceLocation: prevProv?.sourceLocation ?? options?.sourceLocation,
    rawEvidence: prevProv?.rawEvidence,
    candidateConvention: prevProv?.candidateConvention,
  };

  if (structural.status === 'valid') {
    const confirmedHash = computeQuestionVerificationContentHash(candidate);
    const labelSummary = options?.selectionSummary ?? structural.selectedLabel;
    return {
      ...candidate,
      answerConfirmed: true,
      answerProvenance: {
        ...preservedMeta,
        status: 'teacher-confirmed',
        sourceKind: 'teacher-manual',
        rawEvidence: preservedMeta.rawEvidence ?? (labelSummary ? `Giáo viên chọn: ${labelSummary}` : undefined),
        conflictingEvidence: undefined,
        confirmedAt: now,
        confirmedContentHash: confirmedHash,
        note: labelSummary
          ? `Giáo viên đã chọn và xác nhận đáp án thủ công (${labelSummary}).`
          : 'Giáo viên đã chọn và xác nhận đáp án thủ công.',
      },
    };
  }

  if (structural.status === 'missing') {
    return {
      ...candidate,
      answerConfirmed: false,
      answerProvenance: {
        ...preservedMeta,
        status: 'missing',
        sourceKind: prevProv?.sourceKind,
        confirmedAt: undefined,
        confirmedContentHash: undefined,
        note: structural.reason ?? 'Chưa có khóa đáp án đầy đủ; cần giáo viên chọn hoặc nhập đáp án.',
      },
    };
  }

  if (structural.status === 'candidate') {
    return {
      ...candidate,
      answerConfirmed: false,
      answerProvenance: {
        ...preservedMeta,
        status: 'needs-review',
        sourceKind: prevProv?.sourceKind ?? 'underline-candidate',
        confirmedAt: undefined,
        confirmedContentHash: undefined,
        note: structural.reason ?? 'Còn mệnh đề ở trạng thái ứng viên chưa được giáo viên xác nhận rõ.',
      },
    };
  }

  if (structural.status === 'invalid') {
    return {
      ...candidate,
      answerConfirmed: false,
      answerProvenance: {
        ...preservedMeta,
        status: 'needs-review',
        sourceKind: prevProv?.sourceKind,
        confirmedAt: undefined,
        confirmedContentHash: undefined,
        note: structural.reason ?? 'Đáp án hiện tại không hợp lệ — cần kiểm tra lại.',
      },
    };
  }

  return candidate;
}

/**
 * Chuẩn hóa tương thích cho bản nháp cũ đã lưu trước bản sửa:
 * nếu câu hỏi có answerProvenance.status === 'missing' nhưng giáo viên thực tế đã chọn
 * đầy đủ khóa đáp án hợp lệ theo ID (và không có bất thường/thiếu phương án), tự động
 * đồng bộ sang teacher-confirmed trong khi vẫn bảo toàn bằng chứng import gốc.
 */
export function reconcileLegacyQuestionAnswerState(q: MathQuestion): MathQuestion {
  const evaluation = evaluateQuestionAnswerState(q);
  if (!evaluation.reconciledFromStaleMissing) {
    return q;
  }
  return applyTeacherManualAnswer(q, q, {
    now: q.updatedAt || new Date().toISOString(),
    sourceLocation: q.answerProvenance?.sourceLocation ?? 'Khôi phục khóa thủ công từ bản nháp',
  });
}

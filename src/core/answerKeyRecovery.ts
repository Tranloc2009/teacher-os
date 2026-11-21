import {
  MathExamProject,
  MathQuestion,
  McqOptionLabel,
  TrueFalseLabel,
} from '../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  computeQuestionVerificationContentHash,
  evaluateQuestionAnswerState,
} from './mathIntegrity';

export type ReliabilityAnswerStatus =
  | 'SOURCE_KEY_FOUND'
  | 'TEACHER_CONFIRMED'
  | 'MISSING'
  | 'AMBIGUOUS'
  | 'CONFLICT'
  | 'UNSUPPORTED';

export interface ReliabilityAnswerStatusMeta {
  status: ReliabilityAnswerStatus;
  label: string;
  shortLabel: string;
  tone: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';
}

export const RELIABILITY_ANSWER_STATUS_META: Record<
  ReliabilityAnswerStatus,
  ReliabilityAnswerStatusMeta
> = {
  TEACHER_CONFIRMED: {
    status: 'TEACHER_CONFIRMED',
    label: 'TEACHER_CONFIRMED — Giáo viên đã xác nhận',
    shortLabel: 'Đã xác nhận',
    tone: 'emerald',
  },
  SOURCE_KEY_FOUND: {
    status: 'SOURCE_KEY_FOUND',
    label: 'SOURCE_KEY_FOUND — Có khóa đối chiếu từ tài liệu',
    shortLabel: 'Có khóa gốc',
    tone: 'sky',
  },
  AMBIGUOUS: {
    status: 'AMBIGUOUS',
    label: 'AMBIGUOUS — Cần duyệt quy ước / xác nhận lại',
    shortLabel: 'Cần duyệt',
    tone: 'amber',
  },
  CONFLICT: {
    status: 'CONFLICT',
    label: 'CONFLICT — Mâu thuẫn nhiều nguồn đáp án',
    shortLabel: 'Mâu thuẫn',
    tone: 'rose',
  },
  MISSING: {
    status: 'MISSING',
    label: 'MISSING — Thiếu khóa đáp án',
    shortLabel: 'Thiếu đáp án',
    tone: 'rose',
  },
  UNSUPPORTED: {
    status: 'UNSUPPORTED',
    label: 'UNSUPPORTED — Định dạng đáp án chưa hỗ trợ tự động',
    shortLabel: 'Chưa hỗ trợ',
    tone: 'slate',
  },
};

/**
 * Quy đổi trạng thái AnswerProvenance của một câu hỏi về 6 trạng thái chuẩn của
 * Exam Reliability Engine 1.0 (tự phát hiện confirmedContentHash bị lỗi thời).
 */
export function mapToReliabilityAnswerStatus(q: MathQuestion): ReliabilityAnswerStatus {
  if (q.optionParseIncomplete) {
    return 'AMBIGUOUS';
  }

  if (q.type === 'essay') {
    return q.answerConfirmed
      ? 'TEACHER_CONFIRMED'
      : q.solutionGuide?.rawSource?.trim()
      ? 'SOURCE_KEY_FOUND'
      : 'MISSING';
  }

  const ansState = evaluateQuestionAnswerState(q);
  if (ansState.isConflict) return 'CONFLICT';
  if (ansState.isUnsupported) return 'UNSUPPORTED';
  if (ansState.isStaleConfirmation || ansState.isNeedsReview || ansState.isInvalidAnswer) {
    return 'AMBIGUOUS';
  }
  if (ansState.isMissingKey) return 'MISSING';

  if (ansState.effectiveStatus === 'teacher-confirmed') return 'TEACHER_CONFIRMED';
  if (ansState.effectiveStatus === 'source-matched') return 'SOURCE_KEY_FOUND';
  return q.answerConfirmed ? 'TEACHER_CONFIRMED' : 'MISSING';
}

export function getAnswerProvenanceSourceLabel(q: MathQuestion): string {
  const kind = q.answerProvenance?.sourceKind;
  switch (kind) {
    case 'answer-table':
      return 'Bảng đáp án gốc';
    case 'solution-line':
      return 'Lời giải chi tiết';
    case 'inline-key':
      return 'Đánh dấu trong đề';
    case 'underline-candidate':
      return 'Gạch chân (chưa xác nhận)';
    case 'short-answer-candidate':
      return 'Ứng viên trả lời ngắn';
    case 'teacher-manual':
      return 'Giáo viên nhập / xác nhận';
    case 'seed-demo':
      return 'Đề mẫu chuẩn';
    case 'legacy-unverified':
      return 'Bản lưu cũ chưa kiểm chứng';
    default:
      return q.answerConfirmed ? 'Giáo viên xác nhận' : 'Không tìm thấy nguồn';
  }
}

export function getReliabilityAnswerSummary(q: MathQuestion): string {
  if (q.type === 'mcq') {
    const uType = q.universalType ?? q.type;
    if (uType === 'multi-select') {
      const opts = q.multiSelectOptions ?? q.options ?? [];
      const correct = opts.filter((o) => o.isCorrect).map((o) => o.originalLabel);
      return correct.length > 0 ? correct.join(', ') : 'Chưa có';
    }
    const opts = q.options ?? [];
    const hit =
      opts.find((o) => o.id === q.correctOptionId) ?? opts.find((o) => o.isCorrect);
    return hit ? hit.originalLabel : 'Chưa có';
  }
  if (q.type === 'true-false') {
    const sts = q.statements ?? [];
    if (sts.length === 0) return 'Chưa có';
    return sts
      .map((s) => {
        if (s.answerState === 'missing') return `${s.originalLabel}:?`;
        if (s.answerState === 'candidate') return `${s.originalLabel}:${s.isTrue ? 'Đ?' : 'S?'}`;
        return `${s.originalLabel}:${s.isTrue ? 'Đ' : 'S'}`;
      })
      .join(' · ');
  }
  if (q.type === 'short-answer') {
    const raw = q.shortAnswer?.rawAnswer?.trim() || q.shortAnswer?.answerValue?.trim() || '';
    return raw || 'Chưa có';
  }
  return q.solutionGuide?.rawSource?.trim() ? 'Có hướng dẫn chấm' : 'Tự luận (chưa có lời giải)';
}

export interface BulkAnswerKeyEntry {
  questionId: string;
  questionCode: string;
  questionOrderIndex: number; // 0-based index in exam.questions
  questionType: MathQuestion['type'];
  rawInput: string;
  parsedSummary: string;
  mcqLabel?: McqOptionLabel;
  tfValues?: Record<TrueFalseLabel, boolean>;
  shortAnswerRaw?: string;
  shortAnswerNormalized?: string;
}

export interface BulkAnswerKeyParseResult {
  matched: BulkAnswerKeyEntry[];
  unmatchedTokens: string[];
  warnings: string[];
}

function normalizeShortAnswerValue(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^\$+|\$+$/g, '')
    .replace(/\\,/g, '')
    .replace(/\{,\}/g, ',')
    .replace(/−/g, '-')
    .replace(/\s+/g, '');
  if (/^-?\d+,\d+$/.test(cleaned)) {
    return cleaned.replace(',', '.');
  }
  return cleaned;
}

type BulkSectionScope = 'auto' | 'mcq' | 'true-false' | 'short-answer';

function detectSectionScopeHeader(line: string): BulkSectionScope | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^(?:PHẦN|PART)\s*(?:I|1)\b/i.test(trimmed) || /^TRẮC\s+NGHIỆM\s*(?:4\s*PHƯƠNG\s*ÁN|NHIỀU\s*PHƯƠNG\s*ÁN|KHÁCH\s*QUAN)/i.test(trimmed)) {
    return 'mcq';
  }
  if (/^(?:PHẦN|PART)\s*(?:II|2)\b/i.test(trimmed) || /^ĐÚNG\s*[-–/]\s*SAI/i.test(trimmed)) {
    return 'true-false';
  }
  if (/^(?:PHẦN|PART)\s*(?:III|3)\b/i.test(trimmed) || /^TRẢ\s*LỜI\s*NGẮN/i.test(trimmed)) {
    return 'short-answer';
  }
  return null;
}

function parseTfTuple(rawValue: string): Record<TrueFalseLabel, boolean> | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  // Format 1: labeled a) Đ, b) S, c) Đ, d) S
  const labeled = new Map<TrueFalseLabel, boolean>();
  const labeledRe = /([a-d])\s*[).:\-]?\s*(ĐÚNG|SAI|TRUE|FALSE|[ĐTFSđtfsdD])(?![\p{L}\p{N}])/giu;
  let m: RegExpExecArray | null;
  while ((m = labeledRe.exec(trimmed)) !== null) {
    const lbl = m[1].toLowerCase() as TrueFalseLabel;
    const tok = m[2].toUpperCase();
    labeled.set(lbl, tok === 'Đ' || tok === 'ĐÚNG' || tok === 'T' || tok === 'TRUE' || tok === 'D');
  }
  if (labeled.size === 4) {
    return {
      a: labeled.get('a')!,
      b: labeled.get('b')!,
      c: labeled.get('c')!,
      d: labeled.get('d')!,
    };
  }

  // Format 2: compact 4-letter TFTT / ĐSĐS / DSDS
  const compact = trimmed.replace(/[\s\-–·,|/;]+/g, '').toUpperCase();
  if (/^[ĐTFSĐD]{4}$/.test(compact)) {
    const toBool = (ch: string) => ch === 'Đ' || ch === 'T' || ch === 'D';
    return {
      a: toBool(compact[0]),
      b: toBool(compact[1]),
      c: toBool(compact[2]),
      d: toBool(compact[3]),
    };
  }

  // Format 3: separated words Đúng - Sai - Đúng - Sai
  const words = Array.from(
    trimmed.matchAll(/(?<![\p{L}\p{N}])(ĐÚNG|SAI|TRUE|FALSE|[ĐTFSđtfsdD])(?![\p{L}\p{N}])/giu)
  ).map((hit) => hit[1].toUpperCase());
  if (words.length === 4) {
    const toBool = (tok: string) =>
      tok === 'Đ' || tok === 'ĐÚNG' || tok === 'T' || tok === 'TRUE' || tok === 'D';
    return {
      a: toBool(words[0]),
      b: toBool(words[1]),
      c: toBool(words[2]),
      d: toBool(words[3]),
    };
  }

  return null;
}

function findTargetQuestion(
  questions: MathQuestion[],
  qNumber: number,
  preferredType: MathQuestion['type'] | null
): { question: MathQuestion; index: number } | null {
  const byType = preferredType
    ? questions
        .map((question, index) => ({ question, index }))
        .filter((item) => item.question.type === preferredType)
    : questions.map((question, index) => ({ question, index }));

  // 1. Match by sourceTrace.originalQuestionNumberInSection inside preferredType
  const exactSourceMatch = byType.find(
    (item) => item.question.sourceTrace?.originalQuestionNumberInSection === qNumber
  );
  if (exactSourceMatch) return exactSourceMatch;

  // 2. Match by 1-based ordinal inside preferredType
  if (qNumber >= 1 && qNumber <= byType.length) {
    return byType[qNumber - 1];
  }

  // 3. Fallback: global 1-based index if type compatible (or auto)
  if (qNumber >= 1 && qNumber <= questions.length) {
    const globalItem = { question: questions[qNumber - 1], index: qNumber - 1 };
    if (!preferredType || globalItem.question.type === preferredType) {
      return globalItem;
    }
  }

  return null;
}

/**
 * Bộ đọc đáp án dán nhanh (Bulk Paste Answer Key) hỗ trợ đầy đủ 3 phần:
 * - MCQ: `1.B`, `1B 2C 3A 4D`, `Câu 1: B | Câu 2: C`
 * - Đúng/Sai: `1: Đ-S-Đ-S`, `Câu 1: a) Đ, b) S, c) Đ, d) S`, `1: TFTT`
 * - Trả lời ngắn: `1: -4,3`, `2: 0`, `Câu 3: 12.5`
 * Tuyệt đối không đoán hay tự gán cho những câu không có trong dữ liệu giáo viên dán.
 */
export function parseBulkAnswerKeyText(
  rawText: string,
  questions: MathQuestion[]
): BulkAnswerKeyParseResult {
  const matchedById = new Map<string, BulkAnswerKeyEntry>();
  const unmatchedTokens: string[] = [];
  const warnings: string[] = [];

  let scope: BulkSectionScope = 'auto';
  const lines = rawText.split(/\r?\n/);

  const registerPair = (qNum: number, rawVal: string, rawSegment: string) => {
    const val = rawVal.trim();
    if (!val) {
      unmatchedTokens.push(rawSegment);
      return;
    }

    // Determine candidate interpretation
    const singleMcqMatch = val.match(/^([ABCD])$/i);
    const tfParsed = parseTfTuple(val);

    // 1. If scope explicitly set, honor it first
    if (scope === 'mcq' || (scope === 'auto' && singleMcqMatch)) {
      if (singleMcqMatch) {
        const lbl = singleMcqMatch[1].toUpperCase() as McqOptionLabel;
        const target = findTargetQuestion(questions, qNum, 'mcq');
        if (!target) {
          unmatchedTokens.push(rawSegment);
          warnings.push(`Không tìm thấy câu Trắc nghiệm số ${qNum} trong đề cho "${rawSegment}".`);
          return;
        }
        if (target.question.optionParseIncomplete) {
          warnings.push(
            `Bỏ qua Câu ${qNum} (${target.question.code}) vì đang lỗi OPTION_PARSE_INCOMPLETE — cần bổ sung đủ 4 phương án trước.`
          );
          return;
        }
        const optExists = (target.question.options ?? []).some(
          (o) => o.originalLabel === lbl
        );
        if (!optExists) {
          warnings.push(`Câu ${qNum} (${target.question.code}) không có phương án ${lbl}.`);
          return;
        }
        matchedById.set(target.question.id, {
          questionId: target.question.id,
          questionCode: target.question.code,
          questionOrderIndex: target.index,
          questionType: 'mcq',
          rawInput: rawSegment,
          parsedSummary: lbl,
          mcqLabel: lbl,
        });
        return;
      }
    }

    if (scope === 'true-false' || (scope === 'auto' && tfParsed)) {
      if (tfParsed) {
        const target = findTargetQuestion(questions, qNum, 'true-false');
        if (!target) {
          unmatchedTokens.push(rawSegment);
          warnings.push(`Không tìm thấy câu Đúng/Sai số ${qNum} trong đề cho "${rawSegment}".`);
          return;
        }
        const summary = TF_LABELS.map((l) => `${l}:${tfParsed[l] ? 'Đ' : 'S'}`).join(' · ');
        matchedById.set(target.question.id, {
          questionId: target.question.id,
          questionCode: target.question.code,
          questionOrderIndex: target.index,
          questionType: 'true-false',
          rawInput: rawSegment,
          parsedSummary: summary,
          tfValues: tfParsed,
        });
        return;
      } else if (scope === 'true-false') {
        unmatchedTokens.push(rawSegment);
        warnings.push(
          `Câu Đúng/Sai số ${qNum} ("${val}") chưa đủ 4 mệnh đề a/b/c/d — không tự suy đoán ý thiếu.`
        );
        return;
      }
    }

    if (scope === 'short-answer' || scope === 'auto') {
      const target = findTargetQuestion(questions, qNum, 'short-answer');
      if (target) {
        const normalized = normalizeShortAnswerValue(val);
        matchedById.set(target.question.id, {
          questionId: target.question.id,
          questionCode: target.question.code,
          questionOrderIndex: target.index,
          questionType: 'short-answer',
          rawInput: rawSegment,
          parsedSummary: val,
          shortAnswerRaw: val,
          shortAnswerNormalized: normalized,
        });
        return;
      }
    }

    unmatchedTokens.push(rawSegment);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const detectedHeader = detectSectionScopeHeader(line);
    if (detectedHeader) {
      scope = detectedHeader;
      continue;
    }

    // Split by pipe `|` or semicolon `;` if line contains multiple entries like `Câu 1: B | Câu 2: C`
    const segments = line
      .split(/\s*[|;]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const seg of segments) {
      // Check if segment is a sequence of compact MCQ pairs: `1B 2C 3A 4D` or `1.B 2.C 3.A`
      const compactPairs = Array.from(
        seg.matchAll(/(?:^|\s)(?:Câu\s*)?(\d{1,3})\s*[.):\-–]?\s*([ABCD])(?=\s|$)/gi)
      );
      const consumedByCompact = seg
        .replace(/(?:^|\s)(?:Câu\s*)?(\d{1,3})\s*[.):\-–]?\s*([ABCD])(?=\s|$)/gi, ' ')
        .trim();
      if (compactPairs.length >= 2 && consumedByCompact.length === 0) {
        for (const cp of compactPairs) {
          registerPair(parseInt(cp[1], 10), cp[2], `${cp[1]}.${cp[2].toUpperCase()}`);
        }
        continue;
      }

      // Single pair on segment: `Câu 1: ...`, `1. ...`, `1: ...`, `1) ...`, `1 - ...`, `1B`
      const singleMatch =
        seg.match(/^(?:Câu|Bài|Question)?\s*(\d{1,3})\s*[.):=\-–]\s*(.+)$/i) ??
        seg.match(/^(?:Câu\s*)?(\d{1,3})\s*([ABCD])$/i);

      if (singleMatch) {
        const qNum = parseInt(singleMatch[1], 10);
        const rawVal = singleMatch[2].trim();
        registerPair(qNum, rawVal, seg);
      } else {
        unmatchedTokens.push(seg);
      }
    }
  }

  return {
    matched: Array.from(matchedById.values()).sort(
      (a, b) => a.questionOrderIndex - b.questionOrderIndex
    ),
    unmatchedTokens,
    warnings: Array.from(new Set(warnings)),
  };
}

/**
 * Áp dụng kết quả Bulk Paste Answer Key vào dự án một cách bất biến.
 * Chỉ cập nhật đúng các câu khớp, gắn `teacher-confirmed` + `confirmedContentHash`,
 * và xóa `generatedVersions` cũ để bắt buộc sinh mã đề mới theo khóa vừa cập nhật.
 */
export function applyBulkAnswerKeyUpdates(
  exam: MathExamProject,
  entries: BulkAnswerKeyEntry[]
): MathExamProject {
  if (entries.length === 0) return exam;
  const now = new Date().toISOString();
  const byId = new Map(entries.map((e) => [e.questionId, e]));

  const nextQuestions = exam.questions.map((q) => {
    const entry = byId.get(q.id);
    if (!entry) return q;

    let updated: MathQuestion = { ...q, updatedAt: now };

    if (entry.questionType === 'mcq' && entry.mcqLabel && q.options) {
      const targetOpt = q.options.find((o) => o.originalLabel === entry.mcqLabel);
      if (!targetOpt) return q;
      const nextOpts = q.options.map((o) => ({
        ...o,
        isCorrect: o.id === targetOpt.id,
      }));
      updated = {
        ...updated,
        options: nextOpts,
        correctOptionId: targetOpt.id,
        answerConfirmed: true,
      };
    } else if (entry.questionType === 'true-false' && entry.tfValues && q.statements) {
      const nextSts = q.statements.map((st, idx) => {
        const lbl = (st.originalLabel || TF_LABELS[idx]) as TrueFalseLabel;
        const val = entry.tfValues![lbl];
        return {
          ...st,
          isTrue: Boolean(val),
          answerState: 'confirmed' as const,
        };
      });
      updated = {
        ...updated,
        statements: nextSts,
        answerConfirmed: true,
      };
    } else if (entry.questionType === 'short-answer' && entry.shortAnswerRaw !== undefined) {
      const rawAns = entry.shortAnswerRaw.trim();
      const normAns = entry.shortAnswerNormalized ?? normalizeShortAnswerValue(rawAns);
      const accepted = Array.from(new Set([rawAns, normAns].filter(Boolean)));
      updated = {
        ...updated,
        shortAnswer: {
          ...(q.shortAnswer ?? { answerValue: rawAns, acceptedFormats: accepted }),
          answerValue: rawAns,
          rawAnswer: rawAns,
          normalizedAnswer: normAns,
          acceptedFormats: accepted,
        },
        answerConfirmed: true,
      };
    } else {
      return q;
    }

    const confirmedContentHash = computeQuestionVerificationContentHash(updated);
    updated.answerProvenance = {
      status: 'teacher-confirmed',
      sourceKind: 'teacher-manual',
      sourceFileHash: q.answerProvenance?.sourceFileHash ?? q.sourceTrace?.sourceFileHash,
      sourceLocation: 'Answer Key Studio (dán nhanh hàng loạt)',
      rawEvidence: entry.rawInput,
      confirmedAt: now,
      confirmedContentHash,
    };
    return updated;
  });

  const allNonEssayConfirmed = nextQuestions
    .filter((q) => q.type !== 'essay')
    .every((q) => mapToReliabilityAnswerStatus(q) === 'TEACHER_CONFIRMED');

  return {
    ...exam,
    questions: nextQuestions,
    confirmedOriginalAnswers: allNonEssayConfirmed ? true : exam.confirmedOriginalAnswers,
    generatedVersions: [],
    updatedAt: now,
  };
}

/**
 * Xác nhận đáp án cho một câu hỏi cụ thể (chỉ thành công khi câu hỏi đã thực sự có khóa hợp lệ,
 * tuyệt đối không tự gán A hoặc Sai cho câu đang thiếu).
 */
export function confirmSingleQuestionAnswer(
  exam: MathExamProject,
  questionId: string
): MathExamProject {
  const now = new Date().toISOString();
  let changed = false;

  const nextQuestions = exam.questions.map((q) => {
    if (q.id !== questionId) return q;
    if (q.optionParseIncomplete) return q;

    if (q.type === 'mcq') {
      const opts = q.options ?? [];
      const correct = opts.find((o) => o.id === q.correctOptionId && o.isCorrect);
      if (opts.length !== 4 || !correct) return q;
    } else if (q.type === 'true-false') {
      const sts = q.statements ?? [];
      if (sts.length !== 4 || sts.some((s) => s.answerState === 'missing')) return q;
    } else if (q.type === 'short-answer') {
      if (!(q.shortAnswer?.answerValue?.trim())) return q;
    }

    changed = true;
    const nextStatements =
      q.type === 'true-false' && q.statements
        ? q.statements.map((s) => ({ ...s, answerState: 'confirmed' as const }))
        : q.statements;

    const nextQ: MathQuestion = {
      ...q,
      ...(nextStatements ? { statements: nextStatements } : {}),
      answerConfirmed: true,
      updatedAt: now,
    };
    const confirmedContentHash = computeQuestionVerificationContentHash(nextQ);
    nextQ.answerProvenance = {
      ...(q.answerProvenance ?? {}),
      status: 'teacher-confirmed',
      sourceKind: q.answerProvenance?.sourceKind ?? 'teacher-manual',
      confirmedAt: now,
      confirmedContentHash,
    };
    return nextQ;
  });

  if (!changed) return exam;

  const allNonEssayConfirmed = nextQuestions
    .filter((q) => q.type !== 'essay')
    .every((q) => mapToReliabilityAnswerStatus(q) === 'TEACHER_CONFIRMED');

  return {
    ...exam,
    questions: nextQuestions,
    confirmedOriginalAnswers: allNonEssayConfirmed ? true : exam.confirmedOriginalAnswers,
    updatedAt: now,
  };
}

/**
 * Xác nhận hàng loạt CHỈ các câu đang ở trạng thái SOURCE_KEY_FOUND (có khóa đối chiếu từ tài liệu gốc,
 * không mâu thuẫn, không lỗi phương án, không thiếu).
 * TUYỆT ĐỐI không tự xác nhận câu MISSING / AMBIGUOUS / CONFLICT / UNSUPPORTED.
 */
export function confirmAllSourceMatchedAnswers(exam: MathExamProject): {
  exam: MathExamProject;
  confirmedCount: number;
  skippedCount: number;
} {
  const now = new Date().toISOString();
  let confirmedCount = 0;
  let skippedCount = 0;

  const nextQuestions = exam.questions.map((q) => {
    const status = mapToReliabilityAnswerStatus(q);
    if (status === 'TEACHER_CONFIRMED') return q;
    if (status !== 'SOURCE_KEY_FOUND' || q.optionParseIncomplete) {
      if (q.type !== 'essay') skippedCount += 1;
      return q;
    }

    const nextStatements =
      q.type === 'true-false' && q.statements
        ? q.statements.map((s) => ({ ...s, answerState: 'confirmed' as const }))
        : q.statements;

    const nextQ: MathQuestion = {
      ...q,
      ...(nextStatements ? { statements: nextStatements } : {}),
      answerConfirmed: true,
      updatedAt: now,
    };
    const confirmedContentHash = computeQuestionVerificationContentHash(nextQ);
    nextQ.answerProvenance = {
      ...(q.answerProvenance ?? {}),
      status: 'teacher-confirmed',
      confirmedAt: now,
      confirmedContentHash,
    };
    confirmedCount += 1;
    return nextQ;
  });

  if (confirmedCount === 0) {
    return { exam, confirmedCount: 0, skippedCount };
  }

  const allNonEssayConfirmed = nextQuestions
    .filter((q) => q.type !== 'essay')
    .every((q) => mapToReliabilityAnswerStatus(q) === 'TEACHER_CONFIRMED');

  return {
    exam: {
      ...exam,
      questions: nextQuestions,
      confirmedOriginalAnswers: allNonEssayConfirmed ? true : exam.confirmedOriginalAnswers,
      updatedAt: now,
    },
    confirmedCount,
    skippedCount,
  };
}

export function getMcqLabelOptionIds(q: MathQuestion): Record<McqOptionLabel, string | undefined> {
  const map: Record<McqOptionLabel, string | undefined> = {
    A: undefined,
    B: undefined,
    C: undefined,
    D: undefined,
  };
  for (const lbl of MCQ_LABELS) {
    map[lbl] = (q.options ?? []).find((o) => o.originalLabel === lbl)?.id;
  }
  return map;
}

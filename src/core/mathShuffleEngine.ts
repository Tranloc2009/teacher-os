import {
  COGNITIVE_LEVEL_LABELS,
  ExamMatrixRule,
  MATH_QUESTION_TYPE_LABELS,
  MathExamProject,
  MathIntegrityIssue,
  MathQuestion,
  McqOption,
  MixedExamAnswerRow,
  MixedExamVersion,
  MixedQuestionMapping,
  OriginalExamSnapshot,
  QuestionGroup,
  TrueFalseStatement,
} from '../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  createOriginalExamSnapshot,
  detectDependentOptions,
  detectDependentStatements,
  evaluatePreMixIntegrity,
  getOptionLetterLabel,
  getStatementLetterLabel,
  verifyMixedExamIntegrity,
} from './mathIntegrity';
import { getUniversalQuestionType } from './subjectProfileRegistry';

function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleArrayWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Trộn mảng nhưng giữ nguyên vị trí chính xác cho các phần tử bị khóa.
 */
function shuffleWithPinnedSlots<T>(
  items: readonly T[],
  isPinned: (item: T) => boolean,
  rng: () => number
): T[] {
  const result = [...items];
  const unpinnedIndices: number[] = [];
  const unpinnedItems: T[] = [];

  items.forEach((item, idx) => {
    if (!isPinned(item)) {
      unpinnedIndices.push(idx);
      unpinnedItems.push(item);
    }
  });

  const shuffled = shuffleArrayWithRng(unpinnedItems, rng);
  unpinnedIndices.forEach((slotIdx, i) => {
    result[slotIdx] = shuffled[i];
  });

  return result;
}

export const MAX_EXAM_CODES = 200;
export const EXAM_CODE_PRESETS = [2, 4, 8, 10, 20, 40, 50, 100] as const;

export function resolveExamCodes(exam: MathExamProject): string[] {
  const count = Math.max(1, Math.min(MAX_EXAM_CODES, Math.floor(exam.mixConfig.examCount || 4)));
  const custom = exam.mixConfig.customCodeNames
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const start = Math.max(1, Math.floor(exam.mixConfig.startCodeNumber || 101));

  if (custom.length >= count) {
    return custom.slice(0, count);
  }
  if (custom.length > 0) {
    const used = new Set(custom);
    const result = [...custom];
    let nextNum = start;
    while (result.length < count) {
      const candidate = String(nextNum++);
      if (!used.has(candidate)) {
        used.add(candidate);
        result.push(candidate);
      }
    }
    return result;
  }

  return Array.from({ length: count }, (_, idx) => String(start + idx));
}

export function buildDefaultMatrixRules(questions: MathQuestion[]): ExamMatrixRule[] {
  const counts = new Map<string, ExamMatrixRule>();
  questions.forEach((q) => {
    const key = `${q.type}::${q.topic}::${q.cognitiveLevel}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        id: `mat-${q.type}-${counts.size + 1}`,
        type: q.type,
        topic: q.topic,
        cognitiveLevel: q.cognitiveLevel,
        count: 1,
      });
    }
  });
  return Array.from(counts.values());
}

/**
 * Kiểm tra cấu hình trộn đề & ma trận câu hỏi trước khi sinh mã đề.
 */
export function validateMixConfiguration(exam: MathExamProject): MathIntegrityIssue[] {
  const preReport = evaluatePreMixIntegrity(exam);
  const issues: MathIntegrityIssue[] = [...preReport.issues];

  const codes = resolveExamCodes(exam);
  const seenCodes = new Set<string>();
  const duplicateCodes: string[] = [];
  for (const code of codes) {
    if (seenCodes.has(code)) {
      duplicateCodes.push(code);
    }
    seenCodes.add(code);
  }
  if (duplicateCodes.length > 0) {
    issues.push({
      id: 'mix-dup-codes',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'exam',
      message: `Phát hiện mã đề bị trùng: ${Array.from(new Set(duplicateCodes)).join(', ')}.`,
      recommendation: 'Đặt mã đề không trùng nhau trước khi xuất bản.',
    });
  }

  if (exam.mixConfig.examCount < 1 || exam.mixConfig.examCount > MAX_EXAM_CODES) {
    issues.push({
      id: 'mix-count-range',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'exam',
      message: `Số lượng mã đề phải nằm trong khoảng từ 1 đến ${MAX_EXAM_CODES}.`,
      recommendation: 'Điều chỉnh số mã đề hợp lệ (VD: 2, 4, 10, 20, 40, 100).',
    });
  }

  if (exam.mixConfig.level === 3) {
    const rules = exam.mixConfig.matrixRules;
    if (rules.length === 0) {
      issues.push({
        id: 'matrix-empty',
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'matrix',
        message: 'Chế độ Mức 3 (Trộn theo Ma trận) chưa có dòng quy tắc ma trận nào.',
        recommendation: 'Tạo ma trận từ đề hiện có hoặc thêm dòng phân bổ chuyên đề/mức độ.',
      });
    } else {
      const totalRequested = rules.reduce((sum, r) => sum + Math.max(0, r.count), 0);
      if (totalRequested === 0) {
        issues.push({
          id: 'matrix-zero',
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'matrix',
          message: 'Tổng số câu yêu cầu trong ma trận đang bằng 0.',
          recommendation: 'Nhập số lượng câu > 0 cho ít nhất một dòng ma trận.',
        });
      }

      const poolIdsUsed = new Set<string>();
      for (const rule of rules) {
        if (rule.count <= 0) continue;
        const eligible = exam.questions.filter(
          (q) =>
            !poolIdsUsed.has(q.id) &&
            (rule.universalType ? getUniversalQuestionType(q) === rule.universalType : q.type === rule.type) &&
            q.cognitiveLevel === rule.cognitiveLevel &&
            (rule.topic === 'Tất cả' || q.topic === rule.topic)
        );
        if (eligible.length < rule.count) {
          issues.push({
            id: `matrix-shortfall-${rule.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'matrix',
            message: `Thiếu câu cho ma trận [${MATH_QUESTION_TYPE_LABELS[rule.type]} · ${COGNITIVE_LEVEL_LABELS[rule.cognitiveLevel]} · ${rule.topic}]: cần ${rule.count} câu nhưng ngân hàng chỉ còn ${eligible.length} câu phù hợp.`,
            recommendation:
              'Bổ sung thêm câu hỏi vào ngân hàng hoặc giảm số câu yêu cầu (hệ thống không tự bịa câu).',
          });
        } else {
          eligible.slice(0, rule.count).forEach((q) => poolIdsUsed.add(q.id));
        }
      }
    }
  }

  return issues;
}

interface EffectiveMixRules {
  shuffleQuestions: boolean;
  shuffleMcqOptions: boolean;
  keepVdcPositions: boolean;
  shufflePerSectionOnly: boolean;
  shuffleIndependentTrueFalseStatements: boolean;
  lockedIds: Set<string>;
}

function applySubjectOverride(
  base: EffectiveMixRules,
  exam: MathExamProject
): EffectiveMixRules {
  const ov = exam.subjectProfileOverrides;
  if (!ov) return base;
  return {
    ...base,
    shuffleQuestions:
      typeof ov.shuffleQuestions === 'boolean' && exam.mixConfig.level > 0
        ? ov.shuffleQuestions
        : base.shuffleQuestions,
    shuffleMcqOptions:
      typeof ov.shuffleOptions === 'boolean' && exam.mixConfig.level >= 2
        ? ov.shuffleOptions
        : base.shuffleMcqOptions,
    shufflePerSectionOnly:
      typeof ov.shufflePerSectionOnly === 'boolean'
        ? ov.shufflePerSectionOnly
        : base.shufflePerSectionOnly,
  };
}

function getEffectiveRules(exam: MathExamProject): EffectiveMixRules {
  const cfg = exam.mixConfig;
  const lockedIds = new Set<string>(cfg.lockedQuestionIds);

  if (cfg.level === 0) {
    return {
      shuffleQuestions: false,
      shuffleMcqOptions: false,
      keepVdcPositions: true,
      shufflePerSectionOnly: true,
      shuffleIndependentTrueFalseStatements: false,
      lockedIds,
    };
  }
  if (cfg.level === 1) {
    return applySubjectOverride(
      {
        shuffleQuestions: true,
        shuffleMcqOptions: false,
        keepVdcPositions: false,
        shufflePerSectionOnly: true,
        shuffleIndependentTrueFalseStatements: false,
        lockedIds,
      },
      exam
    );
  }
  if (cfg.level === 2) {
    return applySubjectOverride(
      {
        shuffleQuestions: true,
        shuffleMcqOptions: true,
        keepVdcPositions: false,
        shufflePerSectionOnly: true,
        shuffleIndependentTrueFalseStatements: false,
        lockedIds,
      },
      exam
    );
  }
  if (cfg.level === 3) {
    return applySubjectOverride(
      {
        shuffleQuestions: true,
        shuffleMcqOptions: true,
        keepVdcPositions: false,
        shufflePerSectionOnly: true,
        shuffleIndependentTrueFalseStatements: false,
        lockedIds,
      },
      exam
    );
  }
  return applySubjectOverride(
    {
      shuffleQuestions: cfg.shuffleQuestions,
      shuffleMcqOptions: cfg.shuffleMcqOptions,
      keepVdcPositions: cfg.keepVdcPositions,
      shufflePerSectionOnly: cfg.shufflePerSectionOnly,
      shuffleIndependentTrueFalseStatements: cfg.shuffleIndependentTrueFalseStatements,
      lockedIds,
    },
    exam
  );
}

function selectQuestionsByMatrix(
  exam: MathExamProject,
  rng: () => number
): MathQuestion[] {
  const selected: MathQuestion[] = [];
  const usedIds = new Set<string>();

  for (const rule of exam.mixConfig.matrixRules) {
    if (rule.count <= 0) continue;
    const candidates = exam.questions.filter(
      (q) =>
        !usedIds.has(q.id) &&
        (rule.universalType ? getUniversalQuestionType(q) === rule.universalType : q.type === rule.type) &&
        q.cognitiveLevel === rule.cognitiveLevel &&
        (rule.topic === 'Tất cả' || q.topic === rule.topic)
    );
    const chosen = shuffleArrayWithRng(candidates, rng).slice(0, rule.count);
    chosen.forEach((q) => {
      usedIds.add(q.id);
      selected.push(q);
    });
  }

  return selected;
}

interface AtomicMixUnit {
  id: string;
  items: MathQuestion[];
  pinned: boolean;
}

/**
 * Gom nhóm câu hỏi thành các đơn vị nguyên tử (câu đơn hoặc nhóm câu chung dữ kiện/hình vẽ),
 * sau đó chỉ hoán vị các đơn vị tự do trong từng đoạn giữa các mốc khóa cố định để bảo toàn 100% vị trí khóa.
 */
function shuffleQuestionGroupSlice(
  slice: MathQuestion[],
  rules: EffectiveMixRules,
  groups: QuestionGroup[],
  rng: () => number
): MathQuestion[] {
  const isQuestionLocked = (q: MathQuestion) =>
    q.lockQuestionPosition ||
    rules.lockedIds.has(q.id) ||
    (rules.keepVdcPositions && q.cognitiveLevel === 'van-dung-cao');

  const groupMap = new Map<string, QuestionGroup>(groups.map((g) => [g.id, g]));
  const units: AtomicMixUnit[] = [];
  let cursor = 0;

  while (cursor < slice.length) {
    const current = slice[cursor];
    if (current.groupId && groupMap.has(current.groupId)) {
      const grp = groupMap.get(current.groupId)!;
      const memberSet = new Set(grp.questionIds);
      const contiguousItems: MathQuestion[] = [];
      while (cursor < slice.length && slice[cursor].groupId === grp.id && memberSet.has(slice[cursor].id)) {
        contiguousItems.push(slice[cursor]);
        cursor += 1;
      }
      const anyMemberLocked = contiguousItems.some(isQuestionLocked);
      units.push({
        id: `grp-${grp.id}`,
        items: contiguousItems,
        pinned: grp.lockGroupPosition || !grp.moveAsUnit || anyMemberLocked,
      });
    } else {
      units.push({
        id: current.id,
        items: [current],
        pinned: isQuestionLocked(current),
      });
      cursor += 1;
    }
  }

  // Nếu không có nhóm độ dài > 1, dùng shuffleWithPinnedSlots chuẩn trên đơn vị 1-1
  const hasMultiItemGroup = units.some((u) => u.items.length > 1);
  if (!hasMultiItemGroup) {
    return shuffleWithPinnedSlots(units, (u) => u.pinned, rng).flatMap((u) => u.items);
  }

  // Nếu có nhóm câu hỏi nhiều câu, chia thành các đoạn ngăn bởi đơn vị pinned để không làm trượt vị trí câu bị khóa
  const result: MathQuestion[] = [];
  let freeSegment: AtomicMixUnit[] = [];

  for (const unit of units) {
    if (unit.pinned) {
      if (freeSegment.length > 0) {
        const shuffledSeg = shuffleArrayWithRng(freeSegment, rng);
        shuffledSeg.forEach((u) => result.push(...u.items));
        freeSegment = [];
      }
      result.push(...unit.items);
    } else {
      freeSegment.push(unit);
    }
  }
  if (freeSegment.length > 0) {
    const shuffledSeg = shuffleArrayWithRng(freeSegment, rng);
    shuffledSeg.forEach((u) => result.push(...u.items));
  }

  return result;
}

function orderQuestions(
  questions: MathQuestion[],
  rules: EffectiveMixRules,
  groups: QuestionGroup[],
  rng: () => number
): MathQuestion[] {
  if (!rules.shuffleQuestions) {
    return [...questions];
  }

  if (!rules.shufflePerSectionOnly) {
    return shuffleQuestionGroupSlice(questions, rules, groups, rng);
  }

  const sectionOrder: string[] = [];
  const bySection = new Map<string, MathQuestion[]>();
  for (const q of questions) {
    const key = q.sectionTitle || q.type;
    if (!bySection.has(key)) {
      sectionOrder.push(key);
      bySection.set(key, []);
    }
    bySection.get(key)!.push(q);
  }

  const combined: MathQuestion[] = [];
  for (const sec of sectionOrder) {
    const groupSlice = bySection.get(sec)!;
    combined.push(...shuffleQuestionGroupSlice(groupSlice, rules, groups, rng));
  }
  return combined;
}

function mixSingleQuestion(
  orig: MathQuestion,
  origOrderNumber: number,
  newOrderNumber: number,
  rules: EffectiveMixRules,
  rng: () => number
): {
  mixedQuestion: MathQuestion;
  mapping: MixedQuestionMapping;
  answerRow: MixedExamAnswerRow;
  warnings: string[];
} {
  const cloned: MathQuestion = structuredClone(orig);
  const warnings: string[] = [];
  const uType = getUniversalQuestionType(orig);
  const lockedPositionApplied =
    orig.lockQuestionPosition ||
    rules.lockedIds.has(orig.id) ||
    (rules.keepVdcPositions && orig.cognitiveLevel === 'van-dung-cao');

  if (uType === 'multi-select') {
    const origOpts = cloned.multiSelectOptions ?? cloned.options ?? [];
    const depReasons = detectDependentOptions(origOpts);
    const canShuffleOpts =
      rules.shuffleMcqOptions && !orig.lockOptionShuffle && depReasons.length === 0;

    if (rules.shuffleMcqOptions && depReasons.length > 0 && !orig.lockOptionShuffle) {
      warnings.push(
        `Câu ${newOrderNumber} (${orig.code}) giữ nguyên thứ tự phương án vì: ${depReasons[0]}.`
      );
    }

    const finalOpts = canShuffleOpts
      ? shuffleWithPinnedSlots(origOpts, (opt) => Boolean(opt.lockPosition), rng)
      : [...origOpts];

    cloned.multiSelectOptions = finalOpts.map((o) => ({
      id: o.id,
      originalLabel: o.originalLabel,
      content: o.content,
      isCorrect: o.isCorrect,
      lockPosition: o.lockPosition,
    }));
    if (cloned.options) {
      cloned.options = finalOpts.map((o, idx) => ({
        id: o.id,
        originalLabel: (MCQ_LABELS[idx] ?? o.originalLabel) as McqOption['originalLabel'],
        content: o.content,
        isCorrect: o.isCorrect,
        lockPosition: o.lockPosition,
      }));
    }

    const correctIdSet = new Set(
      orig.correctOptionIds ?? origOpts.filter((o) => o.isCorrect).map((o) => o.id)
    );
    const multiSelectPermutation = finalOpts.map((opt, idx) => ({
      newLabel: getOptionLetterLabel(idx),
      originalLabel: opt.originalLabel,
      optionId: opt.id,
      isCorrect: correctIdSet.has(opt.id) || opt.isCorrect,
      locked: Boolean(opt.lockPosition) || !canShuffleOpts,
    }));

    const newCorrectLabels = multiSelectPermutation
      .filter((p) => p.isCorrect)
      .map((p) => p.newLabel);
    const answerText = newCorrectLabels.length > 0 ? newCorrectLabels.join(', ') : '?';

    return {
      mixedQuestion: cloned,
      mapping: {
        newOrderNumber,
        originalOrderNumber: origOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        sectionTitle: orig.sectionTitle,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        multiSelectPermutation,
        newCorrectLabels,
        exactAnswerSummary:
          newCorrectLabels.length > 0 ? `Đáp án ${answerText}` : 'Chưa xác định',
        lockedPositionApplied,
        lockedOptionShuffleApplied:
          !canShuffleOpts || origOpts.some((o) => Boolean(o.lockPosition)),
      },
      answerRow: {
        number: newOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: answerText,
      },
      warnings,
    };
  }

  if (orig.type === 'mcq') {
    const origOpts = cloned.options ?? [];
    const depReasons = detectDependentOptions(origOpts);
    const canShuffleAllOpts =
      rules.shuffleMcqOptions && !orig.lockOptionShuffle && depReasons.length === 0;

    if (rules.shuffleMcqOptions && depReasons.length > 0 && !orig.lockOptionShuffle) {
      warnings.push(
        `Câu ${newOrderNumber} (${orig.code}) giữ nguyên thứ tự A/B/C/D vì: ${depReasons[0]}.`
      );
    }

    // Hỗ trợ khóa vị trí TỪNG phương án (A/B/C/D) bằng shuffleWithPinnedSlots
    const finalOpts: McqOption[] = canShuffleAllOpts
      ? shuffleWithPinnedSlots(origOpts, (opt) => Boolean(opt.lockPosition), rng)
      : [...origOpts];

    cloned.options = finalOpts;

    const optionPermutation = finalOpts.map((opt, idx) => ({
      newLabel: MCQ_LABELS[idx],
      originalLabel: opt.originalLabel,
      optionId: opt.id,
      locked: Boolean(opt.lockPosition) || !canShuffleAllOpts,
    }));

    const correctIdx = finalOpts.findIndex((o) => o.id === orig.correctOptionId);
    const newCorrectLabel = correctIdx >= 0 ? MCQ_LABELS[correctIdx] : undefined;
    const origCorrectIdx = origOpts.findIndex((o) => o.id === orig.correctOptionId);
    const originalCorrectLabel = origCorrectIdx >= 0 ? MCQ_LABELS[origCorrectIdx] : undefined;

    const exactAnswerSummary = newCorrectLabel
      ? `Đáp án ${newCorrectLabel} (gốc ${originalCorrectLabel ?? '?'})`
      : 'Chưa xác định';

    return {
      mixedQuestion: cloned,
      mapping: {
        newOrderNumber,
        originalOrderNumber: origOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        sectionTitle: orig.sectionTitle,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        optionPermutation,
        newCorrectLabel,
        originalCorrectLabel,
        exactAnswerSummary,
        lockedPositionApplied,
        lockedOptionShuffleApplied:
          !canShuffleAllOpts || origOpts.some((o) => Boolean(o.lockPosition)),
      },
      answerRow: {
        number: newOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: newCorrectLabel ?? '?',
      },
      warnings,
    };
  }

  if (orig.type === 'true-false') {
    const origSts = cloned.statements ?? [];
    const depReasons = detectDependentStatements(origSts);
    const canShuffleSts =
      rules.shuffleIndependentTrueFalseStatements &&
      orig.allowStatementShuffle &&
      depReasons.length === 0;

    if (
      rules.shuffleIndependentTrueFalseStatements &&
      orig.allowStatementShuffle &&
      depReasons.length > 0
    ) {
      warnings.push(
        `Câu Đúng/Sai ${newOrderNumber} (${orig.code}) giữ nguyên thứ tự a/b/c/d vì phát hiện tham chiếu giữa các ý.`
      );
    }

    const finalSts: TrueFalseStatement[] = canShuffleSts
      ? shuffleArrayWithRng(origSts, rng)
      : [...origSts];
    cloned.statements = finalSts;

    const statementPermutation = finalSts.map((st, idx) => ({
      newLabel: TF_LABELS[idx],
      originalLabel: st.originalLabel,
      statementId: st.id,
      isTrue: st.isTrue,
    }));

    const answerSummary = statementPermutation
      .map((s) => `${s.newLabel}:${s.isTrue ? 'Đ' : 'S'}`)
      .join(' · ');

    return {
      mixedQuestion: cloned,
      mapping: {
        newOrderNumber,
        originalOrderNumber: origOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        sectionTitle: orig.sectionTitle,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        statementPermutation,
        exactAnswerSummary: answerSummary,
        lockedPositionApplied,
        lockedOptionShuffleApplied: !canShuffleSts,
      },
      answerRow: {
        number: newOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: answerSummary,
      },
      warnings,
    };
  }

  if (uType === 'fill-blank' && cloned.fillBlank) {
    // Khóa cứng thứ tự các chỗ trống {{1}}, {{2}}... trong đề; chỉ đảo Word Bank nếu có
    const wordBank = cloned.fillBlank.wordBank;
    let wordBankPermutation: MixedQuestionMapping['wordBankPermutation'];
    let canShuffleBank = false;
    if (wordBank && wordBank.length > 1) {
      canShuffleBank =
        rules.shuffleMcqOptions &&
        !orig.lockOptionShuffle &&
        cloned.fillBlank.allowShuffleWordBank !== false;
      const finalBank = canShuffleBank
        ? shuffleWithPinnedSlots(wordBank, (b) => Boolean(b.lockPosition), rng)
        : [...wordBank];
      cloned.fillBlank.wordBank = finalBank;
      wordBankPermutation = finalBank.map((item, idx) => ({
        newLabel: getOptionLetterLabel(idx),
        originalLabel: item.originalLabel,
        itemId: item.id,
      }));
    }

    const slotAnswers = cloned.fillBlank.slots
      .map((sl) => `(${sl.slotNumber}) ${sl.acceptedAnswers[0] ?? '?'}`)
      .join(' · ');
    const summary =
      slotAnswers || orig.shortAnswer?.answerValue?.trim() || 'Điền khuyết';

    return {
      mixedQuestion: cloned,
      mapping: {
        newOrderNumber,
        originalOrderNumber: origOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        sectionTitle: orig.sectionTitle,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        wordBankPermutation,
        exactAnswerSummary: summary,
        lockedPositionApplied,
        lockedOptionShuffleApplied: !canShuffleBank,
      },
      answerRow: {
        number: newOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: summary,
      },
      warnings,
    };
  }

  if (uType === 'matching' && cloned.matching) {
    const canShuffleRight =
      rules.shuffleMcqOptions &&
      !orig.lockOptionShuffle &&
      cloned.matching.allowShuffleRight;

    const finalRight = canShuffleRight
      ? shuffleArrayWithRng(cloned.matching.rightItems, rng)
      : [...cloned.matching.rightItems];
    cloned.matching.rightItems = finalRight;

    const newRightLabelById = new Map<string, string>();
    const matchingRightPermutation = finalRight.map((item, idx) => {
      const newLabel = getStatementLetterLabel(idx);
      newRightLabelById.set(item.id, newLabel);
      return {
        newLabel,
        originalLabel: item.originalLabel,
        rightItemId: item.id,
      };
    });

    const leftLabelById = new Map(
      cloned.matching.leftItems.map((item, idx) => [
        item.id,
        item.originalLabel || String(idx + 1),
      ])
    );

    const mappedPairs = cloned.matching.correctPairs
      .map((p) => ({
        leftLabel: leftLabelById.get(p.leftItemId) ?? '?',
        rightLabel: newRightLabelById.get(p.rightItemId) ?? '?',
        order: cloned.matching!.leftItems.findIndex((l) => l.id === p.leftItemId),
      }))
      .sort((a, b) => a.order - b.order)
      .map((p) => `${p.leftLabel}-${p.rightLabel}`);

    const summary = mappedPairs.join(', ') || orig.shortAnswer?.answerValue?.trim() || '?';

    return {
      mixedQuestion: cloned,
      mapping: {
        newOrderNumber,
        originalOrderNumber: origOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        sectionTitle: orig.sectionTitle,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        matchingRightPermutation,
        exactAnswerSummary: summary,
        lockedPositionApplied,
        lockedOptionShuffleApplied: !canShuffleRight,
      },
      answerRow: {
        number: newOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: summary,
      },
      warnings,
    };
  }

  if (uType === 'ordering' && cloned.ordering) {
    const canShuffleItems = rules.shuffleMcqOptions && !orig.lockOptionShuffle;
    const origItems = cloned.ordering.items;
    const finalItems = canShuffleItems
      ? shuffleArrayWithRng(origItems, rng)
      : [...origItems];
    cloned.ordering.items = finalItems;

    const usesNumericLabels = origItems.every((it) => /^\d+$/.test(it.originalLabel.trim()));
    const orderingPermutation = finalItems.map((item, idx) => ({
      newLabel: usesNumericLabels ? String(idx + 1) : getStatementLetterLabel(idx),
      originalLabel: item.originalLabel,
      itemId: item.id,
      correctRank: item.correctRank,
    }));

    const summary = [...orderingPermutation]
      .sort((a, b) => a.correctRank - b.correctRank)
      .map((p) => p.newLabel)
      .join(' → ');

    return {
      mixedQuestion: cloned,
      mapping: {
        newOrderNumber,
        originalOrderNumber: origOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        sectionTitle: orig.sectionTitle,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        orderingPermutation,
        exactAnswerSummary: summary,
        lockedPositionApplied,
        lockedOptionShuffleApplied: !canShuffleItems,
      },
      answerRow: {
        number: newOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: summary,
      },
      warnings,
    };
  }

  if (orig.type === 'short-answer') {
    const val = orig.shortAnswer?.answerValue?.trim() ?? '';
    const unit = orig.shortAnswer?.unit?.trim() ? ` ${orig.shortAnswer.unit.trim()}` : '';
    const summary = `${val}${unit}`;
    return {
      mixedQuestion: cloned,
      mapping: {
        newOrderNumber,
        originalOrderNumber: origOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        sectionTitle: orig.sectionTitle,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        exactAnswerSummary: summary,
        lockedPositionApplied,
        lockedOptionShuffleApplied: true,
      },
      answerRow: {
        number: newOrderNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: summary,
      },
      warnings,
    };
  }

  const totalPts =
    (orig.essayParts && orig.essayParts.length > 0
      ? orig.essayParts.reduce((s, p) => s + p.points, 0)
      : orig.points) || orig.points;
  const summary = `Tự luận (${totalPts} điểm)`;

  return {
    mixedQuestion: cloned,
    mapping: {
      newOrderNumber,
      originalOrderNumber: origOrderNumber,
      questionId: orig.id,
      originalCode: orig.code,
      sectionTitle: orig.sectionTitle,
      type: orig.type,
      universalType: uType,
      cognitiveLevel: orig.cognitiveLevel,
      topic: orig.topic,
      groupId: orig.groupId,
      exactAnswerSummary: summary,
      lockedPositionApplied,
      lockedOptionShuffleApplied: true,
    },
    answerRow: {
      number: newOrderNumber,
      questionId: orig.id,
      originalCode: orig.code,
      type: orig.type,
      universalType: uType,
      cognitiveLevel: orig.cognitiveLevel,
      answer: summary,
    },
    warnings,
  };
}

function buildVersionFingerprint(version: MixedExamVersion): string {
  return version.questions
    .map((q) => {
      const optIds = (q.multiSelectOptions ?? q.options ?? []).map((o) => o.id).join(',');
      const stIds = (q.statements ?? []).map((s) => s.id).join(',');
      const wbIds = (q.fillBlank?.wordBank ?? []).map((w) => w.id).join(',');
      const mrIds = (q.matching?.rightItems ?? []).map((r) => r.id).join(',');
      const ordIds = (q.ordering?.items ?? []).map((i) => i.id).join(',');
      return `${q.id}[${optIds}|${stIds}|${wbIds}|${mrIds}|${ordIds}]`;
    })
    .join(';');
}

function buildUnverifiedSingleVersion(
  exam: MathExamProject,
  code: string,
  seedString: string,
  rules: EffectiveMixRules
): MixedExamVersion {
  const rng = mulberry32(fnv1a32(seedString));
  const originalIndexById = new Map<string, number>();
  exam.questions.forEach((q, idx) => originalIndexById.set(q.id, idx + 1));

  const baseSelection =
    exam.mixConfig.level === 3
      ? selectQuestionsByMatrix(exam, rng)
      : [...exam.questions];

  const ordered = orderQuestions(
    baseSelection,
    rules,
    exam.questionGroups ?? [],
    rng
  );

  const mixedQuestions: MathQuestion[] = [];
  const permutationMap: MixedQuestionMapping[] = [];
  const answerKeyRows: MixedExamAnswerRow[] = [];
  const collectedWarnings = new Set<string>();

  ordered.forEach((origQ, idx) => {
    const newNumber = idx + 1;
    const origNum = originalIndexById.get(origQ.id) ?? newNumber;
    const result = mixSingleQuestion(origQ, origNum, newNumber, rules, rng);
    mixedQuestions.push(result.mixedQuestion);
    permutationMap.push(result.mapping);
    answerKeyRows.push(result.answerRow);
    result.warnings.forEach((w) => collectedWarnings.add(w));
  });

  return {
    code,
    seedUsed: seedString,
    generatedAt: new Date().toISOString(),
    questions: mixedQuestions,
    permutationMap,
    answerKeyRows,
    integrityPassed: true,
    integrityWarnings: Array.from(collectedWarnings),
  };
}

function finalizeVerifiedVersion(
  exam: MathExamProject,
  snapshot: OriginalExamSnapshot,
  version: MixedExamVersion
): MixedExamVersion {
  const verification = verifyMixedExamIntegrity(exam, version, snapshot);
  version.integrityPassed = verification.passed;
  version.integrityStatus = verification.status;
  version.integrityReport = verification.report;
  if (!verification.passed) {
    verification.issues
      .filter((i) => i.severity === 'error')
      .forEach((i) => version.integrityWarnings.push(i.message));
  }
  return version;
}

/**
 * Engine trộn đề đa môn học xác định (Deterministic Seeded Fisher-Yates + 5-Layer Universal Lock + Integrity Check 6.0).
 * Hỗ trợ tạo hàng loạt 2, 4, 10, 20, 40, 100+ (tối đa 200) mã đề phân biệt.
 */
export function generateMixedExams(exam: MathExamProject): {
  versions: MixedExamVersion[];
  snapshot: OriginalExamSnapshot | null;
  warnings: string[];
  errors: string[];
} {
  const configIssues = validateMixConfiguration(exam);
  const errors = configIssues.filter((i) => i.severity === 'error').map((i) => i.message);
  const warnings = configIssues
    .filter((i) => i.severity === 'warning')
    .map((i) => i.message);

  if (errors.length > 0) {
    return {
      versions: [],
      snapshot: null,
      warnings,
      errors,
    };
  }

  const snapshot = createOriginalExamSnapshot(exam);
  const codes = resolveExamCodes(exam);
  const rules = getEffectiveRules(exam);
  const baseSeed = exam.mixConfig.seed.trim() || 'teacheros-math-2025';
  const versions: MixedExamVersion[] = [];
  const seenFingerprints = new Set<string>();

  codes.forEach((code, idx) => {
    let chosenVersion: MixedExamVersion | null = null;
    const maxAttempts = rules.shuffleQuestions || rules.shuffleMcqOptions ? 40 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptSeed = `${baseSeed}::code=${code}::idx=${idx}::try=${attempt}`;
      const candidate = buildUnverifiedSingleVersion(exam, code, attemptSeed, rules);
      const fp = buildVersionFingerprint(candidate);

      if (!seenFingerprints.has(fp) || attempt === maxAttempts - 1) {
        if (seenFingerprints.has(fp) && exam.mixConfig.level > 0) {
          candidate.integrityWarnings.push(
            `Mã đề ${code} có cấu trúc trùng với một mã đề khác do ràng buộc khóa chặt hoặc số câu tự do quá ít.`
          );
        }
        seenFingerprints.add(fp);
        chosenVersion = finalizeVerifiedVersion(exam, snapshot, candidate);
        break;
      }
    }

    if (chosenVersion) {
      versions.push(chosenVersion);
    }
  });

  return {
    versions,
    snapshot,
    warnings,
    errors: [],
  };
}

/**
 * Phiên bản bất đồng bộ chia nhỏ tác vụ theo từng cụm mã đề để giữ mượt giao diện khi tạo 20–200 mã đề
 * và hỗ trợ hủy ngang (AbortSignal).
 */
export async function generateMixedExamsAsync(
  exam: MathExamProject,
  options?: {
    chunkSize?: number;
    onProgress?: (completed: number, total: number) => void;
    signal?: AbortSignal;
  }
): Promise<{
  versions: MixedExamVersion[];
  snapshot: OriginalExamSnapshot | null;
  warnings: string[];
  errors: string[];
  cancelled?: boolean;
}> {
  const configIssues = validateMixConfiguration(exam);
  const errors = configIssues.filter((i) => i.severity === 'error').map((i) => i.message);
  const warnings = configIssues
    .filter((i) => i.severity === 'warning')
    .map((i) => i.message);

  if (errors.length > 0) {
    return {
      versions: [],
      snapshot: null,
      warnings,
      errors,
    };
  }

  const snapshot = createOriginalExamSnapshot(exam);
  const codes = resolveExamCodes(exam);
  const rules = getEffectiveRules(exam);
  const baseSeed = exam.mixConfig.seed.trim() || 'teacheros-math-2025';
  const versions: MixedExamVersion[] = [];
  const seenFingerprints = new Set<string>();
  const chunkSize = Math.max(1, options?.chunkSize ?? 5);

  for (let idx = 0; idx < codes.length; idx++) {
    if (options?.signal?.aborted) {
      return {
        versions: [],
        snapshot: null,
        warnings,
        errors: [],
        cancelled: true,
      };
    }

    const code = codes[idx];
    let chosenVersion: MixedExamVersion | null = null;
    const maxAttempts = rules.shuffleQuestions || rules.shuffleMcqOptions ? 40 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptSeed = `${baseSeed}::code=${code}::idx=${idx}::try=${attempt}`;
      const candidate = buildUnverifiedSingleVersion(exam, code, attemptSeed, rules);
      const fp = buildVersionFingerprint(candidate);

      if (!seenFingerprints.has(fp) || attempt === maxAttempts - 1) {
        if (seenFingerprints.has(fp) && exam.mixConfig.level > 0) {
          candidate.integrityWarnings.push(
            `Mã đề ${code} có cấu trúc trùng với một mã đề khác do ràng buộc khóa chặt hoặc số câu tự do quá ít.`
          );
        }
        seenFingerprints.add(fp);
        chosenVersion = finalizeVerifiedVersion(exam, snapshot, candidate);
        break;
      }
    }

    if (chosenVersion) {
      versions.push(chosenVersion);
    }

    options?.onProgress?.(idx + 1, codes.length);
    if ((idx + 1) % chunkSize === 0 && idx + 1 < codes.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    versions,
    snapshot,
    warnings,
    errors: [],
  };
}

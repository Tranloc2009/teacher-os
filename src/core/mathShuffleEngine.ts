import {
  COGNITIVE_LEVEL_LABELS,
  ExamMatrixRule,
  MATH_QUESTION_TYPE_LABELS,
  MathExamProject,
  MathIntegrityIssue,
  MathQuestion,
  McqOption,
  MixConfig,
  MixLevel,
  MixedExamAnswerRow,
  MixedExamVersion,
  MixedQuestionMapping,
  OriginalExamSnapshot,
  QuestionGroup,
  QuestionShuffleEligibilityReport,
  QuestionShuffleSectionEligibility,
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
  isQuestionPositionLocked,
  resolveEffectiveMixFlags,
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
  keepDependentGroups: boolean;
  lockedIds: Set<string>;
}

/**
 * Cập nhật đồng bộ cấu hình khi giáo viên chọn preset Mức 0–4,
 * đảm bảo các công tắc độc lập shuffleQuestions / shuffleMcqOptions luôn khớp.
 */
export function applyMixLevelPreset(
  prev: MixConfig,
  level: MixLevel,
  questions: MathQuestion[]
): MixConfig {
  const nextMatrixRules =
    level === 3 && prev.matrixRules.length === 0
      ? buildDefaultMatrixRules(questions)
      : prev.matrixRules;

  if (level === 0) {
    return {
      ...prev,
      level: 0,
      shuffleQuestions: false,
      shuffleMcqOptions: false,
      keepVdcPositions: true,
      shuffleIndependentTrueFalseStatements: false,
      keepDependentGroups: prev.keepDependentGroups ?? true,
      matrixRules: nextMatrixRules,
    };
  }
  if (level === 1) {
    return {
      ...prev,
      level: 1,
      shuffleQuestions: true,
      shuffleMcqOptions: false,
      keepVdcPositions: false,
      shufflePerSectionOnly: true,
      keepDependentGroups: prev.keepDependentGroups ?? true,
      matrixRules: nextMatrixRules,
    };
  }
  if (level === 2) {
    return {
      ...prev,
      level: 2,
      shuffleQuestions: true,
      shuffleMcqOptions: true,
      keepVdcPositions: false,
      shufflePerSectionOnly: true,
      keepDependentGroups: prev.keepDependentGroups ?? true,
      matrixRules: nextMatrixRules,
    };
  }
  if (level === 3) {
    return {
      ...prev,
      level: 3,
      shuffleQuestions: true,
      shuffleMcqOptions: true,
      keepVdcPositions: false,
      shufflePerSectionOnly: true,
      keepDependentGroups: prev.keepDependentGroups ?? true,
      matrixRules: nextMatrixRules,
    };
  }
  return {
    ...prev,
    level: 4,
    keepDependentGroups: prev.keepDependentGroups ?? true,
    matrixRules: nextMatrixRules,
  };
}

/**
 * Cập nhật hai công tắc độc lập (Đảo thứ tự câu hỏi / Đảo phương án A/B/C/D) và các ràng buộc.
 * Hỗ trợ đầy đủ cả 4 tổ hợp:
 * - Chỉ đảo câu hỏi (Questions ON, Options OFF)
 * - Chỉ đảo phương án (Questions OFF, Options ON)
 * - Đảo cả câu hỏi và phương án (Both ON)
 * - Không đảo cả hai (Both OFF)
 */
export function applyMixToggleUpdate(
  prev: MixConfig,
  patch: Partial<
    Pick<
      MixConfig,
      | 'shuffleQuestions'
      | 'shuffleMcqOptions'
      | 'keepDependentGroups'
      | 'shufflePerSectionOnly'
      | 'keepVdcPositions'
      | 'shuffleIndependentTrueFalseStatements'
    >
  >
): MixConfig {
  const baseShuffleQ =
    prev.level === 0
      ? false
      : typeof prev.shuffleQuestions === 'boolean'
      ? prev.shuffleQuestions
      : true;
  const baseShuffleO =
    prev.level === 0 || prev.level === 1
      ? false
      : typeof prev.shuffleMcqOptions === 'boolean'
      ? prev.shuffleMcqOptions
      : true;

  const nextShuffleQ = patch.shuffleQuestions ?? baseShuffleQ;
  const nextShuffleO = patch.shuffleMcqOptions ?? baseShuffleO;
  const nextKeepGroups = patch.keepDependentGroups ?? (prev.keepDependentGroups ?? true);
  const nextPerSection = patch.shufflePerSectionOnly ?? prev.shufflePerSectionOnly;
  const nextKeepVdc = patch.keepVdcPositions ?? (prev.level === 0 ? false : prev.keepVdcPositions);
  const nextTf = patch.shuffleIndependentTrueFalseStatements ?? prev.shuffleIndependentTrueFalseStatements;

  let nextLevel: MixLevel;
  if (prev.level === 3) {
    nextLevel = 3;
  } else if (!nextShuffleQ && !nextShuffleO) {
    nextLevel = 0;
  } else if (
    nextShuffleQ &&
    !nextShuffleO &&
    !nextKeepVdc &&
    nextPerSection &&
    !nextTf &&
    nextKeepGroups
  ) {
    nextLevel = 1;
  } else if (
    nextShuffleQ &&
    nextShuffleO &&
    !nextKeepVdc &&
    nextPerSection &&
    !nextTf &&
    nextKeepGroups
  ) {
    nextLevel = 2;
  } else {
    nextLevel = 4;
  }

  return {
    ...prev,
    level: nextLevel,
    shuffleQuestions: nextShuffleQ,
    shuffleMcqOptions: nextShuffleO,
    keepDependentGroups: nextKeepGroups,
    shufflePerSectionOnly: nextPerSection,
    keepVdcPositions: nextKeepVdc,
    shuffleIndependentTrueFalseStatements: nextTf,
  };
}

function getEffectiveRules(exam: MathExamProject): EffectiveMixRules {
  const flags = resolveEffectiveMixFlags(exam);
  const lockedIds = new Set<string>(exam.mixConfig.lockedQuestionIds);
  return {
    ...flags,
    lockedIds,
  };
}

function factorialCappedLocal(n: number, cap = 100000): number {
  let res = 1;
  for (let i = 2; i <= n; i++) {
    res *= i;
    if (res >= cap) return cap;
  }
  return res;
}

interface AtomicMixUnit {
  id: string;
  items: MathQuestion[];
  pinned: boolean;
  group?: QuestionGroup;
}

function buildAtomicUnits(
  slice: MathQuestion[],
  rules: EffectiveMixRules,
  groups: QuestionGroup[]
): AtomicMixUnit[] {
  const isQLocked = (q: MathQuestion) =>
    isQuestionPositionLocked(q, rules.lockedIds, rules.keepVdcPositions);

  const activeGroups = rules.keepDependentGroups ? groups : [];
  const groupMap = new Map<string, QuestionGroup>(activeGroups.map((g) => [g.id, g]));
  const units: AtomicMixUnit[] = [];
  let cursor = 0;

  while (cursor < slice.length) {
    const current = slice[cursor];
    if (current.groupId && groupMap.has(current.groupId)) {
      const grp = groupMap.get(current.groupId)!;
      const memberSet = new Set(grp.questionIds);
      const contiguousItems: MathQuestion[] = [];
      while (
        cursor < slice.length &&
        slice[cursor].groupId === grp.id &&
        memberSet.has(slice[cursor].id)
      ) {
        contiguousItems.push(slice[cursor]);
        cursor += 1;
      }
      const anyMemberLocked = contiguousItems.some(isQLocked);
      units.push({
        id: `grp-${grp.id}`,
        items: contiguousItems,
        pinned: grp.lockGroupPosition || !grp.moveAsUnit || anyMemberLocked,
        group: grp,
      });
    } else {
      units.push({
        id: current.id,
        items: [current],
        pinned: isQLocked(current),
      });
      cursor += 1;
    }
  }

  return units;
}

function countSliceQuestionOrderPermutations(units: AtomicMixUnit[]): {
  swappableUnits: number;
  maxPermutations: number;
} {
  let maxPermutations = 1;
  let swappableUnits = 0;

  // Hoán vị nội bộ trong nhóm nếu lockInternalQuestionOrder === false
  for (const u of units) {
    if (u.group && u.group.lockInternalQuestionOrder === false && u.items.length > 1) {
      maxPermutations = Math.min(
        100000,
        maxPermutations * factorialCappedLocal(u.items.length, 100000)
      );
      swappableUnits += u.items.length;
    }
  }

  const hasMultiItemGroup = units.some((u) => u.items.length > 1);
  if (!hasMultiItemGroup) {
    const freeCount = units.filter((u) => !u.pinned).length;
    if (freeCount > 1) {
      maxPermutations = Math.min(100000, maxPermutations * factorialCappedLocal(freeCount, 100000));
      swappableUnits += freeCount;
    }
    return { swappableUnits, maxPermutations };
  }

  let segCount = 0;
  for (const u of units) {
    if (u.pinned) {
      if (segCount > 1) {
        maxPermutations = Math.min(100000, maxPermutations * factorialCappedLocal(segCount, 100000));
        swappableUnits += segCount;
      }
      segCount = 0;
    } else {
      segCount += 1;
    }
  }
  if (segCount > 1) {
    maxPermutations = Math.min(100000, maxPermutations * factorialCappedLocal(segCount, 100000));
    swappableUnits += segCount;
  }

  return { swappableUnits, maxPermutations };
}

/**
 * Phân tích chính xác số câu đủ điều kiện đảo thứ tự, số câu bị khóa, số nhóm phụ thuộc
 * và số hoán vị thứ tự câu tối đa theo từng phần (section) và toàn đề.
 */
export function analyzeQuestionShuffleEligibility(
  exam: MathExamProject
): QuestionShuffleEligibilityReport {
  const rules = getEffectiveRules(exam);
  const groups = exam.questionGroups ?? [];
  const isQLocked = (q: MathQuestion) =>
    isQuestionPositionLocked(q, rules.lockedIds, rules.keepVdcPositions);

  const sectionOrder: string[] = [];
  const bySection = new Map<string, MathQuestion[]>();

  for (const q of exam.questions) {
    const key = rules.shufflePerSectionOnly ? q.sectionTitle || q.type : 'Toàn bộ đề thi';
    if (!bySection.has(key)) {
      sectionOrder.push(key);
      bySection.set(key, []);
    }
    bySection.get(key)!.push(q);
  }

  const sections: QuestionShuffleSectionEligibility[] = [];
  let totalLocked = 0;
  let totalEligible = 0;
  let totalDependentGroups = 0;
  let totalSwappableUnits = 0;
  let maxQuestionPermutations = 1;

  for (const secTitle of sectionOrder) {
    const slice = bySection.get(secTitle)!;
    const units = buildAtomicUnits(slice, rules, groups);
    const lockedCount = slice.filter(isQLocked).length;
    const depGroupsInSec = units.filter((u) => Boolean(u.group)).length;
    const { swappableUnits, maxPermutations } = countSliceQuestionOrderPermutations(units);

    let eligibleInSec = 0;
    const hasMultiItemGroup = units.some((u) => u.items.length > 1);
    if (!hasMultiItemGroup) {
      const freeUnits = units.filter((u) => !u.pinned);
      if (freeUnits.length >= 2) {
        eligibleInSec = freeUnits.reduce((sum, u) => sum + u.items.length, 0);
      }
    } else {
      let segment: AtomicMixUnit[] = [];
      const flushSeg = () => {
        if (segment.length >= 2) {
          eligibleInSec += segment.reduce((sum, u) => sum + u.items.length, 0);
        } else if (segment.length === 1 && segment[0].group?.lockInternalQuestionOrder === false && segment[0].items.length >= 2) {
          eligibleInSec += segment[0].items.length;
        }
        segment = [];
      };
      for (const u of units) {
        if (u.pinned) {
          flushSeg();
          if (u.group?.lockInternalQuestionOrder === false && u.items.length >= 2) {
            eligibleInSec += u.items.length;
          }
        } else {
          segment.push(u);
        }
      }
      flushSeg();
    }

    sections.push({
      sectionTitle: secTitle,
      totalQuestions: slice.length,
      eligibleQuestions: eligibleInSec,
      lockedQuestions: lockedCount,
      dependentGroupCount: depGroupsInSec,
      swappableUnits,
      maxPermutations,
    });

    totalLocked += lockedCount;
    totalEligible += eligibleInSec;
    totalDependentGroups += depGroupsInSec;
    totalSwappableUnits += swappableUnits;
    maxQuestionPermutations = Math.min(100000, maxQuestionPermutations * maxPermutations);
  }

  const canChangeQuestionOrder = maxQuestionPermutations > 1;
  const warnings: string[] = [];

  if (rules.shuffleQuestions && exam.questions.length > 0 && !canChangeQuestionOrder) {
    warnings.push(
      'Không đủ câu độc lập để đảo: tất cả câu trong từng phần đều đang bị khóa vị trí, nằm trong cùng một nhóm phụ thuộc hoặc mỗi phần chỉ có 1 đơn vị câu.'
    );
  } else if (
    rules.shuffleQuestions &&
    canChangeQuestionOrder &&
    exam.mixConfig.examCount > maxQuestionPermutations
  ) {
    warnings.push(
      `Số mã đề yêu cầu (${exam.mixConfig.examCount}) vượt quá số hoán vị thứ tự câu tối đa (${maxQuestionPermutations}). Một số mã đề sẽ trùng thứ tự câu hỏi (nhưng vẫn cố gắng khác phương án nếu bật đảo A/B/C/D).`
    );
  }

  return {
    shuffleQuestionsEnabled: rules.shuffleQuestions,
    shuffleOptionsEnabled: rules.shuffleMcqOptions,
    keepDependentGroups: rules.keepDependentGroups,
    totalQuestions: exam.questions.length,
    eligibleQuestions: totalEligible,
    lockedQuestions: totalLocked,
    dependentGroupCount: totalDependentGroups,
    swappableUnits: totalSwappableUnits,
    maxQuestionPermutations,
    canChangeQuestionOrder,
    sections,
    warnings,
  };
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
  const units = buildAtomicUnits(slice, rules, groups).map((u) => {
    if (u.group && u.group.lockInternalQuestionOrder === false && u.items.length > 1) {
      return {
        ...u,
        items: shuffleArrayWithRng(u.items, rng),
      };
    }
    return u;
  });

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
  sectionQuestionNumber: number,
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
  const provenanceStatus = orig.answerProvenance?.status;
  const lockedPositionApplied = isQuestionPositionLocked(
    orig,
    rules.lockedIds,
    rules.keepVdcPositions
  );

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
      visualAsset: o.visualAsset,
    }));
    if (cloned.options) {
      cloned.options = finalOpts.map((o, idx) => ({
        id: o.id,
        originalLabel: (MCQ_LABELS[idx] ?? o.originalLabel) as McqOption['originalLabel'],
        content: o.content,
        isCorrect: o.isCorrect,
        lockPosition: o.lockPosition,
        visualAsset: o.visualAsset,
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
        sectionQuestionNumber,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        multiSelectPermutation,
        newCorrectLabels,
        exactAnswerSummary:
          newCorrectLabels.length > 0 ? `Đáp án ${answerText}` : 'Chưa xác định',
        answerProvenanceStatus: provenanceStatus,
        lockedPositionApplied,
        lockedOptionShuffleApplied:
          !canShuffleOpts || origOpts.some((o) => Boolean(o.lockPosition)),
      },
      answerRow: {
        number: newOrderNumber,
        sectionTitle: orig.sectionTitle,
        sectionQuestionNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: answerText,
        answerProvenanceStatus: provenanceStatus,
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
        sectionQuestionNumber,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        optionPermutation,
        newCorrectLabel,
        originalCorrectLabel,
        exactAnswerSummary,
        answerProvenanceStatus: provenanceStatus,
        lockedPositionApplied,
        lockedOptionShuffleApplied:
          !canShuffleAllOpts || origOpts.some((o) => Boolean(o.lockPosition)),
      },
      answerRow: {
        number: newOrderNumber,
        sectionTitle: orig.sectionTitle,
        sectionQuestionNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: newCorrectLabel ?? '?',
        answerProvenanceStatus: provenanceStatus,
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
        sectionQuestionNumber,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        statementPermutation,
        exactAnswerSummary: answerSummary,
        answerProvenanceStatus: provenanceStatus,
        lockedPositionApplied,
        lockedOptionShuffleApplied: !canShuffleSts,
      },
      answerRow: {
        number: newOrderNumber,
        sectionTitle: orig.sectionTitle,
        sectionQuestionNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: answerSummary,
        answerProvenanceStatus: provenanceStatus,
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
        sectionQuestionNumber,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        topic: orig.topic,
        groupId: orig.groupId,
        exactAnswerSummary: summary,
        answerProvenanceStatus: provenanceStatus,
        lockedPositionApplied,
        lockedOptionShuffleApplied: true,
      },
      answerRow: {
        number: newOrderNumber,
        sectionTitle: orig.sectionTitle,
        sectionQuestionNumber,
        questionId: orig.id,
        originalCode: orig.code,
        type: orig.type,
        universalType: uType,
        cognitiveLevel: orig.cognitiveLevel,
        answer: summary,
        answerProvenanceStatus: provenanceStatus,
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
      sectionQuestionNumber,
      type: orig.type,
      universalType: uType,
      cognitiveLevel: orig.cognitiveLevel,
      topic: orig.topic,
      groupId: orig.groupId,
      exactAnswerSummary: summary,
      answerProvenanceStatus: provenanceStatus,
      lockedPositionApplied,
      lockedOptionShuffleApplied: true,
    },
    answerRow: {
      number: newOrderNumber,
      sectionTitle: orig.sectionTitle,
      sectionQuestionNumber,
      questionId: orig.id,
      originalCode: orig.code,
      type: orig.type,
      universalType: uType,
      cognitiveLevel: orig.cognitiveLevel,
      answer: summary,
      answerProvenanceStatus: provenanceStatus,
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

export function buildVersionQuestionOrderSignature(
  questions: ReadonlyArray<Pick<MathQuestion, 'id'>>
): string {
  return questions.map((q) => q.id).join(',');
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

  const sectionCounters = new Map<string, number>();

  ordered.forEach((origQ, idx) => {
    const newNumber = idx + 1;
    const origNum = originalIndexById.get(origQ.id) ?? newNumber;
    const secKey = origQ.sectionTitle || origQ.type;
    const secNum = (sectionCounters.get(secKey) ?? 0) + 1;
    sectionCounters.set(secKey, secNum);
    const result = mixSingleQuestion(origQ, origNum, newNumber, secNum, rules, rng);
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
    questionOrderSignature: buildVersionQuestionOrderSignature(mixedQuestions),
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
 * Chọn ứng viên mã đề tốt nhất theo thứ tự ưu tiên:
 * - Tầng 1 (khi bật Đảo câu và đủ câu độc lập): khác thứ tự đề gốc, khác thứ tự câu của mọi mã trước đó, và khác fingerprint toàn phần.
 * - Tầng 2 (khi bật Đảo câu nhưng đã cạn hoán vị thứ tự câu khác đề gốc): chấp nhận khác thứ tự đề gốc (hoặc khác mã trước) và khác fingerprint toàn phần; cảnh báo rõ nếu trùng thứ tự câu với một mã trước đó.
 * - Tầng 3 (khi chỉ đảo phương án hoặc không đủ hoán vị thứ tự câu): ưu tiên khác fingerprint toàn phần; cảnh báo nếu trùng hoàn toàn.
 */
function selectBestCandidateForCode(params: {
  exam: MathExamProject;
  snapshot: OriginalExamSnapshot;
  code: string;
  idx: number;
  baseSeed: string;
  rules: EffectiveMixRules;
  originalOrderSig: string;
  canChangeQuestionOrder: boolean;
  seenFullFingerprints: Set<string>;
  seenQuestionOrderSignatures: Set<string>;
}): MixedExamVersion {
  const {
    exam,
    snapshot,
    code,
    idx,
    baseSeed,
    rules,
    originalOrderSig,
    canChangeQuestionOrder,
    seenFullFingerprints,
    seenQuestionOrderSignatures,
  } = params;

  const isAnyShuffleOn = rules.shuffleQuestions || rules.shuffleMcqOptions;
  const wantDistinctQuestionOrder = rules.shuffleQuestions && canChangeQuestionOrder;
  const maxAttempts = !isAnyShuffleOn ? 1 : wantDistinctQuestionOrder ? 80 : 40;

  let bestTier2DistinctFull: MixedExamVersion | null = null;
  let bestTier2DistinctOrderFromOrig: MixedExamVersion | null = null;
  let lastCandidate: MixedExamVersion | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = `${baseSeed}::code=${code}::idx=${idx}::try=${attempt}`;
    const candidate = buildUnverifiedSingleVersion(exam, code, attemptSeed, rules);
    const fullFp = buildVersionFingerprint(candidate);
    const qOrderSig = candidate.questionOrderSignature ?? buildVersionQuestionOrderSignature(candidate.questions);
    candidate.questionOrderSignature = qOrderSig;
    lastCandidate = candidate;

    const isDistinctFull = !seenFullFingerprints.has(fullFp);
    const isDistinctFromOriginalOrder = qOrderSig !== originalOrderSig;
    const isDistinctQuestionOrder = !seenQuestionOrderSignatures.has(qOrderSig);

    if (wantDistinctQuestionOrder) {
      if (isDistinctFromOriginalOrder && isDistinctQuestionOrder && isDistinctFull) {
        seenFullFingerprints.add(fullFp);
        seenQuestionOrderSignatures.add(qOrderSig);
        return finalizeVerifiedVersion(exam, snapshot, candidate);
      }
      if (!bestTier2DistinctOrderFromOrig && isDistinctQuestionOrder && isDistinctFull) {
        bestTier2DistinctOrderFromOrig = candidate;
      }
      if (!bestTier2DistinctFull && isDistinctFull) {
        bestTier2DistinctFull = candidate;
      }
    } else if (isDistinctFull) {
      seenFullFingerprints.add(fullFp);
      seenQuestionOrderSignatures.add(qOrderSig);
      return finalizeVerifiedVersion(exam, snapshot, candidate);
    }
  }

  const chosen = bestTier2DistinctOrderFromOrig ?? bestTier2DistinctFull ?? lastCandidate!;
  const chosenFullFp = buildVersionFingerprint(chosen);
  const chosenOrderSig = chosen.questionOrderSignature ?? buildVersionQuestionOrderSignature(chosen.questions);
  chosen.questionOrderSignature = chosenOrderSig;

  if (wantDistinctQuestionOrder && seenQuestionOrderSignatures.has(chosenOrderSig)) {
    const dupOrderMsg = `Mã đề ${code} có thứ tự câu hỏi trùng với một mã đề khác do giới hạn số hoán vị câu hỏi khả dụng.`;
    chosen.duplicateQuestionOrderWarning = dupOrderMsg;
    if (!chosen.integrityWarnings.includes(dupOrderMsg)) {
      chosen.integrityWarnings.push(dupOrderMsg);
    }
  } else if (wantDistinctQuestionOrder && chosenOrderSig === originalOrderSig) {
    const sameOrigMsg = `Mã đề ${code} giữ nguyên thứ tự câu như đề gốc do đã dùng hết các hoán vị thứ tự câu khác đề gốc.`;
    chosen.duplicateQuestionOrderWarning = sameOrigMsg;
    if (!chosen.integrityWarnings.includes(sameOrigMsg)) {
      chosen.integrityWarnings.push(sameOrigMsg);
    }
  }

  if (seenFullFingerprints.has(chosenFullFp) && isAnyShuffleOn) {
    const dupFullMsg = `Mã đề ${code} có cấu trúc trùng với một mã đề khác do ràng buộc khóa chặt hoặc số câu tự do quá ít.`;
    if (!chosen.integrityWarnings.includes(dupFullMsg)) {
      chosen.integrityWarnings.push(dupFullMsg);
    }
  }

  seenFullFingerprints.add(chosenFullFp);
  seenQuestionOrderSignatures.add(chosenOrderSig);
  return finalizeVerifiedVersion(exam, snapshot, chosen);
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
  const eligibility = analyzeQuestionShuffleEligibility(exam);
  const mergedWarnings = Array.from(new Set([...warnings, ...eligibility.warnings]));
  const baseSeed = exam.mixConfig.seed.trim() || 'teacheros-math-2025';
  const originalOrderSig = buildVersionQuestionOrderSignature(exam.questions);
  const versions: MixedExamVersion[] = [];
  const seenFullFingerprints = new Set<string>();
  const seenQuestionOrderSignatures = new Set<string>();

  codes.forEach((code, idx) => {
    const chosenVersion = selectBestCandidateForCode({
      exam,
      snapshot,
      code,
      idx,
      baseSeed,
      rules,
      originalOrderSig,
      canChangeQuestionOrder: eligibility.canChangeQuestionOrder,
      seenFullFingerprints,
      seenQuestionOrderSignatures,
    });
    versions.push(chosenVersion);
  });

  return {
    versions,
    snapshot,
    warnings: mergedWarnings,
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
  const eligibility = analyzeQuestionShuffleEligibility(exam);
  const mergedWarnings = Array.from(new Set([...warnings, ...eligibility.warnings]));
  const baseSeed = exam.mixConfig.seed.trim() || 'teacheros-math-2025';
  const originalOrderSig = buildVersionQuestionOrderSignature(exam.questions);
  const versions: MixedExamVersion[] = [];
  const seenFullFingerprints = new Set<string>();
  const seenQuestionOrderSignatures = new Set<string>();
  const chunkSize = Math.max(1, options?.chunkSize ?? 5);

  for (let idx = 0; idx < codes.length; idx++) {
    if (options?.signal?.aborted) {
      return {
        versions: [],
        snapshot: null,
        warnings: mergedWarnings,
        errors: [],
        cancelled: true,
      };
    }

    const code = codes[idx];
    const chosenVersion = selectBestCandidateForCode({
      exam,
      snapshot,
      code,
      idx,
      baseSeed,
      rules,
      originalOrderSig,
      canChangeQuestionOrder: eligibility.canChangeQuestionOrder,
      seenFullFingerprints,
      seenQuestionOrderSignatures,
    });
    versions.push(chosenVersion);

    options?.onProgress?.(idx + 1, codes.length);
    if ((idx + 1) % chunkSize === 0 && idx + 1 < codes.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    versions,
    snapshot,
    warnings: mergedWarnings,
    errors: [],
  };
}

export interface QuestionOrderDiagnosticRow {
  code: string;
  isOriginal: boolean;
  questionIds: string[];
  questionCodes: string[];
  changedPositionsCount: number;
  totalQuestions: number;
  sameAsOriginal: boolean;
  integrityStatus: 'PASS' | 'WARNING' | 'BLOCKED';
}

export interface QuestionOrderDiagnosticsReport {
  originalOrderIds: string[];
  originalOrderCodes: string[];
  rows: QuestionOrderDiagnosticRow[];
  shuffleQuestionsEnabled: boolean;
  shuffleOptionsEnabled: boolean;
  eligibleQuestions: number;
  lockedQuestions: number;
  dependentGroupCount: number;
  swappableUnits: number;
  anyVersionUnchanged: boolean;
  allVersionsUnchanged: boolean;
  nonShuffleReasons: string[];
}

/**
 * Trích xuất chẩn đoán thứ tự câu hỏi thực tế từ dữ liệu đề gốc và các mã đề đã sinh (không hardcode).
 * Nếu có mã đề không đổi thứ tự dù đã bật Đảo thứ tự câu hỏi, chỉ rõ nguyên nhân chính xác.
 */
export function buildQuestionOrderDiagnostics(
  exam: MathExamProject
): QuestionOrderDiagnosticsReport {
  const eligibility = analyzeQuestionShuffleEligibility(exam);
  const preMix = evaluatePreMixIntegrity(exam);
  const originalOrderIds = exam.questions.map((q) => q.id);
  const originalOrderCodes = exam.questions.map((q) => q.code);
  const totalQuestions = exam.questions.length;

  const rows: QuestionOrderDiagnosticRow[] = [
    {
      code: 'Gốc',
      isOriginal: true,
      questionIds: originalOrderIds,
      questionCodes: originalOrderCodes,
      changedPositionsCount: 0,
      totalQuestions,
      sameAsOriginal: true,
      integrityStatus: preMix.status,
    },
  ];

  for (const ver of exam.generatedVersions) {
    const qIds = ver.questions.map((q) => q.id);
    const qCodes = ver.questions.map((q) => q.code);
    let changed = 0;
    for (let i = 0; i < qIds.length; i++) {
      if (qIds[i] !== originalOrderIds[i]) {
        changed += 1;
      }
    }
    const status: 'PASS' | 'WARNING' | 'BLOCKED' =
      ver.integrityStatus ?? (ver.integrityPassed ? 'PASS' : 'BLOCKED');
    rows.push({
      code: ver.code,
      isOriginal: false,
      questionIds: qIds,
      questionCodes: qCodes,
      changedPositionsCount: changed,
      totalQuestions: qIds.length,
      sameAsOriginal: changed === 0,
      integrityStatus: status,
    });
  }

  const versionRows = rows.slice(1);
  const anyVersionUnchanged = versionRows.some((r) => r.sameAsOriginal);
  const allVersionsUnchanged = versionRows.length > 0 && versionRows.every((r) => r.sameAsOriginal);

  const nonShuffleReasons: string[] = [];
  if (!eligibility.shuffleQuestionsEnabled) {
    nonShuffleReasons.push('Chưa bật tùy chọn "Đảo thứ tự câu hỏi" (shuffleQuestions = false).');
  }
  if (preMix.status === 'BLOCKED') {
    const blockedCount = preMix.issues.filter((i) => i.severity === 'error').length;
    nonShuffleReasons.push(
      `Integrity validation đang chặn trộn (BLOCKED: ${blockedCount} lỗi nghiêm trọng).`
    );
  }
  if (totalQuestions < 2) {
    nonShuffleReasons.push(
      `Parser chỉ tách được ${totalQuestions} câu hỏi — không đủ tối thiểu 2 câu để đảo thứ tự.`
    );
  } else if (eligibility.shuffleQuestionsEnabled && !eligibility.canChangeQuestionOrder) {
    if (eligibility.lockedQuestions >= totalQuestions - 1) {
      nonShuffleReasons.push(
        `Đa số/tất cả câu đang bị khóa vị trí (${eligibility.lockedQuestions}/${totalQuestions} câu bị khóa).`
      );
    }
    if (eligibility.dependentGroupCount > 0) {
      nonShuffleReasons.push(
        `Nhóm phụ thuộc (${eligibility.dependentGroupCount} nhóm) đang gom các câu lại thành 1 khối duy nhất trong phần.`
      );
    }
    if (
      eligibility.sections.length > 0 &&
      eligibility.sections.every((s) => s.swappableUnits < 2)
    ) {
      nonShuffleReasons.push(
        'Mỗi phần hiện có dưới 2 đơn vị câu độc lập để đổi chỗ (hãy mở khóa câu, tách nhóm phụ thuộc hoặc tắt "Chỉ trộn trong từng phần").'
      );
    }
    if (nonShuffleReasons.length === 0) {
      nonShuffleReasons.push('Không đủ ít nhất 2 đơn vị câu độc lập để đảo thứ tự.');
    }
  } else if (eligibility.shuffleQuestionsEnabled && anyVersionUnchanged) {
    nonShuffleReasons.push(
      'Một mã đề có hoán vị trùng thứ tự gốc do số lượng hoán vị khả dụng ít hơn số mã đề cần tạo.'
    );
  }

  return {
    originalOrderIds,
    originalOrderCodes,
    rows,
    shuffleQuestionsEnabled: eligibility.shuffleQuestionsEnabled,
    shuffleOptionsEnabled: eligibility.shuffleOptionsEnabled,
    eligibleQuestions: eligibility.eligibleQuestions,
    lockedQuestions: eligibility.lockedQuestions,
    dependentGroupCount: eligibility.dependentGroupCount,
    swappableUnits: eligibility.swappableUnits,
    anyVersionUnchanged,
    allVersionsUnchanged,
    nonShuffleReasons,
  };
}


import {
  COGNITIVE_LEVEL_LABELS,
  MATH_QUESTION_TYPE_LABELS,
  MATH_SECTION_TITLES,
  type MathExamProject,
  type MathQuestion,
} from '../../types/mathExam';
import type {
  BankQuestionRecord,
  ExamBlueprintConfig,
  ExamGenerationReport,
  GeneratedDraftItem,
  GeneratedExamDraft,
  MatrixShortfallDetail,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import { buildDefaultMatrixRules } from '../mathShuffleEngine';
import { getSubjectProfile } from '../subjectProfileRegistry';
import { createSeededRng } from './seededPrng';
import {
  evaluateBankQuestionVariantSafety,
  generateVerifiedVariant,
} from './verifiedVariantEngine';
import { verifyDynamicGraphBinding } from './level3GraphTemplates';

/**
 * Gộp ngân hàng câu hỏi riêng của Smart Exam Generator với toàn bộ câu hỏi sẵn có
 * trong các dự án MathExamProject (chỉ đọc — KHÔNG BAO GIỜ ghi đè câu hỏi gốc).
 */
export function collectUnifiedQuestionBank(
  storedBank: readonly BankQuestionRecord[],
  mathExams: readonly MathExamProject[]
): BankQuestionRecord[] {
  const result: BankQuestionRecord[] = [];
  const seenIds = new Set<string>();

  for (const item of storedBank) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      result.push(structuredClone(item));
    }
  }

  for (const exam of mathExams) {
    const subjectId = exam.subjectId ?? 'toan';
    const subjectName = exam.subject || getSubjectProfile(subjectId).name;
    for (const q of exam.questions) {
      const mirroredId = `examq::${exam.id}::${q.id}`;
      if (seenIds.has(mirroredId) || seenIds.has(q.id)) continue;
      seenIds.add(mirroredId);

      const hasOmmlOrBinary =
        q.stem.blocks.some((b) => b.kind === 'omml-raw' || b.kind === 'mathml') ||
        (q.options ?? []).some((o) =>
          o.content.blocks.some((b) => b.kind === 'omml-raw' || b.kind === 'mathml')
        );
      const hasVisual =
        Boolean(q.hasVisualAsset) || Boolean(q.visualAssets && q.visualAssets.length > 0);

      result.push({
        id: mirroredId,
        code: q.code,
        subjectId,
        subjectName,
        grade: exam.grade,
        topic: q.topic,
        cognitiveLevel: q.cognitiveLevel,
        type: q.type,
        points: q.points,
        sourceKind: 'exam-project',
        sourceExamId: exam.id,
        sourceExamTitle: exam.title,
        hasBinaryFormulaOrOmml: hasOmmlOrBinary,
        hasNonUpdatableVisualAsset: hasVisual,
        question: structuredClone(q),
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      });
    }
  }

  return result;
}

export interface BuildExamsOptions {
  blueprint: ExamBlueprintConfig;
  bank: readonly BankQuestionRecord[];
  templates: readonly QuestionTemplateDefinition[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, message: string) => void;
}

export interface BuildExamsResult {
  drafts: GeneratedExamDraft[];
  cancelled: boolean;
}

function matchesTopicFilter(itemTopic: string, rowTopic: string, allowedTopics: string[]): boolean {
  if (rowTopic && rowTopic !== 'Tất cả') {
    return itemTopic === rowTopic;
  }
  if (allowedTopics.length > 0) {
    return allowedTopics.includes(itemTopic);
  }
  return true;
}

function generateSingleExamDraft(params: {
  draftNumber: number;
  blueprint: ExamBlueprintConfig;
  bank: readonly BankQuestionRecord[];
  templates: readonly QuestionTemplateDefinition[];
  globalUsedSignatures: Set<string>;
  globalUsedContentKeys: Set<string>;
}): GeneratedExamDraft {
  const {
    draftNumber,
    blueprint,
    bank,
    templates,
    globalUsedSignatures,
    globalUsedContentKeys,
  } = params;
  const draftSeed = `${blueprint.seed || 'TEACHEROS-2026'}::DRAFT-${draftNumber}`;
  const rng = createSeededRng(draftSeed);

  const templateById = new Map(templates.map((t) => [t.id, t]));
  const usedParentIdsInDraft = new Set<string>();
  const usedVariantIdsInDraft = new Set<string>();
  const usedTemplateCountInDraft = new Map<string, number>();

  const items: GeneratedDraftItem[] = [];
  const shortfalls: MatrixShortfallDetail[] = [];
  const warnings: string[] = [];

  let requestedTotal = 0;
  let originalCount = 0;
  let variantCount = 0;
  let reviewRequiredCount = 0;
  let unsupportedCount = 0;
  let blockedCount = 0;

  const subjectBank = bank.filter((b) => {
    if (blueprint.subjectId && b.subjectId !== blueprint.subjectId) return false;
    if (blueprint.selectedTypes.length > 0 && !blueprint.selectedTypes.includes(b.type)) {
      return false;
    }
    if (
      blueprint.selectedCognitiveLevels.length > 0 &&
      !blueprint.selectedCognitiveLevels.includes(b.cognitiveLevel)
    ) {
      return false;
    }
    return true;
  });

  const subjectTemplates = templates.filter((t) => {
    if (blueprint.subjectId && t.subjectId !== blueprint.subjectId) return false;
    if (blueprint.selectedTypes.length > 0 && !blueprint.selectedTypes.includes(t.questionType)) {
      return false;
    }
    if (
      blueprint.selectedCognitiveLevels.length > 0 &&
      !blueprint.selectedCognitiveLevels.includes(t.cognitiveLevel)
    ) {
      return false;
    }
    return true;
  });

  for (const row of blueprint.matrixRows) {
    const need = Math.max(0, Math.floor(row.count));
    if (need === 0) continue;
    requestedTotal += need;

    const targetVariantSlots =
      blueprint.mode === 'bank-only'
        ? 0
        : blueprint.mode === 'verified-variants'
        ? need
        : Math.round((need * Math.max(0, Math.min(100, blueprint.variantRatioPercent))) / 100);

    let fulfilledInRow = 0;
    let variantsInRow = 0;

    // Candidate verified templates for this matrix row
    const matchingTemplates = rng.shuffle(
      subjectTemplates.filter(
        (t) =>
          t.verifiedTemplate &&
          t.questionType === row.type &&
          t.cognitiveLevel === row.cognitiveLevel &&
          matchesTopicFilter(t.topic, row.topic, blueprint.selectedTopics)
      )
    );

    // Candidate original bank questions for this matrix row
    const matchingBankItems = rng.shuffle(
      subjectBank.filter(
        (b) =>
          b.type === row.type &&
          b.cognitiveLevel === row.cognitiveLevel &&
          matchesTopicFilter(b.topic, row.topic, blueprint.selectedTopics)
      )
    );

    // 1. Try filling variant slots (in verified-variants or hybrid mode)
    if (targetVariantSlots > 0) {
      let templateCursor = 0;
      let stallGuard = 0;
      while (
        variantsInRow < targetVariantSlots &&
        fulfilledInRow < need &&
        matchingTemplates.length > 0 &&
        stallGuard < matchingTemplates.length * 4
      ) {
        stallGuard += 1;
        const tpl = matchingTemplates[templateCursor % matchingTemplates.length];
        templateCursor += 1;

        const usedCountForTpl = usedTemplateCountInDraft.get(tpl.id) ?? 0;
        if (!blueprint.allowMultipleVariantsPerTemplate && usedCountForTpl >= 1) {
          continue;
        }

        // Check if linked source bank question is blocked by visual/OMML integrity
        if (tpl.sourceQuestionId) {
          const linkedBank = bank.find((b) => b.id === tpl.sourceQuestionId);
          if (linkedBank) {
            const safety = evaluateBankQuestionVariantSafety(linkedBank, tpl);
            if (!safety.canGenerateVariant) {
              blockedCount += 1;
              warnings.push(
                `Chặn đổi số cho "${tpl.title}": ${safety.reasons[0]}`
              );
              continue;
            }
          }
        }

        const variantSerial = draftNumber * 100 + usedCountForTpl + 1;
        const outcome = generateVerifiedVariant({
          template: tpl,
          seed: `${draftSeed}::row-${row.id}::slot-${fulfilledInRow + 1}`,
          variantIndex: variantSerial,
          parentQuestionId: tpl.sourceQuestionId ?? tpl.id,
          excludeSignatures: globalUsedSignatures,
        });

        if (outcome.ok && outcome.variant) {
          const v = outcome.variant;
          const templateScopedSig = `${tpl.id}::${v.parameterSignature}`;
          const contentKey = v.normalizedContentKey ?? `${tpl.id}::${v.parameterSignature}`;

          if (
            usedVariantIdsInDraft.has(v.id) ||
            globalUsedSignatures.has(templateScopedSig) ||
            globalUsedContentKeys.has(contentKey)
          ) {
            warnings.push(
              `Bỏ qua biến thể trùng lặp cho mẫu "${tpl.title}" (${v.parameterSignature}).`
            );
            continue;
          }

          const qCopy: MathQuestion = structuredClone(v.question);
          qCopy.points = row.pointsPerQuestion > 0 ? row.pointsPerQuestion : qCopy.points;

          globalUsedSignatures.add(v.parameterSignature);
          globalUsedSignatures.add(templateScopedSig);
          globalUsedContentKeys.add(contentKey);
          usedVariantIdsInDraft.add(v.id);
          usedTemplateCountInDraft.set(tpl.id, usedCountForTpl + 1);
          if (tpl.sourceQuestionId) {
            usedParentIdsInDraft.add(tpl.sourceQuestionId);
          }

          items.push({
            id: `draft-${draftNumber}-item-${items.length + 1}`,
            orderNumber: items.length + 1,
            origin: 'verified-variant',
            status: 'VARIANT_READY',
            parentQuestionId: v.parentQuestionId,
            templateId: tpl.id,
            variantId: v.id,
            variantCode: v.variantCode,
            parameterSignature: v.parameterSignature,
            parameterValues: v.parameterValues,
            graphFingerprint: v.graphFingerprint,
            functionAnalysis: v.functionAnalysis,
            variationTable: v.variationTable,
            verificationSummary: v.verification.independentCheckSummary,
            locked: false,
            teacherConfirmed: false,
            question: qCopy,
          });

          variantCount += 1;
          variantsInRow += 1;
          fulfilledInRow += 1;
        } else {
          blockedCount += 1;
          if (outcome.blockingReasons.length > 0) {
            warnings.push(
              `Mẫu "${tpl.title}" không sinh được biến thể: ${outcome.blockingReasons[0]}`
            );
          }
        }
      }
    }

    // 2. Fill remaining slots from original bank (for bank-only and hybrid modes)
    if (blueprint.mode !== 'verified-variants' && fulfilledInRow < need) {
      for (const bankRec of matchingBankItems) {
        if (fulfilledInRow >= need) break;
        if (usedParentIdsInDraft.has(bankRec.id)) continue;

        const linkedTemplate = bankRec.templateId
          ? templateById.get(bankRec.templateId)
          : undefined;
        const safety = evaluateBankQuestionVariantSafety(bankRec, linkedTemplate);

        // Original questions are ALWAYS safe to use unchanged (even with visual assets/OMML!)
        // We never mutate their text/XML/assets.
        const qCopy: MathQuestion = structuredClone(bankRec.question);
        qCopy.id = `orig-${draftNumber}-${items.length + 1}-${bankRec.question.id}`;
        qCopy.points = row.pointsPerQuestion > 0 ? row.pointsPerQuestion : qCopy.points;

        usedParentIdsInDraft.add(bankRec.id);

        const itemStatus = !qCopy.answerConfirmed
          ? 'REVIEW_REQUIRED'
          : safety.status === 'BLOCKED' || safety.status === 'UNSUPPORTED'
          ? 'ORIGINAL'
          : 'ORIGINAL';

        if (!qCopy.answerConfirmed) {
          reviewRequiredCount += 1;
        }
        if (safety.status === 'UNSUPPORTED') {
          unsupportedCount += 1;
        }
        if (safety.status === 'BLOCKED') {
          blockedCount += 1;
        }

        items.push({
          id: `draft-${draftNumber}-item-${items.length + 1}`,
          orderNumber: items.length + 1,
          origin: 'bank-original',
          status: itemStatus,
          parentQuestionId: bankRec.id,
          verificationSummary: qCopy.answerConfirmed
            ? 'Câu gốc từ ngân hàng (đã xác nhận đáp án — giữ nguyên 100% nội dung gốc).'
            : 'Câu gốc từ ngân hàng — giáo viên cần xác nhận lại đáp án trước khi xuất.',
          locked: false,
          teacherConfirmed: Boolean(qCopy.answerConfirmed),
          question: qCopy,
        });

        originalCount += 1;
        fulfilledInRow += 1;
      }
    }

    // 3. Honest shortfall report — NEVER fabricate fake questions!
    if (fulfilledInRow < need) {
      const missing = need - fulfilledInRow;
      shortfalls.push({
        rowId: row.id,
        topic: row.topic,
        type: row.type,
        cognitiveLevel: row.cognitiveLevel,
        requested: need,
        fulfilled: fulfilledInRow,
        shortfall: missing,
        reason:
          blueprint.mode === 'verified-variants'
            ? `Thiếu ${missing} biến thể kiểm chứng cho [${MATH_QUESTION_TYPE_LABELS[row.type]} · ${COGNITIVE_LEVEL_LABELS[row.cognitiveLevel]} · ${row.topic}]. Hãy tạo thêm mẫu tham số Level 1/2 hoặc chuyển sang chế độ Kết hợp (Hybrid).`
            : `Ngân hàng chỉ đủ ${fulfilledInRow}/${need} câu cho [${MATH_QUESTION_TYPE_LABELS[row.type]} · ${COGNITIVE_LEVEL_LABELS[row.cognitiveLevel]} · ${row.topic}]. Hệ thống không tự bịa thêm câu hỏi.`,
      });
    }
  }

  // Re-index order numbers cleanly by section type
  const typeOrder: Record<MathQuestion['type'], number> = {
    mcq: 1,
    'true-false': 2,
    'short-answer': 3,
    essay: 4,
  };
  items.sort((a, b) => typeOrder[a.question.type] - typeOrder[b.question.type]);
  items.forEach((item, idx) => {
    item.orderNumber = idx + 1;
    item.question.sectionTitle = MATH_SECTION_TITLES[item.question.type];
  });

  const totalPoints = Number(
    items.reduce((sum, item) => sum + (item.question.points || 0), 0).toFixed(2)
  );
  const allConfirmed =
    items.length > 0 && items.every((item) => item.teacherConfirmed);

  const now = new Date().toISOString();
  const report: ExamGenerationReport = {
    requestedTotal,
    generatedTotal: items.length,
    originalCount,
    variantCount,
    reviewRequiredCount,
    unsupportedCount,
    blockedCount,
    shortfalls,
    warnings: Array.from(new Set(warnings)),
    cancelled: false,
    seedUsed: draftSeed,
    generatedAt: now,
  };

  return {
    id: `gen-draft-${draftNumber}-${Date.now().toString(36)}-${rng.int(100, 999)}`,
    draftNumber,
    draftLabel: `Đề số ${draftNumber}`,
    title:
      blueprint.examDraftCount > 1
        ? `${blueprint.title.trim() || 'Đề kiểm tra tự động'} — Đề ${draftNumber}`
        : blueprint.title.trim() || 'Đề kiểm tra tự động',
    subjectId: blueprint.subjectId,
    subjectName: blueprint.subjectName,
    grade: blueprint.grade,
    durationMinutes: blueprint.durationMinutes,
    mode: blueprint.mode,
    seed: draftSeed,
    totalPoints,
    status: allConfirmed ? 'reviewed' : 'draft',
    allAnswersConfirmed: allConfirmed,
    items,
    report,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Synchronous deterministic exam generation (ideal for unit tests and fast batches).
 */
export function generateExamsFromBlueprint(
  options: Omit<BuildExamsOptions, 'signal' | 'onProgress'>
): GeneratedExamDraft[] {
  const count = Math.max(1, Math.min(10, options.blueprint.examDraftCount));
  const globalUsedSignatures = new Set<string>();
  const globalUsedContentKeys = new Set<string>();
  const drafts: GeneratedExamDraft[] = [];

  for (let i = 1; i <= count; i += 1) {
    drafts.push(
      generateSingleExamDraft({
        draftNumber: i,
        blueprint: options.blueprint,
        bank: options.bank,
        templates: options.templates,
        globalUsedSignatures,
        globalUsedContentKeys,
      })
    );
  }
  return drafts;
}

/**
 * Asynchronous cancellable exam generation with real progress reporting to keep UI responsive.
 */
export async function generateExamsFromBlueprintAsync(
  options: BuildExamsOptions
): Promise<BuildExamsResult> {
  const count = Math.max(1, Math.min(10, options.blueprint.examDraftCount));
  const globalUsedSignatures = new Set<string>();
  const globalUsedContentKeys = new Set<string>();
  const drafts: GeneratedExamDraft[] = [];

  for (let i = 1; i <= count; i += 1) {
    if (options.signal?.aborted) {
      return { drafts, cancelled: true };
    }
    options.onProgress?.(
      i - 1,
      count,
      `Đang sinh và kiểm chứng Đề số ${i}/${count}...`
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 16));
    if (options.signal?.aborted) {
      return { drafts, cancelled: true };
    }
    const draft = generateSingleExamDraft({
      draftNumber: i,
      blueprint: options.blueprint,
      bank: options.bank,
      templates: options.templates,
      globalUsedSignatures,
      globalUsedContentKeys,
    });
    drafts.push(draft);
    options.onProgress?.(
      i,
      count,
      `Đã hoàn tất kiểm chứng Đề số ${i}/${count} (${draft.items.length} câu).`
    );
  }

  return { drafts, cancelled: false };
}

/**
 * Chuyển đổi đề đã tạo & kiểm chứng từ Smart Exam Generator sang MathExamProject chuẩn
 * để bàn giao trực tiếp cho Exam Mixer Pro (tái sử dụng 100% Shuffle Engine hiện có)
 * và Smart Grading Studio.
 */
export function convertDraftToMathExamProject(
  draft: GeneratedExamDraft,
  options?: {
    examId?: string;
    examCount?: number;
    startCodeNumber?: number;
  }
): MathExamProject {
  const now = new Date().toISOString();
  const profile = getSubjectProfile(draft.subjectId);

  const questions: MathQuestion[] = draft.items.map((item, idx) => {
    const q: MathQuestion = structuredClone(item.question);
    q.code = item.variantCode ?? `C${String(idx + 1).padStart(2, '0')}`;
    q.answerConfirmed = Boolean(item.teacherConfirmed);
    q.lockQuestionPosition = Boolean(item.locked);
    q.updatedAt = now;
    return q;
  });

  const examCount = options?.examCount ?? 4;
  const startCodeNumber = options?.startCodeNumber ?? 101;
  const project: MathExamProject = {
    id: options?.examId ?? `gen-mexam-${draft.id}`,
    title: draft.title,
    subjectId: draft.subjectId,
    subject: draft.subjectName || profile.name,
    schemaVersion: '6.0',
    grade: draft.grade,
    durationMinutes: draft.durationMinutes,
    schoolYear: '2025 - 2026',
    examTypeLabel: 'Đề tạo tự động (Smart Exam Generator 2.0)',
    confirmedOriginalAnswers: draft.items.every((i) => i.teacherConfirmed),
    questions,
    mixConfig: {
      level: 2,
      examCount,
      startCodeNumber,
      customCodeNames: [],
      seed: draft.seed,
      shuffleQuestions: true,
      shuffleMcqOptions: true,
      keepDependentGroups: true,
      keepVdcPositions: false,
      shufflePerSectionOnly: true,
      shuffleIndependentTrueFalseStatements: false,
      preserveTopicRatios: true,
      lockedQuestionIds: questions
        .filter((q) => q.lockQuestionPosition)
        .map((q) => q.id),
      matrixRules: buildDefaultMatrixRules(questions),
    },
    generatedVersions: [],
    lastStep: 2,
    status: draft.allAnswersConfirmed ? 'ready' : 'draft',
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };

  return project;
}

/**
 * Kiểm tra cổng an toàn trước khi xuất Đáp án chính thức / chuyển Smart Grading Studio:
 * KHÔNG được xuất đáp án chính thức nếu giáo viên chưa xác nhận hết đáp án.
 */
export function canExportOfficialAnswerKey(draft: GeneratedExamDraft): {
  allowed: boolean;
  unconfirmedCount: number;
  reason?: string;
} {
  if (draft.items.length === 0) {
    return {
      allowed: false,
      unconfirmedCount: 0,
      reason: 'Đề chưa có câu hỏi nào để xuất đáp án.',
    };
  }
  // Phase 3 Dynamic Graph Binding Gate: BLOCK EXPORT — STALE GRAPH DATA
  for (const item of draft.items) {
    const binding = verifyDynamicGraphBinding({
      question: item.question,
      functionAnalysis: item.functionAnalysis,
      variationTable: item.variationTable,
      graphFingerprint: item.graphFingerprint,
    });
    if (!binding.valid) {
      return {
        allowed: false,
        unconfirmedCount: draft.items.filter((i) => !i.teacherConfirmed).length,
        reason: binding.reason ?? 'BLOCK EXPORT — STALE GRAPH DATA',
      };
    }
  }
  const unconfirmed = draft.items.filter((i) => !i.teacherConfirmed).length;
  if (unconfirmed > 0) {
    return {
      allowed: false,
      unconfirmedCount: unconfirmed,
      reason: `Còn ${unconfirmed}/${draft.items.length} câu hỏi chưa được giáo viên xác nhận đáp án. Vui lòng rà soát và xác nhận trước khi xuất đáp án chính thức hoặc tạo phiếu chấm OMR.`,
    };
  }
  return { allowed: true, unconfirmedCount: 0 };
}

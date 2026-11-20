import { COGNITIVE_LEVEL_LABELS, MATH_QUESTION_TYPE_LABELS } from '../../types/mathExam';
import type {
  BankQuestionRecord,
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import type {
  RetrievalAnswerConfidence,
  SmartRetrievalCandidate,
  SmartRetrievalQuery,
  SmartRetrievalResult,
} from '../../types/resourceIntelligence';
import { computeContentHash } from '../mathIntegrity';
import { evaluateBankQuestionVariantSafety } from './verifiedVariantEngine';

const VI_STOP_WORDS = new Set([
  'va', 'cua', 'cho', 'cac', 'mot', 'nhung', 'trong', 'theo', 'voi', 'la',
  'de', 'tu', 'den', 've', 'co', 'khong', 'hay', 'nao', 'sau', 'day', 'tim',
  'cau', 'hoi', 'bai', 'tap', 'kiem', 'tra', 'toan', 'hoc', 'lop', 'chuong',
]);

/**
 * Chuẩn hóa tiếng Việt có dấu / không dấu phục vụ tìm kiếm cục bộ (không dùng AI API).
 */
export function normalizeVietnameseText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9%\s/+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeVietnamese(input: string, dropStopWords = true): string[] {
  const norm = normalizeVietnameseText(input);
  if (!norm) return [];
  const rawTokens = norm.split(/\s+/).filter((t) => t.length >= 2);
  if (!dropStopWords) return rawTokens;
  const filtered = rawTokens.filter((t) => !VI_STOP_WORDS.has(t));
  return filtered.length > 0 ? filtered : rawTokens;
}

function buildSearchableText(item: BankQuestionRecord): string {
  const q = item.question;
  const optText = (q.options ?? []).map((o) => o.content.rawSource).join(' ');
  const stmtText = (q.statements ?? []).map((s) => s.content.rawSource).join(' ');
  const prov = item.sourceProvenance;
  return [
    item.code,
    item.subjectName,
    item.grade,
    item.topic,
    prov?.chapter ?? '',
    prov?.resourceTitle ?? item.sourceExamTitle ?? '',
    prov?.fileName ?? '',
    prov?.folderPath ?? '',
    q.stem.rawSource,
    optText,
    stmtText,
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizeGradeDigits(grade?: string): string {
  if (!grade) return '';
  const m = grade.match(/\d+/);
  return m ? m[0] : normalizeVietnameseText(grade);
}

function resolveAnswerConfidence(
  item: BankQuestionRecord,
  canVariant: boolean
): { confidence: RetrievalAnswerConfidence; label: string } {
  if (item.question.variantMeta?.verifiedAt || canVariant) {
    if (item.question.answerConfirmed) {
      return {
        confidence: 'verified-engine',
        label: 'Đáp án có kiểm chứng toán học',
      };
    }
  }
  if (item.question.answerConfirmed && item.sourceProvenance?.teacherEdited) {
    return {
      confidence: 'teacher-confirmed',
      label: 'Đáp án giáo viên đã duyệt',
    };
  }
  if (item.question.answerConfirmed) {
    if (item.sourceKind === 'resource-vault') {
      return {
        confidence: 'source-extracted',
        label: 'Đáp án trích từ tài liệu nguồn',
      };
    }
    return {
      confidence: 'teacher-confirmed',
      label: 'Đáp án đã xác nhận trong ngân hàng',
    };
  }
  return {
    confidence: 'unconfirmed',
    label: 'Chưa xác nhận đáp án (cần giáo viên duyệt)',
  };
}

function buildSourceLabel(item: BankQuestionRecord): string {
  if (item.sourceKind === 'resource-vault' && item.sourceProvenance) {
    const folder = item.sourceProvenance.folderPath
      ? `${item.sourceProvenance.folderPath} · `
      : '';
    const pageTag = item.sourceProvenance.sourcePage
      ? ` (Trang ${item.sourceProvenance.sourcePage})`
      : '';
    return `Resource Vault · ${folder}${item.sourceProvenance.fileName}${pageTag}`;
  }
  if (item.sourceKind === 'exam-project') {
    return `Exam Mixer · ${item.sourceExamTitle || 'Đề đã lưu'}`;
  }
  return `Ngân hàng câu hỏi · ${item.code}`;
}

function matchTopicsAndChapters(
  item: BankQuestionRecord,
  chaptersOrTopics: readonly string[]
): { matched: boolean; matchedLabels: string[]; exactMatch: boolean } {
  if (chaptersOrTopics.length === 0) {
    return { matched: true, matchedLabels: [], exactMatch: false };
  }
  const itemTopicNorm = normalizeVietnameseText(
    `${item.topic} ${item.sourceProvenance?.chapter ?? ''} ${item.sourceProvenance?.resourceTitle ?? ''} ${item.question.stem.rawSource}`
  );
  const itemTopicOnly = normalizeVietnameseText(
    `${item.topic} ${item.sourceProvenance?.chapter ?? ''}`
  );
  const matchedLabels: string[] = [];
  let exactMatch = false;

  for (const rawTarget of chaptersOrTopics) {
    const targetNorm = normalizeVietnameseText(rawTarget);
    if (!targetNorm || targetNorm === 'tat ca') {
      return { matched: true, matchedLabels: [], exactMatch: false };
    }
    if (itemTopicOnly.includes(targetNorm) || targetNorm.includes(itemTopicOnly)) {
      matchedLabels.push(rawTarget);
      exactMatch = true;
      continue;
    }
    const targetTokens = tokenizeVietnamese(rawTarget);
    if (
      targetTokens.length > 0 &&
      targetTokens.some((tok) => itemTopicNorm.includes(tok))
    ) {
      matchedLabels.push(rawTarget);
    }
  }

  return {
    matched: matchedLabels.length > 0,
    matchedLabels,
    exactMatch,
  };
}

/**
 * Tìm kiếm & xếp hạng câu hỏi 100% cục bộ bằng lọc metadata + chuẩn hóa tiếng Việt + BM25.
 * Phân biệt rõ điểm phù hợp nội dung (contentRelevancePercent) với độ tin cậy đáp án (answerConfidence).
 */
export function searchUnifiedQuestionPool(
  pool: readonly BankQuestionRecord[],
  templates: readonly QuestionTemplateDefinition[],
  query: SmartRetrievalQuery
): SmartRetrievalResult {
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const excludeIds = new Set(query.excludeIds ?? []);
  const excludeHashes = new Set(query.excludeContentHashes ?? []);
  const queryGradeDigits = normalizeGradeDigits(query.grade);
  const folderKeywordNorm = query.resourceFolderKeyword
    ? normalizeVietnameseText(query.resourceFolderKeyword)
    : '';
  const resourceIdSet =
    query.resourceIds && query.resourceIds.length > 0
      ? new Set(query.resourceIds)
      : null;

  // Step 1: Hard metadata filters
  const filtered: BankQuestionRecord[] = [];
  let blockedVariantCount = 0;

  for (const item of pool) {
    if (excludeIds.has(item.id)) continue;
    const itemHash =
      item.sourceProvenance?.contentHash ??
      computeContentHash(item.question.stem.rawSource.trim());
    if (excludeHashes.has(itemHash)) continue;

    if (query.subjectId && item.subjectId !== query.subjectId) continue;

    if (queryGradeDigits) {
      const itemGradeDigits = normalizeGradeDigits(item.grade);
      if (itemGradeDigits && itemGradeDigits !== queryGradeDigits) continue;
    }

    if (query.questionTypes && query.questionTypes.length > 0) {
      if (!query.questionTypes.includes(item.type)) continue;
    }

    if (query.cognitiveLevels && query.cognitiveLevels.length > 0) {
      if (!query.cognitiveLevels.includes(item.cognitiveLevel)) continue;
    }

    if (query.sourceKinds && query.sourceKinds.length > 0) {
      if (!query.sourceKinds.includes(item.sourceKind)) continue;
    }

    if (resourceIdSet) {
      const resId = item.sourceProvenance?.resourceId;
      if (!resId || !resourceIdSet.has(resId)) continue;
    }

    if (folderKeywordNorm && !resourceIdSet) {
      const hay = normalizeVietnameseText(
        `${item.sourceProvenance?.folderPath ?? ''} ${item.sourceProvenance?.resourceTitle ?? ''} ${item.sourceProvenance?.fileName ?? ''} ${item.subjectName} ${item.grade}`
      );
      if (!hay.includes(folderKeywordNorm)) continue;
    }

    const linkedTpl =
      item.templateId && templateById.has(item.templateId)
        ? templateById.get(item.templateId)
        : templates.find((t) => t.sourceQuestionId === item.id);
    const safety = evaluateBankQuestionVariantSafety(item, linkedTpl);
    if (!safety.canGenerateVariant) {
      blockedVariantCount += 1;
      if (query.onlyVariantCapable) continue;
    }

    filtered.push(item);
  }

  // Step 2: BM25 corpus statistics over filtered pool
  const queryTerms = Array.from(
    new Set([
      ...tokenizeVietnamese(query.queryText ?? ''),
      ...(query.chaptersOrTopics ?? []).flatMap((t) => tokenizeVietnamese(t)),
    ])
  );

  const docTokenLists = filtered.map((item) =>
    tokenizeVietnamese(buildSearchableText(item), false)
  );
  const avgDocLen =
    docTokenLists.length > 0
      ? docTokenLists.reduce((acc, d) => acc + d.length, 0) / docTokenLists.length
      : 1;

  const docFreq = new Map<string, number>();
  for (const term of queryTerms) {
    let df = 0;
    for (const tokens of docTokenLists) {
      if (tokens.includes(term)) df += 1;
    }
    docFreq.set(term, df);
  }

  const k1 = 1.5;
  const b = 0.75;
  const N = Math.max(1, filtered.length);

  // Step 3: Score & build transparent candidate explanations
  const rawCandidates: SmartRetrievalCandidate[] = [];

  filtered.forEach((item, idx) => {
    const tokens = docTokenLists[idx];
    const docLen = Math.max(1, tokens.length);
    const tfMap = new Map<string, number>();
    for (const tok of tokens) {
      tfMap.set(tok, (tfMap.get(tok) ?? 0) + 1);
    }

    let bm25 = 0;
    let matchedTermCount = 0;
    for (const term of queryTerms) {
      const tf = tfMap.get(term) ?? 0;
      if (tf > 0) {
        matchedTermCount += 1;
        const df = docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        bm25 += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLen) / avgDocLen)));
      }
    }

    const topicMatch = matchTopicsAndChapters(item, query.chaptersOrTopics ?? []);
    const matchedTemplate =
      item.templateId && templateById.has(item.templateId)
        ? templateById.get(item.templateId)
        : templates.find((t) => t.sourceQuestionId === item.id);
    const safety = evaluateBankQuestionVariantSafety(item, matchedTemplate);

    const reasons: string[] = [];
    if (query.subjectId) {
      reasons.push(`Khớp môn ${item.subjectName}${item.grade ? ` · ${item.grade}` : ''}`);
    }
    if (topicMatch.matchedLabels.length > 0) {
      reasons.push(
        `${topicMatch.exactMatch ? 'Khớp chủ đề' : 'Liên quan chủ đề'}: ${topicMatch.matchedLabels.join(', ')}`
      );
    }
    if (query.questionTypes && query.questionTypes.length > 0) {
      reasons.push(`Đúng loại câu: ${MATH_QUESTION_TYPE_LABELS[item.type]}`);
    }
    if (query.cognitiveLevels && query.cognitiveLevels.length > 0) {
      reasons.push(`Đúng mức độ: ${COGNITIVE_LEVEL_LABELS[item.cognitiveLevel]}`);
    }
    if (item.sourceKind === 'resource-vault' && item.sourceProvenance) {
      reasons.push(`Nguồn Resource Vault: ${item.sourceProvenance.fileName}`);
    }
    if (matchedTermCount > 0 && queryTerms.length > 0) {
      reasons.push(`Khớp ${matchedTermCount}/${queryTerms.length} từ khóa nội dung`);
    }
    if (safety.canGenerateVariant) {
      reasons.push(
        matchedTemplate
          ? `Hỗ trợ đổi số kiểm chứng (${matchedTemplate.code})`
          : 'Hỗ trợ sinh biến thể kiểm chứng'
      );
    }

    // Content relevance score (0..100), completely independent from answer confidence
    let relevance = 45; // base for passing metadata filters
    if (queryTerms.length > 0) {
      const termCoverage = matchedTermCount / queryTerms.length;
      relevance = Math.round(
        Math.min(
          100,
          20 +
            termCoverage * 45 +
            (topicMatch.exactMatch ? 25 : topicMatch.matched ? 15 : 0) +
            Math.min(15, bm25 * 4)
        )
      );
    } else if (topicMatch.exactMatch) {
      relevance = 95;
    } else if (topicMatch.matched) {
      relevance = 80;
    }

    const sourceBoost = item.sourceKind === 'resource-vault' ? 12 : 0;
    const topicBoost = topicMatch.exactMatch ? 22 : topicMatch.matched ? 10 : 0;
    const variantBoost = safety.canGenerateVariant ? 6 : 0;
    const totalScore = Number((bm25 * 10 + relevance * 0.6 + sourceBoost + topicBoost + variantBoost).toFixed(2));

    const { confidence, label } = resolveAnswerConfidence(item, safety.canGenerateVariant);

    rawCandidates.push({
      record: item,
      totalScore,
      contentRelevancePercent: relevance,
      answerConfidence: confidence,
      answerConfidenceLabel: label,
      matchReasons: reasons.length > 0 ? reasons : ['Phù hợp bộ lọc ma trận hiện tại'],
      canGenerateVariant: safety.canGenerateVariant,
      variantEligibilityReason: safety.reasons[0] ?? 'Đủ điều kiện kiểm chứng',
      matchedTemplateId: matchedTemplate?.id,
      sourceLabel: buildSourceLabel(item),
    });
  });

  // Sort by totalScore descending, tie-break by updatedAt
  rawCandidates.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.record.updatedAt.localeCompare(a.record.updatedAt);
  });

  // Step 4: Collapse near-exact duplicate stems deterministically
  const seenStemKeys = new Set<string>();
  const deduped: SmartRetrievalCandidate[] = [];
  let duplicateCollapsedCount = 0;

  for (const cand of rawCandidates) {
    const stemKey = normalizeVietnameseText(cand.record.question.stem.rawSource);
    const key = stemKey || cand.record.id;
    if (seenStemKeys.has(key)) {
      duplicateCollapsedCount += 1;
      continue;
    }
    seenStemKeys.add(key);
    deduped.push(cand);
  }

  const limit = query.limit && query.limit > 0 ? query.limit : deduped.length;

  return {
    candidates: deduped.slice(0, limit),
    totalPoolScanned: pool.length,
    filteredCount: filtered.length,
    duplicateCollapsedCount,
    blockedVariantCount,
  };
}

/**
 * Tìm câu hỏi thay thế tương đương tiêu chí ma trận (cùng môn, cùng loại câu, ưu tiên cùng mức độ & chủ đề).
 */
export function findEquivalentReplacements(
  target: BankQuestionRecord,
  pool: readonly BankQuestionRecord[],
  templates: readonly QuestionTemplateDefinition[],
  alreadySelectedIds: readonly string[],
  limit = 6
): SmartRetrievalCandidate[] {
  const strict = searchUnifiedQuestionPool(pool, templates, {
    subjectId: target.subjectId,
    grade: target.grade,
    questionTypes: [target.type],
    cognitiveLevels: [target.cognitiveLevel],
    chaptersOrTopics: [target.topic],
    excludeIds: [target.id, ...alreadySelectedIds],
    limit,
  });

  if (strict.candidates.length >= limit) {
    return strict.candidates;
  }

  const relaxed = searchUnifiedQuestionPool(pool, templates, {
    subjectId: target.subjectId,
    questionTypes: [target.type],
    excludeIds: [
      target.id,
      ...alreadySelectedIds,
      ...strict.candidates.map((c) => c.record.id),
    ],
    limit: limit - strict.candidates.length,
  });

  return [...strict.candidates, ...relaxed.candidates];
}

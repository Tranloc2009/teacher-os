import katex from 'katex';
import {
  DuplicateContentGroup,
  IntegrityCategorySummary,
  IntegrityPillarReport,
  MathContentBlock,
  MathContentPayload,
  MathExamProject,
  MathIntegrityIssue,
  MathIntegrityReport,
  MathIntegrityStatus,
  MathQuestion,
  MathVisualAsset,
  MathVisualAssetKind,
  McqOption,
  McqOptionLabel,
  MixedExamVersion,
  OriginalExamSnapshot,
  OriginalGroupFingerprint,
  OriginalQuestionFingerprint,
  QuestionGroup,
  TrueFalseLabel,
  TrueFalseStatement,
} from '../types/mathExam';

export const MCQ_LABELS: McqOptionLabel[] = ['A', 'B', 'C', 'D'];
export const TF_LABELS: TrueFalseLabel[] = ['a', 'b', 'c', 'd'];

export function getOptionLetterLabel(index: number): string {
  if (index >= 0 && index < 26) {
    return String.fromCharCode(65 + index);
  }
  return `O${index + 1}`;
}

export function getStatementLetterLabel(index: number): string {
  if (index >= 0 && index < 26) {
    return String.fromCharCode(97 + index);
  }
  return `s${index + 1}`;
}

export const MATH_SAFETY_LIMITATION_NOTICE =
  'Giới hạn kiểm chứng: Kiểm tra hash nội dung, render KaTeX và ánh xạ ID chỉ bảo đảm dữ liệu không bị sai lệch khi lưu hoặc trộn đề, KHÔNG thể tự chứng minh lời giải hay đáp án gốc đúng về mặt toán học. Giáo viên cần xác nhận đề gốc trước khi xuất bản.';

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

export function sanitizeSvgSource(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<script[\s\S]*?\/>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');
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
 * Chuẩn hóa nội dung câu hỏi để phát hiện câu bị nhân bản/trùng nội dung giữa các ID khác nhau
 * (VD: đề nguồn lặp lại câu từ phần lời giải hoặc nhập chồng 2 lần).
 */
export function computeNormalizedQuestionSignature(q: MathQuestion): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\[\[asset:[^\]]+\]\]/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/^câu\s+\d+\s*[.:]\s*/i, '')
      .trim();

  const stemNorm = norm(q.stem?.rawSource ?? '');
  if (!stemNorm) return '';

  const bodyPieces: string[] = [q.type, stemNorm];
  if (q.type === 'mcq' && q.options) {
    bodyPieces.push(
      ...q.options.map((o) => norm(o.content?.rawSource ?? '') || (o.visualAsset?.checksum ?? ''))
    );
  } else if (q.type === 'true-false' && q.statements) {
    bodyPieces.push(...q.statements.map((s) => norm(s.content?.rawSource ?? '')));
  } else if (q.type === 'short-answer') {
    bodyPieces.push(norm(q.shortAnswer?.answerValue ?? ''));
  }

  return computeContentHash(bodyPieces.join('||'));
}

/**
 * Phương án được xem là có nội dung hợp lệ nếu:
 * - Có tài nguyên hình ảnh/đồ thị hợp lệ (`visualAsset.sourceData`), HOẶC
 * - Có ít nhất một ký tự chữ/số/biểu thức toán (`A-Za-zÀ-ỹ0-9$` hoặc lệnh `\`).
 * Ngược lại (trống hoặc chỉ có dấu câu như `.` / `,` / `...`) sẽ bị CHẶN.
 */
export function hasMeaningfulOptionContent(
  opt: Pick<McqOption, 'content' | 'visualAsset'>
): boolean {
  if (opt.visualAsset && opt.visualAsset.sourceData.trim().length > 0) {
    return true;
  }
  const raw = (opt.content?.rawSource ?? '').trim();
  if (!raw) return false;
  return /[A-Za-zÀ-ỹ0-9$\\]/.test(raw);
}

/**
 * Dựng lại tiêu đề và phần hướng dẫn số câu của mỗi Phần theo đúng số câu thực tế
 * có trong phiên bản đề xuất ra (tránh tiêu đề ghi "từ câu 1 đến câu 12" trong khi
 * phần đó thực tế có số câu khác sau lọc/chỉnh sửa).
 */
export function formatVerifiedSectionHeading(
  rawSectionTitle: string,
  startOrder: number,
  endOrder: number,
  actualCount: number
): string {
  const cleaned = (rawSectionTitle || '').trim();
  if (!cleaned || actualCount <= 0) return cleaned;

  let rewritten = cleaned;
  // Cập nhật cụm "từ câu X đến câu Y" hoặc "câu X đến câu Y"
  rewritten = rewritten.replace(
    /(từ\s+câu\s+)\d+(\s+đến\s+(?:câu\s+)?)\d+/gi,
    `$1${startOrder}$2${endOrder}`
  );
  // Cập nhật cụm "(gồm N câu)" / "(N câu)" / "gồm N câu"
  rewritten = rewritten.replace(
    /(\(\s*(?:gồm\s+)?)(\d+)(\s*câu\s*\))/gi,
    `$1${actualCount}$3`
  );
  rewritten = rewritten.replace(
    /(\bgồm\s+)\d+(\s+câu\b)/gi,
    `$1${actualCount}$2`
  );
  return rewritten;
}

export function detectDuplicateQuestionGroups(questions: MathQuestion[]): DuplicateContentGroup[] {
  const bySig = new Map<string, MathQuestion[]>();
  for (const q of questions) {
    const sig = q.contentSignature || computeNormalizedQuestionSignature(q);
    if (!sig) continue;
    const list = bySig.get(sig) ?? [];
    list.push(q);
    bySig.set(sig, list);
  }
  const groups: DuplicateContentGroup[] = [];
  for (const [signature, list] of bySig.entries()) {
    const distinctIds = Array.from(new Set(list.map((q) => q.id)));
    if (distinctIds.length >= 2) {
      groups.push({
        signature,
        questionIds: list.map((q) => q.id),
        questionCodes: list.map((q) => q.code),
        stemPreview: (list[0].stem?.rawSource ?? '').replace(/\s+/g, ' ').trim().slice(0, 90),
      });
    }
  }
  return groups;
}

export function computeVisualAssetChecksum(
  asset: Pick<MathVisualAsset, 'kind' | 'label' | 'sourceData'>
): string {
  return computeContentHash(`${asset.kind}::${asset.label}::${asset.sourceData}`);
}

export function verifyVisualAssetIntegrity(
  asset: MathVisualAsset
): { valid: boolean; expectedChecksum: string; hasSourceData: boolean } {
  const hasSourceData = Boolean(asset.sourceData && asset.sourceData.trim());
  const expectedChecksum = computeVisualAssetChecksum(asset);
  const valid = hasSourceData && (!asset.checksum || asset.checksum === expectedChecksum);
  return { valid, expectedChecksum, hasSourceData };
}

export function createMathVisualAsset(params: {
  id: string;
  kind: MathVisualAssetKind;
  label: string;
  sourceData: string;
  altText?: string;
  required?: boolean;
  sourcePartPath?: string;
  sourceRelationshipId?: string;
  sourceOrdinal?: number;
  sourceLocation?: string;
}): MathVisualAsset {
  const safeData =
    params.sourceData.trim().startsWith('<svg') || params.sourceData.toLowerCase().includes('<svg')
      ? sanitizeSvgSource(params.sourceData)
      : params.sourceData;
  return {
    id: params.id,
    kind: params.kind,
    label: params.label,
    sourceData: safeData,
    altText: params.altText ?? params.label,
    required: params.required ?? true,
    checksum: computeVisualAssetChecksum({
      kind: params.kind,
      label: params.label,
      sourceData: safeData,
    }),
    contentHash: computeContentHash(safeData),
    ...(params.sourcePartPath ? { sourcePartPath: params.sourcePartPath } : {}),
    ...(params.sourceRelationshipId ? { sourceRelationshipId: params.sourceRelationshipId } : {}),
    ...(params.sourceOrdinal !== undefined ? { sourceOrdinal: params.sourceOrdinal } : {}),
    ...(params.sourceLocation ? { sourceLocation: params.sourceLocation } : {}),
  };
}

function normalizeViForRuleCheck(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tách chuỗi hỗn hợp văn bản tiếng Việt + công thức LaTeX ($...$ và $$...$$)
 * thành các khối dữ liệu bất biến. TUYỆT ĐỐI không sửa đổi ký tự toán học.
 */
export function parseMathContent(rawSource: string, blockPrefix = 'blk'): MathContentPayload {
  const source = typeof rawSource === 'string' ? rawSource : '';
  if (!source) {
    return {
      rawSource: '',
      blocks: [],
    };
  }

  const blocks: MathContentBlock[] = [];
  let cursor = 0;
  let blockIdx = 0;

  while (cursor < source.length) {
    if (source[cursor] === '$' && source[cursor + 1] === '$') {
      const closeIdx = source.indexOf('$$', cursor + 2);
      if (closeIdx !== -1) {
        const latexContent = source.slice(cursor + 2, closeIdx);
        blocks.push({
          id: `${blockPrefix}-${++blockIdx}`,
          kind: 'latex',
          content: latexContent,
          displayMode: true,
        });
        cursor = closeIdx + 2;
        continue;
      }
    }

    if (source[cursor] === '$' && (cursor === 0 || source[cursor - 1] !== '\\')) {
      let searchFrom = cursor + 1;
      let closeIdx = -1;
      while (searchFrom < source.length) {
        const candidate = source.indexOf('$', searchFrom);
        if (candidate === -1) break;
        if (source[candidate - 1] !== '\\' && source[candidate + 1] !== '$') {
          closeIdx = candidate;
          break;
        }
        searchFrom = candidate + 1;
      }
      if (closeIdx !== -1) {
        const latexContent = source.slice(cursor + 1, closeIdx);
        blocks.push({
          id: `${blockPrefix}-${++blockIdx}`,
          kind: 'latex',
          content: latexContent,
          displayMode: false,
        });
        cursor = closeIdx + 1;
        continue;
      }
    }

    let nextMath = -1;
    let scan = cursor;
    while (scan < source.length) {
      if (source[scan] === '$' && (scan === 0 || source[scan - 1] !== '\\')) {
        nextMath = scan;
        break;
      }
      scan += 1;
    }

    if (nextMath === -1) {
      blocks.push({
        id: `${blockPrefix}-${++blockIdx}`,
        kind: 'text',
        content: source.slice(cursor),
      });
      break;
    } else if (nextMath === cursor) {
      blocks.push({
        id: `${blockPrefix}-${++blockIdx}`,
        kind: 'text',
        content: '$',
      });
      cursor += 1;
    } else {
      blocks.push({
        id: `${blockPrefix}-${++blockIdx}`,
        kind: 'text',
        content: source.slice(cursor, nextMath),
      });
      cursor = nextMath;
    }
  }

  return {
    rawSource: source,
    blocks,
  };
}

const DEPENDENT_OPTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bca\s*(?:2|hai)?\s*(?:dap an|phuong an|y)?\s*a\s*(?:va|,|&)\s*b\b/i,
    reason: 'Chứa phương án phụ thuộc "Cả A và B"',
  },
  {
    pattern: /\bca\s*(?:2|hai|ba|bon)?\s*(?:dap an|phuong an)\s*(?:tren|neu tren|a, b, c)\b/i,
    reason: 'Chứa phương án tham chiếu vị trí ("Cả ... phương án trên")',
  },
  {
    pattern: /\btat ca\s*(?:cac\s*)?(?:dap an|phuong an|cau|y)\s*(?:tren|deu dung|deu sai)?\b/i,
    reason: 'Chứa phương án "Tất cả các đáp án trên"',
  },
  {
    pattern: /\bkhong co\s*(?:dap an|phuong an)\s*(?:nao\s*)?(?:dung|o tren)\b/i,
    reason: 'Chứa phương án "Không có đáp án nào đúng"',
  },
  {
    pattern: /\b(?:dap an|phuong an)\s*(?:a|b|c)\s*(?:va|hoac)\s*(?:b|c|d)\b/i,
    reason: 'Tham chiếu chéo trực tiếp nhãn phương án (A/B/C/D)',
  },
  {
    pattern: /\bboth\s+[abcd]\s+and\s+[abcd]\b/i,
    reason: 'Chứa phương án phụ thuộc tiếng Anh ("Both A and B")',
  },
  {
    pattern: /\b(?:all|none)\s+of\s+the\s+(?:above|options|statements|choices)\b/i,
    reason: 'Chứa phương án phụ thuộc vị trí ("All/None of the above")',
  },
  {
    pattern: /\bneither\s+[abcd]\s+nor\s+[abcd]\b/i,
    reason: 'Chứa phương án phụ thuộc tiếng Anh ("Neither A nor B")',
  },
  {
    pattern: /\beither\s+[abcd]\s+or\s+[abcd]\b/i,
    reason: 'Chứa phương án phụ thuộc tiếng Anh ("Either A or B")',
  },
  {
    pattern: /\b(?:options?|choices?|answers?)\s+[abcd]\s+(?:and|or)\s+[abcd]\b/i,
    reason: 'Tham chiếu chéo nhãn phương án tiếng Anh (A/B/C/D)',
  },
];

export function detectDependentOptions(
  options: Array<{ content: MathContentPayload }>
): string[] {
  const reasons = new Set<string>();
  for (const opt of options) {
    const normalized = normalizeViForRuleCheck(opt.content.rawSource);
    for (const rule of DEPENDENT_OPTION_PATTERNS) {
      if (rule.pattern.test(normalized)) {
        reasons.add(rule.reason);
      }
    }
  }
  return Array.from(reasons);
}

export function detectDependentStatements(statements: TrueFalseStatement[]): string[] {
  const reasons = new Set<string>();
  for (const st of statements) {
    const normalized = normalizeViForRuleCheck(st.content.rawSource);
    if (
      /\b(tu|theo|dua vao)\s*(y|cau|menh de)\s*[abcd]\b/.test(normalized) ||
      /\b(tu|theo)\s*\([abcd]\)/.test(normalized) ||
      /\bket qua (o )?(y|tren)\b/.test(normalized) ||
      /\btu do suy ra\b/.test(normalized)
    ) {
      reasons.add('Ý Đúng/Sai có tham chiếu suy luận từ ý khác');
    }
  }
  return Array.from(reasons);
}

const MAX_LATEX_SYNTAX_CACHE = 2500;
const latexSyntaxCache = new Map<string, string[]>();

/**
 * Kiểm tra lỗi đóng mở dấu $, ngoặc {} và cú pháp KaTeX (có cache theo rawSource để đạt tốc độ cao khi trộn 100+ mã đề).
 */
export function checkLatexSyntaxWarnings(rawSource: string): string[] {
  if (!rawSource) return [];
  const cached = latexSyntaxCache.get(rawSource);
  if (cached) {
    return [...cached];
  }

  const warnings: string[] = [];

  let singleDollarCount = 0;
  let i = 0;
  while (i < rawSource.length) {
    if (rawSource[i] === '\\') {
      i += 2;
      continue;
    }
    if (rawSource[i] === '$') {
      if (rawSource[i + 1] === '$') {
        i += 2;
        continue;
      }
      singleDollarCount += 1;
    }
    i += 1;
  }

  const displayMatches = rawSource.match(/\$\$/g);
  const displayCount = displayMatches ? displayMatches.length : 0;
  if (displayCount % 2 !== 0) {
    warnings.push('Cặp dấu công thức khối $$...$$ chưa đóng mở cân đối.');
  }
  if (singleDollarCount % 2 !== 0) {
    warnings.push('Cặp dấu công thức dòng $...$ chưa đóng mở cân đối.');
  }

  const payload = parseMathContent(rawSource);
  for (const blk of payload.blocks) {
    if (blk.kind !== 'latex') continue;
    let depth = 0;
    let unbalanced = false;
    for (let idx = 0; idx < blk.content.length; idx++) {
      const ch = blk.content[idx];
      if (ch === '\\') {
        idx += 1;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth < 0) {
          unbalanced = true;
          break;
        }
      }
    }
    if (unbalanced || depth !== 0) {
      warnings.push(`Ngoặc nhọn {...} trong công thức "${blk.content.slice(0, 32)}" chưa cân bằng.`);
      break;
    }

    try {
      katex.renderToString(blk.content, {
        displayMode: Boolean(blk.displayMode),
        throwOnError: true,
        strict: false,
      });
    } catch {
      warnings.push(`Cú pháp KaTeX có thể gặp lỗi hiển thị ở "${blk.content.slice(0, 36)}".`);
      break;
    }
  }

  if (latexSyntaxCache.size >= MAX_LATEX_SYNTAX_CACHE) {
    latexSyntaxCache.clear();
  }
  latexSyntaxCache.set(rawSource, warnings);
  return [...warnings];
}

function hashQuestionContent(q: MathQuestion): OriginalQuestionFingerprint {
  const uType = q.universalType ?? q.type;
  const optionHashes: Record<string, string> = {};
  const lockedOptionSlots: Record<string, number> = {};
  (q.options ?? []).forEach((opt, idx) => {
    optionHashes[opt.id] = computeContentHash(opt.content.rawSource);
    if (opt.lockPosition) {
      lockedOptionSlots[opt.id] = idx;
    }
  });

  const multiSelectSource = q.multiSelectOptions ?? (uType === 'multi-select' ? q.options : undefined);
  const multiSelectHashes: Record<string, { contentHash: string; isCorrect: boolean }> | undefined =
    multiSelectSource
      ? Object.fromEntries(
          multiSelectSource.map((opt, idx) => {
            if (opt.lockPosition) {
              lockedOptionSlots[opt.id] = idx;
            }
            return [
              opt.id,
              {
                contentHash: computeContentHash(opt.content.rawSource),
                isCorrect: opt.isCorrect,
              },
            ];
          })
        )
      : undefined;

  const statementHashes: Record<string, { contentHash: string; isTrue: boolean }> = {};
  (q.statements ?? []).forEach((st) => {
    statementHashes[st.id] = {
      contentHash: computeContentHash(st.content.rawSource),
      isTrue: st.isTrue,
    };
  });

  const fillBlankSlotHash = q.fillBlank
    ? computeContentHash(
        q.fillBlank.slots
          .map(
            (sl) =>
              `${sl.id}:${sl.slotNumber}:${sl.placeholderToken}:${sl.acceptedAnswers.join('|')}:${Boolean(sl.caseSensitive)}`
          )
          .join('||')
      )
    : undefined;

  const fillBlankWordBankHashes = q.fillBlank?.wordBank
    ? Object.fromEntries(
        q.fillBlank.wordBank.map((wb, idx) => {
          if (wb.lockPosition) {
            lockedOptionSlots[wb.id] = idx;
          }
          return [wb.id, computeContentHash(wb.content.rawSource)];
        })
      )
    : undefined;

  const matchingLeftHash = q.matching
    ? computeContentHash(
        q.matching.leftItems
          .map((item) => `${item.id}:${item.originalLabel}:${item.content.rawSource}`)
          .join('||')
      )
    : undefined;

  const matchingRightHashes = q.matching
    ? Object.fromEntries(
        q.matching.rightItems.map((item) => [item.id, computeContentHash(item.content.rawSource)])
      )
    : undefined;

  const matchingPairsHash = q.matching
    ? computeContentHash(
        q.matching.correctPairs
          .map((p) => `${p.id}:${p.leftItemId}->${p.rightItemId}`)
          .join('||')
      )
    : undefined;

  const orderingItemsHashes = q.ordering
    ? Object.fromEntries(
        q.ordering.items.map((item) => [
          item.id,
          {
            contentHash: computeContentHash(item.content.rawSource),
            correctRank: item.correctRank,
          },
        ])
      )
    : undefined;

  const assetChecksums: Record<string, string> = {};
  (q.visualAssets ?? []).forEach((asset) => {
    assetChecksums[asset.id] = computeVisualAssetChecksum(asset);
  });

  const derivedCorrectOptionIds =
    q.correctOptionIds ??
    (multiSelectSource ? multiSelectSource.filter((o) => o.isCorrect).map((o) => o.id) : undefined);

  return {
    questionId: q.id,
    code: q.code,
    type: q.type,
    universalType: uType,
    stemHash: computeContentHash(q.stem.rawSource),
    solutionHash: computeContentHash(q.solutionGuide.rawSource),
    correctOptionId: q.correctOptionId,
    correctOptionIds: derivedCorrectOptionIds,
    optionHashes,
    multiSelectHashes,
    statementHashes,
    fillBlankSlotHash,
    fillBlankWordBankHashes,
    matchingLeftHash,
    matchingRightHashes,
    matchingPairsHash,
    orderingItemsHashes,
    shortAnswerHash: computeContentHash(
      `${q.shortAnswer?.answerValue ?? ''}|${q.shortAnswer?.unit ?? ''}|${q.shortAnswer?.domainCondition ?? ''}`
    ),
    essayPartsHash: computeContentHash(
      (q.essayParts ?? [])
        .map((p) => `${p.id}:${p.label}:${p.points}:${p.content.rawSource}:${p.solutionOutline.rawSource}`)
        .join('||')
    ),
    assetChecksums,
    lockedPositionIndex: null,
    lockedOptionSlots,
  };
}

export interface ResolvedMixFlags {
  shuffleQuestions: boolean;
  shuffleMcqOptions: boolean;
  keepVdcPositions: boolean;
  shufflePerSectionOnly: boolean;
  shuffleIndependentTrueFalseStatements: boolean;
  keepDependentGroups: boolean;
}

/**
 * Nguồn chân lý duy nhất để đọc cấu hình trộn hiệu lực từ mixConfig.
 * Tôn trọng trực tiếp hai công tắc độc lập shuffleQuestions & shuffleMcqOptions
 * (không âm thầm bỏ qua khi level = 1/2/3 hay bị ghi đè ẩn bởi subjectProfileOverrides).
 */
export function resolveEffectiveMixFlags(exam: MathExamProject): ResolvedMixFlags {
  const cfg = exam.mixConfig;
  const ov = exam.subjectProfileOverrides;
  const keepDependentGroups =
    typeof cfg.keepDependentGroups === 'boolean'
      ? cfg.keepDependentGroups
      : typeof ov?.lockSharedPassageGroups === 'boolean'
      ? ov.lockSharedPassageGroups
      : true;

  const shufflePerSectionOnly =
    typeof ov?.shufflePerSectionOnly === 'boolean'
      ? ov.shufflePerSectionOnly
      : typeof cfg.shufflePerSectionOnly === 'boolean'
      ? cfg.shufflePerSectionOnly
      : true;

  if (cfg.level === 0) {
    return {
      shuffleQuestions: false,
      shuffleMcqOptions: false,
      keepVdcPositions: true,
      shufflePerSectionOnly,
      shuffleIndependentTrueFalseStatements: false,
      keepDependentGroups,
    };
  }

  const defaultQuestions = true;
  const defaultOptions = cfg.level === 1 ? false : true;

  const shuffleQuestions =
    typeof cfg.shuffleQuestions === 'boolean' ? cfg.shuffleQuestions : defaultQuestions;
  const shuffleMcqOptions =
    cfg.level === 1
      ? false
      : typeof cfg.shuffleMcqOptions === 'boolean'
      ? cfg.shuffleMcqOptions
      : defaultOptions;

  return {
    shuffleQuestions,
    shuffleMcqOptions,
    keepVdcPositions: Boolean(cfg.keepVdcPositions),
    shufflePerSectionOnly,
    shuffleIndependentTrueFalseStatements: Boolean(cfg.shuffleIndependentTrueFalseStatements),
    keepDependentGroups,
  };
}

export function isQuestionPositionLocked(
  q: MathQuestion,
  lockedIds: Set<string>,
  keepVdcPositions: boolean
): boolean {
  return Boolean(
    q.lockQuestionPosition ||
      q.universalLock?.positionLock ||
      lockedIds.has(q.id) ||
      (keepVdcPositions && q.cognitiveLevel === 'van-dung-cao')
  );
}

/**
 * Tạo bản chụp đề gốc bất biến kèm checksum/hash độc lập vị trí trước khi trộn.
 */
export function createOriginalExamSnapshot(exam: MathExamProject): OriginalExamSnapshot {
  const fingerprintsByQuestionId: Record<string, OriginalQuestionFingerprint> = {};
  const lockedIds = new Set(exam.mixConfig.lockedQuestionIds);
  const flags = resolveEffectiveMixFlags(exam);

  exam.questions.forEach((q, idx) => {
    const fp = hashQuestionContent(q);
    if (isQuestionPositionLocked(q, lockedIds, flags.keepVdcPositions)) {
      fp.lockedPositionIndex = idx;
    }
    fingerprintsByQuestionId[q.id] = fp;
  });

  const groupFingerprints: Record<string, OriginalGroupFingerprint> = {};
  (exam.questionGroups ?? []).forEach((grp) => {
    const assetChecksums: Record<string, string> = {};
    grp.sharedAssets.forEach((a) => {
      assetChecksums[a.id] = computeVisualAssetChecksum(a);
    });
    const firstIdx = exam.questions.findIndex((q) => grp.questionIds.includes(q.id));
    groupFingerprints[grp.id] = {
      groupId: grp.id,
      questionIds: [...grp.questionIds],
      contextHash: computeContentHash(grp.sharedContext.rawSource),
      assetChecksums,
      lockGroupPosition: grp.lockGroupPosition,
      moveAsUnit: grp.moveAsUnit,
      lockInternalQuestionOrder: grp.lockInternalQuestionOrder !== false,
      startIndex: firstIdx,
    };
  });

  const examContentHash = computeContentHash(
    exam.questions
      .map((q) => {
        const fp = fingerprintsByQuestionId[q.id];
        return `${fp.questionId}:${fp.stemHash}:${Object.values(fp.optionHashes).join(',')}:${Object.values(fp.assetChecksums).join(',')}`;
      })
      .join('##')
  );

  return {
    snapshotId: `snap-${computeContentHash(exam.id + exam.updatedAt)}`,
    createdAt: new Date().toISOString(),
    examTitle: exam.title,
    questionCount: exam.questions.length,
    confirmedOriginalAnswers: exam.confirmedOriginalAnswers,
    examContentHash,
    fingerprintsByQuestionId,
    groupFingerprints,
  };
}

function factorialCapped(n: number, cap = 10000): number {
  let res = 1;
  for (let i = 2; i <= n; i++) {
    res *= i;
    if (res >= cap) return cap;
  }
  return res;
}

/**
 * Tính giới hạn tối đa số mã đề phân biệt có thể sinh ra dưới các ràng buộc Math Lock hiện tại.
 */
export function estimateMaxDistinctPermutations(exam: MathExamProject): number {
  const cfg = exam.mixConfig;
  const flags = resolveEffectiveMixFlags(exam);
  if (!flags.shuffleQuestions && !flags.shuffleMcqOptions) return 1;

  const shuffleQuestions = flags.shuffleQuestions;
  const shuffleMcqOptions = flags.shuffleMcqOptions;
  const keepVdc = flags.keepVdcPositions;
  const shufflePerSection = flags.shufflePerSectionOnly;

  const lockedIds = new Set(cfg.lockedQuestionIds);
  const groups = flags.keepDependentGroups ? (exam.questionGroups ?? []) : [];
  const groupById = new Map<string, QuestionGroup>(groups.map((g) => [g.id, g]));

  let total = 1;

  if (shuffleQuestions) {
    // Phân tách theo phần (hoặc toàn bộ) khớp đúng với orderQuestions + shuffleQuestionGroupSlice
    const slices = new Map<string, MathQuestion[]>();
    exam.questions.forEach((q) => {
      const bucketKey = shufflePerSection ? q.sectionTitle || q.type : '__all__';
      const arr = slices.get(bucketKey) ?? [];
      arr.push(q);
      slices.set(bucketKey, arr);
    });

    const isQLocked = (q: MathQuestion) => isQuestionPositionLocked(q, lockedIds, keepVdc);

    for (const slice of slices.values()) {
      const units: Array<{ len: number; pinned: boolean }> = [];
      let cursor = 0;
      while (cursor < slice.length) {
        const cur = slice[cursor];
        if (cur.groupId && groupById.has(cur.groupId)) {
          const grp = groupById.get(cur.groupId)!;
          const memberSet = new Set(grp.questionIds);
          const members: MathQuestion[] = [];
          while (
            cursor < slice.length &&
            slice[cursor].groupId === grp.id &&
            memberSet.has(slice[cursor].id)
          ) {
            members.push(slice[cursor]);
            cursor += 1;
          }
          const anyMemberLocked = members.some(isQLocked);
          units.push({
            len: members.length,
            pinned: grp.lockGroupPosition || !grp.moveAsUnit || anyMemberLocked,
          });
        } else {
          units.push({ len: 1, pinned: isQLocked(cur) });
          cursor += 1;
        }
      }

      const hasMultiItemGroup = units.some((u) => u.len > 1);
      if (!hasMultiItemGroup) {
        const freeCount = units.filter((u) => !u.pinned).length;
        total = Math.min(100000, total * factorialCapped(freeCount, 100000));
      } else {
        let segFree = 0;
        for (const u of units) {
          if (u.pinned) {
            if (segFree > 1) {
              total = Math.min(100000, total * factorialCapped(segFree, 100000));
            }
            segFree = 0;
          } else {
            segFree += 1;
          }
        }
        if (segFree > 1) {
          total = Math.min(100000, total * factorialCapped(segFree, 100000));
        }
      }
    }
  }

  if (shuffleMcqOptions) {
    for (const q of exam.questions) {
      const uType = q.universalType ?? q.type;
      if (uType === 'multi-select') {
        const opts = q.multiSelectOptions ?? q.options ?? [];
        if (q.lockOptionShuffle || detectDependentOptions(opts).length > 0) continue;
        const unlockedOpts = opts.filter((o) => !o.lockPosition).length;
        if (unlockedOpts > 1) {
          total = Math.min(100000, total * factorialCapped(unlockedOpts, 100000));
        }
        continue;
      }
      if (uType === 'matching' && q.matching) {
        if (!q.lockOptionShuffle && q.matching.allowShuffleRight && q.matching.rightItems.length > 1) {
          total = Math.min(100000, total * factorialCapped(q.matching.rightItems.length, 100000));
        }
        continue;
      }
      if (uType === 'ordering' && q.ordering) {
        if (!q.lockOptionShuffle && q.ordering.items.length > 1) {
          total = Math.min(100000, total * factorialCapped(q.ordering.items.length, 100000));
        }
        continue;
      }
      if (uType === 'fill-blank' && q.fillBlank?.wordBank) {
        if (!q.lockOptionShuffle && q.fillBlank.allowShuffleWordBank !== false) {
          const unlockedBank = q.fillBlank.wordBank.filter((b) => !b.lockPosition).length;
          if (unlockedBank > 1) {
            total = Math.min(100000, total * factorialCapped(unlockedBank, 100000));
          }
        }
        continue;
      }
      if (q.type !== 'mcq' || !q.options) continue;
      if (q.lockOptionShuffle || detectDependentOptions(q.options).length > 0) continue;
      const unlockedOpts = q.options.filter((o) => !o.lockPosition).length;
      if (unlockedOpts > 1) {
        total = Math.min(100000, total * factorialCapped(unlockedOpts, 100000));
      }
    }
  }

  return total;
}

/**
 * Phát hiện mâu thuẫn giữa các quy tắc Math Lock (khóa câu, khóa nhóm, khóa phương án, và số mã đề yêu cầu).
 */
export function detectLockConflictsAndCapacity(exam: MathExamProject): MathIntegrityIssue[] {
  const issues: MathIntegrityIssue[] = [];
  const groups = exam.questionGroups ?? [];
  const lockedIds = new Set(exam.mixConfig.lockedQuestionIds);
  const indexById = new Map<string, number>();
  exam.questions.forEach((q, idx) => indexById.set(q.id, idx));

  groups.forEach((grp) => {
    if (grp.questionIds.length < 2) {
      issues.push({
        id: `grp-size-${grp.id}`,
        severity: 'warning',
        tier: 'WARNING',
        scope: 'group',
        message: `Nhóm "${grp.title}" hiện chỉ có ${grp.questionIds.length} câu hỏi.`,
        recommendation: 'Gom ít nhất 2 câu hỏi chung dữ kiện/hình vẽ vào nhóm hoặc giải tán nhóm.',
      });
    }

    const indices: number[] = [];
    const sections = new Set<string>();
    let hasMissing = false;

    grp.questionIds.forEach((qid) => {
      const idx = indexById.get(qid);
      if (idx === undefined) {
        hasMissing = true;
      } else {
        indices.push(idx);
        sections.add(exam.questions[idx].sectionTitle);
      }
    });

    if (hasMissing) {
      issues.push({
        id: `grp-missing-${grp.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'group',
        message: `Nhóm "${grp.title}" tham chiếu câu hỏi không còn tồn tại trong đề.`,
        recommendation: 'Cập nhật lại danh sách câu thuộc nhóm.',
      });
    } else if (indices.length > 1) {
      // Nhóm phải nằm liên tiếp theo đúng thứ tự trong đề gốc
      const isContiguous = indices.every((val, i) => i === 0 || val === indices[i - 1] + 1);
      if (!isContiguous) {
        issues.push({
          id: `grp-noncontiguous-${grp.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'group',
          message: `Nhóm "${grp.title}" có các câu không đứng liền kề nhau trong đề gốc.`,
          recommendation: 'Đặt các câu cùng nhóm đứng liền kề nhau để không tách hình vẽ/dữ kiện.',
        });
      }
      if (sections.size > 1) {
        issues.push({
          id: `grp-cross-section-${grp.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'group',
          message: `Nhóm "${grp.title}" chứa các câu thuộc nhiều phần thi khác nhau (${Array.from(sections).join(', ')}).`,
          recommendation: 'Các câu trong một nhóm phải thuộc cùng một phần thi.',
        });
      }

      // Mâu thuẫn: nhóm cho phép di chuyển nguyên khối nhưng có câu bên trong lại bị khóa vị trí cố định
      const flagsForLock = resolveEffectiveMixFlags(exam);
      const lockedMembers = grp.questionIds.filter((qid) => {
        const q = exam.questions.find((item) => item.id === qid);
        return q && isQuestionPositionLocked(q, lockedIds, flagsForLock.keepVdcPositions);
      });
      if (!grp.lockGroupPosition && grp.moveAsUnit && lockedMembers.length > 0) {
        issues.push({
          id: `grp-conflict-${grp.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'lock',
          message: `Mâu thuẫn khóa tại nhóm "${grp.title}": nhóm được đặt di chuyển nguyên khối nhưng bên trong có câu bị khóa vị trí cố định.`,
          recommendation: 'Bật "Khóa vị trí cả nhóm" hoặc mở khóa vị trí câu thành viên trong nhóm.',
        });
      }
    }
  });

  // Kiểm tra khả năng tạo đủ số mã đề khác nhau dưới các ràng buộc khóa (chỉ áp dụng khi có bật đảo câu hoặc đảo phương án)
  const effectiveFlags = resolveEffectiveMixFlags(exam);
  if (
    (effectiveFlags.shuffleQuestions || effectiveFlags.shuffleMcqOptions) &&
    exam.mixConfig.examCount > 1 &&
    exam.questions.length > 0
  ) {
    const maxPerms = estimateMaxDistinctPermutations(exam);
    if (exam.mixConfig.examCount > maxPerms) {
      issues.push({
        id: 'lock-insufficient-permutations',
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'lock',
        message: `Ràng buộc khóa quá chặt: yêu cầu ${exam.mixConfig.examCount} mã đề nhưng cấu hình khóa hiện tại chỉ tạo được tối đa ${maxPerms} hoán vị khác nhau.`,
        recommendation: 'Mở khóa bớt câu hỏi/phương án hoặc giảm số mã đề yêu cầu.',
      });
    }
  }

  return issues;
}

/**
 * Kiểm tra tính toàn vẹn của đề gốc trước khi trộn.
 */
export function auditOriginalExamIntegrity(exam: MathExamProject): MathIntegrityIssue[] {
  const issues: MathIntegrityIssue[] = [];

  if (exam.questions.length === 0) {
    issues.push({
      id: 'exam-empty',
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'exam',
      message: 'Đề gốc chưa có câu hỏi nào.',
      recommendation: 'Thêm ít nhất 1 câu hỏi ở Bước 1 trước khi trộn đề.',
    });
    return issues;
  }

  if (!exam.confirmedOriginalAnswers) {
    issues.push({
      id: 'exam-unconfirmed-answers',
      severity: 'warning',
      tier: 'WARNING',
      scope: 'exam',
      message: 'Giáo viên chưa bấm "Xác nhận đáp án gốc" ở Bước 2.',
      recommendation: 'Kiểm tra lại toàn bộ đáp án đúng và đánh dấu xác nhận trước khi sinh mã đề.',
    });
  }

  const seenQuestionIds = new Set<string>();

  exam.questions.forEach((q, idx) => {
    const qNum = idx + 1;

    if (!q.id || seenQuestionIds.has(q.id)) {
      issues.push({
        id: `q-dup-id-${qNum}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'question',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        message: `Câu ${qNum} (${q.code}) bị trùng hoặc thiếu mã định danh ID.`,
        recommendation: 'Tạo lại mã định danh duy nhất cho câu hỏi trước khi trộn.',
      });
    } else {
      seenQuestionIds.add(q.id);
    }

    if (!q.stem.rawSource.trim()) {
      issues.push({
        id: `q-empty-stem-${q.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'question',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        message: `Câu ${qNum} (${q.code}) đang trống nội dung đề bài.`,
        recommendation: 'Nhập đầy đủ đề bài hoặc xóa câu trống.',
      });
    }

    for (const latexWarn of checkLatexSyntaxWarnings(q.stem.rawSource)) {
      issues.push({
        id: `q-latex-stem-${q.id}-${latexWarn}`,
        severity: 'warning',
        tier: 'WARNING',
        scope: 'latex',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        message: `Câu ${qNum} (${q.code}): ${latexWarn}`,
        recommendation: 'Kiểm tra hiển thị KaTeX ở khung xem trước công thức.',
      });
    }

    const locMeta = {
      sectionTitle: q.sectionTitle,
      sourceFileName: q.sourceTrace?.sourceFileName,
    };

    // Kiểm tra bản ghi lỗi legacy (VD: câu Đúng/Sai bị lưu khóa 666/6666 từ phiên bản trước)
    if (q.legacyAnomalyReasons && q.legacyAnomalyReasons.length > 0) {
      issues.push({
        id: `q-legacy-anomaly-${q.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'question',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        ...locMeta,
        message: `Câu ${qNum} (${q.code}) chứa dữ liệu bất thường từ bản lưu cũ: ${q.legacyAnomalyReasons.join(' ')}`,
        recommendation: 'Rà soát và sửa lại nội dung/khóa đáp án rồi xác nhận lại trước khi trộn hoặc xuất đề.',
      });
    }

    const hasLegacyEqMarker =
      q.stem.rawSource.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
      q.stem.rawSource.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]') ||
      (q.options ?? []).some(
        (o) =>
          o.content.rawSource.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
          o.content.rawSource.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]')
      ) ||
      (q.multiSelectOptions ?? []).some(
        (o) =>
          o.content.rawSource.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
          o.content.rawSource.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]')
      ) ||
      (q.statements ?? []).some(
        (s) =>
          s.content.rawSource.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
          s.content.rawSource.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]')
      ) ||
      q.solutionGuide.rawSource.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
      q.solutionGuide.rawSource.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]');

    if (
      hasLegacyEqMarker ||
      q.formulaStatus?.displayable === false ||
      (q.formulaStatus?.unresolvedCount ?? 0) > 0
    ) {
      const unresolvedDetail =
        q.formulaStatus?.unresolvedDetails?.[0] ??
        'Phát hiện placeholder công thức OLE/OMML chưa giải mã được.';
      issues.push({
        id: `q-legacy-eq-${q.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'latex',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        ...locMeta,
        message: `Câu ${qNum} (${q.code}) [${q.sectionTitle || 'Đề thi'}]: Bị CHẶN xuất vì còn công thức MathType/OLE hoặc OMML chưa giải mã được (${unresolvedDetail}).`,
        recommendation: 'Nhập lại công thức bằng LaTeX ($...$) hoặc xóa placeholder trước khi trộn và xuất đề.',
      });
    } else if (
      q.formulaStatus &&
      q.formulaStatus.displayable &&
      !q.formulaStatus.machineReadable
    ) {
      issues.push({
        id: `q-wmf-preview-only-${q.id}`,
        severity: 'warning',
        tier: 'WARNING',
        scope: 'latex',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        ...locMeta,
        message: `Câu ${qNum} (${q.code}): Đang hiển thị ${q.formulaStatus.wmfPreviewCount} công thức OLE qua ảnh vector WMF→SVG (hiển thị được nhưng chưa phải LaTeX chỉnh sửa).`,
        recommendation: 'Kiểm tra hiển thị công thức ở khung xem trước trước khi xuất bản.',
      });
    }

    // Kiểm tra nguồn gốc khóa đáp án (Answer Provenance) & phát hiện sửa nội dung sau khi xác nhận
    if (q.answerProvenance) {
      const prov = q.answerProvenance;
      if (prov.status === 'conflict') {
        const conflictDetail = prov.conflictingEvidence?.join(' vs ') || prov.note || 'Bảng đáp án và lời giải không trùng khớp';
        issues.push({
          id: `q-prov-conflict-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}): MÂU THUẪN đáp án giữa nhiều nguồn trong tài liệu (${conflictDetail}).`,
          recommendation: 'Đối chiếu tài liệu gốc, chọn đáp án chính xác và xác nhận lại trước khi trộn/xuất.',
        });
      } else if (prov.status === 'needs-review') {
        issues.push({
          id: `q-prov-review-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}): Khóa đáp án đang ở trạng thái CẦN DUYỆT QUY ƯỚC (${prov.note || 'ứng viên từ gạch chân hoặc dòng gợi ý chưa được xác nhận'}).`,
          recommendation: 'Mở Bước 2 để xác nhận rõ quy ước đáp án hoặc sửa lại khóa chấm cho câu này.',
        });
      } else if (prov.status === 'missing' && q.type !== 'essay') {
        issues.push({
          id: `q-prov-missing-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}): THIẾU KHÓA ĐÁP ÁN (${prov.note || 'không tìm thấy đáp án xác minh trong tài liệu'}).`,
          recommendation: 'Chọn hoặc nhập đáp án đúng ở Bước 1/2 (hệ thống không tự mặc định A hay Sai).',
        });
      } else if (
        prov.status === 'teacher-confirmed' &&
        prov.confirmedContentHash &&
        prov.confirmedContentHash !== computeQuestionVerificationContentHash(q)
      ) {
        issues.push({
          id: `q-prov-stale-confirm-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}): Nội dung hoặc đáp án đã bị chỉnh sửa sau lần xác nhận trước — trạng thái xác nhận không còn hiệu lực.`,
          recommendation: 'Kiểm tra lại câu hỏi và bấm xác nhận lại đáp án trước khi trộn/xuất.',
        });
      }
    }

    // Cổng bảo vệ công thức & bố cục khi nhập từ PDF hoặc định dạng đa nguồn (Exam Mixer Pro 7.0)
    if (q.sourceVerification) {
      const sv = q.sourceVerification;
      if (
        (sv.verificationStatus === 'BLOCKED' || sv.verificationStatus === 'UNSUPPORTED') &&
        !sv.verifiedByTeacher
      ) {
        const detail = sv.formulaRiskFlags[0] ?? sv.reasons[0] ?? 'Ký tự lỗi font/vùng ảnh scan từ PDF.';
        issues.push({
          id: `q-source-blocked-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'latex',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) [${sv.sourceFormat.toUpperCase()}]: Bị chặn trộn do chưa thể xác minh an toàn công thức (${detail}).`,
          recommendation: 'Đối chiếu lại với trang PDF gốc, chỉnh sửa công thức bằng LaTeX và đánh dấu xác nhận ở Bước 1/2.',
        });
      } else if (sv.verificationStatus === 'REVIEW_REQUIRED' && !sv.verifiedByTeacher) {
        const detail = sv.formulaRiskFlags[0] ?? sv.reasons[0] ?? 'Công thức/chỉ số trích xuất từ PDF cần xác nhận.';
        issues.push({
          id: `q-source-review-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'latex',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) [${sv.sourceFormat.toUpperCase()}]: Cần giáo viên đối chiếu xác nhận trước khi trộn (${detail}).`,
          recommendation: 'Kiểm tra lại biểu thức toán học với trang PDF gốc rồi bấm "Đã xác nhận công thức PDF".',
        });
      }
    }

    // Kiểm tra tài nguyên hình ảnh / đồ thị / bảng biến thiên gắn trên câu hỏi
    (q.visualAssets ?? []).forEach((asset) => {
      const verification = verifyVisualAssetIntegrity(asset);
      if (!verification.hasSourceData) {
        issues.push({
          id: `q-asset-missing-${q.id}-${asset.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'asset',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}): Tài nguyên "${asset.label}" [${asset.id}] bị thiếu dữ liệu nguồn hoặc không tải được.`,
          recommendation: 'Tải lại hình ảnh/SVG hoặc xóa tài nguyên lỗi trước khi trộn.',
        });
      } else if (!verification.valid) {
        const locationDetail = asset.sourceLocation ? `, nguồn=${asset.sourceLocation}` : '';
        issues.push({
          id: `q-asset-checksum-${q.id}-${asset.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'asset',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}): Checksum tài nguyên "${asset.label}" không khớp [id=${asset.id}, kind=${asset.kind}${locationDetail}, lưu=${asset.checksum.slice(0, 12)}, tính=${verification.expectedChecksum.slice(0, 12)}].`,
          recommendation: 'Kiểm tra lại tài nguyên hình học/bảng biến thiên hoặc nhập lại tệp nguồn trước khi trộn.',
        });
      }
    });

    const optionAssets = (q.options ?? [])
      .map((o) => o.visualAsset)
      .filter((a): a is NonNullable<typeof a> => Boolean(a));

    optionAssets.forEach((asset) => {
      const verification = verifyVisualAssetIntegrity(asset);
      if (!verification.hasSourceData) {
        issues.push({
          id: `q-opt-asset-empty-${q.id}-${asset.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'asset',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}): Tài nguyên đồ thị phương án "${asset.label}" bị rỗng.`,
          recommendation: 'Sinh lại biến thể đồ thị trước khi xuất.',
        });
      } else if (!verification.valid) {
        issues.push({
          id: `q-opt-asset-checksum-${q.id}-${asset.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'asset',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}): Checksum đồ thị phương án "${asset.label}" không khớp.`,
          recommendation: 'Sinh lại biến thể đồ thị trước khi xuất.',
        });
      }
    });

    if (
      q.hasVisualAsset &&
      (!q.visualAssets || q.visualAssets.length === 0) &&
      optionAssets.length === 0
    ) {
      issues.push({
        id: `q-asset-flagged-empty-${q.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'asset',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        message: `Câu ${qNum} (${q.code}) đánh dấu có hình vẽ/đồ thị nhưng không tìm thấy tài nguyên đính kèm.`,
        recommendation: 'Đính kèm hình ảnh/bảng biến thiên hoặc bỏ cờ đánh dấu.',
      });
    }

    const uType = q.universalType ?? q.type;

    // Kiểm tra đồng bộ loại câu hỏi với Phần chứa nó (chặn lỗi Phần I chứa short-answer / multi-select lỗi hay Phần II Đúng-Sai thuần chứa short-answer)
    const secNorm = (q.sectionTitle || '').trim();
    const isSingleChoicePart =
      /(?:PHẦN\s*(?:I|1)\b|TRẮC\s*NGHIỆM\s*(?:NHIỀU\s*PHƯƠNG\s*ÁN|KHÁCH\s*QUAN|4\s*PHƯƠNG\s*ÁN|1\s*ĐÁP\s*ÁN))/i.test(
        secNorm
      ) &&
      !/PHẦN\s*(?:II|III|IV|2|3|4)\b|ĐÚNG\s*[-–/]\s*SAI|TRẢ\s*LỜI\s*NGẮN|TỰ\s*LUẬN|NHIỀU\s*ĐÁP\s*ÁN|CHỌN\s*NHIỀU/i.test(
        secNorm
      );
    const isPureTrueFalsePart =
      /(?:PHẦN\s*(?:II|2)\b.*(?:ĐÚNG|SAI)|ĐÚNG\s*[-–/]\s*SAI)/i.test(secNorm) &&
      !/PHẦN\s*(?:III|IV|3|4)\b|TRẢ\s*LỜI\s*NGẮN|TỰ\s*LUẬN|NỐI|GHÉP|MATCHING|ĐIỀN\s*KHUYẾT|SẮP\s*XẾP/i.test(
        secNorm
      );
    const isPureShortAnswerPart =
      /(?:PHẦN\s*(?:III|3)\b|TRẢ\s*LỜI\s*NGẮN)/i.test(secNorm) &&
      !/PHẦN\s*(?:IV|4)\b|TỰ\s*LUẬN|ĐÚNG\s*[-–/]\s*SAI/i.test(secNorm);

    if (isSingleChoicePart) {
      if (q.type === 'short-answer' && uType === 'short-answer') {
        issues.push({
          id: `q-section-type-mismatch-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}) nằm trong "${secNorm}" (Trắc nghiệm 1 đáp án) nhưng đang mang kiểu Trả lời ngắn (short-answer).`,
          recommendation: 'Kiểm tra lại phân tách phương án A/B/C/D hoặc chuyển câu sang đúng phần.',
        });
      } else if (
        q.type === 'mcq' &&
        uType === 'multi-select' &&
        !(q.multiSelectOptions && q.multiSelectOptions.filter((o) => o.isCorrect).length >= 2)
      ) {
        issues.push({
          id: `q-section-type-mismatch-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}) nằm trong "${secNorm}" (Trắc nghiệm 1 đáp án) nhưng bị lệch kiểu type="mcq" / universalType="multi-select".`,
          recommendation: 'Đồng bộ universalType về "mcq" cho câu trắc nghiệm 1 đáp án.',
        });
      } else if (q.type === 'true-false') {
        issues.push({
          id: `q-section-type-mismatch-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}) dạng Đúng/Sai đang nằm sai trong "${secNorm}".`,
          recommendation: 'Chuyển câu sang Phần Đúng/Sai hoặc chỉnh lại tiêu đề phần.',
        });
      }
    } else if (isPureTrueFalsePart && q.type !== 'true-false') {
      issues.push({
        id: `q-section-type-mismatch-${q.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'question',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        ...locMeta,
        message: `Câu ${qNum} (${q.code}) nằm trong "${secNorm}" (Đúng/Sai) nhưng đang mang kiểu "${q.type}".`,
        recommendation: 'Chuyển câu về dạng Đúng/Sai 4 mệnh đề a/b/c/d hoặc đặt đúng phần.',
      });
    } else if (isPureShortAnswerPart && q.type === 'true-false') {
      issues.push({
        id: `q-section-type-mismatch-${q.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'question',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        ...locMeta,
        message: `Câu ${qNum} (${q.code}) dạng Đúng/Sai đang nằm sai trong "${secNorm}" (Trả lời ngắn).`,
        recommendation: 'Kiểm tra và đặt lại đúng phần chứa câu hỏi.',
      });
    }

    if (uType === 'multi-select') {
      const options = q.multiSelectOptions ?? q.options ?? [];
      if (options.length < 2) {
        issues.push({
          id: `ms-count-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) dạng Nhiều đáp án phải có ít nhất 2 phương án.`,
          recommendation: 'Bổ sung đầy đủ các phương án lựa chọn.',
        });
      }

      const optionIds = new Set<string>();
      const correctOptions = options.filter((o) => o.isCorrect);
      options.forEach((opt, optIdx) => {
        if (!opt.id || optionIds.has(opt.id)) {
          issues.push({
            id: `ms-opt-dup-${q.id}-${optIdx}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            message: `Câu ${qNum} (${q.code}) có phương án bị trùng hoặc thiếu ID.`,
            recommendation: 'Lưu lại câu hỏi để chuẩn hóa ID phương án.',
          });
        }
        optionIds.add(opt.id);

        if (!hasMeaningfulOptionContent(opt)) {
          const rawTrim = opt.content.rawSource.trim();
          issues.push({
            id: `ms-opt-empty-${q.id}-${opt.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            ...locMeta,
            optionOrStatementLabel: opt.originalLabel,
            message: rawTrim
              ? `Câu ${qNum} (${q.code}) có phương án ${opt.originalLabel} chỉ chứa ký tự dấu câu rỗng ("${rawTrim}") và không có hình vẽ.`
              : `Câu ${qNum} (${q.code}) có phương án ${opt.originalLabel} đang để trống (không có chữ và không có hình vẽ).`,
            recommendation: 'Điền nội dung phương án hoặc đính kèm hình vẽ đồ thị trước khi trộn.',
          });
        }
      });

      if (correctOptions.length === 0) {
        issues.push({
          id: `ms-answer-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) dạng Nhiều đáp án chưa chọn đáp án đúng nào.`,
          recommendation: 'Đánh dấu ít nhất 1 phương án đúng.',
        });
      }

      const depReasons = detectDependentOptions(options);
      if (depReasons.length > 0 && !q.lockOptionShuffle) {
        issues.push({
          id: `ms-dep-unlock-${q.id}`,
          severity: 'warning',
          tier: 'WARNING',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}): ${depReasons[0]} nhưng chưa bật khóa đảo phương án.`,
          recommendation: 'Hệ thống sẽ tự động khóa đảo phương án cho câu này khi trộn.',
        });
      }
    } else if (q.type === 'mcq') {
      const options = q.options ?? [];
      if (options.length !== 4) {
        issues.push({
          id: `mcq-count-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) dạng 4 phương án phải có đủ 4 lựa chọn A/B/C/D (hiện có ${options.length}).`,
          recommendation: 'Bổ sung đủ 4 phương án A, B, C, D.',
        });
      }

      const optionIds = new Set<string>();
      const correctOptions = options.filter((o) => o.isCorrect);
      options.forEach((opt, optIdx) => {
        if (!opt.id || optionIds.has(opt.id)) {
          issues.push({
            id: `mcq-opt-dup-${q.id}-${optIdx}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            message: `Câu ${qNum} (${q.code}) có phương án bị trùng hoặc thiếu ID.`,
            recommendation: 'Lưu lại câu hỏi để chuẩn hóa ID phương án.',
          });
        }
        optionIds.add(opt.id);

        if (!hasMeaningfulOptionContent(opt)) {
          const rawTrim = opt.content.rawSource.trim();
          issues.push({
            id: `mcq-opt-empty-${q.id}-${opt.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            ...locMeta,
            optionOrStatementLabel: opt.originalLabel,
            message: rawTrim
              ? `Câu ${qNum} (${q.code}) phương án ${opt.originalLabel} chỉ chứa dấu câu rỗng ("${rawTrim}") và không có hình ảnh.`
              : `Câu ${qNum} (${q.code}) phương án ${opt.originalLabel} đang để trống (không có văn bản và không có hình ảnh).`,
            recommendation: 'Điền nội dung phương án hoặc kiểm tra lại ảnh đồ thị bị tách khỏi phương án trước khi trộn.',
          });
        }

        for (const w of checkLatexSyntaxWarnings(opt.content.rawSource)) {
          issues.push({
            id: `mcq-opt-latex-${q.id}-${opt.id}-${w}`,
            severity: 'warning',
            tier: 'WARNING',
            scope: 'latex',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            message: `Câu ${qNum} (${q.code}) phương án ${opt.originalLabel}: ${w}`,
            recommendation: 'Kiểm tra hiển thị KaTeX.',
          });
        }
      });

      if (correctOptions.length !== 1 || correctOptions[0]?.id !== q.correctOptionId) {
        issues.push({
          id: `mcq-answer-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) chưa xác định đúng 1 đáp án chính xác khớp với correctOptionId.`,
          recommendation: 'Chọn duy nhất 1 đáp án đúng (A, B, C hoặc D) cho câu hỏi.',
        });
      }

      const depReasons = detectDependentOptions(options);
      if (depReasons.length > 0 && !q.lockOptionShuffle) {
        issues.push({
          id: `mcq-dep-unlock-${q.id}`,
          severity: 'warning',
          tier: 'WARNING',
          scope: 'option',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}): ${depReasons[0]} nhưng chưa bật khóa đảo phương án.`,
          recommendation: 'Hệ thống sẽ tự động khóa đảo phương án A/B/C/D cho câu này khi trộn.',
        });
      }
    }

    if (q.type === 'true-false') {
      const statements = q.statements ?? [];
      if (statements.length !== 4) {
        issues.push({
          id: `tf-count-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'statement',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) dạng Đúng/Sai phải có đủ 4 ý a, b, c, d.`,
          recommendation: 'Bổ sung đủ 4 mệnh đề a, b, c, d.',
        });
      }
      const stIds = new Set<string>();
      statements.forEach((st) => {
        if (!st.id || stIds.has(st.id)) {
          issues.push({
            id: `tf-dup-${q.id}-${st.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'statement',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            message: `Câu ${qNum} (${q.code}) có ý bị trùng hoặc thiếu ID.`,
            recommendation: 'Chuẩn hóa lại danh sách ý.',
          });
        }
        stIds.add(st.id);

        const stRaw = st.content.rawSource.trim();
        if (!stRaw || !/[A-Za-zÀ-ỹ0-9$\\]/.test(stRaw)) {
          issues.push({
            id: `tf-empty-${q.id}-${st.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'statement',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            ...locMeta,
            optionOrStatementLabel: `${st.originalLabel})`,
            message: `Câu ${qNum} (${q.code}) ý ${st.originalLabel}) đang để trống hoặc chỉ chứa dấu câu.`,
            recommendation: 'Điền đầy đủ nội dung mệnh đề.',
          });
        }
        if (st.answerState === 'missing') {
          issues.push({
            id: `tf-missing-state-${q.id}-${st.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'statement',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            ...locMeta,
            optionOrStatementLabel: `${st.originalLabel})`,
            message: `Câu ${qNum} (${q.code}) ý ${st.originalLabel}) đang THIẾU đáp án Đúng/Sai (hệ thống không tự suy đoán Sai).`,
            recommendation: 'Chọn Đúng hoặc Sai và xác nhận cho từng ý ở Bước 2.',
          });
        } else if (st.answerState === 'candidate') {
          issues.push({
            id: `tf-candidate-state-${q.id}-${st.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'statement',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            ...locMeta,
            optionOrStatementLabel: `${st.originalLabel})`,
            message: `Câu ${qNum} (${q.code}) ý ${st.originalLabel}) mới là ứng viên từ dấu gạch chân, chưa được giáo viên xác nhận quy ước.`,
            recommendation: 'Xác nhận ý gạch chân là Đúng (và các ý còn lại là Sai) hoặc sửa lại ở Bước 2.',
          });
        } else if (typeof st.isTrue !== 'boolean') {
          issues.push({
            id: `tf-bool-${q.id}-${st.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'statement',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            ...locMeta,
            optionOrStatementLabel: `${st.originalLabel})`,
            message: `Câu ${qNum} (${q.code}) ý ${st.originalLabel}) chưa gán giá trị Đúng hoặc Sai.`,
            recommendation: 'Chọn Đúng hoặc Sai cho từng ý.',
          });
        }
      });
    }

    if (uType === 'fill-blank') {
      const slots = q.fillBlank?.slots ?? [];
      if (slots.length === 0 && !q.shortAnswer?.answerValue?.trim()) {
        issues.push({
          id: `fb-empty-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) dạng Điền khuyết chưa có chỗ trống hoặc đáp án.`,
          recommendation: 'Kiểm tra lại định dạng {{1}} và đáp án từng chỗ trống.',
        });
      } else if (slots.some((sl) => sl.acceptedAnswers.length === 0) && !q.shortAnswer?.answerValue?.trim()) {
        issues.push({
          id: `fb-ans-warn-${q.id}`,
          severity: 'warning',
          tier: 'WARNING',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) Điền khuyết có chỗ trống chưa khai báo đáp án.`,
          recommendation: 'Nhập đáp án ở Bước 2 để bảng đáp án đầy đủ.',
        });
      }
    } else if (uType === 'matching') {
      const matching = q.matching;
      if (!matching || matching.leftItems.length < 2 || matching.rightItems.length < 2) {
        issues.push({
          id: `match-items-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) dạng Ghép đôi phải có ít nhất 2 mục ở mỗi cột.`,
          recommendation: 'Bổ sung đủ Cột A và Cột B.',
        });
      } else {
        const leftSet = new Set(matching.leftItems.map((i) => i.id));
        const rightSet = new Set(matching.rightItems.map((i) => i.id));
        const validPairs = matching.correctPairs.filter(
          (p) => leftSet.has(p.leftItemId) && rightSet.has(p.rightItemId)
        );
        if (validPairs.length === 0) {
          issues.push({
            id: `match-pairs-${q.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            message: `Câu ${qNum} (${q.code}) dạng Ghép đôi chưa có cặp nối đúng hợp lệ theo ID.`,
            recommendation: 'Xác định ít nhất 1 cặp ghép nối đúng ở Bước 2.',
          });
        }
      }
    } else if (uType === 'ordering') {
      const items = q.ordering?.items ?? [];
      if (items.length < 2) {
        issues.push({
          id: `order-items-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          message: `Câu ${qNum} (${q.code}) dạng Sắp xếp thứ tự cần ít nhất 2 bước/mảnh.`,
          recommendation: 'Bổ sung tối thiểu 2 bước cần sắp xếp.',
        });
      } else {
        const ranks = new Set(items.map((it) => it.correctRank));
        if (ranks.size !== items.length) {
          issues.push({
            id: `order-ranks-${q.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: q.id,
            questionNumber: qNum,
            code: q.code,
            message: `Câu ${qNum} (${q.code}) dạng Sắp xếp có thứ tự đúng (correctRank) bị trùng.`,
            recommendation: 'Gán thứ tự 1..N duy nhất cho từng bước.',
          });
        }
      }
    } else if (q.type === 'short-answer') {
      const val = q.shortAnswer?.answerValue?.trim() ?? '';
      if (val.length === 0) {
        issues.push({
          id: `sa-empty-${q.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}) dạng Trả lời ngắn chưa có đáp án số chính xác.`,
          recommendation: 'Nhập đáp án gốc cố định (VD: 0, -4,3 hoặc π - 8/3).',
        });
      }
    }

    if (q.type === 'essay') {
      const parts = q.essayParts ?? [];
      if (parts.length === 0 && !q.solutionGuide.rawSource.trim()) {
        const blockEssay = exam.requireEssayAnswerOnExport === true;
        issues.push({
          id: `essay-guide-${q.id}`,
          severity: blockEssay ? 'error' : 'warning',
          tier: blockEssay ? 'BLOCKED' : 'WARNING',
          scope: 'question',
          questionId: q.id,
          questionNumber: qNum,
          code: q.code,
          ...locMeta,
          message: `Câu ${qNum} (${q.code}) Tự luận chưa có hướng dẫn chấm hoặc ĐS.`,
          recommendation: 'Bổ sung hướng dẫn chấm để tạo bảng đáp án đầy đủ.',
        });
      }
    }

    // Cảnh báo bố cục A4 nếu một câu quá dài hoặc có nhiều hình vẽ
    if (q.stem.rawSource.length > 650 || (q.visualAssets?.length ?? 0) > 2) {
      issues.push({
        id: `q-layout-long-${q.id}`,
        severity: 'warning',
        tier: 'WARNING',
        scope: 'layout',
        questionId: q.id,
        questionNumber: qNum,
        code: q.code,
        message: `Câu ${qNum} (${q.code}) có nội dung dài hoặc nhiều hình đính kèm — cần kiểm tra ngắt trang A4 khi xuất bản.`,
        recommendation: 'Xem trước trang A4 ở Bước 5 trước khi in hàng loạt.',
      });
    }
  });

  // Kiểm tra tài nguyên dùng chung của các nhóm câu hỏi
  (exam.questionGroups ?? []).forEach((grp) => {
    grp.sharedAssets.forEach((asset) => {
      const verification = verifyVisualAssetIntegrity(asset);
      if (!verification.hasSourceData) {
        issues.push({
          id: `grp-asset-missing-${grp.id}-${asset.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'asset',
          message: `Nhóm "${grp.title}": Tài nguyên dùng chung "${asset.label}" [${asset.id}] bị thiếu hoặc không tải được.`,
          recommendation: 'Kiểm tra lại hình vẽ/bảng biểu dùng chung của nhóm.',
        });
      } else if (!verification.valid) {
        issues.push({
          id: `grp-asset-checksum-${grp.id}-${asset.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'asset',
          message: `Nhóm "${grp.title}": Checksum tài nguyên dùng chung "${asset.label}" không khớp [id=${asset.id}, kind=${asset.kind}].`,
          recommendation: 'Kiểm tra lại hình vẽ/bảng biểu dùng chung của nhóm trước khi trộn.',
        });
      }
    });
  });

  // Phát hiện trùng lặp nội dung giữa các câu hỏi khác ID (tránh nhân bản câu từ phần lời giải/nhập trùng)
  const dupGroups = detectDuplicateQuestionGroups(exam.questions);
  dupGroups.forEach((grp, gIdx) => {
    issues.push({
      id: `exam-dup-content-${gIdx}-${grp.signature.slice(0, 8)}`,
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'question',
      questionId: grp.questionIds[1],
      code: grp.questionCodes.join(', '),
      message: `Phát hiện ${grp.questionIds.length} câu hỏi có nội dung trùng lặp (${grp.questionCodes.join(', ')}): "${grp.stemPreview}..."`,
      recommendation: 'Xóa câu hỏi bị lặp (thường do nhập nhầm vùng lời giải hoặc nhập trùng 2 lần) trước khi trộn đề.',
    });
  });

  // Kiểm tra số câu khai báo theo từng phần so với số câu thực tế đọc được
  (exam.sectionCountAudits ?? []).forEach((audit, aIdx) => {
    if (audit.declaredCount === undefined) return;
    if (audit.actualCount > audit.declaredCount) {
      issues.push({
        id: `sec-count-overflow-${aIdx}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'exam',
        sectionTitle: audit.sectionTitle,
        message: `${audit.sectionTitle}: Khai báo ${audit.declaredCount} câu nhưng đọc được ${audit.actualCount} câu (nghi ngờ lọt câu từ vùng lời giải/phụ lục).`,
        recommendation: 'Kiểm tra và xóa câu thừa trước khi trộn/xuất đề.',
      });
    } else if (audit.actualCount < audit.declaredCount) {
      issues.push({
        id: `sec-count-underflow-${aIdx}`,
        severity: 'warning',
        tier: 'WARNING',
        scope: 'exam',
        sectionTitle: audit.sectionTitle,
        message: `${audit.sectionTitle}: Khai báo ${audit.declaredCount} câu nhưng mới đọc được ${audit.actualCount} câu.`,
        recommendation: 'Đối chiếu với tệp đề gốc để chắc chắn không bị sót câu.',
      });
    }
  });

  // Kiểm tra các quy tắc khóa & mâu thuẫn khóa
  issues.push(...detectLockConflictsAndCapacity(exam));

  return issues;
}

function buildIntegrityCategories(
  issues: MathIntegrityIssue[],
  totalQuestions: number,
  visualAssetsCount: number
): IntegrityCategorySummary[] {
  const resolveStatus = (scopes: MathIntegrityIssue['scope'][]): MathIntegrityStatus => {
    const matched = issues.filter((i) => scopes.includes(i.scope));
    if (matched.some((i) => i.severity === 'error')) return 'BLOCKED';
    if (matched.some((i) => i.severity === 'warning')) return 'WARNING';
    return 'PASS';
  };

  const formulaSt = resolveStatus(['latex']);
  const assetSt = resolveStatus(['asset']);
  const structSt = resolveStatus(['exam', 'question', 'matrix']);
  const answerSt = resolveStatus(['option', 'statement']);
  const lockSt = resolveStatus(['lock', 'group']);
  const layoutSt = resolveStatus(['layout']);

  return [
    {
      category: 'formula',
      label: 'Công thức Toán & KaTeX',
      status: formulaSt,
      detail:
        formulaSt === 'PASS'
          ? 'Tất cả biểu thức LaTeX hợp lệ và nguyên vẹn.'
          : 'Có cảnh báo/lỗi cú pháp công thức cần rà soát.',
    },
    {
      category: 'asset',
      label: 'Hình ảnh & Bảng biến thiên',
      status: assetSt,
      detail:
        assetSt === 'PASS'
          ? `${visualAssetsCount} tài nguyên hình học/bảng biểu nguyên vẹn checksum.`
          : 'Phát hiện tài nguyên bị thiếu, hỏng hoặc sai checksum.',
    },
    {
      category: 'structure',
      label: 'Cấu trúc đề & Mã ID',
      status: structSt,
      detail:
        structSt === 'PASS'
          ? `Đủ ${totalQuestions} câu hỏi với ID duy nhất.`
          : 'Phát hiện lỗi cấu trúc câu hỏi hoặc thiếu số câu theo ma trận.',
    },
    {
      category: 'answer',
      label: 'Ánh xạ đáp án theo ID',
      status: answerSt,
      detail:
        answerSt === 'PASS'
          ? 'Đáp án A/B/C/D, Đúng/Sai và Trả lời ngắn khớp tuyệt đối theo ID.'
          : 'Có vấn đề về xác nhận hoặc ánh xạ đáp án gốc.',
    },
    {
      category: 'lock',
      label: 'Quy tắc Math Lock & Nhóm',
      status: lockSt,
      detail:
        lockSt === 'PASS'
          ? 'Tất cả khóa câu, khóa phương án và nhóm câu hỏi được tuân thủ.'
          : 'Phát hiện vi phạm hoặc mâu thuẫn quy tắc khóa.',
    },
    {
      category: 'layout',
      label: 'Bố cục & Ngắt trang A4',
      status: layoutSt,
      detail:
        layoutSt === 'PASS'
          ? 'Độ dài câu và nhóm câu hỏi phù hợp bố cục A4.'
          : 'Có câu dài/nhiều hình cần kiểm tra ngắt trang A4.',
    },
  ];
}

export function buildIntegrityPillars(
  issues: MathIntegrityIssue[],
  exam: MathExamProject,
  postExportStatus?: { status: MathIntegrityStatus; detail: string; blockingCount: number; warningCount: number }
): IntegrityPillarReport[] {
  const summarize = (
    pillar: IntegrityPillarReport['pillar'],
    label: string,
    predicate: (i: MathIntegrityIssue) => boolean,
    passDetail: string
  ): IntegrityPillarReport => {
    const matched = issues.filter(predicate);
    const blockingCount = matched.filter((i) => i.severity === 'error').length;
    const warningCount = matched.filter((i) => i.severity === 'warning').length;
    const status: MathIntegrityStatus =
      blockingCount > 0 ? 'BLOCKED' : warningCount > 0 ? 'WARNING' : 'PASS';
    return {
      pillar,
      label,
      status,
      blockingCount,
      warningCount,
      detail:
        blockingCount > 0
          ? `${blockingCount} lỗi chặn cần xử lý (${matched.find((i) => i.severity === 'error')?.message ?? ''}).`
          : warningCount > 0
          ? `${warningCount} cảnh báo cần rà soát.`
          : passDetail,
    };
  };

  const isEmptyContentIssue = (i: MathIntegrityIssue) =>
    i.id.startsWith('empty-opt-') ||
    i.id.startsWith('empty-stmt-') ||
    i.id.startsWith('empty-stem-') ||
    i.id.startsWith('q-empty-');

  const displayPillar = summarize(
    'displayContent',
    '1. Hiển thị đề & công thức/hình',
    (i) =>
      i.scope === 'latex' ||
      i.scope === 'asset' ||
      i.scope === 'layout' ||
      isEmptyContentIssue(i),
    `Tất cả công thức, phương án, hình ảnh & tài nguyên (${exam.questions.length} câu) hiển thị hợp lệ, không có mục trống hay placeholder lỗi.`
  );

  const keyPillar = summarize(
    'keyProvenance',
    '2. Nguồn gốc khóa & xác nhận đáp án',
    (i) =>
      !isEmptyContentIssue(i) &&
      (i.scope === 'option' ||
        i.scope === 'statement' ||
        i.id === 'exam-unconfirmed-answers' ||
        i.id.startsWith('sa-empty-') ||
        i.id.startsWith('q-prov-') ||
        i.id.startsWith('q-legacy-anomaly-')),
    'Toàn bộ khóa đáp án có bằng chứng từ nguồn hoặc đã được giáo viên xác nhận.'
  );

  const permutationPillar = summarize(
    'permutationMapping',
    '3. Cấu trúc, khóa trộn & ánh xạ hoán vị',
    (i) =>
      !isEmptyContentIssue(i) &&
      (i.scope === 'lock' ||
        i.scope === 'group' ||
        i.scope === 'matrix' ||
        (i.scope === 'exam' && i.id !== 'exam-unconfirmed-answers') ||
        (i.scope === 'question' && !i.id.startsWith('sa-empty-') && !i.id.startsWith('q-legacy-anomaly-'))),
    'Cấu trúc đề, ID duy nhất, không trùng nội dung và mọi quy tắc khóa/hoán vị hợp lệ.'
  );

  const upstreamBlockedCount =
    displayPillar.blockingCount + keyPillar.blockingCount + permutationPillar.blockingCount;

  const exportIssues = issues.filter((i) => i.scope === 'export');
  const exportPillar: IntegrityPillarReport = postExportStatus
    ? {
        pillar: 'postExportVerification',
        label: '4. Kiểm chứng đọc lại bản xuất',
        status: postExportStatus.status,
        blockingCount: postExportStatus.blockingCount,
        warningCount: postExportStatus.warningCount,
        detail: postExportStatus.detail,
      }
    : exportIssues.length > 0
    ? summarize(
        'postExportVerification',
        '4. Kiểm chứng đọc lại bản xuất',
        (i) => i.scope === 'export',
        'Bản xuất DOCX/CSV/ZIP đã qua kiểm chứng đọc ngược.'
      )
    : upstreamBlockedCount > 0
    ? {
        pillar: 'postExportVerification',
        label: '4. Kiểm chứng đọc lại bản xuất',
        status: 'BLOCKED',
        blockingCount: upstreamBlockedCount,
        warningCount: 0,
        detail: `Đang khóa cổng xuất do còn ${upstreamBlockedCount} lỗi chặn ở các trụ cột trên.`,
      }
    : {
        pillar: 'postExportVerification',
        label: '4. Kiểm chứng đọc lại bản xuất',
        status: 'PASS',
        blockingCount: 0,
        warningCount: 0,
        detail: 'Sẵn sàng tự động đọc lại DOCX/CSV/ZIP và xác minh không rò rỉ đáp án ngay khi xuất.',
      };

  return [displayPillar, keyPillar, permutationPillar, exportPillar];
}

export function computeLockStats(exam: MathExamProject): MathIntegrityReport['stats'] {
  const lockedIds = new Set(exam.mixConfig.lockedQuestionIds);
  let lockedQuestions = 0;
  let lockedOptions = 0;
  let visualAssetsCount = 0;
  let unresolvedFormulaCount = 0;
  let wmfPreviewCount = 0;
  let missingKeyCount = 0;
  let needsReviewKeyCount = 0;
  let conflictKeyCount = 0;
  let legacyAnomalyCount = 0;

  exam.questions.forEach((q) => {
    const isQLocked =
      q.lockQuestionPosition ||
      lockedIds.has(q.id) ||
      (exam.mixConfig.level === 4 &&
        exam.mixConfig.keepVdcPositions &&
        q.cognitiveLevel === 'van-dung-cao');
    if (isQLocked) lockedQuestions += 1;
    if (q.type === 'mcq' && q.options) {
      lockedOptions += q.options.filter((o) => Boolean(o.lockPosition)).length;
    }
    visualAssetsCount += q.visualAssets?.length ?? 0;
    visualAssetsCount += (q.options ?? []).filter((o) => Boolean(o.visualAsset)).length;

    if (
      q.formulaStatus?.displayable === false ||
      (q.formulaStatus?.unresolvedCount ?? 0) > 0 ||
      q.stem.rawSource.includes('[CÔNG_THỨC_OLE_LEGACY]') ||
      q.stem.rawSource.includes('[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA]')
    ) {
      unresolvedFormulaCount += Math.max(1, q.formulaStatus?.unresolvedCount ?? 0);
    }
    if (q.formulaStatus?.wmfPreviewCount) {
      wmfPreviewCount += q.formulaStatus.wmfPreviewCount;
    }
    if (q.answerProvenance?.status === 'missing') missingKeyCount += 1;
    if (q.answerProvenance?.status === 'needs-review') needsReviewKeyCount += 1;
    if (q.answerProvenance?.status === 'conflict') conflictKeyCount += 1;
    if (q.legacyAnomalyReasons && q.legacyAnomalyReasons.length > 0) legacyAnomalyCount += 1;
  });

  const groups = exam.questionGroups ?? [];
  const lockedGroups = groups.filter((g) => g.lockGroupPosition).length;
  groups.forEach((g) => {
    visualAssetsCount += g.sharedAssets.length;
  });

  const duplicateGroupCount = detectDuplicateQuestionGroups(exam.questions).length;

  return {
    totalQuestions: exam.questions.length,
    lockedQuestions,
    lockedOptions,
    lockedGroups,
    visualAssetsCount,
    unresolvedFormulaCount,
    wmfPreviewCount,
    missingKeyCount,
    needsReviewKeyCount,
    conflictKeyCount,
    duplicateGroupCount,
    legacyAnomalyCount,
  };
}

/**
 * Tạo báo cáo Math Integrity Check đầy đủ (PASS / WARNING / BLOCKED) cho đề gốc trước khi trộn/xuất.
 */
export function evaluatePreMixIntegrity(exam: MathExamProject): MathIntegrityReport {
  const issues = auditOriginalExamIntegrity(exam);
  const stats = computeLockStats(exam);
  const duplicateGroups = detectDuplicateQuestionGroups(exam.questions);
  const hasError = issues.some((i) => i.severity === 'error');
  const hasWarning = issues.some((i) => i.severity === 'warning');
  const status: MathIntegrityStatus = hasError
    ? 'BLOCKED'
    : hasWarning
    ? 'WARNING'
    : 'PASS';

  return {
    status,
    checkedAt: new Date().toISOString(),
    canExport: !hasError,
    limitationNotice: MATH_SAFETY_LIMITATION_NOTICE,
    categories: buildIntegrityCategories(issues, exam.questions.length, stats.visualAssetsCount),
    pillars: buildIntegrityPillars(issues, exam),
    duplicateGroups: duplicateGroups.length > 0 ? duplicateGroups : undefined,
    sectionCountAudits: exam.sectionCountAudits,
    issues,
    stats,
  };
}

/**
 * Kiểm chứng toàn vẹn sau khi trộn đề cho từng mã đề dựa trên OriginalExamSnapshot (hash + ID + Math Lock).
 */
export function verifyMixedExamIntegrity(
  originalExam: MathExamProject,
  mixed: MixedExamVersion,
  snapshotArg?: OriginalExamSnapshot
): { passed: boolean; status: MathIntegrityStatus; issues: MathIntegrityIssue[]; report: MathIntegrityReport } {
  const snapshot = snapshotArg ?? createOriginalExamSnapshot(originalExam);
  const issues: MathIntegrityIssue[] = [];
  const originalById = new Map<string, { q: MathQuestion; originalNumber: number }>();
  originalExam.questions.forEach((q, idx) => {
    originalById.set(q.id, { q, originalNumber: idx + 1 });
  });

  const expectedCount =
    originalExam.mixConfig.level === 3
      ? originalExam.mixConfig.matrixRules.reduce((s, r) => s + Math.max(0, r.count), 0)
      : snapshot.questionCount;

  if (mixed.questions.length !== expectedCount) {
    issues.push({
      id: `mixed-count-mismatch-${mixed.code}`,
      severity: 'error',
      tier: 'BLOCKED',
      scope: 'exam',
      message: `Mã đề ${mixed.code}: Số lượng câu sau trộn (${mixed.questions.length}) không khớp cấu trúc đã xác nhận (${expectedCount}).`,
      recommendation: 'Kiểm tra lại ma trận hoặc nguồn dữ liệu đề gốc.',
    });
  }

  const seenMixedIds = new Set<string>();
  const mixedIndexById = new Map<string, number>();

  mixed.questions.forEach((mq, idx) => {
    const newNumber = idx + 1;
    mixedIndexById.set(mq.id, idx);

    if (seenMixedIds.has(mq.id)) {
      issues.push({
        id: `mixed-dup-${mixed.code}-${mq.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'question',
        questionId: mq.id,
        questionNumber: newNumber,
        code: mq.code,
        message: `Mã đề ${mixed.code}: Câu hỏi ${mq.code} bị lặp lại nhiều lần.`,
        recommendation: 'Trộn lại mã đề bằng engine chuẩn.',
      });
      return;
    }
    seenMixedIds.add(mq.id);

    const origEntry = originalById.get(mq.id);
    const fp = snapshot.fingerprintsByQuestionId[mq.id];
    if (!origEntry || !fp) {
      issues.push({
        id: `mixed-unknown-${mixed.code}-${mq.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'question',
        questionId: mq.id,
        questionNumber: newNumber,
        code: mq.code,
        message: `Mã đề ${mixed.code}: Phát hiện câu ${mq.code} không tồn tại trong bản chụp đề gốc.`,
        recommendation: 'Kiểm tra lại dữ liệu nguồn.',
      });
      return;
    }

    const orig = origEntry.q;
    const mixedFp = hashQuestionContent(mq);

    // 1. Kiểm tra hash nội dung stem & solutionGuide (độc lập vị trí)
    if (mq.stem.rawSource !== orig.stem.rawSource || mixedFp.stemHash !== fp.stemHash) {
      issues.push({
        id: `mixed-stem-mutated-${mixed.code}-${mq.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'latex',
        questionId: mq.id,
        questionNumber: newNumber,
        code: mq.code,
        message: `Mã đề ${mixed.code}: Hash nội dung đề bài câu ${mq.code} bị thay đổi so với đề gốc.`,
        recommendation: 'Chặn xuất đề vì vi phạm nguyên tắc bảo toàn nội dung toán học.',
      });
    }

    if (mq.solutionGuide.rawSource !== orig.solutionGuide.rawSource || mixedFp.solutionHash !== fp.solutionHash) {
      issues.push({
        id: `mixed-guide-mutated-${mixed.code}-${mq.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'latex',
        questionId: mq.id,
        questionNumber: newNumber,
        code: mq.code,
        message: `Mã đề ${mixed.code}: Hash hướng dẫn giải câu ${mq.code} bị biến đổi.`,
        recommendation: 'Chặn xuất đề.',
      });
    }

    // Kiểm tra cú pháp KaTeX
    for (const w of checkLatexSyntaxWarnings(mq.stem.rawSource)) {
      issues.push({
        id: `mixed-latex-warn-${mixed.code}-${mq.id}-${w}`,
        severity: 'warning',
        tier: 'WARNING',
        scope: 'latex',
        questionId: mq.id,
        questionNumber: newNumber,
        code: mq.code,
        message: `Mã đề ${mixed.code} Câu ${newNumber} (${mq.code}): ${w}`,
        recommendation: 'Kiểm tra lại cú pháp LaTeX trước khi in.',
      });
    }

    // 2. Kiểm tra tài nguyên hình ảnh / bảng biến thiên (cả cấp câu hỏi và cấp phương án chọn đồ thị/BBT)
    const origAssets = orig.visualAssets ?? [];
    const mixedAssets = mq.visualAssets ?? [];
    const origOptionAssets = (orig.options ?? [])
      .map((o) => ({ optionId: o.id, asset: o.visualAsset }))
      .filter(
        (entry): entry is { optionId: string; asset: NonNullable<typeof entry.asset> } =>
          Boolean(entry.asset)
      );
    const mixedOptionAssets = (mq.options ?? [])
      .map((o) => ({ optionId: o.id, asset: o.visualAsset }))
      .filter(
        (entry): entry is { optionId: string; asset: NonNullable<typeof entry.asset> } =>
          Boolean(entry.asset)
      );

    if (
      origAssets.length !== mixedAssets.length ||
      origOptionAssets.length !== mixedOptionAssets.length ||
      (orig.hasVisualAsset && mixedAssets.length === 0 && mixedOptionAssets.length === 0)
    ) {
      issues.push({
        id: `mixed-asset-lost-${mixed.code}-${mq.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'asset',
        questionId: mq.id,
        questionNumber: newNumber,
        code: mq.code,
        message: `Mã đề ${mixed.code}: Câu ${mq.code} bị mất tài nguyên hình vẽ/bảng biến thiên sau trộn.`,
        recommendation: 'Chặn xuất đề và kiểm tra lại tài nguyên đính kèm.',
      });
    } else {
      origAssets.forEach((oa) => {
        const ma = mixedAssets.find((item) => item.id === oa.id);
        const origCheck = fp.assetChecksums[oa.id];
        const mixedCheck = ma ? computeVisualAssetChecksum(ma) : '';
        if (!ma || !ma.sourceData.trim() || mixedCheck !== origCheck) {
          issues.push({
            id: `mixed-asset-corrupt-${mixed.code}-${mq.id}-${oa.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'asset',
            questionId: mq.id,
            questionNumber: newNumber,
            code: mq.code,
            message: `Mã đề ${mixed.code}: Tài nguyên "${oa.label}" của câu ${mq.code} bị mất hoặc sai checksum.`,
            recommendation: 'Chặn xuất đề.',
          });
        }
      });

      origOptionAssets.forEach(({ optionId, asset: oa }) => {
        const mixedMatch = mixedOptionAssets.find((item) => item.optionId === optionId);
        const origCheck = computeVisualAssetChecksum(oa);
        const mixedCheck = mixedMatch ? computeVisualAssetChecksum(mixedMatch.asset) : '';
        if (
          !mixedMatch ||
          !mixedMatch.asset.sourceData.trim() ||
          mixedMatch.asset.id !== oa.id ||
          mixedCheck !== origCheck
        ) {
          issues.push({
            id: `mixed-opt-asset-corrupt-${mixed.code}-${mq.id}-${oa.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'asset',
            questionId: mq.id,
            questionNumber: newNumber,
            code: mq.code,
            message: `Mã đề ${mixed.code}: Đồ thị phương án "${oa.label}" của câu ${mq.code} bị mất hoặc lệch khi đảo phương án.`,
            recommendation: 'Chặn xuất đề và kiểm tra ánh xạ đồ thị phương án.',
          });
        }
      });
    }

    // 3. Kiểm tra khóa vị trí câu hỏi
    if (
      fp.lockedPositionIndex !== null &&
      originalExam.mixConfig.level !== 3 &&
      idx !== fp.lockedPositionIndex
    ) {
      issues.push({
        id: `mixed-lock-broken-${mixed.code}-${mq.id}`,
        severity: 'error',
        tier: 'BLOCKED',
        scope: 'lock',
        questionId: mq.id,
        questionNumber: newNumber,
        code: mq.code,
        message: `Mã đề ${mixed.code}: Câu ${mq.code} đã khóa vị trí #${fp.lockedPositionIndex + 1} nhưng bị chuyển sang #${newNumber}.`,
        recommendation: 'Chặn xuất đề do vi phạm quy tắc Math Lock.',
      });
    }

    const uType = orig.universalType ?? orig.type;

    // 4. Kiểm tra MCQ / Multi-Select: hash phương án, khóa từng phương án, khóa phụ thuộc, ánh xạ đáp án ID
    if (uType === 'multi-select') {
      const origOpts = orig.multiSelectOptions ?? orig.options ?? [];
      const mixedOpts = mq.multiSelectOptions ?? mq.options ?? [];
      if (origOpts.length !== mixedOpts.length) {
        issues.push({
          id: `mixed-ms-len-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Câu Nhiều đáp án ${mq.code} bị mất phương án lựa chọn.`,
          recommendation: 'Chặn xuất đề.',
        });
      } else {
        const hasDependentOpts = detectDependentOptions(origOpts).length > 0;
        const expectedCorrectIds = new Set(
          fp.correctOptionIds ?? origOpts.filter((o) => o.isCorrect).map((o) => o.id)
        );
        const mappedCorrectLabels: string[] = [];

        mixedOpts.forEach((mo, optIdx) => {
          const expectedFp = fp.multiSelectHashes?.[mo.id];
          const actualHash = computeContentHash(mo.content.rawSource);
          if (!expectedFp || actualHash !== expectedFp.contentHash || mo.isCorrect !== expectedFp.isCorrect) {
            issues.push({
              id: `mixed-ms-mutated-${mixed.code}-${mq.id}-${mo.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'option',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Phương án hoặc trạng thái đúng/sai của câu Nhiều đáp án ${mq.code} bị biến đổi.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          if ((orig.lockOptionShuffle || hasDependentOpts) && origOpts[optIdx]?.id !== mo.id) {
            issues.push({
              id: `mixed-ms-dep-moved-${mixed.code}-${mq.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'lock',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Câu ${mq.code} bị khóa phương án nhưng vẫn bị đảo vị trí.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          const lockedSlot = fp.lockedOptionSlots[mo.id];
          if (lockedSlot !== undefined && optIdx !== lockedSlot) {
            issues.push({
              id: `mixed-ms-slot-lock-${mixed.code}-${mq.id}-${mo.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'lock',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Phương án khóa ở vị trí ${getOptionLetterLabel(lockedSlot)} bị dịch chuyển.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          if (expectedCorrectIds.has(mo.id)) {
            mappedCorrectLabels.push(getOptionLetterLabel(optIdx));
          }
        });

        const expectedAnswer = mappedCorrectLabels.join(', ');
        const answerRow = mixed.answerKeyRows[idx];
        if (!answerRow || answerRow.answer !== expectedAnswer) {
          issues.push({
            id: `mixed-ms-answer-mismatch-${mixed.code}-${mq.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: mq.id,
            questionNumber: newNumber,
            code: mq.code,
            message: `Mã đề ${mixed.code}: Đáp án ánh xạ của câu Nhiều đáp án ${mq.code} (${answerRow?.answer ?? '?'}) không khớp tập ID đúng (${expectedAnswer}).`,
            recommendation: 'Chặn xuất đề.',
          });
        }
      }
    } else if (orig.type === 'mcq') {
      const origOpts = orig.options ?? [];
      const mixedOpts = mq.options ?? [];
      if (origOpts.length !== mixedOpts.length) {
        issues.push({
          id: `mixed-mcq-len-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Câu ${mq.code} bị mất phương án lựa chọn.`,
          recommendation: 'Chặn xuất đề.',
        });
      } else {
        const origOptMap = new Map(origOpts.map((o) => [o.id, o]));
        const hasDependentOpts = detectDependentOptions(origOpts).length > 0;

        mixedOpts.forEach((mo, optIdx) => {
          const origOpt = origOptMap.get(mo.id);
          const expectedHash = fp.optionHashes[mo.id];
          const actualHash = computeContentHash(mo.content.rawSource);
          if (!origOpt || !expectedHash) {
            issues.push({
              id: `mixed-opt-unknown-${mixed.code}-${mq.id}-${mo.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'option',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Phương án lạ xuất hiện ở câu ${mq.code}.`,
              recommendation: 'Chặn xuất đề.',
            });
            return;
          }
          if (mo.content.rawSource !== origOpt.content.rawSource || actualHash !== expectedHash) {
            issues.push({
              id: `mixed-opt-mutated-${mixed.code}-${mq.id}-${mo.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'latex',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Hash phương án của câu ${mq.code} bị thay đổi.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          if (mo.isCorrect !== origOpt.isCorrect) {
            issues.push({
              id: `mixed-opt-correct-mutated-${mixed.code}-${mq.id}-${mo.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'option',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Trạng thái đúng/sai của phương án ID ${mo.id} bị thay đổi.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          if ((orig.lockOptionShuffle || hasDependentOpts) && origOpts[optIdx]?.id !== mo.id) {
            issues.push({
              id: `mixed-dep-opt-moved-${mixed.code}-${mq.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'lock',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Câu ${mq.code} có phương án phụ thuộc/bị khóa cả câu nhưng thứ tự A/B/C/D vẫn bị đảo.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          // Kiểm tra khóa từng phương án lẻ (VD: Khóa B)
          const lockedSlot = fp.lockedOptionSlots[mo.id];
          if (lockedSlot !== undefined && optIdx !== lockedSlot) {
            issues.push({
              id: `mixed-opt-slot-lock-broken-${mixed.code}-${mq.id}-${mo.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'lock',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Phương án ${MCQ_LABELS[lockedSlot]} của câu ${mq.code} đã bị khóa vị trí nhưng bị chuyển sang ${MCQ_LABELS[optIdx]}.`,
              recommendation: 'Chặn xuất đề do vi phạm khóa phương án.',
            });
          }
        });

        const correctIdx = mixedOpts.findIndex((o) => o.id === fp.correctOptionId);
        const mapping = mixed.permutationMap[idx];
        const answerRow = mixed.answerKeyRows[idx];
        if (
          correctIdx === -1 ||
          !mapping ||
          mapping.newCorrectLabel !== MCQ_LABELS[correctIdx] ||
          !answerRow ||
          answerRow.answer !== MCQ_LABELS[correctIdx]
        ) {
          issues.push({
            id: `mixed-answer-mismatch-${mixed.code}-${mq.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: mq.id,
            questionNumber: newNumber,
            code: mq.code,
            message: `Mã đề ${mixed.code}: Ánh xạ đáp án đúng của câu ${mq.code} không khớp với vị trí phương án ID ${fp.correctOptionId}.`,
            recommendation: 'Chặn xuất đề.',
          });
        }
      }
    }

    // 5. Kiểm tra Đúng/Sai theo statementId
    if (orig.type === 'true-false') {
      const origSts = orig.statements ?? [];
      const mixedSts = mq.statements ?? [];
      if (origSts.length !== mixedSts.length) {
        issues.push({
          id: `mixed-tf-len-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'statement',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Câu Đúng/Sai ${mq.code} bị mất ý.`,
          recommendation: 'Chặn xuất đề.',
        });
      } else {
        mixedSts.forEach((ms, sIdx) => {
          const stFp = fp.statementHashes[ms.id];
          const actualStHash = computeContentHash(ms.content.rawSource);
          if (!stFp || actualStHash !== stFp.contentHash || ms.isTrue !== stFp.isTrue) {
            issues.push({
              id: `mixed-tf-mutated-${mixed.code}-${mq.id}-${ms.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'statement',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Ý Đúng/Sai trong câu ${mq.code} bị biến đổi hash hoặc giá trị Đúng/Sai.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          const mapping = mixed.permutationMap[idx];
          const stMap = mapping?.statementPermutation?.[sIdx];
          if (!stMap || stMap.statementId !== ms.id || stMap.isTrue !== stFp?.isTrue) {
            issues.push({
              id: `mixed-tf-map-mismatch-${mixed.code}-${mq.id}-${ms.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'statement',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Bảng ánh xạ Đúng/Sai của câu ${mq.code} không khớp statement ID ${ms.id}.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
        });
      }
    }

    // 6. Kiểm tra Điền khuyết / Ghép đôi / Sắp xếp / Trả lời ngắn
    if (uType === 'fill-blank') {
      if (fp.fillBlankSlotHash && mixedFp.fillBlankSlotHash !== fp.fillBlankSlotHash) {
        issues.push({
          id: `mixed-fb-slots-mutated-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Thứ tự hoặc đáp án chỗ trống Điền khuyết ở câu ${mq.code} bị thay đổi.`,
          recommendation: 'Chặn xuất đề.',
        });
      }
      if (fp.fillBlankWordBankHashes) {
        const mixedBank = mq.fillBlank?.wordBank ?? [];
        const origBankLen = Object.keys(fp.fillBlankWordBankHashes).length;
        if (mixedBank.length !== origBankLen) {
          issues.push({
            id: `mixed-fb-bank-len-${mixed.code}-${mq.id}`,
            severity: 'error',
            tier: 'BLOCKED',
            scope: 'option',
            questionId: mq.id,
            questionNumber: newNumber,
            code: mq.code,
            message: `Mã đề ${mixed.code}: Word Bank câu ${mq.code} bị mất phần tử.`,
            recommendation: 'Chặn xuất đề.',
          });
        } else {
          mixedBank.forEach((wb, bIdx) => {
            if (fp.fillBlankWordBankHashes?.[wb.id] !== computeContentHash(wb.content.rawSource)) {
              issues.push({
                id: `mixed-fb-bank-mutated-${mixed.code}-${mq.id}-${wb.id}`,
                severity: 'error',
                tier: 'BLOCKED',
                scope: 'option',
                questionId: mq.id,
                questionNumber: newNumber,
                code: mq.code,
                message: `Mã đề ${mixed.code}: Nội dung từ trong Word Bank câu ${mq.code} bị biến đổi.`,
                recommendation: 'Chặn xuất đề.',
              });
            }
            const lockedSlot = fp.lockedOptionSlots[wb.id];
            if (lockedSlot !== undefined && bIdx !== lockedSlot) {
              issues.push({
                id: `mixed-fb-bank-lock-${mixed.code}-${mq.id}-${wb.id}`,
                severity: 'error',
                tier: 'BLOCKED',
                scope: 'lock',
                questionId: mq.id,
                questionNumber: newNumber,
                code: mq.code,
                message: `Mã đề ${mixed.code}: Mục Word Bank bị khóa ở câu ${mq.code} đã bị dịch chuyển.`,
                recommendation: 'Chặn xuất đề.',
              });
            }
          });
        }
      }
    } else if (uType === 'matching') {
      if (fp.matchingLeftHash !== mixedFp.matchingLeftHash || fp.matchingPairsHash !== mixedFp.matchingPairsHash) {
        issues.push({
          id: `mixed-match-mutated-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Cột trái hoặc ánh xạ cặp ID Ghép đôi của câu ${mq.code} bị biến đổi.`,
          recommendation: 'Chặn xuất đề.',
        });
      }
      const origRight = orig.matching?.rightItems ?? [];
      const mixedRight = mq.matching?.rightItems ?? [];
      if (origRight.length !== mixedRight.length) {
        issues.push({
          id: `mixed-match-right-len-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Cột phải câu Ghép đôi ${mq.code} bị thiếu mục.`,
          recommendation: 'Chặn xuất đề.',
        });
      } else {
        mixedRight.forEach((ri, rIdx) => {
          if (fp.matchingRightHashes?.[ri.id] !== computeContentHash(ri.content.rawSource)) {
            issues.push({
              id: `mixed-match-right-mut-${mixed.code}-${mq.id}-${ri.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'option',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Nội dung mục cột phải câu Ghép đôi ${mq.code} bị biến đổi.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          if ((orig.lockOptionShuffle || !orig.matching?.allowShuffleRight) && origRight[rIdx]?.id !== ri.id) {
            issues.push({
              id: `mixed-match-lock-${mixed.code}-${mq.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'lock',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Câu Ghép đôi ${mq.code} bị khóa đảo cột phải nhưng vẫn bị dịch chuyển.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
        });
      }
    } else if (uType === 'ordering') {
      const origItems = orig.ordering?.items ?? [];
      const mixedItems = mq.ordering?.items ?? [];
      if (origItems.length !== mixedItems.length) {
        issues.push({
          id: `mixed-order-len-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'option',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Câu Sắp xếp ${mq.code} bị mất bước trình tự.`,
          recommendation: 'Chặn xuất đề.',
        });
      } else {
        mixedItems.forEach((it, oIdx) => {
          const itemFp = fp.orderingItemsHashes?.[it.id];
          if (
            !itemFp ||
            itemFp.contentHash !== computeContentHash(it.content.rawSource) ||
            itemFp.correctRank !== it.correctRank
          ) {
            issues.push({
              id: `mixed-order-mutated-${mixed.code}-${mq.id}-${it.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'option',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Nội dung hoặc thứ tự chuẩn của bước câu ${mq.code} bị thay đổi.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
          if (orig.lockOptionShuffle && origItems[oIdx]?.id !== it.id) {
            issues.push({
              id: `mixed-order-lock-${mixed.code}-${mq.id}`,
              severity: 'error',
              tier: 'BLOCKED',
              scope: 'lock',
              questionId: mq.id,
              questionNumber: newNumber,
              code: mq.code,
              message: `Mã đề ${mixed.code}: Câu Sắp xếp ${mq.code} đang khóa đảo bước nhưng thứ tự đã thay đổi.`,
              recommendation: 'Chặn xuất đề.',
            });
          }
        });
      }
    } else if (orig.type === 'short-answer') {
      if (mixedFp.shortAnswerHash !== fp.shortAnswerHash) {
        issues.push({
          id: `mixed-sa-mutated-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'question',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Đáp án Trả lời ngắn của câu ${mq.code} bị biến đổi.`,
          recommendation: 'Chặn xuất đề.',
        });
      }
    }

    // 7. Kiểm tra Tự luận
    if (orig.type === 'essay') {
      if (mixedFp.essayPartsHash !== fp.essayPartsHash) {
        issues.push({
          id: `mixed-essay-mutated-${mixed.code}-${mq.id}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'latex',
          questionId: mq.id,
          questionNumber: newNumber,
          code: mq.code,
          message: `Mã đề ${mixed.code}: Các ý tự luận của câu ${mq.code} bị biến đổi.`,
          recommendation: 'Chặn xuất đề.',
        });
      }
    }
  });

  // 8. Kiểm tra nguyên vẹn Nhóm câu hỏi (không tách nhóm, giữ đúng thứ tự nội bộ nếu khóa, giữ vị trí nếu lockGroupPosition)
  const mixFlags = resolveEffectiveMixFlags(originalExam);
  if (originalExam.mixConfig.level !== 3 && mixFlags.keepDependentGroups) {
    Object.values(snapshot.groupFingerprints).forEach((grpFp) => {
      if (grpFp.questionIds.length === 0) return;
      const mixedIndices = grpFp.questionIds.map((qid) => mixedIndexById.get(qid));
      if (mixedIndices.some((mIdx) => mIdx === undefined)) {
        issues.push({
          id: `mixed-grp-missing-${mixed.code}-${grpFp.groupId}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'group',
          message: `Mã đề ${mixed.code}: Nhóm câu hỏi ${grpFp.groupId} bị thiếu câu sau khi trộn.`,
          recommendation: 'Chặn xuất đề.',
        });
        return;
      }
      const nums = mixedIndices as number[];
      const sortedNums = [...nums].sort((a, b) => a - b);
      const isContiguous = sortedNums.every((val, i) => i === 0 || val === sortedNums[i - 1] + 1);
      const contiguousAndOrdered = nums.every((val, i) => i === 0 || val === nums[i - 1] + 1);
      const requireInternalOrder = grpFp.lockInternalQuestionOrder !== false;
      if ((requireInternalOrder && !contiguousAndOrdered) || (!requireInternalOrder && !isContiguous)) {
        issues.push({
          id: `mixed-grp-split-${mixed.code}-${grpFp.groupId}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'group',
          message: `Mã đề ${mixed.code}: Nhóm câu hỏi ${grpFp.groupId} bị tách rời hoặc đảo thứ tự nội bộ.`,
          recommendation: 'Chặn xuất đề vì vi phạm khóa nhóm câu hỏi.',
        });
      }
      if (grpFp.lockGroupPosition && grpFp.startIndex >= 0 && sortedNums[0] !== grpFp.startIndex) {
        issues.push({
          id: `mixed-grp-moved-${mixed.code}-${grpFp.groupId}`,
          severity: 'error',
          tier: 'BLOCKED',
          scope: 'lock',
          message: `Mã đề ${mixed.code}: Nhóm câu hỏi đã khóa vị trí #${grpFp.startIndex + 1} nhưng bị di chuyển sang #${sortedNums[0] + 1}.`,
          recommendation: 'Chặn xuất đề.',
        });
      }
    });
  }

  const stats = computeLockStats(originalExam);
  const hasError = issues.some((i) => i.severity === 'error');
  const hasWarning = issues.some((i) => i.severity === 'warning');
  const status: MathIntegrityStatus = hasError
    ? 'BLOCKED'
    : hasWarning
    ? 'WARNING'
    : 'PASS';

  const report: MathIntegrityReport = {
    status,
    checkedAt: new Date().toISOString(),
    canExport: !hasError,
    limitationNotice: MATH_SAFETY_LIMITATION_NOTICE,
    categories: buildIntegrityCategories(issues, mixed.questions.length, stats.visualAssetsCount),
    pillars: buildIntegrityPillars(issues, originalExam),
    issues,
    stats,
  };

  return {
    passed: !hasError,
    status,
    issues,
    report,
  };
}

/**
 * Cổng kiểm chứng an toàn duy nhất trước khi xuất bản (Unified Export Gate):
 * Từ chối xuất trên MỌI đường xuất (DOCX, CSV, ZIP, JSON, In) nếu:
 * - Đề gốc còn lỗi BLOCKED (placeholder OLE/OMML, phương án rỗng, thiếu/mâu thuẫn/cần duyệt khóa, trùng câu, legacy corruption)
 * - Chưa bấm xác nhận đáp án gốc (`confirmedOriginalAnswers !== true`)
 * - Còn câu hỏi bắt buộc có khóa nhưng chưa xác nhận (`answerConfirmed === false`)
 * - Chưa có mã đề hoặc bất kỳ mã đề nào đang ở trạng thái BLOCKED.
 */
export function checkExamExportGate(exam: MathExamProject): {
  canExport: boolean;
  status: MathIntegrityStatus;
  blockingReasons: string[];
  report: MathIntegrityReport;
} {
  const pre = evaluatePreMixIntegrity(exam);
  const reasons: string[] = [];

  if (pre.status === 'BLOCKED') {
    pre.issues
      .filter((i) => i.severity === 'error')
      .forEach((i) => reasons.push(i.message));
  }

  if (!exam.confirmedOriginalAnswers) {
    reasons.push('Giáo viên chưa xác nhận đáp án gốc ở Bước 2 (confirmedOriginalAnswers = false).');
  }

  const unconfirmedNonEssay = exam.questions.filter(
    (q) =>
      q.type !== 'essay' &&
      !q.answerConfirmed &&
      q.answerProvenance?.status !== 'source-matched' &&
      q.answerProvenance?.status !== 'teacher-confirmed'
  );
  if (unconfirmedNonEssay.length > 0) {
    reasons.push(
      `Còn ${unconfirmedNonEssay.length} câu hỏi chưa được xác nhận đáp án gốc (${unconfirmedNonEssay
        .slice(0, 5)
        .map((q) => q.code)
        .join(', ')}).`
    );
  }

  if (exam.generatedVersions.length === 0) {
    reasons.push('Chưa sinh mã đề nào để xuất bản.');
  }

  for (const v of exam.generatedVersions) {
    if (!v.integrityPassed || v.integrityStatus === 'BLOCKED' || v.integrityReport?.canExport === false) {
      reasons.push(`Mã đề ${v.code} có trạng thái BLOCKED (lỗi toàn vẹn nội dung hoặc vi phạm khóa).`);
    }
  }

  return {
    canExport: reasons.length === 0,
    status: reasons.length > 0 ? 'BLOCKED' : pre.status,
    blockingReasons: Array.from(new Set(reasons)),
    report: pre,
  };
}

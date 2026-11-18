import {
  ExamSubjectId,
  FillBlankSlot,
  MATH_SECTION_TITLES,
  MatchingColumnItem,
  MatchingPairMapping,
  MathExamProject,
  MathQuestion,
  MathQuestionType,
  MathVisualAsset,
  McqOption,
  McqOptionLabel,
  MultiSelectOption,
  OrderingStepItem,
  QuestionGroup,
  SubjectDetectionSuggestion,
  TrueFalseLabel,
  TrueFalseStatement,
  UniversalQuestionType,
} from '../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  computeContentHash,
  createMathVisualAsset,
  detectDependentOptions,
  detectDependentStatements,
} from './mathIntegrity';
import { detectClipboardMathArtifacts } from './mathTextParser';
import { ExtractedOmmlFragment, extractDocxDocument } from './ooxmlParser';
import {
  buildUniversalLockState,
  captureQuestionOriginalSnapshot,
  createImmutableContentPayload,
  getSubjectProfile,
  suggestSubjectProfileFromText,
} from './subjectProfileRegistry';

export type ImportSourceFormat = 'docx' | 'html' | 'text';

export interface ImportDiagnosticReport {
  sourceFormat: ImportSourceFormat;
  fileName?: string;
  suggestedSubject: SubjectDetectionSuggestion;
  totalParsed: number;
  countsByType: Record<UniversalQuestionType, number>;
  groupsCreated: number;
  assetsAttached: number;
  ommlCount: number;
  confirmedAnswerCount: number;
  unconfirmedAnswerCount: number;
  warnings: string[];
  unparsedSegments: string[];
  canImport: boolean;
}

export interface UniversalImportResult {
  questions: MathQuestion[];
  questionGroups: QuestionGroup[];
  report: ImportDiagnosticReport;
}

export interface UniversalImportOptions {
  subjectId?: ExamSubjectId;
  codePrefix?: string;
  assets?: MathVisualAsset[];
  ommlFragments?: ExtractedOmmlFragment[];
  preWarnings?: string[];
  sourceFormat?: ImportSourceFormat;
  fileName?: string;
}

const ENGLISH_DEPENDENT_PATTERNS = [
  /both\s*\(?[abcd]\)?\s*and\s*\(?[abcd]\)?/i,
  /\ball\s+of\s+the\s+above\b/i,
  /\bnone\s+of\s+the\s+above\b/i,
  /\bneither\s*\(?[abcd]\)?\s*nor\s*\(?[abcd]\)?/i,
  /\b[abcd]\s*&\s*[abcd]\b/i,
];

function detectExtendedDependentOptions(options: McqOption[]): string[] {
  const flags = detectDependentOptions(options);
  options.forEach((opt) => {
    const raw = opt.content.rawSource;
    if (ENGLISH_DEPENDENT_PATTERNS.some((re) => re.test(raw))) {
      const msg = `Phương án ${opt.originalLabel} có tham chiếu chéo tiếng Anh ("Both A and B" / "All of the above") — tự động khóa đảo vị trí.`;
      if (!flags.includes(msg)) flags.push(msg);
    }
  });
  return flags;
}

const UNICODE_SUB_HTML: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', n: 'ₙ', i: 'ᵢ',
};

const UNICODE_SUP_HTML: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ',
};

function convertHtmlSubSup(inner: string, mode: 'sub' | 'sup'): string {
  const map = mode === 'sub' ? UNICODE_SUB_HTML : UNICODE_SUP_HTML;
  let out = '';
  let ok = true;
  for (const ch of inner.trim()) {
    if (map[ch]) out += map[ch];
    else {
      ok = false;
      out += ch;
    }
  }
  if (ok) return out;
  return mode === 'sub' ? `_{${inner.trim()}}` : `^{${inner.trim()}}`;
}

/**
 * Chuyển đổi HTML / Rich Text sang văn bản giữ nguyên sub/sup (H₂SO₄, x²), bảng và ảnh data URL.
 */
export function normalizeHtmlToImportText(html: string): {
  text: string;
  assets: MathVisualAsset[];
} {
  const assets: MathVisualAsset[] = [];
  let working = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // Trích xuất ảnh data URL
  working = working.replace(
    /<img\b[^>]*src\s*=\s*(?:"(data:image\/[^"]+)"|'(data:image\/[^']+)')[^>]*>/gi,
    (_m, d1, d2) => {
      const dataUrl = d1 || d2;
      const asset = createMathVisualAsset({
        id: `html-img-${assets.length + 1}`,
        kind: 'image',
        label: `Hình HTML #${assets.length + 1}`,
        sourceData: dataUrl,
        altText: 'Hình ảnh trích xuất từ nội dung HTML',
      });
      assets.push(asset);
      return `\n[[ASSET:${asset.id}]]\n`;
    }
  );

  // Chuyển bảng HTML thành bảng dữ liệu & asset
  working = working.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, tableInner: string) => {
    const rows = Array.from(tableInner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((rm) => {
      const cells = Array.from(rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cm) =>
        cm[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
      return cells.join(' | ');
    });
    const body = rows.filter(Boolean).join('\n');
    if (!body) return '\n';
    const asset: MathVisualAsset = {
      id: `html-tbl-${assets.length + 1}`,
      kind: 'data-table',
      label: `Bảng HTML #${assets.length + 1}`,
      sourceData: body,
      altText: 'Bảng dữ liệu trích xuất từ HTML',
      required: true,
      checksum: computeContentHash(`data-table::Bảng::${body}`),
    };
    assets.push(asset);
    return `\n${body}\n[[ASSET:${asset.id}]]\n`;
  });

  // Bảo toàn <sub> / <sup>
  working = working.replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, (_m, inner: string) =>
    convertHtmlSubSup(inner.replace(/<[^>]+>/g, ''), 'sub')
  );
  working = working.replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_m, inner: string) =>
    convertHtmlSubSup(inner.replace(/<[^>]+>/g, ''), 'sup')
  );

  working = working
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: working, assets };
}

interface ExtractedAnswerKeyEntry {
  raw: string;
}

function extractTrailingAnswerKeySection(rawText: string): {
  bodyText: string;
  keyByNumber: Map<number, ExtractedAnswerKeyEntry>;
} {
  const keyHeaderRe =
    /(?:^|\n)\s*(?:#+\s*)?(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s*(?:ĐỀ\s+GỐC|CHI\s+TIẾT|THAM\s+KHẢO)?|ANSWER\s+KEY)\s*[:.]?\s*(?:\n|$)/i;
  const match = keyHeaderRe.exec(rawText);
  if (!match || match.index === undefined) {
    return { bodyText: rawText, keyByNumber: new Map() };
  }

  // Chỉ cắt nếu phần header nằm ở nửa sau văn bản (tránh cắt nhầm tiêu đề)
  if (match.index < rawText.length * 0.25) {
    return { bodyText: rawText, keyByNumber: new Map() };
  }

  const bodyText = rawText.slice(0, match.index).trim();
  const keyText = rawText.slice(match.index + match[0].length).trim();
  const keyByNumber = new Map<number, ExtractedAnswerKeyEntry>();

  // Hỗ trợ dạng: "1.A  2.B", "Câu 1: Đ-S-Đ-S", "1: 12,5", "3. for; to", "Câu 3: A, C"
  const pairRe =
    /(?:^|\s|\n)(?:Câu|Question|Bài)?\s*(\d{1,3})\s*[.:)\-–]\s*([^\n]+?)(?=(?:\s+(?:Câu|Question|Bài)?\s*\d{1,3}\s*[.:)\-–])|\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(keyText)) !== null) {
    const qNum = Number(m[1]);
    const val = m[2].trim();
    if (Number.isFinite(qNum) && val) {
      keyByNumber.set(qNum, { raw: val });
    }
  }

  return { bodyText, keyByNumber };
}

interface ParsedSectionChunk {
  sectionTitle: string;
  sectionHintType?: UniversalQuestionType;
}

function detectSectionHeader(line: string): ParsedSectionChunk | null {
  const trimmed = line.trim();
  if (trimmed.length > 140) return null;
  const headerRe =
    /^(?:PHẦN|SECTION|PART)\s+(?:[IVX]+|\d+|[A-D])\s*[.:–-]?\s*(.*)$/i;
  const m = trimmed.match(headerRe);
  if (!m) return null;
  const rest = m[1].toLowerCase();
  let hint: UniversalQuestionType | undefined;
  if (/đọc\s*hiểu|reading|cloze|ngữ\s*liệu/.test(rest)) hint = 'reading-comprehension';
  else if (/đúng\s*\/?\s*sai|true\s*\/?\s*false/.test(rest)) hint = 'true-false';
  else if (/trả\s*lời\s*ngắn|short\s*answer/.test(rest)) hint = 'short-answer';
  else if (/điền\s*khuyết|gap\s*fill|cloze/.test(rest)) hint = 'fill-blank';
  else if (/ghép\s*đôi|matching|nối\s*cột/.test(rest)) hint = 'matching';
  else if (/sắp\s*xếp|ordering|arrangement/.test(rest)) hint = 'ordering';
  else if (/tự\s*luận|làm\s*văn|writing|essay/.test(rest)) hint = 'essay';
  else if (/trắc\s*nghiệm|multiple\s*choice|vocabulary|grammar|phonetics/.test(rest)) hint = 'mcq';

  return { sectionTitle: trimmed, sectionHintType: hint };
}

interface PendingPassageRange {
  title: string;
  rawContent: string;
  assetIds: string[];
  startNum?: number;
  endNum?: number;
  contextKind: QuestionGroup['contextKind'];
}

function detectPassageIntroLine(line: string): {
  startNum?: number;
  endNum?: number;
  contextKind: QuestionGroup['contextKind'];
} | null {
  const t = line.trim();
  if (t.length < 12) return null;
  const isPassageIntro =
    /^(?:\[?(?:ĐOẠN VĂN|NGỮ LIỆU|PASSAGE)\]?\s*[:.]?|Đọc\s+(?:đoạn\s+văn|văn\s+bản|đoạn\s+trích|bài\s+thơ|tư\s+liệu)|Read\s+the\s+following\s+(?:passage|text|announcement|advertisement)|Dựa\s+vào\s+(?:bảng\s+số\s+liệu|sơ\s+đồ|tình\s+huống|thông\s+tin)\s+(?:sau|dưới\s+đây)|Questions?\s+\d+\s*(?:[-–]|to|đến)\s*\d+)/i.test(
      t
    );
  if (!isPassageIntro) return null;

  const rangeMatch = t.match(
    /(?:từ\s+câu|câu|questions?)\s*(\d+)\s*(?:đến\s*(?:câu)?|[-–]|to)\s*(\d+)/i
  );
  const contextKind: QuestionGroup['contextKind'] = /thơ|poetry|poem/i.test(t)
    ? 'poetry'
    : /cloze|điền\s*từ/i.test(t)
    ? 'cloze-text'
    : /bảng|số\s*liệu|thí\s*nghiệm|sơ\s*đồ|table|chart/i.test(t)
    ? 'figure-data'
    : /tình\s*huống|case/i.test(t)
    ? 'case-study'
    : 'passage';

  return {
    startNum: rangeMatch ? Number(rangeMatch[1]) : undefined,
    endNum: rangeMatch ? Number(rangeMatch[2]) : undefined,
    contextKind,
  };
}

function extractAssetMarkersAndClean(
  text: string,
  assetLookup: Map<string, MathVisualAsset>
): { cleanedText: string; assets: MathVisualAsset[] } {
  const attached: MathVisualAsset[] = [];
  const seen = new Set<string>();
  const cleanedText = text
    .replace(/\[\[ASSET:([^\]]+)\]\]/g, (_m, id: string) => {
      const found = assetLookup.get(id.trim());
      if (found && !seen.has(found.id)) {
        seen.add(found.id);
        attached.push(found);
      }
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanedText, assets: attached };
}

function collectOmmlForText(
  text: string,
  ommlFragments: ExtractedOmmlFragment[]
): string[] {
  if (!ommlFragments.length) return [];
  return ommlFragments
    .filter((f) => f.latex && text.includes(f.latex))
    .map((f) => f.rawXmlFragment)
    .filter(Boolean);
}

/**
 * Bộ nhập đề đa năng Exam Mixer Pro 6.0 cho văn bản cấu trúc (tiếng Việt & tiếng Anh).
 * Hỗ trợ tất cả 10 dạng câu hỏi, tự tạo nhóm ngữ liệu đọc hiểu, bảo toàn LaTeX/OMML/sub-sup và báo cáo chẩn đoán minh bạch.
 */
export function parseUniversalExamText(
  rawInput: string,
  createIdFn: (prefix: string) => string,
  options?: UniversalImportOptions
): UniversalImportResult {
  const sourceFormat = options?.sourceFormat ?? 'text';
  const baseWarnings: string[] = [
    ...(options?.preWarnings ?? []),
    ...detectClipboardMathArtifacts(rawInput),
  ];

  const assetLookup = new Map<string, MathVisualAsset>(
    (options?.assets ?? []).map((a) => [a.id, a])
  );
  const ommlFragments = options?.ommlFragments ?? [];

  const suggestedSubject = suggestSubjectProfileFromText(rawInput);
  const resolvedSubjectId = options?.subjectId ?? suggestedSubject.suggestedId;
  const subjectProfile = getSubjectProfile(resolvedSubjectId);
  const preserveWhitespace =
    subjectProfile.presentationRules.preserveLineBreaksInPoetryOrCode;

  const emptyCounts: Record<UniversalQuestionType, number> = {
    mcq: 0,
    'multi-select': 0,
    'true-false': 0,
    'short-answer': 0,
    'fill-blank': 0,
    matching: 0,
    ordering: 0,
    'reading-comprehension': 0,
    essay: 0,
    'shared-context': 0,
  };

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      questions: [],
      questionGroups: [],
      report: {
        sourceFormat,
        fileName: options?.fileName,
        suggestedSubject,
        totalParsed: 0,
        countsByType: emptyCounts,
        groupsCreated: 0,
        assetsAttached: 0,
        ommlCount: ommlFragments.length,
        confirmedAnswerCount: 0,
        unconfirmedAnswerCount: 0,
        warnings: [...baseWarnings, 'Chưa có nội dung đầu vào để phân tích.'],
        unparsedSegments: [],
        canImport: false,
      },
    };
  }

  const { bodyText, keyByNumber } = extractTrailingAnswerKeySection(trimmed);
  const lines = bodyText.split(/\r?\n/);

  interface RawQuestionBlock {
    questionNumber: number;
    sectionTitle: string;
    sectionHintType?: UniversalQuestionType;
    lines: string[];
    passageGroupKey?: string;
  }

  let currentSectionTitle =
    subjectProfile.defaultSections[0]?.title ?? MATH_SECTION_TITLES.mcq;
  let currentSectionHint: UniversalQuestionType | undefined;

  const pendingPassages: Map<string, PendingPassageRange> = new Map();
  let activePassageKey: string | undefined;
  let collectingPassageLines: { key: string; meta: ReturnType<typeof detectPassageIntroLine> } | null =
    null;

  const blocks: RawQuestionBlock[] = [];
  let currentBlock: RawQuestionBlock | null = null;
  const unparsedSegments: string[] = [];

  const questionStartRe = /^\s*(?:Câu|Question|Bài)\s+(\d{1,3})\s*[.:)]\s*(.*)$/i;

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();

    // 1. Section Header
    const sec = detectSectionHeader(rawLine);
    if (sec) {
      currentSectionTitle = sec.sectionTitle;
      currentSectionHint = sec.sectionHintType;
      collectingPassageLines = null;
      activePassageKey = undefined;
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // 2. Shared Passage Intro
    const passageIntro = detectPassageIntroLine(rawLine);
    if (passageIntro) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      const key = createIdFn('grp');
      pendingPassages.set(key, {
        title: trimmedLine.slice(0, 72) + (trimmedLine.length > 72 ? '...' : ''),
        rawContent: trimmedLine,
        assetIds: [],
        startNum: passageIntro.startNum,
        endNum: passageIntro.endNum,
        contextKind: passageIntro.contextKind,
      });
      collectingPassageLines = { key, meta: passageIntro };
      activePassageKey = key;
      continue;
    }

    // 3. Question Start
    const qMatch = rawLine.match(questionStartRe);
    if (qMatch) {
      collectingPassageLines = null;
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      const qNum = Number(qMatch[1]);
      let linkedKey: string | undefined;
      if (activePassageKey) {
        const pMeta = pendingPassages.get(activePassageKey);
        if (
          pMeta &&
          (pMeta.startNum === undefined ||
            pMeta.endNum === undefined ||
            (qNum >= pMeta.startNum && qNum <= pMeta.endNum))
        ) {
          linkedKey = activePassageKey;
        } else {
          activePassageKey = undefined;
        }
      }
      currentBlock = {
        questionNumber: qNum,
        sectionTitle: currentSectionTitle,
        sectionHintType: currentSectionHint,
        lines: qMatch[2] ? [qMatch[2]] : [],
        passageGroupKey: linkedKey,
      };
      continue;
    }

    // 4. Accumulate into active passage or question block
    if (collectingPassageLines) {
      const pEntry = pendingPassages.get(collectingPassageLines.key);
      if (pEntry) {
        pEntry.rawContent += `\n${rawLine}`;
      }
      continue;
    }

    if (currentBlock) {
      currentBlock.lines.push(rawLine);
    } else if (trimmedLine) {
      // Nếu có dòng ngữ liệu chứa bảng/ảnh trước câu hỏi đầu tiên
      if (/\[\[ASSET:/.test(trimmedLine)) {
        const key = createIdFn('grp');
        pendingPassages.set(key, {
          title: 'Ngữ liệu / Hình vẽ đính kèm',
          rawContent: rawLine,
          assetIds: [],
          contextKind: 'figure-data',
        });
        activePassageKey = key;
      } else if (!/^(?:ĐỀ\s+KIỂM\s+TRA|MÔN|THỜI\s+GIAN|TRƯỜNG|LỚP|HỌ\s+VÀ\s+TÊN)/i.test(trimmedLine)) {
        unparsedSegments.push(trimmedLine.slice(0, 120));
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  const now = new Date().toISOString();
  const warnings = [...baseWarnings];
  const questions: MathQuestion[] = [];
  const groupQuestionsMap = new Map<string, string[]>();
  const codePrefix = options?.codePrefix ?? 'IMP';

  blocks.forEach((blk, idx) => {
    const qId = createIdFn('mq');
    const code = `${codePrefix}-${String(blk.questionNumber || idx + 1).padStart(2, '0')}`;
    const rawChunk = blk.lines.join('\n').trim();
    const { cleanedText: bodyWithInline, assets: qAssets } = extractAssetMarkersAndClean(
      rawChunk,
      assetLookup
    );

    // Kiểm tra đáp án inline trong khối câu hỏi
    const inlineAnsMatch = bodyWithInline.match(
      /(?:^|\n)\s*(?:Đáp án(?:\s+đúng)?|ĐA|Answer|Key)\s*[:.]\s*([^\n]+)$/i
    );
    const bodyClean = inlineAnsMatch
      ? bodyWithInline.slice(0, inlineAnsMatch.index).trim()
      : bodyWithInline;
    const inlineAnswerRaw = inlineAnsMatch ? inlineAnsMatch[1].trim() : '';
    const trailingAnswerRaw = keyByNumber.get(blk.questionNumber)?.raw ?? '';
    const declaredAnswerRaw = inlineAnswerRaw || trailingAnswerRaw;

    // A. Kiểm tra Đúng / Sai 4 ý: a) ... b) ... c) ... d) ...
    const tfRegex = /(?:^|\n)\s*([a-dA-D])\s*[).]\s+/g;
    const tfMatches: Array<{ label: TrueFalseLabel; index: number; contentStart: number }> = [];
    let tfm: RegExpExecArray | null;
    while ((tfm = tfRegex.exec(bodyClean)) !== null) {
      tfMatches.push({
        label: tfm[1].toLowerCase() as TrueFalseLabel,
        index: tfm.index,
        contentStart: tfm.index + tfm[0].length,
      });
    }
    const isTrueFalseBlock =
      tfMatches.length >= 2 &&
      tfMatches[0].label === 'a' &&
      (blk.sectionHintType === 'true-false' || tfMatches.length === 4);

    // B. Kiểm tra MCQ / Multi-Select A. B. C. D. (hoặc *A.)
    const mcqRegex = /(?:^|\n|\s)(\*?)([ABCD])\.\s+/g;
    const mcqMatches: Array<{
      starred: boolean;
      label: McqOptionLabel;
      index: number;
      contentStart: number;
    }> = [];
    let mcqm: RegExpExecArray | null;
    while ((mcqm = mcqRegex.exec(bodyClean)) !== null) {
      mcqMatches.push({
        starred: mcqm[1] === '*',
        label: mcqm[2].toUpperCase() as McqOptionLabel,
        index: mcqm.index,
        contentStart: mcqm.index + mcqm[0].length,
      });
    }
    const lastFourMcq = mcqMatches.length >= 4 ? mcqMatches.slice(-4) : [];
    const hasFourMcq =
      lastFourMcq.length === 4 && lastFourMcq.map((m) => m.label).join('') === 'ABCD';

    // C. Kiểm tra Matching ("Cột A" & "Cột B" hoặc cặp "1. ... | a. ...")
    const hasMatchingCue =
      blk.sectionHintType === 'matching' ||
      (/cột\s*a|column\s*a/i.test(bodyClean) && /cột\s*b|column\s*b/i.test(bodyClean));

    // D. Kiểm tra Fill-Blank / Cloze ({{1}}, _(1)_, ...(1)..., ____)
    const blankTokens = Array.from(
      bodyClean.matchAll(/\{\{(\d+)\}\}|_\((\d+)\)_|\.{3,}\s*\((\d+)\)\s*\.{3,}|\[(\d+)\]/g)
    );
    const isFillBlank = !hasFourMcq && !isTrueFalseBlock && blankTokens.length > 0;

    // E. Kiểm tra Ordering
    const isOrdering =
      !hasFourMcq &&
      !isTrueFalseBlock &&
      (blk.sectionHintType === 'ordering' ||
        /sắp\s*xếp|arrange\s+the|put\s+the\s+following.*order/i.test(bodyClean));

    const registerInGroup = () => {
      if (blk.passageGroupKey) {
        const arr = groupQuestionsMap.get(blk.passageGroupKey) ?? [];
        arr.push(qId);
        groupQuestionsMap.set(blk.passageGroupKey, arr);
      }
    };

    if (hasFourMcq) {
      const stemText = bodyClean.slice(0, lastFourMcq[0].index).trim();
      const optionTexts = lastFourMcq.map((m, oIdx) => {
        const endIdx = oIdx < 3 ? lastFourMcq[oIdx + 1].index : bodyClean.length;
        return bodyClean.slice(m.contentStart, endIdx).trim();
      });

      const letterMatches = Array.from(
        declaredAnswerRaw.toUpperCase().matchAll(/\b([ABCD])\b/g)
      ).map((m) => m[1] as McqOptionLabel);
      const starredLabels = lastFourMcq.filter((m) => m.starred).map((m) => m.label);
      const effectiveLetters =
        letterMatches.length > 0 ? Array.from(new Set(letterMatches)) : starredLabels;

      const isMultiSelect =
        effectiveLetters.length > 1 ||
        /chọn\s+(?:nhiều|các)\s+(?:đáp\s+án|phương\s+án)|multiple\s+answers/i.test(stemText);

      const primaryCorrectIdx =
        effectiveLetters.length > 0 ? MCQ_LABELS.indexOf(effectiveLetters[0]) : 0;
      const safePrimaryIdx = primaryCorrectIdx >= 0 ? primaryCorrectIdx : 0;
      const answerConfirmed = effectiveLetters.length > 0;

      if (!answerConfirmed) {
        warnings.push(
          `Câu ${blk.questionNumber} (${code}) chưa có đáp án A/B/C/D trong tệp nhập — tạm đánh dấu cần giáo viên xác nhận ở Bước 2.`
        );
      }

      const builtOptions: McqOption[] = optionTexts.map((txt, oIdx) => ({
        id: `${qId}-opt-${oIdx + 1}`,
        originalLabel: MCQ_LABELS[oIdx],
        content: createImmutableContentPayload(txt, `${qId}-o${oIdx + 1}`, {
          rawXmlFragments: collectOmmlForText(txt, ommlFragments),
          preserveExactWhitespace: preserveWhitespace,
        }),
        isCorrect: isMultiSelect
          ? effectiveLetters.includes(MCQ_LABELS[oIdx])
          : oIdx === safePrimaryIdx,
      }));

      const multiSelectOptions: MultiSelectOption[] | undefined = isMultiSelect
        ? builtOptions.map((o) => ({
            id: o.id,
            originalLabel: o.originalLabel,
            content: o.content,
            isCorrect: o.isCorrect,
          }))
        : undefined;

      const depFlags = detectExtendedDependentOptions(builtOptions);
      const uType: UniversalQuestionType = isMultiSelect
        ? 'multi-select'
        : blk.passageGroupKey && subjectProfile.groupRules.preferPassageGrouping
        ? 'reading-comprehension'
        : 'mcq';

      const q: MathQuestion = {
        id: qId,
        code,
        sectionTitle: blk.sectionTitle,
        type: 'mcq',
        universalType: uType,
        subjectId: resolvedSubjectId,
        topic: subjectProfile.name,
        cognitiveLevel: 'thong-hieu',
        difficultyScore: 2,
        points: 0.25,
        stem: createImmutableContentPayload(stemText, `${qId}-stem`, {
          rawXmlFragments: collectOmmlForText(stemText, ommlFragments),
          preserveExactWhitespace: preserveWhitespace,
        }),
        options: builtOptions,
        correctOptionId: builtOptions[safePrimaryIdx].id,
        ...(multiSelectOptions
          ? {
              multiSelectOptions,
              correctOptionIds: multiSelectOptions
                .filter((o) => o.isCorrect)
                .map((o) => o.id),
            }
          : {}),
        solutionGuide: createImmutableContentPayload('', `${qId}-sol`),
        visualAssets: qAssets,
        hasVisualAsset: qAssets.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: false,
        lockOptionShuffle: depFlags.length > 0,
        allowStatementShuffle: false,
        dependencyFlags: depFlags,
        answerConfirmed,
        createdAt: now,
        updatedAt: now,
      };
      q.universalLock = buildUniversalLockState(q, subjectProfile);
      q.originalSnapshot = captureQuestionOriginalSnapshot(q);
      questions.push(q);
      registerInGroup();
      emptyCounts[uType] += 1;
      return;
    }

    if (isTrueFalseBlock) {
      const stemText = bodyClean.slice(0, tfMatches[0].index).trim();
      const stmtTexts = tfMatches.slice(0, 4).map((m, sIdx) => {
        const endIdx =
          sIdx + 1 < Math.min(4, tfMatches.length)
            ? tfMatches[sIdx + 1].index
            : bodyClean.length;
        return bodyClean.slice(m.contentStart, endIdx).trim();
      });

      const tfTokens = Array.from(
        declaredAnswerRaw
          .toUpperCase()
          .matchAll(/(?<![\p{L}\p{N}])(ĐÚNG|SAI|TRUE|FALSE|[ĐTFS])(?![\p{L}\p{N}])/giu)
      ).map((m) => /^(Đ|ĐÚNG|T|TRUE)$/i.test(m[1]));

      const answerConfirmed = tfTokens.length >= stmtTexts.length;
      if (!answerConfirmed) {
        warnings.push(
          `Câu Đúng/Sai #${blk.questionNumber} (${code}) chưa đủ đáp án từng ý — yêu cầu giáo viên xác nhận ở Bước 2.`
        );
      }

      const statements: TrueFalseStatement[] = stmtTexts.map((txt, sIdx) => {
        const inlineTrue = /\[(Đ|Đúng|T|True)\]\s*$/i.test(txt);
        const cleanSt = txt.replace(/\[(Đ|S|Đúng|Sai|T|F|True|False)\]\s*$/i, '').trim();
        return {
          id: `${qId}-st-${sIdx + 1}`,
          originalLabel: TF_LABELS[sIdx] ?? (String(sIdx + 1) as TrueFalseLabel),
          content: createImmutableContentPayload(cleanSt, `${qId}-s${sIdx + 1}`, {
            rawXmlFragments: collectOmmlForText(cleanSt, ommlFragments),
            preserveExactWhitespace: preserveWhitespace,
          }),
          isTrue: tfTokens[sIdx] ?? inlineTrue,
        };
      });

      const depStFlags = detectDependentStatements(statements);
      const q: MathQuestion = {
        id: qId,
        code,
        sectionTitle: blk.sectionTitle,
        type: 'true-false',
        universalType: 'true-false',
        subjectId: resolvedSubjectId,
        topic: subjectProfile.name,
        cognitiveLevel: 'thong-hieu',
        difficultyScore: 2,
        points: 1,
        stem: createImmutableContentPayload(stemText, `${qId}-stem`, {
          rawXmlFragments: collectOmmlForText(stemText, ommlFragments),
          preserveExactWhitespace: preserveWhitespace,
        }),
        statements,
        solutionGuide: createImmutableContentPayload('', `${qId}-sol`),
        visualAssets: qAssets,
        hasVisualAsset: qAssets.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: false,
        lockOptionShuffle: depStFlags.length > 0,
        allowStatementShuffle: depStFlags.length === 0,
        dependencyFlags: depStFlags,
        answerConfirmed,
        createdAt: now,
        updatedAt: now,
      };
      q.universalLock = buildUniversalLockState(q, subjectProfile);
      q.originalSnapshot = captureQuestionOriginalSnapshot(q);
      questions.push(q);
      registerInGroup();
      emptyCounts['true-false'] += 1;
      return;
    }

    if (hasMatchingCue) {
      const pairLines = bodyClean.split('\n').filter((l) => /\|/.test(l) || /^\s*\d+\s*[.)]\s+/.test(l));
      const leftItems: MatchingColumnItem[] = [];
      const rightItems: MatchingColumnItem[] = [];
      const correctPairs: MatchingPairMapping[] = [];

      pairLines.forEach((line, pIdx) => {
        const parts = line.split('|').map((p) => p.trim());
        if (parts.length >= 2) {
          const lId = `${qId}-left-${pIdx + 1}`;
          const rId = `${qId}-right-${pIdx + 1}`;
          leftItems.push({
            id: lId,
            originalLabel: String(pIdx + 1),
            content: createImmutableContentPayload(parts[0].replace(/^\d+[.)]\s*/, ''), lId),
          });
          rightItems.push({
            id: rId,
            originalLabel: TF_LABELS[pIdx] ?? String.fromCharCode(97 + pIdx),
            content: createImmutableContentPayload(parts[1].replace(/^[a-zA-Z][.)]\s*/, ''), rId),
          });
          correctPairs.push({
            id: `${qId}-pair-${pIdx + 1}`,
            leftItemId: lId,
            rightItemId: rId,
          });
        }
      });

      const answerConfirmed = Boolean(declaredAnswerRaw) || correctPairs.length > 0;
      if (!answerConfirmed) {
        warnings.push(
          `Câu Ghép đôi #${blk.questionNumber} (${code}) chưa xác định được bảng cặp nối — cần giáo viên kiểm tra.`
        );
      }

      const q: MathQuestion = {
        id: qId,
        code,
        sectionTitle: blk.sectionTitle,
        type: 'short-answer',
        universalType: 'matching',
        subjectId: resolvedSubjectId,
        topic: subjectProfile.name,
        cognitiveLevel: 'thong-hieu',
        difficultyScore: 2,
        points: 1,
        stem: createImmutableContentPayload(bodyClean, `${qId}-stem`, {
          preserveExactWhitespace: preserveWhitespace,
        }),
        matching: {
          leftItems,
          rightItems,
          correctPairs,
          allowShuffleLeft: false,
          allowShuffleRight: true,
        },
        shortAnswer: {
          answerValue: declaredAnswerRaw || correctPairs.map((p, i) => `${i + 1}-${TF_LABELS[i]}`).join(', '),
          acceptedFormats: [],
        },
        solutionGuide: createImmutableContentPayload('', `${qId}-sol`),
        visualAssets: qAssets,
        hasVisualAsset: qAssets.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: false,
        lockOptionShuffle: false,
        allowStatementShuffle: false,
        dependencyFlags: [],
        answerConfirmed,
        createdAt: now,
        updatedAt: now,
      };
      q.universalLock = buildUniversalLockState(q, subjectProfile);
      q.originalSnapshot = captureQuestionOriginalSnapshot(q);
      questions.push(q);
      registerInGroup();
      emptyCounts.matching += 1;
      return;
    }

    if (isFillBlank) {
      const slotNumbers = Array.from(
        new Set(
          blankTokens.map((t) => Number(t[1] || t[2] || t[3] || t[4])).filter(Number.isFinite)
        )
      ).sort((a, b) => a - b);
      const rawAnsParts = declaredAnswerRaw
        ? declaredAnswerRaw.split(/[;|,]/).map((s) => s.trim()).filter(Boolean)
        : [];
      const slots: FillBlankSlot[] = slotNumbers.map((num, sIdx) => ({
        id: `${qId}-slot-${num}`,
        slotNumber: num,
        placeholderToken: `{{${num}}}`,
        acceptedAnswers: rawAnsParts[sIdx] ? [rawAnsParts[sIdx]] : [],
        lockOrder: true,
      }));
      const answerConfirmed = Boolean(declaredAnswerRaw);
      if (!answerConfirmed) {
        warnings.push(
          `Câu Điền khuyết #${blk.questionNumber} (${code}) chưa có đáp án cho ${slots.length} chỗ trống.`
        );
      }

      const q: MathQuestion = {
        id: qId,
        code,
        sectionTitle: blk.sectionTitle,
        type: 'short-answer',
        universalType: 'fill-blank',
        subjectId: resolvedSubjectId,
        topic: subjectProfile.name,
        cognitiveLevel: 'thong-hieu',
        difficultyScore: 2,
        points: 1,
        stem: createImmutableContentPayload(bodyClean, `${qId}-stem`, {
          preserveExactWhitespace: preserveWhitespace,
        }),
        fillBlank: {
          slots,
          allowShuffleWordBank: true,
        },
        shortAnswer: {
          answerValue: declaredAnswerRaw,
          acceptedFormats: declaredAnswerRaw ? [declaredAnswerRaw] : [],
        },
        solutionGuide: createImmutableContentPayload('', `${qId}-sol`),
        visualAssets: qAssets,
        hasVisualAsset: qAssets.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: false,
        lockOptionShuffle: true,
        allowStatementShuffle: false,
        dependencyFlags: ['Khóa thứ tự chỗ trống Cloze {{1}}, {{2}}...'],
        answerConfirmed,
        createdAt: now,
        updatedAt: now,
      };
      q.universalLock = buildUniversalLockState(q, subjectProfile);
      q.originalSnapshot = captureQuestionOriginalSnapshot(q);
      questions.push(q);
      registerInGroup();
      emptyCounts['fill-blank'] += 1;
      return;
    }

    if (isOrdering) {
      const stepMatches = Array.from(
        bodyClean.matchAll(/(?:^|\n)\s*([a-fA-F]|\d)[.)]\s+([^\n]+)/g)
      );
      const items: OrderingStepItem[] = stepMatches.map((sm, sIdx) => {
        const itemId = `${qId}-step-${sIdx + 1}`;
        return {
          id: itemId,
          originalLabel: sm[1],
          content: createImmutableContentPayload(sm[2].trim(), itemId),
          correctRank: sIdx + 1,
        };
      });

      const answerConfirmed = Boolean(declaredAnswerRaw);
      if (!answerConfirmed) {
        warnings.push(
          `Câu Sắp xếp #${blk.questionNumber} (${code}) chưa có đáp án trình tự đúng — cần giáo viên xác nhận.`
        );
      }

      const q: MathQuestion = {
        id: qId,
        code,
        sectionTitle: blk.sectionTitle,
        type: 'short-answer',
        universalType: 'ordering',
        subjectId: resolvedSubjectId,
        topic: subjectProfile.name,
        cognitiveLevel: 'thong-hieu',
        difficultyScore: 2,
        points: 0.5,
        stem: createImmutableContentPayload(bodyClean, `${qId}-stem`, {
          preserveExactWhitespace: preserveWhitespace,
        }),
        ordering: {
          items,
          requireExactSequence: true,
        },
        shortAnswer: {
          answerValue: declaredAnswerRaw,
          acceptedFormats: declaredAnswerRaw ? [declaredAnswerRaw] : [],
        },
        solutionGuide: createImmutableContentPayload('', `${qId}-sol`),
        visualAssets: qAssets,
        hasVisualAsset: qAssets.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: false,
        lockOptionShuffle: false,
        allowStatementShuffle: false,
        dependencyFlags: [],
        answerConfirmed,
        createdAt: now,
        updatedAt: now,
      };
      q.universalLock = buildUniversalLockState(q, subjectProfile);
      q.originalSnapshot = captureQuestionOriginalSnapshot(q);
      questions.push(q);
      registerInGroup();
      emptyCounts.ordering += 1;
      return;
    }

    // F. Tự luận vs Trả lời ngắn
    const isEssay =
      blk.sectionHintType === 'essay' ||
      /tự luận|làm văn|viết đoạn|viết bài|nghị luận|chứng minh|phân tích|cảm nhận|write an essay|write a paragraph/i.test(
        `${blk.sectionTitle} ${bodyClean}`
      );

    if (isEssay) {
      const q: MathQuestion = {
        id: qId,
        code,
        sectionTitle: blk.sectionTitle,
        type: 'essay',
        universalType: 'essay',
        subjectId: resolvedSubjectId,
        topic: subjectProfile.name,
        cognitiveLevel: 'van-dung',
        difficultyScore: 3,
        points: 2,
        stem: createImmutableContentPayload(bodyClean, `${qId}-stem`, {
          rawXmlFragments: collectOmmlForText(bodyClean, ommlFragments),
          preserveExactWhitespace: preserveWhitespace,
        }),
        essayParts: [
          {
            id: `${qId}-part-1`,
            label: 'Yêu cầu',
            content: createImmutableContentPayload(bodyClean, `${qId}-p1`, {
              preserveExactWhitespace: preserveWhitespace,
            }),
            points: 2,
            solutionOutline: createImmutableContentPayload(
              declaredAnswerRaw,
              `${qId}-sol1`
            ),
          },
        ],
        solutionGuide: createImmutableContentPayload(declaredAnswerRaw, `${qId}-sol`),
        visualAssets: qAssets,
        hasVisualAsset: qAssets.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: true,
        lockOptionShuffle: true,
        allowStatementShuffle: false,
        dependencyFlags: [],
        answerConfirmed: true,
        createdAt: now,
        updatedAt: now,
      };
      q.universalLock = buildUniversalLockState(q, subjectProfile);
      q.originalSnapshot = captureQuestionOriginalSnapshot(q);
      questions.push(q);
      registerInGroup();
      emptyCounts.essay += 1;
    } else {
      const answerConfirmed = Boolean(declaredAnswerRaw);
      if (!answerConfirmed) {
        warnings.push(
          `Câu Trả lời ngắn #${blk.questionNumber} (${code}) chưa có đáp án gốc — cần giáo viên điền/xác nhận ở Bước 2.`
        );
      }

      const q: MathQuestion = {
        id: qId,
        code,
        sectionTitle: blk.sectionTitle,
        type: 'short-answer',
        universalType: blk.passageGroupKey ? 'reading-comprehension' : 'short-answer',
        subjectId: resolvedSubjectId,
        topic: subjectProfile.name,
        cognitiveLevel: 'thong-hieu',
        difficultyScore: 2,
        points: 0.5,
        stem: createImmutableContentPayload(bodyClean, `${qId}-stem`, {
          rawXmlFragments: collectOmmlForText(bodyClean, ommlFragments),
          preserveExactWhitespace: preserveWhitespace,
        }),
        shortAnswer: {
          answerValue: declaredAnswerRaw,
          acceptedFormats: declaredAnswerRaw ? [declaredAnswerRaw] : [],
          unit: '',
          domainCondition: '',
        },
        solutionGuide: createImmutableContentPayload('', `${qId}-sol`),
        visualAssets: qAssets,
        hasVisualAsset: qAssets.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: false,
        lockOptionShuffle: true,
        allowStatementShuffle: false,
        dependencyFlags: [],
        answerConfirmed,
        createdAt: now,
        updatedAt: now,
      };
      q.universalLock = buildUniversalLockState(q, subjectProfile);
      q.originalSnapshot = captureQuestionOriginalSnapshot(q);
      questions.push(q);
      registerInGroup();
      emptyCounts[q.universalType ?? 'short-answer'] += 1;
    }
  });

  // Tạo QuestionGroup cho các đoạn ngữ liệu / Đọc hiểu / Bảng số liệu
  const questionGroups: QuestionGroup[] = [];
  for (const [grpId, meta] of pendingPassages.entries()) {
    const linkedIds = groupQuestionsMap.get(grpId) ?? [];
    if (linkedIds.length === 0) continue;
    const { cleanedText, assets } = extractAssetMarkersAndClean(
      meta.rawContent,
      assetLookup
    );
    questionGroups.push({
      id: grpId,
      title: meta.title,
      sharedContext: createImmutableContentPayload(cleanedText, `${grpId}-ctx`, {
        preserveExactWhitespace: preserveWhitespace || meta.contextKind === 'poetry',
      }),
      sharedAssets: assets,
      questionIds: linkedIds,
      lockGroupPosition: false,
      moveAsUnit: true,
      contextKind: meta.contextKind,
      lockInternalQuestionOrder: subjectProfile.groupRules.lockInternalGroupOrder,
    });
  }

  const assetsAttached =
    questions.reduce((acc, q) => acc + (q.visualAssets?.length ?? 0), 0) +
    questionGroups.reduce((acc, g) => acc + g.sharedAssets.length, 0);
  const confirmedAnswerCount = questions.filter((q) => q.answerConfirmed).length;
  const unconfirmedAnswerCount = questions.length - confirmedAnswerCount;

  return {
    questions,
    questionGroups,
    report: {
      sourceFormat,
      fileName: options?.fileName,
      suggestedSubject,
      totalParsed: questions.length,
      countsByType: emptyCounts,
      groupsCreated: questionGroups.length,
      assetsAttached,
      ommlCount: ommlFragments.length,
      confirmedAnswerCount,
      unconfirmedAnswerCount,
      warnings: Array.from(new Set(warnings)),
      unparsedSegments,
      canImport: questions.length > 0,
    },
  };
}

export function parseUniversalHtmlExam(
  htmlString: string,
  createIdFn: (prefix: string) => string,
  options?: Omit<UniversalImportOptions, 'sourceFormat'>
): UniversalImportResult {
  const { text, assets } = normalizeHtmlToImportText(htmlString);
  return parseUniversalExamText(text, createIdFn, {
    ...options,
    sourceFormat: 'html',
    assets: [...(options?.assets ?? []), ...assets],
  });
}

export async function importUniversalExamFile(
  input: {
    fileName: string;
    buffer?: ArrayBuffer | Uint8Array;
    textContent?: string;
  },
  createIdFn: (prefix: string) => string,
  options?: Omit<UniversalImportOptions, 'sourceFormat' | 'fileName'>
): Promise<UniversalImportResult> {
  const lower = input.fileName.toLowerCase();
  if (lower.endsWith('.docx')) {
    if (!input.buffer) {
      throw new Error('Thiếu dữ liệu nhị phân của tệp .docx.');
    }
    const extracted = await extractDocxDocument(input.buffer);
    return parseUniversalExamText(extracted.plainTextWithMarkers, createIdFn, {
      ...options,
      sourceFormat: 'docx',
      fileName: input.fileName,
      assets: [...(options?.assets ?? []), ...extracted.assets],
      ommlFragments: extracted.ommlFragments,
      preWarnings: [...(options?.preWarnings ?? []), ...extracted.warnings],
    });
  }

  const text = input.textContent ?? '';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return parseUniversalHtmlExam(text, createIdFn, {
      ...options,
      fileName: input.fileName,
    });
  }

  return parseUniversalExamText(text, createIdFn, {
    ...options,
    sourceFormat: 'text',
    fileName: input.fileName,
  });
}

/**
 * Tiện ích hợp nhất kết quả Import vào MathExamProject hiện tại mà không làm mất câu/nhóm cũ.
 */
export function mergeImportedExamIntoProject(
  exam: MathExamProject,
  imported: UniversalImportResult,
  options?: { applySuggestedSubject?: boolean; replaceExisting?: boolean }
): MathExamProject {
  const nextSubjectId = options?.applySuggestedSubject
    ? imported.report.suggestedSubject.suggestedId
    : exam.subjectId;
  const profile = nextSubjectId ? getSubjectProfile(nextSubjectId) : undefined;

  return {
    ...exam,
    ...(options?.applySuggestedSubject && profile
      ? {
          subject: profile.name,
          subjectId: profile.id,
          schemaVersion: '6.0' as const,
        }
      : {}),
    questions: options?.replaceExisting
      ? imported.questions
      : [...exam.questions, ...imported.questions],
    questionGroups: options?.replaceExisting
      ? imported.questionGroups
      : [...(exam.questionGroups ?? []), ...imported.questionGroups],
    confirmedOriginalAnswers: false,
    generatedVersions: [],
    updatedAt: new Date().toISOString(),
  };
}

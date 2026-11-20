import {
  AnswerProvenance,
  ExamSubjectId,
  FillBlankSlot,
  FormulaRenderStatus,
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
  SectionCountAudit,
  SubjectDetectionSuggestion,
  TrueFalseLabel,
  TrueFalseStatement,
  UniversalQuestionType,
} from '../types/mathExam';
import {
  MCQ_LABELS,
  TF_LABELS,
  createMathVisualAsset,
  detectDependentOptions,
  detectDependentStatements,
} from './mathIntegrity';
import { detectClipboardMathArtifacts } from './mathTextParser';
import {
  DocxParagraphSegment,
  ExtractedOmmlFragment,
  extractDocxDocument,
  isExamHeaderBannerTable,
} from './ooxmlParser';
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
  sourceFileHash?: string;
  suggestedSubject: SubjectDetectionSuggestion;
  totalParsed: number;
  countsByType: Record<UniversalQuestionType, number>;
  groupsCreated: number;
  assetsAttached: number;
  ommlCount: number;
  legacyOleCount?: number;
  legacyOleDecodedLatexCount?: number;
  legacyOleWmfPreviewCount?: number;
  unresolvedOleCount?: number;
  unsupportedMediaCount?: number;
  confirmedAnswerCount: number;
  unconfirmedAnswerCount: number;
  sectionCountAudits?: SectionCountAudit[];
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
  docxParagraphs?: DocxParagraphSegment[];
  sourceFileHash?: string;
  preWarnings?: string[];
  sourceFormat?: ImportSourceFormat;
  fileName?: string;
  legacyOleCount?: number;
  legacyOleDecodedLatexCount?: number;
  legacyOleWmfPreviewCount?: number;
  unresolvedOleCount?: number;
  unsupportedMediaCount?: number;
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
  let htmlImgOrdinal = 0;
  let htmlTblOrdinal = 0;
  working = working.replace(
    /<img\b[^>]*src\s*=\s*(?:"(data:image\/[^"]+)"|'(data:image\/[^']+)')[^>]*>/gi,
    (_m, d1, d2) => {
      const dataUrl = d1 || d2;
      htmlImgOrdinal += 1;
      const asset = createMathVisualAsset({
        id: `html-img-${htmlImgOrdinal}`,
        kind: 'image',
        label: `Hình HTML #${htmlImgOrdinal}`,
        sourceData: dataUrl,
        altText: 'Hình ảnh trích xuất từ nội dung HTML',
        sourceOrdinal: htmlImgOrdinal,
        sourceLocation: `html/img[${htmlImgOrdinal}]`,
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
    htmlTblOrdinal += 1;
    const asset = createMathVisualAsset({
      id: `html-tbl-${htmlTblOrdinal}`,
      kind: 'data-table',
      label: `Bảng HTML #${htmlTblOrdinal}`,
      sourceData: body,
      altText: 'Bảng dữ liệu trích xuất từ HTML',
      required: true,
      sourceOrdinal: htmlTblOrdinal,
      sourceLocation: `html/table[${htmlTblOrdinal}]`,
    });
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

export function normalizeShortAnswerValue(raw: string): {
  rawAnswer: string;
  canonicalAnswer: string;
  normalizedAnswer: string;
  acceptedFormats: string[];
} {
  const cleaned = raw.replace(/\u00a0/g, ' ').trim();
  if (!cleaned) {
    return { rawAnswer: '', canonicalAnswer: '', normalizedAnswer: '', acceptedFormats: [] };
  }
  const unwrappedMath = cleaned
    .replace(/^\$\$|\$\$$/g, '')
    .replace(/^\$|\$$/g, '')
    .replace(/^\\\(|\\\)$/g, '')
    .replace(/^\\\[|\\\]$/g, '')
    .replace(/\{,\}/g, ',')
    .replace(/\\,/g, '')
    .replace(/\\;/g, '')
    .replace(/\\!/g, '')
    .trim();
  const normalizedSign = unwrappedMath
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^-\s+(\d)/, '-$1')
    .trim();
  const numericCandidate = normalizedSign.replace(/^\$+|\$+$/g, '').trim();
  const isDecimalWithComma = /^-?\d+,\d+$/.test(numericCandidate);
  const isDecimalWithDot = /^-?\d+\.\d+$/.test(numericCandidate);

  const normalizedAnswer = isDecimalWithComma
    ? numericCandidate.replace(',', '.')
    : numericCandidate;

  const variants = new Set<string>([cleaned]);
  if (normalizedSign && normalizedSign !== cleaned) variants.add(normalizedSign);
  if (normalizedAnswer && normalizedAnswer !== cleaned) variants.add(normalizedAnswer);
  if (isDecimalWithComma) {
    variants.add(numericCandidate);
    variants.add(numericCandidate.replace(',', '.'));
  } else if (isDecimalWithDot) {
    variants.add(numericCandidate.replace('.', ','));
  }

  return {
    rawAnswer: cleaned,
    canonicalAnswer: normalizedSign,
    normalizedAnswer,
    acceptedFormats: Array.from(variants),
  };
}

interface ExtractedAnswerKeyEntry {
  raw: string;
  sourceKind: 'answer-table' | 'solution-line' | 'inline-key';
  location: string;
  conflictingEvidences?: string[];
}

function normalizeComparableKey(raw: string): string {
  const cleaned = raw.replace(/\u00a0/g, ' ').replace(/[−–—]/g, '-').trim();
  const singleMcq = cleaned.match(/^(?:Chọn|Đáp\s*án)?\s*([ABCD])(?:\b|\.)/i);
  if (singleMcq && cleaned.length <= 16) return singleMcq[1].toUpperCase();
  return cleaned.replace(/\s+/g, '').replace(',', '.').toLowerCase();
}

function isMatrixOrRubricTable(grid: string[][]): boolean {
  const headerSlice = grid
    .slice(0, 2)
    .flat()
    .join(' ');
  const looksLikeMatrixSpec =
    /(?:mức\s*độ|nhận\s*biết|thông\s*hiểu|vận\s*dụng|nội\s*dung\s*\/\s*đơn\s*vị|đơn\s*vị\s*kiến\s*thức|tỉ\s*lệ|tổng\s*số\s*câu|tổng\s*điểm|thang\s*điểm)/i.test(
      headerSlice
    );
  const looksLikeAnswerHeader =
    /(?:^|\b)(?:đáp\s*án|chọn|đáp\s*số|answer\s*key)(?:\b|$)/i.test(headerSlice);
  return looksLikeMatrixSpec && !looksLikeAnswerHeader;
}

function normalizeTfCellToken(raw: string): 'Đ' | 'S' | null {
  const cleaned = raw
    .replace(/^\$+|\$+$/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (/^(?:Đ|Đúng|D|True|T)$/i.test(cleaned)) return 'Đ';
  if (/^(?:S|Sai|False|F)$/i.test(cleaned)) return 'S';
  return null;
}

function parseTableKeyLines(
  lines: string[],
  startIdx: number
): { pairs: Array<{ qNum: number; val: string }>; nextIdx: number } {
  const tableLines: string[] = [];
  let cursor = startIdx;
  while (cursor < lines.length && lines[cursor].includes('|')) {
    tableLines.push(lines[cursor]);
    cursor += 1;
  }
  const pairs: Array<{ qNum: number; val: string }> = [];
  if (tableLines.length === 0) return { pairs, nextIdx: startIdx };

  const grid = tableLines.map((ln) => ln.split('|').map((c) => c.trim()));
  if (isMatrixOrRubricTable(grid)) {
    return { pairs: [], nextIdx: cursor - 1 };
  }

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];

    // Case T1 (KNTT Part II 4-row True/False matrix table):
    // Row r:   Câu | 1 | 2 | 3 | 4   (hoặc Câu 1 | Câu 2 | Câu 3 | Câu 4)
    // Row r+1: a)  | Đ | S | Đ | Đ
    // Row r+2: b)  | S | Đ | Đ | S
    // Row r+3: c)  | Đ | Đ | S | Đ
    // Row r+4: d)  | S | S | Đ | S
    if (r + 4 < grid.length) {
      const qCols: Array<{ colIdx: number; qNum: number }> = [];
      row.forEach((cell, cIdx) => {
        const mNum = cell.match(/^(?:Câu|Question|Bài)?\s*(\d{1,3})\s*[:.]?$/i);
        if (mNum) qCols.push({ colIdx: cIdx, qNum: Number(mNum[1]) });
      });
      const subLabels = ['a', 'b', 'c', 'd'] as const;
      const matchesFourSubRows =
        qCols.length >= 1 &&
        subLabels.every((lbl, offset) => {
          const firstCell = (grid[r + 1 + offset][0] ?? '').trim();
          return new RegExp(`^${lbl}\\s*[).:]?$`, 'i').test(firstCell);
        });
      if (matchesFourSubRows) {
        let extractedAnyTf = false;
        for (const { colIdx, qNum } of qCols) {
          const parts: string[] = [];
          subLabels.forEach((lbl, offset) => {
            const cellVal = (grid[r + 1 + offset][colIdx] ?? '').trim();
            const tok = normalizeTfCellToken(cellVal);
            if (tok) parts.push(`${lbl}) ${tok}`);
          });
          if (parts.length >= 2) {
            pairs.push({ qNum, val: parts.join(', ') });
            extractedAnyTf = true;
          }
        }
        if (extractedAnyTf) {
          r += 4;
          continue;
        }
      }
    }

    // Case T2 (Horizontal 5-column True/False row): "Câu 1 | Đ | S | Đ | S" hoặc "1 | Đúng | Sai | Đúng | Sai"
    if (row.length >= 5) {
      const mRowQ = row[0].match(/^(?:Câu|Question|Bài)?\s*(\d{1,3})\s*[:.]?$/i);
      const tfTokens = [1, 2, 3, 4].map((idx) => normalizeTfCellToken(row[idx] ?? ''));
      if (mRowQ && tfTokens.every((t) => t !== null)) {
        const qNum = Number(mRowQ[1]);
        const formatted = `a) ${tfTokens[0]}, b) ${tfTokens[1]}, c) ${tfTokens[2]}, d) ${tfTokens[3]}`;
        pairs.push({ qNum, val: formatted });
        continue;
      }
    }

    // Case B (KNTT 2x6 horizontal table): row r = Câu | 1 | 2 | 3 | 4 | 5 | 6, row r+1 = Đáp án | A | B | C | D | A | B
    if (r + 1 < grid.length) {
      const nextRow = grid[r + 1];
      const numCols: Array<{ colIdx: number; qNum: number }> = [];
      row.forEach((cell, cIdx) => {
        const mNum = cell.match(/^(?:Câu|Question|Bài)?\s*(\d{1,3})\s*[:.]?$/i);
        if (mNum) numCols.push({ colIdx: cIdx, qNum: Number(mNum[1]) });
      });
      const nextRowHasExplicitAnswerLabel =
        /^(?:Đáp\s*án|Chọn|Key|Đáp\s*số|Trả\s*lời)\s*[:.]?$/i.test(nextRow[0] ?? '');
      const hasExplicitHeaderPair =
        numCols.length === 1 &&
        /^(?:Câu|Question|Bài)\s*[:.]?$/i.test(row[0] ?? '') &&
        nextRowHasExplicitAnswerLabel;
      if ((numCols.length >= 2 || hasExplicitHeaderPair) && nextRow.length >= 2) {
        const nextRowIsMostlyAnswers = numCols.some(({ colIdx }) => {
          const v = (nextRow[colIdx] ?? '').trim();
          return (
            Boolean(v) &&
            !/^(?:Câu|Question|Bài|Đáp\s*án|Chọn|Key)$/i.test(v)
          );
        });
        // Make sure row r+1 is not itself another consecutive question-number header row (e.g. 7 | 8 | 9 | 10)
        const nextRowNums = numCols
          .map(({ colIdx }) => (nextRow[colIdx] ?? '').trim())
          .filter((v) => /^\d{1,3}$/.test(v));
        const looksLikeNextNumberRow =
          !nextRowHasExplicitAnswerLabel &&
          nextRowNums.length === numCols.length &&
          numCols.length >= 3 &&
          Number(nextRowNums[1]) === Number(nextRowNums[0]) + 1 &&
          Number(nextRowNums[2]) === Number(nextRowNums[1]) + 1;

        if (nextRowIsMostlyAnswers && !looksLikeNextNumberRow) {
          for (const { colIdx, qNum } of numCols) {
            const v = (nextRow[colIdx] ?? '').trim();
            if (v) pairs.push({ qNum, val: v });
          }
          r += 1;
          continue;
        }
      }
    }

    // Case A: Vertical or paired cells in one row: "1 | A | 2 | B" or "Câu 1 | A | Câu 2 | B"
    for (let c = 0; c + 1 < row.length; c += 2) {
      const mNum = row[c].match(/^(?:Câu|Question|Bài)?\s*(\d{1,3})\s*[:.]?$/i);
      const val = row[c + 1];
      if (mNum && val && !/^(?:Câu|Question|Đáp\s*án|Key)$/i.test(val)) {
        pairs.push({ qNum: Number(mNum[1]), val });
      }
    }
  }
  return { pairs, nextIdx: cursor - 1 };
}

const MATRIX_REGION_HEADER_RE =
  /^\s*(?:[A-Z]\.\s*)?(?:MA\s+TRẬN(?:\s+ĐỀ(?:\s+KIỂM\s+TRA|\s+THI)?)?|BẢNG\s+ĐẶC\s+TẢ|ĐẶC\s+TẢ\s+ĐỀ(?:\s+KIỂM\s+TRA|\s+THI)?)\b/i;

const EXAM_BODY_OPEN_RE =
  /^\s*(?:[B]\.\s*)?(?:ĐỀ\s+(?:KIỂM\s+TRA|THI|MINH\s+HỌA|ÔN\s+TẬP)|PHẦN\s+(?:I|1)\b)/i;

const EXAM_END_MARKER_RE =
  /^\s*(?:[-–—=*_]{2,}\s*)?(?:HẾT|THE\s+END)(?:\s*[-–—=*_]{2,})?\s*[.!]*$/i;

const ANSWER_KEY_REGION_HEADER_RE =
  /^\s*(?:#+\s*)?(?:[A-Z]\.\s*)?(?:BẢNG\s+ĐÁP\s+ÁN(?:\s+VÀ\s+(?:LỜI\s+GIẢI(?:\s+CHI\s+TIẾT)?|HƯỚNG\s+DẪN(?:\s+(?:CHẤM|GIẢI))?))?|ĐÁP\s+ÁN(?:\s+VÀ\s+(?:LỜI\s+GIẢI(?:\s+CHI\s+TIẾT)?|HƯỚNG\s+DẪN(?:\s+(?:CHẤM|GIẢI))?)|\s*(?:ĐỀ\s+GỐC|CHI\s+TIẾT|THAM\s+KHẢO))?|LỜI\s+GIẢI\s+CHI\s+TIẾT|HƯỚNG\s+DẪN\s+(?:CHẤM|GIẢI(?:\s+CHI\s+TIẾT)?)|ANSWER\s+KEY)\s*[:.–-]?\s*$/i;

function segmentDocumentRegions(rawText: string): {
  bodyText: string;
  keyText: string;
  skippedMatrixLines: number;
  sawEndMarker: boolean;
} {
  const lines = rawText.split(/\r?\n/);
  const bodyLines: string[] = [];
  const keyLines: string[] = [];

  type DocRegion = 'INTRO' | 'MATRIX_SPEC' | 'STUDENT_EXAM' | 'ANSWER_KEY_AND_SOLUTION';
  let region: DocRegion = 'INTRO';
  let sawAnyQuestion = false;
  let skippedMatrixLines = 0;
  let sawEndMarker = false;

  const qLineRe = /^\s*(?:\*{1,2}|\[)?(?:Câu|Question|Bài)\s+\d{1,3}(?:\]|\*{1,2})?\s*[.:)\-–]/i;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (region === 'ANSWER_KEY_AND_SOLUTION') {
      keyLines.push(rawLine);
      continue;
    }

    if (region === 'INTRO' || region === 'MATRIX_SPEC') {
      if (MATRIX_REGION_HEADER_RE.test(trimmed)) {
        region = 'MATRIX_SPEC';
        skippedMatrixLines += 1;
        continue;
      }
      if (region === 'MATRIX_SPEC') {
        if (EXAM_BODY_OPEN_RE.test(trimmed) || detectSectionHeader(trimmed)) {
          region = 'STUDENT_EXAM';
          if (detectSectionHeader(trimmed)) {
            bodyLines.push(rawLine);
          }
          continue;
        }
        skippedMatrixLines += 1;
        continue;
      }
      if (
        EXAM_BODY_OPEN_RE.test(trimmed) ||
        detectSectionHeader(trimmed) ||
        qLineRe.test(trimmed)
      ) {
        region = 'STUDENT_EXAM';
      }
    }

    if (region === 'STUDENT_EXAM') {
      if (qLineRe.test(trimmed)) {
        sawAnyQuestion = true;
      }
      if (sawAnyQuestion && EXAM_END_MARKER_RE.test(trimmed)) {
        sawEndMarker = true;
        region = 'ANSWER_KEY_AND_SOLUTION';
        continue;
      }
      if (
        sawAnyQuestion &&
        ANSWER_KEY_REGION_HEADER_RE.test(trimmed)
      ) {
        region = 'ANSWER_KEY_AND_SOLUTION';
        continue;
      }
    }

    bodyLines.push(rawLine);
  }

  return {
    bodyText: bodyLines.join('\n').trim(),
    keyText: keyLines.join('\n').trim(),
    skippedMatrixLines,
    sawEndMarker,
  };
}

function extractTrailingAnswerKeySection(rawText: string): {
  bodyText: string;
  keyByNumber: Map<number, ExtractedAnswerKeyEntry>;
  keyBySectionAndNumber: Map<string, ExtractedAnswerKeyEntry>;
  hasSectionedKeys: boolean;
  skippedMatrixLines: number;
  sawEndMarker: boolean;
} {
  const segmented = segmentDocumentRegions(rawText);
  const bodyText = segmented.bodyText;
  const keyText = segmented.keyText
    .replace(/\[\[ASSET:[^\]]+\]\]/g, '')
    .trim();

  const keyByNumber = new Map<number, ExtractedAnswerKeyEntry>();
  const keyBySectionAndNumber = new Map<string, ExtractedAnswerKeyEntry>();
  let hasSectionedKeys = false;

  if (!keyText) {
    return {
      bodyText,
      keyByNumber,
      keyBySectionAndNumber,
      hasSectionedKeys: false,
      skippedMatrixLines: segmented.skippedMatrixLines,
      sawEndMarker: segmented.sawEndMarker,
    };
  }

  const keyLines = keyText.split(/\r?\n/);
  let keySectionOrdinal = 0;
  let keySectionHint: UniversalQuestionType | undefined;
  let inDetailedSolution = false;
  let activeSolutionQNum: number | null = null;
  let activeSolutionTfMap = new Map<TrueFalseLabel, boolean>();

  const mergeEntry = (
    map: Map<string | number, ExtractedAnswerKeyEntry>,
    mapKey: string | number,
    val: string,
    sourceKind: ExtractedAnswerKeyEntry['sourceKind'],
    location: string
  ) => {
    const existing = map.get(mapKey);
    if (!existing) {
      map.set(mapKey, { raw: val, sourceKind, location });
      return;
    }
    const prevNorm = normalizeComparableKey(existing.raw);
    const nextNorm = normalizeComparableKey(val);
    if (prevNorm && nextNorm && prevNorm !== nextNorm) {
      const evidences = new Set<string>(existing.conflictingEvidences ?? []);
      evidences.add(`${existing.location}: "${existing.raw}"`);
      evidences.add(`${location}: "${val}"`);
      existing.conflictingEvidences = Array.from(evidences);
    }
  };

  const recordPair = (
    qNum: number,
    val: string,
    sourceKind: ExtractedAnswerKeyEntry['sourceKind'],
    location: string
  ) => {
    const trimmedVal = val.replace(/\u00a0/g, ' ').trim();
    if (!Number.isFinite(qNum) || trimmedVal === '') return;
    if (keySectionOrdinal > 0) {
      hasSectionedKeys = true;
      mergeEntry(
        keyBySectionAndNumber,
        `part:${keySectionOrdinal}::${qNum}`,
        trimmedVal,
        sourceKind,
        location
      );
    }
    if (keySectionHint) {
      mergeEntry(
        keyBySectionAndNumber,
        `hint:${keySectionHint}::${qNum}`,
        trimmedVal,
        sourceKind,
        location
      );
    }
    if (!keyByNumber.has(qNum) || keySectionOrdinal === 0) {
      mergeEntry(keyByNumber, qNum, trimmedVal, sourceKind, location);
    }
  };

  const flushActiveSolutionTf = () => {
    if (activeSolutionQNum !== null && activeSolutionTfMap.size > 0) {
      const summary = (['a', 'b', 'c', 'd'] as TrueFalseLabel[])
        .map((lbl) => {
          if (!activeSolutionTfMap.has(lbl)) return '';
          return `${lbl}) ${activeSolutionTfMap.get(lbl) ? 'Đ' : 'S'}`;
        })
        .filter(Boolean)
        .join(', ');
      if (summary) {
        recordPair(
          activeSolutionQNum,
          summary,
          'solution-line',
          `Lời giải Phần ${keySectionOrdinal || 1} Câu ${activeSolutionQNum}`
        );
      }
    }
    activeSolutionTfMap = new Map();
  };

  for (let i = 0; i < keyLines.length; i++) {
    const ln = keyLines[i].trim();
    if (!ln) continue;

    if (
      /^(?:#+\s*)?(?:[A-Z]\.\s*)?(?:LỜI\s+GIẢI\s+CHI\s+TIẾT|HƯỚNG\s+DẪN\s+GIẢI(?:\s+CHI\s+TIẾT)?)\s*[:.–-]?$/i.test(
        ln
      )
    ) {
      flushActiveSolutionTf();
      inDetailedSolution = true;
      keySectionOrdinal = 0;
      keySectionHint = undefined;
      activeSolutionQNum = null;
      continue;
    }

    const sec = detectSectionHeader(ln);
    if (sec) {
      flushActiveSolutionTf();
      keySectionOrdinal = sec.sectionOrdinal ?? keySectionOrdinal + 1;
      keySectionHint = sec.sectionHintType;
      activeSolutionQNum = null;
      continue;
    }

    if (!inDetailedSolution && ln.includes('|')) {
      const { pairs, nextIdx } = parseTableKeyLines(keyLines, i);
      pairs.forEach((p) =>
        recordPair(
          p.qNum,
          p.val,
          'answer-table',
          `Bảng đáp án Phần ${keySectionOrdinal || 1} Câu ${p.qNum}`
        )
      );
      if (pairs.length > 0) {
        i = nextIdx;
        continue;
      }
    }

    if (inDetailedSolution) {
      const solQMatch = ln.match(/^(?:Câu|Question|Bài)\s+(\d{1,3})\s*[.:)\-–]\s*(.*)$/i);
      if (solQMatch) {
        flushActiveSolutionTf();
        activeSolutionQNum = Number(solQMatch[1]);
        const rest = solQMatch[2].trim();
        const directChoose = rest.match(/(?:Chọn|Đáp\s*án(?:\s+đúng)?)\s*[:.]?\s*([ABCD])\b/i);
        if (directChoose) {
          recordPair(
            activeSolutionQNum,
            directChoose[1].toUpperCase(),
            'solution-line',
            `Lời giải Phần ${keySectionOrdinal || 1} Câu ${activeSolutionQNum}`
          );
        }
        const directShort = rest.match(/(?:Đáp\s*số|ĐS|Trả\s*lời)\s*[:.]\s*(.+)$/i);
        if (directShort && directShort[1].trim() !== '') {
          recordPair(
            activeSolutionQNum,
            directShort[1].trim(),
            'solution-line',
            `Lời giải Phần ${keySectionOrdinal || 1} Câu ${activeSolutionQNum}`
          );
        }
        continue;
      }

      if (activeSolutionQNum !== null) {
        const chooseMatch = ln.match(/(?:Chọn|Đáp\s*án(?:\s+đúng)?)\s*[:.]?\s*([ABCD])\b/i);
        if (chooseMatch) {
          recordPair(
            activeSolutionQNum,
            chooseMatch[1].toUpperCase(),
            'solution-line',
            `Lời giải Phần ${keySectionOrdinal || 1} Câu ${activeSolutionQNum}`
          );
        }
        const shortMatch = ln.match(/(?:Đáp\s*số|ĐS|Kết\s*quả)\s*[:.]\s*(.+)$/i);
        if (shortMatch && shortMatch[1].trim() !== '') {
          recordPair(
            activeSolutionQNum,
            shortMatch[1].trim(),
            'solution-line',
            `Lời giải Phần ${keySectionOrdinal || 1} Câu ${activeSolutionQNum}`
          );
        }
        const tfSolMatch = ln.match(/^\s*([a-d])\s*[).]\s*.*\b(Đúng|Sai|True|False)\b/i);
        if (tfSolMatch) {
          const lbl = tfSolMatch[1].toLowerCase() as TrueFalseLabel;
          const isT = /^(?:Đúng|True)$/i.test(tfSolMatch[2]);
          activeSolutionTfMap.set(lbl, isT);
        }
      }
      continue;
    }

    // Hỗ trợ dạng: "1.A  2.B", "Câu 1: Đ-S-Đ-S", "Câu 1. a) Đ, b) S, c) Đ, d) S", "1: −4,3", "2: 0", "3. for; to"
    const pairRe =
      /(?:^|\s)(?:Câu|Question|Bài)?\s*(\d{1,3})\s*[.:)\-–]\s*([^\n]+?)(?=(?:\s+(?:Câu|Question|Bài)?\s*\d{1,3}\s*[.:)\-–])|$)/gi;
    let m: RegExpExecArray | null;
    let matchedAnyPair = false;
    while ((m = pairRe.exec(ln)) !== null) {
      matchedAnyPair = true;
      const qNum = Number(m[1]);
      const val = m[2].trim();
      recordPair(
        qNum,
        val,
        'answer-table',
        `Khóa đáp án Phần ${keySectionOrdinal || 1} Câu ${qNum}`
      );
    }
    // Hỗ trợ dạng bảng đáp án rút gọn không dấu phân cách: "1A 2B 3C 4D 5A ... 12D"
    if (!matchedAnyPair) {
      const compactMcqRe = /(?:^|[\s,;])(\d{1,3})\s*([ABCD])(?=$|[\s,;])/gi;
      while ((m = compactMcqRe.exec(ln)) !== null) {
        const qNum = Number(m[1]);
        const val = m[2].toUpperCase();
        recordPair(
          qNum,
          val,
          'answer-table',
          `Khóa đáp án Phần ${keySectionOrdinal || 1} Câu ${qNum}`
        );
      }
    }
  }

  flushActiveSolutionTf();

  return {
    bodyText,
    keyByNumber,
    keyBySectionAndNumber,
    hasSectionedKeys,
    skippedMatrixLines: segmented.skippedMatrixLines,
    sawEndMarker: segmented.sawEndMarker,
  };
}

interface ParsedSectionChunk {
  sectionTitle: string;
  sectionOrdinal?: number;
  sectionHintType?: UniversalQuestionType;
  declaredCount?: number;
  declaredCountEvidence?: string;
}

function parseSectionOrdinalToken(token: string): number | undefined {
  const upper = token.trim().toUpperCase();
  if (/^\d+$/.test(upper)) {
    const n = Number(upper);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const romanMap: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
  };
  if (romanMap[upper]) return romanMap[upper];
  if (/^[A-D]$/.test(upper)) return upper.charCodeAt(0) - 64;
  return undefined;
}

function extractDeclaredCountFromText(text: string): {
  count?: number;
  evidence?: string;
} {
  // Pattern 1: "từ câu 1 đến câu 12"
  const rangeM = text.match(/từ\s+câu\s+(\d{1,3})\s+đến\s+(?:câu\s+)?(\d{1,3})/i);
  if (rangeM) {
    const start = Number(rangeM[1]);
    const end = Number(rangeM[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return { count: end - start + 1, evidence: rangeM[0] };
    }
  }
  // Pattern 2: "gồm 4 câu", "(6 câu)", "có 12 câu"
  const countM = text.match(/(?:gồm|có|\()\s*(\d{1,3})\s+câu(?:\s+hỏi)?\b/i);
  if (countM) {
    const c = Number(countM[1]);
    if (Number.isFinite(c) && c > 0 && c <= 200) {
      return { count: c, evidence: countM[0] };
    }
  }
  return {};
}

function detectSectionHeader(line: string): ParsedSectionChunk | null {
  const trimmed = line.trim();
  if (trimmed.length > 180) return null;
  const headerRe =
    /^(?:PHẦN|SECTION|PART)\s+([IVX]+|\d+|[A-D])\s*[.:–-]?\s*(.*)$/i;
  const m = trimmed.match(headerRe);
  if (!m) return null;
  const sectionOrdinal = parseSectionOrdinalToken(m[1]);
  const rest = m[2].toLowerCase();
  let hint: UniversalQuestionType | undefined;
  if (/đọc\s*hiểu|reading|cloze|ngữ\s*liệu/.test(rest)) hint = 'reading-comprehension';
  else if (/đúng\s*\/?\s*sai|true\s*\/?\s*false/.test(rest)) hint = 'true-false';
  else if (/trả\s*lời\s*ngắn|short\s*answer/.test(rest)) hint = 'short-answer';
  else if (/điền\s*khuyết|gap\s*fill|cloze/.test(rest)) hint = 'fill-blank';
  else if (/ghép\s*đôi|matching|nối\s*cột/.test(rest)) hint = 'matching';
  else if (/sắp\s*xếp|ordering|arrangement/.test(rest)) hint = 'ordering';
  else if (/tự\s*luận|làm\s*văn|writing|essay/.test(rest)) hint = 'essay';
  else if (/trắc\s*nghiệm|nhiều\s*phương\s*án|multiple\s*choice|vocabulary|grammar|phonetics/.test(rest)) hint = 'mcq';

  const declared = extractDeclaredCountFromText(trimmed);
  return {
    sectionTitle: trimmed,
    sectionOrdinal,
    sectionHintType: hint,
    declaredCount: declared.count,
    declaredCountEvidence: declared.evidence,
  };
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

  const {
    bodyText,
    keyByNumber,
    keyBySectionAndNumber,
    hasSectionedKeys,
    skippedMatrixLines,
  } = extractTrailingAnswerKeySection(trimmed);
  const lines = bodyText.split(/\r?\n/);

  // Map DOCX paragraph underline metadata by line text for exact per-question candidate tracking
  const underlinedOptsByLine = new Map<string, Array<'A' | 'B' | 'C' | 'D'>>();
  const underlinedStmtsByLine = new Map<string, Array<'a' | 'b' | 'c' | 'd'>>();
  const paragraphLocByLine = new Map<string, string>();
  const oleWmfPreviewIdSet = new Set<string>();
  for (const seg of options?.docxParagraphs ?? []) {
    for (const pid of seg.oleWmfPreviewAssetIds ?? []) {
      oleWmfPreviewIdSet.add(pid);
    }
    const segLines = seg.text.split(/\r?\n/);
    for (const sl of segLines) {
      const normKey = sl.trim();
      if (!normKey) continue;
      if (seg.paragraphLocation && !paragraphLocByLine.has(normKey)) {
        paragraphLocByLine.set(normKey, seg.paragraphLocation);
      }
      if (seg.underlinedOptionLabels?.length) {
        const cur = underlinedOptsByLine.get(normKey) ?? [];
        for (const l of seg.underlinedOptionLabels) {
          if (!cur.includes(l)) cur.push(l);
        }
        underlinedOptsByLine.set(normKey, cur);
      }
      if (seg.underlinedStatementLabels?.length) {
        const cur = underlinedStmtsByLine.get(normKey) ?? [];
        for (const l of seg.underlinedStatementLabels) {
          if (!cur.includes(l)) cur.push(l);
        }
        underlinedStmtsByLine.set(normKey, cur);
      }
    }
  }

  interface RawQuestionBlock {
    questionNumber: number;
    sectionOrdinal: number;
    sectionTitle: string;
    sectionHintType?: UniversalQuestionType;
    lines: string[];
    passageGroupKey?: string;
    paragraphLocation?: string;
  }

  interface SectionMetaTracker {
    sectionOrdinal: number;
    sectionTitle: string;
    declaredCount?: number;
    declaredCountEvidence?: string;
    actualCount: number;
  }

  let currentSectionTitle =
    subjectProfile.defaultSections[0]?.title ?? MATH_SECTION_TITLES.mcq;
  let currentSectionHint: UniversalQuestionType | undefined;
  let currentSectionOrdinal = 1;
  let sawSectionOrQuestion = false;

  const sectionTrackers = new Map<number, SectionMetaTracker>();
  const ensureSectionTracker = (
    ordinal: number,
    title: string,
    declaredCount?: number,
    evidence?: string
  ): SectionMetaTracker => {
    let tr = sectionTrackers.get(ordinal);
    if (!tr) {
      tr = {
        sectionOrdinal: ordinal,
        sectionTitle: title,
        declaredCount,
        declaredCountEvidence: evidence,
        actualCount: 0,
      };
      sectionTrackers.set(ordinal, tr);
    } else if (declaredCount !== undefined && tr.declaredCount === undefined) {
      tr.declaredCount = declaredCount;
      tr.declaredCountEvidence = evidence;
    }
    return tr;
  };

  const pendingPassages: Map<string, PendingPassageRange> = new Map();
  let activePassageKey: string | undefined;
  let collectingPassageLines: { key: string; meta: ReturnType<typeof detectPassageIntroLine> } | null =
    null;
  let pendingLeadAssetLines: string[] = [];

  const blocks: RawQuestionBlock[] = [];
  let currentBlock: RawQuestionBlock | null = null;
  const unparsedSegments: string[] = [];

  const questionStartRe =
    /^\s*(?:\*{1,2}|\[)?(?:Câu|Question|Bài)\s+(\d{1,3})(?:\]|\*{1,2})?\s*[.:)\-–]\s*(.*)$/i;

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();

    // 1. Section Header
    const sec = detectSectionHeader(rawLine);
    if (sec) {
      if (sec.sectionOrdinal !== undefined) {
        currentSectionOrdinal = sec.sectionOrdinal;
      } else if (sawSectionOrQuestion) {
        currentSectionOrdinal += 1;
      }
      sawSectionOrQuestion = true;
      currentSectionTitle = sec.sectionTitle;
      currentSectionHint = sec.sectionHintType;
      ensureSectionTracker(
        currentSectionOrdinal,
        sec.sectionTitle,
        sec.declaredCount,
        sec.declaredCountEvidence
      );
      collectingPassageLines = null;
      activePassageKey = undefined;
      // Do NOT clear pendingLeadAssetLines if an anchored image was placed right before a section/question; clear only if unrelated
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // 1b. Section instruction line (right after section header, before first question of that section)
    if (!currentBlock && sawSectionOrQuestion && trimmedLine && !questionStartRe.test(rawLine)) {
      const decl = extractDeclaredCountFromText(trimmedLine);
      if (decl.count !== undefined) {
        ensureSectionTracker(
          currentSectionOrdinal,
          currentSectionTitle,
          decl.count,
          decl.evidence
        );
      }
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
      pendingLeadAssetLines = [];
      continue;
    }

    // 3. Question Start
    const qMatch = rawLine.match(questionStartRe);
    if (qMatch) {
      sawSectionOrQuestion = true;
      collectingPassageLines = null;
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      const qNum = Number(qMatch[1]);
      const tr = ensureSectionTracker(currentSectionOrdinal, currentSectionTitle);
      tr.actualCount += 1;

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
      const initialLines = qMatch[2] ? [qMatch[2]] : [];
      if (pendingLeadAssetLines.length > 0) {
        initialLines.push(...pendingLeadAssetLines);
        pendingLeadAssetLines = [];
      }
      currentBlock = {
        questionNumber: qNum,
        sectionOrdinal: currentSectionOrdinal,
        sectionTitle: currentSectionTitle,
        sectionHintType: currentSectionHint,
        lines: initialLines,
        passageGroupKey: linkedKey,
        paragraphLocation: paragraphLocByLine.get(trimmedLine),
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
      if (/\[\[ASSET:/.test(trimmedLine)) {
        const assetIdsInLine = Array.from(trimmedLine.matchAll(/\[\[ASSET:([^\]]+)\]\]/g)).map(
          (m) => m[1]
        );
        const isHeaderAsset =
          isExamHeaderBannerTable(trimmedLine) ||
          (assetIdsInLine.length > 0 &&
            assetIdsInLine.every((id) => {
              const found = assetLookup.get(id);
              return (
                found?.kind === 'data-table' &&
                isExamHeaderBannerTable(found.sourceData)
              );
            }));
        if (!isHeaderAsset) {
          // Ảnh neo (wp:anchor) hoặc bảng đứng ngay trước câu kế tiếp luôn được gắn vào câu đó
          pendingLeadAssetLines.push(rawLine);
        }
      } else if (
        !/^(?:ĐỀ\s+KIỂM\s+TRA|ĐỀ\s+THI|SỞ\s+GIÁO\s+DỤC|PHÒNG\s+GIÁO\s+DỤC|BỘ\s+GIÁO\s+DỤC|MÔN|THỜI\s+GIAN|TRƯỜNG|LỚP|HỌ\s+VÀ\s+TÊN|SỐ\s+BÁO\s+DANH|MÃ\s+ĐỀ|NĂM\s+HỌC|HỌC\s+K[ÌỲ]|THÍ\s+SINH)/i.test(
          trimmedLine
        ) &&
        !isExamHeaderBannerTable(trimmedLine)
      ) {
        unparsedSegments.push(trimmedLine.slice(0, 120));
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  // Phát hiện số câu bị lặp lại giữa nhiều phần (VD: Phần I Câu 1, Phần II Câu 1, Phần III Câu 1)
  const qNumOccurrences = new Map<number, number>();
  for (const blk of blocks) {
    qNumOccurrences.set(blk.questionNumber, (qNumOccurrences.get(blk.questionNumber) ?? 0) + 1);
  }

  const sectionCountAudits: SectionCountAudit[] = Array.from(sectionTrackers.values()).map(
    (tr) => ({
      sectionTitle: tr.sectionTitle,
      sectionOrdinal: tr.sectionOrdinal,
      declaredCount: tr.declaredCount,
      actualCount: tr.actualCount,
      mismatch:
        tr.declaredCount !== undefined && tr.declaredCount !== tr.actualCount,
      evidence: tr.declaredCountEvidence,
    })
  );

  const now = new Date().toISOString();
  const warnings = [...baseWarnings];
  if (skippedMatrixLines > 0) {
    warnings.push(
      `Đã tự động bỏ qua ${skippedMatrixLines} dòng thuộc vùng MA TRẬN / BẢNG ĐẶC TẢ trước phần đề thi chính thức.`
    );
  }
  for (const audit of sectionCountAudits) {
    if (audit.mismatch) {
      warnings.push(
        `Lệch số lượng câu tại "${audit.sectionTitle}": đề khai báo ${audit.declaredCount} câu (${audit.evidence ?? 'theo tiêu đề'}) nhưng đọc được ${audit.actualCount} câu.`
      );
    }
  }

  const questions: MathQuestion[] = [];
  const groupQuestionsMap = new Map<string, string[]>();
  const codePrefix = options?.codePrefix ?? 'IMP';
  const usedCodes = new Set<string>();

  const computeFormulaStatusForQuestion = (
    rawTexts: string[],
    attachedAssets: MathVisualAsset[]
  ): FormulaRenderStatus => {
    const joined = rawTexts.join('\n');
    const unresolvedOleMatches = joined.match(/\[CÔNG_THỨC_OLE_LEGACY\]/g) ?? [];
    const unresolvedOmmlMatches = joined.match(/\[CÔNG_THỨC_OMML_CẦN_KIỂM_TRA\]/g) ?? [];
    const unresolvedCount = unresolvedOleMatches.length + unresolvedOmmlMatches.length;
    const previewAssets = attachedAssets.filter((a) => oleWmfPreviewIdSet.has(a.id));
    const hasOmml = collectOmmlForText(joined, ommlFragments).length > 0;
    const hasLatex = /\$[^$]+\$/.test(joined);

    if (unresolvedCount > 0) {
      return {
        displayable: false,
        machineReadable: false,
        sourceKind: 'unresolved-ole',
        unresolvedCount,
        previewAssetIds: previewAssets.map((a) => a.id),
        details: [
          `Còn ${unresolvedCount} công thức chưa giải mã được (placeholder) trong câu hỏi.`,
        ],
      };
    }
    if (previewAssets.length > 0) {
      return {
        displayable: true,
        machineReadable: false,
        sourceKind: 'ole-wmf-preview',
        unresolvedCount: 0,
        previewAssetIds: previewAssets.map((a) => a.id),
        details: [
          `Có ${previewAssets.length} công thức dựng từ ảnh vector WMF→SVG (hiển thị được, không có LaTeX máy đọc được).`,
        ],
      };
    }
    if (hasOmml) {
      return {
        displayable: true,
        machineReadable: true,
        sourceKind: 'omml',
        unresolvedCount: 0,
      };
    }
    if (hasLatex) {
      return {
        displayable: true,
        machineReadable: true,
        sourceKind: 'latex',
        unresolvedCount: 0,
      };
    }
    return {
      displayable: true,
      machineReadable: true,
      sourceKind: 'none',
      unresolvedCount: 0,
    };
  };

  blocks.forEach((blk, idx) => {
    const qId = createIdFn('mq');
    const paddedNum = String(blk.questionNumber || idx + 1).padStart(2, '0');
    let code = `${codePrefix}-${paddedNum}`;
    if (usedCodes.has(code)) {
      code = `${codePrefix}-P${blk.sectionOrdinal}-${paddedNum}`;
      let dupIdx = 2;
      while (usedCodes.has(code)) {
        code = `${codePrefix}-P${blk.sectionOrdinal}-${paddedNum}-${dupIdx}`;
        dupIdx += 1;
      }
    }
    usedCodes.add(code);

    // Collect DOCX underline evidence strictly belonging to this question's lines
    const qUnderlinedOptionLabels: Array<'A' | 'B' | 'C' | 'D'> = [];
    const qUnderlinedStmtLabels: Array<'a' | 'b' | 'c' | 'd'> = [];
    for (const ln of blk.lines) {
      const key = ln.trim();
      const opts = underlinedOptsByLine.get(key);
      if (opts) {
        for (const o of opts) {
          if (!qUnderlinedOptionLabels.includes(o)) qUnderlinedOptionLabels.push(o);
        }
      }
      const stmts = underlinedStmtsByLine.get(key);
      if (stmts) {
        for (const s of stmts) {
          if (!qUnderlinedStmtLabels.includes(s)) qUnderlinedStmtLabels.push(s);
        }
      }
    }

    const rawChunkWithMarkers = blk.lines.join('\n').trim();

    // Kiểm tra đáp án inline trong khối câu hỏi (giữ nguyên [[ASSET:...]] để phân bổ đúng cho từng phương án!)
    const inlineAnsMatch = rawChunkWithMarkers.match(
      /(?:^|\n)\s*(?:Đáp án(?:\s+đúng)?|ĐA|Đáp\s*số|ĐS|Answer|Key)\s*[:.]\s*([^\n]+)$/i
    );
    const bodyWithMarkers = inlineAnsMatch
      ? rawChunkWithMarkers.slice(0, inlineAnsMatch.index).trim()
      : rawChunkWithMarkers;
    const inlineAnswerRaw = inlineAnsMatch ? inlineAnsMatch[1].trim() : '';

    const numRepeatsAcrossSections = (qNumOccurrences.get(blk.questionNumber) ?? 0) > 1;
    const sectionScopedEntry =
      keyBySectionAndNumber.get(`part:${blk.sectionOrdinal}::${blk.questionNumber}`) ??
      (blk.sectionHintType
        ? keyBySectionAndNumber.get(`hint:${blk.sectionHintType}::${blk.questionNumber}`)
        : undefined);
    const fallbackGlobalEntry =
      !hasSectionedKeys && !numRepeatsAcrossSections
        ? keyByNumber.get(blk.questionNumber)
        : !hasSectionedKeys && blk.sectionOrdinal === 1
        ? keyByNumber.get(blk.questionNumber)
        : undefined;
    const matchedTrailingEntry = sectionScopedEntry ?? fallbackGlobalEntry;

    const declaredAnswerRaw = inlineAnswerRaw || matchedTrailingEntry?.raw || '';
    const hasKeyConflict = Boolean(matchedTrailingEntry?.conflictingEvidences?.length);
    const keySourceKind: AnswerProvenance['sourceKind'] = inlineAnswerRaw
      ? 'inline-key'
      : matchedTrailingEntry?.sourceKind;
    const keySourceLocation = inlineAnswerRaw
      ? `Đáp án ngay trong khối Câu ${blk.questionNumber}`
      : matchedTrailingEntry?.location;

    const sectionTracker = sectionTrackers.get(blk.sectionOrdinal);
    const baseSourceTrace = {
      sourceFileHash: options?.sourceFileHash,
      sourceFileName: options?.fileName,
      sourcePart: 'word/document.xml',
      paragraphLocation: blk.paragraphLocation,
      sectionOrdinal: blk.sectionOrdinal,
      originalQuestionNumberInSection: blk.questionNumber,
      sectionDeclaredCount: sectionTracker?.declaredCount,
      sectionActualCount: sectionTracker?.actualCount,
      matchedKeyLocation: keySourceLocation,
    };

    // A. Kiểm tra Đúng / Sai 4 ý: a) ... b) ... c) ... d) ... (hỗ trợ cả đầu dòng, sau tab, hoặc dính liền $/[[ASSET:)
    const tfRegex = /(?:^|\n|\t)\s*([a-d])\s*[).](?:\s+|(?=\$|\[\[ASSET:|[−\-0-9]))/g;
    const tfMatches: Array<{ label: TrueFalseLabel; index: number; contentStart: number }> = [];
    let tfm: RegExpExecArray | null;
    while ((tfm = tfRegex.exec(bodyWithMarkers)) !== null) {
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

    // B. Kiểm tra MCQ / Multi-Select A. B. C. D. (hỗ trợ *A., sau tab/xuống dòng/khoảng trắng, và A. dính sát $/[[ASSET:/số)
    const mcqRegex =
      /(?:^|\n|\t|[ ]{1,})(\*?)([ABCD])\.(?:\s+|(?=\$|\[\[ASSET:|\\|[−\-+0-9(\[]))/g;
    const mcqMatches: Array<{
      starred: boolean;
      label: McqOptionLabel;
      index: number;
      contentStart: number;
    }> = [];
    let mcqm: RegExpExecArray | null;
    while ((mcqm = mcqRegex.exec(bodyWithMarkers)) !== null) {
      mcqMatches.push({
        starred: mcqm[1] === '*',
        label: mcqm[2].toUpperCase() as McqOptionLabel,
        index: mcqm.index,
        contentStart: mcqm.index + mcqm[0].length,
      });
    }
    const lastFourMcq = mcqMatches.length >= 4 ? mcqMatches.slice(-4) : [];
    const hasFourMcq =
      !isTrueFalseBlock &&
      lastFourMcq.length === 4 &&
      lastFourMcq.map((m) => m.label).join('') === 'ABCD';

    // B2. Kiểm tra dòng "A. <giá trị>" xuất hiện trong Phần III (Trả lời ngắn) — ứng viên đáp án ngắn chứ không phải MCQ!
    let part3ShortAnswerCandidate: string | undefined;
    let bodyCleanForNonMcq = bodyWithMarkers;
    if (
      !hasFourMcq &&
      !isTrueFalseBlock &&
      blk.sectionHintType === 'short-answer'
    ) {
      const part3AMatch = bodyWithMarkers.match(
        /(?:^|\n)\s*A\.\s*([^\n]+?)\s*$/
      );
      if (part3AMatch && !/\bB\./.test(bodyWithMarkers)) {
        part3ShortAnswerCandidate = part3AMatch[1].trim();
        bodyCleanForNonMcq = bodyWithMarkers.slice(0, part3AMatch.index).trim();
      }
    }

    // Extract assets for non-MCQ branches safely
    const { cleanedText: bodyClean, assets: qAssets } = extractAssetMarkersAndClean(
      bodyCleanForNonMcq,
      assetLookup
    );

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
      // Tách tài nguyên ĐỘC LẬP cho thân câu và từng phương án A/B/C/D!
      const rawStemPart = bodyWithMarkers.slice(0, lastFourMcq[0].index).trim();
      const { cleanedText: stemText, assets: stemAssets } = extractAssetMarkersAndClean(
        rawStemPart,
        assetLookup
      );

      const rawOptionSlices = lastFourMcq.map((m, oIdx) => {
        const endIdx = oIdx < 3 ? lastFourMcq[oIdx + 1].index : bodyWithMarkers.length;
        return bodyWithMarkers.slice(m.contentStart, endIdx).trim();
      });

      const parsedOptions = rawOptionSlices.map((rawSlice) =>
        extractAssetMarkersAndClean(rawSlice, assetLookup)
      );

      const letterMatches = Array.from(
        declaredAnswerRaw.toUpperCase().matchAll(/(?<![A-Z])([ABCD])(?![A-Z])/g)
      ).map((m) => m[1] as McqOptionLabel);
      const starredLabels = lastFourMcq.filter((m) => m.starred).map((m) => m.label);
      const explicitLetters =
        letterMatches.length > 0 ? Array.from(new Set(letterMatches)) : starredLabels;

      // Trong Phần I (trắc nghiệm 1 đáp án đúng), KHÔNG tự chuyển thành multi-select nếu đề không yêu cầu chọn nhiều!
      const explicitlyAsksMultiSelect =
        /chọn\s+(?:nhiều|các|tất\s+cả)\s+(?:đáp\s+án|phương\s+án)|multiple\s+answers/i.test(
          stemText
        );
      const isSingleChoiceSection = blk.sectionHintType === 'mcq';
      const isMultiSelect =
        explicitlyAsksMultiSelect ||
        (!isSingleChoiceSection && explicitLetters.length > 1);

      const effectiveLetters =
        isSingleChoiceSection && explicitLetters.length > 1
          ? [] // Mâu thuẫn: nhiều chữ cái trong phần 1 đáp án -> chặn và yêu cầu duyệt!
          : explicitLetters;

      const hasValidKey = effectiveLetters.length > 0 && !hasKeyConflict;
      const answerConfirmed = hasValidKey;

      let answerProvenance: AnswerProvenance;
      if (hasKeyConflict) {
        answerProvenance = {
          status: 'conflict',
          sourceKind: keySourceKind,
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: keySourceLocation,
          rawEvidence: declaredAnswerRaw,
          conflictingEvidence: matchedTrailingEntry?.conflictingEvidences,
          note: 'Bảng đáp án và lời giải chi tiết đưa ra đáp án khác nhau — bắt buộc giáo viên đối chiếu và chọn đáp án đúng.',
        };
      } else if (isSingleChoiceSection && explicitLetters.length > 1) {
        answerProvenance = {
          status: 'conflict',
          sourceKind: keySourceKind,
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: keySourceLocation,
          rawEvidence: declaredAnswerRaw,
          conflictingEvidence: explicitLetters,
          note: `Phần trắc nghiệm 1 đáp án nhưng khóa đọc được nhiều chữ cái (${explicitLetters.join(', ')}) — cần giáo viên xác nhận.`,
        };
      } else if (answerConfirmed) {
        answerProvenance = {
          status: 'source-matched',
          sourceKind: starredLabels.length > 0 && letterMatches.length === 0 ? 'inline-key' : keySourceKind ?? 'inline-key',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: keySourceLocation ?? `Đánh dấu * trong đề gốc`,
          rawEvidence: declaredAnswerRaw || starredLabels.join(', '),
        };
      } else if (qUnderlinedOptionLabels.length > 0) {
        answerProvenance = {
          status: 'needs-review',
          sourceKind: 'underline-candidate',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: blk.paragraphLocation,
          candidateConvention: 'underlined-option',
          rawEvidence: `Gạch chân nhãn phương án: ${qUnderlinedOptionLabels.join(', ')}`,
          note:
            qUnderlinedOptionLabels.length === 1
              ? `Phát hiện gạch chân tại phương án ${qUnderlinedOptionLabels[0]} (chưa có bảng đáp án đối chiếu). Giáo viên cần xác nhận quy ước gạch chân.`
              : `Phát hiện nhiều nhãn phương án được gạch chân (${qUnderlinedOptionLabels.join(', ')}) — cần giáo viên chọn chính xác 1 đáp án.`,
        };
      } else {
        answerProvenance = {
          status: 'missing',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: blk.paragraphLocation,
          note: 'Không có khóa đáp án A/B/C/D trong tài liệu gốc — tuyệt đối không tự gán mặc định A.',
        };
      }

      if (!answerConfirmed) {
        warnings.push(
          `Câu ${blk.questionNumber} (${code}): ${answerProvenance.note ?? 'Chưa có khóa đáp án được xác nhận.'}`
        );
      }

      const builtOptions: McqOption[] = parsedOptions.map((po, oIdx) => {
        const lbl = MCQ_LABELS[oIdx];
        const isCorrect = answerConfirmed
          ? isMultiSelect
            ? effectiveLetters.includes(lbl)
            : lbl === effectiveLetters[0]
          : false;
        return {
          id: `${qId}-opt-${oIdx + 1}`,
          originalLabel: lbl,
          content: createImmutableContentPayload(po.cleanedText, `${qId}-o${oIdx + 1}`, {
            rawXmlFragments: collectOmmlForText(po.cleanedText, ommlFragments),
            preserveExactWhitespace: preserveWhitespace,
          }),
          isCorrect,
          ...(po.assets[0] ? { visualAsset: po.assets[0] } : {}),
        };
      });

      const primaryCorrectOption = answerConfirmed
        ? builtOptions.find((o) => o.isCorrect)
        : undefined;

      const extraOptionAssets = parsedOptions.flatMap((po) => po.assets.slice(1));
      const allQuestionAssets = [...stemAssets, ...extraOptionAssets];
      const allAttachedIncludingOptions = [
        ...allQuestionAssets,
        ...builtOptions.map((o) => o.visualAsset).filter((a): a is MathVisualAsset => Boolean(a)),
      ];

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

      const formulaStatus = computeFormulaStatusForQuestion(
        [stemText, ...builtOptions.map((o) => o.content.rawSource)],
        allAttachedIncludingOptions
      );

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
        correctOptionId: primaryCorrectOption?.id,
        ...(multiSelectOptions
          ? {
              multiSelectOptions,
              correctOptionIds: multiSelectOptions
                .filter((o) => o.isCorrect)
                .map((o) => o.id),
            }
          : {}),
        solutionGuide: createImmutableContentPayload('', `${qId}-sol`),
        visualAssets: allQuestionAssets,
        hasVisualAsset: allAttachedIncludingOptions.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: false,
        lockOptionShuffle: depFlags.length > 0,
        allowStatementShuffle: false,
        dependencyFlags: depFlags,
        answerConfirmed,
        answerProvenance,
        formulaStatus,
        sourceTrace: baseSourceTrace,
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
      const rawStemPart = bodyWithMarkers.slice(0, tfMatches[0].index).trim();
      const { cleanedText: stemText, assets: stemAssets } = extractAssetMarkersAndClean(
        rawStemPart,
        assetLookup
      );
      const stmtSlices = tfMatches.slice(0, 4).map((m, sIdx) => {
        const endIdx =
          sIdx + 1 < Math.min(4, tfMatches.length)
            ? tfMatches[sIdx + 1].index
            : bodyWithMarkers.length;
        return bodyWithMarkers.slice(m.contentStart, endIdx).trim();
      });
      const parsedStmts = stmtSlices.map((s) => extractAssetMarkersAndClean(s, assetLookup));
      const stmtAssets = parsedStmts.flatMap((ps) => ps.assets);
      const combinedTfAssets = [...stemAssets, ...stmtAssets];

      // Parse per-statement labeled keys first ("a) Đ, b) S, c) Đ, d) S"), fallback to ordered tokens ("Đ-S-Đ-S")
      const labeledTf = new Map<TrueFalseLabel, boolean>();
      const labeledRe = /([a-d])\s*[).:\-]?\s*(ĐÚNG|SAI|TRUE|FALSE|[ĐTFS])(?![\p{L}\p{N}])/giu;
      let lm: RegExpExecArray | null;
      while ((lm = labeledRe.exec(declaredAnswerRaw)) !== null) {
        const lbl = lm[1].toLowerCase() as TrueFalseLabel;
        labeledTf.set(lbl, /^(Đ|ĐÚNG|T|TRUE)$/i.test(lm[2]));
      }

      const orderedTfTokens =
        labeledTf.size > 0
          ? []
          : Array.from(
              declaredAnswerRaw
                .toUpperCase()
                .matchAll(/(?<![\p{L}\p{N}])(ĐÚNG|SAI|TRUE|FALSE|[ĐTFS])(?![\p{L}\p{N}])/giu)
            ).map((m) => /^(Đ|ĐÚNG|T|TRUE)$/i.test(m[1]));

      const statements: TrueFalseStatement[] = parsedStmts.map((ps, sIdx) => {
        const lbl = TF_LABELS[sIdx] ?? (String(sIdx + 1) as TrueFalseLabel);
        const txt = ps.cleanedText;
        const inlineMatch = txt.match(/\[(Đ|S|Đúng|Sai|T|F|True|False)\]\s*$/i);
        const cleanSt = txt.replace(/\[(Đ|S|Đúng|Sai|T|F|True|False)\]\s*$/i, '').trim();
        const isUnderlined = qUnderlinedStmtLabels.includes(lbl);

        let resolvedBool: boolean | undefined;
        if (labeledTf.has(lbl)) {
          resolvedBool = labeledTf.get(lbl);
        } else if (orderedTfTokens[sIdx] !== undefined) {
          resolvedBool = orderedTfTokens[sIdx];
        } else if (inlineMatch) {
          resolvedBool = /^(Đ|Đúng|T|True)$/i.test(inlineMatch[1]);
        }

        const answerState: TrueFalseStatement['answerState'] =
          resolvedBool !== undefined
            ? 'confirmed'
            : isUnderlined
            ? 'candidate'
            : 'missing';

        return {
          id: `${qId}-st-${sIdx + 1}`,
          originalLabel: lbl,
          content: createImmutableContentPayload(cleanSt, `${qId}-s${sIdx + 1}`, {
            rawXmlFragments: collectOmmlForText(cleanSt, ommlFragments),
            preserveExactWhitespace: preserveWhitespace,
          }),
          isTrue: resolvedBool ?? false,
          answerState,
          underlinedInSource: isUnderlined || undefined,
        };
      });

      const allStatementsConfirmed =
        statements.length > 0 &&
        statements.every((st) => st.answerState === 'confirmed') &&
        !hasKeyConflict;

      let answerProvenance: AnswerProvenance;
      if (hasKeyConflict) {
        answerProvenance = {
          status: 'conflict',
          sourceKind: keySourceKind,
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: keySourceLocation,
          rawEvidence: declaredAnswerRaw,
          conflictingEvidence: matchedTrailingEntry?.conflictingEvidences,
          note: 'Các nguồn đáp án Đúng/Sai trong tài liệu mâu thuẫn nhau — cần giáo viên đối chiếu.',
        };
      } else if (allStatementsConfirmed) {
        answerProvenance = {
          status: 'source-matched',
          sourceKind: keySourceKind ?? 'inline-key',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: keySourceLocation ?? 'Đánh dấu [Đ]/[S] trong câu hỏi',
          rawEvidence:
            declaredAnswerRaw ||
            statements.map((st) => `${st.originalLabel})${st.isTrue ? 'Đ' : 'S'}`).join(' '),
        };
      } else if (qUnderlinedStmtLabels.length > 0) {
        answerProvenance = {
          status: 'needs-review',
          sourceKind: 'underline-candidate',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: blk.paragraphLocation,
          candidateConvention: 'underlined-statements-only',
          rawEvidence: `Gạch chân ý: ${qUnderlinedStmtLabels.join(', ')}`,
          note: `Phát hiện gạch chân tại ý ${qUnderlinedStmtLabels.join(', ')} nhưng không có bảng Đ/S. Hệ thống KHÔNG tự suy các ý còn lại là Sai — giáo viên cần xác nhận rõ cả 4 ý.`,
        };
      } else {
        const missingLabels = statements
          .filter((st) => st.answerState !== 'confirmed')
          .map((st) => st.originalLabel);
        answerProvenance = {
          status: 'missing',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: blk.paragraphLocation,
          note: `Thiếu khóa Đúng/Sai cho ý ${missingLabels.join(', ')} — cần giáo viên xác nhận ở Bước 2.`,
        };
      }

      if (!allStatementsConfirmed) {
        warnings.push(
          `Câu Đúng/Sai #${blk.questionNumber} (${code}): ${answerProvenance.note}`
        );
      }

      const depStFlags = detectDependentStatements(statements);
      const formulaStatus = computeFormulaStatusForQuestion(
        [stemText, ...statements.map((s) => s.content.rawSource)],
        combinedTfAssets
      );

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
        visualAssets: combinedTfAssets,
        hasVisualAsset: combinedTfAssets.length > 0,
        groupId: blk.passageGroupKey,
        lockQuestionPosition: false,
        lockOptionShuffle: depStFlags.length > 0,
        allowStatementShuffle: depStFlags.length === 0,
        dependencyFlags: depStFlags,
        answerConfirmed: allStatementsConfirmed,
        answerProvenance,
        formulaStatus,
        sourceTrace: baseSourceTrace,
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
      (blk.sectionHintType !== 'short-answer' &&
        /tự luận|làm văn|viết đoạn|viết bài|nghị luận|chứng minh|phân tích|cảm nhận|write an essay|write a paragraph/i.test(
          `${blk.sectionTitle} ${bodyClean}`
        ));

    if (isEssay) {
      const hasEssayAnswer = declaredAnswerRaw.trim().length > 0;
      const essayFormulaStatus = computeFormulaStatusForQuestion(
        [bodyClean, declaredAnswerRaw],
        qAssets
      );
      const essayProvenance: AnswerProvenance = hasEssayAnswer
        ? {
            status: 'source-matched',
            sourceKind: keySourceKind ?? 'solution-line',
            sourceFileHash: options?.sourceFileHash,
            sourceLocation: keySourceLocation,
            rawEvidence: declaredAnswerRaw,
          }
        : {
            status: 'missing',
            sourceFileHash: options?.sourceFileHash,
            sourceLocation: blk.paragraphLocation,
            note: 'Câu Tự luận chưa có đáp số (ĐS:) hoặc hướng dẫn chấm trong tệp gốc.',
          };

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
        answerConfirmed: hasEssayAnswer,
        answerProvenance: essayProvenance,
        formulaStatus: essayFormulaStatus,
        sourceTrace: baseSourceTrace,
        createdAt: now,
        updatedAt: now,
      };
      q.universalLock = buildUniversalLockState(q, subjectProfile);
      q.originalSnapshot = captureQuestionOriginalSnapshot(q);
      questions.push(q);
      registerInGroup();
      emptyCounts.essay += 1;
    } else {
      const effectiveRawShort = declaredAnswerRaw || part3ShortAnswerCandidate || '';
      const hasExplicitShort = declaredAnswerRaw.trim().length > 0 && !hasKeyConflict;
      const isPart3CandidateOnly = !hasExplicitShort && Boolean(part3ShortAnswerCandidate);
      const normShort = normalizeShortAnswerValue(effectiveRawShort);

      let shortProvenance: AnswerProvenance;
      if (hasKeyConflict) {
        shortProvenance = {
          status: 'conflict',
          sourceKind: keySourceKind,
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: keySourceLocation,
          rawEvidence: declaredAnswerRaw,
          conflictingEvidence: matchedTrailingEntry?.conflictingEvidences,
          note: 'Các nguồn đáp án Trả lời ngắn mâu thuẫn nhau — cần giáo viên kiểm tra.',
        };
      } else if (hasExplicitShort) {
        shortProvenance = {
          status: 'source-matched',
          sourceKind: keySourceKind ?? 'inline-key',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: keySourceLocation,
          rawEvidence: normShort.rawAnswer,
        };
      } else if (isPart3CandidateOnly) {
        shortProvenance = {
          status: 'needs-review',
          sourceKind: 'short-answer-candidate',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: blk.paragraphLocation,
          candidateConvention: 'part3-prefix-A-answer',
          rawEvidence: `A. ${part3ShortAnswerCandidate}`,
          note: `Phát hiện dòng "A. ${part3ShortAnswerCandidate}" trong Phần Trả lời ngắn — giữ làm ứng viên đáp án ngắn, cần giáo viên xác nhận.`,
        };
      } else {
        shortProvenance = {
          status: 'missing',
          sourceFileHash: options?.sourceFileHash,
          sourceLocation: blk.paragraphLocation,
          note: 'Chưa có đáp án Trả lời ngắn trong tài liệu gốc — cần giáo viên điền/xác nhận ở Bước 2.',
        };
      }

      if (!hasExplicitShort) {
        warnings.push(
          `Câu Trả lời ngắn #${blk.questionNumber} (${code}): ${shortProvenance.note}`
        );
      }

      const shortFormulaStatus = computeFormulaStatusForQuestion(
        [bodyClean, normShort.rawAnswer],
        qAssets
      );

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
          answerValue: normShort.canonicalAnswer,
          rawAnswer: normShort.rawAnswer,
          normalizedAnswer: normShort.normalizedAnswer,
          acceptedFormats: normShort.acceptedFormats,
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
        answerConfirmed: hasExplicitShort,
        answerProvenance: shortProvenance,
        formulaStatus: shortFormulaStatus,
        sourceTrace: baseSourceTrace,
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
    if (
      meta.startNum === undefined &&
      meta.endNum === undefined &&
      linkedIds.length === questions.length &&
      questions.length > 6
    ) {
      warnings.push(
        `Nhóm ngữ liệu "${meta.title}" không ghi rõ phạm vi câu nên đang gắn với toàn bộ ${linkedIds.length} câu hỏi. Nếu các câu này độc lập, hãy tách nhóm ở Bước 1 để hệ thống có thể đảo thứ tự câu hỏi.`
      );
    }
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
    questions.reduce(
      (acc, q) =>
        acc +
        (q.visualAssets?.length ?? 0) +
        (q.options?.filter((o) => Boolean(o.visualAsset)).length ?? 0),
      0
    ) +
    questionGroups.reduce((acc, g) => acc + g.sharedAssets.length, 0);
  const confirmedAnswerCount = questions.filter((q) => q.answerConfirmed).length;
  const unconfirmedAnswerCount = questions.length - confirmedAnswerCount;

  return {
    questions,
    questionGroups,
    report: {
      sourceFormat,
      fileName: options?.fileName,
      sourceFileHash: options?.sourceFileHash,
      suggestedSubject,
      totalParsed: questions.length,
      countsByType: emptyCounts,
      groupsCreated: questionGroups.length,
      assetsAttached,
      ommlCount: ommlFragments.length,
      ...(options?.legacyOleCount !== undefined ? { legacyOleCount: options.legacyOleCount } : {}),
      ...(options?.legacyOleDecodedLatexCount !== undefined
        ? { legacyOleDecodedLatexCount: options.legacyOleDecodedLatexCount }
        : {}),
      ...(options?.legacyOleWmfPreviewCount !== undefined
        ? { legacyOleWmfPreviewCount: options.legacyOleWmfPreviewCount }
        : {}),
      ...(options?.unresolvedOleCount !== undefined
        ? { unresolvedOleCount: options.unresolvedOleCount }
        : {}),
      ...(options?.unsupportedMediaCount !== undefined
        ? { unsupportedMediaCount: options.unsupportedMediaCount }
        : {}),
      confirmedAnswerCount,
      unconfirmedAnswerCount,
      sectionCountAudits,
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
      docxParagraphs: extracted.paragraphs,
      sourceFileHash: extracted.sourceFileHash,
      legacyOleCount: extracted.legacyOleCount,
      legacyOleDecodedLatexCount: extracted.legacyOleDecodedLatexCount,
      legacyOleWmfPreviewCount: extracted.legacyOleWmfPreviewCount,
      unresolvedOleCount: extracted.unresolvedOleCount,
      unsupportedMediaCount: extracted.unsupportedMediaCount,
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
    sectionCountAudits: imported.report.sectionCountAudits,
    confirmedOriginalAnswers: false,
    generatedVersions: [],
    updatedAt: new Date().toISOString(),
  };
}

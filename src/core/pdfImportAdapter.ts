import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  ExamSubjectId,
  MathQuestion,
  NormalizedPdfBBox,
  QuestionGroup,
} from '../types/mathExam';
import {
  PdfPageExtractionRecord,
  PdfRiskRegion,
} from '../types/universalImport';
import { parseUniversalExamText, UniversalImportResult } from './universalImportEngine';

export const PDF_MAX_PAGES = 80;
export const PDF_BROWSER_RENDER_MAX_PAGES = 30;
export const PDF_RENDER_SCALE = 1.35;

export interface PdfExtractionProgress {
  phase: 'loading' | 'parsing-pages' | 'rendering-previews' | 'structuring';
  currentPage: number;
  totalPages: number;
  percent: number;
}

export interface PdfLineProvenance {
  lineIndex: number;
  text: string;
  pageNumber: number;
  columnIndex: number;
  bbox: NormalizedPdfBBox;
  riskFlags: string[];
  riskSeverity: 'none' | 'review' | 'blocked';
}

export interface PdfImportExtractionResult {
  totalPages: number;
  textLayerPages: number;
  scannedPages: number;
  pages: PdfPageExtractionRecord[];
  lines: PdfLineProvenance[];
  reconstructedText: string;
  parsed: UniversalImportResult;
  questionProvenanceById: Record<
    string,
    {
      pageNumber: number;
      pageSpan: number[];
      columnIndex: number;
      bbox: NormalizedPdfBBox;
      verificationStatus: 'READY' | 'REVIEW_REQUIRED' | 'UNSUPPORTED' | 'BLOCKED';
      formulaRiskFlags: string[];
      reasons: string[];
      extractedRawText: string;
    }
  >;
  warnings: string[];
  technicalDetails: string[];
}

interface PositionedGlyphRun {
  str: string;
  x: number;
  yTop: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  xEnd: number;
}

const MATH_FONT_RE =
  /(?:symbol|mtextra|mt\s*extra|euclid|cmmi|cmsy|cmex|msam|msbm|cambria\s*math|stix|latin\s*modern\s*math|mathematica|wingdings|webdings)/i;

const PUA_OR_REPLACEMENT_RE = /[\uE000-\uF8FF\uFFFD]/;

const MATH_OPERATOR_RISK_RE = /[∫∬∭∮∑∏√∛∜±∓≠≈≡≤≥∈∉⊂⊃⊆⊇∪∩∀∃∂∇→⇒⇔∆∞∠⊥∥]/;

function ensurePdfWorkerConfigured(customWorkerSrc?: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  if (customWorkerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = customWorkerSrc;
    return;
  }
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }
}

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(1, val));
}

function normalizeBox(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  pageW: number,
  pageH: number
): NormalizedPdfBBox {
  const x = clamp01(minX / Math.max(1, pageW));
  const y = clamp01(minY / Math.max(1, pageH));
  const right = clamp01(maxX / Math.max(1, pageW));
  const bottom = clamp01(maxY / Math.max(1, pageH));
  return {
    x,
    y,
    width: Math.max(0.01, right - x),
    height: Math.max(0.01, bottom - y),
  };
}

function mergeNormalizedBoxes(boxes: NormalizedPdfBBox[]): NormalizedPdfBBox {
  if (boxes.length === 0) {
    return { x: 0.05, y: 0.05, width: 0.9, height: 0.1 };
  }
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return {
    x: clamp01(minX),
    y: clamp01(minY),
    width: Math.max(0.02, clamp01(maxX - minX)),
    height: Math.max(0.015, clamp01(maxY - minY)),
  };
}

function detectTwoColumnSplitX(
  runs: PositionedGlyphRun[],
  pageWidth: number,
  pageHeight: number
): { columnCount: 1 | 2; splitX: number } {
  const bodyRuns = runs.filter(
    (r) =>
      r.str.trim().length > 0 &&
      r.yTop > pageHeight * 0.08 &&
      r.yTop < pageHeight * 0.94
  );
  if (bodyRuns.length < 10) {
    return { columnCount: 1, splitX: pageWidth / 2 };
  }

  let bestSplitX = pageWidth * 0.5;
  let minCrossings = Number.POSITIVE_INFINITY;

  for (let frac = 0.44; frac <= 0.56; frac += 0.02) {
    const candX = pageWidth * frac;
    let crossings = 0;
    let leftCount = 0;
    let rightCount = 0;
    for (const r of bodyRuns) {
      if (r.xEnd <= candX + 2) leftCount += 1;
      else if (r.x >= candX - 2) rightCount += 1;
      else crossings += 1;
    }
    if (leftCount >= 4 && rightCount >= 4 && crossings < minCrossings) {
      minCrossings = crossings;
      bestSplitX = candX;
    }
  }

  const leftRuns = bodyRuns.filter((r) => r.xEnd <= bestSplitX + 2);
  const rightRuns = bodyRuns.filter((r) => r.x >= bestSplitX - 2);
  const maxAllowedCrossings = Math.max(2, Math.floor(bodyRuns.length * 0.08));

  if (
    leftRuns.length >= 4 &&
    rightRuns.length >= 4 &&
    minCrossings <= maxAllowedCrossings
  ) {
    return { columnCount: 2, splitX: bestSplitX };
  }
  return { columnCount: 1, splitX: pageWidth / 2 };
}

function computeMedianFontSize(runs: PositionedGlyphRun[]): number {
  const sizes = runs
    .filter((r) => r.str.trim().length > 0 && r.fontSize > 2)
    .map((r) => r.fontSize)
    .sort((a, b) => a - b);
  if (sizes.length === 0) return 11;
  return sizes[Math.floor(sizes.length / 2)];
}

interface ReconstructedColumnLine {
  text: string;
  columnIndex: number;
  bbox: NormalizedPdfBBox;
  riskFlags: string[];
  riskSeverity: 'none' | 'review' | 'blocked';
  riskRegions: PdfRiskRegion[];
}

function reconstructColumnLines(
  runs: PositionedGlyphRun[],
  columnIndex: number,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  medianFontSize: number
): ReconstructedColumnLine[] {
  const nonEmpty = runs
    .filter((r) => r.str.length > 0)
    .sort((a, b) => a.yTop - b.yTop || a.x - b.x);

  if (nonEmpty.length === 0) return [];

  // Separate primary baseline candidates (>= 83% of median) from small super/sub candidates so small exponents attach to their host baseline!
  const yTol = Math.max(3, medianFontSize * 0.45);
  const subSupWindow = Math.max(5, medianFontSize * 0.72);

  interface LineCluster {
    baselineY: number;
    baseFontSize: number;
    items: PositionedGlyphRun[];
  }

  const primaryRuns = nonEmpty.filter((r) => r.fontSize > medianFontSize * 0.84);
  const smallRuns = nonEmpty.filter((r) => r.fontSize <= medianFontSize * 0.84);

  const clusters: LineCluster[] = [];

  for (const run of primaryRuns) {
    let matched: LineCluster | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = clusters.length - 1; i >= Math.max(0, clusters.length - 6); i--) {
      const c = clusters[i];
      const dy = Math.abs(run.yTop - c.baselineY);
      if (dy <= yTol && dy < bestDist) {
        bestDist = dy;
        matched = c;
      }
    }
    if (matched) {
      matched.items.push(run);
      matched.baselineY =
        matched.items.reduce((sum, it) => sum + it.yTop, 0) / matched.items.length;
      matched.baseFontSize =
        matched.items.reduce((sum, it) => sum + it.fontSize, 0) / matched.items.length;
    } else {
      clusters.push({
        baselineY: run.yTop,
        baseFontSize: run.fontSize || medianFontSize,
        items: [run],
      });
    }
  }

  for (const run of smallRuns) {
    let matched: LineCluster | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of clusters) {
      const dy = Math.abs(run.yTop - c.baselineY);
      if (dy <= subSupWindow && dy < bestDist) {
        bestDist = dy;
        matched = c;
      }
    }
    if (matched) {
      matched.items.push(run);
    } else {
      clusters.push({
        baselineY: run.yTop,
        baseFontSize: run.fontSize || medianFontSize,
        items: [run],
      });
    }
  }

  clusters.sort((a, b) => a.baselineY - b.baselineY);

  const lines: ReconstructedColumnLine[] = [];

  clusters.forEach((cluster, idx) => {
    const ordered = [...cluster.items].sort((a, b) => a.x - b.x);
    let lineText = '';
    const lineRiskFlags = new Set<string>();
    let lineRiskSeverity: 'none' | 'review' | 'blocked' = 'none';
    const lineRiskRegions: PdfRiskRegion[] = [];

    let minX = pageWidth;
    let minY = pageHeight;
    let maxX = 0;
    let maxY = 0;
    let prevEndX = -1;
    let prevFontSize = cluster.baseFontSize;

    for (const item of ordered) {
      const trimmedStr = item.str;
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.yTop - item.fontSize);
      maxX = Math.max(maxX, item.xEnd);
      maxY = Math.max(maxY, item.yTop + item.fontSize * 0.25);

      const box = normalizeBox(
        item.x,
        item.yTop - item.fontSize,
        item.xEnd,
        item.yTop + item.fontSize * 0.25,
        pageWidth,
        pageHeight
      );

      // Inspect Unicode PUA / replacement glyph
      if (PUA_OR_REPLACEMENT_RE.test(trimmedStr)) {
        const msg = 'Phát hiện ký tự lỗi font / vùng mã riêng (PUA/) — bắt buộc đối chiếu trang PDF gốc.';
        lineRiskFlags.add(msg);
        lineRiskSeverity = 'blocked';
        lineRiskRegions.push({
          id: `p${pageNumber}-pua-${idx}-${lineRiskRegions.length}`,
          pageNumber,
          bbox: box,
          kind: 'pua-glyph',
          severity: 'blocked',
          message: msg,
          sampleText: trimmedStr.slice(0, 24),
        });
      }

      // Inspect math font family
      if (MATH_FONT_RE.test(item.fontFamily) || MATH_FONT_RE.test(item.fontName)) {
        const msg = `Sử dụng font ký hiệu toán (${item.fontFamily || item.fontName}) — cần kiểm tra lại công thức.`;
        lineRiskFlags.add(msg);
        if (lineRiskSeverity !== 'blocked') lineRiskSeverity = 'review';
        lineRiskRegions.push({
          id: `p${pageNumber}-mfont-${idx}-${lineRiskRegions.length}`,
          pageNumber,
          bbox: box,
          kind: 'math-font',
          severity: 'review',
          message: msg,
          sampleText: trimmedStr.slice(0, 24),
        });
      }

      // Inspect mathematical operators
      if (MATH_OPERATOR_RISK_RE.test(trimmedStr)) {
        const msg = 'Chứa ký hiệu toán học đặc biệt (∫/∑/√/≤/→/...) — cần đối chiếu hiển thị gốc.';
        lineRiskFlags.add(msg);
        if (lineRiskSeverity !== 'blocked') lineRiskSeverity = 'review';
        lineRiskRegions.push({
          id: `p${pageNumber}-mop-${idx}-${lineRiskRegions.length}`,
          pageNumber,
          bbox: box,
          kind: 'fraction-layout',
          severity: 'review',
          message: msg,
          sampleText: trimmedStr.slice(0, 24),
        });
      }

      // Heuristic superscript / subscript detection
      const isSmall = item.fontSize <= cluster.baseFontSize * 0.84;
      const dyFromBaseline = item.yTop - cluster.baselineY;
      const cleanToken = trimmedStr.trim();
      const isSup =
        isSmall &&
        cleanToken.length > 0 &&
        cleanToken.length <= 6 &&
        dyFromBaseline < -1.2 &&
        Math.abs(dyFromBaseline) <= cluster.baseFontSize * 0.72;
      const isSub =
        isSmall &&
        cleanToken.length > 0 &&
        cleanToken.length <= 6 &&
        dyFromBaseline > 1.2 &&
        Math.abs(dyFromBaseline) <= cluster.baseFontSize * 0.58;

      // Gap insertion (tránh chèn dấu cách trước chỉ số mũ/dưới liền kề)
      if (prevEndX >= 0 && cleanToken.length > 0) {
        const gap = item.x - prevEndX;
        const spaceThreshold =
          isSup || isSub
            ? cluster.baseFontSize * 0.45
            : Math.max(1.4, Math.min(prevFontSize, item.fontSize) * 0.2);
        if (gap > spaceThreshold && !lineText.endsWith(' ') && !trimmedStr.startsWith(' ')) {
          lineText += ' ';
        }
      }

      if (isSup) {
        lineText += `^{${cleanToken}}`;
        const msg = 'Phát hiện chỉ số trên/số mũ suy diễn theo tọa độ PDF — cần xác nhận lại.';
        lineRiskFlags.add(msg);
        if (lineRiskSeverity !== 'blocked') lineRiskSeverity = 'review';
        lineRiskRegions.push({
          id: `p${pageNumber}-sup-${idx}-${lineRiskRegions.length}`,
          pageNumber,
          bbox: box,
          kind: 'sub-sup-heuristic',
          severity: 'review',
          message: msg,
          sampleText: cleanToken,
        });
      } else if (isSub) {
        lineText += `_{${cleanToken}}`;
        const msg = 'Phát hiện chỉ số dưới suy diễn theo tọa độ PDF — cần xác nhận lại.';
        lineRiskFlags.add(msg);
        if (lineRiskSeverity !== 'blocked') lineRiskSeverity = 'review';
        lineRiskRegions.push({
          id: `p${pageNumber}-sub-${idx}-${lineRiskRegions.length}`,
          pageNumber,
          bbox: box,
          kind: 'sub-sup-heuristic',
          severity: 'review',
          message: msg,
          sampleText: cleanToken,
        });
      } else {
        lineText += trimmedStr;
      }

      prevEndX = Math.max(prevEndX, item.xEnd);
      prevFontSize = item.fontSize || prevFontSize;
    }

    let collapsed = lineText.replace(/\s{2,}/g, ' ').trim();
    if (!collapsed) return;

    if (!collapsed.includes('$') && /(?:\^\{[^}]+\}|_\{[^}]+\})/.test(collapsed)) {
      collapsed = collapsed.replace(
        /([A-Za-z0-9\)\]]+(?:\^\{[^}]+\}|_\{[^}]+\})+)/g,
        '$$$1$$'
      );
    }

    lines.push({
      text: collapsed,
      columnIndex,
      bbox: normalizeBox(minX, minY, maxX, maxY, pageWidth, pageHeight),
      riskFlags: Array.from(lineRiskFlags),
      riskSeverity: lineRiskSeverity,
      riskRegions: lineRiskRegions,
    });
  });

  return lines;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapQuestionsToPdfProvenance(
  questions: MathQuestion[],
  lines: PdfLineProvenance[],
  pages: PdfPageExtractionRecord[]
): PdfImportExtractionResult['questionProvenanceById'] {
  const result: PdfImportExtractionResult['questionProvenanceById'] = {};
  if (questions.length === 0) return result;

  const qStartPositions: Array<{ lineIdx: number; qNum: number }> = [];
  const qStartRe = /^\s*(?:Câu|Question|Bài)\s+(\d{1,3})\s*[.:)]\s*/i;
  lines.forEach((ln, idx) => {
    const m = ln.text.match(qStartRe);
    if (m) {
      qStartPositions.push({ lineIdx: idx, qNum: Number(m[1]) });
    }
  });

  const answerKeyStartIdx = lines.findIndex((ln) =>
    /^(?:#+\s*)?(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN|ANSWER\s+KEY|LỜI\s+GIẢI\s+CHI\s+TIẾT)/i.test(
      ln.text.trim()
    )
  );
  const bodyEndLineIdx =
    answerKeyStartIdx > Math.floor(lines.length * 0.25) ? answerKeyStartIdx : lines.length;

  questions.forEach((q, qIdx) => {
    let startLineIdx = -1;
    let endLineIdx = bodyEndLineIdx;

    if (qIdx < qStartPositions.length) {
      startLineIdx = qStartPositions[qIdx].lineIdx;
      endLineIdx =
        qIdx + 1 < qStartPositions.length
          ? qStartPositions[qIdx + 1].lineIdx
          : bodyEndLineIdx;
    } else {
      const stemNeedle = normalizeForMatch(q.stem.rawSource).slice(0, 28);
      if (stemNeedle.length >= 6) {
        const foundIdx = lines.findIndex((ln) =>
          normalizeForMatch(ln.text).includes(stemNeedle)
        );
        if (foundIdx !== -1) {
          startLineIdx = foundIdx;
          endLineIdx = Math.min(bodyEndLineIdx, foundIdx + 6);
        }
      }
    }

    const slice =
      startLineIdx >= 0 && endLineIdx > startLineIdx
        ? lines.slice(startLineIdx, endLineIdx)
        : lines.slice(0, Math.min(1, lines.length));

    const pageSet = Array.from(new Set(slice.map((l) => l.pageNumber))).sort((a, b) => a - b);
    const primaryPage = pageSet[0] ?? 1;
    const primaryPageLines = slice.filter((l) => l.pageNumber === primaryPage);
    const bbox = mergeNormalizedBoxes(primaryPageLines.map((l) => l.bbox));
    const columnIndex = primaryPageLines[0]?.columnIndex ?? 0;

    const riskFlags = new Set<string>();
    let hasBlocked = false;
    let hasReview = false;

    for (const ln of slice) {
      ln.riskFlags.forEach((f) => riskFlags.add(f));
      if (ln.riskSeverity === 'blocked') hasBlocked = true;
      else if (ln.riskSeverity === 'review') hasReview = true;
    }

    // Check if any page in span has vector diagrams / scanned warnings near text
    for (const pNum of pageSet) {
      const pg = pages.find((p) => p.pageNumber === pNum);
      if (!pg) continue;
      if (pg.vectorOpsCount >= 12 && /(?:hình|đồ thị|bảng biến thiên|sơ đồ|figure|graph|diagram)/i.test(q.stem.rawSource)) {
        riskFlags.add(
          `Trang ${pNum} có ${pg.vectorOpsCount} lệnh vẽ hình/đồ thị vector — hãy cắt hoặc gắn hình minh họa vào câu.`
        );
        hasReview = true;
      }
      if (!pg.hasTextLayer || pg.isScannedLikely) {
        riskFlags.add(`Trang ${pNum} có vùng ảnh scan không có lớp chữ.`);
        hasBlocked = true;
      }
    }

    if (pageSet.length > 1) {
      riskFlags.add(`Câu trải dài qua nhiều trang (Trang ${pageSet.join(' → ')}) — cần rà soát nội dung nối trang.`);
      hasReview = true;
    }

    if (/\$\s*[^$]+\s*\$|\^\{|_\{/.test(q.stem.rawSource) && !hasBlocked) {
      if (riskFlags.size === 0) {
        riskFlags.add('Có ký hiệu mũ/chỉ số hoặc biểu thức toán từ PDF — cần xác nhận chuẩn xác trước khi trộn.');
      }
      hasReview = true;
    }

    const verificationStatus: 'READY' | 'REVIEW_REQUIRED' | 'UNSUPPORTED' | 'BLOCKED' =
      hasBlocked
        ? 'BLOCKED'
        : hasReview || riskFlags.size > 0 || !q.answerConfirmed
        ? 'REVIEW_REQUIRED'
        : 'READY';

    const reasons = Array.from(riskFlags);
    if (!q.answerConfirmed && verificationStatus !== 'BLOCKED') {
      reasons.push('Chưa xác nhận đáp án đúng cho câu hỏi.');
    }

    result[q.id] = {
      pageNumber: primaryPage,
      pageSpan: pageSet,
      columnIndex,
      bbox,
      verificationStatus,
      formulaRiskFlags: Array.from(riskFlags),
      reasons,
      extractedRawText: slice.map((l) => l.text).join('\n'),
    };
  });

  return result;
}

/**
 * Cắt vùng hình ảnh trực tiếp từ ảnh trang PDF đã render (trên trình duyệt) theo bounding box chuẩn hóa [0..1].
 */
export async function cropPdfPageRegionToDataUrl(
  pageImageDataUrl: string,
  bbox: NormalizedPdfBBox
): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('Tính năng cắt vùng ảnh PDF chỉ chạy trên trình duyệt.');
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.max(0, Math.floor(bbox.x * img.width));
      const sy = Math.max(0, Math.floor(bbox.y * img.height));
      const sw = Math.max(24, Math.min(img.width - sx, Math.ceil(bbox.width * img.width)));
      const sh = Math.max(24, Math.min(img.height - sy, Math.ceil(bbox.height * img.height)));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Không khởi tạo được Canvas 2D context.'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Không thể tải ảnh trang PDF để cắt vùng.'));
    img.src = pageImageDataUrl;
  });
}

/**
 * Trích xuất PDF đa trang cục bộ bằng PDF.js:
 * - Tôn trọng cột & thứ tự đọc (1 cột / 2 cột)
 * - Nối câu trải dài qua nhiều trang
 * - Phát hiện trang scan / lỗi font PUA / chỉ số mũ heuristic / hình vẽ vector
 * - Render ảnh trang PDF gốc trên trình duyệt để đối chiếu 2 cột
 */
export async function extractPdfExamDocument(
  buffer: ArrayBuffer | Uint8Array,
  createIdFn: (prefix: string) => string,
  options?: {
    fileName?: string;
    subjectId?: ExamSubjectId;
    workerSrc?: string;
    renderPreviews?: boolean;
    onProgress?: (progress: PdfExtractionProgress) => void;
    signal?: AbortSignal;
  }
): Promise<PdfImportExtractionResult> {
  ensurePdfWorkerConfigured(options?.workerSrc);

  const bytes =
    buffer instanceof Uint8Array
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer);

  if (options?.signal?.aborted) {
    throw new Error('Đã hủy tiến trình đọc tệp PDF.');
  }

  options?.onProgress?.({
    phase: 'loading',
    currentPage: 0,
    totalPages: 1,
    percent: 5,
  });

  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    useWorkerFetch: false,
    verbosity: 0,
  });

  const abortListener = () => {
    void loadingTask.destroy();
  };
  options?.signal?.addEventListener('abort', abortListener, { once: true });

  try {
    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;

    if (totalPages === 0) {
      throw new Error('Tệp PDF không có trang nào.');
    }
    if (totalPages > PDF_MAX_PAGES) {
      throw new Error(
        `Tệp PDF có ${totalPages} trang, vượt quá giới hạn an toàn ${PDF_MAX_PAGES} trang mỗi lần nhập.`
      );
    }

    const pages: PdfPageExtractionRecord[] = [];
    const allLines: PdfLineProvenance[] = [];
    const globalWarnings: string[] = [];
    const technicalDetails: string[] = [
      `PDF.js v${pdfjsLib.version ?? '6.x'} · Tổng số trang: ${totalPages}`,
    ];

    const shouldRenderPreview =
      options?.renderPreviews !== false &&
      typeof document !== 'undefined' &&
      totalPages <= PDF_BROWSER_RENDER_MAX_PAGES;

    if (typeof document !== 'undefined' && totalPages > PDF_BROWSER_RENDER_MAX_PAGES) {
      globalWarnings.push(
        `Tài liệu có ${totalPages} trang — chỉ render ảnh xem trước tối đa ${PDF_BROWSER_RENDER_MAX_PAGES} trang đầu để bảo vệ bộ nhớ trình duyệt.`
      );
    }

    let textLayerPages = 0;
    let scannedPages = 0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (options?.signal?.aborted) {
        throw new Error('Đã hủy tiến trình đọc tệp PDF.');
      }

      options?.onProgress?.({
        phase: 'parsing-pages',
        currentPage: pageNum,
        totalPages,
        percent: Math.round(10 + (pageNum / totalPages) * 70),
      });

      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const pageW = viewport.width || 595;
      const pageH = viewport.height || 842;

      const textContent = await page.getTextContent({ includeMarkedContent: false });
      const opList = await page.getOperatorList();

      let imageOpsCount = 0;
      let vectorOpsCount = 0;
      const OPS = pdfjsLib.OPS;
      for (const fn of opList.fnArray) {
        if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintImageMaskXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintImageXObjectRepeat ||
          fn === OPS.paintImageMaskXObjectRepeat
        ) {
          imageOpsCount += 1;
        } else if (
          fn === OPS.stroke ||
          fn === OPS.closeStroke ||
          fn === OPS.fill ||
          fn === OPS.fillStroke ||
          fn === OPS.rectangle ||
          fn === OPS.lineTo ||
          fn === OPS.curveTo
        ) {
          vectorOpsCount += 1;
        }
      }

      const runs: PositionedGlyphRun[] = [];
      const fontFamilySet = new Set<string>();

      for (const item of textContent.items) {
        if (!('str' in item)) continue;
        if (!item.str) continue;
        const t = item.transform as number[];
        const a = t?.[0] ?? 1;
        const b = t?.[1] ?? 0;
        const c = t?.[2] ?? 0;
        const d = t?.[3] ?? 1;
        const tx = t?.[4] ?? 0;
        const ty = t?.[5] ?? 0;

        const fontSize =
          Math.hypot(a, b) || Math.hypot(c, d) || Math.abs(item.height) || 11;
        const styleInfo = textContent.styles?.[item.fontName];
        const fontFamily = styleInfo?.fontFamily ?? item.fontName ?? '';
        if (fontFamily) fontFamilySet.add(fontFamily);

        const yTop = pageH - ty;
        const width = Math.max(
          0.5,
          typeof item.width === 'number' && item.width > 0
            ? item.width
            : item.str.length * fontSize * 0.45
        );

        runs.push({
          str: item.str,
          x: tx,
          yTop,
          width,
          height: Math.max(fontSize, item.height || fontSize),
          fontSize,
          fontName: item.fontName ?? '',
          fontFamily,
          xEnd: tx + width,
        });
      }

      const meaningfulChars = runs
        .map((r) => r.str.replace(/\s+/g, ''))
        .join('').length;
      const hasTextLayer = meaningfulChars >= 15;
      const isScannedLikely = !hasTextLayer && (imageOpsCount > 0 || meaningfulChars < 5);

      if (hasTextLayer) textLayerPages += 1;
      else scannedPages += 1;

      const { columnCount, splitX } = detectTwoColumnSplitX(runs, pageW, pageH);
      const medianFontSize = computeMedianFontSize(runs);

      const pageRiskRegions: PdfRiskRegion[] = [];
      const pageLines: ReconstructedColumnLine[] = [];

      if (!hasTextLayer) {
        const msg = isScannedLikely
          ? `Trang ${pageNum} là PDF scan / chỉ chứa ảnh (${imageOpsCount} ảnh, ${meaningfulChars} ký tự văn bản) — chưa hỗ trợ OCR trong Giai đoạn 1.`
          : `Trang ${pageNum} hầu như không có lớp văn bản (${meaningfulChars} ký tự).`;
        globalWarnings.push(msg);
        pageRiskRegions.push({
          id: `p${pageNum}-scan`,
          pageNumber: pageNum,
          bbox: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 },
          kind: 'image-only-page',
          severity: 'blocked',
          message: msg,
        });
      } else {
        if (columnCount === 2) {
          const topBannerRuns = runs.filter(
            (r) =>
              r.yTop <= pageH * 0.12 &&
              r.x < splitX - 4 &&
              r.xEnd > splitX + 4
          );
          const leftRuns = runs.filter(
            (r) => !topBannerRuns.includes(r) && (r.x + r.xEnd) / 2 < splitX
          );
          const rightRuns = runs.filter(
            (r) => !topBannerRuns.includes(r) && (r.x + r.xEnd) / 2 >= splitX
          );

          pageLines.push(
            ...reconstructColumnLines(topBannerRuns, 0, pageNum, pageW, pageH, medianFontSize),
            ...reconstructColumnLines(leftRuns, 0, pageNum, pageW, pageH, medianFontSize),
            ...reconstructColumnLines(rightRuns, 1, pageNum, pageW, pageH, medianFontSize)
          );
        } else {
          pageLines.push(
            ...reconstructColumnLines(runs, 0, pageNum, pageW, pageH, medianFontSize)
          );
        }

        pageLines.forEach((ln) => {
          pageRiskRegions.push(...ln.riskRegions);
          allLines.push({
            lineIndex: allLines.length,
            text: ln.text,
            pageNumber: pageNum,
            columnIndex: ln.columnIndex,
            bbox: ln.bbox,
            riskFlags: ln.riskFlags,
            riskSeverity: ln.riskSeverity,
          });
        });
      }

      if (vectorOpsCount >= 12) {
        pageRiskRegions.push({
          id: `p${pageNum}-vector`,
          pageNumber: pageNum,
          bbox: { x: 0.08, y: 0.15, width: 0.84, height: 0.7 },
          kind: 'vector-diagram',
          severity: 'review',
          message: `Trang ${pageNum} chứa ${vectorOpsCount} đường vẽ/hình học vector.`,
        });
      }

      let previewImageDataUrl: string | undefined;
      if (shouldRenderPreview || (typeof document !== 'undefined' && pageNum <= PDF_BROWSER_RENDER_MAX_PAGES)) {
        try {
          options?.onProgress?.({
            phase: 'rendering-previews',
            currentPage: pageNum,
            totalPages,
            percent: Math.round(15 + (pageNum / totalPages) * 75),
          });
          const renderVp = page.getViewport({ scale: PDF_RENDER_SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(renderVp.width));
          canvas.height = Math.max(1, Math.floor(renderVp.height));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
              canvas,
              canvasContext: ctx,
              viewport: renderVp,
            }).promise;
            previewImageDataUrl = canvas.toDataURL('image/png');
          }
        } catch {
          // Non-fatal in environments without complete 2D canvas support
        }
      }

      const pageText = pageLines.map((l) => l.text).join('\n');
      technicalDetails.push(
        `Trang ${pageNum}: ${columnCount} cột · ${runs.length} khối chữ · ${meaningfulChars} ký tự · ${imageOpsCount} ảnh · ${vectorOpsCount} vẽ vector · font: ${Array.from(fontFamilySet).slice(0, 4).join(', ') || 'không rõ'}`
      );

      pages.push({
        pageNumber: pageNum,
        width: pageW,
        height: pageH,
        columnCount,
        textItemCount: runs.length,
        meaningfulCharCount: meaningfulChars,
        imageOpsCount,
        vectorOpsCount,
        hasTextLayer,
        isScannedLikely,
        reconstructedText: pageText,
        fontNames: Array.from(fontFamilySet),
        riskRegions: pageRiskRegions,
        previewImageDataUrl,
      });

      page.cleanup();
    }

    options?.onProgress?.({
      phase: 'structuring',
      currentPage: totalPages,
      totalPages,
      percent: 94,
    });

    const reconstructedText = allLines.map((l) => l.text).join('\n');
    const parsed = parseUniversalExamText(reconstructedText, createIdFn, {
      subjectId: options?.subjectId,
      sourceFormat: 'text',
      fileName: options?.fileName,
      codePrefix: 'PDF',
      preWarnings: globalWarnings,
    });

    const provenanceById = mapQuestionsToPdfProvenance(
      parsed.questions,
      allLines,
      pages
    );

    const enrichedQuestions: MathQuestion[] = parsed.questions.map((q) => {
      const prov = provenanceById[q.id];
      if (!prov) return q;
      return {
        ...q,
        sourceVerification: {
          sourceFormat: 'pdf',
          sourceBlockId: `blk-${q.id}`,
          pageNumber: prov.pageNumber,
          pageSpan: prov.pageSpan,
          columnIndex: prov.columnIndex,
          bbox: prov.bbox,
          verificationStatus: prov.verificationStatus,
          verifiedByTeacher: prov.verificationStatus === 'READY',
          formulaRiskFlags: prov.formulaRiskFlags,
          reasons: prov.reasons,
          extractedRawText: prov.extractedRawText,
        },
      };
    });

    const enrichedGroups: QuestionGroup[] = parsed.questionGroups;

    options?.onProgress?.({
      phase: 'structuring',
      currentPage: totalPages,
      totalPages,
      percent: 100,
    });

    await pdfDoc.cleanup();
    await loadingTask.destroy();

    return {
      totalPages,
      textLayerPages,
      scannedPages,
      pages,
      lines: allLines,
      reconstructedText,
      parsed: {
        ...parsed,
        questions: enrichedQuestions,
        questionGroups: enrichedGroups,
      },
      questionProvenanceById: provenanceById,
      warnings: Array.from(new Set([...globalWarnings, ...parsed.report.warnings])),
      technicalDetails,
    };
  } finally {
    options?.signal?.removeEventListener('abort', abortListener);
  }
}

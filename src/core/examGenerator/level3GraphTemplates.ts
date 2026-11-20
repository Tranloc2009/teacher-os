/**
 * Level 3 Dynamic Graph & Variation Table Question Templates (Phase 3)
 *
 * Implements the 6 required Level 3 families:
 *  1. quadratic-graph
 *  2. cubic-monotonicity
 *  3. cubic-extrema
 *  4. rational-asymptotes
 *  5. rational-monotonicity
 *  6. graph-variation-table
 *
 * Enforces:
 * - Dynamic Content Binding with deterministic graphFingerprint across parameters,
 *   analysis, SVG graph, variation table, options, answer, and explanation.
 * - Distinct mathematical distractors (including true distinct-function SVG graphs &
 *   variation tables for choose-graph / choose-variation-table modes).
 * - Stale Graph Data detection: BLOCK EXPORT — STALE GRAPH DATA.
 */

import type {
  DynamicFunctionAnalysis,
  DynamicFunctionFamilyId,
  GraphQuestionSubMode,
  QuestionTemplateDefinition,
  VariationTableModel,
  VerifiedTemplateFamilyId,
} from '../../types/examGenerator';
import type { MathQuestion, MathVisualAsset } from '../../types/mathExam';
import { createMathVisualAsset } from '../mathIntegrity';
import type { SeededRng } from './seededPrng';
import {
  analyzeCubicFunction,
  analyzeDynamicFunction,
  analyzeQuadraticFunction,
  analyzeRationalFunction,
  computeFunctionFingerprint,
  type DynamicFunctionSpec,
} from './dynamicFunctionAnalyzer';
import {
  buildDynamicSvgGraph,
  buildVariationTableModel,
  renderVariationTableSvg,
} from './dynamicSvgGraphEngine';

export const BLOCK_EXPORT_STALE_GRAPH_MSG = 'BLOCK EXPORT — STALE GRAPH DATA';

export const LEVEL3_GRAPH_FAMILY_IDS = new Set<VerifiedTemplateFamilyId>([
  'quadratic-graph',
  'cubic-monotonicity',
  'cubic-extrema',
  'rational-asymptotes',
  'rational-monotonicity',
  'graph-variation-table',
]);

export function isLevel3GraphFamily(familyId: VerifiedTemplateFamilyId): boolean {
  return LEVEL3_GRAPH_FAMILY_IDS.has(familyId);
}

export interface Level3OptionCandidate {
  displayLatex: string;
  canonicalKey: string;
  isCorrect: boolean;
  visualAsset?: MathVisualAsset;
}

export interface Level3GraphCandidateResult {
  ok: boolean;
  error?: string;
  params: Record<string, number>;
  functionFamily: DynamicFunctionFamilyId;
  analysis?: DynamicFunctionAnalysis;
  graphSvg?: string;
  variationTable?: VariationTableModel;
  variationTableSvg?: string;
  questionAssets?: MathVisualAsset[];
  stemLatex?: string;
  explanationLatex?: string;
  numericAnswer?: number;
  correctDisplayLatex?: string;
  correctCanonicalKey?: string;
  shortAnswerValue?: string;
  shortAnswerAccepted?: string[];
  allowShortAnswer?: boolean;
  options?: Level3OptionCandidate[];
  verificationProof?: string;
}

function normalizeIntervalKey(s: string): string {
  return `INT:${s.replace(/\$/g, '').replace(/\s+/g, '').toLowerCase()}`;
}

function extractSvgFingerprint(svgSource: string): string | null {
  const m = /data-graph-fingerprint="([^"]+)"/.exec(svgSource);
  return m ? m[1] : null;
}

/**
 * Verifies Dynamic Content Binding (§VIII & §XIII):
 * Ensures Math Model parameters, Variant ID, SVG Graph, Variation Table, and
 * Question metadata all share the exact same live fingerprint.
 * Returns `BLOCK EXPORT — STALE GRAPH DATA` on any mismatch.
 */
export function verifyDynamicGraphBinding(params: {
  question: MathQuestion;
  functionAnalysis?: DynamicFunctionAnalysis;
  variationTable?: VariationTableModel;
  graphFingerprint?: string;
}): { valid: boolean; reason?: string } {
  const meta = params.question.variantMeta;
  const expectedFp = params.graphFingerprint ?? meta?.graphFingerprint;
  if (!expectedFp) {
    return { valid: true };
  }

  // 1. Recompute fingerprint from stored parameterValues + family + variantId if present
  if (meta?.dynamicFunctionFamily && meta.parameterValues) {
    const p = meta.parameterValues;
    let spec: DynamicFunctionSpec | null = null;
    if (meta.dynamicFunctionFamily === 'quadratic' && p.a !== undefined && p.b !== undefined && p.c !== undefined) {
      spec = { family: 'quadratic', a: p.a, b: p.b, c: p.c };
    } else if (
      meta.dynamicFunctionFamily === 'cubic' &&
      p.a !== undefined &&
      p.b !== undefined &&
      p.c !== undefined &&
      p.d !== undefined
    ) {
      spec = { family: 'cubic', a: p.a, b: p.b, c: p.c, d: p.d };
    } else if (
      meta.dynamicFunctionFamily === 'rational' &&
      p.a !== undefined &&
      p.b !== undefined &&
      p.c !== undefined &&
      p.d !== undefined
    ) {
      spec = { family: 'rational', a: p.a, b: p.b, c: p.c, d: p.d };
    }
    if (spec) {
      const recomputed = computeFunctionFingerprint(spec, meta.variantId);
      if (recomputed !== expectedFp) {
        return {
          valid: false,
          reason: `${BLOCK_EXPORT_STALE_GRAPH_MSG}: Fingerprint tham số (${recomputed}) không khớp metadata (${expectedFp}).`,
        };
      }
    }
  }

  // 2. Check functionAnalysis fingerprint
  if (params.functionAnalysis && params.functionAnalysis.fingerprint !== expectedFp) {
    return {
      valid: false,
      reason: `${BLOCK_EXPORT_STALE_GRAPH_MSG}: Dữ liệu phân tích hàm số (${params.functionAnalysis.fingerprint}) lệch với biến thể (${expectedFp}).`,
    };
  }

  // 3. Check variationTable fingerprint
  if (params.variationTable && params.variationTable.fingerprint !== expectedFp) {
    return {
      valid: false,
      reason: `${BLOCK_EXPORT_STALE_GRAPH_MSG}: Bảng biến thiên (${params.variationTable.fingerprint}) lệch với biến thể (${expectedFp}).`,
    };
  }

  // 4. Check every SVG visualAsset embedded on the question
  for (const asset of params.question.visualAssets ?? []) {
    if (asset.sourceData.includes('data-graph-fingerprint=')) {
      const assetFp = extractSvgFingerprint(asset.sourceData);
      if (assetFp && assetFp !== expectedFp) {
        return {
          valid: false,
          reason: `${BLOCK_EXPORT_STALE_GRAPH_MSG}: Hình "${asset.label}" mang fingerprint cũ (${assetFp} ≠ ${expectedFp}).`,
        };
      }
    }
  }

  return { valid: true };
}

function buildFourDistinctTextOptions(
  correct: { latex: string; key: string },
  distractors: Array<{ latex: string; key: string }>
): Level3OptionCandidate[] | null {
  const seen = new Set<string>([correct.key]);
  const picked: Level3OptionCandidate[] = [
    { displayLatex: correct.latex, canonicalKey: correct.key, isCorrect: true },
  ];
  for (const d of distractors) {
    if (picked.length >= 4) break;
    if (!d.latex.trim() || seen.has(d.key)) continue;
    seen.add(d.key);
    picked.push({ displayLatex: d.latex, canonicalKey: d.key, isCorrect: false });
  }
  return picked.length === 4 ? picked : null;
}

/**
 * Helper: builds 4 distinct SVG Graph options (1 correct + 3 mathematically different functions).
 */
function buildChooseGraphOptions(
  correctSpec: DynamicFunctionSpec,
  correctAnalysis: DynamicFunctionAnalysis,
  variantId: string
): Level3OptionCandidate[] | null {
  const distractorSpecs: DynamicFunctionSpec[] = [];

  if (correctSpec.family === 'quadratic') {
    const { a, b, c } = correctSpec;
    // Flip opening direction, shift vertex horizontally, flip both
    distractorSpecs.push(
      { family: 'quadratic', a: -a, b, c },
      { family: 'quadratic', a, b: b === 0 ? 4 * a : -b, c },
      { family: 'quadratic', a: -a, b: -b, c: c === 0 ? 2 : -c }
    );
  } else if (correctSpec.family === 'cubic') {
    const { a, b, c, d } = correctSpec;
    distractorSpecs.push(
      { family: 'cubic', a: -a, b, c, d },
      { family: 'cubic', a, b: -b, c: c === 0 ? 3 * a : -c, d },
      { family: 'cubic', a: -a, b: -b, c, d: d === 0 ? 2 : -d }
    );
  } else {
    const { a, b, c, d } = correctSpec;
    // Change vertical asymptote sign, horizontal asymptote sign, monotonicity sign
    distractorSpecs.push(
      { family: 'rational', a, b, c, d: d === 0 ? c : -d },
      { family: 'rational', a: -a, b: b === 0 ? 1 : b, c, d },
      { family: 'rational', a: a + c, b: -b - d, c, d }
    );
  }

  const seenFingerprints = new Set<string>([
    computeFunctionFingerprint(correctSpec),
  ]);
  const correctGraph = buildDynamicSvgGraph(correctAnalysis, {
    compact: true,
    hideLegend: true,
    accentColor: '#4F46E5',
  });
  if (!correctGraph.valid) return null;

  const opts: Level3OptionCandidate[] = [
    {
      displayLatex: 'Đồ thị hình bên dưới',
      canonicalKey: `GRAPH:${computeFunctionFingerprint(correctSpec)}`,
      isCorrect: true,
      visualAsset: createMathVisualAsset({
        id: `${variantId}-opt-graph-correct`,
        kind: 'geometry-svg',
        label: 'Phương án đồ thị',
        sourceData: correctGraph.svg,
      }),
    },
  ];

  let dIdx = 1;
  for (const dSpec of distractorSpecs) {
    if (opts.length >= 4) break;
    const baseFp = computeFunctionFingerprint(dSpec);
    if (seenFingerprints.has(baseFp)) continue;
    const dAnalysis = analyzeDynamicFunction(dSpec, `${variantId}-d${dIdx}`);
    if (!dAnalysis.verificationPassed) continue;
    // Ensure meaningful mathematical distinction (different extrema / asymptotes / leading sign)
    const dGraph = buildDynamicSvgGraph(dAnalysis, {
      compact: true,
      hideLegend: true,
      accentColor: '#4F46E5',
    });
    if (!dGraph.valid) continue;
    seenFingerprints.add(baseFp);
    opts.push({
      displayLatex: 'Đồ thị hình bên dưới',
      canonicalKey: `GRAPH:${baseFp}`,
      isCorrect: false,
      visualAsset: createMathVisualAsset({
        id: `${variantId}-opt-graph-d${dIdx}`,
        kind: 'geometry-svg',
        label: 'Phương án đồ thị',
        sourceData: dGraph.svg,
      }),
    });
    dIdx += 1;
  }

  return opts.length === 4 ? opts : null;
}

/**
 * Helper: builds 4 distinct Variation Table SVG options (1 correct + 3 mathematically different functions).
 */
function buildChooseVariationTableOptions(
  correctSpec: DynamicFunctionSpec,
  correctAnalysis: DynamicFunctionAnalysis,
  correctTable: VariationTableModel,
  variantId: string
): Level3OptionCandidate[] | null {
  const distractorSpecs: DynamicFunctionSpec[] = [];

  if (correctSpec.family === 'quadratic') {
    const { a, b, c } = correctSpec;
    distractorSpecs.push(
      { family: 'quadratic', a: -a, b, c },
      { family: 'quadratic', a, b: b === 0 ? 4 * a : -b, c },
      { family: 'quadratic', a: -a, b: -b, c }
    );
  } else if (correctSpec.family === 'cubic') {
    const { a, b, c, d } = correctSpec;
    distractorSpecs.push(
      { family: 'cubic', a: -a, b, c, d },
      { family: 'cubic', a, b: -b, c, d },
      { family: 'cubic', a: -a, b: -b, c, d }
    );
  } else {
    const { a, b, c, d } = correctSpec;
    distractorSpecs.push(
      { family: 'rational', a, b, c, d: d === 0 ? c : -d },
      { family: 'rational', a: -a, b: b === 0 ? 1 : b, c, d },
      { family: 'rational', a, b: -b - (a * d === 0 ? 2 : 0), c, d }
    );
  }

  const tableSig = (m: VariationTableModel): string =>
    m.columns
      .map((c) => `${c.kind}:${c.xLabel}:${c.derivSymbol}:${c.valueLabel ?? ''}:${c.leftLimitLabel ?? ''}:${c.rightLimitLabel ?? ''}`)
      .join('|');

  const seenSigs = new Set<string>([tableSig(correctTable)]);
  const correctSvg = renderVariationTableSvg(correctTable, { compact: true });
  const opts: Level3OptionCandidate[] = [
    {
      displayLatex: 'Bảng biến thiên bên dưới',
      canonicalKey: `BBT:${tableSig(correctTable)}`,
      isCorrect: true,
      visualAsset: createMathVisualAsset({
        id: `${variantId}-opt-bbt-correct`,
        kind: 'variation-table',
        label: 'Bảng biến thiên',
        sourceData: correctSvg,
      }),
    },
  ];

  let dIdx = 1;
  for (const dSpec of distractorSpecs) {
    if (opts.length >= 4) break;
    const dAnalysis = analyzeDynamicFunction(dSpec, `${variantId}-bbtd${dIdx}`);
    if (!dAnalysis.verificationPassed) continue;
    const dTable = buildVariationTableModel(dAnalysis);
    const sig = tableSig(dTable);
    if (seenSigs.has(sig)) continue;
    seenSigs.add(sig);
    const dSvg = renderVariationTableSvg(dTable, { compact: true });
    opts.push({
      displayLatex: 'Bảng biến thiên bên dưới',
      canonicalKey: `BBT:${sig}`,
      isCorrect: false,
      visualAsset: createMathVisualAsset({
        id: `${variantId}-opt-bbt-d${dIdx}`,
        kind: 'variation-table',
        label: 'Bảng biến thiên',
        sourceData: dSvg,
      }),
    });
    dIdx += 1;
  }

  return opts.length === 4 ? opts : null;
}

// ---------------------------------------------------------------------------
// 1. QUADRATIC GRAPH BUILDER (quadratic-graph)
// ---------------------------------------------------------------------------
export function buildQuadraticGraphCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>,
  variantId: string,
  rng: SeededRng
): Level3GraphCandidateResult {
  const a = rawParams.a;
  // Support either direct (a, b, c) or vertex-friendly (a, xv, c)
  const b = rawParams.b !== undefined ? rawParams.b : -2 * a * (rawParams.xv ?? 1);
  const c = rawParams.c ?? 0;

  if (!Number.isFinite(a) || Math.abs(a) < 1e-12) {
    return {
      ok: false,
      error: 'Hệ số a = 0: không phải hàm số bậc hai.',
      params: { a, b, c },
      functionFamily: 'quadratic',
    };
  }

  const spec: DynamicFunctionSpec = { family: 'quadratic', a, b, c };
  const analysis = analyzeQuadraticFunction(a, b, c, variantId);
  if (!analysis.verificationPassed || !analysis.vertex) {
    return {
      ok: false,
      error: analysis.verificationErrors.join(' ') || 'Kiểm chứng hàm bậc hai thất bại.',
      params: { a, b, c },
      functionFamily: 'quadratic',
    };
  }

  const mode: GraphQuestionSubMode =
    template.familyConfig?.graphQuestionMode ?? 'monotonicity-increasing';

  const hideLegend = mode === 'read-graph';
  const graphRes = buildDynamicSvgGraph(analysis, { hideLegend });
  if (!graphRes.valid) {
    return {
      ok: false,
      error: graphRes.errors.join(' '),
      params: { a, b, c },
      functionFamily: 'quadratic',
    };
  }

  const variationTable = buildVariationTableModel(analysis);
  const variationTableSvg = renderVariationTableSvg(variationTable);

  const xv = analysis.vertex.x;
  const yv = analysis.vertex.y;
  const isUp = a > 0;
  const incInterval = analysis.monotonicityIntervals.find((i) => i.trend === 'increasing')!;
  const decInterval = analysis.monotonicityIntervals.find((i) => i.trend === 'decreasing')!;

  const graphAsset = createMathVisualAsset({
    id: `${variantId}-graph`,
    kind: 'geometry-svg',
    label: hideLegend ? 'Đồ thị hàm số y = f(x)' : `Đồ thị hàm số y = ${analysis.functionLatex}`,
    sourceData: graphRes.svg,
  });
  const bbtAsset = createMathVisualAsset({
    id: `${variantId}-bbt`,
    kind: 'variation-table',
    label: 'Bảng biến thiên hàm số',
    sourceData: variationTableSvg,
  });

  if (mode === 'choose-graph') {
    const opts = buildChooseGraphOptions(spec, analysis, variantId);
    if (!opts) {
      return {
        ok: false,
        error: 'Không tạo đủ 4 đồ thị phân biệt cho câu hỏi chọn đồ thị.',
        params: { a, b, c },
        functionFamily: 'quadratic',
      };
    }
    return {
      ok: true,
      params: { a, b, c },
      functionFamily: 'quadratic',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [],
      stemLatex: `Đồ thị nào dưới đây là đồ thị của hàm số $f(x) = ${analysis.functionLatex}$?`,
      explanationLatex: `Hàm số bậc hai có $a = ${a} ${isUp ? '> 0' : '< 0'}$ (parabol quay bề lõm lên ${isUp ? 'trên' : 'dưới'}), đạo hàm $f'(x) = ${analysis.derivativeLatex} = 0 \\Leftrightarrow x = ${xv.latex}$, tọa độ đỉnh $I\\left(${xv.latex};\\; ${yv.latex}\\right)$ và cắt trục tung tại $(0;\\; ${c})$.`,
      numericAnswer: yv.value,
      correctDisplayLatex: `Parabol đỉnh I(${xv.plain}; ${yv.plain}), a = ${a}`,
      correctCanonicalKey: opts[0].canonicalKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  if (mode === 'choose-variation-table') {
    const opts = buildChooseVariationTableOptions(spec, analysis, variationTable, variantId);
    if (!opts) {
      return {
        ok: false,
        error: 'Không tạo đủ 4 bảng biến thiên phân biệt.',
        params: { a, b, c },
        functionFamily: 'quadratic',
      };
    }
    return {
      ok: true,
      params: { a, b, c },
      functionFamily: 'quadratic',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [],
      stemLatex: `Bảng biến thiên nào dưới đây là của hàm số $f(x) = ${analysis.functionLatex}$?`,
      explanationLatex: `Ta có $f'(x) = ${analysis.derivativeLatex} = 0 \\Leftrightarrow x = ${xv.latex}$, $f\\left(${xv.latex}\\right) = ${yv.latex}$. Vì $a = ${a} ${isUp ? '> 0' : '< 0'}$ nên hàm số ${isUp ? 'nghịch biến' : 'đồng biến'} trên ${analysis.monotonicityIntervals[0].latex} và ${isUp ? 'đồng biến' : 'nghịch biến'} trên ${analysis.monotonicityIntervals[1].latex}.`,
      numericAnswer: yv.value,
      correctDisplayLatex: `BBT parabol đỉnh I(${xv.plain}; ${yv.plain})`,
      correctCanonicalKey: opts[0].canonicalKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  if (mode === 'extrema-value' || mode === 'read-graph') {
    const extWord = isUp ? 'giá trị cực tiểu' : 'giá trị cực đại';
    const stemLatex =
      mode === 'read-graph'
        ? `Cho đồ thị hàm số bậc hai $y = f(x)$ như hình vẽ bên dưới. Dựa vào đồ thị, ${extWord} của hàm số là bao nhiêu?`
        : `Cho hàm số $f(x) = ${analysis.functionLatex}$ có đồ thị như hình vẽ. Tìm ${extWord} của hàm số.`;
    const correctLatex = `$${yv.latex}$`;
    const correctKey = `NUM:${yv.plain}`;
    const dOffsets = rng.shuffle([1, -1, 2, -2, 3, -3]);
    const distractors = [
      { latex: `$${xv.latex}$`, key: `NUM:${xv.plain}` },
      { latex: `$${-yv.value}$`, key: `NUM:${-yv.value}` },
      ...dOffsets.map((off) => {
        const v = Number((yv.value + off).toFixed(4));
        return { latex: `$${v}$`, key: `NUM:${v}` };
      }),
    ];
    const opts = buildFourDistinctTextOptions({ latex: correctLatex, key: correctKey }, distractors);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 phương án phân biệt.', params: { a, b, c }, functionFamily: 'quadratic' };
    }
    return {
      ok: true,
      params: { a, b, c },
      functionFamily: 'quadratic',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [graphAsset],
      stemLatex,
      explanationLatex: `Đạo hàm $f'(x) = ${analysis.derivativeLatex} = 0 \\Leftrightarrow x = ${xv.latex}$. Vì $a = ${a} ${isUp ? '> 0' : '< 0'}$ nên hàm số đạt ${isUp ? 'cực tiểu' : 'cực đại'} tại $x = ${xv.latex}$ với ${extWord} $y = f\\left(${xv.latex}\\right) = ${yv.latex}$.`,
      numericAnswer: yv.value,
      correctDisplayLatex: correctLatex,
      correctCanonicalKey: correctKey,
      shortAnswerValue: yv.plain,
      shortAnswerAccepted: [yv.plain, yv.plain.replace('.', ',')],
      allowShortAnswer: true,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  if (mode === 'extrema-points') {
    const correctLatex = `$I\\left(${xv.latex};\\; ${yv.latex}\\right)$`;
    const correctKey = `PAIR:(${xv.plain},${yv.plain})`;
    const distractors = [
      { latex: `$I\\left(${-xv.value};\\; ${yv.latex}\\right)$`, key: `PAIR:(${-xv.value},${yv.plain})` },
      { latex: `$I\\left(${yv.latex};\\; ${xv.latex}\\right)$`, key: `PAIR:(${yv.plain},${xv.plain})` },
      { latex: `$I\\left(${xv.latex};\\; ${-yv.value}\\right)$`, key: `PAIR:(${xv.plain},${-yv.value})` },
      { latex: `$I\\left(${xv.value + 1};\\; ${yv.value - 1}\\right)$`, key: `PAIR:(${xv.value + 1},${yv.value - 1})` },
      { latex: `$I\\left(${xv.value - 1};\\; ${yv.value + 1}\\right)$`, key: `PAIR:(${xv.value - 1},${yv.value + 1})` },
    ];
    const opts = buildFourDistinctTextOptions({ latex: correctLatex, key: correctKey }, distractors);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 phương án đỉnh phân biệt.', params: { a, b, c }, functionFamily: 'quadratic' };
    }
    return {
      ok: true,
      params: { a, b, c },
      functionFamily: 'quadratic',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [graphAsset],
      stemLatex: `Cho hàm số bậc hai $f(x) = ${analysis.functionLatex}$ có đồ thị như hình vẽ. Tọa độ đỉnh (điểm ${isUp ? 'cực tiểu' : 'cực đại'}) của parabol là:`,
      explanationLatex: `Ta có $f'(x) = ${analysis.derivativeLatex} = 0 \\Leftrightarrow x_0 = -\\frac{b}{2a} = ${xv.latex}$. Thay vào hàm số được $y_0 = f\\left(${xv.latex}\\right) = ${yv.latex}$. Vậy đỉnh parabol là $I\\left(${xv.latex};\\; ${yv.latex}\\right)$.`,
      numericAnswer: xv.value,
      correctDisplayLatex: correctLatex,
      correctCanonicalKey: correctKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  // Default: monotonicity-increasing or monotonicity-decreasing
  const targetInterval = mode === 'monotonicity-decreasing' ? decInterval : incInterval;
  const otherInterval = mode === 'monotonicity-decreasing' ? incInterval : decInterval;
  const trendLabel = mode === 'monotonicity-decreasing' ? 'nghịch biến' : 'đồng biến';

  const correctLatex = `$${targetInterval.latex}$`;
  const correctKey = normalizeIntervalKey(targetInterval.latex);
  const shifted1 = xv.value + 1;
  const shifted2 = xv.value - 1;
  const negX = -xv.value;

  const distractors = [
    { latex: `$${otherInterval.latex}$`, key: normalizeIntervalKey(otherInterval.latex) },
    { latex: `$(-\\infty; ${negX})$`, key: normalizeIntervalKey(`(-\\infty; ${negX})`) },
    { latex: `$(${negX}; +\\infty)$`, key: normalizeIntervalKey(`(${negX}; +\\infty)`) },
    { latex: `$(${shifted1}; +\\infty)$`, key: normalizeIntervalKey(`(${shifted1}; +\\infty)`) },
    { latex: `$(-\\infty; ${shifted2})$`, key: normalizeIntervalKey(`(-\\infty; ${shifted2})`) },
  ];
  const opts = buildFourDistinctTextOptions({ latex: correctLatex, key: correctKey }, distractors);
  if (!opts) {
    return { ok: false, error: 'Không tạo đủ 4 khoảng đơn điệu phân biệt.', params: { a, b, c }, functionFamily: 'quadratic' };
  }

  return {
    ok: true,
    params: { a, b, c },
    functionFamily: 'quadratic',
    analysis,
    graphSvg: graphRes.svg,
    variationTable,
    variationTableSvg,
    questionAssets: [graphAsset, bbtAsset],
    stemLatex: `Cho hàm số $f(x) = ${analysis.functionLatex}$ có đồ thị và bảng biến thiên kèm theo. Hàm số ${trendLabel} trên khoảng nào dưới đây?`,
    explanationLatex: `Đạo hàm $f'(x) = ${analysis.derivativeLatex} = 0 \\Leftrightarrow x = ${xv.latex}$. Vì $a = ${a} ${isUp ? '> 0' : '< 0'}$ nên $f'(x) ${mode === 'monotonicity-decreasing' ? '< 0' : '> 0'}$ trên khoảng $${targetInterval.latex}$. Vậy hàm số ${trendLabel} trên $${targetInterval.latex}$.`,
    numericAnswer: xv.value,
    correctDisplayLatex: correctLatex,
    correctCanonicalKey: correctKey,
    allowShortAnswer: false,
    options: opts,
    verificationProof: analysis.verificationProof,
  };
}

// ---------------------------------------------------------------------------
// 2. CUBIC MONOTONICITY & EXTREMA BUILDER (cubic-monotonicity, cubic-extrema)
// ---------------------------------------------------------------------------
export function buildCubicGraphCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>,
  variantId: string,
  rng: SeededRng
): Level3GraphCandidateResult {
  const familyId = template.familyId;
  const casePolicy =
    template.familyConfig?.cubicCasePolicy ??
    (familyId === 'cubic-extrema' ? 'two-extrema' : 'two-extrema');

  const a = rawParams.a;
  if (!Number.isFinite(a) || Math.abs(a) < 1e-12) {
    return { ok: false, error: 'Hệ số a = 0.', params: rawParams, functionFamily: 'cubic' };
  }

  let b: number;
  let c: number;
  const d = rawParams.d ?? 1;

  // Root-first construction when x1, x2 are parameterized for crisp integer/rational critical points
  if (rawParams.x1 !== undefined && rawParams.x2 !== undefined) {
    if (casePolicy === 'double-root') {
      const r = rawParams.x1;
      // f'(x) = 3a(x - r)^2 = 3ax^2 - 6ar x + 3ar^2  => b = -3ar, c = 3ar^2
      b = -3 * a * r;
      c = 3 * a * r * r;
    } else if (casePolicy === 'no-extrema') {
      const r = rawParams.x1;
      const shift = Math.max(1, Math.abs(rawParams.x2) || 2);
      // f'(x) = 3a((x - r)^2 + shift) = 3ax^2 - 6ar x + 3a(r^2 + shift) -> strictly Δ' < 0
      b = -3 * a * r;
      c = 3 * a * (r * r + shift);
    } else {
      // two-extrema: ensure x1 !== x2 and integer b = -3a(x1+x2)/2
      const x1 = rawParams.x1;
      const x2 = rawParams.x2;
      if (x1 === x2) {
        return {
          ok: false,
          error: 'Yêu cầu hai điểm cực trị phân biệt (x₁ ≠ x₂).',
          params: rawParams,
          functionFamily: 'cubic',
        };
      }
      // Choose scaled a_eff = 2*a if (x1+x2) is odd so b = -3*a*(x1+x2)/2 is exact integer!
      if ((a * (x1 + x2)) % 2 !== 0) {
        return {
          ok: false,
          error: 'Chọn cặp (x₁, x₂) cùng tính chẵn lẻ để hệ số b là số nguyên đẹp.',
          params: rawParams,
          functionFamily: 'cubic',
        };
      }
      b = (-3 * a * (x1 + x2)) / 2;
      c = 3 * a * x1 * x2;
    }
  } else {
    b = rawParams.b ?? 0;
    c = rawParams.c ?? 0;
  }

  const maxMag = template.familyConfig?.maxCoeffMagnitude ?? 48;
  if (Math.abs(b) > maxMag || Math.abs(c) > maxMag || Math.abs(d) > maxMag) {
    return {
      ok: false,
      error: `Hệ số đa thức vượt giới hạn hiển thị (${maxMag}).`,
      params: { a, b, c, d },
      functionFamily: 'cubic',
    };
  }

  const spec: DynamicFunctionSpec = { family: 'cubic', a, b, c, d };
  const analysis = analyzeCubicFunction(a, b, c, d, variantId);
  if (!analysis.verificationPassed) {
    return {
      ok: false,
      error: analysis.verificationErrors.join(' '),
      params: { a, b, c, d },
      functionFamily: 'cubic',
    };
  }

  // Enforce case policy strictly
  if (casePolicy !== 'any' && analysis.cubicCase !== casePolicy) {
    return {
      ok: false,
      error: `Trường hợp đạo hàm (${analysis.cubicCase}) không khớp cấu hình (${casePolicy}).`,
      params: { a, b, c, d },
      functionFamily: 'cubic',
    };
  }

  const defaultMode: GraphQuestionSubMode =
    familyId === 'cubic-extrema'
      ? 'extrema-value'
      : familyId === 'graph-variation-table'
      ? 'choose-variation-table'
      : 'monotonicity-increasing';
  const mode: GraphQuestionSubMode = template.familyConfig?.graphQuestionMode ?? defaultMode;

  // Guard: NEVER generate extrema question when cubic has no extrema!
  if (
    (mode === 'extrema-points' || mode === 'extrema-value') &&
    analysis.extrema.length === 0
  ) {
    return {
      ok: false,
      error: 'Hàm bậc ba không có cực trị (đạo hàm không đổi dấu) — chặn sinh câu hỏi cực trị.',
      params: { a, b, c, d },
      functionFamily: 'cubic',
    };
  }

  const hideLegend = mode === 'read-graph';
  const graphRes = buildDynamicSvgGraph(analysis, { hideLegend });
  if (!graphRes.valid) {
    return { ok: false, error: graphRes.errors.join(' '), params: { a, b, c, d }, functionFamily: 'cubic' };
  }
  const variationTable = buildVariationTableModel(analysis);
  const variationTableSvg = renderVariationTableSvg(variationTable);

  const graphAsset = createMathVisualAsset({
    id: `${variantId}-graph`,
    kind: 'geometry-svg',
    label: hideLegend ? 'Đồ thị hàm số y = f(x)' : `Đồ thị hàm số y = ${analysis.functionLatex}`,
    sourceData: graphRes.svg,
  });
  const bbtAsset = createMathVisualAsset({
    id: `${variantId}-bbt`,
    kind: 'variation-table',
    label: 'Bảng biến thiên hàm số bậc ba',
    sourceData: variationTableSvg,
  });

  if (mode === 'choose-graph') {
    const opts = buildChooseGraphOptions(spec, analysis, variantId);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 đồ thị bậc ba phân biệt.', params: { a, b, c, d }, functionFamily: 'cubic' };
    }
    return {
      ok: true,
      params: { a, b, c, d },
      functionFamily: 'cubic',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [],
      stemLatex: `Đồ thị nào dưới đây là đồ thị của hàm số $f(x) = ${analysis.functionLatex}$?`,
      explanationLatex: `Hàm bậc ba có $a = ${a} ${a > 0 ? '> 0' : '< 0'}$ (nhánh phải đi ${a > 0 ? 'lên +∞' : 'xuống -∞'}), $f'(x) = ${analysis.derivativeLatex}$, cắt trục tung tại $(0;\\; ${d})$${analysis.extrema.length === 2 ? ` và có hai điểm cực trị tại $x = ${analysis.extrema[0].x.latex}$, $x = ${analysis.extrema[1].x.latex}$.` : ' và đơn điệu trên toàn $\\mathbb{R}$.'}`,
      numericAnswer: d,
      correctDisplayLatex: `Đồ thị f(x) = ${analysis.functionLatex}`,
      correctCanonicalKey: opts[0].canonicalKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  if (mode === 'choose-variation-table') {
    const opts = buildChooseVariationTableOptions(spec, analysis, variationTable, variantId);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 bảng biến thiên phân biệt.', params: { a, b, c, d }, functionFamily: 'cubic' };
    }
    return {
      ok: true,
      params: { a, b, c, d },
      functionFamily: 'cubic',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [],
      stemLatex: `Bảng biến thiên nào dưới đây là của hàm số $f(x) = ${analysis.functionLatex}$?`,
      explanationLatex: `Tính $f'(x) = ${analysis.derivativeLatex}$. ${analysis.extrema.length === 2 ? `Phương trình $f'(x) = 0$ có hai nghiệm phân biệt $x = ${analysis.extrema[0].x.latex}$ và $x = ${analysis.extrema[1].x.latex}$, kết hợp dấu của $a = ${a}$ cho đúng bảng biến thiên.` : `Do $\\Delta' \\le 0$ nên $f'(x)$ không đổi dấu trên $\\mathbb{R}$ (hàm số đơn điệu trên $\\mathbb{R}$, không có cực trị).`}`,
      numericAnswer: d,
      correctDisplayLatex: `Bảng biến thiên f(x) = ${analysis.functionLatex}`,
      correctCanonicalKey: opts[0].canonicalKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  if (mode === 'extrema-value' || mode === 'read-graph') {
    const maxPt = analysis.extrema.find((p) => p.kind === 'local-max');
    const minPt = analysis.extrema.find((p) => p.kind === 'local-min');
    if (!maxPt || !minPt) {
      return { ok: false, error: 'Thiếu điểm cực đại/cực tiểu.', params: { a, b, c, d }, functionFamily: 'cubic' };
    }
    const target = rng.next() < 0.5 ? maxPt : minPt;
    const other = target === maxPt ? minPt : maxPt;
    const labelVn = target.kind === 'local-max' ? 'giá trị cực đại' : 'giá trị cực tiểu';

    const stemLatex =
      mode === 'read-graph'
        ? `Cho hàm số bậc ba $y = f(x)$ có đồ thị như hình vẽ bên dưới. Dựa vào đồ thị, ${labelVn} của hàm số là:`
        : `Cho hàm số $f(x) = ${analysis.functionLatex}$ có đồ thị và bảng biến thiên kèm theo. Tìm ${labelVn} của hàm số.`;

    const correctLatex = `$${target.y.latex}$`;
    const correctKey = `NUM:${target.y.plain}`;
    const distractors = [
      { latex: `$${other.y.latex}$`, key: `NUM:${other.y.plain}` },
      { latex: `$${target.x.latex}$`, key: `NUM:${target.x.plain}` },
      { latex: `$${other.x.latex}$`, key: `NUM:${other.x.plain}` },
      { latex: `$${target.y.value + 2}$`, key: `NUM:${target.y.value + 2}` },
      { latex: `$${target.y.value - 2}$`, key: `NUM:${target.y.value - 2}` },
    ];
    const opts = buildFourDistinctTextOptions({ latex: correctLatex, key: correctKey }, distractors);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 phương án giá trị cực trị.', params: { a, b, c, d }, functionFamily: 'cubic' };
    }

    return {
      ok: true,
      params: { a, b, c, d },
      functionFamily: 'cubic',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: mode === 'read-graph' ? [graphAsset] : [graphAsset, bbtAsset],
      stemLatex,
      explanationLatex: `Ta có $f'(x) = ${analysis.derivativeLatex} = 0 \\Leftrightarrow x = ${analysis.extrema[0].x.latex}$ hoặc $x = ${analysis.extrema[1].x.latex}$. Lập bảng biến thiên ta thấy hàm số đạt ${target.kind === 'local-max' ? 'cực đại' : 'cực tiểu'} tại $x = ${target.x.latex}$ với ${labelVn} $y = ${target.y.latex}$.`,
      numericAnswer: target.y.value,
      correctDisplayLatex: correctLatex,
      correctCanonicalKey: correctKey,
      shortAnswerValue: target.y.plain,
      shortAnswerAccepted: [target.y.plain, target.y.plain.replace('.', ',')],
      allowShortAnswer: true,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  if (mode === 'extrema-points') {
    const maxPt = analysis.extrema.find((p) => p.kind === 'local-max')!;
    const minPt = analysis.extrema.find((p) => p.kind === 'local-min')!;
    const target = rng.next() < 0.5 ? maxPt : minPt;
    const other = target === maxPt ? minPt : maxPt;
    const labelVn = target.kind === 'local-max' ? 'điểm cực đại' : 'điểm cực tiểu';

    const correctLatex = `$M\\left(${target.x.latex};\\; ${target.y.latex}\\right)$`;
    const correctKey = `PAIR:(${target.x.plain},${target.y.plain})`;
    const distractors = [
      { latex: `$M\\left(${other.x.latex};\\; ${other.y.latex}\\right)$`, key: `PAIR:(${other.x.plain},${other.y.plain})` },
      { latex: `$M\\left(${target.y.latex};\\; ${target.x.latex}\\right)$`, key: `PAIR:(${target.y.plain},${target.x.plain})` },
      { latex: `$M\\left(${-target.x.value};\\; ${target.y.latex}\\right)$`, key: `PAIR:(${-target.x.value},${target.y.plain})` },
      { latex: `$M\\left(${target.x.latex};\\; ${-target.y.value}\\right)$`, key: `PAIR:(${target.x.plain},${-target.y.value})` },
    ];
    const opts = buildFourDistinctTextOptions({ latex: correctLatex, key: correctKey }, distractors);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 phương án tọa độ cực trị.', params: { a, b, c, d }, functionFamily: 'cubic' };
    }
    return {
      ok: true,
      params: { a, b, c, d },
      functionFamily: 'cubic',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [graphAsset, bbtAsset],
      stemLatex: `Cho hàm số $f(x) = ${analysis.functionLatex}$ có đồ thị kèm theo. Tọa độ ${labelVn} của đồ thị hàm số là:`,
      explanationLatex: `Giải $f'(x) = ${analysis.derivativeLatex} = 0$ được $x = ${analysis.extrema[0].x.latex}$ và $x = ${analysis.extrema[1].x.latex}$. Xét dấu đạo hàm suy ra đồ thị đạt ${labelVn} tại $M\\left(${target.x.latex};\\; ${target.y.latex}\\right)$.`,
      numericAnswer: target.x.value,
      correctDisplayLatex: correctLatex,
      correctCanonicalKey: correctKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  // Monotonicity (increasing / decreasing) — handles all 3 cubic cases cleanly!
  const isDecWanted = mode === 'monotonicity-decreasing';
  const matchingIntervals = analysis.monotonicityIntervals.filter((iv) =>
    isDecWanted ? iv.trend === 'decreasing' : iv.trend === 'increasing'
  );
  const targetInterval =
    matchingIntervals.length > 0
      ? matchingIntervals[0]
      : analysis.monotonicityIntervals[0];
  const actualTrendVn =
    targetInterval.trend === 'increasing' ? 'đồng biến' : 'nghịch biến';

  const correctLatex = `$${targetInterval.latex}$`;
  const correctKey = normalizeIntervalKey(targetInterval.latex);

  const distractorPool: Array<{ latex: string; key: string }> = [];
  for (const iv of analysis.monotonicityIntervals) {
    if (iv.trend !== targetInterval.trend) {
      distractorPool.push({ latex: `$${iv.latex}$`, key: normalizeIntervalKey(iv.latex) });
    }
  }
  if (analysis.extrema.length === 2) {
    const x1 = analysis.extrema[0].x;
    const x2 = analysis.extrema[1].x;
    distractorPool.push(
      { latex: `$(${x1.value - 1}; ${x2.value + 1})$`, key: normalizeIntervalKey(`(${x1.value - 1}; ${x2.value + 1})`) },
      { latex: `$(-\\infty; ${x2.latex})$`, key: normalizeIntervalKey(`(-\\infty; ${x2.latex})`) },
      { latex: `$(${x1.latex}; +\\infty)$`, key: normalizeIntervalKey(`(${x1.latex}; +\\infty)`) },
      { latex: `$\\mathbb{R}$`, key: normalizeIntervalKey('R') }
    );
  } else {
    // Strictly monotonic on R: distractors are opposite trend / wrong bounded intervals
    distractorPool.push(
      { latex: `$(-\\infty; 0)$ và nghịch biến trên $(0; +\\infty)$`, key: 'INT:split0' },
      { latex: `$(-1; 1)$ và đổi chiều ngoài đoạn $[-1; 1]$`, key: 'INT:split1' },
      { latex: `Không có khoảng ${actualTrendVn}`, key: 'INT:none' }
    );
  }

  const opts = buildFourDistinctTextOptions({ latex: correctLatex, key: correctKey }, distractorPool);
  if (!opts) {
    return { ok: false, error: 'Không tạo đủ 4 khoảng đơn điệu phân biệt.', params: { a, b, c, d }, functionFamily: 'cubic' };
  }

  return {
    ok: true,
    params: { a, b, c, d },
    functionFamily: 'cubic',
    analysis,
    graphSvg: graphRes.svg,
    variationTable,
    variationTableSvg,
    questionAssets: [graphAsset, bbtAsset],
    stemLatex: `Cho hàm số $f(x) = ${analysis.functionLatex}$ có đồ thị và bảng biến thiên kèm theo. Hàm số ${actualTrendVn} trên khoảng nào dưới đây?`,
    explanationLatex: `Ta có $f'(x) = ${analysis.derivativeLatex}$. ${analysis.extrema.length === 2 ? `Nghiệm $f'(x) = 0$ là $x = ${analysis.extrema[0].x.latex}$ và $x = ${analysis.extrema[1].x.latex}$. ` : `Vì $\\Delta' \\le 0$ nên $f'(x)$ luôn giữ nguyên dấu trên $\\mathbb{R}$. `}Từ bảng biến thiên suy ra hàm số ${actualTrendVn} trên $${targetInterval.latex}$.`,
    numericAnswer: analysis.extrema[0]?.x.value ?? 0,
    correctDisplayLatex: correctLatex,
    correctCanonicalKey: correctKey,
    allowShortAnswer: false,
    options: opts,
    verificationProof: analysis.verificationProof,
  };
}

// ---------------------------------------------------------------------------
// 3. LINEAR-FRACTIONAL BUILDER (rational-asymptotes, rational-monotonicity)
// ---------------------------------------------------------------------------
export function buildRationalGraphCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>,
  variantId: string
): Level3GraphCandidateResult {
  const a = rawParams.a;
  const b = rawParams.b;
  const c = rawParams.c;
  const d = rawParams.d;

  const det = a * d - b * c;
  if (!Number.isFinite(c) || Math.abs(c) < 1e-12 || Math.abs(det) < 1e-12) {
    return {
      ok: false,
      error: 'Hàm phân thức suy biến (c = 0 hoặc ad − bc = 0).',
      params: { a, b, c, d },
      functionFamily: 'rational',
    };
  }

  const spec: DynamicFunctionSpec = { family: 'rational', a, b, c, d };
  const analysis = analyzeRationalFunction(a, b, c, d, variantId);
  if (!analysis.verificationPassed || !analysis.asymptotes.vertical || !analysis.asymptotes.horizontal) {
    return {
      ok: false,
      error: analysis.verificationErrors.join(' '),
      params: { a, b, c, d },
      functionFamily: 'rational',
    };
  }

  const defaultMode: GraphQuestionSubMode =
    template.familyId === 'rational-monotonicity' ? 'monotonicity-increasing' : 'asymptotes';
  const mode: GraphQuestionSubMode = template.familyConfig?.graphQuestionMode ?? defaultMode;

  // Guard: linear-fractional NEVER has extrema!
  if (mode === 'extrema-points' || mode === 'extrema-value') {
    return {
      ok: false,
      error: 'Hàm phân thức bậc nhất trên bậc nhất không có cực trị — chặn sinh câu hỏi cực trị.',
      params: { a, b, c, d },
      functionFamily: 'rational',
    };
  }

  const hideLegend = mode === 'read-graph';
  const graphRes = buildDynamicSvgGraph(analysis, { hideLegend });
  if (!graphRes.valid) {
    return { ok: false, error: graphRes.errors.join(' '), params: { a, b, c, d }, functionFamily: 'rational' };
  }
  const variationTable = buildVariationTableModel(analysis);
  const variationTableSvg = renderVariationTableSvg(variationTable);

  const vAsym = analysis.asymptotes.vertical;
  const hAsym = analysis.asymptotes.horizontal;
  const isInc = det > 0;

  const graphAsset = createMathVisualAsset({
    id: `${variantId}-graph`,
    kind: 'geometry-svg',
    label: hideLegend ? 'Đồ thị hàm phân thức y = f(x)' : `Đồ thị hàm số y = ${analysis.functionLatex}`,
    sourceData: graphRes.svg,
  });
  const bbtAsset = createMathVisualAsset({
    id: `${variantId}-bbt`,
    kind: 'variation-table',
    label: 'Bảng biến thiên hàm phân thức',
    sourceData: variationTableSvg,
  });

  if (mode === 'choose-graph') {
    const opts = buildChooseGraphOptions(spec, analysis, variantId);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 đồ thị phân thức phân biệt.', params: { a, b, c, d }, functionFamily: 'rational' };
    }
    return {
      ok: true,
      params: { a, b, c, d },
      functionFamily: 'rational',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [],
      stemLatex: `Đồ thị nào dưới đây là đồ thị của hàm số $f(x) = ${analysis.functionLatex}$?`,
      explanationLatex: `Tập xác định $D = ${analysis.domainLatex}$. Đồ thị có tiệm cận đứng $${vAsym.equationLatex}$, tiệm cận ngang $${hAsym.equationLatex}$ và đạo hàm $f'(x) = ${analysis.derivativeLatex} ${isInc ? '> 0' : '< 0'}$ trên từng khoảng xác định.`,
      numericAnswer: vAsym.x.value,
      correctDisplayLatex: `TCĐ ${vAsym.equationLatex}, TCN ${hAsym.equationLatex}`,
      correctCanonicalKey: opts[0].canonicalKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  if (mode === 'choose-variation-table') {
    const opts = buildChooseVariationTableOptions(spec, analysis, variationTable, variantId);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 bảng biến thiên phân thức phân biệt.', params: { a, b, c, d }, functionFamily: 'rational' };
    }
    return {
      ok: true,
      params: { a, b, c, d },
      functionFamily: 'rational',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [],
      stemLatex: `Bảng biến thiên nào dưới đây là của hàm số $f(x) = ${analysis.functionLatex}$?`,
      explanationLatex: `Tập xác định $D = ${analysis.domainLatex}$ (phân cách bởi hai gạch đứng tại $x = ${vAsym.x.latex}$). Đạo hàm $f'(x) = ${analysis.derivativeLatex} ${isInc ? '> 0' : '< 0'}$, $\\lim_{x \\to \\pm\\infty} f(x) = ${hAsym.y.latex}$, $\\lim_{x \\to (${vAsym.x.latex})^-} f(x) = ${vAsym.leftLimit}$, $\\lim_{x \\to (${vAsym.x.latex})^+} f(x) = ${vAsym.rightLimit}$.`,
      numericAnswer: vAsym.x.value,
      correctDisplayLatex: `BBT hàm phân thức TCĐ ${vAsym.equationLatex}`,
      correctCanonicalKey: opts[0].canonicalKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  if (mode === 'asymptotes' || mode === 'read-graph') {
    const correctLatex = `TCĐ: $${vAsym.equationLatex}$ và TCN: $${hAsym.equationLatex}$`;
    const correctKey = `ASYM:(x=${vAsym.x.plain},y=${hAsym.y.plain})`;

    const distractors = [
      {
        latex: `TCĐ: $x = ${hAsym.y.latex}$ và TCN: $y = ${vAsym.x.latex}$`,
        key: `ASYM:(x=${hAsym.y.plain},y=${vAsym.x.plain})`,
      },
      {
        latex: `TCĐ: $x = ${-vAsym.x.value}$ và TCN: $${hAsym.equationLatex}$`,
        key: `ASYM:(x=${-vAsym.x.value},y=${hAsym.y.plain})`,
      },
      {
        latex: `TCĐ: $${vAsym.equationLatex}$ và TCN: $y = ${-hAsym.y.value}$`,
        key: `ASYM:(x=${vAsym.x.plain},y=${-hAsym.y.value})`,
      },
      {
        latex: `TCĐ: $x = ${vAsym.x.value + 1}$ và TCN: $y = ${hAsym.y.value + 1}$`,
        key: `ASYM:(x=${vAsym.x.value + 1},y=${hAsym.y.value + 1})`,
      },
      {
        latex: `TCĐ: $x = ${vAsym.x.value - 1}$ và TCN: $y = ${hAsym.y.value - 1}$`,
        key: `ASYM:(x=${vAsym.x.value - 1},y=${hAsym.y.value - 1})`,
      },
    ];
    const opts = buildFourDistinctTextOptions({ latex: correctLatex, key: correctKey }, distractors);
    if (!opts) {
      return { ok: false, error: 'Không tạo đủ 4 phương án tiệm cận phân biệt.', params: { a, b, c, d }, functionFamily: 'rational' };
    }
    const stemLatex =
      mode === 'read-graph'
        ? `Cho đồ thị hàm phân thức $y = f(x)$ như hình vẽ bên dưới. Phương trình đường tiệm cận đứng (TCĐ) và tiệm cận ngang (TCN) của đồ thị là:`
        : `Cho hàm số $f(x) = ${analysis.functionLatex}$ có đồ thị kèm theo. Xác định phương trình đường tiệm cận đứng (TCĐ) và tiệm cận ngang (TCN) của đồ thị hàm số.`;
    return {
      ok: true,
      params: { a, b, c, d },
      functionFamily: 'rational',
      analysis,
      graphSvg: graphRes.svg,
      variationTable,
      variationTableSvg,
      questionAssets: [graphAsset],
      stemLatex,
      explanationLatex: `Mẫu thức bằng $0$ khi $${c}x ${d >= 0 ? `+ ${d}` : `- ${Math.abs(d)}`} = 0 \\Leftrightarrow x = ${vAsym.x.latex}$ (tử số khác $0$ do $ad - bc = ${det} \\neq 0$), suy ra TCĐ: $${vAsym.equationLatex}$. Giới hạn $\\lim_{x \\to \\pm\\infty} f(x) = \\frac{${a}}{${c}} = ${hAsym.y.latex}$, suy ra TCN: $${hAsym.equationLatex}$.`,
      numericAnswer: vAsym.x.value,
      correctDisplayLatex: correctLatex,
      correctCanonicalKey: correctKey,
      allowShortAnswer: false,
      options: opts,
      verificationProof: analysis.verificationProof,
    };
  }

  // Monotonicity on each domain branch (NEVER merge across vertical asymptote!)
  const trendVn = isInc ? 'đồng biến' : 'nghịch biến';
  const wrongTrendVn = isInc ? 'nghịch biến' : 'đồng biến';
  const iv1 = analysis.monotonicityIntervals[0];
  const iv2 = analysis.monotonicityIntervals[1];

  const correctLatex = `Hàm số ${trendVn} trên từng khoảng $${iv1.latex}$ và $${iv2.latex}$`;
  const correctKey = `RATMONO:${isInc ? 'inc' : 'dec'}:${vAsym.x.plain}`;

  const distractors = [
    {
      latex: `Hàm số ${wrongTrendVn} trên từng khoảng $${iv1.latex}$ và $${iv2.latex}$`,
      key: `RATMONO:${isInc ? 'dec' : 'inc'}:${vAsym.x.plain}`,
    },
    {
      latex: `Hàm số ${trendVn} trên toàn bộ tập $\\mathbb{R}$`,
      key: `RATMONO:R:${isInc ? 'inc' : 'dec'}`,
    },
    {
      latex: `Hàm số ${trendVn} trên $${iv1.latex}$ và ${wrongTrendVn} trên $${iv2.latex}$`,
      key: `RATMONO:mix1:${vAsym.x.plain}`,
    },
    {
      latex: `Hàm số có một điểm cực trị tại $x = ${vAsym.x.latex}$`,
      key: `RATMONO:fakeext:${vAsym.x.plain}`,
    },
  ];
  const opts = buildFourDistinctTextOptions({ latex: correctLatex, key: correctKey }, distractors);
  if (!opts) {
    return { ok: false, error: 'Không tạo đủ 4 phương án đơn điệu hàm phân thức.', params: { a, b, c, d }, functionFamily: 'rational' };
  }

  return {
    ok: true,
    params: { a, b, c, d },
    functionFamily: 'rational',
    analysis,
    graphSvg: graphRes.svg,
    variationTable,
    variationTableSvg,
    questionAssets: [graphAsset, bbtAsset],
    stemLatex: `Cho hàm số $f(x) = ${analysis.functionLatex}$ có đồ thị và bảng biến thiên kèm theo. Khẳng định nào sau đây là ĐÚNG về tính đơn điệu của hàm số?`,
    explanationLatex: `Tập xác định $D = ${analysis.domainLatex}$. Đạo hàm $f'(x) = ${analysis.derivativeLatex} ${isInc ? '> 0' : '< 0'}$ với mọi $x \\neq ${vAsym.x.latex}$. Do hàm số gián đoạn tại $x = ${vAsym.x.latex}$, kết luận chính xác là hàm số ${trendVn} trên từng khoảng $${iv1.latex}$ và $${iv2.latex}$ (không gộp qua điểm gián đoạn).`,
    numericAnswer: det,
    correctDisplayLatex: correctLatex,
    correctCanonicalKey: correctKey,
    allowShortAnswer: false,
    options: opts,
    verificationProof: analysis.verificationProof,
  };
}

/**
 * Unified dispatcher for all 6 Level 3 Dynamic Graph & Variation Table template families.
 */
export function buildLevel3GraphCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>,
  variantId: string,
  rng: SeededRng
): Level3GraphCandidateResult {
  if (template.familyId === 'quadratic-graph') {
    return buildQuadraticGraphCandidate(template, rawParams, variantId, rng);
  }
  if (template.familyId === 'cubic-monotonicity' || template.familyId === 'cubic-extrema') {
    return buildCubicGraphCandidate(template, rawParams, variantId, rng);
  }
  if (template.familyId === 'rational-asymptotes' || template.familyId === 'rational-monotonicity') {
    return buildRationalGraphCandidate(template, rawParams, variantId);
  }
  // graph-variation-table: dispatches to configured function family (default: cubic)
  const targetFamily: DynamicFunctionFamilyId =
    template.familyConfig?.graphFunctionFamily ?? 'cubic';
  if (targetFamily === 'quadratic') {
    return buildQuadraticGraphCandidate(template, rawParams, variantId, rng);
  }
  if (targetFamily === 'rational') {
    return buildRationalGraphCandidate(template, rawParams, variantId);
  }
  return buildCubicGraphCandidate(template, rawParams, variantId, rng);
}

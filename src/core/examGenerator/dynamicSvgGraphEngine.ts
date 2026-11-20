/**
 * Dynamic SVG Graph Engine & Smart Variation Table Engine (Phase 3)
 *
 * Pure deterministic SVG generation (ZERO continuous animations, ZERO NaN/Infinity,
 * strict branch splitting at discontinuities, XSS-safe pure SVG markup).
 *
 * Also includes real SVG -> PNG data URL conversion in browser environments for
 * maximum Microsoft Word (.docx) compatibility, with clean SVG fallback in Node tests.
 */

import type {
  DynamicFunctionAnalysis,
  VariationTableColumn,
  VariationTableModel,
} from '../../types/examGenerator';
import {
  evaluateFunction,
  type DynamicFunctionSpec,
} from './dynamicFunctionAnalyzer';

export interface SvgGraphOptions {
  width?: number;
  height?: number;
  hideLegend?: boolean;
  compact?: boolean;
  accentColor?: string;
}

export interface SvgGraphBuildResult {
  svg: string;
  fingerprint: string;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
  branchCount: number;
  samplePointCount: number;
  valid: boolean;
  errors: string[];
}

const MAX_SAMPLE_POINTS = 320;

function escapeSvgText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatTickValue(v: number): string {
  if (Math.abs(v) < 1e-9) return '0';
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  return Number(v.toFixed(1)).toString();
}

function formatLatexToCleanSvgLabel(latex: string): string {
  return latex
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\infty/g, '∞')
    .replace(/\\sqrt\{([^{}]+)\}/g, '√$1')
    .replace(/\^\{2\}/g, '²')
    .replace(/\^\{3\}/g, '³')
    .replace(/\^\{4\}/g, '⁴')
    .replace(/\^2/g, '²')
    .replace(/\^3/g, '³')
    .replace(/\\mathbb\{R\}/g, 'ℝ')
    .replace(/\\setminus/g, '\\')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\cdot/g, '·')
    .replace(/\$/g, '')
    .trim();
}

function specFromAnalysis(analysis: DynamicFunctionAnalysis): DynamicFunctionSpec {
  const p = analysis.params;
  if (analysis.family === 'quadratic') {
    return { family: 'quadratic', a: p.a ?? 1, b: p.b ?? 0, c: p.c ?? 0 };
  }
  if (analysis.family === 'cubic') {
    return {
      family: 'cubic',
      a: p.a ?? 1,
      b: p.b ?? 0,
      c: p.c ?? 0,
      d: p.d ?? 0,
    };
  }
  return {
    family: 'rational',
    a: p.a ?? 1,
    b: p.b ?? 0,
    c: p.c ?? 1,
    d: p.d ?? 0,
  };
}

function computeSmartViewport(
  spec: DynamicFunctionSpec,
  analysis: DynamicFunctionAnalysis
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const keyX: number[] = [0];
  const keyY: number[] = [0];

  if (analysis.vertex) {
    keyX.push(analysis.vertex.x.value);
    keyY.push(analysis.vertex.y.value);
  }
  for (const cp of analysis.criticalPoints) {
    keyX.push(cp.x.value);
    keyY.push(cp.y.value);
  }
  if (analysis.yIntercept) {
    keyX.push(0);
    keyY.push(analysis.yIntercept.y.value);
  }
  for (const xi of analysis.xIntercepts) {
    if (Math.abs(xi.value) <= 20) {
      keyX.push(xi.value);
    }
  }
  if (analysis.asymptotes.vertical) {
    keyX.push(analysis.asymptotes.vertical.x.value);
  }
  if (analysis.asymptotes.horizontal) {
    keyY.push(analysis.asymptotes.horizontal.y.value);
  }

  let rawXMin = Math.min(...keyX);
  let rawXMax = Math.max(...keyX);
  const xSpan = Math.max(4, rawXMax - rawXMin);
  const xPad = Math.max(2.6, xSpan * 0.65);

  let xMin = Math.floor(rawXMin - xPad);
  let xMax = Math.ceil(rawXMax + xPad);
  // Keep readable symmetric-ish range
  if (xMax - xMin < 8) {
    const mid = (xMin + xMax) / 2;
    xMin = Math.floor(mid - 4.5);
    xMax = Math.ceil(mid + 4.5);
  }
  if (xMax - xMin > 24) {
    const center = analysis.vertex?.x.value ?? analysis.asymptotes.vertical?.x.value ?? 0;
    xMin = Math.floor(center - 10);
    xMax = Math.ceil(center + 10);
  }

  // Sample curve values inside [xMin, xMax] to frame y cleanly without asymptote spikes
  const pole = analysis.asymptotes.vertical?.x.value;
  for (let i = 0; i <= 24; i += 1) {
    const tx = xMin + ((xMax - xMin) * i) / 24;
    if (pole !== undefined && Math.abs(tx - pole) < 0.75) continue;
    const ty = evaluateFunction(spec, tx);
    if (ty !== null && Number.isFinite(ty) && Math.abs(ty) <= 40) {
      keyY.push(ty);
    }
  }

  let rawYMin = Math.min(...keyY);
  let rawYMax = Math.max(...keyY);
  if (!Number.isFinite(rawYMin) || !Number.isFinite(rawYMax)) {
    return { xMin: -6, xMax: 6, yMin: -6, yMax: 6 };
  }

  // Clamp extreme polynomial tails so vertex/extrema remain clearly visible
  const anchorY = [
    0,
    ...(analysis.vertex ? [analysis.vertex.y.value] : []),
    ...analysis.criticalPoints.map((c) => c.y.value),
    ...(analysis.asymptotes.horizontal ? [analysis.asymptotes.horizontal.y.value] : []),
    ...(analysis.yIntercept ? [analysis.yIntercept.y.value] : []),
  ].filter(Number.isFinite);

  const anchorMin = Math.min(...anchorY);
  const anchorMax = Math.max(...anchorY);
  const anchorSpan = Math.max(4, anchorMax - anchorMin);
  const yPad = Math.max(2.5, anchorSpan * 0.45);

  let yMin = Math.floor(Math.max(rawYMin - 1, anchorMin - yPad));
  let yMax = Math.ceil(Math.min(rawYMax + 1, anchorMax + yPad));
  if (yMax - yMin < 8) {
    const midY = (anchorMin + anchorMax) / 2;
    yMin = Math.floor(midY - 4.5);
    yMax = Math.ceil(midY + 4.5);
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) {
    return { xMin: -6, xMax: 6, yMin: -6, yMax: 6 };
  }
  return { xMin, xMax, yMin, yMax };
}

function chooseTickStep(span: number): number {
  if (span <= 10) return 1;
  if (span <= 22) return 2;
  if (span <= 45) return 5;
  return 10;
}

/**
 * Generates adaptive sorted x-samples in [xMin, xMax] with extra density near
 * vertex, critical points, and vertical asymptote (respecting MAX_SAMPLE_POINTS).
 */
function buildAdaptiveSamples(
  xMin: number,
  xMax: number,
  focusXs: readonly number[],
  pole?: number
): number[] {
  const xs: number[] = [];
  const baseSteps = 120;
  for (let i = 0; i <= baseSteps; i += 1) {
    xs.push(xMin + ((xMax - xMin) * i) / baseSteps);
  }

  // Refine around critical points / vertex
  for (const fx of focusXs) {
    if (!Number.isFinite(fx)) continue;
    for (let k = -8; k <= 8; k += 1) {
      const sample = fx + k * 0.08;
      if (sample > xMin && sample < xMax) xs.push(sample);
    }
  }

  // Refine near vertical asymptote on BOTH sides without touching pole
  if (pole !== undefined && Number.isFinite(pole)) {
    const offsets = [0.025, 0.05, 0.09, 0.15, 0.24, 0.36, 0.52, 0.72, 1.0];
    for (const off of offsets) {
      if (pole - off > xMin) xs.push(pole - off);
      if (pole + off < xMax) xs.push(pole + off);
    }
  }

  xs.sort((a, b) => a - b);

  // Deduplicate close samples & enforce MAX_SAMPLE_POINTS
  const dedup: number[] = [];
  for (const v of xs) {
    if (dedup.length === 0 || Math.abs(v - dedup[dedup.length - 1]) > 1e-5) {
      dedup.push(v);
    }
  }
  if (dedup.length <= MAX_SAMPLE_POINTS) return dedup;

  const stride = (dedup.length - 1) / (MAX_SAMPLE_POINTS - 1);
  const capped: number[] = [];
  for (let i = 0; i < MAX_SAMPLE_POINTS; i += 1) {
    capped.push(dedup[Math.round(i * stride)]);
  }
  return capped;
}

/**
 * Builds a verified static SVG graph directly from DynamicFunctionAnalysis.
 */
export function buildDynamicSvgGraph(
  analysis: DynamicFunctionAnalysis,
  options?: SvgGraphOptions
): SvgGraphBuildResult {
  const width = options?.width ?? (options?.compact ? 320 : 480);
  const height = options?.height ?? (options?.compact ? 210 : 310);
  const accentColor = options?.accentColor ?? '#4F46E5';
  const padL = options?.compact ? 28 : 40;
  const padR = options?.compact ? 18 : 26;
  const padT = options?.compact ? 24 : 34;
  const padB = options?.compact ? 24 : 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const spec = specFromAnalysis(analysis);
  const viewport = computeSmartViewport(spec, analysis);
  const { xMin, xMax, yMin, yMax } = viewport;

  const toSvgX = (x: number): number => padL + ((x - xMin) / (xMax - xMin)) * plotW;
  const toSvgY = (y: number): number => padT + ((yMax - y) / (yMax - yMin)) * plotH;
  const fmt = (n: number): string => Number(n.toFixed(2)).toString();

  const pole = analysis.asymptotes.vertical?.x.value;
  const focusXs: number[] = [
    ...(analysis.vertex ? [analysis.vertex.x.value] : []),
    ...analysis.criticalPoints.map((c) => c.x.value),
  ];

  const samples = buildAdaptiveSamples(xMin, xMax, focusXs, pole);
  const ySpan = yMax - yMin;
  const yClipMin = yMin - ySpan * 0.25;
  const yClipMax = yMax + ySpan * 0.25;

  // Build continuous path branches (STRICT split at vertical asymptote / out-of-range jumps)
  const branches: Array<Array<{ sx: number; sy: number; x: number; y: number }>> = [];
  let currentBranch: Array<{ sx: number; sy: number; x: number; y: number }> = [];
  let prevX: number | null = null;
  let prevY: number | null = null;

  for (const x of samples) {
    // Never cross pole
    if (
      pole !== undefined &&
      prevX !== null &&
      ((prevX < pole && x > pole) || (prevX > pole && x < pole) || Math.abs(x - pole) < 0.015)
    ) {
      if (currentBranch.length >= 2) branches.push(currentBranch);
      currentBranch = [];
      prevX = x;
      prevY = null;
      if (Math.abs(x - pole) < 0.015) continue;
    }

    const y = evaluateFunction(spec, x);
    if (y === null || !Number.isFinite(y) || y < yClipMin || y > yClipMax) {
      if (currentBranch.length >= 2) branches.push(currentBranch);
      currentBranch = [];
      prevX = x;
      prevY = null;
      continue;
    }

    // Split on huge vertical jump (extra safety against discontinuity bridging)
    if (prevY !== null && Math.abs(y - prevY) > ySpan * 1.15) {
      if (currentBranch.length >= 2) branches.push(currentBranch);
      currentBranch = [];
    }

    const sx = toSvgX(x);
    const sy = toSvgY(y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
      continue;
    }

    currentBranch.push({ sx, sy, x, y });
    prevX = x;
    prevY = y;
  }
  if (currentBranch.length >= 2) {
    branches.push(currentBranch);
  }

  const clipId = `clip-${analysis.fingerprint.replace(/[^a-zA-Z0-9]/g, '')}-${width}`;
  const xStep = chooseTickStep(xMax - xMin);
  const yStep = chooseTickStep(yMax - yMin);

  const gridLines: string[] = [];
  const tickLabels: string[] = [];

  const axisYPos = Math.max(padT, Math.min(padT + plotH, toSvgY(0)));
  const axisXPos = Math.max(padL, Math.min(padL + plotW, toSvgX(0)));
  const showZeroX = xMin <= 0 && xMax >= 0;
  const showZeroY = yMin <= 0 && yMax >= 0;

  for (let gx = Math.ceil(xMin / xStep) * xStep; gx <= xMax; gx += xStep) {
    const sx = toSvgX(gx);
    gridLines.push(
      `<line x1="${fmt(sx)}" y1="${padT}" x2="${fmt(sx)}" y2="${padT + plotH}" stroke="#E2E8F0" stroke-width="1"/>`
    );
    if (Math.abs(gx) > 1e-9) {
      tickLabels.push(
        `<line x1="${fmt(sx)}" y1="${fmt(axisYPos - 3)}" x2="${fmt(sx)}" y2="${fmt(axisYPos + 3)}" stroke="#475569" stroke-width="1"/>`,
        `<text x="${fmt(sx)}" y="${fmt(Math.min(height - 6, axisYPos + 14))}" text-anchor="middle" font-size="${options?.compact ? 9 : 10}" fill="#475569" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(formatTickValue(gx))}</text>`
      );
    }
  }

  for (let gy = Math.ceil(yMin / yStep) * yStep; gy <= yMax; gy += yStep) {
    const sy = toSvgY(gy);
    gridLines.push(
      `<line x1="${padL}" y1="${fmt(sy)}" x2="${padL + plotW}" y2="${fmt(sy)}" stroke="#E2E8F0" stroke-width="1"/>`
    );
    if (Math.abs(gy) > 1e-9) {
      tickLabels.push(
        `<line x1="${fmt(axisXPos - 3)}" y1="${fmt(sy)}" x2="${fmt(axisXPos + 3)}" y2="${fmt(sy)}" stroke="#475569" stroke-width="1"/>`,
        `<text x="${fmt(Math.max(18, axisXPos - 7))}" y="${fmt(sy + 3.5)}" text-anchor="end" font-size="${options?.compact ? 9 : 10}" fill="#475569" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(formatTickValue(gy))}</text>`
      );
    }
  }

  // Asymptotes (dashed rose/amber lines)
  const asymptoteParts: string[] = [];
  if (analysis.asymptotes.vertical) {
    const vx = analysis.asymptotes.vertical.x.value;
    if (vx >= xMin && vx <= xMax) {
      const svx = toSvgX(vx);
      asymptoteParts.push(
        `<line x1="${fmt(svx)}" y1="${padT}" x2="${fmt(svx)}" y2="${padT + plotH}" stroke="#E11D48" stroke-width="1.5" stroke-dasharray="5 4"/>`,
        `<text x="${fmt(Math.min(width - 42, svx + 5))}" y="${padT + 14}" font-size="${options?.compact ? 9 : 10.5}" font-weight="600" fill="#BE123C" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(formatLatexToCleanSvgLabel(analysis.asymptotes.vertical.equationLatex))}</text>`
      );
    }
  }
  if (analysis.asymptotes.horizontal) {
    const hy = analysis.asymptotes.horizontal.y.value;
    if (hy >= yMin && hy <= yMax) {
      const shy = toSvgY(hy);
      asymptoteParts.push(
        `<line x1="${padL}" y1="${fmt(shy)}" x2="${padL + plotW}" y2="${fmt(shy)}" stroke="#D97706" stroke-width="1.5" stroke-dasharray="5 4"/>`,
        `<text x="${padL + plotW - 6}" y="${fmt(Math.max(padT + 14, shy - 5))}" text-anchor="end" font-size="${options?.compact ? 9 : 10.5}" font-weight="600" fill="#B45309" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(formatLatexToCleanSvgLabel(analysis.asymptotes.horizontal.equationLatex))}</text>`
      );
    }
  }

  // Curve paths
  const pathParts = branches.map((branch) => {
    const dStr = branch
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${fmt(pt.sx)} ${fmt(pt.sy)}`)
      .join(' ');
    return `<path d="${dStr}" fill="none" stroke="${accentColor}" stroke-width="${options?.compact ? 2.2 : 2.6}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });

  // Key markers: vertex / extrema / dashed projection lines
  const markerParts: string[] = [];
  const pointsToMark = analysis.extrema.length > 0 ? analysis.extrema : analysis.criticalPoints;
  for (const pt of pointsToMark) {
    if (pt.x.value < xMin || pt.x.value > xMax || pt.y.value < yMin || pt.y.value > yMax) {
      continue;
    }
    const sx = toSvgX(pt.x.value);
    const sy = toSvgY(pt.y.value);
    const color =
      pt.kind === 'local-max'
        ? '#059669'
        : pt.kind === 'local-min'
        ? '#DC2626'
        : '#64748B';
    // Dashed projections to Ox and Oy
    if (showZeroY) {
      markerParts.push(
        `<line x1="${fmt(sx)}" y1="${fmt(sy)}" x2="${fmt(sx)}" y2="${fmt(axisYPos)}" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 3"/>`
      );
    }
    if (showZeroX) {
      markerParts.push(
        `<line x1="${fmt(sx)}" y1="${fmt(sy)}" x2="${fmt(axisXPos)}" y2="${fmt(sy)}" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 3"/>`
      );
    }
    markerParts.push(
      `<circle cx="${fmt(sx)}" cy="${fmt(sy)}" r="${options?.compact ? 3.5 : 4.5}" fill="#FFFFFF" stroke="${color}" stroke-width="2.2"/>`
    );
    if (!options?.compact) {
      const coordLabel = `(${pt.x.plain}; ${pt.y.plain})`;
      const labelY = pt.kind === 'local-min' ? Math.min(padT + plotH - 6, sy + 16) : Math.max(padT + 14, sy - 9);
      markerParts.push(
        `<text x="${fmt(Math.min(padL + plotW - 38, Math.max(padL + 34, sx)))}" y="${fmt(labelY)}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(coordLabel)}</text>`
      );
    }
  }

  // Highlight y-intercept if distinct from extrema and within viewport
  if (analysis.yIntercept) {
    const iy = analysis.yIntercept.y.value;
    const isNearMarked = pointsToMark.some(
      (p) => Math.abs(p.x.value) < 0.15 && Math.abs(p.y.value - iy) < 0.2
    );
    if (!isNearMarked && iy >= yMin && iy <= yMax && showZeroX) {
      const sy = toSvgY(iy);
      markerParts.push(
        `<circle cx="${fmt(axisXPos)}" cy="${fmt(sy)}" r="3" fill="#0F172A"/>`
      );
    }
  }

  const legendText = options?.hideLegend
    ? 'Đồ thị hàm số y = f(x)'
    : `y = ${formatLatexToCleanSvgLabel(analysis.functionLatex)}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeSvgText(legendText)}" data-graph-fingerprint="${escapeSvgText(analysis.fingerprint)}">
  <defs>
    <clipPath id="${clipId}">
      <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}"/>
    </clipPath>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1"/>
  <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#FAFBFF"/>
  ${gridLines.join('\n  ')}
  <g stroke="#334155" stroke-width="1.4">
    <line x1="${padL}" y1="${fmt(axisYPos)}" x2="${padL + plotW + 6}" y2="${fmt(axisYPos)}"/>
    <polygon points="${padL + plotW + 8},${fmt(axisYPos)} ${padL + plotW + 1},${fmt(axisYPos - 3.5)} ${padL + plotW + 1},${fmt(axisYPos + 3.5)}" fill="#334155" stroke="none"/>
    <line x1="${fmt(axisXPos)}" y1="${padT + plotH}" x2="${fmt(axisXPos)}" y2="${padT - 6}"/>
    <polygon points="${fmt(axisXPos)},${padT - 8} ${fmt(axisXPos - 3.5)},${padT - 1} ${fmt(axisXPos + 3.5)},${padT - 1}" fill="#334155" stroke="none"/>
  </g>
  <text x="${padL + plotW + 10}" y="${fmt(axisYPos + 4)}" font-size="${options?.compact ? 10 : 11}" font-weight="700" font-style="italic" fill="#0F172A" font-family="ui-sans-serif, system-ui, sans-serif">x</text>
  <text x="${fmt(axisXPos + 7)}" y="${padT - 2}" font-size="${options?.compact ? 10 : 11}" font-weight="700" font-style="italic" fill="#0F172A" font-family="ui-sans-serif, system-ui, sans-serif">y</text>
  ${showZeroX && showZeroY ? `<text x="${fmt(axisXPos - 6)}" y="${fmt(axisYPos + 13)}" text-anchor="end" font-size="${options?.compact ? 9.5 : 10.5}" font-weight="600" fill="#0F172A" font-family="ui-sans-serif, system-ui, sans-serif">O</text>` : ''}
  ${tickLabels.join('\n  ')}
  <g clip-path="url(#${clipId})">
    ${asymptoteParts.join('\n    ')}
    ${pathParts.join('\n    ')}
    ${markerParts.join('\n    ')}
  </g>
  <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="none" stroke="#CBD5E1" stroke-width="1"/>
  <rect x="${padL + 6}" y="6" width="${Math.min(width - padL - 16, Math.max(120, legendText.length * (options?.compact ? 6.2 : 6.8) + 18))}" height="${options?.compact ? 16 : 20}" rx="6" fill="#EEF2FF" stroke="#C7D2FE" stroke-width="1"/>
  <text x="${padL + 14}" y="${options?.compact ? 17 : 19.5}" font-size="${options?.compact ? 9.5 : 11}" font-weight="700" fill="#312E81" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(legendText)}</text>
</svg>`;

  const errors: string[] = [];
  if (svg.includes('NaN') || svg.includes('Infinity')) {
    errors.push('Đồ thị SVG chứa tọa độ NaN hoặc Infinity.');
  }
  if (branches.length === 0) {
    errors.push('Không sinh được nhánh đường cong hợp lệ trong khung nhìn.');
  }
  if (analysis.family === 'rational' && branches.length < 2) {
    errors.push('Đồ thị hàm phân thức phải có 2 nhánh tách biệt qua tiệm cận đứng.');
  }

  return {
    svg,
    fingerprint: analysis.fingerprint,
    viewport,
    branchCount: branches.length,
    samplePointCount: samples.length,
    valid: errors.length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// SMART VARIATION TABLE ENGINE (Structured Model -> SVG Renderer)
// ---------------------------------------------------------------------------

/**
 * Generates structured VariationTableModel strictly from DynamicFunctionAnalysis.
 * Never hard-codes LaTeX tables; faithfully represents discontinuities (||) and
 * double-root stationary inflection points (no fake extrema arrows).
 */
export function buildVariationTableModel(
  analysis: DynamicFunctionAnalysis
): VariationTableModel {
  const columns: VariationTableColumn[] = [];

  if (analysis.family === 'quadratic' && analysis.vertex) {
    const aPos = (analysis.params.a ?? 1) > 0;
    const x0 = analysis.vertex.x;
    const y0 = analysis.vertex.y;
    columns.push(
      {
        kind: 'boundary',
        xLabel: '-∞',
        xLatex: '-\\infty',
        derivSymbol: '',
        valueLabel: analysis.limitNegInf,
        valueLatex: aPos ? '+\\infty' : '-\\infty',
        yPositionHint: aPos ? 'high' : 'low',
      },
      {
        kind: 'interval',
        xLabel: '',
        xLatex: '',
        derivSymbol: aPos ? '-' : '+',
        trend: aPos ? 'down' : 'up',
      },
      {
        kind: 'critical',
        xLabel: x0.plain,
        xLatex: x0.latex,
        derivSymbol: '0',
        valueLabel: y0.plain,
        valueLatex: y0.latex,
        extremumBadge: aPos ? 'CT' : 'CĐ',
        yPositionHint: aPos ? 'low' : 'high',
      },
      {
        kind: 'interval',
        xLabel: '',
        xLatex: '',
        derivSymbol: aPos ? '+' : '-',
        trend: aPos ? 'up' : 'down',
      },
      {
        kind: 'boundary',
        xLabel: '+∞',
        xLatex: '+\\infty',
        derivSymbol: '',
        valueLabel: analysis.limitPosInf,
        valueLatex: aPos ? '+\\infty' : '-\\infty',
        yPositionHint: aPos ? 'high' : 'low',
      }
    );
  } else if (analysis.family === 'cubic') {
    const aPos = (analysis.params.a ?? 1) > 0;
    const outerSign: '+' | '-' = aPos ? '+' : '-';
    const innerSign: '+' | '-' = aPos ? '-' : '+';

    if (analysis.cubicCase === 'two-extrema' && analysis.extrema.length === 2) {
      const [p1, p2] = analysis.extrema;
      columns.push(
        {
          kind: 'boundary',
          xLabel: '-∞',
          xLatex: '-\\infty',
          derivSymbol: '',
          valueLabel: analysis.limitNegInf,
          valueLatex: aPos ? '-\\infty' : '+\\infty',
          yPositionHint: aPos ? 'low' : 'high',
        },
        {
          kind: 'interval',
          xLabel: '',
          xLatex: '',
          derivSymbol: outerSign,
          trend: aPos ? 'up' : 'down',
        },
        {
          kind: 'critical',
          xLabel: p1.x.plain,
          xLatex: p1.x.latex,
          derivSymbol: '0',
          valueLabel: p1.y.plain,
          valueLatex: p1.y.latex,
          extremumBadge: p1.kind === 'local-max' ? 'CĐ' : 'CT',
          yPositionHint: p1.kind === 'local-max' ? 'high' : 'low',
        },
        {
          kind: 'interval',
          xLabel: '',
          xLatex: '',
          derivSymbol: innerSign,
          trend: aPos ? 'down' : 'up',
        },
        {
          kind: 'critical',
          xLabel: p2.x.plain,
          xLatex: p2.x.latex,
          derivSymbol: '0',
          valueLabel: p2.y.plain,
          valueLatex: p2.y.latex,
          extremumBadge: p2.kind === 'local-max' ? 'CĐ' : 'CT',
          yPositionHint: p2.kind === 'local-max' ? 'high' : 'low',
        },
        {
          kind: 'interval',
          xLabel: '',
          xLatex: '',
          derivSymbol: outerSign,
          trend: aPos ? 'up' : 'down',
        },
        {
          kind: 'boundary',
          xLabel: '+∞',
          xLatex: '+\\infty',
          derivSymbol: '',
          valueLabel: analysis.limitPosInf,
          valueLatex: aPos ? '+\\infty' : '-\\infty',
          yPositionHint: aPos ? 'high' : 'low',
        }
      );
    } else if (analysis.cubicCase === 'double-root' && analysis.criticalPoints.length === 1) {
      const p0 = analysis.criticalPoints[0];
      // Double root: same sign on both sides, monotonic arrow, NO extremum badge!
      columns.push(
        {
          kind: 'boundary',
          xLabel: '-∞',
          xLatex: '-\\infty',
          derivSymbol: '',
          valueLabel: analysis.limitNegInf,
          valueLatex: aPos ? '-\\infty' : '+\\infty',
          yPositionHint: aPos ? 'low' : 'high',
        },
        {
          kind: 'interval',
          xLabel: '',
          xLatex: '',
          derivSymbol: outerSign,
          trend: aPos ? 'up' : 'down',
        },
        {
          kind: 'critical',
          xLabel: p0.x.plain,
          xLatex: p0.x.latex,
          derivSymbol: '0',
          valueLabel: p0.y.plain,
          valueLatex: p0.y.latex,
          yPositionHint: 'mid',
        },
        {
          kind: 'interval',
          xLabel: '',
          xLatex: '',
          derivSymbol: outerSign,
          trend: aPos ? 'up' : 'down',
        },
        {
          kind: 'boundary',
          xLabel: '+∞',
          xLatex: '+\\infty',
          derivSymbol: '',
          valueLabel: analysis.limitPosInf,
          valueLatex: aPos ? '+\\infty' : '-\\infty',
          yPositionHint: aPos ? 'high' : 'low',
        }
      );
    } else {
      // Strictly monotonic on R (no real critical points)
      columns.push(
        {
          kind: 'boundary',
          xLabel: '-∞',
          xLatex: '-\\infty',
          derivSymbol: '',
          valueLabel: analysis.limitNegInf,
          valueLatex: aPos ? '-\\infty' : '+\\infty',
          yPositionHint: aPos ? 'low' : 'high',
        },
        {
          kind: 'interval',
          xLabel: '',
          xLatex: '',
          derivSymbol: outerSign,
          trend: aPos ? 'up' : 'down',
        },
        {
          kind: 'boundary',
          xLabel: '+∞',
          xLatex: '+\\infty',
          derivSymbol: '',
          valueLabel: analysis.limitPosInf,
          valueLatex: aPos ? '+\\infty' : '-\\infty',
          yPositionHint: aPos ? 'high' : 'low',
        }
      );
    }
  } else if (
    analysis.family === 'rational' &&
    analysis.asymptotes.vertical &&
    analysis.asymptotes.horizontal
  ) {
    const vAsym = analysis.asymptotes.vertical;
    const hAsym = analysis.asymptotes.horizontal;
    const sign: '+' | '-' = analysis.monotonicityIntervals[0]?.sign ?? '+';
    const isInc = sign === '+';

    columns.push(
      {
        kind: 'boundary',
        xLabel: '-∞',
        xLatex: '-\\infty',
        derivSymbol: '',
        valueLabel: hAsym.y.plain,
        valueLatex: hAsym.y.latex,
        yPositionHint: isInc ? 'low' : 'high',
      },
      {
        kind: 'interval',
        xLabel: '',
        xLatex: '',
        derivSymbol: sign,
        trend: isInc ? 'up' : 'down',
      },
      {
        kind: 'discontinuity',
        xLabel: vAsym.x.plain,
        xLatex: vAsym.x.latex,
        derivSymbol: '||',
        leftLimitLabel: vAsym.leftLimit,
        rightLimitLabel: vAsym.rightLimit,
      },
      {
        kind: 'interval',
        xLabel: '',
        xLatex: '',
        derivSymbol: sign,
        trend: isInc ? 'up' : 'down',
      },
      {
        kind: 'boundary',
        xLabel: '+∞',
        xLatex: '+\\infty',
        derivSymbol: '',
        valueLabel: hAsym.y.plain,
        valueLatex: hAsym.y.latex,
        yPositionHint: isInc ? 'high' : 'low',
      }
    );
  }

  return {
    fingerprint: analysis.fingerprint,
    functionLatex: analysis.functionLatex,
    derivativeLatex: analysis.derivativeLatex,
    columns,
  };
}

/**
 * Renders structured VariationTableModel into a crisp publication-grade static SVG
 * (compatible with web preview, Print Preview, and DOCX export).
 */
export function renderVariationTableSvg(
  model: VariationTableModel,
  options?: { width?: number; height?: number; compact?: boolean }
): string {
  const width = options?.width ?? (options?.compact ? 360 : 520);
  const height = options?.height ?? (options?.compact ? 148 : 176);
  const headerColW = options?.compact ? 48 : 60;
  const row1H = options?.compact ? 30 : 34;
  const row2H = options?.compact ? 30 : 34;
  const row3H = height - row1H - row2H;

  const cols = model.columns;
  const colW = (width - headerColW) / Math.max(1, cols.length);
  const colCenterX = (idx: number): number => headerColW + colW * (idx + 0.5);

  const yRow1Mid = row1H / 2 + 4;
  const yRow2Mid = row1H + row2H / 2 + 4;
  const yTop = row1H + row2H + 22;
  const yMid = row1H + row2H + row3H / 2 + 4;
  const yBot = height - 14;

  const yFromHint = (hint?: 'high' | 'mid' | 'low'): number =>
    hint === 'high' ? yTop : hint === 'low' ? yBot : yMid;

  const elements: string[] = [];

  // Row 1 & Row 2 cell content
  cols.forEach((col, idx) => {
    const cx = colCenterX(idx);
    if (col.xLabel) {
      elements.push(
        `<text x="${cx.toFixed(1)}" y="${yRow1Mid.toFixed(1)}" text-anchor="middle" font-size="${options?.compact ? 11 : 12}" font-weight="600" fill="#0F172A" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(col.xLabel)}</text>`
      );
    }
    if (col.derivSymbol === '||') {
      // Double vertical bar across Row 2 AND Row 3 (discontinuity / vertical asymptote)
      elements.push(
        `<line x1="${(cx - 2.5).toFixed(1)}" y1="${row1H}" x2="${(cx - 2.5).toFixed(1)}" y2="${height}" stroke="#BE123C" stroke-width="1.4"/>`,
        `<line x1="${(cx + 2.5).toFixed(1)}" y1="${row1H}" x2="${(cx + 2.5).toFixed(1)}" y2="${height}" stroke="#BE123C" stroke-width="1.4"/>`
      );
      if (col.leftLimitLabel) {
        const ly = col.leftLimitLabel === '+∞' ? yTop : yBot;
        elements.push(
          `<text x="${(cx - 8).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end" font-size="${options?.compact ? 10 : 11}" font-weight="700" fill="#BE123C" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(col.leftLimitLabel)}</text>`
        );
      }
      if (col.rightLimitLabel) {
        const ry = col.rightLimitLabel === '+∞' ? yTop : yBot;
        elements.push(
          `<text x="${(cx + 8).toFixed(1)}" y="${ry.toFixed(1)}" text-anchor="start" font-size="${options?.compact ? 10 : 11}" font-weight="700" fill="#BE123C" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(col.rightLimitLabel)}</text>`
        );
      }
    } else if (col.derivSymbol) {
      const symColor =
        col.derivSymbol === '+'
          ? '#047857'
          : col.derivSymbol === '-'
          ? '#B91C1C'
          : '#334155';
      elements.push(
        `<text x="${cx.toFixed(1)}" y="${yRow2Mid.toFixed(1)}" text-anchor="middle" font-size="${options?.compact ? 12 : 13}" font-weight="700" fill="${symColor}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(col.derivSymbol)}</text>`
      );
    }

    // Row 3 value labels (boundary or critical points — NEVER on discontinuity!)
    if (col.kind !== 'discontinuity' && col.kind !== 'interval' && col.valueLabel) {
      const vy = yFromHint(col.yPositionHint);
      const badgeColor =
        col.extremumBadge === 'CĐ'
          ? '#059669'
          : col.extremumBadge === 'CT'
          ? '#DC2626'
          : '#0F172A';
      elements.push(
        `<text x="${cx.toFixed(1)}" y="${vy.toFixed(1)}" text-anchor="middle" font-size="${options?.compact ? 10.5 : 12}" font-weight="700" fill="${badgeColor}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeSvgText(col.valueLabel)}</text>`
      );
      if (col.extremumBadge) {
        const badgeY = col.yPositionHint === 'high' ? vy + 12 : vy - 12;
        elements.push(
          `<text x="${cx.toFixed(1)}" y="${badgeY.toFixed(1)}" text-anchor="middle" font-size="${options?.compact ? 8 : 9}" font-weight="700" fill="${badgeColor}" font-family="ui-sans-serif, system-ui, sans-serif">${col.extremumBadge}</text>`
        );
      }
    }
  });

  // Row 3 arrows for each interval column
  const markerId = `arr-${model.fingerprint.replace(/[^a-zA-Z0-9]/g, '')}-${width}`;
  cols.forEach((col, idx) => {
    if (col.kind !== 'interval' || !col.trend) return;
    const leftCol = cols[idx - 1];
    const rightCol = cols[idx + 1];
    if (!leftCol || !rightCol) return;

    const x1 = colCenterX(idx - 1) + (leftCol.kind === 'discontinuity' ? 24 : 18);
    const x2 = colCenterX(idx + 1) - (rightCol.kind === 'discontinuity' ? 24 : 18);

    const startY =
      leftCol.kind === 'discontinuity'
        ? leftCol.rightLimitLabel === '+∞'
          ? yTop - 3
          : yBot - 3
        : yFromHint(leftCol.yPositionHint) - 3;

    const endY =
      rightCol.kind === 'discontinuity'
        ? rightCol.leftLimitLabel === '+∞'
          ? yTop - 3
          : yBot - 3
        : yFromHint(rightCol.yPositionHint) - 3;

    if (x2 > x1 + 8) {
      const stroke = col.trend === 'up' ? '#059669' : '#DC2626';
      elements.push(
        `<line x1="${x1.toFixed(1)}" y1="${startY.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="${stroke}" stroke-width="1.8" marker-end="url(#${markerId}-${col.trend})"/>`
      );
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Bảng biến thiên hàm số" data-graph-fingerprint="${escapeSvgText(model.fingerprint)}">
  <defs>
    <marker id="${markerId}-up" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#059669"/>
    </marker>
    <marker id="${markerId}-down" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#DC2626"/>
    </marker>
  </defs>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
  <rect x="1" y="1" width="${headerColW - 1}" height="${height - 2}" fill="#F8FAFC"/>
  <line x1="${headerColW}" y1="0" x2="${headerColW}" y2="${height}" stroke="#94A3B8" stroke-width="1.2"/>
  <line x1="0" y1="${row1H}" x2="${width}" y2="${row1H}" stroke="#94A3B8" stroke-width="1.2"/>
  <line x1="0" y1="${row1H + row2H}" x2="${width}" y2="${row1H + row2H}" stroke="#94A3B8" stroke-width="1.2"/>
  <text x="${(headerColW / 2).toFixed(1)}" y="${yRow1Mid.toFixed(1)}" text-anchor="middle" font-size="${options?.compact ? 11 : 12}" font-weight="700" font-style="italic" fill="#334155" font-family="ui-sans-serif, system-ui, sans-serif">x</text>
  <text x="${(headerColW / 2).toFixed(1)}" y="${yRow2Mid.toFixed(1)}" text-anchor="middle" font-size="${options?.compact ? 11 : 12}" font-weight="700" font-style="italic" fill="#334155" font-family="ui-sans-serif, system-ui, sans-serif">f'(x)</text>
  <text x="${(headerColW / 2).toFixed(1)}" y="${yMid.toFixed(1)}" text-anchor="middle" font-size="${options?.compact ? 11 : 12}" font-weight="700" font-style="italic" fill="#334155" font-family="ui-sans-serif, system-ui, sans-serif">f(x)</text>
  ${elements.join('\n  ')}
</svg>`;
}

/**
 * Browser-side real SVG -> PNG data URL converter for Microsoft Word compatibility.
 * Falls back cleanly to null in non-DOM (Node test) environments.
 */
export async function convertSvgToPngDataUrl(
  svgString: string,
  width = 640,
  height = 400
): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  try {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Không thể rasterize SVG sang PNG.'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      const dpr = 2;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/png');
      return dataUrl.startsWith('data:image/png;base64,') ? dataUrl : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

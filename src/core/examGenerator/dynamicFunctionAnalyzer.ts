/**
 * Dynamic Function Analyzer & Independent Symbolic Verification Engine (Phase 3)
 *
 * Pure deterministic mathematical model & analysis layer (ZERO eval(), ZERO Function(), ZERO AI API):
 * - Function Family Registry: Quadratic, Cubic, Linear-Fractional
 * - Exact Rational symbolic formatting + controlled high-precision irrational handling
 * - Derivative, Critical Point, Monotonicity, Extremum, Domain, Asymptote, Limit Analyzers
 * - Independent Verification Layer (cross-checks derivative, midpoint signs, extremum criteria, limits)
 * - Deterministic Function Fingerprint for Dynamic Content Binding
 */

import type {
  AsymptoteInfo,
  CriticalPointInfo,
  DynamicFunctionAnalysis,
  DynamicFunctionFamilyId,
  MonotonicityInterval,
  SymbolicNumberLabel,
} from '../../types/examGenerator';
import {
  addRational,
  createRational,
  divRational,
  evaluatePolynomialHorner,
  formatPolynomialLatex,
  formatRationalLatex,
  formatRationalPlain,
  mulRational,
  negRational,
  rationalToNumber,
  type Rational,
} from './verifiedMathCore';

export type DynamicFunctionSpec =
  | { family: 'quadratic'; a: number; b: number; c: number }
  | { family: 'cubic'; a: number; b: number; c: number; d: number }
  | { family: 'rational'; a: number; b: number; c: number; d: number };

export interface DynamicFunctionFamilyRegistryEntry {
  id: DynamicFunctionFamilyId;
  label: string;
  formulaPattern: string;
  gradeHint: string;
  hasAsymptotes: boolean;
  canHaveExtrema: boolean;
}

export const DYNAMIC_FUNCTION_FAMILIES: Record<
  DynamicFunctionFamilyId,
  DynamicFunctionFamilyRegistryEntry
> = {
  quadratic: {
    id: 'quadratic',
    label: 'Hàm số bậc hai f(x) = ax² + bx + c',
    formulaPattern: 'f(x) = ax² + bx + c (a ≠ 0)',
    gradeHint: 'Lớp 10 / Lớp 12',
    hasAsymptotes: false,
    canHaveExtrema: true,
  },
  cubic: {
    id: 'cubic',
    label: 'Hàm số bậc ba f(x) = ax³ + bx² + cx + d',
    formulaPattern: 'f(x) = ax³ + bx² + cx + d (a ≠ 0)',
    gradeHint: 'Lớp 12',
    hasAsymptotes: false,
    canHaveExtrema: true,
  },
  rational: {
    id: 'rational',
    label: 'Hàm phân thức bậc nhất trên bậc nhất (ax + b)/(cx + d)',
    formulaPattern: 'f(x) = (ax + b)/(cx + d) (c ≠ 0, ad − bc ≠ 0)',
    gradeHint: 'Lớp 12',
    hasAsymptotes: true,
    canHaveExtrema: false,
  },
};

function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export function computeFunctionFingerprint(
  spec: DynamicFunctionSpec,
  variantId?: string
): string {
  const canonical =
    spec.family === 'quadratic'
      ? `quadratic|a=${spec.a}|b=${spec.b}|c=${spec.c}`
      : spec.family === 'cubic'
      ? `cubic|a=${spec.a}|b=${spec.b}|c=${spec.c}|d=${spec.d}`
      : `rational|a=${spec.a}|b=${spec.b}|c=${spec.c}|d=${spec.d}`;
  const payload = variantId ? `${canonical}|v=${variantId}` : canonical;
  return `GF-${fnv1aHex(payload)}`;
}

export function rationalToSymbolicLabel(r: Rational): SymbolicNumberLabel {
  const norm = createRational(r.num, r.den);
  return {
    value: rationalToNumber(norm),
    latex: formatRationalLatex(norm),
    plain: formatRationalPlain(norm),
    isExactRational: true,
  };
}

export function numberToSymbolicLabel(val: number): SymbolicNumberLabel {
  const clean = Math.abs(val) < 1e-12 ? 0 : val;
  if (Math.abs(clean - Math.round(clean)) < 1e-9) {
    return rationalToSymbolicLabel(createRational(Math.round(clean), 1));
  }
  // Check simple denominators up to 12 for exact rational recovery
  for (let den = 2; den <= 12; den += 1) {
    const numCandidate = clean * den;
    if (Math.abs(numCandidate - Math.round(numCandidate)) < 1e-8) {
      return rationalToSymbolicLabel(createRational(Math.round(numCandidate), den));
    }
  }
  const roundedStr = Number(clean.toFixed(3)).toString();
  return {
    value: clean,
    latex: roundedStr,
    plain: roundedStr,
    isExactRational: false,
  };
}

/**
 * Exact symbolic label for quadratic root (-B ± sqrt(D)) / (2A) when D is integer > 0.
 * Never prematurely rounds coordinates before verification.
 */
function exactQuadraticRootLabel(
  numOffset: number,
  signSqrt: 1 | -1,
  radicand: number,
  den: number
): SymbolicNumberLabel {
  const rawVal = (numOffset + signSqrt * Math.sqrt(radicand)) / den;
  const intSqrt = Math.round(Math.sqrt(radicand));
  if (Number.isInteger(radicand) && intSqrt * intSqrt === radicand) {
    return rationalToSymbolicLabel(createRational(numOffset + signSqrt * intSqrt, den));
  }
  // Simplify square factor k^2 out of radicand
  let k = 1;
  let rem = Math.round(radicand);
  for (let f = 2; f * f <= rem; f += 1) {
    while (rem % (f * f) === 0) {
      k *= f;
      rem /= f * f;
    }
  }
  // Reduce fraction by gcd(|numOffset|, k, |den|)
  const gcdAll = (x: number, y: number): number => {
    let a = Math.abs(Math.trunc(x));
    let b = Math.abs(Math.trunc(y));
    while (b !== 0) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a || 1;
  };
  let nOff = Math.round(numOffset);
  let d = Math.round(den);
  let s = signSqrt;
  if (d < 0) {
    nOff = -nOff;
    s = (s === 1 ? -1 : 1) as 1 | -1;
    d = -d;
  }
  const g = gcdAll(gcdAll(nOff, k), d);
  nOff /= g;
  k /= g;
  d /= g;

  const sqrtPart = k === 1 ? `\\sqrt{${rem}}` : `${k}\\sqrt{${rem}}`;
  const numLatex =
    nOff === 0
      ? s === -1
        ? `-${sqrtPart}`
        : sqrtPart
      : s === -1
      ? `${nOff} - ${sqrtPart}`
      : `${nOff} + ${sqrtPart}`;
  const latex = d === 1 ? numLatex : `\\frac{${numLatex}}{${d}}`;
  const plain = Number(rawVal.toFixed(3)).toString();

  return {
    value: rawVal,
    latex,
    plain,
    isExactRational: false,
  };
}

function evalPolynomialRational(coeffsAsc: readonly number[], x: Rational): Rational {
  let acc = createRational(0, 1);
  for (let i = coeffsAsc.length - 1; i >= 0; i -= 1) {
    acc = addRational(mulRational(acc, x), createRational(coeffsAsc[i], 1));
  }
  return acc;
}

export function formatLinearFactorLatex(c: number, d: number): string {
  return formatPolynomialLatex([d, c], 'x');
}

export function formatFunctionLatex(spec: DynamicFunctionSpec): string {
  if (spec.family === 'quadratic') {
    return formatPolynomialLatex([spec.c, spec.b, spec.a], 'x');
  }
  if (spec.family === 'cubic') {
    return formatPolynomialLatex([spec.d, spec.c, spec.b, spec.a], 'x');
  }
  const num = formatLinearFactorLatex(spec.a, spec.b);
  const den = formatLinearFactorLatex(spec.c, spec.d);
  return `\\frac{${num}}{${den}}`;
}

export function formatDerivativeLatex(spec: DynamicFunctionSpec): string {
  if (spec.family === 'quadratic') {
    return formatPolynomialLatex([spec.b, 2 * spec.a], 'x');
  }
  if (spec.family === 'cubic') {
    return formatPolynomialLatex([spec.c, 2 * spec.b, 3 * spec.a], 'x');
  }
  const det = spec.a * spec.d - spec.b * spec.c;
  const den = formatLinearFactorLatex(spec.c, spec.d);
  return `\\frac{${det}}{(${den})^{2}}`;
}

/**
 * Pure numeric evaluation with strict domain safety (returns null at pole or non-finite).
 */
export function evaluateFunction(spec: DynamicFunctionSpec, x: number): number | null {
  if (!Number.isFinite(x)) return null;
  if (spec.family === 'quadratic') {
    const val = evaluatePolynomialHorner([spec.c, spec.b, spec.a], x);
    return Number.isFinite(val) ? val : null;
  }
  if (spec.family === 'cubic') {
    const val = evaluatePolynomialHorner([spec.d, spec.c, spec.b, spec.a], x);
    return Number.isFinite(val) ? val : null;
  }
  const den = spec.c * x + spec.d;
  if (Math.abs(den) < 1e-10) return null;
  const val = (spec.a * x + spec.b) / den;
  return Number.isFinite(val) ? val : null;
}

export function evaluateDerivative(spec: DynamicFunctionSpec, x: number): number | null {
  if (!Number.isFinite(x)) return null;
  if (spec.family === 'quadratic') {
    return 2 * spec.a * x + spec.b;
  }
  if (spec.family === 'cubic') {
    return 3 * spec.a * x * x + 2 * spec.b * x + spec.c;
  }
  const den = spec.c * x + spec.d;
  if (Math.abs(den) < 1e-10) return null;
  const det = spec.a * spec.d - spec.b * spec.c;
  return det / (den * den);
}

function makeInterval(
  fromLatex: string,
  toLatex: string,
  fromValue: number | null,
  toValue: number | null,
  sign: '+' | '-'
): MonotonicityInterval {
  return {
    fromLatex,
    toLatex,
    fromValue,
    toValue,
    sign,
    trend: sign === '+' ? 'increasing' : 'decreasing',
    latex: `(${fromLatex}; ${toLatex})`,
  };
}

/**
 * FAMILY 1: QUADRATIC FUNCTION f(x) = ax² + bx + c (a ≠ 0)
 */
export function analyzeQuadraticFunction(
  a: number,
  b: number,
  c: number,
  variantId?: string
): DynamicFunctionAnalysis {
  const spec: DynamicFunctionSpec = { family: 'quadratic', a, b, c };
  const fingerprint = computeFunctionFingerprint(spec, variantId);
  const errors: string[] = [];

  if (!Number.isFinite(a) || Math.abs(a) <= 1e-12) {
    errors.push('Hệ số a = 0: không phải hàm số bậc hai.');
    return {
      family: 'quadratic',
      params: { a, b, c },
      fingerprint,
      functionLatex: formatFunctionLatex(spec),
      derivativeLatex: formatDerivativeLatex(spec),
      domainLatex: '\\mathbb{R}',
      criticalPoints: [],
      extrema: [],
      monotonicityIntervals: [],
      asymptotes: {},
      xIntercepts: [],
      limitNegInf: '+∞',
      limitPosInf: '+∞',
      verificationPassed: false,
      verificationProof: errors[0],
      verificationErrors: errors,
    };
  }

  const x0Rat = createRational(-b, 2 * a);
  const y0Rat = evalPolynomialRational([c, b, a], x0Rat);
  const x0Label = rationalToSymbolicLabel(x0Rat);
  const y0Label = rationalToSymbolicLabel(y0Rat);

  const isUp = a > 0;
  const leftSign: '+' | '-' = isUp ? '-' : '+';
  const rightSign: '+' | '-' = isUp ? '+' : '-';

  const monotonicityIntervals: MonotonicityInterval[] = [
    makeInterval('-\\infty', x0Label.latex, null, x0Label.value, leftSign),
    makeInterval(x0Label.latex, '+\\infty', x0Label.value, null, rightSign),
  ];

  const vertexPoint: CriticalPointInfo = {
    x: x0Label,
    y: y0Label,
    kind: isUp ? 'local-min' : 'local-max',
    isExtremum: true,
  };

  // Real x-intercepts
  const disc = b * b - 4 * a * c;
  const xIntercepts: SymbolicNumberLabel[] = [];
  if (Math.abs(disc) <= 1e-12) {
    xIntercepts.push(x0Label);
  } else if (disc > 1e-12) {
    const r1 = exactQuadraticRootLabel(-b, -1, disc, 2 * a);
    const r2 = exactQuadraticRootLabel(-b, 1, disc, 2 * a);
    xIntercepts.push(...[r1, r2].sort((p, q) => p.value - q.value));
  }

  const analysis: DynamicFunctionAnalysis = {
    family: 'quadratic',
    params: { a, b, c },
    fingerprint,
    functionLatex: formatFunctionLatex(spec),
    derivativeLatex: formatDerivativeLatex(spec),
    domainLatex: '\\mathbb{R}',
    vertex: {
      x: x0Label,
      y: y0Label,
      axisLatex: `x = ${x0Label.latex}`,
    },
    criticalPoints: [vertexPoint],
    extrema: [vertexPoint],
    monotonicityIntervals,
    asymptotes: {},
    yIntercept: { x: 0, y: rationalToSymbolicLabel(createRational(c, 1)) },
    xIntercepts,
    limitNegInf: isUp ? '+∞' : '-∞',
    limitPosInf: isUp ? '+∞' : '-∞',
    verificationPassed: false,
    verificationProof: '',
    verificationErrors: [],
  };

  const verify = verifyDynamicFunctionAnalysis(spec, analysis);
  analysis.verificationPassed = verify.valid;
  analysis.verificationProof = verify.proofText;
  analysis.verificationErrors = verify.errors;
  return analysis;
}

/**
 * FAMILY 2: CUBIC FUNCTION f(x) = ax³ + bx² + cx + d (a ≠ 0)
 * Handles all 3 exact derivative cases:
 *  A. Δ' > 0 -> 2 distinct extrema
 *  B. Δ' = 0 -> double root (stationary inflection point, NOT an extremum!)
 *  C. Δ' < 0 -> no real critical points (strictly monotonic on R)
 */
export function analyzeCubicFunction(
  a: number,
  b: number,
  c: number,
  d: number,
  variantId?: string
): DynamicFunctionAnalysis {
  const spec: DynamicFunctionSpec = { family: 'cubic', a, b, c, d };
  const fingerprint = computeFunctionFingerprint(spec, variantId);

  if (!Number.isFinite(a) || Math.abs(a) <= 1e-12) {
    const msg = 'Hệ số a = 0: không phải hàm số bậc ba.';
    return {
      family: 'cubic',
      params: { a, b, c, d },
      fingerprint,
      functionLatex: formatFunctionLatex(spec),
      derivativeLatex: formatDerivativeLatex(spec),
      domainLatex: '\\mathbb{R}',
      criticalPoints: [],
      extrema: [],
      monotonicityIntervals: [],
      asymptotes: {},
      xIntercepts: [],
      limitNegInf: '-∞',
      limitPosInf: '+∞',
      verificationPassed: false,
      verificationProof: msg,
      verificationErrors: [msg],
    };
  }

  // f'(x) = 3ax² + 2bx + c  =>  Delta' = b² - 3ac
  const deltaPrime = b * b - 3 * a * c;
  const aPos = a > 0;
  const outerSign: '+' | '-' = aPos ? '+' : '-';
  const innerSign: '+' | '-' = aPos ? '-' : '+';

  const criticalPoints: CriticalPointInfo[] = [];
  const extrema: CriticalPointInfo[] = [];
  const monotonicityIntervals: MonotonicityInterval[] = [];
  let cubicCase: 'two-extrema' | 'double-root' | 'no-extrema';

  if (deltaPrime > 1e-9) {
    cubicCase = 'two-extrema';
    const raw1 = exactQuadraticRootLabel(-b, -1, deltaPrime, 3 * a);
    const raw2 = exactQuadraticRootLabel(-b, 1, deltaPrime, 3 * a);
    const [x1, x2] = [raw1, raw2].sort((p, q) => p.value - q.value);

    const evalY = (xLbl: SymbolicNumberLabel): SymbolicNumberLabel => {
      if (xLbl.isExactRational) {
        const rat = xLbl.plain.includes('/')
          ? createRational(
              Number(xLbl.plain.split('/')[0]),
              Number(xLbl.plain.split('/')[1])
            )
          : createRational(Number(xLbl.plain), 1);
        return rationalToSymbolicLabel(evalPolynomialRational([d, c, b, a], rat));
      }
      const val = evaluatePolynomialHorner([d, c, b, a], xLbl.value);
      return numberToSymbolicLabel(val);
    };

    const y1 = evalY(x1);
    const y2 = evalY(x2);

    // If a > 0: + | 0 | - | 0 | +  => x1 is local-max, x2 is local-min
    // If a < 0: - | 0 | + | 0 | -  => x1 is local-min, x2 is local-max
    const p1: CriticalPointInfo = {
      x: x1,
      y: y1,
      kind: aPos ? 'local-max' : 'local-min',
      isExtremum: true,
    };
    const p2: CriticalPointInfo = {
      x: x2,
      y: y2,
      kind: aPos ? 'local-min' : 'local-max',
      isExtremum: true,
    };

    criticalPoints.push(p1, p2);
    extrema.push(p1, p2);

    monotonicityIntervals.push(
      makeInterval('-\\infty', x1.latex, null, x1.value, outerSign),
      makeInterval(x1.latex, x2.latex, x1.value, x2.value, innerSign),
      makeInterval(x2.latex, '+\\infty', x2.value, null, outerSign)
    );
  } else if (Math.abs(deltaPrime) <= 1e-9) {
    cubicCase = 'double-root';
    const x0Rat = createRational(-b, 3 * a);
    const y0Rat = evalPolynomialRational([d, c, b, a], x0Rat);
    const x0 = rationalToSymbolicLabel(x0Rat);
    const y0 = rationalToSymbolicLabel(y0Rat);

    // Stationary point where f'(x) touches 0 without changing sign -> NOT an extremum!
    criticalPoints.push({
      x: x0,
      y: y0,
      kind: 'stationary-inflection',
      isExtremum: false,
    });
    monotonicityIntervals.push(
      makeInterval('-\\infty', '+\\infty', null, null, outerSign)
    );
  } else {
    cubicCase = 'no-extrema';
    monotonicityIntervals.push(
      makeInterval('-\\infty', '+\\infty', null, null, outerSign)
    );
  }

  const analysis: DynamicFunctionAnalysis = {
    family: 'cubic',
    params: { a, b, c, d },
    fingerprint,
    functionLatex: formatFunctionLatex(spec),
    derivativeLatex: formatDerivativeLatex(spec),
    domainLatex: '\\mathbb{R}',
    cubicCase,
    criticalPoints,
    extrema,
    monotonicityIntervals,
    asymptotes: {},
    yIntercept: { x: 0, y: rationalToSymbolicLabel(createRational(d, 1)) },
    xIntercepts: [],
    limitNegInf: aPos ? '-∞' : '+∞',
    limitPosInf: aPos ? '+∞' : '-∞',
    verificationPassed: false,
    verificationProof: '',
    verificationErrors: [],
  };

  const verify = verifyDynamicFunctionAnalysis(spec, analysis);
  analysis.verificationPassed = verify.valid;
  analysis.verificationProof = verify.proofText;
  analysis.verificationErrors = verify.errors;
  return analysis;
}

/**
 * FAMILY 3: LINEAR-FRACTIONAL FUNCTION f(x) = (ax + b)/(cx + d)
 * Requires c ≠ 0 and ad - bc ≠ 0.
 */
export function analyzeRationalFunction(
  a: number,
  b: number,
  c: number,
  d: number,
  variantId?: string
): DynamicFunctionAnalysis {
  const spec: DynamicFunctionSpec = { family: 'rational', a, b, c, d };
  const fingerprint = computeFunctionFingerprint(spec, variantId);
  const det = a * d - b * c;

  if (!Number.isFinite(c) || Math.abs(c) <= 1e-12 || Math.abs(det) <= 1e-12) {
    const msg =
      Math.abs(c) <= 1e-12
        ? 'Hệ số c = 0: mẫu thức là hằng số (không phải hàm phân thức bậc nhất/bậc nhất).'
        : `Định thức ad - bc = ${det} = 0: hàm suy biến thành hàm hằng.`;
    return {
      family: 'rational',
      params: { a, b, c, d },
      fingerprint,
      functionLatex: formatFunctionLatex(spec),
      derivativeLatex: formatDerivativeLatex(spec),
      domainLatex: '\\mathbb{R}',
      criticalPoints: [],
      extrema: [],
      monotonicityIntervals: [],
      asymptotes: {},
      xIntercepts: [],
      limitNegInf: '0',
      limitPosInf: '0',
      verificationPassed: false,
      verificationProof: msg,
      verificationErrors: [msg],
    };
  }

  const poleRat = createRational(-d, c);
  const horizRat = createRational(a, c);
  const poleLbl = rationalToSymbolicLabel(poleRat);
  const horizLbl = rationalToSymbolicLabel(horizRat);

  const derivSign: '+' | '-' = det > 0 ? '+' : '-';

  // One-sided limits at vertical asymptote x -> pole- and x -> pole+:
  // Since f'(x) = det / (cx+d)^2:
  //   if det > 0 (increasing on each branch): as x -> pole-, f(x) -> +∞; as x -> pole+, f(x) -> -∞
  //   if det < 0 (decreasing on each branch): as x -> pole-, f(x) -> -∞; as x -> pole+, f(x) -> +∞
  const leftLimit: '+∞' | '-∞' = det > 0 ? '+∞' : '-∞';
  const rightLimit: '+∞' | '-∞' = det > 0 ? '-∞' : '+∞';

  const asymptotes: AsymptoteInfo = {
    vertical: {
      x: poleLbl,
      equationLatex: `x = ${poleLbl.latex}`,
      leftLimit,
      rightLimit,
    },
    horizontal: {
      y: horizLbl,
      equationLatex: `y = ${horizLbl.latex}`,
    },
  };

  // STRICT: two separate monotonicity intervals, NEVER merged across pole!
  const monotonicityIntervals: MonotonicityInterval[] = [
    makeInterval('-\\infty', poleLbl.latex, null, poleLbl.value, derivSign),
    makeInterval(poleLbl.latex, '+\\infty', poleLbl.value, null, derivSign),
  ];

  // Intercepts (guarded against pole)
  const yIntercept =
    Math.abs(d) > 1e-12
      ? { x: 0, y: rationalToSymbolicLabel(createRational(b, d)) }
      : undefined;

  const xIntercepts: SymbolicNumberLabel[] = [];
  if (Math.abs(a) > 1e-12) {
    const xRootRat = createRational(-b, a);
    if (Math.abs(rationalToNumber(xRootRat) - poleLbl.value) > 1e-9) {
      xIntercepts.push(rationalToSymbolicLabel(xRootRat));
    }
  }

  const analysis: DynamicFunctionAnalysis = {
    family: 'rational',
    params: { a, b, c, d },
    fingerprint,
    functionLatex: formatFunctionLatex(spec),
    derivativeLatex: formatDerivativeLatex(spec),
    domainLatex: `\\mathbb{R} \\setminus \\{${poleLbl.latex}\\}`,
    excludedPoint: poleLbl,
    criticalPoints: [],
    extrema: [],
    monotonicityIntervals,
    asymptotes,
    yIntercept,
    xIntercepts,
    limitNegInf: horizLbl.plain,
    limitPosInf: horizLbl.plain,
    verificationPassed: false,
    verificationProof: '',
    verificationErrors: [],
  };

  const verify = verifyDynamicFunctionAnalysis(spec, analysis);
  analysis.verificationPassed = verify.valid;
  analysis.verificationProof = verify.proofText;
  analysis.verificationErrors = verify.errors;
  return analysis;
}

export function analyzeDynamicFunction(
  spec: DynamicFunctionSpec,
  variantId?: string
): DynamicFunctionAnalysis {
  if (spec.family === 'quadratic') {
    return analyzeQuadraticFunction(spec.a, spec.b, spec.c, variantId);
  }
  if (spec.family === 'cubic') {
    return analyzeCubicFunction(spec.a, spec.b, spec.c, spec.d, variantId);
  }
  return analyzeRationalFunction(spec.a, spec.b, spec.c, spec.d, variantId);
}

/**
 * Independent Mathematical Verification Layer (§XIII)
 * Cross-checks derivative, vertex/critical points, midpoint monotonicity signs,
 * extremum sign-change criteria (preventing fake extrema), asymptotes, and one-sided limits.
 */
export function verifyDynamicFunctionAnalysis(
  spec: DynamicFunctionSpec,
  analysis: DynamicFunctionAnalysis
): { valid: boolean; errors: string[]; proofText: string } {
  const errors: string[] = [];

  // 1. Check midpoint derivative sign on every monotonicity interval
  for (const iv of analysis.monotonicityIntervals) {
    let testX: number;
    if (iv.fromValue === null && iv.toValue === null) {
      testX = 0.37;
    } else if (iv.fromValue === null && iv.toValue !== null) {
      testX = iv.toValue - 1.5;
    } else if (iv.fromValue !== null && iv.toValue === null) {
      testX = iv.fromValue + 1.5;
    } else {
      testX = ((iv.fromValue ?? 0) + (iv.toValue ?? 0)) / 2;
    }

    const dVal = evaluateDerivative(spec, testX);
    if (dVal === null || !Number.isFinite(dVal)) {
      errors.push(`Không thể tính f'(${testX}) trên khoảng ${iv.latex}.`);
      continue;
    }
    if (iv.sign === '+' && dVal <= 0) {
      errors.push(`Sai dấu đạo hàm trên ${iv.latex}: kỳ vọng > 0 nhưng f'(${testX}) = ${dVal}.`);
    }
    if (iv.sign === '-' && dVal >= 0) {
      errors.push(`Sai dấu đạo hàm trên ${iv.latex}: kỳ vọng < 0 nhưng f'(${testX}) = ${dVal}.`);
    }
  }

  // 2. Family-specific independent checks
  if (spec.family === 'quadratic') {
    if (Math.abs(spec.a) <= 1e-12) {
      errors.push('Hệ số a = 0.');
    }
    if (!analysis.vertex) {
      errors.push('Thiếu tọa độ đỉnh parabol.');
    } else {
      const xv = -spec.b / (2 * spec.a);
      const yv = spec.a * xv * xv + spec.b * xv + spec.c;
      if (Math.abs(analysis.vertex.x.value - xv) > 1e-7) {
        errors.push(`Sai hoành độ đỉnh: ${analysis.vertex.x.value} ≠ ${xv}.`);
      }
      if (Math.abs(analysis.vertex.y.value - yv) > 1e-7) {
        errors.push(`Sai tung độ đỉnh: ${analysis.vertex.y.value} ≠ ${yv}.`);
      }
      const dAtVertex = evaluateDerivative(spec, xv);
      if (dAtVertex === null || Math.abs(dAtVertex) > 1e-7) {
        errors.push(`Đạo hàm tại đỉnh khác 0: f'(${xv}) = ${dAtVertex}.`);
      }
      const expectedKind = spec.a > 0 ? 'local-min' : 'local-max';
      if (analysis.extrema.length !== 1 || analysis.extrema[0].kind !== expectedKind) {
        errors.push('Phân loại cực trị parabol không khớp dấu hệ số a.');
      }
    }
  } else if (spec.family === 'cubic') {
    if (Math.abs(spec.a) <= 1e-12) {
      errors.push('Hệ số a = 0.');
    }
    // Verify every critical point satisfies f'(x) = 0 and sign-change extremum rule
    for (const cp of analysis.criticalPoints) {
      const dAtCp = evaluateDerivative(spec, cp.x.value);
      if (dAtCp === null || Math.abs(dAtCp) > 1e-5) {
        errors.push(`Điểm tới hạn x = ${cp.x.plain} không thỏa f'(x) = 0.`);
      }
      const yCheck = evaluateFunction(spec, cp.x.value);
      if (yCheck === null || Math.abs(yCheck - cp.y.value) > 1e-5) {
        errors.push(`Tung độ f(${cp.x.plain}) không khớp.`);
      }
      const eps = 1e-3;
      const dLeft = evaluateDerivative(spec, cp.x.value - eps) ?? 0;
      const dRight = evaluateDerivative(spec, cp.x.value + eps) ?? 0;
      const changesSign = dLeft * dRight < 0;
      if (cp.isExtremum && !changesSign) {
        errors.push(`Phát hiện cực trị giả tại x = ${cp.x.plain} (đạo hàm không đổi dấu).`);
      }
      if (!cp.isExtremum && changesSign) {
        errors.push(`Bỏ sót cực trị tại x = ${cp.x.plain} (đạo hàm đổi dấu).`);
      }
      if (cp.kind === 'local-max' && !(dLeft > 0 && dRight < 0)) {
        errors.push(`Sai loại cực đại tại x = ${cp.x.plain}.`);
      }
      if (cp.kind === 'local-min' && !(dLeft < 0 && dRight > 0)) {
        errors.push(`Sai loại cực tiểu tại x = ${cp.x.plain}.`);
      }
    }
    // Check limits at ±∞
    const expectedNeg = spec.a > 0 ? '-∞' : '+∞';
    const expectedPos = spec.a > 0 ? '+∞' : '-∞';
    if (analysis.limitNegInf !== expectedNeg || analysis.limitPosInf !== expectedPos) {
      errors.push('Giới hạn tại ±∞ của hàm bậc ba không khớp dấu hệ số a.');
    }
  } else if (spec.family === 'rational') {
    const det = spec.a * spec.d - spec.b * spec.c;
    if (Math.abs(spec.c) <= 1e-12 || Math.abs(det) <= 1e-12) {
      errors.push('Hàm phân thức suy biến (c = 0 hoặc ad - bc = 0).');
    } else {
      const pole = -spec.d / spec.c;
      const horiz = spec.a / spec.c;
      if (!analysis.asymptotes.vertical || Math.abs(analysis.asymptotes.vertical.x.value - pole) > 1e-7) {
        errors.push('Sai phương trình tiệm cận đứng.');
      }
      if (!analysis.asymptotes.horizontal || Math.abs(analysis.asymptotes.horizontal.y.value - horiz) > 1e-7) {
        errors.push('Sai phương trình tiệm cận ngang.');
      }
      if (analysis.extrema.length > 0) {
        errors.push('Hàm phân thức bậc nhất/bậc nhất không có cực trị.');
      }
      // Verify one-sided limits numerically near pole
      const eps = 1e-4;
      const valLeft = evaluateFunction(spec, pole - eps);
      const valRight = evaluateFunction(spec, pole + eps);
      if (valLeft === null || valRight === null) {
        errors.push('Không tính được giới hạn một phía quanh tiệm cận đứng.');
      } else {
        const expectedLeft = valLeft > 0 ? '+∞' : '-∞';
        const expectedRight = valRight > 0 ? '+∞' : '-∞';
        if (analysis.asymptotes.vertical?.leftLimit !== expectedLeft) {
          errors.push(`Sai giới hạn trái tại x = ${pole}: kỳ vọng ${expectedLeft}.`);
        }
        if (analysis.asymptotes.vertical?.rightLimit !== expectedRight) {
          errors.push(`Sai giới hạn phải tại x = ${pole}: kỳ vọng ${expectedRight}.`);
        }
      }
      // Verify horizontal asymptote via large |x|
      const farVal = evaluateFunction(spec, pole + 1e5);
      if (farVal === null || Math.abs(farVal - horiz) > 1e-2) {
        errors.push('Giá trị giới hạn tại vô cực không hội tụ về tiệm cận ngang.');
      }
      // Verify domain split into 2 intervals
      if (analysis.monotonicityIntervals.length !== 2) {
        errors.push('Khoảng đơn điệu hàm phân thức phải tách thành 2 khoảng qua tiệm cận đứng.');
      }
    }
  }

  const proofText =
    errors.length === 0
      ? spec.family === 'quadratic'
        ? `Kiểm chứng độc lập hàm bậc hai: a = ${spec.a} ≠ 0; đỉnh I(${analysis.vertex?.x.plain}; ${analysis.vertex?.y.plain}), f'(x₀) = 0; dấu f'(x) hai phía đỉnh & loại cực trị khớp 100%.`
        : spec.family === 'cubic'
        ? `Kiểm chứng độc lập hàm bậc ba (${analysis.cubicCase}): f'(x) = ${analysis.derivativeLatex}; kiểm tra nghiệm đạo hàm, đổi dấu hai phía & giới hạn ±∞ đạt 100%.`
        : `Kiểm chứng độc lập hàm phân thức: D = ad − bc = ${spec.a * spec.d - spec.b * spec.c} ≠ 0; TCĐ ${analysis.asymptotes.vertical?.equationLatex}, TCN ${analysis.asymptotes.horizontal?.equationLatex}; giới hạn một phía (${analysis.asymptotes.vertical?.leftLimit} / ${analysis.asymptotes.vertical?.rightLimit}) & 2 khoảng đơn điệu đạt 100%.`
      : errors.join(' ');

  return {
    valid: errors.length === 0,
    errors,
    proofText,
  };
}

// Re-export rational helper for sibling Phase 3 modules
export { addRational, createRational, divRational, mulRational, negRational };

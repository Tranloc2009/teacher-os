/**
 * Verified Math Core (Phase 2 — Smart Exam Generator 2.1)
 *
 * Pure deterministic mathematical utilities with ZERO eval() / Function():
 * - Exact Rational arithmetic & reduction (e.g., 2/4 === 1/2)
 * - Canonical Polynomial representation, differentiation, Horner evaluation & equivalence
 * - Independent Quadratic Equation verifier (Delta + substitution + Viète)
 * - Independent Linear System 2x2 solver (Cramer exact rational + Gaussian elimination + substitution)
 * - Independent Polynomial Derivative verifier (term-by-term power rule + Horner + auxiliary central difference)
 * - Mathematical Answer Normalizer & Equivalent Answer Detector
 */

export interface Rational {
  readonly num: number;
  readonly den: number;
}

export function gcdInt(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0 ? 1 : x;
}

export function createRational(num: number, den = 1): Rational {
  if (!Number.isFinite(num) || !Number.isFinite(den)) {
    throw new Error('Rational requires finite numbers.');
  }
  if (Math.abs(den) <= 1e-12) {
    throw new Error('Rational denominator cannot be zero.');
  }
  let n = num;
  let d = den;
  // Promote finite decimals cleanly to integers when needed (up to 6 decimal places)
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    const scale = 1_000_000;
    n = Math.round(n * scale);
    d = Math.round(d * scale);
  }
  if (d < 0) {
    n = -n;
    d = -d;
  }
  if (n === 0) {
    return { num: 0, den: 1 };
  }
  const g = gcdInt(n, d);
  return { num: n / g, den: d / g };
}

export function addRational(a: Rational, b: Rational): Rational {
  return createRational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function subRational(a: Rational, b: Rational): Rational {
  return createRational(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mulRational(a: Rational, b: Rational): Rational {
  return createRational(a.num * b.num, a.den * b.den);
}

export function divRational(a: Rational, b: Rational): Rational {
  if (b.num === 0) {
    throw new Error('Division by zero rational.');
  }
  return createRational(a.num * b.den, a.den * b.num);
}

export function negRational(a: Rational): Rational {
  return { num: a.num === 0 ? 0 : -a.num, den: a.den };
}

export function rationalsEqual(a: Rational, b: Rational): boolean {
  return a.num === b.num && a.den === b.den;
}

export function rationalToNumber(r: Rational): number {
  return r.num / r.den;
}

export function formatRationalLatex(r: Rational): string {
  const n = createRational(r.num, r.den);
  if (n.den === 1) return String(n.num);
  if (n.num < 0) {
    return `-\\frac{${Math.abs(n.num)}}{${n.den}}`;
  }
  return `\\frac{${n.num}}{${n.den}}`;
}

export function formatRationalPlain(r: Rational): string {
  const n = createRational(r.num, r.den);
  if (n.den === 1) return String(n.num);
  return `${n.num}/${n.den}`;
}

export function parseRationalToken(raw: string): Rational | null {
  const s = raw
    .replace(/\$/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\,/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!s) return null;

  // Match LaTeX fraction: -?\frac{num}{den}
  const latexFrac = /^([+-]?)\\frac\{([+-]?\d+)\}\{([+-]?\d+)\}$/.exec(s);
  if (latexFrac) {
    const sign = latexFrac[1] === '-' ? -1 : 1;
    const num = Number(latexFrac[2]) * sign;
    const den = Number(latexFrac[3]);
    if (den === 0) return null;
    return createRational(num, den);
  }

  // Match plain fraction: a/b
  const plainFrac = /^([+-]?\d+)\/([+-]?\d+)$/.exec(s);
  if (plainFrac) {
    const num = Number(plainFrac[1]);
    const den = Number(plainFrac[2]);
    if (den === 0) return null;
    return createRational(num, den);
  }

  // Match integer or decimal (supporting Vietnamese comma decimal)
  const normalizedDec = s.replace(',', '.');
  if (/^[+-]?\d+(\.\d+)?$/.test(normalizedDec)) {
    const val = Number(normalizedDec);
    if (!Number.isFinite(val)) return null;
    return createRational(val, 1);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Polynomial Operations (coeffs[k] = coefficient of x^k)
// ---------------------------------------------------------------------------

export function normalizePolynomial(coeffs: readonly number[]): number[] {
  const out = coeffs.map((c) => {
    const clean = Math.abs(c) < 1e-12 ? 0 : c;
    return Object.is(clean, -0) ? 0 : clean;
  });
  while (out.length > 1 && out[out.length - 1] === 0) {
    out.pop();
  }
  return out.length === 0 ? [0] : out;
}

export function polynomialDegree(coeffs: readonly number[]): number {
  const norm = normalizePolynomial(coeffs);
  if (norm.length === 1 && norm[0] === 0) return 0;
  return norm.length - 1;
}

export function polynomialsEqual(
  a: readonly number[],
  b: readonly number[],
  tolerance = 1e-9
): boolean {
  const na = normalizePolynomial(a);
  const nb = normalizePolynomial(b);
  if (na.length !== nb.length) return false;
  for (let i = 0; i < na.length; i += 1) {
    if (Math.abs(na[i] - nb[i]) > tolerance) return false;
  }
  return true;
}

/**
 * Exact power-rule derivative: d/dx (sum a_k x^k) = sum_{k>=1} (k * a_k) x^{k-1}
 */
export function differentiatePolynomial(coeffs: readonly number[]): number[] {
  const norm = normalizePolynomial(coeffs);
  if (norm.length <= 1) return [0];
  const deriv: number[] = [];
  for (let k = 1; k < norm.length; k += 1) {
    deriv.push(k * norm[k]);
  }
  return normalizePolynomial(deriv);
}

/**
 * Direct sum evaluation: sum a_k * x^k
 */
export function evaluatePolynomialDirect(
  coeffs: readonly number[],
  x: number
): number {
  const norm = normalizePolynomial(coeffs);
  let sum = 0;
  let xPow = 1;
  for (let k = 0; k < norm.length; k += 1) {
    sum += norm[k] * xPow;
    xPow *= x;
  }
  return sum;
}

/**
 * Independent Horner's method evaluation.
 */
export function evaluatePolynomialHorner(
  coeffs: readonly number[],
  x: number
): number {
  const norm = normalizePolynomial(coeffs);
  let acc = 0;
  for (let k = norm.length - 1; k >= 0; k -= 1) {
    acc = acc * x + norm[k];
  }
  return acc;
}

/**
 * Auxiliary numerical central difference check for derivative (NEVER used as sole proof).
 */
export function numericalCentralDifference(
  coeffs: readonly number[],
  x0: number,
  h = 1e-5
): number {
  const fPlus = evaluatePolynomialHorner(coeffs, x0 + h);
  const fMinus = evaluatePolynomialHorner(coeffs, x0 - h);
  return (fPlus - fMinus) / (2 * h);
}

/**
 * Canonical LaTeX formatting for a polynomial (omits zero terms, clean signs, no "1x").
 */
export function formatPolynomialLatex(
  coeffs: readonly number[],
  variable = 'x'
): string {
  const norm = normalizePolynomial(coeffs);
  const parts: string[] = [];

  for (let k = norm.length - 1; k >= 0; k -= 1) {
    const c = norm[k];
    if (Math.abs(c) < 1e-12) continue;

    const isNegative = c < 0;
    const absC = Math.abs(c);
    const absStr = Number.isInteger(absC) ? String(absC) : String(Number(absC.toFixed(4)));

    let termCore = '';
    if (k === 0) {
      termCore = absStr;
    } else if (k === 1) {
      termCore = absC === 1 ? variable : `${absStr}${variable}`;
    } else {
      termCore = absC === 1 ? `${variable}^{${k}}` : `${absStr}${variable}^{${k}}`;
    }

    if (parts.length === 0) {
      parts.push(isNegative ? `-${termCore}` : termCore);
    } else {
      parts.push(isNegative ? ` - ${termCore}` : ` + ${termCore}`);
    }
  }

  return parts.length === 0 ? '0' : parts.join('');
}

export function polynomialCanonicalKey(coeffs: readonly number[]): string {
  const norm = normalizePolynomial(coeffs);
  return `POLY:[${norm.map((c) => createRational(c, 1)).map(formatRationalPlain).join(',')}]`;
}

/**
 * Parses a polynomial expression in x (e.g. "2x + 3x", "9x^2 - 4x + 5", "-x^{3} + 7")
 * into canonical coefficient array WITHOUT eval/Function.
 * Returns null if the expression is not a supported polynomial.
 */
export function parseSimplePolynomial(raw: string, variable = 'x'): number[] | null {
  let s = raw
    .replace(/\$/g, '')
    .replace(/\\cdot/g, '')
    .replace(/\*/g, '')
    .replace(/−/g, '-')
    .replace(/\s+/g, '')
    .trim();

  // Strip optional leading "f'(x)=" or "y'=" or "f(x)="
  s = s.replace(/^[a-zA-Z]'?(?:\([a-zA-Z]\))?=/, '');
  if (!s) return null;

  // Normalize "+-" or "--"
  s = s.replace(/\+-/g, '-').replace(/--/g, '+');
  if (s[0] !== '+' && s[0] !== '-') {
    s = `+${s}`;
  }

  const termRegex = new RegExp(
    `([+-])(?:(\\d+(?:\\.\\d+)?))?(?:${variable}(?:\\^(?:\\{(\\d+)\\}|(\\d+)))?)?`,
    'g'
  );

  const coeffMap = new Map<number, number>();
  let matchedLen = 0;
  let match: RegExpExecArray | null;

  while ((match = termRegex.exec(s)) !== null) {
    if (match[0].length === 1) {
      // Only a bare sign matched with empty body -> invalid
      return null;
    }
    matchedLen += match[0].length;
    const sign = match[1] === '-' ? -1 : 1;
    const numStr = match[2];
    const hasVar = match[0].includes(variable);
    const expStr = match[3] ?? match[4];

    if (!numStr && !hasVar) return null;

    const coeff = (numStr ? Number(numStr) : 1) * sign;
    if (!Number.isFinite(coeff)) return null;

    const deg = hasVar ? (expStr !== undefined ? Number(expStr) : 1) : 0;
    if (!Number.isInteger(deg) || deg < 0 || deg > 12) return null;

    coeffMap.set(deg, (coeffMap.get(deg) ?? 0) + coeff);
  }

  if (matchedLen !== s.length || coeffMap.size === 0) {
    return null;
  }

  const maxDeg = Math.max(...Array.from(coeffMap.keys()));
  const coeffs = Array.from({ length: maxDeg + 1 }, (_, k) => coeffMap.get(k) ?? 0);
  return normalizePolynomial(coeffs);
}

// ---------------------------------------------------------------------------
// Independent Mathematical Verifiers (Quadratic, Linear System 2x2, Derivative)
// ---------------------------------------------------------------------------

export interface QuadraticVerificationResult {
  valid: boolean;
  discriminant: number;
  rootKind: 'two-distinct' | 'double-root' | 'invalid';
  sortedRoots: number[];
  vieteSumOk: boolean;
  vieteProductOk: boolean;
  substitutionOk: boolean;
  proofText: string;
  errors: string[];
}

export function verifyQuadraticEquation(
  a: number,
  b: number,
  c: number,
  r1: number,
  r2: number
): QuadraticVerificationResult {
  const errors: string[] = [];

  if (!Number.isFinite(a) || Math.abs(a) <= 1e-12) {
    errors.push('Hệ số bậc hai a = 0 (không phải phương trình bậc hai).');
  }

  const delta = b * b - 4 * a * c;
  if (delta < -1e-9) {
    errors.push(`Biệt thức Δ = ${delta} < 0 (vô nghiệm thực).`);
  }

  // Independent back-substitution for both roots
  const eval1 = a * r1 * r1 + b * r1 + c;
  const eval2 = a * r2 * r2 + b * r2 + c;
  const substitutionOk = Math.abs(eval1) <= 1e-9 && Math.abs(eval2) <= 1e-9;
  if (!substitutionOk) {
    errors.push(`Thế nghiệm thất bại: f(${r1}) = ${eval1}, f(${r2}) = ${eval2}.`);
  }

  // Independent Viète check (exact multiplication avoids float division error)
  const vieteSumOk = Math.abs(a * (r1 + r2) + b) <= 1e-9;
  const vieteProductOk = Math.abs(a * r1 * r2 - c) <= 1e-9;
  if (!vieteSumOk || !vieteProductOk) {
    errors.push('Không thỏa mãn hệ thức Viète.');
  }

  const isDouble = Math.abs(r1 - r2) <= 1e-9;
  if (isDouble && Math.abs(delta) > 1e-9) {
    errors.push(`Nghiệm kép yêu cầu Δ = 0 nhưng Δ = ${delta}.`);
  }
  if (!isDouble && delta <= 1e-9) {
    errors.push(`Hai nghiệm phân biệt yêu cầu Δ > 0 nhưng Δ = ${delta}.`);
  }

  // Independent quadratic formula recomputation from (a, b, c)
  if (errors.length === 0 && delta >= 0) {
    const sqrtDelta = Math.sqrt(Math.max(0, delta));
    const q1 = (-b - sqrtDelta) / (2 * a);
    const q2 = (-b + sqrtDelta) / (2 * a);
    const expectedSorted = [r1, r2].sort((x, y) => x - y);
    const formulaSorted = [q1, q2].sort((x, y) => x - y);
    if (
      Math.abs(expectedSorted[0] - formulaSorted[0]) > 1e-7 ||
      Math.abs(expectedSorted[1] - formulaSorted[1]) > 1e-7
    ) {
      errors.push('Nghiệm công thức nghiệm (-b ± √Δ)/(2a) không khớp nghiệm đã chọn.');
    }
  }

  const sortedRoots = isDouble ? [r1] : [r1, r2].sort((x, y) => x - y);
  const rootKind: QuadraticVerificationResult['rootKind'] =
    errors.length > 0 ? 'invalid' : isDouble ? 'double-root' : 'two-distinct';

  const setText =
    sortedRoots.length === 1
      ? `{${sortedRoots[0]}} (nghiệm kép)`
      : `{${sortedRoots[0]}; ${sortedRoots[1]}}`;

  const proofText =
    errors.length === 0
      ? `a = ${a} ≠ 0; Δ = ${delta}; Thế ngược f(r) = 0 đạt; Viète: r₁+r₂ = ${r1 + r2} = -b/a, r₁·r₂ = ${r1 * r2} = c/a; Tập nghiệm ${setText}.`
      : errors.join(' ');

  return {
    valid: errors.length === 0,
    discriminant: delta,
    rootKind,
    sortedRoots,
    vieteSumOk,
    vieteProductOk,
    substitutionOk,
    proofText,
    errors,
  };
}

export interface LinearSystemVerificationResult {
  valid: boolean;
  determinant: number;
  cramerX: Rational | null;
  cramerY: Rational | null;
  gaussX: number | null;
  gaussY: number | null;
  substitutionOk: boolean;
  degenerate: boolean;
  proofText: string;
  errors: string[];
}

export function solveAndVerifyLinearSystem2x2(
  a: number,
  b: number,
  e: number,
  c: number,
  d: number,
  f: number,
  expectedX?: number,
  expectedY?: number
): LinearSystemVerificationResult {
  const errors: string[] = [];
  const det = a * d - b * c;
  const degenerate = Math.abs(det) <= 1e-12;

  if (degenerate) {
    errors.push(`Hệ suy biến (định thức D = a·d - b·c = ${det} = 0 — vô nghiệm hoặc vô số nghiệm).`);
    return {
      valid: false,
      determinant: det,
      cramerX: null,
      cramerY: null,
      gaussX: null,
      gaussY: null,
      substitutionOk: false,
      degenerate: true,
      proofText: errors[0],
      errors,
    };
  }

  // Method 1: Exact Rational Cramer's Rule
  const detX = e * d - b * f;
  const detY = a * f - e * c;
  const cramerX = createRational(detX, det);
  const cramerY = createRational(detY, det);
  const xC = rationalToNumber(cramerX);
  const yC = rationalToNumber(cramerY);

  // Method 2: Independent Gaussian Elimination with Partial Pivoting
  let r1 = [a, b, e];
  let r2 = [c, d, f];
  if (Math.abs(r2[0]) > Math.abs(r1[0])) {
    const tmp = r1;
    r1 = r2;
    r2 = tmp;
  }
  const factor = r2[0] / r1[0];
  const elimB = r2[1] - factor * r1[1];
  const elimRhs = r2[2] - factor * r1[2];
  const gaussY = elimRhs / elimB;
  const gaussX = (r1[2] - r1[1] * gaussY) / r1[0];

  if (
    !Number.isFinite(gaussX) ||
    !Number.isFinite(gaussY) ||
    Math.abs(gaussX - xC) > 1e-7 ||
    Math.abs(gaussY - yC) > 1e-7
  ) {
    errors.push('Kết quả khử Gauss không trùng với quy tắc Cramer.');
  }

  // Exact back-substitution in both equations
  const res1 = a * xC + b * yC - e;
  const res2 = c * xC + d * yC - f;
  const substitutionOk = Math.abs(res1) <= 1e-9 && Math.abs(res2) <= 1e-9;
  if (!substitutionOk) {
    errors.push(`Thế nghiệm vào hệ thất bại (sai lệch: ${res1}, ${res2}).`);
  }

  if (expectedX !== undefined && Math.abs(xC - expectedX) > 1e-9) {
    errors.push(`Nghiệm x giải độc lập (${xC}) khác x₀ (${expectedX}).`);
  }
  if (expectedY !== undefined && Math.abs(yC - expectedY) > 1e-9) {
    errors.push(`Nghiệm y giải độc lập (${yC}) khác y₀ (${expectedY}).`);
  }

  const proofText =
    errors.length === 0
      ? `Định thức D = ${det} ≠ 0 (nghiệm duy nhất); Cramer & Gauss đều cho (x, y) = (${formatRationalPlain(cramerX)}, ${formatRationalPlain(cramerY)}); Thế ngược cả 2 PT đều đạt.`
      : errors.join(' ');

  return {
    valid: errors.length === 0,
    determinant: det,
    cramerX,
    cramerY,
    gaussX,
    gaussY,
    substitutionOk,
    degenerate: false,
    proofText,
    errors,
  };
}

export interface PolynomialDerivativeVerificationResult {
  valid: boolean;
  derivativeCoeffs: number[];
  valueAtX0?: number;
  finiteDiffApprox?: number;
  proofText: string;
  errors: string[];
}

export function verifyPolynomialDerivative(
  originalCoeffs: readonly number[],
  claimedDerivativeCoeffs: readonly number[],
  x0?: number
): PolynomialDerivativeVerificationResult {
  const errors: string[] = [];
  const orig = normalizePolynomial(originalCoeffs);
  const expectedDeriv = differentiatePolynomial(orig);
  const claimed = normalizePolynomial(claimedDerivativeCoeffs);

  // Independent term-by-term verification
  const maxLen = Math.max(expectedDeriv.length, claimed.length);
  for (let k = 0; k < maxLen; k += 1) {
    const expCoeff = (orig[k + 1] ?? 0) * (k + 1);
    const gotCoeff = claimed[k] ?? 0;
    if (Math.abs(expCoeff - gotCoeff) > 1e-9) {
      errors.push(`Hệ số bậc ${k} của f'(x) sai (kỳ vọng ${expCoeff}, nhận ${gotCoeff}).`);
    }
  }

  let valueAtX0: number | undefined;
  let finiteDiffApprox: number | undefined;

  if (x0 !== undefined) {
    const directVal = evaluatePolynomialDirect(expectedDeriv, x0);
    const hornerVal = evaluatePolynomialHorner(expectedDeriv, x0);
    if (Math.abs(directVal - hornerVal) > 1e-9) {
      errors.push(`Sai lệch giữa tính trực tiếp (${directVal}) và Horner (${hornerVal}).`);
    }
    valueAtX0 = directVal;

    // Auxiliary numerical central difference check (never sole proof, wide relative tolerance for float h)
    finiteDiffApprox = numericalCentralDifference(orig, x0, 1e-5);
    const scale = Math.max(1, Math.abs(directVal));
    if (Math.abs(finiteDiffApprox - directVal) > 1e-2 * scale) {
      errors.push(
        `Kiểm tra phụ sai phân trung tâm lệch bất thường (${finiteDiffApprox.toFixed(4)} vs ${directVal}).`
      );
    }
  }

  const proofText =
    errors.length === 0
      ? x0 !== undefined
        ? `Đạo hàm chuẩn f'(x) = ${formatPolynomialLatex(expectedDeriv)}; Horner & trực tiếp tại x₀ = ${x0} đều cho ${valueAtX0} (kiểm tra phụ sai phân ≈ ${finiteDiffApprox?.toFixed(2)}).`
        : `Kiểm chứng độc lập từng hệ số d(aₖxᵏ)/dx = k·aₖxᵏ⁻¹ và đạo hàm hằng số = 0; chuẩn hóa f'(x) = ${formatPolynomialLatex(expectedDeriv)}.`
      : errors.join(' ');

  return {
    valid: errors.length === 0,
    derivativeCoeffs: expectedDeriv,
    valueAtX0,
    finiteDiffApprox,
    proofText,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Mathematical Answer Normalizer & Equivalent Answer Detector
// ---------------------------------------------------------------------------

export function canonicalRootSetKey(roots: readonly number[]): string {
  const uniqueRationals = new Map<string, Rational>();
  for (const r of roots) {
    const rat = createRational(r, 1);
    uniqueRationals.set(formatRationalPlain(rat), rat);
  }
  const sorted = Array.from(uniqueRationals.values()).sort(
    (a, b) => rationalToNumber(a) - rationalToNumber(b)
  );
  return `SET:{${sorted.map(formatRationalPlain).join(';')}}`;
}

export function canonicalOrderedPairKey(x: number, y: number): string {
  const rx = createRational(x, 1);
  const ry = createRational(y, 1);
  return `PAIR:(${formatRationalPlain(rx)},${formatRationalPlain(ry)})`;
}

/**
 * Normalizes a mathematical answer string (rational, unordered root set, ordered pair,
 * or polynomial expression) into a canonical comparison key.
 */
export function canonicalizeMathAnswer(raw: string): string {
  const cleaned = raw
    .replace(/\$/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\text\{[^}]*\}/g, '')
    .replace(/\\[;,!:]/g, ' ')
    .replace(/−/g, '-')
    .trim();

  // 1. Unordered root set: \{a; b\} or {a, b} or S = {a; b}
  const setMatch = /^(?:S\s*=\s*)?(?:\\\{|\{)(.+?)(?:\\\}|\})$/.exec(cleaned);
  if (setMatch) {
    const parts = setMatch[1]
      .split(/[;,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const parsed = parts.map(parseRationalToken);
    if (parsed.length > 0 && parsed.every((r): r is Rational => r !== null)) {
      const dedup = new Map<string, Rational>();
      for (const r of parsed) {
        dedup.set(formatRationalPlain(r), r);
      }
      const sorted = Array.from(dedup.values()).sort(
        (a, b) => rationalToNumber(a) - rationalToNumber(b)
      );
      return `SET:{${sorted.map(formatRationalPlain).join(';')}}`;
    }
  }

  // 2. Ordered pair: (x; y) or (x, y)
  const pairMatch = /^\(([^;(),]+)[;,]\s*([^;(),]+)\)$/.exec(cleaned);
  if (pairMatch) {
    const rx = parseRationalToken(pairMatch[1]);
    const ry = parseRationalToken(pairMatch[2]);
    if (rx && ry) {
      return `PAIR:(${formatRationalPlain(rx)},${formatRationalPlain(ry)})`;
    }
  }

  // 3. Single rational / integer / decimal (e.g. 1/2 === 2/4 === 0.5)
  const rat = parseRationalToken(cleaned);
  if (rat) {
    return `NUM:${formatRationalPlain(rat)}`;
  }

  // 4. Polynomial in x (e.g. 2x + 3x === 5x)
  const poly = parseSimplePolynomial(cleaned, 'x');
  if (poly) {
    return polynomialCanonicalKey(poly);
  }

  // Fallback normalized text
  return `RAW:${cleaned.replace(/\s+/g, '').toLowerCase()}`;
}

export function areMathAnswersEquivalent(a: string, b: string): boolean {
  return canonicalizeMathAnswer(a) === canonicalizeMathAnswer(b);
}

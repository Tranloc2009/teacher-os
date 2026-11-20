import type {
  QuestionTemplateDefinition,
} from '../../types/examGenerator';
import {
  areNumbersEquivalent,
  formatMathNumber,
  formatViNumber,
  NUMERIC_EPSILON,
} from './parameterConstraintEngine';
import {
  canonicalizeMathAnswer,
  canonicalOrderedPairKey,
  canonicalRootSetKey,
  differentiatePolynomial,
  evaluatePolynomialHorner,
  formatPolynomialLatex,
  normalizePolynomial,
  polynomialCanonicalKey,
  polynomialsEqual,
  solveAndVerifyLinearSystem2x2,
  verifyPolynomialDerivative,
  verifyQuadraticEquation,
} from './verifiedMathCore';

export interface StructuredOptionCandidate {
  latex: string;
  canonicalKey: string;
  isCorrect: boolean;
  /** Independent verifier MUST confirm this option is valid ONLY for the correct choice */
  satisfiesProblem: boolean;
}

export interface AdvancedFamilyCandidate {
  params: Record<string, number>;
  /** Numeric scalar answer when applicable (NaN for non-scalar answers like root-sets/pairs/polynomials) */
  scalarAnswer: number;
  correctLatex: string;
  correctPlainShortAnswer?: string;
  correctCanonicalKey: string;
  stemLatex: string;
  explanationLatex: string;
  independentProofText: string;
  /** Structured distractor pool (excluding the correct option, validated independently) */
  structuredDistractors: StructuredOptionCandidate[];
  /** Check whether a candidate structured option accidentally satisfies the problem */
  verifyStructuredOptionCorrect: (canonicalKey: string) => boolean;
}

function formatLinearCombination2(a: number, b: number): string {
  const parts: string[] = [];
  if (a !== 0) {
    if (a === 1) parts.push('x');
    else if (a === -1) parts.push('-x');
    else parts.push(`${a}x`);
  }
  if (b !== 0) {
    const absB = Math.abs(b);
    const term = absB === 1 ? 'y' : `${absB}y`;
    if (parts.length === 0) {
      parts.push(b < 0 ? `-${term}` : term);
    } else {
      parts.push(b < 0 ? ` - ${term}` : ` + ${term}`);
    }
  }
  return parts.length === 0 ? '0' : parts.join('');
}

function formatRootSetLatex(roots: readonly number[]): string {
  const unique = Array.from(new Set(roots)).sort((x, y) => x - y);
  return `$S = \\{${unique.map((r) => formatMathNumber(r)).join('; ')}\\}$`;
}

function formatOrderedPairLatex(x: number, y: number): string {
  return `$(${formatMathNumber(x)};\\; ${formatMathNumber(y)})$`;
}

function formatScalarLatex(val: number): string {
  return `$${formatViNumber(val, 2)}$`;
}

/**
 * 1. QUADRATIC EQUATION ENGINE (ax^2 + bx + c = 0, a != 0)
 * Root-first construction -> exact coefficients -> independent Delta, substitution & Viète verification.
 */
export function buildQuadraticCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>
): { ok: true; candidate: AdvancedFamilyCandidate } | { ok: false; reason: string } {
  const cfg = template.familyConfig ?? {};
  const mode = cfg.quadraticMode ?? 'solution-set';
  const rootPolicy = mode === 'double-root' ? 'double' : cfg.rootPolicy ?? 'distinct';
  const maxCoeff = cfg.maxCoeffMagnitude ?? 120;

  // Guardrail §IV: Never force a 2-distinct-root solution set into single-number short-answer
  if (template.questionType === 'short-answer' && mode === 'solution-set' && rootPolicy !== 'double') {
    return {
      ok: false,
      reason:
        'Không thể ép câu hỏi chọn tập nghiệm bậc hai (2 nghiệm phân biệt) thành câu Trả lời ngắn chỉ nhận 1 số duy nhất. Hãy dùng Trắc nghiệm (MCQ) hoặc đổi sang dạng Nghiệm kép / Nghiệm lớn hơn / Tổng hai nghiệm.',
    };
  }

  const a = rawParams.a;
  const r1 = rawParams.r1;
  const r2 = rootPolicy === 'double' ? r1 : rawParams.r2;

  if (!Number.isFinite(a) || Math.abs(a) <= NUMERIC_EPSILON) {
    return { ok: false, reason: 'Hệ số a = 0 (không phải phương trình bậc hai).' };
  }
  if (!Number.isInteger(r1) || !Number.isInteger(r2)) {
    return { ok: false, reason: 'Nghiệm phương trình bậc hai phải là số nguyên trong mẫu này.' };
  }
  if (rootPolicy === 'distinct' && r1 === r2) {
    return { ok: false, reason: 'Chế độ 2 nghiệm phân biệt yêu cầu r₁ ≠ r₂.' };
  }

  const b = -a * (r1 + r2);
  const c = a * r1 * r2;

  if (Math.abs(b) > maxCoeff || Math.abs(c) > maxCoeff) {
    return {
      ok: false,
      reason: `Độ lớn hệ số (|b|=${Math.abs(b)}, |c|=${Math.abs(c)}) vượt quá giới hạn cho phép (${maxCoeff}).`,
    };
  }

  // Independent verification: a != 0, Delta, back-substitution, Viète, quadratic formula
  const check = verifyQuadraticEquation(a, b, c, r1, r2);
  if (!check.valid) {
    return { ok: false, reason: check.proofText };
  }

  const polyLatex = formatPolynomialLatex([c, b, a], 'x');
  const eqLatex = `${polyLatex} = 0`;
  const [minR, maxR] = r1 <= r2 ? [r1, r2] : [r2, r1];
  const sumRoots = r1 + r2;
  const prodRoots = r1 * r2;

  const baseExplanation =
    rootPolicy === 'double'
      ? `Ta có phương trình $${eqLatex}$ với $a = ${a}$, $b = ${b}$, $c = ${c}$. Tính biệt thức $\\Delta = b^2 - 4ac = (${b})^2 - 4\\cdot(${a})\\cdot(${c}) = 0$. Phương trình có nghiệm kép $x_1 = x_2 = -\\frac{b}{2a} = ${r1}$. Kiểm chứng thế ngược: $${a}\\cdot(${r1})^2 ${b >= 0 ? '+' : '-'} ${Math.abs(b)}\\cdot(${r1}) ${c >= 0 ? '+' : '-'} ${Math.abs(c)} = 0$ (Đúng).`
      : `Ta có phương trình $${eqLatex}$ với $a = ${a}$, $b = ${b}$, $c = ${c}$. Tính $\\Delta = (${b})^2 - 4\\cdot(${a})\\cdot(${c}) = ${check.discriminant} > 0$, nên $\\sqrt{\\Delta} = ${Math.round(Math.sqrt(check.discriminant))}$. Hai nghiệm phân biệt là $x_1 = ${minR}$ và $x_2 = ${maxR}$. Kiểm chứng Viète: $x_1 + x_2 = ${sumRoots} = -\\frac{b}{a}$ và $x_1 x_2 = ${prodRoots} = \\frac{c}{a}$.`;

  if (mode === 'solution-set') {
    const correctRoots = check.sortedRoots;
    const correctKey = canonicalRootSetKey(correctRoots);
    const correctLatex = formatRootSetLatex(correctRoots);

    const distractorSets: number[][] =
      rootPolicy === 'double'
        ? [
            [-r1],
            [r1, -r1],
            [r1 + 1],
            [r1 - 1],
            [r1, 0],
            [r1 + 2],
            [r1 - 2],
          ]
        : [
            [-minR, -maxR], // flipped both signs
            [-minR, maxR], // flipped one sign
            [minR, -maxR], // flipped other sign
            [minR], // only one root
            [maxR], // only one root
            [sumRoots, prodRoots], // Viète sum/product confusion
            [minR + 1, maxR + 1],
            [minR - 1, maxR - 1],
            [minR + 1, maxR - 1],
            [minR - 2, maxR],
            [minR, maxR + 2],
          ];

    const verifyKeyCorrect = (key: string) => key === correctKey;

    const structuredDistractors: StructuredOptionCandidate[] = distractorSets.map((roots) => {
      const k = canonicalRootSetKey(roots);
      return {
        latex: formatRootSetLatex(roots),
        canonicalKey: k,
        isCorrect: false,
        satisfiesProblem: verifyKeyCorrect(k),
      };
    });

    return {
      ok: true,
      candidate: {
        params: { a, r1, r2, b, c },
        scalarAnswer: Number.NaN,
        correctLatex,
        correctCanonicalKey: correctKey,
        stemLatex: `Tìm tập nghiệm của phương trình bậc hai $${eqLatex}$.`,
        explanationLatex: `${baseExplanation} Vậy tập nghiệm là ${correctLatex}.`,
        independentProofText: check.proofText,
        structuredDistractors,
        verifyStructuredOptionCorrect: verifyKeyCorrect,
      },
    };
  }

  // Scalar sub-modes: larger-root, sum-of-roots, double-root
  let scalarAnswer: number;
  let stemLatex: string;
  let extraExplain: string;
  let rawDistractorNums: number[];

  if (mode === 'double-root') {
    scalarAnswer = r1;
    stemLatex = `Tìm nghiệm kép của phương trình bậc hai $${eqLatex}$.`;
    extraExplain = ` Vậy nghiệm kép của phương trình là $x = ${r1}$.`;
    rawDistractorNums = [-r1, r1 + 1, r1 - 1, r1 * 2, r1 + 2, r1 - 2, -r1 + 1, 0];
  } else if (mode === 'larger-root') {
    scalarAnswer = maxR;
    stemLatex = `Gọi $x_1, x_2$ ($x_1 < x_2$) là hai nghiệm của phương trình $${eqLatex}$. Giá trị của nghiệm lớn hơn $x_2$ bằng bao nhiêu?`;
    extraExplain = ` Vì $${minR} < ${maxR}$ nên nghiệm lớn hơn là $x_2 = ${maxR}$.`;
    rawDistractorNums = [minR, -maxR, -minR, sumRoots, maxR + 1, maxR - 1, maxR + 2, prodRoots];
  } else {
    // sum-of-roots
    scalarAnswer = sumRoots;
    stemLatex = `Gọi $x_1, x_2$ là hai nghiệm của phương trình $${eqLatex}$. Tính tổng $S = x_1 + x_2$.`;
    extraExplain = ` Vậy tổng hai nghiệm là $S = x_1 + x_2 = ${minR} + (${maxR}) = ${sumRoots}$.`;
    rawDistractorNums = [-sumRoots, prodRoots, -prodRoots, maxR - minR, sumRoots + 1, sumRoots - 1, sumRoots + 2, -b];
  }

  const correctKey = canonicalizeMathAnswer(String(scalarAnswer));
  const verifyKeyCorrect = (key: string) => key === correctKey;

  const structuredDistractors: StructuredOptionCandidate[] = rawDistractorNums.map((num) => {
    const k = canonicalizeMathAnswer(String(num));
    return {
      latex: formatScalarLatex(num),
      canonicalKey: k,
      isCorrect: false,
      satisfiesProblem: verifyKeyCorrect(k),
    };
  });

  return {
    ok: true,
    candidate: {
      params: { a, r1, r2, b, c },
      scalarAnswer,
      correctLatex: formatScalarLatex(scalarAnswer),
      correctPlainShortAnswer: formatMathNumber(scalarAnswer),
      correctCanonicalKey: correctKey,
      stemLatex,
      explanationLatex: `${baseExplanation}${extraExplain}`,
      independentProofText: check.proofText,
      structuredDistractors,
      verifyStructuredOptionCorrect: verifyKeyCorrect,
    },
  };
}

/**
 * 2. LINEAR SYSTEM 2x2 ENGINE (ax + by = e, cx + dy = f, det = ad - bc != 0)
 * Solution-first construction -> unique solution guaranteed -> Cramer + Gauss + substitution verification.
 */
export function buildLinearSystemCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>
): { ok: true; candidate: AdvancedFamilyCandidate } | { ok: false; reason: string } {
  const cfg = template.familyConfig ?? {};
  const mode = cfg.linearSystemMode ?? 'ordered-pair';
  const maxCoeff = cfg.maxCoeffMagnitude ?? 80;
  const exprP = cfg.exprP ?? 2;
  const exprQ = cfg.exprQ ?? -1;

  // Guardrail §V: Never force ordered pair (x, y) into single-number short-answer
  if (template.questionType === 'short-answer' && mode === 'ordered-pair') {
    return {
      ok: false,
      reason:
        'Không hỗ trợ câu Trả lời ngắn yêu cầu nhập cặp số (x, y) khi chưa có cơ chế chấm cặp số. Hãy dùng Trắc nghiệm (MCQ) hoặc chuyển sang dạng tính x + y / biểu thức theo x, y.',
    };
  }

  const { x0, y0, a, b, c, d } = rawParams;
  const det = a * d - b * c;
  if (Math.abs(det) <= NUMERIC_EPSILON) {
    return {
      ok: false,
      reason: 'Hệ phương trình suy biến (định thức D = ad - bc = 0 — không có nghiệm duy nhất).',
    };
  }

  const e = a * x0 + b * y0;
  const f = c * x0 + d * y0;
  if (Math.abs(e) > maxCoeff || Math.abs(f) > maxCoeff) {
    return {
      ok: false,
      reason: `Vế phải (|e|=${Math.abs(e)}, |f|=${Math.abs(f)}) vượt ngưỡng cho phép (${maxCoeff}).`,
    };
  }

  // Independent verification via exact Rational Cramer + Gaussian elimination + back-substitution
  const check = solveAndVerifyLinearSystem2x2(a, b, e, c, d, f, x0, y0);
  if (!check.valid) {
    return { ok: false, reason: check.proofText };
  }

  const eq1 = `${formatLinearCombination2(a, b)} = ${e}`;
  const eq2 = `${formatLinearCombination2(c, d)} = ${f}`;
  const sysLatex = `\\begin{cases} ${eq1} \\\\ ${eq2} \\end{cases}`;

  const detX = e * d - b * f;
  const detY = a * f - e * c;
  const baseExplain = `Tính định thức $D = (${a})\\cdot(${d}) - (${b})\\cdot(${c}) = ${det} \\ne 0$, nên hệ có nghiệm duy nhất. Ta có $D_x = ${detX}$, $D_y = ${detY} \\Rightarrow x = \\frac{${detX}}{${det}} = ${x0}$ và $y = \\frac{${detY}}{${det}} = ${y0}$. Kiểm chứng thế ngược: $${a}\\cdot(${x0}) + (${b})\\cdot(${y0}) = ${e}$ và $${c}\\cdot(${x0}) + (${d})\\cdot(${y0}) = ${f}$ (Đúng).`;

  if (mode === 'ordered-pair') {
    const correctKey = canonicalOrderedPairKey(x0, y0);
    const correctLatex = formatOrderedPairLatex(x0, y0);

    const distractorPairs: Array<[number, number]> = [
      [-x0, y0], // flipped sign x
      [x0, -y0], // flipped sign y
      [y0, x0], // swapped x and y
      [-x0, -y0], // flipped both
      [x0 + 1, y0],
      [x0, y0 + 1],
      [x0 - 1, y0],
      [x0, y0 - 1],
      [x0 + 1, y0 - 1],
      [x0 - 1, y0 + 1],
    ];

    const verifyPairSatisfiesSystem = (px: number, py: number): boolean =>
      areNumbersEquivalent(a * px + b * py, e) && areNumbersEquivalent(c * px + d * py, f);

    const verifyKeyCorrect = (key: string) => key === correctKey;

    const structuredDistractors: StructuredOptionCandidate[] = distractorPairs.map(([px, py]) => {
      const k = canonicalOrderedPairKey(px, py);
      return {
        latex: formatOrderedPairLatex(px, py),
        canonicalKey: k,
        isCorrect: false,
        satisfiesProblem: verifyKeyCorrect(k) || verifyPairSatisfiesSystem(px, py),
      };
    });

    return {
      ok: true,
      candidate: {
        params: { x0, y0, a, b, c, d, e, f },
        scalarAnswer: Number.NaN,
        correctLatex,
        correctCanonicalKey: correctKey,
        stemLatex: `Tìm nghiệm $(x; y)$ của hệ phương trình $${sysLatex}$.`,
        explanationLatex: `${baseExplain} Vậy nghiệm của hệ là $(x; y) = (${x0}; ${y0})$.`,
        independentProofText: check.proofText,
        structuredDistractors,
        verifyStructuredOptionCorrect: verifyKeyCorrect,
      },
    };
  }

  // Scalar modes: sum-xy or linear-expr (p*x + q*y)
  let scalarAnswer: number;
  let stemLatex: string;
  let extraExplain: string;
  let distractorNums: number[];

  if (mode === 'sum-xy') {
    scalarAnswer = x0 + y0;
    stemLatex = `Cho hệ phương trình $${sysLatex}$ có nghiệm duy nhất $(x_0; y_0)$. Tính giá trị biểu thức $T = x_0 + y_0$.`;
    extraExplain = ` Suy ra $T = x_0 + y_0 = ${x0} + (${y0}) = ${scalarAnswer}$.`;
    distractorNums = [
      x0 - y0,
      y0 - x0,
      -scalarAnswer,
      -x0 + y0,
      x0 - y0 + 1,
      scalarAnswer + 1,
      scalarAnswer - 1,
      scalarAnswer + 2,
      scalarAnswer - 2,
    ];
  } else {
    scalarAnswer = exprP * x0 + exprQ * y0;
    const exprStr = formatLinearCombination2(exprP, exprQ);
    stemLatex = `Cho hệ phương trình $${sysLatex}$ có nghiệm duy nhất $(x; y)$. Tính giá trị biểu thức $P = ${exprStr}$.`;
    extraExplain = ` Thay $(x; y) = (${x0}; ${y0})$ vào $P$: $P = ${exprP}\\cdot(${x0}) + (${exprQ})\\cdot(${y0}) = ${scalarAnswer}$.`;
    distractorNums = [
      exprP * y0 + exprQ * x0, // swapped x, y
      exprP * x0 - exprQ * y0, // sign flip on q
      -exprP * x0 + exprQ * y0, // sign flip on p
      -scalarAnswer,
      x0 + y0,
      scalarAnswer + 1,
      scalarAnswer - 1,
      scalarAnswer + 2,
      scalarAnswer - 2,
    ];
  }

  const correctKey = canonicalizeMathAnswer(String(scalarAnswer));
  const verifyKeyCorrect = (key: string) => key === correctKey;

  const structuredDistractors: StructuredOptionCandidate[] = distractorNums.map((num) => {
    const k = canonicalizeMathAnswer(String(num));
    return {
      latex: formatScalarLatex(num),
      canonicalKey: k,
      isCorrect: false,
      satisfiesProblem: verifyKeyCorrect(k),
    };
  });

  return {
    ok: true,
    candidate: {
      params: { x0, y0, a, b, c, d, e, f },
      scalarAnswer,
      correctLatex: formatScalarLatex(scalarAnswer),
      correctPlainShortAnswer: formatMathNumber(scalarAnswer),
      correctCanonicalKey: correctKey,
      stemLatex,
      explanationLatex: `${baseExplain}${extraExplain}`,
      independentProofText: check.proofText,
      structuredDistractors,
      verifyStructuredOptionCorrect: verifyKeyCorrect,
    },
  };
}

/**
 * 3. POLYNOMIAL DERIVATIVE ENGINE (degree 2..4)
 * Typed coefficient array -> exact power-rule derivative -> canonical polynomial normalization ->
 * independent coefficient + Horner + auxiliary central-difference verification.
 */
export function buildPolynomialDerivativeCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>
): { ok: true; candidate: AdvancedFamilyCandidate } | { ok: false; reason: string } {
  const cfg = template.familyConfig ?? {};
  const mode = cfg.derivativeMode ?? 'derivative-poly';
  const degree = cfg.polynomialDegree ?? 3;

  if (template.questionType === 'short-answer' && mode === 'derivative-poly') {
    return {
      ok: false,
      reason:
        'Dạng tìm biểu thức đạo hàm f\'(x) chỉ hỗ trợ Trắc nghiệm (MCQ) để đảm bảo chấm tự động chính xác. Hãy dùng Trắc nghiệm hoặc chọn dạng Tính f\'(x₀) / Tìm hệ số của hạng tử cho Trả lời ngắn.',
    };
  }

  const a4 = degree >= 4 ? (rawParams.a4 ?? 0) : 0;
  const a3 = degree >= 3 ? (rawParams.a3 ?? 0) : 0;
  const a2 = rawParams.a2 ?? 0;
  const a1 = rawParams.a1 ?? 0;
  const a0 = rawParams.a0 ?? 0;
  const x0 = rawParams.x0 ?? 2;

  const coeffs = normalizePolynomial(
    degree === 4 ? [a0, a1, a2, a3, a4] : degree === 3 ? [a0, a1, a2, a3] : [a0, a1, a2]
  );

  // Verify leading coefficient matches requested polynomial degree
  if (coeffs.length - 1 !== degree || coeffs[degree] === 0) {
    return {
      ok: false,
      reason: `Hệ số bậc cao nhất (x^${degree}) phải khác 0 để đa thức có đúng bậc ${degree}.`,
    };
  }

  const derivCoeffs = differentiatePolynomial(coeffs);
  const check = verifyPolynomialDerivative(
    coeffs,
    derivCoeffs,
    mode === 'value-at-x0' ? x0 : undefined
  );

  if (!check.valid) {
    return { ok: false, reason: check.proofText };
  }

  const fLatex = formatPolynomialLatex(coeffs, 'x');
  const fPrimeLatex = formatPolynomialLatex(derivCoeffs, 'x');

  const paramRecord: Record<string, number> = {
    ...(degree >= 4 ? { a4 } : {}),
    ...(degree >= 3 ? { a3 } : {}),
    a2,
    a1,
    a0,
    ...(mode === 'value-at-x0' ? { x0 } : {}),
  };

  if (mode === 'derivative-poly') {
    const correctKey = polynomialCanonicalKey(derivCoeffs);
    const correctLatex = `$f'(x) = ${fPrimeLatex}$`;

    // Classic student error distractors (each checked mathematically via polynomialsEqual!)
    const distractorPolys: number[][] = [];

    // Mistake 1: Forgot to multiply by exponent (just shifted exponents down)
    distractorPolys.push(normalizePolynomial(coeffs.slice(1)));

    // Mistake 2: Kept constant term a0 in derivative
    if (a0 !== 0) {
      const keptConst = [...derivCoeffs];
      keptConst[0] = (keptConst[0] ?? 0) + a0;
      distractorPolys.push(normalizePolynomial(keptConst));
    }

    // Mistake 3: Kept original exponent on leading term (multiplied coeff but forgot n-1)
    const keptExp = new Array<number>(degree + 1).fill(0);
    for (let k = 1; k <= degree; k += 1) {
      keptExp[k] = k * (coeffs[k] ?? 0);
    }
    distractorPolys.push(normalizePolynomial(keptExp));

    // Mistake 4: Sign flip on middle term
    if (derivCoeffs.length >= 2) {
      const flipped = [...derivCoeffs];
      const targetIdx = flipped.length - 2;
      flipped[targetIdx] = flipped[targetIdx] !== 0 ? -flipped[targetIdx] : 2;
      distractorPolys.push(normalizePolynomial(flipped));
    }

    // Mistake 5: Dropped linear/constant term of derivative
    if (derivCoeffs.length >= 2 && derivCoeffs[0] !== 0) {
      const droppedConst = [...derivCoeffs];
      droppedConst[0] = 0;
      distractorPolys.push(normalizePolynomial(droppedConst));
    }

    // Mistake 6: Leading derivative coeff off by +/- 1 or +/- degree
    const leadPlus = [...derivCoeffs];
    leadPlus[leadPlus.length - 1] += 1;
    distractorPolys.push(normalizePolynomial(leadPlus));

    const leadMinus = [...derivCoeffs];
    leadMinus[leadMinus.length - 1] -= 1;
    distractorPolys.push(normalizePolynomial(leadMinus));

    const constPlus = [...derivCoeffs];
    constPlus[0] = (constPlus[0] ?? 0) + 2;
    distractorPolys.push(normalizePolynomial(constPlus));

    const verifyKeyCorrect = (key: string) => key === correctKey;

    const structuredDistractors: StructuredOptionCandidate[] = distractorPolys.map((poly) => {
      const k = polynomialCanonicalKey(poly);
      const isMathematicallySame = polynomialsEqual(poly, derivCoeffs);
      return {
        latex: `$f'(x) = ${formatPolynomialLatex(poly, 'x')}$`,
        canonicalKey: k,
        isCorrect: false,
        satisfiesProblem: isMathematicallySame || verifyKeyCorrect(k),
      };
    });

    return {
      ok: true,
      candidate: {
        params: paramRecord,
        scalarAnswer: Number.NaN,
        correctLatex,
        correctCanonicalKey: correctKey,
        stemLatex: `Tính đạo hàm của hàm số đa thức $f(x) = ${fLatex}$.`,
        explanationLatex: `Áp dụng quy tắc $(a x^n)' = n a x^{n-1}$ và đạo hàm của hằng số bằng $0$, ta thu được $f'(x) = ${fPrimeLatex}$.`,
        independentProofText: check.proofText,
        structuredDistractors,
        verifyStructuredOptionCorrect: verifyKeyCorrect,
      },
    };
  }

  if (mode === 'value-at-x0') {
    const val = evaluatePolynomialHorner(derivCoeffs, x0);
    const correctKey = canonicalizeMathAnswer(String(val));
    const verifyKeyCorrect = (key: string) => key === correctKey;

    const fAtX0 = evaluatePolynomialHorner(coeffs, x0);
    const forgotMultVal = evaluatePolynomialHorner(normalizePolynomial(coeffs.slice(1)), x0);
    const keptConstVal = val + a0;
    const rawDistractors = [
      fAtX0, // evaluated f(x0) instead of f'(x0)
      forgotMultVal,
      keptConstVal,
      -val,
      val + 2,
      val - 2,
      val + 4,
      val - 4,
      val + 1,
      val - 1,
    ];

    const structuredDistractors: StructuredOptionCandidate[] = rawDistractors.map((num) => {
      const k = canonicalizeMathAnswer(String(num));
      return {
        latex: formatScalarLatex(num),
        canonicalKey: k,
        isCorrect: false,
        satisfiesProblem: verifyKeyCorrect(k),
      };
    });

    return {
      ok: true,
      candidate: {
        params: paramRecord,
        scalarAnswer: val,
        correctLatex: formatScalarLatex(val),
        correctPlainShortAnswer: formatMathNumber(val),
        correctCanonicalKey: correctKey,
        stemLatex: `Cho hàm số $f(x) = ${fLatex}$. Tính giá trị đạo hàm $f'(${x0})$.`,
        explanationLatex: `Ta có $f'(x) = ${fPrimeLatex}$. Thay $x = ${x0}$ vào $f'(x)$ ta được $f'(${x0}) = ${val}$.`,
        independentProofText: check.proofText,
        structuredDistractors,
        verifyStructuredOptionCorrect: verifyKeyCorrect,
      },
    };
  }

  // mode === 'term-coefficient'
  const targetDeg = Math.max(0, Math.min(degree - 1, cfg.targetTermDegree ?? degree - 1));
  const coeffVal = derivCoeffs[targetDeg] ?? 0;
  const correctKey = canonicalizeMathAnswer(String(coeffVal));
  const verifyKeyCorrect = (key: string) => key === correctKey;

  const termLabel =
    targetDeg === 0 ? 'hạng tử tự do' : targetDeg === 1 ? '$x$' : `$x^{${targetDeg}}$`;
  const origCoeff = coeffs[targetDeg + 1] ?? 0;

  const rawDistractors = [
    origCoeff, // forgot to multiply by exponent
    -coeffVal,
    origCoeff * targetDeg, // multiplied by (n-1) instead of n
    coeffVal + 1,
    coeffVal - 1,
    coeffVal + 2,
    coeffVal - 2,
    coeffVal + 3,
  ];

  const structuredDistractors: StructuredOptionCandidate[] = rawDistractors.map((num) => {
    const k = canonicalizeMathAnswer(String(num));
    return {
      latex: formatScalarLatex(num),
      canonicalKey: k,
      isCorrect: false,
      satisfiesProblem: verifyKeyCorrect(k),
    };
  });

  return {
    ok: true,
    candidate: {
      params: { ...paramRecord, targetDeg },
      scalarAnswer: coeffVal,
      correctLatex: formatScalarLatex(coeffVal),
      correctPlainShortAnswer: formatMathNumber(coeffVal),
      correctCanonicalKey: correctKey,
      stemLatex: `Cho đa thức $f(x) = ${fLatex}$. Hệ số của ${termLabel} trong biểu thức đạo hàm $f'(x)$ bằng bao nhiêu?`,
      explanationLatex: `Ta có $f'(x) = ${fPrimeLatex}$. Do đó hệ số của ${termLabel} trong $f'(x)$ là $${coeffVal}$.`,
      independentProofText: check.proofText,
      structuredDistractors,
      verifyStructuredOptionCorrect: verifyKeyCorrect,
    },
  };
}

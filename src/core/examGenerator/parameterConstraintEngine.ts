import type {
  ParameterConstraint,
  ParameterValidationResult,
} from '../../types/examGenerator';
import type { SeededRng } from './seededPrng';

export const NUMERIC_EPSILON = 1e-9;

export function roundToPlaces(value: number, places = 4): number {
  const factor = Math.pow(10, Math.max(0, Math.min(8, places)));
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function areNumbersEquivalent(
  a: number,
  b: number,
  tolerance = 1e-6
): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

export function formatViNumber(value: number, maxDecimals = 2): string {
  const rounded = roundToPlaces(value, maxDecimals);
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }
  return normalized.toFixed(maxDecimals).replace(/\.?0+$/, '').replace('.', ',');
}

export function formatMathNumber(value: number, maxDecimals = 2): string {
  const rounded = roundToPlaces(value, maxDecimals);
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }
  return normalized.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

export function formatSignedTerm(value: number): string {
  if (value >= 0) return `+ ${formatMathNumber(value)}`;
  return `- ${formatMathNumber(Math.abs(value))}`;
}

export function validateConstraintDefinitions(
  constraints: readonly ParameterConstraint[]
): ParameterValidationResult {
  const errors: string[] = [];
  const names = new Set<string>();

  for (const c of constraints) {
    if (!c.name.trim()) {
      errors.push('Tên tham số không được để trống.');
      continue;
    }
    if (names.has(c.name)) {
      errors.push(`Tham số "${c.name}" bị khai báo trùng.`);
    }
    names.add(c.name);

    if (!Number.isFinite(c.min) || !Number.isFinite(c.max)) {
      errors.push(`Tham số "${c.name}" có cận min/max không hợp lệ.`);
    } else if (c.min > c.max) {
      errors.push(
        `Tham số "${c.name}" có min (${c.min}) > max (${c.max}).`
      );
    }

    if (c.positive && c.negative) {
      errors.push(
        `Tham số "${c.name}" không thể đồng thời bắt buộc dương và âm.`
      );
    }
    if (c.positive && c.max <= 0) {
      errors.push(
        `Tham số "${c.name}" yêu cầu dương (> 0) nhưng max = ${c.max}.`
      );
    }
    if (c.negative && c.min >= 0) {
      errors.push(
        `Tham số "${c.name}" yêu cầu âm (< 0) nhưng min = ${c.min}.`
      );
    }
    if (c.nonZero && c.min === 0 && c.max === 0) {
      errors.push(
        `Tham số "${c.name}" yêu cầu khác 0 nhưng khoảng giá trị chỉ chứa 0.`
      );
    }
    if (c.allowedSet && c.allowedSet.length === 0) {
      errors.push(`Tham số "${c.name}" có tập giá trị allowedSet rỗng.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateParameterValues(
  constraints: readonly ParameterConstraint[],
  values: Record<string, number>
): ParameterValidationResult {
  const defCheck = validateConstraintDefinitions(constraints);
  const errors: string[] = [...defCheck.errors];

  for (const c of constraints) {
    const val = values[c.name];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      errors.push(`Thiếu hoặc sai định dạng giá trị cho tham số "${c.name}".`);
      continue;
    }
    if (c.kind === 'integer' && !Number.isInteger(val)) {
      errors.push(`Tham số "${c.name}" = ${val} không phải số nguyên.`);
    }
    if (val < c.min - NUMERIC_EPSILON || val > c.max + NUMERIC_EPSILON) {
      errors.push(
        `Tham số "${c.name}" = ${val} nằm ngoài khoảng [${c.min}, ${c.max}].`
      );
    }
    if (c.nonZero && Math.abs(val) <= NUMERIC_EPSILON) {
      errors.push(`Tham số "${c.name}" không được bằng 0.`);
    }
    if (c.positive && val <= NUMERIC_EPSILON) {
      errors.push(`Tham số "${c.name}" phải lớn hơn 0 (hiện tại: ${val}).`);
    }
    if (c.negative && val >= -NUMERIC_EPSILON) {
      errors.push(`Tham số "${c.name}" phải nhỏ hơn 0 (hiện tại: ${val}).`);
    }
    if (c.allowedSet && c.allowedSet.length > 0) {
      const matched = c.allowedSet.some((allowed) =>
        areNumbersEquivalent(val, allowed)
      );
      if (!matched) {
        errors.push(
          `Tham số "${c.name}" = ${val} không thuộc tập hợp cho phép [${c.allowedSet.join(', ')}].`
        );
      }
    }
    if (c.uniqueWith && c.uniqueWith.length > 0) {
      for (const otherName of c.uniqueWith) {
        const otherVal = values[otherName];
        if (
          typeof otherVal === 'number' &&
          areNumbersEquivalent(val, otherVal)
        ) {
          errors.push(
            `Tham số "${c.name}" và "${otherName}" phải có giá trị khác nhau (đang cùng bằng ${val}).`
          );
        }
      }
    }
    if (c.divisibleBy !== undefined) {
      const divisor =
        typeof c.divisibleBy === 'number'
          ? c.divisibleBy
          : values[c.divisibleBy];
      if (typeof divisor !== 'number' || Math.abs(divisor) <= NUMERIC_EPSILON) {
        errors.push(
          `Ràng buộc chia hết của "${c.name}" có số chia không hợp lệ hoặc bằng 0.`
        );
      } else {
        const ratio = val / divisor;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-6) {
          errors.push(
            `Tham số "${c.name}" = ${val} không chia hết cho ${divisor}.`
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function sampleParameterValue(
  c: ParameterConstraint,
  rng: SeededRng
): number | null {
  if (c.allowedSet && c.allowedSet.length > 0) {
    const eligible = c.allowedSet.filter((v) => {
      if (v < c.min - NUMERIC_EPSILON || v > c.max + NUMERIC_EPSILON) return false;
      if (c.nonZero && Math.abs(v) <= NUMERIC_EPSILON) return false;
      if (c.positive && v <= NUMERIC_EPSILON) return false;
      if (c.negative && v >= -NUMERIC_EPSILON) return false;
      if (c.kind === 'integer' && !Number.isInteger(v)) return false;
      return true;
    });
    if (eligible.length === 0) return null;
    return rng.pick(eligible);
  }

  const effectiveMin = c.positive
    ? Math.max(c.min, c.kind === 'integer' ? 1 : 0.1)
    : c.min;
  const effectiveMax = c.negative
    ? Math.min(c.max, c.kind === 'integer' ? -1 : -0.1)
    : c.max;

  if (effectiveMin > effectiveMax) return null;

  if (c.kind === 'integer') {
    const lo = Math.ceil(effectiveMin);
    const hi = Math.floor(effectiveMax);
    if (lo > hi) return null;
    if (c.nonZero && lo === 0 && hi === 0) return null;

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const v = rng.int(lo, hi);
      if (c.nonZero && v === 0) continue;
      return v;
    }
    return null;
  }

  const places = c.decimalPlaces ?? 1;
  const step = Math.pow(10, places);
  const loScaled = Math.ceil(effectiveMin * step);
  const hiScaled = Math.floor(effectiveMax * step);
  if (loScaled > hiScaled) return null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const v = rng.int(loScaled, hiScaled) / step;
    if (c.nonZero && Math.abs(v) <= NUMERIC_EPSILON) continue;
    return roundToPlaces(v, places);
  }
  return null;
}

export function buildParameterSignature(
  values: Record<string, number>
): string {
  return Object.keys(values)
    .sort()
    .map((k) => `${k}=${formatMathNumber(values[k], 4)}`)
    .join('|');
}

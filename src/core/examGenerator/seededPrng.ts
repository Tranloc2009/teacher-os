/**
 * Deterministic Seeded PRNG (FNV-1a 32-bit + Mulberry32).
 * TUYỆT ĐỐI không dùng Math.random() cho sinh biến thể câu hỏi để đảm bảo khả năng tái lập 100%.
 */

export interface SeededRng {
  /** Uniform float in [0, 1) */
  next: () => number;
  /** Uniform integer in [min, max] inclusive */
  int: (min: number, max: number) => number;
  /** Deterministic pick from a non-empty readonly array */
  pick: <T>(items: readonly T[]) => T;
  /** Deterministic Fisher-Yates shuffle returning a new array */
  shuffle: <T>(items: readonly T[]) => T[];
}

export function hashSeedString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createSeededRng(seed: string | number): SeededRng {
  let state = typeof seed === 'number' ? seed >>> 0 : hashSeedString(String(seed));

  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (hi < lo) {
      throw new Error(`Invalid integer range: [${min}, ${max}]`);
    }
    return lo + Math.floor(next() * (hi - lo + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array.');
    }
    return items[Math.floor(next() * items.length)];
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  };

  return { next, int, pick, shuffle };
}

export type MathToolbarCategory = 'primary' | 'extended';

export interface MathToolbarSymbol {
  id: string;
  category: MathToolbarCategory;
  tooltip: string;
  /** Pure LaTeX used by KaTeX to render the button face */
  previewLatex: string;
  /** Canonical LaTeX expression without outer $...$ delimiters */
  latex: string;
  /** Optional scale class when rendering tall/wide KaTeX on a compact button */
  previewScale?: 'normal' | 'compact' | 'matrix';
  /** Build insertion result (inner LaTeX without $...$ + relative editable range) */
  buildInner: (selectedText: string) => {
    innerLatex: string;
    selectStart: number;
    selectEnd: number;
  };
}

function wrapBaseIfNeeded(base: string): string {
  const trimmed = base.trim();
  if (!trimmed) return 'x';
  if (/^[a-zA-Z0-9]+$/.test(trimmed) || /^\\[a-zA-Z]+$/.test(trimmed)) {
    return trimmed;
  }
  if (
    (trimmed.startsWith('(') && trimmed.endsWith(')')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    return trimmed;
  }
  return `(${trimmed})`;
}

export const PRIMARY_MATH_SYMBOLS: MathToolbarSymbol[] = [
  {
    id: 'fraction',
    category: 'primary',
    tooltip: 'Phân số',
    previewLatex: '\\frac{a}{b}',
    latex: '\\frac{a}{b}',
    previewScale: 'normal',
    buildInner: (sel) => {
      if (sel) {
        const prefix = `\\frac{${sel}}{`;
        return {
          innerLatex: `${prefix}b}`,
          selectStart: prefix.length,
          selectEnd: prefix.length + 1,
        };
      }
      return {
        innerLatex: '\\frac{a}{b}',
        selectStart: 6, // 'a'
        selectEnd: 7,
      };
    },
  },
  {
    id: 'sqrt',
    category: 'primary',
    tooltip: 'Căn thức',
    previewLatex: '\\sqrt{x}',
    latex: '\\sqrt{x}',
    previewScale: 'normal',
    buildInner: (sel) => {
      if (sel) {
        const inner = `\\sqrt{${sel}}`;
        return {
          innerLatex: inner,
          selectStart: inner.length,
          selectEnd: inner.length,
        };
      }
      return {
        innerLatex: '\\sqrt{x}',
        selectStart: 6, // 'x'
        selectEnd: 7,
      };
    },
  },
  {
    id: 'superscript',
    category: 'primary',
    tooltip: 'Số mũ',
    previewLatex: 'x^{2}',
    latex: 'x^{2}',
    previewScale: 'normal',
    buildInner: (sel) => {
      const base = sel ? wrapBaseIfNeeded(sel) : 'x';
      const prefix = `${base}^{`;
      return {
        innerLatex: `${prefix}2}`,
        selectStart: prefix.length,
        selectEnd: prefix.length + 1,
      };
    },
  },
  {
    id: 'subscript',
    category: 'primary',
    tooltip: 'Chỉ số',
    previewLatex: 'x_{i}',
    latex: 'x_{i}',
    previewScale: 'normal',
    buildInner: (sel) => {
      const base = sel ? sel : 'x';
      const prefix = `${base}_{`;
      return {
        innerLatex: `${prefix}i}`,
        selectStart: prefix.length,
        selectEnd: prefix.length + 1,
      };
    },
  },
  {
    id: 'limit',
    category: 'primary',
    tooltip: 'Giới hạn',
    previewLatex: '\\lim_{x\\to a} f(x)',
    latex: '\\lim_{x\\to a} f(x)',
    previewScale: 'compact',
    buildInner: (sel) => {
      const body = sel || 'f(x)';
      const inner = `\\lim_{x\\to a} ${body}`;
      const aIdx = inner.indexOf('a');
      return {
        innerLatex: inner,
        selectStart: aIdx,
        selectEnd: aIdx + 1,
      };
    },
  },
  {
    id: 'integral',
    category: 'primary',
    tooltip: 'Tích phân',
    previewLatex: '\\int_a^b f(x)\\,dx',
    latex: '\\int_a^b f(x)\\,dx',
    previewScale: 'compact',
    buildInner: (sel) => {
      const body = sel || 'f(x)';
      const inner = `\\int_a^b ${body}\\,dx`;
      return {
        innerLatex: inner,
        selectStart: 5, // 'a' in \int_a^b
        selectEnd: 6,
      };
    },
  },
  {
    id: 'vector',
    category: 'primary',
    tooltip: 'Vectơ',
    previewLatex: '\\vec{AB}',
    latex: '\\vec{AB}',
    previewScale: 'normal',
    buildInner: (sel) => {
      if (sel) {
        const inner = `\\vec{${sel}}`;
        return {
          innerLatex: inner,
          selectStart: inner.length,
          selectEnd: inner.length,
        };
      }
      return {
        innerLatex: '\\vec{AB}',
        selectStart: 5, // 'AB'
        selectEnd: 7,
      };
    },
  },
  {
    id: 'log',
    category: 'primary',
    tooltip: 'Logarit',
    previewLatex: '\\log_a x',
    latex: '\\log_a x',
    previewScale: 'normal',
    buildInner: (sel) => {
      const arg = sel || 'x';
      const inner = `\\log_a ${arg}`;
      return {
        innerLatex: inner,
        selectStart: 5, // 'a'
        selectEnd: 6,
      };
    },
  },
  {
    id: 'cases',
    category: 'primary',
    tooltip: 'Hệ phương trình',
    previewLatex: '\\begin{cases}x+y=3\\\\x-y=1\\end{cases}',
    latex: '\\begin{cases}x+y=3\\\\x-y=1\\end{cases}',
    previewScale: 'matrix',
    buildInner: (sel) => {
      if (sel) {
        const prefix = `\\begin{cases}${sel}\\\\`;
        return {
          innerLatex: `${prefix}x-y=1\\end{cases}`,
          selectStart: prefix.length,
          selectEnd: prefix.length + 5, // 'x-y=1'
        };
      }
      const prefix = '\\begin{cases}';
      return {
        innerLatex: '\\begin{cases}x+y=3\\\\x-y=1\\end{cases}',
        selectStart: prefix.length,
        selectEnd: prefix.length + 5, // 'x+y=3'
      };
    },
  },
  {
    id: 'real-set',
    category: 'primary',
    tooltip: 'Tập số thực',
    previewLatex: '\\mathbb{R}',
    latex: '\\mathbb{R}',
    previewScale: 'normal',
    buildInner: () => ({
      innerLatex: '\\mathbb{R}',
      selectStart: 10,
      selectEnd: 10,
    }),
  },
];

export const EXTENDED_MATH_SYMBOLS: MathToolbarSymbol[] = [
  {
    id: 'nth-root',
    category: 'extended',
    tooltip: 'Căn bậc n',
    previewLatex: '\\sqrt[n]{x}',
    latex: '\\sqrt[n]{x}',
    previewScale: 'normal',
    buildInner: (sel) => {
      const radicand = sel || 'x';
      const inner = `\\sqrt[n]{${radicand}}`;
      return { innerLatex: inner, selectStart: 6, selectEnd: 7 };
    },
  },
  {
    id: 'sum',
    category: 'extended',
    tooltip: 'Tổng Sigma',
    previewLatex: '\\sum_{i=1}^{n} a_i',
    latex: '\\sum_{i=1}^{n} a_i',
    previewScale: 'compact',
    buildInner: (sel) => {
      const term = sel || 'a_i';
      const inner = `\\sum_{i=1}^{n} ${term}`;
      const nIdx = inner.indexOf('{n}') + 1;
      return { innerLatex: inner, selectStart: nIdx, selectEnd: nIdx + 1 };
    },
  },
  {
    id: 'angle',
    category: 'extended',
    tooltip: 'Góc hình học',
    previewLatex: '\\widehat{ABC}',
    latex: '\\widehat{ABC}',
    previewScale: 'compact',
    buildInner: (sel) => {
      if (sel) {
        const inner = `\\widehat{${sel}}`;
        return { innerLatex: inner, selectStart: inner.length, selectEnd: inner.length };
      }
      return { innerLatex: '\\widehat{ABC}', selectStart: 9, selectEnd: 12 };
    },
  },
  {
    id: 'neq',
    category: 'extended',
    tooltip: 'Khác nhau',
    previewLatex: '\\neq',
    latex: '\\neq',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\neq', selectStart: 4, selectEnd: 4 }),
  },
  {
    id: 'le',
    category: 'extended',
    tooltip: 'Nhỏ hơn hoặc bằng',
    previewLatex: '\\le',
    latex: '\\le',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\le', selectStart: 3, selectEnd: 3 }),
  },
  {
    id: 'ge',
    category: 'extended',
    tooltip: 'Lớn hơn hoặc bằng',
    previewLatex: '\\ge',
    latex: '\\ge',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\ge', selectStart: 3, selectEnd: 3 }),
  },
  {
    id: 'infty',
    category: 'extended',
    tooltip: 'Vô cực',
    previewLatex: '\\infty',
    latex: '\\infty',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\infty', selectStart: 6, selectEnd: 6 }),
  },
  {
    id: 'in-set',
    category: 'extended',
    tooltip: 'Thuộc tập hợp',
    previewLatex: '\\in',
    latex: '\\in',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\in', selectStart: 3, selectEnd: 3 }),
  },
  {
    id: 'setminus',
    category: 'extended',
    tooltip: 'Hiệu tập hợp',
    previewLatex: '\\setminus',
    latex: '\\setminus',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\setminus', selectStart: 9, selectEnd: 9 }),
  },
  {
    id: 'Leftrightarrow',
    category: 'extended',
    tooltip: 'Tương đương',
    previewLatex: '\\Leftrightarrow',
    latex: '\\Leftrightarrow',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\Leftrightarrow', selectStart: 15, selectEnd: 15 }),
  },
  {
    id: 'pi',
    category: 'extended',
    tooltip: 'Số Pi',
    previewLatex: '\\pi',
    latex: '\\pi',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\pi', selectStart: 3, selectEnd: 3 }),
  },
  {
    id: 'delta',
    category: 'extended',
    tooltip: 'Delta',
    previewLatex: '\\Delta',
    latex: '\\Delta',
    previewScale: 'normal',
    buildInner: () => ({ innerLatex: '\\Delta', selectStart: 6, selectEnd: 6 }),
  },
];

export const ALL_MATH_SYMBOLS: MathToolbarSymbol[] = [
  ...PRIMARY_MATH_SYMBOLS,
  ...EXTENDED_MATH_SYMBOLS,
];

export function getMathSymbolById(id: string): MathToolbarSymbol | undefined {
  return ALL_MATH_SYMBOLS.find((s) => s.id === id);
}

/**
 * Checks whether `offset` falls strictly inside an open `$ ... $` or `$$ ... $$`
 * span matching the exact delimiter rules of `parseMathContent`.
 */
export function isOffsetInsideLatexDelimiters(text: string, offset: number): boolean {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let cursor = 0;

  while (cursor < text.length) {
    if (text[cursor] === '$' && text[cursor + 1] === '$') {
      const closeIdx = text.indexOf('$$', cursor + 2);
      if (closeIdx !== -1) {
        if (clamped >= cursor + 2 && clamped <= closeIdx) {
          return true;
        }
        cursor = closeIdx + 2;
        continue;
      }
    }

    if (text[cursor] === '$' && (cursor === 0 || text[cursor - 1] !== '\\')) {
      let searchFrom = cursor + 1;
      let closeIdx = -1;
      while (searchFrom < text.length) {
        const candidate = text.indexOf('$', searchFrom);
        if (candidate === -1) break;
        if (text[candidate - 1] !== '\\' && text[candidate + 1] !== '$') {
          closeIdx = candidate;
          break;
        }
        searchFrom = candidate + 1;
      }
      if (closeIdx !== -1) {
        if (clamped >= cursor + 1 && clamped <= closeIdx) {
          return true;
        }
        cursor = closeIdx + 1;
        continue;
      }
    }

    cursor += 1;
  }

  return false;
}

export interface MathInsertionResult {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
  wrappedInDelimiters: boolean;
}

/**
 * Inserts a LaTeX math symbol at `[selStart, selEnd]` cleanly:
 * - Never destroys surrounding un-selected text.
 * - Replaces selected text into the expression body where appropriate.
 * - Does not double-wrap `$...$` when already inside `$...$` or `$$...$$`.
 * - Positions the cursor/selection on the editable parameter of the symbol.
 */
export function insertMathSymbolAtCursor(
  currentValue: string,
  selStart: number,
  selEnd: number,
  symbol: MathToolbarSymbol
): MathInsertionResult {
  const safeStart = Math.max(0, Math.min(selStart, currentValue.length));
  const safeEnd = Math.max(safeStart, Math.min(selEnd, currentValue.length));

  const before = currentValue.slice(0, safeStart);
  const selected = currentValue.slice(safeStart, safeEnd);
  const after = currentValue.slice(safeEnd);

  const insideLatex =
    isOffsetInsideLatexDelimiters(currentValue, safeStart) &&
    isOffsetInsideLatexDelimiters(currentValue, safeEnd);

  // Strip accidental surrounding $...$ if user highlighted a math expression from outside
  const cleanedSelection =
    !insideLatex &&
    selected.startsWith('$') &&
    selected.endsWith('$') &&
    selected.length >= 2 &&
    !selected.startsWith('$$')
      ? selected.slice(1, -1).trim()
      : selected;

  const built = symbol.buildInner(cleanedSelection);
  const coreInserted = insideLatex ? built.innerLatex : `$${built.innerLatex}$`;
  const leadingSpace =
    !insideLatex && before.endsWith('$') && !before.endsWith('\\$') ? ' ' : '';
  const trailingSpace = !insideLatex && after.startsWith('$') ? ' ' : '';
  const insertedText = `${leadingSpace}${coreInserted}${trailingSpace}`;
  const delimiterOffset = leadingSpace.length + (insideLatex ? 0 : 1);

  const nextValue = `${before}${insertedText}${after}`;

  // For symbols without editable placeholders (like \mathbb{R} or operators), place caret at end of core expression
  const isEndCaret =
    built.selectStart === built.innerLatex.length &&
    built.selectEnd === built.innerLatex.length;
  const endOffset = safeStart + leadingSpace.length + coreInserted.length;
  const nextSelectionStart = isEndCaret
    ? endOffset
    : safeStart + delimiterOffset + built.selectStart;
  const nextSelectionEnd = isEndCaret
    ? endOffset
    : safeStart + delimiterOffset + built.selectEnd;

  return {
    nextValue,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd,
    wrappedInDelimiters: !insideLatex,
  };
}

export interface FieldHistorySnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface FieldHistoryState {
  past: FieldHistorySnapshot[];
  present: FieldHistorySnapshot;
  future: FieldHistorySnapshot[];
}

export function createFieldHistory(
  initialValue: string,
  selectionStart = initialValue.length,
  selectionEnd = initialValue.length
): FieldHistoryState {
  return {
    past: [],
    present: { value: initialValue, selectionStart, selectionEnd },
    future: [],
  };
}

export function pushFieldHistory(
  state: FieldHistoryState,
  next: FieldHistorySnapshot,
  maxDepth = 50
): FieldHistoryState {
  if (state.present.value === next.value) {
    return {
      ...state,
      present: next,
    };
  }
  const past = [...state.past, state.present];
  const trimmedPast = past.length > maxDepth ? past.slice(past.length - maxDepth) : past;
  return {
    past: trimmedPast,
    present: next,
    future: [],
  };
}

export function undoFieldHistory(state: FieldHistoryState): {
  nextState: FieldHistoryState;
  applied: FieldHistorySnapshot | null;
} {
  if (state.past.length === 0) {
    return { nextState: state, applied: null };
  }
  const previous = state.past[state.past.length - 1];
  return {
    nextState: {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
    },
    applied: previous,
  };
}

export function redoFieldHistory(state: FieldHistoryState): {
  nextState: FieldHistoryState;
  applied: FieldHistorySnapshot | null;
} {
  if (state.future.length === 0) {
    return { nextState: state, applied: null };
  }
  const next = state.future[0];
  return {
    nextState: {
      past: [...state.past, state.present],
      present: next,
      future: state.future.slice(1),
    },
    applied: next,
  };
}

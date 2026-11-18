import { KeyboardEvent, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { ChevronDown, ChevronUp, Plus, Redo2, Undo2 } from 'lucide-react';
import {
  EXTENDED_MATH_SYMBOLS,
  MathToolbarSymbol,
  PRIMARY_MATH_SYMBOLS,
} from '../../core/mathToolbarSymbols';

interface MathSymbolToolbarProps {
  symbols?: MathToolbarSymbol[];
  extendedSymbols?: MathToolbarSymbol[];
  onInsertSymbol: (symbol: MathToolbarSymbol) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  activeFieldLabel?: string;
}

function renderSymbolKatex(previewLatex: string): string {
  return katex.renderToString(previewLatex, {
    displayMode: false,
    throwOnError: false,
    strict: false,
    output: 'htmlAndMathml',
  });
}

function SymbolButton({
  symbol,
  html,
  onSelect,
  buttonRef,
  onKeyDown,
}: {
  symbol: MathToolbarSymbol;
  html: string;
  onSelect: (symbol: MathToolbarSymbol) => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const scaleClass =
    symbol.previewScale === 'matrix'
      ? 'text-[10.5px] leading-none scale-[0.82] origin-center'
      : symbol.previewScale === 'compact'
      ? 'text-[11.5px] leading-none'
      : 'text-[13px] leading-none';

  return (
    <div className="relative group">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Chèn ${symbol.tooltip}`}
        title={symbol.tooltip}
        data-math-symbol-id={symbol.id}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSelect(symbol)}
        onKeyDown={onKeyDown}
        className="inline-flex h-8 min-w-[34px] items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-1.5 text-slate-900 dark:text-slate-100 shadow-[0_1px_1px_rgba(15,23,42,0.04)] hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/70 dark:hover:bg-slate-700/90 hover:text-blue-950 dark:hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 active:scale-[0.97] transition-all"
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none select-none inline-flex items-center justify-center ${scaleClass}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-30 whitespace-nowrap rounded-md bg-slate-900 dark:bg-slate-700 px-2 py-1 text-[10px] font-medium text-white shadow-sm opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all"
      >
        {symbol.tooltip}
      </span>
    </div>
  );
}

export function MathSymbolToolbar({
  symbols = PRIMARY_MATH_SYMBOLS,
  extendedSymbols = EXTENDED_MATH_SYMBOLS,
  onInsertSymbol,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  activeFieldLabel,
}: MathSymbolToolbarProps) {
  const [showExtended, setShowExtended] = useState(false);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const renderedPrimary = useMemo(
    () =>
      symbols.map((sym) => ({
        symbol: sym,
        html: renderSymbolKatex(sym.previewLatex),
      })),
    [symbols]
  );

  const renderedExtended = useMemo(
    () =>
      extendedSymbols.map((sym) => ({
        symbol: sym,
        html: renderSymbolKatex(sym.previewLatex),
      })),
    [extendedSymbols]
  );

  const handleToolbarKeyDown = (index: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const visibleButtons = buttonRefs.current.filter((el): el is HTMLButtonElement => Boolean(el));
    if (visibleButtons.length === 0) return;

    let targetIndex = -1;
    if (e.key === 'ArrowRight') {
      targetIndex = (index + 1) % visibleButtons.length;
    } else if (e.key === 'ArrowLeft') {
      targetIndex = (index - 1 + visibleButtons.length) % visibleButtons.length;
    } else if (e.key === 'Home') {
      targetIndex = 0;
    } else if (e.key === 'End') {
      targetIndex = visibleButtons.length - 1;
    }

    if (targetIndex >= 0) {
      e.preventDefault();
      visibleButtons[targetIndex]?.focus();
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Thanh công cụ ký hiệu toán học"
      className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/45 p-1.5 space-y-1.5 overflow-visible"
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {renderedPrimary.map(({ symbol, html }, idx) => (
            <SymbolButton
              key={symbol.id}
              symbol={symbol}
              html={html}
              onSelect={onInsertSymbol}
              buttonRef={(el) => {
                buttonRefs.current[idx] = el;
              }}
              onKeyDown={(e) => handleToolbarKeyDown(idx, e)}
            />
          ))}
        </div>

        <div className="flex items-center gap-1 pl-1.5 border-l border-slate-200 dark:border-slate-700 shrink-0">
          {onUndo && (
            <button
              type="button"
              aria-label="Hoàn tác chỉnh sửa (Ctrl+Z)"
              title="Hoàn tác (Ctrl+Z)"
              disabled={!canUndo}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onUndo}
              className="inline-flex h-8 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {onRedo && (
            <button
              type="button"
              aria-label="Làm lại chỉnh sửa (Ctrl+Y)"
              title="Làm lại (Ctrl+Y)"
              disabled={!canRedo}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onRedo}
              className="inline-flex h-8 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {extendedSymbols.length > 0 && (
            <button
              type="button"
              aria-label="Mở rộng thêm ký hiệu toán học"
              aria-expanded={showExtended}
              title={showExtended ? 'Thu gọn ký hiệu mở rộng' : 'Mở rộng thêm ký hiệu toán học'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowExtended((prev) => !prev)}
              className={`inline-flex h-8 items-center gap-0.5 rounded-lg border px-1.5 text-xs font-medium transition-colors ${
                showExtended
                  ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {showExtended ? (
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>

      {showExtended && extendedSymbols.length > 0 && (
        <div
          aria-label="Ký hiệu toán học mở rộng"
          className="flex flex-wrap items-center gap-1 pt-1.5 border-t border-slate-200/80 dark:border-slate-700/70"
        >
          {renderedExtended.map(({ symbol, html }, extIdx) => {
            const globalIdx = renderedPrimary.length + extIdx;
            return (
              <SymbolButton
                key={symbol.id}
                symbol={symbol}
                html={html}
                onSelect={onInsertSymbol}
                buttonRef={(el) => {
                  buttonRefs.current[globalIdx] = el;
                }}
                onKeyDown={(e) => handleToolbarKeyDown(globalIdx, e)}
              />
            );
          })}
          {activeFieldLabel && (
            <span className="ml-auto px-1.5 text-[10px] text-slate-500 dark:text-slate-400">
              Đang chèn vào: {activeFieldLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

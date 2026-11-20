import { useMemo, useState } from 'react';
import katex from 'katex';
import { MathContentPayload, MathVisualAsset } from '../../types/mathExam';
import { parseMathContent, sanitizeSvgSource } from '../../core/mathIntegrity';

interface MathContentRendererProps {
  payload?: MathContentPayload;
  rawText?: string;
  className?: string;
}

function renderLatexSegment(latex: string, displayMode: boolean): { html: string; hasError: boolean } {
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: true,
      strict: false,
      output: 'htmlAndMathml',
    });
    return { html, hasError: false };
  } catch {
    const fallbackHtml = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      errorColor: '#dc2626',
    });
    return { html: fallbackHtml, hasError: true };
  }
}

export function MathContentRenderer({
  payload,
  rawText,
  className = '',
}: MathContentRendererProps) {
  const resolved = useMemo(() => {
    if (payload && payload.blocks.length > 0) return payload;
    const src = payload?.rawSource ?? rawText ?? '';
    return parseMathContent(src);
  }, [payload, rawText]);

  if (!resolved.rawSource && resolved.blocks.length === 0) {
    return <span className="italic text-slate-400 dark:text-slate-500">(Chưa nhập nội dung)</span>;
  }

  return (
    <span className={`leading-relaxed break-words ${className}`}>
      {resolved.blocks.map((block) => {
        if (block.kind === 'latex') {
          const rendered = renderLatexSegment(block.content, Boolean(block.displayMode));
          if (block.displayMode) {
            return (
              <span
                key={block.id}
                className={`my-2 block overflow-x-auto py-1 text-center ${
                  rendered.hasError ? 'rounded border border-red-300 bg-red-50/70 px-2' : ''
                }`}
                dangerouslySetInnerHTML={{ __html: rendered.html }}
              />
            );
          }
          return (
            <span
              key={block.id}
              className={
                rendered.hasError
                  ? 'inline-block rounded border border-red-300 bg-red-50/70 px-1'
                  : 'inline-block align-middle'
              }
              dangerouslySetInnerHTML={{ __html: rendered.html }}
            />
          );
        }

        if (block.kind === 'graph-note') {
          return (
            <span
              key={block.id}
              className="my-1.5 block rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300"
            >
              [Hình/Đồ thị đính kèm]: {block.content}
            </span>
          );
        }

        return (
          <span key={block.id} className="whitespace-pre-wrap">
            {block.content}
          </span>
        );
      })}
    </span>
  );
}

interface MathVisualAssetRendererProps {
  asset: MathVisualAsset;
  compact?: boolean;
}

export function MathVisualAssetRenderer({ asset, compact = false }: MathVisualAssetRendererProps) {
  const [imgError, setImgError] = useState(false);

  const isSvg =
    (asset.kind === 'geometry-svg' || asset.kind === 'variation-table') &&
    asset.sourceData.trim().startsWith('<svg');

  return (
    <figure className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-slate-800 dark:text-slate-200">
          {asset.label}
        </span>
        {!compact && (
          <span className="font-mono-num text-[10px] text-slate-500 dark:text-slate-400">
            Checksum: {asset.checksum.slice(0, 8)}
          </span>
        )}
      </div>

      {!asset.sourceData.trim() ? (
        <div className="rounded border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-800">
          Lỗi tài nguyên: Thiếu dữ liệu nguồn hình vẽ/bảng biến thiên.
        </div>
      ) : isSvg ? (
        <div
          className={`rounded border border-slate-200 bg-white p-2 flex justify-center items-center overflow-hidden [&>svg]:max-w-full [&>svg]:w-auto [&>svg]:h-auto ${
            compact ? '[&>svg]:max-h-56' : '[&>svg]:max-h-[340px]'
          }`}
          dangerouslySetInnerHTML={{ __html: sanitizeSvgSource(asset.sourceData) }}
        />
      ) : asset.kind === 'data-table' ? (
        <pre className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2 text-[11px] font-mono text-slate-800 dark:text-slate-200 overflow-x-auto whitespace-pre">
          {asset.sourceData}
        </pre>
      ) : imgError ? (
        <div className="rounded border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-800">
          Không tải được hình ảnh ({asset.altText || asset.label}).
        </div>
      ) : (
        <div className="rounded border border-slate-200 bg-white p-1.5 flex justify-center">
          <img
            src={asset.sourceData}
            alt={asset.altText || asset.label}
            onError={() => setImgError(true)}
            className={`object-contain ${compact ? 'max-h-32' : 'max-h-56'}`}
          />
        </div>
      )}
    </figure>
  );
}

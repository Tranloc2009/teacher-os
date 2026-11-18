import { TutorialPlacement } from '../types/tutorial';

export interface BoxRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface TooltipPositionResult {
  top: number;
  left: number;
  resolvedPlacement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  centeredFallback: boolean;
  /** Offset in px relative to tooltip left (for top/bottom) or tooltip top (for left/right) */
  arrowOffset: number;
}

function clamp(val: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(val, min), max);
}

export function computeTooltipPosition(params: {
  targetRect: BoxRect | null;
  tooltipWidth: number;
  tooltipHeight: number;
  viewport: ViewportSize;
  preferredPlacement: TutorialPlacement;
  spotlightPadding?: number;
  gap?: number;
  edgeMargin?: number;
}): TooltipPositionResult {
  const {
    targetRect,
    tooltipWidth,
    tooltipHeight,
    viewport,
    preferredPlacement,
    spotlightPadding = 8,
    gap = 14,
    edgeMargin = 12,
  } = params;

  const safeW = Math.min(tooltipWidth, Math.max(240, viewport.width - edgeMargin * 2));
  const safeH = Math.min(tooltipHeight, Math.max(160, viewport.height - edgeMargin * 2));

  if (!targetRect || preferredPlacement === 'center') {
    return {
      top: Math.round(clamp((viewport.height - safeH) / 2, edgeMargin, viewport.height - safeH - edgeMargin)),
      left: Math.round(clamp((viewport.width - safeW) / 2, edgeMargin, viewport.width - safeW - edgeMargin)),
      resolvedPlacement: 'center',
      centeredFallback: !targetRect && preferredPlacement !== 'center',
      arrowOffset: safeW / 2,
    };
  }

  const sTop = Math.max(0, targetRect.top - spotlightPadding);
  const sLeft = Math.max(0, targetRect.left - spotlightPadding);
  const sRight = Math.min(viewport.width, targetRect.left + targetRect.width + spotlightPadding);
  const sBottom = Math.min(viewport.height, targetRect.top + targetRect.height + spotlightPadding);

  const spaceBottom = viewport.height - sBottom - edgeMargin;
  const spaceTop = sTop - edgeMargin;
  const spaceRight = viewport.width - sRight - edgeMargin;
  const spaceLeft = sLeft - edgeMargin;

  const baseOrder: Array<'bottom' | 'top' | 'right' | 'left'> = ['bottom', 'top', 'right', 'left'];
  const candidates =
    preferredPlacement === 'auto'
      ? baseOrder
      : [
          preferredPlacement,
          ...baseOrder.filter((p) => p !== preferredPlacement),
        ];

  const fits = (side: 'bottom' | 'top' | 'right' | 'left'): boolean => {
    if (side === 'bottom') return spaceBottom >= safeH + gap;
    if (side === 'top') return spaceTop >= safeH + gap;
    if (side === 'right') return viewport.width >= 640 && spaceRight >= safeW + gap;
    return viewport.width >= 640 && spaceLeft >= safeW + gap;
  };

  let chosen: 'bottom' | 'top' | 'right' | 'left' | null =
    candidates.find((c) => fits(c)) ?? null;

  if (!chosen) {
    // Pick side with largest available vertical space so tooltip stays uncluttered
    chosen = spaceBottom >= spaceTop ? 'bottom' : 'top';
  }

  const targetCenterX = sLeft + (sRight - sLeft) / 2;
  const targetCenterY = sTop + (sBottom - sTop) / 2;

  if (chosen === 'bottom' || chosen === 'top') {
    const left = clamp(
      targetCenterX - safeW / 2,
      edgeMargin,
      viewport.width - safeW - edgeMargin
    );
    const rawTop = chosen === 'bottom' ? sBottom + gap : sTop - safeH - gap;
    const top = clamp(rawTop, edgeMargin, viewport.height - safeH - edgeMargin);
    const arrowOffset = clamp(targetCenterX - left, 24, safeW - 24);
    return {
      top: Math.round(top),
      left: Math.round(left),
      resolvedPlacement: chosen,
      centeredFallback: false,
      arrowOffset: Math.round(arrowOffset),
    };
  }

  const top = clamp(
    targetCenterY - safeH / 2,
    edgeMargin,
    viewport.height - safeH - edgeMargin
  );
  const rawLeft = chosen === 'right' ? sRight + gap : sLeft - safeW - gap;
  const left = clamp(rawLeft, edgeMargin, viewport.width - safeW - edgeMargin);
  const arrowOffset = clamp(targetCenterY - top, 24, safeH - 24);
  return {
    top: Math.round(top),
    left: Math.round(left),
    resolvedPlacement: chosen,
    centeredFallback: false,
    arrowOffset: Math.round(arrowOffset),
  };
}

import { useEffect, useState } from 'react';
import { BoxRect } from '../../core/tutorialPositioning';

interface TutorialSpotlightProps {
  active: boolean;
  targetId: string;
  fallbackTargetIds?: string[];
  padding?: number;
  onRectChange: (rect: BoxRect | null, found: boolean) => void;
}

function isElementVisible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findVisibleTourTarget(
  primaryId: string,
  fallbackIds: string[] = []
): HTMLElement | null {
  if (!primaryId || primaryId === 'center') return null;
  const candidates = [primaryId, ...fallbackIds];
  for (const tourId of candidates) {
    const matches = document.querySelectorAll(`[data-tour-id="${CSS.escape(tourId)}"]`);
    for (const el of Array.from(matches)) {
      if (isElementVisible(el)) {
        return el;
      }
    }
  }
  return null;
}

export function TutorialSpotlight({
  active,
  targetId,
  fallbackTargetIds = [],
  padding = 8,
  onRectChange,
}: TutorialSpotlightProps) {
  const [rect, setRect] = useState<BoxRect | null>(null);
  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const fallbackKey = fallbackTargetIds.join('|');

  useEffect(() => {
    if (!active) {
      setRect(null);
      onRectChange(null, false);
      return;
    }

    if (targetId === 'center') {
      setRect(null);
      onRectChange(null, true);
      return;
    }

    let rafId = 0;
    let resizeObs: ResizeObserver | null = null;
    let observedEl: HTMLElement | null = null;
    let didScrollForStep = false;

    const measure = (allowScroll = false) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setViewport((prev) =>
        prev.width === vw && prev.height === vh ? prev : { width: vw, height: vh }
      );

      const el = findVisibleTourTarget(targetId, fallbackTargetIds);
      if (!el) {
        setRect(null);
        onRectChange(null, false);
        return;
      }

      if (observedEl !== el) {
        resizeObs?.disconnect();
        observedEl = el;
        if (typeof ResizeObserver !== 'undefined') {
          resizeObs = new ResizeObserver(() => scheduleMeasure(false));
          resizeObs.observe(el);
        }
      }

      let domRect = el.getBoundingClientRect();
      if (allowScroll && !didScrollForStep) {
        didScrollForStep = true;
        const outOfView =
          domRect.top < 16 || domRect.bottom > window.innerHeight - 56;
        if (outOfView) {
          const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
          const farOffscreen =
            domRect.top < -180 || domRect.top > window.innerHeight * 1.4;
          const instant = Boolean(reduced || farOffscreen);
          const tallTarget = domRect.height > window.innerHeight * 0.35;
          el.scrollIntoView({
            behavior: instant ? 'auto' : 'smooth',
            block: tallTarget ? 'nearest' : 'center',
            inline: 'nearest',
          });
          if (instant) {
            domRect = el.getBoundingClientRect();
          }
        }
      }

      const nextBox: BoxRect = {
        top: domRect.top,
        left: domRect.left,
        width: domRect.width,
        height: domRect.height,
      };
      setRect(nextBox);
      onRectChange(nextBox, true);
    };

    const scheduleMeasure = (allowScroll = false) => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => measure(allowScroll));
    };

    // Initial measurement & gentle settle measurements after scrollIntoView completes
    scheduleMeasure(true);
    const settleTimer = window.setTimeout(() => scheduleMeasure(false), 320);
    const lateSettleTimer = window.setTimeout(() => scheduleMeasure(false), 560);

    const onViewportChange = () => scheduleMeasure(false);
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('scroll', onViewportChange, { passive: true, capture: true });

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer);
      window.clearTimeout(lateSettleTimer);
      resizeObs?.disconnect();
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, { capture: true });
    };
  }, [active, targetId, fallbackKey, onRectChange]);

  if (!active) return null;

  // Full-screen dimmer for centered steps or missing-target fallback
  if (!rect) {
    return (
      <div
        aria-hidden="true"
        className="no-print fixed inset-0 z-[55] bg-slate-950/60 backdrop-blur-[1px]"
      />
    );
  }

  const holeTop = Math.max(0, Math.round(rect.top - padding));
  const holeLeft = Math.max(0, Math.round(rect.left - padding));
  const holeRight = Math.min(viewport.width, Math.round(rect.left + rect.width + padding));
  const holeBottom = Math.min(viewport.height, Math.round(rect.top + rect.height + padding));
  const holeWidth = Math.max(0, holeRight - holeLeft);
  const holeHeight = Math.max(0, holeBottom - holeTop);

  return (
    <div aria-hidden="true" className="no-print fixed inset-0 z-[55] pointer-events-none">
      {/* 4 translucent panels leave the target cutout unobstructed so clicks pass straight through */}
      <div
        className="fixed left-0 top-0 right-0 bg-slate-950/55 pointer-events-auto"
        style={{ height: `${holeTop}px` }}
      />
      <div
        className="fixed left-0 bg-slate-950/55 pointer-events-auto"
        style={{
          top: `${holeTop}px`,
          width: `${holeLeft}px`,
          height: `${holeHeight}px`,
        }}
      />
      <div
        className="fixed right-0 bg-slate-950/55 pointer-events-auto"
        style={{
          top: `${holeTop}px`,
          left: `${holeRight}px`,
          height: `${holeHeight}px`,
        }}
      />
      <div
        className="fixed left-0 right-0 bottom-0 bg-slate-950/55 pointer-events-auto"
        style={{ top: `${holeBottom}px` }}
      />

      {/* Crisp spotlight frame around the real UI element */}
      <div
        data-testid="tutorial-spotlight-ring"
        className="fixed rounded-xl border-2 border-blue-500 dark:border-blue-400 shadow-[0_0_0_4px_rgba(37,99,235,0.22)] transition-all duration-150 ease-out pointer-events-none"
        style={{
          top: `${holeTop}px`,
          left: `${holeLeft}px`,
          width: `${holeWidth}px`,
          height: `${holeHeight}px`,
        }}
      />
    </div>
  );
}

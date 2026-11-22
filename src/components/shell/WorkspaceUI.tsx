import { useEffect, useRef, useState, type ReactNode } from 'react';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="tos-page-header">
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}
  </div>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="tos-section-header"><h2>{title}</h2>{action}</div>;
}

export function EmptyState({ title }: { title: string }) {
  return <p className="tos-empty">{title}</p>;
}

export function DocumentPreview({ label, widthMm, zoom, children }: {
  label: string; widthMm: number; zoom: number; children: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number>();
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const paperWidth = widthMm * 96 / 25.4;
  const fit = availableWidth ? Math.min(1, availableWidth / paperWidth) : 1;
  return (
    <section ref={frame} className="tos-document-preview min-w-0 overflow-x-auto" aria-label={label}>
      <div className="tos-document-scale" style={{ zoom: fit * zoom / 100 }}>
        {children}
      </div>
    </section>
  );
}

export function ProgressIndicator<Step extends number>({ label, active, steps, onSelect, tourId }: {
  label: string; active: Step; steps: { id: Step; label: string; disabled?: boolean }[];
  onSelect: (step: Step) => void; tourId?: string;
}) {
  return (
    <nav aria-label={label} data-tour-id={tourId}>
      <ol className="tos-stepper">{steps.map((step) => (
        <li key={step.id}>
          <button type="button" onClick={() => onSelect(step.id)} disabled={step.disabled}
            aria-current={active === step.id ? 'step' : undefined}>
            <span aria-hidden="true">{step.id}. </span>{step.label}
          </button>
        </li>
      ))}</ol>
    </nav>
  );
}

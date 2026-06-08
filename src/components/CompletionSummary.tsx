import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clock } from "lucide-react";

function useAnimatedValue(target: number, durationMs: number): number {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) {
      setValue(0);
      return;
    }
    startRef.current = null;
    let cancelled = false;

    const step = (timestamp: number) => {
      if (cancelled) return;
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}

function formatElapsed(totalMs: number): string {
  const totalSec = totalMs / 1000;
  if (totalSec < 60) {
    return `${totalSec.toFixed(1)}s`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec % 60);
  if (min < 60) {
    return `${min}m ${sec}s`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

function AnimatedMetricItem({
  icon,
  template,
  count,
  small,
}: {
  icon: ReactNode;
  template: string;
  count: number;
  small?: boolean;
}) {
  const animated = useAnimatedValue(count, 600);
  const display = template.replace("{n}", String(animated));
  return (
    <span className="cs-metric">
      <span className={`cs-metric-icon ${small ? "cs-metric-icon--sm" : ""}`}>
        {icon}
      </span>
      <span className={small ? "cs-metric-text--sm" : ""}>{display}</span>
    </span>
  );
}

function MetricsRow({ items, small }: { items: MetricItem[]; small?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={`cs-metrics-row ${small ? "cs-metrics-row--secondary" : "cs-metrics-row--primary"}`}>
      {items.map((m) => (
        <AnimatedMetricItem key={m.template} {...m} small={small} />
      ))}
    </div>
  );
}

export interface MetricItem {
  icon: ReactNode;
  /** Template with `{n}` for the animated count, e.g. `"{n} 个模组"` or `"词典 {n}"` */
  template: string;
  count: number;
}

interface Props {
  title: string;
  elapsedMs: number;
  primaryMetrics?: MetricItem[];
  secondaryMetrics?: MetricItem[];
}

export function CompletionSummary({
  title,
  elapsedMs,
  primaryMetrics,
  secondaryMetrics,
}: Props) {
  const [show, setShow] = useState(false);
  const animatedElapsed = useAnimatedValue(Math.round(elapsedMs), 600);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`cs-card ${show ? "cs-card--visible" : ""}`}>
      <div className="cs-header">
        <span className="cs-title">{title}</span>
        <span className="cs-elapsed">
          <Clock size={15} className="cs-elapsed-icon" />
          <span className="cs-elapsed-value">{formatElapsed(animatedElapsed)}</span>
        </span>
      </div>

      <div className="cs-divider" />

      <MetricsRow items={primaryMetrics ?? []} />
      <MetricsRow items={secondaryMetrics ?? []} small />
    </div>
  );
}

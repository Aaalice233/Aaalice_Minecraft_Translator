import { useEffect, useRef, useState } from "react";

interface Props {
  /** Target value to count up to */
  value: number;
  /** Duration in ms (default 800) */
  duration?: number;
  /** CSS class for the count element */
  className?: string;
}

/**
 * Animated counter — counts from 0 → value on mount.
 * Re-triggers when `value` changes.
 */
export const AnimatedCount = ({ value, duration = 800, className }: Props) => {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number>(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (value === display) return;

    fromRef.current = display;
    startRef.current = null;

    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const t = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(
        fromRef.current + (value - fromRef.current) * eased,
      );
      setDisplay(current);

      if (t < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplay(value);
      }
    };

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(frameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span className={className}>{display}</span>;
};

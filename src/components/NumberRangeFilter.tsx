import { useEffect, useRef } from "react";
import type { NumberRange } from "./SortableTableHeader";

interface NumberRangeFilterProps {
  value: NumberRange | undefined;
  onChange: (value: NumberRange | null) => void;
  minLabel: string;
  maxLabel: string;
}

/**
 * Number range filter with native wheel handling.
 *
 * Uses ref + addEventListener({ passive: false }) to bypass React's
 * passive onWheel, allowing preventDefault() to actually stop the
 * page from scrolling when the user wheels on the number input.
 */
export function NumberRangeFilter({
  value,
  onChange,
  minLabel,
  maxLabel,
}: NumberRangeFilterProps) {
  const current = value ?? {};
  const minRef = useRef<HTMLInputElement>(null);
  const maxRef = useRef<HTMLInputElement>(null);

  // Non-passive wheel handler factory
  function useNativeWheel(
    ref: React.RefObject<HTMLInputElement | null>,
    getCurrent: () => number | undefined,
    setValue: (n: number | undefined) => void,
  ) {
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const handler = (e: WheelEvent) => {
        if (el !== document.activeElement) return;
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const cur = getCurrent() ?? 0;
        const next = Math.max(0, cur + dir);
        if (next !== cur) {
          setValue(next);
        }
      };
      el.addEventListener("wheel", handler, { passive: false });
      return () => el.removeEventListener("wheel", handler);
    }, [ref, getCurrent, setValue]);
  }

  useNativeWheel(
    minRef,
    () => current.min,
    (n) => onChange(n === undefined && current.max === undefined ? null : { min: n, max: current.max }),
  );

  useNativeWheel(
    maxRef,
    () => current.max,
    (n) => onChange(n === undefined && current.min === undefined ? null : { min: current.min, max: n }),
  );

  return (
    <div>
      <div className="number-range-row">
        <span>{minLabel}</span>
        <input
          ref={minRef}
          type="number"
          min={0}
          value={current.min ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            const n = v === "" ? undefined : Number(v);
            onChange(n === undefined && current.max === undefined ? null : { min: n, max: current.max });
          }}
          placeholder="-"
          autoFocus
        />
      </div>
      <div className="number-range-row">
        <span>{maxLabel}</span>
        <input
          ref={maxRef}
          type="number"
          min={0}
          value={current.max ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            const n = v === "" ? undefined : Number(v);
            onChange(n === undefined && current.min === undefined ? null : { min: current.min, max: n });
          }}
          placeholder="-"
        />
      </div>
    </div>
  );
}

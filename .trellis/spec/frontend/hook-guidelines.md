# Hook Guidelines

> How hooks are used in this project.

---

## Overview

Custom hooks encapsulate **stateful logic** shared between components.
All custom hooks live in `src/hooks/`. The project uses standard React hooks
(`useState`, `useEffect`, `useCallback`, `useMemo`, `useRef`) extensively.

---

## Existing Custom Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useDebouncedValue<T>` | `src/hooks/useDebouncedValue.ts` | Returns debounced copy of a value after `delay` ms of inactivity |
| `useSortFilter<F>` | `src/hooks/useSortFilter.ts` | Shared sort + filter state management with click-outside detection |

---

## Custom Hook Patterns

### Pattern: Generic value transformation (useDebouncedValue)

```tsx
// src/hooks/useDebouncedValue.ts
import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms
 * of inactivity. Useful for filter/search inputs to avoid re-rendering
 * expensive lists on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
```

### Pattern: Complex state management (useSortFilter)

```tsx
// src/hooks/useSortFilter.ts
export function useSortFilter<F extends Record<string, any> = Record<string, string>>() {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [filters, setFilters] = useState<F>({} as F);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const handleSort = useCallback((column: string) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== column) return { key: column, direction: "asc" };
      if (prev.direction === "asc") return { key: column, direction: "desc" };
      return null; // third click → clear sort
    });
    setOpenFilter(null);
  }, []);

  // Click-outside listener for filter popovers
  useEffect(() => {
    if (!openFilter) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openFilter]);

  return { sortConfig, filters, openFilter, filterRef, handleSort, ... };
}
```

---

## Naming Conventions

| Convention | Rule | Example |
|-----------|------|---------|
| Hook naming | Must start with `use` | `useDebouncedValue`, `useSortFilter` |
| File naming | camelCase matching hook name | `useDebouncedValue.ts` |
| Return value | Object destructuring for multi-value hooks | `const { sortConfig, filters, ... } = useSortFilter()` |
| Generic hooks | Use descriptive type params | `<T>` for value type, `<F>` for filter shape |
| State accessors | Prefix with `handle` for event callbacks | `handleSort`, `handleFilterChange` |

---

## How Data Fetching Works

This project does NOT use React Query, SWR, or similar data-fetching libraries.
Data fetching is done through:

1. **Tauri commands** via `src/api/tauri.ts` — all calls are async functions
2. **Event listeners** via `@tauri-apps/api/event` — for progress events (scan-progress, translate-log-entries)
3. **Zustand store** — for persisting results after fetch

```tsx
// Event listener pattern (from DashboardPage.tsx)
useEffect(() => {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  let unlistenFn: (() => void) | null = null;
  let cancelled = false;

  import("@tauri-apps/api/event").then(({ listen }) => {
    if (cancelled) return;
    listen("scan-progress", (event) => {
      setScanProgress(event.payload as ScanProgressEvent);
    }).then((unlisten) => { unlistenFn = unlisten; });
  });

  return () => {
    cancelled = true;
    unlistenFn?.();
  };
}, []);
```

---

## Hook Usage Patterns in Pages

### Standard page flow (DashboardPage.tsx)

```tsx
export const DashboardPage = React.memo(forwardRef<DashboardPageHandle, Props>(
  function DashboardPage(props, ref) {
    // ── Local state ──
    const [instancePath, setInstancePath] = useState(settings.instancePath);
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
    const [error, setError] = useState("");

    // ── Refs for stable references ──
    const isScanningRef = useRef(isScanning);
    useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);

    // ── Shared hooks ──
    const debouncedSearch = useDebouncedValue(searchText, 200);
    const sf = useSortFilter();

    // ── Derived state via useMemo ──
    const processedMods = useMemo(() => {
      // filter + sort logic
    }, [scanSummary?.mods, sf.sortConfig, sf.filters]);

    // ── Callbacks ──
    const handleCancel = useCallback(async () => { ... }, [...]);

    // ── Imperative handle (for parent control) ──
    useImperativeHandle(ref, () => ({ cancelScan: handleCancel }), [handleCancel]);

    // ── Effects ──
    useEffect(() => { /* Tauri event listener */ }, []);

    // ── Render ──
    return ( ... );
  }
));
```

---

## Common Mistakes to Avoid

- **DO NOT** create hooks that directly import from Tauri — all Tauri calls go through `src/api/tauri.ts`
- **DO NOT** put async data fetching logic directly in component body — use `useEffect` or callbacks
- **DO NOT** create a new hook if the logic is only used once — inline it in the component instead
- **DO NOT** put hooks in `src/components/` or `src/pages/` — they belong in `src/hooks/`
- **DO NOT** use `useState` for derived state — use `useMemo` instead
- **AVOID** `useEffect` for state synchronization between related values — compute from existing state
- **DO** include JSDoc comments on every custom hook explaining its purpose and parameters

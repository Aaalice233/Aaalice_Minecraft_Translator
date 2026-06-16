# State Management

> How state is managed in this project.

---

## Overview

This project uses **Zustand** for global state management, with `zustand/middleware`'s `persist` for selective persistence.
The old `AppContext` (React Context-based) is being deprecated — all new shared state should go into Zustand.

---

## State Categories

| Category | Where | Persistence | Examples |
|----------|-------|-------------|---------|
| **Global persistent** | `useAppStore` + `persist`/`partialize` | localStorage `app-store` | `scanElapsedMs`, `translateElapsedMs` |
| **Global ephemeral** | `useAppStore` (no persist) | None | `settings`, `scanSummary`, `translationJobId`, `navStates`, `reviewCount` |
| **Page-local** | `useState` in page components | None | `instancePath`, `isScanning`, `searchText`, `error` |
| **Derived** | `useMemo` | None | `processedMods`, `pendingCache`, `stats` |
| **Stable refs** | `useRef` | None | `isScanningRef`, `filterRef`, `dataRef` |
| **URL/routing** | Implicit (hash or Tauri window) | None | Current page key |

---

## Zustand Store Pattern

### Store structure (src/stores/appStore.ts)

```tsx
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PageNavStatus, ScanSummary, Settings } from "../types";

export type PageKey = "dashboard" | "jobs" | "validate" | "dictionary" | "packages" | "settings" | "logs";

interface AppState {
  // — Persistent state (only select fields are actually persisted) —
  settings: Settings | null;
  scanSummary: ScanSummary | null;
  navStates: Partial<Record<PageKey, PageNavStatus>>;

  // — Translation job state —
  translationJobId: string | null;
  translationStatus: TranslationPageStatus;
  translationResult: number | null;
  translationError: string;

  // — Elapsed time for completion summaries —
  scanElapsedMs: number | null;
  translateElapsedMs: number | null;

  // — Review coordination (version counter for cross-page sync) —
  reviewCount: number;

  // — Actions (always functions on the state interface) —
  setSettings: (s: Settings) => void;
  setScanSummary: (s: ScanSummary | null) => void;
  setNavState: (key: PageKey, status: PageNavStatus) => void;
  // ...
}
```

### Creating and using the store

```tsx
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      settings: null,
      scanSummary: null,
      navStates: {},
      // ...

      // Actions — simple setters
      setSettings: (s) => set({ settings: s }),

      // Complex actions — use (state) => pattern for partial updates
      setNavState: (key, status) =>
        set((state) => {
          if (state.navStates[key] === status) return state; // skip if no change
          return { navStates: { ...state.navStates, [key]: status } };
        }),

      setTranslationStatus: (status, result, error) =>
        set((state) => ({
          translationStatus: status,
          translationResult: result !== undefined ? result : state.translationResult,
          translationError: error !== undefined ? error : state.translationError,
        })),
    }),
    {
      name: "app-store",
      // Selective persistence via partialize
      partialize: (state) => ({
        scanElapsedMs: state.scanElapsedMs,
        translateElapsedMs: state.translateElapsedMs,
      }),
    },
  ),
);
```

### Usage in components

```tsx
// Selector pattern — subscribe to specific slices
const settings = useAppStore((s) => s.settings);
const setScanSummary = useAppStore((s) => s.setScanSummary);
const scanElapsedMs = useAppStore((s) => s.scanElapsedMs);
```

---

## Local State vs Global State Rules

### Use global state (Zustand) when:

- State is needed by **multiple pages** (e.g. `scanSummary` used by both DashboardPage and JobsPage)
- State must **survive page navigation** (e.g. translation job state)
- State should be **persisted across app restarts** (e.g. elapsed time counters)
- State coordinates **cross-page** behavior (e.g. `reviewCount` for review marking sync)

### Use local state (useState) when:

- State is only relevant to **one page or component** (e.g. `isScanning` in DashboardPage)
- State is a **temporary UI concern** (e.g. `expanded` for collapsible sections)
- State is an **uncontrolled form input** (e.g. local search text before debounce)

### Use derived state (useMemo) when:

- Value is computed from existing state (e.g. filtered/sorted mod lists)
- A cache/memo is needed for performance (e.g. `pendingCache`)

---

## Cross-Page State Coordination

### Pattern: Version counter for invalidation

The `reviewCount` counter in the Zustand store is used to signal to other pages (e.g. PackagesPage) that the validation state has changed and cached data should be refreshed.

```tsx
// In ValidatePage — increment on review
setReviewCount(reviewCount + 1);

// In PackagesPage — watch for changes
const reviewCount = useAppStore((s) => s.reviewCount);
useEffect(() => {
  if (reviewCount > 0) loadTranslationJob();
}, [reviewCount]);
```

---

## Server State

This project does NOT have a remote server. All data is local:
- **Minecraft instance files** scanned from disk via Tauri commands
- **SQLite database** managed by Rust backend (dictionary, translation jobs)
- **Settings** persisted both by Rust (`tauri-plugin-store`) and Zustand browser fallback

The API layer (`src/api/tauri.ts`) provides:
- Consistent Tauri command wrappers
- Browser preview mode fallbacks (mock data or `localStorage`)
- Lazy import of `@tauri-apps` modules (avoids Vite issues)

---

## Common Mistakes to Avoid

- **DO NOT** add new state to `AppContext` — use Zustand instead
- **DO NOT** subscribe to the entire store — use selectors: `useAppStore((s) => s.settings)`
- **DO NOT** store derived data in state — compute it with `useMemo`
- **DO NOT** persist large data in Zustand (e.g. full scan results) — persist only lightweight state
- **DO NOT** use Zustand for transient UI state (modal open/close, hover effects) — use local `useState`
- **DO NOT** mutate state directly — always use the setter functions
- **DO** use `partialize` to limit what gets persisted to localStorage

# Type Safety

> Type safety patterns in this project.

---

## Overview

This project uses **TypeScript** with strict type checking.
Types are organized in a single shared file (`src/types.ts`) and inline per-module.

**Critical constraint**: The frontend types in `src/types.ts` must stay in sync with
the Rust backend types in `src-tauri/src/core/models.rs`. Both sides use
`#[serde(rename_all = "camelCase")]` for consistent JSON field naming.

---

## Type Organization

### Shared types file: `src/types.ts`

All types that cross the Tauri IPC boundary are defined here.
The file is organized into sections with section markers:

```tsx
// ═══════════════════════════════════════════════════════════
// ⚠️ TYPE SYNC: These interfaces must stay in sync with
// src-tauri/src/core/models.rs (Rust side). Both use
// #[serde(rename_all = "camelCase")] for field naming.
// When adding/changing a field here, update models.rs too.
// ═══════════════════════════════════════════════════════════

// ── P1: Settings & Scan types ───────────────────────────────
export interface Settings { ... }
export interface ModScanResult { ... }
export interface ScanSummary { ... }

// ── P2: Dictionary types ──────────────────────────────────
export interface DictionaryEntry { ... }
export interface DictionaryStats { ... }

// ── P3: Translation types ─────────────────────────────────
export type PipelinePhase = "scanning" | "extracting" | "dictionary" | "translating" | "completed";
export interface TranslateProgress { ... }

// ── P4: Pack types ─────────────────────────────────────────────────
export interface PackEntry { ... }
export interface PackResult { ... }

// ── P5: Translation job state types (new pipeline) ────────────────
export interface TranslationJobState { ... }

// ── P6: Validation types ──────────────────────────────────────────
export interface ValidationReport { ... }
```

### Local types

Types that are only relevant to a single component or page are defined inline:

```tsx
// In SortableTableHeader.tsx — local types specific to this component
export interface ColumnConfig { ... }
export interface SortConfig { ... }
export interface FilterContentProps { ... }

// In appStore.ts — store-specific types
export type PageKey = "dashboard" | "jobs" | "validate" | ...;
```

### Module-external type exports

When a type is used across multiple components, export it from the defining module:

```tsx
// SortableTableHeader.tsx — exported for reuse
export type NumberRange = { min?: number; max?: number };
export interface ColumnConfig { ... }
export interface SortConfig { ... }

// TranslationEditPanel.tsx — exported for use in both ValidatePage and DictionaryPage
export interface EditPanelEntry { ... }
```

---

## Type Conventions

| Situation | Convention | Example |
|-----------|-----------|---------|
| Rust-synced data model | `interface` in `types.ts` | `interface Settings { ... }` |
| Union of string literals | `type` | `type PipelinePhase = "scanning" | "extracting" | ...` |
| Complex discriminated union | `type` with object literal types | `type PipelineErrorType = { type: "config"; message: string } | { type: "cancelled" }` |
| Component props | `interface` in component file | `interface DataTableProps<T> { ... }` |
| State shape | `interface` in store file | `interface AppState { ... }` |
| Reusable config object | `interface` exported | `export interface ColumnConfig { ... }` |
| Optional fields | `?` modifier | `subtitle?: string` |
| Read-only | `readonly` for array fields | `readonly items: string[]` |

### Interface vs Type

- **Use `interface`** for: props, data models, store state, config objects
- **Use `type`** for: unions, intersection types, literal types, discriminated unions

```tsx
// GOOD — interface for data models
export interface Settings {
  appLanguage: AppLanguage;
  sourceLanguage: string;
  // ...
}

// GOOD — type for unions
export type AppLanguage = "zh_cn" | "en_us" | "ja_jp" | "ko_kr" | "ru_ru";
export type TranslationStatus = "pending" | "running" | "paused" | "completed" | "reviewed" | "failed" | "cancelled";

// GOOD — discriminated union for variant errors
export type PipelineErrorType =
  | { type: "config"; message: string }
  | { type: "io"; message: string }
  | { type: "cancelled" }
  | { type: "internal"; message: string };
```

---

## Generics

Use generics for reusable components and hooks:

```tsx
// Generic data table — T is the row type
export interface DataTableProps<T> {
  data: T[];
  columns: ColumnConfig[];
  renderRow: (item: T, index: number) => React.ReactNode;
}

// Generic hook — T is the value type, F is the filter type
export function useDebouncedValue<T>(value: T, delay: number): T;
export function useSortFilter<F extends Record<string, any> = Record<string, string>>();
```

---

## Type Inference

Prefer type inference when the type is obvious:

```tsx
// GOOD — let TypeScript infer the type
const [isScanning, setIsScanning] = useState(false); // inferred as boolean

// GOOD — explicit when the initial value doesn't cover all states
const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
```

---

## Validation

There is no Zod or runtime validation library on the frontend.
Type validation relies on:

1. **TypeScript compile-time checks** — all IPC types are interfaces
2. **Rust backend validation** — settings, instance paths, and API inputs are validated server-side
3. **Manual checks** — `isTauriRuntime()` guard, try/catch around Tauri invocations

```tsx
async function validateInstance(path: string): Promise<InstanceValidation> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode");
  }
  return tauriInvoke<InstanceValidation>("validate_instance", { path });
}
```

---

## Forbidden Patterns

### ❌ `any` type

`any` is **never** used in the codebase. Prefer `unknown` if the type is truly unknown,
then narrow with type guards or casts.

```tsx
// DON'T
function process(data: any) { ... }

// DO — use unknown + narrowing
function process(data: unknown) {
  if (isValidData(data)) { ... }
}
```

### ❌ Type assertions (`as`)

Type assertions are avoided. Prefer proper type annotations and generics.

### ❌ `// @ts-ignore` or `// @ts-nocheck`

These are not used. Prefer proper type definitions or explicit `eslint-disable` for lint issues.

### ❌ String literal types without a type alias

```tsx
// DON'T — inline string literals repeated in multiple places
function foo(status: "running" | "completed" | "failed") { ... }

// DO — create a type alias
type StageStatus = "running" | "completed" | "failed";
```

---

## Keeping Types in Sync

The `types.ts` file has explicit comments marking sync boundaries with Rust:

```tsx
// ⚠️ TYPE SYNC: These interfaces must stay in sync with
// src-tauri/src/core/models.rs (Rust side). Both use
// #[serde(rename_all = "camelCase")] for field naming.
// When adding/changing a field here, update models.rs too.
```

When changing data models:
1. Update `src/types.ts` (frontend TypeScript)
2. Update `src-tauri/src/core/models.rs` (Rust backend) — using `#[serde(rename_all = "camelCase")]`
3. Update `src/api/tauri.ts` if the invoke command signature changed
4. Run both `npm run test:unit` and `npm run test:rust` to verify

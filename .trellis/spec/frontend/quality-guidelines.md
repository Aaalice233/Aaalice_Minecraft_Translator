# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

This project follows a practical approach to code quality:
- **TypeScript** provides compile-time type safety
- **ESLint** catches common issues (selective rule disable via inline comments, not config overrides)
- **Manual code review** catches logic errors and design issues
- **npm build** must pass before committing

---

## Forbidden Patterns

### ❌ Class components
Only function components with hooks. No class-based React components.

### ❌ Direct Tauri imports in components
All Tauri API calls go through `src/api/tauri.ts`. Do not import `@tauri-apps/api/core` directly from components or pages.

### ❌ UI strings in component code
All user-facing text must be added to `src/i18n/translations.ts` and accessed via the `t()` function.

### ❌ `any` type
Never use `any`. Use `unknown` with proper narrowing, or define an explicit interface/type.

### ❌ `// @ts-ignore` / `// @ts-nocheck`
Never suppress TypeScript errors. If there's a genuine type issue, handle it properly.

### ❌ `any` for props
Props must have explicit interfaces. Never use `props: any`.

### ❌ Mutating state directly
Never mutate Zustand state or React state directly — always use setter functions.

### ❌ `console.log` in production code
Use the application's logging system (Rust backend logs) for persistent logging.
`console.warn`/`console.error` are acceptable for catch-block diagnostics.

### ❌ New state in AppContext
The old `AppContext` is being deprecated. Add new shared state to Zustand.

---

## Required Patterns

### ✅ Named exports
All components, hooks, and utilities use named exports, not default exports.

```tsx
// GOOD
export function DataTable<T>(props: DataTableProps<T>) { ... }

// DON'T
export default function DataTable<T>(props: DataTableProps<T>) { ... }
```

### ✅ JSDoc for custom hooks
Every custom hook must have a JSDoc comment explaining its purpose, parameters, and return value.

### ✅ Type sync comments
Data models shared between frontend (`types.ts`) and backend (`models.rs`) must have sync comments at the file level.

### ✅ i18n for all UI text
Every user-facing string must go through the `t()` function with a translation key.

### ✅ Consistent imports grouping
External imports first (React, lucide-react, libraries), then internal imports (hooks, components, api, types), grouped by category.

### ✅ Composable components over monolithic pages
Extract reusable UI patterns into `src/components/` rather than duplicating in page files.

### ✅ Table layout is always fixed
HTML tables must use `table-layout: fixed` with explicit `colWidths` to prevent overflow.

---

## Testing Requirements

### Frontend unit tests
```bash
npm run test:unit
```
Runs Vitest tests for frontend logic.

### Rust backend tests
```bash
npm run test:rust
```
Runs `cargo test` for Rust backend logic.

### When to test what

| Change type | Required verification |
|-------------|----------------------|
| New component | Visual inspection, build must pass |
| New API call | Mock data in browser mode, verify in Tauri |
| Data model change | Both `test:unit` and `test:rust` |
| Settings change | Frontend type `types.ts` + backend `settings.rs` |
| Translation pipeline | Rust tests, full manual pipeline test |
| UI string change | Visual inspection of all affected languages |
| Refactoring | At least `npm run build` |

### Build verification
```bash
npm run build    # Must pass before any commit
```

---

## Code Review Checklist

Before submitting changes for review (whether human or AI):

### General
- [ ] Does the code follow the established patterns (components, hooks, pages)?
- [ ] Are all console.log statements removed?
- [ ] Are there no `any` types that should be explicit?
- [ ] Does `npm run build` pass?
- [ ] Are new UI strings in `src/i18n/translations.ts`?

### i18n
- [ ] Are all user-facing strings using `t()` with a translation key?
- [ ] Is the translation key added to ALL language maps (zh_cn, en_us, at minimum)?
- [ ] Do template variables match (`{count}`, `{name}`, etc.) across languages?

### State management
- [ ] Is the state scoped correctly (local useState vs Zustand)?
- [ ] Is derived state using `useMemo` instead of `useState`?
- [ ] No new state added to `AppContext`?

### Type safety
- [ ] Are IPC types synchronized between `types.ts` and `models.rs`?
- [ ] Are new types properly organized (shared vs local)?
- [ ] Are discriminated unions used for variant states?

### Error handling
- [ ] Are async operations wrapped in try/catch?
- [ ] Do API calls handle the browser preview mode (`isTauriRuntime()`)?
- [ ] Are error messages shown to the user via the UI (not just console)?

### Performance
- [ ] Are expensive computations wrapped in `useMemo`?
- [ ] Are event handlers wrapped in `useCallback` if passed to child components?
- [ ] Is `React.memo` considered for frequently re-rendered components?
- [ ] Are Tauri event listeners properly cleaned up on unmount?

---

## AI Coding Standards

When AI generates code for this project:

- **Read existing files first** before modifying them to understand the context and patterns
- **Match the surrounding code style** — comment density, naming conventions, import style
- **Do not introduce new patterns** unless the PRD explicitly requires them
- **Do not remove comments** that explain why something is done a certain way
- **Respect the `isTauriRuntime()` guard** — all API functions must work in browser preview mode or fail gracefully

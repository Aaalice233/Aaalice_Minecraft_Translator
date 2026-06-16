# Directory Structure

> How frontend code is organized in this project.

---

## Overview

This project (Aaalice Minecraft Translator) is a Tauri v2 desktop application.
The frontend is built with React + TypeScript + Vite. All frontend source code lives under `src/`.

The layout follows a **feature-based** page structure with **shared components and utilities** extracted to common directories.

---

## Directory Layout

```
src/
├── api/                    # Tauri command wrappers (API layer)
│   └── tauri.ts            #   Lazy Tauri invoke + browser mock fallbacks
├── app/                    # App shell & legacy Context
│   └── ...                 #   App component, old AppContext (being migrated to Zustand)
├── components/             # Shared reusable UI components
│   ├── AnimatedCount.tsx       # 0→value animated counter
│   ├── CompletionSummary.tsx   # Scan/translate completion card
│   ├── DataTable.tsx           # Virtual-scrolled data table (TableVirtuoso)
│   ├── Field.tsx               # Label + input field
│   ├── NumberRangeFilter.tsx   # Min/max number range filter popover
│   ├── PageHeader.tsx          # Page title + subtitle + actions toolbar
│   ├── SearchInput.tsx         # Debounced search input with clear button
│   ├── SortableTableHeader.tsx # Column sort + filter popover header
│   ├── SplashScreen.tsx        # App startup splash/loading screen
│   ├── Toggle.tsx              # CSS sliding toggle switch
│   └── TranslationEditPanel.tsx # Modal editor for translation entries
├── hooks/                  # Shared custom React hooks
│   ├── useDebouncedValue.ts    # Generic debounce hook
│   └── useSortFilter.ts        # Sort + filter state management
├── i18n/                   # Internationalization
│   └── translations.ts     #   All UI text strings (5 languages)
├── pages/                  # Feature pages (one file per route)
│   ├── DashboardPage.tsx       # Scan instance + mod list
│   ├── DictionaryPage.tsx      # Dictionary CRUD
│   ├── JobsPage.tsx            # Translation job management
│   ├── LogsPage.tsx            # Application log viewer
│   ├── PackagesPage.tsx        # Resource pack generation
│   ├── SettingsPage.tsx        # Settings with tabs
│   └── ValidatePage.tsx        # Translation review workbench
├── stores/                 # Zustand state stores
│   └── appStore.ts         #   Global application store (with persist)
├── styles/                 # Global CSS
│   └── app.css             #   All styles (CSS custom properties + data-theme)
├── types.ts                # All shared TypeScript types/interfaces
└── ...                     # App entry, routing, etc.
```

---

## Module Organization

### Pages (route-level)

Each page is a single file in `src/pages/` named `[Name]Page.tsx`.
Pages follow these conventions:
- **Props**: `interface Props` defined at top of file with the pattern `{ settings?, scanSummary?, language, ... }`
- **Export**: Named export, e.g. `export const DashboardPage`
- **Imperative handles**: `export interface [Name]PageHandle`, exposed via `forwardRef` + `useImperativeHandle` (see `DashboardPage.tsx:106-110`)
- **Page composition**: Pages compose shared components (`PageHeader`, `DataTable`, `SearchInput`, etc.)

### Components (shared reusable)

Components live in `src/components/` and are **named exports**, one component per file.
- Props interface named `[ComponentName]Props` or `Props` (file-local)
- All components are **function components** only
- See `src/components/DataTable.tsx`, `src/components/SortableTableHeader.tsx` as key reusable patterns

### Hooks

Custom hooks live in `src/hooks/`, named `use[CamelCase].ts`.
- Each hook is a named export
- Generic hooks accept type parameters (e.g. `useDebouncedValue<T>`, `useSortFilter<F>`)
- Hooks always include JSDoc comments explaining their purpose

### Stores

Shared global state in `src/stores/`, using Zustand.
- Currently one store: `appStore.ts` → `useAppStore`
- Old `AppContext` is being migrated to Zustand; do NOT add new state to `AppContext`

### API Layer

All Tauri backend calls go through `src/api/tauri.ts`.
- Every function checks `isTauriRuntime()` at the top
- Returns mock/fallback values in browser preview mode
- Each function wraps `tauriInvoke<T>(command, args?)`
- Naming: verb-based, camelCase (`scanInstance`, `getSettings`, `saveSettings`)

---

## File and Folder Naming Conventions

| Entity | Convention | Example |
|--------|-----------|---------|
| Component file | PascalCase `.tsx` | `DataTable.tsx`, `SplashScreen.tsx` |
| Hook file | camelCase `.ts` | `useDebouncedValue.ts` |
| Page file | PascalCase `.tsx` | `DashboardPage.tsx` |
| Store file | camelCase `.ts` | `appStore.ts` |
| API file | camelCase `.ts` | `tauri.ts` |
| Type file | camelCase `.ts` | `types.ts` (shared), inline for module-specific |
| CSS file | camelCase `.css` | `app.css` |
| Directory | lowercase | `components/`, `hooks/`, `stores/` |

---

## What NOT to Do

- **Do not** create deeply nested component directories — all shared components are flat in `src/components/`
- **Do not** mix pages and components — pages go in `src/pages/`, components in `src/components/`
- **Do not** put state logic in page files — extract to hooks or stores
- **Do not** add new state to `AppContext` — use Zustand instead
- **Do not** put UI strings in component files — add to `src/i18n/translations.ts`
- **Do not** create `utils/` or `lib/` directories — shared logic belongs in hooks or inline in components/pages

---

## Examples

Well-organized modules to reference:
- `src/pages/DashboardPage.tsx` — standard page pattern with scan, progress, table, and composition of `PageHeader`, `SearchInput`, `SortableTableHeader`, `CompletionSummary`
- `src/components/TranslationEditPanel.tsx` — complex component with portal, keyboard shortcuts, focus trapping, and async operations
- `src/api/tauri.ts` — consistent API layer with Tauri/browser dual-mode

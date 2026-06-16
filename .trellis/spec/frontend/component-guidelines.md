# Component Guidelines

> How components are built in this project.

---

## Overview

This project uses **React function components only** (no class components).
Components are organized into two categories:

1. **Reusable UI components** in `src/components/` — shared across pages
2. **Page-level components** in `src/pages/` — one per route

---

## Component Structure

### Standard component file layout

```tsx
// 1. Imports (external first, then internal, grouped by type)
import { IconName } from "lucide-react";
import { useCallback, useState } from "react";
import { t } from "../i18n/translations";
import type { SomeType } from "../types";

// 2. Props interface (local to file, named "Props" for simple components)
interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

// 3. Component function (named export)
export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-header-button">{actions}</div>}
    </div>
  );
}
```

### Complex component layout (see `TranslationEditPanel.tsx`)

```tsx
// 1. Imports
// 2. Shared types section with `// ── Types ──` separator
export interface EditPanelEntry { ... }

// 3. Props interface
export interface TranslationEditPanelProps { ... }

// 4. Component with internal sections (// ── State ──, // ── Handlers ──, etc.)
export function TranslationEditPanel({ ... }: TranslationEditPanelProps) {
  // ── State ──
  const [currentKey, setCurrentKey] = useState(initialKey);

  // ── Derived ──
  const currentIndex = useMemo(...);

  // ── Handlers ──
  const handleSave = useCallback(async () => { ... }, [...]);

  // ── Render ──
  return ( ... );
}
```

---

## Props Conventions

### Props interface pattern

- **Simple components**: define `interface Props` locally in the file (e.g. `Field.tsx`, `Toggle.tsx`)
- **Components with shared usage**: define and export a named interface (e.g. `DataTableProps`, `TranslationEditPanelProps`)
- **Page components**: define `interface Props` at the top (e.g. `DashboardPage.tsx:21`)
- **Sub-components within a file**: define inline local interfaces or use generics

### Props typing rules

```tsx
// GOOD — explicit interface, optional props marked with ?
interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
}

// GOOD — generic props for reusable tables
export interface DataTableProps<T> {
  data: T[];
  columns: ColumnConfig[];
  renderRow: (item: T, index: number) => React.ReactNode;
}

// GOOD — ReactNode for render slots
interface PageHeaderProps {
  title: string;
  actions?: ReactNode;
}

// DON'T — inline anonymous types in function signature
export function Bad({ title, onChange }: { title: string; onChange: () => void }) { ... }
```

### Common prop patterns

| Pattern | Usage | Example |
|---------|-------|---------|
| `language: AppLanguage` | All pages receive language for i18n | `DashboardPage.tsx` |
| `on[Verb]` | Callback props | `onChange`, `onSave`, `onClose` |
| `on[Event]Change` | Event handlers | `onSettingsChange`, `onScanSummaryChange` |
| `data-tooltip` | Tooltip attribute (not a prop, but standard pattern) | `data-tooltip={t(lang, "tooltip.filter")}` |
| `className` | Styling extension slot | Optional string prop in many components |

---

## Composition Patterns

### Page composition

Pages compose components via imports. Pattern from `DashboardPage.tsx`:

```tsx
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { SortableTableHeader } from "../components/SortableTableHeader";
import { CompletionSummary } from "../components/CompletionSummary";
```

### Render slots via `actions` prop

```tsx
<PageHeader
  title={title}
  subtitle={subtitle}
  actions={
    <div className="dashboard-actions">
      <button>{t(lang, "dashboard.scan")}</button>
    </div>
  }
/>
```

### Row wrapper pattern (DataTable)

`DataTable` supports an optional `RowWrapper` prop for custom row behavior:

```tsx
<DataTable
  data={items}
  columns={columns}
  RowWrapper={({ item, children, ...rest }) =>
    <tr {...rest} onClick={() => handleClick(item)}>{children}</tr>
  }
/>
```

### Portal pattern for modals

The `TranslationEditPanel` uses `createPortal` to render modals:

```tsx
return createPortal(
  <div className="edit-panel-overlay">{/* modal content */}</div>,
  document.body,
);
```

---

## Performance Patterns

- **`React.memo`** for components that receive the same props frequently (see `DashboardPage`, `ModRow`)
- **`forwardRef` + `useImperativeHandle`** for imperative parent-to-child calls (see `DashboardPageHandle`)
- **`useRef` for stable references** — DataTable uses refs to avoid forcing TableVirtuoso re-initialization
- **`useMemo` for derived data** — filtered/sorted arrays, column configs
- **`useCallback` for event handlers** — prevents unnecessary child re-renders
- **`useDebouncedValue`** for search inputs to avoid per-keystroke re-render

```tsx
// DataTable pattern: stable components via refs to prevent scroll reset
const dataRef = useRef(data);
dataRef.current = data;

const tableComponents = useMemo(() => ({
  Scroller: React.forwardRef<HTMLDivElement, ...>(({ style, ...rest }, ref) => (
    <div ref={ref} style={{ ...style, overflowX: "hidden" }} {...rest} />
  )),
  Table: ({ children, ...rest }) => (
    <table {...rest} style={{ tableLayout: "fixed", width: "100%" }}>
      <colgroup>{/* col widths */}</colgroup>
      {children}
    </table>
  ),
}), []);
```

---

## Styling Patterns

- **Global CSS** in `src/styles/app.css` with CSS custom properties
- **Theme system** via `data-theme` attribute on root element
- **BEM-like class naming**: `.page-header`, `.stat-card`, `.edit-panel-overlay`, `.splash-brand`
- **Inline styles** used sparingly for dynamic values (progress bars, animations)
- **`lucide-react`** for all icons — no icon fonts or SVG assets
- **Class toggling** via template literals or `.filter(Boolean).join(" ")`

```tsx
// Class toggling pattern
className={[
  "th-filter-btn",
  hasActiveFilter ? "has-filter" : "",
  openFilter === col.key ? "active" : "",
].filter(Boolean).join(" ")}
```

---

## Accessibility

- **`role="switch"`** on toggle components (see `Toggle.tsx`)
- **`aria-checked`**, **`aria-label`**, **`aria-modal`** on interactive elements
- **`aria-expanded`** on collapsible sections
- **Keyboard navigation**: `tabIndex={0}`, `onKeyDown` handlers for Enter/Space
- **Focus trapping** in modal panels (see `TranslationEditPanel.tsx:232-254`)
- **Tooltips** via `data-tooltip` attribute (CSS-driven, not JS library)

---

## Common Mistakes to Avoid

- **DO NOT** use class components
- **DO NOT** define props as inline types in function parameters
- **DO NOT** put UI text strings directly in JSX — always use `t()` from i18n
- **DO NOT** mutate `style` objects directly on components that re-render frequently (causes layout thrash)
- **DO NOT** create components in page files that should be reusable — extract to `src/components/`
- **DO NOT** use `any` for props — prefer generics or explicit interfaces
- **DO NOT** forget to handle the empty/loading/error states in table-like components

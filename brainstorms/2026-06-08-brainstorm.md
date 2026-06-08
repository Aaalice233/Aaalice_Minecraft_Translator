# Brainstorm Brief: Settings Page Beautification

## Current leaning

A clear consensus was reached on **Direction A: Card-based grouping + modern form controls**, as the primary beautification approach for the Settings page and its sub-pages.

## Decision details

| Decision | Choice |
|----------|--------|
| Card style | **A1** — White background, 1px subtle border (`#ede8dc`), 6px radius |
| Toggle switches | **B1** — Replace native checkboxes with custom CSS sliding toggles |
| Tab transition | **C2** — Content fade-in on tab switch (150ms) |
| Scope | **D1** — All 7 tabs beautified in one pass |
| Card header | **E1** — Compact text style (`font-size: 13px; font-weight: 600`) |
| Number inputs | **F1** — Consistent with text inputs, plus `tabular-nums` |
| Save behavior | **G3** — Auto-save on change (600ms debounce), remove Save button, show green dot indicator |
| Resource pack list | **H2** — Chip-style list with inline add |

## Rationale

- Card grouping provides visual hierarchy to the previously flat form layout, aligning with the "Warm Pixel Workbench" style guide (6px radius, light surfaces, high density).
- Custom toggles and micro-animations enhance perceived polish without architectural changes.
- Auto-save removes friction and eliminates the redundant "save" mental step for a tool-type application.
- Chip-style resource pack list replaces the current developer-tool feel with a more native desktop UX.
- All decisions preserve the existing data model and sidebar navigation structure—changes are purely presentational.

## Alternatives considered

- **Direction B (navigation overhaul)** — Rejected as too narrow; most visual gain is in content area.
- **Direction C (immersive cards + slide transitions)** — Rejected as too heavy for a compact utility tool; slide animation deemed unnecessary.
- **Direction D (information architecture refactor)** — Rejected as out of scope; would require cross-page consistency work.
- **A2/A3 card styles** — Rejected in favor of A1 for maximum consistency with existing `.resource-section` components.
- **G2 (save at bottom)** — Rejected in favor of auto-save.
- **H1/H3** — Rejected in favor of chip UI for better space usage.

## Risks & open questions

- **Auto-save reliability**: Frequent saves (especially on number inputs) may cause unnecessary I/O. The 600ms debounce is a first guess—may need tuning during implementation.
- **Chip input overflow**: Long resource pack names may need ellipsis or max-width behavior to be defined.
- **Tab animation with form state**: Fade-in must not cause form field refocus / value flash. Implementation using React key change or CSS class toggle needs validation.
- **Resource pack list state on error**: If a chip add fails to save (auto-save), the UI should roll back—not show a phantom chip.

## Transcript Summary

The user requested to beautify the Settings page and its sub-pages. After reviewing the current code and style guide, the assistant proposed four directions (A through D) for discussion. The user selected Direction A (card-based grouping + modern form controls), and then refined all sub-decisions (card style, toggles, animation, save behavior, resource pack list) through a structured Q&A. A final design specification was summarized covering all 7 tabs, CSS additions, and behavioral changes.
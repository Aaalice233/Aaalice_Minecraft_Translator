import { Filter } from "lucide-react";
import type { ReactNode } from "react";
import { normalizeAppLanguage, t } from "../i18n/translations";
import { NumberRangeFilter } from "./NumberRangeFilter";

// ── Column config ──

export type NumberRange = { min?: number; max?: number };

export interface ColumnConfig {
  key: string;
  label: string;
  sortable?: boolean;
  /** Default sort direction when clicked first time (default "asc"). */
  defaultSort?: "asc" | "desc";
  filterType?: "text" | "select" | "number-range" | "none";
  filterOptions?: { value: string; label: string }[];
  /** Override the entire filter popover content. When set, filterType is ignored. */
  renderFilterContent?: (props: FilterContentProps) => ReactNode;
  /** Extra style for the <th> element. */
  thStyle?: React.CSSProperties;
}

export interface FilterContentProps {
  column: string;
  value: string | NumberRange | undefined;
  onChange: (value: string | NumberRange | null) => void;
}

// ── Sort/filter state shape ──

export interface SortConfig {
  key: string;
  direction: "asc" | "desc";
}

// ── Component ──

interface Props {
  columns: ColumnConfig[];
  sortConfig: SortConfig | null;
  filters: Record<string, string | NumberRange | undefined>;
  openFilter: string | null;
  filterRef: React.RefObject<HTMLDivElement | null>;
  onSort: (key: string) => void;
  onToggleFilter: (key: string) => void;
  onFilterChange: (key: string, value: string | NumberRange | null) => void;
  /** Default column for initial sort indicator */
  defaultSortKey?: string;
  /** App language for i18n filter labels. */
  language?: string;
}

/**
 * Reusable sortable table header row.
 *
 * Usage:
 * ```tsx
 * <SortableTableHeader
 *   columns={columns}
 *   sortConfig={sf.sortConfig}
 *   filters={sf.filters}
 *   openFilter={sf.openFilter}
 *   filterRef={sf.filterRef}
 *   onSort={sf.handleSort}
 *   onToggleFilter={sf.toggleFilter}
 *   onFilterChange={sf.handleFilterChange}
 * />
 * ```
 */
export function SortableTableHeader({
  columns,
  sortConfig,
  filters,
  openFilter,
  filterRef,
  onSort,
  onToggleFilter,
  onFilterChange,
  defaultSortKey,
  language,
}: Props) {
  const lang = normalizeAppLanguage(language);
  return (
    <tr>
      {columns.map((col, colIdx) => {
        const isRightColumn = colIdx >= columns.length - 2; // last 2 columns → right-align popover
        // Special handling: columns with no sort/filter
        if (col.sortable === false && col.filterType === "none") {
          return (
            <th key={col.key} style={col.thStyle}>
              {col.label}
            </th>
          );
        }

        const isActiveSort = sortConfig?.key === col.key;
        const isDefaultSort = !sortConfig && col.key === defaultSortKey;
        const hasActiveFilter = col.key in filters;

        return (
          <th
            key={col.key}
            className={[
              "sortable",
              isActiveSort ? (sortConfig!.direction === "asc" ? "sorted-asc" : "sorted-desc") : "",
              isDefaultSort ? "sorted-default" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={col.sortable !== false ? () => onSort(col.key) : undefined}
            style={col.thStyle}
          >
            <span className="th-filter-wrap">
              {col.label}
              {(isActiveSort || isDefaultSort) && (
                <span className="sort-indicator">
                  {isActiveSort ? (sortConfig!.direction === "asc" ? "↑" : "↓") : "↕"}
                </span>
              )}
              {col.filterType !== "none" && (
                <button
                  className={[
                    "th-filter-btn",
                    hasActiveFilter ? "has-filter" : "",
                    openFilter === col.key ? "active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFilter(col.key);
                  }}
                  type="button"
                  aria-label={`${t(lang, "tooltip.filter")} ${col.label}`}
                  data-tooltip={t(lang, "tooltip.filter")}
                >
                  <Filter size={13} />
                </button>
              )}
              {openFilter === col.key && (
                <div
                  className={`filter-popover${isRightColumn ? " popover-right" : ""}`}
                  ref={filterRef as React.RefObject<HTMLDivElement>}
                  onClick={(e) => e.stopPropagation()}
                >
                  {col.renderFilterContent ? (
                    col.renderFilterContent({
                      column: col.key,
                      value: filters[col.key],
                      onChange: (v) => onFilterChange(col.key, v),
                    })
                  ) : col.filterType === "select" && col.filterOptions ? (
                    <select
                      value={String(filters[col.key] ?? "")}
                      onChange={(e) => onFilterChange(col.key, e.target.value || null)}
                      autoFocus
                    >
                      <option value="">{t(lang, "common.filterAll")}</option>
                      {col.filterOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : col.filterType === "number-range" ? (
                    <NumberRangeFilter
                      value={typeof filters[col.key] === "object" ? filters[col.key] as NumberRange : undefined}
                      onChange={(v) => onFilterChange(col.key, v)}
                      minLabel={t(lang, "common.filterMin")}
                      maxLabel={t(lang, "common.filterMax")}
                    />
                  ) : (
                    <input
                      type="text"
                      value={String(filters[col.key] ?? "")}
                      onChange={(e) => onFilterChange(col.key, e.target.value)}
                      placeholder={t(lang, "common.filterPlaceholder")}
                      autoFocus
                    />
                  )}
                </div>
              )}
            </span>
          </th>
        );
      })}
    </tr>
  );
}

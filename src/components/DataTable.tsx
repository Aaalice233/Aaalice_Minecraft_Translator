import { TableVirtuoso } from "react-virtuoso";
import {
  SortableTableHeader,
  type ColumnConfig,
  type SortConfig,
} from "./SortableTableHeader";
import React, { useCallback, useMemo, useRef } from "react";

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnConfig[];
  sortConfig: SortConfig | null;
  filters: Record<string, any>;
  openFilter: string | null;
  filterRef: React.RefObject<HTMLDivElement | null>;
  onSort: (key: string) => void;
  onToggleFilter: (key: string) => void;
  onFilterChange: (key: string, value: any) => void;
  defaultSortKey?: string;
  language?: string;
  renderRow: (item: T, index: number) => React.ReactNode;
  colWidths: string[];
  /** Optional row wrapper for custom row behavior (click handlers, etc.) */
  RowWrapper?: React.ComponentType<{
    item: T;
    children: React.ReactNode;
    [key: string]: any;
  }>;
  followOutput?: boolean;
  /** Ref forwarded to the underlying TableVirtuoso instance */
  virtuosoRef?: React.Ref<any>;
}

/**
 * Universal virtual-scrolled data table using TableVirtuoso.
 *
 * Unifies Scroller (overflowX: "hidden"), Table (with <colgroup>),
 * fixed header (SortableTableHeader), and row rendering across
 * JobsPage, DictionaryPage, and ValidatePage.
 *
 * Uses refs + useMemo for component props to prevent TableVirtuoso
 * from re-creating its virtual scroller DOM on every render
 * (which would reset scrollTop to 0).
 */
export function DataTable<T>(props: DataTableProps<T>) {
  const {
    data,
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
    renderRow,
    colWidths,
    RowWrapper,
    followOutput,
    virtuosoRef,
  } = props;

  // Stable refs so useMemo'd components/rows don't force re-initialization
  const dataRef = useRef(data);
  dataRef.current = data;

  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;

  const rowWrapperRef = useRef(RowWrapper);
  rowWrapperRef.current = RowWrapper;

  // Stable itemContent: reads from dataRef so it never depends on `data`
  const itemContent = useCallback(
    (index: number) => renderRow(dataRef.current[index], index),
    [renderRow],
  );

  // Stable fixed header: only changes when column/sort/filter config changes
  const fixedHeaderContent = useCallback(
    () => (
      <SortableTableHeader
        columns={columns}
        sortConfig={sortConfig}
        filters={filters}
        openFilter={openFilter}
        filterRef={filterRef}
        onSort={onSort}
        onToggleFilter={onToggleFilter}
        onFilterChange={onFilterChange}
        defaultSortKey={defaultSortKey}
        language={language}
      />
    ),
    [columns, sortConfig, filters, openFilter, filterRef, onSort, onToggleFilter, onFilterChange, defaultSortKey, language],
  );

  // Stable components object: uses refs so it never forces re-initialization
  const tableComponents = useMemo(() => ({
    Scroller: React.forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement>
    >(({ style, ...rest }, ref) => (
      <div ref={ref} style={{ ...style, overflowX: "hidden" }} {...rest} />
    )),
    Table: ({ children, ...rest }: React.HTMLAttributes<HTMLTableElement>) => {
      const cw = colWidthsRef.current;
      return (
        <table {...rest} style={{ tableLayout: "fixed", width: "100%", borderCollapse: "collapse" }}>
          <colgroup>
            {cw.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          {children}
        </table>
      );
    },
    TableRow: (({ children, ...rest }: any) => {
      const RW = rowWrapperRef.current;
      if (!RW) {
        return <tr {...rest}>{children}</tr>;
      }
      const index = rest["data-index"];
      const item = index !== undefined ? dataRef.current[index] : null;
      return item ? (
        <RW {...rest} item={item}>
          {children}
        </RW>
      ) : (
        <tr {...rest}>{children}</tr>
      );
    }) as any,
  }), []);

  return (
    <TableVirtuoso
      ref={virtuosoRef}
      followOutput={followOutput}
      style={{ height: "100%" }}
      totalCount={data.length}
      components={tableComponents}
      fixedHeaderContent={fixedHeaderContent}
      itemContent={itemContent}
    />
  );
}

import { TableVirtuoso } from "react-virtuoso";
import {
  SortableTableHeader,
  type ColumnConfig,
  type SortConfig,
} from "./SortableTableHeader";
import React from "react";

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
  emptyMessage?: string;
  className?: string;
  followOutput?: boolean;
  virtuosoRef?: React.Ref<any>;
}

/**
 * Universal virtual-scrolled data table using TableVirtuoso.
 *
 * Unifies Scroller (overflowX: "hidden"), Table (with <colgroup>),
 * fixed header (SortableTableHeader), and row rendering across
 * JobsPage, DictionaryPage, and ValidatePage.
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
    emptyMessage,
    className,
    followOutput,
    virtuosoRef,
  } = props;

  return (
    <TableVirtuoso
      ref={virtuosoRef}
      followOutput={followOutput}
      style={{ height: "100%" }}
      totalCount={data.length}
      components={{
        Scroller: React.forwardRef<
          HTMLDivElement,
          React.HTMLAttributes<HTMLDivElement>
        >(({ style, ...rest }, ref) => (
          <div ref={ref} style={{ ...style, overflowX: "hidden" }} {...rest} />
        )),
        Table: ({ children, ...rest }) => (
          <table {...rest} style={{ tableLayout: "fixed", width: "100%", borderCollapse: "collapse" }}>
            <colgroup>
              {colWidths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            {children}
          </table>
        ),
        EmptyPlaceholder: () => (
          <div className="log-panel-empty">{emptyMessage}</div>
        ),
        TableRow: RowWrapper
          ? ({ children, ...rest }) => {
              const index = (rest as any)["data-index"];
              const item = index !== undefined ? data[index] : null;
              return item ? (
                <RowWrapper {...rest} item={item}>
                  {children}
                </RowWrapper>
              ) : (
                <tr {...rest}>{children}</tr>
              );
            }
          : undefined,
      }}
      fixedHeaderContent={() => (
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
      )}
      itemContent={(index) => renderRow(data[index], index)}
    />
  );
}

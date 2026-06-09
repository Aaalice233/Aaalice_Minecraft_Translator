import { useCallback, useEffect, useRef, useState } from "react";

export interface SortConfig {
  key: string;
  direction: "asc" | "desc";
}

export type FilterValue = string | { min?: number; max?: number } | null;

/**
 * Shared sort + filter state management hook.
 * Encapsulates the duplicate sortConfig/handleSort/toggleFilter/handleFilterChange
 * pattern found in DashboardPage and JobsPage.
 */
export function useSortFilter<F extends Record<string, any> = Record<string, string>>() {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [filters, setFilters] = useState<F>({} as F);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const handleSort = useCallback((column: string) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== column) return { key: column, direction: "asc" };
      if (prev.direction === "asc") return { key: column, direction: "desc" };
      return null;
    });
    setOpenFilter(null);
  }, []);

  const toggleFilter = useCallback((column: string) => {
    setOpenFilter((prev) => (prev === column ? null : column));
  }, []);

  const handleFilterChange = useCallback((column: string, value: FilterValue) => {
    setFilters((prev: any) => {
      const next = { ...prev };
      if (
        value === null ||
        value === "" ||
        (typeof value === "object" && !("min" in value) && !("max" in value))
      ) {
        delete next[column];
      } else {
        next[column] = value;
      }
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({} as F);
    setSortConfig(null);
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

  return {
    sortConfig,
    filters,
    openFilter,
    filterRef,
    handleSort,
    toggleFilter,
    handleFilterChange,
    resetFilters,
  };
}

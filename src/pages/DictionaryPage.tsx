import { Download, Trash2, Upload } from "lucide-react";
import { SearchInput } from "../components/SearchInput";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSortFilter } from "../hooks/useSortFilter";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { type ColumnConfig } from "../components/SortableTableHeader";
import { TranslationEditPanel, type EditPanelEntry } from "../components/TranslationEditPanel";
import {
  clearDictionary,
  countDictionary,
  deleteDictionaryEntry,
  deleteDictionarySelection,
  getDictionaryStats,
  searchDictionary,
  translateSingleEntry,
  updateDictionaryEntry,
} from "../api/tauri";
import { t } from "../i18n/translations";
import { getSettings } from "../api/tauri";
import type { AppLanguage, DictionaryEntry, DictionaryQueryParams, DictionarySelectionDeleteRequest, DictionaryStats, Settings } from "../types";

interface Props {
  language: AppLanguage;
}

const DICTIONARY_PAGE_SIZE = 1000;

type DictionarySelection =
  | { mode: "ids"; ids: Set<number> }
  | { mode: "query"; query: DictionaryQueryParams; excludedIds: Set<number>; total: number };

function emptySelection(): DictionarySelection {
  return { mode: "ids", ids: new Set<number>() };
}

function typeLabel(st: string, lang: AppLanguage): string {
  const key = `dictionary.type${st.charAt(0).toUpperCase() + st.slice(1)}` as any;
  const label = t(lang, key);
  return label || st;
}

// ── Row component ──

const DictionaryRow = React.memo(function DictionaryRow({
  entry,
  onOpenPanel,
  highlighted,
  onDelete,
  selected,
  onToggleSelected,
  language,
}: {
  entry: DictionaryEntry;
  onOpenPanel?: () => void;
  highlighted?: boolean;
  onDelete: (id: number) => void;
  selected: boolean;
  onToggleSelected: (id: number) => void;
  language: AppLanguage;
}) {
  const modLabel = entry.modName || entry.modId || "-";
  return (
    <>
      <td className="selection-cell">
        {entry.id != null && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(entry.id!)}
            aria-label={t(language, "dictionary.selectRow")}
          />
        )}
      </td>
      <td title={entry.sourceText}>{entry.sourceText}</td>
      <td
        style={{ cursor: entry.id != null ? "pointer" : "default" }}
        onClick={entry.id != null ? onOpenPanel : undefined}
        title={entry.id != null ? t(language, "dictionary.clickToEdit") : t(language, "dictionary.readOnly")}
      >
        <span style={{ color: highlighted ? "var(--accent)" : undefined }}>
          {entry.targetText}
        </span>
      </td>
      <td title={entry.modName && entry.modId ? `${entry.modName} · ${entry.modId}` : modLabel}>
        {modLabel}
      </td>
      <td className="mono">{entry.translationKey ?? "-"}</td>
      <td>
        <span className={`badge ${entry.sourceType}`}>
          {typeLabel(entry.sourceType, language)}
        </span>
      </td>
      <td>
        <button
          className="ghost-button danger"
          onClick={() => entry.id != null && onDelete(entry.id)}
          type="button"
          data-tooltip={t(language, "tooltip.delete")}
        >
          {t(language, "common.delete")}
        </button>
      </td>
    </>
  );
});

// ── Dictionary page ──

export function DictionaryPage({ language }: Props) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [stats, setStats] = useState<DictionaryStats | null>(null);
  const [matchingCount, setMatchingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [selection, setSelection] = useState<DictionarySelection>(() => emptySelection());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const debouncedSearch = useDebouncedValue(globalSearch, 300);
  const selectAllLoadedRef = useRef<HTMLInputElement>(null);

  // Edit panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelKey, setPanelKey] = useState<string | null>(null);

  const sf = useSortFilter();
  const activeSearch = useMemo(() => debouncedSearch.trim(), [debouncedSearch]);
  const dictionaryQuery = useMemo<DictionaryQueryParams>(() => {
    const filters = sf.filters as Record<string, string>;
    return {
      search: activeSearch || undefined,
      sourceText: filters.sourceText || undefined,
      targetText: filters.targetText || undefined,
      modQuery: filters.modId || undefined,
      translationKey: filters.translationKey || undefined,
      sourceType: filters.sourceType || undefined,
    };
  }, [activeSearch, sf.filters]);
  const querySignature = useMemo(() => JSON.stringify(dictionaryQuery), [dictionaryQuery]);

  const loadedIds = useMemo(
    () => entries.map((entry) => entry.id).filter((id): id is number => id != null),
    [entries],
  );

  const isSelected = useCallback((id: number) => {
    if (selection.mode === "ids") {
      return selection.ids.has(id);
    }
    return !selection.excludedIds.has(id);
  }, [selection]);

  const selectedCount = useMemo(() => {
    if (selection.mode === "ids") {
      return selection.ids.size;
    }
    return Math.max(selection.total - selection.excludedIds.size, 0);
  }, [selection]);

  const loadedSelectedCount = useMemo(
    () => loadedIds.filter((id) => isSelected(id)).length,
    [loadedIds, isSelected],
  );
  const allLoadedSelected = loadedIds.length > 0 && loadedSelectedCount === loadedIds.length;
  const someLoadedSelected = loadedSelectedCount > 0 && !allLoadedSelected;
  const filterSummary = useMemo(() => {
    const filters = sf.filters as Record<string, string>;
    const parts: string[] = [];
    if (activeSearch) {
      parts.push(`${t(language, "dictionary.search")}: ${activeSearch}`);
    }
    if (filters.sourceText) {
      parts.push(`${t(language, "dictionary.col.source")}: ${filters.sourceText}`);
    }
    if (filters.targetText) {
      parts.push(`${t(language, "dictionary.col.target")}: ${filters.targetText}`);
    }
    if (filters.modId) {
      parts.push(`${t(language, "dictionary.col.mod")}: ${filters.modId}`);
    }
    if (filters.translationKey) {
      parts.push(`${t(language, "dictionary.col.key")}: ${filters.translationKey}`);
    }
    if (filters.sourceType) {
      parts.push(`${t(language, "dictionary.col.type")}: ${typeLabel(filters.sourceType, language)}`);
    }
    return parts.length > 0 ? parts.join(" / ") : t(language, "dictionary.bulkFilterAll");
  }, [activeSearch, language, sf.filters]);
  const selectionSummary = selection.mode === "query"
    ? t(language, "dictionary.bulkSelectionQuery", { selected: selectedCount, total: matchingCount })
    : t(language, "dictionary.bulkSelectionIds", { selected: selectedCount, total: matchingCount });

  // ── Data loading ──

  // ── Silent fetch: skip setLoading to avoid UI flicker during polling ──
  const fetchEntriesSilent = useCallback(async () => {
    try {
      const [results, total] = await Promise.all([
        searchDictionary({ ...dictionaryQuery, limit: DICTIONARY_PAGE_SIZE, offset: 0 }),
        countDictionary(dictionaryQuery),
      ]);
      setEntries((prev) => {
        if (prev.length <= DICTIONARY_PAGE_SIZE) {
          return results;
        }
        const refreshedIds = new Set(results.map((entry) => entry.id).filter((id) => id != null));
        return [
          ...results,
          ...prev.slice(DICTIONARY_PAGE_SIZE).filter((entry) => entry.id == null || !refreshedIds.has(entry.id)),
        ];
      });
      setHasMore((prev) => prev || results.length === DICTIONARY_PAGE_SIZE);
      setMatchingCount(total);
    } catch {
      // silent — ignore polling errors
    }
  }, [dictionaryQuery]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [results, total] = await Promise.all([
        searchDictionary({ ...dictionaryQuery, limit: DICTIONARY_PAGE_SIZE, offset: 0 }),
        countDictionary(dictionaryQuery),
      ]);
      setEntries(results);
      setHasMore(results.length === DICTIONARY_PAGE_SIZE);
      setMatchingCount(total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [dictionaryQuery]);

  const loadMoreEntries = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const results = await searchDictionary({
        ...dictionaryQuery,
        limit: DICTIONARY_PAGE_SIZE,
        offset: entries.length,
      });
      setEntries((prev) => {
        const seen = new Set(prev.map((entry) => entry.id).filter((id) => id != null));
        const next = results.filter((entry) => entry.id == null || !seen.has(entry.id));
        return [...prev, ...next];
      });
      setHasMore(results.length === DICTIONARY_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [dictionaryQuery, entries.length, hasMore, loading, loadingMore]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await getDictionaryStats();
      setStats(s);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchStats();
  }, [fetchEntries, fetchStats]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    setSelection(emptySelection());
  }, [querySignature]);

  useEffect(() => {
    if (selectAllLoadedRef.current) {
      selectAllLoadedRef.current.indeterminate = someLoadedSelected;
    }
  }, [someLoadedSelected]);

  const selectAllMatching = useCallback(() => {
    if (matchingCount <= 0) return;
    setSelection({
      mode: "query",
      query: dictionaryQuery,
      excludedIds: new Set<number>(),
      total: matchingCount,
    });
  }, [dictionaryQuery, matchingCount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select") || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      selectAllMatching();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectAllMatching]);

  // ── Auto-refresh: poll every 5s while page is visible ──
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const safeFetch = () => {
      if (cancelled) return;
      fetchEntriesSilent();
      fetchStats();
    };

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(safeFetch, 5000);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    // Visibility change handler — refresh immediately then start/stop polling
    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        safeFetch();
        startPolling();
      } else {
        stopPolling();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") {
      startPolling();
    }

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchEntriesSilent, fetchStats]);

  const toggleEntrySelected = useCallback((id: number) => {
    setSelection((prev) => {
      if (prev.mode === "query") {
        const excludedIds = new Set(prev.excludedIds);
        if (excludedIds.has(id)) {
          excludedIds.delete(id);
        } else {
          excludedIds.add(id);
        }
        return { ...prev, excludedIds };
      }

      const ids = new Set(prev.ids);
      if (ids.has(id)) {
        ids.delete(id);
      } else {
        ids.add(id);
      }
      return { mode: "ids", ids };
    });
  }, []);

  const toggleLoadedSelection = useCallback(() => {
    if (loadedIds.length === 0) return;
    setSelection((prev) => {
      if (prev.mode === "query") {
        const excludedIds = new Set(prev.excludedIds);
        if (allLoadedSelected) {
          loadedIds.forEach((id) => excludedIds.add(id));
        } else {
          loadedIds.forEach((id) => excludedIds.delete(id));
        }
        return { ...prev, excludedIds };
      }

      const ids = new Set(prev.ids);
      if (allLoadedSelected) {
        loadedIds.forEach((id) => ids.delete(id));
      } else {
        loadedIds.forEach((id) => ids.add(id));
      }
      return { mode: "ids", ids };
    });
  }, [allLoadedSelected, loadedIds]);

  const invertLoadedSelection = useCallback(() => {
    if (loadedIds.length === 0) return;
    setSelection((prev) => {
      if (prev.mode === "query") {
        const excludedIds = new Set(prev.excludedIds);
        loadedIds.forEach((id) => {
          if (excludedIds.has(id)) {
            excludedIds.delete(id);
          } else {
            excludedIds.add(id);
          }
        });
        return { ...prev, excludedIds };
      }

      const ids = new Set(prev.ids);
      loadedIds.forEach((id) => {
        if (ids.has(id)) {
          ids.delete(id);
        } else {
          ids.add(id);
        }
      });
      return { mode: "ids", ids };
    });
  }, [loadedIds]);

  const clearSelection = useCallback(() => {
    setSelection(emptySelection());
  }, []);

  const openBulkConfirm = useCallback(() => {
    if (selectedCount <= 0) return;
    setError("");
    setMessage("");
    setBulkConfirmOpen(true);
  }, [selectedCount]);

  const buildDeleteRequest = useCallback((): DictionarySelectionDeleteRequest => {
    if (selection.mode === "query") {
      return {
        mode: "query",
        query: selection.query,
        excludedIds: Array.from(selection.excludedIds),
      };
    }
    return {
      mode: "ids",
      ids: Array.from(selection.ids),
    };
  }, [selection]);

  const handleDeleteSelection = useCallback(async () => {
    if (selectedCount <= 0) return;
    setError("");
    setMessage("");
    setBulkDeleting(true);
    try {
      const result = await deleteDictionarySelection(buildDeleteRequest());
      setMessage(t(language, "dictionary.bulkDeleted", { count: result.removed }));
      setSelection(emptySelection());
      setBulkConfirmOpen(false);
      setPanelOpen(false);
      await Promise.all([fetchEntries(), fetchStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkDeleting(false);
    }
  }, [buildDeleteRequest, fetchEntries, fetchStats, language, selectedCount]);

  // ── Edit handlers ──

  const handleSave = useCallback(async (entry: EditPanelEntry, newText: string) => {
    if (entry.id == null) return;
    setError("");
    setMessage("");
    try {
      await updateDictionaryEntry(entry.id, newText);
      setMessage(t(language, "dictionary.saved"));
      // Optimistic update: avoid full re-fetch loading flash
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, targetText: newText } : e)),
      );
      // Silent background refresh
      fetchEntriesSilent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [language, fetchEntriesSilent]);

  const handleLlmTranslate = useCallback(async (entry: EditPanelEntry) => {
    const settings: Settings = await getSettings();
    const result = await translateSingleEntry(
      null, // no jobId for dictionary
      entry.key,
      entry.sourceText,
      entry.modName ?? "",
      entry.modId,
      settings.sourceLanguage,
      settings.targetLanguage,
    );
    return result;
  }, []);

  const handleDelete = useCallback(
    async (id: number) => {
      setError("");
      setMessage("");
      try {
        await deleteDictionaryEntry(id);
        setSelection((prev) => {
          if (prev.mode === "query") {
            const excludedIds = new Set(prev.excludedIds);
            if (excludedIds.has(id)) {
              excludedIds.delete(id);
              return { ...prev, excludedIds };
            }
            return { ...prev, excludedIds, total: Math.max(prev.total - 1, 0) };
          }
          const ids = new Set(prev.ids);
          ids.delete(id);
          return { mode: "ids", ids };
        });
        setMessage(t(language, "dictionary.deleted"));
        fetchEntries();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [language, fetchEntries],
  );

  const openClearConfirm = useCallback(() => {
    setError("");
    setMessage("");
    setClearConfirmOpen(true);
  }, []);

  const handleClearDictionary = useCallback(async () => {
    setError("");
    setMessage("");
    setClearing(true);
    try {
      const removed = await clearDictionary();
      setEntries([]);
      setHasMore(false);
      setLoadingMore(false);
      setMatchingCount(0);
      setSelection(emptySelection());
      setBulkConfirmOpen(false);
      setStats({ total: 0, modIds: [] });
      setMessage(t(language, "dictionary.cleared", { count: removed }));
      setClearConfirmOpen(false);
      fetchEntriesSilent();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }, [language, fetchEntriesSilent, fetchStats]);

  // ── Client-side filter + sort ──

  const filteredEntries = useMemo(() => {
    let result = entries;

    // Sort
    if (sf.sortConfig) {
      const { key, direction } = sf.sortConfig;
      const dir = direction === "asc" ? 1 : -1;
      const getVal = (x: DictionaryEntry): string => {
        switch (key) {
          case "sourceText": return x.sourceText;
          case "targetText": return x.targetText;
          case "modId": return x.modName || x.modId || "";
          case "translationKey": return x.translationKey ?? "";
          case "sourceType": return x.sourceType;
          default: return "";
        }
      };
      result = [...result].sort((a, b) =>
        getVal(a).localeCompare(getVal(b), undefined, { sensitivity: "base" }) * dir,
      );
    }

    return result;
  }, [entries, sf.sortConfig]);

  // ── Column config ──

  const dictColumnsMemo: ColumnConfig[] = useMemo(
    () => [
      {
        key: "selection",
        label: "",
        sortable: false,
        filterType: "none",
        renderHeaderContent: () => (
          <input
            ref={selectAllLoadedRef}
            type="checkbox"
            checked={allLoadedSelected}
            disabled={loadedIds.length === 0}
            onChange={toggleLoadedSelection}
            aria-label={t(language, "dictionary.selectLoaded")}
          />
        ),
      },
      { key: "sourceText", label: t(language, "dictionary.col.source"), filterType: "text" },
      { key: "targetText", label: t(language, "dictionary.col.target"), filterType: "text" },
      { key: "modId", label: t(language, "dictionary.col.mod"), filterType: "text" },
      { key: "translationKey", label: t(language, "dictionary.col.key"), filterType: "text" },
      {
        key: "sourceType",
        label: t(language, "dictionary.col.type"),
        filterType: "select",
        filterOptions: ["manual", "resourcepack", "reviewed", "llm"].map((v) => ({
          value: v,
          label: typeLabel(v, language),
        })),
      },
      { key: "actions", label: t(language, "dictionary.col.actions"), sortable: false, filterType: "none" },
    ],
    [allLoadedSelected, language, loadedIds.length, toggleLoadedSelection],
  );

  // ── Stable renderRow to avoid DataTable re-initialization ──

  const dictRenderRow = useCallback(
    (entry: DictionaryEntry, index: number) => (
      <DictionaryRow
        key={entry.id ?? index}
        entry={entry}
        onOpenPanel={() => {
          if (entry.id != null) {
            setPanelKey(`dict::${entry.id}`);
            setPanelOpen(true);
          }
        }}
        highlighted={panelOpen && panelKey === `dict::${entry.id}`}
        onDelete={handleDelete}
        selected={entry.id != null && isSelected(entry.id)}
        onToggleSelected={toggleEntrySelected}
        language={language}
      />
    ),
    [panelOpen, panelKey, handleDelete, isSelected, toggleEntrySelected, language],
  );

  // ── Render ──

  return (
    <section className="page dictionary-page">
      <PageHeader
        title={t(language, "dictionary.title")}
        subtitle={stats
          ? t(language, "dictionary.subtitle", { total: stats.total, mods: stats.modIds.length })
          : t(language, "dictionary.subtitleEmpty")}
        actions={
          <>
            <button
              className="ghost-button danger"
              type="button"
              disabled={!isTauriRuntime() || (stats?.total ?? 0) === 0}
              onClick={openClearConfirm}
              data-tooltip={t(language, "dictionary.clearTooltip")}
            >
              <Trash2 size={17} />
              {t(language, "dictionary.clear")}
            </button>
            <button className="ghost-button" type="button" disabled={!isTauriRuntime()} data-tooltip={t(language, "tooltip.export")}>
              <Download size={17} />
              {t(language, "dictionary.export")}
            </button>
            <button className="ghost-button" type="button" disabled={!isTauriRuntime()} data-tooltip={t(language, "tooltip.import")}>
              <Upload size={17} />
              {t(language, "dictionary.import")}
            </button>
          </>
        }
      />

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {clearConfirmOpen && createPortal(
        <div className="confirm-overlay" role="presentation" onClick={() => !clearing && setClearConfirmOpen(false)}>
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dictionary-clear-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-modal-icon danger">
              <Trash2 size={22} />
            </div>
            <div className="confirm-modal-body">
              <h2 id="dictionary-clear-confirm-title">{t(language, "dictionary.clearConfirmTitle")}</h2>
              <p>{t(language, "dictionary.clearConfirm")}</p>
            </div>
            <div className="confirm-modal-actions">
              <button className="ghost-button" type="button" disabled={clearing} onClick={() => setClearConfirmOpen(false)}>
                {t(language, "common.cancel")}
              </button>
              <button className="primary-button danger" type="button" disabled={clearing} onClick={handleClearDictionary}>
                {clearing ? t(language, "common.loading") : t(language, "dictionary.clearConfirmAction")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {bulkConfirmOpen && createPortal(
        <div className="confirm-overlay" role="presentation" onClick={() => !bulkDeleting && setBulkConfirmOpen(false)}>
          <div
            className="confirm-modal dictionary-bulk-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dictionary-bulk-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-modal-icon danger">
              <Trash2 size={22} />
            </div>
            <div className="confirm-modal-body">
              <h2 id="dictionary-bulk-confirm-title">{t(language, "dictionary.bulkConfirmTitle")}</h2>
              <p>{t(language, "dictionary.bulkConfirm", { count: selectedCount })}</p>
              <p className="dictionary-bulk-confirm-filter">
                {t(language, "dictionary.bulkConfirmFilter", { filter: filterSummary })}
              </p>
            </div>
            <div className="confirm-modal-actions">
              <button className="ghost-button" type="button" disabled={bulkDeleting} onClick={() => setBulkConfirmOpen(false)}>
                {t(language, "common.cancel")}
              </button>
              <button className="primary-button danger" type="button" disabled={bulkDeleting} onClick={handleDeleteSelection}>
                {bulkDeleting ? t(language, "common.loading") : t(language, "dictionary.bulkConfirmAction")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <div style={{ marginBottom: 16 }}>
        <SearchInput
          value={globalSearch}
          onChange={setGlobalSearch}
          placeholder={t(language, "dictionary.searchPlaceholder")}
        />
      </div>

      <div className="dictionary-bulk-toolbar">
        <div className="dictionary-bulk-summary">
          <strong>{selectionSummary}</strong>
          <span title={filterSummary}>{filterSummary}</span>
        </div>
        <div className="dictionary-bulk-actions">
          <button
            className="ghost-button"
            type="button"
            disabled={!isTauriRuntime() || matchingCount === 0}
            onClick={selectAllMatching}
          >
            {t(language, "dictionary.bulkSelectMatching")}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={loadedIds.length === 0}
            onClick={invertLoadedSelection}
          >
            {t(language, "dictionary.bulkInvertLoaded")}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={selectedCount === 0}
            onClick={clearSelection}
          >
            {t(language, "dictionary.bulkClearSelection")}
          </button>
          <button
            className="ghost-button danger"
            type="button"
            disabled={!isTauriRuntime() || selectedCount === 0}
            onClick={openBulkConfirm}
          >
            <Trash2 size={16} />
            {t(language, "dictionary.bulkDeleteSelected")}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && <div className="empty-state">{t(language, "common.loading")}</div>}

      {/* Data table */}
      {!loading && (
        <div className="log-panel" style={{ flex: 1, marginTop: 12 }}>
          <div className="log-panel-body" style={{ overflowX: "hidden" }}>
            <DataTable
              data={filteredEntries}
              columns={dictColumnsMemo}
              sortConfig={sf.sortConfig}
              filters={sf.filters}
              openFilter={sf.openFilter}
              filterRef={sf.filterRef as React.RefObject<HTMLDivElement | null>}
              onSort={sf.handleSort}
              onToggleFilter={sf.toggleFilter}
              onFilterChange={sf.handleFilterChange}
              defaultSortKey="sourceText"
              language={language}
              renderRow={dictRenderRow}
              colWidths={["4%", "24%", "24%", "15%", "18%", "7%", "8%"]}
              endReached={loadMoreEntries}
            />
            {loadingMore && <div className="empty-state">{t(language, "common.loading")}</div>}
          </div>
        </div>
      )}

      {/* ── Edit Panel (via createPortal) ── */}
      {panelOpen && panelKey && (() => {
        const entry = entries.find((e) => `dict::${e.id}` === panelKey);
        if (!entry || entry.id == null) return null;
        return createPortal(
          <TranslationEditPanel
            entries={filteredEntries
              .filter((e) => e.id != null)
              .map((e) => ({
                navKey: `dict::${e.id}`,
                key: e.translationKey ?? `${e.sourceText}`,
                sourceText: e.sourceText,
                targetText: e.targetText,
                modId: e.modId ?? "",
                modName: e.modName ?? e.modId ?? undefined,
                sourceType: e.sourceType,
                id: e.id,
                translationKey: e.translationKey,
              }))}
            initialKey={panelKey}
            onSave={handleSave}
            onClose={() => {
              setPanelOpen(false);
            }}
            onLlmTranslate={handleLlmTranslate}
            pageType="dictionary"
            language={language}
          />,
          document.body,
        );
      })()}
    </section>
  );
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

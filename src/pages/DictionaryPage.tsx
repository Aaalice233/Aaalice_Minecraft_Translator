import { BookOpen, Download, Search, Upload } from "lucide-react";
import { TableVirtuoso } from "react-virtuoso";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSortFilter } from "../hooks/useSortFilter";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { SortableTableHeader, type ColumnConfig } from "../components/SortableTableHeader";
import { TranslationEditPanel, type EditPanelEntry } from "../components/TranslationEditPanel";
import {
  deleteDictionaryEntry,
  getDictionaryStats,
  importTranslationResultsToDictionary,
  searchDictionary,
  translateSingleEntry,
  updateDictionaryEntry,
} from "../api/tauri";
import { t } from "../i18n/translations";
import { getSettings } from "../api/tauri";
import type { AppLanguage, DictionaryEntry, DictionaryStats, Settings } from "../types";

interface Props {
  language: AppLanguage;
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
  language,
}: {
  entry: DictionaryEntry;
  onOpenPanel?: () => void;
  highlighted?: boolean;
  onDelete: (id: number) => void;
  language: AppLanguage;
}) {
  return (
    <>
      <td title={entry.sourceText}>{entry.sourceText}</td>
      <td
        style={{ cursor: entry.id != null ? "pointer" : "default" }}
        onDoubleClick={entry.id != null ? onOpenPanel : undefined}
        title={entry.id != null ? "双击打开编辑面板" : "只读"}
      >
        <span style={{ color: highlighted ? "var(--accent)" : undefined }}>
          {entry.targetText}
        </span>
      </td>
      <td>{entry.modId ?? "-"}</td>
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
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const debouncedSearch = useDebouncedValue(globalSearch, 300);

  // Edit panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelKey, setPanelKey] = useState<string | null>(null);

  const sf = useSortFilter();

  // ── Data loading ──

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const results = await searchDictionary(undefined, undefined, undefined, undefined, undefined, 1000);
      setEntries(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

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

  // ── Import handler ──

  const handleImport = async () => {
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const result = await importTranslationResultsToDictionary();
      setMessage(
        `已导入 ${result.imported} 条，跳过 ${result.skipped} 条` +
          (result.conflicts.length > 0 ? `，${result.conflicts.length} 条冲突` : ""),
      );
      fetchEntries();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  // ── Edit handlers ──

  const handleSave = useCallback(async (entry: EditPanelEntry, newText: string) => {
    if (entry.id == null) return;
    setError("");
    setMessage("");
    try {
      await updateDictionaryEntry(entry.id, newText);
      setMessage(t(language, "dictionary.saved"));
      fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [language, fetchEntries]);

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
        setMessage(t(language, "dictionary.deleted"));
        fetchEntries();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [language, fetchEntries],
  );

  // ── Client-side filter + sort ──

  const filteredEntries = useMemo(() => {
    let result = entries;

    // Global search (debounced)
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.sourceText.toLowerCase().includes(q) ||
          e.targetText.toLowerCase().includes(q) ||
          (e.modId ?? "").toLowerCase().includes(q) ||
          (e.translationKey ?? "").toLowerCase().includes(q),
      );
    }

    // Column-level filters
    const f = sf.filters as Record<string, string>;
    for (const key of Object.keys(f)) {
      const val = f[key];
      if (!val) continue;
      const v = val.toLowerCase();
      result = result.filter((e) => {
        switch (key) {
          case "sourceText":
            return e.sourceText.toLowerCase().includes(v);
          case "targetText":
            return e.targetText.toLowerCase().includes(v);
          case "modId":
            return (e.modId ?? "").toLowerCase().includes(v);
          case "translationKey":
            return (e.translationKey ?? "").toLowerCase().includes(v);
          case "sourceType":
            return e.sourceType === val;
          default:
            return true;
        }
      });
    }

    // Sort
    if (sf.sortConfig) {
      const { key, direction } = sf.sortConfig;
      const dir = direction === "asc" ? 1 : -1;
      const getVal = (x: DictionaryEntry): string => {
        switch (key) {
          case "sourceText": return x.sourceText;
          case "targetText": return x.targetText;
          case "modId": return x.modId ?? "";
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
  }, [entries, debouncedSearch, sf.filters, sf.sortConfig]);

  // ── Column config ──

  const dictColumns: ColumnConfig[] = useMemo(
    () => [
      { key: "sourceText", label: t(language, "dictionary.col.source"), filterType: "text" },
      { key: "targetText", label: t(language, "dictionary.col.target"), filterType: "text" },
      { key: "modId", label: t(language, "dictionary.col.mod"), filterType: "text" },
      { key: "translationKey", label: t(language, "dictionary.col.key"), filterType: "text" },
      {
        key: "sourceType",
        label: t(language, "dictionary.col.type"),
        filterType: "select",
        filterOptions: ["manual", "resourcepack", "cfpa", "llm"].map((v) => ({
          value: v,
          label: typeLabel(v, language),
        })),
      },
      { key: "actions", label: t(language, "dictionary.col.actions"), sortable: false, filterType: "none" },
    ],
    [language],
  );

  // ── Render ──

  return (
    <section className="page dictionary-page">
      <div className="page-header">
        <div>
          <h1>{t(language, "dictionary.title")}</h1>
          <p>
            {stats
              ? t(language, "dictionary.subtitle", { total: stats.total, mods: stats.modIds.length })
              : t(language, "dictionary.subtitleEmpty")}
          </p>
        </div>
        <div className="page-header-button">
          <button
            className="ghost-button"
            type="button"
            disabled={!isTauriRuntime() || importing}
            onClick={handleImport}
            data-tooltip="从已有翻译导入词典"
          >
            <Download size={17} />
            {importing ? "导入中..." : "导入已有翻译"}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={!isTauriRuntime()}
            data-tooltip={t(language, "tooltip.export")}
          >
            <Download size={17} />
            {t(language, "dictionary.export")}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={!isTauriRuntime()}
            data-tooltip={t(language, "tooltip.import")}
          >
            <Upload size={17} />
            {t(language, "dictionary.import")}
          </button>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {/* Search bar */}
      <div className="instance-row">
        <label className="search-field">
          <Search size={17} />
          <input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder={t(language, "dictionary.searchPlaceholder")}
          />
        </label>
        {filteredEntries.length > 0 && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {filteredEntries.length} / {entries.length} 条
          </span>
        )}
      </div>

      {/* Loading state */}
      {loading && <div className="empty-state">{t(language, "common.loading")}</div>}

      {/* Empty state */}
      {!loading && filteredEntries.length === 0 && (
        <div className="empty-state">
          <BookOpen size={32} />
          <p>{t(language, "dictionary.empty")}</p>
        </div>
      )}

      {/* Virtual-scrolled table */}
      {!loading && filteredEntries.length > 0 && (
        <div className="log-panel" style={{ flex: 1, marginTop: 12 }}>
          <div className="log-panel-body">
            <TableVirtuoso
              style={{ height: "100%" }}
              totalCount={filteredEntries.length}
              components={{
                Table: ({ children, ...rest }) => (
                  <table {...rest}>
                    <colgroup>
                      <col style={{ width: "30%" }} />
                      <col style={{ width: "30%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "5%" }} />
                      <col style={{ width: "5%" }} />
                    </colgroup>
                    {children}
                  </table>
                ),
              }}
              fixedHeaderContent={() => (
                <SortableTableHeader
                  columns={dictColumns}
                  sortConfig={sf.sortConfig}
                  filters={sf.filters}
                  openFilter={sf.openFilter}
                  filterRef={sf.filterRef}
                  onSort={sf.handleSort}
                  onToggleFilter={sf.toggleFilter}
                  onFilterChange={sf.handleFilterChange}
                  defaultSortKey="sourceText"
                />
              )}
              itemContent={(index) => {
                const entry = filteredEntries[index];
                const isHighlighted = panelOpen && panelKey === `dict::${entry.id}`;
                return (
                  <DictionaryRow
                    key={entry.id ?? index}
                    entry={entry}
                    onOpenPanel={() => {
                      if (entry.id != null) {
                        setPanelKey(`dict::${entry.id}`);
                        setPanelOpen(true);
                      }
                    }}
                    highlighted={isHighlighted}
                    onDelete={handleDelete}
                    language={language}
                  />
                );
              }}
            />
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
                modName: e.modId ?? undefined,
                sourceType: e.sourceType,
                id: e.id,
                translationKey: e.translationKey,
              }))}
            initialKey={panelKey}
            onSave={handleSave}
            onClose={() => {
              setPanelOpen(false);
              fetchEntries();
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

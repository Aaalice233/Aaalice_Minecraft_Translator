import { Download, Upload } from "lucide-react";
import { SearchInput } from "../components/SearchInput";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSortFilter } from "../hooks/useSortFilter";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { type ColumnConfig } from "../components/SortableTableHeader";
import { TranslationEditPanel, type EditPanelEntry } from "../components/TranslationEditPanel";
import {
  deleteDictionaryEntry,
  getDictionaryStats,
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
        onClick={entry.id != null ? onOpenPanel : undefined}
        title={entry.id != null ? t(language, "dictionary.clickToEdit") : t(language, "dictionary.readOnly")}
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
  const [globalSearch, setGlobalSearch] = useState("");
  const debouncedSearch = useDebouncedValue(globalSearch, 300);

  // Edit panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelKey, setPanelKey] = useState<string | null>(null);

  const sf = useSortFilter();

  // ── Data loading ──

  // ── Silent fetch: skip setLoading to avoid UI flicker during polling ──
  const fetchEntriesSilent = useCallback(async () => {
    try {
      const results = await searchDictionary(undefined, undefined, undefined, undefined, undefined, 1000);
      setEntries(results);
    } catch {
      // silent — ignore polling errors
    }
  }, []);

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

  const dictColumnsMemo: ColumnConfig[] = useMemo(
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
      <PageHeader
        title={t(language, "dictionary.title")}
        subtitle={stats
          ? t(language, "dictionary.subtitle", { total: stats.total, mods: stats.modIds.length })
          : t(language, "dictionary.subtitleEmpty")}
        actions={
          <>
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

      <div style={{ marginBottom: 16 }}>
        <SearchInput
          value={globalSearch}
          onChange={setGlobalSearch}
          placeholder={t(language, "dictionary.searchPlaceholder")}
        />
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
              renderRow={(entry, index) => (
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
                  language={language}
                />
              )}
              colWidths={["25%", "25%", "15%", "20%", "7%", "8%"]}
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

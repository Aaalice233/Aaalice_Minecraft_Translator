import { AlertTriangle, CheckCircle, FileText, Filter, Play, Square, Trash2, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelTranslation, startTranslation } from "../api/tauri";
import { t } from "../i18n/translations";
import type { AppLanguage, EntryProgress, ScanSummary, TranslateLogEntry, TranslateProgress } from "../types";

function csvQuote(val: string): string {
  if (val.indexOf(",") >= 0 || val.indexOf('"') >= 0 || val.indexOf(" ") >= 0) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function statusLabel(status: string, lang: AppLanguage): string {
  const key = `jobs.entryStatus.${status}` as any;
  const label = t(lang, key);
  return label || status;
}

function sourceTypeLabel(sourceType: string, lang: AppLanguage): string {
  const key = `jobs.sourceType.${sourceType}` as any;
  const label = t(lang, key);
  return label || sourceType;
}

interface EntryStatusCounts {
  pending: number;
  dictionaryHit: number;
  skip: number;
  translating: number;
  completed: number;
  failed: number;
}

const STATUS_META: Array<{ key: keyof EntryStatusCounts; color: string }> = [
  { key: "pending", color: "#6b7280" },
  { key: "dictionaryHit", color: "#3b82f6" },
  { key: "skip", color: "#9ca3af" },
  { key: "translating", color: "#f59e0b" },
  { key: "completed", color: "#22c55e" },
  { key: "failed", color: "#ef4444" },
];

const MAX_LOG = 10000;

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Tauri event listener hook that auto-manages lifecycle and cleanup. */
function useTauriEvent<T>(
  event: string,
  handler: (payload: T) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      listen(event, (e) => handlerRef.current(e.payload as T)).then((u) => {
        unlisten = u;
        if (cancelled) u();
      });
    }).catch((err) => {
      console.error(`${event} listener failed:`, err);
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [event]);
}

interface Props {
  language: AppLanguage;
  isActive?: boolean;
  scanSummary: ScanSummary | null;
  onScanSummaryChange: (summary: ScanSummary) => void;
  settings: { instancePath: string; sourceLanguage: string; targetLanguage: string };
  onBusyChange?: (busy: boolean) => void;
  onCompleteChange?: (completed: boolean) => void;
}

type TranslationStatus = "idle" | "running" | "completed" | "canceled" | "failed";

export function JobsPage({ language, isActive = true, scanSummary, onScanSummaryChange, settings, onBusyChange, onCompleteChange }: Props) {
  const [translateProgress, setTranslateProgress] = useState<TranslateProgress | null>(null);
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const isRunning = status === "running";
  const [translationResult, setTranslationResult] = useState<number | null>(null);
  const [translationError, setTranslationError] = useState<string>("");
  const [logEntries, setLogEntries] = useState<TranslateLogEntry[]>([]);
  const [entryProgressMap, setEntryProgressMap] = useState<Map<string, EntryProgress>>(new Map());
  const [filterTerm, setFilterTerm] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);



  /** Derive entry status from progress map or fall back based on sourceType. */
  function getEntryStatus(entry: TranslateLogEntry): string {
    const ep = entryProgressMap.get(entry.modName + "::" + entry.key);
    if (ep) return ep.status;
    switch (entry.sourceType) {
      case "llm":
      case "existing":
        return "completed";
      case "skipped":
        return "skip";
      case "dictionary":
        return "dictionaryHit";
      default:
        return entry.sourceType;
    }
  }

  const knownSourceTypes = ["llm", "dictionary", "existing", "skipped", "failed"] as const;
  const knownStatuses = ["pending", "dictionaryHit", "skip", "translating", "completed", "failed"] as const;

  const canTranslate = scanSummary && scanSummary.actualPendingEntries > 0 && (status === "idle" || status === "failed" || status === "canceled");

  // Sync translation busy state to parent (sidebar)
  useEffect(() => {
    onBusyChange?.(isRunning);
  }, [isRunning, onBusyChange]);

  // Browser preview mock data
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setLogEntries([
        { key: "item.example.name", sourceText: "Example Item", targetText: "示例物品", modName: "example-mod-1.21.1.jar", sourceType: "llm" },
        { key: "item.example.desc", sourceText: "A useful example item", targetText: "一个有用的示例物品", modName: "example-mod-1.21.1.jar", sourceType: "llm" },
        { key: "block.example.ore", sourceText: "Example Ore", targetText: "示例矿石", modName: "example-mod-1.21.1.jar", sourceType: "dictionary" },
      ]);
    }
  }, []);

  // Tauri event listeners for translation progress updates
  useTauriEvent<TranslateProgress>("translate-progress", setTranslateProgress);

  useTauriEvent<TranslateLogEntry[]>("translate-log-entries", (entries) => {
    if (cancelledRef.current) return;
    setLogEntries((prev) => {
      const next = [...prev, ...entries];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
  });

  useTauriEvent<EntryProgress[]>("translate-entry-progresses", (entries) => {
    if (cancelledRef.current) return;
    setEntryProgressMap((prev) => {
      const next = new Map(prev);
      for (const entry of entries) {
        next.set(`${entry.modName}::${entry.key}`, entry);
      }
      return next;
    });
  });

  // Auto-scroll log panel only when page is visible and user is near the bottom
  useEffect(() => {
    if (!isActive) return;
    const container = logContainerRef.current;
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
      if (isNearBottom) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [logEntries, isActive]);

  async function handleStart() {
    if (!scanSummary) return;
    cancelledRef.current = false;
    const instPath = settings.instancePath || scanSummary.instancePath;
    const srcLang = settings.sourceLanguage || scanSummary.sourceLanguage;
    const tgtLang = settings.targetLanguage || scanSummary.targetLanguage;

    setStatus("running");
    setTranslateProgress(null);
    setTranslationResult(null);
    setTranslationError("");
    setLogEntries([]);
    setEntryProgressMap(new Map());

    try {
      const result = await startTranslation(
        instPath, srcLang, tgtLang,
        scanSummary.jobId,
      );
      if (cancelledRef.current) return;
      setTranslationResult(result);
      setStatus("completed");
      onCompleteChange?.(true);

      // Re-scan to refresh pending counts after translation
      if ("__TAURI_INTERNALS__" in window) {
        try {
          const { scanInstance } = await import("../api/tauri");
          const newSummary = await scanInstance(instPath, srcLang, tgtLang);
          onScanSummaryChange(newSummary);
        } catch (scanErr) {
          setTranslationError("翻译后自动重新扫描失败: " + toErrorMessage(scanErr));
        }
      }
    } catch (err) {
      setTranslationError(toErrorMessage(err));
      setStatus("failed");
    }
  }

  async function handleCancel() {
    cancelledRef.current = true; // signal handleStart not to set completed
    try {
      await cancelTranslation();
      setStatus("canceled");
      setTranslationResult(null);
    } catch (err) {
      console.warn("取消翻译失败：", err);
    }
  }

  const entryCounts = useMemo(() => {
    const c: EntryStatusCounts = {
      pending: 0, dictionaryHit: 0, skip: 0,
      translating: 0, completed: 0, failed: 0,
    };
    entryProgressMap.forEach((entry) => {
      const s = entry.status as keyof EntryStatusCounts;
      if (s in c) c[s]++;
    });
    return c;
  }, [entryProgressMap]);

  const visibleStatuses = (scanSummary?.actualPendingEntries ?? 0) > 0
    ? STATUS_META.filter((s) => entryCounts[s.key] > 0)
    : STATUS_META;

  const progressPercent =
    translateProgress && translateProgress.total > 0
      ? Math.round((translateProgress.current / translateProgress.total) * 100)
      : 0;

  const filteredEntries = useMemo(() => {
    let result = logEntries;

    // Apply global fuzzy search (modName + key)
    if (filterTerm) {
      const term = filterTerm.toLowerCase();
      result = result.filter(
        (e) =>
          e.modName.toLowerCase().includes(term) ||
          e.key.toLowerCase().includes(term),
      );
    }

    // Apply per-column filters
    const activeKeys = Object.keys(filters);
    if (activeKeys.length > 0) {
      result = result.filter((entry) =>
        activeKeys.every((col) => {
          const value = filters[col];
          if (!value) return true;
          switch (col) {
            case "key":
              return entry.key.toLowerCase().includes(value.toLowerCase());
            case "sourceText":
              return entry.sourceText.toLowerCase().includes(value.toLowerCase());
            case "targetText":
              return entry.targetText.toLowerCase().includes(value.toLowerCase());
            case "modName":
              return entry.modName.toLowerCase().includes(value.toLowerCase());
            case "sourceType":
              return entry.sourceType === value;
            case "status":
              return getEntryStatus(entry) === value;
            default:
              return true;
          }
        }),
      );
    }

    // Apply sorting
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const dir = sortConfig.direction === "asc" ? 1 : -1;
        let cmp = 0;
        switch (sortConfig.key) {
          case "key":
            cmp = a.key.localeCompare(b.key);
            break;
          case "sourceText":
            cmp = a.sourceText.localeCompare(b.sourceText);
            break;
          case "targetText":
            cmp = a.targetText.localeCompare(b.targetText);
            break;
          case "modName":
            cmp = a.modName.localeCompare(b.modName);
            break;
          case "sourceType":
            cmp = a.sourceType.localeCompare(b.sourceType);
            break;
          case "status":
            cmp = getEntryStatus(a).localeCompare(getEntryStatus(b));
            break;
        }
        return cmp * dir;
      });
    }

    return result;
  }, [logEntries, filterTerm, filters, sortConfig, entryProgressMap]);



  const copyEntry = useCallback(async (entry: TranslateLogEntry) => {
    try {
      await navigator.clipboard.writeText(
        `${csvQuote(entry.key)},${csvQuote(entry.sourceText)},${csvQuote(entry.targetText)},${csvQuote(entry.modName)}`,
      );
    } catch {
      // clipboard not available
    }
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    setFilterTerm("");
  }, []);

  function handleSort(column: string) {
    setSortConfig((prev) => {
      if (!prev || prev.key !== column) return { key: column, direction: "asc" };
      if (prev.direction === "asc") return { key: column, direction: "desc" };
      return null;
    });
    setOpenFilter(null);
  }

  function toggleFilter(column: string) {
    setOpenFilter((prev) => (prev === column ? null : column));
  }

  function handleFilterChange(column: string, value: string | null) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === null || value === "") {
        delete next[column];
      } else {
        next[column] = value;
      }
      return next;
    });
  }

  // Click outside to close filter popover
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

  return (
    <section className="page page-jobs">
      <div className="page-header">
        <div>
          <h1>{t(language, "jobs.title")}</h1>
          <p>{t(language, "jobs.subtitle")}</p>
        </div>
        <div className="page-header-button">
          {isRunning ? (
            <button className="primary-button danger" onClick={handleCancel} type="button" data-tooltip={t(language, "tooltip.stopTranslation")}>
              <Square size={17} />
              {t(language, "jobs.stop")}
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={!canTranslate}
              onClick={handleStart}
              type="button"
              data-tooltip={t(language, "tooltip.startTranslation")}
            >
              <Play size={18} />
              {t(language, "jobs.start")}
            </button>
          )}
        </div>
      </div>

      {!scanSummary && (
        <div className="empty-state">
          <FileText size={32} />
          <p>{t(language, "jobs.noScan")}</p>
        </div>
      )}

      {scanSummary && scanSummary.actualPendingEntries === 0 && status === "idle" && (
        <div className="empty-state">
          <CheckCircle size={32} />
          <p>{t(language, "jobs.noPending")}</p>
        </div>
      )}

      {status === "completed" && translationResult !== null && (
        <div className="alert success" style={{ marginBottom: 16 }}>
          <CheckCircle size={17} />
          <span>{t(language, "jobs.completed.message", { count: translationResult })}</span>
        </div>
      )}

      {status === "canceled" && (
        <div className="alert warning" style={{ marginBottom: 16 }}>
          <XCircle size={17} />
          <span>{t(language, "jobs.canceled")}</span>
        </div>
      )}

      {status === "failed" && translationError && (
        <div className="alert error" style={{ marginBottom: 16 }}>
          <AlertTriangle size={17} />
          <span>{t(language, "jobs.failed.message", { error: translationError })}</span>
        </div>
      )}

      {/* Compact summary (idle) — replaces old stats-grid */}
      {scanSummary && scanSummary.actualPendingEntries > 0 && status === "idle" && (
        <div className="idle-summary">
          <span className="idle-summary-item">
            <strong>{scanSummary.actualPendingEntries.toLocaleString()}</strong>{" "}
            {t(language, "jobs.totalEntries")}
          </span>
          <span className="idle-summary-item">
            {scanSummary.sourceLanguage} → {scanSummary.targetLanguage}
          </span>
          <span className="idle-summary-item">
            <strong>{scanSummary.mods.length}</strong> {t(language, "jobs.modCount")}
          </span>
        </div>
      )}

      {/* Unified progress section */}
      {(isRunning || status === "completed" || status === "canceled") && (
        <div className="scan-progress">
          <div className="scan-progress-header">
            <strong className="scan-progress-mod" style={{ maxWidth: 300, flex: 1, margin: 0 }}>
              {(() => {
                if (!translateProgress) return t(language, "jobs.translating");
                switch (translateProgress.phase) {
                  case "scanning":
                    return `正在扫描: ${translateProgress.modName || ""}`;
                  case "extracting":
                    return "正在提取待翻译条目...";
                  case "dictionary":
                    return "正在词典匹配...";
                  case "translating":
                    return `正在翻译${translateProgress.subStep ? " (" + translateProgress.subStep + ")" : ""}`;
                  default:
                    return t(language, `jobs.stage.${translateProgress.phase}` as any) || translateProgress.phase;
                }
              })()}
            </strong>
            {translateProgress?.phase !== "translating" && (
              <>
                <span>
                  {translateProgress
                    ? `${translateProgress.current.toLocaleString()} / ${translateProgress.total.toLocaleString()}`
                    : t(language, "jobs.progressFallback")}
                </span>
                <span className="percent-label">({progressPercent}%)</span>
              </>
            )}
          </div>

          {/* Merged bar: colored stacked when entry progress data exists */}
          {(isRunning || status === "completed") && scanSummary && scanSummary.actualPendingEntries > 0 ? (
            <>
              <div className="essb-container">
                <div className="essb-track" style={{ height: 20 }}>
                  {visibleStatuses.map(({ key, color }) => {
                    const count = entryCounts[key];
                    const total = scanSummary.actualPendingEntries;
                    const pct = (count / total) * 100;
                    return (
                      <div
                        key={key}
                        className="essb-segment"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                        title={`${statusLabel(key, language)}: ${count} 条 (${Math.round(pct)}%)`}
                      />
                    );
                  })}
                </div>
                <span className="essb-pct-label">
                  {Math.round((entryCounts.completed / (scanSummary.actualPendingEntries)) * 100)}%
                </span>
              </div>
              <div className="essb-legend">
                {visibleStatuses.map(({ key, color }) => (
                  <span className="essb-legend-item" key={key}>
                    <span className="essb-legend-dot" style={{ backgroundColor: color }} />
                    {statusLabel(key, language)}
                    <span className="essb-legend-count">{entryCounts[key]}</span>
                  </span>
                ))}
                <span className="essb-legend-item essb-legend-total">
                  总计 {(scanSummary.actualPendingEntries).toLocaleString()} 条
                </span>
              </div>
            </>
          ) : (
            /* Simple progress bar for non-translating phases or canceled */
            <>
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: translateProgress && translateProgress.total > 0
                      ? `${progressPercent}%`
                      : "0%",
                    background: status === "completed" ? "#1f8a5b" : status === "canceled" ? "#b0a99c" : undefined,
                  }}
                />
              </div>
              {translateProgress?.subStep && translateProgress.phase !== "translating" ? (
                <small className="scan-progress-mod">{translateProgress.subStep}</small>
              ) : translateProgress?.modName && translateProgress.phase === "scanning" ? (
                <small className="scan-progress-mod">{translateProgress.modName}</small>
              ) : null}
            </>
          )}

          {status === "completed" && (
            <small className="scan-progress-status">
              ✔ {t(language, "jobs.title")} — {translationResult ?? 0} {t(language, "jobs.totalEntries")}
            </small>
          )}
          {status === "canceled" && (
            <small className="scan-progress-status status-canceled">
              {t(language, "jobs.canceledStatus")}
            </small>
          )}
          {isRunning && (
            <small className="scan-progress-status">
              {t(language, "jobs.progressHint")}
            </small>
          )}
        </div>
      )}

      {/* Log panel (always visible) */}
      <div className="log-panel" style={{ marginTop: isRunning || status !== "idle" ? 16 : 0 }}>
        <div className="log-panel-header">
          <h3>{t(language, "jobs.logPanel.title")}</h3>
          {filteredEntries.length > 0 && (
            <span className="log-entries-count">
              {t(language, "jobs.logPanel.entriesCount", { count: filteredEntries.length })}
            </span>
          )}
          <input
            className="log-panel-filter"
            placeholder={t(language, "jobs.logPanel.filterPlaceholder")}
            value={filterTerm}
            onChange={(e) => setFilterTerm(e.target.value)}
          />
          <button className="ghost-button danger" onClick={clearLog} type="button" style={{ height: 30 }} data-tooltip={t(language, "tooltip.clearLog")}>
            <Trash2 size={14} />
            {t(language, "jobs.logPanel.clear")}
          </button>
        </div>
        <div className="log-panel-body" ref={logContainerRef}>
          {filteredEntries.length === 0 || !isActive ? (
            <div className="log-panel-empty">{t(language, "jobs.logPanel.noEntries")}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  {([
                    { key: "key", label: t(language, "jobs.logPanel.colKey") },
                    { key: "sourceText", label: t(language, "jobs.logPanel.colSource") },
                    { key: "targetText", label: t(language, "jobs.logPanel.colTarget") },
                    { key: "modName", label: t(language, "jobs.logPanel.colMod") },
                    { key: "sourceType", label: t(language, "jobs.logPanel.colType") },
                    { key: "status", label: t(language, "jobs.logPanel.colStatus") },
                  ] as const).map((col) => {
                    const isActiveSort = sortConfig?.key === col.key;
                    const isDefaultSort = !sortConfig && col.key === "key";
                    const hasActiveFilter = col.key in filters;
                    return (
                      <th
                        key={col.key}
                        className={[
                          "sortable",
                          isActiveSort ? (sortConfig.direction === "asc" ? "sorted-asc" : "sorted-desc") : "",
                          isDefaultSort ? "sorted-default" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="th-filter-wrap">
                          {col.label}
                          {(isActiveSort || isDefaultSort) && (
                            <span className="sort-indicator">
                              {isActiveSort ? (sortConfig!.direction === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          )}
                          <button
                            className={[
                              "th-filter-btn",
                              hasActiveFilter ? "has-filter" : "",
                              openFilter === col.key ? "active" : "",
                            ].filter(Boolean).join(" ")}
                            onClick={(e) => { e.stopPropagation(); toggleFilter(col.key); }}
                            type="button"
                            aria-label={`Filter ${col.label}`}
                            data-tooltip={t(language, "tooltip.filter")}
                          >
                            <Filter size={13} />
                          </button>
                          {openFilter === col.key && (
                            <div
                              className="filter-popover"
                              ref={filterRef}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="filter-popover-header">
                                <span>{col.label}</span>
                                <button
                                  className="filter-popover-clear"
                                  onClick={() => { handleFilterChange(col.key, null); }}
                                  type="button"
                                  data-tooltip={t(language, "tooltip.clearFilter")}
                                >
                                  <X size={13} />
                                </button>
                              </div>
                              {(col.key === "key" || col.key === "sourceText" || col.key === "targetText" || col.key === "modName") && (
                                <input
                                  type="text"
                                  value={filters[col.key] || ""}
                                  onChange={(e) => handleFilterChange(col.key, e.target.value)}
                                  placeholder={t(language, "dashboard.filterSearch")}
                                  autoFocus
                                />
                              )}
                              {col.key === "sourceType" && (
                                <select
                                  value={filters.sourceType || ""}
                                  onChange={(e) => handleFilterChange("sourceType", e.target.value || null)}
                                  autoFocus
                                >
                                  <option value="">全部</option>
                                  {knownSourceTypes.map((st) => (
                                    <option key={st} value={st}>{sourceTypeLabel(st, language)}</option>
                                  ))}
                                </select>
                              )}
                              {col.key === "status" && (
                                <select
                                  value={filters.status || ""}
                                  onChange={(e) => handleFilterChange("status", e.target.value || null)}
                                  autoFocus
                                >
                                  <option value="">全部</option>
                                  {knownStatuses.map((st) => (
                                    <option key={st} value={st}>{statusLabel(st, language)}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry, idx) => (
                  <tr key={`${entry.key}-${idx}`} className="copy-log-row" onClick={() => copyEntry(entry)} title={t(language, "jobs.logPanel.copyEntry")}>
                    <td>{entry.key}</td>
                    <td title={entry.sourceText}>{entry.sourceText}</td>
                    <td title={entry.targetText}>{entry.targetText}</td>
                    <td className="truncate" style={{ maxWidth: 180 }}>{entry.modName}</td>
                    <td><span className="badge">{sourceTypeLabel(entry.sourceType, language)}</span></td>
                    <td>
                      {(() => {
                        const st = getEntryStatus(entry);
                        const ep = entryProgressMap.get(entry.modName + "::" + entry.key);
                        const errorMsg = ep?.errorMessage;
                        return (
                          <span
                            className={`badge badge-${st}`}
                            data-tooltip={st === "failed" && errorMsg ? errorMsg : undefined}
                          >
                            {statusLabel(st, language)}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

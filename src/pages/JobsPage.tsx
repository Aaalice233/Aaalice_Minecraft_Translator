import { AlertTriangle, CheckCircle, FileText, Play, Square, Trash2, XCircle } from "lucide-react";
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
const ROW_HEIGHT = 30;
const ROW_BUFFER = 5;

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
  const logContainerRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  // Measure log body height to calculate visible row count
  const [visibleRows, setVisibleRows] = useState(0);
  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const update = () => {
      const h = el.clientHeight;
      setVisibleRows(Math.ceil(h / ROW_HEIGHT) + ROW_BUFFER);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const filteredEntries = useMemo(
    () =>
      filterTerm
        ? logEntries.filter(
            (e) =>
              e.modName.toLowerCase().includes(filterTerm.toLowerCase()) ||
              e.key.toLowerCase().includes(filterTerm.toLowerCase()),
          )
        : logEntries,
    [logEntries, filterTerm],
  );

  // Only render as many rows as fit in the visible area (+ buffer)
  const displayEntries = visibleRows > 0 && filteredEntries.length > visibleRows
    ? filteredEntries.slice(-visibleRows)
    : filteredEntries;

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
                  <th>{t(language, "jobs.logPanel.colKey")}</th>
                  <th>{t(language, "jobs.logPanel.colSource")}</th>
                  <th>{t(language, "jobs.logPanel.colTarget")}</th>
                  <th>{t(language, "jobs.logPanel.colMod")}</th>
                  <th>{t(language, "jobs.logPanel.colType")}</th>
                  <th>{t(language, "jobs.logPanel.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {displayEntries.map((entry, idx) => (
                  <tr key={`${entry.key}-${idx}`} className="copy-log-row" onClick={() => copyEntry(entry)} title={t(language, "jobs.logPanel.copyEntry")}>
                    <td>{entry.key}</td>
                    <td title={entry.sourceText}>{entry.sourceText}</td>
                    <td title={entry.targetText}>{entry.targetText}</td>
                    <td className="truncate" style={{ maxWidth: 180 }}>{entry.modName}</td>
                    <td><span className="badge">{sourceTypeLabel(entry.sourceType, language)}</span></td>
                    <td>
                      {(() => {
                        const ep = entryProgressMap.get(entry.modName + "::" + entry.key);
                        let fallbackStatus: string;
                        switch (entry.sourceType) {
                          case "llm":
                          case "existing":
                            fallbackStatus = "completed";
                            break;
                          case "skipped":
                            fallbackStatus = "skip";
                            break;
                          case "dictionary":
                            fallbackStatus = "dictionaryHit";
                            break;
                          default:
                            fallbackStatus = entry.sourceType;
                        }
                        const status = ep ? ep.status : fallbackStatus;
                        return <span className={`badge badge-${status}`}>{statusLabel(status, language)}</span>;
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

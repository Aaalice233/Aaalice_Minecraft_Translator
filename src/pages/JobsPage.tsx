import { AlertTriangle, CheckCircle, FileText, Play, Square, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelTranslation, startTranslation } from "../api/tauri";
import { t } from "../i18n/translations";
import type { AppLanguage, ScanSummary, TranslateLogEntry, TranslateProgress } from "../types";

interface Props {
  language: AppLanguage;
  scanSummary: ScanSummary | null;
  onScanSummaryChange: (summary: ScanSummary) => void;
  settings: { instancePath: string; sourceLanguage: string; targetLanguage: string };
}

type TranslationStatus = "idle" | "running" | "completed" | "canceled" | "failed";

export function JobsPage({ language, scanSummary, onScanSummaryChange, settings }: Props) {
  const [translateProgress, setTranslateProgress] = useState<TranslateProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [translationResult, setTranslationResult] = useState<number | null>(null);
  const [translationError, setTranslationError] = useState<string>("");
  const [logEntries, setLogEntries] = useState<TranslateLogEntry[]>([]);
  const [filterTerm, setFilterTerm] = useState("");
  const logContainerRef = useRef<HTMLDivElement>(null);

  const canTranslate = scanSummary && scanSummary.actualPendingEntries > 0 && status === "idle";

  // Register translate-progress listener
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      listen("translate-progress", (event) => {
        setTranslateProgress(event.payload as TranslateProgress);
      }).then((unlisten) => {
        unlistenFn = unlisten;
        if (cancelled) unlisten();
      });
    }).catch((err) => {
      console.error("translate-progress listener registration failed:", err);
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Register translate-log-entry listener
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      // Browser preview: populate mock data
      setLogEntries([
        { key: "item.example.name", sourceText: "Example Item", targetText: "示例物品", modName: "example-mod-1.21.1.jar", sourceType: "llm" },
        { key: "item.example.desc", sourceText: "A useful example item", targetText: "一个有用的示例物品", modName: "example-mod-1.21.1.jar", sourceType: "llm" },
        { key: "block.example.ore", sourceText: "Example Ore", targetText: "示例矿石", modName: "example-mod-1.21.1.jar", sourceType: "dictionary" },
      ]);
      return;
    }
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      listen("translate-log-entry", (event) => {
        const entry = event.payload as TranslateLogEntry;
        setLogEntries((prev) => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }).then((unlisten) => {
        unlistenFn = unlisten;
        if (cancelled) unlisten();
      });
    }).catch((err) => {
      console.error("translate-log-entry listener registration failed:", err);
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Auto-scroll log panel when new entries arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logEntries]);

  async function handleStart() {
    if (!scanSummary) return;
    setIsRunning(true);
    setStatus("running");
    setTranslateProgress(null);
    setTranslationResult(null);
    setTranslationError("");

    try {
      const result = await startTranslation(
        settings.instancePath || scanSummary.instancePath,
        settings.sourceLanguage || scanSummary.sourceLanguage,
        settings.targetLanguage || scanSummary.targetLanguage,
        scanSummary.actualPendingEntries,
      );
      setTranslationResult(result);
      setStatus("completed");

      // Re-scan to refresh pending counts after translation
      if ("__TAURI_INTERNALS__" in window) {
        try {
          const { scanInstance } = await import("../api/tauri");
          const newSummary = await scanInstance(
            settings.instancePath || scanSummary.instancePath,
            settings.sourceLanguage || scanSummary.sourceLanguage,
            settings.targetLanguage || scanSummary.targetLanguage,
          );
          onScanSummaryChange(newSummary);
        } catch (scanErr) {
          console.warn("翻译后自动重新扫描失败：", scanErr);
        }
      }
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : String(err));
      setStatus("failed");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleCancel() {
    try {
      await cancelTranslation();
      setStatus("canceled");
      setTranslationResult(null);
      setIsRunning(false);
    } catch (err) {
      console.warn("取消翻译失败：", err);
    }
  }

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

  const copyEntry = useCallback(async (entry: TranslateLogEntry) => {
    try {
      await navigator.clipboard.writeText(
        `${entry.key}: ${entry.sourceText} -> ${entry.targetText}`,
      );
    } catch {
      // clipboard not available
    }
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    setFilterTerm("");
  }, []);

  const stageLabel = (phase: string) => {
    const key = `jobs.stage.${phase}` as const;
    const translated = t(language, key as any);
    return translated || phase;
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>{t(language, "jobs.title")}</h1>
          <p>{t(language, "jobs.subtitle")}</p>
        </div>
        <div className="page-header-button">
          <button
            className="primary-button"
            disabled={!canTranslate}
            onClick={handleStart}
            type="button"
          >
            <Play size={18} />
            {isRunning ? t(language, "jobs.running") : t(language, "jobs.start")}
          </button>
          {isRunning && (
            <button className="ghost-button danger" onClick={handleCancel} type="button">
              <Square size={17} />
              {t(language, "jobs.stop")}
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

      {/* Progress bar — visible during running AND after completion/cancel */}
      {(isRunning || status === "completed" || status === "canceled") && (
        <div className="scan-progress">
          <div className="scan-progress-header">
            <strong className="scan-progress-mod" style={{ maxWidth: 300, flex: 1, margin: 0 }}>
              {translateProgress?.modName && translateProgress.phase === "translating"
                ? translateProgress.modName
                : translateProgress
                  ? stageLabel(translateProgress.phase)
                  : t(language, "jobs.translating")}
            </strong>
            <span>
              {translateProgress
                ? `${translateProgress.current.toLocaleString()} / ${translateProgress.total.toLocaleString()}`
                : t(language, "jobs.progressFallback")}
            </span>
            <span className="percent-label">({progressPercent}%)</span>
          </div>
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
          {translateProgress?.subStep && !translateProgress.modName && (
            <small className="scan-progress-mod">{translateProgress.subStep}</small>
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
          {isRunning && status !== "completed" && status !== "canceled" && (
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
          <button className="ghost-button danger" onClick={clearLog} type="button" style={{ height: 30 }}>
            <Trash2 size={14} />
            {t(language, "jobs.logPanel.clear")}
          </button>
        </div>
        <div className="log-panel-body" ref={logContainerRef}>
          {filteredEntries.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry, idx) => (
                  <tr key={`${entry.key}-${idx}`} className="copy-log-row" onClick={() => copyEntry(entry)} title={t(language, "jobs.logPanel.copyEntry")}>
                    <td>{entry.key}</td>
                    <td>{entry.sourceText}</td>
                    <td>{entry.targetText}</td>
                    <td className="truncate" style={{ maxWidth: 180 }}>{entry.modName}</td>
                    <td><span className="badge">{entry.sourceType}</span></td>
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

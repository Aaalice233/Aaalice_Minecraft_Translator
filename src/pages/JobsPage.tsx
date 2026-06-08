import { AlertTriangle, BookOpen, Bot, CheckCircle, FileText, Filter, Play, RefreshCw, Square, X, XCircle, Zap } from "lucide-react";
import { TableVirtuoso } from "react-virtuoso";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelTranslation, loadLatestTranslationJob, retryFailedEntries, startTranslation } from "../api/tauri";
import { useAppState } from "../app/AppContext";
import { t } from "../i18n/translations";
import { useAppStore } from "../stores/appStore";
import { CompletionSummary } from "../components/CompletionSummary";
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

function stageLabel(progress: TranslateProgress | null, lang: AppLanguage): string {
  if (!progress) return t(lang, "jobs.translating");
  switch (progress.phase) {
    case "scanning":
      return `正在扫描: ${progress.modName || ""}`;
    case "extracting":
      return "正在提取待翻译条目...";
    case "dictionary":
      return "正在词典匹配...";
    case "translating": {
      const sub = progress.subStep ? ` (${progress.subStep})` : "";
      return `正在翻译${sub}`;
    }
    default:
      return t(lang, `jobs.stage.${progress.phase}` as any) || progress.phase;
  }
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

const KNOWN_SOURCE_TYPES = ["llm", "dictionary", "existing", "skipped", "failed"] as const;
const KNOWN_STATUSES = ["pending", "dictionaryHit", "skip", "translating", "completed", "failed"] as const;

function entryProgKey(modName: string, key: string): string {
  return modName + "::" + key;
}

/** Module-level status helper: reads from EP map or falls back to sourceType. */
function getEntryStatusFromEP(
  ep: EntryProgress | undefined,
  entry: TranslateLogEntry,
): string {
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

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const LogRow = React.memo(function LogRow({
  entry,
  language,
  copyEntry: onCopy,
  entryProgressRef,
  version,
}: {
  entry: TranslateLogEntry;
  language: AppLanguage;
  copyEntry: (entry: TranslateLogEntry) => void;
  entryProgressRef: { current: Map<string, EntryProgress> };
  version: number;
}) {
  const ep = entryProgressRef.current.get(entryProgKey(entry.modName, entry.key));
  const tgtText = entry.targetText || ep?.targetText || '';
  const st = getEntryStatusFromEP(ep, entry);
  const errorMsg = ep?.errorMessage;
  return (
    <>
      <td>{entry.key}</td>
      <td title={entry.sourceText}>{entry.sourceText}</td>
      <td title={tgtText}>{tgtText}</td>
      <td className="truncate" style={{ maxWidth: 180 }}>{entry.modName}</td>
      <td><span className="badge">{sourceTypeLabel(entry.sourceType, language)}</span></td>
      <td>
        <span className={`badge badge-${st}`} data-tooltip={st === "failed" && errorMsg ? errorMsg : undefined}>
          {statusLabel(st, language)}
        </span>
      </td>
    </>
  );
});

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

export const JobsPage = React.memo(function JobsPage({ language, isActive = true, scanSummary, onScanSummaryChange, settings, onBusyChange, onCompleteChange }: Props) {
  const { state, dispatch } = useAppState();

  const [translateProgress, setTranslateProgress] = useState<TranslateProgress | null>(null);
  const [status, setStatus] = useState<TranslationStatus>(() => state.translationStatus as TranslationStatus || "idle");
  const isRunning = status === "running";
  const [translationResult, setTranslationResult] = useState<number | null>(state.translationResult);
  const [translationError, setTranslationError] = useState<string>(state.translationError);
  const logRef = useRef<TranslateLogEntry[]>([]);
  const [logVersion, setLogVersion] = useState(0);
  const entryProgressMapRef = useRef<Map<string, EntryProgress>>(new Map());
  const [entryProgressVersion, setEntryProgressVersion] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const setTranslateElapsedMs = useAppStore((s) => s.setTranslateElapsedMs);
  const translateElapsedMs = useAppStore((s) => s.translateElapsedMs);
  const [isRetrying, setIsRetrying] = useState(false);
  const [filterTerm, setFilterTerm] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const prevScanJobId = useRef<string | undefined>(undefined);
  const filterRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<any>(null);
  const cancelledRef = useRef(false);
  const postCompletionRescan = useRef(false);

  function getEntryStatus(entry: TranslateLogEntry): string {
    return getEntryStatusFromEP(
      entryProgressMapRef.current.get(entryProgKey(entry.modName, entry.key)),
      entry,
    );
  }

  const canTranslate = scanSummary && scanSummary.actualPendingEntries > 0 && (status === "idle" || status === "failed" || status === "canceled");

  useEffect(() => {
    dispatch({
      type: "SET_TRANSLATION_STATUS",
      payload: { status, result: translationResult, error: translationError },
    });
  }, [status, translationResult, translationError, dispatch]);

  useEffect(() => {
    if (status !== "idle") return; // Already restored from AppContext
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    loadLatestTranslationJob()
      .then((job) => {
        if (cancelled || !job) return;
        dispatch({ type: "SET_TRANSLATION_JOB_ID", payload: job.jobId });
        // Only restore completed status if the job matches the current scan,
        // otherwise stale translate_*.json from a different session would
        // incorrectly show "completed" with zero progress.
        const scanMatches = scanSummary && job.scanJobId === scanSummary.jobId;
        if (job.status === "completed" && scanMatches) {
          setStatus("completed");
          setTranslationResult(job.completedEntries);
          onCompleteChange?.(true);
        }
      })
      .catch((err) => console.warn("恢复翻译状态失败:", err));
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 扫描变更时重置翻译状态，防止 SPN 导航后显示上一次的旧结果
  useEffect(() => {
    const currentId = scanSummary?.jobId;
    if (!currentId) return;
    if (prevScanJobId.current === undefined) {
      prevScanJobId.current = currentId;
      return;
    }
    if (prevScanJobId.current !== currentId) {
      prevScanJobId.current = currentId;
      // 翻译完成后自动重新扫描会传回新 jobId，此时不清空日志和进度
      if (postCompletionRescan.current) {
        postCompletionRescan.current = false;
        return;
      }
      // 取消状态下不清空重置（避免覆盖 cancel 状态）
      if (status === "canceled") return;
      setStatus("idle");
      setTranslationResult(null);
      setTranslationError("");
      onCompleteChange?.(false);
      logRef.current = [];
      setLogVersion(0);
      entryProgressMapRef.current = new Map();
      setEntryProgressVersion((v) => v + 1);
    }
  }, [scanSummary?.jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onBusyChange?.(isRunning);
  }, [isRunning, onBusyChange]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      logRef.current = [
        { key: "item.example.name", sourceText: "Example Item", targetText: "示例物品", modName: "example-mod-1.21.1.jar", sourceType: "llm" },
        { key: "item.example.desc", sourceText: "A useful example item", targetText: "一个有用的示例物品", modName: "example-mod-1.21.1.jar", sourceType: "llm" },
        { key: "block.example.ore", sourceText: "Example Ore", targetText: "示例矿石", modName: "example-mod-1.21.1.jar", sourceType: "dictionary" },
      ];
      setLogVersion(1);
    }
  }, []);

  useTauriEvent<TranslateProgress>("translate-progress", (progress) => {
    if (cancelledRef.current) return;
    setTranslateProgress(progress);
  });

  useTauriEvent<TranslateLogEntry[]>("translate-log-entries", (entries) => {
    if (cancelledRef.current) return;
    logRef.current.push(...entries);
    setLogVersion((v) => v + 1);
  });

  useTauriEvent<EntryProgress[]>("translate-entry-progresses", (entries) => {
    if (cancelledRef.current) return;
    for (const entry of entries) {
      entryProgressMapRef.current.set(`${entry.modName}::${entry.key}`, entry);
    }
    setEntryProgressVersion((v) => v + 1);
  });

  async function handleStart() {
    if (!scanSummary) return;
    cancelledRef.current = false;
    const instPath = settings.instancePath || scanSummary.instancePath;
    const srcLang = settings.sourceLanguage || scanSummary.sourceLanguage;
    const tgtLang = settings.targetLanguage || scanSummary.targetLanguage;

    startTimeRef.current = performance.now();
    setTranslateElapsedMs(null);
    setStatus("running");
    setTranslateProgress(null);
    setTranslationResult(null);
    setTranslationError("");
    logRef.current = [];
    setLogVersion(0);
    entryProgressMapRef.current = new Map();
    setEntryProgressVersion((v) => v + 1);

    try {
      const result = await startTranslation(
        instPath, srcLang, tgtLang,
        scanSummary.jobId,
      );
      if (cancelledRef.current) return;
      setTranslationResult(result);
      setStatus("completed");
      onCompleteChange?.(true);
      const elapsed = performance.now() - (startTimeRef.current ?? performance.now());
      setTranslateElapsedMs(elapsed);

      // Look up jobId and store in AppContext for cross-page access
      if ("__TAURI_INTERNALS__" in window) {
        await Promise.all([
          loadLatestTranslationJob().then((job) => {
            if (job) dispatch({ type: "SET_TRANSLATION_JOB_ID", payload: job.jobId });
          }).catch((err) => console.warn("获取翻译任务 ID 失败:", err)),
          (async () => {
            try {
              const { scanInstance } = await import("../api/tauri");
              postCompletionRescan.current = true;
              onScanSummaryChange(await scanInstance(instPath, srcLang, tgtLang));
            } catch (scanErr) {
              setTranslationError("翻译后自动重新扫描失败: " + toErrorMessage(scanErr));
            }
          })(),
        ]);
      }
    } catch (err) {
      setTranslationError(toErrorMessage(err));
      setStatus("failed");
    }
  }

  async function handleRetry() {
    cancelledRef.current = false;
    const srcLang = settings.sourceLanguage || scanSummary?.sourceLanguage || "auto";
    const tgtLang = settings.targetLanguage || scanSummary?.targetLanguage || "zh_cn";

    let retryJobId = state.translationJobId;
    if (!retryJobId) {
      try {
        const job = await loadLatestTranslationJob();
        if (!job || job.status !== "completed") return;
        retryJobId = job.jobId;
      } catch { return; }
    }

    startTimeRef.current = performance.now();
    setTranslateElapsedMs(null);
    setIsRetrying(true);
    setTranslateProgress(null);
    setStatus("running");
    try {
      const result = await retryFailedEntries(retryJobId, srcLang, tgtLang);
      if (cancelledRef.current) return;
      setStatus("completed");
      setTranslationResult(result);
      const elapsed = performance.now() - (startTimeRef.current ?? performance.now());
      setTranslateElapsedMs(elapsed);
    } catch (err) {
      if (cancelledRef.current) return;
      setTranslateElapsedMs(null);
      setTranslationError(toErrorMessage(err));
      setStatus("failed");
    } finally {
      setIsRetrying(false);
    }
  }

  async function handleCancel() {
    cancelledRef.current = true; // signal handleStart not to set completed
    setTranslateElapsedMs(null);
    try {
      await cancelTranslation();
      setStatus("canceled");
      setTranslationResult(null);
    } catch (err) {
      console.warn("取消翻译失败：", err);
      setStatus("canceled");
      setTranslationError("取消失败: " + toErrorMessage(err));
    }
  }

  const entryCounts = useMemo(() => {
    const c: EntryStatusCounts = {
      pending: 0, dictionaryHit: 0, skip: 0,
      translating: 0, completed: 0, failed: 0,
    };
    entryProgressMapRef.current.forEach((entry) => {
      const s = entry.status as keyof EntryStatusCounts;
      if (s in c) c[s]++;
    });
    return c;
  }, [entryProgressVersion]);

  const visibleStatuses = (scanSummary?.actualPendingEntries ?? 0) > 0
    ? STATUS_META.filter((s) => entryCounts[s.key] > 0)
    : STATUS_META;

  const progressPercent =
    translateProgress && translateProgress.total > 0
      ? Math.min(Math.round((translateProgress.current / translateProgress.total) * 100), 100)
      : 0;

  const filteredEntries = useMemo(() => {
    let result = logRef.current;

    if (filterTerm) {
      const term = filterTerm.toLowerCase();
      result = result.filter(
        (e) =>
          e.modName.toLowerCase().includes(term) ||
          e.key.toLowerCase().includes(term),
      );
    }

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
  }, [logVersion, filterTerm, filters, sortConfig, entryProgressVersion]);

  const copyEntry = useCallback(async (entry: TranslateLogEntry) => {
    try {
      const tgt = entry.targetText || entryProgressMapRef.current.get(entryProgKey(entry.modName, entry.key))?.targetText || "";
      await navigator.clipboard.writeText(
        `${csvQuote(entry.key)},${csvQuote(entry.sourceText)},${csvQuote(tgt)},${csvQuote(entry.modName)}`,
      );
    } catch {
      // clipboard unavailable
    }
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

      {(status === "completed" || (status === "running" && isRetrying)) && translationResult !== null && (
        <div className="alert success" style={{ marginBottom: 16 }}>
          <CheckCircle size={17} />
          <span>{t(language, "jobs.completed.message", { count: translationResult })}</span>
          {isRetrying ? (
            <span className="alert-action-button retrying-indicator">
              <RefreshCw size={15} className="spinning" />
              {t(language, "jobs.retrying")}
            </span>
          ) : entryCounts.failed > 0 && (
            <button
              className="alert-action-button"
              onClick={handleRetry}
              type="button"
            >
              <RefreshCw size={15} />
              {t(language, "jobs.retryFailed")} ({entryCounts.failed})
            </button>
          )}
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

      {/* During translation or cancelled: show progress card */}
      {(isRunning || status === "canceled") && (
        <div className="scan-progress">
          <div className="scan-progress-header">
            <strong className="scan-progress-mod" style={{ maxWidth: 300, flex: 1, margin: 0 }}>
              {stageLabel(translateProgress, language)}
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

          {isRunning && scanSummary && scanSummary.actualPendingEntries > 0 ? (
            <>
              <div className="essb-container">
                <div className="essb-track" style={{ height: 20 }}>
                  {visibleStatuses.map(({ key, color }) => {
                    const count = entryCounts[key];
                    const total = scanSummary.totalPendingEntries;
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
                  {Math.min(Math.round((entryCounts.completed / (scanSummary.totalPendingEntries || 1)) * 100), 100)}%
                </span>
              </div>
              <div className="essb-legend">
                {visibleStatuses.map(({ key, color }) => (
                  <button
                    className={["essb-legend-item", filters.status === key ? "active" : ""].filter(Boolean).join(" ")}
                    key={key}
                    onClick={() => handleFilterChange("status", filters.status === key ? null : key)}
                    type="button"
                    title={filters.status === key ? "点击取消过滤此状态" : "点击过滤此状态"}
                  >
                    <span className="essb-legend-dot" style={{ backgroundColor: color }} />
                    {statusLabel(key, language)}
                    <span className="essb-legend-count">{entryCounts[key]}</span>
                  </button>
                ))}
                {filters.status && (
                  <button
                    className="essb-legend-item essb-legend-clear"
                    onClick={() => handleFilterChange("status", null)}
                    type="button"
                    title="清除状态过滤"
                  >
                    清除过滤
                  </button>
                )}
                <span className="essb-legend-item essb-legend-total">
                  总计 {(scanSummary.actualPendingEntries).toLocaleString()} 条
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: translateProgress && translateProgress.total > 0
                      ? `${progressPercent}%`
                      : "0%",
                    background: status === "canceled" ? "#b0a99c" : undefined,
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

          {status === "canceled" && (
            <small className="scan-progress-status status-canceled">
              {t(language, "jobs.canceledStatus")}
            </small>
          )}
        </div>
      )}

      {/* After translation completes: show completion summary */}
      {!isRunning && status === "completed" && translateElapsedMs !== null && (
        <CompletionSummary
          title={t(language, "summary.translateCompleted")}
          elapsedMs={translateElapsedMs}
          primaryMetrics={[
            {
              icon: <FileText size={18} />,
              template: t(language, "summary.entries"),
              count: translationResult ?? entryCounts.completed,
            },
            {
              icon: <Zap size={18} />,
              template: t(language, "summary.entriesSpeed"),
              count: translateElapsedMs > 0
                ? Math.round(((translationResult ?? entryCounts.completed) / (translateElapsedMs / 1000)) * 10) / 10
                : 0,
            },
          ]}
          secondaryMetrics={[
            {
              icon: <BookOpen size={15} />,
              template: t(language, "summary.dictionary"),
              count: entryCounts.dictionaryHit,
            },
            {
              icon: <Bot size={15} />,
              template: t(language, "summary.llm"),
              count: Math.max(0, (translationResult ?? entryCounts.completed) - entryCounts.dictionaryHit),
            },
            ...(entryCounts.failed > 0
              ? [{ icon: <XCircle size={15} />, template: t(language, "summary.failed"), count: entryCounts.failed }]
              : []),
          ]}
        />
      )}

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
        </div>
        <div className="log-panel-body">
          {filteredEntries.length === 0 || !isActive ? (
            <div className="log-panel-empty">{t(language, "jobs.logPanel.noEntries")}</div>
          ) : (
            <TableVirtuoso
              ref={virtuosoRef}
              followOutput
              style={{ height: "100%" }}
              totalCount={filteredEntries.length}
              components={{
                Table: ({ children, ...rest }) => (
                  <table {...rest}>
                    <colgroup>
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "25%" }} />
                      <col style={{ width: "25%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "10%" }} />
                    </colgroup>
                    {children}
                  </table>
                ),
                TableRow: ({ children, ...rest }) => {
                  const index = (rest as any)["data-index"];
                  const entry = index !== undefined ? filteredEntries[index] : null;
                  return (
                    <tr
                      className="copy-log-row"
                      onClick={() => entry && copyEntry(entry)}
                      title={t(language, "jobs.logPanel.copyEntry")}
                      {...rest}
                    >
                      {children}
                    </tr>
                  );
                },
              }}
              fixedHeaderContent={() => (
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
                              {["key", "sourceText", "targetText", "modName"].includes(col.key) && (
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
                                  {KNOWN_SOURCE_TYPES.map((st) => (
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
                                  {KNOWN_STATUSES.map((st) => (
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
              )}
              itemContent={(index) => {
                const entry = filteredEntries[index];
                return (
                  <LogRow
                    entry={entry}
                    language={language}
                    copyEntry={copyEntry}
                    entryProgressRef={entryProgressMapRef}
                    version={entryProgressVersion}
                  />
                );
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
});

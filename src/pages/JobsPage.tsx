import { AlertTriangle, BookOpen, Bot, CheckCircle, FileText, Play, RefreshCw, Square, XCircle, Zap } from "lucide-react";
import { SearchInput } from "../components/SearchInput";
import { DataTable } from "../components/DataTable";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSortFilter } from "../hooks/useSortFilter";
import { cancelTranslation, loadLatestTranslationJobMeta, loadTranslationResults, retryFailedEntries, startTranslation } from "../api/tauri";
import { MOCK_TRANSLATION_ENTRIES } from "../mocks/browser-translation-log";
import { useAppState } from "../app/AppContext";
import { t } from "../i18n/translations";
import { useAppStore } from "../stores/appStore";
import { toErrorMessage } from "../utils";
import { CompletionSummary } from "../components/CompletionSummary";
import { PageHeader } from "../components/PageHeader";
import type { ColumnConfig } from "../components/SortableTableHeader";
import type { AppLanguage, EntryProgress, ScanSummary, TranslateLogEntry, TranslateProgress, TranslationResult } from "../types";

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

/** Map TranslationResult[] (from JSONL) to TranslateLogEntry[] for log display. */
function toTranslateLogEntries(results: TranslationResult[]): TranslateLogEntry[] {
  return results.map((r) => ({
    key: r.key,
    sourceText: r.sourceText,
    targetText: r.targetText,
    modName: r.modName,
    sourceType: r.sourceType,
  }));
}

function stageLabel(progress: TranslateProgress | null, lang: AppLanguage): string {
  if (!progress) return t(lang, "jobs.translating");
  switch (progress.phase) {
    case "scanning":
      if (progress.subStep) return progress.subStep;
      return t(lang, "jobs.stage.scanning", { mod: progress.modName || "" });
    case "extracting":
      return t(lang, "jobs.stage.extracting");
    case "dictionary":
      return t(lang, "jobs.stage.dictionary");
    case "translating": {
      const sub = progress.subStep ? ` (${progress.subStep})` : "";
      return t(lang, "jobs.stage.translatingWithSub", { sub });
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
      <td title={entry.key}>{entry.key}</td>
      <td title={entry.sourceText}>{entry.sourceText}</td>
      <td title={tgtText}>{tgtText}</td>
      <td title={entry.modName}>{entry.modName}</td>
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
  const sf = useSortFilter<Record<string, string>>();
  const prevScanJobId = useRef<string | undefined>(undefined);
  const virtuosoRef = useRef<any>(null);
  const cancelledRef = useRef(false);
  const postCompletionRescan = useRef(false);
  const retryingRef = useRef(false);
  const savedFailedEntriesRef = useRef(0);

  function getEntryStatus(entry: TranslateLogEntry): string {
    return getEntryStatusFromEP(
      entryProgressMapRef.current.get(entryProgKey(entry.modName, entry.key)),
      entry,
    );
  }

  const canTranslate = scanSummary && scanSummary.actualPendingEntries > 0 && (status === "idle" || status === "failed" || status === "canceled" || status === "completed");

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
    loadLatestTranslationJobMeta()
      .then((job) => {
        if (cancelled || !job) return;
        // Only restore job ID + status if the job matches the current scan,
        // otherwise stale translate_*.json from a different session would
        // incorrectly show "completed" with zero progress and leak into
        // global state, causing ValidatePage to display old results.
        const scanMatches = scanSummary && job.scanJobId === scanSummary.jobId;
        if (!scanMatches) return;
        // 恢复翻译完成计数和重试状态，但不清空日志或自动加载翻译结果。
        // 日志只应在用户点击「开始翻译」后出现，避免磁盘上残留的旧任务自动显示。
        if (job.status === "completed") {
          setTranslationResult(job.completedEntries);
          savedFailedEntriesRef.current = job.failedEntries ?? 0;
        }
      })
      .catch((err) => console.warn("restore translation state failed:", err));
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
      savedFailedEntriesRef.current = 0;
      // 清除旧的翻译任务 ID，防止加载上一次的翻译结果
      dispatch({ type: "SET_TRANSLATION_JOB_ID", payload: null });
      useAppStore.getState().setTranslationJobId(null);
    }
  }, [scanSummary?.jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isRunning) {
      onBusyChange?.(true);
    } else if (status === "idle") {
      // Only clear busy state when truly idle — don't overwrite "completed"/"failed"/"canceled"
      onBusyChange?.(false);
    }
  }, [isRunning, status, onBusyChange]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      logRef.current = [...MOCK_TRANSLATION_ENTRIES];
      setLogVersion(1);
    }
  }, []);

  // ── 页面挂载时加载已有翻译结果（页面切换后日志不丢失） ──
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const translationJobId = useAppStore.getState().translationJobId;
    if (!translationJobId || isRunning) return;
    let cancelled = false;
    loadLatestTranslationJobMeta().then((job) => {
      if (cancelled || !job) return;
      if (logRef.current.length > 0) return; // 已经有日志（来自事件）
      // 只加载与当前扫描匹配的翻译结果，避免显示上一次启动的旧日志
      if (scanSummary && job.scanJobId !== scanSummary.jobId) {
        dispatch({ type: "SET_TRANSLATION_JOB_ID", payload: null });
        useAppStore.getState().setTranslationJobId(null);
        return;
      }
      loadTranslationResults(job.jobId).then((results) => {
        if (cancelled) return;
        const entries = toTranslateLogEntries(results);
        if (entries.length > 0) {
          logRef.current = entries;
          setLogVersion((v) => v + 1);
        }
      });
    });
    return () => { cancelled = true; };
  }, [isRunning, scanSummary?.jobId]);

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
    setTranslateProgress({
      current: 0,
      total: 1,
      phase: "extracting",
      modName: "",
      stageStatus: "running",
    });
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

      // Load results from JSONL so logRef has authoritative source_type data
      // for the summary (pipeline events may not all have arrived yet).
      if ("__TAURI_INTERNALS__" in window) {
        const [job] = await Promise.all([
          loadLatestTranslationJobMeta().then((j) => {
            if (j) dispatch({ type: "SET_TRANSLATION_JOB_ID", payload: j.jobId });
            return j;
          }).catch((err) => { console.warn("get translation job ID failed:", err); return null; }),
          (async () => {
            try {
              const { scanInstance } = await import("../api/tauri");
              postCompletionRescan.current = true;
              onScanSummaryChange(await scanInstance(instPath, srcLang, tgtLang));
            } catch (scanErr) {
              setTranslationError(t(language, "jobs.postScanFailed", { error: toErrorMessage(scanErr) }));
            }
          })(),
        ]);
        // Load the full results into logRef for accurate source-type breakdown
        if (job) {
          try {
            const results = await loadTranslationResults(job.jobId);
            const entries = toTranslateLogEntries(results);
            logRef.current = entries;
            setLogVersion((v) => v + 1);
          } catch (e) {
            console.warn("load translation results for summary failed:", e);
          }
        }
      }
    } catch (err) {
      setTranslationError(toErrorMessage(err));
      setStatus("failed");
    }
  }

  async function handleRetry() {
    if (retryingRef.current) return;
    cancelledRef.current = false;
    const srcLang = settings.sourceLanguage || scanSummary?.sourceLanguage || "auto";
    const tgtLang = settings.targetLanguage || scanSummary?.targetLanguage || "zh_cn";

    let retryJobId = state.translationJobId;
    if (!retryJobId) {
      try {
        const job = await loadLatestTranslationJobMeta();
        if (!job || job.status !== "completed") return;
        retryJobId = job.jobId;
      } catch { return; }
    }

    startTimeRef.current = performance.now();
    retryingRef.current = true;
    setTranslateElapsedMs(null);
    setIsRetrying(true);
    setTranslateProgress(null);
    setStatus("running");
    try {
      await retryFailedEntries(retryJobId, srcLang, tgtLang);
      if (cancelledRef.current) return;
      setStatus("completed");
      onCompleteChange?.(true);
      const elapsed = performance.now() - (startTimeRef.current ?? performance.now());
      setTranslateElapsedMs(elapsed);
    } catch (err) {
      if (cancelledRef.current) return;
      setTranslateElapsedMs(null);
      setTranslationError(toErrorMessage(err));
      setStatus("failed");
    } finally {
      retryingRef.current = false;
      setIsRetrying(false);
    }
  }

  function handleResetToIdle() {
    cancelledRef.current = false;
    setStatus("idle");
    setTranslationResult(null);
    setTranslationError("");
    onCompleteChange?.(false);
    logRef.current = [];
    setLogVersion(0);
    entryProgressMapRef.current = new Map();
    setEntryProgressVersion((v) => v + 1);
  }

  async function handleCancel() {
    cancelledRef.current = true; // signal handleStart not to set completed
    setTranslateElapsedMs(null);
    try {
      await cancelTranslation();
      setStatus("canceled");
      setTranslationResult(null);
    } catch (err) {
      console.warn("Cancel translation failed:", err);
      setStatus("canceled");
      setTranslationError(t(language, "jobs.cancelFailed", { error: toErrorMessage(err) }));
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

  /** Source-type counts from log entries (single pass over the array).
   *  Replaces the old `completed - dictionaryHit` formula that overcounted LLM
   *  by including "existing" entries in the "completed" status bucket.
   *  All counts come from the authoritative JSONL file, not event channels,
   *  so they are accurate even when late EntryProgress events haven't arrived. */
  const sourceTypeCounts = useMemo(() => {
    const c = { llm: 0, existing: 0, skipped: 0, dictionary: 0 };
    for (const e of logRef.current) {
      if (e.sourceType === "llm") c.llm++;
      else if (e.sourceType === "existing") c.existing++;
      else if (e.sourceType === "skipped") c.skipped++;
      else if (e.sourceType === "dictionary") c.dictionary++;
    }
    return c;
  }, [logVersion]);

  const visibleStatuses = (scanSummary?.actualPendingEntries ?? 0) > 0
    ? STATUS_META.filter((s) => entryCounts[s.key] > 0)
    : STATUS_META;

  const progressPercent =
    translateProgress && translateProgress.total > 0
      ? Math.min(Math.round((translateProgress.current / translateProgress.total) * 100), 100)
      : 0;
  const shouldShowEntryStatusSegments =
    isRunning
    && scanSummary !== null
    && scanSummary.actualPendingEntries > 0
    && translateProgress?.phase === "translating";

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

    const activeKeys = Object.keys(sf.filters);
    if (activeKeys.length > 0) {
      result = result.filter((entry) =>
        activeKeys.every((col) => {
          const value = sf.filters[col];
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

    if (sf.sortConfig) {
      const sc = sf.sortConfig;
      result = [...result].sort((a, b) => {
        const dir = sc.direction === "asc" ? 1 : -1;
        let cmp = 0;
        switch (sc.key) {
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
  }, [logVersion, filterTerm, sf.filters, sf.sortConfig, entryProgressVersion]);

  const jobColumnsMemo: ColumnConfig[] = useMemo(() => [
    { key: "key", label: t(language, "jobs.logPanel.colKey"), filterType: "text" },
    { key: "sourceText", label: t(language, "jobs.logPanel.colSource"), filterType: "text" },
    { key: "targetText", label: t(language, "jobs.logPanel.colTarget"), filterType: "text" },
    { key: "modName", label: t(language, "jobs.logPanel.colMod"), filterType: "text" },
    {
      key: "sourceType",
      label: t(language, "jobs.logPanel.colType"),
      filterType: "select",
      filterOptions: KNOWN_SOURCE_TYPES.map((st) => ({
        value: st,
        label: sourceTypeLabel(st, language),
      })),
    },
    {
      key: "status",
      label: t(language, "jobs.logPanel.colStatus"),
      filterType: "select",
      filterOptions: KNOWN_STATUSES.map((st) => ({
        value: st,
        label: statusLabel(st, language),
      })),
    },
  ], [language]);

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

  // Stable renderRow/RowWrapper to avoid DataTable re-initialization
  const jobsRenderRow = useCallback(
    (entry: TranslateLogEntry, index: number) => (
      <LogRow
        entry={entry}
        language={language}
        copyEntry={copyEntry}
        entryProgressRef={entryProgressMapRef}
        version={entryProgressVersion}
      />
    ),
    [language, copyEntry, entryProgressVersion],
  );

  const jobsRowWrapper = useCallback(
    ({ item: entry, children, ...rest }: { item: TranslateLogEntry; children: React.ReactNode; [key: string]: any }) => (
      <tr
        className="copy-log-row"
        onClick={() => copyEntry(entry)}
        title={t(language, "jobs.logPanel.copyEntry")}
        {...rest}
      >
        {children}
      </tr>
    ),
    [language, copyEntry],
  );

  return (
    <section className="page page-jobs">
      <PageHeader
        title={t(language, "jobs.title")}
        subtitle={t(language, "jobs.subtitle")}
        actions={
          isRunning ? (
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
              {status === "completed" ? t(language, "jobs.restart") : t(language, "jobs.start")}
            </button>
          )
        }
      />

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
          ) : (
            <>
              {(entryCounts.failed > 0 || savedFailedEntriesRef.current > 0) && (
                <button
                  className="alert-action-button"
                  onClick={handleRetry}
                  type="button"
                >
                  <RefreshCw size={15} />
                  {t(language, "jobs.retryFailed")} ({Math.max(entryCounts.failed, savedFailedEntriesRef.current)})
                </button>
              )}
            </>
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

          {shouldShowEntryStatusSegments && scanSummary ? (
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
                        title={t(language, "jobs.entryCountWithPercent", { label: statusLabel(key, language), count: count.toString(), percent: Math.round(pct).toString() })}
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
                    className={["essb-legend-item", sf.filters.status === key ? "active" : ""].filter(Boolean).join(" ")}
                    key={key}
                    onClick={() => sf.handleFilterChange("status", sf.filters.status === key ? null : key)}
                    type="button"
                    title={sf.filters.status === key ? t(language, "jobs.clearStatusFilter") : t(language, "jobs.filterByStatus")}
                  >
                    <span className="essb-legend-dot" style={{ backgroundColor: color }} />
                    {statusLabel(key, language)}
                    <span className="essb-legend-count">{entryCounts[key]}</span>
                  </button>
                ))}
                {sf.filters.status && (
                  <button
                    className="essb-legend-item essb-legend-clear"
                    onClick={() => sf.handleFilterChange("status", null)}
                    type="button"
                    title={t(language, "jobs.clearStatusFilter")}
                  >
                    {t(language, "jobs.clearFilter")}
                  </button>
                )}
                <span className="essb-legend-item essb-legend-total">
                  {t(language, "jobs.totalCount", { count: (scanSummary.actualPendingEntries).toLocaleString() })}
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
              count: sourceTypeCounts.dictionary,
            },
            ...(sourceTypeCounts.existing > 0
              ? [{ icon: <CheckCircle size={15} />, template: t(language, "summary.existing"), count: sourceTypeCounts.existing }]
              : []),
            ...(sourceTypeCounts.skipped > 0
              ? [{ icon: <FileText size={15} />, template: t(language, "summary.skipped"), count: sourceTypeCounts.skipped }]
              : []),
            {
              icon: <Bot size={15} />,
              template: t(language, "summary.llm"),
              count: sourceTypeCounts.llm,
            },
            ...(Math.max(entryCounts.failed, savedFailedEntriesRef.current) > 0
              ? [{ icon: <XCircle size={15} />, template: t(language, "summary.failed"), count: Math.max(entryCounts.failed, savedFailedEntriesRef.current) }]
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
          <SearchInput
            value={filterTerm}
            onChange={setFilterTerm}
            placeholder={t(language, "jobs.logPanel.filterPlaceholder")}
          />
        </div>
        <div className="log-panel-body">
          {!isActive ? (
            <div className="log-panel-empty">{t(language, "jobs.logPanel.noEntries")}</div>
          ) : (
            <DataTable
              data={filteredEntries}
              columns={jobColumnsMemo}
              sortConfig={sf.sortConfig}
              filters={sf.filters}
              openFilter={sf.openFilter}
              filterRef={sf.filterRef as React.RefObject<HTMLDivElement | null>}
              onSort={sf.handleSort}
              onToggleFilter={sf.toggleFilter}
              onFilterChange={sf.handleFilterChange}
              defaultSortKey="key"
              language={language}
              renderRow={jobsRenderRow}
              colWidths={["16%", "22%", "22%", "18%", "11%", "11%"]}
              RowWrapper={jobsRowWrapper}
              followOutput
              virtuosoRef={virtuosoRef}
            />
          )}
        </div>
      </div>
    </section>
  );
});

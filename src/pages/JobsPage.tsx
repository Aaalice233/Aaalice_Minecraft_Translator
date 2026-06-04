import { AlertTriangle, CheckCircle, FileText, Play, Square, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cancelTranslation, startTranslation } from "../api/tauri";
import { t } from "../i18n/translations";
import type { AppLanguage, ScanSummary, TranslateProgress } from "../types";

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
    } catch (err) {
      console.warn("取消翻译失败：", err);
    }
  }

  const progressPercent =
    translateProgress && translateProgress.total > 0
      ? Math.round((translateProgress.current / translateProgress.total) * 100)
      : 0;

  const stageLabel = (phase: string): string => {
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
          <span>翻译完成：共处理 {translationResult} 条条目</span>
        </div>
      )}

      {status === "canceled" && (
        <div className="alert warning" style={{ marginBottom: 16 }}>
          <XCircle size={17} />
          <span>翻译已取消</span>
        </div>
      )}

      {status === "failed" && translationError && (
        <div className="alert error" style={{ marginBottom: 16 }}>
          <AlertTriangle size={17} />
          <span>翻译失败：{translationError}</span>
        </div>
      )}

      {scanSummary && scanSummary.actualPendingEntries > 0 && status === "idle" && (
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-title">
              <h2>{t(language, "jobs.summary")}</h2>
            </div>
            <div className="stats-grid compact">
              <article className="stat-card">
                <span>{t(language, "jobs.totalEntries")}</span>
                <strong>{scanSummary.actualPendingEntries.toLocaleString()}</strong>
              </article>
              <article className="stat-card">
                <span>{t(language, "jobs.sourceLang")}</span>
                <strong>{scanSummary.sourceLanguage}</strong>
              </article>
              <article className="stat-card">
                <span>{t(language, "jobs.targetLang")}</span>
                <strong>{scanSummary.targetLanguage}</strong>
              </article>
              <article className="stat-card">
                <span>{t(language, "jobs.modCount")}</span>
                <strong>{scanSummary.mods.length}</strong>
              </article>
            </div>
          </section>
        </div>
      )}

      {isRunning && (
        <div className="scan-progress">
          <div className="scan-progress-header">
            <strong>
              {translateProgress
                ? stageLabel(translateProgress.phase)
                : t(language, "jobs.translating")}
            </strong>
            <span>
              {translateProgress
                ? `${translateProgress.current.toLocaleString()} / ${translateProgress.total.toLocaleString()}`
                : "- / -"}
            </span>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{
                width: translateProgress && translateProgress.total > 0
                  ? `${progressPercent}%`
                  : "0%",
              }}
            />
          </div>
          {translateProgress?.subStep && (
            <small className="scan-progress-mod">{translateProgress.subStep}</small>
          )}
          {translateProgress?.modName && translateProgress.phase === "translating" && (
            <small className="scan-progress-mod">
              {translateProgress.modName}
            </small>
          )}
          {translateProgress?.stageStatus === "completed" && (
            <small className="scan-progress-status">
              ✔ {stageLabel(translateProgress.phase)}
            </small>
          )}
          {isRunning && translateProgress?.stageStatus !== "completed" && (
            <small className="scan-progress-status">
              {t(language, "jobs.progressHint")}
            </small>
          )}
        </div>
      )}
    </section>
  );
}

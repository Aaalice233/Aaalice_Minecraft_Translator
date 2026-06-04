import { AlertTriangle, FolderOpen, Loader2, RefreshCcw, ScanLine, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cancelScan, saveSettings, scanInstance } from "../api/tauri";
import { localeByAppLanguage, t } from "../i18n/translations";
import type { AppLanguage, ScanProgressEvent, ScanSummary, Settings } from "../types";
import type { TranslationKey } from "../i18n/translations";

interface Props {
  settings: Settings;
  scanSummary: ScanSummary | null;
  onSettingsChange: (settings: Settings) => void;
  onScanSummaryChange: (summary: ScanSummary) => void;
  onScanStart?: () => void;
  language: AppLanguage;
}

export function DashboardPage({
  settings,
  scanSummary,
  onSettingsChange,
  onScanSummaryChange,
  onScanStart,
  language,
}: Props) {
  const [instancePath, setInstancePath] = useState(settings.instancePath);
  const [isScanning, setIsScanning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyFlash = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    } catch { /* clipboard not available */ }
  }, []);

  const stageLabel = (phase: string): string => {
    const key = `dashboard.stage.${phase}` as TranslationKey;
    const translated = t(language, key);
    return translated || phase;
  };

  const numberLocale = localeByAppLanguage[language];
  const progressPercent = (p: ScanProgressEvent) =>
    p.total === 0 ? 0 : Math.round((p.current / p.total) * 100);
  const stats = useMemo(
    () => [
      { label: t(language, "dashboard.stats.mods"), value: scanSummary?.mods.length ?? 0, hint: t(language, "dashboard.stats.modsHint") },
      { label: t(language, "dashboard.stats.pendingEntries"), value: scanSummary?.totalPendingEntries ?? 0, hint: "" },
      { label: t(language, "dashboard.stats.resourcePackCovered"), value: scanSummary?.resourcePackCoveredEntries ?? 0, hint: t(language, "dashboard.stats.resourcePackCoveredHint") },
      { label: t(language, "dashboard.stats.actualPending"), value: scanSummary?.actualPendingEntries ?? 0, hint: t(language, "dashboard.stats.actualPendingHint") },
    ],
    [language, scanSummary],
  );

  // Register scan-progress listener — only in real Tauri runtime
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      listen("scan-progress", (event) => {
        setScanProgress(event.payload as ScanProgressEvent);
      }).then((unlisten) => {
        unlistenFn = unlisten;
        if (cancelled) unlisten();
      });
    }).catch((err) => {
      console.error("scan-progress listener registration failed:", err);
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await cancelScan();
    } catch (err) {
      console.error("取消扫描失败:", err);
      setError("取消扫描失败: " + (err instanceof Error ? err.message : String(err)));
      setIsCancelling(false);
    }
  }

  async function handleScan() {
    setIsScanning(true);
    setIsCancelling(false);
    setScanProgress(null);
    setError("");
    onScanStart?.();
    try {
      const nextSettings = { ...settings, instancePath };
      onSettingsChange(nextSettings);
      await saveSettings(nextSettings);
      const summary = await scanInstance(
        instancePath,
        nextSettings.sourceLanguage,
        nextSettings.targetLanguage,
      );
      onScanSummaryChange(summary);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setIsScanning(false);
      setIsCancelling(false);
    }
  }

  return (
    <section className="page dashboard-page">
      <div className="page-header">
        <div>
          <h1>{t(language, "dashboard.title")}</h1>
          <p>{t(language, "dashboard.subtitle")}</p>
        </div>
        <div className="page-header-button">
          <button
            className={[
              "primary-button",
              isScanning && !isCancelling && "danger",
              isCancelling && "cancelling",
            ].filter(Boolean).join(" ")}
            disabled={isCancelling}
            onClick={isScanning ? handleCancel : handleScan}
            type="button"
          >
            {isCancelling ? (
              <Loader2 size={18} className="spin" />
            ) : isScanning ? (
              <Square size={18} />
            ) : (
              <ScanLine size={18} />
            )}
            {isCancelling
              ? t(language, "dashboard.cancelling")
              : isScanning
                ? t(language, "dashboard.cancel")
                : t(language, "dashboard.scan")}
          </button>
        </div>
      </div>

      <div className="instance-row">
        <label>
          {t(language, "dashboard.instancePath")}
          <input
            value={instancePath}
            onChange={(event) => setInstancePath(event.target.value)}
            placeholder={t(language, "dashboard.instancePlaceholder")}
          />
        </label>
        <button className="ghost-button" type="button">
          <FolderOpen size={17} />
          {t(language, "dashboard.pickInstance")}
        </button>
        <button className="ghost-button" disabled={isScanning} onClick={handleScan} type="button">
          <RefreshCcw size={17} />
          {t(language, "dashboard.rescan")}
        </button>
      </div>

      {isScanning && scanProgress && (
        <div className="scan-progress">
          <div className="scan-progress-header">
            <strong>{stageLabel(scanProgress.phase)}</strong>
            <span>{t(language, "dashboard.scanProgress", { current: scanProgress.current, total: scanProgress.total })}</span>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${progressPercent(scanProgress)}%` }}
            />
          </div>
          {scanProgress.stageStatus === "completed" && (
            <small className="scan-progress-status">✔ {stageLabel(scanProgress.phase)}</small>
          )}
          {scanProgress.subStep && (
            <small className="scan-progress-mod">{scanProgress.subStep}</small>
          )}
          {!scanProgress.subStep && scanProgress.modName && scanProgress.phase === "scan" && (
            <small className="scan-progress-mod">{scanProgress.modName}</small>
          )}
        </div>
      )}

      {error && (
        <div className="alert error">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}

      {!isScanning && scanSummary?.cancelled && (
        <div className="alert warning">
          <AlertTriangle size={17} />
          {t(language, "dashboard.cancelledMessage")}
        </div>
      )}

      {scanSummary?.warnings.slice(0, 6).map((warning) => (
        <div className="alert warning" key={`${warning.code}-${warning.path}`}>
          <AlertTriangle size={17} />
          <span>{warning.message}</span>
          <code>{warning.path}</code>
        </div>
      ))}
      {scanSummary && scanSummary.warnings.length > 6 && (
        <div className="alert warning">
          <AlertTriangle size={17} />
          {t(language, "dashboard.moreWarnings", { count: scanSummary.warnings.length - 6 })}
        </div>
      )}

      <div className="stats-grid">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value.toLocaleString(numberLocale)}</strong>
            <small>{stat.hint}</small>
          </article>
        ))}
      </div>

      <div className="resource-bar">
        <span className="resource-bar-label">{t(language, "dashboard.resourceSources")}</span>
        {(scanSummary?.resourcePacks ?? []).map((pack) => (
          <span key={pack.path} className="resource-chip">
            <strong>{pack.name}</strong>
            <span>{t(language, "dashboard.resourceCount", { files: pack.langFileCount, entries: pack.entryCount })}</span>
            <span className={`badge ${pack.sourceType}`}>{pack.sourceType}</span>
          </span>
        ))}
        {!scanSummary && <span className="resource-bar-empty">{t(language, "dashboard.emptyResource")}</span>}
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>{t(language, "dashboard.modsTitle")}</h2>
            <span>{scanSummary ? scanSummary.mods.length : t(language, "dashboard.waiting")}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t(language, "dashboard.column.mod")}</th>
                  <th>{t(language, "dashboard.column.modId")}</th>
                  <th>{t(language, "dashboard.column.format")}</th>
                  <th>{t(language, "dashboard.column.langFiles")}</th>
                  <th>{t(language, "dashboard.column.pending")}</th>
                  <th>{t(language, "dashboard.column.status")}</th>
                </tr>
              </thead>
              <tbody>
                {(scanSummary?.mods ?? []).map((mod) => (
                  <tr key={mod.jarPath}>
                    <td
                      className="copy-cell mod-name"
                      onClick={() => copyFlash(mod.fileName, `n-${mod.jarPath}`)}
                      onKeyDown={(e) => e.key === "Enter" && copyFlash(mod.fileName, `n-${mod.jarPath}`)}
                      tabIndex={0}
                      title={mod.fileName}
                    >
                      {mod.fileName}
                      {copiedKey === `n-${mod.jarPath}` && <span className="copy-flash">{t(language, "common.copied")}</span>}
                    </td>
                    <td
                      className="copy-cell mod-id"
                      onClick={() => copyFlash(mod.modId, `i-${mod.jarPath}`)}
                      onKeyDown={(e) => e.key === "Enter" && copyFlash(mod.modId, `i-${mod.jarPath}`)}
                      tabIndex={0}
                      title={mod.modId}
                    >
                      {mod.modId}
                      {copiedKey === `i-${mod.jarPath}` && <span className="copy-flash">{t(language, "common.copied")}</span>}
                    </td>
                    <td>{mod.formats.join(" / ") || "-"}</td>
                    <td>{mod.languageFileCount}</td>
                    <td>{Math.max(0, mod.sourceEntries - mod.targetEntries)}</td>
                    <td>
                      <span className={mod.hasTargetLanguage ? "badge success" : "badge muted"}>
                        {mod.hasTargetLanguage ? t(language, "dashboard.hasTarget") : t(language, "dashboard.needsTranslation")}
                      </span>
                    </td>
                  </tr>
                ))}
                {!scanSummary && (
                  <tr>
                    <td colSpan={6}>{t(language, "dashboard.emptyScan")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </section>
  );
}

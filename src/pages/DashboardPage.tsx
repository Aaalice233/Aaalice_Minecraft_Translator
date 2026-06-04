import { AlertTriangle, FolderOpen, RefreshCcw, ScanLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { saveSettings, scanInstance } from "../api/tauri";
import { localeByAppLanguage, t } from "../i18n/translations";
import type { AppLanguage, ScanProgressEvent, ScanSummary, Settings } from "../types";

interface Props {
  settings: Settings;
  scanSummary: ScanSummary | null;
  onSettingsChange: (settings: Settings) => void;
  onScanSummaryChange: (summary: ScanSummary) => void;
  language: AppLanguage;
}

export function DashboardPage({
  settings,
  scanSummary,
  onSettingsChange,
  onScanSummaryChange,
  language,
}: Props) {
  const [instancePath, setInstancePath] = useState(settings.instancePath);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [error, setError] = useState("");

  const numberLocale = localeByAppLanguage[language];
  const sourceLabel = scanSummary?.sourceLanguage ?? settings.sourceLanguage;
  const targetLabel = scanSummary?.targetLanguage ?? settings.targetLanguage;
  const progressPercent = (p: ScanProgressEvent) =>
    p.total === 0 ? 0 : Math.round((p.current / p.total) * 100);
  const stats = useMemo(
    () => [
      { label: t(language, "dashboard.stats.mods"), value: scanSummary?.mods.length ?? 0, hint: t(language, "dashboard.stats.modsHint") },
      { label: t(language, "dashboard.stats.langFiles"), value: scanSummary?.totalLanguageFiles ?? 0, hint: `${sourceLabel} / ${targetLabel}` },
      { label: t(language, "dashboard.stats.sourceEntries"), value: scanSummary?.totalSourceEntries ?? 0, hint: sourceLabel },
      { label: t(language, "dashboard.stats.targetEntries"), value: scanSummary?.totalTargetEntries ?? 0, hint: targetLabel },
      { label: t(language, "dashboard.stats.pendingEntries"), value: scanSummary?.totalPendingEntries ?? 0, hint: t(language, "dashboard.stats.pendingHint") },
      {
        label: t(language, "dashboard.stats.recovered"),
        value: scanSummary?.mods.reduce((sum, mod) => sum + mod.recoveredLanguageFiles, 0) ?? 0,
        hint: t(language, "dashboard.stats.recoveredHint"),
      },
    ],
    [language, scanSummary, sourceLabel, targetLabel],
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

  async function handleScan() {
    setIsScanning(true);
    setScanProgress(null);
    setError("");
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
            className={isScanning ? "primary-button scanning" : "primary-button"}
            disabled={isScanning}
            onClick={handleScan}
            type="button"
          >
            <ScanLine size={18} />
            {isScanning ? t(language, "dashboard.scanning") : t(language, "dashboard.scan")}
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
            <strong>{t(language, "dashboard.scanning")}</strong>
            <span>{t(language, "dashboard.scanProgress", { current: scanProgress.current, total: scanProgress.total })}</span>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${progressPercent(scanProgress)}%` }}
            />
          </div>
          <small className="scan-progress-mod">{scanProgress.modName}</small>
        </div>
      )}

      {error && (
        <div className="alert error">
          <AlertTriangle size={17} />
          {error}
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

      <div className="dashboard-grid">
        <section className="panel wide">
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
                  <th>{t(language, "dashboard.column.recovered")}</th>
                  <th>{t(language, "dashboard.column.source")}</th>
                  <th>{t(language, "dashboard.column.target")}</th>
                  <th>{t(language, "dashboard.column.status")}</th>
                </tr>
              </thead>
              <tbody>
                {(scanSummary?.mods ?? []).map((mod) => (
                  <tr key={mod.jarPath}>
                    <td>{mod.fileName}</td>
                    <td>{mod.modId}</td>
                    <td>{mod.formats.join(" / ") || "-"}</td>
                    <td>{mod.languageFileCount}</td>
                    <td>
                      {mod.recoveredLanguageFiles > 0 || mod.failedLanguageFiles > 0
                        ? `${mod.recoveredLanguageFiles}/${mod.failedLanguageFiles}`
                        : "-"}
                    </td>
                    <td title={mod.resolvedSourceLanguage}>{mod.sourceEntries}</td>
                    <td>{mod.targetEntries}</td>
                    <td>
                      <span className={mod.hasTargetLanguage ? "badge success" : "badge muted"}>
                        {mod.hasTargetLanguage ? t(language, "dashboard.hasTarget") : t(language, "dashboard.needsTranslation")}
                      </span>
                    </td>
                  </tr>
                ))}
                {!scanSummary && (
                  <tr>
                    <td colSpan={8}>{t(language, "dashboard.emptyScan")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>{t(language, "dashboard.resourceSources")}</h2>
            <span>{scanSummary?.resourcePacks.length ?? 0}</span>
          </div>
          <div className="resource-list">
            {(scanSummary?.resourcePacks ?? []).map((pack) => (
              <article key={pack.path} className="resource-item">
                <div>
                  <strong>{pack.name}</strong>
                  <span>{t(language, "dashboard.resourceCount", { files: pack.langFileCount, entries: pack.entryCount })}</span>
                </div>
                <span className={`badge ${pack.sourceType}`}>{pack.sourceType}</span>
              </article>
            ))}
            {!scanSummary && <div className="empty-state compact">{t(language, "dashboard.emptyResource")}</div>}
          </div>
        </section>
      </div>
    </section>
  );
}

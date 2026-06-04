import { Boxes, Copy, FileArchive, Eye } from "lucide-react";
import { useState } from "react";
import { copyPackToInstance, generateTranslationPack } from "../api/tauri";
import { t } from "../i18n/translations";
import type { AppLanguage, CopyResult, PackResult, ScanSummary } from "../types";

interface Props {
  language: AppLanguage;
  scanSummary: ScanSummary | null;
  settings: { instancePath: string };
}

export function PackagesPage({ language, scanSummary, settings }: Props) {
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");

  const canGenerate = scanSummary && scanSummary.actualPendingEntries > 0 && !loading;

  const handleGenerate = async (dryRun: boolean) => {
    if (!scanSummary) return;
    setLoading(true);
    setError("");
    try {
      // Collect all entries from mods
      const entries = scanSummary.mods.flatMap((mod) =>
        mod.entries
          .filter((e) => e.language === scanSummary.sourceLanguage)
          .map((e) => ({ modId: e.modId, key: e.key, text: e.text }))
      );
      const result = await generateTranslationPack(
        entries,
        scanSummary.targetLanguage,
        dryRun,
      );
      setPackResult(result);
      if (!dryRun) {
        setShowConfirm(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToInstance = async () => {
    if (!packResult?.zipPath) return;
    setError("");
    try {
      const result = await copyPackToInstance(
        packResult.zipPath,
        settings.instancePath,
        true,
      );
      setCopyResult(result);
      setShowConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>{t(language, "packages.title")}</h1>
          <p>{t(language, "packages.subtitle")}</p>
        </div>
        <div className="page-header-button">
          <button
            className="ghost-button"
            disabled={!canGenerate}
            onClick={() => handleGenerate(true)}
            type="button"
          >
            <Eye size={17} />
            {t(language, "packages.dryRun")}
          </button>
          <button
            className="primary-button"
            disabled={!canGenerate}
            onClick={() => handleGenerate(false)}
            type="button"
          >
            <FileArchive size={18} />
            {t(language, "packages.generate")}
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {!scanSummary && (
        <div className="empty-state">
          <Boxes size={32} />
          <p>{t(language, "packages.noScan")}</p>
        </div>
      )}

      {packResult && (
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-title">
              <h2>{t(language, "packages.result")}</h2>
            </div>
            <div className="stats-grid compact">
              <article className="stat-card">
                <span>{t(language, "packages.mods")}</span>
                <strong>{packResult.modCount}</strong>
              </article>
              <article className="stat-card">
                <span>{t(language, "packages.entries")}</span>
                <strong>{packResult.entryCount}</strong>
              </article>
              {packResult.conflicts.length > 0 && (
                <article className="stat-card warning">
                  <span>{t(language, "packages.conflicts")}</span>
                  <strong>{packResult.conflicts.length}</strong>
                </article>
              )}
            </div>
            {packResult.conflicts.length > 0 && (
              <div className="conflict-list">
                <h3>{t(language, "packages.conflictDetail")}</h3>
                {packResult.conflicts.slice(0, 20).map((c, i) => (
                  <div key={i} className="conflict-item">
                    <code>{c.modId}:{c.key}</code>
                    <div className="conflict-diff">
                      <del>{c.existingText}</del>
                      <ins>{c.dictionaryText}</ins>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {showConfirm && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">
            <h2>{t(language, "packages.confirmTitle")}</h2>
          </div>
          <p>{t(language, "packages.confirmMessage", { path: settings.instancePath })}</p>
          <div className="page-header-button" style={{ marginTop: 12 }}>
            <button className="ghost-button" onClick={() => setShowConfirm(false)} type="button">
              {t(language, "common.cancel")}
            </button>
            <button className="primary-button" onClick={handleCopyToInstance} type="button">
              <Copy size={17} />
              {t(language, "packages.copyToInstance")}
            </button>
          </div>
        </div>
      )}

      {copyResult && (
        <div className={`alert ${copyResult.success ? "success" : "error"}`}>
          {copyResult.success
            ? t(language, "packages.copySuccess", {
                path: copyResult.targetPath,
                replaced: copyResult.replaced ? t(language, "packages.replaced") : "",
              })
            : t(language, "packages.copyFailed")}
        </div>
      )}
    </section>
  );
}

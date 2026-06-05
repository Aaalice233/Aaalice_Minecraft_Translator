import { Boxes, Copy, FileArchive, Eye, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { copyPackToInstance, generatePackFromJob, generateTranslationPack, loadLatestTranslationJob } from "../api/tauri";
import { useAppState } from "../app/AppContext";
import { t } from "../i18n/translations";
import type { AppLanguage, CopyResult, PackResult, ScanSummary, TranslationJobState } from "../types";

interface Props {
  language: AppLanguage;
  scanSummary?: ScanSummary | null;
  settings?: { instancePath: string };
  onBusyChange?: (busy: boolean) => void;
}

export function PackagesPage({ language, scanSummary: _scanSummary, settings: _settings, onBusyChange: _onBusyChange }: Props) {
  const { state, dispatch } = useAppState();
  const scanSummary = _scanSummary !== undefined ? _scanSummary : state.scanSummary;
  const settings = _settings ?? state.settings!;
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");

  // Job-based state
  const [translationJob, setTranslationJob] = useState<TranslationJobState | null>(null);
  const [loadingJob, setLoadingJob] = useState(true);

  // On mount, try to find the latest completed translation job
  useEffect(() => {
    let cancelled = false;
    setLoadingJob(true);
    loadLatestTranslationJob()
      .then((job) => {
        if (!cancelled && job?.status === "completed") {
          setTranslationJob(job);
        }
      })
      .catch((err) => {
        console.warn("加载翻译结果失败:", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingJob(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Sync packaging busy state to sidebar nav
  useEffect(() => {
    dispatch({ type: "SET_NAV_STATE", payload: { key: "packages", status: loading ? "busy" : "idle" } });
  }, [loading, dispatch]);

  const canGenerate = scanSummary && scanSummary.actualPendingEntries > 0 && !loading;

  // ── Generate from scan (old path) ─────────────────────────────

  const handleGenerateFromScan = async (dryRun: boolean) => {
    if (!scanSummary) return;
    setLoading(true);
    setError("");
    try {
      const entries = scanSummary.mods.flatMap((mod) =>
        mod.entries
          .filter((e) => e.language === scanSummary.sourceLanguage)
          .map((e) => ({ modId: e.modId, key: e.key, text: e.text }))
      );
      const result = await generateTranslationPack(entries, scanSummary.targetLanguage, dryRun);
      setPackResult(result);
      if (!dryRun) setShowConfirm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Generate from translation job (new path) ──────────────────

  const languageMismatch = settings.instancePath && translationJob
    && translationJob.targetLanguage !== scanSummary?.targetLanguage;

  const handleGenerateFromJob = async (dryRun: boolean) => {
    if (!translationJob) return;
    setLoading(true);
    setError("");
    try {
      const targetLang = scanSummary?.targetLanguage || translationJob.targetLanguage;
      const result = await generatePackFromJob(
        translationJob.jobId,
        targetLang,
        dryRun,
      );
      setPackResult(result);
      if (!dryRun) setShowConfirm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Copy to instance ──────────────────────────────────────────

  const handleCopyToInstance = async () => {
    if (!packResult?.zipPath) return;
    setError("");
    try {
      const result = await copyPackToInstance(packResult.zipPath, settings.instancePath, true);
      setCopyResult(result);
      setShowConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>{t(language, "packages.title")}</h1>
          <p>{t(language, "packages.subtitle")}</p>
        </div>
        <div className="page-header-button">
          {/* Dry-run buttons */}
          {translationJob && (
            <button
              className="ghost-button"
              disabled={loading}
              onClick={() => handleGenerateFromJob(true)}
              type="button"
              data-tooltip="使用已翻译结果预览"
            >
              <Eye size={17} />
              预览(翻译结果)
            </button>
          )}
          {canGenerate && (
            <button
              className="ghost-button"
              disabled={loading}
              onClick={() => handleGenerateFromScan(true)}
              type="button"
              data-tooltip={t(language, "tooltip.dryRun")}
            >
              <Eye size={17} />
              {t(language, "packages.dryRun")}
            </button>
          )}
          {/* Real generate buttons */}
          {translationJob && (
            <button
              className="primary-button"
              disabled={loading}
              onClick={() => handleGenerateFromJob(false)}
              type="button"
              data-tooltip="从已翻译结果生成资源包"
            >
              {loading ? <Loader2 size={18} className="spin" /> : <FileArchive size={18} />}
              生成(翻译结果)
            </button>
          )}
          {canGenerate && (
            <button
              className="primary-button"
              disabled={loading}
              onClick={() => handleGenerateFromScan(false)}
              type="button"
              data-tooltip={t(language, "tooltip.generatePack")}
            >
              <FileArchive size={18} />
              {t(language, "packages.generate")}
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* Translation job info */}
      {translationJob && (
        <div className="panel" style={{ padding: "12px 18px", marginBottom: 18 }}>
          <span>
            ✅ 翻译结果可用: <code>{translationJob.jobId}</code> —
            {translationJob.completedEntries} 条已翻译 ({translationJob.targetLanguage})
          </span>
          {languageMismatch && (
            <span style={{ display: "block", marginTop: 8, color: "#d4a72c" }}>
              ⚠️ 当前设置的目标语言 ({scanSummary?.targetLanguage})
              与翻译结果的语言 ({translationJob.targetLanguage}) 不一致。
              将使用当前设置的语言打包。
            </span>
          )}
        </div>
      )}

      {!scanSummary && (
        <div className="empty-state">
          <Boxes size={32} />
          <p>{t(language, "packages.noScan")}</p>
        </div>
      )}

      {loadingJob && (
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
          <p>检查翻译结果...</p>
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
            <button className="ghost-button" onClick={() => setShowConfirm(false)} type="button" data-tooltip={t(language, "common.cancel")}>
              {t(language, "common.cancel")}
            </button>
            <button className="primary-button" onClick={handleCopyToInstance} type="button" data-tooltip={t(language, "tooltip.copyToInstance")}>
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

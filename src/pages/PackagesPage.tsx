import { Boxes, Copy, FileArchive, Eye, Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { copyPackToInstance, generatePackFromJob, generateTranslationPack, listTranslationJobs } from "../api/tauri";
import { useAppState } from "../app/AppContext";
import { t } from "../i18n/translations";
import type { AppLanguage, CopyResult, PackResult, ScanSummary, TranslationJobState } from "../types";

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Props {
  language: AppLanguage;
  scanSummary?: ScanSummary | null;
  settings?: { instancePath: string };
  onBusyChange?: (busy: boolean) => void;
}

export const PackagesPage = React.memo(function PackagesPage({ language, scanSummary, settings: _settings, onBusyChange }: Props) {
  const { state, dispatch } = useAppState();
  const settings = _settings!;
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");

  // Job-based state
  const [translationJob, setTranslationJob] = useState<TranslationJobState | null>(null);
  const [loadingJob, setLoadingJob] = useState(true);
  const [allTranslationJobs, setAllTranslationJobs] = useState<TranslationJobState[]>([]);

  // On mount, load all translation jobs (P10 — history selection)
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setLoadingJob(false);
      return;
    }
    let cancelled = false;
    setLoadingJob(true);
    listTranslationJobs()
      .then((jobs) => {
        if (cancelled) return;
        setAllTranslationJobs(jobs);

        // Restore saved selection from AppContext, or fall back to first completed job
        const targetJob = state.packagesJobId
          ? jobs.find((j) => j.jobId === state.packagesJobId)
          : undefined;
        const selected = targetJob ?? jobs.find((j) => j.status === "completed");
        if (selected) {
          setTranslationJob(selected);
          dispatch({ type: "SET_PACKAGES_JOB_ID", payload: selected.jobId });
        }
        setLoadingJob(false);
      })
      .catch((err) => {
        console.warn("加载翻译任务列表失败:", err);
        if (!cancelled) setLoadingJob(false);
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleJobSelect(jobId: string) {
    const job = allTranslationJobs.find((j) => j.jobId === jobId);
    if (job) {
      setTranslationJob(job);
      dispatch({ type: "SET_PACKAGES_JOB_ID", payload: jobId });
    }
  }

  // Sync packaging busy state to sidebar nav
  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  const canGenerate = scanSummary && scanSummary.actualPendingEntries > 0 && !loading;

  // ── Generate from scan (old path) ─────────────────────────────

  const handleGenerateFromScan = async (dryRun: boolean) => {
    if (!scanSummary) return;
    setLoading(true);
    setError("");
    try {
      const entries = scanSummary.mods.flatMap((mod) => {
        // Use existing target-language translation when available
        const targetMap = new Map(
          mod.entries
            .filter((e) => e.language === scanSummary.targetLanguage)
            .map((e) => [e.key, e.text]),
        );
        // Use resolvedSourceLanguage per mod (handles sourceLanguage="auto"),
        // falling back to scanSummary.sourceLanguage for backward compatibility.
        const srcLang = mod.resolvedSourceLanguage || scanSummary.sourceLanguage;
        return mod.entries
          .filter((e) => e.language === srcLang)
          .map((e) => ({
            modId: e.modId,
            key: e.key,
            text: targetMap.get(e.key) || e.text,
            sourceText: e.text,
          }));
      });
      const result = await generateTranslationPack(entries, scanSummary.targetLanguage, dryRun);
      setPackResult(result);
      if (!dryRun) setShowConfirm(true);
    } catch (err) {
      setError(toErrorMessage(err));
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
      setError(toErrorMessage(err));
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
      setError(toErrorMessage(err));
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

      {/* Translation job info with history selector (P10) */}
      {allTranslationJobs.length > 0 && (
        <div className="panel" style={{ padding: "12px 18px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label htmlFor="job-selector" style={{ whiteSpace: "nowrap", fontWeight: 500 }}>
              选择翻译任务:
            </label>
            <select
              id="job-selector"
              className="job-selector"
              value={translationJob?.jobId ?? ""}
              onChange={(e) => handleJobSelect(e.target.value)}
              style={{ flex: 1, maxWidth: 400 }}
            >
              <option value="" disabled>
                -- 请选择翻译任务 --
              </option>
              {allTranslationJobs.map((job) => (
                <option key={job.jobId} value={job.jobId}>
                  [{job.status === "completed" ? "完成" : job.status}] {job.jobId.slice(0, 16)}… —
                  {job.completedEntries} 条 ({job.targetLanguage})
                  {job.createdAt ? ` - ${new Date(job.createdAt).toLocaleDateString()}` : ""}
                </option>
              ))}
            </select>
          </div>
          {translationJob && (
            <div style={{ marginTop: 8 }}>
              <span>
                ✅ 翻译结果可用 — {translationJob.completedEntries} 条已翻译 ({translationJob.targetLanguage})
              </span>
              {languageMismatch && (
                <span style={{ display: "block", marginTop: 4, color: "#d4a72c" }}>
                  ⚠️ 当前设置的目标语言 ({scanSummary?.targetLanguage})
                  与翻译结果的语言 ({translationJob.targetLanguage}) 不一致。
                  将使用当前设置的语言打包。
                </span>
              )}
            </div>
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
});

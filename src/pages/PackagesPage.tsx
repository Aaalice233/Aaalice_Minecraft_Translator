import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileArchive,
  FileText,
  FolderOpen,
  Loader2,
  Minus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  copyFile,
  copyPackToInstance,
  generatePackFromJob,
  loadLatestTranslationJobMeta,
} from "../api/tauri";
import { AnimatedCount } from "../components/AnimatedCount";
import { PageHeader } from "../components/PageHeader";
import { PackingAnimation } from "../components/PackingAnimation";
import { toErrorMessage } from "../utils";
import { t } from "../i18n/translations";
import { useAppStore } from "../stores/appStore";
import type {
  AppLanguage,
  CopyResult,
  PackResult,
  ScanSummary,
  TranslationJobListItem,
} from "../types";

interface Props {
  language: AppLanguage;
  scanSummary?: ScanSummary | null;
  settings?: { instancePath: string };
  onBusyChange?: (busy: boolean) => void;
  onPackComplete?: (done: boolean) => void;
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

export const PackagesPage = React.memo(function PackagesPage({
  language,
  scanSummary,
  settings: _settings,
  onBusyChange,
  onPackComplete,
}: Props) {
  const settings = _settings!;

  // ── State ──────────────────────────────────────────────────
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [animationProgress, setAnimationProgress] = useState(0);
  const [packComplete, setPackComplete] = useState(false);

  const [translationJob, setTranslationJob] = useState<TranslationJobListItem | null>(null);

  const [expandedMods, setExpandedMods] = useState<Set<string>>(new Set());
  const [reviewRequired, setReviewRequired] = useState(false);

  const animFrameRef = useRef<number>(0);

  // ═══════════════════════════════════════════════════════════
  // Handlers (useCallback — must be BEFORE effects that use them)
  // ═══════════════════════════════════════════════════════════

  const generateFromJob = useCallback(
    async (dryRun: boolean) => {
      if (!translationJob) return;
      setLoading(true);
      setError("");
      setCopyResult(null);
      setPackResult(null);
      try {
        const targetLang =
          scanSummary?.targetLanguage || translationJob.targetLanguage;
        const result = await generatePackFromJob(
          translationJob.jobId,
          targetLang,
          dryRun,
        );
        setPackResult(result);
      } catch (err) {
        setError(toErrorMessage(err));
        setPackResult(null);
      } finally {
        setLoading(false);
      }
    },
    [translationJob, scanSummary?.targetLanguage],
  );

  const handleRegenerate = useCallback(() => {
    if (translationJob && translationJob.completedEntries > 0) {
      generateFromJob(false);
    }
  }, [translationJob, generateFromJob]);

  const handleCopyToInstance = useCallback(async () => {
    if (!packResult?.zipPath) return;
    setError("");
    try {
      const result = await copyPackToInstance(
        packResult.zipPath,
        settings.instancePath,
        true,
      );
      setCopyResult(result);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [packResult?.zipPath, settings.instancePath]);

  const handleOpenFolder = useCallback(async () => {
    if (!packResult?.outputDir) return;
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_path", { path: packResult.outputDir });
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [packResult?.outputDir]);

  const handleSaveLocally = useCallback(async () => {
    if (!packResult?.zipPath) return;
    setError("");
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const zipName =
        packResult.zipPath.split(/[/\\]/).pop() || "translation-pack.zip";
      const dest = await save({
        defaultPath: zipName,
        filters: [{ name: t(language, "packages.zipFilter"), extensions: ["zip"] }],
      });
      if (!dest) return; // user cancelled
      await copyFile(packResult.zipPath, dest);
      setCopyResult({
        success: true,
        targetPath: dest,
        replaced: false,
      });
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [packResult?.zipPath]);

  const translationJobId = useAppStore((s) => s.translationJobId);
  const reviewCount = useAppStore((s) => s.reviewCount);

  const toggleModExpand = useCallback((modId: string) => {
    setExpandedMods((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  }, []);

  // ═══════════════════════════════════════════════════════════
  // Effects
  // ═══════════════════════════════════════════════════════════

  // 1. Auto-load latest completed/reviewed translation job.
  // 只在当前会话确有翻译任务（translationJobId 被显式设置）时自动加载，
  // 防止旧会话遗留的 translate_*.json 显示为已完成翻译。
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (!translationJobId) {
      setTranslationJob(null);
      setReviewRequired(false);
      return;
    }
    let cancelled = false;
    loadLatestTranslationJobMeta()
      .then((job) => {
        if (cancelled || !job) return;
        const isFinished = (job.status === "completed" || job.status === "reviewed")
          && job.completedEntries > 0;
        if (isFinished) {
          setTranslationJob(job);
          // reviewed === false → 需要校对（新 job）
          // reviewed === null/undefined → 旧数据向后兼容视为已校对
          // reviewed === true → 已校对
          setReviewRequired(job.reviewed === false);
        }
      })
      .catch((err) => console.warn("load latest translation job failed:", err));
    return () => { cancelled = true; };
  }, [translationJobId, reviewCount]);

  // 2. Sync busy state to sidebar
  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  // 4a. Animate progress 0→95% during generation
  useEffect(() => {
    if (!loading) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }
    const start = Date.now();
    const duration = 3000;
    const animate = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / duration) * 100, 95);
      setAnimationProgress(pct);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [loading]);

  // 4b. Completion transition when pack result arrives
  useEffect(() => {
    if (packResult && !loading) {
      setAnimationProgress(100);
      const timer = setTimeout(() => {
        setPackComplete(true);
        onPackComplete?.(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
    if (!loading) {
      setPackComplete(false);
    }
  }, [packResult, loading, onPackComplete]);

  // ═══════════════════════════════════════════════════════════
  // Derived state
  // ═══════════════════════════════════════════════════════════

  const languageMismatch =
    settings.instancePath &&
    translationJob &&
    scanSummary?.targetLanguage &&
    translationJob.targetLanguage !== scanSummary?.targetLanguage;

  const canRegenerate =
    !loading &&
    !reviewRequired &&
    (translationJob?.completedEntries ?? 0) > 0;

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  return (
    <section className="page packages-page">
      {/* ══════════════════════════════════════════════════════
          LAYER 1: 统计 + 操作
          ══════════════════════════════════════════════════════ */}
      <div className="packages-layer packages-top">
        <PageHeader
          title={t(language, "packages.title")}
          subtitle={t(language, "packages.subtitle")}
          actions={
            <button
              className="primary-button"
              disabled={!canRegenerate}
              onClick={handleRegenerate}
              type="button"
              data-tooltip={t(language, "packages.regenerateTooltip")}
            >
              {loading ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <RefreshCw size={18} />
              )}
              {t(language, "packages.regenerate")}
            </button>
          }
        />

        {/* Stats bar */}
        {packResult && !loading && (
          <div className="packages-stats-bar">
            <span className="packages-stat">
              <Boxes size={16} />
              <span><AnimatedCount value={packResult.modCount} />{t(language, "packages.modCount").replace("{count}", "")}</span>
            </span>
            <span className="packages-stat-divider" />
            <span className="packages-stat">
              <FileText size={16} />
              <span><AnimatedCount value={packResult.entryCount} />{t(language, "packages.entryCount").replace("{count}", "")}</span>
            </span>
            <span className="packages-stat-divider" />
            <span className="packages-stat packages-status-ready">
              <CheckCircle2 size={16} />
              <span>{t(language, "packages.ready")}</span>
            </span>
          </div>
        )}

        {loading && (
          <div className="packages-stats-bar">
            <span className="packages-stat packages-status-generating">
              <Loader2 size={16} className="spin" />
              <span>{t(language, "packages.packing")}</span>
            </span>
          </div>
        )}

        {reviewRequired && (
          <div className="alert warning compact" style={{ marginTop: 10 }}>
            ⚠️ {t(language, "packages.reviewRequired")}
          </div>
        )}
        {languageMismatch && (
          <div className="alert warning compact" style={{ marginTop: 10 }}>
            ⚠️ {t(language, "packages.languageMismatch", { current: scanSummary!.targetLanguage, job: translationJob!.targetLanguage })}
          </div>
        )}

        {error && <div className="alert error">{error}</div>}
      </div>

      {/* ══════════════════════════════════════════════════════
          LAYER 2: 装箱动画 / 模组列表
          ══════════════════════════════════════════════════════ */}
      <div className="packages-layer packages-middle">
        {/* No scan yet */}
        {!scanSummary && (
          <div className="packages-middle-empty">
            <Boxes size={32} />
            <p>{t(language, "packages.noScan")}</p>
          </div>
        )}

        {/* No pack generated yet */}
        {!translationJob && scanSummary && !packResult && !loading && (
          <div className="packages-middle-empty">
            <FileArchive size={32} />
            <p>{t(language, "packages.noTranslation")}</p>
          </div>
        )}

        {/* ── Generation in progress / completion animation ── */}
        {(loading || (packResult && !packComplete)) && (
          <div className="packages-animation-area">
            <PackingAnimation progress={animationProgress} />
            {loading && (
              <>
                <div className="packages-progress-track">
                  <div
                    className="packages-progress-fill"
                    style={{ width: `${animationProgress}%` }}
                  />
                </div>
                <span className="packages-progress-label">
                  {t(language, "packages.packingPercent", { percent: Math.round(animationProgress) })}
                </span>
              </>
            )}
            {packResult && !loading && !packComplete && (
              <span className="packages-progress-label packages-status-ready">
                <CheckCircle2 size={14} /> {t(language, "packages.packDone")}
              </span>
            )}
          </div>
        )}

        {/* ── Generation complete: mod list ─────────────────── */}
        {packResult && packComplete && scanSummary && (
          <div className="packages-mod-list">
            <div className="packages-mod-list-header">
              <h2>{t(language, "packages.allMods", { count: scanSummary.mods.length })}</h2>
            </div>
            <div className="packages-mod-list-body">
              {scanSummary.mods.map((mod) => {
                const hasEntries = mod.entries.length > 0;
                const hasErrors = mod.failedLanguageFiles > 0;
                const isExpanded = expandedMods.has(mod.modId);

                let StatusIcon: typeof CheckCircle2;
                let iconClass: string;
                if (hasErrors) {
                  StatusIcon = XCircle;
                  iconClass = "packages-icon-error";
                } else if (!hasEntries) {
                  StatusIcon = Minus;
                  iconClass = "packages-icon-muted";
                } else {
                  StatusIcon = CheckCircle2;
                  iconClass = "packages-icon-success";
                }

                return (
                  <div
                    key={mod.modId}
                    className={`packages-mod-item ${isExpanded ? "expanded" : ""}`}
                  >
                    <div
                      className="packages-mod-item-row"
                      onClick={() => toggleModExpand(mod.modId)}
                    >
                      <span className="packages-mod-icon">
                        <StatusIcon size={16} className={iconClass} />
                      </span>
                      <span className="packages-mod-name">{mod.modId}</span>
                      <span className="packages-mod-file">{mod.fileName}</span>
                      <span className="packages-mod-meta">
                        {mod.entries.length || mod.languageFileCount
                          ? [mod.entries.length ? t(language, "packages.entries_label", { count: mod.entries.length }) : null, mod.languageFileCount ? t(language, "packages.files_label", { count: mod.languageFileCount }) : null].filter(Boolean).join(" · ")
                          : t(language, "packages.noLangFiles")}
                      </span>
                      {hasErrors && (
                        <span className="packages-mod-error-badge">{t(language, "packages.failed_label")}</span>
                      )}
                      {hasEntries && (
                        <span className="packages-mod-expand">
                          {isExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </span>
                      )}
                    </div>
                    {isExpanded && hasEntries && (
                      <div className="packages-mod-detail">
                        <div className="packages-mod-detail-row packages-mod-detail-header">
                          <span className="packages-detail-key">{t(language, "packages.detailKey")}</span>
                          <span>{t(language, "packages.detailSource")}</span>
                        </div>
                        {mod.entries.slice(0, 20).map((entry) => (
                          <div key={entry.key} className="packages-mod-detail-row">
                            <code className="packages-detail-key">{entry.key}</code>
                            <span className="packages-detail-source">
                              {entry.text}
                            </span>
                          </div>
                        ))}
                        {mod.entries.length > 20 && (
                          <div className="packages-mod-detail-more">
                            {t(language, "packages.moreEntries", { count: mod.entries.length - 20 })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
          LAYER 3: 部署按钮
          ══════════════════════════════════════════════════════ */}
      {packResult && packComplete && (
        <div className="packages-layer packages-bottom">
          <div className="packages-deploy-buttons">
            <button
              className="packages-deploy-btn"
              onClick={handleSaveLocally}
              type="button"
              data-tooltip={t(language, "packages.saveLocallyTooltip")}
            >
              <Download size={18} />
              <span>{t(language, "packages.saveLocally")}</span>
            </button>
            <button
              className="packages-deploy-btn packages-deploy-primary"
              onClick={handleCopyToInstance}
              type="button"
              data-tooltip={t(language, "packages.copyToInstanceTooltip")}
            >
              <Copy size={18} />
              <span>{t(language, "packages.copyToInstanceBtn")}</span>
            </button>
            <button
              className="packages-deploy-btn"
              onClick={handleOpenFolder}
              type="button"
              data-tooltip={t(language, "packages.openFolderTooltip")}
            >
              <FolderOpen size={18} />
              <span>{t(language, "packages.openFolder")}</span>
            </button>
          </div>

          {copyResult && (
            <div
              className={`alert ${copyResult.success ? "success" : "error"}`}
              style={{ marginTop: 12 }}
            >
              {copyResult.success
                ? t(language, "packages.copySuccess", {
                    path: copyResult.targetPath,
                    replaced: copyResult.replaced
                      ? t(language, "packages.replaced")
                      : "",
                  })
                : t(language, "packages.copyFailed")}
            </div>
          )}
        </div>
      )}
    </section>
  );
});


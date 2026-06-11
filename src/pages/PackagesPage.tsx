import {
  Boxes,
  CheckCircle2,
  FileArchive,
  FileText,
  FolderOpen,
  Loader2,
  Minus,
  Package,
  XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
// Sub-components
// ═══════════════════════════════════════════════════════════════

/** A single mod row showing name, file, and entry count — no expandable detail. */
const ModRow = React.memo(function ModRow({
  mod,
  language,
}: {
  mod: ScanSummary["mods"][0];
  language: AppLanguage;
}) {
  const hasEntries = mod.entries.length > 0;
  const hasErrors = mod.failedLanguageFiles > 0;

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
    <div className="packages-mod-item">
      <div className="packages-mod-item-row">
        <span className="packages-mod-icon">
          <StatusIcon size={16} className={iconClass} />
        </span>
        <span className="packages-mod-name">{mod.modId}</span>
        <span className="packages-mod-file">{mod.fileName}</span>
        <span className="packages-mod-meta">
          {hasEntries || mod.languageFileCount
            ? [hasEntries ? t(language, "packages.entries_label", { count: mod.entries.length }) : null, mod.languageFileCount ? t(language, "packages.files_label", { count: mod.languageFileCount }) : null].filter(Boolean).join(" · ")
            : t(language, "packages.noLangFiles")}
        </span>
        {hasErrors && (
          <span className="packages-mod-error-badge">{t(language, "packages.failed_label")}</span>
        )}
      </div>
    </div>
  );
});

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [animationProgress, setAnimationProgress] = useState(0);
  const [packComplete, setPackComplete] = useState(false);

  const [translationJob, setTranslationJob] = useState<TranslationJobListItem | null>(null);

  const [reviewRequired, setReviewRequired] = useState(false);
  const [outputDir, setOutputDir] = useState<string | null>(() =>
    settings.instancePath ? `${settings.instancePath.replace(/\\/g, "/")}/resourcepacks` : null,
  );

  const animFrameRef = useRef<number>(0);

  // ═══════════════════════════════════════════════════════════
  // Handlers (useCallback — must be BEFORE effects that use them)
  // ═══════════════════════════════════════════════════════════

  const generateFromJob = useCallback(
    async (dryRun: boolean) => {
      if (!translationJob) return;
      const animStart = Date.now();
      setLoading(true);
      setAnimationProgress(0);
      setError("");
      setPackResult(null);
      try {
        const targetLang =
          scanSummary?.targetLanguage || translationJob.targetLanguage;
        const result = await generatePackFromJob(
          translationJob.jobId,
          targetLang,
          dryRun,
          outputDir ?? undefined,
        );
        // 确保动画最短 3 秒
        const minAnimationMs = 3000;
        const elapsed = Date.now() - animStart;
        if (elapsed < minAnimationMs) {
          await new Promise((r) => setTimeout(r, minAnimationMs - elapsed));
        }
        setPackResult(result);
      } catch (err) {
        setError(toErrorMessage(err));
        setPackResult(null);
      } finally {
        setLoading(false);
      }
    },
    [translationJob, scanSummary, outputDir],
  );

  const handleSelectOutputDir = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: t(language, "packages.outputDir") });
      if (dir) setOutputDir(dir);
    } catch (err) {
      // Not in Tauri runtime — ignore
    }
  }, [language]);

  const handleRegenerate = useCallback(() => {
    if (translationJob && translationJob.completedEntries > 0) {
      generateFromJob(false);
    }
  }, [translationJob, generateFromJob]);

  const translationJobId = useAppStore((s) => s.translationJobId);
  const reviewCount = useAppStore((s) => s.reviewCount);

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
        // 自动在资源管理器中打开输出文件夹
        if (packResult.outputDir && ("__TAURI_INTERNALS__" in window)) {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("open_path", { path: packResult.outputDir }).catch((err) => {
              setError(`打开输出文件夹失败: ${toErrorMessage(err)}`);
            });
          }).catch((err) => {
            setError(`打开输出文件夹失败: ${toErrorMessage(err)}`);
          });
        }
      }, 600);
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
  // Render helpers
  // ═══════════════════════════════════════════════════════════

  /** Mod rows from scanSummary — memoized to avoid rebuild on every animation frame. */
  const modItems = useMemo(
    () => scanSummary?.mods.map((mod) => (
      <ModRow key={mod.modId} mod={mod} language={language} />
    )),
    [scanSummary, language],
  );

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
              data-tooltip={packResult ? t(language, "packages.regenerateTooltip") : t(language, "packages.subtitle")}
            >
              {loading ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <Package size={18} />
              )}
              {t(language, packResult ? "packages.regenerate" : "packages.generate")}
            </button>
          }
        />

        {/* Stats bar */}
        {packResult && !loading && (
          <div className="packages-stats-bar">
            <span className="packages-stat">
              <Boxes size={16} />
              <span><AnimatedCount value={packResult.modCount} />{t(language, "packages.modCount", { count: 0 }).replace(/^0\s*/, " ")}</span>
            </span>
            <span className="packages-stat-divider" />
            <span className="packages-stat">
              <FileText size={16} />
              <span><AnimatedCount value={packResult.entryCount} />{t(language, "packages.entryCount", { count: 0 }).replace(/^0\s*/, " ")}</span>
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

        {/* ── Output directory selector (always visible after scan+translate) ── */}
        {translationJob && scanSummary && !loading && (
          <div className="packages-output-dir">
            <FolderOpen size={16} />
            <span className="packages-output-dir-label">
              {t(language, "packages.outputDir")}:
            </span>
            <code className="packages-output-dir-path">
              {outputDir}
            </code>
            <button
              className="packages-output-dir-btn"
              onClick={handleSelectOutputDir}
              type="button"
              data-tooltip={t(language, "packages.outputDirBrowse")}
            >
              {t(language, "packages.outputDirBrowse")}
            </button>
          </div>
        )}

        {/* ── Pre-pack: mod list preview ──────── */}
        {translationJob && scanSummary && !loading && !packResult && (
          <div className="packages-middle-preview">
            <div className="packages-mod-list">
                <div className="packages-mod-list-header">
                  <h2>{t(language, "packages.allMods", { count: scanSummary.mods.length })}</h2>
                  <span className="packages-mod-list-ready">
                    {t(language, "packages.readyToPack")}
                  </span>
                </div>
                <div className="packages-mod-list-body">
                  {modItems}
                </div>
              </div>
          </div>
        )}

        {/* ── Generation complete: mod list ─────────────────── */}
        {packResult && packComplete && scanSummary && (
          <div className="packages-mod-list">
            <div className="packages-mod-list-header">
              <h2>{t(language, "packages.allMods", { count: scanSummary.mods.length })}</h2>
            </div>
            <div className="packages-mod-list-body">
              {modItems}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
          LAYER 3: 打包完成后自动打开文件夹，无需显示按钮
          ══════════════════════════════════════════════════════ */}
      {/* 底部部署按钮已移除 — 打包完成后自动在资源管理器中打开输出目录 */}
    </section>
  );
});


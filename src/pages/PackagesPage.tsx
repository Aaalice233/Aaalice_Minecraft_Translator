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
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  generatePackFromJob,
  loadLatestTranslationJobMeta,
  openPath,
} from "../api/tauri";
import { AnimatedCount } from "../components/AnimatedCount";
import { PageHeader } from "../components/PageHeader";
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
  autoLocked?: boolean;
}

export interface PackagesPageHandle {
  runAutoPack: () => Promise<PackResult>;
}

function normalizeWindowsDisplayPath(path: string): string {
  if (path.startsWith("//?/UNC/")) return `//${path.slice("//?/UNC/".length)}`;
  if (path.startsWith("//?/")) return path.slice("//?/".length);
  if (path.startsWith("\\\\?\\UNC\\")) return `//${path.slice("\\\\?\\UNC\\".length).replace(/\\/g, "/")}`;
  if (path.startsWith("\\\\?\\")) return path.slice("\\\\?\\".length).replace(/\\/g, "/");
  return path.replace(/\\/g, "/");
}

function defaultOutputDir(instancePath?: string | null): string | null {
  return instancePath ? `${normalizeWindowsDisplayPath(instancePath)}/resourcepacks` : null;
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
  const entryCount = mod.entries.length || mod.sourceEntries;
  const hasEntries = entryCount > 0;
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
            ? [hasEntries ? t(language, "packages.entries_label", { count: entryCount }) : null, mod.languageFileCount ? t(language, "packages.files_label", { count: mod.languageFileCount }) : null].filter(Boolean).join(" · ")
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

export const PackagesPage = React.memo(forwardRef<PackagesPageHandle, Props>(function PackagesPage({
  language,
  scanSummary,
  settings: _settings,
  onBusyChange,
  onPackComplete,
  autoLocked = false,
}: Props, ref) {
  const settings = _settings!;

  // ── State ──────────────────────────────────────────────────
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [packProgress, setPackProgress] = useState(0);
  const [packComplete, setPackComplete] = useState(false);

  const [translationJob, setTranslationJob] = useState<TranslationJobListItem | null>(null);

  const [reviewRequired, setReviewRequired] = useState(false);
  const [outputDir, setOutputDir] = useState<string | null>(() =>
    defaultOutputDir(scanSummary?.instancePath || settings.instancePath),
  );

  const progressFrameRef = useRef<number>(0);
  const pageRef = useRef<HTMLElement>(null);
  const outputDirTouchedRef = useRef(false);

  // 抑制外层 page-layer 滚动 — CSS :has() 后备
  useEffect(() => {
    const layer = pageRef.current?.closest<HTMLElement>(".page-layer");
    if (!layer) return;
    const prevOverflow = layer.style.overflow;
    layer.style.overflow = "hidden";
    return () => { layer.style.overflow = prevOverflow; };
  }, []);

  useEffect(() => {
    if (outputDirTouchedRef.current) return;
    const nextOutputDir = defaultOutputDir(scanSummary?.instancePath || settings.instancePath);
    if (nextOutputDir && outputDir !== nextOutputDir) {
      setOutputDir(nextOutputDir);
    }
  }, [outputDir, scanSummary?.instancePath, settings.instancePath]);

  // ═══════════════════════════════════════════════════════════
  // Handlers (useCallback — must be BEFORE effects that use them)
  // ═══════════════════════════════════════════════════════════

  const generateFromJob = useCallback(
    async (
      dryRun: boolean,
      options: { jobOverride?: TranslationJobListItem; throwOnError?: boolean } = {},
    ): Promise<PackResult | null> => {
      const activeJob = options.jobOverride ?? translationJob;
      if (!activeJob) return null;
      const progressStart = Date.now();
      setLoading(true);
      setPackProgress(0);
      setError("");
      setPackResult(null);
      try {
        const targetLang =
          scanSummary?.targetLanguage || activeJob.targetLanguage;
        const result = await generatePackFromJob(
          activeJob.jobId,
          targetLang,
          dryRun,
          outputDir ?? undefined,
        );
        // 保留短暂进度反馈，避免很快完成时状态条闪一下就消失。
        const minProgressMs = 3000;
        const elapsed = Date.now() - progressStart;
        if (elapsed < minProgressMs) {
          await new Promise((r) => setTimeout(r, minProgressMs - elapsed));
        }
        setPackResult(result);
        return result;
      } catch (err) {
        const message = toErrorMessage(err);
        setError(message);
        setPackResult(null);
        if (options.throwOnError) throw err;
        return null;
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
      if (dir) {
        outputDirTouchedRef.current = true;
        setOutputDir(dir);
      }
    } catch (err) {
      // Not in Tauri runtime — ignore
    }
  }, [language]);

  const handleRegenerate = useCallback(() => {
    if (translationJob && translationJob.completedEntries > 0) {
      generateFromJob(false);
    }
  }, [translationJob, generateFromJob]);

  useImperativeHandle(ref, () => ({
    runAutoPack: async () => {
      const job = await loadLatestTranslationJobMeta();
      if (!job) {
        throw new Error(t(language, "auto.error.noJob"));
      }
      if (job.failedEntries > 0) {
        throw new Error(t(language, "auto.error.failedEntries", { count: job.failedEntries }));
      }
      setTranslationJob(job);
      setReviewRequired(false);
      const result = await generateFromJob(false, { jobOverride: job, throwOnError: true });
      if (!result) {
        throw new Error(t(language, "packages.noTranslation"));
      }
      return result;
    },
  }), [generateFromJob, language]);

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
          setReviewRequired(job.reviewed === false || job.failedEntries > 0);
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
      cancelAnimationFrame(progressFrameRef.current);
      return;
    }
    const start = Date.now();
    const duration = 3000;
    const animate = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / duration) * 100, 95);
      setPackProgress(pct);
      progressFrameRef.current = requestAnimationFrame(animate);
    };
    progressFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(progressFrameRef.current);
  }, [loading]);

  // 4b. Completion transition when pack result arrives
  useEffect(() => {
    if (packResult && !loading) {
      setPackProgress(100);
      const timer = setTimeout(() => {
        setPackComplete(true);
        onPackComplete?.(true);
        // 自动在资源管理器中打开输出文件夹
        if (packResult.outputDir && ("__TAURI_INTERNALS__" in window)) {
          openPath(packResult.outputDir).catch((err) => {
            setError(t(language, "packages.openOutputDirFailed", { error: toErrorMessage(err) }));
          });
        }
      }, 600);
      return () => clearTimeout(timer);
    }
    if (!loading) {
      setPackComplete(false);
    }
  }, [packResult, loading, onPackComplete, language]);

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
  const normalizedPackProgress = Math.min(Math.max(packProgress, 0), 100);

  const showModList =
    scanSummary &&
    ((translationJob && !packResult) || (packResult && packComplete));
  const isPrePack = showModList && !!(translationJob && !loading && !packResult);

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
    <section ref={pageRef} className="page packages-page">
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
              disabled={!canRegenerate || autoLocked}
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
          <div className={packComplete ? "packages-stats-bar" : "packages-stats-bar packages-progress-bar"}>
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
              <span>{t(language, packComplete ? "packages.ready" : "packages.packDone")}</span>
            </span>
            {!packComplete && (
              <>
                <span className="packages-stat-divider" />
                <div className="packages-progress-track" aria-hidden="true">
                  <div className="packages-progress-fill" style={{ width: "100%" }} />
                </div>
                <span className="packages-progress-label">
                  {t(language, "packages.packingPercent", { percent: 100 })}
                </span>
              </>
            )}
          </div>
        )}

        {loading && (
          <div className="packages-stats-bar packages-progress-bar">
            <span className="packages-stat packages-status-generating">
              <Loader2 size={16} className="spinning" />
              <span>{t(language, "packages.packing")}</span>
            </span>
            <div className="packages-progress-track" aria-hidden="true">
              <div
                className="packages-progress-fill"
                style={{ transform: `scaleX(${normalizedPackProgress / 100})` }}
              />
            </div>
            <span className="packages-progress-label">
              {t(language, "packages.packingPercent", { percent: Math.round(normalizedPackProgress) })}
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
          LAYER 2: 模组列表
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

        {/* ── Mod list (pre-pack preview / post-pack summary) ── */}
        {showModList && (
          <div className={isPrePack ? "packages-middle-preview" : undefined}>
            <div className="packages-mod-list">
              <div className="packages-mod-list-header">
                <h2>{t(language, "packages.allMods", { count: scanSummary.mods.length })}</h2>
                {isPrePack && (
                  <span className="packages-mod-list-ready">
                    {t(language, "packages.readyToPack")}
                  </span>
                )}
              </div>
              <div className="packages-mod-list-body">
                {modItems}
              </div>
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
}));


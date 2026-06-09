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
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

export const PackagesPage = React.memo(function PackagesPage({
  language,
  scanSummary,
  settings: _settings,
  onBusyChange,
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
  const [didAutoGenerate, setDidAutoGenerate] = useState(false);
  const [updateDictionary, setUpdateDictionary] = useState(false);

  const animFrameRef = useRef<number>(0);

  // ═══════════════════════════════════════════════════════════
  // Handlers (useCallback — must be BEFORE effects that use them)
  // ═══════════════════════════════════════════════════════════

  const generateFromJob = useCallback(
    async (dryRun: boolean, updateDict?: boolean) => {
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
          updateDict ?? updateDictionary,
        );
        setPackResult(result);
      } catch (err) {
        setError(toErrorMessage(err));
        setPackResult(null);
      } finally {
        setLoading(false);
      }
    },
    [translationJob, scanSummary?.targetLanguage, updateDictionary],
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
        filters: [{ name: "ZIP 资源包", extensions: ["zip"] }],
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

  // 1. Auto-load latest completed translation job.
  // 只在当前会话确有翻译任务（translationJobId 被显式设置）时自动加载，
  // 防止旧会话遗留的 translate_*.json 显示为已完成翻译。
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (!translationJobId) {
      setTranslationJob(null);
      return;
    }
    let cancelled = false;
    loadLatestTranslationJobMeta()
      .then((job) => {
        if (cancelled || !job) return;
        if (job.status === "completed" && job.completedEntries > 0) {
          setTranslationJob(job);
        }
      })
      .catch((err) => console.warn("加载最新翻译任务失败:", err));
    return () => { cancelled = true; };
  }, [translationJobId]);

  // 2. Auto-pre-generate when a completed translation job becomes available
  useEffect(() => {
    if (didAutoGenerate || loading || packResult || !translationJob) return;
    if (translationJob.completedEntries > 0) {
      setDidAutoGenerate(true);
      generateFromJob(false);
    }
  }, [translationJob, generateFromJob]);

  // 3. Sync busy state to sidebar
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
      const timer = setTimeout(() => setPackComplete(true), 1200);
      return () => clearTimeout(timer);
    }
    if (!loading) {
      setPackComplete(false);
    }
  }, [packResult, loading]);

  // ═══════════════════════════════════════════════════════════
  // Derived state
  // ═══════════════════════════════════════════════════════════

  const languageMismatch =
    settings.instancePath &&
    translationJob &&
    translationJob.targetLanguage !== scanSummary?.targetLanguage;

  const canRegenerate =
    !loading &&
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
        <div className="page-header">
          <div>
            <h1>{t(language, "packages.title")}</h1>
            <p>{t(language, "packages.subtitle")}</p>
          </div>
          <div className="page-header-button">
            <button
              className="primary-button"
              disabled={!canRegenerate}
              onClick={handleRegenerate}
              type="button"
              data-tooltip="重新生成资源包"
            >
              {loading ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <RefreshCw size={18} />
              )}
              重新生成
            </button>
          </div>
        </div>

        {/* ── 更新词典复选框 ── */}
        {translationJob && (
          <label className="toggle-row" style={{ marginBottom: 12, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={updateDictionary}
              onChange={(e) => setUpdateDictionary(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span>打包时更新词典（将 LLM 翻译结果保存到词典）</span>
          </label>
        )}

        {/* Stats bar */}
        {packResult && !loading && (
          <div className="packages-stats-bar">
            <span className="packages-stat">
              <Boxes size={16} />
              <span><AnimatedCount value={packResult.modCount} /> 个模组</span>
            </span>
            <span className="packages-stat-divider" />
            <span className="packages-stat">
              <FileText size={16} />
              <span><AnimatedCount value={packResult.entryCount} /> 条翻译</span>
            </span>
            <span className="packages-stat-divider" />
            <span className="packages-stat packages-status-ready">
              <CheckCircle2 size={16} />
              <span>已就绪</span>
            </span>
          </div>
        )}

        {loading && (
          <div className="packages-stats-bar">
            <span className="packages-stat packages-status-generating">
              <Loader2 size={16} className="spin" />
              <span>正在打包...</span>
            </span>
          </div>
        )}

        {languageMismatch && (
          <div className="alert warning compact" style={{ marginTop: 10 }}>
            ⚠️ 当前设置的目标语言 ({scanSummary?.targetLanguage})
            与翻译结果的语言 ({translationJob!.targetLanguage}) 不一致。
            将使用当前设置的语言打包。
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
            <p>暂无可用的翻译结果，请先完成翻译</p>
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
                  正在打包 ({Math.round(animationProgress)}%)
                </span>
              </>
            )}
            {packResult && !loading && !packComplete && (
              <span className="packages-progress-label packages-status-ready">
                <CheckCircle2 size={14} /> 打包完成
              </span>
            )}
          </div>
        )}

        {/* ── Generation complete: mod list ─────────────────── */}
        {packResult && packComplete && scanSummary && (
          <div className="packages-mod-list">
            <div className="packages-mod-list-header">
              <h2>全部模组 ({scanSummary.mods.length})</h2>
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
                          ? [mod.entries.length ? `${mod.entries.length} 条目` : null, mod.languageFileCount ? `${mod.languageFileCount} 文件` : null].filter(Boolean).join(" · ")
                          : "无语言文件"}
                      </span>
                      {hasErrors && (
                        <span className="packages-mod-error-badge">失败</span>
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
                          <span className="packages-detail-key">键</span>
                          <span>原文</span>
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
                            ...还有 {mod.entries.length - 20} 条
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
              data-tooltip="选择保存位置"
            >
              <Download size={18} />
              <span>保存本地</span>
            </button>
            <button
              className="packages-deploy-btn packages-deploy-primary"
              onClick={handleCopyToInstance}
              type="button"
              data-tooltip="复制到游戏实例 resourcepacks 目录"
            >
              <Copy size={18} />
              <span>复制到实例</span>
            </button>
            <button
              className="packages-deploy-btn"
              onClick={handleOpenFolder}
              type="button"
              data-tooltip="在文件管理器中打开"
            >
              <FolderOpen size={18} />
              <span>打开文件夹</span>
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


import { TableVirtuoso } from "react-virtuoso";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Loader2,
  PackageCheck,
  Save,
  Search,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { loadLatestTranslationJobMeta, loadTranslationModSummaries, loadTranslationResults, saveTranslationEntry } from "../api/tauri";
import { t } from "../i18n/translations";
import { useAppStore } from "../stores/appStore";
import type { AppLanguage, ModTranslationSummary, TranslationJobListItem, TranslationResult } from "../types";

interface Props {
  language: AppLanguage;
  onConfirm: () => void;
}

// ── Component ────────────────────────────────────────────────────

export function ValidatePage({ language, onConfirm }: Props) {
  const translationJobId = useAppStore((s) => s.translationJobId);
  const translationStatus = useAppStore((s) => s.translationStatus);

  // ── State ──
  const [job, setJob] = useState<TranslationJobListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [modSummaries, setModSummaries] = useState<ModTranslationSummary[]>([]);
  const [expandedMods, setExpandedMods] = useState<Set<string>>(new Set());
  // Lazy-loaded per-mod results: modId -> TranslationResult[]
  const [modResults, setModResults] = useState<Map<string, TranslationResult[]>>(new Map());
  // Track which mods are currently loading results
  const [loadingMods, setLoadingMods] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  // Track per-row saving state: "modId\x00key\x00modName" -> saving
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const [saveMsg, setSaveMsg] = useState<string>("");

  const [dismissed, setDismissed] = useState(false);
  const prevTranslationJobId = useRef(translationJobId);

  // ── Auto-recover: 新翻译开始时自动重置 dismissed ──
  useEffect(() => {
    if (translationJobId && translationJobId !== prevTranslationJobId.current) {
      prevTranslationJobId.current = translationJobId;
      setDismissed(false);
    }
  }, [translationJobId]);

  // ── Load job meta + mod summaries reactively ──
  // 只在当前会话确有翻译任务（translationJobId 被显式设置）时自动加载；
  // 否则旧会话遗留的 translate_*.json 会错误显示为已完成任务。
  // UI 渲染层根据 dismissed 决定是否显示内容。
  useEffect(() => {
    if (!translationJobId) {
      setLoading(false);
      setJob(null);
      setModSummaries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // ⚠️ 清除缓存的 per-mod 数据，防止切换任务后展开同名 modId 时展示旧结果
    resetModCache();
    loadLatestTranslationJobMeta()
      .then(async (j) => {
        if (cancelled) return;
        setJob(j);
        if (j && j.status === "completed") {
          // Load lightweight per-mod summaries (no full entries)
          const summaries = await loadTranslationModSummaries(j.jobId);
          if (!cancelled) {
            setModSummaries(summaries);
          }
        }
      })
      .catch(() => {/* no job yet — that's OK */})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [translationJobId, translationStatus]);

  // ── Dismiss / clear view ──
  function handleDismiss() {
    setDismissed(true);
    setJob(null);
    setModSummaries([]);
    resetModCache();
    setError("");
    setSaveMsg("");
  }

  // ── Reset per-mod cache (防止新增缓存状态时遗漏任一重置点) ──
  function resetModCache() {
    setModResults(new Map());
    setExpandedMods(new Set());
    setLoadingMods(new Set());
  }

  // ── Lazy load results when a mod is expanded ──
  async function loadModResults(modId: string) {
    if (modResults.has(modId)) return; // already loaded
    if (!job?.jobId) return;
    setLoadingMods((prev) => new Set(prev).add(modId));
    setError("");
    try {
      const results = await loadTranslationResults(job.jobId, modId);
      setModResults((prev) => {
        const next = new Map(prev);
        next.set(modId, results);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMods((prev) => {
        const next = new Set(prev);
        next.delete(modId);
        return next;
      });
    }
  }

  // ── Mod expand/collapse ──
  function toggleMod(modId: string) {
    setExpandedMods((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) {
        next.delete(modId);
      } else {
        next.add(modId);
        // Trigger lazy load (async, non-blocking)
        loadModResults(modId);
      }
      return next;
    });
  }

  // ── Save a single entry edit back to JSONL ──
  const handleSave = useCallback(async (entry: TranslationResult, newText: string) => {
    const rk = rowKey(entry);
    setSavingRows((prev) => new Set(prev).add(rk));
    setSaveMsg("");
    try {
      await saveTranslationEntry(job!.jobId, entry.key, entry.modName, entry.modId, newText);
      // Update local state: find and update only the changed entry
      setModResults((prev) => {
        const existing = prev.get(entry.modId);
        if (!existing) return prev;
        const idx = existing.findIndex(
          (e) => e.key === entry.key && e.modName === entry.modName && e.modId === entry.modId,
        );
        if (idx === -1) return prev;
        const copy = existing.slice();
        copy[idx] = { ...existing[idx], targetText: newText };
        const next = new Map(prev);
        next.set(entry.modId, copy);
        return next;
      });
      setSaveMsg("已保存");
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingRows((prev) => {
        const next = new Set(prev);
        next.delete(rk);
        return next;
      });
    }
  }, [job?.jobId]);

  // ── Render helpers ──

  function rowKey(entry: TranslationResult) {
    return `${entry.modId}\x00${entry.key}\x00${entry.modName}`;
  }

  // ── Render: Loading (job) ──
  if (loading) {
    return (
      <section className="page validate-page">
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
          <p>加载中...</p>
        </div>
      </section>
    );
  }

  // ── Render: Dismissed (show empty state even if a job is loaded) ──
  if (dismissed) {
    return (
      <section className="page validate-page validate-workspace">
        <PageHeader language={language}>
          {job && (
            <button
              className="ghost-button"
              onClick={() => setDismissed(false)}
              type="button"
              style={{ fontSize: 13 }}
            >
              {t(language, "validate.restoreView")}
            </button>
          )}
        </PageHeader>
        <div className="empty-state">
          <Search size={32} />
          <p>{t(language, "validate.dismissedMessage")}</p>
        </div>
      </section>
    );
  }

  // ── Render: No job ──
  if (!job) {
    return (
      <section className="page validate-page validate-workspace">
        <PageHeader language={language} />
        <div className="empty-state">
          <Search size={32} />
          <p>未找到翻译任务。请先在「翻译任务」页面完成一次翻译。</p>
        </div>
      </section>
    );
  }

  // ── Render: Job found but not completed ──
  if (job.status !== "completed") {
    return (
      <section className="page validate-page validate-workspace">
        <PageHeader language={language}>
          <button className="ghost-button" onClick={handleDismiss} type="button">
            {t(language, "validate.close")}
          </button>
        </PageHeader>
        <div className="empty-state">
          <Loader2 size={32} />
          <p>翻译任务尚未完成，请等待翻译完成后进入校对。</p>
        </div>
      </section>
    );
  }

  // ── Render: Main review workbench ──
  return (
    <section className="page validate-page validate-workspace">
      <PageHeader language={language}>
          <button className="ghost-button" onClick={handleDismiss} type="button" style={{ fontSize: 13 }}>
            {t(language, "validate.close")}
          </button>
          {modSummaries.length > 0 && (
            <button
              className="primary-button"
              onClick={onConfirm}
              type="button"
            >
              <PackageCheck size={18} />
              进入打包
            </button>
          )}
        </PageHeader>

      {/* ── Job info bar ── */}
      <div className="job-info-bar">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <FileText size={14} />
          任务: <code style={{ fontSize: 12 }}>{job.jobId}</code>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <CheckCircle size={14} style={{ color: "var(--accent)" }} />
          {job.completedEntries} 条已翻译
        </span>
        {job.completedAt && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ClipboardList size={14} />
            {new Date(job.completedAt).toLocaleString()}
          </span>
        )}
        <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
          {job.completedEntries} 个条目
        </span>
      </div>

      {/* ── Error / Info alerts ── */}
      {error && (
        <div className="alert error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      {saveMsg && (
        <div
          className={`alert ${saveMsg === "已保存" ? "success" : "error"}`}
          style={{ marginBottom: 12 }}
        >
          {saveMsg}
        </div>
      )}

      {/* ── No mod summaries ── */}
      {modSummaries.length === 0 && (
        <div className="empty-state" style={{ padding: 32 }}>
          <Search size={28} />
          <p>暂无翻译结果</p>
        </div>
      )}

      {/* ── Review table: mod groups ── */}
      {modSummaries.length > 0 && (
        <div className="workspace-layout" style={{ gridTemplateColumns: "1fr", marginTop: 0 }}>
          <main className="workspace-main">
            <div className="validate-issue-list" style={{ gap: 6 }}>
              {modSummaries.map(({ modId, entryCount }) => {
                const isExpanded = expandedMods.has(modId);
                const isLoading = loadingMods.has(modId);
                const entries = modResults.get(modId);
                const hasEntries = entries && entries.length > 0;
                return (
                  <div key={modId} className="mod-group">
                    <button
                      className="mod-group-header"
                      onClick={() => toggleMod(modId)}
                      type="button"
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="mod-name">{modId}</span>
                      <span className="mod-count">{entryCount} 条</span>
                    </button>

                    {isExpanded && !hasEntries && isLoading && (
                      <div className="empty-state" style={{ padding: 16 }}>
                        <Loader2 size={20} className="spin" />
                        <p>加载中...</p>
                      </div>
                    )}

                    {isExpanded && entries && entries.length > 0 && (
                      <TableVirtuoso
                        style={{
                          height: "min(calc(100vh - 280px), 600px)",
                          borderTop: "1px solid var(--border)",
                        }}
                        totalCount={entries.length}
                        fixedHeaderContent={() => (
                          <tr style={{
                            background: "var(--bg-muted)",
                            borderBottom: "1px solid var(--border)",
                          }}>
                            <th style={{ ...thStyle, width: "25%" }}>Key</th>
                            <th style={{ ...thStyle, width: "30%" }}>原文 (Source)</th>
                            <th style={{ ...thStyle, width: "35%" }}>译文 (Target)</th>
                            <th style={{ ...thStyle, width: 80 }}>操作</th>
                          </tr>
                        )}
                        itemContent={(index) => {
                          const entry = entries[index];
                          const rk = rowKey(entry);
                          const isSaving = savingRows.has(rk);
                          return (
                            <ReviewRow
                              entry={entry}
                              isSaving={isSaving}
                              onSave={handleSave}
                            />
                          );
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      )}
    </section>
  );
}

// ── Row component ────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontWeight: 600,
  whiteSpace: "nowrap",
  color: "var(--text-secondary)",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 12px",
  verticalAlign: "middle",
  borderBottom: "1px solid var(--border)",
};

const ReviewRow = React.memo(function ReviewRow({
  entry,
  isSaving,
  onSave,
}: {
  entry: TranslationResult;
  isSaving: boolean;
  onSave: (entry: TranslationResult, newText: string) => void;
}) {
  const [editText, setEditText] = useState(entry.targetText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDirty = editText !== entry.targetText;

  // Reset local state when entry changes (e.g. after save from another row)
  useEffect(() => {
    setEditText(entry.targetText);
  }, [entry.key, entry.modName, entry.modId, entry.targetText]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.max(ta.scrollHeight, 28)}px`;
    }
  }, [editText]);

  return (
    <tr>
      <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
        {entry.key}
      </td>
      <td style={{ ...tdStyle, maxWidth: 300, wordBreak: "break-all" }}>
        <div style={{ maxHeight: 80, overflowY: "auto", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
          {entry.sourceText || "-"}
        </div>
      </td>
      <td style={{ ...tdStyle, maxWidth: 300 }}>
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          style={{
            width: "100%",
            minHeight: 28,
            resize: "vertical",
            fontFamily: "inherit",
            fontSize: 12,
            lineHeight: 1.4,
            padding: "4px 6px",
            border: `1px solid ${isDirty ? "var(--accent)" : "var(--border-input)"}`,
            borderRadius: 4,
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = "var(--accent)";
            e.target.style.boxShadow = "0 0 0 2px var(--accent-bg)";
          }}
          onBlur={(e) => {
            if (!isDirty) {
              e.target.style.borderColor = "var(--border-input)";
              e.target.style.boxShadow = "none";
            }
          }}
          rows={1}
        />
      </td>
      <td style={{ ...tdStyle, textAlign: "center" }}>
        <button
          className="ghost-button"
          onClick={() => onSave(entry, editText)}
          disabled={!isDirty || isSaving}
          type="button"
          style={{ padding: "4px 8px", fontSize: 12 }}
          data-tooltip="保存修改"
        >
          {isSaving ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <Save size={14} />
          )}
        </button>
      </td>
    </tr>
  );
});

// ── Page Header (reduces duplication across 4 render paths) ────

function PageHeader({ language, children }: { language: AppLanguage; children?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{t(language, "validate.title")}</h1>
        <p>{t(language, "validate.description")}</p>
      </div>
      <div className="page-header-button" style={{ gap: 6 }}>
        {children}
      </div>
    </div>
  );
}



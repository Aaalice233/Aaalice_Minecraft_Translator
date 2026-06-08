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
import { useEffect, useMemo, useRef, useState } from "react";
import { loadLatestTranslationJob, loadTranslationResults, saveTranslationEntry } from "../api/tauri";
import type { AppLanguage, TranslationJobState, TranslationResult } from "../types";

interface Props {
  language: AppLanguage;
  onConfirm: () => void;
}

// ── Component ────────────────────────────────────────────────────

export function ValidatePage({ language: _language, onConfirm }: Props) {
  // ── State ──
  const [job, setJob] = useState<TranslationJobState | null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TranslationResult[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState("");
  const [expandedMods, setExpandedMods] = useState<Set<string>>(new Set());
  // Track per-row saving state: "modId\x00key\x00modName" -> saving
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const [saveMsg, setSaveMsg] = useState<string>("");

  // ── Load job + entries on mount ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadLatestTranslationJob()
      .then((j) => {
        if (cancelled) return;
        setJob(j);
        if (j && j.status === "completed") {
          loadEntries(j.jobId);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadEntries(jobId: string) {
    setLoadingEntries(true);
    setError("");
    try {
      const results = await loadTranslationResults(jobId);
      setEntries(results);
      // Auto-expand all mods
      const modIds = new Set(results.map((r) => r.modId));
      setExpandedMods(modIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  }

  // ── Group entries by modId ──
  const grouped = useMemo(() => {
    const map = new Map<string, TranslationResult[]>();
    for (const entry of entries) {
      const list = map.get(entry.modId);
      if (list) {
        list.push(entry);
      } else {
        map.set(entry.modId, [entry]);
      }
    }
    return map;
  }, [entries]);

  // ── Mod expand/collapse ──
  function toggleMod(modId: string) {
    setExpandedMods((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  }

  // ── Save a single entry edit back to JSONL ──
  async function handleSave(entry: TranslationResult, newText: string) {
    const rk = rowKey(entry);
    setSavingRows((prev) => new Set(prev).add(rk));
    setSaveMsg("");
    try {
      await saveTranslationEntry(job!.jobId, entry.key, entry.modName, entry.modId, newText);
      // Update local state so UI reflects the saved value
      setEntries((prev) =>
        prev.map((e) =>
          e.key === entry.key && e.modName === entry.modName && e.modId === entry.modId
            ? { ...e, targetText: newText }
            : e,
        ),
      );
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
  }

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

  // ── Render: No job ──
  if (!job) {
    return (
      <section className="page validate-page validate-workspace">
        <div className="empty-state">
          <Search size={32} />
          <p>未找到翻译任务。请先在"翻译任务"页面完成一次翻译。</p>
        </div>
      </section>
    );
  }

  // ── Render: Job found but not completed ──
  if (job.status !== "completed") {
    return (
      <section className="page validate-page validate-workspace">
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
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1>校对工作台</h1>
          <p>逐条审核 LLM 翻译结果，确认后可进入打包阶段</p>
        </div>
        <div className="page-header-button" style={{ gap: 6 }}>
          {entries.length > 0 && (
            <button
              className="primary-button"
              onClick={onConfirm}
              type="button"
            >
              <PackageCheck size={18} />
              进入打包
            </button>
          )}
        </div>
      </div>

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
          {entries.length} 个条目
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

      {/* ── Loading entries ── */}
      {loadingEntries && (
        <div className="empty-state" style={{ padding: 32 }}>
          <Loader2 size={24} className="spin" />
          <p>加载翻译结果...</p>
        </div>
      )}

      {/* ── No entries ── */}
      {!loadingEntries && entries.length === 0 && (
        <div className="empty-state" style={{ padding: 32 }}>
          <Search size={28} />
          <p>暂无翻译结果</p>
        </div>
      )}

      {/* ── Review table: mod groups ── */}
      {!loadingEntries && entries.length > 0 && (
        <div className="workspace-layout" style={{ gridTemplateColumns: "1fr", marginTop: 0 }}>
          <main className="workspace-main">
            <div className="validate-issue-list" style={{ gap: 6 }}>
              {Array.from(grouped.entries()).map(([modId, modEntries]) => {
                const isExpanded = expandedMods.has(modId);
                return (
                  <div key={modId} className="mod-group">
                    <button
                      className="mod-group-header"
                      onClick={() => toggleMod(modId)}
                      type="button"
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="mod-name">{modId}</span>
                      <span className="mod-count">{modEntries.length} 条</span>
                    </button>

                    {isExpanded && (
                      <div className="review-table" style={{
                        overflowX: "auto",
                        borderTop: "1px solid var(--border)",
                      }}>
                        <table style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}>
                          <thead>
                            <tr style={{
                              background: "var(--bg-muted)",
                              borderBottom: "1px solid var(--border)",
                            }}>
                              <th style={thStyle}>Key</th>
                              <th style={thStyle}>原文 (Source)</th>
                              <th style={thStyle}>译文 (Target)</th>
                              <th style={{ ...thStyle, width: 80 }}>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {modEntries.map((entry) => {
                              const rk = rowKey(entry);
                              const isSaving = savingRows.has(rk);
                              return (
                                <ReviewRow
                                  key={rk}
                                  entry={entry}
                                  isSaving={isSaving}
                                  onSave={handleSave}
                                />
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
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

function ReviewRow({
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
}

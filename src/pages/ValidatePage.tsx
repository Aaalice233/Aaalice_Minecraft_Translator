import { TableVirtuoso } from "react-virtuoso";
import {
  CheckCircle,
  FileText,
  Filter,
  Loader2,
  PackageCheck,
  Save,
  Search,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLatestTranslationJobMeta, loadTranslationResults, saveTranslationEntry } from "../api/tauri";
import { t } from "../i18n/translations";
import { useSortFilter } from "../hooks/useSortFilter";
import { useAppStore } from "../stores/appStore";
import type { AppLanguage, TranslationJobListItem, TranslationResult } from "../types";

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
  const [allEntries, setAllEntries] = useState<TranslationResult[]>([]);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  // Track per-row saving state: "modId\x00key\x00modName" -> saving
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const [saveMsg, setSaveMsg] = useState<string>("");

  const prevTranslationJobId = useRef(translationJobId);
  const [filterTerm, setFilterTerm] = useState("");
  const sf = useSortFilter<Record<string, string>>();

  // ── Auto-recover: 新翻译开始时自动重置 dismissed ──
  useEffect(() => {
    if (translationJobId && translationJobId !== prevTranslationJobId.current) {
      prevTranslationJobId.current = translationJobId;
      setDismissed(false);
    }
  }, [translationJobId]);

  // ── Load job meta + all results reactively ──
  useEffect(() => {
    if (!translationJobId) {
      setLoading(false);
      setJob(null);
      setAllEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setAllEntries([]);
    setError("");

    const load = async () => {
      try {
        const j = await loadLatestTranslationJobMeta();
        if (cancelled) return;
        setJob(j);
        if (j && j.status === "completed") {
          const results = await loadTranslationResults(j.jobId);
          if (!cancelled) {
            setAllEntries(results);
          }
        }
      } catch {
        // no job yet — that's OK
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [translationJobId, translationStatus]);

  // ── Dismiss / clear view ──
  function handleDismiss() {
    setDismissed(true);
    setJob(null);
    setAllEntries([]);
    setError("");
    setSaveMsg("");
  }

  // ── Save a single entry edit back to JSONL ──
  const handleSave = useCallback(async (entry: TranslationResult, newText: string) => {
    const rk = rowKey(entry);
    setSavingRows((prev) => new Set(prev).add(rk));
    setSaveMsg("");
    try {
      await saveTranslationEntry(job!.jobId, entry.key, entry.modName, entry.modId, newText);
      // Update local state
      setAllEntries((prev) => {
        const idx = prev.findIndex(
          (e) => e.key === entry.key && e.modName === entry.modName && e.modId === entry.modId,
        );
        if (idx === -1) return prev;
        const copy = prev.slice();
        copy[idx] = { ...prev[idx], targetText: newText };
        return copy;
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

  // ── Filter & sort entries ──
  const filteredEntries = useMemo(() => {
    let result = allEntries;

    // Global text search across all text columns
    if (filterTerm) {
      const term = filterTerm.toLowerCase();
      result = result.filter(
        (e) =>
          e.modName.toLowerCase().includes(term) ||
          e.modId.toLowerCase().includes(term) ||
          e.key.toLowerCase().includes(term) ||
          e.sourceText.toLowerCase().includes(term) ||
          (e.targetText || "").toLowerCase().includes(term),
      );
    }

    // Per-column filters
    const fkeys = Object.keys(sf.filters);
    if (fkeys.length > 0) {
      result = result.filter((entry) =>
        fkeys.every((col) => {
          const value = sf.filters[col];
          if (!value) return true;
          switch (col) {
            case "modName":
              return entry.modName.toLowerCase().includes(value.toLowerCase());
            case "modId":
              return entry.modId.toLowerCase().includes(value.toLowerCase());
            case "key":
              return entry.key.toLowerCase().includes(value.toLowerCase());
            case "sourceText":
              return entry.sourceText.toLowerCase().includes(value.toLowerCase());
            case "targetText":
              return (entry.targetText || "").toLowerCase().includes(value.toLowerCase());
            case "sourceType":
              return entry.sourceType === value;
            default:
              return true;
          }
        }),
      );
    }

    // Sort
    if (sf.sortConfig) {
      const sc = sf.sortConfig;
      result = [...result].sort((a, b) => {
        const dir = sc.direction === "asc" ? 1 : -1;
        let cmp = 0;
        switch (sc.key) {
          case "modName":
            cmp = a.modName.localeCompare(b.modName); break;
          case "modId":
            cmp = a.modId.localeCompare(b.modId); break;
          case "key":
            cmp = a.key.localeCompare(b.key); break;
          case "sourceText":
            cmp = a.sourceText.localeCompare(b.sourceText); break;
          case "targetText":
            cmp = (a.targetText || "").localeCompare(b.targetText || ""); break;
          case "sourceType":
            cmp = a.sourceType.localeCompare(b.sourceType); break;
        }
        return cmp * dir;
      });
    }

    return result;
  }, [allEntries, filterTerm, sf.filters, sf.sortConfig]);

  // ── Helpers ──
  function rowKey(entry: TranslationResult) {
    return `${entry.modId}\x00${entry.key}\x00${entry.modName}`;
  }

  const hasData = job && job.status === "completed" && filteredEntries.length > 0;

  // ── Render helpers ──

  function renderContent() {
    if (loading) {
      return (
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
          <p>加载中...</p>
        </div>
      );
    }

    if (dismissed) {
      return (
        <>
          {job && (
            <div className="page-header">
              <div>
                <h1>{t(language, "validate.title")}</h1>
                <p>{t(language, "validate.description")}</p>
              </div>
              <div className="page-header-button">
                <button className="ghost-button" onClick={() => setDismissed(false)} type="button" style={{ fontSize: 13 }}>
                  {t(language, "validate.restoreView")}
                </button>
              </div>
            </div>
          )}
          <div className="empty-state">
            <Search size={32} />
            <p>{t(language, "validate.dismissedMessage")}</p>
          </div>
        </>
      );
    }

    if (!job) {
      return (
        <>
          <div className="page-header">
            <div>
              <h1>{t(language, "validate.title")}</h1>
              <p>{t(language, "validate.description")}</p>
            </div>
          </div>
          <div className="empty-state">
            <Search size={32} />
            <p>未找到翻译任务。请先在「翻译任务」页面完成一次翻译。</p>
          </div>
        </>
      );
    }

    if (job.status !== "completed") {
      return (
        <>
          <div className="page-header">
            <div>
              <h1>{t(language, "validate.title")}</h1>
              <p>{t(language, "validate.description")}</p>
            </div>
            <div className="page-header-button">
              <button className="ghost-button" onClick={handleDismiss} type="button">
                {t(language, "validate.close")}
              </button>
            </div>
          </div>
          <div className="empty-state">
            <Loader2 size={32} />
            <p>翻译任务尚未完成，请等待翻译完成后进入校对。</p>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="page-header">
          <div>
            <h1>{t(language, "validate.title")}</h1>
            <p>{t(language, "validate.description")}</p>
          </div>
          <div className="page-header-button">
            <button className="ghost-button" onClick={handleDismiss} type="button" style={{ fontSize: 13 }}>
              {t(language, "validate.close")}
            </button>
            {allEntries.length > 0 && (
              <button className="primary-button" onClick={onConfirm} type="button">
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
              {new Date(job.completedAt).toLocaleString()}
            </span>
          )}
          <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
            {allEntries.length} 个条目
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

        {allEntries.length === 0 && (
          <div className="empty-state" style={{ padding: 32 }}>
            <Search size={28} />
            <p>暂无翻译结果</p>
          </div>
        )}

        {/* ── Flat table ── */}
        {allEntries.length > 0 && (
          <div className="log-panel" style={{ flex: 1, marginTop: 0 }}>
            <div className="log-panel-header">
              <h3>翻译条目</h3>
              {filteredEntries.length > 0 && (
                <span className="log-entries-count">
                  {filteredEntries.length} / {allEntries.length} 条
                </span>
              )}
              <input
                className="log-panel-filter"
                placeholder="搜索模组名、ModId、键名、原文或译文..."
                value={filterTerm}
                onChange={(e) => setFilterTerm(e.target.value)}
              />
            </div>
            <div className="log-panel-body">
              {filteredEntries.length === 0 ? (
                <div className="log-panel-empty">没有匹配的条目</div>
              ) : (
                <TableVirtuoso
                  followOutput={false}
                  style={{ height: "100%" }}
                  totalCount={filteredEntries.length}
                  components={{
                    Table: ({ children, ...rest }) => (
                      <table {...rest}>
                        <colgroup>
                          <col style={{ width: "16%" }} />
                          <col style={{ width: "16%" }} />
                          <col style={{ width: "25%" }} />
                          <col style={{ width: "30%" }} />
                          <col style={{ width: "8%" }} />
                          <col style={{ width: "5%" }} />
                        </colgroup>
                        {children}
                      </table>
                    ),
                  }}
                  fixedHeaderContent={() => (
                    <tr>
                      {([
                        { key: "modName", label: "Mod 名称" },
                        { key: "modId", label: "Mod ID" },
                        { key: "sourceText", label: "原文" },
                        { key: "targetText", label: "译文" },
                        { key: "sourceType", label: "来源" },
                        { key: "actions", label: "操作" },
                      ] as const).map((col) => {
                        if (col.key === "actions") {
                          return (
                            <th key={col.key} style={{ textAlign: "center", ...sortThStyle }}>
                              {col.label}
                            </th>
                          );
                        }
                        const isActiveSort = sf.sortConfig?.key === col.key;
                        const isDefaultSort = !sf.sortConfig && col.key === "modName";
                        const hasActiveFilter = col.key in sf.filters;
                        return (
                          <th
                            key={col.key}
                            className={[
                              "sortable",
                              isActiveSort ? (sf.sortConfig!.direction === "asc" ? "sorted-asc" : "sorted-desc") : "",
                              isDefaultSort ? "sorted-default" : "",
                            ].filter(Boolean).join(" ")}
                            onClick={() => sf.handleSort(col.key)}
                            style={sortThStyle}
                          >
                            <span className="th-filter-wrap">
                              {col.label}
                              {(isActiveSort || isDefaultSort) && (
                                <span className="sort-indicator">
                                  {isActiveSort ? (sf.sortConfig!.direction === "asc" ? "↑" : "↓") : "↕"}
                                </span>
                              )}
                              <button
                                className={[
                                  "th-filter-btn",
                                  hasActiveFilter ? "has-filter" : "",
                                  sf.openFilter === col.key ? "active" : "",
                                ].filter(Boolean).join(" ")}
                                onClick={(e) => { e.stopPropagation(); sf.toggleFilter(col.key); }}
                                type="button"
                                aria-label={`Filter ${col.label}`}
                                data-tooltip={t(language, "tooltip.filter")}
                              >
                                <Filter size={13} />
                              </button>
                              {sf.openFilter === col.key && (
                                <div
                                  className="filter-popover"
                                  ref={sf.filterRef}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="filter-popover-header">
                                    <span>{col.label}</span>
                                    <button
                                      className="filter-popover-clear"
                                      onClick={() => { sf.handleFilterChange(col.key, null); }}
                                      type="button"
                                      data-tooltip={t(language, "tooltip.clearFilter")}
                                    >
                                      <X size={13} />
                                    </button>
                                  </div>
                                  <input
                                    type="text"
                                    value={sf.filters[col.key] || ""}
                                    onChange={(e) => sf.handleFilterChange(col.key, e.target.value)}
                                    placeholder="筛选..."
                                    autoFocus
                                  />
                                </div>
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  )}
                  itemContent={(index) => {
                    const entry = filteredEntries[index];
                    const rk = rowKey(entry);
                    const isSaving = savingRows.has(rk);
                    return (
                      <ValidateRow
                        entry={entry}
                        isSaving={isSaving}
                        onSave={handleSave}
                      />
                    );
                  }}
                />
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <section className="page validate-page">
      {renderContent()}
    </section>
  );
}

// ── Shared styles ──

const sortThStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontWeight: 600,
  fontSize: 11,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  background: "var(--bg-surface)",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  verticalAlign: "middle",
  borderBottom: "1px solid var(--bg-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "0",  // Required for text-overflow in flex/grid contexts
};

// ── Row component ──

const ValidateRow = React.memo(function ValidateRow({
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

  // Reset local state when entry changes
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

  let sourceTypeLabel = entry.sourceType;
  if (sourceTypeLabel === "llm") sourceTypeLabel = "LLM";
  else if (sourceTypeLabel === "dictionary") sourceTypeLabel = "词典";
  else if (sourceTypeLabel === "existing") sourceTypeLabel = "已有";
  else if (sourceTypeLabel === "skipped") sourceTypeLabel = "跳过";
  else if (sourceTypeLabel === "failed") sourceTypeLabel = "失败";
  else if (sourceTypeLabel === "reviewed") sourceTypeLabel = "已审";

  return (
    <tr>
      <td style={{ ...tdStyle, fontWeight: 500 }} title={entry.modName}>
        {entry.modName}
      </td>
      <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }} title={entry.modId}>
        {entry.modId}
      </td>
      <td style={{ ...tdStyle }} title={entry.sourceText}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.sourceText}
        </span>
      </td>
      <td style={{ ...tdStyle, padding: "4px 10px", whiteSpace: "normal" }}>
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
        <span className="badge" style={{ fontSize: 10 }}>{sourceTypeLabel}</span>
      </td>
      <td style={{ ...tdStyle, textAlign: "center" }}>
        <button
          className="ghost-button"
          onClick={() => onSave(entry, editText)}
          disabled={!isDirty || isSaving}
          type="button"
          style={{ padding: "4px 8px", fontSize: 12, minWidth: 0 }}
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

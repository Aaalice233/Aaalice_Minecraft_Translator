import { TableVirtuoso } from "react-virtuoso";
import {
  CheckCircle,
  Loader2,
  PackageCheck,
  Search,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { loadLatestTranslationJobMeta, loadTranslationResults, markJobReviewed, saveTranslationEntry, translateSingleEntry } from "../api/tauri";
import { t } from "../i18n/translations";
import { useSortFilter } from "../hooks/useSortFilter";
import { SortableTableHeader } from "../components/SortableTableHeader";
import { TranslationEditPanel } from "../components/TranslationEditPanel";
import type { EditPanelEntry } from "../components/TranslationEditPanel";
import { useAppStore } from "../stores/appStore";
import type { AppLanguage, TranslationJobListItem, TranslationResult } from "../types";

interface Props {
  language: AppLanguage;
  onReviewComplete: () => void;
}

// ── Component ────────────────────────────────────────────────────

export function ValidatePage({ language, onReviewComplete }: Props) {
  const translationJobId = useAppStore((s) => s.translationJobId);
  const translationStatus = useAppStore((s) => s.translationStatus);

  // ── State ──
  const [job, setJob] = useState<TranslationJobListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [allEntries, setAllEntries] = useState<TranslationResult[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [filterTerm, setFilterTerm] = useState("");
  const sf = useSortFilter<Record<string, string>>();

  // ── Edit panel state ──
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelKey, setPanelKey] = useState<string | null>(null);

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

  // ── Auto-save when user leaves an edited textarea ──
  const handleSave = useCallback(async (entry: TranslationResult, newText: string) => {
    if (!job) throw new Error("未找到翻译任务");
    if (newText === entry.targetText) return;
    try {
      await saveTranslationEntry(job.jobId, entry.key, entry.modName, entry.modId, newText);
      setAllEntries((prev) => {
        const idx = prev.findIndex(
          (e) => e.key === entry.key && e.modName === entry.modName && e.modId === entry.modId,
        );
        if (idx === -1) return prev;
        const copy = prev.slice();
        copy[idx] = { ...prev[idx], targetText: newText };
        return copy;
      });
    } catch (err) {
      console.warn("auto-save failed:", err);
      throw err; // re-throw so TranslationEditPanel can show saveError
    }
  }, [job]);

  // ── LLM translate handler for the edit panel ──
  const handleLlmTranslate = useCallback(async (entry: EditPanelEntry) => {
    const result = await translateSingleEntry(
      job?.jobId ?? null,
      entry.key,
      entry.sourceText,
      entry.modName ?? "",
      entry.modId,
      job?.sourceLanguage ?? "en_us",
      job?.targetLanguage ?? "zh_cn",
    );
    return result;
  }, [job?.jobId, job?.sourceLanguage, job?.targetLanguage]);

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


  const hasData = job && job.status === "completed" && filteredEntries.length > 0;

  // ── Render helpers ──

  // ── 校对完成处理 ──
  async function handleReviewComplete() {
    if (!job || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await markJobReviewed(job.jobId);
      onReviewComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // reviewed=true → 已校对; reviewed=null/undefined → 旧数据向后兼容视为已校对; reviewed=false → 未校对
  const isReviewed = job?.reviewed === true || (job?.status === "reviewed") || (job?.reviewed == null && job?.status === "completed");

  function renderContent() {
    if (loading) {
      return (
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
          <p>加载中...</p>
        </div>
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

    const jobIsFinished = job.status === "completed" || job.status === "reviewed" || job.status === "failed";
    if (!jobIsFinished) {
      return (
        <>
          <div className="page-header">
            <div>
              <h1>{t(language, "validate.title")}</h1>
              <p>{t(language, "validate.description")}</p>
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
            {isReviewed && (
              <span className="badge success" style={{ fontSize: 12, marginRight: 8 }}>
                <CheckCircle size={14} style={{ marginRight: 4 }} />
                已校对
              </span>
            )}
            {!isReviewed && allEntries.length > 0 && (
              <button
                className="primary-button"
                onClick={handleReviewComplete}
                disabled={submitting}
                type="button"
              >
                {submitting ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <PackageCheck size={18} />
                )}
                校对完成
              </button>
            )}
          </div>
        </div>

        {/* ── Job info bar ── */}
        <div className="job-info-bar">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <CheckCircle size={14} style={{ color: "var(--accent)" }} />
            {job.completedEntries} 条已翻译
          </span>
          {job.completedAt && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {new Date(job.completedAt).toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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
                          <col style={{ width: "17%" }} />
                          <col style={{ width: "15%" }} />
                          <col style={{ width: "27%" }} />
                          <col style={{ width: "31%" }} />
                          <col style={{ width: "10%" }} />
                        </colgroup>
                        {children}
                      </table>
                    ),
                  }}
                  fixedHeaderContent={() => {
                    const validateColumns: import("../components/SortableTableHeader").ColumnConfig[] = [
                      { key: "modName", label: "Mod 名称", filterType: "text", thStyle: sortThStyle },
                      { key: "modId", label: "Mod ID", filterType: "text", thStyle: sortThStyle },
                      { key: "sourceText", label: "原文", filterType: "text", thStyle: sortThStyle },
                      { key: "targetText", label: "译文", filterType: "text", thStyle: sortThStyle },
                      { key: "sourceType", label: "来源", filterType: "text", thStyle: sortThStyle },
                    ];
                    return (
                      <SortableTableHeader
                        columns={validateColumns}
                        sortConfig={sf.sortConfig}
                        filters={sf.filters}
                        openFilter={sf.openFilter}
                        filterRef={sf.filterRef}
                        onSort={sf.handleSort}
                        onToggleFilter={sf.toggleFilter}
                        onFilterChange={sf.handleFilterChange}
                        defaultSortKey="modName"
                      />
                    );
                  }}
                  itemContent={(index) => {
                    const entry = filteredEntries[index];
                    const isHighlighted = panelOpen && panelKey === `${entry.modId}::${entry.key}`;
                    return (
                      <ValidateRow
                        entry={entry}
                        onOpenPanel={() => {
                          setPanelKey(`${entry.modId}::${entry.key}`);
                          setPanelOpen(true);
                        }}
                        highlighted={isHighlighted}
                      />
                    );
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Edit Panel (via createPortal) ── */}
        {panelOpen && panelKey && createPortal(
          <TranslationEditPanel
            entries={filteredEntries.map((e) => ({
              navKey: `${e.modId}::${e.key}`,
              key: e.key,
              sourceText: e.sourceText,
              targetText: e.targetText,
              modId: e.modId,
              modName: e.modName,
              sourceType: e.sourceType,
            }))}
            initialKey={panelKey}
            onSave={async (panelEntry, newText) => {
              const orig = filteredEntries.find(
                (e) => e.key === panelEntry.key && e.modName === panelEntry.modName && e.modId === panelEntry.modId,
              );
              if (!orig) throw new Error("条目已不在当前列表，无法保存");
              await handleSave(orig, newText);
            }}
            onClose={() => setPanelOpen(false)}
            onLlmTranslate={handleLlmTranslate}
            pageType="validate"
            language={language}
          />,
          document.body,
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
  padding: "8px 12px",
  verticalAlign: "top",
  borderBottom: "1px solid var(--bg-muted)",
  lineHeight: 1.5,
};

const highlightedTdStyle: React.CSSProperties = {
  ...tdStyle,
  background: "var(--accent-bg)",
  boxShadow: "inset 3px 0 0 var(--accent)",
};

// ── Row component ──

const ValidateRow = React.memo(function ValidateRow({
  entry,
  onOpenPanel,
  highlighted,
}: {
  entry: TranslationResult;
  onOpenPanel?: () => void;
  highlighted?: boolean;
}) {
  let sourceTypeLabel = entry.sourceType;
  if (sourceTypeLabel === "llm") sourceTypeLabel = "LLM";
  else if (sourceTypeLabel === "dictionary") sourceTypeLabel = "词典";
  else if (sourceTypeLabel === "existing") sourceTypeLabel = "已有";
  else if (sourceTypeLabel === "skipped") sourceTypeLabel = "跳过";
  else if (sourceTypeLabel === "failed") sourceTypeLabel = "失败";
  else if (sourceTypeLabel === "reviewed") sourceTypeLabel = "已审";

  const hStyle = highlighted ? highlightedTdStyle : tdStyle;

  return (
    <>
      <td style={{ ...hStyle, fontWeight: 500 }} title={entry.modName}>
        {entry.modName}
      </td>
      <td style={{ ...hStyle, fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }} title={entry.modId}>
        {entry.modId}
      </td>
      <td style={{ ...hStyle }} title={entry.sourceText}>
        <span style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          lineHeight: 1.5,
        }}>
          {entry.sourceText}
        </span>
      </td>
      <td
        style={{ ...hStyle, cursor: "pointer" }}
        onDoubleClick={onOpenPanel}
        title="双击打开编辑面板"
      >
        <span style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          lineHeight: 1.5,
        }}>
          {entry.targetText}
        </span>
      </td>
      <td style={{ ...hStyle, textAlign: "center" }}>
        <span className="badge" style={{ fontSize: 10 }}>{sourceTypeLabel}</span>
      </td>
    </>
  );
});

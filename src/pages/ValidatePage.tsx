import {
  BadgeCheck,
  ClipboardCheck,
  Loader2,
  Search,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadLatestTranslationJobMeta, loadTranslationResults, markJobReviewed, saveTranslationEntry, translateSingleEntry } from "../api/tauri";
import { localeByAppLanguage, t } from "../i18n/translations";
import { useSortFilter } from "../hooks/useSortFilter";
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { DataTable } from "../components/DataTable";
import type { ColumnConfig } from "../components/SortableTableHeader";
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
  const activeEditKeyRef = useRef<string | null>(null);

  // Clean up DOM highlight when panel closes (safety net for edge cases)
  useEffect(() => {
    if (!panelOpen) {
      document.querySelectorAll("tr.editing-highlighted").forEach((el) =>
        el.classList.remove("editing-highlighted"),
      );
    }
  }, [panelOpen]);

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
    if (!job) throw new Error("Translation job not found");
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

  // ── Stable renderRow — panelOpen/panelKey NOT in deps ──
  // Highlighting is done via DOM data-* attribute + CSS class, not React state.
  const renderRow = useCallback((entry: TranslationResult, _index: number) => {
    const key = `${entry.modId}::${entry.key}`;
    return (
      <ValidateRow
        entry={entry}
        language={language}
        onOpenPanel={() => {
          activeEditKeyRef.current = key;
          // Add highlight class via DOM directly — avoids React re-render
          document.querySelectorAll("tr.editing-highlighted").forEach((el) =>
            el.classList.remove("editing-highlighted"),
          );
          document
            .querySelector(`tr[data-entry-key="${CSS.escape(key)}"]`)
            ?.classList.add("editing-highlighted");
          setPanelKey(key);
          setPanelOpen(true);
        }}
      />
    );
  }, [language]);


  const validateColumnsMemo: ColumnConfig[] = useMemo(() => [
    { key: "modName", label: t(language, "validate.col.modName"), filterType: "text", thStyle: sortThStyle },
    { key: "modId", label: t(language, "validate.col.modId"), filterType: "text", thStyle: sortThStyle },
    { key: "sourceText", label: t(language, "validate.col.sourceText"), filterType: "text", thStyle: sortThStyle },
    { key: "targetText", label: t(language, "validate.col.targetText"), filterType: "text", thStyle: sortThStyle },
    { key: "sourceType", label: t(language, "validate.col.sourceType"), filterType: "select", filterOptions: [
      { value: "llm", label: t(language, "jobs.sourceType.llm") },
      { value: "dictionary", label: t(language, "jobs.sourceType.dictionary") },
      { value: "existing", label: t(language, "jobs.sourceType.existing") },
      { value: "skipped", label: t(language, "jobs.sourceType.skipped") },
      { value: "failed", label: t(language, "jobs.sourceType.failed") },
      { value: "reviewed", label: t(language, "jobs.sourceType.reviewed") },
    ], thStyle: sortThStyle },
  ], [language]);

  // ── Row wrapper: adds data-entry-key for DOM-based row highlighting ──
  const rowWrapper = useCallback(
    ({ item, children, ...rest }: { item: TranslationResult; children: React.ReactNode; [key: string]: any }) => (
      <tr {...rest} data-entry-key={`${item.modId}::${item.key}`}>
        {children}
      </tr>
    ),
    [],
  );

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
          <p>{t(language, "validate.loading")}</p>
        </div>
      );
    }

    if (!job) {
      return (
        <>
          <PageHeader title={t(language, "validate.title")} subtitle={t(language, "validate.description")} />
          <div className="empty-state">
            <Search size={32} />
            <p>{t(language, "validate.noJob")}</p>
          </div>
        </>
      );
    }

    const validateSubtitle = job
      ? (() => {
          const dateStr = job.completedAt
            ? new Date(job.completedAt).toLocaleString(localeByAppLanguage[language], { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
            : "";
          return t(language, "validate.summary", { count: job.completedEntries, date: dateStr, total: allEntries.length });
        })()
      : t(language, "validate.description");
    const jobIsFinished = job.status === "completed" || job.status === "reviewed" || job.status === "failed";
    if (!jobIsFinished) {
      return (
        <>
          <PageHeader title={t(language, "validate.title")} subtitle={t(language, "validate.description")} />
          <div className="empty-state">
            <Loader2 size={32} />
            <p>{t(language, "validate.jobPending")}</p>
          </div>
        </>
      );
    }

    return (
      <>
        <PageHeader
          title={t(language, "validate.title")}
          subtitle={validateSubtitle}
          actions={
            <>
              {isReviewed && (
                <span className="badge success" style={{ fontSize: 12, marginRight: 8 }}>
                  <BadgeCheck size={14} style={{ marginRight: 4 }} />
                  {t(language, "validate.reviewed")}
                </span>
              )}
              {!isReviewed && allEntries.length > 0 && (
                <button className="primary-button" onClick={handleReviewComplete} disabled={submitting} type="button">
                  {submitting ? <Loader2 size={18} className="spin" /> : <ClipboardCheck size={18} />}
                  {t(language, "validate.markDone")}
                </button>
              )}
            </>
          }
        />

        {/* ── Error / Info alerts ── */}
        {error && (
          <div className="alert error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        {allEntries.length === 0 && (
          <div className="empty-state" style={{ padding: 32 }}>
            <Search size={28} />
            <p>{t(language, "validate.noResults")}</p>
          </div>
        )}

        {/* ── Flat table ── */}
        {allEntries.length > 0 && (
          <>
          <div style={{ marginBottom: 8 }}>
          <SearchInput
            value={filterTerm}
            onChange={setFilterTerm}
            placeholder={t(language, "validate.searchPlaceholder")}
          />
          </div>
          <div className="log-panel-body" style={{ overflowX: "hidden" }}>
          <DataTable
            data={filteredEntries}
            columns={validateColumnsMemo}
            sortConfig={sf.sortConfig}
            filters={sf.filters}
            openFilter={sf.openFilter}
            filterRef={sf.filterRef as React.RefObject<HTMLDivElement | null>}
            onSort={sf.handleSort}
            onToggleFilter={sf.toggleFilter}
            onFilterChange={sf.handleFilterChange}
            defaultSortKey="modName"
            language={language}
            renderRow={renderRow}
            RowWrapper={rowWrapper}
            colWidths={["16%", "12%", "28%", "30%", "14%"]}
          />
          </div>
          </>
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
              if (!orig) throw new Error("Entry no longer in list, cannot save");
              await handleSave(orig, newText);
            }}
            onClose={() => {
              // Clean up DOM highlight before closing
              document.querySelectorAll("tr.editing-highlighted").forEach((el) =>
                el.classList.remove("editing-highlighted"),
              );
              activeEditKeyRef.current = null;
              setPanelOpen(false);
            }}
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
  verticalAlign: "middle",
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
  language,
  onOpenPanel,
  highlighted,
}: {
  entry: TranslationResult;
  language: AppLanguage;
  onOpenPanel?: () => void;
  highlighted?: boolean;
}) {
  const sourceTypeLabel = t(language, `jobs.sourceType.${entry.sourceType}` as any);

  const hStyle = highlighted ? highlightedTdStyle : tdStyle;

  return (
    <>
      <td style={{ ...hStyle, fontWeight: 500, wordBreak: "break-word" }} title={entry.modName}>
        {entry.modName}
      </td>
      <td style={{ ...hStyle, wordBreak: "break-all" }} title={entry.modId}>
        {entry.modId}
      </td>
      <td style={{ ...hStyle, wordBreak: "break-word" }} title={entry.sourceText}>
        <span style={{ lineHeight: 1.5 }}>
          {entry.sourceText}
        </span>
      </td>
      <td
        style={{ ...hStyle, cursor: "pointer", wordBreak: "break-word" }}
        onClick={onOpenPanel}
        title={t(language, "validate.doubleClickEdit")}
      >
        <span style={{ lineHeight: 1.5 }}>
          {entry.targetText}
        </span>
      </td>
      <td style={{ ...hStyle }}>
        <span className="badge" style={{ fontSize: 10 }}>{sourceTypeLabel}</span>
      </td>
    </>
  );
});

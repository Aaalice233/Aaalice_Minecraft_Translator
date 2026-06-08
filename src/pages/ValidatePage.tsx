import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  Loader2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLatestTranslationJob, retryFailedEntries, validateTranslation } from "../api/tauri";
import { t, type TranslationKey } from "../i18n/translations";
import type { AppLanguage, TranslationJobState, ValidationIssue, ValidationReport } from "../types";

interface Props {
  language: AppLanguage;
  onConfirm: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  error: { icon: XCircle, className: "severity-error", label: "错误" },
  warning: { icon: AlertTriangle, className: "severity-warning", label: "警告" },
} as const;

const ISSUE_TYPE_LABELS: Record<string, string> = {
  missing_result: "缺失结果",
  empty_result: "空结果",
  placeholder_missing: "占位符丢失",
};

const ISSUE_TYPES = ["all", "missing_result", "empty_result", "placeholder_missing"];

function severityIcon(s: string) {
  const cfg = SEVERITY_CONFIG[s as keyof typeof SEVERITY_CONFIG];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return <Icon size={15} className={cfg.className} />;
}

function issueTypeLabel(tpe: string): string {
  return ISSUE_TYPE_LABELS[tpe] || tpe;
}

/** Group issues by modId. */
function groupByMod(issues: ValidationIssue[]): Map<string, ValidationIssue[]> {
  const map = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.modId) || [];
    list.push(issue);
    map.set(issue.modId, list);
  }
  return map;
}

// ── Component ────────────────────────────────────────────────────

export function ValidatePage({ language, onConfirm }: Props) {
  // ── State ──
  const [job, setJob] = useState<TranslationJobState | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "error" | "warning">("all");
  const [issueTypeFilter, setIssueTypeFilter] = useState<string>("all");
  const [selectedIssue, setSelectedIssue] = useState<ValidationIssue | null>(null);
  const [expandedMods, setExpandedMods] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<string>("");
  // Editing state for the detail panel
  const [editText, setEditText] = useState<string>("");
  // Multi-select: set of "modId\x00key" composite keys
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // ── Load job on mount ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadLatestTranslationJob()
      .then((j) => { if (!cancelled) setJob(j); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Validation ──
  async function handleValidate() {
    if (!job) return;
    setValidating(true);
    setError("");
    setReport(null);
    setSelectedIssue(null);
    setRetryResult("");
    try {
      const result = await validateTranslation(job.jobId);
      setReport(result);
      // Auto-expand all mods with errors
      if (result) {
        const allIssues = [...result.placeholderIssues, ...result.formatIssues];
        const errorMods = new Set(allIssues.filter((i) => i.severity === "error" || i.severity === "warning").map((i) => i.modId));
        setExpandedMods(errorMods);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  // ── Filtering ──
  const filterBySeverity = useCallback(
    (i: ValidationIssue): boolean => {
      if (viewMode === "all") return true;
      return i.severity === viewMode;
    },
    [viewMode],
  );

  const filterByIssueType = useCallback(
    (i: ValidationIssue): boolean => {
      if (issueTypeFilter === "all") return true;
      return i.issueType === issueTypeFilter;
    },
    [issueTypeFilter],
  );

  const allIssues: ValidationIssue[] = useMemo(
    () =>
      report
        ? [...report.placeholderIssues, ...report.formatIssues].filter(filterBySeverity).filter(filterByIssueType)
        : [],
    [report, filterBySeverity, filterByIssueType],
  );

  const groupedIssues = useMemo(() => groupByMod(allIssues), [allIssues]);

  // ── Expand/collapse mod groups ──
  function toggleMod(modId: string) {
    setExpandedMods((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  }

  // ── Selection ──
  function handleSelectIssue(issue: ValidationIssue) {
    setSelectedIssue(issue);
    setEditText(issue.targetText);
  }

  // ── Retry failed entries ──
  async function runRetry() {
    if (!job) return;
    setRetrying(true);
    setRetryResult("");
    try {
      const count = await retryFailedEntries(job.jobId, job.sourceLanguage, job.targetLanguage);
      setRetryResult(`已重试 ${count} 个失败条目`);
      handleValidate();
    } catch (err) {
      setRetryResult(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  }

  function handleRetry() { runRetry(); }
  function handleBatchRetry() {
    runRetry().then(() => clearSelection());
  }

  // ── Export report ──
  function handleExportJSON() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `validation-report-${job?.jobId ?? "unknown"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportCSV() {
    if (!report) return;
    const issues = [...report.placeholderIssues, ...report.formatIssues];
    const header = "severity,type,modId,key,sourceText,targetText,description";
    const rows = issues.map(
      (i) =>
        `${i.severity},${i.issueType},${i.modId},"${i.key}","${i.sourceText.replace(/"/g, '""')}","${i.targetText.replace(/"/g, '""')}","${i.description}"`,
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `validation-report-${job?.jobId ?? "unknown"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Multi-select helpers ──
  function issueKey(i: ValidationIssue): string {
    return `${i.modId}\x00${i.key}`;
  }

  function toggleSelect(issue: ValidationIssue) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = issueKey(issue);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  // ── Batch retry selected failed entries ──


  // ── Edit and save correction ──
  function handleEditChange(newText: string) {
    setEditText(newText);
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't fire if user is editing text
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "Enter":
          if (!report && job) handleValidate();
          break;
        case "r":
        case "R":
          if (report && report.failed > 0) handleRetry();
          break;
        case "e":
        case "E":
          if (report) handleExportJSON();
          break;
        case "Escape":
          setSelectedIssue(null);
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [report, job]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render: Loading ──
  if (loading) {
    return (
      <section className="page validate-page">
        <div className="empty-state">
          <Loader2 size={24} className="spin" />
          <p>{t(language, "common.loading")}</p>
        </div>
      </section>
    );
  }

  // ── Render: No job ──
  if (!job && !loading) {
    return (
      <section className="page validate-page validate-workspace">
        <div className="empty-state">
          <Search size={32} />
          <p>未找到翻译任务。请先在"翻译任务"页面完成一次翻译。</p>
        </div>
      </section>
    );
  }

  // ── Render: Main ──
  return (
    <section className="page validate-page validate-workspace">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1>{t(language, "pipeline.validate")}</h1>
          <p>检查翻译结果中的占位符完整性和格式正确性</p>
        </div>
        <div className="page-header-button" style={{ gap: 6 }}>
          {report && (
            <>
              <button
                className="ghost-button"
                onClick={handleExportJSON}
                type="button"
                data-tooltip="导出 JSON 报告"
              >
                <Download size={16} />
                JSON
              </button>
              <button
                className="ghost-button"
                onClick={handleExportCSV}
                type="button"
                data-tooltip="导出 CSV 报告"
              >
                <FileText size={16} />
                CSV
              </button>
              {report.failed > 0 && (
                <button
                  className="ghost-button"
                  onClick={handleRetry}
                  disabled={retrying}
                  type="button"
                  data-tooltip="重试所有失败条目"
                >
                  {retrying ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                  重试失败
                </button>
              )}
              <button
                className="primary-button"
                onClick={onConfirm}
                type="button"
                disabled={report.failed > 0 || report.missing > 0}
                data-tooltip={
                  report.failed > 0 || report.missing > 0
                    ? "请先修复校验错误"
                    : "确认后进入打包"
                }
              >
                <PackageCheck size={18} />
                {t(language, "packages.generate")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Error alert ── */}
      {error && (
        <div className="alert error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={17} />
          {error}
        </div>
      )}

      {retryResult && (
        <div
          className={`alert ${retryResult.startsWith("已重试") ? "success" : "error"}`}
          style={{ marginBottom: 12 }}
        >
          {retryResult}
        </div>
      )}

      {/* ── Pre-validation state ── */}
      {job && !report && (
        <div className="validate-ready">
          <div className="validate-ready-card">
            <div className="validate-ready-icon">
              <ShieldCheck size={28} />
            </div>
            <div className="validate-ready-info">
              <h3>准备校验</h3>
              <div className="validate-ready-meta">
                <span className="ready-meta-item">
                  <FileText size={14} />
                  任务: <code>{job.jobId}</code>
                </span>
                {job.status === "completed" && (
                  <span className="ready-meta-item success">
                    <CheckCircle size={14} />
                    {job.completedEntries} 条已翻译
                  </span>
                )}
                {job.completedAt && (
                  <span className="ready-meta-item">
                    <ClipboardList size={14} />
                    {new Date(job.completedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="validate-ready-desc">
                检查翻译结果中的占位符完整性和格式正确性，确保资源包可用。
              </p>
            </div>
            <button
              className="primary-button validate-ready-btn"
              onClick={handleValidate}
              disabled={validating}
              type="button"
            >
              {validating ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
              {validating ? "校验中..." : "开始校验"}
            </button>
          </div>
        </div>
      )}

      {/* ── Report view: three-column workspace ── */}
      {report && (
        <div className="workspace-layout">
          {/* ── Left column: Sidebar ── */}
          <aside className="workspace-sidebar">
            {/* Quick stats */}
            <section className="workspace-card">
              <h3 className="workspace-card-title">校验统计</h3>
              <div className="validate-stats-vertical">
                <div className="validate-stat-row">
                  <span className="stat-label">总条目</span>
                  <span className="stat-value">{report.totalEntries}</span>
                </div>
                <div className="validate-stat-row success">
                  <CheckCircle size={15} />
                  <span className="stat-label">通过</span>
                  <span className="stat-value">{report.passed}</span>
                </div>
                <div className="validate-stat-row error">
                  <XCircle size={15} />
                  <span className="stat-label">失败</span>
                  <span className="stat-value">{report.failed}</span>
                </div>
                <div className="validate-stat-row warning">
                  <AlertTriangle size={15} />
                  <span className="stat-label">缺失</span>
                  <span className="stat-value">{report.missing}</span>
                </div>
              </div>
              {/* Mini bar chart showing pass/fail ratio */}
              {report.totalEntries > 0 && (
                <div className="validate-bar-chart">
                  {report.passed > 0 && (
                    <div
                      className="bar-segment success"
                      style={{ width: `${(report.passed / report.totalEntries) * 100}%` }}
                      title={`通过: ${report.passed}`}
                    />
                  )}
                  {report.failed > 0 && (
                    <div
                      className="bar-segment error"
                      style={{ width: `${(report.failed / report.totalEntries) * 100}%` }}
                      title={`失败: ${report.failed}`}
                    />
                  )}
                  {report.missing > 0 && (
                    <div
                      className="bar-segment warning"
                      style={{ width: `${(report.missing / report.totalEntries) * 100}%` }}
                      title={`缺失: ${report.missing}`}
                    />
                  )}
                </div>
              )}
            </section>

            {/* Summary alerts */}
            {report.failed === 0 && report.missing === 0 && (
              <div className="alert success compact" style={{ marginTop: 8 }}>
                <CheckCircle size={15} />
                <span>全部通过，可以打包</span>
              </div>
            )}
            {report.missing > 0 && (
              <div className="alert warning compact" style={{ marginTop: 8 }}>
                <AlertTriangle size={15} />
                <span>{report.missing} 个条目缺少翻译结果</span>
              </div>
            )}

            {/* Filter tabs */}
            <section className="workspace-card" style={{ marginTop: 12 }}>
              <h3 className="workspace-card-title">严重性</h3>
              <div className="validate-filter-group">
                {(["all", "error", "warning"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`filter-chip ${viewMode === mode ? "active" : ""}`}
                    onClick={() => setViewMode(mode)}
                    type="button"
                  >
                    {mode === "all" ? "全部" : mode === "error" ? "错误" : "警告"}
                    <span className="chip-count">
                      {mode === "all"
                        ? allIssues.length
                        : [...report.placeholderIssues, ...report.formatIssues].filter((i) => i.severity === mode)
                            .length}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="workspace-card">
              <h3 className="workspace-card-title">问题类型</h3>
              <div className="validate-filter-group">
                {ISSUE_TYPES.map((tpe) => (
                  <button
                    key={tpe}
                    className={`filter-chip ${issueTypeFilter === tpe ? "active" : ""}`}
                    onClick={() => setIssueTypeFilter(tpe)}
                    type="button"
                  >
                    {tpe === "all"
                      ? "全部"
                      : issueTypeLabel(tpe)}
                    <span className="chip-count">
                      {tpe === "all"
                        ? [...report.placeholderIssues, ...report.formatIssues].length
                        : [...report.placeholderIssues, ...report.formatIssues].filter((i) => i.issueType === tpe)
                            .length}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Keyboard shortcut hints */}
            <section className="workspace-card" style={{ marginTop: "auto" }}>
              <h3 className="workspace-card-title">快捷键</h3>
              <div className="shortcut-list">
                <span><kbd>Enter</kbd> 开始校验</span>
                <span><kbd>R</kbd> 重试失败</span>
                <span><kbd>E</kbd> 导出 JSON</span>
                <span><kbd>Esc</kbd> 关闭详情</span>
              </div>
            </section>
          </aside>

          {/* ── Center column: Issue list ── */}
          <main className="workspace-main">
            {allIssues.length === 0 && (
              <div className="empty-state" style={{ padding: 32 }}>
                <CheckCircle size={28} />
                <p>未发现校验问题</p>
              </div>
            )}

            {allIssues.length > 0 && (
              <div className="validate-issue-list">
                {/* Batch action toolbar */}
                {selectedKeys.size > 0 && (
                  <div className="batch-toolbar">
                    <span className="batch-count">已选 {selectedKeys.size} 项</span>
                    <button
                      className="ghost-button"
                      onClick={clearSelection}
                      type="button"
                    >
                      取消选择
                    </button>
                    <button
                      className="primary-button"
                      onClick={handleBatchRetry}
                      disabled={retrying}
                      type="button"
                    >
                      {retrying ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
                      批量重试
                    </button>
                  </div>
                )}

                {Array.from(groupedIssues.entries()).map(([modId, issues]) => {
                  const isExpanded = expandedMods.has(modId);
                  const errorCount = issues.filter((i) => i.severity === "error").length;
                  const warningCount = issues.filter((i) => i.severity === "warning").length;
                  return (
                    <div key={modId} className="mod-group">
                      <button
                        className="mod-group-header"
                        onClick={() => toggleMod(modId)}
                        type="button"
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className="mod-name">{modId}</span>
                        <span className="mod-count">{issues.length} 条</span>
                        {errorCount > 0 && <span className="mod-badge error">{errorCount} 错误</span>}
                        {warningCount > 0 && <span className="mod-badge warning">{warningCount} 警告</span>}
                      </button>

                      {isExpanded && (
                        <div className="mod-group-issues">
                          {issues.map((issue, idx) => {
                            const isSelected = selectedIssue?.key === issue.key && selectedIssue?.modId === issue.modId;
                            const isChecked = selectedKeys.has(issueKey(issue));
                            return (
                              <div
                                key={`${issue.key}-${idx}`}
                                className={`issue-row-wrap ${isSelected ? "selected" : ""}`}
                              >
                                <label className="issue-checkbox" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleSelect(issue)}
                                  />
                                </label>
                                <button
                                  className="issue-row"
                                  onClick={() => handleSelectIssue(issue)}
                                  type="button"
                                >
                                  <span className="issue-type-icon">{severityIcon(issue.severity)}</span>
                                  <span className="issue-badge-type">{issueTypeLabel(issue.issueType)}</span>
                                  <code className="issue-key truncate">{issue.key}</code>
                                  <span className="issue-source truncate">{issue.sourceText || "-"}</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </main>

          {/* ── Right column: Detail panel (only when an issue is selected) ── */}
          {selectedIssue && (
            <aside className="workspace-detail">
              <div className="detail-panel">
                <div className="detail-header">
                  <h3>条目详情</h3>
                  <button
                    className="ghost-button-icon"
                    onClick={() => setSelectedIssue(null)}
                    type="button"
                    title="关闭"
                  >
                    <XCircle size={16} />
                  </button>
                </div>

                <div className="detail-meta-grid">
                  <div className="detail-meta-item">
                    <span className="detail-label">模组</span>
                    <code className="detail-value">{selectedIssue.modId}</code>
                  </div>
                  <div className="detail-meta-item">
                    <span className="detail-label">Key</span>
                    <code className="detail-value" style={{ wordBreak: "break-all" }}>{selectedIssue.key}</code>
                  </div>
                  <div className="detail-meta-item">
                    <span className="detail-label">严重性</span>
                    <span className={`severity-badge ${selectedIssue.severity}`}>
                      {severityIcon(selectedIssue.severity)}
                      {selectedIssue.severity === "error" ? "错误" : "警告"}
                    </span>
                  </div>
                  <div className="detail-meta-item">
                    <span className="detail-label">问题</span>
                    <span>{issueTypeLabel(selectedIssue.issueType)}</span>
                  </div>
                  <div className="detail-meta-item" style={{ gridColumn: "1 / -1" }}>
                    <span className="detail-label">说明</span>
                    <span>{selectedIssue.description}</span>
                  </div>
                </div>

                {/* Source vs Target comparison */}
                <div className="detail-compare-card">
                  <h4 className="detail-section-title">原文 vs 译文</h4>
                  <div className="detail-compare">
                    <div className="compare-column">
                      <div className="compare-label">原文 (Source)</div>
                      <div className="compare-text source">{selectedIssue.sourceText || "-"}</div>
                    </div>
                    <div className="compare-column">
                      <div className="compare-label">译文 (Target)</div>
                      <textarea
                        className="compare-text target edit-area"
                        value={editText}
                        onChange={(e) => handleEditChange(e.target.value)}
                        rows={4}
                      />
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="detail-actions">
                  <button
                    className="ghost-button"
                    onClick={() => setEditText(selectedIssue.targetText)}
                    type="button"
                    title="还原为原始翻译"
                  >
                    <RefreshCw size={15} />
                    还原
                  </button>
                  {report && selectedIssue && (
                    <button
                      className="primary-button"
                      onClick={() => {
                        if (report && selectedIssue) {
                          const updatedReport = { ...report };
                          for (const list of [updatedReport.placeholderIssues, updatedReport.formatIssues]) {
                            const match = list.find(
                              (i) => i.key === selectedIssue.key && i.modId === selectedIssue.modId,
                            );
                            if (match) {
                              match.targetText = editText;
                              break;
                            }
                          }
                          setReport(updatedReport);
                        }
                      }}
                      type="button"
                      disabled={editText === selectedIssue.targetText}
                    >
                      保存修正
                    </button>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

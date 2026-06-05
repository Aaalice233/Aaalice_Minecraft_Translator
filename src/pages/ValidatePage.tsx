import { AlertTriangle, CheckCircle, Loader2, PackageCheck, Search, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { loadLatestTranslationJob, validateTranslation } from "../api/tauri";
import { t } from "../i18n/translations";
import type { AppLanguage, TranslationJobState, ValidationIssue, ValidationReport } from "../types";

interface Props {
  language: AppLanguage;
  onConfirm: () => void;
}

/**
 * ValidatePage — 校验阶段
 *
 * 翻译完成后进入此页面，用户可对翻译结果执行占位符完整性检查和格式校验。
 * 校验通过后确认进入打包阶段。
 */
export function ValidatePage({ language, onConfirm }: Props) {
  const [job, setJob] = useState<TranslationJobState | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "error" | "warning">("all");

  // Load the most recent translation job on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadLatestTranslationJob()
      .then((j) => {
        if (!cancelled) setJob(j);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function handleValidate() {
    if (!job) return;
    setValidating(true);
    setError("");
    setReport(null);
    try {
      const result = await validateTranslation(job.jobId);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  const filteredIssues: ValidationIssue[] = report
    ? [
        ...report.placeholderIssues.filter(filterBySeverity),
        ...report.formatIssues.filter(filterBySeverity),
      ]
    : [];

  function filterBySeverity(i: ValidationIssue): boolean {
    if (viewMode === "all") return true;
    return i.severity === viewMode;
  }

  const severityIcon = (s: string) =>
    s === "error" ? <XCircle size={15} className="icon-error" /> :
    s === "warning" ? <AlertTriangle size={15} className="icon-warning" /> : null;

  const issueTypeLabel = (tpe: string) => {
    switch (tpe) {
      case "missing_result": return "缺失结果";
      case "empty_result": return "空结果";
      case "placeholder_missing": return "占位符丢失";
      default: return tpe;
    }
  };

  // ── Render ──────────────────────────────────────────────────────

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

  return (
    <section className="page validate-page">
      <div className="page-header">
        <div>
          <h1>{t(language, "pipeline.validate")}</h1>
          <p>检查翻译结果中的占位符完整性和格式正确性</p>
        </div>
        <div className="page-header-button">
          {report && (
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
          )}
        </div>
      </div>

      {error && (
        <div className="alert error">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}

      {!job && !loading && (
        <div className="empty-state">
          <Search size={32} />
          <p>未找到翻译任务。请先在"翻译任务"页面完成一次翻译。</p>
        </div>
      )}

      {job && !report && (
        <>
          <div className="panel" style={{ padding: "24px 18px", marginBottom: 18 }}>
            <p style={{ margin: 0 }}>
              最近翻译任务: <code>{job.jobId}</code> —
              {job.status === "completed"
                ? ` ${job.completedEntries} 条已翻译`
                : ` 状态: ${job.status}`
              }
              {job.completedAt && ` (${new Date(job.completedAt).toLocaleString()})`}
            </p>
          </div>

          <button
            className="primary-button"
            onClick={handleValidate}
            disabled={validating}
            type="button"
          >
            {validating ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
            {validating ? "校验中..." : "开始校验"}
          </button>
        </>
      )}

      {report && (
        <>
          {/* Summary stats */}
          <div className="stats-grid" style={{ marginBottom: 16 }}>
            <article className="stat-card">
              <span>总条目</span>
              <strong>{report.totalEntries}</strong>
            </article>
            <article className="stat-card success">
              <span>通过</span>
              <strong>{report.passed}</strong>
            </article>
            <article className="stat-card error">
              <span>失败</span>
              <strong>{report.failed}</strong>
            </article>
            <article className="stat-card warning">
              <span>缺失</span>
              <strong>{report.missing}</strong>
            </article>
          </div>

          {/* Summary messages */}
          {report.failed === 0 && report.missing === 0 && (
            <div className="alert success" style={{ marginBottom: 16 }}>
              <CheckCircle size={17} />
              <span>所有条目通过校验，可以进入打包阶段。</span>
            </div>
          )}

          {report.missing > 0 && (
            <div className="alert warning" style={{ marginBottom: 16 }}>
              <AlertTriangle size={17} />
              <span>
                {report.missing} 个条目缺少翻译结果。可能翻译中断或未完成，
                建议返回翻译任务页面重新执行。
              </span>
            </div>
          )}

          {/* Filter tabs */}
          <div className="filter-tabs" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {(["all", "error", "warning"] as const).map((mode) => (
              <button
                key={mode}
                className={`ghost-button ${viewMode === mode ? "active" : ""}`}
                onClick={() => setViewMode(mode)}
                type="button"
              >
                {mode === "all" ? "全部" : mode === "error" ? "错误" : "警告"}
                {mode === "all"
                  ? ` (${filteredIssues.length})`
                  : ` (${[...report.placeholderIssues, ...report.formatIssues].filter(i => i.severity === mode).length})`
                }
              </button>
            ))}
          </div>

          {/* Issues table */}
          {filteredIssues.length > 0 && (
            <section className="panel">
              <div className="panel-title">
                <h2>校验问题 ({filteredIssues.length})</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>模组</th>
                      <th>Key</th>
                      <th>来源文本</th>
                      <th>翻译文本</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.map((issue, idx) => (
                      <tr key={`${issue.key}-${idx}`}>
                        <td>
                          <span className="issue-type-badge">
                            {severityIcon(issue.severity)}
                            {issueTypeLabel(issue.issueType)}
                          </span>
                        </td>
                        <td className="truncate" style={{ maxWidth: 120 }}>{issue.modId}</td>
                        <td className="truncate" style={{ maxWidth: 200 }} title={issue.key}>
                          <code>{issue.key}</code>
                        </td>
                        <td className="truncate" style={{ maxWidth: 250 }} title={issue.sourceText}>
                          {issue.sourceText || "-"}
                        </td>
                        <td className="truncate" style={{ maxWidth: 250 }} title={issue.targetText}>
                          {issue.targetText || "-"}
                        </td>
                        <td>{issue.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {filteredIssues.length === 0 && (
            <div className="alert success">
              <CheckCircle size={17} />
              <span>未发现校验问题。</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

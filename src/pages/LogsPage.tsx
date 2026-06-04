import { t } from "../i18n/translations";
import type { AppLanguage, ScanSummary } from "../types";

export function LogsPage({
  scanSummary,
  language,
}: {
  scanSummary: ScanSummary | null;
  language: AppLanguage;
}) {
  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>{t(language, "logs.title")}</h1>
          <p>{t(language, "logs.subtitle")}</p>
        </div>
      </div>
      <section className="panel">
        <h2>{t(language, "logs.recentJob")}</h2>
        {scanSummary ? (
          <div className="log-summary">
            <span>{t(language, "logs.jobId", { id: scanSummary.jobId })}</span>
            <span>{t(language, "logs.instance", { path: scanSummary.instancePath })}</span>
            <span>{t(language, "logs.warning", { count: scanSummary.warnings.length })}</span>
          </div>
        ) : (
          <div className="empty-state compact">{t(language, "logs.empty")}</div>
        )}
      </section>
    </section>
  );
}

import { t } from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";
import type { AppLanguage } from "../types";

const titleKeys = {
  jobs: "nav.jobs",
  dictionary: "nav.dictionary",
  packages: "nav.packages",
  ftb: "nav.ftb",
  hardcoded: "nav.hardcoded",
} satisfies Record<string, TranslationKey>;

export function PlaceholderPage({
  pageKey,
  language,
}: {
  pageKey: string;
  language: AppLanguage;
}) {
  const titleKey = titleKeys[pageKey as keyof typeof titleKeys] ?? "placeholder.disabled";
  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>{t(language, titleKey)}</h1>
          <p>{t(language, "placeholder.subtitle")}</p>
        </div>
        <span className="badge muted">{t(language, "placeholder.disabled")}</span>
      </div>
      <div className="empty-state">{t(language, "placeholder.empty")}</div>
    </section>
  );
}

import {
  BookOpen,
  Boxes,
  FileText,
  HardHat,
  Home,
  ListChecks,
  PackageCheck,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardPage } from "../pages/DashboardPage";
import { LogsPage } from "../pages/LogsPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { SettingsPage } from "../pages/SettingsPage";
import type { ScanSummary, Settings } from "../types";
import { getSettings } from "../api/tauri";
import { localeByAppLanguage, normalizeAppLanguage, t } from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";

type PageKey =
  | "dashboard"
  | "jobs"
  | "dictionary"
  | "packages"
  | "ftb"
  | "hardcoded"
  | "settings"
  | "logs";

const navItems = [
  { key: "dashboard", labelKey: "nav.dashboard", icon: Home },
  { key: "jobs", labelKey: "nav.jobs", icon: FileText },
  { key: "dictionary", labelKey: "nav.dictionary", icon: BookOpen },
  { key: "packages", labelKey: "nav.packages", icon: Boxes },
  { key: "ftb", labelKey: "nav.ftb", icon: ListChecks },
  { key: "hardcoded", labelKey: "nav.hardcoded", icon: HardHat },
  { key: "settings", labelKey: "nav.settings", icon: SettingsIcon },
  { key: "logs", labelKey: "nav.logs", icon: PackageCheck },
] as const satisfies ReadonlyArray<{ key: PageKey; labelKey: TranslationKey; icon: LucideIcon }>;

export function App() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const language = normalizeAppLanguage(settings?.appLanguage);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  const content = useMemo(() => {
    if (!settings) {
      return <div className="empty-state">{loadError || t(language, "app.loadingSettings")}</div>;
    }

    if (activePage === "dashboard") {
      return (
        <DashboardPage
          settings={settings}
          onSettingsChange={setSettings}
          scanSummary={scanSummary}
          onScanSummaryChange={setScanSummary}
          language={language}
        />
      );
    }
    if (activePage === "settings") {
      return <SettingsPage settings={settings} onSettingsChange={setSettings} />;
    }
    if (activePage === "logs") {
      return <LogsPage scanSummary={scanSummary} language={language} />;
    }

    return <PlaceholderPage pageKey={activePage} language={language} />;
  }, [activePage, language, loadError, scanSummary, settings]);

  return (
    <div className="app-shell" lang={localeByAppLanguage[language]}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>Aaalice</strong>
            <span>MC Translator</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={item.key === activePage ? "nav-item active" : "nav-item"}
                key={item.key}
                onClick={() => setActivePage(item.key)}
                type="button"
              >
                <Icon size={18} />
                <span>{t(language, item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <span>v0.1.0</span>
          <span className="status-dot">{t(language, "app.ready")}</span>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <span className="topbar-label">{t(language, "app.currentInstance")}</span>
            <strong>{settings?.instancePath || t(language, "app.noInstance")}</strong>
          </div>
          <span className="topbar-status">{t(language, "app.phase")}</span>
        </div>
        {content}
      </main>
    </div>
  );
}

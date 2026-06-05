import {
  BookOpen,
  Boxes,
  FileText,
  HardHat,
  Home,
  ListChecks,
  PackageCheck,
  ScanLine,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardPage } from "../pages/DashboardPage";
import { DictionaryPage } from "../pages/DictionaryPage";
import { JobsPage } from "../pages/JobsPage";
import { LogsPage } from "../pages/LogsPage";
import { PackagesPage } from "../pages/PackagesPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ValidatePage } from "../pages/ValidatePage";
import { PipelineBreadcrumb } from "../components/PipelineBreadcrumb";
import { usePipeline } from "./usePipeline";
import type { ScanSummary, Settings } from "../types";
import type { PipelineStage } from "../types";
import { getSettings } from "../api/tauri";
import { localeByAppLanguage, normalizeAppLanguage, t } from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";
import { STAGE_TO_PAGE } from "../types";

/** 页面到流水线阶段的反向映射，非流水线页面返回 undefined */
const PAGE_TO_STAGE: Partial<Record<PageKey, PipelineStage>> = {
  dashboard: "scan",
  jobs: "translate",
  validate: "validate",
  packages: "pack",
};

type PageKey =
  | "dashboard"
  | "jobs"
  | "validate"
  | "dictionary"
  | "packages"
  | "ftb"
  | "hardcoded"
  | "settings"
  | "logs";

const DISABLED_NAV: ReadonlySet<PageKey> = new Set(["ftb", "hardcoded"] as const);

const navItems = [
  { key: "dashboard", labelKey: "nav.dashboard", icon: ScanLine },
  { key: "jobs", labelKey: "nav.jobs", icon: FileText },
  { key: "validate", labelKey: "nav.validate", icon: PackageCheck },
  { key: "packages", labelKey: "nav.packages", icon: Boxes },
  { key: "ftb", labelKey: "nav.ftb", icon: ListChecks },
  { key: "hardcoded", labelKey: "nav.hardcoded", icon: HardHat },
  { key: "dictionary", labelKey: "nav.dictionary", icon: BookOpen },
  { key: "settings", labelKey: "nav.settings", icon: SettingsIcon },
  { key: "logs", labelKey: "nav.logs", icon: Home },
] as const satisfies ReadonlyArray<{ key: PageKey; labelKey: TranslationKey; icon: LucideIcon }>;

export function App() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const language = normalizeAppLanguage(settings?.appLanguage);

  const {
    currentStage,
    stageStatuses,
    nextStage,
    advanceStage,
    resetPipeline,
  } = usePipeline();

  // 面包屑高亮跟随当前页面：用户在哪个页面就高亮对应阶段
  const activeStage = PAGE_TO_STAGE[activePage] ?? currentStage;

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  // ── 扫描完成处理 ────────────────────────────────
  // 不自动推进阶段，用户通过"下一阶段"按钮手动控制
  // 这里仅跟踪最新 scanSummary 供"下一阶段"按钮做守卫检查

  const handleStageNavigate = (stage: import("../types").PipelineStage) => {
    const page = STAGE_TO_PAGE[stage];
    if (page) {
      setActivePage(page as PageKey);
    }
  };

  /** 下一阶段按钮点击处理 */
  const handleNextStage = () => {
    if (!nextStage) return;

    // 基本守卫：扫描阶段必须有扫描结果
    if (currentStage === "scan" && !scanSummary) return;

    advanceStage();
    setActivePage(STAGE_TO_PAGE[nextStage] as PageKey);
  };

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
          onScanStart={() => {
            if (currentStage !== "scan") resetPipeline();
          }}
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
    if (activePage === "dictionary") {
      return <DictionaryPage language={language} />;
    }
    if (activePage === "jobs") {
      return (
        <JobsPage
          language={language}
          scanSummary={scanSummary}
          onScanSummaryChange={setScanSummary}
          settings={settings}
        />
      );
    }
    if (activePage === "validate") {
      return (
        <ValidatePage
          language={language}
          onConfirm={() => {
            advanceStage();
            setActivePage("packages");
          }}
        />
      );
    }
    if (activePage === "packages") {
      return <PackagesPage language={language} scanSummary={scanSummary} settings={settings} />;
    }

    return <PlaceholderPage pageKey={activePage} language={language} />;
  }, [activePage, language, loadError, scanSummary, settings, advanceStage, currentStage, resetPipeline]);

  // ── 语言对显示 ──────────────────────────────────
  const langPairLabel = useMemo(() => {
    if (!settings) return "";
    const source =
      scanSummary && settings.sourceLanguage === "auto"
        ? scanSummary.sourceLanguage
        : settings.sourceLanguage;
    const target = scanSummary?.targetLanguage ?? settings.targetLanguage;
    return t(language, "pipeline.langPair", { source, target });
  }, [language, settings, scanSummary]);

  return (
    <div className="app-shell" lang={localeByAppLanguage[language]}>
      <aside className="sidebar">
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item${item.key === activePage ? " active" : ""}${DISABLED_NAV.has(item.key) ? " disabled" : ""}`}
                key={item.key}
                disabled={DISABLED_NAV.has(item.key)}
                onClick={() => setActivePage(item.key)}
                type="button"
                data-tooltip={item.key === activePage ? t(language, "tooltip.currentPage") : t(language, "tooltip.nav", { page: t(language, item.labelKey) })}
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
          <div className="topbar-info">
            <span className="topbar-info-path">
              {settings?.instancePath || t(language, "app.noInstance")}
            </span>
            {settings && (
              <span className="topbar-info-langpair">{langPairLabel}</span>
            )}
          </div>

          <PipelineBreadcrumb
            currentStage={activeStage}
            stageStatuses={stageStatuses}
            onNavigate={handleStageNavigate}
            language={language}
          />

          <button
            className={`next-stage-button${currentStage === "pack" ? " final" : ""}`}
            disabled={!nextStage || activeStage === nextStage || (currentStage === "scan" && !scanSummary)}
            onClick={handleNextStage}
            type="button"
            data-tooltip={t(language, "tooltip.nextStage")}
          >
            {currentStage === "pack"
              ? t(language, "pipeline.pack")
              : nextStage
                ? `${t(language, "pipeline.nextStage")}: ${t(language, `pipeline.${nextStage}` as const)}`
                : t(language, "pipeline.nextStage")}
          </button>
        </div>
        {content}
      </main>
    </div>
  );
}

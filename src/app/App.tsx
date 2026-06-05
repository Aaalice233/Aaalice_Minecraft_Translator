import {
  BookOpen,
  Boxes,
  CheckCircle,
  FileText,
  HardHat,
  Home,
  ListChecks,
  Loader2,
  PackageCheck,
  ScanLine,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardPage } from "../pages/DashboardPage";
import { DictionaryPage } from "../pages/DictionaryPage";
import { JobsPage } from "../pages/JobsPage";
import { LogsPage } from "../pages/LogsPage";
import { PackagesPage } from "../pages/PackagesPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ValidatePage } from "../pages/ValidatePage";
import { getSettings } from "../api/tauri";
import { AppProvider, useAppState } from "./AppContext";
import { localeByAppLanguage, normalizeAppLanguage, t } from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";

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
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

function AppShell() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [loadError, setLoadError] = useState("");
  const { state, dispatch } = useAppState();
  const { settings, scanSummary, navStates } = state;
  const language = normalizeAppLanguage(settings?.appLanguage);

  useEffect(() => {
    getSettings()
      .then((s) => dispatch({ type: "SET_SETTINGS", payload: s }))
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, [dispatch]);

  // 智能 tooltip 方向：当元素靠近视口上边缘时自动向下弹出
  useEffect(() => {
    const TOOLTIP_TOP_THRESHOLD = 60;
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < TOOLTIP_TOP_THRESHOLD) {
        el.setAttribute("data-tooltip-direction", "down");
      } else {
        el.removeAttribute("data-tooltip-direction");
      }
    };
    document.addEventListener("mouseover", handler);
    return () => document.removeEventListener("mouseover", handler);
  }, []);

  // 页面栈：记录已懒加载过的页面
  const [mountedPages, setMountedPages] = useState<Set<PageKey>>(() => new Set(["dashboard"]));
  const prevPageRef = useRef(activePage);

  // 当 activePage 变化时，标记该页已挂载
  useEffect(() => {
    if (activePage !== prevPageRef.current) {
      prevPageRef.current = activePage;
      setMountedPages((prev) => {
        if (prev.has(activePage)) return prev;
        const next = new Set(prev);
        next.add(activePage);
        return next;
      });
    }
  }, [activePage]);

  // Stable per-page callbacks — created once, never cause extra re-renders
  const dbBusy = useCallback((b: boolean) => dispatch({ type: "SET_NAV_STATE", payload: { key: "dashboard", status: b ? "busy" : "idle" } }), [dispatch]);
  const dbCompleted = useCallback((c: boolean) => dispatch({ type: "SET_NAV_STATE", payload: { key: "dashboard", status: c ? "completed" : "idle" } }), [dispatch]);
  const jobsBusy = useCallback((b: boolean) => dispatch({ type: "SET_NAV_STATE", payload: { key: "jobs", status: b ? "busy" : "idle" } }), [dispatch]);
  const jobsCompleted = useCallback((c: boolean) => dispatch({ type: "SET_NAV_STATE", payload: { key: "jobs", status: c ? "completed" : "idle" } }), [dispatch]);
  const packsBusy = useCallback((b: boolean) => dispatch({ type: "SET_NAV_STATE", payload: { key: "packages", status: b ? "busy" : "idle" } }), [dispatch]);

  /** 渲染页面实例（懒加载：仅在首次访问时挂载） */
  const renderPage = useCallback(
    (page: PageKey) => {
      if (!mountedPages.has(page)) return null;
      const isActive = activePage === page;

      if (page === "dashboard") {
        return <DashboardPage settings={settings!} onSettingsChange={(s) => dispatch({ type: "SET_SETTINGS", payload: s })} scanSummary={scanSummary} onScanSummaryChange={(s) => dispatch({ type: "SET_SCAN_SUMMARY", payload: s })} language={language} onBusyChange={dbBusy} onCompleteChange={dbCompleted} />;
      }
      if (page === "settings") {
        return <SettingsPage settings={settings!} onSettingsChange={(s) => dispatch({ type: "SET_SETTINGS", payload: s })} />;
      }
      if (page === "logs") {
        return <LogsPage scanSummary={scanSummary} language={language} />;
      }
      if (page === "dictionary") {
        return <DictionaryPage language={language} />;
      }
      if (page === "jobs") {
        return <JobsPage language={language} scanSummary={scanSummary} onScanSummaryChange={(s) => dispatch({ type: "SET_SCAN_SUMMARY", payload: s })} settings={settings!} onBusyChange={jobsBusy} onCompleteChange={jobsCompleted} />;
      }
      if (page === "validate") {
        return <ValidatePage language={language} onConfirm={() => setActivePage("packages")} />;
      }
      if (page === "packages") {
        return <PackagesPage language={language} scanSummary={scanSummary} settings={settings!} onBusyChange={packsBusy} />;
      }
      return <PlaceholderPage pageKey={page} language={language} />;
    },
    [activePage, language, scanSummary, settings, mountedPages, dbBusy, dbCompleted, jobsBusy, packsBusy],
  );

  // 加载完成前显示 loading
  const isLoading = !settings;

  return (
    <div className="app-shell" lang={localeByAppLanguage[language]}>
      <aside className="sidebar">
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const navStatus = navStates[item.key] ?? "idle";
            const isBusy = navStatus === "busy";
            const isCompleted = navStatus === "completed";
            return (
              <button
                className={`nav-item${item.key === activePage ? " active" : ""}${isBusy ? " busy" : ""}${isCompleted ? " completed" : ""}${DISABLED_NAV.has(item.key) ? " disabled" : ""}`}
                key={item.key}
                disabled={DISABLED_NAV.has(item.key)}
                onClick={() => setActivePage(item.key)}
                type="button"
                data-tooltip={isBusy ? t(language, "tooltip.busy", { page: t(language, item.labelKey) }) : isCompleted ? t(language, "tooltip.completed", { page: t(language, item.labelKey) }) : item.key === activePage ? t(language, "tooltip.currentPage") : t(language, "tooltip.nav", { page: t(language, item.labelKey) })}
              >
                {isBusy ? <Loader2 size={18} className="spin nav-icon-busy" /> : isCompleted ? <CheckCircle size={18} className="nav-icon-completed" /> : <Icon size={18} />}
                <span>{t(language, item.labelKey)}</span>
                {isBusy && <span className="nav-busy-dot" />}
                {isCompleted && <span className="nav-completed-mark" />}
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
        {isLoading ? (
          <div className="empty-state">{loadError || t(language, "app.loadingSettings")}</div>
        ) : (
          <div className="page-stack">
            {(["dashboard", "settings", "logs", "dictionary", "jobs", "validate", "packages", "ftb", "hardcoded"] as PageKey[]).map((page) => (
              <div
                key={page}
                className={`page-layer${activePage === page ? " active" : ""}`}
              >
                {renderPage(page)}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

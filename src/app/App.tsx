import {
  BookOpen,
  Boxes,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
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
import { applyFont, SettingsPage } from "../pages/SettingsPage";
import { ValidatePage } from "../pages/ValidatePage";
import { getSettings } from "../api/tauri";
import { AppProvider, useAppState } from "./AppContext";
import { useAppStore } from "../stores/appStore";
import { localeByAppLanguage, normalizeAppLanguage, t } from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";
import type { ScanSummary, Settings } from "../types";

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

interface NavItem {
  key: PageKey;
  labelKey: TranslationKey;
  icon: LucideIcon;
  disabled?: boolean;
}

const DEFAULT_SIDEBAR_WIDTH = 232;
const COLLAPSED_SIDEBAR_WIDTH = 54;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;

const navItems: NavItem[] = [
  { key: "dashboard", labelKey: "nav.dashboard", icon: ScanLine },
  { key: "jobs", labelKey: "nav.jobs", icon: FileText },
  { key: "validate", labelKey: "nav.validate", icon: PackageCheck },
  { key: "packages", labelKey: "nav.packages", icon: Boxes },
  { key: "ftb", labelKey: "nav.ftb", icon: ListChecks, disabled: true },
  { key: "hardcoded", labelKey: "nav.hardcoded", icon: HardHat, disabled: true },
  { key: "dictionary", labelKey: "nav.dictionary", icon: BookOpen },
  { key: "settings", labelKey: "nav.settings", icon: SettingsIcon },
  { key: "logs", labelKey: "nav.logs", icon: Home },
];

const ALL_PAGE_KEYS: PageKey[] = [
  "dashboard", "settings", "logs", "dictionary",
  "jobs", "validate", "packages", "ftb", "hardcoded",
];

export function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

function AppShell() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [exitingPage, setExitingPage] = useState<PageKey | null>(null);
  const [loadError, setLoadError] = useState("");
  const { state, dispatch } = useAppState();
  // Zustand store (runs alongside AppContext during migration)
  const store = useAppStore();
  const { settings, scanSummary, navStates } = state;
  const language = normalizeAppLanguage(settings?.appLanguage);

  // Sync AppContext → Zustand store on state changes
  // This allows pages to gradually migrate to direct store access.
  const syncedDispatch: typeof dispatch = (action) => {
    dispatch(action);
    // Mirror to Zustand store
    switch (action.type) {
      case "SET_SETTINGS":
        store.setSettings(action.payload);
        break;
      case "SET_SCAN_SUMMARY":
        store.setScanSummary(action.payload);
        break;
      case "SET_NAV_STATE":
        store.setNavState(action.payload.key, action.payload.status);
        break;
      case "SET_TRANSLATION_STATUS":
        store.setTranslationStatus(action.payload.status, action.payload.result, action.payload.error);
        break;
      case "SET_TRANSLATION_JOB_ID":
        store.setTranslationJobId(action.payload);
        break;
      case "SET_PACKAGES_JOB_ID":
        store.setPackagesJobId(action.payload);
        break;
    }
  };

  useEffect(() => {
    getSettings()
      .then((s) => syncedDispatch({ type: "SET_SETTINGS", payload: s }))
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, [dispatch]);

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

  const [mountedPages, setMountedPages] = useState<Set<PageKey>>(() => new Set(["dashboard"]));

  useEffect(() => {
    setMountedPages((prev) => {
      if (prev.has(activePage)) return prev;
      const next = new Set(prev);
      next.add(activePage);
      return next;
    });
  }, [activePage]);

  // 退出动画清理：动画结束后移除 exiting 状态
  useEffect(() => {
    if (!exitingPage) return;
    const timer = setTimeout(() => setExitingPage(null), 150);
    return () => clearTimeout(timer);
  }, [exitingPage]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const prevWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);

  const toggleSidebar = useCallback(() => {
    if (sidebarCollapsed) {
      setSidebarWidth(prevWidthRef.current);
    } else {
      prevWidthRef.current = sidebarWidth;
      setSidebarWidth(COLLAPSED_SIDEBAR_WIDTH);
    }
    setSidebarCollapsed((prev) => !prev);
  }, [sidebarCollapsed, sidebarWidth]);

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidebarWidth };
    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const w = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, dragRef.current.startW + (ev.clientX - dragRef.current.startX)));
      setSidebarWidth(w);
    };
    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [sidebarWidth]);

  const setNavBusy = useCallback((key: PageKey, busy: boolean) =>
    syncedDispatch({ type: "SET_NAV_STATE", payload: { key, status: busy ? "busy" : "idle" } }), [syncedDispatch]);
  const setNavCompleted = useCallback((key: PageKey, done: boolean) =>
    syncedDispatch({ type: "SET_NAV_STATE", payload: { key, status: done ? "completed" : "idle" } }), [syncedDispatch]);
  const dbBusy = useCallback((b: boolean) => setNavBusy("dashboard", b), [setNavBusy]);
  const dbCompleted = useCallback((c: boolean) => setNavCompleted("dashboard", c), [setNavCompleted]);
  const jobsBusy = useCallback((b: boolean) => setNavBusy("jobs", b), [setNavBusy]);
  const jobsCompleted = useCallback((c: boolean) => setNavCompleted("jobs", c), [setNavCompleted]);
  const packsBusy = useCallback((b: boolean) => setNavBusy("packages", b), [setNavBusy]);
  const handleSettingsChange = useCallback(
    (s: Settings) => syncedDispatch({ type: "SET_SETTINGS", payload: s }),
    [syncedDispatch],
  );
  const handleScanSummaryChange = useCallback(
    (s: ScanSummary | null) => syncedDispatch({ type: "SET_SCAN_SUMMARY", payload: s }),
    [syncedDispatch],
  );

  const renderPage = useCallback(
    (page: PageKey) => {
      if (!mountedPages.has(page)) return null;
      const isActive = activePage === page;

      if (page === "dashboard") {
        return <DashboardPage settings={settings!} onSettingsChange={handleSettingsChange} scanSummary={scanSummary} onScanSummaryChange={handleScanSummaryChange} language={language} onBusyChange={dbBusy} onCompleteChange={dbCompleted} />;
      }
      if (page === "settings") {
        return <SettingsPage settings={settings!} onSettingsChange={handleSettingsChange} />;
      }
      if (page === "logs") {
        return <LogsPage scanSummary={scanSummary} language={language} />;
      }
      if (page === "dictionary") {
        return <DictionaryPage language={language} />;
      }
      if (page === "jobs") {
        return <JobsPage isActive={isActive} language={language} scanSummary={scanSummary} onScanSummaryChange={handleScanSummaryChange} settings={settings!} onBusyChange={jobsBusy} onCompleteChange={jobsCompleted} />;
      }
      if (page === "validate") {
        return <ValidatePage language={language} onConfirm={() => setActivePage("packages")} />;
      }
      if (page === "packages") {
        return <PackagesPage language={language} scanSummary={scanSummary} settings={settings!} onBusyChange={packsBusy} />;
      }
      return <PlaceholderPage pageKey={page} language={language} />;
    },
    [activePage, language, scanSummary, settings, mountedPages, dbBusy, dbCompleted, jobsBusy, jobsCompleted, packsBusy],
  );

  useEffect(() => {
    if (settings?.uiTheme) {
      document.documentElement.dataset.theme = settings.uiTheme;
    }
    if (settings?.uiFont) {
      applyFont(settings.uiFont);
    }
  }, [settings?.uiTheme, settings?.uiFont]);

  const isLoading = !settings;

  return (
    <div className="app-shell" lang={localeByAppLanguage[language]} style={{ '--sidebar-width': sidebarWidth + 'px' } as React.CSSProperties}>
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        {!sidebarCollapsed && <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />}
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const navStatus = navStates[item.key] ?? "idle";
            const isBusy = navStatus === "busy";
            const isCompleted = navStatus === "completed";
            const isActive = item.key === activePage;

            let className = "nav-item";
            if (isActive) className += " active";
            if (isBusy) className += " busy";
            if (isCompleted) className += " completed";
            if (item.disabled) className += " disabled";

            let tooltip: string;
            if (isBusy) {
              tooltip = t(language, "tooltip.busy", { page: t(language, item.labelKey) });
            } else if (isCompleted) {
              tooltip = t(language, "tooltip.completed", { page: t(language, item.labelKey) });
            } else if (isActive) {
              tooltip = t(language, "tooltip.currentPage");
            } else {
              tooltip = t(language, "tooltip.nav", { page: t(language, item.labelKey) });
            }

            let navIcon;
            if (isBusy) {
              navIcon = <Loader2 size={18} className="spin nav-icon-busy" />;
            } else if (isCompleted) {
              navIcon = <CheckCircle size={18} className="nav-icon-completed" />;
            } else {
              navIcon = <Icon size={18} />;
            }

            return (
              <button
                className={className}
                key={item.key}
                disabled={item.disabled}
                onClick={() => {
                  setExitingPage(activePage);
                  setActivePage(item.key);
                }}
                type="button"
                data-tooltip={sidebarCollapsed ? t(language, item.labelKey) : tooltip}
              >
                {navIcon}
                <span>{t(language, item.labelKey)}</span>
                {isBusy && <span className="nav-busy-dot" />}
                {isCompleted && <span className="nav-completed-mark" />}
              </button>
            );
          })}
          <button className="sidebar-toggle" onClick={toggleSidebar} type="button" data-tooltip={sidebarCollapsed ? t(language, "nav.expand") : t(language, "nav.collapse")}>
            {sidebarCollapsed ? <ChevronRight size={14} strokeWidth={2.5} /> : <ChevronLeft size={14} strokeWidth={2.5} />}
            <span className="toggle-label">{t(language, sidebarCollapsed ? "nav.expand" : "nav.collapse")}</span>
          </button>
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
            {ALL_PAGE_KEYS.map((page) => (
              <div
                key={page}
                className={`page-layer${activePage === page ? " active" : ""}${exitingPage === page ? " exiting" : ""}`}
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

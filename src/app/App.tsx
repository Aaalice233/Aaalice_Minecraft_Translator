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
  Moon,
  PackageCheck,
  ScanLine,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardPage } from "../pages/DashboardPage";
import { DictionaryPage } from "../pages/DictionaryPage";
import { JobsPage } from "../pages/JobsPage";
import { LogsPage } from "../pages/LogsPage";
import { PackagesPage } from "../pages/PackagesPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { SplashScreen } from "../components/SplashScreen";
import { applyFont, SettingsPage } from "../pages/SettingsPage";
import { ValidatePage } from "../pages/ValidatePage";
import { getSettings, runWarmup, saveSettings } from "../api/tauri";
import { AppProvider, useAppState } from "./AppContext";
import { useAppStore } from "../stores/appStore";
import { localeByAppLanguage, normalizeAppLanguage, t } from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";
import type { ScanSummary, Settings, WarmupProgress } from "../types";

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
  const { state, dispatch } = useAppState();
  const { settings, scanSummary, navStates } = state;
  const language = normalizeAppLanguage(settings?.appLanguage);

  // ── Splash / Warmup state ──
  const [splashDone, setSplashDone] = useState(false);
  const [warmupProgress, setWarmupProgress] = useState<WarmupProgress | null>(null);
  const [warmupComplete, setWarmupComplete] = useState(false);
  const [fatalWarmupError, setFatalWarmupError] = useState<string | undefined>();
  const [isOffline, setIsOffline] = useState(false);
  let isFirstLaunch = false;
  try {
    isFirstLaunch = !localStorage.getItem("aaalice_mc_warmup_done");
  } catch {
    // localStorage inaccessible
  }

  // ── Combined warmup: register listener first, then start warmup ──
  // This eliminates the race where Rust emits events before the frontend
  // listener is registered.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        // Step 1: Register event listener BEFORE starting warmup
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<WarmupProgress>("warmup-progress", (event) => {
          if (cancelled) return;
          const p = event.payload;
          setWarmupProgress(p);

          if (p.phase === "completed" && p.status === "completed") {
            setWarmupComplete(true);
          }

          // Detect offline mode: LLM phase completed with an error but app can still run
          if (
            p.phase === "llm" &&
            p.status === "completed" &&
            p.error
          ) {
            setIsOffline(true);
          }

          // Detect fatal configuration error
          if (p.phase === "settings" && p.status === "failed" && p.error) {
            setFatalWarmupError(p.error);
          }
        });

        // Step 2: Now safe to start warmup — listener is already registered
        await runWarmup();
      } catch {
        if (cancelled) return;
        // Non-Tauri environment (browser preview) or early warmup failure
        // — let the splash screen proceed so the user isn't stuck
        setWarmupComplete(true);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Mark warmup done in local storage after first completed warmup
  useEffect(() => {
    if (warmupComplete) {
      try {
        localStorage.setItem("aaalice_mc_warmup_done", "1");
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [warmupComplete]);

  // Sync AppContext → Zustand store on state changes
  const syncedDispatch = useCallback<typeof dispatch>((action) => {
    dispatch(action);
    const s = useAppStore.getState();
    switch (action.type) {
      case "SET_SETTINGS": s.setSettings(action.payload); break;
      case "SET_SCAN_SUMMARY": s.setScanSummary(action.payload); break;
      case "SET_NAV_STATE": s.setNavState(action.payload.key, action.payload.status); break;
      case "SET_TRANSLATION_STATUS": s.setTranslationStatus(action.payload.status, action.payload.result, action.payload.error); break;
      case "SET_TRANSLATION_JOB_ID": s.setTranslationJobId(action.payload); break;
      case "SET_PACKAGES_JOB_ID": s.setPackagesJobId(action.payload); break;
    }
  }, [dispatch]);

  useEffect(() => {
    getSettings()
      .then((s) => syncedDispatch({ type: "SET_SETTINGS", payload: s }))
      .catch((error) => console.warn("getSettings 失败:", error));
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

  // 挂载新页面（立即生效）
  useEffect(() => {
    setMountedPages((prev) => {
      if (prev.has(activePage)) return prev;
      const next = new Set(prev);
      next.add(activePage);
      return next;
    });
  }, [activePage]);

  // 退出动画完成后卸载旧页面（释放 DOM 和 React 内存）
  useEffect(() => {
    if (!exitingPage) return;
    const timer = setTimeout(() => {
      setMountedPages((prev) => {
        if (!prev.has(exitingPage)) return prev;
        const next = new Set(prev);
        next.delete(exitingPage);
        return next;
      });
      setExitingPage(null);
    }, 150); // 与 CSS transition 持续时间匹配
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
  const toggleDarkMode = useCallback(() => {
    if (!settings) return;
    const next = !settings.uiDarkMode;
    const updated: Settings = { ...settings, uiDarkMode: next };
    document.documentElement.dataset.theme = next ? "dark" : "light";
    syncedDispatch({ type: "SET_SETTINGS", payload: updated });
    saveSettings(updated).catch((err) => console.warn("saveSettings 失败:", err));
  }, [settings, syncedDispatch]);

  const packsBusy = useCallback((b: boolean) => setNavBusy("packages", b), [setNavBusy]);
  const handleSettingsChange = useCallback(
    (s: Settings) => syncedDispatch({ type: "SET_SETTINGS", payload: s }),
    [syncedDispatch],
  );
  const handleScanSummaryChange = useCallback(
    (s: ScanSummary | null) => syncedDispatch({ type: "SET_SCAN_SUMMARY", payload: s }),
    [syncedDispatch],
  );

  function renderPage(page: PageKey) {
    if (!mountedPages.has(page)) return null;

    switch (page) {
      case "dashboard":
        return <DashboardPage settings={settings!} onSettingsChange={handleSettingsChange} scanSummary={scanSummary} onScanSummaryChange={handleScanSummaryChange} language={language} onBusyChange={dbBusy} onCompleteChange={dbCompleted} />;
      case "settings":
        return <SettingsPage settings={settings!} onSettingsChange={handleSettingsChange} />;
      case "logs":
        return <LogsPage scanSummary={scanSummary} language={language} />;
      case "dictionary":
        return <DictionaryPage language={language} />;
      case "jobs":
        return <JobsPage isActive={activePage === page} language={language} scanSummary={scanSummary} onScanSummaryChange={handleScanSummaryChange} settings={settings!} onBusyChange={jobsBusy} onCompleteChange={jobsCompleted} />;
      case "validate":
        return <ValidatePage language={language} onConfirm={() => setActivePage("packages")} />;
      case "packages":
        return <PackagesPage language={language} scanSummary={scanSummary} settings={settings!} onBusyChange={packsBusy} />;
      default:
        return <PlaceholderPage pageKey={page} language={language} />;
    }
  }

  useEffect(() => {
    const accent = settings?.uiTheme === "default" ? "green" : (settings?.uiTheme || "green");
    if (accent === "green") {
      document.documentElement.dataset.accent = "green";
    } else {
      document.documentElement.dataset.accent = accent;
    }
    document.documentElement.dataset.theme = settings?.uiDarkMode ? "dark" : "light";
    if (settings?.uiFont) {
      applyFont(settings.uiFont);
    }
  }, [settings?.uiTheme, settings?.uiDarkMode, settings?.uiFont]);

  return (
    <div className="app-root">
      {!splashDone && (
        <SplashScreen
          onFinish={() => setSplashDone(true)}
          fatalError={fatalWarmupError}
          offline={isOffline}
          isFirstLaunch={isFirstLaunch}
          warmupComplete={warmupComplete}
          progress={warmupProgress}
        />
      )}
      <div
       className="app-shell"
       lang={localeByAppLanguage[language]}
       style={{
         '--sidebar-width': sidebarWidth + 'px',
         opacity: splashDone ? 1 : 0,
         transition: 'opacity 300ms ease-out',
       } as React.CSSProperties}
      >
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        {!sidebarCollapsed && <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />}
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const navStatus = navStates[item.key] ?? "idle";
            const isBusy = navStatus === "busy";
            const isCompleted = navStatus === "completed";
            const isActive = item.key === activePage;

            let className = [
              "nav-item",
              isActive && "active",
              isBusy && "busy",
              isCompleted && "completed",
              item.disabled && "disabled",
            ].filter(Boolean).join(" ");

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
          <div className="sidebar-footer-left">
            <button
              className="dark-toggle-btn"
              onClick={toggleDarkMode}
              type="button"
              data-tooltip={settings?.uiDarkMode ? t(language, "settings.uiDarkModeOff") : t(language, "settings.uiDarkModeOn")}
              data-tooltip-direction="down"
            >
              {settings?.uiDarkMode ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <span>v0.1.0</span>
          </div>
          <span className="status-dot">{t(language, "app.ready")}</span>
        </div>
      </aside>

      <main className="main">
        {settings ? (
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
        ) : null}
      </main>
    </div>
    </div>
  );
}

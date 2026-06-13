import {
  BookOpen,
  Boxes,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  FileText,
  Home,
  Loader2,
  Moon,
  ScanLine,
  Settings as SettingsIcon,
  Square,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardPage, type DashboardPageHandle } from "../pages/DashboardPage";
import { DictionaryPage } from "../pages/DictionaryPage";
import { JobsPage, type JobsPageHandle } from "../pages/JobsPage";
import { LogsPage } from "../pages/LogsPage";
import { PackagesPage, type PackagesPageHandle } from "../pages/PackagesPage";
import { SplashScreen } from "../components/SplashScreen";
import { applyFont, SettingsPage } from "../pages/SettingsPage";
import { ValidatePage, type ValidatePageHandle } from "../pages/ValidatePage";
import { getAppVersion, getSettings, runWarmup, saveSettings } from "../api/tauri";
import { AppProvider, useAppState } from "./AppContext";
import { localeByAppLanguage, normalizeAppLanguage, t } from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";
import type { ScanSummary, Settings, WarmupProgress } from "../types";
import type { PageKey } from "../stores/appStore";
import { useAppStore } from "../stores/appStore";

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
  { key: "validate", labelKey: "nav.validate", icon: FileSearch },
  { key: "packages", labelKey: "nav.packages", icon: Boxes },
  { key: "dictionary", labelKey: "nav.dictionary", icon: BookOpen },
  { key: "settings", labelKey: "nav.settings", icon: SettingsIcon },
  { key: "logs", labelKey: "nav.logs", icon: Home },
];

const ALL_PAGE_KEYS: PageKey[] = [
  "dashboard", "settings", "logs", "dictionary",
  "jobs", "validate", "packages",
];

type AutoFlowPhase =
  | "idle"
  | "scanning"
  | "translating"
  | "retrying"
  | "reviewing"
  | "packing"
  | "done"
  | "failed"
  | "cancelled";

interface AutoFlowState {
  active: boolean;
  phase: AutoFlowPhase;
  status: string;
  stopping: boolean;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

function AppShell() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const { state, dispatch } = useAppState();
  const { settings, scanSummary, navStates } = state;
  const language = normalizeAppLanguage(settings?.appLanguage);
  const dashboardRef = useRef<DashboardPageHandle>(null);
  const jobsRef = useRef<JobsPageHandle>(null);
  const validateRef = useRef<ValidatePageHandle>(null);
  const packagesRef = useRef<PackagesPageHandle>(null);
  const autoCancelRequestedRef = useRef(false);
  const autoClearTimerRef = useRef<number | null>(null);
  const [autoMode, setAutoMode] = useState(() => {
    try {
      return localStorage.getItem("aaalice_auto_mode") === "1";
    } catch {
      return false;
    }
  });
  const [autoFlow, setAutoFlow] = useState<AutoFlowState>({
    active: false,
    phase: "idle",
    status: "",
    stopping: false,
  });
  const isAutoFlowVisible = autoFlow.phase !== "idle";
  const isAutoLocked = autoFlow.active;

  // ── Splash / Warmup state ──
  const [splashDone, setSplashDone] = useState(false);
  const [warmupProgress, setWarmupProgress] = useState<WarmupProgress | null>(null);
  const [warmupComplete, setWarmupComplete] = useState(false);
  const [fatalWarmupError, setFatalWarmupError] = useState<string | undefined>();
  const [isOffline, setIsOffline] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  let isFirstLaunch = false;
  try {
    isFirstLaunch = !localStorage.getItem("aaalice_mc_warmup_done");
  } catch {
    // localStorage inaccessible
  }

  // Register listener before starting warmup to eliminate the race
  // where Rust emits events before the frontend listener is registered.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<WarmupProgress>("warmup-progress", (event) => {
          if (cancelled) return;
          const p = event.payload;
          setWarmupProgress(p);

          if (p.phase === "completed" && p.status === "completed") {
            setWarmupComplete(true);
          }

          if (p.phase === "llm" && p.status === "completed" && p.error) {
            setIsOffline(true);
          }

          if (p.phase === "settings" && p.status === "failed" && p.error) {
            setFatalWarmupError(p.error);
          }
        });

        await runWarmup();
      } catch {
        if (cancelled) return;
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

  useEffect(() => {
    getSettings()
      .then((s) => dispatch({ type: "SET_SETTINGS", payload: s }))
      .catch((error) => console.warn("getSettings failed:", error));
  }, [dispatch]);

  useEffect(() => () => {
    if (autoClearTimerRef.current !== null) {
      window.clearTimeout(autoClearTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAppVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch((error) => {
        console.warn("getAppVersion failed:", error);
        if (!cancelled) setAppVersion("?");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const TOOLTIP_TOP_THRESHOLD = 60;
    const TOOLTIP_EDGE_THRESHOLD = 300; // half of max tooltip width
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;

      // Top/bottom edge
      if (rect.top < TOOLTIP_TOP_THRESHOLD) {
        el.setAttribute("data-tooltip-direction", "down");
      } else {
        el.removeAttribute("data-tooltip-direction");
      }

      // Left/right edge: keep tooltip within window bounds
      if (centerX < TOOLTIP_EDGE_THRESHOLD) {
        el.setAttribute("data-tooltip-align", "left");
      } else if (window.innerWidth - centerX < TOOLTIP_EDGE_THRESHOLD) {
        el.setAttribute("data-tooltip-align", "right");
      } else {
        el.removeAttribute("data-tooltip-align");
      }
    };
    document.addEventListener("mouseover", handler);
    return () => document.removeEventListener("mouseover", handler);
  }, []);

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
    dispatch({ type: "SET_NAV_STATE", payload: { key, status: busy ? "busy" : "idle" } }), [dispatch]);
  const setNavCompleted = useCallback((key: PageKey, done: boolean) =>
    dispatch({ type: "SET_NAV_STATE", payload: { key, status: done ? "completed" : "idle" } }), [dispatch]);
  const dbBusy = useCallback((b: boolean) => setNavBusy("dashboard", b), [setNavBusy]);
  const dbCompleted = useCallback((c: boolean) => setNavCompleted("dashboard", c), [setNavCompleted]);
  const jobsBusy = useCallback((b: boolean) => setNavBusy("jobs", b), [setNavBusy]);
  const jobsCompleted = useCallback((c: boolean) => setNavCompleted("jobs", c), [setNavCompleted]);
  const validateCompleted = useCallback((c: boolean) => setNavCompleted("validate", c), [setNavCompleted]);
  const packsBusy = useCallback((b: boolean) => setNavBusy("packages", b), [setNavBusy]);
  const packsCompleted = useCallback((c: boolean) => setNavCompleted("packages", c), [setNavCompleted]);

  const animatingRef = useRef(false);
  const toggleDarkMode = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (animatingRef.current || !settings) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    document.documentElement.style.setProperty('--click-x', x + 'px');
    document.documentElement.style.setProperty('--click-y', y + 'px');

    const next = !settings.uiDarkMode;
    const updated: Settings = { ...settings, uiDarkMode: next };

    animatingRef.current = true;
    document.documentElement.dataset.vtMode = next ? 'expand' : 'shrink';

    const setTheme = () => { document.documentElement.dataset.theme = next ? "dark" : "light"; };

    try {
      const vt = (document as any).startViewTransition?.(setTheme);
      if (vt) {
        await vt.finished;
      } else {
        setTheme();
      }
    } catch {
      // Transition skipped or failed — state update still needed
    }

    requestAnimationFrame(() => {
      document.documentElement.removeAttribute('data-vt-mode');
      animatingRef.current = false;
      dispatch({ type: "SET_SETTINGS", payload: updated });
      saveSettings(updated).catch((err) => console.warn("saveSettings failed:", err));
    });
  }, [settings, dispatch]);

  const handleSettingsChange = useCallback(
    (s: Settings) => dispatch({ type: "SET_SETTINGS", payload: s }),
    [dispatch],
  );
  const handleScanSummaryChange = useCallback(
    (s: ScanSummary | null) => dispatch({ type: "SET_SCAN_SUMMARY", payload: s }),
    [dispatch],
  );

  const updateAutoMode = useCallback((enabled: boolean) => {
    setAutoMode(enabled);
    try {
      localStorage.setItem("aaalice_auto_mode", enabled ? "1" : "0");
    } catch {
      // localStorage 只影响开关记忆，不影响当前会话。
    }
  }, []);

  const clearAutoTimer = useCallback(() => {
    if (autoClearTimerRef.current !== null) {
      window.clearTimeout(autoClearTimerRef.current);
      autoClearTimerRef.current = null;
    }
  }, []);

  const showAutoStage = useCallback((phase: AutoFlowPhase, status: string) => {
    clearAutoTimer();
    setAutoFlow({ active: true, phase, status, stopping: false });
  }, [clearAutoTimer]);

  const finishAutoFlow = useCallback((phase: "done" | "failed" | "cancelled", status: string) => {
    clearAutoTimer();
    setAutoFlow({ active: false, phase, status, stopping: false });
    autoClearTimerRef.current = window.setTimeout(() => {
      setAutoFlow((current) => current.phase === phase
        ? { active: false, phase: "idle", status: "", stopping: false }
        : current);
      autoClearTimerRef.current = null;
    }, phase === "done" ? 5000 : 7000);
  }, [clearAutoTimer]);

  const ensureAutoNotCancelled = useCallback(() => {
    if (autoCancelRequestedRef.current) {
      throw new Error(t(language, "auto.status.cancelled"));
    }
  }, [language]);

  const handleAutoScanStart = useCallback(() => {
    autoCancelRequestedRef.current = false;
    showAutoStage("scanning", t(language, "auto.status.scanning"));
    setActivePage("dashboard");
  }, [language, showAutoStage]);

  const handleAutoScanCancelled = useCallback(() => {
    autoCancelRequestedRef.current = false;
    finishAutoFlow("cancelled", t(language, "auto.status.cancelled"));
  }, [finishAutoFlow, language]);

  const handleAutoScanFailed = useCallback((message: string) => {
    autoCancelRequestedRef.current = false;
    finishAutoFlow("failed", `${t(language, "auto.status.failed")}：${message}`);
  }, [finishAutoFlow, language]);

  const runAutoFlowAfterScan = useCallback(async (summary: ScanSummary, currentSettings: Settings) => {
    if (!autoMode || summary.cancelled) return;
    if (!currentSettings.apiKey.trim()) {
      finishAutoFlow("failed", t(language, "app.apiKeyMissing"));
      return;
    }

    try {
      ensureAutoNotCancelled();
      setActivePage("jobs");
      showAutoStage("translating", t(language, "auto.status.translating"));
      await delay(250);
      const job = await jobsRef.current?.runAutoTranslation(
        Math.max(0, currentSettings.autoRetryCount ?? 0),
        (attempt, total) => {
          showAutoStage("retrying", t(language, "auto.status.retrying", { attempt, total }));
        },
      );
      if (!job) throw new Error(t(language, "auto.error.noJob"));

      ensureAutoNotCancelled();
      setActivePage("validate");
      showAutoStage("reviewing", t(language, "auto.status.reviewing"));
      await delay(450);
      await validateRef.current?.runAutoReview();

      ensureAutoNotCancelled();
      setActivePage("packages");
      showAutoStage("packing", t(language, "auto.status.packing"));
      await delay(450);
      await packagesRef.current?.runAutoPack();

      ensureAutoNotCancelled();
      autoCancelRequestedRef.current = false;
      finishAutoFlow("done", t(language, "auto.status.done"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const wasCancelled = autoCancelRequestedRef.current || message === t(language, "auto.status.cancelled");
      autoCancelRequestedRef.current = false;
      finishAutoFlow(
        wasCancelled ? "cancelled" : "failed",
        wasCancelled ? t(language, "auto.status.cancelled") : `${t(language, "auto.status.failed")}：${message}`,
      );
    }
  }, [autoMode, ensureAutoNotCancelled, finishAutoFlow, language, showAutoStage]);

  const requestStopAutoFlow = useCallback(async () => {
    if (!autoFlow.active || autoFlow.stopping) return;
    autoCancelRequestedRef.current = true;
    setAutoFlow((current) => current.active
      ? { ...current, stopping: true, status: t(language, "auto.action.stopping") }
      : current);

    try {
      if (autoFlow.phase === "scanning") {
        await dashboardRef.current?.cancelScan();
      } else if (autoFlow.phase === "translating" || autoFlow.phase === "retrying") {
        await jobsRef.current?.cancelActiveTask();
      }
    } catch (err) {
      console.warn("auto flow stop failed:", err);
    }
  }, [autoFlow.active, autoFlow.phase, autoFlow.stopping, language]);

  function renderPage(page: PageKey) {
    switch (page) {
      case "dashboard":
        return (
          <DashboardPage
            ref={dashboardRef}
            settings={settings!}
            onSettingsChange={handleSettingsChange}
            scanSummary={scanSummary}
            onScanSummaryChange={handleScanSummaryChange}
            language={language}
            onBusyChange={dbBusy}
            onCompleteChange={dbCompleted}
            autoMode={autoMode}
            autoLocked={isAutoLocked}
            onAutoModeChange={updateAutoMode}
            onAutoScanStart={handleAutoScanStart}
            onAutoScanComplete={runAutoFlowAfterScan}
            onAutoScanCancelled={handleAutoScanCancelled}
            onAutoScanFailed={handleAutoScanFailed}
          />
        );
      case "settings":
        return <SettingsPage settings={settings!} onSettingsChange={handleSettingsChange} />;
      case "logs":
        return <LogsPage language={language} />;
      case "dictionary":
        return <DictionaryPage language={language} />;
      case "jobs":
        return <JobsPage ref={jobsRef} isActive={activePage === page} language={language} scanSummary={scanSummary} onScanSummaryChange={handleScanSummaryChange} settings={settings!} onBusyChange={jobsBusy} onCompleteChange={jobsCompleted} autoLocked={isAutoLocked} />;
      case "validate":
        return <ValidatePage ref={validateRef} language={language} autoLocked={isAutoLocked} onReviewComplete={() => { setActivePage("packages"); validateCompleted(true); useAppStore.getState().setReviewCount(useAppStore.getState().reviewCount + 1); }} />;
      case "packages":
        return <PackagesPage ref={packagesRef} language={language} scanSummary={scanSummary} settings={settings!} onBusyChange={packsBusy} onPackComplete={packsCompleted} autoLocked={isAutoLocked} />;
      default:
        const _exhaustive: never = page;
        return _exhaustive;
    }
  }

  useEffect(() => {
    document.documentElement.dataset.accent = settings?.uiTheme === "default" ? "green" : (settings?.uiTheme || "green");
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
          language={language}
        />
      )}
      <div
       className={`app-shell${isAutoLocked ? " auto-flow-running" : ""}`}
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
                disabled={item.disabled || isAutoLocked}
                onClick={() => {
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
          <button
            className="dark-toggle-btn"
            onClick={(e) => toggleDarkMode(e)}
            type="button"
            data-tooltip={settings?.uiDarkMode ? t(language, "settings.uiDarkModeOff") : t(language, "settings.uiDarkModeOn")}
            data-tooltip-direction="down"
          >
            {settings?.uiDarkMode ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <span>{appVersion ? `v${appVersion}` : "v..."}</span>
          <span className="status-dot" data-tooltip={t(language, "app.ready")} data-tooltip-direction="up">{t(language, "app.ready")}</span>
        </div>
      </aside>

      <main className="main">
        {isAutoFlowVisible && (
          <div className={`auto-flow-banner auto-flow-banner-${autoFlow.phase}`}>
            <div className="auto-flow-banner-main">
              {autoFlow.active ? <Loader2 size={16} className="spin" /> : <CheckCircle size={16} />}
              <span>{autoFlow.status}</span>
            </div>
            {autoFlow.active && (
              <button
                type="button"
                className="auto-flow-stop-button"
                onClick={requestStopAutoFlow}
                disabled={autoFlow.stopping}
              >
                <span className="auto-flow-stop-icon" aria-hidden="true">
                  {autoFlow.stopping ? <Loader2 size={14} className="spin" /> : <Square size={13} />}
                </span>
                <span>{t(language, autoFlow.stopping ? "auto.action.stopping" : "auto.action.stop")}</span>
              </button>
            )}
          </div>
        )}
        {settings && !settings.apiKey.trim() && (
          <div className="api-key-banner">
            <span>{t(language, "app.apiKeyMissing")}</span>
            <button type="button" className="text-button" onClick={() => setActivePage("settings")} disabled={isAutoLocked}>
              {t(language, "app.openApiSettings")}
            </button>
          </div>
        )}
        {settings ? (
          <div className="page-stack">
          {ALL_PAGE_KEYS.map((page) => (
              <div
                key={page}
                className={`page-layer${activePage === page ? " active" : ""}`}
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

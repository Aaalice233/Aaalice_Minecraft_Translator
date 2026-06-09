import { createContext, useContext, useCallback, type Dispatch, type ReactNode } from "react";
import type { PageNavStatus, ScanSummary, Settings } from "../types";
import { useAppStore } from "../stores/appStore";
import type { PageKey, TranslationPageStatus } from "../stores/appStore";

// Unified dispatch action that maps to Zustand store actions.
type AppAction =
  | { type: "SET_SETTINGS"; payload: Settings }
  | { type: "SET_SCAN_SUMMARY"; payload: ScanSummary | null }
  | { type: "SET_NAV_STATE"; payload: { key: PageKey; status: PageNavStatus } }
  | { type: "SET_TRANSLATION_STATUS"; payload: { status: TranslationPageStatus; result?: number | null; error?: string } }
  | { type: "SET_TRANSLATION_JOB_ID"; payload: string | null }
  | { type: "SET_PACKAGES_JOB_ID"; payload: string | null };

interface AppContextState {
  settings: Settings | null;
  scanSummary: ScanSummary | null;
  navStates: Partial<Record<PageKey, PageNavStatus>>;
  translationJobId: string | null;
  translationStatus: TranslationPageStatus;
  translationResult: number | null;
  translationError: string;
  packagesJobId: string | null;
}

function dispatchToStore(action: AppAction) {
  const s = useAppStore.getState();
  switch (action.type) {
    case "SET_SETTINGS":
      s.setSettings(action.payload);
      break;
    case "SET_SCAN_SUMMARY":
      s.setScanSummary(action.payload);
      break;
    case "SET_NAV_STATE":
      s.setNavState(action.payload.key, action.payload.status);
      break;
    case "SET_TRANSLATION_STATUS":
      s.setTranslationStatus(action.payload.status, action.payload.result, action.payload.error);
      break;
    case "SET_TRANSLATION_JOB_ID":
      s.setTranslationJobId(action.payload);
      break;
    case "SET_PACKAGES_JOB_ID":
      s.setPackagesJobId(action.payload);
      break;
  }
}

export type AppDispatch = Dispatch<AppAction>;

const AppContext = createContext<{
  state: AppContextState;
  dispatch: AppDispatch;
} | null>(null);

function useStoreSnapshot() {
  const settings = useAppStore((s) => s.settings);
  const scanSummary = useAppStore((s) => s.scanSummary);
  const navStates = useAppStore((s) => s.navStates);
  const translationJobId = useAppStore((s) => s.translationJobId);
  const translationStatus = useAppStore((s) => s.translationStatus);
  const translationResult = useAppStore((s) => s.translationResult);
  const translationError = useAppStore((s) => s.translationError);
  const packagesJobId = useAppStore((s) => s.packagesJobId);

  return {
    settings,
    scanSummary,
    navStates,
    translationJobId,
    translationStatus,
    translationResult,
    translationError,
    packagesJobId,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const state = useStoreSnapshot();
  const dispatch = useCallback((action: AppAction) => {
    dispatchToStore(action);
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

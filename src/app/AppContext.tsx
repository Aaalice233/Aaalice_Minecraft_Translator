import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import type { PageNavStatus, ScanSummary, Settings } from "../types";

type PageKey =
  | "dashboard" | "jobs" | "validate" | "dictionary"
  | "packages" | "ftb" | "hardcoded" | "settings" | "logs";

export type TranslationPageStatus = "idle" | "running" | "completed" | "canceled" | "failed";

interface AppState {
  settings: Settings | null;
  scanSummary: ScanSummary | null;
  navStates: Partial<Record<PageKey, PageNavStatus>>;
  // Translation state persistence (M7)
  translationJobId: string | null;
  translationStatus: TranslationPageStatus;
  translationResult: number | null;
  translationError: string;
  // Packages page selected job (P10)
  packagesJobId: string | null;
}

type AppAction =
  | { type: "SET_SETTINGS"; payload: Settings }
  | { type: "SET_SCAN_SUMMARY"; payload: ScanSummary }
  | { type: "SET_NAV_STATE"; payload: { key: PageKey; status: PageNavStatus } }
  | { type: "SET_TRANSLATION_STATUS"; payload: { status: TranslationPageStatus; result?: number | null; error?: string } }
  | { type: "SET_TRANSLATION_JOB_ID"; payload: string | null }
  | { type: "SET_PACKAGES_JOB_ID"; payload: string | null };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SETTINGS":
      return { ...state, settings: action.payload };
    case "SET_SCAN_SUMMARY":
      return { ...state, scanSummary: action.payload };
    case "SET_NAV_STATE": {
      const { key, status } = action.payload;
      if (state.navStates[key] === status) return state;
      if (status === "idle" && state.navStates[key] === "completed") return state;
      return { ...state, navStates: { ...state.navStates, [key]: status } };
    }
    case "SET_TRANSLATION_STATUS": {
      const { status, result, error } = action.payload;
      return {
        ...state,
        translationStatus: status,
        translationResult: result !== undefined ? result : state.translationResult,
        translationError: error !== undefined ? error : state.translationError,
      };
    }
    case "SET_TRANSLATION_JOB_ID":
      return { ...state, translationJobId: action.payload };
    case "SET_PACKAGES_JOB_ID":
      return { ...state, packagesJobId: action.payload };
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, {
    settings: null,
    scanSummary: null,
    navStates: {},
    translationJobId: null,
    translationStatus: "idle",
    translationResult: null,
    translationError: "",
    packagesJobId: null,
  });
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

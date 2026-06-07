/**
 * Application-wide state store (Zustand).
 *
 * ⚠️ TYPE SYNC: Data types shared between frontend (types.ts) and backend
 * (models.rs) must be kept in sync. When adding a new field to a Rust model
 * that's serialized to the frontend, add the corresponding field in types.ts.
 * See comments in types.ts and src-tauri/src/core/models.rs.
 *
 *
 * Replaces the previous AppContext + useReducer pattern with a single
 * Zustand store for better performance (no unnecessary re-renders via
 * Context), simpler selectors, and easier integration with async flows.
 *
 * Migration strategy (incremental):
 * 1. Create this store with the same shape as AppContext state
 * 2. Wire it into App.tsx alongside the old AppContext
 * 3. Migrate pages one-by-one to use the store directly
 * 4. Remove AppContext once all consumers are migrated
 */
import { create } from "zustand";
import type { PageNavStatus, ScanSummary, Settings } from "../types";

export type PageKey =
  | "dashboard" | "jobs" | "validate" | "dictionary"
  | "packages" | "ftb" | "hardcoded" | "settings" | "logs";

export type TranslationPageStatus = "idle" | "running" | "completed" | "canceled" | "failed";

interface AppState {
  // — Persistent state —
  settings: Settings | null;
  scanSummary: ScanSummary | null;
  navStates: Partial<Record<PageKey, PageNavStatus>>;

  // — Translation job state (M7) —
  translationJobId: string | null;
  translationStatus: TranslationPageStatus;
  translationResult: number | null;
  translationError: string;

  // — Packages page selected job (P10) —
  packagesJobId: string | null;

  // — Actions —
  setSettings: (s: Settings) => void;
  setScanSummary: (s: ScanSummary | null) => void;
  setNavState: (key: PageKey, status: PageNavStatus) => void;
  setTranslationStatus: (status: TranslationPageStatus, result?: number | null, error?: string) => void;
  setTranslationJobId: (id: string | null) => void;
  setPackagesJobId: (id: string | null) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  // Initial state
  settings: null,
  scanSummary: null,
  navStates: {},
  translationJobId: null,
  translationStatus: "idle",
  translationResult: null,
  translationError: "",
  packagesJobId: null,

  // Actions
  setSettings: (s) => set({ settings: s }),

  setScanSummary: (s) => set({ scanSummary: s }),

  setNavState: (key, status) =>
    set((state) => {
      // Skip redundant updates
      if (state.navStates[key] === status) return state;
      // Once completed, don't revert to idle
      if (status === "idle" && state.navStates[key] === "completed") return state;
      return { navStates: { ...state.navStates, [key]: status } };
    }),

  setTranslationStatus: (status, result, error) =>
    set((state) => ({
      translationStatus: status,
      translationResult: result !== undefined ? result : state.translationResult,
      translationError: error !== undefined ? error : state.translationError,
    })),

  setTranslationJobId: (id) => set({ translationJobId: id }),

  setPackagesJobId: (id) => set({ packagesJobId: id }),
}));

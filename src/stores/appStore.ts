/**
 * Application-wide state store (Zustand).
 *
 * ⚠️ TYPE SYNC: Data types shared between frontend (types.ts) and backend
 * (models.rs) must be kept in sync. See comments in types.ts and models.rs.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PageNavStatus, ScanSummary, Settings } from "../types";

export type PageKey =
  | "dashboard" | "jobs" | "validate" | "dictionary"
  | "packages" | "settings" | "logs";

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

  // — Elapsed time for completion summaries —
  scanElapsedMs: number | null;
  translateElapsedMs: number | null;

  // — Actions —
  setSettings: (s: Settings) => void;
  setScanSummary: (s: ScanSummary | null) => void;
  setNavState: (key: PageKey, status: PageNavStatus) => void;
  setTranslationStatus: (status: TranslationPageStatus, result?: number | null, error?: string) => void;
  setTranslationJobId: (id: string | null) => void;
  setPackagesJobId: (id: string | null) => void;
  setScanElapsedMs: (ms: number | null) => void;
  setTranslateElapsedMs: (ms: number | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      settings: null,
      scanSummary: null,
      navStates: {},
      translationJobId: null,
      translationStatus: "idle",
      translationResult: null,
      translationError: "",
      packagesJobId: null,
      scanElapsedMs: null,
      translateElapsedMs: null,

      // Actions
      setSettings: (s) => set({ settings: s }),
      setScanSummary: (s) => set({ scanSummary: s }),

      setNavState: (key, status) =>
        set((state) => {
          if (state.navStates[key] === status) return state;
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
      setScanElapsedMs: (ms) => set({ scanElapsedMs: ms }),
      setTranslateElapsedMs: (ms) => set({ translateElapsedMs: ms }),
    }),
    {
      name: "app-store",
      // Only persist elapsed time values (transient data survives restarts)
      partialize: (state) => ({
        scanElapsedMs: state.scanElapsedMs,
        translateElapsedMs: state.translateElapsedMs,
      }),
    },
  ),
);

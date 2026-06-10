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

  // — Elapsed time for completion summaries —
  scanElapsedMs: number | null;
  translateElapsedMs: number | null;

  // — Review coordination (version counter for cross-page sync) —
  reviewCount: number;

  // — Actions —
  setSettings: (s: Settings) => void;
  setScanSummary: (s: ScanSummary | null) => void;
  setNavState: (key: PageKey, status: PageNavStatus) => void;
  setTranslationStatus: (status: TranslationPageStatus, result?: number | null, error?: string) => void;
  setTranslationJobId: (id: string | null) => void;
  setReviewCount: (c: number) => void;
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
      scanElapsedMs: null,
      translateElapsedMs: null,
      reviewCount: 0,

      // Actions
      setSettings: (s) => set({ settings: s }),
      setScanSummary: (s) => set({ scanSummary: s }),
      setReviewCount: (c) => set({ reviewCount: c }),

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
      setScanElapsedMs: (ms) => set({ scanElapsedMs: ms }),
      setTranslateElapsedMs: (ms) => set({ translateElapsedMs: ms }),
    }),
    {
      name: "app-store",
      // Persist elapsed time counters only (跨重启保留扫描/翻译耗时）。
      // 不持久化 translationJobId——该 ID 应在每次启动时重新获取，
      // 否则 ValidatePage 等页面在启动时读到旧 ID 将自动加载历史翻译结果。
      partialize: (state) => ({
        scanElapsedMs: state.scanElapsedMs,
        translateElapsedMs: state.translateElapsedMs,
      }),
    },
  ),
);

import { useEffect, useRef, useState, useCallback } from "react";
import { cancelWarmup } from "../api/tauri";
import type { WarmupPhase, WarmupProgress } from "../types";

// ── Constants ──────────────────────────────────────────────────────────

const SPLASH_MIN_MS = 3000;
const LETTER_REVEAL_MS = 60;
const BRAND_NAME = "Aaalice";
const SUBTITLE = "Minecraft Translator";
const ICON_SIZE = 48;

const PHASE_LABELS: Record<string, string> = {
  settings: "设置",
  local: "本地",
  dictionary: "词典",
  llm: "LLM",
};

const PHASE_ORDER: WarmupPhase[] = ["settings", "local", "dictionary", "llm"];

interface SplashScreenProps {
  /** Called when the splash sequence is complete and ready to transition to main UI. */
  onFinish: () => void;
  /** Error message if warmup failed fatally (user can force-skip). */
  fatalError?: string;
  /** Whether we're in offline mode (LLM unreachable). */
  offline?: boolean;
  /** Whether this is the very first app launch. */
  isFirstLaunch?: boolean;
  /** Is warmup complete (from event). */
  warmupComplete?: boolean;
  /** Current warmup progress from Rust events. */
  progress?: WarmupProgress | null;
}

// ── Diamond-book SVG icon ──────────────────────────────────────────────

function DiamondBookIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="splash-icon-svg"
    >
      {/* Diamond shape */}
      <polygon
        points="24,2 46,24 24,46 2,24"
        fill="var(--accent)"
        opacity="0.15"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      {/* Inner diamond */}
      <polygon
        points="24,8 40,24 24,40 8,24"
        fill="var(--accent)"
        opacity="0.08"
        stroke="var(--accent)"
        strokeWidth="1"
      />
      {/* Open book in center */}
      <path
        d="M15 20 L15 32 L24 28 L33 32 L33 20 L24 16 Z"
        fill="var(--accent)"
        opacity="0.85"
      />
      {/* Book spine line */}
      <line
        x1="24" y1="16" x2="24" y2="28"
        stroke="var(--bg-surface, #fff)"
        strokeWidth="0.8"
      />
      {/* Page line left */}
      <line
        x1="18" y1="20" x2="18" y2="29"
        stroke="var(--bg-surface, #fff)"
        strokeWidth="0.4"
        opacity="0.5"
      />
      {/* Page line right */}
      <line
        x1="30" y1="20" x2="30" y2="29"
        stroke="var(--bg-surface, #fff)"
        strokeWidth="0.4"
        opacity="0.5"
      />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function SplashScreen({
  onFinish,
  fatalError,
  offline,
  isFirstLaunch,
  warmupComplete,
  progress,
}: SplashScreenProps) {
  const [phase, setPhase] = useState<SplashPhase>("init");
  const [showSplash, setShowSplash] = useState(true);
  const [curPercent, setCurPercent] = useState(0);
  const [curPhase, setCurPhase] = useState<WarmupPhase | null>(null);
  const [phaseStatuses, setPhaseStatuses] = useState<
    Record<string, "running" | "completed" | "failed">
  >({});

  const startTimeRef = useRef(Date.now());
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Track warmup progress events ──
  useEffect(() => {
    if (!progress) return;

    setCurPercent(progress.percent);
    setCurPhase(progress.phase);

    if (progress.phase !== "completed") {
      setPhaseStatuses((prev) => ({
        ...prev,
        [progress.phase]: progress.status,
      }));
    }
  }, [progress]);

  // When warmup completes, handle the minimum display time and transition
  useEffect(() => {
    if (!warmupComplete && !fatalError) return;

    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);

    transitionTimerRef.current = setTimeout(() => {
      // Start fade-out
      setShowSplash(false);

      // After fade out, trigger main fade in
      setTimeout(() => {
        onFinish();
      }, 400); // fade-out duration
    }, remaining);

    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    };
  }, [warmupComplete, fatalError, onFinish]);

  // ── Brand name letter reveal logic ──
  useEffect(() => {
    const timer = setTimeout(() => setPhase("brand"), 500); // after icon float-up
    return () => clearTimeout(timer);
  }, []);

  // ── Phase label helpers ──
  const getPhaseLabel = (phaseKey: WarmupPhase): string =>
    PHASE_LABELS[phaseKey] ?? phaseKey;

  function getPhaseIcon(phaseKey: WarmupPhase): string {
    const status = phaseStatuses[phaseKey];
    if (status === "completed") return "\u2713";
    if (status === "failed") return "\u26A0";
    if (phaseKey === curPhase && status === "running") return "\u27F3";
    return "";
  }

  const hasAnimationStarted = phase !== "init";

  // ── Error fallback button ──
  const handleForceSkip = useCallback(() => {
    // Cancel background warmup on Rust side
    cancelWarmup().catch(() => {});
    // Clear any pending warmup-completion transition timer
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    setShowSplash(false);
    setTimeout(() => {
      onFinish();
    }, 400);
  }, [onFinish]);

  // ── Render ──
  return (
      <div
        className={`splash-overlay${showSplash ? " visible" : " fading-out"}`}
      >
        <div className="splash-content">
          {/* Icon */}
          <div className="splash-icon-wrapper">
            <DiamondBookIcon size={ICON_SIZE} />
          </div>

          {/* Brand name with letter reveal */}
          <h1 className="splash-brand">
            {BRAND_NAME.split("").map((letter, i) => (
              <span
                key={i}
                className="splash-letter"
                style={{
                  opacity: 0,
                  animation:
                    hasAnimationStarted
                      ? `splashLetterReveal 60ms ease-out ${500 + i * LETTER_REVEAL_MS}ms forwards`
                      : undefined,
                }}
              >
                {letter}
              </span>
            ))}
          </h1>

          {/* Subtitle */}
          <p
            className="splash-subtitle"
            style={{
              opacity: 0,
              animation:
                hasAnimationStarted
                  ? "splashFadeIn 200ms ease-out forwards"
                  : undefined,
              animationDelay: `${500 + BRAND_NAME.length * LETTER_REVEAL_MS + 100}ms`,
            }}
          >
            {SUBTITLE}
          </p>

          {/* Scan line */}
          <div className="splash-scanline" />

          {/* Progress bar + phase steps */}
          <div className="splash-progress-section">
            <div className="splash-progress-track">
              <div
                className="splash-progress-fill"
                style={{ width: `${curPercent}%` }}
              />
            </div>

            <div className="splash-phase-steps">
              {PHASE_ORDER.map((phaseKey) => (
                <div
                  key={phaseKey}
                  className={`splash-phase-step${
                    phaseKey === curPhase && phaseStatuses[phaseKey] === "running"
                      ? " active"
                      : phaseStatuses[phaseKey] === "completed"
                        ? " done"
                        : phaseStatuses[phaseKey] === "failed"
                          ? " failed"
                          : ""
                  }`}
                >
                  <span className="splash-phase-icon">
                    {getPhaseIcon(phaseKey)}
                  </span>
                  <span className="splash-phase-label">
                    {getPhaseLabel(phaseKey)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Status messages */}
          {progress?.message && !fatalError && (
            <p className="splash-status">{progress.message}</p>
          )}

          {/* Offline indicator */}
          {offline && !fatalError && (
            <p className="splash-offline-indicator">离线模式</p>
          )}

          {/* First launch hint */}
          {isFirstLaunch && !warmupComplete && (
            <p className="splash-first-launch-hint">
              首次启动，正在初始化…
            </p>
          )}

          {/* Fatal error with skip button */}
          {fatalError && (
            <div className="splash-error">
              <p className="splash-error-msg">{fatalError}</p>
              <button
                className="splash-skip-btn"
                onClick={handleForceSkip}
                type="button"
              >
                跳过，直接进入
              </button>
            </div>
          )}
        </div>
      </div>
  );
}

type SplashPhase = "init" | "brand" | "subtitle" | "progress";

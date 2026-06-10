import { Check, ChevronLeft, ChevronRight, ClipboardCopy, CornerDownLeft, Sparkles, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AppLanguage } from "../types";
import { t } from "../i18n/translations";

// ── Types ──────────────────────────────────────────────────

/** Unified entry type shared by ValidatePage and DictionaryPage adapters */
export interface EditPanelEntry {
  navKey: string;
  key: string;
  sourceText: string;
  targetText: string;
  modId: string;
  modName?: string;
  sourceType: string;
  id?: number;
  translationKey?: string;
}

export interface TranslationEditPanelProps {
  entries: EditPanelEntry[];
  initialKey: string;
  onSave: (entry: EditPanelEntry, newText: string) => Promise<void>;
  onClose: () => void;
  onLlmTranslate?: (entry: EditPanelEntry) => Promise<string>;
  pageType: "validate" | "dictionary";
  language: AppLanguage;
}

// ── Component ───────────────────────────────────────────────

export function TranslationEditPanel({
  entries,
  initialKey,
  onSave,
  onClose,
  onLlmTranslate,
  pageType,
  language,
}: TranslationEditPanelProps) {
  // ── State ──
  const [currentKey, setCurrentKey] = useState(initialKey);
  const [editText, setEditText] = useState("");
  const [llmSuggestion, setLlmSuggestion] = useState<{
    text: string;
    loading: boolean;
    error: string | null;
  }>({ text: "", loading: false, error: null });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [animState, setAnimState] = useState<"opening" | "open" | "closing">("opening");

  // Refs for focus trapping and stable callback access
  const panelRef = useRef<HTMLDivElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleCloseRef = useRef<() => Promise<void>>(async () => {});
  const handlePrevRef = useRef<() => Promise<void>>(async () => {});
  const handleNextRef = useRef<() => Promise<void>>(async () => {});

  // ── Derived ──
  const currentIndex = useMemo(
    () => entries.findIndex((e) => e.navKey === currentKey),
    [entries, currentKey],
  );
  const currentEntry = currentIndex >= 0 ? entries[currentIndex] : null;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < entries.length - 1;
  const isDirty = useMemo(
    () => currentEntry != null && editText !== currentEntry.targetText,
    [currentEntry, editText],
  );

  // Open animation: mount → immediately trigger open state
  useEffect(() => {
    requestAnimationFrame(() => {
      setAnimState("open");
    });
    // Lock body scroll while the panel is open
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Reset state when navigating to a new entry
  useEffect(() => {
    if (currentEntry) {
      setEditText(currentEntry.targetText);
    }
    setLlmSuggestion({ text: "", loading: false, error: null });
    setSaved(false);
    setSaveError(null);
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea when content changes
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.max(80, ta.scrollHeight)}px`;
    }
  }, [editText]);

  // ── Auto-save current edit before navigation ──
  const saveCurrent = useCallback(async () => {
    if (!currentEntry || !isDirty) return;
    try {
      await onSave(currentEntry, editText);
      setSaved(true);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      throw err; // re-throw so caller knows save failed
    }
  }, [currentEntry, isDirty, editText, onSave]);

  // ── Handlers ──
  const handlePrev = useCallback(async () => {
    if (!canGoPrev) return;
    if (isDirty) {
      try { await saveCurrent(); } catch { return; }
    }
    const prevEntry = entries[currentIndex - 1];
    if (prevEntry) setCurrentKey(prevEntry.navKey);
  }, [canGoPrev, isDirty, saveCurrent, entries, currentIndex]);

  const handleNext = useCallback(async () => {
    if (!canGoNext) return;
    if (isDirty) {
      try { await saveCurrent(); } catch { return; }
    }
    const nextEntry = entries[currentIndex + 1];
    if (nextEntry) setCurrentKey(nextEntry.navKey);
  }, [canGoNext, isDirty, saveCurrent, entries, currentIndex]);

  const handleSave = useCallback(async () => {
    if (!currentEntry || !isDirty) return;
    setSaveError(null);
    try {
      await onSave(currentEntry, editText);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [currentEntry, isDirty, editText, onSave]);

  const handleLlmTranslate = useCallback(async () => {
    if (!currentEntry || !onLlmTranslate) return;
    setLlmSuggestion({ text: "", loading: true, error: null });
    try {
      const result = await onLlmTranslate(currentEntry);
      setLlmSuggestion({ text: result, loading: false, error: null });
    } catch (err) {
      setLlmSuggestion({
        text: "",
        loading: false,
        error: err instanceof Error ? err.message : t(language, "editPanel.llmFailed"),
      });
    }
  }, [currentEntry, onLlmTranslate]);

  const handleAcceptSuggestion = useCallback(async () => {
    if (!currentEntry || !llmSuggestion.text) return;
    setSaveError(null);
    setEditText(llmSuggestion.text);
    try {
      await onSave(currentEntry, llmSuggestion.text);
      setSaved(true);
      setLlmSuggestion({ text: "", loading: false, error: null });
      textareaRef.current?.focus();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [currentEntry, llmSuggestion.text, onSave]);

  const handleCopySource = useCallback(async () => {
    if (!currentEntry) return;
    try {
      await navigator.clipboard.writeText(currentEntry.sourceText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = currentEntry.sourceText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [currentEntry]);

  // ── Close handler with auto-save and closing animation ──
  const handleClose = useCallback(async () => {
    if (isDirty && currentEntry) {
      try { await onSave(currentEntry, editText); } catch { /* best-effort */ }
    }
    setAnimState("closing");
    setTimeout(() => onClose(), 200);
  }, [isDirty, currentEntry, editText, onSave, onClose]);

  // ── Keyboard handler (uses refs to avoid stale closures without re-registration) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack arrow keys when editing text
      if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          handlePrevRef.current();
          break;
        case "ArrowRight":
          e.preventDefault();
          handleNextRef.current();
          break;
        case "Escape":
          handleCloseRef.current();
          break;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Focus trapping ──
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    panel.addEventListener("keydown", trap);
    // Focus the ← button so keyboard shortcuts keep working after navigation.
    (panel.querySelector<HTMLElement>(".edit-panel-toolbar-group button") ?? first)?.focus();
    return () => panel.removeEventListener("keydown", trap);
  }, [currentKey]);

  // Sync refs so keyboard handler always calls latest callbacks
  handleCloseRef.current = handleClose;
  handlePrevRef.current = handlePrev;
  handleNextRef.current = handleNext;

  const isPanelOpen = animState === "open";

  // ── Guard: entry not found ──
  if (!currentEntry) {
    return createPortal(
      <div className={`edit-panel-overlay ${isPanelOpen ? "open" : ""}`} onClick={onClose}>
        <div className="edit-panel-modal" onClick={(e) => e.stopPropagation()}>
          <div className="empty-state">
            <p>{t(language, "editPanel.entryNotFound")}</p>
            <button className="primary-button" onClick={onClose} type="button">{t(language, "editPanel.close")}</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className={`edit-panel-overlay ${isPanelOpen ? "open" : ""}`}
      onClick={handleClose}
    >
      <div
        className={`edit-panel-modal ${isPanelOpen ? "open" : ""}`}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t(language, "editPanel.ariaLabel")}
      >
        {/* ── Header ── */}
        <div className="edit-panel-header">
          <div className="edit-panel-header-left">
            <span className="edit-panel-mod-dot" />
            <span className="edit-panel-modname">{currentEntry.modName ?? currentEntry.modId}</span>
            {currentEntry.modName && currentEntry.modId && (
              <span className="edit-panel-modid">· {currentEntry.modId}</span>
            )}
            {currentEntry.key && (
              <span className="edit-panel-entry-key" title={currentEntry.key}>
                {currentEntry.key}
              </span>
            )}
          </div>
          <div className="edit-panel-header-right">
            <span className="edit-panel-progress">
              {currentIndex + 1} / {entries.length}
            </span>
            <button
              className="edit-panel-close"
              onClick={handleClose}
              type="button"
              aria-label={t(language, "editPanel.ariaClose")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Body: source / target ── */}
        <div className="edit-panel-body">
          {/* Source */}
          <div className="edit-panel-source">
            <div className="edit-panel-source-card">
              <div className="edit-panel-source-card-header">
                <span className="edit-panel-lang-badge">
                  {pageType === "validate" ? (language === "zh_cn" ? "en_us" : language) : currentEntry.sourceType || "source"}
                </span>
                <button
                  className="edit-panel-icon-btn"
                  onClick={handleCopySource}
                  type="button"
                  data-tooltip={copied ? t(language, "editPanel.copied") : t(language, "editPanel.copySource")}
                  aria-label={t(language, "editPanel.copySource")}
                >
                  {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
                </button>
              </div>
              <div className="edit-panel-source-text">
                {currentEntry.sourceText}
              </div>
            </div>
          </div>

          {/* Target */}
          <div className="edit-panel-target">
            <div className="edit-panel-target-label">
              <span className="edit-panel-lang-badge">
                {pageType === "validate" ? language : "target"}
              </span>
            </div>

            {saveError && (
              <div className="alert error" style={{ marginBottom: 8, fontSize: 12, padding: "4px 8px" }}>
                {saveError}
              </div>
            )}

            <textarea
              ref={textareaRef}
              className={`edit-panel-textarea ${isDirty ? "dirty" : ""}`}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={5}
              aria-label={t(language, "editPanel.ariaTargetEdit")}
            />

            {/* LLM suggestion card */}
            {llmSuggestion.loading && (
              <div className="edit-panel-llm-card loading">
                <span className="edit-panel-llm-spinner" />
                <span>{t(language, "editPanel.translating")}</span>
              </div>
            )}
            {llmSuggestion.error && (
              <div className="edit-panel-llm-card error">
                <span className="edit-panel-llm-error-text">{llmSuggestion.error}</span>
                <button className="text-button" onClick={handleLlmTranslate} type="button">
                  {t(language, "editPanel.retry")}
                </button>
              </div>
            )}
            {llmSuggestion.text && !llmSuggestion.loading && (
              <div className="edit-panel-llm-card done">
                <div className="edit-panel-llm-label">
                  <Sparkles size={12} />
                  {t(language, "editPanel.llmTranslate")}
                </div>
                <div className="edit-panel-llm-text">{llmSuggestion.text}</div>
                <div className="edit-panel-llm-actions">
                  <button
                    className="primary-button"
                    onClick={handleAcceptSuggestion}
                    type="button"
                  >
                    <CornerDownLeft size={12} />
                    {t(language, "editPanel.accept")}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={handleLlmTranslate}
                    type="button"
                  >
                    {t(language, "editPanel.retranslate")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom Toolbar ── */}
        <div className="edit-panel-toolbar">
          <div className="edit-panel-toolbar-group">
            <button
              className="edit-panel-tool-btn"
              onClick={handlePrev}
              disabled={!canGoPrev}
              type="button"
              data-tooltip={t(language, "editPanel.prevTooltip")}
              aria-label={t(language, "editPanel.prevTooltip")}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="edit-panel-tool-btn"
              onClick={handleNext}
              disabled={!canGoNext}
              type="button"
              data-tooltip={t(language, "editPanel.nextTooltip")}
              aria-label={t(language, "editPanel.nextTooltip")}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="edit-panel-toolbar-divider" />

          <button
            className="edit-panel-tool-btn"
            onClick={handleCopySource}
            type="button"
            data-tooltip={copied ? t(language, "editPanel.copied") : t(language, "editPanel.copySource")}
          >
            <ClipboardCopy size={14} />
            <span>{t(language, "editPanel.copySource")}</span>
          </button>

          <div className="edit-panel-toolbar-divider" />

          <button
            className="edit-panel-tool-btn"
            onClick={handleLlmTranslate}
            type="button"
            disabled={llmSuggestion.loading || !onLlmTranslate}
            data-tooltip={t(language, "editPanel.llmTranslateTooltip")}
          >
            <Sparkles size={14} />
            <span>{t(language, "editPanel.llmTranslate")}</span>
          </button>

          <div className="edit-panel-toolbar-spacer" />

          <button
            ref={saveBtnRef}
            className={`primary-button edit-panel-save-btn ${saved ? "flash-saved" : ""}`}
            onClick={handleSave}
            disabled={!isDirty}
            type="button"
          >
            {saved ? <Check size={16} /> : null}
            {t(language, "editPanel.save")}
          </button>
        </div>

        {/* ── Shortcut hints ── */}
        <div className="edit-panel-shortcuts">
          <span><kbd>←</kbd> {t(language, "editPanel.shortcutPrev")}</span>
          <span><kbd>→</kbd> {t(language, "editPanel.shortcutNext")}</span>
          <span><kbd>Esc</kbd> {t(language, "editPanel.shortcutClose")}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

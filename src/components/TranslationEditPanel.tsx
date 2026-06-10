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

  // Refs for focus trapping and stable callback access
  const panelRef = useRef<HTMLDivElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);
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

  // Reset state when navigating to a new entry
  useEffect(() => {
    if (currentEntry) {
      setEditText(currentEntry.targetText);
    }
    setLlmSuggestion({ text: "", loading: false, error: null });
    setSaved(false);
    setSaveError(null);
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Save current before navigating
    if (isDirty) {
      try { await saveCurrent(); } catch { return; }
    }
    // Safety check: currentIndex is guaranteed valid because canGoPrev checks it
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
      // Flash effect: reset saved after 2s
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
    // Accept = fill textarea with suggestion + save
    setEditText(llmSuggestion.text);
    try {
      await onSave(currentEntry, llmSuggestion.text);
      setSaved(true);
      setLlmSuggestion({ text: "", loading: false, error: null });
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

  // ── Keyboard handler (uses refs to avoid stale closures without re-registration) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    first?.focus();
    return () => panel.removeEventListener("keydown", trap);
  }, [currentKey]);

  // ── Close handler with auto-save ──
  const handleClose = useCallback(async () => {
    if (isDirty && currentEntry) {
      try { await onSave(currentEntry, editText); } catch { /* best-effort */ }
    }
    onClose();
  }, [isDirty, currentEntry, editText, onSave, onClose]);

  // Sync refs so keyboard handler always calls latest callbacks
  handleCloseRef.current = handleClose;
  handlePrevRef.current = handlePrev;
  handleNextRef.current = handleNext;

  // ── Guard: entry not found ──
  if (!currentEntry) {
    return createPortal(
      <div className="edit-panel-overlay" onClick={onClose}>
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

  const panelContent = (
    <div className="edit-panel-overlay" onClick={handleClose}>
      <div
        className="edit-panel-modal"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t(language, "editPanel.ariaLabel")}
      >
        {/* ── Header ── */}
        <div className="edit-panel-header">
          <div className="edit-panel-header-info">
            <span className="edit-panel-modname">{currentEntry.modName ?? currentEntry.modId}</span>
            {currentEntry.modName && currentEntry.modId && (
              <span className="edit-panel-modid">· {currentEntry.modId}</span>
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
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Body: source / target ── */}
        <div className="edit-panel-body">
          {/* Source */}
          <div className="edit-panel-source">
            <div className="edit-panel-section-header">
              <span>{t(language, "editPanel.sourceTitle")}</span>
              <button
                className="ghost-button"
                onClick={handleCopySource}
                type="button"
                data-tooltip={copied ? t(language, "editPanel.copied") : t(language, "editPanel.copySource")}
              >
                {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
              </button>
            </div>
            <div className="edit-panel-text-content">
              {currentEntry.sourceText}
            </div>
          </div>

          {/* Target */}
          <div className="edit-panel-target">
            <div className="edit-panel-section-header">
              <span>{t(language, "editPanel.targetTitle")}</span>
            </div>
            {saveError && (
              <div className="alert error" style={{ marginBottom: 8, fontSize: 12, padding: "4px 8px" }}>
                {saveError}
              </div>
            )}
            <textarea
              className={`edit-panel-textarea ${isDirty ? "dirty" : ""}`}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={5}
              aria-label={t(language, "editPanel.ariaTargetEdit")}
            />

            {/* Suggestion bar */}
            {llmSuggestion.loading && (
              <div className="suggestion-bar loading">
                <span className="spin" style={{ display: "inline-block" }}>⟳</span>
                {t(language, "editPanel.translating")}
              </div>
            )}
            {llmSuggestion.error && (
              <div className="suggestion-bar error">
                <span>{llmSuggestion.error}</span>
                <button className="text-button" onClick={handleLlmTranslate} type="button">
                  {t(language, "editPanel.retry")}
                </button>
              </div>
            )}
            {llmSuggestion.text && !llmSuggestion.loading && (
              <div className="suggestion-bar">
                <div className="suggestion-text">{llmSuggestion.text}</div>
                <div className="suggestion-actions">
                  <button
                    className="primary-button"
                    onClick={handleAcceptSuggestion}
                    type="button"
                    style={{ fontSize: 12, padding: "3px 10px" }}
                  >
                    <CornerDownLeft size={12} />
                    {t(language, "editPanel.accept")}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={handleLlmTranslate}
                    type="button"
                    style={{ fontSize: 12 }}
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
          <button
            className="ghost-button"
            onClick={handleLlmTranslate}
            type="button"
            disabled={llmSuggestion.loading || !onLlmTranslate}
            data-tooltip={t(language, "editPanel.llmTranslateTooltip")}
          >
            <Sparkles size={16} />
            {t(language, "editPanel.llmTranslate")}
          </button>

          <div className="edit-panel-toolbar-divider" />

          <button
            className="ghost-button"
            onClick={handlePrev}
            disabled={!canGoPrev}
            type="button"
            data-tooltip={t(language, "editPanel.prevTooltip")}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="ghost-button"
            onClick={handleNext}
            disabled={!canGoNext}
            type="button"
            data-tooltip={t(language, "editPanel.nextTooltip")}
          >
            <ChevronRight size={16} />
          </button>

          <div className="edit-panel-toolbar-divider" />

          <button
            className="ghost-button"
            onClick={handleCopySource}
            type="button"
            data-tooltip={copied ? t(language, "editPanel.copied") : t(language, "editPanel.copySource")}
          >
            {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
            {t(language, "editPanel.copySource")}
          </button>

          <button
            ref={saveBtnRef}
            className={`primary-button ${saved ? "flash-saved" : ""}`}
            onClick={handleSave}
            disabled={!isDirty}
            type="button"
          >
            {saved ? <Check size={16} /> : null}
            {t(language, "editPanel.save")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panelContent, document.body);
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Pause, Play, Trash2 } from "lucide-react";
import { readLogs } from "../api/tauri";
import { t } from "../i18n/translations";
import type { AppLanguage, LogEntry } from "../types";

interface Props {
  scanSummary: unknown; // unused, kept for interface compatibility
  language: AppLanguage;
}

const ROW_HEIGHT = 22;
const OVERSCAN = 20;
const POLL_MS = 600;
const MAX_LOG = 50000;

/** Map log level to CSS class and display label. */
function levelMeta(level: string): { cls: string; label: string } {
  switch (level) {
    case "ERROR": return { cls: "log-error", label: "ERROR" };
    case "WARN": return { cls: "log-warn", label: "WARN" };
    case "INFO": return { cls: "log-info", label: "INFO" };
    case "DEBUG": return { cls: "log-debug", label: "DEBUG" };
    default: return { cls: "log-raw", label: level };
  }
}

export function LogsPage({ language }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);
  const followRef = useRef(true); // whether auto-follow is on
  const rafRef = useRef<number | null>(null);

  // Poll for new log entries
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const result = await readLogs();
        if (!active) return;
        if (result.entries.length > 0 && !pausedRef.current) {
          setEntries((prev) => {
            const next = [...prev, ...result.entries];
            return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
          });
        }
      } catch {
        // file may not exist yet
      }
      setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { active = false; };
  }, []);

  // Update view height on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewHeight(el.clientHeight);
    });
    ro.observe(el);
    setViewHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Smooth scroll-to-bottom when new entries arrive (only if following)
  useEffect(() => {
    if (!followRef.current || paused) return;
    const el = containerRef.current;
    if (!el) return;
    // Use rAF to avoid layout thrash
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      rafRef.current = null;
    });
  }, [entries, paused]);

  // Virtual scroll calculations
  const totalHeight = entries.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(entries.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleEntries = entries.slice(startIdx, endIdx);
  const offsetY = startIdx * ROW_HEIGHT;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    // Determine if user is near bottom
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    followRef.current = nearBottom;
  }, []);

  const clearLog = useCallback(() => {
    setEntries([]);
    followRef.current = true;
  }, []);

  const copyAll = useCallback(async () => {
    const text = entries.map((e) => {
      const ts = e.timestamp ? `[${e.timestamp}]` : "";
      return `${ts} ${e.level} ${e.message}`;
    }).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch { /* clipboard not available */ }
  }, [entries]);

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>{t(language, "logs.title")}</h1>
          <p>{t(language, "logs.subtitle")}</p>
        </div>
        <div className="page-header-button" style={{ gap: 6 }}>
          <button
            className="ghost-button"
            onClick={() => { setPaused((p) => !p); pausedRef.current = !pausedRef.current; }}
            type="button"
            title={paused ? "继续滚动" : "暂停滚动"}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? "继续" : "暂停"}
          </button>
          <button className="ghost-button" onClick={copyAll} type="button" data-tooltip="复制全部日志">
            <Copy size={14} />
            复制
          </button>
          <button className="ghost-button danger" onClick={clearLog} type="button" title="清空日志">
            <Trash2 size={14} />
            {t(language, "jobs.logPanel.clear")}
          </button>
        </div>
      </div>

      <div className="log-viewer-wrap">
        {paused && <div className="log-paused-banner">日志已暂停</div>}
        <div
          className="log-viewer"
          ref={containerRef}
          onScroll={handleScroll}
        >
          <div style={{ height: totalHeight, position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${offsetY}px)` }}>
              {visibleEntries.map((entry) => {
                const { cls, label } = levelMeta(entry.level);
                return (
                  <div
                    key={entry.lineNumber}
                    className={`log-row ${cls}`}
                    style={{ height: ROW_HEIGHT }}
                    data-tooltip={entry.message}
                  >
                    <span className="log-lvl-badge">{label}</span>
                    <span className="log-ts">{entry.timestamp}</span>
                    <span className="log-msg">{entry.message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="log-footer">
          <span>{entries.length.toLocaleString()} 行</span>
          {!followRef.current && (
            <button className="text-button" onClick={() => { followRef.current = true; containerRef.current && (containerRef.current.scrollTop = containerRef.current.scrollHeight); }} type="button">
              回到底部
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

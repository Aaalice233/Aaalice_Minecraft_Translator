import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, FileText, Pause, Play, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { readLogs } from "../api/tauri";
import { t } from "../i18n/translations";
import type { AppLanguage, LogEntry } from "../types";

interface Props {
  language: AppLanguage;
}

const ROW_HEIGHT = 22;
const OVERSCAN = 20;
const POLL_MS = 600;
const MAX_LOG = 50000;

const LEVELS = ["ALL", "ERROR", "WARN", "INFO", "DEBUG", "RAW"] as const;
type LevelFilter = (typeof LEVELS)[number];

function levelCls(level: string): string {
  switch (level) {
    case "ERROR": return "log-error";
    case "WARN": return "log-warn";
    case "INFO": return "log-info";
    case "DEBUG": return "log-debug";
    default: return "log-raw";
  }
}

export function LogsPage({ language }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("ALL");
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);
  const followRef = useRef(true);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const result = await readLogs();
        if (result.entries.length > 0 && !pausedRef.current) {
          setEntries((prev) => {
            const next = [...prev, ...result.entries];
            return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
          });
        }
      } catch {
        // file may not exist yet
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

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

  useEffect(() => {
    if (!followRef.current || paused) return;
    const el = containerRef.current;
    if (!el) return;
    // Use rAF to avoid layout thrash
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [entries, paused]);

  const filteredEntries = useMemo(
    () => levelFilter === "ALL" ? entries : entries.filter((e) => e.level === levelFilter),
    [entries, levelFilter],
  );

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, RAW: 0 };
    for (const e of entries) {
      if (counts[e.level] !== undefined) counts[e.level]++;
    }
    return counts;
  }, [entries]);

  const totalHeight = filteredEntries.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(filteredEntries.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleEntries = filteredEntries.slice(startIdx, endIdx);
  const offsetY = startIdx * ROW_HEIGHT;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const scrollToBottom = useCallback(() => {
    followRef.current = true;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const clearLog = useCallback(() => {
    setEntries([]);
    followRef.current = true;
  }, []);

  const copyAll = useCallback(() => {
    const text = entries.map((e) => {
      const ts = e.timestamp ? `[${e.timestamp}]` : "";
      return `${ts} ${e.level} ${e.message}`;
    }).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [entries]);

  return (
    <section className="page">
      <PageHeader
        title={t(language, "logs.title")}
        subtitle={t(language, "logs.subtitle")}
        actions={
          <>
            <button
              className={`icon-button ${paused ? '' : 'active'}`}
              onClick={() => setPaused((p) => !p)}
              type="button"
              data-tooltip={t(language, paused ? "logs.resume" : "logs.pause")}
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button className="icon-button" onClick={copyAll} type="button" data-tooltip={t(language, "logs.copyAll")}>
              <Copy size={16} />
            </button>
            <button className="icon-button danger" onClick={clearLog} type="button" data-tooltip={t(language, "logs.clear")}>
              <Trash2 size={16} />
            </button>
          </>
        }
      />

      <div className="log-filter-bar">
        {LEVELS.map((lvl) => {
          const count = lvl === "ALL" ? entries.length : (levelCounts[lvl] ?? 0);
          const isEmpty = count === 0 && lvl !== "ALL";
          return (
            <button
              key={lvl}
              type="button"
              className={`log-filter-btn${levelFilter === lvl ? " active" : ""}${isEmpty ? " log-filter-btn--empty" : ""}`}
              data-level={lvl}
              onClick={() => { setLevelFilter(lvl); scrollToBottom(); }}
            >
              <span className="log-filter-lbl">{lvl === "ALL" ? t(language, "logs.allLevel") : lvl}</span>
              <span className="log-filter-cnt">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="log-viewer-wrap">
        {paused && <div className="log-paused-banner">{t(language, "logs.paused")}</div>}
        <div
          className="log-viewer"
          ref={containerRef}
          onScroll={handleScroll}
        >
          {filteredEntries.length === 0 && (
            <div className="log-empty-state">
              <FileText size={22} />
              <span>{t(language, "logs.empty")}</span>
            </div>
          )}
          <div style={{ height: totalHeight, position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${offsetY}px)` }}>
              {visibleEntries.map((entry) => (
                <div
                  key={entry.lineNumber}
                  className={`log-row ${levelCls(entry.level)}`}
                  style={{ height: ROW_HEIGHT }}
                  data-tooltip={entry.message}
                >
                  <span className="log-lvl-badge">{entry.level}</span>
                  <span className="log-ts">{entry.timestamp}</span>
                  <span className="log-msg">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="log-footer">
          <span>{t(language, "logs.lines", { count: filteredEntries.length })}{levelFilter !== "ALL" ? ` ${t(language, "logs.linesWithTotal", { count: entries.length })}` : ""}</span>
          {!followRef.current && (
            <button className="text-button" onClick={scrollToBottom} type="button">
              {t(language, "logs.scrollToBottom")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

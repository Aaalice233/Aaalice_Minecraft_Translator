import { AlertTriangle, Filter, FolderOpen, Loader2, RefreshCcw, ScanLine, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelScan, saveSettings, scanInstance } from "../api/tauri";
import { localeByAppLanguage, t } from "../i18n/translations";
import type { AppLanguage, ModScanResult, ScanProgressEvent, ScanSummary, ScanWarning, Settings } from "../types";
import type { TranslationKey } from "../i18n/translations";
import { useAppState } from "../app/AppContext";

interface Props {
  settings?: Settings;
  scanSummary?: ScanSummary | null;
  onSettingsChange?: (settings: Settings) => void;
  onScanSummaryChange?: (summary: ScanSummary) => void;
  language: AppLanguage;
  onBusyChange?: (busy: boolean) => void;
  /** Notify sidebar that scanning completed (or was reset). */
  onCompleteChange?: (completed: boolean) => void;
}

/** Collapsible warnings panel — collapsed by default, expands on click. */
function CollapsibleWarnings({ warnings, language }: { warnings: ScanWarning[]; language: AppLanguage }) {
  const [expanded, setExpanded] = useState(false);
  const maxVisible = expanded ? warnings.length : 0;

  return (
    <div className="warnings-collapsible">
      <button
        className="warnings-toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
        aria-expanded={expanded}
      >
        <AlertTriangle size={15} />
        <span>{t(language, "dashboard.warningsCount", { count: warnings.length })}</span>
        <span className={`warnings-arrow ${expanded ? "expanded" : ""}`}>▶</span>
      </button>
      {expanded && (
        <div className="warnings-body">
          {warnings.map((w) => (
            <div className="alert warning compact" key={`${w.code}-${w.path}`}>
              <span>{w.message}</span>
              {w.path && <code>{w.path}</code>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardPage({
  settings: _settings,
  scanSummary: _scanSummary,
  onSettingsChange: _onSettingsChange,
  onScanSummaryChange: _onScanSummaryChange,
  language,
}: Props) {
  const { state, dispatch } = useAppState();
  const settings = _settings ?? state.settings!;
  const scanSummary = _scanSummary !== undefined ? _scanSummary : state.scanSummary;
  const [instancePath, setInstancePath] = useState(settings.instancePath);
  const [isScanning, setIsScanning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Sync scanning busy state to sidebar nav
  useEffect(() => {
    dispatch({ type: "SET_NAV_STATE", payload: { key: "dashboard", status: isScanning ? "busy" : "idle" } });
  }, [isScanning, dispatch]);

  // Notify sidebar nav when scan completes (has valid result, not cancelled, not currently scanning)
  const prevIsScanning = useRef(isScanning);
  useEffect(() => {
    if (prevIsScanning.current && !isScanning && scanSummary && !scanSummary.cancelled && !error) {
      dispatch({ type: "SET_NAV_STATE", payload: { key: "dashboard", status: "completed" } });
    }
    prevIsScanning.current = isScanning;
  }, [isScanning, scanSummary, error, dispatch]);

  // When instance path changes, clear completed state (user is setting up a new scan target)
  useEffect(() => {
    if (instancePath && settings.instancePath && instancePath !== settings.instancePath) {
      dispatch({ type: "SET_NAV_STATE", payload: { key: "dashboard", status: "idle" } });
    }
  }, [instancePath, settings.instancePath, dispatch]);

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, string | { min?: number; max?: number }>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const copyFlash = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    } catch { /* clipboard not available */ }
  }, []);

  const stageLabel = (phase: string): string => {
    const key = `dashboard.stage.${phase}` as TranslationKey;
    const translated = t(language, key);
    return translated || phase;
  };

  const numberLocale = localeByAppLanguage[language];
  const progressPercent = (p: ScanProgressEvent) =>
    p.total === 0 ? 0 : Math.round((p.current / p.total) * 100);
  const stats = useMemo(
    () => [
      { label: t(language, "dashboard.stats.mods"), value: scanSummary?.mods.length ?? 0, hint: t(language, "dashboard.stats.modsHint") },
      { label: t(language, "dashboard.stats.pendingEntries"), value: scanSummary?.totalPendingEntries ?? 0, hint: "" },
      { label: t(language, "dashboard.stats.resourcePackCovered"), value: scanSummary?.resourcePackCoveredEntries ?? 0, hint: t(language, "dashboard.stats.resourcePackCoveredHint") },
      { label: t(language, "dashboard.stats.actualPending"), value: scanSummary?.actualPendingEntries ?? 0, hint: t(language, "dashboard.stats.actualPendingHint") },
    ],
    [language, scanSummary],
  );

  const processedMods = useMemo(() => {
    const mods = scanSummary?.mods ?? [];
    let result = mods;

    // Apply filters
    const activeFilterKeys = Object.keys(filters);
    if (activeFilterKeys.length > 0) {
      result = result.filter((mod) =>
        activeFilterKeys.every((col) => {
          const value = filters[col];
          if (value == null) return true;
          switch (col) {
            case "fileName":
              return typeof value === "string" && mod.fileName.toLowerCase().includes(value.toLowerCase());
            case "modId":
              return typeof value === "string" && mod.modId.toLowerCase().includes(value.toLowerCase());
            case "formats":
              return typeof value === "string" && (value === "" || mod.formats.some((f) => f === value));
            case "languageFileCount":
              if (typeof value === "object" && "min" in value) {
                return (!value.min || mod.languageFileCount >= Number(value.min)) &&
                       (!value.max || mod.languageFileCount <= Number(value.max));
              }
              return true;
            case "pending": {
              const pending = getPending(mod);
              if (typeof value === "object" && "min" in value) {
                return (!value.min || pending >= Number(value.min)) &&
                       (!value.max || pending <= Number(value.max));
              }
              return true;
            }
            case "hasTargetLanguage":
              if (value === "") return true;
              return mod.hasTargetLanguage === (value === "true");
            default:
              return true;
          }
        }),
      );
    }

    // Apply sorting
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const dir = sortConfig.direction === "asc" ? 1 : -1;
        let cmp = 0;
        switch (sortConfig.key) {
          case "fileName":
            cmp = a.fileName.localeCompare(b.fileName);
            break;
          case "modId":
            cmp = a.modId.localeCompare(b.modId);
            break;
          case "formats":
            cmp = a.formats.join("/").localeCompare(b.formats.join("/"));
            break;
          case "languageFileCount":
            cmp = a.languageFileCount - b.languageFileCount;
            break;
          case "pending":
            cmp = getPending(a) - getPending(b);
            break;
          case "hasTargetLanguage":
            cmp = Number(a.hasTargetLanguage) - Number(b.hasTargetLanguage);
            break;
        }
        return cmp * dir;
      });
    }
    // if sortConfig is null, keep original backend sort (fileName asc)

    return result;
  }, [scanSummary?.mods, sortConfig, filters]);

  // Register scan-progress listener — only in real Tauri runtime
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      listen("scan-progress", (event) => {
        setScanProgress(event.payload as ScanProgressEvent);
      }).then((unlisten) => {
        unlistenFn = unlisten;
        if (cancelled) unlisten();
      });
    }).catch((err) => {
      console.error("scan-progress listener registration failed:", err);
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Click outside to close filter popover
  useEffect(() => {
    if (!openFilter) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openFilter]);

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await cancelScan();
    } catch (err) {
      console.error("取消扫描失败:", err);
      setError("取消扫描失败: " + (err instanceof Error ? err.message : String(err)));
      setIsCancelling(false);
    }
  }

  async function handleScan() {
    setIsScanning(true);
    setIsCancelling(false);
    dispatch({ type: "SET_NAV_STATE", payload: { key: "dashboard", status: "idle" } }); // clear completed state on re-scan
    setScanProgress(null);
    setError("");
    setSortConfig(null);
    setFilters({});
    setOpenFilter(null);
    try {
      const nextSettings = { ...settings, instancePath };
      dispatch({ type: "SET_SETTINGS", payload: nextSettings });
      await saveSettings(nextSettings);
      const summary = await scanInstance(
        instancePath,
        nextSettings.sourceLanguage,
        nextSettings.targetLanguage,
      );
      dispatch({ type: "SET_SCAN_SUMMARY", payload: summary });
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setIsScanning(false);
      setIsCancelling(false);
    }
  }

  function handleSort(column: string) {
    setSortConfig((prev) => {
      if (!prev || prev.key !== column) return { key: column, direction: "asc" };
      if (prev.direction === "asc") return { key: column, direction: "desc" };
      return null; // back to default (fileName asc)
    });
    setOpenFilter(null);
  }

  function toggleFilter(column: string) {
    setOpenFilter((prev) => (prev === column ? null : column));
  }

  function handleFilterChange(column: string, value: string | { min?: number; max?: number } | null) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === null || value === "" || (typeof value === "object" && !("min" in value) && !("max" in value))) {
        delete next[column];
      } else {
        next[column] = value;
      }
      return next;
    });
  }

  // 判断文本中是否含有显著比例的 CJK 字符（与后端 has_substantial_cjk 一致）
  function hasSubstantialCjk(text: string): boolean {
    const cjkChars = [...text].filter((c) => {
      const cp = c.codePointAt(0)!;
      return (cp >= 0x4e00 && cp <= 0x9fff)
        || (cp >= 0x3400 && cp <= 0x4dbf)
        || (cp >= 0x2f800 && cp <= 0x2fa1f);
    });
    if (cjkChars.length === 0) return false;
    const nonWs = [...text].filter((c) => c.trim() !== "").length;
    return nonWs > 0 && (cjkChars.length / nonWs) > 0.25;
  }

  // 缓存每个 mod 的 pending 数，避免 O(entries) 迭代
  const pendingCache = useMemo(() => {
    const cache = new Map<string, number>();
    if (!scanSummary) return cache;
    for (const mod of scanSummary.mods) {
      // 源语言与目标语言相同时跳过（防止中译中）
      if (mod.resolvedSourceLanguage === mod.targetLanguage) {
        cache.set(mod.jarPath, 0);
        continue;
      }
      const targetKeys = new Set(
        mod.entries.filter((e) => e.language === mod.targetLanguage).map((e) => e.key)
      );
      const count = mod.entries.filter(
        (e) => e.language === mod.resolvedSourceLanguage && !targetKeys.has(e.key)
          // 跳过源文本中已有显著比例 CJK 字符的条目（虚假 en_us）
          && !(mod.resolvedSourceLanguage === "en_us" && hasSubstantialCjk(e.text))
      ).length;
      cache.set(mod.jarPath, count);
    }
    return cache;
  }, [scanSummary]);

  function getPending(mod: ModScanResult): number {
    return pendingCache.get(mod.jarPath) ?? 0;
  }

  return (
    <section className="page dashboard-page">
      <div className="page-header">
        <div>
          <h1>{t(language, "dashboard.title")}</h1>
          <p>{t(language, "dashboard.subtitle")}</p>
        </div>
        <div className="page-header-button">
          <button
            className={[
              "primary-button",
              isScanning && !isCancelling && "danger",
              isCancelling && "cancelling",
            ].filter(Boolean).join(" ")}
            disabled={isCancelling}
            onClick={isScanning ? handleCancel : handleScan}
            type="button"
            data-tooltip={t(language, isScanning ? "tooltip.cancelScan" : "tooltip.scan")}
          >
            {isCancelling ? (
              <Loader2 size={18} className="spin" />
            ) : isScanning ? (
              <Square size={18} />
            ) : (
              <ScanLine size={18} />
            )}
            {isCancelling
              ? t(language, "dashboard.cancelling")
              : isScanning
                ? t(language, "dashboard.cancel")
                : t(language, "dashboard.scan")}
          </button>
        </div>
      </div>

      <div className="instance-row">
        <label>
          {t(language, "dashboard.instancePath")}
          <input
            value={instancePath}
            onChange={(event) => setInstancePath(event.target.value)}
            placeholder={t(language, "dashboard.instancePlaceholder")}
          />
        </label>
<button
        className="ghost-button"
        type="button"
        data-tooltip={t(language, "tooltip.pickInstance")}
        onClick={async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const selected: string | null = await invoke("pick_instance_folder", {
                locale: localeByAppLanguage[language],
              });
            if (selected) {
              setInstancePath(selected);
            }
          } catch (err) {
            setError(t(language, "dashboard.pickInstanceError") + (err instanceof Error ? err.message : String(err)));
          }
        }}
        >
        <FolderOpen size={17} />
        {t(language, "dashboard.pickInstance")}
        </button>
        <button className="ghost-button" disabled={isScanning} onClick={handleScan} type="button" data-tooltip={t(language, "tooltip.rescan")}>
          <RefreshCcw size={17} />
          {t(language, "dashboard.rescan")}
        </button>
      </div>

      {isScanning && scanProgress && (
        <div className="scan-progress">
          <div className="scan-progress-header">
            <strong>{stageLabel(scanProgress.phase)}</strong>
            <span>{t(language, "dashboard.scanProgress", { current: scanProgress.current, total: scanProgress.total })}</span>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${progressPercent(scanProgress)}%` }}
            />
          </div>
          {scanProgress.stageStatus === "completed" && (
            <small className="scan-progress-status">✔ {stageLabel(scanProgress.phase)}</small>
          )}
          {scanProgress.subStep && (
            <small className="scan-progress-mod">{scanProgress.subStep}</small>
          )}
          {!scanProgress.subStep && scanProgress.modName && (
            <small className="scan-progress-mod">{scanProgress.modName}</small>
          )}
        </div>
      )}

      {error && (
        <div className="alert error">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}

      {!isScanning && scanSummary?.cancelled && (
        <div className="alert warning">
          <AlertTriangle size={17} />
          {t(language, "dashboard.cancelledMessage")}
        </div>
      )}

      {scanSummary && scanSummary.warnings.length > 0 && (
        <CollapsibleWarnings warnings={scanSummary.warnings} language={language} />
      )}

      <div className="stats-grid">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value.toLocaleString(numberLocale)}</strong>
            <small>{stat.hint}</small>
          </article>
        ))}
      </div>

      <div className="resource-bar">
        <span className="resource-bar-label">{t(language, "dashboard.resourceSources")}</span>
        {(scanSummary?.resourcePacks ?? []).map((pack) => (
          <span key={pack.path} className="resource-chip">
            <strong>{pack.name}</strong>
            <span>{t(language, "dashboard.resourceCount", { files: pack.langFileCount, entries: pack.entryCount })}</span>
            <span className={`badge ${pack.sourceType}`}>{pack.sourceType}</span>
          </span>
        ))}
        {!scanSummary && <span className="resource-bar-empty">{t(language, "dashboard.emptyResource")}</span>}
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>{t(language, "dashboard.modsTitle")}</h2>
            <span>{scanSummary ? `${processedMods.length} / ${scanSummary.mods.length}` : t(language, "dashboard.waiting")}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    { key: "fileName", label: t(language, "dashboard.column.mod") },
                    { key: "modId", label: t(language, "dashboard.column.modId") },
                    { key: "formats", label: t(language, "dashboard.column.format") },
                    { key: "languageFileCount", label: t(language, "dashboard.column.langFiles") },
                    { key: "pending", label: t(language, "dashboard.column.pending") },
                    { key: "hasTargetLanguage", label: t(language, "dashboard.column.status") },
                  ].map((col) => {
                    const isActiveSort = sortConfig?.key === col.key;
                    const isDefaultSort = !sortConfig && col.key === "fileName";
                    const hasActiveFilter = col.key in filters;
                    return (
                      <th
                        key={col.key}
                        className={[
                          "sortable",
                          isActiveSort ? (sortConfig.direction === "asc" ? "sorted-asc" : "sorted-desc") : "",
                          isDefaultSort ? "sorted-default" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="th-filter-wrap">
                          {col.label}
                          {(isActiveSort || isDefaultSort) && (
                            <span className="sort-indicator">
                              {isActiveSort ? (sortConfig!.direction === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          )}
                          <button
                            className={[
                              "th-filter-btn",
                              hasActiveFilter ? "has-filter" : "",
                              openFilter === col.key ? "active" : "",
                            ].filter(Boolean).join(" ")}
                            onClick={(e) => { e.stopPropagation(); toggleFilter(col.key); }}
                            type="button"
                            aria-label={`Filter ${col.label}`}
                            data-tooltip={t(language, "tooltip.filter")}
                          >
                            <Filter size={13} />
                          </button>
                          {openFilter === col.key && (
                            <div
                              className={["filter-popover", (col.key === "pending" || col.key === "hasTargetLanguage") ? "popover-right" : ""].filter(Boolean).join(" ")}
                              ref={filterRef}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="filter-popover-header">
                                <span>{col.label}</span>
                                <button
                                  className="filter-popover-clear"
                                  onClick={() => { handleFilterChange(col.key, null); }}
                                  type="button"
                                  data-tooltip={t(language, "tooltip.clearFilter")}
                                >
                                  <X size={13} />
                                </button>
                              </div>
                              {(col.key === "fileName" || col.key === "modId") && (
                                <input
                                  type="text"
                                  value={(filters[col.key] as string) || ""}
                                  onChange={(e) => handleFilterChange(col.key, e.target.value)}
                                  placeholder={t(language, "dashboard.filterSearch")}
                                  autoFocus
                                />
                              )}
                              {col.key === "formats" && (
                                <select
                                  value={(filters.formats as string) || ""}
                                  onChange={(e) => handleFilterChange("formats", e.target.value || null)}
                                  autoFocus
                                >
                                  <option value="">全部格式</option>
                                  <option value="json">json</option>
                                  <option value="lang">lang</option>
                                </select>
                              )}
                              {(col.key === "languageFileCount" || col.key === "pending") && (
                                <div>
                                  <div className="number-range-row">
                                    <span>从</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={(filters[col.key] as any)?.min ?? ""}
                                      onChange={(e) => {
                                        const prev = (filters[col.key] as any) || {};
                                        handleFilterChange(col.key, { min: e.target.value === "" ? undefined : Number(e.target.value), max: prev.max });
                                      }}
                                      autoFocus
                                    />
                                  </div>
                                  <div className="number-range-row">
                                    <span>到</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={(filters[col.key] as any)?.max ?? ""}
                                      onChange={(e) => {
                                        const prev = (filters[col.key] as any) || {};
                                        handleFilterChange(col.key, { min: prev.min, max: e.target.value === "" ? undefined : Number(e.target.value) });
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                              {col.key === "hasTargetLanguage" && (
                                <select
                                  value={(filters.hasTargetLanguage as string) ?? ""}
                                  onChange={(e) => handleFilterChange("hasTargetLanguage", e.target.value ?? null)}
                                  autoFocus
                                >
                                  <option value="">全部状态</option>
                                  <option value="true">{t(language, "dashboard.hasTarget")}</option>
                                  <option value="false">{t(language, "dashboard.needsTranslation")}</option>
                                </select>
                              )}
                            </div>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {scanSummary && processedMods.length === 0 && (
                  <tr>
                    <td colSpan={6}>{t(language, "dashboard.filterEmpty")}</td>
                  </tr>
                )}
                {processedMods.map((mod) => (
                  <tr key={mod.jarPath}>
                    <td
                      className="copy-cell mod-name"
                      onClick={() => copyFlash(mod.fileName, `n-${mod.jarPath}`)}
                      onKeyDown={(e) => e.key === "Enter" && copyFlash(mod.fileName, `n-${mod.jarPath}`)}
                      tabIndex={0}
                      title={mod.fileName}
                    >
                      {mod.fileName}
                      {copiedKey === `n-${mod.jarPath}` && <span className="copy-flash">{t(language, "common.copied")}</span>}
                    </td>
                    <td
                      className="copy-cell mod-id"
                      onClick={() => copyFlash(mod.modId, `i-${mod.jarPath}`)}
                      onKeyDown={(e) => e.key === "Enter" && copyFlash(mod.modId, `i-${mod.jarPath}`)}
                      tabIndex={0}
                      title={mod.modId}
                    >
                      {mod.modId}
                      {copiedKey === `i-${mod.jarPath}` && <span className="copy-flash">{t(language, "common.copied")}</span>}
                    </td>
                    <td>{mod.formats.join(" / ") || "-"}</td>
                    <td>{mod.languageFileCount}</td>
                    <td>{getPending(mod)}</td>
                    <td>
                      <span className={mod.hasTargetLanguage ? "badge success" : "badge muted"}>
                        {mod.hasTargetLanguage ? t(language, "dashboard.hasTarget") : t(language, "dashboard.needsTranslation")}
                      </span>
                    </td>
                  </tr>
                ))}
                {!scanSummary && (
                  <tr>
                    <td colSpan={6}>{t(language, "dashboard.emptyScan")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </section>
  );
}

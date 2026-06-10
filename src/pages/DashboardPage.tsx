import { AlertTriangle, ChevronDown, FolderOpen, Loader2, Package, RefreshCcw, ScanLine, Square, Zap } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useSortFilter } from "../hooks/useSortFilter";
import { cancelScan, saveSettings, scanAndDiff, scanInstance } from "../api/tauri";
import { localeByAppLanguage, t } from "../i18n/translations";
import { useAppStore } from "../stores/appStore";
import { CompletionSummary } from "../components/CompletionSummary";
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { SortableTableHeader, type ColumnConfig } from "../components/SortableTableHeader";
import type { AppLanguage, ModScanResult, ScanProgressEvent, ScanSummary, ScanWarning, Settings } from "../types";
import type { TranslationKey } from "../i18n/translations";

interface Props {
  settings?: Settings;
  scanSummary?: ScanSummary | null;
  onSettingsChange?: (settings: Settings) => void;
  onScanSummaryChange?: (summary: ScanSummary | null) => void;
  language: AppLanguage;
  onBusyChange?: (busy: boolean) => void;
  onCompleteChange?: (completed: boolean) => void;
}

const ModRow = React.memo(({ mod, copiedKey, copyFlash, getPending, language }: {
  mod: ModScanResult;
  copiedKey: string | null;
  copyFlash: (text: string, key: string) => Promise<void>;
  getPending: (mod: ModScanResult) => number;
  language: AppLanguage;
}) => (
  <tr>
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
));

function CollapsibleWarnings({ warnings, language }: { warnings: ScanWarning[]; language: AppLanguage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="warnings-collapsible">
      <button
        className="warnings-toggle"
        onClick={() => setExpanded((p) => !p)}
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

export const DashboardPage = React.memo(function DashboardPage({
  settings: _settings,
  scanSummary: _scanSummary,
  language,
  onBusyChange,
  onCompleteChange,
  onSettingsChange,
  onScanSummaryChange,
}: Props) {
  const settings = _settings!;
  const scanSummary = _scanSummary;
  const [instancePath, setInstancePath] = useState(settings.instancePath);
  const [isScanning, setIsScanning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const isScanningRef = useRef(isScanning);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<{ newModCount: number; newMods: string[]; pendingEntries: number } | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const setScanElapsedMs = useAppStore((s) => s.setScanElapsedMs);
  const scanElapsedMs = useAppStore((s) => s.scanElapsedMs);

  useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);

  useEffect(() => {
    onBusyChange?.(isScanning);
  }, [isScanning, onBusyChange]);

  const prevIsScanning = useRef(isScanning);
  useEffect(() => {
    if (prevIsScanning.current && !isScanning && scanSummary && !scanSummary.cancelled && !error) {
      onCompleteChange?.(true);
    }
    prevIsScanning.current = isScanning;
  }, [isScanning, scanSummary, error, onCompleteChange]);

  // When instance path changes, clear completed state (user is setting up a new scan target)
  useEffect(() => {
    if (instancePath && settings.instancePath && instancePath !== settings.instancePath) {
      onBusyChange?.(false);
      setScanElapsedMs(null);
    }
  }, [instancePath, settings.instancePath, onBusyChange]);

  const [searchText, setSearchText] = useState("");
  const [resourcePacksCollapsed, setResourcePacksCollapsed] = useState(true);
  const debouncedSearch = useDebouncedValue(searchText, 200);
  const sf = useSortFilter<Record<string, string | { min?: number; max?: number }>>();
  const copyFlash = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    } catch (err) {
      console.warn("clipboard copy failed:", err);
    }
  }, []);

  const stageLabel = (phase: string): string => {
    const key = `dashboard.stage.${phase}` as TranslationKey;
    const translated = t(language, key);
    return translated || phase;
  };

  const numberLocale = localeByAppLanguage[language];
  const progressPercent = (p: ScanProgressEvent) =>
    p.total === 0 ? 0 : Math.min(Math.round((p.current / p.total) * 100), 100);
  const stats = useMemo(
    () => [
      { label: t(language, "dashboard.stats.mods"), value: scanSummary?.mods.length ?? 0, hint: t(language, "dashboard.stats.modsHint") },
      { label: t(language, "dashboard.stats.pendingEntries"), value: scanSummary?.totalPendingEntries ?? 0, hint: "" },
      { label: t(language, "dashboard.stats.resourcePackCovered"), value: scanSummary?.resourcePackCoveredEntries ?? 0, hint: t(language, "dashboard.stats.resourcePackCoveredHint") },
      { label: t(language, "dashboard.stats.actualPending"), value: scanSummary?.actualPendingEntries ?? 0, hint: t(language, "dashboard.stats.actualPendingHint") },
    ],
    [language, scanSummary],
  );

  const dashboardColumns: ColumnConfig[] = useMemo(
    () => [
      { key: "fileName", label: t(language, "dashboard.column.mod"), filterType: "text" },
      { key: "modId", label: t(language, "dashboard.column.modId"), filterType: "text" },
      {
        key: "formats",
        label: t(language, "dashboard.column.format"),
        filterType: "select",
        filterOptions: [
          { value: "json", label: "json" },
          { value: "lang", label: "lang" },
        ],
      },
      { key: "languageFileCount", label: t(language, "dashboard.column.langFiles"), filterType: "number-range" },
      { key: "pending", label: t(language, "dashboard.column.pending"), filterType: "number-range" },
      {
        key: "hasTargetLanguage",
        label: t(language, "dashboard.column.status"),
        filterType: "select",
        filterOptions: [
          { value: "true", label: t(language, "dashboard.hasTarget") },
          { value: "false", label: t(language, "dashboard.needsTranslation") },
        ],
      },
    ],
    [language],
  );

  const processedMods = useMemo(() => {
    const mods = scanSummary?.mods ?? [];
    let result = mods;

    const activeFilterKeys = Object.keys(sf.filters);
    if (activeFilterKeys.length > 0) {
      result = result.filter((mod) =>
        activeFilterKeys.every((col) => {
          const value = sf.filters[col];
          if (value == null) return true;
          switch (col) {
            case "fileName":
              return typeof value === "string" && (
                mod.fileName.toLowerCase().includes(value.toLowerCase()) ||
                mod.modId.toLowerCase().includes(value.toLowerCase())
              );
            case "modId":
              return typeof value === "string" && mod.modId.toLowerCase().includes(value.toLowerCase());
            case "formats":
              return typeof value === "string" && (value === "" || mod.formats.some((f) => f === value));
            case "languageFileCount":
              return inRange(mod.languageFileCount, value);
            case "pending":
              return inRange(getPending(mod), value);
            case "hasTargetLanguage":
              if (value === "") return true;
              return mod.hasTargetLanguage === (value === "true");
            default:
              return true;
          }
        }),
      );
    }

    if (sf.sortConfig) {
      const sc = sf.sortConfig;
      result = [...result].sort((a, b) => {
        const dir = sc.direction === "asc" ? 1 : -1;
        let cmp = 0;
        switch (sc.key) {
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

    return result;
  }, [scanSummary?.mods, sf.sortConfig, sf.filters]);

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

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await cancelScan();
      // Let handleScan's finally block reset UI.
      // Add a timeout safety net in case something goes wrong.
      setTimeout(() => {
        if (isScanningRef.current) {
          setIsScanning(false);
          setIsCancelling(false);
          setScanElapsedMs(null);
        }
      }, 3000);
    } catch (err) {
      console.error("cancel scan failed:", err);
      setError("Cancel scan failed: " + (err instanceof Error ? err.message : String(err)));
      setScanElapsedMs(null);
      setIsCancelling(false);
    }
  }

  async function handleScan() {
    startTimeRef.current = performance.now();
    setScanElapsedMs(null);
    setIsScanning(true);
    setIsCancelling(false);
    onBusyChange?.(false);
    onScanSummaryChange?.(null);
    setScanProgress(null);
    setError("");
    setSearchText("");
    sf.resetFilters();
    try {
      const nextSettings = { ...settings, instancePath };
      onSettingsChange?.(nextSettings);
      await saveSettings(nextSettings);
      const summary = await scanInstance(
        instancePath,
        nextSettings.sourceLanguage,
        nextSettings.targetLanguage,
      );
      onScanSummaryChange?.(summary);
      if (!summary.cancelled) {
        const elapsed = performance.now() - (startTimeRef.current ?? performance.now());
        setScanElapsedMs(elapsed);
      } else {
        setScanElapsedMs(null);
      }
    } catch (scanError) {
      setScanElapsedMs(null);
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setIsScanning(false);
      setIsCancelling(false);
      startTimeRef.current = null;
    }
  }

  /** 重新扫描：检测新模组，弹窗让用户确认补翻 */
  async function handleRescan() {
    if (!("__TAURI_INTERNALS__" in window)) {
      handleScan();
      return;
    }
    startTimeRef.current = performance.now();
    setScanElapsedMs(null);
    setIsScanning(true);
    setError("");
    setDiffResult(null);
    try {
      const nextSettings = { ...settings, instancePath };
      onSettingsChange?.(nextSettings);
      await saveSettings(nextSettings);
      const result = await scanAndDiff(
        instancePath,
        nextSettings.sourceLanguage,
        nextSettings.targetLanguage,
      );
      onScanSummaryChange?.(result.newSummary);
      if (!result.newSummary.cancelled) {
        const elapsed = performance.now() - (startTimeRef.current ?? performance.now());
        setScanElapsedMs(elapsed);
        if (result.newModCount > 0) {
          // 使用后端计算的 actualPendingEntries 作为待翻译条目数
          const pendingEntries = result.newSummary.actualPendingEntries;
          setDiffResult({
            newModCount: result.newModCount,
            newMods: result.newMods,
            pendingEntries,
          });
        }
      } else {
        setScanElapsedMs(null);
      }
    } catch (scanError) {
      setScanElapsedMs(null);
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setIsScanning(false);
      startTimeRef.current = null;
    }
  }

  // Sync debounced search text into filters (avoids per-keystroke re-render of full table)
  useEffect(() => {
    sf.handleFilterChange("fileName", debouncedSearch);
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const getPending = useCallback((mod: ModScanResult): number => {
    return pendingCache.get(mod.jarPath) ?? 0;
  }, [pendingCache]);

  function inRange(actual: number, filter: unknown): boolean {
    if (typeof filter !== "object" || filter === null) return true;
    const range = filter as { min?: number; max?: number };
    return (!range.min || actual >= range.min) &&
           (!range.max || actual <= range.max);
  }

  function getScanButtonState(): {
    className: string;
    disabled: boolean;
    icon: JSX.Element;
    text: string;
    tooltipKey: TranslationKey;
  } {
    if (isCancelling) {
      return {
        className: "primary-button cancelling",
        disabled: true,
        icon: <Loader2 size={18} className="spin" />,
        text: t(language, "dashboard.cancelling"),
        tooltipKey: "tooltip.cancelScan",
      };
    }
    if (isScanning) {
      return {
        className: "primary-button danger",
        disabled: false,
        icon: <Square size={18} />,
        text: t(language, "dashboard.cancel"),
        tooltipKey: "tooltip.cancelScan",
      };
    }
    return {
      className: "primary-button",
      disabled: false,
      icon: <ScanLine size={18} />,
      text: scanSummary ? t(language, "dashboard.rescan") : t(language, "dashboard.scan"),
      tooltipKey: scanSummary ? "tooltip.rescan" : "tooltip.scan",
    };
  }

  const scanBtn = getScanButtonState();

  return (
    <section className="page dashboard-page">
      <PageHeader
        title={t(language, "dashboard.title")}
        subtitle={t(language, "dashboard.subtitle")}
        actions={
          <button
            className={scanBtn.className}
            disabled={scanBtn.disabled}
            onClick={isScanning ? handleCancel : (scanSummary ? handleRescan : handleScan)}
            type="button"
            data-tooltip={t(language, scanBtn.tooltipKey)}
          >
            {scanBtn.icon}
            {scanBtn.text}
          </button>
        }
      />

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
      </div>

      {/* During scan: show progress bar */}
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
          {(scanProgress.subStep || scanProgress.modName) && (
            <small className="scan-progress-mod">
              {scanProgress.subStep || scanProgress.modName}
            </small>
          )}
        </div>
      )}

      {/* After scan completes successfully: show completion summary */}
      {!isScanning && scanSummary && !scanSummary.cancelled && !error && scanElapsedMs !== null && (
        <CompletionSummary
          title={t(language, "summary.scanCompleted")}
          elapsedMs={scanElapsedMs}
          primaryMetrics={[
            {
              icon: <Package size={18} />,
              template: t(language, "summary.mods"),
              count: scanSummary.mods.length,
            },
            {
              icon: <Zap size={18} />,
              template: t(language, "summary.modsSpeed"),
              count: scanElapsedMs > 0 ? Math.round((scanSummary.mods.length / (scanElapsedMs / 1000)) * 10) / 10 : 0,
            },
          ]}
        />
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

      {/* ── 增量扫描结果弹窗 ── */}
      {diffResult && diffResult.newModCount > 0 && (
        <div className="alert info" style={{ marginTop: 12 }}>
          <Zap size={17} />
          <div style={{ flex: 1 }}>
            <strong>{t(language, "dashboard.newModsFound", { count: diffResult.newModCount })}</strong>
            <p style={{ margin: "4px 0", fontSize: 13, color: "var(--text-muted)" }}>
              {t(language, "dashboard.newPendingEntries", { count: diffResult.pendingEntries })}
            </p>
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 20, fontSize: 12 }}>
              {diffResult.newMods.slice(0, 10).map((id) => (
                <li key={id}>{id}</li>
              ))}
              {diffResult.newMods.length > 10 && (
                <li style={{ color: "var(--text-muted)" }}>{t(language, "dashboard.andMore", { count: diffResult.newMods.length - 10 })}</li>
              )}
            </ul>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
            <button
              className="ghost-button"
              onClick={() => setDiffResult(null)}
              type="button"
              style={{ fontSize: 13 }}
            >
              {t(language, "dashboard.gotIt")}
            </button>
          </div>
        </div>
      )}

      {scanSummary && scanSummary.warnings.length > 0 && (
        <CollapsibleWarnings warnings={scanSummary.warnings} language={language} />
      )}

      <div className="stats-grid">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <span className="stat-label">{stat.label}</span>
            <span className="stat-value">{stat.value.toLocaleString(numberLocale)}</span>
            {stat.hint && <span className="stat-hint">{stat.hint}</span>}
          </article>
        ))}
        {scanSummary && scanSummary.dictionaryCacheTotal != null && scanSummary.dictionaryCacheTotal > 0 && (
          <article className="stat-card" key="dict-cache">
            <span className="stat-label">{t(language, "dashboard.dictCache")}</span>
            <span className="stat-value">
              {scanSummary.dictionaryCacheHits}/{scanSummary.dictionaryCacheTotal}
            </span>
            <span className="stat-hint">{t(language, "dashboard.dictHitCheck")}</span>
          </article>
        )}
      </div>

      <div className="resource-section">
        <div
          className="resource-section-header"
          onClick={() => setResourcePacksCollapsed((v) => !v)}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}
        >
          <ChevronDown
            size={14}
            style={{
              transition: "transform 0.15s",
              transform: resourcePacksCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
            }}
          />
          {t(language, "dashboard.resourceSources")}
          {scanSummary && scanSummary.resourcePacks.length > 0 && (
            <span style={{ marginLeft: "auto", fontWeight: 400, fontSize: 12, color: "var(--text-muted)" }}>
              {t(language, "dashboard.resourceFilesEntries", { files: scanSummary.resourcePacks.reduce((s, p) => s + p.langFileCount, 0), entries: scanSummary.resourcePacks.reduce((s, p) => s + p.entryCount, 0) })}
            </span>
          )}
        </div>
        {!resourcePacksCollapsed && (
          <div className="resource-section-body">
          {(scanSummary?.resourcePacks ?? []).map((pack) => (
            <div key={pack.path} className="resource-pack">
              <div className="resource-pack-top">
                <span className="resource-pack-name" title={pack.name}>{pack.name}</span>
              </div>
              <div className="resource-pack-meta">
                {t(language, "dashboard.resourceCount", { files: pack.langFileCount, entries: pack.entryCount })}
              </div>
            </div>
          ))}
          {(!scanSummary || scanSummary.resourcePacks.length === 0) && (
            <div className="resource-section-empty">
              {t(language, "dashboard.emptyResource")}
            </div>
          )}
        </div>
      )}
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>{t(language, "dashboard.modsTitle")}</h2>
            <SearchInput
              value={searchText}
              onChange={setSearchText}
              placeholder={t(language, "dashboard.filterSearch")}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <SortableTableHeader
                  columns={dashboardColumns}
                  sortConfig={sf.sortConfig}
                  filters={sf.filters}
                  openFilter={sf.openFilter}
                  filterRef={sf.filterRef}
                  onSort={sf.handleSort}
                  onToggleFilter={sf.toggleFilter}
                  onFilterChange={sf.handleFilterChange}
                  defaultSortKey="fileName"
                  language={language}
                />
              </thead>
              <tbody>
                {scanSummary && processedMods.length === 0 && (
                  <tr>
                    <td colSpan={6}>{t(language, "dashboard.filterEmpty")}</td>
                  </tr>
                )}
                {processedMods.map((mod) => (
                  <ModRow
                    key={mod.jarPath}
                    mod={mod}
                    copiedKey={copiedKey}
                    copyFlash={copyFlash}
                    getPending={getPending}
                    language={language}
                  />
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
});

import {
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  ExternalLink,
  Info,
  Palette,
  Database,
  FileText,
  Languages,
  RefreshCcw,
  Server,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkUpdate as updaterCheck,
  checkLlmConnection,
  checkI18nDictUpdate,
  downloadAndInstallUpdate,
  getAppVersion,
  openPath,
  relaunchApp,
  fetchLlmModels,
  getSystemFonts,
  saveSettings,
  updateI18nDict,
} from "../api/tauri";
import { Toggle } from "../components/Toggle";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import {
  appLanguages,
  minecraftLanguageOptions,
  normalizeAppLanguage,
  t,
} from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";
import type { AppLanguage, I18nDictUpdateInfo, LlmModel, Settings } from "../types";
import { toErrorMessage } from "../utils";

interface Props {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

type SettingsTab = "language" | "appearance" | "api" | "performance" | "reuse" | "logs" | "about";

const tabs = [
  { key: "language", labelKey: "settings.tab.language", icon: Languages },
  { key: "appearance", labelKey: "settings.tab.appearance", icon: Palette },
  { key: "api", labelKey: "settings.tab.api", icon: Server },
  { key: "performance", labelKey: "settings.tab.performance", icon: Cpu },
  { key: "reuse", labelKey: "settings.tab.reuse", icon: Boxes },
  { key: "logs", labelKey: "settings.tab.logs", icon: FileText },
  { key: "about", labelKey: "settings.tab.about", icon: Info },
] as const satisfies ReadonlyArray<{ key: SettingsTab; labelKey: TranslationKey; icon: LucideIcon }>;

const RELEASE_BASE_URL = "https://github.com/Aaalice233/Aaalice_Minecraft_Translator/releases";
const UP_TO_DATE_RESET_MS = 3500;

/** 预设字体键名列表 — 与 CSS [data-font] 选择器对应 */
export const FONT_PRESETS = ["system", "yahei", "noto", "simsun"] as const;

/** 应用主题到文档根元素：accent（强调色）和 darkMode（暗色模式）。 */
export function applyTheme(accent: string | undefined, darkMode: boolean): void {
  document.documentElement.dataset.accent = (!accent || accent === "default") ? "green" : accent;
  document.documentElement.dataset.theme = darkMode ? "dark" : "light";
}

/** 应用字体到文档根元素：预设走 data-font 属性，自定义走 --ui-font CSS 变量 */
export function applyFont(font: string): void {
  const presets: readonly string[] = FONT_PRESETS;
  if (presets.includes(font)) {
    document.documentElement.dataset.font = font;
    document.documentElement.style.removeProperty("--ui-font");
  } else {
    document.documentElement.dataset.font = "";
    const quoted = font.includes(" ") ? `"${font}"` : font;
    document.documentElement.style.setProperty("--ui-font", `${quoted}, sans-serif`);
  }
}

export function SettingsPage({ settings, onSettingsChange }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("language");
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [showCustomModel, setShowCustomModel] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState<"saved" | "saving" | "unsaved">("saved");

  // ── Updater state ────────────────────────────────────────
  const [appVersion, setAppVersion] = useState("...");
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "downloading" | "downloaded" | "uptodate" | "error">("idle");
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body?: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateError, setUpdateError] = useState("");
  const [i18nDictStatus, setI18nDictStatus] = useState<"idle" | "checking" | "available" | "uptodate" | "updating" | "updated" | "error">("idle");
  const [i18nDictInfo, setI18nDictInfo] = useState<I18nDictUpdateInfo | null>(null);
  const [i18nDictError, setI18nDictError] = useState("");

  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => setAppVersion("?"));
  }, []);

  useEffect(() => {
    if (updateStatus !== "uptodate") return;
    const timer = setTimeout(() => {
      setUpdateStatus("idle");
    }, UP_TO_DATE_RESET_MS);
    return () => clearTimeout(timer);
  }, [updateStatus]);

  // Silent check on mount
  useEffect(() => {
    updaterCheck()
      .then((info) => {
        if (info) {
          setUpdateInfo(info);
          setUpdateStatus("available");
        }
      })
      .catch(() => { /* silent */ });
  }, []);

  const language = normalizeAppLanguage(draft.appLanguage);
  const i18nDictEnabled = draft.targetLanguage.trim().toLowerCase() === "zh_cn";
  const releaseNotesVersion = updateInfo?.version || (appVersion === "..." || appVersion === "?" ? "" : appVersion);
  const releaseNotesUrl = releaseNotesVersion
    ? `${RELEASE_BASE_URL}/tag/v${releaseNotesVersion.replace(/^v/i, "")}`
    : RELEASE_BASE_URL;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(settings);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onSettingsChangeRef = useRef(onSettingsChange);
  onSettingsChangeRef.current = onSettingsChange;

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const currentTitle = useMemo(
    () => t(language, tabs.find((tab) => tab.key === activeTab)?.labelKey ?? "settings.title"),
    [activeTab, language],
  );

  const scheduleSave = useCallback(() => {
    setSaveIndicator("unsaved");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveIndicator("saving");
      const d = draftRef.current;
      const s = settingsRef.current;

      const normalizedSourceLanguage = normalizeTranslationLanguage(d.sourceLanguage, true);
      const normalizedTargetLanguage = normalizeTranslationLanguage(d.targetLanguage, false);
      if (!normalizedSourceLanguage) {
        setError(t(normalizeAppLanguage(d.appLanguage), "settings.invalidSourceLanguage"));
        setSaveIndicator("unsaved");
        return;
      }
      if (!normalizedTargetLanguage) {
        setError(t(normalizeAppLanguage(d.appLanguage), "settings.invalidTargetLanguage"));
        setSaveIndicator("unsaved");
        return;
      }

      const nextSettings: Settings = {
        ...d,
        appLanguage: normalizeAppLanguage(d.appLanguage),
        sourceLanguage: normalizedSourceLanguage,
        targetLanguage: normalizedTargetLanguage,
      };

      try {
        await saveSettings(nextSettings);
        setDraft(nextSettings);
        onSettingsChangeRef.current(nextSettings);
        setError("");
        setSaveIndicator("saved");
        lastCommittedRef.current = nextSettings;
      } catch (err) {
        setDraft(s);
        setError(toErrorMessage(err));
        setSaveIndicator("unsaved");
      }
    }, 600);
  }, []);

  /** 立即保存 appLanguage（需要即时刷新侧边栏） */
  const handleAppLanguageChange = useCallback(async (newLanguage: string) => {
    const normalized = normalizeAppLanguage(newLanguage);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDraft((prev) => ({ ...prev, appLanguage: normalized }));
    setMessage("");
    setError("");
    try {
      const updatedSettings = { ...settings, appLanguage: normalized };
      await saveSettings(updatedSettings);
      onSettingsChangeRef.current(updatedSettings);
      setMessage(t(normalized, "settings.saved"));
      setSaveIndicator("saved");
      lastCommittedRef.current = updatedSettings;
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [settings]);

  async function handleFetchModels() {
    setIsFetchingModels(true);
    setError("");
    setMessage("");
    try {
      const result = await fetchLlmModels(draft.baseUrl, draft.apiKey);
      setModels(result.models);
      setShowCustomModel(false);
      if (result.models.length > 0 && !result.models.some((item) => item.id === draft.model)) {
        setDraft(prev => ({ ...prev, model: result.models[0].id }));
      }
      setMessage(t(language, "settings.modelsFetched", { url: result.sourceUrl, count: result.models.length }));
    } catch (fetchError) {
      setError(toErrorMessage(fetchError));
    } finally {
      setIsFetchingModels(false);
    }
  }

  async function handleTestApi() {
    setIsTestingApi(true);
    setError("");
    setMessage("");
    try {
      await checkLlmConnection(draft.baseUrl, draft.apiKey, draft.model);
      setMessage(t(language, "settings.apiTestSuccess"));
    } catch (testError) {
      setError(toErrorMessage(testError));
    } finally {
      setIsTestingApi(false);
    }
  }

  async function handleCheckI18nDict() {
    if (!i18nDictEnabled) return;
    setI18nDictStatus("checking");
    setI18nDictError("");
    try {
      const info = await checkI18nDictUpdate();
      setI18nDictInfo(info);
      setI18nDictStatus(info.updateAvailable ? "available" : "uptodate");
    } catch (err) {
      setI18nDictError(toErrorMessage(err));
      setI18nDictStatus("error");
    }
  }

  async function handleUpdateI18nDict() {
    if (!i18nDictEnabled) return;
    setI18nDictStatus("updating");
    setI18nDictError("");
    setMessage("");
    try {
      const result = await updateI18nDict();
      const info = await checkI18nDictUpdate();
      setI18nDictInfo(info);
      setI18nDictStatus("updated");
      setMessage(t(language, "settings.i18nDictUpdated", { count: result.referenceEntries }));
    } catch (err) {
      setI18nDictError(toErrorMessage(err));
      setI18nDictStatus("error");
    }
  }

  // Sync draft with external settings changes (e.g. dark mode toggle from sidebar)
  useEffect(() => {
    const settingsStr = JSON.stringify(settings);
    const lastStr = JSON.stringify(lastCommittedRef.current);
    if (settingsStr !== lastStr) {
      setDraft(settings);
      lastCommittedRef.current = settings;
    }
  }, [settings]);

  // Lazy-load system fonts when entering the appearance tab
  useEffect(() => {
    if (activeTab === "appearance" && fonts.length === 0 && !isLoadingFonts) {
      setIsLoadingFonts(true);
      getSystemFonts()
        .then(setFonts)
        .catch(() => setFonts([]))
        .finally(() => setIsLoadingFonts(false));
    }
  }, [activeTab, fonts.length, isLoadingFonts]);

  return (
    <section className="page">
      <PageHeader title={t(language, "settings.title")} subtitle={t(language, "settings.subtitle")} />

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="settings-shell">
        <aside className="settings-sidebar" aria-label={t(language, "settings.title")}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                className={activeTab === tab.key ? "settings-tab active" : "settings-tab"}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                type="button"
                data-tooltip={t(language, tab.labelKey)}
              >
                <Icon size={17} />
                <span>{t(language, tab.labelKey)}</span>
              </button>
            );
          })}
        </aside>

        <section className="settings-content">
          <div className="panel-title">
            <h2>{currentTitle}</h2>
            <div className="save-indicator">
              {saveIndicator === "saved" && <span className="save-dot" title={t(language, "settings.saved")} />}
              <span>{t(language, "settings.autosaveHint")}</span>
            </div>
          </div>

          <div key={activeTab} className="tab-fade-in">
            {activeTab === "language" && (
              <div className="settings-card">
                <h3 className="settings-card-header">{t(language, "settings.tab.language")}</h3>
                <div className="settings-card-body">
                  <label className="field">
                    {t(language, "settings.appLanguage")}
                    <select
                      value={draft.appLanguage}
                      onChange={(event) => handleAppLanguageChange(event.target.value)}
                    >
                      {appLanguages.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <LanguageField
                    helpText={t(language, "settings.sourceHint")}
                    label={t(language, "settings.sourceLanguage")}
                    value={draft.sourceLanguage}
                    onChange={(value) => {
                      setDraft(prev => ({ ...prev, sourceLanguage: value }));
                      scheduleSave();
                    }}
                  />
                  <LanguageField
                    helpText={t(language, "settings.targetHint")}
                    label={t(language, "settings.targetLanguage")}
                    value={draft.targetLanguage}
                    onChange={(value) => {
                      setDraft(prev => ({ ...prev, targetLanguage: value }));
                      scheduleSave();
                    }}
                    excludeAuto
                  />
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="settings-card">
                <h3 className="settings-card-header">{t(language, "settings.tab.appearance")}</h3>
                <div className="settings-card-body">
                  <label className="field">
                    {t(language, "settings.uiTheme")}
                    <select
                      value={draft.uiTheme}
                      onChange={(event) => {
                        const newTheme = event.target.value;
                        setDraft(prev => ({ ...prev, uiTheme: newTheme }));
                        applyTheme(newTheme, draft.uiDarkMode);
                        scheduleSave();
                      }}
                    >
                      {(["default", "ocean", "aurora", "gold"] as const).map((key) => (
                        <option key={key} value={key}>{t(language, `settings.uiThemeOption.${key}` as TranslationKey)}</option>
                      ))}
                    </select>
                  </label>
                  <Toggle
                    label={t(language, "settings.uiDarkMode")}
                    checked={draft.uiDarkMode}
                    onChange={(checked) => {
                      setDraft(prev => ({ ...prev, uiDarkMode: checked }));
                      applyTheme(draft.uiTheme, checked);
                      scheduleSave();
                    }}
                  />
                  <label className="field">
                    {t(language, "settings.uiFont")}
                    {isLoadingFonts && <small className="field-hint">{t(language, "settings.loadingFonts")}</small>}
                    <select
                      value={draft.uiFont}
                      onChange={(event) => {
                        const newFont = event.target.value;
                        setDraft(prev => ({ ...prev, uiFont: newFont }));
                        applyFont(newFont);
                        scheduleSave();
                      }}
                    >
                      <optgroup label={t(language, "settings.uiFontPresets")}>
                        {FONT_PRESETS.map((key) => (
                          <option key={key} value={key}>{t(language, `settings.uiFontOption.${key}` as TranslationKey)}</option>
                        ))}
                      </optgroup>
                      {fonts.length > 0 && (
                        <optgroup label={t(language, "settings.uiFontSystem", { count: fonts.length })}>
                          {fonts.map((font) => (
                            <option key={font} value={font}>{font}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "api" && <ApiSettingsTab language={language} draft={draft} setDraft={setDraft} models={models} isFetchingModels={isFetchingModels} isTestingApi={isTestingApi} handleFetchModels={handleFetchModels} handleTestApi={handleTestApi} showCustomModel={showCustomModel} setShowCustomModel={setShowCustomModel} scheduleSave={scheduleSave} />}

            {activeTab === "performance" && (
              <>
                <div className="settings-card">
                  <h3 className="settings-card-header">{t(language, "settings.card.concurrency")}</h3>
                  <div className="settings-card-body two-column">
                    <label className="field">
                      <span>{t(language, "settings.concurrency")}</span>
                      <input
                        type="number" min="1" max="100"
                        value={draft.concurrency}
                        onChange={(e) => {
                          setDraft(prev => ({ ...prev, concurrency: Number(e.target.value) }));
                          scheduleSave();
                        }}
                      />
                      <small>{t(language, "settings.concurrencyHint")}</small>
                    </label>
                    <label className="field">
                      <span>{t(language, "settings.batchSize")}</span>
                      <input
                        type="number" min="1" max="500"
                        value={draft.batchSize}
                        onChange={(e) => {
                          setDraft(prev => ({ ...prev, batchSize: Number(e.target.value) }));
                          scheduleSave();
                        }}
                      />
                      <small>{t(language, "settings.batchSizeHint")}</small>
                    </label>
                  </div>
                </div>
                <div className="settings-card">
                  <h3 className="settings-card-header">{t(language, "settings.card.timeouts")}</h3>
                  <div className="settings-card-body two-column">
                    <label className="field">
                      <span>{t(language, "settings.timeoutSecs")}</span>
                      <input
                        type="number" min="10" max="600"
                        value={draft.timeoutSecs}
                        onChange={(e) => {
                          setDraft(prev => ({ ...prev, timeoutSecs: Number(e.target.value) }));
                          scheduleSave();
                        }}
                      />
                      <small>{t(language, "settings.timeoutSecsHint")}</small>
                    </label>
                    <label className="field">
                      <span>{t(language, "settings.retryCount")}</span>
                      <input
                        type="number" min="0" max="20"
                        value={draft.retryCount}
                        onChange={(e) => {
                          setDraft(prev => ({ ...prev, retryCount: Number(e.target.value) }));
                          scheduleSave();
                        }}
                      />
                      <small>{t(language, "settings.retryCountHint")}</small>
                    </label>
                    <label className="field">
                      <span>{t(language, "settings.autoRetryCount")}</span>
                      <input
                        type="number" min="0" max="20"
                        value={draft.autoRetryCount}
                        onChange={(e) => {
                          setDraft(prev => ({ ...prev, autoRetryCount: Number(e.target.value) }));
                          scheduleSave();
                        }}
                      />
                      <small>{t(language, "settings.autoRetryCountHint")}</small>
                    </label>
                    <label className="field" style={{ gridColumn: "1 / -1" }}>
                      <span>{t(language, "settings.rateLimitRpm")}</span>
                      <input
                        type="number" min="0" max="100000"
                        value={draft.rateLimitRpm}
                        onChange={(e) => {
                          setDraft(prev => ({ ...prev, rateLimitRpm: Number(e.target.value) }));
                          scheduleSave();
                        }}
                      />
                      <small>{t(language, "settings.rateLimitRpmHint")}</small>
                    </label>
                  </div>
                </div>
              </>
            )}

            {activeTab === "reuse" && (
              <>
                <div className="settings-card">
                  <h3 className="settings-card-header">{t(language, "settings.card.dictionary")}</h3>
                  <div className="settings-card-body">
                    <Toggle
                      label={t(language, "settings.preferDictionary")}
                      checked={draft.preferUserDictionary}
                      onChange={(checked) => {
                        setDraft(prev => ({ ...prev, preferUserDictionary: checked }));
                        scheduleSave();
                      }}
                    />
                    <div className="field">
                      <span>{t(language, "settings.i18nDictTitle")}</span>
                      <small>{t(language, "settings.i18nDictDescription")}</small>
                      <small>{t(language, "settings.i18nDictTargetOnly")}</small>
                    </div>
                    {i18nDictInfo && (
                      <div className="empty-state compact" style={{ alignItems: "flex-start" }}>
                        <span>{t(language, "settings.i18nDictInstalled", { count: i18nDictInfo.referenceEntries })}</span>
                        <span>{t(language, "settings.i18nDictCurrent", { tag: i18nDictInfo.currentTag ?? "-" })}</span>
                        <span>{t(language, "settings.i18nDictLatest", { tag: i18nDictInfo.latestTag })}</span>
                      </div>
                    )}
                    <div className="inline-control update-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!i18nDictEnabled || i18nDictStatus === "checking" || i18nDictStatus === "updating"}
                        onClick={handleCheckI18nDict}
                      >
                        <RefreshCcw size={16} />
                        {i18nDictStatus === "checking" ? t(language, "settings.i18nDictChecking") : t(language, "settings.i18nDictCheck")}
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!i18nDictEnabled || i18nDictStatus === "checking" || i18nDictStatus === "updating"}
                        onClick={handleUpdateI18nDict}
                      >
                        <Database size={16} />
                        {i18nDictStatus === "updating" ? t(language, "settings.i18nDictUpdating") : t(language, "settings.i18nDictUpdate")}
                      </button>
                    </div>
                    {i18nDictStatus === "available" && (
                      <span>{t(language, "settings.i18nDictUpdateAvailable")}</span>
                    )}
                    {i18nDictStatus === "uptodate" && (
                      <span>{t(language, "settings.i18nDictUpToDate")}</span>
                    )}
                    {i18nDictStatus === "error" && i18nDictError && (
                      <div className="alert error">{i18nDictError}</div>
                    )}
                  </div>
                </div>
                <div className="settings-card">
                  <h3 className="settings-card-header">{t(language, "settings.translationPacks")}</h3>
                  <div className="settings-card-body">
                    <ChipInput
                      language={language}
                      values={draft.resourcePackNames ?? []}
                      onChange={(newValues) => {
                        setDraft(prev => ({ ...prev, resourcePackNames: newValues }));
                        scheduleSave();
                      }}
                      placeholder={t(language, "settings.packPlaceholder")}
                      addLabel={t(language, "settings.addPack")}
                    />
                    <small style={{ color: "#6b665d", fontSize: 12 }}>
                      {t(language, "settings.resourcePackHint")}
                    </small>
                    <small style={{ color: "#6b665d", fontSize: 12, display: "block", marginTop: 4 }}>
                      {t(language, "settings.placeholderHint")}
                    </small>
                  </div>
                </div>
                <div className="settings-card">
                  <h3 className="settings-card-header">{t(language, "settings.outputPackName")}</h3>
                  <div className="settings-card-body">
                    <label className="field">
                      <span>{t(language, "settings.outputPackName")}</span>
                      <input
                        type="text"
                        value={draft.outputPackName ?? ""}
                        onChange={(e) => {
                          setDraft(prev => ({ ...prev, outputPackName: e.target.value }));
                          scheduleSave();
                        }}
                      />
                    </label>
                    <small style={{ color: "#6b665d", fontSize: 12 }}>
                      {t(language, "settings.placeholderHint")}
                    </small>
                  </div>
                </div>
              </>
            )}

            {activeTab === "logs" && (
              <div className="settings-card">
                <h3 className="settings-card-header">{t(language, "settings.tab.logs")}</h3>
                <div className="settings-card-body">
                  <Toggle
                    label={t(language, "settings.resetMainLog")}
                    checked={draft.resetMainLogOnStart}
                    onChange={(checked) => {
                      setDraft(prev => ({ ...prev, resetMainLogOnStart: checked }));
                      scheduleSave();
                    }}
                  />
                  <Toggle
                    label={t(language, "settings.enableDebug")}
                    checked={draft.enableDebugLog}
                    onChange={(checked) => {
                      setDraft(prev => ({ ...prev, enableDebugLog: checked }));
                      scheduleSave();
                    }}
                  />
                  <Toggle
                    label={t(language, "settings.enableHttp")}
                    checked={draft.enableHttpLog}
                    onChange={(checked) => {
                      setDraft(prev => ({ ...prev, enableHttpLog: checked }));
                      scheduleSave();
                    }}
                  />
                </div>
              </div>
            )}

            {activeTab === "about" && (
              <div className="settings-card">
                <h3 className="settings-card-header">{t(language, "settings.aboutAndUpdate")}</h3>
                <div className="settings-card-body">
                  <div className="field">
                    <span>{t(language, "settings.currentVersion")}</span>
                    <span style={{ fontWeight: 600 }}>v{appVersion}</span>
                  </div>

                  <div className="inline-control update-actions">
                    <button className="ghost-button stable-action" disabled={updateStatus === "checking" || updateStatus === "downloading"} onClick={async () => {
                        setUpdateStatus("checking");
                        setUpdateError("");
                        try {
                          const info = await updaterCheck();
                          if (info) {
                            setUpdateInfo(info);
                            setUpdateStatus("available");
                          } else {
                            setUpdateStatus("uptodate");
                          }
                        } catch (err) {
                          setUpdateError(toErrorMessage(err));
                          setUpdateStatus("error");
                        }
                      }} type="button">
                      <RefreshCcw size={16} className={updateStatus === "checking" ? "spinning" : undefined} />
                      {updateStatus === "checking" ? t(language, "settings.checkingUpdate") : t(language, "settings.checkUpdate")}
                    </button>
                    <button className="ghost-button stable-action" onClick={() => openPath(releaseNotesUrl).catch((err) => setUpdateError(toErrorMessage(err)))} type="button">
                      <ExternalLink size={16} />
                      {t(language, "settings.viewReleaseNotes")}
                    </button>
                  </div>

                  {updateStatus === "checking" && <span>{t(language, "settings.checkUpdate")}…</span>}

                  {updateStatus === "available" && updateInfo && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span>{t(language, "settings.updateAvailable", { version: updateInfo.version })}</span>
                      {updateInfo.body && <small>{t(language, "settings.updateReleaseNotes")}: {updateInfo.body}</small>}
                      <progress value={downloadProgress} max={100} style={{ width: "100%" }} />
                      <div className="inline-control update-actions">
                        <button className="ghost-button" onClick={async () => {
                          setUpdateStatus("downloading");
                          setDownloadProgress(0);
                          try {
                            await downloadAndInstallUpdate((p) => setDownloadProgress(p));
                            setUpdateStatus("downloaded");
                          } catch (err) {
                            setUpdateError(toErrorMessage(err));
                            setUpdateStatus("error");
                          }
                        }} type="button">
                          {t(language, "settings.installNow")}
                        </button>
                        <button className="ghost-button stable-action" onClick={() => openPath(releaseNotesUrl).catch((err) => setUpdateError(toErrorMessage(err)))} type="button">
                          <ExternalLink size={16} />
                          {t(language, "settings.viewReleaseNotes")}
                        </button>
                      </div>
                    </div>
                  )}

                  {updateStatus === "downloading" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span>{t(language, "settings.downloading", { percent: downloadProgress })}</span>
                      <progress value={downloadProgress} max={100} style={{ width: "100%" }} />
                    </div>
                  )}

                  {updateStatus === "downloaded" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span>{t(language, "settings.downloadComplete")}</span>
                      <button className="ghost-button" onClick={async () => {
                        try { await relaunchApp(); } catch (err) { setUpdateError(toErrorMessage(err)); }
                      }}>
                        {t(language, "settings.installNow")}
                      </button>
                    </div>
                  )}

                  {updateStatus === "uptodate" && <span>{t(language, "settings.upToDate")}</span>}

                  {updateStatus === "error" && updateError && (
                    <div className="alert error" style={{ marginTop: 8 }}>{updateError}</div>
                  )}
                  <div className="about-links">
                    <p>{t(language, "settings.aboutIntro")}</p>
                    <button className="text-button" type="button" onClick={() => openPath("https://github.com/Aaalice233/Aaalice_Minecraft_Translator").catch((err) => setUpdateError(toErrorMessage(err)))}>
                      <ExternalLink size={14} />
                      {t(language, "settings.projectHome")}
                    </button>
                    <button className="text-button" type="button" onClick={() => openPath("https://space.bilibili.com/169187367?spm_id_from=333.1007.0.0").catch((err) => setUpdateError(toErrorMessage(err)))}>
                      <ExternalLink size={14} />
                      {t(language, "settings.bilibiliHome")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

// ── Chip Input ────────────────────────────────

interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  addLabel: string;
  language: AppLanguage;
}

function ChipInput({ values, onChange, placeholder, addLabel, language }: ChipInputProps) {
  const [inputValue, setInputValue] = useState("");

  const addChip = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setInputValue("");
    }
  };

  return (
    <div className="chip-input">
      {values.length > 0 && (
        <div className="chip-list">
          {values.map((v, i) => (
            <span key={i} className="chip">
              <span className="chip-label" title={v}>{v}</span>
              <button
                className="chip-remove"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                type="button"
                aria-label={t(language, "common.remove")}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chip-add-row">
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addChip();
            }
          }}
          placeholder={placeholder}
        />
        <button className="ghost-button" onClick={addChip} type="button" style={{ flexShrink: 0 }}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}

// ── Language Field ─────────────────────────────

interface LanguageFieldProps {
  label: string;
  value: string;
  helpText: string;
  excludeAuto?: boolean;
  onChange: (value: string) => void;
}

function LanguageField({
  label,
  value,
  helpText,
  excludeAuto = false,
  onChange,
}: LanguageFieldProps) {
  const options = minecraftLanguageOptions.filter((item) => !excludeAuto || item.code !== "auto");
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        {options.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
      <small>{helpText}</small>
    </label>
  );
}

// ── Helpers ───────────────────────────────────

function normalizeTranslationLanguage(value: string, allowAuto: boolean): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto") return allowAuto ? normalized : null;
  if (/^[a-z]{2,3}_[a-z0-9]{2,8}$/.test(normalized)) return normalized;
  return null;
}

// ── API Settings Tab ──────────────────────────

const PROVIDER_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

interface ApiSettingsTabProps {
  language: AppLanguage;
  draft: Settings;
  setDraft: React.Dispatch<React.SetStateAction<Settings>>;
  models: LlmModel[];
  isFetchingModels: boolean;
  isTestingApi: boolean;
  handleFetchModels: () => Promise<void>;
  handleTestApi: () => Promise<void>;
  showCustomModel: boolean;
  setShowCustomModel: React.Dispatch<React.SetStateAction<boolean>>;
  scheduleSave: () => void;
}

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  deepseek: <Bot size={16} />,
  openai: <Cloud size={16} />,
};

function ApiSettingsTab({ language, draft, setDraft, models, isFetchingModels, isTestingApi, handleFetchModels, handleTestApi, showCustomModel, setShowCustomModel, scheduleSave }: ApiSettingsTabProps) {
  const PROVIDER_OPTIONS = [
    { value: "deepseek", label: "DeepSeek" },
    { value: "openai", label: t(language, "settings.providerOpenai") },
  ] as const;

  const [providerOpen, setProviderOpen] = useState(false);
  const providerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!providerOpen) return;
    const handler = (e: MouseEvent) => {
      if (providerRef.current && !providerRef.current.contains(e.target as Node)) {
        setProviderOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [providerOpen]);

  const selectProvider = useCallback((provider: string) => {
    const preset = PROVIDER_PRESETS[provider];
    if (preset) {
      setDraft((prev) => ({
        ...prev,
        provider,
        baseUrl: preset.baseUrl,
        model: prev.provider !== provider ? preset.model : prev.model,
      }));
    } else {
      setDraft((prev) => ({ ...prev, provider }));
    }
    setProviderOpen(false);
    scheduleSave();
  }, [setDraft, scheduleSave]);

  return (
    <>
      <div className="settings-card">
        <h3 className="settings-card-header">
          <Server size={14} className="card-header-icon" />
          {t(language, "settings.provider")}
        </h3>
        <div className="settings-card-body two-column">
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>{t(language, "settings.provider")}</span>
            <div className="provider-select-wrap" ref={providerRef}>
              <button
                className="provider-select-btn"
                type="button"
                onClick={() => setProviderOpen((p) => !p)}
              >
                <span className="provider-select-label">
                  {PROVIDER_ICONS[draft.provider]}
                  {PROVIDER_OPTIONS.find((o) => o.value === draft.provider)?.label || draft.provider}
                </span>
                <ChevronDown size={14} className={`provider-chevron ${providerOpen ? "open" : ""}`} />
              </button>
              {providerOpen && (
                <div className="provider-dropdown">
                  {PROVIDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`provider-option${draft.provider === opt.value ? " selected" : ""}`}
                      type="button"
                      onClick={() => selectProvider(opt.value)}
                    >
                      {PROVIDER_ICONS[opt.value]}
                      <span>{opt.label}</span>
                      {draft.provider === opt.value && <Check size={14} className="provider-check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>
          <Field
            label={t(language, "settings.baseUrl")}
            value={draft.baseUrl}
            onChange={(value) => {
              setDraft((prev) => ({ ...prev, baseUrl: value }));
              scheduleSave();
            }}
          />
          <Field
            label={t(language, "settings.apiKey")}
            type="password"
            value={draft.apiKey}
            onChange={(value) => {
              setDraft((prev) => ({ ...prev, apiKey: value }));
              scheduleSave();
            }}
          />
        </div>
      </div>
      <div className="settings-card">
        <h3 className="settings-card-header">
          <Bot size={14} className="card-header-icon" />
          {t(language, "settings.modelLabel")}
        </h3>
        <div className="settings-card-body">
          <label className="field">
            {t(language, "settings.modelLabel")}
            <div className="inline-control api-model-control">
              {showCustomModel || models.length === 0 ? (
                <input
                  value={draft.model}
                  onChange={(event) => {
                    setDraft((prev) => ({ ...prev, model: event.target.value }));
                    scheduleSave();
                  }}
                  placeholder={
                    models.length === 0
                      ? draft.model
                      : t(language, "settings.modelPlaceholder")
                  }
                />
              ) : (
                <select
                  value={models.some((item) => item.id === draft.model) ? draft.model : ""}
                  onChange={(event) => {
                    setDraft((prev) => ({ ...prev, model: event.target.value }));
                    scheduleSave();
                  }}
                >
                  <option value="" disabled>
                    {t(language, "settings.selectModel")}
                  </option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                      {model.ownedBy ? ` (${model.ownedBy})` : ""}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="ghost-button"
                disabled={isFetchingModels || !draft.baseUrl || !draft.apiKey}
                onClick={handleFetchModels}
                type="button"
                data-tooltip={t(language, "tooltip.fetchModels")}
              >
                <RefreshCcw size={17} />
                {t(language, "settings.fetchModels")}
              </button>
              <button
                className="ghost-button"
                disabled={isTestingApi || !draft.baseUrl || !draft.apiKey || !draft.model}
                onClick={handleTestApi}
                type="button"
                data-tooltip={t(language, "tooltip.testApi")}
              >
                <Check size={17} />
                {isTestingApi ? t(language, "settings.testingApi") : t(language, "settings.testApi")}
              </button>
            </div>
            {!showCustomModel && models.length > 0 && (
              <button
                className="text-button"
                onClick={() => setShowCustomModel(true)}
                type="button"
              >
                {t(language, "settings.customModel")}
              </button>
            )}
            {showCustomModel && (
              <button
                className="text-button"
                onClick={() => setShowCustomModel(false)}
                type="button"
              >
                {t(language, "settings.pickFromList")}
              </button>
            )}
          </label>
        </div>
      </div>
      <div className="settings-card">
        <h3 className="settings-card-header">
          <Cpu size={14} className="card-header-icon" />
          {t(language, "settings.card.apiParams")}
        </h3>
        <div className="settings-card-body two-column">
          <label className="field">
            <span>{t(language, "settings.temperature")}</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={draft.temperature}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, temperature: Number(event.target.value) }));
                scheduleSave();
              }}
            />
            <small>{t(language, "settings.temperatureHint")}</small>
          </label>
          <label className="field">
            <span>{t(language, "settings.maxTokens")}</span>
            <input
              type="number"
              min="0"
              max={999999}
              step="1"
              value={draft.maxTokens === 0 ? "" : draft.maxTokens}
              placeholder={t(language, "settings.maxTokensPlaceholder")}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, maxTokens: event.target.value === "" ? 0 : Number(event.target.value) }));
                scheduleSave();
              }}
            />
            <small>{t(language, "settings.maxTokensHint")}</small>
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>{t(language, "settings.systemPrompt")}</span>
            <textarea
              rows={6}
              value={draft.systemPrompt}
              onChange={(e) => {
                setDraft((prev) => ({ ...prev, systemPrompt: e.target.value }));
                scheduleSave();
              }}
              style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 1.5, width: "100%" }}
            />
            <small>{t(language, "settings.systemPromptHint")}</small>
          </label>
        </div>
      </div>
    </>
  );
}

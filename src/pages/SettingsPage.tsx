import {
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Palette,
  Database,
  FileText,
  Languages,
  RefreshCcw,
  Save,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLlmModels, getSystemFonts, saveSettings } from "../api/tauri";
import {
  appLanguages,
  minecraftLanguageOptions,
  normalizeAppLanguage,
  t,
} from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";
import type { AppLanguage, LlmModel, Settings } from "../types";

interface Props {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

type SettingsTab = "language" | "appearance" | "api" | "performance" | "reuse" | "logs" | "advanced";

const tabs = [
  { key: "language", labelKey: "settings.tab.language", icon: Languages },
  { key: "appearance", labelKey: "settings.tab.appearance", icon: Palette },
  { key: "api", labelKey: "settings.tab.api", icon: Server },
  { key: "performance", labelKey: "settings.tab.performance", icon: Cpu },
  { key: "reuse", labelKey: "settings.tab.reuse", icon: Boxes },
  { key: "logs", labelKey: "settings.tab.logs", icon: FileText },
  { key: "advanced", labelKey: "settings.tab.advanced", icon: Database },
] as const satisfies ReadonlyArray<{ key: SettingsTab; labelKey: TranslationKey; icon: LucideIcon }>;

/** 预设字体键名列表 — 与 CSS [data-font] 选择器对应 */
export const FONT_PRESETS = ["system", "yahei", "noto", "simsun"] as const;

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
  const [showCustomModel, setShowCustomModel] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);
  const language = normalizeAppLanguage(draft.appLanguage);

  const currentTitle = useMemo(
    () => t(language, tabs.find((tab) => tab.key === activeTab)?.labelKey ?? "settings.title"),
    [activeTab, language],
  );

  async function handleSave() {
    setError("");
    setMessage("");
    const normalizedSourceLanguage = normalizeTranslationLanguage(draft.sourceLanguage, true);
    const normalizedTargetLanguage = normalizeTranslationLanguage(draft.targetLanguage, false);
    if (!normalizedSourceLanguage) {
      setError(t(language, "settings.invalidSourceLanguage"));
      return;
    }
    if (!normalizedTargetLanguage) {
      setError(t(language, "settings.invalidTargetLanguage"));
      return;
    }

    const nextSettings = {
      ...draft,
      appLanguage: normalizeAppLanguage(draft.appLanguage),
      sourceLanguage: normalizedSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
    };
    await saveSettings(nextSettings);
    setDraft(nextSettings);
    onSettingsChange(nextSettings);
    setMessage(t(nextSettings.appLanguage, "settings.saved"));
  }

  async function handleFetchModels() {
    setIsFetchingModels(true);
    setError("");
    setMessage("");
    try {
      const result = await fetchLlmModels(draft.baseUrl, draft.apiKey);
      setModels(result.models);
      setShowCustomModel(false);
      if (result.models.length > 0 && !result.models.some((item) => item.id === draft.model)) {
        setDraft({ ...draft, model: result.models[0].id });
      }
      setMessage(t(language, "settings.modelsFetched", { url: result.sourceUrl, count: result.models.length }));
    } catch (fetchError) {
      setError(toErrorMessage(fetchError));
    } finally {
      setIsFetchingModels(false);
    }
  }

  // 进入外观选项卡时懒加载系统字体列表
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
      <div className="page-header">
        <div>
          <h1>{t(language, "settings.title")}</h1>
          <p>{t(language, "settings.subtitle")}</p>
        </div>
        <button className="primary-button" onClick={handleSave} type="button" data-tooltip={t(language, "tooltip.saveSettings")}>
          <Save size={18} />
          {t(language, "settings.save")}
        </button>
      </div>

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
            <span>{t(language, "settings.autosaveHint")}</span>
          </div>

          {activeTab === "language" && (
            <div className="settings-form">
              <label className="field">
                {t(language, "settings.appLanguage")}
                <select
                  value={draft.appLanguage}
                  onChange={async (event) => {
                    const newLanguage = normalizeAppLanguage(event.target.value);
                    setDraft((prev) => ({ ...prev, appLanguage: newLanguage }));
                    setMessage("");
                    setError("");
                    try {
                      // 立即保存并传播，使侧边栏和所有页面即时刷新
                      const updatedSettings = { ...settings, appLanguage: newLanguage };
                      await saveSettings(updatedSettings);
                      onSettingsChange(updatedSettings);
                      setMessage(t(newLanguage, "settings.saved"));
                    } catch (err) {
                      setError(toErrorMessage(err));
                    }
                  }}
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
                onChange={(value) => setDraft({ ...draft, sourceLanguage: value })}
              />
              <LanguageField
                helpText={t(language, "settings.targetHint")}
                label={t(language, "settings.targetLanguage")}
                value={draft.targetLanguage}
                onChange={(value) => setDraft({ ...draft, targetLanguage: value })}
                excludeAuto
              />
            </div>
          )}

          {activeTab === "appearance" && (
            <div className="settings-form">
              <label className="field">
                {t(language, "settings.uiTheme")}
                <select
                  value={draft.uiTheme}
                  onChange={(event) => {
                    const newTheme = event.target.value;
                    setDraft((prev) => ({ ...prev, uiTheme: newTheme }));
                    document.documentElement.dataset.theme = newTheme;
                  }}
                >
                  {(["default", "ocean", "aurora", "gold"] as const).map((key) => (
                    <option key={key} value={key}>{t(language, `settings.uiThemeOption.${key}` as TranslationKey)}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t(language, "settings.uiFont")}
                {isLoadingFonts && <small className="field-hint">{t(language, "settings.loadingFonts")}</small>}
                <select
                  value={draft.uiFont}
                  onChange={(event) => {
                    const newFont = event.target.value;
                    setDraft((prev) => ({ ...prev, uiFont: newFont }));
                    applyFont(newFont);
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
          )}

          {activeTab === "api" && <ApiSettingsTab language={language} draft={draft} setDraft={setDraft} models={models} isFetchingModels={isFetchingModels} handleFetchModels={handleFetchModels} showCustomModel={showCustomModel} setShowCustomModel={setShowCustomModel} />}

          {activeTab === "performance" && (
            <div className="settings-form two-column">
              <label className="field">
                <span>{t(language, "settings.concurrency")}</span>
                <input
                  type="number" min="1" max="100"
                  value={draft.concurrency}
                  onChange={(e) => setDraft({...draft, concurrency: Number(e.target.value)})}
                  data-tooltip={t(language, "settings.concurrencyHint")}
                />
                <small>{t(language, "settings.concurrencyHint")}</small>
              </label>
              <label className="field">
                <span>{t(language, "settings.batchSize")}</span>
                <input
                  type="number" min="1" max="500"
                  value={draft.batchSize}
                  onChange={(e) => setDraft({...draft, batchSize: Number(e.target.value)})}
                  data-tooltip={t(language, "settings.batchSizeHint")}
                />
                <small>{t(language, "settings.batchSizeHint")}</small>
              </label>
              <label className="field">
                <span>{t(language, "settings.timeoutSecs")}</span>
                <input
                  type="number" min="10" max="600"
                  value={draft.timeoutSecs}
                  onChange={(e) => setDraft({...draft, timeoutSecs: Number(e.target.value)})}
                  data-tooltip={t(language, "settings.timeoutSecsHint")}
                />
                <small>{t(language, "settings.timeoutSecsHint")}</small>
              </label>
              <label className="field">
                <span>{t(language, "settings.retryCount")}</span>
                <input
                  type="number" min="0" max="20"
                  value={draft.retryCount}
                  onChange={(e) => setDraft({...draft, retryCount: Number(e.target.value)})}
                  data-tooltip={t(language, "settings.retryCountHint")}
                />
                <small>{t(language, "settings.retryCountHint")}</small>
              </label>
              <label className="field">
                <span>{t(language, "settings.retryDelaySecs")}</span>
                <input
                  type="number" min="0.1" max="60" step="0.5"
                  value={draft.retryDelaySecs}
                  onChange={(e) => setDraft({...draft, retryDelaySecs: Number(e.target.value)})}
                  data-tooltip={t(language, "settings.retryDelaySecsHint")}
                />
                <small>{t(language, "settings.retryDelaySecsHint")}</small>
              </label>
              <label className="field">
                <span>{t(language, "settings.rateLimitRpm")}</span>
                <input
                  type="number" min="0" max="100000"
                  value={draft.rateLimitRpm}
                  onChange={(e) => setDraft({...draft, rateLimitRpm: Number(e.target.value)})}
                  data-tooltip={t(language, "settings.rateLimitRpmHint")}
                />
                <small>{t(language, "settings.rateLimitRpmHint")}</small>
              </label>
            </div>
          )}

          {activeTab === "reuse" && (
            <div className="settings-form">
              <Toggle label={t(language, "settings.reuseI18n")} checked={draft.reuseI18nPacks} onChange={(checked) => setDraft({ ...draft, reuseI18nPacks: checked })} />
              <Toggle label={t(language, "settings.reuseVm")} checked={draft.reuseVmPacks} onChange={(checked) => setDraft({ ...draft, reuseVmPacks: checked })} />
              <Toggle label={t(language, "settings.preferDictionary")} checked={draft.preferUserDictionary} onChange={(checked) => setDraft({ ...draft, preferUserDictionary: checked })} />
              <Toggle label={t(language, "settings.keepExisting")} checked={draft.keepExistingResourceTranslations} onChange={(checked) => setDraft({ ...draft, keepExistingResourceTranslations: checked })} />
              <Toggle label={t(language, "settings.enableFtb")} checked={draft.enableFtbQuests} onChange={(checked) => setDraft({ ...draft, enableFtbQuests: checked })} />
              <hr className="settings-separator" />
              <h3 className="section-label">{t(language, "settings.translationPacks")}</h3>
              {(draft.resourcePackNames ?? []).map((name, index) => (
                <div key={index} className="resource-pack-row">
                  <label className="field pack-row-input">
                    {t(language, "settings.resourcePackName")} #{index + 1}
                    <input
                      value={name}
                      onChange={(event) => {
                        const next = [...(draft.resourcePackNames ?? [])];
                        next[index] = event.target.value;
                        setDraft({ ...draft, resourcePackNames: next });
                      }}
                      placeholder={t(language, "settings.packPlaceholder")}
                    />
                  </label>
                  <button
                    className="ghost-button danger pack-remove-btn"
                    onClick={() => {
                      const next = draft.resourcePackNames.filter((_, i) => i !== index);
                      setDraft({ ...draft, resourcePackNames: next });
                    }}
                    type="button"
                  >
                    {t(language, "settings.removePack")}
                  </button>
                </div>
              ))}
              <button
                className="ghost-button"
                onClick={() => {
                  const next = [...(draft.resourcePackNames ?? []), ""];
                  setDraft({ ...draft, resourcePackNames: next });
                }}
                type="button"
                style={{ marginTop: 8 }}
              >
                + {t(language, "settings.addPack")}
              </button>
              <small style={{ display: 'block', marginTop: 6, color: '#6b665d', fontSize: 12 }}>
                {t(language, "settings.resourcePackHint")}
              </small>
            </div>
          )}

          {activeTab === "logs" && (
            <div className="settings-form">
              <Toggle label={t(language, "settings.resetMainLog")} checked={draft.resetMainLogOnStart} onChange={(checked) => setDraft({ ...draft, resetMainLogOnStart: checked })} />
              <Toggle label={t(language, "settings.enableDebug")} checked={draft.enableDebugLog} onChange={(checked) => setDraft({ ...draft, enableDebugLog: checked })} />
              <Toggle label={t(language, "settings.enableHttp")} checked={draft.enableHttpLog} onChange={(checked) => setDraft({ ...draft, enableHttpLog: checked })} />
              <Toggle label={t(language, "settings.enableTokens")} checked={draft.enableTokenStats} onChange={(checked) => setDraft({ ...draft, enableTokenStats: checked })} />
            </div>
          )}

          {activeTab === "advanced" && (
            <div className="settings-form">
              <Field
                label={t(language, "settings.defaultInstance")}
                value={draft.instancePath}
                onChange={(value) => setDraft({ ...draft, instancePath: value })}
              />
              <div className="empty-state compact">{t(language, "settings.futureAdvanced")}</div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

interface FieldProps {
  label: string;
  value: string | number;
  type?: string;
  onChange: (value: string) => void;
}

function Field({ label, value, type = "text", onChange }: FieldProps) {
  return (
    <label className="field">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

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

function normalizeTranslationLanguage(value: string, allowAuto: boolean): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto") return allowAuto ? normalized : null;
  if (/^[a-z]{2,3}_[a-z0-9]{2,8}$/.test(normalized)) return normalized;
  return null;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const PROVIDER_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

const PROVIDER_OPTIONS = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI 兼容" },
] as const;

interface ApiSettingsTabProps {
  language: AppLanguage;
  draft: Settings;
  setDraft: React.Dispatch<React.SetStateAction<Settings>>;
  models: LlmModel[];
  isFetchingModels: boolean;
  handleFetchModels: () => Promise<void>;
  showCustomModel: boolean;
  setShowCustomModel: React.Dispatch<React.SetStateAction<boolean>>;
}

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  deepseek: <Bot size={16} />,
  openai: <Cloud size={16} />,
};

function ApiSettingsTab({ language, draft, setDraft, models, isFetchingModels, handleFetchModels, showCustomModel, setShowCustomModel }: ApiSettingsTabProps) {
  const [providerOpen, setProviderOpen] = useState(false);
  const providerRef = useRef<HTMLDivElement>(null);

  // Click outside to close provider dropdown
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
  }, [setDraft]);

  return (
    <div className="settings-form two-column">
      {/* Provider selector — full width */}
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
              {PROVIDER_OPTIONS.find((o) => o.value === draft.provider)?.label}
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
        onChange={(value) => setDraft((prev) => ({ ...prev, baseUrl: value }))}
      />
      <Field
        label={t(language, "settings.apiKey")}
        type="password"
        value={draft.apiKey}
        onChange={(value) => setDraft((prev) => ({ ...prev, apiKey: value }))}
      />

      <label className="field" style={{ gridColumn: "1 / -1" }}>
        {t(language, "settings.modelLabel")}
        <div className="inline-control">
          {showCustomModel || models.length === 0 ? (
            <input
              value={draft.model}
              onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
              placeholder={
                models.length === 0
                  ? draft.model
                  : t(language, "settings.modelPlaceholder")
              }
            />
          ) : (
            <select
              value={models.some((item) => item.id === draft.model) ? draft.model : ""}
              onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
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

      <label className="field">
        <span>{t(language, "settings.temperature")}</span>
        <input
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={draft.temperature}
          onChange={(event) => setDraft((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
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
          onChange={(event) => setDraft((prev) => ({ ...prev, maxTokens: event.target.value === "" ? 0 : Number(event.target.value) }))}
        />
        <small>{t(language, "settings.maxTokensHint")}</small>
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        <span>{t(language, "settings.systemPrompt")}</span>
        <textarea
          rows={6}
          value={draft.systemPrompt}
          onChange={(e) => setDraft((prev) => ({...prev, systemPrompt: e.target.value}))}
          style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 1.5, width: "100%" }}
        />
        <small>{t(language, "settings.systemPromptHint")}</small>
      </label>
    </div>
  );
}

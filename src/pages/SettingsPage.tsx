import {
  Boxes,
  Cpu,
  Database,
  FileText,
  Languages,
  RefreshCcw,
  Save,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { fetchLlmModels, saveSettings } from "../api/tauri";
import {
  appLanguages,
  minecraftLanguageOptions,
  normalizeAppLanguage,
  t,
} from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";
import type { LlmModel, Settings } from "../types";

interface Props {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

type SettingsTab = "language" | "api" | "performance" | "reuse" | "logs" | "advanced";

const tabs = [
  { key: "language", labelKey: "settings.tab.language", icon: Languages },
  { key: "api", labelKey: "settings.tab.api", icon: Server },
  { key: "performance", labelKey: "settings.tab.performance", icon: Cpu },
  { key: "reuse", labelKey: "settings.tab.reuse", icon: Boxes },
  { key: "logs", labelKey: "settings.tab.logs", icon: FileText },
  { key: "advanced", labelKey: "settings.tab.advanced", icon: Database },
] as const satisfies ReadonlyArray<{ key: SettingsTab; labelKey: TranslationKey; icon: LucideIcon }>;

export function SettingsPage({ settings, onSettingsChange }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("language");
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [showCustomModel, setShowCustomModel] = useState(false);
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
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setIsFetchingModels(false);
    }
  }

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
                      setError(err instanceof Error ? err.message : String(err));
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
                listId="source-language-options"
                value={draft.sourceLanguage}
                onChange={(value) => setDraft({ ...draft, sourceLanguage: value })}
              />
              <LanguageField
                helpText={t(language, "settings.targetHint")}
                label={t(language, "settings.targetLanguage")}
                listId="target-language-options"
                value={draft.targetLanguage}
                onChange={(value) => setDraft({ ...draft, targetLanguage: value })}
                excludeAuto
              />
            </div>
          )}

          {activeTab === "api" && (
            <div className="settings-form two-column">
              <Field
                label={t(language, "settings.baseUrl")}
                value={draft.baseUrl}
                onChange={(value) => setDraft({ ...draft, baseUrl: value })}
              />
              <Field
                label={t(language, "settings.apiKey")}
                type="password"
                value={draft.apiKey}
                onChange={(value) => setDraft({ ...draft, apiKey: value })}
              />
              <label className="field">
                {t(language, "settings.modelLabel")}
                <div className="inline-control">
                  {showCustomModel || models.length === 0 ? (
                    <input
                      value={draft.model}
                      onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                      placeholder={
                        models.length === 0
                          ? draft.model
                          : t(language, "settings.modelPlaceholder")
                      }
                    />
                  ) : (
                    <select
                      value={models.some((item) => item.id === draft.model) ? draft.model : ""}
                      onChange={(event) => setDraft({ ...draft, model: event.target.value })}
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
                  onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })}
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
                  onChange={(event) => setDraft({ ...draft, maxTokens: event.target.value === "" ? 0 : Number(event.target.value) })}
                />
                <small>{t(language, "settings.maxTokensHint")}</small>
              </label>
            </div>
          )}

          {activeTab === "performance" && (
            <div className="settings-form two-column">
              <Field label={t(language, "settings.concurrency")} type="number" value={draft.concurrency} onChange={(value) => setDraft({ ...draft, concurrency: Number(value) })} />
              <Field label={t(language, "settings.batchSize")} type="number" value={draft.batchSize} onChange={(value) => setDraft({ ...draft, batchSize: Number(value) })} />
              <Field label={t(language, "settings.batchMaxChars")} type="number" value={draft.batchMaxChars} onChange={(value) => setDraft({ ...draft, batchMaxChars: Number(value) })} />
              <Field label={t(language, "settings.timeoutSecs")} type="number" value={draft.timeoutSecs} onChange={(value) => setDraft({ ...draft, timeoutSecs: Number(value) })} />
              <Field label={t(language, "settings.retryCount")} type="number" value={draft.retryCount} onChange={(value) => setDraft({ ...draft, retryCount: Number(value) })} />
              <Field label={t(language, "settings.retryDelaySecs")} type="number" value={draft.retryDelaySecs} onChange={(value) => setDraft({ ...draft, retryDelaySecs: Number(value) })} />
              <Field label={t(language, "settings.rateLimitRpm")} type="number" value={draft.rateLimitRpm} onChange={(value) => setDraft({ ...draft, rateLimitRpm: Number(value) })} />
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
              <label className="field">
                {t(language, "settings.i18nPackName")}
                <input
                  value={draft.i18nPackName}
                  onChange={(event) => setDraft({ ...draft, i18nPackName: event.target.value })}
                  placeholder="Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip"
                />
                <small>{t(language, "settings.i18nPackHint")}</small>
              </label>
              <label className="field">
                {t(language, "settings.vmPackName")}
                <input
                  value={draft.vmPackName}
                  onChange={(event) => setDraft({ ...draft, vmPackName: event.target.value })}
                  placeholder="VMTranslationPack-Converted-1.21.1.zip"
                />
                <small>{t(language, "settings.vmPackHint")}</small>
              </label>
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
  listId: string;
  helpText: string;
  excludeAuto?: boolean;
  onChange: (value: string) => void;
}

function LanguageField({
  label,
  value,
  listId,
  helpText,
  excludeAuto = false,
  onChange,
}: LanguageFieldProps) {
  const options = minecraftLanguageOptions.filter((item) => !excludeAuto || item.code !== "auto");
  const inputId = `${listId}-input`;
  return (
    <label className="field" htmlFor={inputId}>
      <span>{label}</span>
      <input
        aria-label={label}
        id={inputId}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </datalist>
      <small>{helpText}</small>
    </label>
  );
}

function normalizeTranslationLanguage(value: string, allowAuto: boolean): string | null {
  const normalized = value.trim().toLowerCase();
  if (allowAuto && normalized === "auto") {
    return normalized;
  }
  if (!allowAuto && normalized === "auto") {
    return null;
  }
  if (/^[a-z]{2,3}_[a-z0-9]{2,8}$/.test(normalized)) {
    return normalized;
  }
  return null;
}

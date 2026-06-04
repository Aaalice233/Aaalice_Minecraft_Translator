import { invoke } from "@tauri-apps/api/core";
import type { InstanceValidation, LlmModelsResponse, ScanSummary, Settings } from "../types";

const settingsStorageKey = "aaalice-mc-translator-settings";

const defaultSettings: Settings = {
  appLanguage: "zh_cn",
  sourceLanguage: "auto",
  targetLanguage: "zh_cn",
  instancePath: "E:/PCL2/.minecraft/versions/Aaalice Craft",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-flash",
  temperature: 0.3,
  maxTokens: 4096,
  concurrency: 6,
  batchSize: 80,
  batchMaxChars: 120000,
  timeoutSecs: 120,
  retryCount: 3,
  retryDelaySecs: 2,
  rateLimitRpm: 3000,
  reuseI18nPacks: true,
  reuseVmPacks: true,
  preferUserDictionary: true,
  keepExistingResourceTranslations: true,
  enableFtbQuests: false,
  resetMainLogOnStart: true,
  enableDebugLog: false,
  enableHttpLog: false,
  enableTokenStats: true,
};

export async function getSettings(): Promise<Settings> {
  if (!isTauriRuntime()) {
    return loadBrowserSettings();
  }
  return invoke<Settings>("get_settings");
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    return;
  }
  return invoke<void>("save_settings", { settings });
}

export async function validateInstance(path: string): Promise<InstanceValidation> {
  return invoke<InstanceValidation>("validate_instance", { path });
}

export async function scanInstance(
  path: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<ScanSummary> {
  return invoke<ScanSummary>("scan_instance", { path, sourceLanguage, targetLanguage });
}

export async function fetchLlmModels(baseUrl: string, apiKey: string): Promise<LlmModelsResponse> {
  if (!isTauriRuntime()) {
    return {
      models: [{ id: "deepseek-v4-flash", ownedBy: "deepseek" }],
      sourceUrl: `${baseUrl.replace(/\/$/, "")}/models`,
    };
  }
  return invoke<LlmModelsResponse>("fetch_llm_models", { baseUrl, apiKey });
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function loadBrowserSettings(): Settings {
  const raw = localStorage.getItem(settingsStorageKey);
  if (!raw) {
    return defaultSettings;
  }
  try {
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

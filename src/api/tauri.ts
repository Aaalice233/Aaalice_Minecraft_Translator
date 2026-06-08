import type { CopyResult, DictionaryEntry, DictionaryStats, ImportResult, InstanceValidation, LlmModelsResponse, LogEntry, PackEntry, PackResult, ReadLogsResult, ScanSummary, Settings, TranslateProgress, TranslationJobState, ValidationReport } from "../types";

const settingsStorageKey = "aaalice-mc-translator-settings";

const defaultSettings: Settings = {
  appLanguage: "zh_cn",
  sourceLanguage: "auto",
  targetLanguage: "zh_cn",
  instancePath: "E:/PCL2/.minecraft/versions/Aaalice Craft",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-flash",
  temperature: 1.0,
  maxTokens: 0,
  concurrency: 6,
  batchSize: 100,
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
  resourcePackNames: [
    "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
    "VMTranslationPack-Converted-1.21.1.zip",
  ],
  systemPrompt: "",
  uiFont: "system",
  uiTheme: "default",
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Lazy Tauri invoke — only loads the module in Tauri runtime. */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

export async function getSettings(): Promise<Settings> {
  if (!isTauriRuntime()) {
    return loadBrowserSettings();
  }
  return tauriInvoke<Settings>("get_settings");
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    return;
  }
  return tauriInvoke<void>("save_settings", { settings });
}

export async function validateInstance(path: string): Promise<InstanceValidation> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览模式下不可用，请在 Tauri 桌面端中运行");
  }
  return tauriInvoke<InstanceValidation>("validate_instance", { path });
}

export async function scanInstance(
  path: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<ScanSummary> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览模式下不可用，请在 Tauri 桌面端中运行");
  }
  return tauriInvoke<ScanSummary>("scan_instance", { path, sourceLanguage, targetLanguage });
}

/** Clear all cached scan and translation job files, forcing a fresh scan next time. */
export async function clearJobsCache(): Promise<void> {
  if (!isTauriRuntime()) return;
  return tauriInvoke<void>("clear_jobs_cache");
}

export async function cancelScan(): Promise<void> {
  if (!isTauriRuntime()) {
    return; // browser mode no-op
  }
  return tauriInvoke<void>("cancel_scan");
}

export async function fetchLlmModels(baseUrl: string, apiKey: string): Promise<LlmModelsResponse> {
  if (!isTauriRuntime()) {
    return {
      models: [{ id: "deepseek-v4-flash", ownedBy: "deepseek" }],
      sourceUrl: `${baseUrl.replace(/\/$/, "")}/models`,
    };
  }
  return tauriInvoke<LlmModelsResponse>("fetch_llm_models", { baseUrl, apiKey });
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

// ── P2: Dictionary API ────────────────────────────────────────────

export async function searchDictionary(
  search?: string,
  sourceType?: string,
  modId?: string,
  sourceLang?: string,
  targetLang?: string,
  limit?: number,
  offset?: number,
): Promise<DictionaryEntry[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return tauriInvoke<DictionaryEntry[]>("search_dictionary", {
    search, sourceType, modId, sourceLang, targetLang, limit, offset,
  });
}

export async function updateDictionaryEntry(id: number, targetText: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return true;
  }
  return tauriInvoke<boolean>("update_dictionary_entry", { id, targetText });
}

export async function deleteDictionaryEntry(id: number): Promise<boolean> {
  if (!isTauriRuntime()) {
    return true;
  }
  return tauriInvoke<boolean>("delete_dictionary_entry", { id });
}

export async function exportDictionary(filePath: string): Promise<number> {
  if (!isTauriRuntime()) {
    return 0;
  }
  return tauriInvoke<number>("export_dictionary", { filePath });
}

export async function importDictionary(filePath: string): Promise<ImportResult> {
  if (!isTauriRuntime()) {
    return { imported: 0, skipped: 0, conflicts: [] };
  }
  return tauriInvoke<ImportResult>("import_dictionary", { filePath });
}

export async function getDictionaryStats(): Promise<DictionaryStats> {
  if (!isTauriRuntime()) {
    return { total: 0, modIds: [] };
  }
  return tauriInvoke<DictionaryStats>("get_dictionary_stats");
}

// ── P4: Pack API ──────────────────────────────────────────────────

export async function startTranslation(
  path: string,
  sourceLanguage: string,
  targetLanguage: string,
  scanJobId?: string,
): Promise<number> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览模式下不可用，请在 Tauri 桌面端中运行");
  }
  return tauriInvoke<number>("start_translation", {
    path,
    sourceLanguage,
    targetLanguage,
    scanJobId: scanJobId ?? null,
  });
}

export async function cancelTranslation(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return tauriInvoke<void>("cancel_translation");
}

export async function retryFailedEntries(
  jobId: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<number> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览模式下不可用");
  }
  return tauriInvoke<number>("retry_failed_entries", { jobId, sourceLanguage, targetLanguage });
}

export async function getTranslationJob(jobId: string): Promise<TranslationJobState | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return tauriInvoke<TranslationJobState | null>("get_translation_job", { jobId });
}

export async function loadLatestTranslationJob(): Promise<TranslationJobState | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return tauriInvoke<TranslationJobState | null>("load_latest_translation_job");
}

export async function listTranslationJobs(): Promise<TranslationJobState[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return tauriInvoke<TranslationJobState[]>("list_translation_jobs");
}

export async function validateTranslation(jobId: string): Promise<ValidationReport> {
  if (!isTauriRuntime()) {
    return { totalEntries: 0, passed: 0, failed: 0, missing: 0, placeholderIssues: [], formatIssues: [] };
  }
  return tauriInvoke<ValidationReport>("validate_translation", { jobId });
}

export async function generateTranslationPack(
  entries: PackEntry[],
  targetLanguage: string,
  dryRun: boolean,
  packFormat?: number,
): Promise<PackResult> {
  if (!isTauriRuntime()) {
    return { outputDir: "", zipPath: "", modCount: 0, entryCount: 0, conflicts: [] };
  }
  return tauriInvoke<PackResult>("generate_translation_pack", {
    entries, targetLanguage, dryRun, packFormat: packFormat ?? null,
  });
}

export async function copyPackToInstance(
  packZipPath: string,
  instancePath: string,
  overwrite: boolean,
): Promise<CopyResult> {
  if (!isTauriRuntime()) {
    return { success: false, targetPath: "", replaced: false };
  }
  return tauriInvoke<CopyResult>("copy_pack_to_instance", {
    packZipPath, instancePath, overwrite,
  });
}

export async function generatePackFromJob(
  jobId: string,
  targetLanguage: string,
  dryRun: boolean,
): Promise<PackResult> {
  if (!isTauriRuntime()) {
    return { outputDir: "", zipPath: "", modCount: 0, entryCount: 0, conflicts: [] };
  }
  return tauriInvoke<PackResult>("generate_pack_from_job", {
    jobId, targetLanguage, dryRun,
  });
}

// ── Font API ────────────────────────────────────────────────

/** 浏览器预览模式下使用的常见系统字体后备列表 */
const FALLBACK_FONTS = [
  "Arial", "Arial Black", "Calibri", "Cambria", "Candara",
  "Comic Sans MS", "Consolas", "Courier New", "DengXian",
  "FangSong", "Georgia", "Helvetica", "Impact", "KaiTi",
  "Lucida Console", "Lucida Sans Unicode", "Microsoft Sans Serif",
  "Microsoft YaHei", "Microsoft YaHei UI", "NSimSun",
  "Noto Sans", "Noto Sans SC", "Noto Serif", "Noto Serif SC",
  "Palatino Linotype", "Segoe UI", "SimHei", "SimSun",
  "Source Han Sans", "Source Han Sans SC", "Source Han Serif",
  "STKaiti", "STSong", "Tahoma", "Times New Roman",
  "Trebuchet MS", "Verdana", "Wingdings", "Yu Gothic",
];

/** 获取系统已安装的字体列表 */
export async function getSystemFonts(): Promise<string[]> {
  if (!isTauriRuntime()) {
    return FALLBACK_FONTS;
  }
  return tauriInvoke<string[]>("list_fonts");
}

export async function readLogs(): Promise<ReadLogsResult> {
  if (!isTauriRuntime()) {
    return { entries: [], fileSize: 0 };
  }
  return tauriInvoke<ReadLogsResult>("read_logs");
}

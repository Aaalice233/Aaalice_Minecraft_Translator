import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import type { CopyResult, DictionaryEntry, DictionaryStats, I18nDictUpdateInfo, I18nDictUpdateResult, ImportResult, InstanceValidation, LlmModelsResponse, LogEntry, ModTranslationSummary, PackEntry, PackResult, ReadLogsResult, ScanDiffResult, ScanSummary, Settings, TranslateProgress, TranslationJobListItem, TranslationJobState, TranslationResult, ValidationReport } from "../types";
import packageJson from "../../package.json";

const settingsStorageKey = "aaalice-mc-translator-settings";
let pendingAppUpdate: Update | null = null;

const defaultSettings: Settings = {
  appLanguage: "zh_cn",
  sourceLanguage: "auto",
  targetLanguage: "zh_cn",
  instancePath: "",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-flash",
  temperature: 1.0,
  maxTokens: 0,
  concurrency: 100,
  batchSize: 80,
  timeoutSecs: 180,
  retryCount: 5,
  autoRetryCount: 2,
  rateLimitRpm: 3000,
  preferUserDictionary: true,
  resetMainLogOnStart: true,
  enableDebugLog: false,
  enableHttpLog: false,
  resourcePackNames: [
    "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
    "VMTranslationPack-Converted-1.21.1.zip",
  ],
  outputPackName: "Aaalice-MC-Translator-{{mc_version}}",
  systemPrompt: "",
  uiFont: "system",
  uiTheme: "default",
  uiDarkMode: false,
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
    throw new Error("Not available in browser preview mode, please run in Tauri desktop");
  }
  return tauriInvoke<InstanceValidation>("validate_instance", { path });
}

export async function scanInstance(
  path: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<ScanSummary> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode, please run in Tauri desktop");
  }
  return tauriInvoke<ScanSummary>("scan_instance", { path, sourceLanguage, targetLanguage });
}



export async function scanAndDiff(
  path: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<ScanDiffResult> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode");
  }
  return tauriInvoke<ScanDiffResult>("scan_and_diff", { path, sourceLanguage, targetLanguage });
}

export async function cancelScan(): Promise<void> {
  if (!isTauriRuntime()) return;
  return tauriInvoke<void>("cancel_scan");
}

export async function pickInstanceFolder(locale: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return tauriInvoke<string | null>("pick_instance_folder", { locale });
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

export async function checkLlmConnection(baseUrl: string, apiKey: string, model: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return true;
  }
  return tauriInvoke<boolean>("check_llm_connection", { baseUrl, apiKey, model });
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

export async function clearDictionary(): Promise<number> {
  if (!isTauriRuntime()) {
    return 0;
  }
  return tauriInvoke<number>("clear_dictionary");
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

export async function checkI18nDictUpdate(): Promise<I18nDictUpdateInfo> {
  if (!isTauriRuntime()) {
    return {
      currentTag: null,
      latestTag: "browser-preview",
      latestName: "browser-preview",
      publishedAt: "",
      assetName: "Dict-Sqlite.db",
      referenceEntries: 0,
      updateAvailable: false,
    };
  }
  return tauriInvoke<I18nDictUpdateInfo>("check_i18n_dict_update");
}

export async function updateI18nDict(): Promise<I18nDictUpdateResult> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode");
  }
  return tauriInvoke<I18nDictUpdateResult>("update_i18n_dict");
}

// ── P4: Pack API ──────────────────────────────────────────────────

export async function startTranslation(
  path: string,
  sourceLanguage: string,
  targetLanguage: string,
  scanJobId?: string,
): Promise<number> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode, please run in Tauri desktop");
  }
  return tauriInvoke<number>("start_translation", {
    path,
    sourceLanguage,
    targetLanguage,
    scanJobId: scanJobId ?? null,
  });
}

export async function cancelTranslation(): Promise<void> {
  if (!isTauriRuntime()) return;
  return tauriInvoke<void>("cancel_translation");
}

export async function retryFailedEntries(
  jobId: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<number> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode");
  }
  return tauriInvoke<number>("retry_failed_entries", { jobId, sourceLanguage, targetLanguage });
}

export async function translateSingleEntry(
  jobId: string | null,
  key: string,
  sourceText: string,
  modName: string,
  modId: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode");
  }
  return tauriInvoke<string>("translate_single_entry", {
    jobId,
    key,
    sourceText,
    modName,
    modId,
    sourceLanguage,
    targetLanguage,
  });
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

/** Lightweight variant: returns job metadata without the full `entries` list (~350B vs 2MB). */
export async function loadLatestTranslationJobMeta(): Promise<TranslationJobListItem | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return tauriInvoke<TranslationJobListItem | null>("load_latest_translation_job_meta");
}

export async function loadTranslationResults(jobId: string, modId?: string): Promise<TranslationResult[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return tauriInvoke<TranslationResult[]>("load_translation_results", { jobId, modId: modId ?? null });
}

export async function loadTranslationModSummaries(jobId: string): Promise<ModTranslationSummary[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return tauriInvoke<ModTranslationSummary[]>("load_translation_mod_summaries", { jobId });
}

export async function saveTranslationEntry(
  jobId: string,
  key: string,
  modName: string,
  modId: string,
  targetText: string,
): Promise<void> {
  if (!isTauriRuntime()) return;
  return tauriInvoke<void>("save_translation_entry", { jobId, key, modName, modId, targetText });
}



export async function validateTranslation(jobId: string): Promise<ValidationReport> {
  if (!isTauriRuntime()) {
    return { totalEntries: 0, passed: 0, failed: 0, missing: 0, placeholderIssues: [], formatIssues: [] };
  }
  return tauriInvoke<ValidationReport>("validate_translation", { jobId });
}

/** Mark a translation job as reviewed (校对完成). */
export async function markJobReviewed(jobId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return tauriInvoke<void>("mark_job_reviewed", { jobId });
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
  outputDir?: string,
): Promise<PackResult> {
  if (!isTauriRuntime()) {
    return { outputDir: "", zipPath: "", modCount: 0, entryCount: 0, conflicts: [] };
  }
  return tauriInvoke<PackResult>("generate_pack_from_job", {
    jobId, targetLanguage, dryRun, outputDir: outputDir ?? null,
  });
}

// ── Warmup API ───────────────────────────────────────────────

/** Start the app warmup pipeline. Progress is received via Tauri event 'warmup-progress'. */
export async function runWarmup(): Promise<void> {
  if (!isTauriRuntime()) return;
  return tauriInvoke<void>("run_warmup");
}

export async function cancelWarmup(): Promise<void> {
  if (!isTauriRuntime()) return;
  return tauriInvoke<void>("cancel_warmup");
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

export async function openPath(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(path, "_blank", "noopener,noreferrer");
    return;
  }
  return tauriInvoke<void>("open_path", { path });
}

// ── Updater API ─────────────────────────────────────────────

/** Get the current app version from the Tauri runtime. */
export async function getAppVersion(): Promise<string> {
  if (!isTauriRuntime()) {
    return packageJson.version;
  }
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Check for updates. Returns update info or null if up-to-date. */
export async function checkUpdate(): Promise<{ version: string; body?: string } | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  try {
    const update = await check();
    pendingAppUpdate = update;
    if (!update) return null;
    return { version: update.version, body: update.body };
  } catch (err) {
    // Tauri plugin-updater 将 HTTP 4xx/网络错误统一报告为 ReleaseNotFound
    // 改进错误消息以区分不同失败场景
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Could not fetch a valid release JSON")) {
      throw new Error("检查更新失败：无法从远程获取更新信息，请检查网络连接或稍后再试。");
    }
    throw err;
  }
}

/**
 * Download and install the available update.
 * @param onProgress Callback receiving download progress (0-100, estimated from chunks).
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: number) => void,
  expectedVersion?: string,
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode");
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  let update = pendingAppUpdate;
  if (!update || (expectedVersion && update.version !== expectedVersion)) {
    update = await check();
    pendingAppUpdate = update;
  }
  if (!update) return;
  let totalBytes = 0;
  let downloadedBytes = 0;
  const handleProgress = (event: DownloadEvent) => {
    if (event.event === "Started" && event.data.contentLength) {
      totalBytes = event.data.contentLength;
    }
    if (event.event === "Progress" && onProgress) {
      downloadedBytes += event.data.chunkLength;
      if (totalBytes > 0) {
        onProgress(Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)));
      }
    }
  };
  try {
    await update.downloadAndInstall(handleProgress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
      throw new Error("下载更新失败：远程安装包地址无效或发布资产缺失，请稍后重试。");
    }
    throw err;
  }
  pendingAppUpdate = null;
  onProgress?.(100);
}

/** Relaunch the app (used after installing an update). */
export async function relaunchApp(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Not available in browser preview mode");
  }
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

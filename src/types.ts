export interface Settings {
  appLanguage: AppLanguage;
  sourceLanguage: string;
  targetLanguage: string;
  instancePath: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** Max response tokens. 0 = no limit (API default). */
  maxTokens: number;
  concurrency: number;
  batchSize: number;
  batchMaxChars: number;
  timeoutSecs: number;
  retryCount: number;
  retryDelaySecs: number;
  rateLimitRpm: number;
  reuseI18nPacks: boolean;
  reuseVmPacks: boolean;
  preferUserDictionary: boolean;
  keepExistingResourceTranslations: boolean;
  enableFtbQuests: boolean;
  resetMainLogOnStart: boolean;
  enableDebugLog: boolean;
  enableHttpLog: boolean;
  enableTokenStats: boolean;
}

export type AppLanguage = "zh_cn" | "en_us" | "ja_jp" | "ko_kr";

export interface LlmModel {
  id: string;
  ownedBy: string;
}

export interface LlmModelsResponse {
  models: LlmModel[];
  sourceUrl: string;
}

export interface ScanWarning {
  code: string;
  message: string;
  path: string;
}

export interface InstanceValidation {
  instancePath: string;
  isValid: boolean;
  modsPath: string;
  resourcepacksPath: string;
  warnings: ScanWarning[];
}

export interface LanguageEntry {
  modId: string;
  key: string;
  text: string;
  textHash: string;
  language: string;
  format: string;
  sourceFile: string;
}

export interface ModScanResult {
  modId: string;
  fileName: string;
  jarPath: string;
  languageFileCount: number;
  recoveredLanguageFiles: number;
  failedLanguageFiles: number;
  sourceLanguage: string;
  resolvedSourceLanguage: string;
  targetLanguage: string;
  sourceEntries: number;
  targetEntries: number;
  hasTargetLanguage: boolean;
  formats: string[];
  entries: LanguageEntry[];
  warnings: ScanWarning[];
}

export interface ResourcePackScanResult {
  name: string;
  path: string;
  sourceType: string;
  isArchive: boolean;
  hasPackMeta: boolean;
  langFileCount: number;
  entryCount: number;
}

export interface ScanProgressEvent {
  current: number;
  total: number;
  modName: string;
  phase: string;
}

export interface ScanSummary {
  jobId: string;
  instancePath: string;
  validation: InstanceValidation;
  mods: ModScanResult[];
  resourcePacks: ResourcePackScanResult[];
  sourceLanguage: string;
  targetLanguage: string;
  totalLanguageFiles: number;
  totalSourceEntries: number;
  totalTargetEntries: number;
  totalPendingEntries: number;
  warnings: ScanWarning[];
}

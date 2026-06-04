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
  i18nPackName: string;
  vmPackName: string;
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
  entries: LanguageEntry[];
}

export interface ScanProgressEvent {
  current: number;
  total: number;
  modName: string;
  phase: string;
  subStep?: string;
  stageStatus: "running" | "completed" | "failed";
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
  resourcePackCoveredEntries: number;
  actualPendingEntries: number;
  warnings: ScanWarning[];
  cancelled: boolean;
}

// ── P2: Dictionary types ──────────────────────────────────────────

export interface DictionaryEntry {
  id?: number;
  sourceText: string;
  targetText: string;
  sourceLang: string;
  targetLang: string;
  sourceType: string;
  modId?: string;
  translationKey?: string;
  context?: string;
  confidence: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DictionaryStats {
  total: number;
  modIds: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  conflicts: string[];
}

// ── P3: Translation types ─────────────────────────────────────────

export interface TranslationEntry {
  key: string;
  text: string;
  modId: string;
  sourceLang: string;
  targetLang: string;
}

export interface TranslateProgress {
  current: number;
  total: number;
  phase: string;
  modName: string;
  subStep?: string;
  stageStatus: "running" | "completed" | "failed";
}

export type JobStatus =
  | "idle"
  | "scanning"
  | "matching"
  | "translating"
  | "translatingPaused"
  | "validating"
  | "validatingPaused"
  | "packaging"
  | "completed"
  | "failed"
  | "canceled";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TranslationJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  totalEntries: number;
  completedEntries: number;
  failedEntries: number;
  skippedEntries: number;
  matchedEntries: number;
  pendingEntries: number;
  tokenUsage: TokenUsage;
  etaSecs?: number;
}

// ── P3.5: Pipeline types ────────────────────────────

export type PipelineStage = "scan" | "translate" | "validate" | "pack";

export type StageStatus =
  | "locked"
  | "active"
  | "completed"
  | "failed_partial"
  | "failed_total";

export interface PipelineState {
  currentStage: PipelineStage;
  stageStatuses: Record<PipelineStage, StageStatus>;
}

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  "scan",
  "translate",
  "validate",
  "pack",
] as const;

export const STAGE_TO_PAGE: Record<PipelineStage, string> = {
  scan: "dashboard",
  translate: "jobs",
  validate: "validate",
  pack: "packages",
};

// ── P4: Pack types ────────────────────────────────────────────────

export interface PackEntry {
  modId: string;
  key: string;
  text: string;
}

export interface ConflictInfo {
  modId: string;
  key: string;
  sourceText: string;
  dictionaryText: string;
  existingText: string;
}

export interface PackResult {
  outputDir: string;
  zipPath: string;
  modCount: number;
  entryCount: number;
  conflicts: ConflictInfo[];
}

export interface CopyResult {
  success: boolean;
  targetPath: string;
  replaced: boolean;
}

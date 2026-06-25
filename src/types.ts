// ═══════════════════════════════════════════════════════════
// ⚠️ TYPE SYNC: These interfaces must stay in sync with
// src-tauri/src/core/models.rs (Rust side). Both use
// #[serde(rename_all = "camelCase")] for field naming.
// When adding/changing a field here, update models.rs too.
// ═══════════════════════════════════════════════════════════

export interface Settings {
  appLanguage: AppLanguage;
  sourceLanguage: string;
  targetLanguage: string;
  instancePath: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** Max response tokens. 0 = no limit (API default). */
  maxTokens: number;
  concurrency: number;
  batchSize: number;
  timeoutSecs: number;
  retryCount: number;
  autoRetryCount: number;
  rateLimitRpm: number;
  preferUserDictionary: boolean;
  resetMainLogOnStart: boolean;
  enableDebugLog: boolean;
  enableHttpLog: boolean;
  resourcePackNames: string[];
  outputPackName: string;
  systemPrompt: string;
  uiFont: string;
  uiTheme: string;
  uiDarkMode: boolean;
}

export type AppLanguage = "zh_cn" | "en_us" | "ja_jp" | "ko_kr" | "ru_ru";

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
  warnings: ScanWarning[];
}

export type ScanPhase = "scan" | "resourcepacks" | "aggregate" | "dictionary" | "log" | "persist";

export interface ScanProgressEvent {
  current: number;
  total: number;
  modName: string;
  phase: ScanPhase;
  subStep?: string;
  stageStatus: "running" | "completed" | "failed";
}

export interface ScanDiffResult {
  newSummary: ScanSummary;
  newMods: string[];
  newModCount: number;
  oldModCount: number;
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
  dictionaryCacheHits?: number;
  dictionaryCacheTotal?: number;
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
  modName?: string;
  translationKey?: string;
  context?: string;
  confidence: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DictionaryQueryParams {
  search?: string;
  sourceText?: string;
  targetText?: string;
  translationKey?: string;
  modQuery?: string;
  sourceType?: string;
  modId?: string;
  sourceLang?: string;
  targetLang?: string;
  limit?: number;
  offset?: number;
}

export type DictionarySelectionDeleteRequest =
  | {
      mode: "ids";
      ids: number[];
      query?: DictionaryQueryParams;
      excludedIds?: number[];
    }
  | {
      mode: "query";
      query: DictionaryQueryParams;
      ids?: number[];
      excludedIds?: number[];
    };

export interface DictionarySelectionDeleteResult {
  removed: number;
  remainingLocal: number;
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

export interface I18nDictUpdateInfo {
  currentTag?: string | null;
  latestTag: string;
  latestName: string;
  publishedAt: string;
  assetName: string;
  referenceEntries: number;
  updateAvailable: boolean;
}

export interface I18nDictUpdateResult {
  tag: string;
  publishedAt: string;
  referenceEntries: number;
}

// ── P3: Translation types ─────────────────────────────────────────

export type PipelinePhase = "scanning" | "extracting" | "dictionary" | "translating" | "completed";

export interface TranslateProgress {
  current: number;
  total: number;
  phase: PipelinePhase;
  modName: string;
  subStep?: string;
  stageStatus: "running" | "completed" | "failed";
}

export interface TranslateLogEntry {
  key: string;
  sourceText: string;
  targetText: string;
  modName: string;
  sourceType: string;
}

export interface EntryProgress {
  key: string;
  modName: string;
  sourceText: string;
  targetText: string | null;
  status: "pending" | "dictionaryHit" | "skip" | "translating" | "completed" | "failed";
  errorMessage?: string;
}

/** 侧边栏导航项的三态：空闲 / 运行中 / 已完成 */
export type PageNavStatus = "idle" | "busy" | "completed";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ── Log types ───────────────────────────────────────────

export interface LogEntry {
  lineNumber: number;
  timestamp: string;
  level: string;
  message: string;
}

export interface ReadLogsResult {
  entries: LogEntry[];
  fileSize: number;
}

// ── P5: Translation job state types (new pipeline) ────────────────

export type TranslationStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "reviewed"
  | "failed"
  | "cancelled";

export interface PendingEntry {
  key: string;
  sourceText: string;
  modId: string;
  modName: string;
}

export interface TranslationResult {
  key: string;
  sourceText: string;
  targetText: string;
  modId: string;
  modName: string;
  sourceType: string;
}

export interface TranslationJobState {
  jobId: string;
  scanJobId: string;
  status: TranslationStatus;
  sourceLanguage: string;
  targetLanguage: string;
  entries: PendingEntry[];
  completedEntries: number;
  failedEntries: number;
  tokenUsage: TokenUsage;
  createdAt: string;
  completedAt?: string;
  reviewed?: boolean | null;
  reviewedAt?: string;
}

/** Per-module translation result summary (entry count only, no full entries). */
export interface ModTranslationSummary {
  modId: string;
  entryCount: number;
}

/** Lightweight job summary returned by listTranslationJobs, without the full entries list. */
export interface TranslationJobListItem {
  jobId: string;
  scanJobId: string;
  status: TranslationStatus;
  sourceLanguage: string;
  targetLanguage: string;
  completedEntries: number;
  failedEntries: number;
  createdAt: string;
  completedAt?: string;
  /** null/undefined = 旧版数据（向后兼容），true = 已校对，false = 未校对 */
  reviewed?: boolean | null;
  reviewedAt?: string;
}

// ── SPLASH / Warmup types ─────────────────────────────────────────

export type WarmupPhase =
  | "settings"
  | "local"
  | "dictionary"
  | "llm"
  | "completed";

export type StageStatus = "running" | "completed" | "failed";

export interface WarmupProgress {
  phase: WarmupPhase;
  /** 0-100 overall progress */
  percent: number;
  status: StageStatus;
  message?: string;
  error?: string;
}

// ── P6: Validation types ──────────────────────────────────────────

export interface ValidationIssue {
  key: string;
  modId: string;
  sourceText: string;
  targetText: string;
  issueType: string;
  description: string;
  severity: string;
}

export interface ValidationReport {
  totalEntries: number;
  passed: number;
  failed: number;
  missing: number;
  placeholderIssues: ValidationIssue[];
  formatIssues: ValidationIssue[];
}

// ── P4: Pack types ────────────────────────────────────────────────

export interface PackEntry {
  modId: string;
  key: string;
  text: string;
  sourceText: string;
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

/** Structured error from the translation pipeline (mirrors Rust models::PipelineError). */
export type PipelineErrorType =
  | { type: "config"; message: string }
  | { type: "io"; message: string }
  | { type: "llm"; message: string }
  | { type: "cancelled" }
  | { type: "not_found"; message: string }
  | { type: "internal"; message: string }
  | { type: "dictionary"; message: string };

export interface CopyResult {
  success: boolean;
  targetPath: string;
  replaced: boolean;
}

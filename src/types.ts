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
  resourcePackNames: string[];
  systemPrompt: string;
  uiFont: string;
  uiTheme: string;
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

export type ScanPhase = "scan" | "resourcepacks" | "aggregate" | "log";

export interface ScanProgressEvent {
  current: number;
  total: number;
  modName: string;
  phase: ScanPhase;
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

export interface CopyResult {
  success: boolean;
  targetPath: string;
  replaced: boolean;
}

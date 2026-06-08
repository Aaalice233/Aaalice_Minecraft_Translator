use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicU64;

// ═══════════════════════════════════════════════════════════
// ⚠️ TYPE SYNC: Serialized structs here must stay in sync
// with src/types.ts (TypeScript side). Both use
// #[serde(rename_all = "camelCase")] to produce camelCase
// JSON field names matching the TypeScript interfaces.
// When adding/changing a field here, update types.ts too.
// ═══════════════════════════════════════════════════════════

/// 默认 Minecraft 模组翻译系统提示词
pub const DEFAULT_SYSTEM_PROMPT: &str = "你是一个专业 Minecraft 模组汉化翻译专家，精通中英文游戏术语和模组翻译规范。\n\
\n\
## 格式要求\n\
- 严格按 JSON 数组格式返回：[{\"key\": \"...\", \"text\": \"翻译文本\"}, ...]\n\
- 只返回 JSON，不要包含 markdown 代码块标记或其他解释文字\n\
- 每个条目必须包含 key 和 text 字段\n\
\n\
## 占位符保护（极其重要）\n\
- 输入文本中的格式代码和占位符已被替换为 __SHIELD_0__、__SHIELD_1__ 等标记\n\
- 这些 __SHIELD_N__ 标记对应 %s、%d、%1$s、§a、{player} 等原始代码\n\
- 你必须：\n\
  - 在输出文本中**完全保留每个 __SHIELD_N__ 标记的原样**（包括数字后缀 _0 _1 等）\n\
  - 不要删除、拆分、合并或重写任何 __SHIELD_N__ 标记\n\
  - **不要在 __SHIELD_N__ 之间添加空格或标点**\n\
- 这些标记会在翻译完成后被替换回原始格式代码，任何修改都会导致游戏内显示异常\n\
- 如果一条输入文本中包含多个 __SHIELD_N__ 标记，每个都必须出现在输出中一次且仅一次\n\
\n\
## § 颜色/格式码（在 Minecraft 中不可省略）\n\
- Minecraft 使用 § 符号控制文本颜色和格式（如 §b=淡蓝色、§r=重置、§l=加粗、§o=斜体）\n\
- **这些代码不是装饰**：它们控制文字的实际外观，删除后游戏内会丢失颜色和格式\n\
- 许多条目中 § 码是分段标记（如 §2#物品名§r§7描述§r），每段独立着色，缺一不可\n\
- 如果某段带有 § 码的原文被删除了颜色码，该段文字在游戏中会变成默认白色，和其他文字混在一起无法区分\n\
- 这些 § 码已被替换为 __SHIELD_N__ 标记，你必须**全部保留**，即使你觉得它们看起来多余\n\
\n\
## 翻译规范\n\
- 术语统一：与 Minecraft 中文标准译名一致（Creeper → 苦力怕 / Ender Dragon → 末影龙 / Nether → 下界）\n\
- 模组专属名词的首次出现可用括号附注英文原名\n\
- 同一术语在同一模组内必须始终保持一致译法\n\
- 描述性文本需要通顺自然，符合中文表达习惯\n\
- 物品名/方块名使用书名号《》括起，但保留原始格式标记\n\
- 任务文本保持原文的语气和风格（正式/诙谐/史诗感）";

fn default_resource_pack_names() -> Vec<String> {
    vec![
        "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip".to_string(),
        "VMTranslationPack-Converted-1.21.1.zip".to_string(),
    ]
}

fn default_ui_font() -> String {
    "system".to_string()
}

fn default_ui_theme() -> String {
    "default".to_string()
}

fn default_provider() -> String {
    "deepseek".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Settings {
    pub app_language: String,
    pub source_language: String,
    pub target_language: String,
    pub instance_path: String,
    #[serde(default = "default_provider")]
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub concurrency: u16,
    pub batch_size: u16,
    pub timeout_secs: u16,
    pub retry_count: u16,
    pub rate_limit_rpm: u32,
    pub prefer_user_dictionary: bool,
    pub reset_main_log_on_start: bool,
    pub enable_debug_log: bool,
    pub enable_http_log: bool,
    #[serde(default = "default_resource_pack_names")]
    pub resource_pack_names: Vec<String>,
    pub system_prompt: String,
    #[serde(default = "default_ui_font")]
    pub ui_font: String,
    #[serde(default = "default_ui_theme")]
    pub ui_theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum StageStatus {
    #[default]
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ScanProgress {
    pub current: usize,
    pub total: usize,
    pub mod_name: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_step: Option<String>,
    pub stage_status: StageStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmModel {
    pub id: String,
    pub owned_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelsResponse {
    pub models: Vec<LlmModel>,
    pub source_url: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            app_language: "zh_cn".to_string(),
            source_language: "auto".to_string(),
            target_language: "zh_cn".to_string(),
            instance_path: "E:/PCL2/.minecraft/versions/Aaalice Craft".to_string(),
            provider: "deepseek".to_string(),
            base_url: "https://api.deepseek.com".to_string(),
            api_key: String::new(),
            model: "deepseek-v4-flash".to_string(),
            temperature: 1.0,
            max_tokens: 0,
            concurrency: 10,
            batch_size: 100,
            timeout_secs: 180,
            retry_count: 5,
            rate_limit_rpm: 3000,
            prefer_user_dictionary: true,
            reset_main_log_on_start: true,
            enable_debug_log: false,
            enable_http_log: false,
            resource_pack_names: vec![
                "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip".to_string(),
                "VMTranslationPack-Converted-1.21.1.zip".to_string(),
            ],
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
            ui_font: "system".to_string(),
            ui_theme: "default".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanWarning {
    pub code: String,
    pub message: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstanceValidation {
    pub instance_path: String,
    pub is_valid: bool,
    pub mods_path: String,
    pub resourcepacks_path: String,
    pub warnings: Vec<ScanWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageEntry {
    pub mod_id: String,
    pub key: String,
    pub text: String,
    pub text_hash: String,
    pub language: String,
    pub format: String,
    pub source_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModScanResult {
    pub mod_id: String,
    pub file_name: String,
    pub jar_path: String,
    pub language_file_count: usize,
    pub recovered_language_files: usize,
    pub failed_language_files: usize,
    pub source_language: String,
    pub resolved_source_language: String,
    pub target_language: String,
    pub source_entries: usize,
    pub target_entries: usize,
    pub has_target_language: bool,
    pub formats: Vec<String>,
    pub entries: Vec<LanguageEntry>,
    pub warnings: Vec<ScanWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePackScanResult {
    pub name: String,
    pub path: String,
    pub source_type: String,
    pub is_archive: bool,
    pub has_pack_meta: bool,
    pub lang_file_count: usize,
    pub entry_count: usize,
    pub entries: Vec<LanguageEntry>,
    pub warnings: Vec<ScanWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub job_id: String,
    pub instance_path: String,
    pub validation: InstanceValidation,
    pub mods: Vec<ModScanResult>,
    pub resource_packs: Vec<ResourcePackScanResult>,
    pub source_language: String,
    pub target_language: String,
    pub total_language_files: usize,
    pub total_source_entries: usize,
    pub total_target_entries: usize,
    pub total_pending_entries: usize,
    /// How many pending entries match existing resource-pack translations.
    pub resource_pack_covered_entries: usize,
    /// Entries needing actual translation (excludes existing target-language entries).
    pub actual_pending_entries: usize,
    pub warnings: Vec<ScanWarning>,
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranslateLogEntry {
    pub key: String,
    pub source_text: String,
    pub target_text: String,
    pub mod_name: String,
    pub source_type: String,
}

/// Token usage statistics, shared across models and jobs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

/// Pipeline 阶段标识
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum PipelinePhase {
    #[serde(rename = "scanning")]
    Scanning,
    #[serde(rename = "extracting")]
    Extracting,
    #[serde(rename = "dictionary")]
    Dictionary,
    #[serde(rename = "translating")]
    Translating,
    #[serde(rename = "completed")]
    Completed,
}

/// Pipeline 统一进度事件
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PipelineProgress {
    pub current: usize,
    pub total: usize,
    pub phase: PipelinePhase,
    pub mod_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_step: Option<String>,
    pub stage_status: StageStatus,
}

/// LLM 配置（从 Settings 提取，用于 PipelineConfig）
#[derive(Clone, Debug)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub concurrency: usize,
    pub batch_size: usize,
    pub timeout_secs: u64,
    pub retry_count: u32,
    pub rate_limit_rpm: u32,
    pub prefer_user_dict: bool,
    pub system_prompt: String,
}

/// Pipeline 配置
#[derive(Clone, Debug)]
pub struct PipelineConfig {
    pub root: std::path::PathBuf,
    pub instance_path: String,
    pub source_language: String,
    pub target_language: String,
    pub scan_job_id: Option<String>,
    pub resource_pack_names: Vec<String>,
    pub llm: Option<LlmConfig>,
}

/// Pipeline 结果
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineResult {
    pub completed: usize,
    pub non_llm_count: usize,
    pub llm_count: usize,
    pub token_usage: TokenUsage,
    pub actual_source_language: String,
    pub job_id: String,
}

/// 条目级翻译进度状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum EntryStatus {
    /// 仅占位符，已跳过
    #[serde(rename = "skip")]
    Skip,
    /// 词典命中
    #[serde(rename = "dictionaryHit")]
    DictionaryHit,
    /// 等待 LLM 翻译
    #[serde(rename = "pending")]
    Pending,
    /// 正在翻译
    #[serde(rename = "translating")]
    Translating,
    /// LLM 翻译完成
    #[serde(rename = "completed")]
    Completed,
    /// 翻译失败
    #[serde(rename = "failed")]
    Failed,
}

/// 单一条目的翻译进度事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryProgress {
    pub key: String,
    pub mod_name: String,
    pub source_text: String,
    pub target_text: Option<String>,
    pub status: EntryStatus,
    #[serde(default)]
    pub error_message: Option<String>,
}

/// A single issue found during translation validation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub key: String,
    pub mod_id: String,
    pub source_text: String,
    pub target_text: String,
    pub issue_type: String,
    pub description: String,
    pub severity: String,
}

/// Aggregate report from validating a completed translation job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub total_entries: usize,
    pub passed: usize,
    pub failed: usize,
    pub missing: usize,
    pub placeholder_issues: Vec<ValidationIssue>,
    pub format_issues: Vec<ValidationIssue>,
}

/// Structured error type for the translation pipeline.
///
/// Replaces bare `Result<_, String>` in pipeline phases with a categorised
/// error enum so the frontend can display different error types differently
/// (e.g. configuration errors vs IO errors vs LLM errors).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "message", rename_all = "camelCase")]
pub enum PipelineError {
    /// Invalid or missing configuration (e.g. LLM not configured).
    #[serde(rename = "config")]
    Config(String),
    /// File system or I/O error (scan, read, write).
    #[serde(rename = "io")]
    Io(String),
    /// LLM API call failed (network, auth, rate limit).
    #[serde(rename = "llm")]
    Llm(String),
    /// User cancelled the operation.
    #[serde(rename = "cancelled")]
    Cancelled,
    /// Job or resource not found.
    #[serde(rename = "not_found")]
    NotFound(String),
    /// Internal pipeline logic error.
    #[serde(rename = "internal")]
    Internal(String),
    /// Dictionary error.
    #[serde(rename = "dictionary")]
    Dictionary(String),
}

impl std::fmt::Display for PipelineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PipelineError::Config(msg) => write!(f, "配置错误: {msg}"),
            PipelineError::Io(msg) => write!(f, "IO 错误: {msg}"),
            PipelineError::Llm(msg) => write!(f, "LLM 错误: {msg}"),
            PipelineError::Cancelled => write!(f, "已取消"),
            PipelineError::NotFound(msg) => write!(f, "未找到: {msg}"),
            PipelineError::Internal(msg) => write!(f, "内部错误: {msg}"),
            PipelineError::Dictionary(msg) => write!(f, "词典错误: {msg}"),
        }
    }
}

impl std::error::Error for PipelineError {}

pub static TOTAL_TOKEN_USAGE_PROMPT: AtomicU64 = AtomicU64::new(0);
pub static TOTAL_TOKEN_USAGE_COMPLETION: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_deserialize_missing_language_fields_with_defaults() {
        let settings: Settings = serde_json::from_str(
            r#"{
              "instancePath": "E:/PCL2/.minecraft/versions/Aaalice Craft",
              "baseUrl": "https://api.deepseek.com",
              "apiKey": "",
              "model": "deepseek-v4-flash",
              "temperature": 1.0,
              "maxTokens": 0,
              "concurrency": 6,
              "batchSize": 100,
              "timeoutSecs": 120,
              "retryCount": 3,
              "rateLimitRpm": 3000,
              "preferUserDictionary": true,
              "resetMainLogOnStart": true,
              "enableDebugLog": false,
              "enableHttpLog": false
            }"#,
        )
        .unwrap();

        assert_eq!(settings.app_language, "zh_cn");
        assert_eq!(settings.source_language, "auto");
        assert_eq!(settings.target_language, "zh_cn");
    }
}

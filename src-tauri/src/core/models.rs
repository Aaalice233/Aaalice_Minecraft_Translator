use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicU64;

/// 默认 Minecraft 模组翻译系统提示词
pub const DEFAULT_SYSTEM_PROMPT: &str = "你是一个专业 Minecraft 模组汉化翻译专家，精通中英文游戏术语和模组翻译规范。\n\
\n\
## 格式要求\n\
- 严格按 JSON 数组格式返回：[{\"key\": \"...\", \"text\": \"翻译文本\"}, ...]\n\
- 只返回 JSON，不要包含 markdown 代码块标记或其他解释文字\n\
- 每个条目必须包含 key 和 text 字段\n\
\n\
## 占位符保护（极其重要）\n\
- 保留所有 % 格式代码：%s %d %1$s %2$d %08.2f 等\n\
- 保留所有 § 颜色/样式码：§a §l §r §e §6 等\n\
- 保留所有花括号占位符：{player} {0} {{quest_name}} 等\n\
- 保留所有尖括号引用：<item:minecraft:diamond> <block:stone> 等\n\
- 保留所有转义序列：\\n \\t 等\n\
- 永远不要修改、删除或重新排序这些占位符\n\
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Settings {
    pub app_language: String,
    pub source_language: String,
    pub target_language: String,
    pub instance_path: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub concurrency: u16,
    pub batch_size: u16,
    pub batch_max_chars: u32,
    pub timeout_secs: u16,
    pub retry_count: u16,
    pub retry_delay_secs: f32,
    pub rate_limit_rpm: u32,
    pub reuse_i18n_packs: bool,
    pub reuse_vm_packs: bool,
    pub prefer_user_dictionary: bool,
    pub keep_existing_resource_translations: bool,
    pub enable_ftb_quests: bool,
    pub reset_main_log_on_start: bool,
    pub enable_debug_log: bool,
    pub enable_http_log: bool,
    pub enable_token_stats: bool,
    #[serde(default = "default_resource_pack_names")]
    pub resource_pack_names: Vec<String>,
    pub system_prompt: String,
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
            base_url: "https://api.deepseek.com".to_string(),
            api_key: String::new(),
            model: "deepseek-v4-flash".to_string(),
            temperature: 1.0,
            max_tokens: 0,
            concurrency: 10,
            batch_size: 80,
            batch_max_chars: 120_000,
            timeout_secs: 180,
            retry_count: 5,
            retry_delay_secs: 2.0,
            rate_limit_rpm: 3000,
            reuse_i18n_packs: true,
            reuse_vm_packs: true,
            prefer_user_dictionary: true,
            keep_existing_resource_translations: true,
            enable_ftb_quests: false,
            reset_main_log_on_start: true,
            enable_debug_log: false,
            enable_http_log: false,
            enable_token_stats: true,
            resource_pack_names: vec![
                "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip".to_string(),
                "VMTranslationPack-Converted-1.21.1.zip".to_string(),
            ],
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
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
    pub dict_count: usize,
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
              "batchSize": 80,
              "batchMaxChars": 120000,
              "timeoutSecs": 120,
              "retryCount": 3,
              "retryDelaySecs": 2.0,
              "rateLimitRpm": 3000,
              "reuseI18nPacks": true,
              "reuseVmPacks": true,
              "preferUserDictionary": true,
              "keepExistingResourceTranslations": true,
              "enableFtbQuests": false,
              "resetMainLogOnStart": true,
              "enableDebugLog": false,
              "enableHttpLog": false,
              "enableTokenStats": true
            }"#,
        )
        .unwrap();

        assert_eq!(settings.app_language, "zh_cn");
        assert_eq!(settings.source_language, "auto");
        assert_eq!(settings.target_language, "zh_cn");
    }
}

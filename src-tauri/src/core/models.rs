use serde::{Deserialize, Serialize};

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
    pub i18n_pack_name: String,
    pub vm_pack_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StageStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
}

impl Default for StageStatus {
    fn default() -> Self {
        StageStatus::Running
    }
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
            concurrency: 6,
            batch_size: 80,
            batch_max_chars: 120_000,
            timeout_secs: 120,
            retry_count: 3,
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
            i18n_pack_name: "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip".to_string(),
            vm_pack_name: "VMTranslationPack-Converted-1.21.1.zip".to_string(),
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
    /// Effective pending after deducting resource pack coverage.
    pub actual_pending_entries: usize,
    pub warnings: Vec<ScanWarning>,
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranslateProgress {
    pub current: usize,
    pub total: usize,
    pub phase: String,
    pub mod_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_step: Option<String>,
    pub stage_status: StageStatus,
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

// ── P6: Validation types ───────────────────────────────────────────

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

use std::sync::atomic::AtomicU64;
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

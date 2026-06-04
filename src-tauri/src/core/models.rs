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
            temperature: 0.3,
            max_tokens: 4096,
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
    pub warnings: Vec<ScanWarning>,
}

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
              "temperature": 0.3,
              "maxTokens": 4096,
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

// LLM translation client + Fake mode
// TODO: Full implementation in Step 7

pub mod fake;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationEntry {
    pub key: String,
    pub text: String,
    pub mod_id: String,
    pub source_lang: String,
    pub target_lang: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateResult {
    pub key: String,
    pub original_text: String,
    pub translated_text: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateProgress {
    pub total_entries: usize,
    pub completed_entries: usize,
    pub failed_entries: usize,
    pub current_batch: usize,
    pub total_batches: usize,
}

pub struct LlmClient {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub concurrency: usize,
    pub batch_size: usize,
    pub retry_count: u32,
}

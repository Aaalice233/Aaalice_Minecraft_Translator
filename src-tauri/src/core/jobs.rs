// Translation job state machine
// TODO: Full implementation in Step 8

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Idle,
    Scanning,
    Matching,
    Translating,
    TranslatingPaused,
    Validating,
    ValidatingPaused,
    Packaging,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

impl Default for TokenUsage {
    fn default() -> Self {
        Self {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationJob {
    pub id: String,
    pub status: JobStatus,
    pub created_at: String,
    pub total_entries: usize,
    pub completed_entries: usize,
    pub failed_entries: usize,
    pub skipped_entries: usize,
    pub matched_entries: usize,
    pub pending_entries: usize,
    pub token_usage: TokenUsage,
    pub eta_secs: Option<f64>,
}

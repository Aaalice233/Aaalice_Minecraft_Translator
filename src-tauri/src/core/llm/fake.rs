// Fake LLM server for testing
// TODO: Full implementation in Step 7

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FakeLlmConfig {
    pub port: u16,
    pub delay_ms: u64,
    pub error_rate: f64,
}

impl Default for FakeLlmConfig {
    fn default() -> Self {
        Self {
            port: 11451,
            delay_ms: 50,
            error_rate: 0.0,
        }
    }
}

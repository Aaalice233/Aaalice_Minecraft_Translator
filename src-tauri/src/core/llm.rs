// LLM translation client — OpenAI-compatible API calls
//
// Sends batched translation requests to any OpenAI-compatible endpoint
// (OpenAI, DeepSeek, Anthropic via proxy, etc.) and parses structured
// JSON responses.  Designed for Minecraft mod text: preserves format
// codes, placeholders, and colour markers.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

// ── Data types ──────────────────────────────────────────────────────────

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

// ── Client ──────────────────────────────────────────────────────────────

pub struct LlmClient {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub concurrency: usize,
    pub batch_size: usize,
    pub retry_count: u32,
    pub timeout_secs: u64,
}

impl LlmClient {
    /// Validate that the client has sufficient configuration to make API calls.
    pub fn validate(&self) -> Result<(), String> {
        if self.base_url.is_empty() {
            return Err("API 地址未配置".to_string());
        }
        if self.api_key.is_empty() {
            return Err("API 密钥未配置".to_string());
        }
        if self.model.is_empty() {
            return Err("模型名称未配置".to_string());
        }
        Ok(())
    }

    /// Translate a batch of entries via the LLM API.
    ///
    /// Sends all entries in a single API call with a structured prompt;
    /// expects a JSON array of `{ key, text }` objects in the response.
    /// Entries whose keys appear in the response are marked successful;
    /// missing or parse-error entries are marked as failed.
    pub fn translate_batch(
        &self,
        entries: &[TranslationEntry],
    ) -> (Vec<TranslateResult>, Option<super::models::TokenUsage>) {
        if entries.is_empty() {
            return (Vec::new(), None);
        }

        let source_lang = &entries[0].source_lang;
        let target_lang = &entries[0].target_lang;
        let prompt = build_prompt(entries, source_lang, target_lang);

        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": "你是 Minecraft 模组翻译助手。严格按 JSON 数组格式返回翻译结果，保留所有格式代码（%s、%d、§a 等）和占位符。只返回 JSON，不要附加任何解释。"
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens.max(2048),
            "response_format": { "type": "json_object" },
        });

        let url = format!("{}/v1/chat/completions", self.base_url.trim_end_matches('/'));

        let client = match reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(self.timeout_secs.max(30)))
            .build()
        {
            Ok(c) => c,
            Err(build_err) => {
                return (
                    entries
                        .iter()
                        .map(|entry| TranslateResult {
                            key: entry.key.clone(),
                            original_text: entry.text.clone(),
                            translated_text: entry.text.clone(),
                            success: false,
                            error: Some(format!("HTTP client 创建失败: {build_err}")),
                        })
                        .collect(),
                    None,
                );
            }
        };

        // Retry loop
        let mut last_error = String::new();
        let max_retries = self.retry_count.max(1);

        for attempt in 0..max_retries {
            if attempt > 0 {
                let delay = Duration::from_millis(1000u64 * 2u64.pow(attempt.min(5)));
                std::thread::sleep(delay);
            }

            match send_request(&client, &url, &self.api_key, &body) {
                Ok(response_body) => {
                    let token_usage = extract_token_usage(&response_body);
                    match parse_response(&response_body, entries) {
                        Ok(results) => return (results, token_usage),
                        Err(e) => {
                            last_error = format!("解析响应失败: {e}");
                            continue;
                        }
                    }
                }
                Err(e) => {
                    last_error = format!("API 请求失败: {e}");
                    continue;
                }
            }
        }

        // All retries exhausted — mark all entries as failed
        (
            entries
                .iter()
                .map(|e| TranslateResult {
                    key: e.key.clone(),
                    original_text: e.text.clone(),
                    translated_text: e.text.clone(),
                    success: false,
                    error: Some(last_error.clone()),
                })
                .collect(),
            None,
        )
    }
}

// ── Internal helpers ────────────────────────────────────────────────────

/// Build a structured prompt for the LLM from a batch of entries.
fn build_prompt(entries: &[TranslationEntry], source_lang: &str, target_lang: &str) -> String {
    fn lang_label(code: &str) -> &str {
        match code {
            "zh_cn" => "简体中文",
            "zh_tw" => "繁体中文",
            "en_us" => "英文 (美国)",
            "en_gb" => "英文 (英国)",
            "ja_jp" => "日文",
            "ko_kr" => "韩文",
            "fr_fr" => "法文",
            "de_de" => "德文",
            "es_es" => "西班牙文",
            "pt_br" => "葡萄牙文 (巴西)",
            "ru_ru" => "俄文",
            "it_it" => "意大利文",
            _ => code,
        }
    }

    format!(
        r#"请将以下 Minecraft 模组文本从 {source_label} ({source_lang}) 翻译为 {target_label} ({target_lang})。

规则：
1. 保留所有格式代码（%s、%d、%1$s、%2$d、§a、§l 等）
2. 保留所有占位符（{{player}}、{{0}}、<> 等）
3. 保持 JSON 结构不变
4. 只返回 JSON 数组，格式为 [{{"key": "...", "text": "翻译文本"}}, ...]

输入：
{entries_json}"#,
        source_label = lang_label(source_lang),
        target_label = lang_label(target_lang),
        source_lang = source_lang,
        target_lang = target_lang,
        entries_json = serde_json::to_string_pretty(
            &entries.iter().map(|e| serde_json::json!({
                "key": e.key,
                "text": e.text,
                "mod_id": e.mod_id,
            })).collect::<Vec<_>>()
        ).unwrap_or_default(),
    )
}

/// Send the HTTP request and return the raw response body as a Value.
fn send_request(
    client: &reqwest::blocking::Client,
    url: &str,
    api_key: &str,
    body: &Value,
) -> Result<Value, String> {
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(body)
        .send()
        .map_err(|e| format!("HTTP 请求失败: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let status_code = status.as_u16();
        let response_text = response.text().unwrap_or_default();
        return Err(format!("API 返回 HTTP {status_code}: {response_text}"));
    }

    let response_body: Value = response
        .json()
        .map_err(|e| format!("解析 API 响应 JSON 失败: {e}"))?;

    Ok(response_body)
}

/// Extract token usage from the API response (optional field).
fn extract_token_usage(response_body: &Value) -> Option<super::models::TokenUsage> {
    let usage = response_body.get("usage")?;
    Some(super::models::TokenUsage {
        prompt_tokens: usage.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
        completion_tokens: usage.get("completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
        total_tokens: usage.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
    })
}

/// Extract the assistant's message content from the API response and
/// parse it back into per-entry results.
fn parse_response(
    response_body: &Value,
    entries: &[TranslationEntry],
) -> Result<Vec<TranslateResult>, String> {
    // Navigate: response.choices[0].message.content
    let content = response_body
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            format!(
                "API 响应结构异常: choices/message/content 路径缺失: {}",
                serde_json::to_string(&response_body).unwrap_or_default()
            )
        })?;

    // Try to parse the content as JSON
    let parsed: Value = serde_json::from_str(content)
        .map_err(|e| format!("LLM 返回的不是有效 JSON: {e}\n原始内容: {content}"))?;

    // Extract the translation array
    let translations = parsed
        .get("translations")
        .or_else(|| parsed.as_array().map(|_| &parsed))
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            format!(
                "LLM 返回的 JSON 缺少 translations 数组: {}",
                serde_json::to_string(&parsed).unwrap_or_default()
            )
        })?;

    // Build a lookup map from the response
    let mut result_map: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
    for item in translations {
        let key = item
            .get("key")
            .and_then(|k| k.as_str())
            .unwrap_or_default();
        let text = item
            .get("text")
            .or_else(|| item.get("translation"))
            .and_then(|t| t.as_str())
            .unwrap_or("");
        if !key.is_empty() && !text.is_empty() {
            result_map.insert(key, text.to_string());
        }
    }

    // Map results back to input entries
    let results: Vec<TranslateResult> = entries
        .iter()
        .map(|e| {
            match result_map.get(e.key.as_str()) {
                Some(translated) => TranslateResult {
                    key: e.key.clone(),
                    original_text: e.text.clone(),
                    translated_text: translated.clone(),
                    success: true,
                    error: None,
                },
                None => TranslateResult {
                    key: e.key.clone(),
                    original_text: e.text.clone(),
                    translated_text: e.text.clone(),
                    success: false,
                    error: Some("LLM 响应中未找到该条目的翻译".to_string()),
                },
            }
        })
        .collect();

    Ok(results)
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_style_response() {
        let body: Value = serde_json::from_str(r#"{
            "choices": [{
                "message": {
                    "content": "{\"translations\": [{\"key\": \"item.a\", \"text\": \"物品 A\"}, {\"key\": \"item.b\", \"text\": \"物品 B\"}]}"
                }
            }]
        }"#).unwrap();

        let entries = vec![
            TranslationEntry {
                key: "item.a".into(),
                text: "Item A".into(),
                mod_id: "test".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
            },
            TranslationEntry {
                key: "item.b".into(),
                text: "Item B".into(),
                mod_id: "test".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
            },
        ];

        let results = parse_response(&body, &entries).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].translated_text, "物品 A");
        assert_eq!(results[1].translated_text, "物品 B");
        assert!(results[0].success);
    }

    #[test]
    fn parses_response_with_translation_field() {
        let body: Value = serde_json::from_str(r#"{
            "choices": [{
                "message": {
                    "content": "{\"translations\": [{\"key\": \"item.a\", \"translation\": \"物品 A\"}]}"
                }
            }]
        }"#).unwrap();

        let entries = vec![
            TranslationEntry {
                key: "item.a".into(),
                text: "Item A".into(),
                mod_id: "test".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
            },
        ];

        let results = parse_response(&body, &entries).unwrap();
        assert_eq!(results[0].translated_text, "物品 A");
    }

    #[test]
    fn missing_entry_in_response_marked_failed() {
        let body: Value = serde_json::from_str(r#"{
            "choices": [{
                "message": {
                    "content": "{\"translations\": [{\"key\": \"item.a\", \"text\": \"物品 A\"}]}"
                }
            }]
        }"#).unwrap();

        let entries = vec![
            TranslationEntry {
                key: "item.a".into(),
                text: "Item A".into(),
                mod_id: "test".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
            },
            TranslationEntry {
                key: "item.b".into(),
                text: "Item B".into(),
                mod_id: "test".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
            },
        ];

        let results = parse_response(&body, &entries).unwrap();
        assert!(results[0].success, "item.a 应在响应中");
        assert!(!results[1].success, "item.b 不在响应中应标记失败");
        assert_eq!(results[0].translated_text, "物品 A");
        assert_eq!(results[1].translated_text, "Item B"); // fallback = source
    }

    #[test]
    fn build_prompt_includes_entries() {
        let entries = vec![
            TranslationEntry {
                key: "item.a".into(),
                text: "Item A".into(),
                mod_id: "test".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
            },
        ];
        let prompt = build_prompt(&entries, "en_us", "zh_cn");
        assert!(prompt.contains("Item A"));
        assert!(prompt.contains("item.a"));
        assert!(prompt.contains("英文"));
        assert!(prompt.contains("简体中文"));
    }
}

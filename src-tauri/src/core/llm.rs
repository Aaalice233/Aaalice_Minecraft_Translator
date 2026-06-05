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
    pub system_prompt: String,
    /// 有效并发数（运行时动态调整，用于限流适应）
    pub effective_concurrency: std::sync::atomic::AtomicUsize,
    /// 连续 429 错误计数（达到阈值后主动降速）
    pub consecutive_429s: std::sync::atomic::AtomicUsize,
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
        on_batch_complete: Option<&(dyn Fn(&[TranslateResult]) + Sync)>,
    ) -> (Vec<TranslateResult>, Option<super::models::TokenUsage>) {
        if entries.is_empty() {
            return (Vec::new(), None);
        }

        let source_lang = &entries[0].source_lang;
        let target_lang = &entries[0].target_lang;
        let prompt = build_prompt(entries, source_lang, target_lang);

        let mut body = serde_json::json!({
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": &self.system_prompt
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": self.temperature,
            "response_format": { "type": "json_object" },
        });

        // max_tokens = 0 表示不限制，交给 API 服务端决定输出上限
        if self.max_tokens > 0 {
            body["max_tokens"] = serde_json::json!(self.max_tokens);
        }

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
                    // 从 API 响应结构中提取 content 字段
                    let content_str = match response_body
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|c| c.first())
                        .and_then(|c| c.get("message"))
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        Some(s) => s,
                        None => {
                            last_error = format!(
                                "API 响应结构异常: choices/message/content 路径缺失: {}",
                                serde_json::to_string(&response_body).unwrap_or_default()
                            );
                            continue;
                        }
                    };
                    match healing_parse_response(content_str, entries) {
                        Ok(results) => {
                            if let Some(cb) = on_batch_complete {
                                cb(&results);
                            }
                            return (results, token_usage);
                        }
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
    if status == 429 {
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(30);
        return Err(format!("RATE_LIMITED:{}", retry_after));
    }
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

/// 多层容错解析 LLM 响应文本
fn healing_parse_response(
    content: &str,
    entries: &[TranslationEntry],
) -> Result<Vec<TranslateResult>, String> {
    if content.trim().is_empty() {
        return Err("LLM 返回内容为空".to_string());
    }

    // 第 1 层：直接解析
    if let Ok(val) = serde_json::from_str::<Value>(content) {
        return parse_translations_from_value(&val, entries);
    }

    // 第 2 层：修复常见错误后解析
    let fixed = fix_json_errors(content);
    if fixed != content {
        if let Ok(val) = serde_json::from_str::<Value>(&fixed) {
            return parse_translations_from_value(&val, entries);
        }
    }

    // 第 3 层：提取 markdown 代码块
    if let Some(start) = content.find("```") {
        let after = &content[start + 3..];
        let code = if let Some(end) = after.find("```") {
            &after[..end]
        } else {
            after
        };
        let trimmed = code.trim().trim_start_matches("json").trim();
        if !trimmed.is_empty() {
            let fixed = fix_json_errors(trimmed);
            if let Ok(val) = serde_json::from_str::<Value>(&fixed) {
                return parse_translations_from_value(&val, entries);
            }
        }
    }

    // 第 4 层：逐行解析
    let mut pairs = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim().trim_end_matches(',').trim();
        if trimmed.starts_with('{') && trimmed.contains("\"key\"") {
            let fixed = fix_json_errors(trimmed);
            if let Ok(v) = serde_json::from_str::<Value>(&fixed) {
                if let (Some(key), Some(text)) = (
                    v.get("key").and_then(|k| k.as_str()),
                    v.get("text").or(v.get("translation")).and_then(|t| t.as_str()),
                ) {
                    pairs.push((key.to_string(), text.to_string()));
                }
            }
        }
    }

    if !pairs.is_empty() {
        return Ok(map_results(pairs, entries));
    }

    Err(format!("无法解析 LLM 响应: {}", &content[..content.len().min(200)]))
}

/// 修复常见 JSON 格式错误
fn fix_json_errors(s: &str) -> String {
    let mut s = s.to_string();
    // 去掉 markdown 代码块标记
    s = s.replace("```json", "").replace("```", "");
    // 去掉尾部逗号（JSON 不允许）
    s = s.trim().to_string();
    if s.ends_with(',') {
        s.pop();
    }
    // 去掉闭合括号前的多余逗号（如 {"key":"a","text":"b",} 或 [{"key":"a"},]）
    while s.contains(",]") || s.contains(",}") {
        s = s.replace(",]", "]");
        s = s.replace(",}", "}");
    }
    // 替换单引号为双引号（只在非转义上下文中）
    s = s.replace('\'', "\"");
    s
}

/// 从已解析的 Value 中提取 translations 数组
fn parse_translations_from_value(parsed: &Value, entries: &[TranslationEntry]) -> Result<Vec<TranslateResult>, String> {
    let translations = parsed
        .get("translations")
        .or_else(|| if parsed.is_array() { Some(parsed) } else { None })
        .and_then(|v| v.as_array())
        .ok_or_else(|| "JSON 缺少 translations 数组".to_string())?;

    let mut pairs = Vec::new();
    for item in translations {
        let key = item.get("key").and_then(|k| k.as_str()).unwrap_or_default();
        let text = item.get("text").or(item.get("translation")).and_then(|t| t.as_str()).unwrap_or_default();
        if !key.is_empty() && !text.is_empty() {
            pairs.push((key.to_string(), text.to_string()));
        }
    }

    Ok(map_results(pairs, entries))
}

/// 将 (key, text) 对映射回 entries 顺序
fn map_results(pairs: Vec<(String, String)>, entries: &[TranslationEntry]) -> Vec<TranslateResult> {
    let map: std::collections::HashMap<&str, &str> = pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    entries.iter().map(|e| {
        match map.get(e.key.as_str()) {
            Some(text) => TranslateResult {
                key: e.key.clone(),
                original_text: e.text.clone(),
                translated_text: text.to_string(),
                success: true,
                error: None,
            },
            None => TranslateResult {
                key: e.key.clone(),
                original_text: e.text.clone(),
                translated_text: e.text.clone(),
                success: false,
                error: Some("LLM 响应中未找到该条目".to_string()),
            },
        }
    }).collect()
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

    // ── healing_parse_response tests ─────────────────────────────────

    fn sample_entries() -> Vec<TranslationEntry> {
        vec![
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
        ]
    }

    #[test]
    fn healing_normal_valid_json() {
        let content = r#"{"translations": [{"key": "item.a", "text": "物品A"}, {"key": "item.b", "text": "物品B"}]}"#;
        let results = healing_parse_response(content, &sample_entries()).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].translated_text, "物品A");
        assert_eq!(results[1].translated_text, "物品B");
        assert!(results[0].success);
        assert!(results[1].success);
    }

    #[test]
    fn healing_trailing_comma() {
        // 带尾部逗号的 JSON
        let content = r#"{"translations": [{"key": "item.a", "text": "物品A",}, {"key": "item.b", "text": "物品B",},]}"#;
        let results = healing_parse_response(content, &sample_entries()).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].translated_text, "物品A");
        assert_eq!(results[1].translated_text, "物品B");
    }

    #[test]
    fn healing_single_quotes() {
        // 单引号替换为双引号
        let content = r#"{'translations': [{'key': 'item.a', 'text': '物品A'}, {'key': 'item.b', 'text': '物品B'}]}"#;
        let results = healing_parse_response(content, &sample_entries()).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].translated_text, "物品A");
        assert_eq!(results[1].translated_text, "物品B");
    }

    #[test]
    fn healing_markdown_code_block() {
        let content = "```json\n{\"translations\": [{\"key\": \"item.a\", \"text\": \"物品A\"}, {\"key\": \"item.b\", \"text\": \"物品B\"}]}\n```";
        let results = healing_parse_response(content, &sample_entries()).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].translated_text, "物品A");
        assert_eq!(results[1].translated_text, "物品B");
    }

    #[test]
    fn healing_markdown_code_block_with_label() {
        let content = "```json\n{\"translations\": [{\"key\": \"item.a\", \"text\": \"物品A\"}]}\n```";
        let entries = vec![
            TranslationEntry {
                key: "item.a".into(),
                text: "Item A".into(),
                mod_id: "test".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
            },
        ];
        let results = healing_parse_response(content, &entries).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].translated_text, "物品A");
    }

    #[test]
    fn healing_empty_content() {
        let result = healing_parse_response("", &sample_entries());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("空"));

        let result = healing_parse_response("  ", &sample_entries());
        assert!(result.is_err());
    }

    #[test]
    fn healing_line_by_line_recovery() {
        // 每一行都是一个独立的对象，但整体不是合法 JSON
        let content = "{\"key\": \"item.a\", \"text\": \"物品A\"}\n{\"key\": \"item.b\", \"text\": \"物品B\"}";
        let results = healing_parse_response(content, &sample_entries()).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].translated_text, "物品A");
        assert_eq!(results[1].translated_text, "物品B");
    }

    #[test]
    fn healing_partial_recovery() {
        // 只有部分条目可恢复
        let content = "{\"key\": \"item.a\", \"text\": \"物品A\"}\n垃圾行\n{\"key\": \"item.b\", \"text\": \"物品B\"}";
        let results = healing_parse_response(content, &sample_entries()).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].translated_text, "物品A");
        assert_eq!(results[1].translated_text, "物品B");
    }

    #[test]
    fn healing_translation_field() {
        // 使用 translation 而非 text 字段
        let content = r#"{"translations": [{"key": "item.a", "translation": "物品A"}]}"#;
        let entries = vec![
            TranslationEntry {
                key: "item.a".into(),
                text: "Item A".into(),
                mod_id: "test".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
            },
        ];
        let results = healing_parse_response(content, &entries).unwrap();
        assert_eq!(results[0].translated_text, "物品A");
    }

    #[test]
    fn healing_missing_entry_marked_failed() {
        let content = r#"{"translations": [{"key": "item.a", "text": "物品A"}]}"#;
        let results = healing_parse_response(content, &sample_entries()).unwrap();
        assert!(results[0].success);
        assert!(!results[1].success);
        assert_eq!(results[0].translated_text, "物品A");
        assert_eq!(results[1].translated_text, "Item B"); // fallback = source
    }
}

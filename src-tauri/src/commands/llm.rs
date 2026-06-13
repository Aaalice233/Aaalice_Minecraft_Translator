use tracing::info;

use crate::core::{
    llm::{LlmClient, TranslationEntry},
    models::{LlmModel, LlmModelsResponse, DEFAULT_SYSTEM_PROMPT},
};

/// Validate a URL to prevent SSRF: ensure scheme is http/https
/// and the host is not a private/internal/loopback address.
pub(crate) fn validate_url(url_str: &str) -> Result<(), String> {
    let trimmed = url_str.trim();

    // Check scheme
    let after_scheme = if trimmed.starts_with("https://") {
        &trimmed[8..]
    } else if trimmed.starts_with("http://") {
        &trimmed[7..]
    } else {
        return Err("仅支持 http/https 协议".to_string());
    };

    // Skip userinfo (credentials) if present
    let after_auth = match after_scheme.find('@') {
        Some(at_pos) => &after_scheme[at_pos + 1..],
        None => after_scheme,
    };

    // Extract host (before first /, :, ?, #)
    let host = after_auth
        .split(|c: char| c == '/' || c == ':' || c == '?' || c == '#')
        .next()
        .ok_or("URL 缺少主机名")?;

    if host.is_empty() {
        return Err("URL 缺少主机名".to_string());
    }

    // Strip brackets for IPv6
    let bare_host = host.trim_start_matches('[').trim_end_matches(']');

    // Check localhost names
    let lower = bare_host.to_ascii_lowercase();
    if lower == "localhost"
        || lower == "localhost.localdomain"
        || lower == "127.0.0.1"
        || lower == "0.0.0.0"
        || lower == "::1"
    {
        return Err("不允许访问本机地址".to_string());
    }

    // Check common internal hostnames
    if lower.ends_with(".local")
        || lower.ends_with(".internal")
        || lower == "metadata.google.internal"
    {
        return Err("不允许访问内网地址".to_string());
    }

    // Parse as IP to check private/link-local/unspecified ranges
    if let Ok(ip) = bare_host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(v4) => {
                if v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
                {
                    return Err("不允许访问内网地址".to_string());
                }
            }
            std::net::IpAddr::V6(v6) => {
                if v6.is_loopback() || v6.is_unspecified() {
                    return Err("不允许访问内网地址".to_string());
                }
                let segments = v6.segments();
                // Check unique-local (fc00::/7)
                if segments[0] & 0xfe00 == 0xfc00 {
                    return Err("不允许访问内网地址".to_string());
                }
                // Check link-local (fe80::/10)
                if segments[0] & 0xffc0 == 0xfe80 {
                    return Err("不允许访问内网地址".to_string());
                }
            }
        }
    }

    Ok(())
}

pub(crate) fn model_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        vec![format!("{trimmed}/models")]
    } else {
        vec![format!("{trimmed}/models"), format!("{trimmed}/v1/models")]
    }
}

/// Parse the common `{ data: [{ id, owned_by }, ...] }` response body.
fn parse_llm_models(body: serde_json::Value) -> Vec<LlmModel> {
    body.get("data")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?.to_string();
                    let owned_by = item
                        .get("owned_by")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some(LlmModel { id, owned_by })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Lightweight version used by the warmup pipeline — skips SSRF validation
/// (the caller is responsible for validating URLs) and uses a shorter timeout.
pub fn fetch_llm_models_internal(
    base_url: String,
    api_key: String,
) -> Result<LlmModelsResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let urls = model_urls(&base_url);
    let mut last_error = String::new();

    for url in urls {
        let response = match client.get(&url).bearer_auth(&api_key).send() {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("模型列表请求失败: {e}");
                continue;
            }
        };

        if !response.status().is_success() {
            last_error = format!("模型列表请求失败: HTTP {}", response.status());
            continue;
        }

        let body: serde_json::Value = match response.json() {
            Ok(b) => b,
            Err(e) => {
                last_error = format!("响应解析失败: {e}");
                continue;
            }
        };
        let models = parse_llm_models(body);

        info!("fetch_llm_models_internal: 获取到 {} 个模型", models.len());
        return Ok(LlmModelsResponse {
            models,
            source_url: url,
        });
    }

    info!("fetch_llm_models_internal: 请求失败: {last_error}");
    Err(last_error)
}

#[tauri::command]
pub fn fetch_llm_models(base_url: String, api_key: String) -> Result<LlmModelsResponse, String> {
    info!("fetch_llm_models: base_url={}", &base_url);
    validate_url(&base_url)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let urls = model_urls(&base_url);

    for url_str in &urls {
        validate_url(url_str)?;
    }
    let mut last_error = String::new();

    for url in urls {
        let response = client
            .get(&url)
            .bearer_auth(&api_key)
            .send()
            .map_err(|e| e.to_string());

        let Ok(response) = response else {
            last_error = "模型列表请求失败".to_string();
            continue;
        };

        if !response.status().is_success() {
            last_error = format!("模型列表请求失败：HTTP {}", response.status());
            continue;
        }

        let body: serde_json::Value = response.json().map_err(|e| e.to_string())?;
        let models = parse_llm_models(body);

        info!("fetch_llm_models: 获取到 {} 个模型", models.len());
        return Ok(LlmModelsResponse {
            models,
            source_url: url,
        });
    }

    info!("fetch_llm_models: 请求失败: {last_error}");
    Err(if last_error.is_empty() {
        "未能拉取模型列表".to_string()
    } else {
        last_error
    })
}

#[tauri::command]
pub fn check_llm_connection(
    base_url: String,
    api_key: String,
    model: String,
) -> Result<bool, String> {
    info!("check_llm_connection: model={}", &model);
    validate_url(&base_url)?;
    let client = LlmClient {
        base_url,
        api_key,
        model,
        temperature: 0.0,
        max_tokens: 64,
        concurrency: 1,
        batch_size: 1,
        retry_count: 1,
        timeout_secs: 30,
        system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
        http_client: LlmClient::build_http_client(30),
        effective_concurrency: std::sync::atomic::AtomicUsize::new(1),
        consecutive_429s: std::sync::atomic::AtomicUsize::new(0),
    };
    client.validate()?;
    let entry = TranslationEntry {
        key: "connection.test".to_string(),
        text: "Connection Test".to_string(),
        mod_id: "aaalice_mc_translator".to_string(),
        mod_name: String::new(),
        source_lang: "en_us".to_string(),
        target_lang: "zh_cn".to_string(),
        references: Vec::new(),
    };
    let (results, _) = client.translate_batch(&[entry], None, None);
    let Some(result) = results.first() else {
        return Err("API 测试未返回结果".to_string());
    };
    if !result.success || result.translated_text.trim().is_empty() {
        return Err(result
            .error
            .clone()
            .unwrap_or_else(|| "API 测试返回空译文".to_string()));
    }
    Ok(true)
}

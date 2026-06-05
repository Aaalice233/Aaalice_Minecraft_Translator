use crate::core::{
    llm::LlmClient,
    models::{LlmModel, LlmModelsResponse},
};

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn model_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        vec![format!("{trimmed}/models")]
    } else {
        vec![format!("{trimmed}/models"), format!("{trimmed}/v1/models")]
    }
}

#[tauri::command]
pub fn fetch_llm_models(base_url: String, api_key: String) -> Result<LlmModelsResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(to_message)?;
    let urls = model_urls(&base_url);
    let mut last_error = String::new();

    for url in urls {
        let response = client
            .get(&url)
            .bearer_auth(&api_key)
            .send()
            .map_err(to_message);

        let Ok(response) = response else {
            last_error = "模型列表请求失败".to_string();
            continue;
        };

        if !response.status().is_success() {
            last_error = format!("模型列表请求失败：HTTP {}", response.status());
            continue;
        }

        let body: serde_json::Value = response.json().map_err(to_message)?;
        let models = body
            .get("data")
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
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        return Ok(LlmModelsResponse {
            models,
            source_url: url,
        });
    }

    Err(if last_error.is_empty() {
        "未能拉取模型列表".to_string()
    } else {
        last_error
    })
}

#[tauri::command]
pub fn check_llm_connection(base_url: String, api_key: String, model: String) -> Result<bool, String> {
    let client = LlmClient {
        base_url,
        api_key,
        model,
        temperature: 1.0,
        max_tokens: 0,
        concurrency: 1,
        batch_size: 1,
        retry_count: 1,
        timeout_secs: 30,
        system_prompt: String::new(),
        effective_concurrency: std::sync::atomic::AtomicUsize::new(1),
        consecutive_429s: std::sync::atomic::AtomicUsize::new(0),
    };
    client.validate()?;
    Ok(true)
}

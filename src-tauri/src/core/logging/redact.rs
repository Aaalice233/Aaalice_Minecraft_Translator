use std::sync::OnceLock;

use regex::Regex;

/// Redact sensitive information (API keys, tokens) from log messages using regex patterns.
///
/// The approach avoids raw string regex literals to prevent editor/truncation issues.
/// Patterns are compiled lazily with OnceLock.
pub fn redact_secret(message: &str) -> String {
    // Fast path: skip regex overhead if no suspicious patterns are present
    let lower = message.to_ascii_lowercase();
    if !lower.contains("api_key")
        && !lower.contains("apikey")
        && !lower.contains("authorization")
        && !lower.contains("bearer")
        && !lower.contains("sk-")
        && !lower.contains("sk_")
    {
        return message.to_string();
    }

    static PATTERNS: OnceLock<Vec<(Regex, &str)>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        vec![
            // Pattern 1: "api_key":"sk-xxxx..." in JSON
            (
                Regex::new(
                    "(?i)(api[_-]?key|authorization)\\s*[:=]\\s*[\"']?(sk-[a-zA-Z0-9]{20,})[\"']?",
                )
                .unwrap(),
                "[REDACTED]",
            ),
            // Pattern 2: api_key=sk-xxxx in URL query or headers
            (
                Regex::new("(?i)(api[_-]?key|authorization)\\s*[:=]\\s*(sk-[a-zA-Z0-9]{20,})")
                    .unwrap(),
                "${1}=[REDACTED]",
            ),
            // Pattern 3: Bearer sk-xxxx
            (
                Regex::new("(?i)(Bearer\\s+)(sk-[a-zA-Z0-9]{20,})").unwrap(),
                "${1}[REDACTED]",
            ),
            // Pattern 4: Generic long API keys (16+ chars) after known labels
            (
                Regex::new(
                    "(?i)(api[_-]?key|authorization)\\s*[:=]\\s*[\"']?([a-zA-Z0-9_\\-]{16,})[\"']?",
                )
                .unwrap(),
                "[REDACTED]",
            ),
            // Pattern 5: Standalone sk- keys (word boundary)
            (
                Regex::new("(?i)\\b(sk-[a-zA-Z0-9]{20,})\\b").unwrap(),
                "[REDACTED]",
            ),
        ]
    });

    let mut result = message.to_string();
    for (re, replacement) in patterns {
        result = re.replace_all(&result, *replacement).to_string();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_sk_key() {
        let msg = r#"api_key": "sk-abc123def456ghi789jkl012""#;
        let redacted = redact_secret(msg);
        assert!(!redacted.contains("sk-"), "密钥应被脱敏: {redacted}");
        assert!(redacted.contains("[REDACTED]"), "应包含 [REDACTED] 标记");
    }

    #[test]
    fn test_redact_bearer_token() {
        let msg = "Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        let redacted = redact_secret(msg);
        assert!(!redacted.contains("sk-xx"), "Bearer token 应被脱敏");
    }

    #[test]
    fn test_redact_innocent_text_unchanged() {
        let msg = "这是一条正常的日志消息，不包含任何敏感信息";
        let redacted = redact_secret(msg);
        assert_eq!(redacted, msg, "普通文本不应被修改");
    }
}

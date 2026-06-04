use regex::Regex;
use std::sync::OnceLock;

/// A single placeholder token extracted from text during protection.
#[derive(Debug, Clone, PartialEq)]
pub struct ShieldToken {
    /// The original placeholder text (e.g. "%s", "§a", "{player}")
    pub original: String,
    /// The replacement token sent to LLM (e.g. "__SHIELD_0__")
    pub token: String,
    /// The index/position of this token in the original text
    pub index: usize,
}

/// Result of protecting a text: the protected string and the extracted tokens.
#[derive(Debug, Clone)]
pub struct ShieldResult {
    /// Text with placeholders replaced by tokens
    pub protected: String,
    /// Extracted tokens for later restore/validation
    pub tokens: Vec<ShieldToken>,
}

fn percent_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"%(\d+\$)?[-#+ 0,]*(\d+)?(\.\d+)?[tT]?[dsfFeEgGxXoOaAcCbBhHn]").unwrap())
}

fn brace_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}").unwrap())
}

fn section_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"§[0-9a-fk-or]").unwrap())
}

fn tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<(item|block|entity|fluid):[^>]+>").unwrap())
}

fn double_brace_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{[^}]*\}\}").unwrap())
}

/// Protect a text: replace all known placeholder patterns with shield tokens.
///
/// Extraction order (must match restore order):
/// 1. Double braces ({{...}})
/// 2. Minecraft tag references (<item:...>)
/// 3. Section/color codes (§a, §l, etc.)
/// 4. Curly-brace variables ({player})
/// 5. Java String.format placeholders (%s, %d, %1$s)
pub fn protect(text: &str) -> ShieldResult {
    let mut tokens = Vec::new();
    let mut protected = text.to_string();
    let mut index = 0usize;

    // Phase 1: Double braces (must be first, they contain brace chars)
    protected = protect_with_regex(&protected, double_brace_regex(), &mut tokens, &mut index);

    // Phase 2: Minecraft tag references
    protected = protect_with_regex(&protected, tag_regex(), &mut tokens, &mut index);

    // Phase 3: Section/color codes
    protected = protect_with_regex(&protected, section_regex(), &mut tokens, &mut index);

    // Phase 4: Brace variables
    protected = protect_with_regex(&protected, brace_regex(), &mut tokens, &mut index);

    // Phase 5: Percent placeholders (must be last, they use % chars)
    protected = protect_with_regex(&protected, percent_regex(), &mut tokens, &mut index);

    ShieldResult { protected, tokens }
}

/// Restore original placeholders from shielded tokens.
pub fn restore(protected: &str, tokens: &[ShieldToken]) -> String {
    let mut result = protected.to_string();
    // Restore in reverse order to avoid token substring collisions
    // e.g., __SHIELD_1__ contains __SHIELD_1 (but not really, since we use exact match)
    for token in tokens.iter().rev() {
        result = result.replace(&token.token, &token.original);
    }
    result
}

/// Validate that all original placeholders exist in the translated text.
/// Checks each token independently (not order-dependent), because LLM may
/// reorder sentence structure while preserving placeholders.
/// Returns `true` if all tokens are found.
pub fn validate(original_tokens: &[ShieldToken], translated: &str) -> bool {
    original_tokens
        .iter()
        .all(|token| translated.contains(&token.original))
}

/// Validate a single text entry: protect → check all tokens are unique → return validation result
pub fn validate_entry(text: &str) -> EntryValidation {
    let result = protect(text);
    // Check: all tokens were successfully restored
    let restored = restore(&result.protected, &result.tokens);
    let full_roundtrip = restored == text;

    // Check: no token collisions (all tokens are distinct)
    let mut seen = Vec::new();
    let no_duplicates = result.tokens.iter().all(|t| {
        if seen.contains(&t.token) { false } else { seen.push(t.token.clone()); true }
    });

    EntryValidation {
        is_valid: full_roundtrip && no_duplicates,
        token_count: result.tokens.len(),
        full_roundtrip,
        no_duplicates,
    }
}

#[derive(Debug, Clone)]
pub struct EntryValidation {
    pub is_valid: bool,
    pub token_count: usize,
    pub full_roundtrip: bool,
    pub no_duplicates: bool,
}

/// Apply protect → LLM translations → restore chain to a batch of texts.
/// Returns the restored texts (None for entries that failed validation).
pub fn process_batch(
    texts: &[&str],
    translations: &[String],
) -> Vec<Option<String>> {
    let protections: Vec<ShieldResult> = texts.iter().map(|t| protect(t)).collect();

    texts
        .iter()
        .zip(translations.iter())
        .zip(protections.iter())
        .map(|((_original, translation), shield)| {
            // Restore tokens in the translation
            let restored = restore(translation, &shield.tokens);
            // Validate that all tokens survived
            if !validate(&shield.tokens, &restored) {
                return None;
            }
            Some(restored)
        })
        .collect()
}

fn protect_with_regex(
    text: &str,
    re: &Regex,
    tokens: &mut Vec<ShieldToken>,
    index: &mut usize,
) -> String {
    // Collect all matches with their positions
    let matches: Vec<_> = re.find_iter(text).map(|m| (m.start(), m.end())).collect();
    if matches.is_empty() {
        return text.to_string();
    }

    // Build the result string by walking through the text and replacing matches
    let mut result = String::with_capacity(text.len());
    let mut last_end = 0;
    for (start, end) in &matches {
        // Append text before this match
        result.push_str(&text[last_end..*start]);
        // Extract original and create token
        let original = text[*start..*end].to_string();
        let token = format!("__SHIELD_{}__", *index);
        tokens.push(ShieldToken {
            original,
            token: token.clone(),
            index: *index,
        });
        *index += 1;
        // Append the shield token
        result.push_str(&token);
        last_end = *end;
    }
    // Append remaining text after last match
    result.push_str(&text[last_end..]);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_percent_s() {
        let result = protect("按住 %s 打开 %s 界面");
        assert_eq!(result.tokens.len(), 2);
        assert_eq!(result.tokens[0].original, "%s");
        assert!(result.protected.contains("__SHIELD_0__"));
        assert!(result.protected.contains("__SHIELD_1__"));
    }

    #[test]
    fn protects_curly_brace_variables() {
        let result = protect("欢迎 {player}！你有 {count} 条消息");
        assert_eq!(result.tokens.len(), 2);
        assert_eq!(result.tokens[0].original, "{player}");
        assert_eq!(result.tokens[1].original, "{count}");
    }

    #[test]
    fn protects_section_codes() {
        let result = protect("§a绿色文本 §l粗体 §r重置");
        assert!(result.tokens.iter().any(|t| t.original == "§a"));
        assert!(result.tokens.iter().any(|t| t.original == "§l"));
        assert!(result.tokens.iter().any(|t| t.original == "§r"));
    }

    #[test]
    fn protects_tag_references() {
        let result = protect("获得 <item:minecraft:diamond> 和 <block:minecraft:stone>");
        assert!(result.tokens.iter().any(|t| t.original == "<item:minecraft:diamond>"));
        assert!(result.tokens.iter().any(|t| t.original == "<block:minecraft:stone>"));
    }

    #[test]
    fn protects_double_braces() {
        let result = protect("任务描述 {{quest.name}} 完成");
        assert!(result.tokens.iter().any(|t| t.original.contains("{{")));
    }

    #[test]
    fn protects_complex_formats() {
        let result = protect("HP: %1$d/%2$d  进度: %08.2f%%");
        assert!(result.tokens.iter().any(|t| t.original == "%1$d"));
        assert!(result.tokens.iter().any(|t| t.original == "%2$d"));
        assert!(result.tokens.iter().any(|t| t.original.contains("%")));
    }

    #[test]
    fn roundtrip_preserves_text() {
        let original = "按住 %s 打开 §l%s§r 界面";
        let shield = protect(original);
        let restored = restore(&shield.protected, &shield.tokens);
        assert_eq!(restored, original);
    }

    #[test]
    fn roundtrip_preserves_complex_text() {
        let original = "§a欢迎 {player}！你有 %d 条新消息 <item:minecraft:paper>";
        let shield = protect(original);
        let restored = restore(&shield.protected, &shield.tokens);
        assert_eq!(restored, original);
    }

    #[test]
    fn validate_accepts_restored_text_with_placeholders() {
        let original = "按住 %s 打开 %s";
        let shield = protect(original);
        let restored = restore(&shield.protected, &shield.tokens);
        assert_eq!(restored, original);
        assert!(validate(&shield.tokens, &restored));
    }

    #[test]
    fn validate_detects_missing_tokens() {
        let original = "按住 %s 打开 %s";
        let shield = protect(original);
        assert!(!validate(&shield.tokens, "按住 打开"));
    }

    #[test]
    fn process_batch_succeeds_when_tokens_preserved() {
        let texts = vec!["按住 %s 打开", "欢迎 {player}"];
        let translations = vec!["按住 __SHIELD_0__ 打开".to_string(), "欢迎 __SHIELD_0__".to_string()];
        let results = process_batch(&texts, &translations);
        assert_eq!(results.len(), 2);
        assert!(results[0].is_some());
        assert!(results[1].is_some());
        assert_eq!(results[0].as_deref(), Some("按住 %s 打开"));
        assert_eq!(results[1].as_deref(), Some("欢迎 {player}"));
    }

    #[test]
    fn process_batch_fails_when_token_lost() {
        let texts = vec!["按住 %s 打开"];
        let translations = vec!["按住 打开".to_string()];
        let results = process_batch(&texts, &translations);
        assert!(results[0].is_none());
    }

    #[test]
    fn full_pipeline_preserves_all_placeholder_types() {
        let original = "§a按住 %s 打开 {player} 的背包";
        let shield = protect(original);
        let llm_output = shield.protected.clone();
        let restored = restore(&llm_output, &shield.tokens);
        assert_eq!(restored, original);
        assert!(validate(&shield.tokens, &restored));
    }

    #[test]
    fn validates_entry_roundtrip() {
        let validation = validate_entry("§a欢迎 {player}！耗时 %dms");
        assert!(validation.is_valid);
        assert_eq!(validation.token_count, 3);
    }

    #[test]
    fn empty_text_has_no_tokens() {
        let result = protect("");
        assert_eq!(result.tokens.len(), 0);
        assert_eq!(result.protected, "");
    }

    #[test]
    fn text_without_placeholders_is_unchanged() {
        let original = "这是一个普通的文本";
        let result = protect(original);
        assert_eq!(result.tokens.len(), 0);
        assert_eq!(result.protected, original);
    }
}

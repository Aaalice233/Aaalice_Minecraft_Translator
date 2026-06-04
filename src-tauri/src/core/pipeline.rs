// Translation pipeline orchestration
// Coordinates Shield → Dictionary → LLM → Packer into a coherent pipeline.
// Jobs module handles state transitions and UI events; Pipeline handles the actual
// translation flow for a batch of entries.

use crate::core::{dictionary, shield};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A single source entry to be processed through the pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry {
    pub key: String,
    pub text: String,
    pub mod_id: String,
    pub source_lang: String,
    pub target_lang: String,
}

/// The matching result for a single entry.
#[derive(Debug, Clone)]
pub enum MatchResult {
    /// Matched from dictionary (manual, cfpa, etc.)
    Matched(dictionary::DictionaryEntry),
    /// Needs LLM translation
    Unmatched(SourceEntry),
    /// Text is all placeholders, no translation needed
    Skipped(String),
}

/// Result of the matching phase for a batch.
#[derive(Debug, Clone)]
pub struct MatchedBatch {
    /// Entries found in the dictionary
    pub matched: Vec<dictionary::DictionaryEntry>,
    /// Entries needing LLM translation
    pub pending: Vec<SourceEntry>,
    /// Entries skipped (all placeholders)
    pub skipped: Vec<String>,
}

/// Run the matching phase: check each source entry against the dictionary.
/// Entries that are all placeholders are skipped immediately.
pub fn match_entries(
    db_path: &Path,
    entries: &[SourceEntry],
    target_lang: &str,
) -> Result<MatchedBatch, String> {
    let conn = dictionary::open(db_path).map_err(|e| e.to_string())?;
    let mut matched = Vec::new();
    let mut pending = Vec::new();
    let mut skipped = Vec::new();

    for entry in entries {
        // Skip pure-placeholder text
        if is_placeholder_only(&entry.text) {
            skipped.push(entry.key.clone());
            continue;
        }

        let query = dictionary::DictionaryQuery {
            search: None,
            source_type: None,
            mod_id: Some(entry.mod_id.clone()),
            source_lang: Some(entry.source_lang.clone()),
            target_lang: Some(target_lang.to_string()),
            limit: Some(50),
            offset: None,
        };

        let results = dictionary::search(&conn, &query).map_err(|e| e.to_string())?;

        // Match by source_hash first, then verify source_text equality
        let dict_match = results
            .iter()
            .find(|d| d.source_type != "resourcepack" && d.source_text == entry.text)
            .cloned();

        match dict_match {
            Some(entry) => matched.push(entry),
            None => pending.push(SourceEntry {
                key: entry.key.clone(),
                text: entry.text.clone(),
                mod_id: entry.mod_id.clone(),
                source_lang: entry.source_lang.clone(),
                target_lang: target_lang.to_string(),
            }),
        }
    }

    Ok(MatchedBatch {
        matched,
        pending,
        skipped,
    })
}

/// Check if text consists entirely of placeholders (no meaningful content).
/// Such text does not need translation.
pub fn is_placeholder_only(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    // Protect the text, then remove all shield tokens. If nothing meaningful remains, skip.
    let protected = shield::protect(trimmed);
    let mut stripped = protected.protected.clone();
    for token in &protected.tokens {
        stripped = stripped.replace(&token.token, "");
    }
    let remaining: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();
    remaining.is_empty()
}

/// Final translation entry ready for packaging.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalEntry {
    pub key: String,
    pub text: String,
    pub mod_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_placeholder_only_text() {
        assert!(is_placeholder_only("%s %s"));
        assert!(is_placeholder_only("%1$s %2$d"));
        assert!(is_placeholder_only(""));
        assert!(!is_placeholder_only("按住 %s 打开"));
    }

    #[test]
    fn empty_text_is_placeholder_only() {
        assert!(is_placeholder_only(""));
        assert!(is_placeholder_only("  "));
    }
}

use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::{params, Connection, Result as SqlResult, Row};
use serde::{Deserialize, Serialize};

/// Shared SQL schema: table + indexes used by both `open` and `open_in_memory`.
const SCHEMA_SQL: &str = "CREATE TABLE IF NOT EXISTS dictionary_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    source_lang TEXT NOT NULL DEFAULT 'en_us',
    target_lang TEXT NOT NULL DEFAULT 'zh_cn',
    source_type TEXT NOT NULL DEFAULT 'manual',
    mod_id TEXT,
    translation_key TEXT,
    context TEXT,
    source_hash TEXT NOT NULL,
    target_hash TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_source_hash ON dictionary_entries(source_hash);
CREATE INDEX IF NOT EXISTS idx_source_lang ON dictionary_entries(source_lang);
CREATE INDEX IF NOT EXISTS idx_target_lang ON dictionary_entries(target_lang);
CREATE INDEX IF NOT EXISTS idx_mod_id ON dictionary_entries(mod_id);
CREATE INDEX IF NOT EXISTS idx_source_type ON dictionary_entries(source_type);
CREATE TABLE IF NOT EXISTS dictionary_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);";

/// Map a SQLite row to a DictionaryEntry.
fn map_row(row: &Row) -> SqlResult<DictionaryEntry> {
    Ok(DictionaryEntry {
        id: Some(row.get(0)?),
        source_text: row.get(1)?,
        target_text: row.get(2)?,
        source_lang: row.get(3)?,
        target_lang: row.get(4)?,
        source_type: row.get(5)?,
        mod_id: row.get(6)?,
        translation_key: row.get(7)?,
        context: row.get(8)?,
        confidence: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn local_source_priority(source_type: &str) -> u8 {
    match source_type {
        "manual" => 4,
        "reviewed" => 3,
        "resourcepack" => 2,
        "llm" => 1,
        _ => 0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub id: Option<i64>,
    pub source_text: String,
    pub target_text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub source_type: String,
    pub mod_id: Option<String>,
    pub translation_key: Option<String>,
    pub context: Option<String>,
    pub confidence: f64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryStats {
    pub total: usize,
    pub mod_ids: Vec<String>,
}

/// i18n reference dictionary match used as per-entry LLM context.
#[derive(Debug, Clone)]
pub struct CfpaMatch {
    pub source_text: String,
    pub target_text: String,
    pub similarity: f64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryQuery {
    pub search: Option<String>,
    pub source_type: Option<String>,
    pub mod_id: Option<String>,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// Open or create the dictionary database, initializing schema and WAL mode.
pub fn open(db_path: &Path) -> SqlResult<Connection> {
    tracing::info!(path = %db_path.display(), "Opening dictionary database");
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;",
    )?;
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(conn)
}

/// Apply schema to an in-memory connection (for tests and temp operations).
pub fn open_in_memory(conn: &Connection) -> SqlResult<()> {
    tracing::debug!("初始化内存词典");
    conn.execute_batch(SCHEMA_SQL)
}

/// Shared column list for SELECT queries returning full DictionaryEntry rows.
const SELECT_COLS: &str =
    "SELECT id, source_text, target_text, source_lang, target_lang, source_type, \
    mod_id, translation_key, context, confidence, created_at, updated_at \
    FROM dictionary_entries";

/// Compute a stable deterministic hash for a text string (16 hex chars).
/// Uses FNV-1a algorithm which is deterministic across platforms and processes.
pub fn hash_text(text: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

/// Insert a single dictionary entry. Returns the new row ID.
pub fn insert(conn: &Connection, entry: &DictionaryEntry) -> SqlResult<i64> {
    tracing::debug!(
        source_lang = %entry.source_lang,
        target_lang = %entry.target_lang,
        source_type = %entry.source_type,
        "插入词典条目"
    );
    let source_hash = hash_text(&entry.source_text);
    let target_hash = hash_text(&entry.target_text);

    conn.execute(
        "INSERT INTO dictionary_entries
            (source_text, target_text, source_lang, target_lang, source_type,
             mod_id, translation_key, context, source_hash, target_hash, confidence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            entry.source_text,
            entry.target_text,
            entry.source_lang,
            entry.target_lang,
            entry.source_type,
            entry.mod_id,
            entry.translation_key,
            entry.context,
            source_hash,
            target_hash,
            entry.confidence,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Upsert: insert or update when the same (source_hash, target_lang) exists.
/// Returns the row ID and whether a new row was inserted (true) or existing updated (false).
pub fn upsert(conn: &Connection, entry: &DictionaryEntry) -> SqlResult<(i64, bool)> {
    tracing::debug!(source_text = %entry.source_text, source_type = %entry.source_type, "Upserting dictionary entry");
    let source_hash = hash_text(&entry.source_text);
    let target_hash = hash_text(&entry.target_text);

    // CFPA/i18n entries are reference data only; local cache/manual entries must not collide with them.
    let existing: Option<(i64,)> = conn
        .query_row(
            "SELECT id FROM dictionary_entries
             WHERE source_hash = ?1 AND target_lang = ?2 AND source_type <> 'cfpa'
             LIMIT 1",
            params![source_hash, entry.target_lang],
            |row| Ok((row.get(0)?,)),
        )
        .ok();

    if let Some((existing_id,)) = existing {
        // Update existing entry
        // Only update if source_type is 'manual' or if new entry has higher priority
        let current_info: (String, f64) = conn
            .query_row(
                "SELECT source_type, confidence FROM dictionary_entries WHERE id = ?1",
                params![existing_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or_default();

        // Priority: manual > reviewed > resourcepack > llm. CFPA is excluded above.
        let should_update = match (current_info.0.as_str(), entry.source_type.as_str()) {
            ("manual", _) => false,
            (_, "manual") => true,
            ("reviewed", _) => false,
            (_, "reviewed") => true,
            ("resourcepack", "llm") => false,
            ("llm", _) => true,
            (a, b) if a == b => entry.confidence > current_info.1,
            _ => false,
        };

        if should_update {
            conn.execute(
                "UPDATE dictionary_entries
                 SET target_text = ?1, target_hash = ?2, source_type = ?3,
                     mod_id = ?4, translation_key = ?5, context = ?6,
                     confidence = ?7, updated_at = datetime('now')
                 WHERE id = ?8",
                params![
                    entry.target_text,
                    target_hash,
                    entry.source_type,
                    entry.mod_id,
                    entry.translation_key,
                    entry.context,
                    entry.confidence,
                    existing_id,
                ],
            )?;
        }
        Ok((existing_id, false))
    } else {
        let id = insert(conn, entry)?;
        Ok((id, true))
    }
}

/// Search dictionary entries with optional filters.
pub fn search(conn: &Connection, query: &DictionaryQuery) -> SqlResult<Vec<DictionaryEntry>> {
    tracing::debug!(?query, "Searching dictionary entries");
    let mut sql = format!("{SELECT_COLS} WHERE 1=1");
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref search) = query.search {
        sql.push_str(" AND (source_text LIKE ? OR target_text LIKE ? OR translation_key LIKE ?)");
        let pattern = format!("%{}%", search);
        param_values.push(Box::new(pattern.clone()));
        param_values.push(Box::new(pattern.clone()));
        param_values.push(Box::new(pattern));
    }
    if let Some(ref source_type) = query.source_type {
        sql.push_str(" AND source_type = ?");
        param_values.push(Box::new(source_type.clone()));
    } else {
        sql.push_str(" AND source_type <> 'cfpa'");
    }
    if let Some(ref mod_id) = query.mod_id {
        sql.push_str(" AND mod_id = ?");
        param_values.push(Box::new(mod_id.clone()));
    }
    if let Some(ref source_lang) = query.source_lang {
        sql.push_str(" AND source_lang = ?");
        param_values.push(Box::new(source_lang.clone()));
    }
    if let Some(ref target_lang) = query.target_lang {
        sql.push_str(" AND target_lang = ?");
        param_values.push(Box::new(target_lang.clone()));
    }

    sql.push_str(" ORDER BY updated_at DESC");

    let limit = query.limit.unwrap_or(200).min(1000);
    let offset = query.offset.unwrap_or(0);
    sql.push_str(" LIMIT ? OFFSET ?");
    param_values.push(Box::new(limit as i64));
    param_values.push(Box::new(offset as i64));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), map_row)?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    tracing::info!(count = results.len(), "Dictionary search completed");
    Ok(results)
}

/// Search dictionary entries by source_hash (exact match against the indexed hash column).
/// Returns entries matching the hash and target_lang, limited to a small number
/// (the same source text from different mods usually yields the same hash).
pub fn search_by_hash(
    conn: &Connection,
    source_hash: &str,
    target_lang: &str,
) -> SqlResult<Vec<DictionaryEntry>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_COLS}
         WHERE source_hash = ?1 AND target_lang = ?2 AND source_type <> 'cfpa'
         ORDER BY
             CASE source_type
                 WHEN 'manual' THEN 4
                 WHEN 'reviewed' THEN 3
                 WHEN 'resourcepack' THEN 2
                 WHEN 'llm' THEN 1
                 ELSE 0
             END DESC,
             confidence DESC,
             updated_at DESC
         LIMIT 5"
    ))?;

    let rows = stmt.query_map(params![source_hash, target_lang], map_row)?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    if results.is_empty() {
        tracing::debug!(source_hash, target_lang, "词典未命中");
    } else {
        tracing::info!(
            hit_count = results.len(),
            source_type = %results[0].source_type,
            target_lang,
            "词典命中"
        );
    }
    Ok(results)
}

/// Batch count how many entries have dictionary hits.
/// Uses batched `IN (...)` queries for performance — groups entries into batches of 100.
/// Returns (hits, total) when checked against target_lang.
pub fn count_hits_batch(
    conn: &Connection,
    entries: &[String],
    target_lang: &str,
) -> SqlResult<(usize, usize)> {
    let total = entries.len();
    if total == 0 {
        return Ok((0, 0));
    }

    let mut hits = 0usize;
    let batch_size = 100;

    for chunk in entries.chunks(batch_size) {
        let hashes: Vec<String> = chunk.iter().map(|s| hash_text(s)).collect();
        // Build: WHERE target_lang = ?N AND source_hash IN (?1, ?2, ...)
        let placeholders: Vec<String> = (0..hashes.len())
            .map(|i| format!("?{}", i + 2)) // ?2 onward for hashes, ?1 for target_lang
            .collect();
        // Use COUNT(DISTINCT source_hash) since same hash may be duplicated across entries
        let sql = format!(
            "SELECT COUNT(DISTINCT source_hash) FROM dictionary_entries \
             WHERE target_lang = ?1 AND source_type <> 'cfpa' AND source_hash IN ({})",
            placeholders.join(",")
        );

        let mut stmt = conn.prepare(&sql)?;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> =
            Vec::with_capacity(hashes.len() + 1);
        param_values.push(Box::new(target_lang.to_string()));
        for h in &hashes {
            param_values.push(Box::new(h.clone()));
        }
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        let count: i64 = stmt.query_row(param_refs.as_slice(), |row| row.get(0))?;
        hits += count as usize;
    }

    tracing::debug!(hits, total, target_lang, "词典批量缓存命中检测");
    Ok((hits, total))
}

/// Load all source hashes that already have a translation for `target_lang`.
///
/// Scanner-side cache statistics only need exact hash presence, so this avoids
/// issuing many small `IN (...)` queries and avoids cloning every scanned text
/// into a temporary vector.
pub fn load_source_hashes_for_target(
    conn: &Connection,
    target_lang: &str,
) -> SqlResult<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT source_hash FROM dictionary_entries
         WHERE target_lang = ?1 AND source_type <> 'cfpa'",
    )?;
    let rows = stmt.query_map(params![target_lang], |row| row.get::<_, String>(0))?;

    let mut hashes = HashSet::new();
    for row in rows {
        hashes.insert(row?);
    }
    tracing::debug!(
        hash_count = hashes.len(),
        target_lang,
        "词典目标语言 hash 集合已加载"
    );
    Ok(hashes)
}

/// Get a single entry by ID.
pub fn get_by_id(conn: &Connection, id: i64) -> SqlResult<Option<DictionaryEntry>> {
    tracing::debug!(entry_id = id, "查询词典条目");
    let mut stmt = conn.prepare(&format!("{SELECT_COLS} WHERE id = ?1"))?;

    let mut rows = stmt.query_map(params![id], map_row)?;

    match rows.next() {
        Some(Ok(entry)) => Ok(Some(entry)),
        _ => Ok(None),
    }
}

/// Update the target_text of an entry. Sets source_type to 'manual'.
pub fn update_translation(conn: &Connection, id: i64, new_target: &str) -> SqlResult<bool> {
    tracing::info!(
        entry_id = id,
        new_target_len = new_target.len(),
        "更新词典译文"
    );
    let target_hash = hash_text(new_target);
    let affected = conn.execute(
        "UPDATE dictionary_entries
         SET target_text = ?1, target_hash = ?2, source_type = 'manual', confidence = 1.0, updated_at = datetime('now')
         WHERE id = ?3",
        params![new_target, target_hash, id],
    )?;
    Ok(affected > 0)
}

/// Delete an entry by ID.
pub fn delete(conn: &Connection, id: i64) -> SqlResult<bool> {
    tracing::info!(entry_id = id, "删除词典条目");
    let affected = conn.execute("DELETE FROM dictionary_entries WHERE id = ?1", params![id])?;
    Ok(affected > 0)
}

/// Delete all dictionary entries. Returns the number of removed rows.
pub fn clear_all(conn: &Connection) -> SqlResult<usize> {
    tracing::warn!("清空词典条目");
    let affected = conn.execute("DELETE FROM dictionary_entries", [])?;
    Ok(affected)
}

/// Delete local application dictionary entries while keeping external CFPA references.
pub fn clear_local_entries(conn: &Connection) -> SqlResult<usize> {
    tracing::warn!("清空本地词典条目，保留 CFPA 参考词典");
    let affected = conn.execute(
        "DELETE FROM dictionary_entries WHERE source_type <> 'cfpa'",
        [],
    )?;
    Ok(affected)
}

/// Get total count of entries.
pub fn count(conn: &Connection) -> SqlResult<usize> {
    let count = conn.query_row("SELECT COUNT(*) FROM dictionary_entries", [], |row| {
        row.get::<_, i64>(0).map(|v| v as usize)
    })?;
    tracing::debug!(count, "词典条目计数");
    Ok(count)
}

pub fn count_local_entries(conn: &Connection) -> SqlResult<usize> {
    conn.query_row(
        "SELECT COUNT(*) FROM dictionary_entries WHERE source_type <> 'cfpa'",
        [],
        |row| row.get::<_, i64>(0).map(|v| v as usize),
    )
}

pub fn count_by_source_type(conn: &Connection, source_type: &str) -> SqlResult<usize> {
    conn.query_row(
        "SELECT COUNT(*) FROM dictionary_entries WHERE source_type = ?1",
        params![source_type],
        |row| row.get::<_, i64>(0).map(|v| v as usize),
    )
}

pub fn get_metadata(conn: &Connection, key: &str) -> SqlResult<Option<String>> {
    let value = conn
        .query_row(
            "SELECT value FROM dictionary_metadata WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(value)
}

pub fn set_metadata(conn: &Connection, key: &str, value: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO dictionary_metadata (key, value, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        params![key, value],
    )?;
    Ok(())
}

pub fn export_jsonl(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_COLS} WHERE source_type <> 'cfpa' ORDER BY id"
    ))?;

    let rows = stmt.query_map([], map_row)?;

    let mut lines = Vec::new();
    for row in rows {
        let entry = row?;
        if let Ok(json) = serde_json::to_string(&entry) {
            lines.push(json);
        }
    }
    tracing::info!(count = lines.len(), "Exported dictionary entries as JSONL");
    Ok(lines)
}

/// Import entries from JSON lines. Returns import summary.
pub fn import_jsonl(conn: &Connection, lines: &[&str]) -> SqlResult<ImportResult> {
    tracing::info!(
        count = lines.len(),
        "Importing dictionary entries from JSONL"
    );
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut conflicts = Vec::new();

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<DictionaryEntry>(line) {
            Ok(entry) => {
                let (_, is_new) = upsert(conn, &entry)?;
                if is_new {
                    imported += 1;
                } else {
                    skipped += 1;
                }
            }
            Err(err) => {
                conflicts.push(format!("解析失败: {err} — {line}"));
            }
        }
    }

    Ok(ImportResult {
        imported,
        skipped,
        conflicts,
    })
}

/// Get distinct mod_ids in the dictionary.
pub fn distinct_mod_ids(conn: &Connection) -> SqlResult<Vec<String>> {
    tracing::debug!("获取词典中的模组列表");
    let mut stmt = conn.prepare(
        "SELECT DISTINCT mod_id FROM dictionary_entries
         WHERE mod_id IS NOT NULL AND source_type <> 'cfpa'
         ORDER BY mod_id",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row?);
    }
    Ok(ids)
}

// ── MemoryDictionary: in-memory dictionary for fast pipeline lookups ─────

/// An in-memory dictionary that loads all entries from SQLite at pipeline start,
/// then provides O(1) hash-based lookups and in-memory fuzzy search.
///
/// Writes are synchronised back to both memory and SQLite so the pipeline
/// never has to re-read from disk during translation.
pub struct MemoryDictionary {
    /// source_hash → entries (O(1) exact match)
    entries: HashMap<String, Vec<DictionaryEntry>>,
    /// All `cfpa`-type entries pre-sorted for fuzzy search:
    /// (source_text, target_text, source_lang, target_lang)
    cfpa_entries: Vec<(String, String, String, String)>,
    /// (source_lang, target_lang, lowercase source_text) → cfpa_entries indices
    cfpa_exact_index: HashMap<String, Vec<usize>>,
    /// Inverted word index: lowercase keyword → indices into cfpa_entries
    word_index: HashMap<String, Vec<usize>>,
}

impl MemoryDictionary {
    /// Load ALL entries from the SQLite dictionary into memory.
    /// Expected size: ~50k entries (~5–10 MB).
    pub fn load(conn: &Connection) -> SqlResult<Self> {
        let mut stmt = conn.prepare(&format!("{SELECT_COLS}"))?;
        let rows = stmt.query_map([], map_row)?;

        let mut entries: HashMap<String, Vec<DictionaryEntry>> = HashMap::new();
        let mut cfpa_entries: Vec<(String, String, String, String)> = Vec::new();
        let mut cfpa_exact_index: HashMap<String, Vec<usize>> = HashMap::new();
        let mut word_index: HashMap<String, Vec<usize>> = HashMap::new();

        for row in rows {
            let entry = row?;
            let hash = hash_text(&entry.source_text);
            entries.entry(hash).or_default().push(entry.clone());

            let source_text = entry.source_text.trim().to_string();
            let target_text = entry.target_text.trim().to_string();
            if entry.source_type == "cfpa" && is_useful_reference_pair(&source_text, &target_text) {
                let idx = cfpa_entries.len();
                cfpa_entries.push((
                    source_text.clone(),
                    target_text,
                    entry.source_lang.clone(),
                    entry.target_lang.clone(),
                ));
                cfpa_exact_index
                    .entry(cfpa_exact_key(
                        &entry.source_lang,
                        &entry.target_lang,
                        &source_text,
                    ))
                    .or_default()
                    .push(idx);
                for word in meaningful_tokens(&source_text) {
                    word_index.entry(word).or_default().push(idx);
                }
            }
        }

        tracing::info!(
            total = entries.len(),
            cfpa = cfpa_entries.len(),
            "MemoryDictionary loaded"
        );
        Ok(Self {
            entries,
            cfpa_entries,
            cfpa_exact_index,
            word_index,
        })
    }

    /// O(1) lookup by source hash and target language for local reusable translations.
    /// Returns up to 5 matching entries (cloned owned data — negligible overhead vs. old SQLite query).
    pub fn search_by_hash(&self, source_hash: &str, target_lang: &str) -> Vec<DictionaryEntry> {
        self.entries
            .get(source_hash)
            .map(|vec| {
                let mut hits: Vec<DictionaryEntry> = vec
                    .iter()
                    .filter(|e| e.target_lang == target_lang && e.source_type != "cfpa")
                    .cloned()
                    .collect();
                hits.sort_by(|a, b| {
                    local_source_priority(&b.source_type)
                        .cmp(&local_source_priority(&a.source_type))
                        .then_with(|| {
                            b.confidence
                                .partial_cmp(&a.confidence)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        })
                        .then_with(|| b.updated_at.cmp(&a.updated_at))
                });
                hits.truncate(5);
                hits
            })
            .unwrap_or_default()
    }

    /// Search i18n reference terms for one source entry.
    pub fn reference_search(
        &self,
        text: &str,
        key: &str,
        source_lang: &str,
        target_lang: &str,
        limit: usize,
    ) -> Vec<CfpaMatch> {
        let limit = limit.min(10);
        if limit == 0 {
            return Vec::new();
        }
        let query_lower = text.to_lowercase();
        let query_words = meaningful_tokens(text);
        let query_tokens = tokenize(text);
        if query_lower.trim().is_empty() || query_words.is_empty() {
            return Vec::new();
        }
        if is_long_reference_query(text, key) {
            return self.contained_reference_search(
                &query_lower,
                &query_words,
                source_lang,
                target_lang,
                limit,
            );
        }

        let mut scored: Vec<(f64, usize)> = Vec::new();
        let mut seen = std::collections::HashSet::new();

        if let Some(indices) =
            self.cfpa_exact_index
                .get(&cfpa_exact_key(source_lang, target_lang, text))
        {
            let mut seen_sources = HashSet::new();
            for &idx in indices {
                let (src, _, _, _) = &self.cfpa_entries[idx];
                if seen.insert(idx) && seen_sources.insert(normalize_reference_source(src)) {
                    scored.push((1.0, idx));
                }
            }
        }
        if is_mod_name_reference_key(key) {
            return scored
                .into_iter()
                .take(limit)
                .map(|(sim, idx)| {
                    let (src, tgt, _, _) = &self.cfpa_entries[idx];
                    CfpaMatch {
                        source_text: src.clone(),
                        target_text: tgt.clone(),
                        similarity: sim,
                    }
                })
                .collect();
        }
        if query_words.len() == 1 && is_unstable_reference_token(&query_words[0]) {
            return scored
                .into_iter()
                .take(limit)
                .map(|(sim, idx)| {
                    let (src, tgt, _, _) = &self.cfpa_entries[idx];
                    CfpaMatch {
                        source_text: src.clone(),
                        target_text: tgt.clone(),
                        similarity: sim,
                    }
                })
                .collect();
        }

        let mut word_hits: HashMap<usize, usize> = HashMap::new();
        for word in &query_words {
            if let Some(indices) = self.word_index.get(word) {
                for &idx in indices {
                    if seen.contains(&idx) {
                        continue;
                    }
                    let (_, _, sl, tl) = &self.cfpa_entries[idx];
                    if sl == source_lang && tl == target_lang {
                        *word_hits.entry(idx).or_default() += 1;
                    }
                }
            }
        }

        for (idx, matched_words) in word_hits {
            let (src, _, _, _) = &self.cfpa_entries[idx];
            let src_lower = src.to_lowercase();
            let src_words = meaningful_tokens(src);
            if src_words.is_empty() {
                continue;
            }
            if src_words.len() == 1
                && query_words.len() > 2
                && !is_single_token_reference(&src_words[0])
            {
                continue;
            }

            let query_len = query_words.len();
            let min_matches = if query_len <= 2 {
                query_len
            } else {
                ((query_len as f64) * 0.6).ceil() as usize
            };
            let src_tokens = tokenize(src);
            let phrase_related = contains_token_sequence(&src_tokens, &query_tokens)
                || contains_token_sequence(&query_tokens, &src_tokens);
            if matched_words < min_matches && !phrase_related {
                continue;
            }
            if !phrase_related && src_words.len() > query_words.len() + 4 {
                continue;
            }

            let coverage = matched_words as f64 / query_words.len() as f64;
            let precision = matched_words as f64 / src_words.len() as f64;
            let mut score = 0.55 * coverage + 0.45 * precision;
            if src_lower.starts_with(&query_lower) {
                score = score.max(0.88);
            } else if phrase_related {
                score = score.max(0.78);
            }
            if score < 0.58 {
                continue;
            }
            scored.push((score.min(0.99), idx));
        }

        scored.sort_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    let a_len = meaningful_tokens(&self.cfpa_entries[a.1].0).len();
                    let b_len = meaningful_tokens(&self.cfpa_entries[b.1].0).len();
                    a_len.cmp(&b_len)
                })
                .then_with(|| {
                    self.cfpa_entries[a.1]
                        .0
                        .len()
                        .cmp(&self.cfpa_entries[b.1].0.len())
                })
        });

        let mut results: Vec<CfpaMatch> = Vec::new();
        let mut result_sources = HashSet::new();
        for (sim, idx) in scored {
            if results.len() >= limit {
                break;
            }
            if seen.insert(idx) || (sim - 1.0).abs() < f64::EPSILON {
                let (src, tgt, _, _) = &self.cfpa_entries[idx];
                if !result_sources.insert(normalize_reference_source(src)) {
                    continue;
                }
                results.push(CfpaMatch {
                    source_text: src.clone(),
                    target_text: tgt.clone(),
                    similarity: sim,
                });
            }
        }

        results
    }

    fn contained_reference_search(
        &self,
        query_lower: &str,
        query_words: &[String],
        source_lang: &str,
        target_lang: &str,
        limit: usize,
    ) -> Vec<CfpaMatch> {
        let mut scored: Vec<(f64, usize)> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let query_tokens = tokenize(query_lower);
        for word in query_words {
            if let Some(indices) = self.word_index.get(word) {
                for &idx in indices {
                    if !seen.insert(idx) {
                        continue;
                    }
                    let (src, _, sl, tl) = &self.cfpa_entries[idx];
                    if sl != source_lang || tl != target_lang {
                        continue;
                    }
                    let src_words = meaningful_tokens(src);
                    if src_words.is_empty() {
                        continue;
                    }
                    if src_words.len() == 1 && !is_single_token_reference(&src_words[0]) {
                        continue;
                    }
                    let source_tokens = tokenize(src);
                    if contains_token_sequence(&query_tokens, &source_tokens) {
                        scored.push((0.82 + (src_words.len().min(3) as f64 * 0.03), idx));
                    }
                }
            }
        }

        let mut seen_sources = HashSet::new();
        scored.sort_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    let b_len = meaningful_tokens(&self.cfpa_entries[b.1].0).len();
                    let a_len = meaningful_tokens(&self.cfpa_entries[a.1].0).len();
                    b_len.cmp(&a_len)
                })
        });
        scored
            .into_iter()
            .filter_map(|(sim, idx)| {
                let (src, tgt, _, _) = &self.cfpa_entries[idx];
                if !seen_sources.insert(normalize_reference_source(src)) {
                    return None;
                }
                Some(CfpaMatch {
                    source_text: src.clone(),
                    target_text: tgt.clone(),
                    similarity: sim.min(0.95),
                })
            })
            .take(limit)
            .collect()
    }

    /// Insert or update a single result in both memory and SQLite.
    pub fn upsert_result(
        &mut self,
        conn: &Connection,
        result: &crate::core::jobs::TranslationResult,
        source_lang: &str,
        target_lang: &str,
    ) -> SqlResult<(i64, bool)> {
        let entry = DictionaryEntry {
            id: None,
            source_text: result.source_text.clone(),
            target_text: result.target_text.clone(),
            source_lang: source_lang.to_string(),
            target_lang: target_lang.to_string(),
            source_type: result.source_type.clone(),
            mod_id: Some(result.mod_id.clone()),
            translation_key: Some(result.key.clone()),
            context: None,
            confidence: 1.0,
            created_at: None,
            updated_at: None,
        };
        let (id, is_new) = upsert(conn, &entry)?;

        // Update in-memory state
        let hash = hash_text(&result.source_text);
        let bucket = self.entries.entry(hash).or_default();
        if let Some(existing) = bucket.iter_mut().find(|e| e.target_lang == target_lang) {
            existing.target_text = result.target_text.clone();
            existing.source_type = result.source_type.clone();
        } else {
            bucket.push(DictionaryEntry {
                id: Some(id),
                source_text: result.source_text.clone(),
                target_text: result.target_text.clone(),
                source_lang: source_lang.to_string(),
                target_lang: target_lang.to_string(),
                source_type: result.source_type.clone(),
                mod_id: Some(result.mod_id.clone()),
                translation_key: Some(result.key.clone()),
                context: None,
                confidence: 1.0,
                created_at: None,
                updated_at: None,
            });
        }

        Ok((id, is_new))
    }

    /// Batch-save LLM/reviewed results to both memory and SQLite.
    /// Uses a single SQLite transaction for performance.
    pub fn save_llm_results(
        &mut self,
        conn: &Connection,
        results: &[crate::core::jobs::TranslationResult],
        source_lang: &str,
        target_lang: &str,
    ) -> SqlResult<(usize, usize)> {
        let mut inserted = 0usize;
        let mut updated = 0usize;

        // Use an explicit transaction for batch upsert
        conn.execute_batch("BEGIN IMMEDIATE")?;
        for r in results {
            if r.source_type != "llm" && r.source_type != "reviewed" {
                continue;
            }
            if r.target_text.trim().is_empty() {
                continue;
            }
            let (_, is_new) = self.upsert_result(conn, r, source_lang, target_lang)?;
            if is_new {
                inserted += 1;
            } else {
                updated += 1;
            }
        }
        conn.execute_batch("COMMIT")?;

        tracing::info!(inserted, updated, "MemoryDictionary batch save");
        Ok((inserted, updated))
    }
}

/// Tokenize text into lowercase keywords (split on space, underscore, slash).
fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| c == ' ' || c == '_' || c == '/' || c == '-' || c == '.')
        .filter(|w| w.len() > 1)
        .map(String::from)
        .collect()
}

fn meaningful_tokens(text: &str) -> Vec<String> {
    let tokens: Vec<String> = tokenize(text)
        .into_iter()
        .filter(|w| {
            !matches!(
                w.as_str(),
                "the"
                    | "and"
                    | "for"
                    | "with"
                    | "from"
                    | "item"
                    | "block"
                    | "entity"
                    | "tooltip"
                    | "mod"
                    | "more"
                    | "light"
                    | "of"
                    | "to"
                    | "at"
                    | "in"
                    | "on"
                    | "by"
                    | "as"
                    | "is"
                    | "are"
                    | "be"
                    | "a"
                    | "an"
                    | "one"
            )
        })
        .collect();
    if tokens.is_empty() {
        Vec::new()
    } else {
        tokens
    }
}

fn cfpa_exact_key(source_lang: &str, target_lang: &str, source_text: &str) -> String {
    format!(
        "{source_lang}\0{target_lang}\0{}",
        normalize_reference_source(source_text)
    )
}

fn normalize_reference_source(source_text: &str) -> String {
    source_text.trim().to_lowercase()
}

fn contains_token_sequence(haystack: &[String], needle: &[String]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return false;
    }
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn is_useful_reference_pair(source_text: &str, target_text: &str) -> bool {
    let source = source_text.trim();
    let target = target_text.trim();
    if source.is_empty() || target.is_empty() {
        return false;
    }
    if source.eq_ignore_ascii_case(target) || target.is_ascii() {
        return false;
    }
    if source
        .chars()
        .chain(target.chars())
        .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return false;
    }
    source.chars().filter(|c| c.is_alphanumeric()).count() >= 3
        && !meaningful_tokens(source).is_empty()
        && !is_unstable_single_word_reference(source)
}

fn is_unstable_single_word_reference(source_text: &str) -> bool {
    let tokens = meaningful_tokens(source_text);
    if tokens.len() != 1 {
        return false;
    }
    is_unstable_reference_token(&tokens[0])
}

fn is_unstable_reference_token(token: &str) -> bool {
    matches!(
        token,
        "slicing"
            | "heating"
            | "baking"
            | "toasting"
            | "combining"
            | "solidifying"
            | "processing"
            | "crafting"
            | "pressing"
            | "mixing"
            | "filling"
            | "cutting"
    )
}

fn is_long_reference_query(text: &str, key: &str) -> bool {
    text.chars().count() > 96
        || meaningful_tokens(text).len() > 8
        || key.contains(".desc")
        || key.contains(".description")
        || key.contains(".info")
        || key.contains("tooltip.")
}

fn is_mod_name_reference_key(key: &str) -> bool {
    key.starts_with("itemGroup.") || key.contains("creative_tab")
}

fn is_single_token_reference(token: &str) -> bool {
    matches!(
        token,
        "gun"
            | "guns"
            | "pistol"
            | "rifle"
            | "musket"
            | "shotgun"
            | "shell"
            | "round"
            | "bullet"
            | "ammo"
            | "ammunition"
            | "copper"
            | "iron"
            | "steel"
            | "brass"
            | "diamond"
            | "standard"
            | "heavy"
            | "flintlock"
            | "blunderbuss"
            | "handcannon"
            | "revolver"
            | "cannon"
            | "grenade"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        open_in_memory(&conn).unwrap();
        conn
    }

    #[test]
    fn inserts_and_retrieves_entry() {
        let conn = test_conn();
        let entry = DictionaryEntry {
            id: None,
            source_text: "Hello".to_string(),
            target_text: "你好".to_string(),
            source_lang: "en_us".to_string(),
            target_lang: "zh_cn".to_string(),
            source_type: "manual".to_string(),
            mod_id: Some("examplemod".to_string()),
            translation_key: Some("examplemod.hello".to_string()),
            context: None,
            confidence: 1.0,
            created_at: None,
            updated_at: None,
        };
        let id = insert(&conn, &entry).unwrap();
        assert!(id > 0);

        let retrieved = get_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(retrieved.source_text, "Hello");
        assert_eq!(retrieved.target_text, "你好");
        assert_eq!(retrieved.source_type, "manual");
    }

    #[test]
    fn searches_by_keyword() {
        let conn = test_conn();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "apple".into(),
                target_text: "苹果".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "manual".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let results = search(
            &conn,
            &DictionaryQuery {
                search: Some("apple".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].target_text, "苹果");
    }

    #[test]
    fn upsert_protects_manual_entries() {
        let conn = test_conn();
        let entry = DictionaryEntry {
            source_text: "hello".into(),
            target_text: "你好".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "manual".into(),
            ..Default::default()
        };
        let (id1, is_new) = upsert(&conn, &entry).unwrap();
        assert!(is_new);

        // Second upsert with manual should NOT overwrite (existing manual is protected)
        let updated_entry = DictionaryEntry {
            source_text: "hello".into(),
            target_text: "哈喽".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "manual".into(),
            ..Default::default()
        };
        let (id2, is_new) = upsert(&conn, &updated_entry).unwrap();
        assert!(!is_new);
        assert_eq!(id1, id2);

        // Original text preserved because manual is protected
        let retrieved = get_by_id(&conn, id1).unwrap().unwrap();
        assert_eq!(retrieved.target_text, "你好");
    }

    #[test]
    fn upsert_overwrites_lower_priority() {
        let conn = test_conn();
        let rp_entry = DictionaryEntry {
            source_text: "hello".into(),
            target_text: "你好".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "resourcepack".into(),
            ..Default::default()
        };
        let (id1, is_new) = upsert(&conn, &rp_entry).unwrap();
        assert!(is_new);

        // CFPA is reference-only and must not overwrite local reusable entries.
        let cfpa_entry = DictionaryEntry {
            source_text: "hello".into(),
            target_text: "哈喽".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "cfpa".into(),
            ..Default::default()
        };
        upsert(&conn, &cfpa_entry).unwrap();
        let retrieved = get_by_id(&conn, id1).unwrap().unwrap();
        assert_eq!(retrieved.target_text, "你好");
        assert_eq!(retrieved.source_type, "resourcepack");

        let reviewed_entry = DictionaryEntry {
            source_text: "hello".into(),
            target_text: "您好".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "reviewed".into(),
            ..Default::default()
        };
        upsert(&conn, &reviewed_entry).unwrap();
        let retrieved = get_by_id(&conn, id1).unwrap().unwrap();
        assert_eq!(retrieved.target_text, "您好");
        assert_eq!(retrieved.source_type, "reviewed");
    }

    #[test]
    fn respects_source_type_priority() {
        let conn = test_conn();

        // Insert a resourcepack entry first
        let rp_entry = DictionaryEntry {
            source_text: "hello".into(),
            target_text: "你好".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "resourcepack".into(),
            ..Default::default()
        };
        upsert(&conn, &rp_entry).unwrap();

        // Upsert with manual should override
        let manual_entry = DictionaryEntry {
            source_text: "hello".into(),
            target_text: "您好".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "manual".into(),
            ..Default::default()
        };
        upsert(&conn, &manual_entry).unwrap();

        // Insert llm should NOT override manual
        let llm_entry = DictionaryEntry {
            source_text: "hello".into(),
            target_text: "嘿".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "llm".into(),
            ..Default::default()
        };
        upsert(&conn, &llm_entry).unwrap();

        let results = search(
            &conn,
            &DictionaryQuery {
                search: Some("hello".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(results[0].target_text, "您好");
        assert_eq!(results[0].source_type, "manual");
    }

    #[test]
    fn memory_fuzzy_prefers_precise_matches() {
        let conn = test_conn();
        for (source, target) in [
            ("Iron Sword", "铁剑"),
            ("Iron Gear", "铁齿轮"),
            ("Copper Sword", "铜剑"),
            ("Iron Sword Blade", "铁剑刃"),
        ] {
            insert(
                &conn,
                &DictionaryEntry {
                    source_text: source.into(),
                    target_text: target.into(),
                    source_lang: "en_us".into(),
                    target_lang: "zh_cn".into(),
                    source_type: "cfpa".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        }

        let dict = MemoryDictionary::load(&conn).unwrap();
        let results = dict.reference_search("Iron Sword", "", "en_us", "zh_cn", 5);
        assert_eq!(results[0].source_text, "Iron Sword");
        assert!(!results.iter().any(|m| m.source_text == "Iron Gear"));
        assert!(!results.iter().any(|m| m.source_text == "Copper Sword"));
    }

    #[test]
    fn memory_fuzzy_limits_prompt_references() {
        let conn = test_conn();
        for index in 0..10 {
            insert(
                &conn,
                &DictionaryEntry {
                    source_text: format!("Scorched Rifle Variant {index}"),
                    target_text: format!("焦土步枪变体 {index}"),
                    source_lang: "en_us".into(),
                    target_lang: "zh_cn".into(),
                    source_type: "cfpa".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        }

        let dict = MemoryDictionary::load(&conn).unwrap();
        let results = dict.reference_search("Scorched Rifle", "", "en_us", "zh_cn", 3);
        assert!(results.len() <= 3);
        assert!(results.iter().all(|m| m.similarity >= 0.58));
    }

    #[test]
    fn memory_fuzzy_ignores_long_descriptions() {
        let conn = test_conn();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "Time".into(),
                target_text: "时间".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "cfpa".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let dict = MemoryDictionary::load(&conn).unwrap();
        let results = dict.reference_search(
            "A long description about the first successful firearm design using an old name at the time.",
            "",
            "en_us",
            "zh_cn",
            3,
        );
        assert!(results.is_empty());
    }

    #[test]
    fn reference_search_item_group_uses_exact_match_only() {
        let conn = test_conn();
        for (source, target) in [
            ("MrCrayfish's Furniture Mod", "MrCrayfish的家具模组"),
            ("MrCrayfish's Furniture Mod ", "MrCrayfish 的家具"),
            (
                "MrCrayfish's More Furniture Mod",
                "MrCrayfish的更多家具模组",
            ),
            ("MrCrayfish's Gun Mod", "MrCrayfish的枪械模组"),
        ] {
            insert(
                &conn,
                &DictionaryEntry {
                    source_text: source.into(),
                    target_text: target.into(),
                    source_lang: "en_us".into(),
                    target_lang: "zh_cn".into(),
                    source_type: "cfpa".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        }

        let dict = MemoryDictionary::load(&conn).unwrap();
        let results = dict.reference_search(
            "MrCrayfish's Furniture Mod",
            "itemGroup.refurbished_furniture",
            "en_us",
            "zh_cn",
            3,
        );
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].target_text, "MrCrayfish的家具模组");
    }

    #[test]
    fn reference_search_avoids_substring_phrase_matches() {
        let conn = test_conn();
        for (source, target) in [
            ("End Button", "末地木按钮"),
            ("Button", "按钮"),
            ("Mailbox", "信箱"),
        ] {
            insert(
                &conn,
                &DictionaryEntry {
                    source_text: source.into(),
                    target_text: target.into(),
                    source_lang: "en_us".into(),
                    target_lang: "zh_cn".into(),
                    source_type: "cfpa".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        }

        let dict = MemoryDictionary::load(&conn).unwrap();
        let results = dict.reference_search(
            "Select a mailbox and then press the send button.",
            "gui.post_box_info",
            "en_us",
            "zh_cn",
            5,
        );
        assert!(!results.iter().any(|m| m.source_text == "End Button"));
    }

    #[test]
    fn reference_search_filters_unstable_single_word_process_terms() {
        let conn = test_conn();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "Slicing".into(),
                target_text: "头颅装配".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "cfpa".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let dict = MemoryDictionary::load(&conn).unwrap();
        let results = dict.reference_search(
            "Slicing",
            "jei_category.refurbished_furniture.slicing",
            "en_us",
            "zh_cn",
            5,
        );
        assert!(results.is_empty());
    }

    #[test]
    fn cfpa_entries_are_reference_only_for_hash_reuse() {
        let conn = test_conn();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "Oak Table".into(),
                target_text: "橡木桌".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "cfpa".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let dict = MemoryDictionary::load(&conn).unwrap();
        let local_hits = dict.search_by_hash(&hash_text("Oak Table"), "zh_cn");
        assert!(local_hits.is_empty());
        let references =
            dict.reference_search("Oak Table", "block.test.oak_table", "en_us", "zh_cn", 3);
        assert_eq!(references[0].target_text, "橡木桌");
    }

    #[test]
    fn local_upsert_does_not_update_cfpa_rows() {
        let conn = test_conn();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "Oak Table".into(),
                target_text: "橡木桌".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "cfpa".into(),
                ..Default::default()
            },
        )
        .unwrap();
        upsert(
            &conn,
            &DictionaryEntry {
                source_text: "Oak Table".into(),
                target_text: "橡木餐桌".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "llm".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let cfpa_count = count_by_source_type(&conn, "cfpa").unwrap();
        let llm_count = count_by_source_type(&conn, "llm").unwrap();
        assert_eq!(cfpa_count, 1);
        assert_eq!(llm_count, 1);
        let dict = MemoryDictionary::load(&conn).unwrap();
        let local_hits = dict.search_by_hash(&hash_text("Oak Table"), "zh_cn");
        assert_eq!(local_hits[0].target_text, "橡木餐桌");
    }

    #[test]
    fn local_hash_queries_ignore_cfpa_references() {
        let conn = test_conn();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "Oak Chair".into(),
                target_text: "橡木椅".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "cfpa".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let source_hash = hash_text("Oak Chair");
        assert!(search_by_hash(&conn, &source_hash, "zh_cn")
            .unwrap()
            .is_empty());
        assert!(!load_source_hashes_for_target(&conn, "zh_cn")
            .unwrap()
            .contains(&source_hash));
        assert_eq!(
            count_hits_batch(&conn, &["Oak Chair".to_string()], "zh_cn").unwrap(),
            (0, 1)
        );
    }

    #[test]
    fn memory_hash_lookup_prefers_reviewed_over_llm() {
        let conn = test_conn();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "Copper Rifle".into(),
                target_text: "铜步枪".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "llm".into(),
                ..Default::default()
            },
        )
        .unwrap();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "Copper Rifle".into(),
                target_text: "铜制步枪".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "reviewed".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let dict = MemoryDictionary::load(&conn).unwrap();
        let local_hits = dict.search_by_hash(&hash_text("Copper Rifle"), "zh_cn");
        assert_eq!(local_hits[0].target_text, "铜制步枪");
        assert_eq!(local_hits[0].source_type, "reviewed");
    }

    #[test]
    fn save_llm_results_preserves_source_language() {
        let conn = test_conn();
        let mut dict = MemoryDictionary::load(&conn).unwrap();
        dict.save_llm_results(
            &conn,
            &[crate::core::jobs::TranslationResult {
                key: "item.test.rifle".into(),
                source_text: "Test Rifle".into(),
                target_text: "测试步枪".into(),
                mod_id: "test".into(),
                mod_name: "test.jar".into(),
                source_type: "llm".into(),
            }],
            "en_us",
            "zh_cn",
        )
        .unwrap();

        let hits = dict.search_by_hash(&hash_text("Test Rifle"), "zh_cn");
        assert_eq!(hits[0].source_lang, "en_us");
        assert_eq!(hits[0].target_text, "测试步枪");
    }

    #[test]
    fn updates_translation_sets_manual() {
        let conn = test_conn();
        let entry = DictionaryEntry {
            source_text: "test".into(),
            target_text: "测试".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "llm".into(),
            ..Default::default()
        };
        let id = insert(&conn, &entry).unwrap();

        update_translation(&conn, id, "试验").unwrap();
        let retrieved = get_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(retrieved.target_text, "试验");
        assert_eq!(retrieved.source_type, "manual");
    }

    #[test]
    fn exports_and_imports_jsonl() {
        let conn = test_conn();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "apple".into(),
                target_text: "苹果".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "manual".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let lines = export_jsonl(&conn).unwrap();
        assert_eq!(lines.len(), 1);

        let import_conn = test_conn();
        let result = import_jsonl(
            &import_conn,
            &lines.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        )
        .unwrap();
        assert_eq!(result.imported, 1);

        let count = count(&import_conn).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn counts_entries() {
        let conn = test_conn();
        assert_eq!(count(&conn).unwrap(), 0);

        insert(
            &conn,
            &DictionaryEntry {
                source_text: "a".into(),
                target_text: "甲".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "manual".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(count(&conn).unwrap(), 1);
    }

    #[test]
    fn clear_all_removes_entries() {
        let conn = test_conn();

        insert(
            &conn,
            &DictionaryEntry {
                source_text: "a".into(),
                target_text: "甲".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "manual".into(),
                ..Default::default()
            },
        )
        .unwrap();
        insert(
            &conn,
            &DictionaryEntry {
                source_text: "b".into(),
                target_text: "乙".into(),
                source_lang: "en_us".into(),
                target_lang: "zh_cn".into(),
                source_type: "llm".into(),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(clear_all(&conn).unwrap(), 2);
        assert_eq!(count(&conn).unwrap(), 0);
    }
}

impl Default for DictionaryEntry {
    fn default() -> Self {
        Self {
            id: None,
            source_text: String::new(),
            target_text: String::new(),
            source_lang: "en_us".to_string(),
            target_lang: "zh_cn".to_string(),
            source_type: "manual".to_string(),
            mod_id: None,
            translation_key: None,
            context: None,
            confidence: 1.0,
            created_at: None,
            updated_at: None,
        }
    }
}

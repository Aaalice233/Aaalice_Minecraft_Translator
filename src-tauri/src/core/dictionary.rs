use std::path::Path;

use rusqlite::{params, Connection, Result as SqlResult, Row};
use serde::{Deserialize, Serialize};

use crate::core::models::LanguageEntry;

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
CREATE INDEX IF NOT EXISTS idx_source_type ON dictionary_entries(source_type);";

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
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;")?;
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(conn)
}

/// Apply schema to an in-memory connection (for tests and temp operations).
pub fn open_in_memory(conn: &Connection) -> SqlResult<()> {
    tracing::debug!("初始化内存词典");
    conn.execute_batch(SCHEMA_SQL)
}

/// Shared column list for SELECT queries returning full DictionaryEntry rows.
const SELECT_COLS: &str = "SELECT id, source_text, target_text, source_lang, target_lang, source_type, \
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

    // Check if an entry with the same source_hash + target_lang exists
    let existing: Option<(i64,)> = conn
        .query_row(
            "SELECT id FROM dictionary_entries
             WHERE source_hash = ?1 AND target_lang = ?2
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

        // Priority: manual > cfpa > resourcepack > llm
        let should_update = match (current_info.0.as_str(), entry.source_type.as_str()) {
            // Current is manual: never overwrite with lower priority
            ("manual", _) => false,
            // Current is cfpa: overwrite only with manual
            (_, "manual") => true,
            // Current is resourcepack: overwrite with cfpa
            ("resourcepack", "cfpa") => true,
            // Current is llm: overwrite with anything
            ("llm", _) => true,
            // Same type: update only if new confidence is strictly higher than existing
            (a, b) if a == b => entry.confidence > current_info.1,
            // Default: don't overwrite
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
        sql.push_str(
            " AND (source_text LIKE ? OR target_text LIKE ? OR translation_key LIKE ?)",
        );
        let pattern = format!("%{}%", search);
        param_values.push(Box::new(pattern.clone()));
        param_values.push(Box::new(pattern.clone()));
        param_values.push(Box::new(pattern));
    }
    if let Some(ref source_type) = query.source_type {
        sql.push_str(" AND source_type = ?");
        param_values.push(Box::new(source_type.clone()));
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

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
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
    let mut stmt = conn.prepare(
        &format!("{SELECT_COLS}
         WHERE source_hash = ?1 AND target_lang = ?2
         ORDER BY updated_at DESC
         LIMIT 5"),
    )?;

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

/// Get a single entry by ID.
pub fn get_by_id(conn: &Connection, id: i64) -> SqlResult<Option<DictionaryEntry>> {
    tracing::debug!(entry_id = id, "查询词典条目");
    let mut stmt = conn.prepare(
        &format!("{SELECT_COLS} WHERE id = ?1"),
    )?;

    let mut rows = stmt.query_map(params![id], map_row)?;

    match rows.next() {
        Some(Ok(entry)) => Ok(Some(entry)),
        _ => Ok(None),
    }
}

/// Update the target_text of an entry. Sets source_type to 'manual'.
pub fn update_translation(conn: &Connection, id: i64, new_target: &str) -> SqlResult<bool> {
    tracing::info!(entry_id = id, new_target_len = new_target.len(), "更新词典译文");
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
    let affected = conn.execute(
        "DELETE FROM dictionary_entries WHERE id = ?1",
        params![id],
    )?;
    Ok(affected > 0)
}

/// Get total count of entries.
pub fn count(conn: &Connection) -> SqlResult<usize> {
    let count = conn.query_row("SELECT COUNT(*) FROM dictionary_entries", [], |row| {
        row.get::<_, i64>(0).map(|v| v as usize)
    })?;
    tracing::debug!(count, "词典条目计数");
    Ok(count)
}

/// Import resource pack entries into the dictionary.
/// TODO: Integrate into translation pipeline when resource pack reuse is enabled.
#[allow(dead_code)]
pub fn import_resource_pack_entries(
    conn: &Connection,
    entries: &[LanguageEntry],
    target_lang: &str,
) -> SqlResult<ImportResult> {
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut conflicts = Vec::new();

    for entry in entries {
        if entry.language != target_lang {
            skipped += 1;
            continue;
        }

        let source_hash = hash_text(&entry.text);
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT source_type, target_text FROM dictionary_entries
                 WHERE source_hash = ?1 AND target_lang = ?2
                 LIMIT 1",
                params![source_hash, target_lang],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        match existing {
            Some((_, ref existing_text)) if *existing_text == entry.text => {
                skipped += 1;
            }
            Some((ref existing_type, ref existing_text)) => {
                conflicts.push(format!(
                    "条目「{}」已有译文「{}」（来源: {}），资源包译文「{}」被跳过",
                    entry.text, existing_text, existing_type, entry.text
                ));
                skipped += 1;
            }
            None => {
                let dict_entry = DictionaryEntry {
                    id: None,
                    source_text: entry.text.clone(),
                    target_text: entry.text.clone(),
                    source_lang: entry.language.clone(),
                    target_lang: target_lang.to_string(),
                    source_type: "resourcepack".to_string(),
                    mod_id: Some(entry.mod_id.clone()),
                    translation_key: Some(entry.key.clone()),
                    context: None,
                    confidence: 0.8,
                    created_at: None,
                    updated_at: None,
                };
                upsert(conn, &dict_entry)?;
                imported += 1;
            }
        }
    }

    Ok(ImportResult {
        imported,
        skipped,
        conflicts,
    })
}

/// Export all entries as JSON lines.
pub fn export_jsonl(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut stmt = conn.prepare(
        &format!("{SELECT_COLS} ORDER BY id"),
    )?;

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
    tracing::info!(count = lines.len(), "Importing dictionary entries from JSONL");
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
        "SELECT DISTINCT mod_id FROM dictionary_entries WHERE mod_id IS NOT NULL ORDER BY mod_id",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row?);
    }
    Ok(ids)
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

        // CFPA should overwrite resourcepack
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
        assert_eq!(retrieved.target_text, "哈喽");
        assert_eq!(retrieved.source_type, "cfpa");
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
        let result = import_jsonl(&import_conn, &lines.iter().map(|s| s.as_str()).collect::<Vec<_>>()).unwrap();
        assert_eq!(result.imported, 1);

        let count = count(&import_conn).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn counts_entries() {
        let conn = test_conn();
        assert_eq!(count(&conn).unwrap(), 0);

        insert(&conn, &DictionaryEntry {
            source_text: "a".into(),
            target_text: "甲".into(),
            source_lang: "en_us".into(),
            target_lang: "zh_cn".into(),
            source_type: "manual".into(),
            ..Default::default()
        }).unwrap();
        assert_eq!(count(&conn).unwrap(), 1);
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

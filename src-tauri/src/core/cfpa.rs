// CFPA 词典模糊匹配
//
// 对原文在词典中进行模糊匹配，返回候选译文列表作为 LLM 翻译的参考上下文。
// 复用现有 dictionary SQLite 表，仅搜索 source_type = 'cfpa' 的条目。

use rusqlite::{Connection, Result as SqlResult};

/// CFPA 模糊匹配结果
#[derive(Debug, Clone)]
pub struct CfpaMatch {
    pub source_text: String,
    pub target_text: String,
    pub similarity: f64,
}

/// 对原文进行模糊匹配，返回候选译文列表
///
/// 策略：
/// 1. SQL LIKE 子串匹配
/// 2. 关键词拆分后分别匹配
/// 3. 合并结果按相似度排序去重
pub fn fuzzy_search(
    conn: &Connection,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    limit: usize,
) -> SqlResult<Vec<CfpaMatch>> {
    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let limit = limit.min(20);

    // 策略 1：全文本子串匹配
    {
        let pattern = format!("%{}%", text);
        let mut stmt = conn.prepare(
            "SELECT source_text, target_text FROM dictionary_entries
             WHERE source_type = 'cfpa'
               AND source_lang = ?1 AND target_lang = ?2
               AND source_text LIKE ?3
             LIMIT ?4"
        )?;
        let rows = stmt.query_map(rusqlite::params![source_lang, target_lang, pattern, limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })?;
        for row in rows {
            let (src, tgt) = row?;
            if seen.insert(src.clone()) {
                let sim = if src.to_lowercase() == text.to_lowercase() { 1.0 } else { 0.7 };
                results.push(CfpaMatch { source_text: src, target_text: tgt, similarity: sim });
            }
        }
    }

    // 策略 2：关键词拆分匹配
    if results.len() < limit {
        let keywords: Vec<&str> = text.split(|c: char| c == ' ' || c == '_' || c == '/')
            .filter(|w| w.len() > 2)
            .collect();
        for kw in keywords {
            if results.len() >= limit { break; }
            let pattern = format!("%{}%", kw);
            let mut stmt = conn.prepare(
                "SELECT source_text, target_text FROM dictionary_entries
                 WHERE source_type = 'cfpa'
                   AND source_lang = ?1 AND target_lang = ?2
                   AND source_text LIKE ?3
                   AND source_text NOT LIKE ?4
                 LIMIT ?5"
            )?;
            let full_pattern = format!("%{}%", text);
            let remaining = (limit - results.len()) as i64;
            let rows = stmt.query_map(rusqlite::params![source_lang, target_lang, pattern, full_pattern, remaining], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            })?;
            for row in rows {
                let (src, tgt) = row?;
                if seen.insert(src.clone()) {
                    results.push(CfpaMatch { source_text: src, target_text: tgt, similarity: 0.5 });
                }
            }
        }
    }

    // 按相似度降序
    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_cfpa_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_text TEXT NOT NULL,
                target_text TEXT NOT NULL,
                source_lang TEXT NOT NULL DEFAULT 'en_us',
                target_lang TEXT NOT NULL DEFAULT 'zh_cn',
                source_type TEXT NOT NULL DEFAULT 'cfpa',
                source_hash TEXT NOT NULL DEFAULT '',
                target_hash TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 1.0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );"
        ).unwrap();
        conn
    }

    fn insert_cfpa(conn: &Connection, src: &str, tgt: &str) {
        conn.execute(
            "INSERT INTO dictionary_entries (source_text, target_text, source_lang, target_lang, source_type, source_hash, target_hash)
             VALUES (?1, ?2, 'en_us', 'zh_cn', 'cfpa', '', '')",
            rusqlite::params![src, tgt],
        ).unwrap();
    }

    #[test]
    fn fuzzy_finds_exact_match() {
        let conn = setup_cfpa_db();
        insert_cfpa(&conn, "Iron Ingot", "铁锭");
        insert_cfpa(&conn, "Stone Sword", "石剑");

        let results = fuzzy_search(&conn, "Iron Ingot", "en_us", "zh_cn", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert!((results[0].similarity - 1.0).abs() < 0.001);
    }

    #[test]
    fn fuzzy_finds_substring_match() {
        let conn = setup_cfpa_db();
        insert_cfpa(&conn, "Iron Ingot", "铁锭");
        insert_cfpa(&conn, "Iron Sword", "铁剑");

        let results = fuzzy_search(&conn, "Iron", "en_us", "zh_cn", 10).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn fuzzy_limits_results() {
        let conn = setup_cfpa_db();
        insert_cfpa(&conn, "Apple", "苹果");
        insert_cfpa(&conn, "Apple Pie", "苹果派");
        insert_cfpa(&conn, "Apple Juice", "苹果汁");

        let results = fuzzy_search(&conn, "Apple", "en_us", "zh_cn", 2).unwrap();
        assert!(results.len() <= 2);
    }

    #[test]
    fn fuzzy_returns_empty_for_no_match() {
        let conn = setup_cfpa_db();
        let results = fuzzy_search(&conn, "NonExistentItem", "en_us", "zh_cn", 10).unwrap();
        assert!(results.is_empty());
    }
}

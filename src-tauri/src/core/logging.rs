use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use regex::Regex;

pub fn init_main_log(root: &Path) -> io::Result<()> {
    let logs_dir = root.join("logs");
    fs::create_dir_all(logs_dir.join("jobs"))?;
    fs::create_dir_all(logs_dir.join("errors"))?;
    fs::write(
        logs_dir.join("main.log"),
        format!("[{}] INFO 程序启动，main.log 已重置\n", timestamp()),
    )
}

pub fn append_main(root: &Path, message: impl AsRef<str>) -> io::Result<()> {
    append(root.join("logs").join("main.log"), "INFO", message.as_ref())
}

pub fn append_job(root: &Path, job_id: &str, message: impl AsRef<str>) -> io::Result<()> {
    append(
        root.join("logs").join("jobs").join(format!("{job_id}.log")),
        "INFO",
        message.as_ref(),
    )
}

pub fn append_error(root: &Path, job_id: &str, message: impl AsRef<str>) -> io::Result<()> {
    append(
        root.join("logs").join("errors").join(format!("{job_id}.log")),
        "ERROR",
        message.as_ref(),
    )
}

pub fn new_job_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{prefix}_{millis}")
}

fn append(path: std::path::PathBuf, level: &str, message: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "[{}] {level} {}", timestamp(), redact_secret(message))
}

fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    secs.to_string()
}

/// Redact sensitive information (API keys, tokens) from log messages using regex patterns.
///
/// The approach avoids raw string regex literals to prevent editor/truncation issues.
/// Patterns are compiled lazily with OnceLock.
fn redact_secret(message: &str) -> String {
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
            // Pattern 1: "api_key":"sk-xxxx..." or 'api_key':'sk-xxxx...' in JSON
            (
                Regex::new("(?i)(api[_-]?key|authorization)\\s*[:=]\\s*[\"']?(sk-[a-zA-Z0-9]{20,})[\"']?").unwrap(),
                "[REDACTED]",
            ),
            // Pattern 2: api_key=sk-xxxx in URL query or headers
            (
                Regex::new("(?i)(api[_-]?key|authorization)\\s*[:=]\\s*(sk-[a-zA-Z0-9]{20,})").unwrap(),
                "${1}=[REDACTED]",
            ),
            // Pattern 3: Bearer sk-xxxx or bearer sk-xxxx
            (
                Regex::new("(?i)(Bearer\\s+)(sk-[a-zA-Z0-9]{20,})").unwrap(),
                "${1}[REDACTED]",
            ),
            // Pattern 4: Generic long API keys (16+ chars) after known labels
            (
                Regex::new("(?i)(api[_-]?key|authorization)\\s*[:=]\\s*[\"']?([a-zA-Z0-9_\\-]{16,})[\"']?").unwrap(),
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

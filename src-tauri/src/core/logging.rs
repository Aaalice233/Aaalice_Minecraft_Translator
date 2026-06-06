use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

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

fn redact_secret(message: &str) -> String {
    message
        .split_whitespace()
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            if lower.contains("api_key") || lower.contains("apikey") || lower.contains("authorization") {
                "[REDACTED]"
            } else if lower.starts_with("bearer") && part.len() > 10 {
                "Bearer [REDACTED]"
            } else if (part.starts_with("sk-") || part.starts_with("sk_")) && part.len() > 10 {
                "[REDACTED]"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

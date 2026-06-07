use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::core::paths;

/// A single parsed log entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub line_number: usize,
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

/// Result of reading the main log file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLogsResult {
    pub entries: Vec<LogEntry>,
    pub file_size: u64,
}

/// Shared state: (byte_offset, line_count) for incremental reads.
/// Tracks both the byte position for seeking and cumulative line count
/// so that line numbers remain correct across multiple poll cycles.
pub struct LogOffset(pub Mutex<(u64, usize)>);

#[tauri::command]
pub fn read_logs(
    offset_state: State<'_, LogOffset>,
) -> Result<ReadLogsResult, String> {
    let root = paths::runtime_root().map_err(|e| format!("获取运行时路径失败: {e}"))?;
    let log_path = root.join("logs").join("main.log");

    if !log_path.is_file() {
        return Ok(ReadLogsResult {
            entries: Vec::new(),
            file_size: 0,
        });
    }

    let mut file = std::fs::File::open(&log_path)
        .map_err(|e| format!("打开日志文件失败: {e}"))?;

    let file_size = file.metadata()
        .map(|m| m.len())
        .unwrap_or(0);

    let mut state = offset_state.0.lock().map_err(|e| format!("锁错误: {e}"))?;
    let (byte_offset, mut line_count) = *state;

    // If file was truncated (smaller than our offset), reset to 0
    if byte_offset > file_size {
        *state = (0, 0);
        line_count = 0;
    }

    // Seek to last known byte position
    file.seek(SeekFrom::Start(byte_offset))
        .map_err(|e| format!("定位文件失败: {e}"))?;

    let mut buffer = String::new();
    file.read_to_string(&mut buffer)
        .map_err(|e| format!("读取日志文件失败: {e}"))?;

    // Count how many new lines were read
    let new_line_count = buffer.lines().count();

    // Parse new lines, using cumulative line_count for correct line numbers
    let entries: Vec<LogEntry> = buffer
        .lines()
        .enumerate()
        .map(|(i, line)| parse_log_line(line_count + i, line))
        .collect();

    // Update state: byte offset to EOF, line count incremented
    *state = (file_size, line_count + new_line_count);

    Ok(ReadLogsResult { entries, file_size })
}

/// Parse a single log line into a LogEntry.
///
/// Expected format: `[timestamp] LEVEL message`
/// Lines that don't match the format are treated as raw continuation lines.
fn parse_log_line(line_number: usize, line: &str) -> LogEntry {
    let trimmed = line.trim();
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some(close) = rest.find(']') {
            let timestamp = rest[..close].to_string();
            let after_bracket = rest[close + 1..].trim();
            if let Some(space) = after_bracket.find(' ') {
                let level = after_bracket[..space].to_string();
                let message = after_bracket[space + 1..].to_string();
                return LogEntry {
                    line_number,
                    timestamp,
                    level,
                    message,
                };
            }
        }
    }
    // Fallback: treat as raw message (continuation or unformatted line)
    LogEntry {
        line_number,
        timestamp: String::new(),
        level: "RAW".to_string(),
        message: trimmed.to_string(),
    }
}

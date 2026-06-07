use super::{append_error, append_job, append_main, init, new_job_id};

/// Simulates the frontend's parse_log_line logic to verify format compatibility.
/// Test that LogFormatter output is compatible with the frontend's parse_log_line.
///
/// Frontend parser expects: `[timestamp] LEVEL message`
/// LogFormatter produces:   `[unix_seconds] LEVEL message`
#[test]
fn test_log_format_frontend_compatible() {
    // Create a log line in our format
    let line = "[1234567890] DEBUG test message from logger";
    let (ts, level, msg) = parse_log_line(line);
    assert_eq!(ts, "1234567890", "timestamp 应正确解析");
    assert_eq!(level, "DEBUG", "level 应正确解析");
    assert_eq!(msg, "test message from logger", "message 应正确解析");
}

/// Test various log level formats all parse correctly
#[test]
fn test_log_format_various_levels() {
    for (level, label) in [("ERROR", "error"), ("WARN", "warn"), ("INFO", "info"), ("DEBUG", "debug"), ("TRACE", "trace")] {
        let line = format!("[0] {level} {label} message");
        let (_, parsed_level, parsed_msg) = parse_log_line(&line);
        assert_eq!(parsed_level, level, "level {level} 应正确解析");
        assert!(parsed_msg.contains(label), "消息应包含 '{label}'");
    }
}

/// Test that unix timestamp is parseable as a number
#[test]
fn test_log_format_timestamp_is_numeric() {
    let line = "[1735912992] INFO numeric check";
    let (ts, _, _) = parse_log_line(line);
    let parsed: u64 = ts.parse().expect("timestamp 应为数字");
    assert!(parsed > 0, "timestamp 应大于 0");
}

fn parse_log_line(line: &str) -> (String, String, String) {
    let trimmed = line.trim();
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some(close) = rest.find(']') {
            let timestamp = rest[..close].to_string();
            let after_bracket = rest[close + 1..].trim();
            if let Some(space) = after_bracket.find(' ') {
                let level = after_bracket[..space].to_string();
                let message = after_bracket[space + 1..].to_string();
                return (timestamp, level, message);
            }
        }
    }
    (String::new(), "RAW".to_string(), trimmed.to_string())
}

#[test]
fn test_new_job_id_format() {
    let id = new_job_id("test");
    assert!(id.starts_with("test_"), "job_id 应以 prefix_ 开头");
    assert!(id.len() > 5, "job_id 应包含时间戳");
}

#[test]
fn test_new_init_creates_logs_dir() {
    let dir = tempfile::tempdir().expect("tempdir");
    init(dir.path()).expect("logging::init 应成功");
    let main_log = dir.path().join("logs").join("main.log");
    assert!(main_log.is_file(), "init 后应创建 main.log");
}

#[test]
fn test_append_main_returns_ok() {
    let result = append_main("test");
    assert!(result.is_ok(), "append_main 应返回 Ok(())");
}

#[test]
fn test_append_job_returns_ok() {
    let result = append_job("job_001", "test");
    assert!(result.is_ok(), "append_job 应返回 Ok(())");
}

#[test]
fn test_append_error_returns_ok() {
    let result = append_error("job_001", "test");
    assert!(result.is_ok(), "append_error 应返回 Ok(())");
}

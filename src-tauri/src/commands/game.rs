fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open::that(path).map_err(to_message)
}

/// Placeholder — returns empty list; actual implementation deferred.
#[tauri::command]
pub fn fetch_game_versions() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// Read a log file from disk, returning the last N lines.
#[tauri::command]
pub fn get_log_content(path: String) -> Result<String, String> {
    use std::io::{BufReader, Read, Seek, SeekFrom};
    let file = std::fs::File::open(&path).map_err(to_message)?;
    let mut reader = BufReader::new(file);

    // Efficient tail: seek near end, read chunks backwards
    let file_len = reader.seek(SeekFrom::End(0)).map_err(to_message)?;
    const MAX_TAIL_LINES: usize = 500;
    const CHUNK_SIZE: u64 = 4096;
    let mut buffer = Vec::new();
    let mut pos = file_len;
    let mut lines_found = 0usize;

    // Read backwards in chunks until we have enough lines or reach the start
    while pos > 0 && lines_found < MAX_TAIL_LINES {
        let chunk_start = pos.saturating_sub(CHUNK_SIZE);
        let chunk_len = (pos - chunk_start) as usize;
        let mut chunk = vec![0u8; chunk_len];
        reader.seek(SeekFrom::Start(chunk_start)).map_err(to_message)?;
        reader.read_exact(&mut chunk).map_err(to_message)?;
        pos = chunk_start;

        // Count newlines in this chunk (excluding the first line if it's a partial line)
        for &b in chunk.iter().rev() {
            if b == b'\n' && lines_found <= MAX_TAIL_LINES {
                lines_found += 1;
            }
        }
        buffer.splice(0..0, chunk);
    }

    let content = String::from_utf8_lossy(&buffer);
    let lines: Vec<&str> = content.lines().collect();
    let tail = lines.iter().rev().take(MAX_TAIL_LINES).cloned().collect::<Vec<_>>();
    let tail: Vec<&str> = tail.into_iter().rev().collect();
    Ok(tail.join("\n"))
}

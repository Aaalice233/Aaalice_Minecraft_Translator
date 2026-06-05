use std::{io, path::PathBuf};

pub fn runtime_root() -> io::Result<PathBuf> {
    // Use the executable's location to determine runtime root.
    // During development (cargo): .../src-tauri/target/{debug,release}/exe
    // For installed app:           install_dir/exe
    let exe = std::env::current_exe().map_err(|e| {
        io::Error::new(
            io::ErrorKind::Other,
            format!("无法获取可执行文件路径: {e}"),
        )
    })?;

    if let Some(dir) = exe.parent() {
        let dir_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if dir_name == "debug" || dir_name == "release" {
            // Development mode: exe is in .../src-tauri/target/{debug,release}/
            // Walk up 3 levels to reach project root
            let mut root = dir.to_path_buf();
            for _ in 0..3 {
                if let Some(parent) = root.parent() {
                    root = parent.to_path_buf();
                }
            }
            return Ok(root);
        }
        // Installed mode: use exe's own directory
        return Ok(dir.to_path_buf());
    }

    // Fallback: current working directory
    let cwd = std::env::current_dir()?;
    if cwd.file_name().is_some_and(|name| name == "src-tauri") {
        Ok(cwd.parent().unwrap_or(&cwd).to_path_buf())
    } else {
        Ok(cwd)
    }
}

pub fn display_path(path: impl AsRef<std::path::Path>) -> String {
    path.as_ref().to_string_lossy().replace('\\', "/")
}

/// Path to the SQLite dictionary database
pub fn dictionary_db_path(root: &std::path::Path) -> std::path::PathBuf {
    root.join("data").join("dictionary.sqlite")
}

/// Directory for build output (translated resource pack)
pub fn build_output_dir(root: &std::path::Path) -> std::path::PathBuf {
    root.join("build").join("output")
}

/// Path to a translation job's state file (for cross-session recovery)
pub fn job_state_path(root: &std::path::Path, job_id: &str) -> std::path::PathBuf {
    root.join("data").join("jobs").join(format!("{job_id}.json"))
}

/// Directory for all job state files
pub fn jobs_dir(root: &std::path::Path) -> std::path::PathBuf {
    root.join("data").join("jobs")
}

/// Path to a translation job's lightweight state file (stats only).
pub fn translate_job_state_path(root: &std::path::Path, job_id: &str) -> std::path::PathBuf {
    root.join("data").join("jobs").join(format!("translate_{job_id}.json"))
}

/// Path to a translation job's results file (JSONL, one result per line).
pub fn translate_job_results_path(root: &std::path::Path, job_id: &str) -> std::path::PathBuf {
    root.join("data").join("jobs").join(format!("translate_{job_id}_results.jsonl"))
}

/// Delete all scan_*.json cache files in the jobs directory.
/// Called on app startup to ensure a fresh scan state.
pub fn clear_scan_cache(root: &std::path::Path) -> std::io::Result<()> {
    let jobs_dir = jobs_dir(root);
    if !jobs_dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&jobs_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("scan_") && name.ends_with(".json") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

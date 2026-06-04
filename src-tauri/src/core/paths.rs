use std::{io, path::PathBuf};

pub fn runtime_root() -> io::Result<PathBuf> {
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

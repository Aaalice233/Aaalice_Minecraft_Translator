use tracing::info;

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let normalized = normalize_open_path(&path);
    info!("open_path: path={}", normalized);
    open::that(normalized).map_err(|e| e.to_string())
}

fn normalize_open_path(path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    if let Some(rest) = path.strip_prefix("//?/UNC/") {
        return format!("//{rest}");
    }
    if let Some(rest) = path.strip_prefix("//?/") {
        return rest.to_string();
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::normalize_open_path;

    #[test]
    fn strips_windows_extended_prefix_for_local_paths() {
        assert_eq!(
            normalize_open_path("//?/E:/PCL2/.minecraft/resourcepacks"),
            "E:/PCL2/.minecraft/resourcepacks"
        );
        assert_eq!(
            normalize_open_path(r"\\?\E:\PCL2\.minecraft\resourcepacks"),
            r"E:\PCL2\.minecraft\resourcepacks"
        );
    }

    #[test]
    fn leaves_urls_unchanged() {
        assert_eq!(
            normalize_open_path("https://github.com/Aaalice233/Aaalice_Minecraft_Translator"),
            "https://github.com/Aaalice233/Aaalice_Minecraft_Translator"
        );
    }
}

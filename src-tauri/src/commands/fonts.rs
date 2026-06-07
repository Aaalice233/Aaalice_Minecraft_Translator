use tracing::info;

use font_kit::source::SystemSource;

/// 获取当前系统已安装的所有可用字体家族名称列表。
/// 自动过滤掉隐藏字体和明显的图标/符号字体。
#[tauri::command]
pub fn list_fonts() -> Result<Vec<String>, String> {
    info!("list_fonts");
    let source = SystemSource::new();
    let families = source.all_families().map_err(|e| format!("获取系统字体失败: {e}"))?;

    let mut names: Vec<String> = families
        .iter()
        .map(|f| f.to_string())
        .filter(|name| {
            // 过滤隐藏字体（以 . 开头）和明显的符号字体
            !name.starts_with('.')
                && !matches!(
                    name.as_str(),
                    "Webdings" | "Wingdings" | "Wingdings 2" | "Wingdings 3" | "Symbol"
                        | "Marlett" | "Segoe MDL2 Assets" | "Segoe Fluent Icons"
                        | "Segoe UI Symbol" | "Segoe UI Emoji"
                )
        })
        .collect();

    // 按字母排序（不区分大小写）
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    // 去重（可能因 DirectWrite 来源不同产生重复）
    names.dedup();

    Ok(names)
}

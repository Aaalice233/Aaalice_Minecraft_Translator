use std::fs::File;
use std::path::{Path, PathBuf};

use reqwest::blocking::Client;
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, Manager};
use tracing::info;

use crate::core::{dictionary, paths};

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/CFPATools/i18n-dict/releases/latest";
const SQLITE_ASSET_NAME: &str = "Dict-Sqlite.db";
const META_TAG: &str = "i18n_dict_tag";
const META_PUBLISHED_AT: &str = "i18n_dict_published_at";
const META_ASSET_NAME: &str = "i18n_dict_asset_name";
const META_ENTRY_COUNT: &str = "i18n_dict_entry_count";
const BUNDLED_DB_RESOURCE: &str = "resources/i18n-dict/Dict-Sqlite.db";
const BUNDLED_METADATA_RESOURCE: &str = "resources/i18n-dict/metadata.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct I18nDictUpdateInfo {
    pub current_tag: Option<String>,
    pub latest_tag: String,
    pub latest_name: String,
    pub published_at: String,
    pub asset_name: String,
    pub installed_entries: usize,
    pub update_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct I18nDictUpdateResult {
    pub tag: String,
    pub published_at: String,
    pub imported_entries: usize,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    published_at: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

struct LatestI18nDict {
    tag: String,
    name: String,
    published_at: String,
    asset_name: String,
    download_url: String,
}

struct AvailableI18nDict {
    tag: String,
    name: String,
    published_at: String,
    asset_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledI18nDictMetadata {
    tag_name: String,
    name: Option<String>,
    published_at: String,
    asset_name: String,
}

struct BundledI18nDict {
    db_path: PathBuf,
    metadata: BundledI18nDictMetadata,
}

#[tauri::command]
pub async fn check_i18n_dict_update(app: tauri::AppHandle) -> Result<I18nDictUpdateInfo, String> {
    info!("check_i18n_dict_update");
    tauri::async_runtime::spawn_blocking(move || check_i18n_dict_update_blocking(&app))
        .await
        .map_err(|e| format!("检查 i18n 模组词典更新线程崩溃: {e}"))?
}

fn check_i18n_dict_update_blocking(app: &tauri::AppHandle) -> Result<I18nDictUpdateInfo, String> {
    let available = fetch_latest_i18n_dict()
        .map(AvailableI18nDict::from)
        .or_else(|_| bundled_i18n_dict(app).map(AvailableI18nDict::from))?;
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let current_tag = dictionary::get_metadata(&conn, META_TAG).map_err(|e| e.to_string())?;
    let installed_entries =
        dictionary::count_by_source_type(&conn, "cfpa").map_err(|e| e.to_string())?;
    let update_available =
        installed_entries == 0 || current_tag.as_deref() != Some(available.tag.as_str());

    Ok(I18nDictUpdateInfo {
        current_tag,
        latest_tag: available.tag,
        latest_name: available.name,
        published_at: available.published_at,
        asset_name: available.asset_name,
        installed_entries,
        update_available,
    })
}

#[tauri::command]
pub async fn update_i18n_dict(app: tauri::AppHandle) -> Result<I18nDictUpdateResult, String> {
    info!("update_i18n_dict");
    tauri::async_runtime::spawn_blocking(move || update_i18n_dict_blocking(&app))
        .await
        .map_err(|e| format!("更新 i18n 模组词典线程崩溃: {e}"))?
}

fn update_i18n_dict_blocking(app: &tauri::AppHandle) -> Result<I18nDictUpdateResult, String> {
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let mut conn =
        dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let bundled = bundled_i18n_dict(app).ok();
    let latest = fetch_latest_i18n_dict();
    let (source_path, available, cleanup_path) = match latest {
        Ok(latest) => {
            if let Some(bundled) = bundled {
                if bundled.metadata.tag_name == latest.tag {
                    (bundled.db_path, AvailableI18nDict::from(latest), None)
                } else {
                    let download_path = download_i18n_dict_sqlite(&root, &latest)?;
                    (
                        download_path.clone(),
                        AvailableI18nDict::from(latest),
                        Some(download_path),
                    )
                }
            } else {
                let download_path = download_i18n_dict_sqlite(&root, &latest)?;
                (
                    download_path.clone(),
                    AvailableI18nDict::from(latest),
                    Some(download_path),
                )
            }
        }
        Err(fetch_error) => {
            let bundled = bundled.ok_or(fetch_error)?;
            let available = AvailableI18nDict::from(&bundled.metadata);
            (bundled.db_path, available, None)
        }
    };

    let imported_entries = import_i18n_dict_sqlite(&mut conn, &source_path)?;
    dictionary::set_metadata(&conn, META_TAG, &available.tag).map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_PUBLISHED_AT, &available.published_at)
        .map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_ASSET_NAME, &available.asset_name)
        .map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_ENTRY_COUNT, &imported_entries.to_string())
        .map_err(|e| e.to_string())?;

    if let Some(path) = cleanup_path {
        let _ = std::fs::remove_file(path);
    }
    Ok(I18nDictUpdateResult {
        tag: available.tag,
        published_at: available.published_at,
        imported_entries,
    })
}

pub(crate) fn ensure_bundled_i18n_dict_installed(
    app: &tauri::AppHandle,
) -> Result<Option<usize>, String> {
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let mut conn =
        dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let installed_entries =
        dictionary::count_by_source_type(&conn, "cfpa").map_err(|e| e.to_string())?;
    if installed_entries > 0 {
        return Ok(None);
    }

    let bundled = bundled_i18n_dict(app)?;
    let imported_entries = import_i18n_dict_sqlite(&mut conn, &bundled.db_path)?;
    dictionary::set_metadata(&conn, META_TAG, &bundled.metadata.tag_name)
        .map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_PUBLISHED_AT, &bundled.metadata.published_at)
        .map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_ASSET_NAME, &bundled.metadata.asset_name)
        .map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_ENTRY_COUNT, &imported_entries.to_string())
        .map_err(|e| e.to_string())?;

    Ok(Some(imported_entries))
}

impl From<LatestI18nDict> for AvailableI18nDict {
    fn from(value: LatestI18nDict) -> Self {
        Self {
            tag: value.tag,
            name: value.name,
            published_at: value.published_at,
            asset_name: value.asset_name,
        }
    }
}

impl From<BundledI18nDict> for AvailableI18nDict {
    fn from(value: BundledI18nDict) -> Self {
        Self::from(&value.metadata)
    }
}

impl From<&BundledI18nDictMetadata> for AvailableI18nDict {
    fn from(value: &BundledI18nDictMetadata) -> Self {
        Self {
            tag: value.tag_name.clone(),
            name: value.name.clone().unwrap_or_else(|| value.tag_name.clone()),
            published_at: value.published_at.clone(),
            asset_name: value.asset_name.clone(),
        }
    }
}

fn bundled_i18n_dict(app: &tauri::AppHandle) -> Result<BundledI18nDict, String> {
    let db_path = bundled_resource_path(app, BUNDLED_DB_RESOURCE)
        .ok_or_else(|| "未找到内置 i18n 模组词典".to_string())?;
    let metadata_path = bundled_resource_path(app, BUNDLED_METADATA_RESOURCE)
        .ok_or_else(|| "未找到内置 i18n 模组词典元数据".to_string())?;
    let metadata_text = std::fs::read_to_string(&metadata_path)
        .map_err(|e| format!("读取内置 i18n 模组词典元数据失败: {e}"))?;
    let metadata: BundledI18nDictMetadata = serde_json::from_str(&metadata_text)
        .map_err(|e| format!("解析内置 i18n 模组词典元数据失败: {e}"))?;
    Ok(BundledI18nDict { db_path, metadata })
}

fn bundled_resource_path(app: &tauri::AppHandle, resource: &str) -> Option<PathBuf> {
    app.path()
        .resolve(resource, BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_file())
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|cwd| cwd.join("src-tauri").join(resource))
                .filter(|path| path.is_file())
        })
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|cwd| cwd.join(resource))
                .filter(|path| path.is_file())
        })
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Aaalice-MC-Translator")
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

fn fetch_latest_i18n_dict() -> Result<LatestI18nDict, String> {
    let client = http_client()?;
    let release: GithubRelease = client
        .get(LATEST_RELEASE_URL)
        .send()
        .map_err(|e| format!("检查 i18n 模组词典更新失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub release 响应异常: {e}"))?
        .json()
        .map_err(|e| format!("解析 i18n 模组词典 release 失败: {e}"))?;

    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == SQLITE_ASSET_NAME)
        .ok_or_else(|| format!("最新 release 中未找到 {SQLITE_ASSET_NAME}"))?;

    Ok(LatestI18nDict {
        name: release.name.unwrap_or_else(|| release.tag_name.clone()),
        tag: release.tag_name,
        published_at: release.published_at,
        asset_name: asset.name,
        download_url: asset.browser_download_url,
    })
}

fn download_i18n_dict_sqlite(root: &Path, latest: &LatestI18nDict) -> Result<PathBuf, String> {
    let dir = root.join("data").join("i18n-dict");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 i18n 词典缓存目录失败: {e}"))?;
    let path = dir.join(format!("{}.download", SQLITE_ASSET_NAME));
    let mut file = File::create(&path).map_err(|e| format!("创建 i18n 词典下载文件失败: {e}"))?;

    let client = http_client()?;
    let mut response = client
        .get(&latest.download_url)
        .send()
        .map_err(|e| format!("下载 i18n 模组词典失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("下载 i18n 模组词典响应异常: {e}"))?;
    response
        .copy_to(&mut file)
        .map_err(|e| format!("写入 i18n 模组词典下载文件失败: {e}"))?;
    Ok(path)
}

fn import_i18n_dict_sqlite(conn: &mut Connection, source_db_path: &Path) -> Result<usize, String> {
    let source = Connection::open_with_flags(source_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("打开下载的 i18n 词典失败: {e}"))?;
    let mut source_stmt = source
        .prepare(
            "SELECT ORIGIN_NAME, TRANS_NAME, MODID, KEY, VERSION, CURSEFORGE
             FROM dict
             WHERE TRIM(ORIGIN_NAME) <> '' AND TRIM(TRANS_NAME) <> ''",
        )
        .map_err(|e| format!("读取 i18n 词典结构失败: {e}"))?;
    let rows = source_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| format!("读取 i18n 词典条目失败: {e}"))?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("开始词典导入事务失败: {e}"))?;
    tx.execute(
        "DELETE FROM dictionary_entries WHERE source_type = 'cfpa'",
        [],
    )
    .map_err(|e| format!("清理旧 i18n 词典失败: {e}"))?;

    let mut imported = 0usize;
    {
        let mut insert_stmt = tx
            .prepare(
                "INSERT INTO dictionary_entries
                    (source_text, target_text, source_lang, target_lang, source_type,
                     mod_id, translation_key, context, source_hash, target_hash, confidence)
                 VALUES (?1, ?2, 'en_us', 'zh_cn', 'cfpa', ?3, ?4, ?5, ?6, ?7, 0.7)",
            )
            .map_err(|e| format!("准备 i18n 词典写入失败: {e}"))?;

        for row in rows {
            let (source_text, target_text, mod_id, key, version, curseforge) =
                row.map_err(|e| format!("读取 i18n 词典条目失败: {e}"))?;
            let context = serde_json::json!({
                "version": version,
                "curseforge": curseforge,
            })
            .to_string();
            insert_stmt
                .execute(params![
                    source_text,
                    target_text,
                    mod_id,
                    key,
                    context,
                    dictionary::hash_text(&source_text),
                    dictionary::hash_text(&target_text),
                ])
                .map_err(|e| format!("写入 i18n 词典条目失败: {e}"))?;
            imported += 1;
        }
    }

    tx.commit()
        .map_err(|e| format!("提交 i18n 词典导入失败: {e}"))?;
    Ok(imported)
}

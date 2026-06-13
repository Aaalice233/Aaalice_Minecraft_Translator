use std::fs::File;
use std::path::{Path, PathBuf};

use reqwest::blocking::Client;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, Manager};
use tracing::{info, warn};

use crate::core::{dictionary, paths};

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/CFPATools/i18n-dict/releases/latest";
const SQLITE_ASSET_NAME: &str = "Dict-Sqlite.db";
const META_TAG: &str = "i18n_dict_tag";
const META_PUBLISHED_AT: &str = "i18n_dict_published_at";
const META_ASSET_NAME: &str = "i18n_dict_asset_name";
const META_ENTRY_COUNT: &str = "i18n_dict_entry_count";
const BUNDLED_DB_RESOURCE: &str = "resources/i18n-dict/Dict-Sqlite.db";
const BUNDLED_METADATA_RESOURCE: &str = "resources/i18n-dict/metadata.json";
const ACTIVE_DB_FILE_NAME: &str = "Dict-Sqlite.db";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct I18nDictUpdateInfo {
    pub current_tag: Option<String>,
    pub latest_tag: String,
    pub latest_name: String,
    pub published_at: String,
    pub asset_name: String,
    pub reference_entries: usize,
    pub update_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct I18nDictUpdateResult {
    pub tag: String,
    pub published_at: String,
    pub reference_entries: usize,
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
    let bundled = bundled_i18n_dict(app).ok();
    let current_tag = match dictionary::get_metadata(&conn, META_TAG).map_err(|e| e.to_string())? {
        Some(tag) => Some(tag),
        None if !active_i18n_dict_db_path(&root).is_file() => {
            bundled.as_ref().map(|item| item.metadata.tag_name.clone())
        }
        None => None,
    };
    let reference_entries = match reference_entries_for_check(&conn, app, bundled.as_ref()) {
        Ok(count) => count,
        Err(error) => {
            warn!(%error, "本地 i18n 模组词典不可用，将检查结果标记为需要更新");
            0
        }
    };
    let update_available =
        reference_entries == 0 || current_tag.as_deref() != Some(available.tag.as_str());

    Ok(I18nDictUpdateInfo {
        current_tag,
        latest_tag: available.tag,
        latest_name: available.name,
        published_at: available.published_at,
        asset_name: available.asset_name,
        reference_entries,
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
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let bundled = bundled_i18n_dict(app).ok();
    let latest = fetch_latest_i18n_dict();
    let (source_path, available, cleanup_path, precomputed_entries) = match latest {
        Ok(latest) => select_i18n_dict_source(&root, latest, bundled.as_ref())?,
        Err(fetch_error) => {
            let bundled = bundled.ok_or(fetch_error)?;
            let available = AvailableI18nDict::from(&bundled.metadata);
            (bundled.db_path, available, None, None)
        }
    };

    let reference_entries = match precomputed_entries {
        Some(count) => count,
        None => count_i18n_dict_entries(&source_path)?,
    };
    if let Some(path) = cleanup_path.as_ref() {
        let active_path = active_i18n_dict_db_path(&root);
        if let Some(parent) = active_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建 i18n 词典缓存目录失败: {e}"))?;
        }
        if active_path.exists() {
            std::fs::remove_file(&active_path)
                .map_err(|e| format!("替换旧 i18n 模组词典失败: {e}"))?;
        }
        std::fs::rename(path, &active_path).map_err(|e| format!("保存 i18n 模组词典失败: {e}"))?;
    }
    dictionary::set_metadata(&conn, META_TAG, &available.tag).map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_PUBLISHED_AT, &available.published_at)
        .map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_ASSET_NAME, &available.asset_name)
        .map_err(|e| e.to_string())?;
    dictionary::set_metadata(&conn, META_ENTRY_COUNT, &reference_entries.to_string())
        .map_err(|e| e.to_string())?;

    Ok(I18nDictUpdateResult {
        tag: available.tag,
        published_at: available.published_at,
        reference_entries,
    })
}

fn select_i18n_dict_source(
    root: &Path,
    latest: LatestI18nDict,
    bundled: Option<&BundledI18nDict>,
) -> Result<(PathBuf, AvailableI18nDict, Option<PathBuf>, Option<usize>), String> {
    if let Some(bundled) = bundled {
        if bundled.metadata.tag_name == latest.tag {
            match count_i18n_dict_entries(&bundled.db_path) {
                Ok(count) => {
                    return Ok((
                        bundled.db_path.clone(),
                        AvailableI18nDict::from(latest),
                        None,
                        Some(count),
                    ));
                }
                Err(error) => {
                    warn!(
                        %error,
                        path = %bundled.db_path.display(),
                        "内置 i18n 模组词典不可用，改为下载最新词典"
                    );
                }
            }
        }
    }

    let download_path = download_i18n_dict_sqlite(root, &latest)?;
    Ok((
        download_path.clone(),
        AvailableI18nDict::from(latest),
        Some(download_path),
        None,
    ))
}

pub(crate) fn active_i18n_dict_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let active_path = active_i18n_dict_db_path(&root);
    if active_path.is_file() {
        return Ok(active_path);
    }
    Ok(bundled_i18n_dict(app)?.db_path)
}

fn reference_entries_for_check(
    conn: &Connection,
    app: &tauri::AppHandle,
    bundled: Option<&BundledI18nDict>,
) -> Result<usize, String> {
    let cached_count = dictionary::get_metadata(conn, META_ENTRY_COUNT)
        .map_err(|e| e.to_string())?
        .and_then(|value| value.parse::<usize>().ok());
    if let Some(count) = cached_count {
        if count > 0 {
            return Ok(count);
        }
    }

    let counted = count_active_or_bundled_i18n_dict_entries(app, bundled)?;
    dictionary::set_metadata(conn, META_ENTRY_COUNT, &counted.to_string())
        .map_err(|e| e.to_string())?;
    Ok(counted)
}

fn count_active_or_bundled_i18n_dict_entries(
    app: &tauri::AppHandle,
    bundled: Option<&BundledI18nDict>,
) -> Result<usize, String> {
    match active_i18n_dict_path(app).and_then(|path| count_i18n_dict_entries(&path)) {
        Ok(count) => Ok(count),
        Err(active_error) => match bundled {
            Some(item) => count_i18n_dict_entries(&item.db_path).map_err(|bundled_error| {
                format!(
                    "统计当前 i18n 模组词典失败: {active_error}; 统计内置词典也失败: {bundled_error}"
                )
            }),
            None => Err(active_error),
        },
    }
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
    let path = dir.join(format!("{ACTIVE_DB_FILE_NAME}.download"));
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

fn active_i18n_dict_db_path(root: &Path) -> PathBuf {
    root.join("data")
        .join("i18n-dict")
        .join(ACTIVE_DB_FILE_NAME)
}

fn count_i18n_dict_entries(source_db_path: &Path) -> Result<usize, String> {
    let source = Connection::open_with_flags(source_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("打开 i18n 词典失败: {e}"))?;
    let count = source
        .query_row(
            "SELECT COUNT(*) FROM dict WHERE TRIM(ORIGIN_NAME) <> '' AND TRIM(TRANS_NAME) <> ''",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("统计 i18n 词典条目失败: {e}"))?;
    usize::try_from(count).map_err(|e| format!("统计 i18n 词典条目数异常: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_i18n_dict_entries_filters_blank_terms() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("Dict-Sqlite.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE dict(
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                ORIGIN_NAME TEXT NOT NULL,
                TRANS_NAME TEXT NOT NULL,
                MODID TEXT NOT NULL,
                KEY TEXT NOT NULL,
                VERSION TEXT NOT NULL,
                CURSEFORGE TEXT NOT NULL
            );
            INSERT INTO dict (ORIGIN_NAME, TRANS_NAME, MODID, KEY, VERSION, CURSEFORGE)
                VALUES ('Energy Cell', '能量单元', 'examplemod', 'item.example.energy_cell', '', '');
            INSERT INTO dict (ORIGIN_NAME, TRANS_NAME, MODID, KEY, VERSION, CURSEFORGE)
                VALUES (' ', '空原文', 'examplemod', 'item.example.blank_origin', '', '');
            INSERT INTO dict (ORIGIN_NAME, TRANS_NAME, MODID, KEY, VERSION, CURSEFORGE)
                VALUES ('Blank Translation', '', 'examplemod', 'item.example.blank_translation', '', '');",
        )
        .unwrap();

        assert_eq!(count_i18n_dict_entries(&db_path).unwrap(), 1);
    }

    #[test]
    fn count_bundled_i18n_dict_entries() {
        let db_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("i18n-dict")
            .join("Dict-Sqlite.db");

        assert!(count_i18n_dict_entries(&db_path).unwrap() > 800_000);
    }

    #[test]
    fn lfs_pointer_file_is_not_accepted_as_i18n_dict() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("Dict-Sqlite.db");
        std::fs::write(
            &db_path,
            "version https://git-lfs.github.com/spec/v1\n\
             oid sha256:4c995086a022da250f49553ab1252d517d8962e66d4158e0cff5cc50e41842ee\n\
             size 127168512\n",
        )
        .unwrap();

        let error = count_i18n_dict_entries(&db_path).unwrap_err();
        assert!(error.contains("file is not a database"));
    }
}

# 翻译 Pipeline 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 重构翻译模块，修复进度/取消问题，拆分 commands.rs，重写 pipeline 编排器，统一事件通道，引入前端 Context 状态管理。

**架构：** 4 阶段递进：① 数据模型 + pipeline 重写 → ② commands 目录拆分 → ③ 修复与清理 → ④ 前端 Context。每阶段编译通过后再继续。

**Tech Stack:** Rust + Tauri 2 + React + TypeScript

---

## 文件清单

### 创建

| 文件 | 职责 |
|------|------|
| `src-tauri/src/commands/mod.rs` | 命令模块根，声明子模块并重新导出所有函数 |
| `src-tauri/src/commands/scan.rs` | 扫描命令（scan_instance、cancel_scan、pick_instance_folder、validate_instance） |
| `src-tauri/src/commands/translate.rs` | 翻译命令（start_translation、cancel_translation） |
| `src-tauri/src/commands/pack.rs` | 打包命令（generate_translation_pack、generate_pack_from_job、copy_pack_to_instance） |
| `src-tauri/src/commands/validate.rs` | 校验命令（validate_translation） |
| `src-tauri/src/commands/jobs.rs` | 任务管理命令（clear_jobs_cache、get_translation_job、load_latest_translation_job） |
| `src-tauri/src/commands/settings.rs` | 设置命令（get_settings、save_settings） |
| `src-tauri/src/commands/llm.rs` | LLM 命令（fetch_llm_models、check_llm_connection） |
| `src-tauri/src/commands/dictionary.rs` | 词典命令（search/update/delete/export/import/stats） |
| `src-tauri/src/commands/game.rs` | 杂项命令（open_path） |
| `src/app/AppContext.tsx` | React Context + Provider + Reducer |

### 修改

| 文件 | 变更 |
|------|------|
| `src-tauri/src/core/models.rs` | 新增 PipelinePhase、PipelineProgress、PipelineConfig、PipelineResult |
| `src-tauri/src/core/pipeline.rs` | 完全重写：run_pipeline() 5 阶段编排器 |
| `src-tauri/src/lib.rs` | `pub mod commands` 自动指向 commands/mod.rs（目录结构变化） |
| `src-tauri/src/core/jobs.rs` | 删除 extract_pending_entries 重复代码 |
| `src-tauri/src/core/llm.rs` | 修复生产代码 .expect() → ? |
| `src/app/App.tsx` | 用 Context 替换 useState + props 透传 |
| `src/pages/JobsPage.tsx` | 简化为 useContext，新增 Scanning 阶段支持 |
| `src/pages/DashboardPage.tsx` | 简化为 useContext |
| `src/pages/PackagesPage.tsx` | 简化为 useContext |

### 删除

| 文件 |
|------|
| `src-tauri/src/commands.rs` |

---

## Phase 1: 数据模型 + Pipeline 重写

新增模型类型（不影响现有代码），重写 pipeline.rs。

### Task 1: 新增 Pipeline 数据模型

**Files:**
- Modify: `src-tauri/src/core/models.rs`

在 `StageStatus` enum 之后新增：

```rust
/// Pipeline 阶段标识
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum PipelinePhase {
    Scanning,
    Extracting,
    Dictionary,
    Translating,
    Completed,
}

/// Pipeline 统一进度事件（替代 TranslateProgress 用于内部传递）
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PipelineProgress {
    pub current: usize,
    pub total: usize,
    pub phase: PipelinePhase,
    pub mod_name: String,
    pub sub_step: Option<String>,
    pub stage_status: StageStatus,
}

impl PipelineProgress {
    pub fn phase_label(&self) -> String {
        match self.phase {
            PipelinePhase::Scanning => format!("正在扫描: {}", self.mod_name),
            PipelinePhase::Extracting => "正在提取待翻译条目...".into(),
            PipelinePhase::Dictionary => "正在词典匹配...".into(),
            PipelinePhase::Translating => {
                if let Some(ref step) = self.sub_step {
                    format!("正在翻译 ({})", step)
                } else {
                    "正在翻译...".into()
                }
            }
            PipelinePhase::Completed => "完成".into(),
        }
    }
}

/// LLM 配置（从 Settings 中提取）
#[derive(Clone, Debug)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub concurrency: usize,
    pub batch_size: usize,
    pub timeout_secs: u64,
    pub retry_count: u32,
    pub rate_limit_rpm: u32,
    pub prefer_user_dict: bool,
}

/// Pipeline 配置
#[derive(Clone, Debug)]
pub struct PipelineConfig {
    pub root: std::path::PathBuf,
    pub instance_path: String,
    pub source_language: String,
    pub target_language: String,
    pub scan_job_id: Option<String>,
    pub i18n_pack_name: Option<String>,
    pub vm_pack_name: Option<String>,
    pub llm: Option<LlmConfig>,
}

/// Pipeline 结果
#[derive(Clone, Debug, Serialize)]
pub struct PipelineResult {
    pub completed: usize,
    pub dict_count: usize,
    pub llm_count: usize,
    pub token_usage: TokenUsage,
    pub actual_source_language: String,
    pub job_id: String,
}
```

- [ ] **Step 1: 在 models.rs 添加 PipelinePhase enum 和相关结构体**

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译成功，无 warning

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/core/models.rs
git commit -m "feat(core): add PipelinePhase/PipelineConfig/PipelineResult models"
```

---

### Task 2: 重写 core/pipeline.rs — 新编排器

**Files:**
- Rewrite: `src-tauri/src/core/pipeline.rs`

```rust
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::sync::mpsc;
use std::collections::HashSet;
use std::path::PathBuf;
use crate::core::models::*;
use crate::core::{logging, paths, scanner, dictionary, jobs, llm as llm_client, shield};
use crate::core::llm::LlmClient;

static TRANSLATE_CANCEL: AtomicBool = AtomicBool::new(false);
static ACTIVE_TRANSLATE_TASK: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// 检查当前翻译任务是否被取消
pub fn is_translation_cancelled(job_id: &str) -> bool {
    if TRANSLATE_CANCEL.load(Ordering::SeqCst) {
        return true;
    }
    let task = ACTIVE_TRANSLATE_TASK.lock().unwrap_or_else(|e| e.into_inner());
    task.as_ref().map_or(true, |id| id != job_id)
}

/// 请求取消当前翻译
pub fn cancel_current_translation() {
    *ACTIVE_TRANSLATE_TASK.lock().unwrap_or_else(|e| e.into_inner()) = None;
    TRANSLATE_CANCEL.store(true, Ordering::SeqCst);
}

/// 注册新翻译任务（返回前一个 job_id 如果存在）
pub fn register_translation_task(job_id: &str) -> Option<String> {
    TRANSLATE_CANCEL.store(false, Ordering::SeqCst);
    let mut task = ACTIVE_TRANSLATE_TASK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = task.take();
    *task = Some(job_id.to_string());
    prev
}

/// 从 ScanSummary 提取待翻译条目
pub fn extract_pending_entries(summary: &ScanSummary) -> Vec<(&LanguageEntry, &str)> {
    let mut pending = Vec::new();
    for mod_result in &summary.mods {
        let source = &mod_result.resolved_source_language;
        let target = &mod_result.target_language;
        let target_keys: HashSet<&str> = mod_result
            .entries
            .iter()
            .filter(|e| e.language == *target)
            .map(|e| e.key.as_str())
            .collect();
        for entry in &mod_result.entries {
            if entry.language == *source && !target_keys.contains(entry.key.as_str()) {
                pending.push((entry, mod_result.file_name.as_str()));
            }
        }
    }
    pending
}

/// 运行完整翻译管线
pub fn run_pipeline(
    config: PipelineConfig,
    job_id: &str,
    progress_tx: mpsc::Sender<PipelineProgress>,
    log_tx: mpsc::Sender<TranslateLogEntry>,
) -> Result<PipelineResult, String> {
    use crate::core::paths;
    use std::time::Duration;

    if is_translation_cancelled(job_id) {
        return Ok(PipelineResult {
            completed: 0, dict_count: 0, llm_count: 0,
            token_usage: TokenUsage::default(),
            actual_source_language: config.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    // ── Phase 1: Acquire scan result ──────────────────────────
    let _ = progress_tx.send(PipelineProgress {
        current: 0, total: 1, phase: PipelinePhase::Scanning,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Running,
    });

    let scan_summary = resolve_scan(&config, job_id, &progress_tx)?;

    if scan_summary.cancelled || is_translation_cancelled(job_id) {
        logging::append_job(&config.root, job_id, "扫描被取消或翻译被取消").ok();
        return Ok(PipelineResult {
            completed: 0, dict_count: 0, llm_count: 0,
            token_usage: TokenUsage::default(),
            actual_source_language: config.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    // ── Phase 2: Extract pending entries ──────────────────────
    let _ = progress_tx.send(PipelineProgress {
        current: 0, total: 1, phase: PipelinePhase::Extracting,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Running,
    });

    let pending = extract_pending_entries(&scan_summary);
    let total = pending.len().max(1);

    let _ = progress_tx.send(PipelineProgress {
        current: 1, total: 1, phase: PipelinePhase::Extracting,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Completed,
    });

    if is_translation_cancelled(job_id) {
        return Ok(PipelineResult {
            completed: 0, dict_count: 0, llm_count: 0,
            token_usage: TokenUsage::default(),
            actual_source_language: scan_summary.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    // ── Phase 3: Dictionary matching ──────────────────────────
    let _ = progress_tx.send(PipelineProgress {
        current: 0, total: total, phase: PipelinePhase::Dictionary,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Running,
    });

    let prefer_user_dict = config.llm.as_ref().map(|c| c.prefer_user_dict).unwrap_or(false);
    let dict_conn = dictionary::open(&config.root);
    let mut completed = 0usize;
    let mut batch_results: Vec<TranslationResult> = Vec::new();
    let mut llm_only_entries: Vec<(&LanguageEntry, &str)> = Vec::new();

    for (entry, file_name) in &pending {
        if completed % 64 == 0 && is_translation_cancelled(job_id) {
            break;
        }
        if shield::is_placeholder_only(&entry.translation) {
            let result = TranslationResult {
                key: entry.key.clone(),
                source_text: entry.translation.clone(),
                target_text: entry.translation.clone(),
                mod_name: entry.mod_id.clone().unwrap_or_default(),
                file_name: file_name.to_string(),
                source_type: "skipped".into(),
            };
            batch_results.push(result);
            let _ = log_tx.send(TranslateLogEntry {
                key: entry.key.clone(),
                source_text: entry.translation.clone(),
                target_text: entry.translation.clone(),
                mod_name: entry.mod_id.clone().unwrap_or_default(),
                source_type: "skipped".into(),
            });
        } else if let Ok(Some(dict_entry)) = dictionary::search_by_hash(&dict_conn, &crate::core::dictionary::compute_hash(&entry.translation), &config.target_language) {
            if prefer_user_dict && dict_entry.source_type == "manual" || !prefer_user_dict {
                let result = TranslationResult {
                    key: entry.key.clone(),
                    source_text: entry.translation.clone(),
                    target_text: dict_entry.target_text,
                    mod_name: entry.mod_id.clone().unwrap_or_default(),
                    file_name: file_name.to_string(),
                    source_type: "dictionary".into(),
                };
                let _ = log_tx.send(TranslateLogEntry {
                    key: entry.key.clone(),
                    source_text: entry.translation.clone(),
                    target_text: result.target_text.clone(),
                    mod_name: entry.mod_id.clone().unwrap_or_default(),
                    source_type: "dictionary".into(),
                });
                batch_results.push(result);
            } else {
                llm_only_entries.push((entry, file_name));
            }
        } else {
            llm_only_entries.push((entry, file_name));
        }
        completed += 1;
        if completed % 64 == 0 {
            let _ = progress_tx.send(PipelineProgress {
                current: completed, total, phase: PipelinePhase::Dictionary,
                mod_name: String::new(), sub_step: None,
                stage_status: StageStatus::Running,
            });
        }
    }

    let dict_count = completed - llm_only_entries.len();

    let _ = progress_tx.send(PipelineProgress {
        current: completed, total, phase: PipelinePhase::Dictionary,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Completed,
    });

    // Flush dictionary results to disk
    if !batch_results.is_empty() {
        let _ = jobs::batch_append_results(&config.root, job_id, &batch_results);
    }

    if is_translation_cancelled(job_id) {
        return Ok(PipelineResult {
            completed, dict_count, llm_count: 0,
            token_usage: TokenUsage::default(),
            actual_source_language: scan_summary.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    // ── Phase 4: LLM Translation ──────────────────────────────
    let mut accumulated_token_usage = TokenUsage::default();
    let mut llm_count = 0usize;

    if !llm_only_entries.is_empty() {
        let llm_cfg = config.llm.as_ref().ok_or("LLM 未配置，但有待翻译条目需要 LLM 翻译".to_string())?;
        let effective_batch_size = llm_cfg.batch_size.min(llm_only_entries.len());
        let total_llm_batches = llm_only_entries.len().div_ceil(effective_batch_size);
        let wave_size = llm_cfg.concurrency.min(total_llm_batches);
        let inter_batch_delay_ms = if llm_cfg.rate_limit_rpm > 0 && wave_size > 0 {
            (60000.0 / (llm_cfg.rate_limit_rpm as f64 / wave_size as f64)).max(0.0) as u64
        } else { 0 };

        let client = LlmClient::new(
            &llm_cfg.base_url, &llm_cfg.api_key, &llm_cfg.model,
            llm_cfg.temperature, llm_cfg.max_tokens as u16,
            llm_cfg.timeout_secs, llm_cfg.retry_count,
        )?;

        let _ = progress_tx.send(PipelineProgress {
            current: 0, total: total_llm_batches,
            phase: PipelinePhase::Translating,
            mod_name: String::new(),
            sub_step: Some("0/0 批次".into()),
            stage_status: StageStatus::Running,
        });

        for wave_start in (0..total_llm_batches).step_by(wave_size) {
            if is_translation_cancelled(job_id) { break; }
            let wave_end = (wave_start + wave_size).min(total_llm_batches);

            let wave_batches: Vec<Vec<(&LanguageEntry, &str)>> = (wave_start..wave_end)
                .map(|bi| {
                    let start = bi * effective_batch_size;
                    let end = (start + effective_batch_size).min(llm_only_entries.len());
                    llm_only_entries[start..end].to_vec()
                })
                .collect();

            let wave_results: Vec<Vec<TranslationResult>> = std::thread::scope(|s| {
                wave_batches.iter().map(|batch| {
                    s.spawn(|| {
                        client.translate_batch(
                            batch, &config.source_language, &config.target_language,
                            &scan_summary.source_language,
                        )
                    })
                }).collect::<Vec<_>>().into_iter()
                .filter_map(|h| h.join().ok())
                .collect()
            });

            for (batch_result, token_usage) in &wave_results {
                for entry in batch_result {
                    if entry.source_type == "llm" {
                        llm_count += 1;
                    }
                    accumulated_token_usage.prompt_tokens += token_usage.prompt_tokens;
                    accumulated_token_usage.completion_tokens += token_usage.completion_tokens;
                    accumulated_token_usage.total_tokens += token_usage.total_tokens;
                    let _ = log_tx.send(TranslateLogEntry {
                        key: entry.key.clone(),
                        source_text: entry.source_text.clone(),
                        target_text: entry.target_text.clone(),
                        mod_name: entry.mod_name.clone(),
                        source_type: entry.source_type.clone(),
                    });
                    batch_results.push(entry.clone());
                }
            }

            completed += llm_count;
            let _ = progress_tx.send(PipelineProgress {
                current: wave_end.min(total_llm_batches), total: total_llm_batches,
                phase: PipelinePhase::Translating,
                mod_name: String::new(),
                sub_step: Some(format!("{}/{} 批次", wave_end.min(total_llm_batches), total_llm_batches)),
                stage_status: StageStatus::Running,
            });

            let _ = jobs::batch_append_results(&config.root, job_id, &batch_results);
            batch_results.clear();

            let next_wave_start = wave_start + wave_size;
            if next_wave_start < total_llm_batches && inter_batch_delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(inter_batch_delay_ms));
            }
        }
    }

    // ── Phase 5: Finalize ──────────────────────────────────────
    if is_translation_cancelled(job_id) {
        if !batch_results.is_empty() {
            let _ = jobs::batch_append_results(&config.root, job_id, &batch_results);
        }
        return Ok(PipelineResult {
            completed, dict_count, llm_count,
            token_usage: accumulated_token_usage,
            actual_source_language: scan_summary.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    if accumulated_token_usage.total_tokens > 0 {
        let _ = logging::append_job(&config.root, job_id, format!(
            "LLM Token 使用: prompt={}, completion={}, total={}",
            accumulated_token_usage.prompt_tokens,
            accumulated_token_usage.completion_tokens,
            accumulated_token_usage.total_tokens,
        ));
    }

    let _ = progress_tx.send(PipelineProgress {
        current: completed, total,
        phase: PipelinePhase::Completed,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Completed,
    });

    let _ = logging::append_job(&config.root, job_id, format!(
        "翻译完成: {completed}/{total} 条目 (词典: {dict_count}, LLM: {llm_count})"
    ));

    Ok(PipelineResult {
        completed, dict_count, llm_count,
        token_usage: accumulated_token_usage,
        actual_source_language: scan_summary.source_language.clone(),
        job_id: job_id.to_string(),
    })
}

/// 解析扫描结果：加载缓存或运行扫描
fn resolve_scan(
    config: &PipelineConfig,
    job_id: &str,
    progress_tx: &mpsc::Sender<PipelineProgress>,
) -> Result<ScanSummary, String> {
    // 尝试从文件加载
    if let Some(ref sid) = config.scan_job_id {
        if !sid.is_empty() {
            let scan_path = paths::job_state_path(&config.root, sid);
            if let Ok(content) = std::fs::read_to_string(&scan_path) {
                if let Ok(summary) = serde_json::from_str::<ScanSummary>(&content) {
                    if summary.source_language == config.source_language
                        && summary.target_language == config.target_language
                    {
                        let _ = logging::append_main(&config.root, format!("从缓存加载扫描结果 (任务 {sid})"));
                        return Ok(summary);
                    }
                    let _ = logging::append_main(&config.root, format!(
                        "缓存扫描语言不匹配 (缓存: {}→{}, 当前: {}→{}), 重新扫描",
                        summary.source_language, summary.target_language,
                        config.source_language, config.target_language,
                    ));
                }
            }
        }
    }

    // 运行新扫描，进度中继到 translate-progress
    let relay = |scan_progress: ScanProgress| {
        let _ = progress_tx.send(PipelineProgress {
            current: scan_progress.current,
            total: scan_progress.total,
            phase: PipelinePhase::Scanning,
            mod_name: scan_progress.mod_name.clone().unwrap_or_default(),
            sub_step: None,
            stage_status: StageStatus::Running,
        });
    };

    let summary = scanner::scan_instance(
        &config.root,
        &config.instance_path,
        &config.source_language,
        &config.target_language,
        config.i18n_pack_name.clone().unwrap_or_default(),
        config.vm_pack_name.clone().unwrap_or_default(),
        &TRANSLATE_CANCEL,
        &relay,
    ).map_err(|e| format!("扫描失败: {e}"))?;

    // 持久化扫描结果
    if !summary.cancelled {
        if let Ok(json) = serde_json::to_string_pretty(&summary) {
            let job_path = paths::job_state_path(&config.root, &summary.job_id);
            if let Some(parent) = job_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(err) = std::fs::write(&job_path, &json) {
                let _ = logging::append_main(&config.root, format!("扫描结果写入失败 ({}): {err}", job_path.display()));
            }
        }
    }

    Ok(summary)
}
```

- [ ] **Step 1: 用上述代码重写 `src-tauri/src/core/pipeline.rs`**

注意：当前 `LlmClient::translate_batch()` 签名需要确认。如果签名是 `(&self, batch: &[(&LanguageEntry, &str)], source, target, scan_source)` 则保留，否则在实现时调整。

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译成功（新代码尚未被调用，可能有 unused warnings 是正常的）

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/core/pipeline.rs
git commit -m "feat(core): rewrite pipeline.rs with run_pipeline orchestrator + extract_pending_entries"
```

---

### Task 3: 更新 jobs.rs — 删除重复的 extract_pending_entries

**Files:**
- Modify: `src-tauri/src/core/jobs.rs`

- [ ] **Step 1: 在 jobs.rs 中删除 `extract_pending_entries` 函数（约 lines 332-356），添加注释引用 pipeline 中的唯一实现**

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/core/jobs.rs
git commit -m "refactor(core): remove duplicate extract_pending_entries from jobs.rs (now in pipeline.rs)"
```

---

## Phase 2: commands/ 目录拆分

### Task 4: 创建 commands/mod.rs — 模块根

**Files:**
- Create: `src-tauri/src/commands/mod.rs`

```rust
pub mod scan;
pub mod translate;
pub mod pack;
pub mod validate;
pub mod jobs;
pub mod settings;
pub mod llm;
pub mod dictionary;
pub mod game;

pub use scan::*;
pub use translate::*;
pub use pack::*;
pub use validate::*;
pub use jobs::*;
pub use settings::*;
pub use llm::*;
pub use dictionary::*;
pub use game::*;
```

- [ ] **Step 1: 创建 `src-tauri/src/commands/` 目录和 `mod.rs` 文件**

- [ ] **Step 2: 验证目录结构**

Run: `ls src-tauri/src/commands/`
Expected: 显示 `mod.rs`

- [ ] **Step 3: 暂不提交（等所有子模块文件创建完）**

---

### Task 5: 创建 scan.rs — 扫描命令

**Files:**
- Create: `src-tauri/src/commands/scan.rs`

```rust
use tauri::AppHandle;
use crate::core::{self, models::*, paths, scanner, logging, settings};

#[tauri::command]
pub fn validate_instance(path: String) -> Result<InstanceValidation, String> {
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    scanner::validate_instance(&root, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_instance(
    app: AppHandle,
    path: String,
    source_language: String,
    target_language: String,
) -> Result<ScanSummary, String> {
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let i18n_pack_name = settings::load_settings(&root)
        .ok()
        .and_then(|s| Some(s.i18n_pack_name))
        .unwrap_or_default();
    let vm_pack_name = settings::load_settings(&root)
        .ok()
        .and_then(|s| Some(s.vm_pack_name))
        .unwrap_or_default();

    // 进度事件中继
    let (tx, rx) = std::sync::mpsc::channel::<ScanProgress>();
    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = rx.recv() {
            let _ = app_emit.emit("scan-progress", &progress);
        }
    });

    let summary = scanner::scan_instance(
        &root, &path, &source_language, &target_language,
        i18n_pack_name, vm_pack_name,
        &scanner::SCAN_CANCEL,
        &|p| { let _ = tx.send(p); },
    ).map_err(|e| e.to_string())?;

    // 持久化
    if !summary.cancelled {
        if let Ok(json) = serde_json::to_string_pretty(&summary) {
            let job_path = paths::job_state_path(&root, &summary.job_id);
            if let Some(parent) = job_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&job_path, &json);
        }
    }

    Ok(summary)
}

#[tauri::command]
pub fn cancel_scan() -> Result<(), String> {
    scanner::SCAN_CANCEL.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn pick_instance_folder() -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = crate::get_active_window().await
        .dialog()
        .file()
        .pick_folder();
    Ok(file.map(|p| p.to_string()))
}
```

注意：`pick_instance_folder` 使用了 `get_active_window()` — 需要确认该函数是否存在。如果不存在，改为使用 `tauri_plugin_dialog` 的 `MessageDialogBuilder` 或其他方式。

- [ ] **Step 1: 创建 `src-tauri/src/commands/scan.rs`**（上述代码，根据实际编译错误调整）

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译成功或仅有可修复错误

- [ ] **Step 3: 暂不提交**

---

### Task 6: 创建 translate.rs — 翻译命令

**Files:**
- Create: `src-tauri/src/commands/translate.rs`

```rust
use std::sync::{Arc, atomic::AtomicBool};
use std::sync::mpsc;
use tauri::AppHandle;
use crate::core::{self, models::*, paths, logging, settings};
use crate::core::pipeline::{self, PipelineConfig, PipelineResult, PipelineProgress};

#[tauri::command]
pub async fn start_translation(
    app: AppHandle,
    path: String,
    source_language: String,
    target_language: String,
    total_entries: Option<usize>,
    scan_job_id: Option<String>,
) -> Result<usize, String> {
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let job_id = logging::new_job_id("translate");

    // 注册任务（先注册、再清取消 — 顺序防止竞态）
    let prev = pipeline::register_translation_task(&job_id);

    logging::append_main(&root, format!("翻译任务创建成功，任务 ID: {job_id}"))
        .map_err(|e| e.to_string())?;

    // 通道：进度事件 + 日志条目
    let (progress_tx, progress_rx) = mpsc::channel::<PipelineProgress>();
    let (log_tx, log_rx) = mpsc::channel::<TranslateLogEntry>();

    let progress_tx_work = progress_tx.clone();
    let log_tx_work = log_tx.clone();

    // 进度读取线程
    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = progress_rx.recv() {
            let _ = app_emit.emit("translate-progress", &progress);
        }
    });

    // 日志读取线程
    let app_emit_log = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(entry) = log_rx.recv() {
            let _ = app_emit_log.emit("translate-log-entry", &entry);
        }
    });

    // 读取设置
    let settings_data = settings::load_settings(&root).ok();
    let (i18n_pack_name, vm_pack_name) = settings_data
        .as_ref()
        .map(|s| (s.i18n_pack_name.clone(), s.vm_pack_name.clone()))
        .unwrap_or_default();

    let llm_config = settings_data.map(|s| crate::core::models::LlmConfig {
        base_url: s.base_url,
        api_key: s.api_key,
        model: s.model,
        temperature: s.temperature,
        max_tokens: s.max_tokens,
        concurrency: s.concurrency,
        batch_size: s.batch_size,
        timeout_secs: s.timeout_secs,
        retry_count: s.retry_count,
        rate_limit_rpm: s.rate_limit_rpm,
        prefer_user_dict: s.prefer_user_dict,
    });

    // 构建 PipelineConfig
    let config = PipelineConfig {
        root: root.clone(),
        instance_path: path,
        source_language,
        target_language,
        scan_job_id,
        i18n_pack_name: Some(i18n_pack_name),
        vm_pack_name: Some(vm_pack_name),
        llm: llm_config,
    };

    // 运行管线
    let config_clone = config; // move
    let result = tauri::async_runtime::spawn_blocking(move || {
        pipeline::run_pipeline(config_clone, &job_id, progress_tx_work, log_tx_work)
    }).await.map_err(|e| e.to_string())??;

    // 关闭通道 → 读取线程自然退出
    drop(progress_tx);
    drop(log_tx);

    logging::append_main(&root, format!("翻译任务完成: {}/{} 条目", result.completed, total_entries.unwrap_or(0)))
        .ok();

    Ok(result.completed)
}

#[tauri::command]
pub fn cancel_translation() -> Result<(), String> {
    pipeline::cancel_current_translation();
    logging::append_main(&paths::runtime_root().map_err(|e| e.to_string())?, "翻译任务被用户取消").ok();
    Ok(())
}
```

- [ ] **Step 1: 创建 `src-tauri/src/commands/translate.rs`**（上述代码）

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译成功或仅有可修复错误

- [ ] **Step 3: 暂不提交**

---

### Task 7: 创建 pack/validate/jobs/settings/llm/dictionary/game 命令文件

**Files:**
- Create: `src-tauri/src/commands/pack.rs`
- Create: `src-tauri/src/commands/validate.rs`
- Create: `src-tauri/src/commands/jobs.rs`
- Create: `src-tauri/src/commands/settings.rs`
- Create: `src-tauri/src/commands/llm.rs`
- Create: `src-tauri/src/commands/dictionary.rs`
- Create: `src-tauri/src/commands/game.rs`

**策略：** 从原 `commands.rs` 逐函数复制到对应文件，每个函数前加 `#[tauri::command]`，import 调整为 `crate::core::*`。

关键命令清单：

**pack.rs:**
- `generate_translation_pack(data: Vec<PackEntry>, target_language: String, dry_run: bool)`
- `copy_pack_to_instance(pack_name: String)`
- `generate_pack_from_job(job_id: String, target_language: String, dry_run: bool)`

**validate.rs:**
- `validate_translation(job_id: String)`

**jobs.rs:**
- `clear_jobs_cache()`
- `get_translation_job(job_id: String)`
- `load_latest_translation_job()`

**settings.rs:**
- `get_settings()`
- `save_settings(settings: Settings)`

**llm.rs:**
- `fetch_llm_models()`
- `check_llm_connection(base_url: String, api_key: String, model: String)`

**dictionary.rs:**
- `search_dictionary(query: String, target_language: String)`
- `update_dictionary_entry(entry: DictionaryEntry)`
- `delete_dictionary_entry(id: String)`
- `export_dictionary(target_language: String)`
- `import_dictionary(target_language: String)`
- `get_dictionary_stats()`

**game.rs:**
- `open_path(path: String)`

- [ ] **Step 1: 创建 pack.rs**— 从原 commands.rs 复制打包相关函数

- [ ] **Step 2: 创建 validate.rs**— 复制校验函数

- [ ] **Step 3: 创建 jobs.rs**— 复制任务管理函数

- [ ] **Step 4: 创建 settings.rs**— 复制设置函数

- [ ] **Step 5: 创建 llm.rs**— 复制 LLM 函数

- [ ] **Step 6: 创建 dictionary.rs**— 复制词典函数

- [ ] **Step 7: 创建 game.rs**— 复制杂项函数

- [ ] **Step 8: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译成功

- [ ] **Step 9: 删除旧的 commands.rs**

```bash
rm src-tauri/src/commands.rs
```

- [ ] **Step 10: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译成功

- [ ] **Step 11: 全量编译+测试**

Run: `cd src-tauri && cargo build && cargo test`
Expected: 编译成功，测试通过

- [ ] **Step 12: Commit**

```bash
git add src-tauri/src/commands/
git rm src-tauri/src/commands.rs
git add src-tauri/src/core/
git commit -m "refactor(commands): split commands.rs into commands/ directory, rewrite pipeline.rs"
```

---

## Phase 3: 修复与清理

### Task 8: 事件读取线程添加取消检查 + 通道关闭修复

**Files:**
- Modify: `src-tauri/src/commands/translate.rs`

```rust
// 把 translate.rs 中的两个读取线程改为：
let cancel_token = Arc::new(AtomicBool::new(false));
let tok = cancel_token.clone();
let _progress_reader = tauri::async_runtime::spawn_blocking(move || {
    while let Ok(progress) = progress_rx.recv() {
        if pipeline::is_translation_cancelled(&job_id) {
            break;  // 取消检查
        }
        let _ = app_emit.emit("translate-progress", &progress);
    }
});
```

同时确保 `cancel_translation` 设置后，`run_pipeline` 尽快返回 → `drop(progress_tx)` → 读取线程 `recv()` 失败 → 退出。

- [ ] **Step 1: 在 translate.rs 的读取线程中添加取消检查**

- [ ] **Step 2: 验证编译** `cd src-tauri && cargo check`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/translate.rs
git commit -m "fix: add cancel check to progress/log reader threads"
```

---

### Task 9: 替换 eprintln! 为正式日志

**Files:**
- Modify: `src-tauri/src/commands/` 下所有文件

搜索所有 `eprintln!` 调用（原始 commands.rs 中有 7 处），替换为：
- 有 root 可用的地方 → `logging::append_main(&root, msg)`
- 无 root 的地方 → 通过返回值传播错误

- [ ] **Step 1: 扫描所有 commands/ 子文件中的 eprintln! 并替换**

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 无 eprintln! warning

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/
git commit -m "fix: replace eprintln! with structured logging"
```

---

### Task 10: 修复 llm.rs 生产代码 .expect()

**Files:**
- Modify: `src-tauri/src/core/llm.rs`

```rust
// 修改 llm.rs 中类似这样的行（约 line 103）：
// 原来: .expect("LLM HTTP client 创建失败");
// 改为: .map_err(|e| format!("LLM HTTP client 创建失败: {e}"))?;
```

具体位置：在 `LlmClient::new()` 方法中 `Client::builder().build()` 处。

- [ ] **Step 1: 查找 `src-tauri/src/core/llm.rs` 中所有的 `.expect(` 并替换为 `.map_err(...)?`**

只改非测试代码（`#[cfg(test)]` 中的 expect 可以保留）。

- [ ] **Step 2: 验证编译+测试**

Run: `cd src-tauri && cargo build && cargo test`
Expected: 编译成功，测试通过

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/core/llm.rs
git commit -m "fix(llm): replace .expect() with Result propagation"
```

---

### Task 11: 集成 — 全量构建验证

- [ ] **Step 1: Rust 全量构建**

Run: `cd src-tauri && cargo build`
Expected: 编译成功

- [ ] **Step 2: Rust 测试**

Run: `cd src-tauri && cargo test`
Expected: 全部通过

- [ ] **Step 3: 前端构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 前端单元测试**

Run: `npm run test:unit`
Expected: 全部通过

---

## Phase 4: 前端 Context 重构

### Task 12: 创建 AppContext.tsx

**Files:**
- Create: `src/app/AppContext.tsx`

```typescript
import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react";
import type { PageNavStatus, ScanSummary, Settings } from "../types";

type PageKey =
  | "dashboard" | "jobs" | "validate" | "dictionary"
  | "packages" | "ftb" | "hardcoded" | "settings" | "logs";

interface AppState {
  settings: Settings | null;
  scanSummary: ScanSummary | null;
  navStates: Partial<Record<PageKey, PageNavStatus>>;
}

type AppAction =
  | { type: "SET_SETTINGS"; payload: Settings }
  | { type: "SET_SCAN_SUMMARY"; payload: ScanSummary }
  | { type: "SET_NAV_STATE"; payload: { key: PageKey; status: PageNavStatus } };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SETTINGS":
      return { ...state, settings: action.payload };
    case "SET_SCAN_SUMMARY":
      return { ...state, scanSummary: action.payload };
    case "SET_NAV_STATE": {
      const { key, status } = action.payload;
      if (state.navStates[key] === status) return state;
      if (status === "idle" && state.navStates[key] === "completed") return state;
      return { ...state, navStates: { ...state.navStates, [key]: status } };
    }
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, {
    settings: null,
    scanSummary: null,
    navStates: {},
  });
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}
```

- [ ] **Step 1: 创建 `src/app/AppContext.tsx`**（上述代码）

- [ ] **Step 2: 验证编译**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/app/AppContext.tsx
git commit -m "feat(frontend): add AppContext with reducer for global state"
```

---

### Task 13: 更新 App.tsx — 使用 Context

**Files:**
- Modify: `src/app/App.tsx`

将 `useState<Settings>`、`useState<ScanSummary>`、`useState<PageNavStates>` 以及相关的 `setNav` 回调替换为 `useAppState()`：

```typescript
import { AppProvider, useAppState } from "./AppContext";

// App 内部组件
function AppShell() {
  const { state, dispatch } = useAppState();
  const { settings, scanSummary, navStates } = state;
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!settings) {
      getSettings()
        .then((s) => dispatch({ type: "SET_SETTINGS", payload: s }))
        .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    }
  }, [settings, dispatch]);

  // renderPage 中用 dispatch({type: "SET_SCAN_SUMMARY", payload: ...}) 替换 onScanSummaryChange
  // ...
}
```

注意：App.tsx 原本的 `renderPage` 中传递的 props（如 `onBusyChange`、`onCompleteChange`）需要改为通过 Context 的 `dispatch` 更新 navStates。

- [ ] **Step 1: 在 App.tsx 外层包装 `<AppProvider>`**

- [ ] **Step 2: 将内部逻辑改为 useAppState，移除所有 onBusyChange/onCompleteChange props 传递**

- [ ] **Step 3: 验证编译**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "refactor(frontend): App.tsx uses AppContext instead of local state + props drilling"
```

---

### Task 14: 更新 JobsPage.tsx — 使用 Context + 新增 Scanning 支持

**Files:**
- Modify: `src/pages/JobsPage.tsx`

**变更内容：**
1. Props 接口简化为只保留 `language`（`scanSummary`、`settings`、`onBusyChange`、`onCompleteChange` 从 Context 读取）
2. 改用 `useAppState()` 读取共享状态
3. 翻译进度显示增加 `Scanning` 阶段支持

```typescript
// 新的 Props 接口
interface JobsPageProps {
  language: AppLanguage;
}

// 组件内部
import { useAppState } from "../app/AppContext";

export function JobsPage({ language }: JobsPageProps) {
  const { state, dispatch } = useAppState();
  const { scanSummary, settings } = state;

  // ... 其余逻辑保持不变 ...

  // handleStart 结尾用 dispatch 更新 scanSummary
  // 原来的 onScanSummaryChange(newSummary)
  // 改为 dispatch({ type: "SET_SCAN_SUMMARY", payload: newSummary })
}
```

进度显示增加 Scanning 阶段：

```typescript
const progressPercent =
  translateProgress && translateProgress.total > 0
    ? Math.round((translateProgress.current / translateProgress.total) * 100)
    : 0;

const phaseLabel = translateProgress?.phase === "Scanning"
  ? `正在扫描: ${translateProgress.mod_name}`
  : translateProgress?.phase === "Extracting"
  ? "正在提取待翻译条目..."
  : translateProgress?.phase === "Dictionary"
  ? "正在词典匹配..."
  : translateProgress?.phase === "Translating"
  ? `正在翻译 (${translateProgress.sub_step || ""})`
  : "";
```

- [ ] **Step 1: 简化 JobsPage 的 Props 接口，移除外来状态**

- [ ] **Step 2: 加入 useAppState 读取 scanSummary/settings**

- [ ] **Step 3: 将 onScanSummaryChange 调用改为 dispatch**

- [ ] **Step 4: 将 onBusyChange/onCompleteChange 调用改为 dispatch({type: "SET_NAV_STATE", ...})**

- [ ] **Step 5: 增加 Scanning/Extracting 阶段在进度条上的显示**

- [ ] **Step 6: 验证编译**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 7: Commit**

```bash
git add src/pages/JobsPage.tsx
git commit -m "refactor(frontend): JobsPage uses AppContext, adds Scanning phase support"
```

---

### Task 15: 更新 DashboardPage.tsx + PackagesPage.tsx

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/PackagesPage.tsx`

- [ ] **Step 1: DashboardPage — 改用 useAppState() 读取/更新 scanSummary，移除 props 中的 scanSummary/onScanSummaryChange/onBusyChange/onCompleteChange**

- [ ] **Step 2: 验证编译**

Run: `npm run build`

- [ ] **Step 3: PackagesPage — 改用 useAppState() 读取 scanSummary/settings，移除 props 透传**

- [ ] **Step 4: 验证编译**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/PackagesPage.tsx
git commit -m "refactor(frontend): DashboardPage and PackagesPage use AppContext"
```

---

## Phase 5: 最终验证

### Task 16: 全量构建 + 测试

- [ ] **Step 1: Rust 全量构建**

Run: `cd src-tauri && cargo build`
Expected: 0 errors, 0 warnings

- [ ] **Step 2: Rust 测试**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 3: 前端构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 前端单元测试**

Run: `npm run test:unit`
Expected: all pass

- [ ] **Step 5: 列出最终 git diff**

Run: `git diff --stat`
Expected: 清晰显示所有变更文件

- [ ] **Step 6: 最终提交**

```bash
git add -A
git commit -m "refactor: complete translation pipeline refactor

- Split commands.rs into commands/ directory (9 modules)
- Rewrote pipeline.rs with run_pipeline orchestrator (5 phases)
- Added PipelinePhase/PipelineConfig/PipelineResult models
- Fixed progress stuck at 0 during re-scan (scan progress relay)
- Fixed cancel not stopping progress/log threads
- Replaced eprintln! with structured logging
- Replaced .expect() with Result propagation
- Added React Context + useReducer for frontend state
- JobsPage supports Scanning/Extracting phase display
- Removed duplicate extract_pending_entries logic"
```

---

## 自检

**Spec 覆盖检查：**

| Spec 章节 | 对应 Task |
|-----------|-----------|
| 2. 后端模块拆分 | Task 4-7 |
| 3. Pipeline 层重构 | Task 2 |
| 3.3 扫描进度中继 | Task 2 (resolve_scan) |
| 4. 事件通道与取消机制 | Task 2 (cancel_current_translation) + Task 8 |
| 5. 统一数据模型 | Task 1 |
| 6. 重复代码清理 | Task 3 |
| 7. 日志 & 错误处理 | Task 9 + 10 |
| 8. 前端状态管理 | Task 12-15 |

**类型一致性检查：**
- `PipelinePhase` enum 在 models.rs 定义，在 pipeline.rs 使用，在 translate.rs 作为事件发出，在前端解析 — 所有路径一致
- `PipelineConfig` 在 models.rs 定义，在 pipeline.rs 作为参数 — 一致
- `PipelineResult` 在 models.rs 定义，在 pipeline.rs 作为返回值 — 一致
- `cancel_current_translation()` 在 pipeline.rs 定义，在 translate.rs 调用 — 一致

**占位符检查：** 无 TBD/TODO/占位符

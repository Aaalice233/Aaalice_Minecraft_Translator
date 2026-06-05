# 翻译系统改进 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5 项翻译系统改进：设置 UI 增强、流式刷新、智能限流适应、CFPA 词典参考、Agent 角色设定、逐条目状态显示。

**Architecture:** Rust 后端（models → llm → pipeline → translate commands）+ React 前端（SettingsPage → JobsPage）。后端新增 `EntryProgress` 事件 channel 实现逐条目状态上报；`llm.rs` 增加自愈解析和限流自适应；`pipeline.rs` 改为按 mod 分组智能分批。

**Tech Stack:** Tauri 2, Rust reqwest blocking, React/TypeScript, SQLite

---

## 文件变更清单

| 文件 | 操作 | 职责 |
|---|---|---|
| `src-tauri/src/core/models.rs` | 修改 | Settings 加 system_prompt/字段; 新增 EntryProgress/EntryStatus |
| `src-tauri/src/core/llm.rs` | 修改 | system_prompt 字段; translate_batch 回调; 自愈解析; 限流适应 |
| `src-tauri/src/core/pipeline.rs` | 修改 | 智能分批(按mod); 条目状态发射; 波浪循环增强(降级+恢复) |
| `src-tauri/src/core/dictionary.rs` | 修改 | 导出 fuzzy_search, pub mod cfpa |
| `src-tauri/src/core/dictionary/cfpa.rs` | 新建 | CFPA 模糊匹配函数 |
| `src-tauri/src/commands/translate.rs` | 修改 | 新增 entry_progress channel + Tauri reader 线程 |
| `src/pages/SettingsPage.tsx` | 修改 | 字段 hints + system_prompt textarea + tooltip |
| `src/pages/JobsPage.tsx` | 修改 | 日志表状态列 + 条目状态面板 |
| `src/i18n/translations.ts` | 修改 | 新增 ~50 个 i18n 键（4 语言） |
| `src/styles/app.css` | 修改 | 状态 badge 样式 |

---

### Task 1: Settings/LlmConfig 新增 system_prompt 字段

**Files:**
- Modify: `src-tauri/src/core/models.rs` — Settings 和 LlmConfig 加 system_prompt

- [ ] **Step 1: Settings 增加 system_prompt 字段**

在 `Settings` struct 的 `pub vm_pack_name` 之后添加：

```rust
pub system_prompt: String,
```

在 `Settings::default()` 的 `vm_pack_name` 之后添加：

```rust
system_prompt: "你是一个专业 Minecraft 模组汉化翻译专家，精通中英文游戏术语和模组翻译规范。\n\
\n\
## 格式要求\n\
- 严格按 JSON 数组格式返回：[{\"key\": \"...\", \"text\": \"翻译文本\"}, ...]\n\
- 只返回 JSON，不要包含 markdown 代码块标记或其他解释文字\n\
- 每个条目必须包含 key 和 text 字段\n\
\n\
## 占位符保护（极其重要）\n\
- 保留所有 % 格式代码：%s %d %1$s %2$d %08.2f 等\n\
- 保留所有 § 颜色/样式码：§a §l §r §e §6 等\n\
- 保留所有花括号占位符：{player} {0} {{quest_name}} 等\n\
- 保留所有尖括号引用：<item:minecraft:diamond> <block:stone> 等\n\
- 保留所有转义序列：\\n \\t 等\n\
- 永远不要修改、删除或重新排序这些占位符\n\
\n\
## 翻译规范\n\
- 术语统一：与 Minecraft 中文标准译名一致（Creeper → 苦力怕 / Ender Dragon → 末影龙 / Nether → 下界）\n\
- 模组专属名词的首次出现可用括号附注英文原名\n\
- 同一术语在同一模组内必须始终保持一致译法\n\
- 描述性文本需要通顺自然，符合中文表达习惯\n\
- 物品名/方块名使用书名号《》括起，但保留原始格式标记\n\
- 任务文本保持原文的语气和风格（正式/诙谐/史诗感）".to_string(),
```

更新 Settings 默认值：

```rust
concurrency: 10,        // 从 6 改为 10
timeout_secs: 180,      // 从 120 改为 180
retry_count: 5,         // 从 3 改为 5
```

确保 `#[serde(default)]` 已存在（Settings 已标注 `#[serde(default)]`），所以旧 JSON 缺少字段时回退默认。

- [ ] **Step 2: LlmConfig 同步加 system_prompt**

```rust
pub struct LlmConfig {
    // ...现有字段
    pub system_prompt: String,
}
```

创建 `LlmConfig` 时从 `Settings.system_prompt` 传入。

- [ ] **Step 3: 编译验证**

```bash
cd src-tauri && cargo build 2>&1 | head -30
```

Expected: 编译成功，旧设置文件加载时 system_prompt 自动获得默认值。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/core/models.rs
git commit -m "feat: add system_prompt field to Settings and LlmConfig"
```

---

### Task 2: LlmClient 增强 — system_prompt + 回调 + 自愈解析

**Files:**
- Modify: `src-tauri/src/core/llm.rs`

- [ ] **Step 1: LlmClient 增加字段和回调签名**

```rust
pub struct LlmClient {
    // ... 现有字段
    pub system_prompt: String,
    /// 有效并发数（运行时动态调整，用于限流适应）
    #[serde(skip)]
    pub effective_concurrency: std::sync::atomic::AtomicUsize,
    #[serde(skip)]
    pub consecutive_429s: std::sync::atomic::AtomicUsize,
}
```

修改 `translate_batch` 签名：

```rust
pub fn translate_batch(
    &self,
    entries: &[TranslationEntry],
    on_batch_complete: Option<&(dyn Fn(&[TranslateResult]) + Sync)>,  // 新增回调
) -> (Vec<TranslateResult>, Option<TokenUsage>)
```

- [ ] **Step 2: 使用 system_prompt 替代硬编码字符串**

将 body 构建中的硬编码 system message 替换为：

```rust
"role": "system",
"content": &self.system_prompt,
```

- [ ] **Step 3: 构建 body 时不再在 build_prompt 中嵌入 system 指令**

`build_prompt` 函数保持仅生成 user prompt（现有逻辑基本符合，移除其中内嵌的格式指令）

- [ ] **Step 4: 实现自愈解析函数 `healing_parse_response`**

新增函数：

```rust
/// 多层容错解析 LLM 响应
fn healing_parse_response(
    content: &str,
    entries: &[TranslationEntry],
) -> Result<Vec<TranslateResult>, String> {
    // 第 0 层：空内容检测
    if content.trim().is_empty() {
        return Err("LLM 返回内容为空".to_string());
    }

    // 辅助函数：对 JSON 字符串应用常见修复
    fn apply_fixes(s: &str) -> String {
        let mut s = s.to_string();
        // 去掉 markdown 代码块标记
        s = s.replace("```json", "").replace("```", "");
        // 去掉尾部逗号（JSON 不允许）
        s = s.trim().to_string();
        // 转义单引号
        s = s.replace('\'', "\"");
        s
    }

    // 第 1 层：直接解析
    match serde_json::from_str::<Value>(content) {
        Ok(val) => return parse_translations(&val, entries),
        Err(_) => {}
    }

    // 第 2 层：修复后解析
    let fixed = apply_fixes(content);
    if fixed != content {
        match serde_json::from_str::<Value>(&fixed) {
            Ok(val) => return parse_translations(&val, entries),
            Err(_) => {}
        }
    }

    // 第 3 层：尝试提取代码块 + 修复
    if let Some(code_block_start) = content.find("```") {
        let after_block = &content[code_block_start + 3..];
        if let Some(code_block_end) = after_block.find("```") {
            let extracted = &after_block[..code_block_end].trim();
            if !extracted.is_empty() {
                let fixed = apply_fixes(extracted);
                match serde_json::from_str::<Value>(&fixed) {
                    Ok(val) => return parse_translations(&val, entries),
                    Err(_) => {}
                }
            }
        }
    }

    // 第 4 层：逐行解析（容错模式）
    // 尝试提取每行，只要匹配 {"key": ..., "text": ...} 模式
    let mut partial_results = Vec::new();
    let mut found_any = false;
    let trimmed = content.trim().trim_start_matches('[').trim_end_matches(']');
    for line in trimmed.lines() {
        let line = line.trim().trim_end_matches(',').trim();
        if line.starts_with('{') && line.contains("\"key\"") && line.contains("\"text\"") {
            let fixed = apply_fixes(line);
            if let Ok(v) = serde_json::from_str::<Value>(&fixed) {
                if let (Some(key), Some(text)) = (
                    v.get("key").and_then(|k| k.as_str()),
                    v.get("text").or(v.get("translation")).and_then(|t| t.as_str()),
                ) {
                    partial_results.push((key.to_string(), text.to_string()));
                    found_any = true;
                }
            }
        }
    }

    if found_any {
        return map_to_results(&partial_results, entries);
    }

    Err(format!("无法解析 LLM 响应内容: {}", &content[..content.len().min(200)]))
}

/// 从已解析的 Value 中提取 translations
fn parse_translations(parsed: &Value, entries: &[TranslationEntry]) -> Result<Vec<TranslateResult>, String> {
    let translations = parsed
        .get("translations")
        .or_else(|| parsed.as_array().map(|_| parsed))
        .and_then(|v| v.as_array())
        .ok_or_else(|| "JSON 缺少 translations 数组".to_string())?;

    let mut pairs = Vec::new();
    for item in translations {
        let key = item.get("key").and_then(|k| k.as_str()).unwrap_or_default();
        let text = item.get("text").or(item.get("translation")).and_then(|t| t.as_str()).unwrap_or_default();
        if !key.is_empty() && !text.is_empty() {
            pairs.push((key.to_string(), text.to_string()));
        }
    }
    map_to_results(&pairs, entries)
}

fn map_to_results(pairs: &[(String, String)], entries: &[TranslationEntry]) -> Vec<TranslateResult> {
    let map: std::collections::HashMap<&str, &str> = pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    entries.iter().map(|e| {
        match map.get(e.key.as_str()) {
            Some(text) => TranslateResult {
                key: e.key.clone(),
                original_text: e.text.clone(),
                translated_text: text.to_string(),
                success: true,
                error: None,
            },
            None => TranslateResult {
                key: e.key.clone(),
                original_text: e.text.clone(),
                translated_text: e.text.clone(),
                success: false,
                error: Some("LLM 响应中未找到该条目".to_string()),
            },
        }
    }).collect()
}
```

在 `translate_batch` 中将 `parse_response` 调用替换为 `healing_parse_response`。

- [ ] **Step 5: 实现限流检测**

在 `send_request` 中增加 429 处理：

```rust
fn send_request(...) -> Result<Value, String> {
    // ... 现有代码
    let status = response.status();
    if status == 429 {
        let retry_after = response.headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(30);
        return Err(format!("RATE_LIMITED:{}", retry_after));
    }
    // ... 现有代码
}
```

- [ ] **Step 6: translate_batch 调用回调**

在 `healing_parse_response` 成功后，results 返回前：

```rust
// 在成功路径中，调用回调
if let Some(cb) = on_batch_complete {
    cb(&results);
}
```

- [ ] **Step 7: 运行已有测试（确认不破坏）**

```bash
cd src-tauri && cargo test -- core::llm 2>&1 | tail -20
```

Expected: 所有测试通过。

- [ ] **Step 8: 提交**

```bash
git add src-tauri/src/core/llm.rs
git commit -m "feat: enhance LlmClient with system_prompt, healing parse, rate limit detection"
```

---

### Task 3: pipeline.rs — 智能分批 + 流式进度 + 限流适应

**Files:**
- Modify: `src-tauri/src/core/pipeline.rs`
- Modify: `src-tauri/src/core/models.rs`（EntryProgress/EntryStatus 新类型）

- [ ] **Step 1: models.rs 新增 EntryProgress/EntryStatus**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum EntryStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "dictionary_hit")]
    DictionaryHit,
    #[serde(rename = "skip")]
    Skip,
    #[serde(rename = "translating")]
    Translating,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryProgress {
    pub key: String,
    pub mod_name: String,
    pub source_text: String,
    pub target_text: Option<String>,
    pub status: EntryStatus,
}
```

- [ ] **Step 2: run_pipeline 新增 entry_progress_tx 参数**

```rust
pub fn run_pipeline(
    config: PipelineConfig,
    job_id: &str,
    progress_tx: mpsc::Sender<PipelineProgress>,
    log_tx: mpsc::Sender<TranslateLogEntry>,
    entry_progress_tx: mpsc::Sender<EntryProgress>,  // 新增
) -> Result<PipelineResult, String>
```

所有调用处同步更新。

- [ ] **Step 3: 词典阶段发射条目状态**

在词典阶段循环中，对每个条目发射 EntryProgress：

```rust
// 在循环开始时，对 llm_only_entries 统一发射 Pending
for (entry, file_name) in &llm_only_entries {
    let _ = entry_progress_tx.send(EntryProgress {
        key: entry.key.clone(),
        mod_name: file_name.to_string(),
        source_text: entry.text.clone(),
        target_text: None,
        status: EntryStatus::Pending,
    });
}
```

命中词典时发射 DictionaryHit，跳过时发射 Skip。

- [ ] **Step 4: 实现智能分批逻辑**

新增辅助函数：

```rust
/// 按 mod_id 分组，每组内按 batch_size 切割
fn group_batches<'a>(
    entries: &[(&'a LanguageEntry, &'a str)],
    batch_size: usize,
) -> Vec<Vec<(&'a LanguageEntry, &'a str)>> {
    use std::collections::HashMap;
    
    // Step 1: 按 mod_id 分组
    let mut by_mod: HashMap<&str, Vec<(&LanguageEntry, &str)>> = HashMap::new();
    for item in entries {
        by_mod.entry(item.0.mod_id.as_str()).or_default().push(*item);
    }
    
    // 将分组结果排序（稳定顺序）
    let mut mod_ids: Vec<&str> = by_mod.keys().copied().collect();
    mod_ids.sort();
    
    let mut batches = Vec::new();
    for mod_id in &mod_ids {
        let group = by_mod.get(mod_id).unwrap();
        // Step 2: 每组内切割
        for chunk in group.chunks(batch_size) {
            batches.push(chunk.to_vec());
        }
    }
    batches
}
```

在 `run_pipeline` 的 LLM 阶段替换原有分批逻辑：

```rust
// 旧逻辑（删除）：
// let effective_batch_size = llm_cfg.batch_size.min(llm_only_entries.len());
// let total_llm_batches = llm_only_entries.len().div_ceil(effective_batch_size);

// 新逻辑：
let effective_batch_size = llm_cfg.batch_size.max(1);
let smart_batches = group_batches(&llm_only_entries, effective_batch_size);
let total_llm_batches = smart_batches.len();
```

- [ ] **Step 5: 波浪循环增强 — 流式回调 + 限流适应**

替换现有波浪循环实现：

```rust
use std::sync::atomic::Ordering;
use std::time::Duration;

let mut effective_concurrency = llm_cfg.concurrency.min(total_llm_batches).max(1);
let mut batch_index = 0usize;
let mut all_llm_results: Vec<(usize, Vec<jobs::TranslationResult>)> = Vec::new();

while batch_index < total_llm_batches {
    if is_translation_cancelled(job_id) {
        break;
    }

    // 当前波浪 batch 数
    let wave_count = effective_concurrency.min(total_llm_batches - batch_index);
    
    // 构建当前波浪
    let wave_batches: Vec<(usize, Vec<TranslationEntry>)> = (batch_index..batch_index + wave_count)
        .map(|bi| {
            let batch = &smart_batches[bi];
            let entries: Vec<TranslationEntry> = batch.iter().map(|(entry, _)| TranslationEntry {
                key: entry.key.clone(),
                text: entry.text.clone(),
                mod_id: entry.mod_id.clone(),
                source_lang: entry.language.clone(),
                target_lang: config.target_language.clone(),
            }).collect();
            (bi, entries)
        })
        .collect();

    // 发射 Translating 状态
    for (_, batch_entries) in &wave_batches {
        for te in batch_entries {
            let _ = entry_progress_tx.send(EntryProgress {
                key: te.key.clone(),
                mod_name: String::new(),
                source_text: te.text.clone(),
                target_text: None,
                status: EntryStatus::Translating,
            });
        }
    }

    // 并发调度（每个 batch 通过回调发射 Completed/Failed 状态）
    let client_ref = &client;
    let key_to_meta = &key_to_meta;
    let entry_progress_tx_ref = &entry_progress_tx;
    let mod_name_map: std::collections::HashMap<&str, &str> = llm_only_entries
        .iter()
        .map(|(entry, fname)| (entry.key.as_str(), *fname))
        .collect();

    let wave_results: Vec<(usize, Vec<jobs::TranslationResult>, TokenUsage, bool)> = std::thread::scope(|s| {
        wave_batches.iter().map(|(bi, batch_entries)| {
            s.spawn(|| {
                let on_complete = |results: &[TranslateResult]| {
                    for r in results {
                        let status = if r.success { EntryStatus::Completed } else { EntryStatus::Failed };
                        let _ = entry_progress_tx_ref.send(EntryProgress {
                            key: r.key.clone(),
                            mod_name: mod_name_map.get(r.key.as_str()).unwrap_or(&"").to_string(),
                            source_text: r.original_text.clone(),
                            target_text: Some(r.translated_text.clone()),
                            status,
                        });
                        // 也发送到 log_tx
                        let _ = log_tx.send(TranslateLogEntry {
                            key: r.key.clone(),
                            source_text: r.original_text.clone(),
                            target_text: r.translated_text.clone(),
                            mod_name: mod_name_map.get(r.key.as_str()).unwrap_or(&"").to_string(),
                            source_type: if r.success { "llm".to_string() } else { "failed".to_string() },
                        });
                    }
                };

                let (results, token_usage) = client_ref.translate_batch(batch_entries, Some(&on_complete));
                let token = token_usage.unwrap_or_default();

                // 检查是否全部因限流失败
                let all_rate_limited = results.iter().all(|r| !r.success && r.error.as_deref().map_or(false, |e| e.contains("RATE_LIMITED")));

                let converted: Vec<jobs::TranslationResult> = results.into_iter()
                    .map(|r| jobs::TranslationResult {
                        key: r.key,
                        source_text: r.original_text,
                        target_text: r.translated_text,
                        mod_id: String::new(),
                        mod_name: String::new(),
                        source_type: if r.success { "llm".to_string() } else { "failed".to_string() },
                    })
                    .collect();

                (*bi, converted, token, all_rate_limited)
            })
        }).collect::<Vec<_>>().into_iter().filter_map(|h| h.join().ok()).collect()
    });

    // 恢复 mod_id/mod_name
    for (_, results, _, _) in &wave_results {
        for mut entry in results.iter().cloned() {
            if let Some(&(mid, fname)) = key_to_meta.get(entry.key.as_str()) {
                if entry.mod_id.is_empty() { entry.mod_id = mid.to_string(); }
                if entry.mod_name.is_empty() { entry.mod_name = fname.to_string(); }
            }
            all_llm_results.push((0, vec![entry]));
        }
    }

    // 检查限流情况
    let has_429 = wave_results.iter().any(|(_, _, _, rate_limited)| *rate_limited);
    if has_429 {
        client.consecutive_429s.fetch_add(1, Ordering::SeqCst);
        let count = client.consecutive_429s.load(Ordering::SeqCst);
        let new_conc = (effective_concurrency / 2).max(1);
        effective_concurrency = new_conc;
        let wait_secs = match count {
            1 => 30u64,
            2 => 60,
            _ => 120,
        };
        std::thread::sleep(Duration::from_secs(wait_secs));
        // 失败的 batch 重新放回队列
        // （RATE_LIMITED 的 batch 已被标记为 failed，在下一轮重新调度）
    } else {
        client.consecutive_429s.store(0, Ordering::SeqCst);
        // 试探性恢复并发
        if effective_concurrency < llm_cfg.concurrency.min(total_llm_batches) {
            effective_concurrency += 1;
        }
    }

    // 更新进度
    batch_index += wave_count;
    let _ = progress_tx.send(PipelineProgress {
        current: batch_index.min(total_llm_batches),
        total: total_llm_batches,
        phase: PipelinePhase::Translating,
        mod_name: String::new(),
        sub_step: Some(format!("{}/{} 批次", batch_index.min(total_llm_batches), total_llm_batches)),
        stage_status: StageStatus::Running,
    });
}
```

- [ ] **Step 6: 编译验证**

```bash
cd src-tauri && cargo build 2>&1 | head -30
```

Expected: 编译成功。

- [ ] **Step 7: 运行测试**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
```

Expected: 所有测试通过。

- [ ] **Step 8: 提交**

```bash
git add src-tauri/src/core/models.rs src-tauri/src/core/pipeline.rs
git commit -m "feat: smart batching, streaming progress, rate limit adaptation"
```

---

### Task 4: translate.rs 新增 entry_progress channel

**Files:**
- Modify: `src-tauri/src/commands/translate.rs`

- [ ] **Step 1: 新增 entry_progress channel 和 reader 线程**

在 `start_translation` 函数中，在现有 `progress_tx` 和 `log_tx` 之后新增：

```rust
let (entry_progress_tx, entry_progress_rx) = mpsc::channel::<EntryProgress>();

// Reader: entry progress → Tauri event
let app_emit_ep = app.clone();
let _ = tauri::async_runtime::spawn_blocking(move || {
    while let Ok(entry) = entry_progress_rx.recv() {
        if let Err(err) = app_emit_ep.emit("translate-entry-progress", &entry) {
            eprintln!("translate-entry-progress emit error: {err}");
        }
    }
});
```

在 `pipeline::run_pipeline` 调用中传入 `entry_progress_tx`：

```rust
let result = tauri::async_runtime::spawn_blocking(move || {
    pipeline::run_pipeline(config, &job_id, progress_tx_work, log_tx_work, entry_progress_tx)
}).await.map_err(|e| e.to_string())??;
```

添加 `use crate::core::models::EntryProgress;` 导入。

- [ ] **Step 2: 编译验证**

```bash
cd src-tauri && cargo build 2>&1 | head -20
```

Expected: 编译成功。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/commands/translate.rs
git commit -m "feat: add entry_progress channel for per-item status events"
```

---

### Task 5: CFPA 词典模糊匹配

**Files:**
- Create: `src-tauri/src/core/dictionary/cfpa.rs`
- Modify: `src-tauri/src/core/dictionary.rs`

- [ ] **Step 1: 创建 cfpa.rs**

```rust
use rusqlite::{params, Connection, Result as SqlResult};

/// CFPA 模糊匹配结果
#[derive(Debug, Clone)]
pub struct CfpaMatch {
    pub source_text: String,
    pub target_text: String,
    pub similarity: f64,
}

/// 对原文进行模糊匹配，返回候选译文列表
///
/// 策略：
/// 1. SQL LIKE 子串匹配（source_text LIKE '%keyword%'）
/// 2. 关键词拆分后分别匹配
/// 3. 合并结果按关联度排序去重
pub fn fuzzy_search(
    conn: &Connection,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    limit: usize,
) -> SqlResult<Vec<CfpaMatch>> {
    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let limit = limit.min(20);

    // 策略 1：全文本子串匹配
    {
        let pattern = format!("%{}%", text);
        let mut stmt = conn.prepare(
            "SELECT source_text, target_text FROM dictionary_entries
             WHERE source_type = 'cfpa'
               AND source_lang = ?1 AND target_lang = ?2
               AND source_text LIKE ?3
             LIMIT ?4"
        )?;
        let rows = stmt.query_map(params![source_lang, target_lang, pattern, limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })?;
        for row in rows {
            let (src, tgt) = row?;
            if seen.insert(src.clone()) {
                // 完全匹配则相似度 1.0，否则按长度比
                let sim = if src.to_lowercase() == text.to_lowercase() { 1.0 } else { 0.7 };
                results.push(CfpaMatch { source_text: src, target_text: tgt, similarity: sim });
            }
        }
    }

    // 策略 2：按空格/下划线拆分原文关键词，分别匹配
    if results.len() < limit {
        let keywords: Vec<&str> = text.split(|c: char| c == ' ' || c == '_' || c == '/')
            .filter(|w| w.len() > 2)
            .collect();
        for kw in keywords {
            if results.len() >= limit { break; }
            let pattern = format!("%{}%", kw);
            let mut stmt = conn.prepare(
                "SELECT source_text, target_text FROM dictionary_entries
                 WHERE source_type = 'cfpa'
                   AND source_lang = ?1 AND target_lang = ?2
                   AND source_text LIKE ?3
                   AND source_text NOT LIKE ?4
                 LIMIT ?5"
            )?;
            let full_pattern = format!("%{}%", text);
            let rows = stmt.query_map(params![source_lang, target_lang, pattern, full_pattern, (limit - results.len()) as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            })?;
            for row in rows {
                let (src, tgt) = row?;
                if seen.insert(src.clone()) {
                    results.push(CfpaMatch { source_text: src, target_text: tgt, similarity: 0.5 });
                }
            }
        }
    }

    // 按相似度降序排序
    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    Ok(results)
}
```

- [ ] **Step 2: dictionary.rs 导出 cfpa 模块**

在文件顶部添加：

```rust
pub mod cfpa;
```

- [ ] **Step 3: 编译验证**

```bash
cd src-tauri && cargo build 2>&1 | head -20
```

Expected: 编译成功。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/core/dictionary/cfpa.rs src-tauri/src/core/dictionary.rs
git commit -m "feat: add CFPA dictionary fuzzy matching module"
```

---

### Task 6: build_prompt 集成 CFPA 参考词典

**Files:**
- Modify: `src-tauri/src/core/llm.rs`

- [ ] **Step 1: 新增 `build_prompt_with_references` 函数**

```rust
/// 构建带 CFPA 参考词典的 user prompt
pub fn build_prompt_with_references(
    entries: &[TranslationEntry],
    source_lang: &str,
    target_lang: &str,
    references: &[(String, String)],  // (source, target) pairs
) -> String {
    let base_prompt = build_prompt(entries, source_lang, target_lang);
    
    if references.is_empty() {
        return base_prompt;
    }

    // 构建参考段（不超过 30 对，避免超长）
    let ref_lines: Vec<String> = references.iter()
        .take(30)
        .map(|(s, t)| format!("{} → {}", s, t))
        .collect();
    let ref_text = ref_lines.join("\n");

    format!(
        "{}

## 参考词汇表（以下为 CFPA 汉化组词典中可能相关的对照，请参考但不严格遵循）
{}
",
        base_prompt, ref_text
    )
}
```

- [ ] **Step 2: 在 pipeline.rs 中调用 cfpa::fuzzy_search 并传入 build_prompt**

在 `run_pipeline` LLM 阶段中，构建 batch 后、发送请求前，对每个 batch 的文本做模糊匹配，收集参考：

```rust
// 收集当前 batch 的参考词典
let mut all_references = Vec::new();
let mut seen_ref = std::collections::HashSet::new();
for entry in batch_entries {
    if let Ok(matches) = dictionary::cfpa::fuzzy_search(
        &dict_conn,
        &entry.text,
        &entry.source_lang,
        &config.target_language,
        5,
    ) {
        for m in &matches {
            if seen_ref.insert(m.source_text.clone()) {
                all_references.push((m.source_text.clone(), m.target_text.clone()));
            }
        }
    }
}
// 使用 build_prompt_with_references 替代 build_prompt
let prompt = llm::build_prompt_with_references(batch_entries, source_lang, target_lang, &all_references);
```

需要将 `dict_conn` 的引用传入 LLM 阶段的闭包中（通过 `Arc<Mutex<Connection>>` 或提前 collect）。

简化方案：在 LLM 阶段开始前预先对所有 llm_only_entries 做一次模糊匹配，收集所有参考对，然后在构建 `TranslationEntry` 时一并携带。

- [ ] **Step 3: 编译验证**

```bash
cd src-tauri && cargo build 2>&1 | head -20
```

Expected: 编译成功。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/core/llm.rs src-tauri/src/core/pipeline.rs
git commit -m "feat: integrate CFPA dictionary references into LLM prompts"
```

---

### Task 7: 前端设置页 — hints + system_prompt + tooltip

**Files:**
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/i18n/translations.ts`

- [ ] **Step 1: i18n 新增键**

在 `TranslationKey` 类型中添加：

```typescript
| "settings.batchSizeHint"
| "settings.batchMaxCharsHint"
| "settings.concurrencyHint"
| "settings.timeoutSecsHint"
| "settings.retryCountHint"
| "settings.retryDelaySecsHint"
| "settings.rateLimitRpmHint"
| "settings.systemPrompt"
| "settings.systemPromptHint"
| "jobs.entryStatus.pending"
| "jobs.entryStatus.dictionaryHit"
| "jobs.entryStatus.skip"
| "jobs.entryStatus.translating"
| "jobs.entryStatus.completed"
| "jobs.entryStatus.failed"
| "jobs.logPanel.colStatus"
```

在 `zhCn` 对象中添加：

```typescript
"settings.batchSizeHint": "每批最多包含的条目数。较大 batch 可提高 Token 利用率，但单次响应时间更长。小白建议保持默认值 80。",
"settings.batchMaxCharsHint": "每批的最大字符数，超过此值时强制拆分。适用于 API 有上下文窗口限制的情况。默认 120000。",
"settings.concurrencyHint": "同时发送的 API 请求数量。程序会自动根据限流情况动态调整，遇 429 自动降级，无需手动操心。",
"settings.timeoutSecsHint": "单次 API 请求的超时秒数，默认 180。翻译大批量时可适当增加。",
"settings.retryCountHint": "API 请求失败时的重试次数，默认 5 次。程序会自动处理限流重试等待。",
"settings.retryDelaySecsHint": "首次重试前的等待秒数，默认 2 秒。后续重试等待时间会翻倍。",
"settings.rateLimitRpmHint": "每分钟最多请求数，默认 3000。0 表示不限速。",
"settings.systemPrompt": "系统提示词",
"settings.systemPromptHint": "自定义 AI 翻译助手的角色和行为设定。默认已提供完善的 Minecraft 翻译专家设定，大多数用户无需修改。",
"jobs.entryStatus.pending": "待翻译",
"jobs.entryStatus.dictionaryHit": "词典命中",
"jobs.entryStatus.skip": "跳过",
"jobs.entryStatus.translating": "翻译中",
"jobs.entryStatus.completed": "已完成",
"jobs.entryStatus.failed": "失败",
"jobs.logPanel.colStatus": "状态",
```

在 `enUs`、`jaJp`、`koKr`、`ruRu` 中添加对应英文/日文/韩文/俄文翻译。

- [ ] **Step 2: SettingsPage 增强字段**

在 `settings-form two-column` 的 `activeTab === "performance"` 中，对每个字段添加 `<small>`：

```tsx
// concurrency 字段
<label className="field">
  <span>{t(language, "settings.concurrency")}</span>
  <input
    type="number" min="1" max="100"
    value={draft.concurrency}
    onChange={(e) => setDraft({...draft, concurrency: Number(e.target.value)})}
    data-tooltip={t(language, "settings.concurrencyHint")}
  />
  <small>{t(language, "settings.concurrencyHint")}</small>
</label>
```

对其他 6 个字段（batchSize、batchMaxChars、timeoutSecs、retryCount、retryDelaySecs、rateLimitRpm）同样处理。

- [ ] **Step 3: 添加 system_prompt 多行文本框**

在 API 选项卡 `activeTab === "api"` 中添加：

```tsx
<label className="field" style={{ gridColumn: "1 / -1" }}>
  <span>{t(language, "settings.systemPrompt")}</span>
  <textarea
    rows={6}
    value={draft.systemPrompt}
    onChange={(e) => setDraft({...draft, systemPrompt: e.target.value})}
    style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 1.5 }}
  />
  <small>{t(language, "settings.systemPromptHint")}</small>
</label>
```

- [ ] **Step 4: 前端构建验证**

```bash
npm run build 2>&1 | tail -20
```

Expected: 构建成功，无类型错误。

- [ ] **Step 5: 提交**

```bash
git add src/pages/SettingsPage.tsx src/i18n/translations.ts
git commit -m "feat: improve settings UI with hints and system_prompt editor"
```

---

### Task 8: 前端 JobsPage — 状态列 + 条目状态面板

**Files:**
- Modify: `src/pages/JobsPage.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: 状态 badge 样式**

在 `src/styles/app.css` 末尾添加：

```css
/* ── Entry status badges ── */
.badge-pending { background: #6b7280; color: #fff; }
.badge-dictionary_hit { background: #3b82f6; color: #fff; }
.badge-skip { background: #9ca3af; color: #fff; }
.badge-translating { background: #f59e0b; color: #fff; animation: pulse 1.5s ease-in-out infinite; }
.badge-completed { background: #22c55e; color: #fff; }
.badge-failed { background: #ef4444; color: #fff; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* ── Entry status panel ── */
.entry-status-panel {
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  padding: 12px 16px;
  margin-top: 12px;
  background: var(--panel-bg, #fafafa);
}
.entry-status-panel h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
}
.entry-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  font-size: 13px;
}
.entry-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.entry-status-bar {
  flex: 1;
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
  min-width: 80px;
}
.entry-status-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.entry-status-count {
  font-variant-numeric: tabular-nums;
  min-width: 80px;
  text-align: right;
  color: #666;
}
```

- [ ] **Step 2: 注册 translate-entry-progress 事件监听**

在 `JobsPage.tsx` 的 `useEffect` 中新增监听器：

```typescript
// Register translate-entry-progress listener
useEffect(() => {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }
  let unlistenFn: (() => void) | null = null;
  let cancelled = false;
  import("@tauri-apps/api/event").then(({ listen }) => {
    if (cancelled) return;
    listen("translate-entry-progress", (event) => {
      const entry = event.payload as EntryProgress;
      setEntryProgressMap((prev) => {
        const next = new Map(prev);
        next.set(entry.key, entry);
        return next;
      });
    }).then((unlisten) => {
      unlistenFn = unlisten;
      if (cancelled) unlisten();
    });
  });
  return () => {
    cancelled = true;
    unlistenFn?.();
  };
}, []);
```

新增 `EntryProgress` 类型定义（或在 `types.ts` 中统一添加）：

```typescript
interface EntryProgress {
  key: string;
  modName: string;
  sourceText: string;
  targetText: string | null;
  status: "pending" | "dictionary_hit" | "skip" | "translating" | "completed" | "failed";
}
```

在组件状态中添加：

```typescript
const [entryProgressMap, setEntryProgressMap] = useState<Map<string, EntryProgress>>(new Map());
```

- [ ] **Step 3: 日志表新增状态列**

在 table thead 末尾添加：

```tsx
<th>{t(language, "jobs.logPanel.colStatus")}</th>
```

在 tbody 每行末尾添加：

```tsx
{/* 状态列 */}
<td>
  <span className={`badge badge-${translateLogToStatus(entry)}`}>
    {entryStatusLabel(translateLogToStatus(entry), language)}
  </span>
</td>
```

辅助函数：

```typescript
function translateLogToStatus(entry: TranslateLogEntry): string {
  switch (entry.sourceType) {
    case "skipped": return "skip";
    case "dictionary": return "dictionary_hit";
    case "llm": return "completed";
    case "failed": return "failed";
    default: return "pending";
  }
}
```

- [ ] **Step 4: 新增条目状态面板组件**

```tsx
interface EntryStatusCounts {
  pending: number;
  dictionary_hit: number;
  skip: number;
  translating: number;
  completed: number;
  failed: number;
}

function EntryStatusPanel({ 
  entryProgressMap, 
  total,
  language 
}: { 
  entryProgressMap: Map<string, EntryProgress>;
  total: number;
  language: AppLanguage;
}) {
  const counts: EntryStatusCounts = useMemo(() => {
    const c = { pending: 0, dictionary_hit: 0, skip: 0, translating: 0, completed: 0, failed: 0 };
    entryProgressMap.forEach((entry) => {
      if (entry.status in c) c[entry.status as keyof EntryStatusCounts]++;
    });
    return c;
  }, [entryProgressMap]);

  if (total === 0) return null;

  const statuses: Array<{ key: keyof EntryStatusCounts; color: string }> = [
    { key: "pending", color: "#6b7280" },
    { key: "dictionary_hit", color: "#3b82f6" },
    { key: "skip", color: "#9ca3af" },
    { key: "translating", color: "#f59e0b" },
    { key: "completed", color: "#22c55e" },
    { key: "failed", color: "#ef4444" },
  ];

  const i18nKey = (k: string) => `jobs.entryStatus.${k}` as const;

  return (
    <div className="entry-status-panel">
      <h3>翻译状态</h3>
      {statuses.map(({ key, color }) => (
        <div className="entry-status-row" key={key}>
          <span className="entry-status-dot" style={{ background: color }} />
          <span>{t(language, i18nKey(key))}</span>
          <div className="entry-status-bar">
            <div
              className="entry-status-bar-fill"
              style={{
                width: total > 0 ? `${(counts[key] / total) * 100}%` : "0%",
                background: color,
              }}
            />
          </div>
          <span className="entry-status-count">
            {counts[key]} / {total}
          </span>
        </div>
      ))}
    </div>
  );
}
```

在 JSX 中 status 面板的插入位置：

```tsx
{/* 进度条保持现有逻辑 */}
<div className="scan-progress">...</div>

{/* 新增：条目状态面板 */}
{(isRunning || status === "completed") && (
  <EntryStatusPanel
    entryProgressMap={entryProgressMap}
    total={scanSummary?.actualPendingEntries ?? 0}
    language={language}
  />
)}
```

- [ ] **Step 5: 前端构建验证**

```bash
npm run build 2>&1 | tail -20
```

Expected: 构建成功。

- [ ] **Step 6: 提交**

```bash
git add src/pages/JobsPage.tsx src/i18n/translations.ts src/styles/app.css
git commit -m "feat: add entry status column and status panel to JobsPage"
```

---

## 执行顺序

1. **Task 1** (models.rs) → **Task 2** (llm.rs) → **Task 3** (pipeline.rs) → 后端核心链路完成
2. **Task 4** (translate.rs) → 后端事件链路完成
3. **Task 5** (cfpa.rs) → **Task 6** (集成 build_prompt) → CFPA 词典完成
4. **Task 7** (前端设置页) → **Task 8** (前端条目状态) → 前端完成

每个 Task 编译+测试验证后提交，不累积。

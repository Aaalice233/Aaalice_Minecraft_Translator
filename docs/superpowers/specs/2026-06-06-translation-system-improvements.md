# 翻译系统改进设计

> 基于用户反馈的 5 项核心改进：设置 UI 增强、流式刷新、CFPA 词典参考、Agent 角色设定、逐条目状态显示。

---

## 1. 设置页 UI 改进

### 现状

`SettingsPage.tsx` 中性能/API 字段只有纯标签，缺少 tooltip 和详细说明。新手用户难以理解各项参数含义。

### 改动

#### Backend

`src-tauri/src/core/models.rs` — `Settings` 新增字段：

```rust
pub system_prompt: String,  // 默认值见下方
```

默认值（开箱即用，覆盖角色设定、格式要求、翻译规范）：

```text
你是一个专业 Minecraft 模组汉化翻译专家，精通中英文游戏术语和模组翻译规范。

## 格式要求
- 严格按 JSON 数组格式返回：[{"key": "...", "text": "翻译文本"}, ...]
- 只返回 JSON，不要包含 markdown 代码块标记或其他解释文字
- 每个条目必须包含 key 和 text 字段

## 占位符保护（极其重要）
- 保留所有 % 格式代码：%s %d %1$s %2$d %08.2f 等
- 保留所有 § 颜色/样式码：§a §l §r §e §6 等
- 保留所有花括号占位符：{player} {0} {{quest_name}} 等
- 保留所有尖括号引用：<item:minecraft:diamond> <block:stone> 等
- 保留所有转义序列：\n \t 等
- 永远不要修改、删除或重新排序这些占位符

## 翻译规范
- 术语统一：与 Minecraft 中文标准译名一致（Creeper → 苦力怕 / Ender Dragon → 末影龙 / Nether → 下界）
- 模组专属名词的首次出现可用括号附注英文原名
- 同一术语在同一模组内必须始终保持一致译法
- 描述性文本需要通顺自然，符合中文表达习惯
- 物品名/方块名使用书名号《》括起，但保留原始格式标记
- 任务文本保持原文的语气和风格（正式/诙谐/史诗感）
```

`Settings` 其他默认值同步调整：

| 字段 | 原默认值 | 新默认值 | 说明 |
|---|---|---|---|
| `concurrency` | 6 | 10 | 上限，实际根据 API 响应动态调整 |
| `batch_size` | 80 | 80 | 每批最大条目数，保持 |
| `timeout_secs` | 120 | 180 | 稍放宽，应对大 batch |
| `retry_count` | 3 | 5 | 留更多容错空间（含限流降级） |

`LlmConfig` 同步新增 `system_prompt` 字段。

#### I18n

`src/i18n/translations.ts` 新增以下键（4 语言）：

| Key | zh_cn |
|---|---|
| `settings.batchSize` | 每批条目数（已有，增强描述） |
| `settings.batchSizeHint` | 每批最多包含的条目数，默认 80。较大 batch 可提高 Token 利用率，但单次响应时间更长。小白用户建议保持默认值。 |
| `settings.batchMaxCharsHint` | 每批的最大字符数，默认 120000。超过此值时会强制拆分。适用于 API 有上下文窗口限制的情况。 |
| `settings.concurrencyHint` | 同时发送的 API 请求数量，默认 100。程序会自动根据 API 限流情况动态调整，遇 429 会自动降级，无需手动操心。 |
| `settings.timeoutSecsHint` | 单次 API 请求的超时时间，默认 180 秒。翻译大批量时可适当增加。 |
| `settings.retryCountHint` | API 请求失败时的重试次数，默认 5 次。程序会自动处理限流的重试等待。 |
| `settings.retryDelaySecsHint` | 首次重试前的等待秒数，默认 2 秒。后续重试的等待时间会翻倍（2s → 4s → 8s）。 |
| `settings.rateLimitRpmHint` | 每分钟最多请求数，默认 3000。0 表示不限速。超过此值时会自动等待。 |
| `settings.systemPrompt` | 系统提示词 |
| `settings.systemPromptHint` | 自定义 AI 翻译助手的角色和行为设定，例如「你是一个 Minecraft 游戏模组汉化专家，请严格遵循 JSON 格式返回...」 |

#### Frontend

`SettingsPage.tsx`：

- API 选项卡：在所有 `<input>` / `<select>` 元素上添加 `data-tooltip` 属性，只在鼠标悬浮时显示
- API 选项卡：新增 **系统提示词** 多行文本框（`<textarea>`）
- 性能选项卡：每个字段下方添加 `<small>` 元素显示 hint 文本
- 所有 hint 文本均通过 `t(language, key)` 从 i18n 字典获取，实现多语言

#### 影响范围

- 文件：`models.rs`、`llm.rs`、`pipeline.rs`、`translate.rs`、`SettingsPage.tsx`、`translations.ts`
- 新增字段序列化向后兼容：`#[serde(default = "default_system_prompt")]`

---

## 2. 流式刷新 + 自愈解析 + 智能分批

### 现状

`pipeline.rs` 的 LLM 阶段使用 `std::thread::scope` 并发处理多个 batch，然后**等待 wave 内所有 batch 都完成后**才统一发送一次 `PipelineProgress`。前端只能看到「批次级」的进度跳跃。

`llm.rs` 的 `parse_response` 对 LLM 返回格式错误的容错能力有限——JSON 解析失败就直接走 retry 循环。

### 2a. 流式：每批独立上报

#### Backend

**`llm.rs`** — `translate_batch` 签名增加回调参数：

```rust
pub fn translate_batch(
    &self,
    entries: &[TranslationEntry],
    on_batch_complete: impl Fn(&[TranslateResult]),  // 新增
) -> (Vec<TranslateResult>, Option<TokenUsage>)
```

在 `parse_response` 成功后立即调用 `on_batch_complete(&results)`，而不是等 caller 循环末尾再处理。

**`pipeline.rs`** — LLM 波浪循环简化：

```rust
for wave_start in (0..total_llm_batches).step_by(wave_size) {
    // 构建当前波浪的 batch 列表
    // ...
    // 并发调度
    let wave_results = std::thread::scope(|s| { ... });
    
    // 每个 batch 已经在 translate_batch 的回调中发射过事件了。
    // 这里只需聚合统计。                    
}
```

事件发射链：`on_batch_complete` → `progress_tx.send` → `translate.rs` 中的 reader 线程 → `app.emit("translate-progress")` → 前端。

### 2b. 智能分批

**`pipeline.rs`**：

替换现有平铺分批逻辑为**按 mod_id 分组分批**：

```text
输入: llm_only_entries = [(entry, file_name), ...]

1. 按 mod_id 分组: HashMap<mod_id, Vec<(entry, file_name)>>
2. 每组内按 effective_batch_size 切割
3. 所有 batch 合并为一个 Vec<Vec<...>>
4. 再按 wave_size 取波浪

每个 batch 保证条目来自同一个 mod（除非该 mod 的条目少于 batch_size）。
```

#### 附带 mod 信息

`build_prompt` 的输入 JSON 增加 `mod_id` 和 `file_name` 字段，让 LLM 知道当前翻译的模组上下文。

### 2c. 自愈解析

**`llm.rs`** — `parse_response` 增加多层容错：

```rust
fn parse_response(response_body: &Value, entries: &[TranslationEntry]) -> Result<Vec<TranslateResult>, String> {
    // 第 0 层：内容为空 → 直接失败
    // 第 1 层：常规 JSON 解析
    // 第 2 层：提取 markdown 代码块 ````json ... ```` 中的 JSON
    // 第 3 层：修复常见错误再解析
    //    - 去掉尾部逗号 ",] → ]"   ",} → }"
    //    - 单引号转双引号
    //    - 补全缺失的结束引号
    // 第 4 层：逐行解析，每行尝试独立解析为 {"key":..., "text":...}
    //    - 能解析多少算多少，失败的 key 标记为 failed
    // 全部失败 → 返回 Err
}
```

每一层返回成功结果后即停止后续尝试。

### 2d. 智能限流适应（Rate Limit Auto-Adaptation）

**设计目标**：
- API 返回 429 Too Many Requests 时，不标记所有条目为失败
- 动态降低并发数，自动重试失败的 batch
- 对限流「宽限」的 API（高 RPM 但偶尔 429）智能适应
- 用户无需手动调整 concurrency 就能稳定翻译

**实现方案**：

`LlmClient` 新增自适应状态：

```rust
pub struct LlmClient {
    // ... 现有字段
    pub system_prompt: String,
    // 限流适应状态（运行时可变，非序列化）
    #[serde(skip)]
    pub effective_concurrency: AtomicUsize,  // 当前有效并发数
    #[serde(skip)]
    pub consecutive_429s: AtomicUsize,       // 连续 429 计数
}
```

**`llm.rs` — `send_request` 增强**：

```rust
fn send_request(...) -> Result<Value, String> {
    let response = client.post(url) ... .send()?;
    let status = response.status();
    
    if status == 429 {
        // 1. 读 Retry-After 头
        let retry_after = response.headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(30);  // 默认等 30 秒
        
        // 2. 返回特殊错误，携带等待时间
        return Err(format!("RATE_LIMITED:{}", retry_after));
    }
    // ...
}
```

**`pipeline.rs` — 波浪循环增强**：

```text
effective_concurrency = min(llm_cfg.concurrency, total_llm_batches)

for wave_start in (0..total_llm_batches).step_by(effective_concurrency) {
    // 构建当前波浪
    // 并发发送所有 batch
    
    // 检查返回结果
    for result in wave_results {
        if result 包含 RATE_LIMITED 错误 {
            consecutive_429s += 1
            // 指数退避：等 Retry-After 秒
            // 降低 effective_concurrency（减半，下限 1）
            // 将失败的 batch 放回队列重新调度
        } else {
            consecutive_429s = 0
            // 如果连续成功 3 次且当前并发 < 原始值时，尝试恢复（+1）
        }
    }
}
```

**降级策略细节**：

| 连续 429 次数 | 并发削减 | 等待策略 |
|---|---|---|
| 第 1 次 | 减半（10→5） | Retry-After 头或 30s |
| 第 2 次 | 再减半（5→2） | 60s |
| 第 3+ 次 | 降到 1 | 120s |
| 连续成功 3 次 | +1（试探性恢复） | — |

**恢复策略**：
- 每次降低并发后，如果后续连续 3 个 wave 都成功，尝试恢复 1 个并发单位
- 再次遇到 429 则重新降级
- 效果：自动在 API 速率附近振荡，找到稳定点

**为什么不直接全部 429 失败？**
因为限流通常是临时的（其他用户占用了配额），且不同 API 的限流阈值差异巨大（DeepSeek 的 RPM 是 3000+，而某些 API 只有 60），固定重试策略不适合所有场景。

#### 影响范围

- 文件：`llm.rs`、`pipeline.rs`、`models.rs`
- 接口：`translate_batch` 签名变更（新增回调参数）
- 不破坏测试：现有测试只测解析逻辑，不受影响

---

## 3. CFPA i18n-dict 参考词典

### 现状

词典阶段只做 `search_by_hash`（精确匹配），没有模糊匹配或外部词典参考。

### 方案

新增 `src-tauri/src/core/dictionary/cfpa.rs`：

```rust
/// 对原文进行模糊匹配，返回候选译文列表作为 LLM 参考
pub fn fuzzy_search(
    conn: &Connection,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    limit: usize,
) -> Result<Vec<CfpaMatch>, String> {
    // Step 1: SQL LIKE 子串匹配
    let like_results = search_like(conn, text, source_lang, target_lang, limit)?;
    // Step 2: 关键词拆分匹配
    // Step 3: 合并结果按相似度排序
    // Step 4: 去重后取 top limit
}
```

```rust
pub struct CfpaMatch {
    pub source_text: String,
    pub target_text: String,
    pub similarity: f64,  // 0.0 ~ 1.0
}
```

**`build_prompt` 增加参考段**：

在 system prompt 和 user prompt 之间插入：

```text
以下是 CFPA 汉化组词典中可能与当前翻译相关的参考对照：
```
Iron Ingot → 铁锭
Stone Sword → 石剑
Creeper → 爬行者
```
请参考以上译法，但不必严格遵循。
```

**数据加载**：
- 用户首次使用时，程序提示下载 CFPA i18n-dict（从 GitHub releases 或直接引用已有本地路径）
- 下载后导入 SQLite 词典库，`source_type = "cfpa"`
- 如果已有本地词典库包含 `cfpa` 类型的条目，直接使用

#### 影响范围

- 文件：新增 `cfpa.rs`、修改 `dictionary.rs`、修改 `pipeline.rs`、修改 `llm.rs`（`build_prompt`）
- 数据：CFPA 条目复用现有 dictionary SQLite 表，`source_type = "cfpa"`
- 现有词典优先级不受影响（cfpa 优先级低于 `manual`，高于 `llm`）

---

## 4. Agent 角色系统提示词

### 现状

System prompt 硬编码在 `llm.rs` 的 `build_prompt` 函数内：

```rust
"你是 Minecraft 模组翻译助手。严格按 JSON 数组格式返回..."
```

用户无法自定义。

### 方案

**`models.rs`** — `Settings` 新增 `system_prompt: String`，默认值包含上述内容。

**`LlmClient`** 新增字段 `system_prompt: String`，在构建请求 body 时使用它替代硬编码字符串。

**`build_prompt`** 不再包含 system prompt，只生成 user prompt 部分。system prompt 由 `translate_batch` 传入。

**`SettingsPage.tsx`** — API 选项卡新增多行文本框：

```tsx
<label className="field">
  <span>{t(language, "settings.systemPrompt")}</span>
  <textarea
    rows={4}
    value={draft.systemPrompt}
    onChange={(e) => setDraft({...draft, systemPrompt: e.target.value})}
  />
  <small>{t(language, "settings.systemPromptHint")}</small>
</label>
```

#### 影响范围

- 文件：`models.rs`、`llm.rs`、`pipeline.rs`、`translate.rs`、`SettingsPage.tsx`、`translations.ts`
- 默认值向后兼容
- 已保存设置的旧 JSON 无 `systemPrompt` 字段 → `#[serde(default)]` 回退默认

---

## 5. 逐条目状态显示

### 现状

`PipelineProgress` 只有批次的 `current/total`，前端日志表只有最终结果（`TranslateLogEntry`），无法看到翻译过程中的中间状态。

### 5a. 后端事件

**新增模型**（`models.rs`）：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryProgress {
    pub key: String,
    pub mod_name: String,
    pub source_text: String,
    pub target_text: Option<String>,
    pub status: EntryStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
```

**新增 channel**（`pipeline.rs`）：

```rust
fn run_pipeline(
    ...
    entry_progress_tx: mpsc::Sender<EntryProgress>,  // 新增
) -> ...
```

每个条目生命周期中的发射点：

| 阶段 | 状态 | 发射时机 |
|---|---|---|
| 词典阶段开始 | Pending | 对待 LLM 的条目统一发射一次 |
| 词典命中 | DictionaryHit | `search_by_hash` 命中时 |
| 纯占位符 | Skip | `is_placeholder_only` 时 |
| 发送到 LLM | Translating | 调用 `translate_batch` 前 |
| LLM 返回成功 | Completed | `parse_response` 成功后 |
| LLM 返回失败 | Failed | 所有 retry 耗尽后 |

**`translate.rs`** 新增 reader 线程：

```rust
let app_emit_entry = app.clone();
let _ = tauri::async_runtime::spawn_blocking(move || {
    while let Ok(entry) = entry_progress_rx.recv() {
        if let Err(err) = app_emit_entry.emit("translate-entry-progress", &entry) {
            eprintln!("translate-entry-progress emit error: {err}");
        }
    }
});
```

### 5b. 前端显示

**`JobsPage.tsx`**：

1. **日志表新增「状态」列**：

```tsx
<th>{t(language, "jobs.logPanel.colStatus")}</th>
// ...
<td>
  <span className={`badge badge-${entry.status}`}>
    {statusLabel(entry.status)}
  </span>
</td>
```

颜色方案：
- `pending` → 灰色 `#999`
- `dictionary_hit` → 蓝色 `#3b82f6`
- `skip` → 灰色 `#999`
- `translating` → 黄色动画 `#f59e0b`
- `completed` → 绿色 `#22c55e`
- `failed` → 红色 `#ef4444`

2. **新增条目状态面板**（进度条下方）：

```
┌─ 翻译状态 ──────────────────────────────────┐
│ ⬤ 待翻译    ████████████░░░░░ 128 / 200     │
│ ⬤ 词典命中   ██████░░░░░░░░░░░  20 / 200    │
│ ⬤ 跳过      ██░░░░░░░░░░░░░░░   2 / 200    │
│ ⬤ 翻译中    █████░░░░░░░░░░░░░   8 / 200    │
│ ⬤ 已完成    ████████████████░ 192 / 200     │
│ ⬤ 失败      ██░░░░░░░░░░░░░░░   2 / 200    │
│                                         总计 200 │
└──────────────────────────────────────────────┘
```

每个状态行包含：
- 颜色圆点
- 状态名
- 水平进度条（占总体比例）
- 计数

**多语言**：`EntryStatus` 的显示文本通过 i18n 字典获取：

| Key | zh_cn |
|---|---|
| `jobs.entryStatus.pending` | 待翻译 |
| `jobs.entryStatus.dictionaryHit` | 词典命中 |
| `jobs.entryStatus.skip` | 跳过 |
| `jobs.entryStatus.translating` | 翻译中 |
| `jobs.entryStatus.completed` | 已完成 |
| `jobs.entryStatus.failed` | 失败 |

### 5c. 影响范围

- 文件：`models.rs`（新增类型）、`pipeline.rs`（新增发射点）、`translate.rs`（新增 channel 和 reader 线程）、`JobsPage.tsx`（状态列 + 状态面板）、`translations.ts`（新增键）
- 性能：`EntryProgress` 事件数 ≈ 待翻译条目数（10k 条目 ≈ 10k 事件），前端使用分页或虚拟滚动处理大批量

---

## 文件变更清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src-tauri/src/core/models.rs` | 修改+新增 | Settings 加 systemPrompt; 新增 EntryProgress, EntryStatus |
| `src-tauri/src/core/llm.rs` | 修改 | system_prompt 字段; translate_batch 回调参数; 自愈解析 |
| `src-tauri/src/core/pipeline.rs` | 修改 | 智能分批; 条目状态发射; 回调接入 |
| `src-tauri/src/core/dictionary/cfpa.rs` | 新增 | CFPA 模糊匹配 |
| `src-tauri/src/core/dictionary.rs` | 修改 | mod 声明 + fuzzy_search 导出 |
| `src-tauri/src/commands/translate.rs` | 修改 | 新增 entry_progress channel + reader |
| `src/pages/SettingsPage.tsx` | 修改 | 字段 hints + system_prompt textarea |
| `src/pages/JobsPage.tsx` | 修改 | 状态列 + 条目状态面板 |
| `src/i18n/translations.ts` | 修改 | 新增 ~30 个 i18n 键（4 语言） |
| `src/styles/app.css` | 可选的 | 状态 badge 样式 |

---

## 分批执行顺序

按依赖关系和风险排序：

1. **P1：后端基础** — `models.rs` 新增字段 + `llm.rs` 自愈解析 + `system_prompt`
2. **P2：流式与智能分批** — `pipeline.rs` 回调 + 按 mod 分组
3. **P3：条目状态事件** — `EntryProgress` 发射 + `translate.rs` 新 channel
4. **P4：CFPA 词典** — `cfpa.rs` + `build_prompt` 参考段
5. **P5：前端设置页** — hints + system_prompt textarea
6. **P6：前端条目状态** — 状态列 + 状态面板 + i18n

P1–P4 可以独立测试（Rust 单元测试），P5–P6 需要前端联调。

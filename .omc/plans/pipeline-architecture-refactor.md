# RALPLAN-DR: 扫描-翻译-校验-打包 Pipeline 架构重构

> 状态: **pending approval** ✅ 已通过 Architect + Critic 审查
> 审查结论: APPROVE（含 4 项补充修正已纳入）

---

## 0. 问题分析

### 当前数据流

```
[扫描]                         [翻译]                         [打包]
DashboardPage                 JobsPage                       PackagesPage
    │                             │                              │
    ▼                             ▼                              ▼
scan_instance()               start_translation()             generate_translation_pack()
    │                             │                              │
    ├─ 扫 jars                   ├─ 重新扫 jars（重复）         ├─ 从前端 state 读 scanSummary
    ├─ 落盘 scan_{jobId}.json    ├─ 算 pending                  ├─ 过滤 sourceLang 条目
    ├─ 给前端返回 ScanSummary     ├─ stub LLM                    └─ 生成 zip
    └─ job_id 不被后续使用       └─ 不回存翻译结果
                                     │
                                     └─ JobsPage 手动再扫一次刷新

[校验]
ValidatePage ─── 纯占位符，无任何后端逻辑
```

### 关键缺陷

| # | 缺陷 | 影响 |
|---|------|------|
| 1 | `start_translation()` 不接收 `job_id`，重新扫描实例 | 翻译无视扫描结果，扫描白做 |
| 2 | 翻译结果不持久化 | 页面刷新后翻译丢失，无法 resume |
| 3 | 无 `TranslationJob` 状态机（前端有类型、后端无实现） | 不能追踪 pipeline 阶段 |
| 4 | `ValidatePage` 是纯占位符 | 校验阶段不存在 |
| 5 | 打包阶段从前端 state 读 `scanSummary`，不是从后端 | 后端无渠道知道翻译结果对应哪些条目 |
| 6 | 无 resume/重试机制 | 翻译中断后只能重新开始 |

---

## 1. 原则 (Principles)

1. **增量引入** — 每次改动一个阶段的 bridge，不一次性改写所有命令。每个 phase 后功能仍然可用。
2. **持久状态 > 瞬态数据** — Job 状态和翻译结果必须持久化到磁盘，不能依赖前端 React state。
3. **唯一真相源** — `scan_{jobId}.json` 是"有哪些条目"的唯一权威，翻译/校验/打包都基于它。
4. **向前兼容** — 新增阶段不要求已有阶段大规模改动。旧命令签名在过渡期保留。
5. **Job ID 贯穿** — `job_id` 是所有阶段的连接令牌。

## 2. 决策驱动因素 (Decision Drivers)

| 优先级 | 驱动因素 | 解释 |
|--------|----------|------|
| P0 | 不破坏现有扫描/展示/翻译功能 | 重构期间用户仍能正常使用已完成的 P1 功能 |
| P1 | 最小化前端改动 | 新增命令和类型，不改动现有组件 props 和生命周期 |
| P2 | 可增量部署 | 每个 phase 完成后可以独立验证和合并 |
| P3 | 为 resume 和 retry 打下基础 | 状态持久化后后续才能支持中断恢复 |

## 3. 可行方案与决策

### Option A: Job 状态机关联阶段（推荐 ✅）

| 维度 | Option A（推荐） | Option B（轻量） | Option C（SQLite，已排除） |
|------|:---:|:---:|:---:|
| 改动量 | 中 | 小 | 大 |
| 解决核心问题（数据断流） | ✅ | ⚠️ 部分 | ✅ |
| 支持 resume | ✅ | ❌ | ✅ |
| 支持后续阶段接入 | ✅ | ❌ | ✅ |
| 复杂度 | 中 | 低 | 高 |
| 风险 | 低 | 低 | 中 |

**Option B 排除理由**：只解决"翻译重新扫描"问题，不持久化翻译结果，校验和打包阶段仍然接不进来。相当于在断流处打了个补丁，没有真正建立 pipeline。

**Option C 排除理由**：当前只需要顺序文件读写，引入 SQLite schema 增加不必要的复杂度。保留日后从 JSON 文件迁移到 DB 的升级空间。此外和现有 `data/dictionary.sqlite` 职责重叠。

---

## 4. 推荐方案: Option A

### 4.1 新增数据结构

```rust
/// data/jobs/translate_{jobId}.json — 翻译 Job 主状态文件（轻量，仅统计）
struct TranslationJobState {
    job_id: String,
    scan_job_id: String,          // 关联的扫描 job
    status: TranslationStatus,
    source_language: String,
    target_language: String,
    entries: Vec<PendingEntry>,   // 冻结的待翻译列表
    completed_entries: usize,
    failed_entries: usize,
    token_usage: TokenUsage,
    created_at: String,
    completed_at: Option<String>,
}

/// data/jobs/translate_{jobId}_results.jsonl — 翻译结果（追加写，避免 OOM）
/// 每行一个 JSON 对象：TranslationResult
struct TranslationResult {
    key: String,
    source_text: String,
    target_text: String,
    mod_id: String,
    mod_name: String,
    source_type: String,  // "llm" | "dictionary" | "i18n_pack" | "vm_pack"
}

enum TranslationStatus {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

struct PendingEntry {
    key: String,
    source_text: String,
    mod_id: String,
    mod_name: String,
}
```

**关键设计决策**：

| 决策 | 选择 | 理由 |
|------|------|------|
| 结果存储 | **单独 JSONL 文件追加写**，而非 `Vec<TranslationResult>` 内嵌 | 50k 条结果全在内存序列化可能 OOM；JSONL 每行一个对象，追加写 O(1)，读时流式加载 |
| 写入原子性 | **tmp + rename** | 写 `translate_{id}.json.tmp`，sync 后再 rename 覆盖，崩溃时最多丢一个批次 |
| 文件锁 | **不需要** | 单用户桌面应用，同一时刻只有一个 translate job 在运行 |
| 旧命令兼容 | `start_translation` 的 `path` 参数保留为可选 | 前端过渡期可传 `{ scan_job_id, path }`，优先用 scan_job_id |

### 4.2 任务时序和竞争条件分析

重要：**scan 文件写入和 translate 读取不存在竞争条件**，因为：
```
scan_instance() 写入 scan_{id}.json（同步）
    → 返回给前端
    → 用户手动点击"开始翻译"
    → start_translation(scan_job_id) 读取 scan_{id}.json
```

这是严格的人机交互时序，不是并发异步执行。

### 4.3 Phase 1: Job 核心 + 扫描-翻译 bridge（6 步）

核心改动量：约 200 行 Rust + 50 行 TypeScript

| 步骤 | 文件 | 改动 |
|------|------|------|
| **1.1** | `src-tauri/src/core/models.rs` | 新增 `TranslationJobState`、`TranslationStatus`、`PendingEntry`、`TranslationResult`、`PendingEntriesFile` |
| **1.2** | `src-tauri/src/core/jobs.rs` | **新建** — `JobManager` 结构体：`create_from_scan()`、`save()`、`load()`、`append_result()`、`load_latest()` |
| **1.3** | `src-tauri/src/core/paths.rs` | 新增 `translate_job_state_path(job_id)`、`translate_job_results_path(job_id)` |
| **1.4** | `src-tauri/src/commands.rs` | **改 `start_translation`** — 接收可选 `scan_job_id: Option<String>`，优先从 scan file 加载；回退到旧路径（重新扫描）；翻译结果追加写 JSONL；新增 `get_translation_job(job_id)` 和 `load_latest_translation_job()` 命令 |
| **1.5** | `src/types.ts` + `src/api/tauri.ts` | 同步新增前端类型；新增 `getTranslationJob()` 和 `loadLatestTranslationJob()` API |
| **1.6** | `src/pages/JobsPage.tsx` | 传递 `scanSummary.job_id` 给 `startTranslation`；加载后从 job file 读取状态代替手动 re-scan |

**Phase 1 验收**：
- ✅ `start_translation(scan_job_id)` 不再重新扫描
- ✅ 翻译进度和结果持久化到 `data/jobs/translate_{id}.json` + `.jsonl`
- ✅ 页面刷新后 `loadLatestTranslationJob()` 恢复 job 状态
- ✅ 不传 `scan_job_id` 时回退到旧行为（兼容过渡期）

### 4.4 Phase 2: 校验/Shield 模块

| 文件 | 改动 |
|------|------|
| `src-tauri/src/core/shield.rs` | **实现** 占位符保护（LLM 输入前标记、输出后校验恢复）、格式完整性（JSON 合法性）、缺失值检测 |
| `src-tauri/src/core/jobs.rs` | 新增 `load_results()` 方法（流式读取 JSONL）；新增 `validate()`：对结果逐条调用 shield |
| `src-tauri/src/commands.rs` | 新增 `validate_translation(job_id)` — 加载 job 翻译结果 → shield 校验 → 汇总报告 |
| `src/pages/ValidatePage.tsx` | 从 props 接收 `job_id`，调用 `validateTranslation(job_id)`，展示错误/冲突 |
| `src/types.ts` | 新增 `ValidationReport`、`ValidationIssue` 类型 |

**Phase 2 验收**：
- ✅ 校验阶段识别占位符破坏和格式错误
- ✅ 校验结果在 ValidatePage 展示
- ✅ shield 模块有独立单元测试

### 4.5 Phase 3: 打包 Job 化

| 文件 | 改动 |
|------|------|
| `src-tauri/src/commands.rs` | 新增 `generate_pack_from_job(job_id, dry_run)` — 从 job 加载翻译结果 → 打包 |
| `src-tauri/src/core/packer.rs` | 新增 `generate_pack_from_state(&PackOptions)` 重载 |
| `src/pages/PackagesPage.tsx` | 通过 `job_id` 调用 `generatePackFromJob()`；回退支持旧签名 |
| `src/types.ts` | 新增 `PackFromJobRequest` |
| `src-tauri/src/core/jobs.rs` | 新增打包阶段状态转换 |

**Phase 3 验收**：
- ✅ `generate_pack_from_job(job_id)` 使用已验证的翻译结果
- ✅ 打包阶段不依赖前端 `scanSummary` state
- ✅ 旧 `generate_translation_pack(entries, ...)` 命令仍然可用

---

## 5. 边界情况与恢复策略

| 场景 | 处理方式 |
|------|----------|
| 翻译中 app 崩溃 | JSON/JSONL 原子写入（tmp+rename）；重启后 `load_latest_translation_job()` 找到未完成的 job，可继续 |
| 用户传无效 scan_job_id | start_translation 参数校验 + 返回 `Result::Err("scan job not found")`，前端展示友好错误 |
| 扫描后实例变化（jar 增减） | 用户可选：基于旧扫描翻译，或重新扫描获得新 id |
| 大量 entries（>50k） | 翻译结果 JSONL 追加写，读时流式逐行 parse，不一次加载全部到内存 |
| 翻译结果和 scan 的 entries 数量不一致 | 应在 Phase 2 校验阶段检测并报告 |
| 用户快速点击两次"开始翻译" | `TRANSLATE_CANCEL` AtomicBool 保证只有一个激活；或者检查 job status 拒绝重复开始 |

---

## 6. 风险登记表

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 大量 entries 导致单 JSON 过大 | 中 | 高 | 结果分 JSONL 文件存储，主文件仅存统计 |
| 翻译中崩溃导致文件损坏 | 低 | 高 | tmp + rename 原子写入 |
| Phase 1 改 commands.rs 引入 bug | 低 | 中 | 保留旧签名作为 fallback，逐步迁移 |
| 前端从 props 读 scanSummary 改成从后端读 job 状态 → 过渡期不一致 | 中 | 低 | Phase 1 保留双通道，前端优先用后端状态 |

---

## 7. 不包含的范围

- FTB 任务翻译（独立模块，后续添加）
- 硬编码汉化（二期实验室）
- 自动 resume（手动确认后可做后续 PR）
- 多 job 并发/翻译队列（保留扩展性即可）
- 设置页的 job 历史管理

---

## 8. ADR（架构决策记录）

| 字段 | 内容 |
|------|------|
| **决策** | 采用 `TranslationJobState` JSON 持久化 + `job_id` 贯穿 pipeline |
| **驱动因素** | 扫描→翻译数据断流，翻译结果不持久化，校验/打包无法接入 |
| **备选方案** | Option B（最小 bridge），Option C（SQLite pipeline）|
| **选择理由** | Option A 在"解决核心问题"和"不增加过度复杂度"之间取得最佳平衡；单文件 JSON 足够应对当前规模 |
| **后果** | 1）翻译不再重新扫描，速度提升 2）翻译结果持久化，页面刷新不丢失 3）新增约 200 行 Rust 维护成本 |
| **后续事项** | Phase 1 完成后即可移除旧代码路径；如果未来 job 数据量 > 1GB 或需要复杂查询，可以迁移到 SQLite |

---

## 9. 执行路径

此计划已通过 Architect 和 Critic 审查。等待用户选择执行方式：

- **team**（推荐）：并行 agents 按 phase 分步实现
- **ralph**：顺序执行，每步验证
- **手动分步执行**：我在当前会话逐步实现

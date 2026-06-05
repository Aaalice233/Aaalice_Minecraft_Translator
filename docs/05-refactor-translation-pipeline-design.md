# 翻译 Pipeline 重构规格说明书

> 对应诊断发现的问题：进度卡0、取消后继续跑、commands.rs 臃肿、pipeline.rs 死代码、重复逻辑、日志不一致、Job 状态不更新

---

## 1. 动机与目标

### 1.1 诊断发现的问题

| # | 问题 | 严重性 | 根因 |
|---|------|--------|------|
| P1 | 翻译内嵌扫描时进度始终为 0 | 🔴 用户可见 | 扫描进度回调是空闭包 `&\|_: ScanProgress\| {}`，JobsPage 不监听 scan-progress |
| P2 | 取消翻译后进度/日志还在走 | 🔴 用户可见 | 事件读取线程未同步退出 + `spawn_blocking` 管线未及时检查取消标志 |
| P3 | cancel_translation 竞态窗口 | 🟡 逻辑 | 两次 store 之间可被另一方插入，导致取消被静默吞掉 |
| P4 | `commands.rs` 979 行 | 🟡 可维护 | 架构文档规划的 6 个命令文件全部堆在一个文件 |
| P5 | `pipeline.rs` 从未被调用 | 🟡 死代码 | 字典匹配有 3 套独立实现（pipeline / commands 内联 / jobs） |
| P6 | Job 状态始终为 `Pending` | 🟡 不准确 | 没有代码在阶段转换时更新 `TranslationJobState.status` |
| P7 | 7 处 `eprintln!` 不写日志文件 | 🟢 诊断困难 | 非关键错误走 stderr，main.log 看不到 |
| P8 | `llm.rs` 生产代码用 `.expect()` | 🟢 风险 | HTTP 客户端构建失败时 panic |

### 1.2 重构目标

1. **修复 P1/P2/P3**：消除用户可见的进度和取消问题
2. **拆分 P4**：`commands.rs` → `commands/` 目录，按职责分文件
3. **激活 P5**：`pipeline.rs` 重写为翻译编排器，统一重复逻辑
4. **修复 P6/P7/P8**：状态机、日志、错误处理清理

**不改变：** 扫描器、LLM 客户端、词典、资源包打包、前端 UI 布局和交互流程

---

## 2. 后端模块拆分

### 2.1 当前结构

```
commands.rs (979 行, 22+ 个 Tauri command)
core/pipeline.rs (91 行, 未被任何代码调用)
```

### 2.2 目标结构

```
commands/
├── mod.rs            # 注册所有命令，lib.rs 只引用 commands::register_all()
├── scan.rs           # scan_instance, cancel_scan
├── translate.rs      # start_translation, cancel_translation
├── pack.rs           # generate_translation_pack, generate_pack_from_job, copy_pack_to_instance
├── validate.rs       # validate_translation
├── jobs.rs           # get_translation_job, load_latest_translation_job, load_jobs, clear_jobs_cache
├── settings.rs       # get_settings, save_settings
├── llm.rs            # fetch_llm_models, check_llm_connection
├── dictionary.rs     # get_dictionary_stats, import_dictionary, export_dictionary
└── game.rs           # fetch_game_versions, get_log_content
```

### 2.3 模块接口

每个命令文件是一个公共函数：
```rust
// commands/scan.rs
pub fn register(app: &mut TauriApp) {
    // 或通过 mod.rs 统一注册
}
```

`commands/mod.rs` 提供 `register_all()`：
```rust
pub fn register_all(app: &mut App) -> Result<(), Box<dyn Error>> {
    scan::register(app);
    translate::register(app);
    pack::register(app);
    // ...
}
```

**迁移策略：**
1. 创建 `commands/` 目录及 `mod.rs`
2. 从 `commands.rs` 逐函数复制到对应文件，每次复制后确认编译通过
3. 最终删除 `commands.rs`

---

## 3. Pipeline 层重构

### 3.1 新接口

```rust
// core/pipeline.rs

use std::sync::{Arc, atomic::AtomicBool};
use std::path::PathBuf;
use std::sync::mpsc;

/// Pipeline 配置 — 所有参数集中一处
pub struct PipelineConfig {
    pub root: PathBuf,
    pub instance_path: String,
    pub source_language: String,
    pub target_language: String,
    pub llm_config: LlmConfig,
    pub scan_job_id: Option<String>,
    pub i18n_pack_name: Option<String>,
    pub vm_pack_name: Option<String>,
}

/// Pipeline 结果 — 替代直接返回 usize
pub struct PipelineResult {
    pub completed: usize,
    pub dict_count: usize,
    pub llm_count: usize,
    pub token_usage: TokenUsage,
    pub actual_source_language: String,
    pub scan_job_id: String,
}

/// 统一进度事件（替换原来的 TranslateProgress）
pub enum PipelinePhase {
    Scanning,
    Extracting,
    Dictionary,
    Translating,
    Completed,
}

pub struct PipelineProgress {
    pub current: usize,
    pub total: usize,
    pub phase: PipelinePhase,
    pub mod_name: String,
    pub sub_step: Option<String>,
    pub stage_status: StageStatus,
}

/// 运行完整翻译管线
pub fn run_pipeline(
    config: PipelineConfig,
    cancel_token: Arc<AtomicBool>,
    progress_tx: mpsc::Sender<PipelineProgress>,
    log_tx: mpsc::Sender<TranslateLogEntry>,
) -> Result<PipelineResult, String>;
```

### 3.2 内部 5 阶段

```
run_pipeline()
│
├─ 1. resolve_phase(&config, cancel_token, progress_tx, log_tx)
│     返回 (ScanSummary, actual_source_language)
│
│     ┝  scan_job_id 非空 → 从文件加载 ScanSummary（验证语言匹配）
│     ┖  加载失败/语言不匹配 → 扫描实例
│          ┝  传入带中继的进度回调 → ScanProgress 转为 PipelineProgress 发到 progress_tx
│          ┖  阶段进度: total=模组数, current=已扫模组数, phase=Scanning
│
├─ 2. extract_pending(&scan_summary) -> Vec<PendingEntry>
│     从 ScanSummary 提取待翻译条目
│     逻辑从 commands.rs:497-513 和 jobs.rs:332-356 统一过来
│
├─ 3. dictionary_phase(&root, &pending, &config, cancel_token, progress_tx, log_tx)
│        -> (Vec<TranslationResult>, Vec<PendingEntry>)
│
│     ┝  遍历 pending entries
│     ┝  dictionary::search_by_hash 匹配 → 加入 batch_results
│     ┖  未匹配 → 加入 llm_only_entries
│       进度: phase=Dictionary, total=pending.len(), current=已处理
│
├─ 4. llm_phase(&root, &llm_only, &config, cancel_token, progress_tx, log_tx)
│        -> Vec<TranslationResult>
│
│     ┝  波次并发: wave_size=min(concurrency, total_batches)
│     ┝  每波内 std::thread::scope 并行发送
│     ┝  进度: phase=Translating, sub_step="{wave}/{total_waves} 批次"
│     ┖  波间限速 sleep
│
└─ 5. finalize(&root, &job_id, &results, &dict_count, &llm_count, &token_usage,
                progress_tx, log_tx) -> PipelineResult
       ┝  batch_append_results 写入 .jsonl
       ┝  Token 使用统计日志
       ┝  PipelineProgress { stage_status: Completed }
       ┖  return PipelineResult
```

### 3.3 扫描进度中继（关键修复）

```rust
fn resolve_phase(..., progress_tx: mpsc::Sender<PipelineProgress>, ...) -> Result<ScanSummary, String> {
    // ... 尝试加载缓存 ...

    // 需要重新扫描
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
        &cancel_token,
        &relay,     // ← 原来 &|_: ScanProgress| {}，现在真正中继
    ).map_err(to_message)?;

    // 扫描完成事件
    let _ = progress_tx.send(PipelineProgress {
        current: summary.total_mods(),
        total: summary.total_mods(),
        phase: PipelinePhase::Scanning,
        stage_status: StageStatus::Completed,
        ..default()
    });

    Ok(summary)
}
```

---

## 4. 事件通道与取消机制

### 4.1 事件读取线程安全退出

```rust
// translate.rs 中（原来在 commands.rs）
let _progress_reader = tauri::async_runtime::spawn_blocking({
    let cancel = cancel_token.clone();
    move || {
        while let Ok(progress) = progress_rx.recv() {
            if cancel.load(Ordering::SeqCst) {
                break;  // ← 检查取消，不要继续 recv
            }
            let _ = app_emit.emit("translate-progress", &progress);
        }
    }
});

let _log_reader = tauri::async_runtime::spawn_blocking({
    let cancel = cancel_token.clone();
    move || {
        while let Ok(log_entry) = log_rx.recv() {
            if cancel.load(Ordering::SeqCst) {
                break;  // ← 之前没有这个检查！
            }
            let _ = app_emit_log.emit("translate-log-entry", &log_entry);
        }
    }
});
```

### 4.2 取消后通道关闭

```rust
// start_translation 末尾（await spawn_blocking 返回后）
let result = tauri::async_runtime::spawn_blocking(move || {
    pipeline::run_pipeline(config, cancel_token, progress_tx_work, log_tx_work)
}).await.map_err(|e| e.to_string())?;

// 关闭通道 → 读取线程 recv() 失败 → 自然退出
drop(progress_tx);
drop(log_tx);
```

### 4.3 取消标志竞态修复

保持当前顺序（先清除、再注册），但增加第二个保护：

```rust
// start_translation:
TRANSLATE_CANCEL.store(false, Ordering::SeqCst);
*ACTIVE_TRANSLATE_TASK.lock() = Some(job_id.clone());

// cancel_translation:
*ACTIVE_TRANSLATE_TASK.lock() = None;
TRANSLATE_CANCEL.store(true, Ordering::SeqCst);

// 额外保护：pipeline 内部统一使用 cancel_token (Arc<AtomicBool>)
// 该 token 由 pipeline 内部检查，不做双重存储
```

### 4.4 前端行为

JobsPage 的 `handleCancel` 保持不变：
1. `cancelledRef.current = true`
2. 调用 `cancelTranslation()` IPC
3. 设置 `status = "canceled"`
4. `setIsRunning(false)`

进度条在 `!isRunning` 时隐藏（CSS/条件渲染），不再显示已取消后的残余事件。

---

## 5. 统一数据模型

### 5.1 models.rs 变更

```rust
// 新增
#[derive(Clone, Serialize, Deserialize)]
pub enum PipelinePhase {
    Scanning,
    Extracting,
    Dictionary,
    Translating,
    Completed,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PipelineProgress {
    pub current: usize,
    pub total: usize,
    pub phase: PipelinePhase,
    pub mod_name: String,
    pub sub_step: Option<String>,
    pub stage_status: StageStatus,
}

// TranslateProgress 保留（兼容），但新代码使用 PipelineProgress
// 前端优先解析 PipelinePhase，fallback 到 TranslateProgress.phase
```

### 5.2 任务状态枚举完善

```rust
// jobs.rs
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}
```

当前 `TranslationJobState.status` 是 `String`。改为 `JobStatus` 枚举，pipeline 各阶段转换时更新：

| 时机 | 状态 |
|------|------|
| Job 创建 | `Pending` |
| `run_pipeline` 开始 | `Running` |
| 全部完成 | `Completed` |
| 取消检测命中 | `Cancelled` |
| 返回 Err | `Failed` |

---

## 6. 重复代码清理

### 6.1 Pending Entry 提取

```rust
// pipeline.rs | 唯一实现
pub fn extract_pending_entries(scan_summary: &ScanSummary) -> Vec<(&LanguageEntry, &str)>;
```

删除 `commands.rs:497-513` 和 `jobs.rs:332-356` 的重复实现。

### 6.2 Dictionary Matching

```rust
// pipeline.rs | dictionary_phase() 内部
fn match_single_entry(
    entry: &LanguageEntry,
    source_language: &str,
    target_language: &str,
    conn: &rusqlite::Connection,
    prefer_user_dict: bool,
) -> Option<TranslationResult>;
```

`pipeline.rs` 旧的 `match_entries()` 删除。`commands.rs` 内联的字典匹配逻辑移至 `dictionary_phase()`。

---

## 7. 日志 & 错误处理

### 7.1 eprintln! 替换

| 位置 | 替换为 |
|------|--------|
| 扫描结果写入失败 | `logging::append_main(&root, "...")?;` |
| 扫描结果序列化失败 | `logging::append_main(...)` |
| scan-progress emit error | `logging::append_main(...)` |
| translate-progress emit error | `logging::append_main(...)` |
| translate-log-entry emit error | `logging::append_main(...)` |
| 词典结果写入失败 | `logging::append_main(...)` |
| 批次结果写入失败 | `logging::append_main(...)` |

### 7.2 llm.rs .expect() 修复

```rust
// 原来
let client = Client::builder()
    .timeout(...)
    .build()
    .expect("LLM HTTP client 创建失败");

// 改为
let client = Client::builder()
    .timeout(...)
    .build()
    .map_err(|e| format!("LLM HTTP client 创建失败: {e}"))?;
```

---

## 8. 前端状态管理

### 8.1 Context + Reducer

```typescript
// src/app/AppContext.tsx

interface AppState {
  settings: Settings | null;
  scanSummary: ScanSummary | null;
  navStates: Record<PageKey, PageNavStatus>;
}

type AppAction =
  | { type: 'SET_SETTINGS'; payload: Settings }
  | { type: 'SET_SCAN_SUMMARY'; payload: ScanSummary }
  | { type: 'SET_NAV_STATE'; payload: { key: PageKey; status: PageNavStatus } };

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}
```

### 8.2 App.tsx 变更

```typescript
// 原来
function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [navStates, setNavStates] = useState<Record<PageKey, PageNavStatus>>({...});
  // ... 回调通过 props 传下去

// 改为
function App() {
  const { state, dispatch } = useContext(AppContext)!;
  // 直接读 state.settings, state.scanSummary, state.navStates
  // 页面通过 useContext 读取，不再 props 透传
```

### 8.3 JobsPage 变更

- Props 接口简化：移除 `scanSummary`、`onScanSummaryChange`、`settings`、`onBusyChange`、`onCompleteChange`
- 从 `useContext(AppContext)` 读取所需数据
- `translate-progress` 监听逻辑移到 Context 中（可选），或保持本地

### 8.4 进度事件完善

JobsPage 新增对 `translate-progress` 中 `phase === 'Scanning'` 的支持：

```typescript
// 进度条显示
const phaseLabel = translateProgress?.phase === 'Scanning'
  ? `正在扫描: ${translateProgress.mod_name}`
  : translateProgress?.phase === 'Extracting'
  ? '正在提取待翻译条目...'
  : translateProgress?.phase === 'Dictionary'
  ? '正在词典匹配...'
  : translateProgress?.phase === 'Translating'
  ? `正在翻译 (${translateProgress.sub_step || ''})`
  : '';
```

---

## 9. 重构风险与回退

### 9.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 新 pipeline 有遗漏行为 | 中 | 高 | 每阶段拆分后跑一次完整翻译验证 |
| 前端 Context 重构导致渲染异常 | 低 | 中 | 逐步替换，不改原有 JSX 结构 |
| 模块拆分遗漏导出 | 低 | 高 | 每拆一个编译一次 `cargo check` |
| 翻译中途中断（文件不存在等） | 低 | 高 | 保持 `.jsonl` 增量写入，支持断点续传（未来） |

### 9.2 回退策略

1. 每个步骤提交一次，确保可回退到任意点
2. 重构期间不删除旧的 `commands.rs`，重构完成后确认新路径跑通再删
3. 前端 Context 不改变页面 JSX，只改变数据读取方式，可逐页面切换

---

## 10. 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| A1 | 翻译内嵌扫描时进度条实时更新 | 启动翻译 → 看到进度从 0% 逐步增长 |
| A2 | 取消后进度条停止并显示灰色 | 点击取消 → 进度条立即停止 |
| A3 | 取消后日志不再追加 | 点击取消 → 日志面板不再新增条目 |
| A4 | 前后端编译通过 | `cargo build` + `npm run build` |
| A5 | 翻译结果与重构前一致 | 相同输入产生相同输出条数 |
| A6 | 词典匹配功能正常 | 命中词典的条目显示 source_type=dictionary |
| A7 | LLM 翻译功能正常 | 未命中词典的条目调用 LLM 翻译 |
| A8 | 前端 Context 给所有页面提供正确数据 | 各页面导航状态、扫描摘要显示正常 |

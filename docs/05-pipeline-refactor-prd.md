# PRD: 翻译管线架构重构

## 背景

当前 `pipeline.rs` 是一个 630 行单体函数（God Function），5 个阶段（Scan→Extract→Dictionary→LLM→Finalize）以注释分隔，共享局部变量，全局静态变量做取消控制。存在的问题：

1. **不可测试** — 无法单独测试某个阶段（如 LLM 重试逻辑），必须跑完整流程
2. **全局取消状态** — `TRANSLATE_CANCEL` + `ACTIVE_TRANSLATE_TASK` 静态变量，测试间互相污染
3. **扩展困难** — 加 FTB 任务翻译、翻译后验证等新阶段需改 200+ 行散布代码
4. **取消检查散落** — 7 处 `is_translation_cancelled()` 穿插在业务逻辑中

## 目标

将单体函数重构为 **Trait 阶段管道**架构：

```
PipelineBuilder::new()
    .phase(ScanPhase)
    .phase(ExtractPhase)
    .phase(DictionaryPhase)
    .phase(LlmPhase)
    .phase(FinalizePhase)
    .build()
    .run(ctx)
```

## 设计

### PipelineContext

统一上下文，携带所有阶段共享的数据：

```rust
pub struct PipelineContext {
    pub config: PipelineConfig,
    pub cancel: CancelToken,
    pub progress_tx: mpsc::Sender<PipelineProgress>,
    pub log_tx: mpsc::Sender<TranslateLogEntry>,
    pub entry_progress_tx: mpsc::Sender<EntryProgress>,
    pub dict_conn: Option<rusqlite::Connection>,
    pub scan_summary: Option<ScanSummary>,
    pub source_language: String,
}
```

### Phase Trait

```rust
pub trait Phase {
    fn name(&self) -> &'static str;
    fn run(&self, ctx: &mut PipelineContext) -> Result<PhaseOutcome, PhaseError>;
}

pub enum PhaseOutcome {
    Continue,
    StopAndReturn(PipelineResult),
}
```

### PipelineBuilder

```rust
pub struct PipelineBuilder {
    phases: Vec<Box<dyn Phase>>,
}
```

### CancelToken

将全局静态变量替换为注入式 `CancelToken(Arc<AtomicBool>)`：

```rust
pub struct CancelToken(Arc<AtomicBool>);
```

## 迁移步骤（8 步，增量进行）

| 步骤 | 状态 | 改动 |
|------|------|------|
| 1 | ✅ | 提取 CancelToken，替换全局静态 |
| 2 | ✅ | 定义 PipelineContext |
| 3 | ✅ | 提取 dictionary_phase() |
| 4 | ✅ | 提取 llm_phase() |
| 5 | ✅ | 定义 Phase trait + PipelineBuilder |
| 6 | ✅ | 各阶段包装为 Phase impl (ScanExtractPhase, DictionaryPhase, LlmPhase, FinalizePhase) |
| 7 | ✅ | 替换 run_pipeline() 为 Pipeline::run() |
| 8 | 🟡 待定 | 加 channel 实现阶段 3↔4 重叠 |

## 实际架构差异（对比原设计）

- **PipelineContext** 使用生命周期参数 `<'a>` 引用 config/cancel，而不是拥有这些数据。
- 阶段间数据（pending_entries, llm_only_entries）使用 **owned Vec** 存储在 ctx 中，
  通过 `std::mem::take` 取出的方式传递，满足 Rust 借用检查。
- `extract_pending_entries` 改为返回 `(LanguageEntry, String, Option<String>)`（owned），
  消除引用依赖和生命周期约束。
- 所有 4 阶段的错误处理和资源清理职责都封装在各自的 Phase impl 中。
- Pipeline::run() 在每阶段前检查取消信号，无需在各阶段内部重复编写。
- 取消信号可以通过注入不同的 CancelToken 在测试中隔离。

## 验收标准

1. `cargo build` 零错误零警告
2. `cargo test` 全部 52 测试通过
3. 翻译流程功能不变
4. 取消机制可测试
5. 每个阶段可独立测试

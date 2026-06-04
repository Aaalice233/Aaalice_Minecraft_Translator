# 扫描卡顿修复计划 (RALPLAN-DR)

## 问题
扫描时 UI 冻结 ~5 秒，进度事件不显示。根因：同步 command 阻塞 UI 线程 + `by_index()` 遍历全部 zip 条目。

## 改动文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src-tauri/src/commands.rs` | 修改 | `scan_instance` → async + spawn_blocking |
| `src-tauri/src/core/scanner.rs` | 修改 | `scan_mod_jar` + `scan_resourcepack_zip` 使用 `file_names()` 预过滤 |
| `src/pages/DashboardPage.tsx` | 无变更 | 已有事件监听代码可用 |

## RALPLAN-DR

### Principles
1. **非阻塞优先** — 耗时操作必须释放 UI 线程
2. **IO 最小化** — 不读不需要的数据
3. **增量改动** — 不重构整个扫描器，只改瓶颈点
4. **向后兼容** — 不改数据结构、测试 fixture、ScanSummary 接口
5. **一致性** — 同一模式出现在多个地方则全部修复

### Decision Drivers
1. UI 线程被同步 command 阻塞 → 事件无法送达 → **改成 async**
2. `by_index()` 对每个 zip 条目 seek → 99.8% 浪费 → **用 `file_names()` 预过滤**

### Viable Options

#### Option A: async command + file_names (推荐)
- 改动 2 个文件，共 ~15 行
- Tauri 2 已自带 async runtime，不需新依赖
- 双管齐下：事件实时送达 + 扫描快 20x
- 风险：极低

#### Option B: 只改 async command
- 只改 commands.rs 一行
- 事件能送达，但扫描仍慢（~5 秒）
- 用户能看进度条但还是要等
- 不彻底

#### Option C: 只改 file_names
- 只改 scanner.rs
- 扫描快 20x，但 UI 仍可能短暂冻结
- 用户看不到进度反馈

### 选定方案
**Option A (两者都改)**。async command 释放 UI 线程使事件流式送达；file_names 预过滤使扫描从 ~5 秒降到 ~0.3 秒。互不依赖，可独立验证。

## 实施步骤

### Step 1: commands.rs — async + spawn_blocking
```rust
#[tauri::command]
pub async fn scan_instance(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
) -> Result<ScanSummary, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_instance(&root, path, source_language, target_language, &|p| {
            let _ = app.emit("scan-progress", &p);
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    result.map_err(to_message)
}
```

### Step 2: scanner.rs — file_names() 预过滤

在 `scan_mod_jar` 中将 ZIP 条目遍历改为两阶段，注意借用顺序：

```rust
// 阶段 1：零 IO — 从内存中央目录收集语言文件索引
let lang_indices: Vec<usize> = {
    archive.file_names()
        .enumerate()
        .filter(|(_, name)| is_supported_lang_file(&name.replace('\\', "/")))
        .map(|(i, _)| i)
        .collect()  // 先释放 file_names() 的共享借用
};
// 阶段 2：只对匹配的索引 seek + 读取
for index in lang_indices {
    let Ok(mut file) = archive.by_index(index) else { continue; };
    // ... read_to_end + parse (同现有逻辑)
}
```

### Step 2b: scanner.rs — scan_resourcepack_zip 同步修复
`scan_resourcepack_zip` 函数（第 332-368 行）有完全相同的 `for index in 0..archive.len() { archive.by_index(index) }` 模式，同步应用 `file_names()` 预过滤避免后续技术债务。

### Step 3: 验证
- `cargo test` — 6 个已有测试必须全过
- `npm run build` — TypeScript 编译通过
- 手动在 Tauri 窗口验证：点击扫描，观察按钮动画 + 进度数字实时更新

## 测试说明
- 现有 Rust 测试 `scans_mod_jars_and_detects_existing_zh_cn` 覆盖扫描逻辑，修改后自动验证
- 前端测试 `renders editable provider fields` 不涉及扫描，不变
- file_names 优化不改变扫描结果，只改变 IO 路径

## ADR

| 字段 | 内容 |
|------|------|
| **决策** | async command + spawn_blocking + file_names 预过滤 |
| **驱动因素** | ① UI 线程阻塞 ② 30 万次无用 IO |
| **备选方案** | 只做 async / 只做 file_names |
| **选择理由** | 两者互不依赖，各自单独有效；同时解决"卡死"和"慢" |
| **后果** | scan_instance 改为 async 后调用方无感知（invoke 返回 Promise 不变） |
| **待办** | ① `fetch_llm_models` 也是同步 command + blocking HTTP，后续应 async；② 后续可考虑 Tauri 2 Channel API 替代事件，但当前方案已够用 |

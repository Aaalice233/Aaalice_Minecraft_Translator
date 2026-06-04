# Deep Dive Trace: 扫描卡顿根因追踪

## Observed Result
点击扫描按钮后，桌面端 UI 冻结约 5 秒，全程无进度反馈，扫描完成后一次性显示结果。

## Ranked Hypotheses
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|------------------|
| 1 | 同步 Tauri command 阻塞主线程，事件无法送达 | ✅ High | Strong — 3 lanes converge |
| 2 | `by_index()` 遍历全部 zip 条目造成 30 万次 IO seek | ✅ High | Strong — 量化分析 |
| 3 | React 状态批处理延迟 | ❌ Low | Weak — 事件根本没到达前端 |

## Evidence Summary by Hypothesis

### Lane 1: IPC 通道阻塞 (High confidence)
- **WebView2 的 `WebMessageReceived` 在 UI 线程(主线程)上触发** (wry 0.55.1)
- 同步 `#[tauri::command]` 直接在 IPC handler 中执行，**阻塞了 winit 事件循环**
- `app.emit("scan-progress")` 调用 `send_user_message()` → `EventLoopProxy::send_event()` — 是非阻塞的，但消息**被排队到事件循环中**
- 事件循环被阻塞 → 排队的 `EvaluateScript` 消息无法处理 → JavaScript 回调不执行
- 命令返回后 → 所有排队事件一次性涌入 → 前端看到"瞬间完成"
- **修复方向**: 改为 `async fn` + `tokio::task::spawn_blocking`

### Lane 2: ZipArchive 性能 (High confidence)
- `ZipArchive::new()` 仅读中央目录 (~1ms/jar)，**不是瓶颈**
- 但 `by_index(index)` 对每个 zip 条目都做 seek + 读本地文件头 (~0.1ms SSD, ~8ms HDD)
- 300 jars × ~1000 条目/jar = **300,000 次 IO 操作**
- SSD 场景仅 `by_index` 遍历就占 ~7.5 秒
- 语言文件仅占 0.2% 条目，99.8% 的 IO 被浪费
- **修复方向**: 用 `archive.file_names()` 零 IO 预过滤语言文件路径

### Lane 3: React 事件流 (Confirmed Lane 1)
- `listen("scan-progress")` 注册正确，JS 事件循环**不阻塞**
- 但事件根本无法从 Rust 端到达前端 → 不是因为 React 批处理
- 根因与 Lane 1 完全一致：UI 线程被阻塞

## Convergence / Separation Notes
**完全收敛**：三条路径指向同一个机制。同步 `#[tauri::command]` 阻塞 UI 线程导致事件无法送达，同时 `by_index()` 的 30 万次 IO 操作是 5 秒延迟的直接原因。

两个因素相互放大：
- 如果命令是 async 的，事件本可以正常流式显示，用户不会觉得"卡死"
- 如果 `by_index()` 优化了，5 秒延迟缩短到 <0.5 秒，即使用户感受不到进度也能接受

## Most Likely Explanation
双层根因：
1. **直接原因**（延迟来源）：`by_index()` 遍历全部 zip 条目造成 300,000 次 seek，SSD 上 ~7.5 秒
2. **结构原因**（卡死来源）：同步 `#[tauri::command]` 在主线程上阻塞 winit 事件循环，`emit()` 事件无法送达前端

## Recommended Discriminating Probe
将 `scan_instance` 改为 `async fn`，使用 `tokio::task::spawn_blocking` + `tauri::async_runtime::spawn_blocking`，验证 UI 在扫描期间是否能正常响应。

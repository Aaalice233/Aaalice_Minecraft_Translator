# 日志系统审计报告

> 日期：2026-06-07
> 范围：后端 logging 模块、前端 LogsPage、现有日志调用点
> 类型：对抗性代码审查

---

## 一、BUG 修复清单

### 1.1 ✅ read_logs 行号计算错误

**文件：** `src-tauri/src/commands/logs.rs`
**严重程度：** 中

**问题：** `LogOffset` 存储的是字节偏移量（用于 seek），但行号计算用了 `*offset as usize + i`。第二次轮询时 `*offset` 变成文件总字节数（如 4000），行号就变成 4000+0=4000、4000+1=4001……完全不反映真实行号。

**修复：** 将 `LogOffset` 从 `Mutex<u64>` 改为 `Mutex<(u64, usize)>`，分别记录字节偏移和累计行数。行号改为基于累计行数递增。

**涉及文件：** `commands/logs.rs`、`lib.rs`

### 1.2 ✅ mem::forget(guard) 尾部日志丢失

**文件：** `src-tauri/src/core/logging.rs`
**严重程度：** 中

**问题：** `tracing_appender::non_blocking` 返回的 `WorkerGuard` 被 `mem::forget` 泄漏，导致：
- 正常进程退出时不会 flush 缓冲队列
- 崩溃时尾部日志条目必定丢失

**修复：** 用 `OnceLock` 持有 guard，使其在进程正常退出时正确 drop 并 flush。

### 1.3 ✅ append_main/append_job/append_error 的 _root 参数未使用

**文件：** `src-tauri/src/core/logging.rs` 及 6 个调用文件
**严重程度：** 低

**问题：** 三个函数的 `_root: &Path` 参数都是未使用的。调用者以为在控制日志文件位置，实际日志写入由全局 `tracing` subscriber 决定。

**修复：** 移除 `_root` 参数，清理所有 20+ 处调用点。

**涉及文件：** `logging.rs`、`scanner.rs`、`pipeline.rs`、`jobs.rs`、`commands/scan.rs`、`commands/translate.rs`、`logging/tests.rs`

### 1.4 ❌ LogOffset 并发竞争（误报）

**文件：** `src-tauri/src/commands/logs.rs`
**严重程度：** 无

**分析：** 初看以为 Mutex 锁定范围不足（读取偏移量后立即释放），但实际代码中 `MutexGuard` 生命周期贯穿 seek → read → state update 全过程，竞争不成立。状态读取和文件 I/O 均在锁内完成，并发安全。

### 1.5 ✅ 前端 RAF / setTimeout 未清理

**文件：** `src/pages/LogsPage.tsx`
**严重程度：** 低

**问题：** `requestAnimationFrame` 的返回 ID 未在 effect 清理函数中取消；`setTimeout` 链在组件卸载后继续运行。

**修复：** 改用 `setInterval`（自动 cleanup）；RAF 效果增加返回值清理。

### 1.6 🔍 其他发现（已记录，未修复）

| 问题 | 文件 | 说明 |
|------|------|------|
| `errors/` 和 `jobs/` 目录创建但未使用 | `logging.rs` | `init()` 创建了 `logs/jobs/` 和 `logs/errors/` 但没有任何代码写入 |
| `append_direct` 死代码 | `logging.rs` | 标记 `#[allow(dead_code)]`，未被使用 |
| redact Pattern 4 过度泛化 | `redact.rs` | 匹配 `api_key`/`authorization` 后 16+ 字符的任意字符串，存在误脱敏风险 |
| paused 状态丢弃日志 | `LogsPage.tsx` | 暂停时新日志条目永久丢失，恢复时不会补回 |

---

## 二、性能分析

### 2.1 前端 600ms 轮询

**现状：** `LogsPage` 每 600ms 通过 Tauri command 调用 `read_logs`，后者从上次字节偏移处读取增量内容。

**评估：** ✅ **可接受**
- 每次调用只读取新写入的行，不是全量文件
- 轮询间隔 600ms 适中，不会造成 CPU 或 IO 压力
- Mutex 序列化访问确保不重复读取
- 主要瓶颈在 Tauri IPC 延迟，而非文件 I/O

**建议（不涉及架构变更）：** 如需更实时体验可考虑 Tauri event 推送，但当前方案已满足需求。

### 2.2 main.log 单文件无滚动

**现状：** `tracing_appender::rolling::never` — 文件持续增长直到磁盘满或手动删除。

**评估：** ⚠️ **中等风险**
- 正常使用下日志量不大（仅 INFO 级别，约 10 处调用点）
- 长时间运行（数天）或 debug 场景下文件可达数十 MB
- `read_logs` 的 `file.read_to_string` 在文件很大时可能造成明显延迟（虽然后台线程持有锁，不影响 UI 响应）

**建议：** 改用 `rolling::daily` 或 `rolling::minutely`，或在设置中加日志清理选项。

### 2.3 EnvFilter 硬编码 info 级别

**现状：** `EnvFilter::new("info")` 写死在 `init()` 中，不读设置。

**评估：** ⚠️ **中低风险**
- 排查问题时无法启用 DEBUG/TRACE 级别日志
- 需要重新编译才能调整
- 当前代码库中也没有任何 DEBUG/TRACE 日志调用

**建议：** 从设置文件读取日志级别，允许用户在不重启时切换（需配合简单架构改动）。

### 2.4 LogFormatter 每行调用 SystemTime::now()

**现状：** 每次格式化日志事件时都调用 `SystemTime::now()` 获取 Unix 秒数。

**评估：** ✅ **可忽略**
- `SystemTime::now()` 在 Windows 上是微秒级调用
- 日志事件频率很低（10-100 条/扫描周期）
- 总开销 < 1ms，不是性能瓶颈

### 2.5 性能总结

| 项目 | 评分 | 风险点 |
|------|------|--------|
| 轮询机制 | ✅ 可接受 | 每次只读增量，600ms 间隔适中 |
| 日志滚动 | ⚠️ 改进空间 | 无滚动策略，长期运行文件膨胀 |
| 日志级别 | ⚠️ 改进空间 | 硬编码 info，无法动态切换 |
| 时间戳开销 | ✅ 可忽略 | 微秒级开销 |
| 脱敏正则 | ✅ 可接受 | 快速路径跳过大部分消息 |

---

## 三、覆盖度分析

### 3.1 后端模块覆盖矩阵

| 模块 | 文件 | 日志调用数 | 覆盖情况 |
|------|------|-----------|----------|
| logging | `logging.rs` | 4（含 init） | ✅ 自覆盖完整 |
| scanner | `scanner.rs` | 8 | ✅ 扫描流程完整 |
| pipeline | `pipeline.rs` | 10 | ✅ 翻译流程完整 |
| jobs | `jobs.rs` | 1 | ✅ Job 创建 |
| commands/scan | `commands/scan.rs` | 1 | ⚠️ 仅错误路径 |
| commands/translate | `commands/translate.rs` | 3 | ✅ 创建/完成/取消 |
| commands/logs | `commands/logs.rs` | 无 | N/A （日志消费者） |
| shield | `shield.rs` | 无 | ❌ 无日志 |
| dictionary | `dictionary.rs` | 无 | ❌ 无日志 |
| llm | `llm.rs` | 无 | ❌ 无日志 |
| packer | `packer.rs` | 无 | ❌ 无日志 |
| extractor | (TBD) | 无 | ❌ 无日志 |
| settings | `settings.rs` | 无 | ❌ 无日志 |

### 3.2 关键路径缺口

以下路径明显缺失日志（不在本次修复范围内，仅记录）：

1. **LLM API 调用** — 无请求/响应日志（出于安全考虑，可能会暴露 API Key，但至少应有调用次数和耗时记录）
2. **词典操作** — 无查询/命中/未命中日志，排查翻译质量时无法追溯词典来源
3. **资源包生成** — 无打包开始/完成/条目数日志
4. **设置变更** — 无设置保存/加载日志
5. **Shield 校验** — 无校验失败/通过日志

### 3.3 覆盖度评分

**总体评分：6/10**

- ✅ 扫描和翻译主流程覆盖完整
- ⚠️ 命令层错误路径偶有遗漏
- ❌ 子模块（LLM、词典、打包、Shield、设置）缺少日志
- ❌ 无结构化 span/duration 跟踪

---

## 四、审计结论

| 类别 | 结果 |
|------|------|
| 已修复 BUG | 4 个 |
| 误报 | 1 个 |
| 未修复发现 | 5 个（低风险/范围外） |
| 性能风险 | 2 个（日志滚动、级别可调，均为改进建议） |
| 覆盖度缺口 | 5 个子模块缺少日志 |
| 总体评价 | 核心功能日志可用，但子模块覆盖不足，长期运行有文件膨胀风险 |

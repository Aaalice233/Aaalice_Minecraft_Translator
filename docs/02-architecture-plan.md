# 架构与总体计划

## 技术选型

推荐方案：

```text
Tauri 2 + Rust + React + TypeScript + Vite
```

选择理由：

- Rust 适合高性能文件扫描、zip/jar 读取、并发任务、SQLite 查询和资源包打包。
- Tauri 能生成 Windows `.exe`，体积比 Electron 更可控。
- React + TypeScript 适合做复杂桌面工具界面、状态管理和 Playwright 自动化测试。
- Web 前端利于后续快速调整 UI，不把界面写死在原生控件里。

备选方案：

| 方案 | 优点 | 问题 | 结论 |
| --- | --- | --- | --- |
| Tauri + Rust + React | 性能好、体积小、UI 灵活 | Rust/Tauri 工程复杂度略高 | 推荐 |
| Electron + Node.js | 开发快、生态成熟 | 体积大、资源占用高 | 不推荐作为首选 |
| Python + PySide/PyQt | 脚本开发快 | 打包、性能、异步复杂任务较麻烦 | 可做原型，不做最终主线 |
| C# WPF/WinUI | Windows 原生体验好 | 跨平台和 Web UI 复用弱 | Windows-only 可考虑 |

## 总体架构

```text
src-tauri/
  src/
    main.rs
    commands/
      scan.rs
      translate.rs
      dictionary.rs
      package.rs
      settings.rs
      logs.rs
    core/
      scanner/
      extractor/
      resourcepack/
      dictionary/
      llm/
      shield/
      packer/
      ftb/
      vault_lab/
      logging/
      jobs/
src/
  app/
  pages/
  components/
  stores/
  api/
  styles/
tests/
  fixtures/
  fake-llm-server/
  e2e/
  golden/
docs/
```

## 后端模块

### scanner

职责：

- 校验实例目录。
- 枚举 `mods/`、`resourcepacks/`、FTB Quest 候选目录。
- 生成扫描摘要。

核心输出：

```rust
ScanSummary {
  instance_path,
  mods,
  resource_packs,
  ftb_candidates,
  warnings,
}
```

### extractor

职责：

- 从 jar/zip 中读取语言文件。
- 支持 `.json` 和 `.lang`。
- 归一化为统一 `TranslationEntry`。

### resourcepack

职责：

- 识别已有资源包。
- 读取 `zh_cn` 翻译。
- 标记 i18n/VM/普通资源包来源。
- 生成复用候选。

### dictionary

职责：

- SQLite 词典读写。
- 导入导出。
- 冲突处理。
- 人工纠错。

建议数据库：

```text
data/dictionary.sqlite
```

### shield

职责：

- 占位符保护。
- LLM 前后 token 映射。
- 校验格式完整性。
- 失败报告。

### llm

职责：

- OpenAI-compatible API。
- 批处理。
- 并发限制。
- 失败重试。
- 成本和 token 统计。
- 请求脱敏日志。

### jobs

职责：

- 翻译任务状态机。
- 进度事件广播给前端。
- 暂停、继续、停止、重试失败。

状态：

```text
idle -> scanning -> matching -> translating -> validating -> packaging -> completed
                                           -> failed
                                           -> canceled
```

### packer

职责：

- 生成 `pack.mcmeta`。
- 写入 `assets/<modid>/lang/zh_cn.json`。
- 生成 zip。
- 生成 dry-run diff。
- 复制到 `resourcepacks/`。

## 前端模块

### 页面

- 总览页：实例选择、扫描结果、开始任务。
- 进度页：任务队列、吞吐、失败、费用、ETA。
- 词典页：浏览、搜索、纠错、导入导出。
- 设置页：LLM、性能、资源包复用、日志、实验功能。
- 打包页：资源包确认、冲突处理、复制/替换。
- 日志页：日志过滤、错误详情、导出。
- FTB 页：任务树、任务文本预览、纠错。
- 硬编码实验页：Vault Patcher 草案和风险确认。

### 状态管理

推荐：

- TanStack Query：请求和缓存。
- Zustand：本地 UI 状态。
- Tauri event：任务进度推送。

## 开发阶段计划

### P0：项目初始化

- 初始化 Tauri 2 + React + TypeScript。
- 接入基础布局。
- 建立 Rust command 结构。
- 建立日志目录和设置文件。
- 建立测试 fixture 目录。

验收：

- 能启动桌面程序。
- 能打开总览页。
- 能读取和保存设置。
- `logs/main.log` 启动重置。

### P1：扫描与抽取

- 实例目录选择。
- 扫描 `mods/*.jar`。
- 抽取 `en_us.json` 和 `.lang`。
- 扫描已有 `zh_cn`。
- 扫描资源包 `zh_cn`。

验收：

- fixture modpack 可全自动扫描。
- UI 显示 mod 数、语言条目数、资源包命中数。

### P2：词典系统

- SQLite 词典。
- CFPATools/i18n-dict 导入。
- 资源包翻译入候选池。
- 词典浏览和手动纠错。
- 导入导出。

验收：

- 相同英文文本不重复请求 LLM。
- 手动纠错后重新翻译优先命中用户词典。

### P3：LLM 翻译

- OpenAI-compatible API。
- fake LLM server。
- 并发和 batch size 设置。
- 占位符保护。
- 响应校验。
- 失败重试。

验收：

- 无网络条件下使用 fake LLM 完成端到端测试。
- 占位符破坏时不写入最终结果。

### P4：资源包生成

- 生成 `zh_cn.json`。
- 生成 `pack.mcmeta`。
- 生成 zip。
- 打包确认页。
- 复制或替换到 `resourcepacks/`。

验收：

- golden zip 与预期一致。
- 替换动作必须经过 UI 确认。

### P5：FTB 可选模块

- 扫描 FTB Quest 候选目录。
- 抽取 fixture 覆盖格式。
- 接入词典和 LLM。
- 生成翻译结果。

验收：

- fixture FTB 文件可端到端翻译。
- 不支持格式显示明确错误。

### P6：硬编码实验室

- 只做候选字符串扫描和 Vault Patcher 规则草案。
- 不自动应用补丁。
- UI 强制风险确认。

验收：

- 生成草案但不会修改实例文件。

## 关键风险

| 风险 | 处理 |
| --- | --- |
| LLM 破坏占位符 | shield 模块强校验，失败不落盘 |
| 资源包覆盖用户文件 | dry-run + 用户确认 + 目标路径展示 |
| 词典许可 | CFPA 词典许可单独标注，不把许可风险藏在程序里 |
| FTB 格式差异 | fixture 覆盖格式才自动处理，未知格式显式失败 |
| 硬编码替换误判 | 二期实验区，只生成草案 |
| API Key 泄漏 | 设置加密存储或本地安全存储，日志脱敏 |

## 首期验收标准

- 可选择实例目录。
- 可扫描 mod 语言文件。
- 可识别已有汉化资源包并复用。
- 可导入 CFPATools/i18n-dict。
- 可配置 LLM URL、Key、模型、并发、batch size。
- 可显示翻译进度、失败、ETA、成本。
- 可浏览词典并手动纠错。
- 可生成资源包 zip。
- 可确认后复制或替换资源包。
- 可查看日志和错误详情。
- 可使用 fake LLM 完成全自动端到端测试。

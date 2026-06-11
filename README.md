# Aaalice MC Translator — 整合包翻译工具

> 通过 LLM 批量翻译 Minecraft 模组文本，输出为可直接使用的资源包。

<p align="center">
  <img src="assets/app-icon-source.png" alt="Aaalice MC Translator" width="128" />
</p>

<p align="center">
  <b>简体中文</b> · <a href="#english">English</a>
</p>

---

## 概述

**Aaalice MC Translator** 是一款 Windows 桌面端 Minecraft 整合包汉化工具。它可以：

1. **扫描** Minecraft 整合包实例，从模组 JAR 中提取所有语言文件
2. **复用** 已有资源包（i18n / VM 汉化格式）和本地词典中的翻译
3. **翻译** 通过 OpenAI 兼容的 LLM API（如 DeepSeek、OpenAI）批量翻译剩余未翻译条目，并自动保护占位符
4. **打包** 生成标准 Minecraft 资源包（zip），可直接放入 `resourcepacks/` 目录

### 核心原则

- ❌ 不直接修改原始模组 JAR
- ❌ 不未经确认替换用户已有资源包
- ✅ LLM 只翻译词典和资源包未覆盖的缺口文本
- ✅ 所有格式代码和占位符在翻译前后自动保护
- ✅ 失败和错误在 UI 和日志中均可追溯

---

## 截图预览

| 页面 | 功能 |
|------|------|
| **仪表盘** | 扫描 MC 实例、选择模组、查看待翻译条目 |
| **翻译作业** | 实时查看翻译进度、条目状态分布、重试失败项 |
| **词典管理** | 搜索、编辑、删除词典条目，导入/导出 |
| **校对工作台** | 逐条审查翻译结果，直接编辑修正 |
| **资源包打包** | 生成 zip 资源包并可直接复制到实例 |
| **设置中心** | 多标签页：语言/外观/API/性能/日志/关于 |
| **日志查看器** | 实时日志流，支持级别过滤和暂停 |

---

## 快速开始

### 系统要求

- **操作系统**：Windows 10 / Windows 11（64 位）
- **Minecraft 整合包**：PCL2 / HMCL / 官方启动器 等标准实例目录均可
- **LLM API**：需要 API Key（支持 DeepSeek、OpenAI 等兼容接口）

### 安装

从 [Releases 页面](https://github.com/Aaalice233/Aaalice_Minecraft_Translator/releases) 下载最新版安装器并运行即可。

应用内置自动更新功能，可在「设置 → 关于与更新」中检查更新。

### 使用流程

```
1. 选择 MC 实例目录 ──→ 2. 扫描模组 ──→ 3. 配置 LLM API
    ↓
4. 开始翻译 ──→ 5. 校对结果 ──→ 6. 打包资源包 ──→ 7. 复制到实例
```

---

## 技术栈

### 前端

| 技术 | 用途 |
|------|------|
| React 18 + TypeScript 5 | UI 框架 + 类型安全 |
| Vite 6 | 构建工具 / 开发服务器 |
| Zustand 5 | 全局状态管理（+ useReducer 渐进迁移） |
| react-virtuoso | 虚拟滚动表格 |
| lucide-react | 图标库 |
| Vitest + @testing-library/react | 单元测试 |
| @tauri-apps/plugin-* (dialog / process / updater) | Tauri 原生功能桥接 |

### 后端

| 技术 | 用途 |
|------|------|
| Tauri 2 | 桌面应用框架 |
| Rust 2021 edition | 后端语言 |
| Rayon | 并行 JAR 文件扫描（4 线程池） |
| reqwest (blocking) | LLM API HTTP 客户端（连接池复用） |
| rusqlite (bundled) | SQLite 词典数据库 |
| serde + serde_json | JSON 序列化（camelCase） |
| zip | 读取 JAR / 生成资源包 |
| regex | 占位符匹配与日志脱敏 |
| font-kit | 系统字体枚举 |
| tracing + tracing-appender | 异步文件日志 |

---

## 架构设计

### 翻译流水线（Pipeline）

5 个阶段顺序编排，通过 `Phase` trait 实现：

```
扫描提取阶段 → 词典匹配阶段 → LLM 翻译阶段 → 收尾阶段
     ↓              ↓              ↓             ↓
  扫描 JARs +    词典匹配 +    并发 LLM 请求   汇总结果 +
  提取条目       CFPA 参考    (HTTP 连接池)    持久化词典
```

- **PipelineBuilder** 模式组装各阶段
- **CancelToken** 跨阶段/线程取消机制（atomic flag + active task ID guard）
- **事件驱动进度** 通过 `mpsc::channel` 异步发射到前端
- **检查点恢复** LLM 阶段启动时读取已有 JSONL，跳过已翻译条目

### 占位符保护（Shield）

翻译前用 `__SHIELD_N__` 标记替换 Minecraft 格式代码，LLM 翻译完成后还原并验证完整性：

1. `{{...}}` — 双花括号
2. `<item:...>` — Minecraft tag 引用
3. `§[0-9a-fk-or]` — 颜色/格式码
4. `{player}` — 花括号变量
5. `%s %d %1$s` — Java String.format 占位符

### 词典优先级

```
手动录入 > CFPA 参考 > 资源包 > LLM 翻译
```

- SQLite 存储，FNV-1a 哈希索引实现 O(1) 查找
- 内存缓存 `MemoryDictionary` 加速流水线访问
- CFPA 条目支持三级模糊匹配（精确=1.0 / 前缀=0.8 / 分词子集=0.5）

### LLM 并发模型

- `reqwest::blocking::Client` 连接池复用（避免每次新建 TCP+TLS）
- `std::thread::scope` + `AtomicUsize` 分配批次
- 429 限流自动降速（30s → 60s → 120s 指数退避）
- RPM 限流：`per_worker_delay = (60000 * concurrency / rpm) ms`
- 4 层 JSON 解析修复：标准 JSON → 容错修复 → Markdown 代码块 → 逐行恢复

---

## 项目结构

```
Aaalice_Minecraft_Translator/
├── assets/                  应用图标源 / pack.png
├── data/                    运行期本地数据（.gitignore）
│   ├── settings.json        持久化设置（camelCase）
│   ├── dictionary.sqlite    词典数据库
│   └── jobs/                翻译任务状态 + JSONL 结果
├── docs/                    规格与设计文档
│   ├── 00-index.md          全部文档索引
│   ├── 01-product-spec.md   产品规格
│   ├── 02-architecture-plan.md   架构方案
│   ├── 03-ui-style-guide.md      UI 风格指南
│   └── 04-agent-test-plan.md    自动化测试方案
├── logs/                    运行期日志（.gitignore）
├── scripts/                 打包/PowerShell 脚本
│   ├── package-exe.ps1      构建 NSIS 安装器
│   └── package-exe.bat      批处理包装脚本
├── src/                     React 前端
│   ├── api/tauri.ts         Tauri invoke 懒加载 + 浏览器 mock
│   ├── app/                 App 壳 + AppContext + useReducer
│   ├── pages/               7 个功能页面
│   ├── components/          通用组件库
│   ├── hooks/               通用 hook
│   ├── stores/appStore.ts   Zustand 全局状态
│   ├── i18n/translations.ts 5 语言字典
│   ├── mocks/               浏览器预览 mock 数据
│   └── styles/app.css       全局样式
├── src-tauri/               Tauri 2 + Rust 后端
│   ├── src/commands/        12 个 Tauri command 模块
│   ├── src/core/            9 个核心逻辑模块
│   ├── tauri.conf.json      窗口 / 打包 / 更新器配置
│   └── capabilities/        Tauri 2 权限声明
├── tests/                   前端 + 集成测试
│   ├── fixtures/            测试用 MC 实例（含 fake mod JARs）
│   └── setup.ts             Vitest 设置（jsdom）
├── AGENTS.md                AI 辅助开发参考手册
├── CHANGELOG.md             版本变更日志
├── CLAUDE.md                项目指令（→ @AGENTS.md）
└── package.json / tsconfig.json / vite.config.ts
```

---

## 开发指南

### 环境要求

- **Node.js** 20+
- **Rust** 1.76+（stable）
- **npm** 10+

### 常用命令

| 操作 | 命令 | 说明 |
|------|------|------|
| 开发热重载 | `npm run tauri dev` | Vite HMR + Rust 增量编译 |
| 前端构建 | `npm run build` | `tsc && vite build` |
| 前端测试 | `npm run test:unit` | Vitest（jsdom 环境） |
| Rust 测试 | `npm run test:rust` 或 `cd src-tauri && cargo test` | 含 76+ 单元测试 + 9 集成测试 |
| 生成安装器 | `npm run package:exe` | NSIS 安装器（自动加载签名密钥） |
| 生成便携版 | `npm run package:app` | 同上，跳过 NSIS 打包 |
| 发布新版本 | `git tag vX.Y.Z && git push origin vX.Y.Z` | → GitHub Actions 自动构建发布 |

### 类型同步约定

前后端数据结构通过 camelCase JSON 同步：

```rust
// Rust: #[serde(rename_all = "camelCase")]
// TypeScript: 同名接口（src/types.ts ←→ src-tauri/src/core/models.rs）
```

两端加/改字段时必须同步更新对方，文件内均有 `⚠️ TYPE SYNC` 注释标注。

---

## 发布流程

遵循 [SemVer](https://semver.org/) 版本规范。

1. 更新版本号：`tauri.conf.json` + `Cargo.toml` + `package.json`
2. 更新 `CHANGELOG.md`
3. `git commit + git tag vX.Y.Z + git push origin main vX.Y.Z`
4. GitHub Actions 自动：构建 → 签名 → 发布到 Releases
5. 应用内检查更新验证

详情见 [AGENTS.md](AGENTS.md)「发布流程」章节。

---

## 许可证

本项目为私有软件，代码托管于 [GitHub](https://github.com/Aaalice233/Aaalice_Minecraft_Translator)。

---

## English

<a id="english"></a>

# Aaalice MC Translator — Modpack Translation Tool

> Batch-translate Minecraft mod text via LLM and output as a ready-to-use resource pack.

### Overview

A Windows desktop tool for Minecraft modpack localization. It scans mod JARs for language files, reuses existing Chinese translations from resource packs and dictionaries, fills gaps via OpenAI-compatible LLM APIs, and packages the result as a standard Minecraft resource pack (zip).

### Tech Stack

**Frontend**: React 18 + TypeScript 5 + Vite 6 + Zustand 5  
**Backend**: Tauri 2 + Rust 2021 + Rayon + reqwest + rusqlite  
**Testing**: Vitest (frontend) + cargo test (backend, 85+ tests)

### Quick Start

1. Download the installer from [Releases](https://github.com/Aaalice233/Aaalice_Minecraft_Translator/releases)
2. Launch the app and select your Minecraft instance directory
3. Configure your LLM API (DeepSeek, OpenAI, or compatible)
4. Scan mods → Translate → Review → Pack → Play!

### Development

```bash
npm run tauri dev     # Hot-reload dev server
npm run test:unit     # Frontend tests
npm run test:rust     # Backend tests
npm run package:exe   # Build installer
```

---

## 参考项目

- [MineAI-Modpack-Translator](https://github.com/Thedrezik/MineAI-Modpack-Translator)
- [mc-autotranslator](https://gitee.com/li27744/mc-autotranslator)

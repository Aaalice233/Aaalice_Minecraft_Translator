# Aaalice_Minecraft_Translator

> 整合包翻译工具——通过 LLM 批量翻译模组文本，输出为资源包。

---

## 基本信息

| 字段 | 内容 |
|------|------|
| **名称** | Aaalice Minecraft Translator（整合包翻译工具） |
| **定位** | Windows 桌面端 Minecraft 整合包汉化工具 |
| **版本** | 0.1.0 |
| **本地路径** | `E:/MC Projects/Aaalice_Minecraft_Translator/` |
| **MC 实例** | `E:/PCL2/.minecraft/versions/Aaalice Craft` |
| **Git 地址** | `https://github.com/Aaalice233/Aaalice_Minecraft_Translator`（私有） |
| **技术栈** | Tauri 2 + Rust + React 18 + TypeScript + Vite 6 |
| **包管理** | npm |
| **应用 ID** | `com.aaalice.minecraft-translator` |

---

## 项目结构

```
Aaalice_Minecraft_Translator/
├── assets/                   # 应用图标源（app-icon-source.png）
├── data/                     # 运行期本地数据目录（.gitignore）
│   ├── settings.json         # 持久化设置（JSON，serde camelCase）
│   ├── dictionary.sqlite     # 词典数据库（SQLite）
│   └── jobs/                 # 翻译任务状态和结果
│       ├── translate_<ts>.json          # Job 轻量状态文件
│       └── translate_<ts>_results.jsonl # 逐行 JSONL 结果
├── docs/                     # 规格与设计文档
│   ├── 00-index.md
│   ├── 01-product-spec.md
│   ├── 02-architecture-plan.md
│   ├── 03-ui-style-guide.md
│   ├── 04-agent-test-plan.md
│   ├── 05-pipeline-refactor-prd.md
│   ├── audit/                # 架构审计记录
│   ├── superpowers/          # 功能增强设计文档
│   └── ui-reference/         # UI 参考图（images/ 子目录）
├── logs/                     # 运行期日志（.gitignore）
│   ├── main.log              # 主日志 [unix_seconds] LEVEL message
│   ├── redact.log            # 脱敏摘要日志
│   ├── errors/               # 预留
│   └── jobs/                 # 预留
├── scripts/
│   ├── package-exe.bat       # 双击一键打包入口
│   └── package-exe.ps1       # PowerShell 打包脚本
├── src/                      # React + TypeScript 前端（Vite + HMR）
│   ├── main.tsx              # 入口：ReactDOM.createRoot
│   ├── types.ts              # 前端所有类型定义（⚠️ 与 models.rs 同步）
│   ├── api/
│   │   └── tauri.ts          # Tauri invoke 懒加载封装 + 浏览器预览 mock
│   ├── app/
│   │   ├── App.tsx           # 应用壳：侧边栏导航 + 页面路由
│   │   └── AppContext.tsx    # useReducer 全局状态（正在被 Zustand 替代）
│   ├── pages/
│   │   ├── DashboardPage.tsx # 扫描概览：实例选择、扫描进度、模组列表
│   │   ├── JobsPage.tsx      # 翻译任务：启动/停止/进度/日志
│   │   ├── DictionaryPage.tsx# 词典管理：搜索/编辑/导入/导出
│   │   ├── PackagesPage.tsx  # 资源包生成：预览/打包/部署
│   │   ├── ValidatePage.tsx  # 翻译校验：占位符/格式检查
│   │   ├── SettingsPage.tsx  # 设置：7 选项卡（语言/API/性能/复用/日志/高级/外观）
│   │   ├── LogsPage.tsx      # 日志中心
│   │   └── PlaceholderPage.tsx # FTB / 硬编码占位页
│   ├── components/
│   │   ├── SplashScreen.tsx    # 启动屏（品牌动画 + 预热进度）
│   │   └── CompletionSummary.tsx # 翻译完成摘要
│   ├── hooks/
│   │   └── useDebouncedValue.ts # 防抖 hook
│   ├── stores/
│   │   └── appStore.ts       # Zustand 全局状态（渐进替代 AppContext）
│   ├── i18n/
│   │   └── translations.ts   # 4+1 语言字典（zh_cn/en_us/ja_jp/ko_kr/ru_ru）
│   └── styles/
│       └── app.css           # 全局样式：6px 圆角、进度条动画、桌面工具风格
├── src-tauri/                # Tauri 2 + Rust 后端
│   ├── Cargo.toml            # 依赖：rayon、reqwest(blocking+json)、rusqlite、zip 等
│   ├── tauri.conf.json       # Tauri 配置：窗口 1365x768、NSIS 打包
│   ├── icons/                # 全套应用图标（32x32 ~ 512x512, ico, icns）
│   └── src/
│       ├── main.rs           # fn main() → 调用 lib::run()
│       ├── lib.rs            # Tauri Builder 注册所有 command + 插件
│       ├── commands/         # Tauri command 暴露层（每个功能一个子模块）
│       │   ├── settings.rs   # get_settings / save_settings
│       │   ├── scan.rs       # validate_instance / scan_instance / cancel_scan
│       │   ├── translate.rs  # start_translation / cancel_translation / retry_failed_entries
│       │   ├── jobs.rs       # get/load/list translation jobs
│       │   ├── pack.rs       # generate_translation_pack / generate_pack_from_job / copy_pack_to_instance
│       │   ├── llm.rs        # fetch_llm_models
│       │   ├── dictionary.rs # search / update / delete / export / import / stats
│       │   ├── validate.rs   # validate_translation
│       │   ├── logs.rs       # read_logs
│       │   ├── fonts.rs      # list_fonts
│       │   ├── game.rs       # pick_instance_folder / open_path
│       │   └── warmup.rs     # run_warmup / cancel_warmup（预热 pipeline）
│       └── core/             # 后端核心逻辑
│           ├── models.rs       # 所有数据模型（⚠️ 与 types.ts 同步）
│           ├── settings.rs     # JSON 持久化 + 校验（temperature/concurrency/batch等范围检查）
│           ├── scanner.rs      # 并行扫描 jars（rayon, zip, 进度回调）
│           ├── pipeline.rs     # 翻译流水线编排（Phase trait, 5 阶段：scan→extract→dict→llm→finalize）
│           ├── llm.rs          # OpenAI-compatible HTTP client（并发批次、429 降级、重试）
│           ├── shield.rs       # 占位符保护/恢复/验证（%s, §a, {player}, <item:> 等）
│           ├── dictionary.rs   # SQLite 词典（哈希搜索、CFPA 模糊匹配）
│           ├── cfpa.rs         # CFPA 词典集成（fuzzy_search）
│           ├── packer.rs       # 资源包生成（assets/<modid>/lang/<target>.json → zip）
│           ├── jobs.rs         # Job 状态管理（JSON 状态 + JSONL 结果）
│           ├── paths.rs        # 运行时根路径解析 + 各数据文件路径
│           ├── logging.rs      # tracing + tracing-appender 异步文件日志
│           │   └── redact.rs   # API 密钥脱敏
│           └── mod.rs          # 模块声明
├── tests/                   # 前端单元测试（Vitest + jsdom）
│   ├── app.test.tsx          # App 壳 / Sidebar / SettingsPage 渲染测试
│   ├── validate.test.tsx     # 校验页面测试
│   └── fixtures/             # Minecraft fixture 数据
├── dev-reload.ps1           # 一键重启热重载脚本
├── index.html               # HTML 入口（lang=zh-CN）
├── package.json             # 依赖与脚本
├── tsconfig.json            # TypeScript 配置（ES2020, strict, react-jsx）
├── vite.config.ts           # Vite 配置（host 127.0.0.1:1420, strictPort, jsdom test）
└── AGENTS.md                # 本文件
```

---

## 命令速查

| 操作 | 命令 | 说明 |
|------|------|------|
| 开发热重载 | `npm run tauri dev` | **日常使用**，Vite HMR + Rust 增量编译 |
| 一键重启 HMR | `.\dev-reload.ps1` | 清理旧进程（端口 1420 / Tauri / cargo）后启动 |
| 前端构建 | `npm run build` | `tsc && vite build` |
| 前端预览 | `npm run preview` | `vite preview` |
| 前端测试 | `npm run test:unit` | `vitest run`（jsdom 环境） |
| Rust 测试 | `npm run test:rust` | `cd src-tauri && cargo test` |
| Rust 测试（直接） | `cd src-tauri && cargo test` | 含 settings 反序列化等单元测试 |
| 生成安装器 | `npm run package:exe` | 前端 build → Rust release → NSIS 安装器 |
| 生成 release exe | `npm run package:app` | 同上，但跳过 NSIS 打包（`-NoBundle`） |
| 一键打包 | 双击 `scripts/package-exe.bat` | |

### 产物路径

- 开发模式 exe：`src-tauri/target/debug/aaalice_mc_translator.exe`
- Release exe：`src-tauri/target/release/aaalice_mc_translator.exe`
- NSIS 安装器：`src-tauri/target/release/bundle/nsis/Aaalice MC Translator_0.1.0_x64-setup.exe`

---

## 技术栈详情

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | ^18.3.1 | UI 框架 |
| TypeScript | ^5.6.3 | 类型安全 |
| Vite | ^6.0.1 | 构建/开发服务器 |
| Zustand | ^5.0.14 | 全局状态管理 |
| lucide-react | ^0.468.0 | 图标库 |
| react-virtuoso | ^4.18.7 | 虚拟滚动列表 |
| @tauri-apps/api | ^2.5.0 | Tauri 前端桥接 |
| @vitejs/plugin-react | ^4.3.4 | Vite React 插件 |
| Vitest | ^2.1.8 | 测试框架 |
| @testing-library/react | ^16.1.0 | 组件测试 |
| jsdom | ^25.0.1 | DOM 环境模拟 |

### 后端

| 技术 | 用途 |
|------|------|
| Tauri 2 | 桌面框架 |
| Rayon 1 | 并行 jar 扫描 |
| reqwest 0.12 (blocking+json) | LLM API HTTP 客户端 |
| rusqlite 0.31 (bundled) | SQLite 词典 |
| serde 1 + serde_json 1 | JSON 序列化（camelCase） |
| zip 2 | 资源包 zip 生成 |
| regex 1 | 占位符匹配 |
| tracing 0.1 + tracing-appender 0.2 | 异步文件日志 |
| tauri-plugin-dialog 2 | 原生文件夹选择对话框 |
| font-kit 0.14 | 系统字体枚举 |

---

## 架构与设计模式

### 翻译流水线（Pipeline）

5 阶段顺序编排，通过 `Phase` trait 实现：

```
ScanExtractPhase → DictionaryPhase → LlmPhase → FinalizePhase
     ↓                  ↓               ↓            ↓
  扫描JARs +       词典匹配 +      并发LLM请求    汇总结果 +
  提取条目          CFPA参考      (HTTP pool)     持久化状态
```

- **PipelineBuilder** 模式组装阶段，每个阶段实现 `Phase` trait
- **CancelToken** 跨阶段/跨线程取消机制（atomic flag + active task ID guard）
- **进度事件**通过 `mpsc::channel` 异步发射到前端（`PipelineProgress`, `EntryProgress`, `TranslateLogEntry`）
- **检查点恢复**：LLM 阶段启动时读取已有 JSONL，跳过已翻译条目

### 状态管理（前端）

渐进迁移中：`AppContext (useReducer)` → **Zustand** (`stores/appStore.ts`)

- `App.tsx` 中双向同步：Context dispatch → Zustand store
- 页面逐步迁移到直接 `useAppStore()` 选择器
- 侧边栏导航状态三态：`idle` / `busy` / `completed`

### Tauri API 懒加载

`src/api/tauri.ts`：

- 运行时检测 `__TAURI_INTERNALS__` 决定使用 Tauri invoke 还是 localStorage mock
- 所有函数使用动态 `import("@tauri-apps/api/core")`，不静态加载
- 浏览器预览模式：`getSettings`/`saveSettings` → localStorage；其余 API 抛友好错误或返回空数据

### 类型同步契约

```rust
// src-tauri/src/core/models.rs — #[serde(rename_all = "camelCase")]
//   ⇅ JSON camelCase
// src/types.ts — 同名接口
```

- 两端加/改字段时必须同步更新对方（文件内均有 `⚠️ TYPE SYNC` 注释）
- Rust 端使用 `#[serde(default)]` 保证向前兼容

### 占位符保护（Shield）

翻译前将 Minecraft 格式代码、占位符替换为 `__SHIELD_N__` 标记，LLM 翻译完成后还原并验证完整性：

1. `{{...}}` 双花括号
2. `<item:...>` Minecraft tag 引用
3. `§[0-9a-fk-or]` 颜色/格式码
4. `{player}` 花括号变量
5. `%s %d %1$s` Java String.format 占位符

---

## 编程规范

### 通用

- **PR/提交信息**：`type(scope): 中文描述`，不超过 72 字。scope 可选。正文可选，空一行后用中文 bullet points。
  - type: `feat` / `fix` / `refactor` / `perf` / `style` / `docs` / `test` / `chore`
- 代码、命令、路径、配置字段、API 名称和专有名词保持原样；用户面向的回应优先使用简体中文。

### Rust 后端

- 使用 `2021 edition`，目标 `rustc 1.96+`
- `#![allow(rust_2021_prefixes_incompatible_syntax)]` → 字符串中大量 `.json` / `.lang` 扩展名需此 lint
- 错误处理：`Result<T, String>` 为主；`PipelineError` 枚举分类：`Config` / `Io` / `Llm` / `Cancelled` / `NotFound` / `Internal` / `Dictionary`
- 序列化：`#[serde(rename_all = "camelCase")]` + `#[serde(default)]` 保证 JSON 字段为 camelCase
- 并发：`rayon::ThreadPoolBuilder::new().num_threads(4)`（限制扫描线数以避免 UI 线程饥饿）
- 全局状态：`static GLOBAL_CANCEL: LazyLock<CancelToken>` + `AtomicBool` + `Mutex`
- 日志：`tracing` macros (`info!`, `warn!`, `error!`, `trace!`) + `logging::append_main` / `logging::append_job` 辅助函数
- 测试：`#[cfg(test)] mod tests` 内联，主要做反序列化兼容性测试

### TypeScript 前端

- 严格模式：`tsconfig.json` 中 `strict: true`
- React 函数组件 + Hooks（无 class 组件）
- 类型定义集中在 `src/types.ts`（与 Rust `models.rs`——对应）
- i18n：`TranslationKey` 联合类型保证编译期检查；4+1 语言字典（zh_cn → en_us → ja_jp → ko_kr → ru_ru）
- 状态管理渐近迁移中：`AppContext (useReducer)` → `Zustand (appStore.ts)`
- CSS：全局样式在 `app.css`，`6px` 圆角、lucide-react 图标、`data-theme` 属性换主题

### 测试

- 前端：Vitest + jsdom + @testing-library/react，测试文件在 `tests/` 目录
- 后端：`cargo test`，单元测试内联在 `mod tests` 中
- 新增测试优先补最小 fixture（放在 `tests/fixtures/`）

---

## 关键架构决策

### Tauri API 懒加载模式

`src/api/tauri.ts` 不静态 `import { invoke }`，而是运行时动态 import。浏览器预览模式下：
- `getSettings()` → 读 localStorage
- `saveSettings()` → 写 localStorage
- `validateInstance()` / `scanInstance()` → 抛友好错误
- `fetchLlmModels()` → 返回硬编码 mock 列表

### 扫描进度事件

`scanner.rs` 使用 rayon 并行扫描 jars，通过 `&(dyn Fn(ScanProgress) + Sync)` 回调 → `commands/` 层 → `app.emit("scan-progress")` → 前端 `DashboardPage.tsx` 动态 `listen("scan-progress")` 更新进度条。

### LLM 并发模型

- `reqwest::blocking::Client` 连接池复用（避免每次新建 TCP+TLS）
- 并发工作池使用 `std::thread::scope` + `AtomicUsize` 分配批次
- 连续 429 错误自动降速（30s → 60s → 120s 等待）
- RPM 限流：`per_worker_delay = (60000 * concurrency / rpm)` ms

### 设置校验

`settings.rs` 中 `validate_settings()` 强制执行范围：
- temperature: 0.0–2.0
- concurrency: 1–100
- batchSize: 1–500
- timeoutSecs: 10–600
- retryCount: ≤ 20

---

## 项目文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 文档索引 | `docs/00-index.md` | 全部文档导航 |
| 产品规格 | `docs/01-product-spec.md` | 功能需求与范围 |
| 架构与计划 | `docs/02-architecture-plan.md` | 系统架构与分阶段实施计划 |
| UI 风格指南 | `docs/03-ui-style-guide.md` | 视觉统一规范 |
| Agent 测试计划 | `docs/04-agent-test-plan.md` | 自动化测试框架 |
| UI 参考图 | `docs/ui-reference/README.md` | 参考图说明 |
| 参考图目录 | `docs/ui-reference/images/` | 09 张参考图（Logo / 仪表盘 / 翻译进度 / 词典 / 设置 / 打包 / 日志 / FTB / 硬编码） |

---

## 当前约定

- 首期主线：模组语言文件扫描 → 资源包复用 → 词典复用 → LLM 翻译 → 资源包打包 → 日志 → 自动化测试。
- FTB 任务汉化作为首期可选模块预留。
- 硬编码汉化只进入二期实验室，不自动应用补丁。
- **不直接修改原始 mod jar。**
- **不未经确认替换用户已有资源包。**
- 应用自身支持 `zh_cn` / `en_us` / `ja_jp` / `ko_kr` / `ru_ru` 五种 UI 语言，默认 `zh_cn`。
- 新增 UI 文案必须写入 `src/i18n/translations.ts` `TranslationKey` + 各语言字典，不要在组件里硬编码。
- 翻译语言使用 Minecraft locale code，例如 `en_us` / `zh_cn` / `ja_jp` / `ko_kr`。
- 来源语言允许 `auto`，目标语言禁止 `auto`；`sourceLanguage=auto` 时优先使用 `en_us`。
- 生成资源包时语言文件路径：`assets/<modid>/lang/<targetLanguage>.json`。
- 项目使用 Git；`.gitignore` 忽略：`.pi/`、`dist/`、`build/`、`target/`、`node_modules/`、`logs/`、`data/`、`*.log`、`.env` 等运行时/构建产物。

---

## 依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri 2 Shell                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Rust Backend (commands/ + core/)                    │   │
│  │  ├─ scanner (rayon 并行 jar 扫描)                     │   │
│  │  ├─ pipeline (Phase trait 编排)                      │   │
│  │  │  ├─ shield.rs (占位符保护)                         │   │
│  │  │  ├─ dictionary.rs (SQLite 词典)                    │   │
│  │  │  ├─ cfpa.rs (CFPA 参考集成)                       │   │
│  │  │  ├─ llm.rs (并发 HTTP 翻译)                       │   │
│  │  │  └─ packer.rs (zip 资源包生成)                     │   │
│  │  ├─ settings.rs (JSON 持久化 + 校验)                   │   │
│  │  ├─ jobs.rs (任务状态管理)                              │   │
│  │  ├─ logging.rs (tracing 异步日志)                      │   │
│  │  └─ paths.rs (运行时路径)                              │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  React Frontend (Vite HMR)                           │   │
│  │  ├─ App.tsx → 侧边栏 + 页面路由                       │   │
│  │  ├─ pages/ → 8 个功能页面                              │   │
│  │  ├─ api/tauri.ts → Tauri invoke 封装                 │   │
│  │  ├─ stores/appStore.ts → Zustand 全局状态            │   │
│  │  ├─ i18n/translations.ts → 多语言字典                │   │
│  │  └─ types.ts → 前端类型定义                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 参考项目

- MineAI-Modpack-Translator：`https://github.com/Thedrezik/MineAI-Modpack-Translator`
- mc-autotranslator：`https://gitee.com/li27744/mc-autotranslator`
- 参考项目只用于对照扫描、翻译、资源包生成和异常兼容思路；具体实现仍以本项目规格、当前代码和用户最新要求为准。

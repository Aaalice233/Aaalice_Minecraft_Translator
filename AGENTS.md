# Aaalice_Minecraft_Translator

> 整合包翻译工具——通过 LLM 批量翻译模组文本，输出为资源包。

---

## 基本信息

| 字段 | 内容 |
|------|------|
| **名称** | Aaalice Minecraft Translator（整合包翻译工具） |
| **定位** | Windows 桌面端 Minecraft 整合包汉化工具 |
| **本地路径** | `E:/MC Projects/Aaalice_Minecraft_Translator/` |
| **MC 实例** | `E:/PCL2/.minecraft/versions/Aaalice Craft` |
| **Git 地址** | `https://github.com/Aaalice233/Aaalice_Minecraft_Translator`（私有） |
| **技术栈** | Tauri 2 + Rust + React + TypeScript + Vite |

## 项目文档

- 规格与文档索引：`docs/00-index.md`
- 产品规格：`docs/01-product-spec.md`
- 架构与总体计划：`docs/02-architecture-plan.md`
- UI 风格对齐文档：`docs/03-ui-style-guide.md`
- 面向 agent 的自动化测试框架：`docs/04-agent-test-plan.md`

## 项目结构

- `src/`：React + TypeScript 前端，包含应用壳、页面、Tauri API 封装、i18n 字典和样式。
- `src/app/`：全局布局、左侧导航、当前页面切换和全局设置读取。
- `src/pages/`：DashboardPage（总览含扫描进度条）、SettingsPage（6 选项卡 + 模型下拉选择）、LogsPage。
- `src/api/tauri.ts`：Tauri invoke 的懒加载封装。静态不引入 `@tauri-apps/api`，运行时仅在 `__TAURI_INTERNALS__` 存在时动态 import。浏览器预览模式使用 localStorage + mock 数据。
- `src/i18n/translations.ts`：4 语言字典（zh_cn / en_us / ja_jp / ko_kr），t() 参数插值，enUs 以 zhCn 为 fallback。
- `src/styles/app.css`：全局样式，桌面工具风格 + 6px 圆角控件 + 进度条动画。
- `src-tauri/`：Tauri 2 + Rust 后端，负责设置持久化、实例扫描、日志、LLM 模型拉取和后续翻译/打包流水线。
- `src-tauri/src/core/`：后端核心逻辑模块：`settings`（JSON 持久化）、`scanner`（rayon 并行 + 进度事件）、`logging`（文件日志 + 脱敏）、`paths`（运行时根路径）、`models`（数据模型 + Default impl）。
- `src-tauri/src/commands.rs`：Tauri command 暴露层，含进度事件发射（scan-progress）和 AppHandle 管理。
- `src-tauri/Cargo.toml`：依赖 `rayon`、`reqwest`（blocking+json）、`serde`、`zip`、`tauri 2`。
- `tests/`：前端单元测试和 Minecraft fixture；新增行为优先补最小 fixture 测试。
- `docs/`：产品规格、架构计划、UI 风格和 agent 测试计划。
- `scripts/`：Windows 打包脚本（package-exe.bat / .ps1）。
- `data/`：运行期本地数据目录，例如 `settings.json`；不要把用户本地设置当成源码常量。
- `assets/`：应用图标源和后续可复用静态资产。

## 关键架构决策

### Tauri API 懒加载模式

`src/api/tauri.ts` 不使用模块级静态 `import { invoke }`，而是通过 `tauriInvoke<T>()` 函数在调用时动态 `import("@tauri-apps/api/core")`。这样浏览器预览模式不会加载 Tauri 原生模块，避免 `window.__TAURI_INTERNALS__` 不存在的崩溃。

浏览器预览模式下：
- `getSettings()` → 读 localStorage
- `saveSettings()` → 写 localStorage
- `validateInstance()` / `scanInstance()` → 抛友好错误
- `fetchLlmModels()` → 返回硬编码 mock 列表

### 扫描进度事件

`src-tauri/src/core/scanner.rs` 使用 rayon 并行扫描 jars，通过 `&(dyn Fn(ScanProgress) + Sync)` 进度回调将进度传递到 `commands.rs`，再由 `app.emit("scan-progress", payload)` 发射到前端。

前端 `DashboardPage.tsx` 在 `useEffect` 中通过 `__TAURI_INTERNALS__` 守卫后动态 `import("@tauri-apps/api/event")` 注册 `listen("scan-progress")`，更新进度条组件。

### 模型下拉选择

设置页 API 选项卡使用 `<select>` + "输入自定义模型" 切换按钮代替 `<datalist>`，避免浏览器兼容问题和用户感知的"拉取后无反应"。

## 参考项目

- MineAI-Modpack-Translator：`https://github.com/Thedrezik/MineAI-Modpack-Translator`
- mc-autotranslator：`https://gitee.com/li27744/mc-autotranslator`
- 参考项目只用于对照扫描、翻译、资源包生成和异常兼容思路；具体实现仍以本项目规格、当前代码和用户最新要求为准。

## UI 参考图

- UI 参考图说明：`docs/ui-reference/README.md`
- UI 参考图目录：`docs/ui-reference/images/`

当前参考图包含：

- `01-brand-logo.png`
- `02-dashboard.png`
- `03-translation-progress.png`
- `04-dictionary-browser.png`
- `05-settings.png`
- `06-packaging-confirmation.png`
- `07-logs-diagnostics.png`
- `08-ftb-quests.png`
- `09-hardcoded-lab.png`

## 打包流程

### 常用命令

- **开发模式（热重载）**：`npm run tauri dev` ← **日常使用**
  - 改 React/TypeScript → Vite HMR 即时生效，无需手动刷新
  - 改 Rust → Tauri 自动检测变化 → 增量编译 → 重启窗口
  - Rust 增量编译通常 3–10s（首次编译约 1–2min）
  - 开发期不要用 `npm run build` + `cargo build --release` 每次测试，太慢
- **前端构建验证**：`npm run build`
- **前端单元测试**：`npm run test:unit`
- **Rust 后端测试**：`cd src-tauri && cargo test`
- **生成 Windows 安装器**：`npm run package:exe`
- **生成未打包 release 主程序**：`npm run package:app`
- **双击一键打包**：`scripts/package-exe.bat`

### 产物路径

- 直接运行版 exe：`src-tauri/target/release/aaalice_mc_translator.exe`
- NSIS 安装器：`src-tauri/target/release/bundle/nsis/Aaalice MC Translator_0.1.0_x64-setup.exe`
- 应用图标源：`assets/app-icon-source.png`
- Tauri 全套图标：`src-tauri/icons/`

### 注意点

- 本项目使用 Tauri 2 打包；Windows 安装器目标为 `nsis`，配置在 `src-tauri/tauri.conf.json`。
- Rust 通过 `rustup` 安装后，新 shell 才可能自动识别 `cargo`；脚本会主动把 `%USERPROFILE%/.cargo/bin` 加入 `PATH`。
- 首次打包 NSIS 安装器时，Tauri 可能下载 `nsis-3.11.zip` 和 `nsis_tauri_utils.dll`；如果遇到 socket、TLS 或网络权限错误，需要允许联网后重跑 `npm run package:exe`。
- `npm run package:exe` 会先执行前端 build，再执行 Tauri release build，并生成安装器。
- 不要手工裁 UI 参考图当应用图标；图标源应使用独立生成的正方形图标 `assets/app-icon-source.png`，再通过 `npm run tauri icon assets/app-icon-source.png` 生成全套图标。
- `npm audit fix --force` 可能升级依赖并破坏当前可打包状态；除非明确处理依赖安全问题，不要在普通打包流程里自动执行。

## 当前约定

- 首期主线：模组语言文件扫描、资源包复用、词典复用、LLM 翻译、资源包打包、日志和自动化测试。
- FTB 任务汉化作为首期可选模块预留。
- 硬编码汉化只进入二期实验室，不自动应用补丁。
- 不直接修改原始 mod jar。
- 不未经确认替换用户已有资源包。
- 应用自身必须支持 `zh_cn`、`en_us`、`ja_jp`、`ko_kr` 四种 UI 语言，默认 `zh_cn`。
- 应用语言在设置菜单切换并持久化；新增 UI 文案必须写入 `src/i18n/`，不要在组件里新增散落的硬编码可见文本。
- 翻译流水线必须支持选择来源语言和目标语言；来源语言默认 `auto`，目标语言默认 `zh_cn`。
- 翻译语言使用 Minecraft locale code，例如 `en_us`、`zh_cn`、`ja_jp`、`ko_kr`；来源语言允许 `auto`，目标语言禁止 `auto`。
- 扫描、资源包复用、词典命中、LLM prompt、输出目录和 zip 命名都必须尊重 `sourceLanguage` / `targetLanguage`，不要重新写死 `en_us -> zh_cn`。
- `sourceLanguage=auto` 时优先使用 `en_us`，没有 `en_us` 时再按当前扫描结果选择可用来源语言，并在结果中记录实际来源语言。
- 生成资源包时语言文件路径应为 `assets/<modid>/lang/<targetLanguage>.json`，输出目录和 zip 名应带 `<targetLanguage>`。

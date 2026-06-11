# Aaalice_Minecraft_Translator

> 整合包翻译工具——通过 LLM 批量翻译模组文本，输出为资源包。

---

## 基本信息

| 字段 | 内容 |
|------|------|
| **名称** | Aaalice Minecraft Translator（整合包翻译工具） |
| **定位** | Windows 桌面端 Minecraft 整合包汉化工具 |
| **版本** | 0.2.0 |
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
├── assets/                  应用图标源
├── data/                    运行期本地数据（.gitignore）
│   ├── settings.json        持久化设置（camelCase）
│   ├── dictionary.sqlite    词典数据库
│   └── jobs/                翻译任务状态 + JSONL 结果
├── docs/                    规格与设计文档（00-index.md 索引全部）
├── logs/                    运行期日志（.gitignore）
├── .github/workflows/       CI 发布流水线（release.yml）
├── scripts/                 package-exe 打包脚本
├── src/                     React 前端（Vite + HMR）
│   ├── main.tsx             入口
│   ├── types.ts             所有类型定义（⚠️ 与 models.rs 同步）
│   ├── api/tauri.ts         Tauri invoke 懒加载 + 浏览器 mock + updater API
│   ├── app/                 App 壳 + useReducer 状态（→ Zustand 迁移中）
│   ├── pages/               8 个功能页面（Dashboard/Jobs/Dict/Packages/Validate/Settings/Logs/FTB）
│   ├── components/          UI 通用组件（DataTable/SearchInput/SortableTableHeader 等）
│   ├── hooks/               通用 hook（useSortFilter / useDebouncedValue）
│   ├── stores/appStore.ts   Zustand 全局状态
│   ├── i18n/translations.ts 4+1 语言字典
│   └── styles/app.css       全局样式
├── src-tauri/               Tauri 2 + Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json      窗口 1365x768、NSIS 打包、updater 配置
│   ├── capabilities/        Tauri 2 权限声明（updater/process/dialog）
│   ├── nsi-hooks/           NSIS 安装器钩子（路径选择器）
│   ├── icons/
│   └── src/
│       ├── commands/        9 个 Tauri command 模块
│       └── core/            核心逻辑（scanner/pipeline/shield/dictionary/cfpa/llm/packer/jobs/paths/logging）
├── tests/                   前端单元测试（Vitest）
└── 配置文件（package.json / tsconfig.json / vite.config.ts）
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
| 生成安装器 | `npm run package:exe` | Rust release → NSIS 安装器（自动从 `.env.local` 加载签名密钥） |
| 生成 exe 便携版 | `npm run package:app` | 同上，跳过 NSIS 打包（`-NoBundle`） |
| 发布新版本 | `git tag vX.Y.Z && git push origin vX.Y.Z` | 推送 tag → GitHub Actions 自动构建、ed25519 签名、发布到 Releases。需先在 GitHub Secrets 配置 `UPDATER_SIGN_PRIVATE_KEY`。CI 位于 `.github/workflows/release.yml`。 |
| 一键打包 | 双击 `scripts/package-exe.bat` | |

### 产物路径

- 开发模式 exe：`src-tauri/target/debug/aaalice_mc_translator.exe`
- Release exe：`src-tauri/target/release/aaalice_mc_translator.exe`
- NSIS 安装器：`src-tauri/target/release/bundle/nsis/Aaalice MC Translator_<version>_x64-setup.exe`

---

## 发布流程

### 版本规范

遵循 [SemVer](https://semver.org/)：`主版本.次版本.修订号`
- 新功能 → 增加次版本（如 `0.1.0` → `0.2.0`）
- Bug 修复 → 增加修订号（如 `0.2.0` → `0.2.1`）
- 破坏性变更 → 增加主版本（如 `0.2.0` → `1.0.0`）

### CHANGELOG 格式模板

每个版本在 `CHANGELOG.md` 顶部新增条目，按此模板写：

```markdown
## vX.Y.Z (YYYY-MM-DD)

### ✨ 新功能
- **功能名称**：一句话说明（关联 issue/PR 编号）

### 🔧 改进
- 技术改进或重构说明

### 🐛 Bug 修复
- 修复了什么问题

### 升级注意（仅破坏性变更时）
- 迁移指南或配置变更说明
```

### 发布步骤

1. **更新版本号** — 修改以下 3 个文件的版本字段：
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `package.json`

2. **更新 CHANGELOG** — 按上面模板在文件顶部新增条目

3. **本地验证**（可选）：
   ```bash
   npm run test:unit && cd src-tauri && cargo test
   npm run build
   ```

4. **提交并打 tag**：
   ```bash
   git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json CHANGELOG.md
   git commit -m "chore(release): bump to vX.Y.Z"
   git tag vX.Y.Z -m "vX.Y.Z — 本次更新的简要描述"
   git push origin main vX.Y.Z
   ```

5. **等待 CI 完成** — GitHub Actions 自动执行：
   - 构建 Rust release + NSIS 安装器
   - 用 `UPDATER_SIGN_PRIVATE_KEY`（GitHub Secrets）签名
   - 从 `CHANGELOG.md` 提取当前版本描述作为 Release notes
   - 上传 `update.json` + 安装器到 GitHub Releases

6. **验证** — 打开应用 → 设置页 → 「关于与更新」→ 检查更新，确认新版本可下载安装

---

## 技术栈详情

### 前端

| 技术 | 用途 |
|------|------|
| React 18 + TypeScript 5 | UI + 类型安全 |
| Vite 6 | 构建/开发服务器 |
| Zustand 5 | 全局状态管理 |
| react-virtuoso | 虚拟滚动表格 |
| lucide-react | 图标库 |
| Vitest + @testing-library/react | 单元测试 |

### 后端

| 技术 | 用途 |
|------|------|
| Tauri 2 | 桌面框架 |
| Rayon | 并行 jar 扫描 |
| reqwest (blocking+json) | LLM API HTTP 客户端 |
| rusqlite (bundled) | SQLite 词典 |
| serde + serde_json | JSON 序列化（camelCase） |
| zip | 资源包 zip 生成 |
| regex | 占位符匹配 |
| tracing + tracing-appender | 异步文件日志 |
| font-kit | 系统字体枚举 |

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
- 表格布局：`table-layout: fixed`（默认）+ 百分比 `<col>` 各列求和 100%，文本列给足宽度用 `overflow-wrap: break-word` 换行，TableVirtuoso 的 `Scroller` 加 `overflowX: "hidden"` 避免横向滚动条

### 测试

- 前端：Vitest + jsdom + @testing-library/react，测试文件在 `tests/` 目录
- 后端：`cargo test`，单元测试内联在 `mod tests` 中
- 新增测试优先补最小 fixture（放在 `tests/fixtures/`）

### UI 组件复用规范

#### 核心原则：不重复造轮子

**新增任何 UI 元素前，必须检查 `src/components/` 目录下是否有现成的通用组件可用。** 严禁在各页面中手写重复的表格、搜索框、过滤弹窗等模式。

#### 通用组件库结构

```
src/components/
├── DataTable.tsx              # ⭐ 通用虚拟滚动表格（封装 TableVirtuoso + SortableTableHeader）
├── SearchInput.tsx            # ⭐ 统一搜索框（带防抖、清除按钮、Search 图标）
├── SortableTableHeader.tsx    # ⭐ 可排序/过滤表头（支持 text / select / number-range）
├── TranslationEditPanel.tsx   # 翻译编辑弹窗
├── CompletionSummary.tsx      # 扫描/翻译完成摘要卡片
├── SplashScreen.tsx           # 启动屏
├── AnimatedCount.tsx          # 数字递增动画
└── PackingAnimation.tsx       # 打包动画
```

#### 组件使用规则

| 场景 | 推荐组件 | 禁止做法 |
|------|---------|---------|
| 带排序/过滤的数据表格 | `DataTable` + `ColumnConfig` | 手写原生 `<table>` 表头 |
| 表格每列过滤 | `SortableTableHeader` + `filterType` | 在页面 useMemo 中手写过滤 UI |
| 全局搜索框 | `SearchInput`（防抖内置） | 手写 input + Search 图标组合 |
| 数字范围过滤 | `filterType: "number-range"` | 在页面内手写 min/max 输入框 |
| 排序/过滤状态管理 | `useSortFilter` hook | 在页面内手写 useState + 回调 |

#### 新增通用组件的要求

如需添加新的通用组件，必须：
1. 放在 `src/components/` 目录
2. 导出的类型定义放在组件文件头部的 `interface Props`
3. 使用 JSDoc 说明组件用途
4. 完成所有页面迁移后，删除页面内的旧实现

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

`docs/00-index.md` 为全部文档的索引。核心文档：
`01-product-spec.md` · `02-architecture-plan.md` · `03-ui-style-guide.md` · `04-agent-test-plan.md` · `05-pipeline-refactor-prd.md`

---

## 当前约定

- 首期主线：模组扫描 → 资源包复用 → 词典复用 → LLM 翻译 → 资源包打包 → 日志 → 自动化测试。
- FTB 任务汉化 / 硬编码汉化作为二期预留。
- **不直接修改原始 mod jar。** **不未经确认替换用户已有资源包。**
- 应用 UI 支持 `zh_cn` / `en_us` / `ja_jp` / `ko_kr` / `ru_ru`，默认 `zh_cn`。
- 新增 UI 文案必须写入 `i18n/translations.ts`，不要在组件里硬编码。
- 翻译语言使用 Minecraft locale code（`en_us` / `zh_cn` 等）。来源语言允许 `auto`，目标语言禁止 `auto`。
- 资源包路径：`assets/<modid>/lang/<targetLanguage>.json`。

---

## 参考项目

- [MineAI-Modpack-Translator](https://github.com/Thedrezik/MineAI-Modpack-Translator) · [mc-autotranslator](https://gitee.com/li27744/mc-autotranslator)
- 仅对照扫描/翻译/打包思路；具体以本项目规格和当前代码为准。

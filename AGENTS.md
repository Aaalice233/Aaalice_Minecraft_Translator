# AGENTS.md

> 本文件只记录 `Aaalice_Minecraft_Translator` 的项目级规则。
> 通用协作、搜索、编辑、安全、提问和 Git 规范遵循上层/全局 `AGENTS.md`，不要在这里重复维护。

## 适用范围

- 适用范围：仓库根目录及全部子目录。
- 本文件不记录具体应用版本号；版本信息以 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 为准。
- 如果本文件和用户当前指令冲突，以用户当前指令为准。

## 项目定位

- 项目：Aaalice Minecraft Translator，Windows 桌面端 Minecraft 整合包汉化工具。
- 技术栈：Tauri + Rust + React + TypeScript + Vite。
- 包管理：npm。
- 应用 ID：`com.aaalice.minecraft-translator`。
- 本地仓库：`E:/MC Projects/Aaalice_Minecraft_Translator/`。
- 默认测试实例：`E:/PCL2/.minecraft/versions/Aaalice Craft`。
- 私有 Git 仓库：`https://github.com/Aaalice233/Aaalice_Minecraft_Translator`。

## 目录速查

```text
assets/                  应用图标源
data/                    运行期本地数据，通常不提交
docs/                    产品、架构、UI、测试文档
logs/                    运行期日志，通常不提交
scripts/                 打包脚本
src/                     React + TypeScript 前端
src/api/tauri.ts         Tauri invoke 懒加载与浏览器 mock
src/app/                 App 壳与旧 Context 状态
src/components/          通用 UI 组件
src/hooks/               通用 hooks
src/i18n/translations.ts UI 文案字典
src/pages/               功能页面
src/stores/appStore.ts   Zustand 全局状态
src/styles/app.css       全局样式
src/types.ts             前端类型定义
src-tauri/               Tauri + Rust 后端
src-tauri/src/commands/  Tauri command 层
src-tauri/src/core/      扫描、流水线、词典、LLM、打包、日志等核心逻辑
tests/                   前端单元测试
```

## 常用命令

| 操作 | 命令 |
| --- | --- |
| 前端开发服务器 | `npm run dev` |
| Tauri 开发模式 | `npm run tauri dev` |
| 一键重启开发环境 | `./dev-reload.ps1` |
| 前端构建 | `npm run build` |
| 前端预览 | `npm run preview` |
| 前端单元测试 | `npm run test:unit` |
| Rust 测试 | `npm run test:rust` |
| 生成安装器 | `npm run package:exe` |
| 生成便携 exe | `npm run package:app` |

产物位置：

- 开发模式 exe：`src-tauri/target/debug/aaalice_mc_translator.exe`
- Release exe：`src-tauri/target/release/aaalice_mc_translator.exe`
- NSIS 安装器：`src-tauri/target/release/bundle/nsis/`

## 项目硬约束

- 不直接修改原始 mod jar。
- 不未经用户确认复制、覆盖或替换 Minecraft 实例中的已有资源包。
- `data/`、`logs/`、`dist/`、`build/`、`src-tauri/target/` 属于运行期数据或构建产物，除非任务明确要求，否则不要纳入提交。
- UI 面向用户的新增文案必须进入 `src/i18n/translations.ts`，不要写死在组件里。
- 前后端数据结构变更必须同步 `src-tauri/src/core/models.rs` 和 `src/types.ts`。
- Tauri API 调用必须经由 `src/api/tauri.ts` 封装，保持浏览器预览模式可运行或显式友好失败。

## 前端约定

- React 只使用函数组件和 Hooks。
- 全局状态正在从 `AppContext` 迁移到 `Zustand`；新增共享状态优先评估 `src/stores/appStore.ts`。
- UI 字典现有语言：`zh_cn`、`en_us`、`ja_jp`、`ko_kr`、`ru_ru`。
- 新增表格、搜索、排序、过滤能力前，先复用 `src/components/` 中的组件。
- 数据表优先使用 `DataTable`、`SortableTableHeader`、`useSortFilter`。
- 搜索框优先使用 `SearchInput`。
- 图标优先使用 `lucide-react`。
- 样式保持 `src/styles/app.css` 和 `data-theme` 主题机制。
- 表格默认保持 `table-layout: fixed`，列宽合计 100%，避免横向滚动和文本溢出。

## 后端约定

- Tauri command 层负责参数接收、事件发射和错误返回；复杂业务逻辑放入 `src-tauri/src/core/`。
- JSON 字段与前端保持 camelCase；新增 Rust 数据结构优先使用 `#[serde(rename_all = "camelCase")]` 和必要的 `#[serde(default)]`。
- 设置读写和校验集中在 `settings.rs`；新增设置必须补默认值、校验逻辑和前端类型。
- 日志使用 `tracing` 和现有 `logging` helper，避免散落临时 `println!`。
- 长任务必须支持取消，并正确处理 `CancelToken` 与 active task guard。

## 翻译流水线

当前主流水线由 `PipelineBuilder` 串联：

```text
ScanExtractPhase -> DictionaryPhase -> LlmPhase -> FinalizePhase
```

- 扫描进度通过 `scan-progress` 事件推给前端。
- 翻译日志和条目进度通过 `translate-log-entries`、`translate-entry-progresses` 推给前端。
- LLM 阶段读取已有 JSONL 结果以支持检查点恢复。
- 修改流水线时要同时检查任务状态、取消逻辑、日志、前端进度显示和失败恢复。

## 翻译与资源包规则

- 翻译语言使用 Minecraft locale code，例如 `en_us`、`zh_cn`。
- 来源语言允许 `auto`，目标语言禁止 `auto`。
- 资源包输出路径遵循 `assets/<modid>/lang/<targetLanguage>.json`。
- 占位符保护必须覆盖 Minecraft 格式码、变量、`String.format` 占位符和现有 shield 规则。
- LLM 输出不能悄悄丢失 `§` 颜色/格式码、`%s` / `%d` / `%1$s`、`{player}`、`{{...}}`、`<item:...>` 等占位内容。
- FTB 任务汉化和硬编码汉化属于扩展能力，改动前先确认当前产品边界和文档状态。

## 验证建议

- 只改文档：检查渲染结构、行数和 diff。
- 前端组件、页面、i18n、类型改动：优先运行 `npm run build`；必要时运行 `npm run test:unit`。
- Rust command、core、settings、pipeline、scanner、packer、jobs 改动：优先运行 `npm run test:rust`。
- 前后端契约改动：至少检查 `src/types.ts`、`src-tauri/src/core/models.rs` 和相关 invoke 调用。
- UI 行为改动：说明验证过的页面、主题、空态、加载态、错误态；能实际预览时优先实际检查。

## 发布相关

- 发布只在用户明确要求时执行。
- 版本号同步位置：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。
- 发布说明更新 `CHANGELOG.md` 顶部，沿用现有格式。
- 建议发布前验证：`npm run test:unit`、`npm run test:rust`、`npm run build`。
- Git tag 使用 `vX.Y.Z` 格式；推送 tag 后由 GitHub Actions 构建 release、签名 updater artifact 并上传安装器。

## 项目文档索引

- `docs/00-index.md`：全部文档入口。
- `docs/01-product-spec.md`：产品规格、功能边界、流程和风险。
- `docs/02-architecture-plan.md`：技术选型、总体架构和模块拆分。
- `docs/03-ui-style-guide.md`：界面风格、颜色、布局、组件和交互规范。
- `docs/04-agent-test-plan.md`：面向 Agent 的自动化测试方案。
- `docs/05-pipeline-refactor-prd.md`：流水线重构需求。
- `docs/ui-reference/README.md`：逐页 UI 参考图清单。

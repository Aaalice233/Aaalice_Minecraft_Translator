# Changelog

## v0.2.1 (2026-06-12)

### 🐛 Bug 修复

- **修复自动更新检查**：根因为私有仓库导致 GitHub 对未认证的 Release asset 请求返回 404，改为公开仓库后生效（需在仓库 Settings 手动设为 Public）
- **CI release.yml**：installer 路径从硬编码空格文件名改为自动检测实际 exe 文件，消除 Tauri NSIS bundler 文件名规范化差异
- **前端错误消息改进**：`checkUpdate()` 将 "invalid JSON" 映射为友好的中文错误提示

### 🔧 改进

- **Update JSON 生成**：使用 `Uri.EscapeDataString` 自动编码文件名，避免手动构造 URL 出错

---

## v0.2.0 (2026-06-11)

### ✨ 新功能

- **应用内自动更新**：设置页新增「关于与更新」tab，支持检查更新、下载进度、一键重启安装
- **NSIS 覆盖安装升级**：安装器支持自动检测旧版本、静默卸载后安装新版，可自定义安装路径
- **CI 发布流水线**：push tag 自动触发构建、ed25519 签名、生成 update.json、发布到 GitHub Releases

### 🔧 技术改进

- 集成 `tauri-plugin-updater` + `tauri-plugin-process`
- 所有 5 种 UI 语言（zh_cn/en_us/ja_jp/ko_kr/ru_ru）的更新相关文案全覆盖
- 打包脚本自动从 `.env.local` 加载签名密钥
- `package-exe.ps1` 修复 UTF-8 with BOM 编码兼容 CI 环境

---

## v0.1.0 (2026-06-11)

### 🎉 首个公开发布

Aaalice Minecraft Translator 的第一个公开发布版本。整合包汉化工具，通过 LLM 批量翻译模组文本并输出为资源包。

### ✨ 新功能

- **翻译管线**：完整的 5 阶段翻译流水线（扫描 → 词典匹配 → CFPA 参考 → LLM 翻译 → 打包）
- **增量扫描**：支持重复扫描时增量更新，避免重复工作
- **LLM 翻译**：智能分批次、并发请求、占位符保护（Shield）、429 自动降速
- **断点续翻**：支持中断后继续翻译，已有结果不重复请求
- **词典系统**：SQLite 持久化词典 + 模糊匹配 + 手动词条管理
- **CFPA 参考**：集成 CFPA 中文翻译资源复用
- **资源包打包**：自动生成 Minecraft 资源包，支持 pack.png 图标嵌入
- **人工校对**：校对工作台支持逐条编辑、单条目重翻
- **重试机制**：翻译失败条目一键重试，不覆盖已有结果
- **主题系统**：暗夜模式切换 + CSS 圆形遮罩动画（startViewTransition）
- **多语言 UI**：支持 5 种界面语言（简体中文 / English / 日本語 / 한국어 / Русский）
- **实时日志**：翻译过程实时日志面板 + 日志过滤/搜索
- **扫描进度**：并行 jar 扫描引擎 + 可视化进度条
- **设置页面**：完整的 LLM API 配置（供应商分组、参数调节、自定义 prompt）
- **字体选择**：自动枚举系统字体，界面字体即时预览
- **资源包复用**：自动检测并利用已有的资源包翻译
- **侧边栏导航**：三态导航状态（idle / busy / completed）
- **流程控制**：顶栏流程状态指示，限制翻译完成前不得打包
- **启动屏**：SplashScreen 加载动画 + 后台预热

### 🔧 技术亮点

- Tauri 2 + Rust 后端，React 18 + TypeScript 前端
- Rayon 并行 jar 扫描（4 线程池限制）
- reqwest 连接池复用 + 并发工作池
- Zustand 全局状态（从 useReducer 渐进迁移中）
- 虚拟滚动表格（react-virtuoso）支撑千级条目
- 组件复用体系（DataTable / SearchInput / SortableTableHeader）
- 76+9 单元/集成测试覆盖核心逻辑
- 检查点恢复：LLM 阶段读取已有 JSONL 跳过已翻译条目

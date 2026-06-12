# Aaalice MC Translator

> Windows 桌面端 Minecraft 整合包汉化工具。扫描模组语言文件，复用已有翻译，并通过 LLM 补齐缺口，最终输出可直接加载的资源包。

<p align="center">
  <img src="assets/app-icon-source.png" alt="Aaalice MC Translator" width="128" />
</p>

<p align="center">
  <b>简体中文</b> · <a href="README.en-US.md">English</a>
</p>

---

## 功能概览

- 扫描 Minecraft 实例目录，从 mod JAR 中提取 `.json` / `.lang` 语言文件。
- 复用已有资源包、本地词典和 CFPA 参考翻译，减少重复请求。
- 通过 DeepSeek、OpenAI 或其他 OpenAI-compatible API 批量翻译剩余条目。
- 在翻译前后保护 Minecraft 格式代码、变量、物品标签和 Java format 占位符。
- 支持翻译作业进度、日志、失败项重试和结果校对。
- 打包生成标准 Minecraft 资源包 zip，不直接修改原始 mod JAR。

## 快速开始

### 系统要求

- Windows 10 / Windows 11 64 位
- 一个标准 Minecraft 实例目录，例如 PCL2、HMCL 或官方启动器实例
- 可用的 LLM API Key

### 安装

从 [Releases](https://github.com/Aaalice233/Aaalice_Minecraft_Translator/releases) 下载最新版安装器并运行。

应用支持自动更新，可在「设置 -> 关于与更新」里检查新版本。

### 基本流程

```text
选择 MC 实例 -> 扫描模组 -> 配置 LLM API -> 开始翻译 -> 校对结果 -> 打包资源包
```

生成的资源包可以复制到实例的 `resourcepacks/` 目录中使用。

## 开发

### 环境要求

- Node.js 20+
- npm 10+
- Rust stable

### 常用命令

| 操作 | 命令 |
| --- | --- |
| 启动前端开发服务器 | `npm run dev` |
| 启动 Tauri 开发模式 | `npm run tauri dev` |
| 前端构建 | `npm run build` |
| 前端测试 | `npm run test:unit` |
| Rust 测试 | `npm run test:rust` |
| 生成 NSIS 安装器 | `npm run package:exe` |
| 生成便携版 exe | `npm run package:app` |

## 项目结构

```text
Aaalice_Minecraft_Translator/
├── assets/                  应用图标与资源包图标
├── data/                    运行期本地数据，已被 .gitignore 忽略
├── docs/                    产品、架构、UI 与测试文档
├── logs/                    运行期日志，已被 .gitignore 忽略
├── scripts/                 打包与辅助脚本
├── src/                     React + TypeScript 前端
│   ├── api/                 Tauri API 封装与浏览器 mock
│   ├── app/                 App 壳、Context 与全局状态同步
│   ├── components/          通用 UI 组件
│   ├── hooks/               通用 React hooks
│   ├── i18n/                界面多语言字典
│   ├── pages/               功能页面
│   ├── stores/              Zustand 状态
│   └── styles/              全局样式
├── src-tauri/               Tauri 2 + Rust 后端
│   ├── src/commands/        Tauri commands
│   ├── src/core/            扫描、词典、LLM、打包、日志等核心逻辑
│   └── tauri.conf.json      窗口、打包和更新器配置
├── tests/                   Vitest 测试与 fixture
├── CHANGELOG.md             版本变更日志
├── LICENSE                  MIT 许可证
├── README.en-US.md          英文 README
└── README.md                中文 README
```

## 技术栈

### 前端

- React 18
- TypeScript 5
- Vite 6
- Zustand
- react-virtuoso
- lucide-react
- Vitest + Testing Library

### 后端

- Tauri 2
- Rust 2021
- Rayon
- reqwest
- rusqlite
- serde / serde_json
- zip
- tracing

## 核心约定

- 不直接修改原始 mod JAR。
- 不未经确认替换用户已有资源包。
- 资源包输出使用 `assets/<modid>/lang/<targetLanguage>.json`。
- 前后端类型通过 camelCase JSON 同步，修改数据结构时需要同时更新 `src/types.ts` 和 `src-tauri/src/core/models.rs`。
- 新增界面文案需要写入 `src/i18n/translations.ts`。

## 文档

完整文档索引见 [docs/00-index.md](docs/00-index.md)。

## 参考项目

- [MineAI-Modpack-Translator](https://github.com/Thedrezik/MineAI-Modpack-Translator)
- [mc-autotranslator](https://gitee.com/li27744/mc-autotranslator)

## 许可证

本项目使用 [MIT License](LICENSE)。

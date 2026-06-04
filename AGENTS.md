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
| **Git 地址** | 私有仓库，远程地址待配置 |
| **技术栈** | Tauri 2 + Rust + React + TypeScript + Vite |

## 项目文档

- 规格与文档索引：`docs/00-index.md`
- 产品规格：`docs/01-product-spec.md`
- 架构与总体计划：`docs/02-architecture-plan.md`
- UI 风格对齐文档：`docs/03-ui-style-guide.md`
- 面向 agent 的自动化测试框架：`docs/04-agent-test-plan.md`

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

## 当前约定

- 首期主线：模组语言文件扫描、资源包复用、词典复用、LLM 翻译、资源包打包、日志和自动化测试。
- FTB 任务汉化作为首期可选模块预留。
- 硬编码汉化只进入二期实验室，不自动应用补丁。
- 不直接修改原始 mod jar。
- 不未经确认替换用户已有资源包。

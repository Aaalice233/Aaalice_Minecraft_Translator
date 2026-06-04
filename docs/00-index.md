# Aaalice MC Translator 文档索引

本目录记录 `Aaalice Minecraft Translator` 的产品规格、技术架构、UI 风格和自动化测试方案。

## 文档列表

- [01-product-spec.md](01-product-spec.md)：产品规格、功能边界、流程和风险评估。
- [02-architecture-plan.md](02-architecture-plan.md)：技术选型、总体架构、模块拆分和端到端开发计划。
- [03-ui-style-guide.md](03-ui-style-guide.md)：界面风格、颜色、布局、组件和交互规范。
- [04-agent-test-plan.md](04-agent-test-plan.md)：面向 agent 的自动化测试框架设计。
- [ui-reference/README.md](ui-reference/README.md)：逐页 UI 参考图清单。

## 首期目标

做一个 Windows `.exe` 桌面程序，允许用户选择 Minecraft 整合包实例目录，自动扫描模组语言文件和已有汉化资源包，结合词典与 LLM 翻译生成 `zh_cn` 资源包，并在用户确认后复制或替换到实例的 `resourcepacks` 目录。

首期先完成模组文本翻译、词典复用、资源包打包和可视化流程。FTB 任务汉化作为首期可选功能预留；硬编码内容汉化只做二期实验功能评估，不进入首期自动应用链路。

## 参考链接

- MineAI-Modpack-Translator: https://github.com/Thedrezik/MineAI-Modpack-Translator
- mc-autotranslator: https://gitee.com/li27744/mc-autotranslator
- CFPATools/i18n-dict: https://github.com/CFPATools/i18n-dict
- Tauri 2: https://v2.tauri.app/start/
- Vault Patcher: https://www.mcmod.cn/class/8765.html
- Vault Patcher 相关说明: https://www.mcmod.cn/post/5703.html

# 产品规格

## 产品定位

`Aaalice MC Translator` 是一个面向 Minecraft 整合包的离线桌面翻译工具。它不要求用户进入游戏，也不修改原始 mod jar；程序通过扫描实例目录、复用已有汉化资源包和词典、调用 LLM 翻译缺口文本，最终输出标准资源包。

## 目标用户

- 整合包作者：需要快速给大量 mod 做 `zh_cn` 汉化。
- 玩家：希望给自己正在玩的整合包补充汉化。
- 汉化维护者：需要复用已有词典、人工纠错、导入导出翻译记忆。
- Agent/自动化开发者：需要全自动验证扫描、翻译、打包、UI 操作流程。

## 核心原则

- 不直接改原始 mod jar。
- 不静默覆盖用户已有资源包。
- LLM 只处理词典和资源包都无法命中的缺口文本。
- 翻译前后必须保护并校验格式占位符。
- 失败必须显式暴露在 UI 和日志里。
- 首期只做高确定性的资源包汉化；硬编码汉化进入二期实验区。

## 首期功能

### 实例目录选择

用户选择 Minecraft 实例目录，程序校验以下目录或文件：

- `mods/`
- `resourcepacks/`
- `config/`
- `saves/`
- `options.txt`

只要存在 `mods/` 即可进入扫描；其他目录缺失时显示明确提示。

### 模组语言文件扫描

扫描 `mods/*.jar`，读取常见语言文件：

- `assets/<modid>/lang/en_us.json`
- `assets/<modid>/lang/en_us.lang`
- `assets/<modid>/lang/zh_cn.json`
- `assets/<modid>/lang/zh_cn.lang`

首期以 `en_us` 到 `zh_cn` 为主。程序记录：

- `modid`
- jar 文件路径
- mod 文件名
- 原始 key
- 原始文本
- 原始文本 hash
- 语言文件格式
- 是否已有 `zh_cn`

### 资源包识别与复用

扫描实例 `resourcepacks/`，识别已有汉化资源包作为补充来源。识别策略：

- 检查 `pack.mcmeta`。
- 检查 `assets/*/lang/zh_cn.json` 或 `zh_cn.lang`。
- 检查资源包文件名、目录结构和语言文件覆盖关系。
- 对 i18n 汉化资源包和 VM 汉化资源包做来源标记。

资源包复用只进入候选翻译池，不直接修改这些资源包。

### 词典系统

词典按优先级查询：

1. 用户手动纠错词典。
2. 当前项目历史翻译。
3. 用户导入词典。
4. 已有 i18n/VM 汉化资源包。
5. CFPATools/i18n-dict。
6. LLM 翻译结果。

词典记录字段：

- `source_text`
- `target_text`
- `source_lang`
- `target_lang`
- `source_type`
- `modid`
- `translation_key`
- `context`
- `source_hash`
- `target_hash`
- `confidence`
- `created_at`
- `updated_at`

支持：

- 搜索。
- 按 `modid`、来源、状态过滤。
- 手动纠错。
- 同源文本批量应用。
- 导入导出。
- 冲突对比。

### LLM 集成

首期支持 OpenAI-compatible API：

- Base URL。
- API Key。
- Model。
- Temperature。
- Max tokens。
- Timeout。
- 并发数。
- Batch size。
- 每批最大字符数。
- Retry count。
- Retry delay。
- Rate limit。

请求前必须执行格式保护；响应后必须执行还原和校验。校验失败的条目进入失败队列，不写入最终资源包。

### Minecraft 文本格式保护

必须保护：

- `%s`
- `%1$s`
- `%d`
- `{0}`
- `{player}`
- `§a`、`§l` 等颜色和样式码。
- `\n`
- JSON 转义。
- Markdown。
- Patchouli/FTB 常见变量。
- NBT/物品标签片段。
- `<item:...>`、`<block:...>` 等引用。

保护策略：

1. 翻译前替换为不可翻译 token。
2. LLM prompt 明确要求保持 token。
3. 响应后还原 token。
4. 对比 token 数量和顺序。
5. 校验失败则重试或进入人工处理。

### 资源包生成

输出结构：

```text
build/output/Aaalice-MC-Translator-zh_cn/
  pack.mcmeta
  pack.png
  assets/<modid>/lang/zh_cn.json
```

最终 zip：

```text
build/output/Aaalice-MC-Translator-zh_cn.zip
```

用户确认后可执行：

- 打开输出目录。
- 复制到实例 `resourcepacks/`。
- 替换旧的同名生成包。
- 取消。

所有替换动作必须显示目标路径并由用户确认。

### FTB 任务汉化

首期作为可选模块。扫描候选路径：

- `config/ftbquests/`
- `config/ftbquests/quests/`
- `saves/<world>/serverconfig/ftbquests/`

支持内容：

- quest title。
- description。
- chapter title。
- reward text。
- task text。

由于不同版本 FTB Quest 文件格式差异较大，首期只在 fixture 覆盖的格式上启用自动处理；识别失败时显示原因。

### 硬编码内容汉化

二期实验功能，不进入首期自动应用链路。

可行性判断：

- Vault Patcher 适合做补丁式替换。
- 部分补丁需要客户端和服务端同时安装。
- 硬编码字符串定位误判风险高。
- 自动生成补丁容易造成运行时异常。

首期只保留界面入口和风险评估：

- 扫描候选硬编码字符串。
- 生成补丁草案。
- 用户手动确认。
- 不自动应用到实例。

## 日志系统

日志目录：

```text
logs/
  main.log
  jobs/<job_id>.log
  errors/<job_id>.log
  http/<job_id>.log
  debug/<job_id>.log
```

策略：

- `main.log` 每次启动重置，只保留当前启动主日志。
- `jobs/` 保留任务级日志。
- `errors/` 保留错误日志。
- `http/` 默认关闭，用户开启后记录脱敏请求摘要。
- `debug/` 默认关闭。
- 所有 API Key 必须脱敏。

## 非目标

首期不做：

- 直接改 mod jar。
- 自动安装 Vault Patcher。
- 自动生成服务端补丁。
- 多语言批量输出。
- 游戏内实时翻译。
- 未经确认替换资源包。

## 交付物

- Windows `.exe` 安装包或便携版。
- 标准资源包 zip。
- 可导入导出的词典文件。
- 自动化测试 fixture。
- UI 参考图和风格规范。
- 开发与测试文档。

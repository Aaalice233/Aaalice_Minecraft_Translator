# 面向 Agent 的自动化测试框架

## 目标

让测试阶段尽可能全自动。agent 应该可以在没有真实 LLM、没有真实 Minecraft 客户端、没有网络的情况下验证核心流程。

## 测试层级

```text
Unit Tests
  Rust core modules

Integration Tests
  fixture modpack -> scan -> match -> fake LLM -> package

E2E Tests
  Tauri app UI -> choose fixture -> run job -> review dictionary -> package

Golden Tests
  output zip/files compare expected snapshots
```

## Fixture 目录

```text
tests/fixtures/
  modpacks/
    basic_pack/
      mods/
        examplemod.jar
        placeholdermod.jar
      resourcepacks/
        i18n-example.zip
        vm-example.zip
      config/
        ftbquests/
  jars/
    examplemod/
      assets/examplemod/lang/en_us.json
    placeholdermod/
      assets/placeholdermod/lang/en_us.json
  dictionaries/
    user-dict.sqlite
    imported-dict.json
  expected/
    basic_pack_output/
      assets/examplemod/lang/zh_cn.json
```

fixture 应覆盖：

- 普通 JSON lang。
- 旧 `.lang`。
- 已有 `zh_cn`。
- `%s`、`%1$s`、`§a`、`\n`。
- 重复英文文本。
- 已有资源包命中。
- 词典命中。
- LLM 缺口。
- LLM 返回破坏占位符。
- FTB Quest 可识别格式。

## Fake LLM Server

位置：

```text
tests/fake-llm-server/
```

职责：

- 模拟 OpenAI-compatible `/v1/chat/completions`。
- 按输入 hash 返回固定译文。
- 支持测试模式：
  - normal。
  - timeout。
  - rate_limit_429。
  - malformed_json。
  - placeholder_broken。
  - partial_failure。

agent 运行测试时不需要真实 API Key。

## Rust 单元测试

重点模块：

- `scanner`：实例目录识别。
- `extractor`：jar/zip 和 lang/json 解析。
- `resourcepack`：i18n/VM 资源包识别。
- `dictionary`：优先级、冲突、导入导出。
- `shield`：占位符保护和校验。
- `packer`：资源包输出。
- `jobs`：任务状态机。

推荐命令：

```powershell
cargo test
```

## 集成测试

用 fixture 完整跑一遍：

```text
scan -> extract -> dictionary match -> fake LLM -> validate -> package
```

断言：

- 输出条目数量正确。
- 词典命中不进入 fake LLM。
- LLM 失败条目不写入最终资源包。
- zip 内容和 golden 一致。
- 日志里记录失败原因。

## UI E2E 测试

推荐 Playwright。

测试路径：

```text
tests/e2e/
  dashboard.spec.ts
  translation-job.spec.ts
  dictionary.spec.ts
  settings.spec.ts
  packaging.spec.ts
  logs.spec.ts
```

覆盖：

- 选择 fixture 实例目录。
- 点击扫描。
- 查看统计卡片。
- 配置 fake LLM URL。
- 启动翻译。
- 等待任务完成。
- 打开词典页修改一条翻译。
- 重新打包。
- 进入打包确认页。
- 复制动作使用测试目录，不碰真实实例。
- 查看日志页错误详情。

## Agent 自动化入口

建议提供统一命令：

```powershell
npm run test:agent
```

内部执行：

```text
cargo test
npm run test:unit
npm run test:e2e
npm run test:golden
```

如果还没有完整 UI，可先提供：

```powershell
cargo test --workspace
npm run test:unit
```

## 日志验证

每次测试启动前清理测试临时目录，但不删除真实 `logs/`。

断言：

- `main.log` 在启动时重置。
- `jobs/<job_id>.log` 被创建。
- API Key 不出现在任何日志。
- LLM 错误能被记录到 error log。

## 禁止事项

- 测试不能依赖真实网络。
- 测试不能改用户真实 Minecraft 实例。
- 测试不能调用真实 LLM。
- 测试不能吞掉失败。
- 测试不能为了通过而自动修复 golden。

## 首期自动化验收

首期完成时，agent 应能执行：

```powershell
npm run test:agent
```

并自动验证：

- 扫描成功。
- 词典命中成功。
- fake LLM 翻译成功。
- 占位符破坏被拦截。
- 资源包生成成功。
- UI 可完成端到端流程。
- 日志策略符合要求。

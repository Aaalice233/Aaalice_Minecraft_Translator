# 规格说明书：启动/打包后自动清空扫描翻译缓存

## 概述

应用启动和资源包打包完成后，自动清空扫描和翻译的中间缓存文件，确保每次使用时都必须重新扫描。

## 需求

1. **应用启动时**：清空 `data/jobs/` 目录下所有扫描和翻译作业文件，使前端 `loadLatestScanSummary()` 返回空。
2. **资源包打包成功后**（非 dry-run）：清空 `data/jobs/` 目录下所有扫描和翻译作业文件。
3. **保留数据**：`data/settings.json`、`data/dictionary.sqlite` 不受影响。
4. **打包产物**：`build/output/` 下的 zip 不被清理。

## 影响范围

| 文件 | 清理时机 | 说明 |
|---|---|---|
| `data/jobs/scan_*.json` | 启动 + 打包后 | 扫描结果 |
| `data/jobs/translate_*.json` | 启动 + 打包后 | 翻译任务状态 |
| `data/jobs/translate_*_results.jsonl` | 启动 + 打包后 | 翻译结果明细 |
| `data/settings.json` | 不清理 | 用户设置 |
| `data/dictionary.sqlite` | 不清理 | 词典库 |
| `build/output/*` | 不清理 | 最终打包输出 |

## 实现方案

### 后端 Rust — commands.rs

新增 `clear_jobs_cache` 命令，删除 `data/jobs/` 目录内容并重建空目录。

### 后端 Rust — lib.rs setup()

在 `logging::init_main_log()` 后调用缓存清理。

### 后端 Rust — 打包命令

`generate_pack_from_job` 和 `generate_translation_pack` 在非 dry-run 成功后自动清理。

### 前端 TypeScript — tauri.ts

添加 `clearJobsCache` 包装函数。

### 前端 TypeScript — App.tsx

启动时调用 `clearJobsCache`，使 `loadLatestScanSummary()` 必定返回空。

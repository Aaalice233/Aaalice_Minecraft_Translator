# Autopilot Plan: 启动/打包后自动清空扫描翻译缓存

## 改动清单

### Change 1: commands.rs — 新增 clear_jobs_cache 命令
- 新增 `clear_jobs_cache` Tauri command
- 删除 `data/jobs/` 目录下所有文件，重新创建空目录
- 导出公共函数 `cleanup_jobs_cache()` 供 lib.rs 调用

### Change 2: lib.rs — 启动时清理缓存
- 在 `rayon` 初始化后、`logging::init_main_log()` 后调用 `cleanup_jobs_cache()`

### Change 3: commands.rs — 打包后清理缓存
- `generate_pack_from_job()` 在非 dry-run 成功时调用 `cleanup_jobs_cache()`
- `generate_translation_pack()` 在非 dry-run 成功时调用 `cleanup_jobs_cache()`

### Change 4: api/tauri.ts — 添加前端包装
- 新增 `clearJobsCache()` 导出函数

### Change 5: App.tsx — 启动时调用
- 在设置加载成功后调用 `clearJobsCache()`，使缓存一定被清除

## 执行顺序
Change 1 → Change 2 → Change 3 → Change 4 → Change 5 → 验证

## 验证
1. `cd src-tauri && cargo test` — 全部通过
2. `npm run build` — 前端构建通过

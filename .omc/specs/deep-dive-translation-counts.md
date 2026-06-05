# Deep Dive Spec: 页面翻译数量统一

## Metadata
- Interview ID: deep-dive-translation-counts
- Type: brownfield
- Generated: 2026-06-04
- Status: PASSED

## Trace Findings
**根因：** DashboardPage 显示两个值——`totalPendingEntries`（"待翻译条目"=1000）和 `actualPendingEntries`（"实际需要翻译"=700）。JobsPage 显示 `totalPendingEntries`（"待翻译条目"=1000）但未显示扣除资源包覆盖后的净值。用户对比的是不同计算口径的值。

## Goal
统一所有页面使用 `actualPendingEntries`（扣除汉化资源包覆盖后的实际待翻译数）作为翻译数量的唯一口径。保证 DashboardPage、JobsPage、PackagesPage 显示一致的数值。

## Constraints
1. `ScanSummary` 后端数据模型不动——`totalPendingEntries` 和 `actualPendingEntries` 都保留
2. 翻译启动时的进度 total 也需要对齐，避免 translation progress 显示不同数字
3. 最小改动——优先改前端显示，必要时改后端传参

## Acceptance Criteria
- [ ] JobsPage 显示的待翻译条目数改为 `actualPendingEntries`
- [ ] JobsPage 的 canTranslate 守卫条件用 `actualPendingEntries`
- [ ] JobsPage 的空状态（无待翻译）检查用 `actualPendingEntries`
- [ ] PackagesPage 的 canGenerate 守卫条件用 `actualPendingEntries`
- [ ] 翻译进度 total 与 `actualPendingEntries` 对齐（前端传参或后端过滤）
- [ ] TypeScript 编译无错误

## Files to Change

### `src/pages/JobsPage.tsx`
- Line 23: `scanSummary.totalPendingEntries > 0` → `scanSummary.actualPendingEntries > 0`
- Line 142: `scanSummary.totalPendingEntries === 0` → `scanSummary.actualPendingEntries === 0`
- Line 170: `scanSummary.totalPendingEntries > 0` → `scanSummary.actualPendingEntries > 0`
- Line 179: `scanSummary.totalPendingEntries.toLocaleString()` → `scanSummary.actualPendingEntries.toLocaleString()`
- UI label 可保持"待翻译条目"或改为"实际需要翻译"

### `src/pages/PackagesPage.tsx`
- Line 20: `scanSummary.totalPendingEntries > 0` → `scanSummary.actualPendingEntries > 0`

### Optional: `src-tauri/src/commands.rs`
- 如果希望翻译进度 total 也对齐，需要 `start_translation` 接收 `actual_pending_entries` 参数

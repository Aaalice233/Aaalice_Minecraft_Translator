---
plan: true
version: 1
created: 2026-06-07
---

## Plan: 给日志页面级别过滤器添加数量显示

### 概述

在 LogsPage 的级别过滤按钮上，为每个级别（ALL、ERROR、WARN、INFO、DEBUG、RAW）添加当前日志条数的计数显示，提升信息密度和视觉设计感。

### 实现方案

每个过滤按钮由「级别标签 + 数量徽标」两部分组成，inline-flex 水平排列。数量使用 `tabular-nums` 保持数字宽度稳定，以较低不透明度呈现次级信息层次。整体风格沿用 Catppuccin Mocha 暗色日志主题，与现有按钮颜色系统保持一致。

### 步骤

**Step 1：计算各级别数量（`src/pages/LogsPage.tsx`）**

- 新增 `useMemo` 计算 `levelCounts: Record<string, number>`，单次遍历 `entries` 统计 ERROR / WARN / INFO / DEBUG / RAW 各自数量
- ALL 的数量直接用 `entries.length` 表示

**Step 2：更新过滤按钮渲染（`src/pages/LogsPage.tsx`）**

- 在每个 `<button className="log-filter-btn">` 内部，将原本纯文本改为：
  - `<span className="log-filter-lbl">{显示文本}</span>`
  - `<span className="log-filter-cnt">{count}</span>`
- ALL 按钮的显示文本保持 "全部"，其他保持级别名
- 当 count === 0 时添加 `.log-filter-btn--empty` 类（可选弱化）

**Step 3：CSS 样式（`src/styles/app.css`）**

- `.log-filter-btn` → 增加 `display: inline-flex; align-items: center; gap: 4px;`
- `.log-filter-lbl` → 保留现有字体大小 (11px)
- 新增 `.log-filter-cnt`：
  - `font-size: 10px`
  - `font-variant-numeric: tabular-nums`
  - `opacity: 0.55`（次级信息，不抢眼）
  - 鼠标悬停时 `.log-filter-btn:hover .log-filter-cnt` → `opacity: 0.75`
  - 激活时 `.log-filter-btn.active .log-filter-cnt` → `opacity: 0.85`（在有色背景上保持可读）
- 可选：`.log-filter-btn--empty .log-filter-cnt` → `opacity: 0.3`（空级别更淡化）

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/pages/LogsPage.tsx` | 新增 `levelCounts` useMemo；更新 JSX 渲染过滤按钮 |
| `src/styles/app.css`（~1709-1765 区域） | 调整 `.log-filter-btn` flex 布局；新增 `.log-filter-cnt` 样式 |

### 未变更范围

- i18n 翻译文件：无需变更，count 是纯数字
- Rust 后端：无需变更
- 类型定义：无需变更
- 日志轮询逻辑：无需变更
- Footer 已有行数显示不变

### 验收标准

1. 每个过滤按钮右侧显示该级别的日志条数，ALL 显示总条数
2. 数字使用等宽数字，悬停和激活态有正确的透明度变化
3. 新轮询到日志时数量即时更新
4. 空级别显示 0，不报错
5. 按钮视觉上仍保持原有颜色体系，不破坏现有布局

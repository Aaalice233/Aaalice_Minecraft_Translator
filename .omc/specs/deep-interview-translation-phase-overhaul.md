# Deep Interview Spec: 翻译阶段大修

## Metadata
- Interview ID: di-translation-phase-001
- Rounds: 7
- Final Ambiguity Score: 17.5%
- Type: brownfield
- Generated: 2026-06-05
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 0.35 | 0.298 |
| Constraint Clarity | 0.80 | 0.25 | 0.200 |
| Success Criteria | 0.80 | 0.25 | 0.200 |
| Context Clarity | 0.85 | 0.15 | 0.128 |
| **Total Clarity** | | | **0.825** |
| **Ambiguity** | | | **0.175 (17.5%)** |

## Topology

| Component | Status | Description | Coverage Note |
|-----------|--------|-------------|---------------|
| progress-bar | active | 进度条改造 — mod 文件名(截断) + 条目数 current/total | MVP 范围 |
| log-panel | active | 实时翻译日志/审查面板 — 差异审阅风格，支持交互 | MVP 范围 |
| backend-streaming | active | 后端新增独立 `translate-log-entry` 事件通道 | MVP 范围（日志面板的前置） |
| feature-brainstorm | deferred | 增量翻译/词典缓存/统计仪表盘等脑暴功能 | 推迟到二期，用户确认暂缓 |

**暂缓确认时间：** Round 6（2026-06-05）
**暂缓理由：** 用户选择 MVP 范围为进度条 + 日志审查面板，增量翻译/词典缓存/仪表盘等功能延后。

## Goal
对翻译阶段（JobsPage）进行 UI 重构和架构增强，实现：
1. **进度条改造**：去掉当前统计卡片（totalEntries/sourceLang/targetLang/modCount），替换为简洁的进度条组件，显示当前翻译的 mod 文件名（支持截断）和条目数进度（current/total 或百分比）
2. **实时翻译日志审查面板**：页面下方大块区域，接收后端独立事件通道数据，实时追加显示每条翻译结果，并支持差异审阅风格的交互（复制、过滤、清空、按 mod 筛选）
3. **后端流式事件增强**：新增 `translate-log-entry` 独立 Tauri 事件通道，与现有 `translate-progress` 解耦，携带条目级翻译详情

## Constraints
- 进度条中的 mod 名使用文件名（非 modid），需要设置最大宽度+文本截断
- 日志面板无限追加，不做行数限制（但在实现时要用虚拟滚动或可视区截断防止 DOM 性能问题）
- 日志条目需要显示的信息：翻译 key、翻译文本、原文文本、来源词典类型、mod 文件名（不含 token 数）
- 日志面板需要支持的交互：点击复制单条翻译文本、清空日志、按 mod 名称过滤
- 后端独立事件通道使用 `translate-log-entry` 事件名
- 后端事件数据结构需包含：key, sourceText, targetText, modName, sourceType（"llm"/"dictionary"/"resourcepack"/"skipped"）
- 进度事件 `translate-progress` 保持不变，按批次更新（低频）；日志事件按条目发射（高频）
- 翻译目前是模拟的（50ms/batch），后续接入真实 LLM 时事件架构不变

## Non-Goals
- 增量翻译/差异扫描 → 二期（词典缓存方案确认：增强版 SQLite + 哈希索引）
- 汉化资源包自动吸收到词典 → 二期
- 断点续翻 → 看复杂度，容易出 Bug 则不实现
- 内联审阅编辑器 → 属于校验阶段（ValidatePage），非翻译阶段
- 翻译统计仪表盘 → 二期（要求美观）
- 一键导出增量资源包 → 不需要，完整资源包即可

## Acceptance Criteria
- [ ] AC1: JobsPage idle 状态不再显示统计卡片（totalEntries/sourceLang/targetLang/modCount）
- [ ] AC2: 翻译运行时显示进度条，包含当前 mod 文件名（截断）、条目数 current/total、百分比
- [ ] AC3: 页面下方大块区域实时显示翻译日志条目
- [ ] AC4: 日志条目显示 key、翻译文本、原文文本、来源类型、mod 名
- [ ] AC5: 日志支持无限追加（虚拟滚动防性能问题）
- [ ] AC6: 日志支持点击复制单条文本
- [ ] AC7: 日志支持清空按钮
- [ ] AC8: 日志支持按 mod 名称过滤
- [ ] AC9: Rust 后端新增 `translate-log-entry` 独立事件通道
- [ ] AC10: 新事件数据结构包含 key/sourceText/targetText/modName/sourceType
- [ ] AC11: 新事件与现有 `translate-progress` 互不影响
- [ ] AC12: 浏览器预览模式（无 Tauri）下有 mock/fallback 行为
- [ ] AC13: 所有新增 UI 文案写入 i18n 字典

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "实时流水日志就是用户想要的" | Contrarian (Round 4): 是否改为结果审查视图？ | 确定：**结果审查风格 > 流水日志**。日志面板定位为差异审查，过程流式为辅 |
| "进度和日志用同一个事件通道" | 设计讨论 (Round 7): 合并 vs 独立？ | **独立通道**：进度低频按批次、日志高频按条目，各自优化 |
| "功能越多越好" | Simplifier (Round 6): MVP 范围压缩 | **MVP 范围 = 进度条 + 日志面板**，增量翻译/词典缓存/仪表盘全部二期 |
| 词典技术选型 | 分析比较 (Round 5): SQLite vs HashMap vs RocksDB | **增强 SQLite + 哈希索引**（零额外依赖，够用） |

## Technical Context
### 需修改的文件
- `src/pages/JobsPage.tsx` — 主要 UI 改造：移除统计卡片、替换进度条、新增日志面板
- `src/types.ts` — 新增 `TranslateLogEntry` 接口类型
- `src/api/tauri.ts` — 无需修改（事件监听通过 `@tauri-apps/api/event` 直接注册，不需经过 tauri.ts）
- `src-tauri/src/commands.rs` — 新增 `translate-log-entry` 事件发射逻辑
- `src-tauri/src/core/models.rs` — 新增 `TranslateLogEntry` 结构体
- `src/styles/app.css` — 新增日志面板样式、进度条样式调整
- `src/i18n/translations.ts` — 新增 UI 文案

### 不需要修改的
- `src-tauri/src/core/pipeline.rs` — 翻译流水线逻辑不变
- `src-tauri/src/core/jobs.rs` — 任务状态机不变
- `src/pages/ValidatePage.tsx` — 不属于翻译阶段
- `src/components/PipelineBreadcrumb.tsx` — 流水线导航不变

### 关键设计决策
- 使用独立 Tauri 事件通道 `translate-log-entry`，频率为每翻译一条条目发射一次
- `TranslateLogEntry` 结构：key, sourceText, targetText, modName, sourceType
- 日志面板使用虚拟滚动（如 `react-window` 或 `@tanstack/virtual`）处理大量条目
- 进度条使用现有 CSS 动画（复用 `progress-bar-fill` 样式）

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| TranslateProgress | 核心领域 | current, total, phase, modName, subStep, stageStatus | 通过 translate-progress 事件从后端发射到前端 |
| TranslateLogEntry | 核心领域 | key, sourceText, targetText, modName, sourceType | 通过 translate-log-entry 事件从后端发射到前端 |
| Job | 核心领域 | id, status, entries | 包含翻译任务整体状态 |
| Mod | 核心领域 | fileName, modId | 被翻译的模组，进度条显示其文件名 |
| TranslationEntry | 核心领域 | key, text, modId | 单条翻译键值对 |
| SourceType | 枚举 | llm, dictionary, resourcepack, skipped | 标识翻译来源 |
| Dictionary | 核心领域（二期） | sourceText, targetText, lang | SQLite 持久化，哈希索引加速 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 5 | 5 | - | - | - |
| 2 | 6 | 1 | 0 | 5 | 83% |
| 3 | 7 | 1 | 0 | 6 | 86% |
| 4 | 9 | 2 | 1 | 6 | 78% |
| 5 | 11 | 3 | 1 | 7 | 73% |
| 6 | 12 | 2 | 0 | 10 | 83% |
| 7 | 12 | 1 | 0 | 11 | 92% |

实体在 Round 6-7 趋于稳定，最后两轮新引入仅 1 个实体，稳定性达 92%。

## Interview Transcript
<details>
<summary>Full Q&A (7 rounds)</summary>

### Round 0
**Q:** 拓扑确认：4 个组件（进度条改造 / 实时翻译日志面板 / 后端流式事件增强 / 功能脑暴）是否正确？
**A:** 可以
**Ambiguity:** N/A（拓扑锁定阶段）

### Round 1
**Q:** 使用场景和主要痛点是什么？
**A:** 自己玩整合包想汉化，加新 mod 要全量重跑很慢
**Ambiguity:** 59.5%（Goal: 0.5, Constraints: 0.3, Criteria: 0.2）

### Round 2
**Q:** 进度条显示 modid 还是文件名？进度当前/总数是条目数还是模组数？
**A:** 文件名，需要设置最大宽度。条目数
**Ambiguity:** 59.5%（Progress-bar 组件清晰度提升，但整体仍受 Criteria 拖累）

### Round 3
**Q:** 日志面板：行数限制、条目内容、交互支持？
**A:** 一直追加；需要额外信息但不要太冗余；需要交互
**Ambiguity:** 59.5%（Log-panel 方向明确但仍需设计定型）

### Round 4 (Contrarian Mode)
**Q:** 挑战假设：不做实时日志，改为结果审查视图？
**A:** 详细的结果审查更好
**Ambiguity:** 48.5%（关键设计转向）

### Round 5
**Q:** 5 个脑暴功能筛选：增量翻译/断点续翻/内联审阅/统计仪表盘/增量导出
**A:** 1.增量翻译+词典缓存（要）2.断点续翻（可有可无）3.内联审阅（校验阶段）4.统计仪表盘（要美观）5.完整资源包即可
**Ambiguity:** 30.8%（功能脑暴组件的约束条件清晰化）

### Round 6 (Simplifier Mode)
**Q:** MVP 最小范围是什么？
**A:** 进度条、日志审查面板
**Ambiguity:** 23.8%（功能脑暴标记为暂缓）

### Round 7
**Q:** 后端事件：合并到现有事件 vs 独立事件通道？
**A:** B 独立通道好（用户让我推荐，我推了 B）
**Ambiguity:** 17.5%（低于阈值，准备结束）

</details>

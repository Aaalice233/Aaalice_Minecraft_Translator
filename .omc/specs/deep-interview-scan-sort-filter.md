# Deep Interview Spec: 扫描页列表表格排序与过滤

## Metadata
- Interview ID: di-scan-sort-filter-001
- Rounds: 10
- Final Ambiguity Score: 16.7%
- Type: brownfield
- Generated: 2026-06-05
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 35% | 0.298 |
| Constraint Clarity | 0.80 | 25% | 0.200 |
| Success Criteria | 0.80 | 25% | 0.200 |
| Context Clarity | 0.90 | 15% | 0.135 |
| **Total Clarity** | | | **0.833** |
| **Ambiguity** | | | **16.7%** |

## Topology

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| 排序 (sorting) | active | 点击表头按列排序，三态循环，绿色主题色指示器 | 全部 6 列可排序；单列切换升降序；默认模组名列升序（绿色高亮） |
| 过滤 (filtering) | active | 表头内嵌弹出式列级过滤 | 每列对应控件：文本/下拉选择/数字范围；即时过滤；弹窗保持打开直到外部点击 |
| UI 适配 & 国际化 (i18n-styles) | active | 新增控件的样式和 4 语言翻译 | 翻译文案在实现时按模式添加；CSS 继承现有主题系统 |

## Goal
在扫描概览页（DashboardPage）的模组表格中，添加完整的排序和列级过滤功能，使用户能按任意列排序（三态循环）和按列精确过滤（表头弹出式），提升大规模模组扫描结果的可浏览性。

## Constraints
1. **纯前端实现**：排序和过滤都是客户端操作，不涉及 Rust 后端修改
2. **现有数据模型**：操作 `scanSummary.mods: ModScanResult[]`，不改变类型定义
3. **"待翻译"列为计算字段**：`sourceEntries - targetEntries`，在 JS 中计算
4. **排序范围**：全部 6 列可排序（模组名、Mod ID、格式、语言文件数、待翻译、状态）
5. **过滤控件分布**：
   - 模组名 → 文本输入框
   - Mod ID → 文本输入框
   - 格式（"json" / "lang" 字符串数组）→ 下拉选择（多选，或单选联合值如 "json / lang"）
   - 语言文件数 → 数字范围（最小值/最大值）
   - 待翻译（计算列）→ 数字范围（最小值/最大值）
   - 状态（hasTargetLanguage 布尔值）→ 下拉选择（全部 / 已有目标语言 / 待翻译）
6. **过滤 UI**：表头内嵌弹出式，点击过滤图标打开弹窗，即时过滤，弹窗保持打开直到外部点击
7. **重新扫描时重置**：Rescan 后排序回到默认（模组名升序），过滤全部清除
8. **空结果**：无匹配模组时显示友好提示，不需要额外清除按钮

## Non-Goals
- 不修改 Rust 后端（扫描器、命令层、数据模型）
- 不添加持久化（排序/过滤状态不保存到 settings 或 localStorage）
- 不改变现有扫描流程和进展 UI
- 不涉及翻译流程的排序/过滤（仅限扫描页表格）
- 不需要多列排序

## Acceptance Criteria
- [ ] 每个表头可点击，按三态循环切换：默认（无指示）→ 升序 → 降序 → 默认
- [ ] 点击新列表头时，旧列的排序状态被清除，新列成为当前排序列
- [ ] 默认状态下模组名列显示绿色高亮（升序指示），因为后端默认按 fileName 排序
- [ ] 当前排序列的列头文字/背景使用主题绿色（`#1f8a5b`）高亮
- [ ] 每个表头有过滤图标按钮，点击后弹出对应列的过滤控件弹窗
- [ ] 文本输入过滤实时生效（输入即过滤）
- [ ] 下拉选择和数字范围选择即过滤（无需点击应用）
- [ ] 弹窗保持打开状态，点击弹窗外区域时关闭
- [ ] 有激活过滤条件的列，表头过滤图标有视觉指示（如绿色圆点或高亮图标）
- [ ] 过滤后再排序，排序作用于过滤后的子集
- [ ] 没有匹配结果时，表格显示"没有匹配的模组"提示
- [ ] 点击 Rescan 后，排序状态重置为默认（模组名升序），过滤全部清除
- [ ] 过滤和排序使用 `useMemo` 优化，避免全表不必要的重新渲染
- [ ] 所有新增 UI 文案在 4 种应用语言（zh_cn / en_us / ja_jp / ko_kr）中都有翻译

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 过滤应该用列内嵌弹出式还是简单搜索框 | Contrarian mode (Round 6) 挑战了复杂度假设 | 确认用户坚持完整弹出式列级过滤 |
| 排序应该是二态还是三态 | 明确指出需要"回到默认"的三态循环 | 三态循环 + 默认模组名升序绿色高亮 |
| 过滤弹窗行为 | 即时过滤 vs 手动触发 | 即时过滤，弹窗保持打开直到外部点击 |

## Technical Context
- **目标文件**：`src/pages/DashboardPage.tsx` — 主修改文件
- **类型文件**：`src/types.ts` — 可能需要新增排序/过滤相关的类型
- **翻译文件**：`src/i18n/translations.ts` — 新增 UI 文案
- **样式文件**：`src/styles/app.css` — 新增排序指示器 + 过滤弹窗样式
- **数据流**：`scanSummary.mods: ModScanResult[]` → `useMemo`（排序+过滤）→ 渲染 `<tr>`

### 现有排序
Rust 后端在 `scanner.rs:312` 已做 `results.sort_by(|left, right| left.file_name.cmp(&right.file_name))`。前端默认排序就是模组名升序。

### 计算列说明
"待翻译"列按 `Math.max(0, mod.sourceEntries - mod.targetEntries)` 计算（DashboardPage.tsx:287），过滤时应基于这个计算值做数字范围匹配。

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| ModScanResult | core domain | fileName, modId, formats, languageFileCount, sourceEntries, targetEntries, hasTargetLanguage | 被排序和过滤操作 |
| SortState | supporting | column: string, direction: 'asc' \| 'desc' \| null | 关联到 ModScanResult 的排序属性 |
| ColumnFilterConfig | supporting | column: string, type: 'text' \| 'select' \| 'number-range', value: any | 定义每列的过滤行为 |
| FilterPopover | UI | column, isOpen, filterValue, config | 嵌入表头的弹出面板 |
| SortIndicator | UI | isActive, direction, themeColor: '#1f8a5b' | 表头的排序状态视觉指示 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 2 | 2 | - | - | - |
| 5 | 4 | 2 | 0 | 2 | 100% |
| 10 | 5 | 1 | 0 | 4 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (10 rounds)</summary>

### Round 1
**Q:** 过滤功能应该以什么形式呈现？
**A:** 列级过滤器（类似 Notion/Airtable 风格）
**Ambiguity:** 100% (Goal: 0.5, Constraints: 0.3, Criteria: 0.2, Context: 0.9)

### Round 2
**Q:** 排序的交互方式和范围是什么？
**A:** 单列排序 + 点击切换升降序
**Ambiguity:** 53% (Goal: 0.6, Constraints: 0.3, Criteria: 0.2, Context: 0.9)

### Round 3
**Q:** 各列用什么样的过滤控件？
**A:** 所有列全上——模组名/Mod ID 文本输入，格式/状态下拉，语言文件数/待翻译数字范围
**Ambiguity:** 53% (Goal: 0.7, Constraints: 0.5, Criteria: 0.2, Context: 0.9)

### Round 4
**Q:** 哪些列可排序？
**A:** 全部 6 列可排序
**Ambiguity:** 44.5% (Goal: 0.85, Constraints: 0.7, Criteria: 0.25, Context: 0.9)

### Round 5
**Q:** 过滤控件在表格中的布局？
**A:** 表头内嵌弹出式（点击过滤图标弹出过滤面板）
**Ambiguity:** 33% (Goal: 0.9, Constraints: 0.75, Criteria: 0.25, Context: 0.9)

### Round 6 (Contrarian Mode)
**Q:** 挑战复杂度假设——弹窗式列级过滤真的必要吗？
**A:** 坚持全列弹出式过滤
**Ambiguity:** 30% (Goal: 0.8, Constraints: 0.6, Criteria: 0.3, Context: 0.9)

### Round 7
**Q:** 排序循环行为和指示器风格？
**A:** 三态循环（未排序→升序→降序）+ 主题绿色高亮指示器
**Ambiguity:** 28% (Goal: 0.85, Constraints: 0.75, Criteria: 0.4, Context: 0.9)

### Round 8
**Q:** 过滤弹窗行为模式 + Rescan 重置行为？
**A:** 即时过滤 + 弹窗保持打开直到外部点击；Rescan 重置排序和过滤
**Ambiguity:** 31% (Goal: 0.8, Constraints: 0.6, Criteria: 0.5, Context: 0.9)

### Round 9
**Q:** 空结果状态 + 计算列过滤？
**A:** 显示"没有匹配的模组"提示（无清除按钮）；"待翻译"列用数字范围过滤
**Ambiguity:** 21.7% (Goal: 0.85, Constraints: 0.7, Criteria: 0.7, Context: 0.9)

### Round 10
**Q:** 默认排序状态的视觉表现？
**A:** 默认绿色指示在模组名列（升序），因为后端已按 fileName 排序
**Ambiguity:** 16.7% ✅ (Goal: 0.85, Constraints: 0.8, Criteria: 0.8, Context: 0.9)

</details>

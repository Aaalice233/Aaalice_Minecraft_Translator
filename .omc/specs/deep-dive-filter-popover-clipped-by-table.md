# Deep Dive Spec: 过滤弹窗被表绘制范围截断

## Metadata
- Interview ID: deep-dive-filter-clip-001
- Rounds: 1
- Final Ambiguity Score: 15%
- Type: brownfield
- Generated: 2026-06-05
- Threshold: 0.2
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 35% | 0.333 |
| Constraint Clarity | 0.90 | 25% | 0.225 |
| Success Criteria | 0.60 | 25% | 0.150 |
| Context Clarity | 0.95 | 15% | 0.143 |
| **Total Clarity** | | | **0.85** |
| **Ambiguity** | | | **15%** |

## Trace Findings
- **根因**: `.table-wrap { overflow-x: auto }` 裁剪了内部绝对定位的过滤弹窗
- **载体**: 过滤弹窗锚定在 `<th>` 内部，绝对定位向右展开时超出容器边界
- **影响列**: 最右 1-2 列（待翻译、状态）影响最严重
- **关键未知已解决**: 修复方案确定为右列 `right: 0` 向左展开

## Goal
修复状态列（及右列）过滤弹窗被 `.table-wrap` 的 `overflow-x: auto` 裁剪的问题。

## Constraints
- 仅 CSS 改动，不修改 JSX 结构
- 对右起 2 列（`pending`、`hasTargetLanguage`）使用 `right: 0` 替代 `left: 0`
- 不改动现有弹窗功能和样式

## Acceptance Criteria
- [ ] 状态列过滤弹窗完整可见，不被裁剪
- [ ] 待翻译列过滤弹窗完整可见，不被裁剪
- [ ] 左侧 4 列（模组名、Mod ID、格式、语言文件数）弹窗行为保持不变
- [ ] TypeScript 编译无错误
- [ ] 前端构建成功

## Technical Context
- 目标文件: `src/styles/app.css`
- 改动: 为 `.filter-popover.popover-right` 添加 `right: 0; left: auto;`
- 触发方式: 当列 key 为 `pending` 或 `hasTargetLanguage` 时，在弹窗 div 上添加 `popover-right` 类

## Interview Transcript
<details>
<summary>Full Q&A (1 round)</summary>

### Round 1 (Trace Injected)
**Q:** 过滤弹窗被表格 overflow 容器裁剪。倾向哪种修复方案？
**A:** 右列向左展开（对右起 1-2 列使用 `right: 0`）
**Ambiguity:** 15% ✅

</details>

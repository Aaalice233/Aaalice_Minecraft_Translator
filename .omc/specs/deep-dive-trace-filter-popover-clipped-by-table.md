# Deep Dive Trace: filter-popover-clipped-by-table

## Observed Result
状态列（最右列）的过滤弹窗被表格容器的绘制边界截断，弹窗右侧部分不可见。

## Ranked Hypotheses
| Rank | Hypothesis | Confidence | Evidence Strength | Why it leads |
|------|------------|------------|-------------------|--------------|
| 1 | CSS overflow/容器裁剪 | High | Strong | 直接观察到了 DOM 结构冲突 |
| 2 | Viewport 右边界溢出 | Medium | Moderate | 即使修复容器裁剪，视口过窄时仍可能溢出 |
| 3 | z-index/层叠上下文 | Low | Weak | z-index 100 在根层叠上下文中足够高，实际没有遮挡 |

## Evidence Summary by Hypothesis

### Hypothesis 1: CSS overflow/容器裁剪 ⭐ 主要根因
- **DOM 嵌套链**: `section.panel → div.table-wrap(overflow-x:auto) → table → thead → tr → th → span.th-filter-wrap(position:relative) → div.filter-popover(position:absolute, left:0)`
- `.table-wrap` 在第 543 行定义了 `overflow-x: auto`，创建了裁剪容器
- `.filter-popover` 在第 641-642 行使用 `position: absolute`，**锚定在 `overflow-x: auto` 容器内部的 `<th>` 上**
- 当弹窗向右延伸时，超出 `.table-wrap` 的可见边界，被 `overflow-x: auto` 裁剪
- **这是根本原因**：`overflow: auto` 容器内部的绝对定位元素无法突破容器的可见边界

### Hypothesis 2: Viewport 右边界溢出
- 状态列是第 6 列（最右列），弹窗默认从 `left: 0` 向右展开
- `body` 有 `min-width: 1100px`，但应用窗口可调整大小
- 即使修复 overflow 问题，在窄窗口下弹窗仍可能超出视口
- **次级问题**：在修复主问题后需要考虑

### Hypothesis 3: z-index/层叠上下文
- `.filter-popover` 有 `z-index: 100`，处于根层叠上下文
- 周围元素（panel、stat-card 等）没有设置 z-index
- 后续 panel 没有覆盖弹窗的证据
- **排除此假设**

## Evidence Against / Missing Evidence
- **Hypothesis 1**: 无反对证据。DOM 结构和 CSS 属性明确指向 overflow 裁剪
- **Hypothesis 2**: 需要用户视口宽度数据确认；目前是推理
- **Hypothesis 3**: z-index 100 足够高；没有发现更高 z-index 的同级元素

## Rebuttal Round
- Hypothesis 2 的反驳：即使弹窗在视口外，`overflow-x: auto` 也应该显示滚动条让用户滚动看到弹窗。但弹窗被裁剪了，说明不是纯视口问题。
- → Hypothesis 1 仍然成立。

## Convergence / Separation Notes
- Hypothesis 1 和 2 是串联关系：先解决 overflow 裁剪（1），再考虑右边界溢出（2）
- Hypothesis 3 与本问题无关

## Most Likely Explanation
**根因：** `.table-wrap { overflow-x: auto }` 裁剪了内部绝对定位的过滤弹窗。弹窗锚定在 `<th>` 内部的 `.th-filter-wrap` 上，但由于表结构嵌套在 `overflow-x: auto` 容器内，弹窗向右延伸的部分被容器边界裁剪。

## Critical Unknown
触发弹窗定位反转（向左展开）的最佳条件：是固定对最右 1-2 列使用 `right: 0`，还是需要更通用的智能定位策略？

## Recommended Discriminating Probe
在所有列上打开过滤弹窗，观察：
1. 最右 1-2 列（状态、待翻译）是否被裁剪 → 确认 Hypothesis 1
2. 其他列是否正常 → 确认左对齐弹窗只在右边界有问题

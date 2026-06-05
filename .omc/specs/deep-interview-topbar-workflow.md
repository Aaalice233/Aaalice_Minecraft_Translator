# Deep Interview Spec: 顶栏流程控制扩展

## Metadata
- Interview ID: deep-interview-topbar-workflow
- Rounds: 7
- Final Ambiguity Score: 14%
- Type: brownfield
- Generated: 2026-06-04
- Threshold: 0.2
- Threshold Source: default
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 35% | 0.315 |
| Constraint Clarity | 0.85 | 25% | 0.212 |
| Success Criteria | 0.82 | 25% | 0.205 |
| Context Clarity | 0.88 | 15% | 0.132 |
| **Total Clarity** | | | **0.86** |
| **Ambiguity** | | | **14%** |

## Topology

| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| 信息展示面板 (Instance Info) | active | 顶栏左侧显示实例路径和语言对 | 实例路径+来源语言→目标语言；语言对在设置保存时预览、扫描完成后修正 |
| 下一阶段导航 (Next-Stage Navigation) | active | 根据流水线状态显示"下一阶段"导航控件 | 按钮始终存在，当前页时置灰；点击跳转到下一阶段的独立页面 |
| 流水线进度条 (Pipeline Progress) | active | 可折叠面包屑导航展示流水线全部5个阶段 | 可折叠：已解锁阶段展开显示，未解锁阶段折叠为圆点 |
| 阶段级快捷操作 (Stage-Specific Actions) | active | 各阶段的操作按钮 | 明确：操作按钮留在各页面内，顶栏不承载阶段级操作 |
| 全局状态指示器 (Global Status Indicators) | active | 通过面包屑状态反映整体流水线状态 | 由面包屑各阶段的图标/颜色承载，不额外增加独立指示器 |

### Deferrals
无。所有 5 个组件均为活跃。

## Goal
将 Aaalice Minecraft Translator 的顶栏从当前仅显示实例路径和阶段文本的简单信息栏，扩展为含可折叠面包屑导航的流程控制中心。顶栏的核心职责是**控制阶段跳转**，具体操作按钮留在各页面内。

## 设计原则
1. **顶栏只控制跳转，不承载操作**——操作按钮留在具体页面内
2. **保持简洁**——不额外添加跨阶段全局功能（搜索/词典快捷查看等）
3. **可折叠面包屑**——已解锁阶段展开可见，未解锁阶段折叠为圆点，悬停展开
4. **始终可导航**——"下一阶段"按钮始终存在，已在目标页面时置灰

## Constraints
1. 面包屑显示全部 5 个流水线阶段：**扫描 → 匹配 → 翻译 → 校验 → 打包**
2. 每个阶段对应一个独立页面（未来规划 5 个独立页面）
3. 阶段间流程控制：
   - **扫描→匹配**：自动串联（无需人工确认）
   - **匹配→翻译**：停在匹配页，等人确认后手动启动翻译
   - **翻译→校验**：自动串联
   - **校验→打包**：停在校验页，等人检查冲突后手动打包
4. "下一阶段"按钮始终在顶栏显示，目标页面为当前页时置灰不可点击
5. 顶栏左侧信息区域：实例路径 + 来源语言→目标语言（如 `E:/.../Aaalice Craft` · `en_us → zh_cn`）
6. 语言对更新策略：设置保存时立即预览显示，扫描完成后根据实际结果修正
7. 错误状态：**部分失败**显示 ⚠️ 警告 + 允许继续进入下一阶段；**完全失败**显示 ❌ 错误 + 阻止进入下一阶段
8. 原有顶栏的硬编码阶段文本（"第一阶段：扫描闭环"）**完全移除**，由面包屑替代

## Non-Goals
- 不在顶栏添加搜索框、词典快捷查看、语言切换等跨阶段全局功能
- 不在顶栏添加各阶段的具体操作按钮（开始翻译/暂停/取消等留在页面内）
- 不在此阶段实现页面级的各阶段具体功能逻辑
- 不实现 FTB 任务或硬编码汉化的阶段控制（这些不在首期主线）

## Acceptance Criteria
- [ ] 顶栏左侧显示实例路径 + 来源语言→目标语言（如 `E:/PCL2/.../Aaalice Craft · en_us → zh_cn`）
- [ ] 面包屑导航显示 5 个阶段：扫描→匹配→翻译→校验→打包
- [ ] 未解锁阶段默认折叠显示为圆点，悬停/点击展开
- [ ] 当前阶段高亮，已完成阶段打 ✅ 标记
- [ ] "下一阶段"按钮始终在顶栏可见，已在目标页面时置灰
- [ ] 扫描→匹配：自动串联，无需手动确认
- [ ] 匹配→翻译：停在匹配页，需手动确认启动翻译
- [ ] 翻译→校验：自动串联
- [ ] 校验→打包：停在校验页，需手动确认打包
- [ ] 语言对在设置保存时预览、扫描完成后根据结果修正
- [ ] 部分失败显示 ⚠️ 标记 + 允许继续
- [ ] 完全失败显示 ❌ 标记 + 阻止进入下一阶段
- [ ] 旧的"第一阶段：扫描闭环"文本被完全移除
- [ ] Tauri command 层面无破坏性变更（向后兼容）

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "应该把所有操作按钮放进顶栏" | 挑战模式 (Round 5)：是否需要全部 5 阶段面包屑 | 顶栏只控制跳转，操作留在页面内 |
| "需要完整的 5 阶段面包屑" | 挑战模式 (Round 5)：会不会信息过载 | 可折叠方案：已解锁展开，未解锁为圆点 |
| "下一阶段按钮只在扫描完成后出现" | Round 6 收尾 | 始终显示，当前页时置灰 |
| "语言对只在扫描完成后更新" | Round 6 收尾 | 设置保存时预览 + 扫描完成后修正 |

## Technical Context

### 当前代码结构
- 顶栏实现在 `src/app/App.tsx` 第 136-142 行
- 左侧：实例路径（`settings?.instancePath`），右侧：硬编码阶段文本
- 页面切换通过 `activePage` state 和侧边栏导航按钮驱动
- 当前页面类型：`dashboard | jobs | dictionary | packages | ftb | hardcoded | settings | logs`
- 当前阶段文本 `"app.phase"` 在 `src/i18n/translations.ts` 中为硬编码字符串
- 扫描状态通过 `ScanSummary` 在上层 App 组件维护

### 建议实现方向
1. **面包屑组件**：新建 `src/components/PipelineBreadcrumb.tsx`，接收 `currentStage` 和 `stageStatuses` props
2. **流水线状态管理**：在 App.tsx 中新增 `pipelineStage` state（或通过 context 管理）
3. **Stage enum**：定义 `Scan | Match | Translate | Validate | Pack` 枚举
4. **"下一阶段"按钮逻辑**：根据当前 stage 计算 `nextStage`，映射到对应的 `PageKey`
5. **页面-阶段映射**：各阶段对应独立页面，当前 `DashboardPage` 对应扫描，`JobsPage` 对应翻译，`PackagesPage` 对应打包，需要新增匹配、校验页面（或用 placeholder）
6. **i18n**：新增面包屑相关翻译键（`pipeline.scan`, `pipeline.match`, `pipeline.translate` 等）

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Topbar | UI 组件 | 实例路径、语言对、面包屑导航 | Topbar 包含 Breadcrumb、InstanceInfo |
| Breadcrumb | 导航组件 | 阶段列表、状态(未解锁/当前/已完成/失败)、折叠状态 | Breadcrumb 显示 PipelineStage；Breadcrumb 可点击导航 |
| PipelineStage | 核心概念 | 名称、状态(locked/active/completed/failed_partial/failed_total)、顺序(1-5) | PipelineStage 有 5 种：扫描/匹配/翻译/校验/打包 |
| InstanceInfo | 信息面板 | 实例路径、来源语言、目标语言 | InstanceInfo 显示在 Topbar 左侧 |
| NextStageButton | 导航控件 | 目标页面、启用状态(enabled/disabled)、当前页标记 | NextStageButton 指向下一阶段页面 |
| PipelineFlow | 流程定义 | 阶段列表、自动/手动标记、完成条件 | PipelineFlow 定义阶段间转换规则 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 3 | 3 | - | - | - |
| 2 | 4 | 2 | 0 | 2 | 50% |
| 3 | 5 | 1 | 0 | 4 | 80% |
| 4 | 5 | 0 | 0 | 5 | 100% |
| 5 | 6 | 1 | 0 | 5 | 83% |
| 6 | 6 | 0 | 0 | 6 | 100% |
| 7 | 6 | 0 | 0 | 6 | 100% |

## Interview Transcript

<details>
<summary>Full Q&A (7 rounds)</summary>

### Round 0: Topology Confirmation
**Q:** 拓扑结构确认——5 个组件正确吗？
**A:** 看起来正确。

### Round 1: 下一阶段导航 — Goal Clarity
**Q:** "下一阶段"按钮跳转到哪里？
**A:** 跳转到翻译/任务页面 (JobsPage)。

### Round 2: 流水线进度条 — Constraints
**Q:** 面包屑形态？哪些步骤自动/手动？
**A:** 可点击面包屑导航；扫描→匹配自动，匹配→翻译待确认，翻译→校验自动，校验→打包待确认。

### Round 3: 阶段级快捷操作 — Criteria
**Q:** 各阶段操作按钮？
**A:** 操作按钮留给具体页面，顶栏控制阶段跳转即可。

**Q:** 跨阶段功能？
**A:** 保持简洁，不额外加。

### Round 4: 信息展示面板 — Goal
**Q:** 信息区域显示什么？阶段文字保留吗？
**A:** 路径 + 语言对；旧阶段文字去掉，面包屑足够。

### Round 5: Contrarian Mode — 挑战全面包屑假设
**Q:** 全面包屑 vs 简洁版？
**A:** 可折叠面包屑——已解锁展开，未解锁折叠为圆点。

### Round 6: Simplifier Mode + 收尾
**Q:** "下一阶段"按钮何时出现？语言对更新时机？
**A:** 始终显示，当前页置灰；语言对：设置保存预览 + 扫描完成后修正。

### Round 7: 最终收尾 — 阶段→页面映射 & 错误状态
**Q:** 阶段到页面映射？错误状态？
**A:** 每个阶段独立页面；部分失败⚠️可继续，完全失败❌阻止进入下一阶段。

</details>

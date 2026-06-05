# 共识计划：顶栏流程控制扩展

## RALPLAN-DR 摘要

### 原则
1. **最小改动**——只修改顶栏及相关状态管理，不重构现有页面内部逻辑。
2. **关注点分离**——顶栏只负责导航跳转和状态指示；操作按钮留在各页面内部。
3. **渐进式实现**——新增的匹配/校验页面先用 placeholder 填充，后续逐步接入真实逻辑。
4. **向后兼容**——不破坏现有 Tauri command 接口和数据流；ScanSummary、Settings 等现有类型不变。

### 决策驱动因素
1. **可折叠面包屑 vs 固定面包屑**：五阶段全展开会信息过载，但未解锁阶段完全隐藏会让用户迷失；折中方案——已解锁阶段展开，未解锁阶段折叠为圆点，悬停展开。
2. **阶段状态存储位置**：全局状态管理（context）vs 提升到 App.tsx；考虑到当前项目不使用 context 库且仅 App.tsx 需要持有状态，选择提升到 App.tsx 的 `useState`。
3. **页面-阶段映射中的新增页面**：当前已有 DashboardPage（扫描）、JobsPage（翻译）、PackagesPage（打包），缺少 MatchPage（匹配）和 ValidatePage（校验）——选择用 placeholder 继承方式快速填充。

### 可选方案
#### 方案 A：Composable Topbar + usePipeline Hook（推荐）
**方法：** 新建 `PipelineBreadcrumb` 组件 + `usePipeline()` 自定义 hook。hook 封装所有流水线状态和转换逻辑；Breadcrumb 组件纯展示。
**优点：** 结构清晰、状态逻辑可独立测试、符合 React 惯用模式、App.tsx 不膨胀。
**缺点：** 需要稍多文件修改（约 7-9 个文件），但改动幅度可控。

#### 方案 B：Inline Topbar Expansion + Inline State
**方法：** 在 App.tsx 顶栏区域直接内联实现面包屑和状态逻辑，不拆分子组件和 hook。
**优点：** 改动文件最少（3-5 个）。
**缺点：** App.tsx 膨胀，状态转换逻辑混在组件中难以测试，违反关注点分离。

**选择方案 A** 因为项目已有清晰的组件拆分模式（各页面独立文件），且 5 阶段 + 3 种推进模式（auto/manual/blocked）的状态管理复杂到足以值得独立 hook。

---

## 实施步骤

### 第 1 步：扩展类型定义
**涉及文件：** `src/types.ts`、`src/app/App.tsx`
**改动内容：**
- 新增 `PipelineStage` 联合类型：`"scan" | "match" | "translate" | "validate" | "pack"`
- 新增 `StageStatus` 类型：`"locked" | "active" | "completed" | "failed_partial" | "failed_total"`
- 新增 `PipelineState` 接口，包含 `currentStage: PipelineStage` 和 `stageStatuses: Record<PipelineStage, StageStatus>`
- 导出 `PIPELINE_STAGES` 常量数组（`["scan", "match", "translate", "validate", "pack"]`）和 `STAGE_TO_PAGE` 映射对象：
  - `"scan" → "dashboard"`, `"match" → "match"`, `"translate" → "jobs"`, `"validate" → "validate"`, `"pack" → "packages"`
- 在 `App.tsx` 中扩展 `PageKey` 类型，增加 `"match"` 和 `"validate"`

### 第 2 步：添加 i18n 翻译键
**涉及文件：** `src/i18n/translations.ts`
**改动内容：**
- 新增 `TranslationKey` 条目：
  - `"pipeline.scan"` → 扫描
  - `"pipeline.match"` → 匹配
  - `"pipeline.translate"` → 翻译
  - `"pipeline.validate"` → 校验
  - `"pipeline.pack"` → 打包
  - `"pipeline.nextStage"` → 下一阶段（Next Stage）
  - `"pipeline.langPair"` → `{source} → {target}`（参数化）
- 在 4 个语言字典（zhCn/enUs/jaJp/koKr）中分别填写对应翻译
- **移除** `"app.phase"` 这个已不再需要的键（包括 `TranslationKey` 定义和所有语言字典）

### 第 3 步：新建 PipelineBreadcrumb 组件
**涉及文件：** `src/components/PipelineBreadcrumb.tsx`（新建文件）
**改动内容：**
- 接收 props：
  - `currentStage: PipelineStage`
  - `stageStatuses: Record<PipelineStage, StageStatus>`
  - `onNavigate: (stage: PipelineStage) => void`
  - `language: AppLanguage`
- 渲染逻辑：
  - 水平排列 5 个阶段节点，节点间用箭头分隔符（→）
  - 已解锁阶段（`active` / `completed` / `failed_partial` / `failed_total`）显示：图标 + 阶段名称
  - 未解锁阶段（`locked`）折叠为圆点（●），hover 时展开显示阶段名称
  - 阶段图标：
    - `completed` → ✅ 绿色对勾
    - `active` → 当前阶段名称高亮（绿色文字）
    - `failed_partial` → ⚠️ 橙色警告
    - `failed_total` → ❌ 红色叉
    - `locked` → ● 灰色圆点
  - 当前阶段不可点击，其他可点击触发 `onNavigate`
- 样式：使用 inline styles 或添加 CSS 类 `.pipeline-breadcrumb` 并在步骤 5 中定义样式

### 第 3.5 步：新建 usePipeline 自定义 Hook
**涉及文件：** `src/app/usePipeline.ts`（新建文件）
**改动内容：**
- 创建自定义 React hook `usePipeline()`，封装所有流水线状态和转换逻辑：
  - 内部状态：`currentStage: PipelineStage`，初始值 `"scan"`
  - 内部状态：`stageStatuses: Record<PipelineStage, StageStatus>`，初始除 `scan` 为 `"active"` 外全为 `"locked"`
  - 函数 `advanceStage()`：将 `currentStage` 推进到下一个阶段（按 `PIPELINE_STAGES` 顺序），更新对应 `stageStatuses`
  - 函数 `resetPipeline()`：将所有阶段重置为初始状态
  - 函数 `markStageFailed(stage, type)`：将指定阶段标记为 `"failed_partial"` 或 `"failed_total"`
  - 函数 `onScanComplete(activePage, STAGE_TO_PAGE)`：扫描完成时调用，内部处理自动推进逻辑
  - 导出 `nextStage: PipelineStage | null`（计算属性，根据 `currentStage` 和 `stageStatuses` 确定下一步）
- 完整的状态转换表（嵌入 hook 内部逻辑）：
  - `locked → active`：前一阶段 `completed` 时自动或手动触发
  - `active → completed`：阶段业务逻辑完成时触发
  - `active → failed_partial`：部分失败时触发（允许继续）
  - `active → failed_total`：完全失败时触发（阻止进入下一阶段）
  - `completed → locked`：仅重新扫描时触发
- 提供清晰的 TypeScript 类型定义和 JSDoc 注释

### 第 4 步：重构 App.tsx 顶栏
**涉及文件：** `src/app/App.tsx`
**改动内容：**
- 顶部新增 import：`PipelineBreadcrumb` 组件、`usePipeline` hook、`PIPELINE_STAGES`/`STAGE_TO_PAGE` 类型
- 使用 `usePipeline()` hook 替代直接 state 管理：
  - `const { currentStage, stageStatuses, advanceStage, nextStage, resetPipeline, onScanComplete } = usePipeline()`
- 新增工具函数：
  - `getCurrentPageKey()`：将 `PipelineStage` 映射到 `PageKey`
  - 自动/手动流程转换逻辑（扫描完成时自动推进到 match，翻译完成自动推进到 validate，match→translate 和 validate→pack 等待手动确认）
  - "下一阶段"按钮逻辑：
    - `nextStage` 为 `null`（当前为 `pack`）→ 按钮置灰，文本显示"最终阶段"
    - 当前页为目标页 → 按钮 disabled
    - 点击时调用 `advanceStage()` + 页面跳转
- 重构顶栏区域（替换第 136-142 行的现有顶栏）：
  - 左侧信息面板：实例路径 + 语言对（`en_us → zh_cn`）
  - 中间：`<PipelineBreadcrumb>` 组件
  - 右侧："下一阶段"按钮（始终显示；当前页面为目标阶段页时 disabled；点击时计算下一阶段并跳转）
- **完全移除** 旧的 `{t(language, "app.phase")}` 和 `.topbar-status` 相关代码
- 钩子：监听 `scanSummary` 变化，当扫描完成时自动推进阶段到 `"match"`
- 创建 `MatchPage` 和 `ValidatePage` 的 import/路由（步骤 7 的 import 准备）

### 第 5 步：PipelineBreadcrumb CSS 样式
**涉及文件：** `src/styles/app.css`
**改动内容：**
- 新增 `.pipeline-breadcrumb` 类：水平 flex 布局，gap，居中对齐
- 新增 `.pipeline-stage-node`：圆角胶囊形状，padding，font-size 13px
- 新增 `.pipeline-stage-completed`（绿色背景）、`.pipeline-stage-active`（绿色文字粗体）、`.pipeline-stage-locked`（灰色圆点）、`.pipeline-stage-failed-partial`（橙色）、`.pipeline-stage-failed-total`（红色）
- 新增 `.pipeline-dot`：8px 圆形，用于折叠状态
- 新增 `.pipeline-arrow`：分隔符样式
- 新增 `.next-stage-button`：与现有 `.primary-button` 风格一致，高度 32px 适配顶栏
- 新增 `.topbar-info`：左侧信息区域样式显示实例路径和语言对
- 新增 `.topbar-info-path`：实例路径 span 样式
- 新增 `.topbar-info-langpair`：语言对 span 样式（灰色文字、12px）

### 第 6 步：创建 MatchPage（匹配页面 placeholder）
**涉及文件：** `src/pages/MatchPage.tsx`（新建文件）
**改动内容：**
- 创建与 PlaceholderPage 风格一致的 placeholder 页面，标题为"匹配阶段"
- 显示扫描结果摘要（从 `scanSummary` 获取）
- 包含"确认并开始翻译"按钮（用于触发 match→translate 的手动确认流程）
- Props：`language`, `scanSummary`, `onConfirm: () => void`
- 注意：此页在首期只需 placeholder 功能——显示匹配预览，手动触发跳转到翻译页

### 第 7 步：创建 ValidatePage（校验页面 placeholder）
**涉及文件：** `src/pages/ValidatePage.tsx`（新建文件）
**改动内容：**
- 创建 placeholder 页面，标题为"冲突校验"
- 首期只需显示"校验阶段 - 后续接入"的 placeholder 文本
- 包含"确认打包"按钮（用于触发 validate→pack 的手动确认流程）
- Props：`language: AppLanguage`, `onConfirm: () => void`（首期不接真实数据，后续接入时再扩展）
- **注意**：`translationResult` 类型当前不存在，首期完全不接收此 prop

### 第 8 步：更新页面路由映射
**涉及文件：** `src/app/App.tsx`（更新）
**改动内容：**
- 在 `content` 的 useMemo 中添加 `MatchPage` 和 `ValidatePage` 的路由
- 暂时设定：`activePage` 切换不直接进入 match/validate——由 `currentStage` 控制。但 `activePage === "match"` 和 `activePage === "validate"` 需要路由到对应页面
- 或者：保持侧边栏导航不变，只为阶段跳转新增路由路径。侧边栏点击依旧跳转到原有 `PageKey`，阶段导航使用 `currentStage` → `STAGE_TO_PAGE` 确定目标页面
- （Architecture Note：由于 `PageKey` 和 `PipelineStage` 不完全一致，在 App.tsx 中维护一个实时 `activePage` 和 `currentStage` 的同步关系——当 `currentStage` 改变时自动计算对应 `activePage` 并跳转）

### 第 9 步：连接扫描完成自动推进逻辑
**涉及文件：** `src/app/App.tsx`
**改动内容：**
- 在 `scanSummary` 状态更新后（即扫描完成时），调用 `usePipeline().onScanComplete(activePage, STAGE_TO_PAGE)`
- 自动推进逻辑（实现在 `usePipeline` hook 中）：
  ```typescript
  // 伪代码逻辑
  onScanComplete(activePage, stageToPage) {
    // 先将 scan 标记为 completed
    this.setStageStatus("scan", "completed");
    this.setStageStatus("match", "active");
    this.setCurrentStage("match");
    
    // 条件守卫：仅在当前页面为扫描页时自动跳转
    if (activePage === stageToPage["scan"]) {
      // 用户还在 dashboard 页 → 自动导航到 match 页
      return stageToPage["match"]; // 让 App.tsx 执行跳转
    } else {
      // 用户在其他页面（settings/logs 等）→ 只更新状态，不导航
      return null; // App.tsx 不跳转
    }
  }
  ```
- **重新扫描（Rescan）处理：**
  - 当用户点击"重新扫描"时，调用 `usePipeline().resetPipeline()`
  - 将所有 `stageStatuses` 重置：`scan → "active"`，其余 `→ "locked"`
  - `currentStage` 重置为 `"scan"`
  - 扫描完成后再按上述逻辑自动推进
  - **注意**：如果用户当前在其他阶段页面（如 translate），重新扫描会重置状态，显示 Alert 提示"扫描结果已更新，请重新确认"

### 第 10 步：生成语言对显示逻辑
**涉及文件：** `src/app/App.tsx`
**改动内容：**
- 顶栏左侧信息面板除实例路径外，添加语言对显示
- 语言对格式：`{sourceLanguage} → {targetLanguage}`
- 从 `settings` 和 `scanSummary` 中获取实际语言：
  - 设置保存时：直接显示 `settings.sourceLanguage` → `settings.targetLanguage`
  - 扫描完成后：显示 `scanSummary.sourceLanguage` → `scanSummary.targetLanguage`（可能修正）
- 扫描完成后如果 `settings.sourceLanguage === "auto"`，显示 `scanSummary.sourceLanguage` 而不是 `"auto"`

---

## 页面阶段映射总表

| 阶段 (PipelineStage) | 对应页面 (PageKey) | 当前实现状态 | 自动/手动进入 |
|---|---|---|---|
| scan | dashboard | 已有（DashboardPage） | 初始页 |
| match | _（新增 stage=match 逻辑）_ | 新增 MatchPage (placeholder) | 扫描完成后自动 |
| translate | jobs | 已有（JobsPage） | 匹配确认后手动 |
| validate | _（新增 stage=validate 逻辑）_ | 新增 ValidatePage (placeholder) | 翻译完成后自动 |
| pack | packages | 已有（PackagesPage） | 校验确认后手动 |

---

## 验收标准（继承自 Deep Interview）
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

---

## 实现顺序图

```
Step 1 (types.ts)          → 类型定义
      ↓
Step 2 (i18n)              → 翻译键
      ↓
Step 3 (PipelineBreadcrumb) → 新建组件
      ↓
Step 5 (app.css)           → 面包屑样式
      ↓
Step 6 + 7 (MatchPage + ValidatePage) → 新建页面
      ↓
Step 4 + 8 + 9 + 10 (App.tsx) → 顶栏重构核心（依赖前面所有步骤）
```

**建议执行顺序：** 1 → 2 → 3 → 5 → 6 → 7 → 4+8+9+10（4-8-9-10 都在 App.tsx 中，可以一次完成）

---

## 风险和缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| Stage 状态管理复杂度随流程增长 | 代码可读性下降 | 中 | 通过 `usePipeline()` hook 封装所有状态和转换逻辑，App.tsx 仅消费 hook 的返回值 |
| 扫描完成后自动跳转可能打断用户操作 | 用户体验下降 | 低 | 条件守卫：仅在当前页面为前一阶段页面时自动跳转；如果用户在看其他页面则只更新面包屑状态 |
| MatchPage/ValidatePage 的 placeholder 可能导致用户困惑 | UX 困惑 | 中 | 页面明确标注"首期 placeholder"和"下一阶段按钮"引导用户继续 |
| 侧边栏导航和面包屑导航之间存在状态不一致 | 导航矛盾 | 中 | 面包屑始终反映 `currentStage`，侧边栏始终反映 `activePage`。`usePipeline` 的 `onScanComplete()` 仅在用户在前一阶段页面时自动导航 |
| 部分失败/完全失败状态触发时间点不确定 | 状态不一致 | 低 | 首期采用前端推导策略：根据 `scanSummary.cancelled` 和 `scanSummary.warnings.length > 0` 推导扫描阶段状态；翻译/校验阶段状态待后续接入真实逻辑时由后端事件驱动 |
| 重新扫描可能覆盖用户当前工作 | 数据丢失 | 低 | 调用 `resetPipeline()` 前检查当前 `currentStage` 是否在 scan 阶段；如果不是，显示确认对话框"重新扫描将重置流水线进度，确定继续？" |

## 验证步骤

### 验收标准验证（手动/浏览器测试）
执行 `npm run tauri dev` 后逐项验证：

| 验收标准 | 验证方法 |
|----------|----------|
| 顶栏左侧显示实例路径 + 来源语言→目标语言 | 在设置页配置语言对后观察顶栏 |
| 面包屑导航显示 5 个阶段 | 观察顶栏中间区域 |
| 未解锁阶段默认折叠为圆点 | 初始启动时观察 match/translate/validate/pack 显示为圆点 |
| 当前阶段高亮，已完成打 ✅ | 扫描完成后观察 scan 阶段变为 ✅ |
| "下一阶段"按钮始终可见，当前页时置灰 | 在各页面间导航观察按钮状态 |
| 扫描→匹配自动串联 | 点击"开始扫描"→ 扫描完成后观察自动跳转到 match 页 |
| 匹配→翻译需手动确认 | 在 match 页点击"确认并开始翻译"→ 观察页面跳转到 jobs |
| 扫描完成后语言对修正 | `settings.sourceLanguage="auto"` 时扫描完成后观察顶栏语言对更新 |

### 前端构建验证
```bash
cd "E:/MC Projects/Aaalice_Minecraft_Translator" && npx tsc --noEmit 2>&1
```
- 确保无 TypeScript 类型错误

### 前端测试验证
```bash
npm run test:unit 2>&1 | tail -5
```
- 确保已有测试不因改动而失败
- （可选）为 `usePipeline()` hook 和 `PipelineBreadcrumb` 组件添加单元测试

## 变更日志（共识评审后修订）

| 版本 | 改动 |
|------|------|
| v1.0（初始） | Planner 创建的初始计划 |
| v1.1（Architect 评审后） | 新增 `usePipeline()` hook 步骤（3.5）；扩展 `PageKey` 包含 match/validate；添加自动推进条件守卫；添加重新扫描处理逻辑；修正 ValidatePage props 接口 |
| v1.2（Critic 评审后） | 补充验证步骤表和命令；明确"下一阶段"按钮在末端阶段的行为；添加变更日志 |

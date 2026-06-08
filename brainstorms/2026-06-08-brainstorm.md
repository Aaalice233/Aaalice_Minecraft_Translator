# Brainstorm Brief: 校验阶段定位修正

## Current leaning
确认了 ValidatePage 的正确定位是**人工校对工作台**（manual review workbench），而非校验错误报告页面。此处不存在分歧——这是对概念的纠正，尚未进入设计或实施。

## 关键澄清
- **错误理解被纠正**：此前误将校验阶段理解为展示 LLM 翻译报错/校验问题（占位符丢失、格式错误等）。正确用途是：
  1. 列出 LLM 翻译的全部条目（而非仅问题条目）
  2. 按 mod 分组
  3. 人工逐条审核与编辑译文
  4. 用户认为满意后可进入打包阶段
- **当前页面存在根本性偏差**：数据源（`validateTranslation` → 只返回 issue）、展示内容（错误/警告统计而非翻译条目）、交互方式（无内联编辑）均需要重做。

## 已明确的用户偏好
1. **交互形式**：表格内联编辑（原文/译文并排，译文列可直接编辑）
2. **进度追踪**：无需系统追踪，用户自行判断
3. **确认流程**：不强制所有条目通过审核，用户自行决定何时打包

## 需要新增的基础设施
- **后端**：新增 Tauri command `load_translation_results`，暴露 `JobManager::load_results()` 返回 `Vec<TranslationResult>`
- **前端类型**：在 `types.ts` 中增加 `TranslationResult`（含 `key`, `sourceText`, `targetText`, `modId`, `modName`, `sourceType`）
- **页面改造**：ValidatePage 从"校验报告"完全重构为"人工校对工作台"

## 未解决的问题/待权衡
- `validateTranslation` 已有的 placeholder/format 校验提示是否需要作为辅助信息嵌入校对页面，还是完全废弃
- 内联编辑后的译文如何持久化保存（直接写回 JSONL？还是新建 review 结果文件？）
- 打包阶段是否需要加载审核后的译文而非原始翻译结果

## Transcript Summary
用户纠正了 assistant 对校验阶段定位的理解——不是看 LLM 翻译报错的阶段，而是人工校对 LLM 翻译全部条目的工作台。用户通过三个选择题明确了交互方式（内联编辑表格）、进度追踪（无需）和确认流程（用户自行决定）。当前 ValidatePage 的数据源和展示逻辑与正确定位完全不一致，需要从后端到前端进行重构。用户等待确认后决定是否进入实施阶段。
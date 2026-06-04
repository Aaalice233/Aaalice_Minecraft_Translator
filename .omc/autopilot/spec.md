# 规格：汉化资源包名称设置

## 需求概述

在设置页添加"汉化资源包"配置区域，允许用户指定 i18n 和 VM 两类汉化资源包的文件名。扫描器只按设置的文件名查找资源包（而非列出全部），为后续提取条目作为补充词库做准备。

## 功能要求

### 1. 设置项新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `i18nPackName` | string | `Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip` | i18n 汉化资源包名称 |
| `vmPackName` | string | `VMTranslationPack-Converted-1.21.1.zip` | VM 汉化资源包名称 |

### 2. 设置页 UI

- 在 SettingsPage 新增"汉化资源包"（Translation Packs）选项卡或区域
- 两个文本框：i18n 汉化包名称、VM 汉化包名称
- 每个文本框带默认值占位符
- 带有 i18n 标签

### 3. 扫描器行为变化

- `scan_resourcepacks` 改为按配置的名称精确匹配
- 只有文件名与 `i18nPackName` 或 `vmPackName` 完全匹配的 zip 才被扫描和返回
- 其余资源包不显示（简化列表，让用户聚焦于关键包）
- 如果文件不存在，则不返回该条目（而非报错）

### 4. 后端修改

- `src-tauri/src/core/models.rs`：Settings 新增 `i18n_pack_name` 和 `vm_pack_name` 字段
- `src-tauri/src/core/scanner.rs`：`scan_resourcepacks` 接收包名称参数，过滤匹配
- `src-tauri/src/commands.rs`：将配置的名称传递给扫描器

### 5. 前端修改

- `src/types.ts`：添加 `i18nPackName` 和 `vmPackName` 类型定义
- `src/api/tauri.ts`：更新 defaultSettings
- `src/pages/SettingsPage.tsx`：新增设置 UI
- `src/i18n/translations.ts`：新增 i18n 翻译条目

### 6. 影响范围

- 不涉及扫描路径变更，只过滤扫描结果
- 不涉及翻译管线修改（后续阶段实现条目提取合并）
- `infer_pack_source_type` 仍然保留，但后续根据配置名称来推断类型而非文件名

## 实现约束

- 保持现有代码风格
- 所有 UI 文本必须通过 i18n 字典
- 设置默认值向后兼容（当前设置 JSON 缺失字段时自动取默认值）
- 扫描器修改不能影响现有测试

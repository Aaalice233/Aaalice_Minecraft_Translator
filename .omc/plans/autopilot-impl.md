# 实现计划：汉化资源包名称设置

## 修改文件清单（按顺序）

### 1. Rust 后端模型
- **文件**: `src-tauri/src/core/models.rs`
  - Settings 新增 `i18n_pack_name` 和 `vm_pack_name` 字段 (String)
  - Default impl 添加默认值

### 2. Rust 扫描器
- **文件**: `src-tauri/src/core/scanner.rs`
  - `scan_resourcepacks` 新增 `i18n_pack_name` 和 `vm_pack_name` 参数
  - 只返回文件名匹配的 zip，其他过滤掉
  - 更新 `scan_resourcepack_zip` 调用链

### 3. Rust 命令层
- **文件**: `src-tauri/src/commands.rs`
  - `scan_instance` 从 settings 读取 pack name 并传入 scanner

### 4. 前端类型定义
- **文件**: `src/types.ts`
  - Settings 新增 `i18nPackName` 和 `vmPackName` 字段

### 5. 前端 API 层
- **文件**: `src/api/tauri.ts`
  - defaultSettings 补充默认值

### 6. i18n 翻译字典
- **文件**: `src/i18n/translations.ts`
  - 新增 settings 相关翻译条目（4 语言）

### 7. 前端设置页 UI
- **文件**: `src/pages/SettingsPage.tsx`
  - 新增"汉化资源包"设置区域
  - 两个文本框

### 8. 更新测试
- **文件**: `tests/app.test.tsx`（如有需要）
  - 测试默认值兼容性

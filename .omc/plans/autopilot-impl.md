# Autopilot Plan: 扫描结果延迟修复

## 改动清单

### Change 1: models.rs — 跳过 entries 序列化
- **文件**: `src-tauri/src/core/models.rs`
- `ModScanResult.entries`: 添加 `#[serde(skip)]`
- `ResourcePackScanResult.entries`: 添加 `#[serde(skip)]`
- 内部数据结构不变，Rust 端依然保留完整 entries

### Change 2: scanner.rs — 资源包名模糊匹配
- **文件**: `src-tauri/src/core/scanner.rs`
- `is_known_pack()` 闭包的 `==` 改为 `contains()`

### 验证
1. `cd src-tauri && cargo test` — 全部通过
2. `npm run build` — 前端构建通过

## 执行顺序
Change 1 + Change 2 独立可并行 → 验证

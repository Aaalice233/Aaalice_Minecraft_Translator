# Deep Dive Spec: 扫描结果延迟修复

## Goal

消除扫描完成后 Dashboard 结果出现的数秒延迟，同时修复资源包扫描阶段 total=1 的误报问题。

## Trace Findings

三条追踪线路收敛于同一根因：调试构建（`opt-level=0`）下，`ScanSummary` 中包含的全部 `entries: Vec<LanguageEntry>`（约 360K 个对象、~70MB JSON）通过 serde_json + Tauri IPC 传输到前端，但 `DashboardPage.tsx` **完全不消费 entries 数据**（只显示聚合统计数字）。

| 模组数 | 每模组条目数 | 总 entries | JSON 大小 | debug 序列化耗时 |
|--------|-------------|------------|-----------|-----------------|
| ~450 | ~800 | ~360K | ~70MB | 3-8 秒 |

资源包 total=1 的原因是 `scan_resourcepacks()` 使用 `==` 精确匹配文件名（`scanner.rs:278`），但用户的资源包文件名版本号与配置文件不一致。

## Constraints

1. **不允许改前端类型定义**之上去除 entries——必须从源头（Rust 端序列化时跳过 entries）
2. **不允许改变 `ModScanResult` / `ResourcePackScanResult` / `ScanSummary` 的内部数据结构**——只改序列化行为
3. 翻译流水线（尚未实现）后续需要 entries 数据，必须在 Rust 端保留完整的 `Vec<LanguageEntry>`
4. 资源包匹配必须兼容版本号后缀差异，不得要求用户每次更新包后改配置文件

## Acceptance Criteria

- [ ] `ModScanResult.entries` 序列化时跳过（`#[serde(skip)]`），前端收到的 JSON 不含 entries
- [ ] `ResourcePackScanResult.entries` 同样跳过
- [ ] 前端的聚合统计（`totalSourceEntries`、`totalTargetEntries`、`totalPendingEntries`、`mod.sourceEntries`、`mod.targetEntries`、`pack.entryCount`）仍然正常显示
- [ ] `npm run tauri dev` 下资源包扫描阶段正确显示用户的实际资源包数（如 2 个）
- [ ] 延迟从数秒降至可忽略（<200ms）

## Technical Context

### 待修改文件

| 文件 | 修改 |
|------|------|
| `src-tauri/src/core/models.rs` | `ModScanResult.entries` 加 `#[serde(skip)]`；`ResourcePackScanResult.entries` 加 `#[serde(skip)]` |
| `src-tauri/src/core/scanner.rs` | `is_known_pack()` 中的 `==` 改为 `contains()` 模糊匹配 |

### 修改说明

```rust
// models.rs —— 仅改序列化行为，不改内部逻辑
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModScanResult {
    // ... 其他字段不变
    #[serde(skip)]                    // ← 新增：跳过 IPC 序列化
    pub entries: Vec<LanguageEntry>,
}
```

```rust
// scanner.rs —— 资源包匹配逻辑
let is_known_pack = |name: &str| -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains(&i18n_lower) || lower.contains(&vm_lower)  // ← == 改为 contains()
};
```

### 结构图

```
修复前：
  scanner → ScanSummary { mods: [{ entries: [360K objects] }, ...] }
                                                      ↓ serde_json (~70MB)
                                     IPC (~3-8秒) → 前端 JSON.parse → Dashboard 不消费

修复后：
  scanner → ScanSummary { mods: [{ entries: [360K objects] }, ...] }
                                                      ↓ #[serde(skip)]
                                     IPC (~50KB, <200ms) → 前端 Dashboard 秒渲染
```

### 风险

- 低：entries 在 Rust 端仍完整保留，仅跳过序列化
- 后续翻译流水线需要 entries 时，需添加按需获取命令（不在本次范围内）

## Ontology

| Entity | Change | Impact |
|--------|--------|--------|
| `ModScanResult.entries` | `#[serde(skip)]` | 前端不再接收，Rust 内部不变 |
| `ResourcePackScanResult.entries` | `#[serde(skip)]` | 同上 |
| `is_known_pack()` | `==` → `contains()` | 更多包被匹配 |
| `ScanSummary` | 无变化 | 结构不变 |
| `DashboardPage` | 无变化 | 无代码改动 |

## Interview Transcript

Round 1: 确认 entries 在前端的使用范围 → 仅 Rust 后端翻译流水线需 entries，Dashboard 只读聚合数字
Round 2: 用户选择"去掉 entries 的 IPC 传输" → 最小改动，秒出结果

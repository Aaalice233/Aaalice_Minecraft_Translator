# Deep Dive Trace: translation-counts

## Observed Result
用户报告各个页面显示的实际翻译数量对不上，需要统一核查。

## Ranked Hypotheses
| Rank | Hypothesis | Confidence | Evidence Strength | Why it leads |
|------|------------|------------|-------------------|--------------|
| 1 | JobsPage 和 DashboardPage 显示了不同的统计字段 | High | Strong | DashboardPage 同时显示 `totalPendingEntries`（1000）和 `actualPendingEntries`（700），而 JobsPage 只显示 `totalPendingEntries`（1000）。用户对比的是 DashboardPage 的"实际需要翻译"和 JobsPage 的"待翻译条目"——两个本就不该相等的值 |
| 2 | Translation job 独立重算 pending 条目，与 ScanSummary 结果可能不同 | Medium | Moderate | 翻译任务在 commands.rs 用 key 集合匹配重新计算 pending 条目，不直接使用 ScanSummary 的 `totalPendingEntries`。如果存在特殊边角情况（翻译后未重新扫描），结果可能不一致 |
| 3 | 资源包覆盖扣除逻辑与翻译任务的重算逻辑不一致 | Medium | Moderate | ScanSummary 扣除 `resourcePackCoveredEntries` 后得到 `actualPendingEntries`，但翻译任务重算时完全不考虑资源包覆盖，会重新翻译所有未匹配的 source key |

## Evidence Summary by Hypothesis

### Lane 1: 扫描汇总减法 vs 逐 key 匹配

**两个计算方式的对比：**

ScanSummary（scanner.rs:124-127）:
```rust
let total_pending_entries: usize = mods.iter()
    .map(|m| m.source_entries.saturating_sub(m.target_entries))
    .sum();
```
= 每个模组的 (source 条目数 - target 条目数) 之和

Translation job（commands.rs:359-376）:
```rust
// 收集 target 语言已有的 key 集合
let target_keys: HashSet<&str> = mod_result.entries.iter()
    .filter(|e| e.language == *target)
    .map(|e| e.key.as_str())
    .collect();
// 对于每个 source 条目，检查是否已有 target 翻译
for entry in &mod_result.entries {
    if entry.language == *resolved_source && !target_keys.contains(entry.key.as_str()) {
        pending_entries.push(...);
    }
}
```

**分析结论：** 在正常情况下两者结果完全一致。因为 `source_entries` 是 `language == resolved_source` 的计数，`target_entries` 是 `language == target` 的计数，而逐 key 匹配也是同样的筛选条件。除非语言文件中有重复 key，否则不会不同。证据强度：**弱**——理论可能但实际概率极低。

### Lane 2: 资源包扣除数值

**当前显示逻辑：**

DashboardPage 显示 3 个数字：
1. `totalPendingEntries` = sum(source - target) → "待翻译条目"
2. `resourcePackCoveredEntries` = 资源包匹配数 → "汉化资源包可复用"
3. `actualPendingEntries` = totalPending - resourcePackCovered → "实际需要翻译"

JobsPage 显示 1 个数字：
- `totalPendingEntries` → "待翻译条目"

Translation job 重算时不考虑资源包覆盖，所以用户看到：
- DashboardPage "实际需要翻译" = 700（扣除后）
- JobsPage "待翻译条目" = 1000（扣除前）
- 开始翻译后进度显示 ≈ 1000（重算，未扣除）
- 三个数字全部不同

**证据强度：强** — 这是确凿的显示不一致。

### Lane 3: 各页面字段映射

| 页面 | 显示的字段 | 标签文本 | 值 |
|------|-----------|---------|-----|
| DashboardPage | `totalPendingEntries` | "待翻译条目" | 1000 |
| DashboardPage | `resourcePackCoveredEntries` | "汉化资源包可复用" | 300 |
| DashboardPage | `actualPendingEntries` | "实际需要翻译" | 700 |
| JobsPage | `totalPendingEntries` | "待翻译条目" | 1000 |
| PackagesPage | `totalPendingEntries > 0` | 守卫条件（不直接显示） | — |
| Translation progress | 独立重算的 `pending_entries.len()` | 进度 current/total | 可能 ≠1000 |

**关键发现：** 没有页面显示 `actualPendingEntries` 除了 DashboardPage。JobsPage 应该显示 `actualPendingEntries` 而不是 `totalPendingEntries`，因为"实际需要翻译"的数字对用户更有意义。

## Evidence Against / Missing Evidence
- **Lane 1**: 两种计算方式在标准 Minecraft 语言文件（无重复 key）下结果一致；翻译完成后 JobsPage 会触重新扫描刷新 ScanSummary
- **Lane 2**: 翻译任务启动时完全重新计算 pending 条目，与 `totalPendingEntries` 的计算方式一致，但不扣除资源包覆盖
- **Lane 3**: 各页面所有引用都确实使用 `scanSummary.xxx`，没有错误的字段名

## Per-Lane Critical Unknowns
- **Lane 1**: 翻译完成后重新扫描时，`source_entries` 和 `target_entries` 是否准确反映了翻译后的状态？
- **Lane 2**: JobsPage 的"待翻译条目"应该用 `totalPendingEntries` 还是 `actualPendingEntries`？
- **Lane 3**: 翻译进度的 `total` 是否与 ScanSummary 的任意字段对应？

## Most Likely Explanation
**问题根因：DashboardPage 的"实际需要翻译"（`actualPendingEntries`）和 JobsPage 的"待翻译条目"（`totalPendingEntries`）是两个不同的值，但用户期望它们相等。** 前者是扣除汉化资源包覆盖后的净值，后者是包含资源包覆盖的毛值。JobsPage 应该改为显示 `actualPendingEntries`。

次要问题：翻译任务的独立重算可能导致进度 total 与显示 count 不一致。

## Critical Unknown
用户具体是在对比哪两个数字？是 DashboardPage 内部的"待翻译条目"vs"实际需要翻译"，还是 DashboardPage 的"实际需要翻译"vs JobsPage 的"待翻译条目"？

## Recommended Discriminating Probe
确认 JobsPage 第 179 行是否应该从 `totalPendingEntries` 改为 `actualPendingEntries`，同时确认翻译进度 total 是否需要考虑资源包覆盖。

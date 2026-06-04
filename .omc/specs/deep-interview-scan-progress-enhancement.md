# Deep Interview Spec: 多阶段扫描进度增强

## Metadata
- Interview ID: deep-interview-scan-progress-enhancement
- Rounds: 6
- Final Ambiguity Score: 16%
- Type: brownfield
- Generated: 2026-06-04
- Threshold: 0.2
- Threshold Source: default
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.92 | 35% | 0.322 |
| Constraint Clarity | 0.82 | 25% | 0.205 |
| Success Criteria | 0.78 | 25% | 0.195 |
| Context Clarity | 0.82 | 15% | 0.123 |
| **Total Clarity** | | | **0.84** |
| **Ambiguity** | | | **16%** |

## Topology
| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| 当前扫描后停顿修复 | active | 为 `scan_resourcepacks()` 和聚合/日志阶段添加进度事件，消除进度100%后的无反馈停顿 | 资源包按个数报进度；统一事件格式 |
| 未来流水线进度框架 | active | 为后续 matching/translating/validating/packaging 阶段设计统一的进度事件框架 | 统一事件格式、独立阶段进度、可取消操作 |

## Goal
为 Minecraft 整合包翻译工具的扫描及后续流水线流程实现多阶段连续进度显示。后端每个阶段独立报告进度，前端主进度条 + 阶段标签展示，支持原子取消（当前阶段完成后停止）。

## Constraints
1. **统一事件格式**：扩展现有 `ScanProgress`，新增 `sub_step`（子步骤描述）、`stage_status`（running/completed/failed）字段，所有阶段使用同一事件结构
2. **阶段独立进度**：每个阶段（resourcepacks/aggregation/matching/translating/validating/packaging）独立维护 current/total，阶段切换时 total 重置
3. **原子取消**：取消操作在当前阶段完成后才终止，不中断正在执行的操作
4. **资源包按个数计进度**：`scan_resourcepacks()` 每个资源包一个进度点，不细化到包内文件数
5. **主进度条 + 阶段标签 UI**：一个主进度条贯穿所有阶段，底部显示当前阶段名和子进度描述
6. **向后兼容**：现有 `phase: "scan"` 的 jar 扫描事件格式不变，新增阶段使用相同事件通道 `scan-progress`

## Non-Goals
- 不改变现有 jar 扫描（`scan_mods()`）的进度机制
- 不在此阶段实现 `matching/translating/validating/packaging` 的功能逻辑，只设计进度框架
- 不细化资源包内文件级进度
- 不在 UI 中添加独立进度条列表（仅主进度条 + 阶段标签）

## Acceptance Criteria
### 当前停顿修复
- [ ] `scan_resourcepacks()` 接收 `progress` 回调，每个资源包发射一次进度事件
- [ ] 聚合阶段发射 `stage_status: "running"` 事件（如 current/total 均为 0 表示不可量化阶段）
- [ ] 扫描全流程结束时发射 `stage_status: "completed"` 事件
- [ ] 前端进度条在阶段切换时 phase 标签更新，不出现"进度 100% 后无响应"的情况

### 未来框架设计
- [ ] 事件结构体包含：`phase`, `current`, `total`, `sub_step`(optional), `stage_status`
- [ ] `stage_status` 取值为 `"running"` | `"completed"` | `"failed"`
- [ ] 后端提供取消接口，原子取消语义
- [ ] 前端 `listen("scan-progress")` 兼容新旧事件格式

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 扫描完成后停顿是后续处理 | 确认确实是 `scan_resourcepacks()` 和聚合阶段 | 所有后续阶段应显示进度 |
| 一个进度条够用 | 询问是否要分阶段独立进度条 | 主进度条 + 阶段标签即可 |
| 取消操作行为 | 询问立即中断还是原子取消 | 原子取消（当前阶段完成后停止） |

## Technical Context

### 当前实现路径
```
scan_instance [commands.rs:27]
├── spawn_blocking 读线程: mpsc::Receiver → emit("scan-progress")
├── spawn_blocking 扫描线程: scanner::scan_instance()
│   ├── validate_instance()        [无进度]
│   ├── scan_mods(progress)        [有进度: 每jar一个事件]
│   ├── scan_resourcepacks()       [无进度 ← 需修改]
│   ├── 聚合总计                    [无进度 ← 需修改]
│   ├── 文件日志                     [无进度]
│   └── 返回 ScanSummary
└── 前端重新渲染
```

### 目标事件结构（扩展 ScanProgress）
```rust
// 现有结构扩展
struct ScanProgress {
    phase: String,           // "scan" | "resourcepacks" | "aggregation" | "matching" | "translating" | "validating" | "packaging"
    current: usize,          // 当前阶段进度
    total: usize,            // 当前阶段总量
    mod_name: Option<String>, // 可选：当前处理的模组名
    sub_step: Option<String>, // 可选：子步骤描述，如 "正在处理 i18n 包"
    stage_status: Option<String>, // "running" | "completed" | "failed" (阶段边界标记)
}
```

### 待修改文件
| 文件 | 修改内容 |
|------|---------|
| `src-tauri/src/core/models.rs` | 扩展 `ScanProgress` 结构体 |
| `src-tauri/src/core/scanner.rs` | `scan_resourcepacks()` 添加 progress 参数，发射 per-pack 进度 |
| `src-tauri/src/commands.rs` | 支持多阶段事件发射，取消接口 |
| `src/types.ts` | 更新前端 `ScanProgressEvent` 类型 |
| `src/pages/DashboardPage.tsx` | 主进度条 + 阶段标签 UI 更新 |
| `src/api/tauri.ts` | 添加 `cancelScan()` 函数 |

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| ScanProgress | core:event | phase, current, total, mod_name, sub_step, stage_status | emitted by scanner, consumed by frontend |
| ScanPhase | core:enum | scan, resourcepacks, aggregation, matching, translating, validating, packaging | transitions determine progress bar stage |
| StageStatus | core:enum | running, completed, failed | marks phase boundaries |
| DashboardPage | ui:component | scanProgress, isScanning, stageLabel | listens to scan-progress event |
| CancelToken | core:mechanism | cancelled flag | checked between stages for atomic cancellation |

## Interview Transcript
<details>
<summary>Full Q&A (6 rounds)</summary>

### Round 0
**Q:** 拓扑确认：当前扫描后停顿 + 未来流水线进度框架
**A:** 选择了"当前扫描 + 未来流水线设计"

### Round 1
**Q:** 进度呈现方式：连续单进度条 / 分阶段进度显示 / 其他
**A:** 分阶段进度显示

### Round 2
**Q:** 未来流水线进度框架要求
**A:** 每个阶段独立进度 + 统一事件格式 + 可取消操作

### Round 3
**Q:** 扩展后进度事件需要哪些信息
**A:** 阶段名称+子步骤 + 预估百分比/ETA + 状态字段(running/completed/failed)

### Round 4
**Q:** 资源包扫描进度粒度（按包个数 vs 按文件数）
**A:** 按资源包个数

### Round 5
**Q:** UI 展示方式（主进度条+阶段标签 / 阶段列表 / 保持现状）
**A:** 主进度条 + 阶段标签

### Round 6
**Q:** 取消操作（原子取消 / 立即中断 / 分阶段取消 / 暂不实现）
**A:** 原子取消

</details>

# 扫描进度增强：多阶段连续进度与阶段边界取消

> **Status: ⏳ PENDING APPROVAL** — 共识计划已完成。请选择执行方式。

## 1. RALPLAN-DR 总结

### Principles (原则)

| # | 原则 | 说明 |
|---|------|------|
| P1 | **最小侵入** | 不改 jar 扫描逻辑，不重构现有通道架构，所有变更保持向后兼容 |
| P2 | **用户可见性** | 扫描全程每一阶段都要有进度反馈，消除"100% 后白屏等待" |
| P3 | **阶段边界取消** | 取消操作只在阶段边界生效，不在阶段中途中断；mod 扫描阶段的 rayon 并行遍历不检查取消标志 |
| P4 | **单一事实源** | 所有阶段通过同一 `scan-progress` 事件通道发送，前端统一消费 |
| P5 | **渐进增强** | 新增字段为 `Option` 类型或带 `#[serde(default)]`，旧版前端忽略即可 |

### Decision Drivers (前 3)

1. **D1 (体验)**: 用户必须能看到扫描后处理（资源包扫描、聚合、日志）的进度，不能停在 100%
2. **D2 (安全)**: 取消操作不能破坏 jar 扫描的 rayon 并行遍历，只能在后处理阶段检查
3. **D3 (兼容)**: 现有 `phase: "scan"` 的 jar 扫描事件格式完全不变，前端旧代码不崩

### Viable Options

#### 选项 A: 静态 AtomicBool 取消 + 扩展 ScanProgress (推荐)

- 后端：`commands.rs` 中静态 `AtomicBool` 作为取消标志，`scan_instance()` 在阶段间检查
- 事件：`ScanProgress` 增加 `sub_step: Option<String>` 和 `stage_status: StageStatus`
- 优点：改动最小，无需重构 scanner 签名链；全局标志简单可靠
- 缺点：不支持并发扫描（当前架构也不支持）；静态变量需要每次 `store(false)` 重置

#### 选项 B: Arc\<AtomicBool\> 传参取消

- 通过 `scan_instance()` → `scan_resourcepacks()` 函数链传递 `Arc<AtomicBool>`
- 优点：无全局状态，支持后续并发多实例扫描
- 缺点：需要改 `scan_resourcepacks()` 签名加参数，且当前无多实例需求，过度设计

#### 选项 C: 新事件通道（不推荐）

- 为后处理阶段开第二个 `scan-post-progress` 事件通道
- 被否决原因：前端需要监听两个通道，增加复杂度；同一通道加阶段判别即可区分

#### 选项 D: 取消 = drop 通道发送端（已排除）

- 被否决原因：`scan_mods` 中的 rayon 闭包持有 `progress_tx` clone，无法可靠检测 drop

### 结论

| 决策 | 选择 | 原因 |
|------|------|------|
| 事件格式 | `sub_step: Option<String>` + `stage_status: StageStatus` | 向后兼容，前端可渐进适配 |
| 取消机制 | 静态 `AtomicBool` + 阶段边界检查 | 实现简单，满足安全需求 |
| 阶段划分 | scan → resourcepacks → aggregate → log | 覆盖所有后处理环节 |
| 资源包进度 | 修改 `scan_resourcepacks()` 签名加 progress 回调 | 复用现有通道，一致性强 |
| 聚合/日志 | 标记事件 (total=1, current=0→1) | 轻量、前端可显示完成状态 |

### Consequences

- 同一 `scan-progress` 事件将携带不同 `phase` 值，前端需处理 `phase` 变化
- `scan_resourcepacks()` 签名变更会影响所有调用点（含测试代码）
- 静态 `AtomicBool` 需要每次扫描开始时重置，防止上次取消状态残留
- `ScanSummary` 新增 `cancelled: bool` 字段，前端据此判断是否显示取消消息

### Follow-ups

- 无。本计划包含完整实施路径。

### Pre-mortem (3 failure scenarios)

1. **rayon 并行阶段取消无效**：`scan_mods` 使用 rayon `par_iter`，其闭包不检查取消标志。取消请求在大型整合包（200+ mod）中延迟 5-10 秒才生效，用户以为取消按钮坏了。
   - 缓解：取消按钮切换为"正在停止..."时，添加副文本"等待当前阶段完成..."；取消 UX 文档化预期延迟。
2. **聚合计算依赖被取消跳过的阶段结果**：`scan_resourcepacks` 被取消后返回空 Vec，聚合代码若假设非空会导致错误。
   - 缓解：聚合代码设计为 `Vec::new()` 降级，总计数值为 0；取消不跳过聚合计算本身。
3. **前端阶段跳变闪烁**：aggregate 和 log 阶段使用 quick marker 事件（0→1），在 10ms 内完成，进度条一闪而过用户看不到。
   - 缓解：标记阶段进度条使用脉冲动画；激进优化下可设最小持续时间 200ms。

---

## 2. 实施步骤

### Step 1 — data model: `ScanProgress` + 前端类型 + 阶段状态枚举

**涉及文件：**
- `src-tauri/src/core/models.rs`
- `src/types.ts`

**修改内容：**

**models.rs** — 扩展 `ScanProgress`，新增 `StageStatus` 枚举，为 `ScanSummary` 添加取消字段：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StageStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
}

impl Default for StageStatus {
    fn default() -> Self {
        StageStatus::Running
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ScanProgress {
    pub current: usize,
    pub total: usize,
    pub mod_name: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_step: Option<String>,
    pub stage_status: StageStatus,
}
```

说明：
- `#[serde(default)]` 保证 `stage_status` 在缺少该字段时使用 `StageStatus::Running` 默认值
- `sub_step` 为 `Option<String>`，序列化时跳过 `None`，向后兼容
- `stage_status` 为枚举——"running" / "completed" / "failed"，前端可根据值切换阶段标签样式
- 现有 `phase: "scan"` 事件不变

**ScanSummary 也需添加 `#[serde(default)]` 和 `cancelled` 字段：**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ScanSummary {
    pub job_id: String,
    pub instance_path: String,
    pub validation: InstanceValidation,
    pub mods: Vec<ModScanResult>,
    pub resource_packs: Vec<ResourcePackScanResult>,
    pub source_language: String,
    pub target_language: String,
    pub total_language_files: usize,
    pub total_source_entries: usize,
    pub total_target_entries: usize,
    pub total_pending_entries: usize,
    pub warnings: Vec<ScanWarning>,
    #[serde(default)]
    pub cancelled: bool,
}
```

说明：
- `cancelled` 默认 `false`，序列化时兼容旧前端
- `#[serde(default)]` 确保旧 JSON（缺 `cancelled` 字段）反序列化时不会失败

**types.ts** — 同步前端类型：

```typescript
export interface ScanProgressEvent {
  current: number;
  total: number;
  modName: string;
  phase: string;
  subStep?: string;
  stageStatus: "running" | "completed" | "failed";
}

export interface ScanSummary {
  // ... existing fields ...
  cancelled: boolean;
}
```

**验收标准：**
- [ ] Rust 编译通过，`StageStatus` 枚举序列化为 "running"/"completed"/"failed"
- [ ] `StageStatus` 的 Default 返回 `Running`，`ScanProgress` 带 `#[serde(default)]`
- [ ] `ScanSummary` 带 `#[serde(default)]`，`cancelled` 字段默认 `false`
- [ ] TypesScript 编译通过

---

### Step 2 — 后端：`scan_resourcepacks()` 添加进度回调

**涉及文件：**
- `src-tauri/src/core/scanner.rs`

**修改内容：**

1. `scan_resourcepacks()` 新增 `progress: &(dyn Fn(ScanProgress) + Sync)` 参数
2. 进入循环前，先统计已知资源包数量作为 `total`
3. 循环前按名称排序 `known_packs`，使进度发射顺序与最终结果排序一致
4. 循环中每个包处理后发射一次进度事件，`mod_name` 放包名，`sub_step` 设为 `None`（避免与 `mod_name` 重复）
5. 更新 `scan_resourcepacks` 的内部调用 `scan_resourcepack_dir()` / `scan_resourcepack_zip()` 不变（不需要文件级进度）

```rust
pub fn scan_resourcepacks(
    resourcepacks_path: &Path,
    target_language: &str,
    i18n_pack_name: &str,
    vm_pack_name: &str,
    progress: &(dyn Fn(ScanProgress) + Sync),
) -> io::Result<Vec<ResourcePackScanResult>> {
    // ... existing setup ...

    // Count known packs first for progress total
    let mut known_packs: Vec<_> = fs::read_dir(resourcepacks_path)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| is_known_pack(&file_name(&entry.path())))
        .collect();
    // Sort by name so progress emission order matches final sort order
    known_packs.sort_by(|a, b| file_name(&a.path()).cmp(&file_name(&b.path())));
    let total = known_packs.len();
    let mut current = 0;

    for entry in known_packs {
        let path = entry.path();
        let name = file_name(&path);
        current += 1;
        progress(ScanProgress {
            current,
            total,
            mod_name: name.clone(),
            phase: "resourcepacks".to_string(),
            sub_step: None,
            stage_status: StageStatus::Running,
        });
        // ... existing per-pack processing ...
    }
    // ... sorting and return ...
}
```

6. 更新 `scan_instance()` 调用处传递 progress：

```rust
let resource_packs = scan_resourcepacks(
    &instance_path.join("resourcepacks"),
    &target_language,
    &i18n_pack_name,
    &vm_pack_name,
    progress,  // 新增参数
)?;
```

7. 更新测试代码，传空闭包兼容：

```rust
let packs = scan_resourcepacks(
    &fixtures_root().join("resourcepacks"),
    "zh_cn",
    "i18n-example.zip",
    "VM_汉化包",
    &|_| {},  // 新增
).unwrap();
```

8. 新增取消行为测试：验证 `scan_instance` 在取消标志设置后跳过 resourcepacks 阶段：

```rust
#[test]
fn scan_skip_resourcepacks_when_cancelled() {
    use std::sync::atomic::AtomicBool;
    let cancel = AtomicBool::new(true);
    let result = scan_instance(
        &fixtures_root(),
        "test_instance".to_string(),
        "auto".to_string(),
        "zh_cn".to_string(),
        "i18n-example.zip".to_string(),
        "VM_汉化包".to_string(),
        &cancel,
        &|_| {},
    );
    assert!(result.is_ok());
    let summary = result.unwrap();
    assert!(summary.resource_packs.is_empty());
    assert!(summary.cancelled);
}
```

**验收标准：**
- [ ] Rust 编译通过，测试通过
- [ ] `scan_resourcepacks()` 在扫描每个包时发射一次 `phase: "resourcepacks"` 事件
- [ ] total 等于已知资源包数量，事件中 `mod_name` 为包名，`sub_step` 为 `None`
- [ ] 进度事件按包名排序发射
- [ ] 取消测试验证 `resource_packs` 为空且 `cancelled` 为 `true`

---

### Step 3 — 后端：`scan_instance()` 多阶段进度 + 取消支持

**涉及文件：**
- `src-tauri/src/core/scanner.rs`
- `src-tauri/src/commands.rs`

**修改内容：**

**scanner.rs** — `scan_instance()` 添加阶段间进度发射和取消检查；聚合计算无条件运行：

```rust
use std::sync::atomic::{AtomicBool, Ordering};

pub fn scan_instance(
    root: &Path,
    path: String,
    source_language: String,
    target_language: String,
    i18n_pack_name: String,
    vm_pack_name: String,
    cancel: &AtomicBool,
    progress: &(dyn Fn(ScanProgress) + Sync),
) -> io::Result<ScanSummary> {
    // ... existing setup (validate, logging, job_id) ...

    // Stage 1: scan mods (existing, unchanged)
    let mods = scan_mods(&instance_path.join("mods"), &source_language, &target_language, progress)?;

    // Stage 2: resource packs — can be skipped on cancel
    let resource_packs = if cancel.load(Ordering::SeqCst) {
        Vec::new()
    } else {
        progress(ScanProgress {
            current: 0, total: 0, mod_name: String::new(),
            phase: "resourcepacks".into(), sub_step: None,
            stage_status: StageStatus::Running,
        });
        scan_resourcepacks(
            &instance_path.join("resourcepacks"), &target_language,
            &i18n_pack_name, &vm_pack_name, progress,
        )?
    };

    // Stage 3: aggregate — ALWAYS runs regardless of cancel
    // Aggregation (total_language_files, total_source_entries, etc.)
    // is required to construct a valid ScanSummary.
    let total_language_files = mods.iter().map(|m| m.language_file_count).sum();
    let total_source_entries = mods.iter().map(|m| m.source_entries).sum();
    let total_target_entries = mods.iter().map(|m| m.target_entries).sum();
    let total_pending_entries = mods
        .iter()
        .map(|m| m.source_entries.saturating_sub(m.target_entries))
        .sum();
    let mut warnings = validation.warnings.clone();
    warnings.extend(mods.iter().flat_map(|m| m.warnings.clone()));

    // Emit aggregate progress events only if not cancelled
    if !cancel.load(Ordering::SeqCst) {
        progress(ScanProgress {
            current: 0, total: 1, mod_name: String::new(),
            phase: "aggregate".into(), sub_step: None,
            stage_status: StageStatus::Running,
        });
        progress(ScanProgress {
            current: 1, total: 1, mod_name: String::new(),
            phase: "aggregate".into(), sub_step: None,
            stage_status: StageStatus::Completed,
        });
    }

    // Stage 4: log — only write if not cancelled
    if !cancel.load(Ordering::SeqCst) {
        progress(ScanProgress {
            current: 0, total: 1, mod_name: String::new(),
            phase: "log".into(), sub_step: None,
            stage_status: StageStatus::Running,
        });
        // ... existing logging logic ...
        progress(ScanProgress {
            current: 1, total: 1, mod_name: String::new(),
            phase: "log".into(), sub_step: None,
            stage_status: StageStatus::Completed,
        });
    }

    let cancelled = cancel.load(Ordering::SeqCst);

    // Always emit final "done" event (even if cancelled, to signal scan end)
    progress(ScanProgress {
        current: 1, total: 1, mod_name: String::new(),
        phase: "done".into(), sub_step: None,
        stage_status: StageStatus::Completed,
    });

    Ok(ScanSummary {
        job_id,
        instance_path: display_path(instance_path),
        validation,
        mods,
        resource_packs,
        source_language,
        target_language,
        total_language_files,
        total_source_entries,
        total_target_entries,
        total_pending_entries,
        warnings,
        cancelled,
    })
}
```

**commands.rs** — 添加取消命令（使用简单静态 AtomicBool，不需要 LazyLock）：

```rust
use std::sync::atomic::{AtomicBool, Ordering};

static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

/// 请求取消当前扫描。当前阶段完成后才终止（阶段边界取消）。
#[tauri::command]
pub fn cancel_scan() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}
```

修改 `scan_instance` command，重置取消标志并传递给 scanner：

```rust
#[tauri::command]
pub async fn scan_instance(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
) -> Result<ScanSummary, String> {
    // Reset cancel flag for this scan
    SCAN_CANCEL.store(false, Ordering::SeqCst);

    let root = paths::runtime_root().map_err(to_message)?;
    let (progress_tx, progress_rx) = mpsc::channel::<ScanProgress>();
    let progress_tx_scan = progress_tx.clone();

    // Reader thread (unchanged)
    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = progress_rx.recv() {
            if let Err(err) = app_emit.emit("scan-progress", &progress) {
                eprintln!("scan-progress emit error: {err}");
            }
        }
    });

    // Settings (unchanged)
    let settings = settings::load_settings(&root).ok();
    let (i18n_pack_name, vm_pack_name) = settings
        .as_ref()
        .map(|s| (s.i18n_pack_name.clone(), s.vm_pack_name.clone()))
        .unwrap_or_default();

    let result = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_instance(
            &root,
            path,
            source_language,
            target_language,
            i18n_pack_name,
            vm_pack_name,
            &SCAN_CANCEL,
            &|progress: ScanProgress| {
                let _ = progress_tx_scan.send(progress);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    drop(progress_tx);
    result.map_err(to_message)
}
```

在 `lib.rs` 中注册新命令：

```rust
.invoke_handler(tauri::generate_handler![
    // ...
    commands::cancel_scan,
])
```

**验证 Tauri 2 capabilities：** 确认 `src-tauri/capabilities/default.json` 中 `"core:default"` 是否覆盖了 `cancel_scan` command。如果 capabilities 配置要求显式声明 command 权限，需将 `cancel_scan` 添加到权限列表。

如：

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    // ... existing permissions ...
  ]
}
```

Tauri 2 的事件系统本身需要 `"core:event:default"` 或 `"core:event:allow-listen"` / `"core:event:allow-emit"` 在 capabilities 中声明。如果当前 `scan-progress` 事件已正常工作，则现有配置已覆盖事件权限；新增 command 一般可被 `"core:default"` 覆盖，但如果遇到权限错误则需显式添加。

**验收标准：**
- [ ] Rust 编译通过，测试通过
- [ ] 完整扫描流程按序发射 4 阶段事件：scan → resourcepacks → aggregate → log → done
- [ ] 调用 `cancel_scan()` 后，当前阶段完成，跳过后续阶段（但聚合计算不受影响）
- [ ] 取消后 `ScanSummary.cancelled` 为 `true`
- [ ] 每次新扫描重置取消标志
- [ ] 不需要 `LazyLock` / `OnceLock`，直接使用 `static AtomicBool`

---

### Step 4 — 前端：新 i18n 键

**涉及文件：**
- `src/i18n/translations.ts`

**新增键：**

| 键 | zh-cn | en-us | ja-jp | ko-kr |
|-----|-------|-------|-------|-------|
| `dashboard.stage.scan` | 扫描模组 | Scanning mods | Mod スキャン中 | 모드 스캔 중 |
| `dashboard.stage.resourcepacks` | 扫描资源包 | Scanning resource packs | リソースパック スキャン中 | 리소스팩 스캔 중 |
| `dashboard.stage.aggregate` | 聚合结果 | Aggregating results | 結果集計中 | 결과 집계 중 |
| `dashboard.stage.log` | 写入日志 | Writing logs | ログ書き込み中 | 로그 쓰는 중 |
| `dashboard.stage.done` | 扫描完成 | Scan complete | スキャン完了 | 스캔 완료 |
| `dashboard.cancel` | 取消扫描 | Cancel scan | スキャンキャンセル | 스캔 취소 |
| `dashboard.cancelling` | 正在停止... | Stopping... | 停止中... | 중지 중... |
| `dashboard.cancellingHint` | 等待当前阶段完成... | Waiting for current stage... | 現在の段階が完了するのを待っています... | 현재 단계 완료 대기 중... |
| `dashboard.cancelledMessage` | 扫描已被取消，显示部分结果 | Scan was cancelled, showing partial results | スキャンがキャンセルされました。部分的な結果を表示しています | 스캔이 취소되었습니다. 부분 결과를 표시합니다 |

添加 `TranslationKey` 类型：

```typescript
| "dashboard.stage.scan"
| "dashboard.stage.resourcepacks"
| "dashboard.stage.aggregate"
| "dashboard.stage.log"
| "dashboard.stage.done"
| "dashboard.cancel"
| "dashboard.cancelling"
| "dashboard.cancellingHint"
| "dashboard.cancelledMessage"
```

**验收标准：**
- [ ] 4 种语言都有对应翻译值
- [ ] `TranslationKey` 类型包含新键

---

### Step 5 — 前端：`tauri.ts` 添加 `cancelScan()`

**涉及文件：**
- `src/api/tauri.ts`

```typescript
export async function cancelScan(): Promise<void> {
  if (!isTauriRuntime()) {
    return; // browser mode no-op
  }
  return tauriInvoke<void>("cancel_scan");
}
```

**验收标准：**
- [ ] TypeScript 编译通过
- [ ] 浏览器模式下调用不抛错

---

### Step 6 — 前端：`DashboardPage.tsx` 多阶段进度 UI + 取消按钮

**涉及文件：**
- `src/pages/DashboardPage.tsx`

**修改内容：**

1. **阶段名映射**：使用 i18n 将 `phase` → 可读标签

```typescript
const stageLabel = (phase: string): string => {
  const key = `dashboard.stage.${phase}` as TranslationKey;
  const translated = t(language, key);
  // Fallback for unknown phases
  return translated || phase;
};
```

2. **进度条下方添加阶段标签行**：

```tsx
{isScanning && scanProgress && (
  <div className="scan-progress">
    {/* 现有进度头部 */}
    <div className="scan-progress-header">
      <strong>{stageLabel(scanProgress.phase)}</strong>
      <span>{t(language, "dashboard.scanProgress", { current: scanProgress.current, total: scanProgress.total })}</span>
    </div>
    {/* 进度条 */}
    <div className="progress-bar-track">
      <div
        className="progress-bar-fill"
        style={{ width: `${progressPercent(scanProgress)}%` }}
      />
    </div>
    {/* 阶段状态：已完成时显示勾或对号 */}
    {scanProgress.stageStatus === "completed" && (
      <small className="scan-progress-status">✔ {stageLabel(scanProgress.phase)}</small>
    )}
    {/* 子步骤详情 */}
    {scanProgress.subStep && (
      <small className="scan-progress-mod">{scanProgress.subStep}</small>
    )}
  </div>
)}
```

3. **取消按钮**：放置在"开始扫描"按钮旁，仅在 `isScanning` 时显示，带副文本提示延迟

```tsx
<button
  className="ghost-button danger"
  disabled={isCancelling}
  onClick={handleCancel}
  type="button"
>
  {isCancelling ? t(language, "dashboard.cancelling") : t(language, "dashboard.cancel")}
</button>
{isCancelling && (
  <small className="cancelling-hint">{t(language, "dashboard.cancellingHint")}</small>
)}
```

新增状态和取消处理：

```typescript
const [isCancelling, setIsCancelling] = useState(false);

async function handleCancel() {
  setIsCancelling(true);
  try {
    await cancelScan();
  } catch {
    // ignore - scan might finish before cancel takes effect
  }
  // Don't reset isCancelling here - the scan will complete at next stage boundary
  // and the finally block in handleScan will set isScanning=false
}
```

4. **handleScan 中重置取消相关状态**：

```typescript
async function handleScan() {
  setIsScanning(true);
  setIsCancelling(false);
  setScanProgress(null);
  setError("");
  setScanSummary(null);
  // ...existing logic...
  // In the result handler, store the returned ScanSummary
  .then((summary) => {
    setScanSummary(summary);
  })
  finally {
    setIsScanning(false);
    // Do NOT reset isCancelling here — the cancel message relies on
    // scanSummary.cancelled instead, so isCancelling can be safely reset.
    setIsCancelling(false);
  }
}
```

5. **扫描完成/取消消息**：使用 `scanSummary.cancelled` 替代 `isCancelling` 状态

```tsx
{!isScanning && scanSummary?.cancelled && (
  <div className="alert warning">
    <AlertTriangle size={17} />
    {t(language, "dashboard.cancelledMessage")}
  </div>
)}
```

说明：`scanSummary.cancelled` 来自后端的 `ScanSummary.cancelled` 字段（Step 1/3 添加），扫描返回后由 Rust 后端根据取消标志实际状态设置。这消除了前端 `isCancelling` 在 `finally` 中被清除导致取消消息永不显示的问题。

**新增 CSS 样式**（`src/styles/app.css`）：

```css
.scan-progress-status {
  color: var(--success, #22c55e);
  font-weight: 500;
}

.ghost-button.danger {
  color: var(--danger, #ef4444);
}
.ghost-button.danger:hover {
  background: var(--danger-bg, rgba(239, 68, 68, 0.1));
}

.cancelling-hint {
  display: block;
  color: var(--text-muted, #888);
  font-size: 0.85em;
  margin-top: 4px;
}
```

**验收标准：**
- [ ] 扫描时显示阶段名（如"扫描模组"→"扫描资源包"→"聚合结果"→"写入日志"→"扫描完成"）
- [ ] 资源包扫描时显示当前包名作为 mod_name
- [ ] 取消按钮在扫描时可见，点击后变为"正在停止..."（禁用）+ 副文本"等待当前阶段完成..."
- [ ] 取消后显示提示"扫描已被取消，显示部分结果"（基于 `scanSummary.cancelled` 判断）
- [ ] 取消后重新扫描正常，不会错误显示取消消息

---

## 3. 验收标准（整体）

| # | 标准 | 验证方式 |
|---|------|----------|
| AC1 | 扫描进度从 0-100% 覆盖整个流程，包括后处理阶段 | 手动扫描观察进度条 |
| AC2 | 每个阶段有独立进度计数，阶段切换时 total 重置 | 观察控制台事件输出 |
| AC3 | 点击取消按钮后，当前阶段完成后立即停止，不进入下一阶段 | 取消后观察事件序列的最后一个 phase |
| AC4 | 取消后重新扫描正常（取消标志已重置） | 取消后再次扫描，完整走完所有阶段 |
| AC5 | 现有 jar 扫描阶段 `phase: "scan"` 事件格式完全不变 | 检查事件 JSON 结构 |
| AC6 | 所有 i18n 语言下阶段名正确显示 | 切换语言后扫描验证 |
| AC7 | 既有 `cargo test` 全部通过 | `cd src-tauri && cargo test` |
| AC8 | 取消后 `ScanSummary.cancelled` 返回 `true`，前端显示对应消息 | 取消扫描后验证 UI 显示 |
| AC9 | 新测试 `scan_skip_resourcepacks_when_cancelled` 通过 | `cargo test scan_skip_resourcepacks_when_cancelled` |

---

## 4. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 取消标志竞态：旧扫描已结束时新扫描开始 | 中 | 下次扫描被错误取消 | Step 3 中每次 `scan_instance` 调用开始时 `store(false)` |
| mod 扫描阶段取消延迟 — P3 阶段边界取消在 `scan_mods` 的 rayon 并行阶段不检查标志，取消需等到所有 mod 遍历完才生效 | 高 | 大型整合包预计延迟 5-10 秒 | 取消按钮切换为"正在停止..."并显示副文本"等待当前阶段完成..."；前端文档化预期延迟 |
| 聚合/日志阶段发射事件触发多次 UI 更新 | 低 | 短暂闪烁 | 标记事件仅 current 0→1，前端进度条显示为脉冲或瞬间跳过 |
| `scan_resourcepacks` 签名变更影响 Cargo 测试 | 低 | 测试编译失败 | Step 2 已包含测试代码更新 |
| Tauri 2 capabilities 未覆盖 `cancel_scan` command | 低 | 前端调用取消失败 | Step 3 末尾注明验证 capabilities 配置 |

---

## 5. 验证步骤

1. `cd src-tauri && cargo test` — Rust 测试全部通过（含新增取消测试）
2. `npm run test:unit` — 前端单元测试通过
3. `cd src-tauri && cargo build` — 编译成功
4. `npm run build` — 前端构建成功
5. 手动测试：
   - 点击"开始扫描"，观察进度条依次走过 4 个阶段
   - 等待扫描完全结束，确认最后显示"扫描完成"
   - 扫描过程中点击取消，确认当前阶段走完、后阶段跳过、提示显示（基于 `cancelled` 字段）
   - 取消后再次扫描，确认正常执行且无残留取消消息
   - 切换为 en_us、ja_jp、ko_kr 语言，重复测试

# Deep Dive Trace: 扫描完成到结果出现之间的延迟

## 观察到的结果

扫描过程中进度事件正常显示（含并行 jar 扫描进度），但扫描显示 `phase: "done"` 后，Dashboard 仍需等待数秒才渲染出扫描结果（统计卡片、模组表格、资源包列表）。

同时发现资源包扫描阶段只显示 `total=1`。

## 排名假设

| 排名 | 假设 | 置信度 | 证据强度 | 为什么领先 |
|------|------|--------|----------|-----------|
| 1 | **载荷过大**：`ScanSummary` 包含全部 `Vec<LanguageEntry>`，调试构建下序列化/反序列化耗时 | High | Strong — 3 条 lane 收敛 | 全部 entries 通过 IPC 序列化传输，但 Dashboard 根本不使用这些数据 |
| 2 | **前端渲染**：React 接收大 JSON 后重渲染耗时 | Medium | Moderate — 但纯 DOM 渲染数百行不应该是瓶颈 | JSON.parse 大 payload + 反序列化后重渲染叠加 |
| 3 | **配置问题**：资源包 total=1 是精确匹配导致的 | High (for resource pack issue) | Strong | 默认配置的文件名是精确匹配，实际文件可能版本号不同 |

## 各假设证据总结

### Lane 1: 代码路径 — ScanSummary 载荷过大

**`src-tauri/src/core/models.rs`** — `ModScanResult` 包含 `entries: Vec<LanguageEntry>`，每个 `LanguageEntry` 有 7 个 String 字段：
```rust
pub struct LanguageEntry {
    pub mod_id: String,      // 平均 15 chars
    pub key: String,         // 平均 40 chars (如 "item.tconstruct.tough_handle")
    pub text: String,        // 平均 20 chars (翻译文本)
    pub text_hash: String,   // 16 chars (hex)
    pub language: String,    // 5 chars ("zh_cn")
    pub format: String,      // 4 chars ("json")
    pub source_file: String, // 平均 40 chars (路径)
}
```

**`src-tauri/src/core/scanner.rs`** — `ScanSummary` 在发送 `phase: "done"` 事件后立即返回，之后要经过：
1. `spawn_blocking` 闭包返回结果 → 2. serde_json 序列化为 JSON 字符串 → 3. Tauri IPC 传输 → 4. 前端 JSON.parse → 5. React 渲染

**`src-tauri/Cargo.toml`** — 无 `[profile.dev]` 节，默认 `opt-level = 0`（无优化）

**Dashboard 不消耗 entries 的证据**：`src/pages/DashboardPage.tsx` 中只用到：
- `scanSummary.mods.length`
- `mod.fileName`, `mod.modId`, `mod.formats`, `mod.languageFileCount`, `mod.recoveredLanguageFiles`, `mod.failedLanguageFiles`, `mod.sourceEntries`, `mod.targetEntries`, `mod.hasTargetLanguage`, `mod.resolvedSourceLanguage`
- `pack.name`, `pack.langFileCount`, `pack.entryCount`, `pack.sourceType`

**没有任何地方使用 `mod.entries` 或 `pack.entries`！**

估算：200 mods × 500 entries × ~150 bytes/entry = ~15MB JSON。在 `opt-level=0` 下，serde_json 序列化 15MB 约需 1-3 秒。

### Lane 2: 配置与环境

**资源包 total=1 的根因**（`scanner.rs:278`）：
```rust
let is_known_pack = |name: &str| -> bool {
    let lower = name.to_ascii_lowercase();
    lower == i18n_lower || lower == vm_lower
    // ^ 精确相等 —— 文件名版本号不同则不匹配
};
```

默认配置（`tauri.ts:31-32`）：
```
i18nPackName: "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip"
vmPackName: "VMTranslationPack-Converted-1.21.1.zip"
```

如果用户的文件是 `...1.21.3.zip` 或 `...1.20.1.zip`，精确匹配会漏掉。

**Debug vs Release 构建的影响**：Cargo.toml 没有 `[profile.dev]`，dev 默认 `opt-level=0`。release 默认 `opt-level=3`，serde_json 会有数量级的加速。

### Lane 3: 前端渲染

**证据 FOR**：
- Dashboard 不渲染 entries，但 entries 仍通过 IPC 传输
- 没有虚拟滚动，表格直接渲染所有行
- `onScanSummaryChange(summary)` 触发组件全量重渲染

**证据 AGAINST**：
- 使用唯一的 `jarPath` 作为 table key（OK）
- `useMemo` 对 stats 缓存（OK）
- 200-300 行纯 DOM 渲染应在 50-100ms 内，不是瓶颈

## 反驳回合

| 反驳 | 对假设 1 的影响 |
|------|----------------|
| "Tauri IPC 基于 JSON，应该是流式的" | 实际上 serde_json 在 opt-level=0 下使用慢路径（无内联、无向量化），大量字符串拼接耗时显著 |
| "entries 可能在翻译流水线中使用" | 这是后端逻辑——但问题在于 entries 在 IPC 响应中传输，前端解析全部数据后才调用 `onScanSummaryChange` |
| "2-3 秒不可能是序列化" | 15MB × 在无优化下的字符处理 = 合理估算；在实际大包的 100K+ entries 场景下可达 3-5 秒 |

## 收敛 / 分离说明

**三条 Lane 收敛于同一根因**：

```
根因：ScanSummary 包含不必要的 entries 载荷
  ├─ Lane 1: 调试构建下 serde_json 序列化耗时长
  ├─ Lane 2: 无 [profile.dev] 优化，release 下会好但本质问题仍在
  └─ Lane 3: 前端不消费 entries，但 payload 必须传输 + 解析
```

资源包 total=1 是独立问题（精确文件名匹配），不造成延迟，但值得修复。

## 最可能的解释

**调试构建（opt-level=0）下，`ScanSummary` 中的全部 `Vec<LanguageEntry>` 通过 serde_json + Tauri IPC 序列化传输是 2-5 秒延迟的直接原因。**

核心矛盾：
- **扫描引擎** 已经优化（零 IO 过滤 + rayon 并行）
- **结果传输** 没有优化 —— 将 `~15MB` 的 entries（前端不需要的）通过单次 `return Ok(ScanSummary)` 全量发送

## 关键未知

用户实例的具体模组数量和条目总数。这决定了 payload 的实际大小。

## 推荐的鉴别性探测

1. **最小修复**：在 `ModScanResult` 中使 `entries` 可选（`#[serde(skip_serializing_if = "Vec::is_empty")]`），新建一个不含 entries 的轻量 `DashboardScanSummary`，只在后端保留完整数据
2. **验证**：修复后在 `npm run tauri dev` 下重新扫描，测量延迟是否消失
3. **同时修复**：资源包匹配改为 `contains()` 前缀匹配而非 `==` 精确匹配

# 翻译阶段重构计划 (Translation Phase Overhaul)

> 文件：`.omc/plans/translation-phase-overhaul-plan.md`
> 基于 Deep Interview 规格，覆盖 MV P 的 3 个组件：进度条改造、后端流式事件增强、实时翻译日志审查面板。

---

## RALPLAN-DR 摘要

### Principles（指导原则）

1. **最小增量原则** — 每个组件保持独立可交付，不重构无关代码，不在一个 PR 里混合范围外改动。
2. **与现有架构一致** — 后端事件通道复用 `mpsc` + `app.emit()` 模式（与 `scan-progress` 一致），前端事件监听复用 `listen()` + `isTauriRuntime()` 守卫模式。
3. **前端边界清晰** — 浏览器预览模式提供 mock 数据，不因 Tauri API 不可用而崩溃。
4. **可测试性** — 每个组件都有明确的验收断言，新增的 Rust 结构体和事件链可独立测试。
5. **日志数据扁平** — 日志条目按条目发射，不捆绑进度数据，前端按需聚合。

### Decision Drivers（前 3 决策驱动因素）

1. **事件通道架构** — 翻译日志是逐条发射（高频、细粒度）还是按批次合并发射？直接影响前端实时性、后端性能和数据一致性。
2. **虚拟滚动策略** — 日志面板是否引入虚拟滚动库？影响 DOM 节点数、内存占用和整体复杂度。
3. **数据模型耦合** — `TranslateLogEntry` 是独立结构体还是扩展 `TranslateProgress`？影响前后端契约的向后兼容性。

### Viable Options

#### 决策 1：事件通道架构

| 选项 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A: 独立 mpsc 通道**（推荐） | `start_translation` 内新增第二个 mpsc 通道专门用于 `TranslateLogEntry`，第二条 reader 线程发射 `translate-log-entry` 事件 | 与 scan-progress 模式完全一致；细粒度实时流；log 不阻塞进度事件 | 增加一个通道和一个 spawn_blocking reader |
| B: 合并到 TranslateProgress | 在 `TranslateProgress` 中添加 `Vec<TranslateLogEntry>`，每批发射时附带该批日志 | 单通道、少代码 | 破坏现有 progress 契约；前端需去重；大批量时 payload 膨胀 |
| C: 无事件，轮询拉取 | 不发射事件，前端定期调用 `tauriInvoke` 拉取日志缓存 | 无需改事件通道 | 延迟高；轮询浪费资源；违背实时流设计目标 |

**无效化理由**：B 选项导致每批 progress 事件携带冗余日志数据，当前端仅关心进度数值时浪费带宽，且破坏 `TranslateProgress` 单一职责。C 选项与 Tauri 事件机制背道而驰，增加轮询复杂度且实时性差。

#### 决策 2：虚拟滚动策略

| 选项 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A: 固定高度容器 + overflow-y: auto + 尾部截断**（推荐） | `<div>` 固定 max-height，仅保留最后 N 条（如 500 条），超出丢弃 | 零依赖；代码 ~10 行；适合 <500 条场景 | 超出 500 条后日志丢失；大量条目时 DOM 膨胀 |
| B: 手动虚拟滚动 | 固定行高 + 计算可视区间，只渲染可见行 | 适合 1k+ 条目；无额外依赖 | 需要维护 scroll state、计算 offset；增加 ~80 行复杂度 |
| C: 引入 react-window | 引入 `react-window` 库的标准虚拟滚动 | 成熟方案、稳定可靠 | 引入 ~20KB 依赖；对本应用预期日志量（<500 条）过度设计 |

**无效化理由**：C 选项引入外部依赖，而本应用单次翻译会话的日志条目通常不超过数百条，尾部截断足够满足 MVP 需求。B 选项在条目量不大时徒增复杂度。A 方案是当前阶段最务实的路径。

#### 决策 3：TranslateLogEntry 数据模型

| 选项 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A: 独立结构体 + 独立事件**（推荐） | `TranslateLogEntry { key, sourceText, targetText, modName, sourceType }` 通过 `translate-log-entry` 单独发射 | 单一职责；前端按需过滤聚合；不影响 progress | 新增一个结构体和事件名 |
| B: 嵌入 TranslateProgress | 在 `TranslateProgress` 加 `logEntry: Option<TranslateLogEntry>` | 复用已有事件通道 | 每批日志量不固定；progress 语义膨胀 |
| C: 用现有 Rust dictionary::DictionaryEntry | 复用已有数据结构代替新增 | 零新增结构体 | `DictionaryEntry` 字段与日志需求不完全对齐；缺少 `sourceType`、`modName` 等字段的语言文件类型 |

**无效化理由**：B 选项压缩了两个关注点不同的数据流（进度 vs 日志），C 选项复用语义不匹配的现有类型导致前端需要额外适配。独立结构体是最清晰的选择。

---

## 实现步骤

### Step 1：后端 -- 新增 TranslateLogEntry 结构体

**文件：** `src-tauri/src/core/models.rs`

- 在 `TranslateProgress` 结构体之后（约第 209 行）新增 `TranslateLogEntry` 结构体定义：
  ```rust
  #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
  #[serde(rename_all = "camelCase")]
  pub struct TranslateLogEntry {
      pub key: String,
      pub source_text: String,
      pub target_text: String,
      pub mod_name: String,
      pub source_type: String, // "mod" | "resourcepack" | "dictionary" | "llm"
  }
  ```
- 需要把新的类型导出到 `commands.rs` 作用域：在 `commands.rs`（第 13 行）的 `use crate::core::models::{}` 中加入 `TranslateLogEntry`。
- 新增字段均非 optional — 每条翻译日志必须包含完整的 5 个字段。

### Step 2：后端 -- start_translation 新增 translate-log-entry 事件发射

**文件：** `src-tauri/src/commands.rs`

1. **新增第二个 mpsc 通道**（在第 303-305 行之后，即第一个 progress 通道创建后）：
   ```rust
   let (log_tx, log_rx) = mpsc::channel::<TranslateLogEntry>();
   let log_tx_work = log_tx.clone();
   ```

2. **新增第二条 reader 线程**（在第 307-314 行的 progress reader 之后）：
   ```rust
   let app_emit_log = app.clone();
   let _ = tauri::async_runtime::spawn_blocking(move || {
       while let Ok(log_entry) = log_rx.recv() {
           if let Err(err) = app_emit_log.emit("translate-log-entry", &log_entry) {
               eprintln!("translate-log-entry emit error: {err}");
           }
       }
   });
   ```

3. **在翻译循环中发射日志事件**（第 422-425 行的模拟循环体内，每个条目发射一次）：
   ```rust
   for (entry, mod_name) in batch_entries {
       let _ = log_tx_work.send(TranslateLogEntry {
           key: entry.key.clone(),
           source_text: entry.text.clone(),
           target_text: entry.text.clone(), // 模拟：目标=原文（后续 LLM 接入后替换）
           mod_name: mod_name.to_string(),
           source_type: "mod".to_string(),
       });
       completed += 1;
   }
   ```

4. **不要在 matching 阶段发射日志** — matching 阶段只更新 progress，日志条目只在 translating 阶段发射。

5. **在函数末尾关闭 log_tx**（在 `drop(progress_tx)` 附近，约第 466 行）加一行：
   ```rust
   drop(log_tx);
   ```

6. **将 `TranslateLogEntry` 加入 `start_translation` 的 `use` 导入**（第 8-17 行已导入的 `models` 中包含）。

### Step 3：前端 -- types.ts 新增 TranslateLogEntry 接口

**文件：** `src/types.ts`

- 在 `TranslateProgress` 接口之后（约第 169 行）新增：
  ```typescript
  export interface TranslateLogEntry {
    key: string;
    sourceText: string;
    targetText: string;
    modName: string;
    sourceType: string;
  }
  ```
- 注意字段名使用 camelCase（Rust `#[serde(rename_all = "camelCase")]` 自动转换）。

### Step 4：前端 -- i18n 新增日志面板相关翻译键

**文件：** `src/i18n/translations.ts`

- 在 `TranslationKey` 类型（约第 106 行附近）新增以下键：
  ```
  | "jobs.logPanel.title"
  | "jobs.logPanel.filterPlaceholder"
  | "jobs.logPanel.clear"
  | "jobs.logPanel.copyEntry"
  | "jobs.logPanel.noEntries"
  | "jobs.logPanel.colKey"
  | "jobs.logPanel.colSource"
  | "jobs.logPanel.colTarget"
  | "jobs.logPanel.colMod"
  | "jobs.logPanel.colType"
  | "jobs.logPanel.entriesCount"
  ```

- 在 `zhCn` 字典（约第 330-334 行区域）、`enUs` 回退（enUs 使用 `...zhCn` 继承，需覆盖 key）、`jaJp`、`koKr` 中添加对应翻译值。由于 enUs 继承 zhCn，只新增的键需要在 enUs 中显式覆盖为英文。

  ```typescript
  // zhCn 新增（在 "jobs.progressHint": "请等待当前批处理完成" 附近）
  "jobs.logPanel.title": "翻译日志",
  "jobs.logPanel.filterPlaceholder": "按模组名称过滤...",
  "jobs.logPanel.clear": "清空日志",
  "jobs.logPanel.copyEntry": "复制",
  "jobs.logPanel.noEntries": "暂无翻译日志",
  "jobs.logPanel.colKey": "键名",
  "jobs.logPanel.colSource": "原文",
  "jobs.logPanel.colTarget": "译文",
  "jobs.logPanel.colMod": "模组",
  "jobs.logPanel.colType": "来源",
  "jobs.logPanel.entriesCount": "共 {count} 条",
  
  // enUs 新增（需要覆盖继承的 zhCn）
  "jobs.logPanel.title": "Translation Log",
  "jobs.logPanel.filterPlaceholder": "Filter by mod name...",
  "jobs.logPanel.clear": "Clear Log",
  "jobs.logPanel.copyEntry": "Copy",
  "jobs.logPanel.noEntries": "No translation log entries",
  "jobs.logPanel.colKey": "Key",
  "jobs.logPanel.colSource": "Source",
  "jobs.logPanel.colTarget": "Target",
  "jobs.logPanel.colMod": "Mod",
  "jobs.logPanel.colType": "Type",
  "jobs.logPanel.entriesCount": "{count} entries",
  ```

### Step 5：前端 -- JobsPage.tsx 进度条改造

**文件：** `src/pages/JobsPage.tsx`

1. **替换 idle 状态的 stats-grid 为简洁摘要条**（第 171-197 行）：
   - 删除原有的完整面板（4 个 stat-card），改为一条内联摘要条，保留关键信息：
   ```tsx
   {scanSummary && scanSummary.actualPendingEntries > 0 && status === "idle" && (
     <div className="idle-summary">
       <span>{t(language, "jobs.totalEntries")}: <strong>{scanSummary.actualPendingEntries.toLocaleString()}</strong></span>
       <span className="idle-summary-sep">|</span>
       <span>{t(language, "jobs.sourceLang")}: <strong>{scanSummary.sourceLanguage}</strong></span>
       <span className="idle-summary-sep">|</span>
       <span>{t(language, "jobs.targetLang")}: <strong>{scanSummary.targetLanguage}</strong></span>
       <span className="idle-summary-sep">|</span>
       <span>{t(language, "jobs.modCount")}: <strong>{scanSummary.mods.length}</strong></span>
     </div>
   )}
   ```

2. **进度条改造**（第 199-242 行的 `isRunning` 区块）：
   - 修改 `scan-progress-header` 内的 `<strong>` 标签：不再显示 phase label，改为显示当前 mod 文件名，应用 CSS 截断。
   - `<span>` 保持显示 `current / total` 数字。
   - 在 `scan-progress-header` 右侧加百分比显示 `(75%)`。
   - `<div className="scan-progress">` 容器需要在翻译运行期间始终可见（包括 `status === "running"` 并在翻译完成后保留短暂时间显示最终状态）。
   - 翻译完成后（`status === "completed"`）进度条变绿并显示 "翻译完成" 消息，不再显示 mod 名。
   - 翻译取消时进度条不变，显示 "已取消" 消息。

3. **新增日志面板容器**（在进度条下方，约第 242 行后，`</section>` 之前）：
   - `<div className="log-panel">` 容器，带 max-height 和 overflow-y。
   - 头部包含标题、过滤输入框、清空按钮。
   - 表格体包含 5 列：键名、原文、译文、模组、来源类型。
   - 监听 `translate-log-entry` 事件的逻辑。

4. **在组件顶部新增导入**：
   - `import { useState, useEffect, useRef, useMemo, useCallback } from "react";`
   - `import { Copy, Filter, Trash2 } from "lucide-react";` (如果这些图标可用)
   - `import type { TranslateLogEntry } from "../types";`

5. **在组件内部新增状态和效果**：
   ```typescript
   const [logEntries, setLogEntries] = useState<TranslateLogEntry[]>([]);
   const [filterTerm, setFilterTerm] = useState("");
   const logContainerRef = useRef<HTMLDivElement>(null);
   
   // 监听 translate-log-entry
   useEffect(() => {
     if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
     let unlistenFn: (() => void) | null = null;
     let cancelled = false;
     import("@tauri-apps/api/event").then(({ listen }) => {
       if (cancelled) return;
       listen("translate-log-entry", (event) => {
         const entry = event.payload as TranslateLogEntry;
         setLogEntries(prev => {
           const next = [...prev, entry];
           // Keep last 500 entries
           return next.length > 500 ? next.slice(-500) : next;
         });
       }).then((unlisten) => { unlistenFn = unlisten; if (cancelled) unlisten(); });
     });
     return () => { cancelled = true; unlistenFn?.(); };
   }, []);
   
   // 自动滚动到日志底部
   useEffect(() => {
     if (logContainerRef.current) {
       logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
     }
   }, [logEntries.length]);

   // 浏览器预览模式 mock — 当不在 Tauri 运行时使用
   const mockLogEntries: TranslateLogEntry[] = [
     { key: "item.example.name", sourceText: "Example Item", targetText: "示例物品", modName: "example-mod", sourceType: "llm" },
     { key: "item.example.desc", sourceText: "A useful example", targetText: "一个有用的示例", modName: "example-mod", sourceType: "llm" },
   ];

   // 选择数据源：Tauri 运行时取事件流，浏览器模式取 mock
   const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
   const sourceEntries = isTauri ? logEntries : mockLogEntries;
   ```

6. **过滤逻辑**（使用 `useMemo`，支持模组名和键名过滤）：
   ```typescript
   const filteredEntries = useMemo(() => {
     if (!filterTerm) return sourceEntries;
     const lower = filterTerm.toLowerCase();
     return sourceEntries.filter(
       (e) => e.modName.toLowerCase().includes(lower) || e.key.toLowerCase().includes(lower)
     );
   }, [sourceEntries, filterTerm]);
   ```

7. **复制功能**（带错误处理）：
   ```typescript
   const copyEntry = useCallback(async (entry: TranslateLogEntry) => {
     const text = `${entry.key}: ${entry.sourceText} -> ${entry.targetText}`;
     try {
       await navigator.clipboard.writeText(text);
     } catch (err) {
       console.warn("复制日志条目失败:", err);
     }
   }, []);
   ```

8. **清空功能**：
   ```typescript
   const clearLog = useCallback(() => {
     setLogEntries([]);
   }, []);
   ```

8. **清空功能**：`function clearLog() { setLogEntries([]); }`

### Step 6：前端 -- CSS 样式新增

**文件：** `src/styles/app.css`

在文件末尾（第 807 行后）追加日志面板相关样式：

```css
/* ── Idle 待翻译摘要条 ──────────────────── */

.idle-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
  border: 1px solid #ded8cc;
  border-radius: 6px;
  background: #faf8f5;
  font-size: 13px;
  color: #6b665d;
}

.idle-summary strong {
  color: #1f2937;
  font-weight: 600;
}

.idle-summary-sep {
  color: #ded8cc;
}

/* ── Log Panel ──────────────────────────── */

.log-panel {
  margin-top: 16px;
  border: 1px solid #ded8cc;
  border-radius: 6px;
  background: #fff;
}

.log-panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid #efeade;
}

.log-panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.log-panel-filter {
  display: flex;
  flex: 1;
  max-width: 300px;
  height: 30px;
  border: 1px solid #ded8cc;
  border-radius: 5px;
  padding: 0 10px;
  font-size: 12px;
}

.log-panel-body {
  max-height: 520px;
  overflow-y: auto;
}

.log-panel-body table {
  font-size: 12px;
}

.log-panel-body td {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-panel-body .copy-log-row {
  cursor: pointer;
  transition: background 0.1s;
}

.log-panel-body .copy-log-row:hover {
  background: #f5f3ee;
}



.log-entries-count {
  font-size: 12px;
  color: #6b665d;
  white-space: nowrap;
}

.log-panel-empty {
  display: grid;
  place-items: center;
  min-height: 120px;
  color: #6b665d;
  font-size: 13px;
}
```

同时修改进度条中的 mod 名显示样式，确保 `scan-progress-mod` 已有 `text-overflow: ellipsis` 和 `white-space: nowrap`（已在第 439-442 行定义，无需额外修改）。进度条百分比可以在 `scan-progress-header span` 旁新增一个元素。

### Step 7：前端 -- JobsPage 完整结构重组

**文件：** `src/pages/JobsPage.tsx`

重新组织渲染逻辑为以下区块顺序：

```
<section className="page">
  <div className="page-header">
    <h1> + <p> + <Play>/<Square> buttons
  </div>

  {/* idle: empty state when no scan */}
  {!scanSummary && <empty-state>}

  {/* idle: no pending entries */}
  {scanSummary && actualPendingEntries===0 && status==="idle" && <success empty-state>}

  {/* alerts */}
  {completed && <success alert>}
  {canceled && <warning alert>}
  {failed && <error alert>}

  {/* Progress bar (running or completed+still showing) */}
  {(isRunning || translateProgress) && (
    <div className="scan-progress">
      <div className="scan-progress-header">
        <strong className="truncate">{modName or stageLabel}</strong>
        <span>{current} / {total}</span>
        <small>({percent}%)</small>
      </div>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{width: percent+"%"}} />
      </div>
      {stageStatus==="completed" && <small>✔ {stageLabel}</small>}
    </div>
  )}

  {/* Log panel (always visible, shows empty state pre-translation) */}
  <div className="log-panel">
    <div className="log-panel-header">
      <h3>{t(language, "jobs.logPanel.title")}</h3>
      {filteredEntries.length > 0 && (
        <span className="log-entries-count">
          {t(language, "jobs.logPanel.entriesCount", { count: filteredEntries.length })}
        </span>
      )}
      <input
        className="log-panel-filter"
        placeholder={t(language, "jobs.logPanel.filterPlaceholder")}
        onChange={...}
      />
      <button className="ghost-button" style={{height:30}} onClick={clearLog}>
        <Trash2 size={14} />
        {t(language, "jobs.logPanel.clear")}
      </button>
    </div>

    <div className="log-panel-body">
      {filteredEntries.length === 0
        ? <div className="log-panel-empty">{t(language, "jobs.logPanel.noEntries")}</div>
        : <table>
            <thead>
              <tr>
                <th>{t(language, "jobs.logPanel.colKey")}</th>
                <th>{t(language, "jobs.logPanel.colSource")}</th>
                <th>{t(language, "jobs.logPanel.colTarget")}</th>
                <th>{t(language, "jobs.logPanel.colMod")}</th>
                <th>{t(language, "jobs.logPanel.colType")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry, idx) => (
                <tr key={idx} className="copy-log-row" onClick={() => copyEntry(entry)}>
                  <td>{entry.key}</td>
                  <td>{entry.sourceText}</td>
                  <td>{entry.targetText}</td>
                  <td>{entry.modName}</td>
                  <td><span className="badge">{entry.sourceType}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
      }
    </div>
  </div>
</section>
```

### Step 8：前端 -- 收尾检查

- `jobs.totalEntries`、`jobs.sourceLang`、`jobs.targetLang`、`jobs.modCount` 这 4 个键仍被 idle-summary 使用，**保留不动**。
- `jobs.summary` 未被使用（原 stats-grid panel title），保留在字典中不做删除（无代价）。
- 确认前后端事件名一致：`translate-log-entry`。

---

## 验收标准

### 组件 A：进度条改造

| 编号 | 验收断言 | 验证方式 |
|------|----------|----------|
| A1 | 翻译 idle 状态下不显示大型统计卡片，改为简洁摘要信息条（条目数、语言、模组数） | 打开 JobsPage，scanSummary 有数据且 status="idle" 时，页面包含 `.idle-summary` 而非 `.stats-grid`。 |
| A2 | 翻译运行时进度条显示当前 mod 文件名，且文件名超出最大宽度时 text-overflow 截断 | 启动翻译，观察 `.scan-progress-mod` 是否显示截断效果。 |
| A3 | 进度条显示 `current / total` 数值和 `(xx%)` 百分比 | 翻译运行期间观察进度条 header，数值和百分比实时更新。 |
| A4 | 翻译完成后进度条变为绿色、显示"翻译完成" | 翻译完成后，progress-bar-fill 显示 100% 宽度（绿色），出现成功提示。 |
| A5 | 翻译取消时进度条显示取消状态 | 点击停止，出现取消提示。 |

### 组件 B：后端流式事件

| 编号 | 验收断言 | 验证方式 |
|------|----------|----------|
| B1 | `models.rs` 存在 `TranslateLogEntry` 结构体 | `cargo test` 通过；grep 确认结构体定义存在。 |
| B2 | `TranslateLogEntry` 在 `serde(rename_all = "camelCase")` 下序列化正确 | Rust 单元测试：构造实例、JSON 序列化/反序列化验证。 |
| B3 | 翻译循环每个条目发射一次 `translate-log-entry` 事件 | 前端日志面板条目数等于翻译总数；或 Rust 新增计数验证。 |
| B4 | matching 阶段不发射日志事件 | matching 阶段日志面板不出现 0 条以外变化。 |
| B5 | 翻译完成后 channel 正确关闭、无泄漏 | `cargo test` 内存相关测试通过（内存泄漏检测使用 Windows 原生工具如 DrMemory，或标准 leak 检测）。 |

### 组件 C：实时日志审查面板

| 编号 | 验收断言 | 验证方式 |
|------|----------|----------|
| C1 | 日志面板始终可见（包括翻译前显示空状态） | 页面加载后下方出现日志面板，无条目时显示"暂无翻译日志"。 |
| C2 | 翻译过程中日志逐条追加 | 开始翻译后日志面板每秒新增条目。 |
| C3 | 点击单行复制 key:sourceText->targetText 到剪贴板 | 点击日志行，粘贴后检查格式。 |
| C4 | 清空日志按钮清除所有条目 | 点击清空按钮后日志面板回到空状态。 |
| C5 | 按模组名称或键名过滤 | 在过滤输入框输入模组名或键名，表格只显示匹配项。 |
| C6 | 条目超过 500 条时自动丢弃最早的条目 | 插入 501 条数据后，第一条不可见。 |
| C7 | 浏览器预览模式显示 mock 日志（2 条预设示例） | 浏览器中打开 JobsPage，日志面板显示预设示例条目。 |
| C8 | 自动滚动到新条目 | 日志追加时容器自动滚动到底部。 |

### 整体

| 编号 | 验收断言 | 验证方式 |
|------|----------|----------|
| O1 | `npm run build` 无错误 | 执行构建命令并检查输出。 |
| O2 | `npm run test:unit` 全通过 | 执行单元测试。 |
| O3 | `cd src-tauri && cargo test` 全通过 | 执行 Rust 测试。 |
| O4 | 所有 TS/TSX 文件 LSP 诊断 0 error | `lsp_diagnostics` 工具检查。 |
| O5 | 4 种应用语言下日志面板显示正确翻译文本 | 切换 `zh_cn` / `en_us` / `ja_jp` / `ko_kr`，检查面板头部和空状态文本。 |

---

## 风险与缓解措施

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| **LSP 事件监听泄漏** — `listen()` 在组件卸载时未正确清理 | 中 | 高（重复监听导致事件多次处理） | 使用 useEffect 返回的 cleanup 函数调用 `unlisten()`；在 unmount 时设置 cancel flag |
| **per-entry 事件过多导致前端卡顿** — 1000+ 条目逐条发射 `listen` 回调 | 低 | 中 | 保持 <500 条目截断；React state batching 天然合并渲染；必要时使用 `requestAnimationFrame` 抑制 |
| **mpsc channel 积压** — 日志发射快于 reader 消费 | 低 | 低 | mpsc channel 无界缓冲区会自动增长；仅在速率极端时影响内存，但本应用逐条目发射频率远低于 10K/s 阈值 |
| **caps 缺少事件权限** — Tauri 2 需要显式 permissions 才能发射事件 | 中 | 高 | 检查 `capabilities/default.json` 已有 `core:event:default`（确认：现有 `scan-progress` 正常工作，证明事件系统已就绪） |
| **translate-log-entry 事件名拼写错误** — 前后端事件名不一致 | 低 | 高 | 统一在 plan 中固定为 `translate-log-entry`（带连字符）；后端 emit / 前端 listen 使用相同字符串常量 |
| **进度条改造破坏现有功能** — 删除 stats-grid 后扫描摘要信息丢失 | 中 | 中 | idle 状态下使用 compact summary 条替代，保留条目数/语言/模组数关键信息 |
| **Rust 单元测试未覆盖 channels** — 增加 channel 后缺少测试 | 中 | 低 | 为 `start_translation` 模拟翻译循环写一个基础集成测试：验证发射了 N 个 log entry |

---

## 交付顺序建议

建议按以下顺序实现以避免阻塞：

```
Step 1 (models.rs 新增 TranslateLogEntry) ──→ Step 2 (commands.rs 发射日志事件)
                                                       │
Step 3 (types.ts 新增接口) ──→ Step 4 (i18n 新增键) ──┼──→ Step 5+6+7 (JobsPage 改造 + CSS)
                                                       │
                                              Step 8 (收尾检查)
```

Step 1 (Rust) 和 Step 3 (TypeScript) 互不依赖，可并行开发。Step 5/6/7 需要 Step 3/4 完成后进行。

---

## ADR（架构决策记录）

### ADR-1：独立 mpsc 事件通道

| 字段 | 内容 |
|------|------|
| **决策** | 新增独立 `translate-log-entry` 事件通道，与现有 `translate-progress` 解耦 |
| **驱动因素** | ① 日志条目逐条高频发射 vs 进度按批次低频更新 ② 单一职责原则 ③ 与 scan-progress 现有 mpsc 模式一致 |
| **备选方案** | 合并到 TranslateProgress（否决：破坏职责分离、payload 膨胀）；轮询拉取（否决：延迟高、非实时） |
| **选择理由** | 复用已验证的 mpsc + spawn_blocking + app.emit() 模式，双通道各自独立最优 |
| **后果** | 新增一个 channel + reader 线程；事件监听代码复杂度可接受 |
| **跟进** | 后续 LLM 接入后，事件发射频率需监控 |

### ADR-2：尾部截断代替虚拟滚动

| 字段 | 内容 |
|------|------|
| **决策** | 固定 max-height 容器 + overflow-y:auto + 保留最后 500 条 |
| **驱动因素** | ① 最小化依赖 ② 单次翻译预期条目数 < 500 ③ 实现复杂度最低 |
| **备选方案** | react-window（否决：~20KB 依赖，过度设计）；手动虚拟滚动（否决：~80 行复杂逻辑） |
| **选择理由** | MVP 阶段实用性优先，500 条阈值足够覆盖几乎所有使用场景 |
| **后果** | 超大规模翻译（>1k 条目/会话）可能丢失早期日志；后续可升级为虚拟滚动 |
| **跟进** | 用户确认"一直追加"，500 条为实现保护而非 UX 限制，后续可配置或升级 |

### ADR-3：独立 TranslateLogEntry 结构体

| 字段 | 内容 |
|------|------|
| **决策** | 新增独立的 TranslateLogEntry 结构体（Rust）+ 接口（TypeScript） |
| **驱动因素** | ① 字段与进度数据无关 ② 前后端契约独立演化 ③ 代码可读性 |
| **备选方案** | 嵌入 TranslateProgress（否决：语义膨胀、可选字段导致消费方困惑）；复用 DictionaryEntry（否决：字段不匹配） |
| **选择理由** | 最清晰的关注点分离，后续添加字段不影响现有结构 |
| **后果** | 一个额外的 Rust struct + TS interface + 事件名 |
| **跟进** | 后续 `source_type: String` 可升级为 Rust 枚举 + TypeScript union type |

### ADR-4：source_type 使用 String（暂不枚举）

| 字段 | 内容 |
|------|------|
| **决策** | `sourceType` 使用自由字符串 `"mod"` / `"resourcepack"` / `"dictionary"` / `"llm"` / `"skipped"` |
| **驱动因素** | ① 二期才接入真实 LLM 和词典，枚举的完整取值空间未知 ② 最小化提前抽象 |
| **备选方案** | Rust enum `SourceType { Mod, Resourcepack, Dictionary, Llm, Skipped }`（否决：二期取值变化时需改枚举定义 + 反序列化兼容） |
| **选择理由** | String 足够灵活，后续接入 LLM/词典时再收敛为枚举，避免 YAGNI 问题 |
| **后果** | 前端需处理字符串匹配；二期需升级为类型安全的枚举 |
| **跟进** | 二期接入词典缓存时同步升级为枚举 |

---

## Changelog（Critic 改进记录）

| 改进 | 原始 | 修正后 | 来源 |
|------|------|--------|------|
| idle 状态保留摘要信息 | 完全移除统计卡片 | 替换为紧凑摘要条（条目数/语言/模组数） | Critic: 用户可能仍需参考扫描摘要 |
| Step 8 保留字典键 | 删除 `jobs.totalEntries` 等 5 个键 | 保留 4 个仍在 idle-summary 使用的键，只标记 `jobs.summary` 为未使用 | Critic: 确认引用关系 |
| 过滤范围扩展 | 仅按模组名过滤 | 模组名或键名均可匹配 | Critic: 更灵活的用户体验 |
| 自动滚动 | 未提及 | 新增 C8 验收标准：日志追加时自动滚动到底部 | Critic: UX 完整性 |
| 日志条目计数 | 无 | header 中显示当前条目数 | Critic: 信息完整性 |
| B5 泄漏检测方案 | valgrind（Linux 工具） | Windows 原生工具如 DrMemory | Critic: Windows 平台适用性 |
| 整体风格 | 技术文档 | 增加非技术用户可读的前言段落 | Critic: 受众适配 |

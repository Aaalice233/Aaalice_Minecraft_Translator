# 规格：资源包语言文件解析进词典候选池

## 现状

当前 `scanner.rs` 的资源包扫描只统计条目数量 (`entry_count: usize`)，不解析实际翻译内容。`ResourcePackScanResult` 缺少 `entries: Vec<LanguageEntry>` 字段。

这意味着扫描完成后，资源包中的翻译文本无法被后续词典系统复用——统计数字有了，但实际翻译内容丢失了。

## 目标

1. 资源包扫描时，将每个语言文件解析为 `LanguageEntry` 对象列表
2. 存入 `ResourcePackScanResult.entries`，供后续词典系统访问
3. 保持向后兼容：`entry_count` 仍可通过 `entries.len()` 推导，不改变现有接口字段名
4. 更新测试验证条目内容和语言标签正确性

## 影响范围

| 文件 | 改动 |
|------|------|
| `models.rs` | `ResourcePackScanResult` 增加 `entries: Vec<LanguageEntry>` |
| `scanner.rs` | 修改 `scan_resourcepack_dir`、`scan_resourcepack_zip`、`collect_resourcepack_lang_dir` 以解析实际条目 |
| `scanner.rs` | 新建 `parse_resourcepack_lang_file()` 复用已有解析逻辑 |
| `scanner.rs` | 删除 `parse_resourcepack_entry_count()`（被条目解析取代） |
| `scanner.rs` 测试 | 增加条目内容验证、mod_id/language 标签验证 |

## 实现方案

资源包语言文件的路径格式为 `assets/<modid>/lang/<target_language>.json` 或 `.lang`，与 mod jar 里的格式完全一致。因此复用 `parse_language_entries()`。

### 新函数

```rust
fn parse_resourcepack_lang_file(
    name: &str,
    content: &str,
    jar_path: &Path,
    warnings: &mut Vec<ScanWarning>,
) -> Vec<LanguageEntry>
```

### 修改的扫描函数

- `scan_resourcepack_dir(path)` → `collect_resourcepack_lang_dir` 改为收集 `Vec<LanguageEntry>` 
- `scan_resourcepack_zip(path)` → 每个匹配的文件都 parse 成 entries
- `collect_resourcepack_lang_dir` → 递归收集目录下所有语言文件条目

### 数据模型

```rust
pub struct ResourcePackScanResult {
    // ... 现有字段不变 ...
    pub entries: Vec<LanguageEntry>,    // 新增
}
```

### 边界情况

- 资源包内单文件损坏 → 跳过，不影响整个包
- 空语言文件 → 空 Vec
- JSON 格式错误 → 宽松解析回退（已有逻辑）
- 目录模式与 zip 模式均正确处理

## 测试要求

- i18n-example.zip → entries[0].key 为 "item.examplemod.energy_cell"，language 为 "zh_cn"
- VM_汉化包/ → .lang 条目键值为 "item.placeholdermod.wrench"
- ja_jp 目标语言 → 两个包条目均为 0

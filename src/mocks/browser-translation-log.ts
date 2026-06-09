import type { TranslateLogEntry } from "../types";

/**
 * 浏览器预览模式下的示例翻译日志数据。
 * 当 __TAURI_INTERNALS__ 不可用时使用此 mock 数据展示日志表格。
 */
export const MOCK_TRANSLATION_ENTRIES: TranslateLogEntry[] = [
  {
    key: "item.example.name",
    sourceText: "Example Item",
    targetText: "示例物品",
    modName: "example-mod-1.21.1.jar",
    sourceType: "llm",
  },
  {
    key: "item.example.desc",
    sourceText: "A useful example item",
    targetText: "一个有用的示例物品",
    modName: "example-mod-1.21.1.jar",
    sourceType: "llm",
  },
  {
    key: "block.example.ore",
    sourceText: "Example Ore",
    targetText: "示例矿石",
    modName: "example-mod-1.21.1.jar",
    sourceType: "dictionary",
  },
];

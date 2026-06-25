import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DictionaryPage } from "../src/pages/DictionaryPage";

const apiMocks = vi.hoisted(() => ({
  searchDictionary: vi.fn(),
  countDictionary: vi.fn(),
  getDictionaryStats: vi.fn(),
  deleteDictionarySelection: vi.fn(),
  deleteDictionaryEntry: vi.fn(),
  clearDictionary: vi.fn(),
  updateDictionaryEntry: vi.fn(),
  getSettings: vi.fn(),
  translateSingleEntry: vi.fn(),
}));

vi.mock("../src/api/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/tauri")>();
  return {
    ...actual,
    searchDictionary: apiMocks.searchDictionary,
    countDictionary: apiMocks.countDictionary,
    getDictionaryStats: apiMocks.getDictionaryStats,
    deleteDictionarySelection: apiMocks.deleteDictionarySelection,
    deleteDictionaryEntry: apiMocks.deleteDictionaryEntry,
    clearDictionary: apiMocks.clearDictionary,
    updateDictionaryEntry: apiMocks.updateDictionaryEntry,
    getSettings: apiMocks.getSettings,
    translateSingleEntry: apiMocks.translateSingleEntry,
  };
});

vi.mock("react-virtuoso", () => ({
  TableVirtuoso: ({ totalCount, components, fixedHeaderContent, itemContent }: any) => {
    const Table = components.Table;
    return (
      <Table>
        <thead>{fixedHeaderContent()}</thead>
        <tbody>
          {Array.from({ length: totalCount }).map((_, index) => (
            <tr key={index}>{itemContent(index)}</tr>
          ))}
        </tbody>
      </Table>
    );
  },
}));

const entries = [
  {
    id: 1,
    sourceText: "Copper Gear",
    targetText: "铜齿轮",
    sourceLang: "en_us",
    targetLang: "zh_cn",
    sourceType: "llm",
    modId: "gearbox",
    modName: "Gearbox-1.21.1.jar",
    translationKey: "item.gearbox.copper_gear",
    confidence: 1,
  },
  {
    id: 2,
    sourceText: "Iron Gear",
    targetText: "铁齿轮",
    sourceLang: "en_us",
    targetLang: "zh_cn",
    sourceType: "reviewed",
    modId: "gearbox",
    modName: "Gearbox-1.21.1.jar",
    translationKey: "item.gearbox.iron_gear",
    confidence: 1,
  },
];

beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
  apiMocks.searchDictionary.mockResolvedValue(entries);
  apiMocks.countDictionary.mockResolvedValue(2);
  apiMocks.getDictionaryStats.mockResolvedValue({ total: 2, modIds: ["gearbox"] });
  apiMocks.deleteDictionarySelection.mockResolvedValue({ removed: 2, remainingLocal: 0 });
});

afterEach(() => {
  cleanup();
  delete (window as any).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe("DictionaryPage bulk selection", () => {
  it("renders bulk toolbar and selects individual rows", async () => {
    render(<DictionaryPage language="zh_cn" />);

    expect(await screen.findByText("匹配 2 条，已选择 0 条")).toBeTruthy();
    const rowChecks = await screen.findAllByLabelText("选择此条目");
    fireEvent.click(rowChecks[0]);

    expect(await screen.findByText("匹配 2 条，已选择 1 条")).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除所选" })).toBeEnabled();
  });

  it("uses Ctrl+A to select all matching entries outside text inputs", async () => {
    render(<DictionaryPage language="zh_cn" />);
    expect(await screen.findByText("匹配 2 条，已选择 0 条")).toBeTruthy();

    fireEvent.keyDown(document, { key: "a", ctrlKey: true });

    expect(await screen.findByText("匹配 2 条，已选择 2 条（包含未加载条目）")).toBeTruthy();
  });

  it("does not steal Ctrl+A from the search input", async () => {
    render(<DictionaryPage language="zh_cn" />);
    expect(await screen.findByText("匹配 2 条，已选择 0 条")).toBeTruthy();

    const search = screen.getByPlaceholderText("搜索原文、译文、翻译键、模组名或文件名...");
    fireEvent.keyDown(search, { key: "a", ctrlKey: true });

    expect(screen.getByText("匹配 2 条，已选择 0 条")).toBeTruthy();
  });

  it("confirms and deletes the selected query", async () => {
    render(<DictionaryPage language="zh_cn" />);
    expect(await screen.findByText("匹配 2 条，已选择 0 条")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "全选匹配项" }));
    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(apiMocks.deleteDictionarySelection).toHaveBeenCalledWith({
        mode: "query",
        query: expect.objectContaining({}),
        excludedIds: [],
      });
    });
    expect(await screen.findByText("已删除 2 条词库条目")).toBeTruthy();
  });
});

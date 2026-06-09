import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../src/app/AppContext";
import { ValidatePage } from "../src/pages/ValidatePage";

vi.mock("../src/api/tauri", () => ({
  loadLatestTranslationJobMeta: () => Promise.resolve({
    jobId: "test-job-001", scanJobId: "scan-001",
    status: "completed" as const,
    sourceLanguage: "en_us", targetLanguage: "zh_cn",
    entries: 3, completedEntries: 5, failedEntries: 1,
    tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    createdAt: "2026-01-01T00:00:00Z",
  }),
  loadTranslationModSummaries: () => Promise.resolve([
    { modId: "testmod", modName: "testmod-1.0.jar", entryCount: 2, completedCount: 2, failedCount: 0 },
    { modId: "othermod", modName: "othermod-1.0.jar", entryCount: 1, completedCount: 1, failedCount: 0 },
  ]),
  loadTranslationResults: () => Promise.resolve([
    { key: "item.test.a", sourceText: "Hello A", targetText: "你好A", modId: "testmod", modName: "testmod-1.0.jar", sourceType: "llm" },
    { key: "item.test.b", sourceText: "Hello B", targetText: "你好B", modId: "othermod", modName: "othermod-1.0.jar", sourceType: "llm" },
    { key: "item.test.c", sourceText: "Hello C", targetText: "你好C", modId: "testmod", modName: "testmod-1.0.jar", sourceType: "llm" },
  ]),
  saveTranslationEntry: () => Promise.resolve(),
}));

afterEach(() => { cleanup(); });

describe("ValidatePage", () => {
  it("shows review workbench heading when job exists", async () => {
    render(<AppProvider><ValidatePage language="zh_cn" onConfirm={() => {}} /></AppProvider>);
    expect(await screen.findByText("校对工作台")).toBeTruthy();
  });

  it("displays job info bar with completed entries count", async () => {
    render(<AppProvider><ValidatePage language="zh_cn" onConfirm={() => {}} /></AppProvider>);
    expect(await screen.findByText(/5 条已翻译/)).toBeTruthy();
    expect(await screen.findByText(/test-job-001/)).toBeTruthy();
  });

  it("renders mod accordion group headers from translation results", async () => {
    render(<AppProvider><ValidatePage language="zh_cn" onConfirm={() => {}} /></AppProvider>);
    expect(await screen.findByText("testmod")).toBeTruthy();
    expect(await screen.findByText("othermod")).toBeTruthy();
  });

  it("shows entry count per mod group", async () => {
    render(<AppProvider><ValidatePage language="zh_cn" onConfirm={() => {}} /></AppProvider>);
    expect(await screen.findByText(/2 条/)).toBeTruthy();
    expect(await screen.findByText(/1 条/)).toBeTruthy();
  });

  it("shows confirm pack button when entries exist", async () => {
    render(<AppProvider><ValidatePage language="zh_cn" onConfirm={() => {}} /></AppProvider>);
    expect(await screen.findByText("进入打包")).toBeTruthy();
  });
});

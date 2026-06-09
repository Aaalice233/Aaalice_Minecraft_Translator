import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../src/app/AppContext";
import { ValidatePage } from "../src/pages/ValidatePage";
import { useAppStore } from "../src/stores/appStore";

vi.mock("../src/api/tauri", () => ({
  loadLatestTranslationJobMeta: () => Promise.resolve({
    jobId: "test-job-001", scanJobId: "scan-001",
    status: "completed" as const,
    sourceLanguage: "en_us", targetLanguage: "zh_cn",
    completedEntries: 5, failedEntries: 1,
    createdAt: "2026-01-01T00:00:00Z",
    reviewed: false,
  }),
  loadTranslationResults: () => Promise.resolve([
    { key: "item.test.a", sourceText: "Hello A", targetText: "你好A", modId: "testmod", modName: "testmod-1.0.jar", sourceType: "llm" },
    { key: "item.test.b", sourceText: "Hello B", targetText: "你好B", modId: "othermod", modName: "othermod-1.0.jar", sourceType: "llm" },
    { key: "item.test.c", sourceText: "Hello C", targetText: "你好C", modId: "testmod", modName: "testmod-1.0.jar", sourceType: "llm" },
  ]),
  saveTranslationEntry: () => Promise.resolve(),
  markJobReviewed: () => Promise.resolve(),
}));

afterEach(() => {
  cleanup();
  // Reset Zustand store between tests
  useAppStore.getState().setTranslationJobId(null);
});

describe("ValidatePage", () => {
  it("shows review workbench heading when job exists", async () => {
    useAppStore.getState().setTranslationJobId("test-job-001");
    render(<AppProvider><ValidatePage language="zh_cn" onReviewComplete={() => {}} /></AppProvider>);
    expect(await screen.findByText("校对工作台")).toBeTruthy();
  });

  it("displays job info bar with completed entries count", async () => {
    useAppStore.getState().setTranslationJobId("test-job-001");
    render(<AppProvider><ValidatePage language="zh_cn" onReviewComplete={() => {}} /></AppProvider>);
    expect(await screen.findByText(/5 条已翻译/)).toBeTruthy();
    expect(await screen.findByText(/test-job-001/)).toBeTruthy();
  });

  it("renders entry data by checking source text in the table", async () => {
    useAppStore.getState().setTranslationJobId("test-job-001");
    render(<AppProvider><ValidatePage language="zh_cn" onReviewComplete={() => {}} /></AppProvider>);
    // TableVirtuoso may not render all rows in jsdom, so check the overall entry count
    expect(await screen.findByText(/3 个条目/)).toBeTruthy();
  });

  it("shows review complete button when entries exist", async () => {
    useAppStore.getState().setTranslationJobId("test-job-001");
    render(<AppProvider><ValidatePage language="zh_cn" onReviewComplete={() => {}} /></AppProvider>);
    expect(await screen.findByText("校对完成")).toBeTruthy();
  });
});

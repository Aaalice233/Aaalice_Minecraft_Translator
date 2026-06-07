import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../src/app/AppContext";
import { ValidatePage } from "../src/pages/ValidatePage";

vi.mock("../src/api/tauri", () => ({
  loadLatestTranslationJob: () => Promise.resolve({
    jobId: "test-job-001", scanJobId: "scan-001",
    status: "completed" as const,
    sourceLanguage: "en_us", targetLanguage: "zh_cn",
    entries: [], completedEntries: 5, failedEntries: 1,
    tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    createdAt: "2026-01-01T00:00:00Z",
  }),
  validateTranslation: () => Promise.resolve({
    totalEntries: 5, passed: 3, failed: 1, missing: 1,
    placeholderIssues: [
      { key: "item.test.bad", modId: "badmod", sourceText: "Hello %s", targetText: "你好", issueType: "placeholder_missing", description: "缺少占位符 %s", severity: "error" },
      { key: "item.test.ok", modId: "goodmod", sourceText: "Hello", targetText: "你好", issueType: "ok", description: "正常", severity: "warning" },
    ],
    formatIssues: [],
  }),
  retryFailedEntries: () => Promise.resolve(1),
}));

afterEach(() => { cleanup(); });

describe("ValidatePage", () => {
  it("shows start validation button when job exists", async () => {
    render(<AppProvider><ValidatePage language="zh_cn" onConfirm={() => {}} /></AppProvider>);
    expect(await screen.findByText("开始校验")).toBeTruthy();
  });

  it("displays validation report with stats after clicking validate", async () => {
    render(<AppProvider><ValidatePage language="zh_cn" onConfirm={() => {}} /></AppProvider>);
    fireEvent.click(await screen.findByText("开始校验"));
    expect(await screen.findByText("通过")).toBeTruthy();
    expect(screen.getByText("JSON")).toBeTruthy();
    expect(screen.getByText("CSV")).toBeTruthy();
  });

  it("renders mod accordion group headers in report", async () => {
    render(<AppProvider><ValidatePage language="zh_cn" onConfirm={() => {}} /></AppProvider>);
    fireEvent.click(await screen.findByText("开始校验"));
    // Mod group headers render with mod names
    expect(await screen.findByText("badmod")).toBeTruthy();
    expect(screen.getByText("goodmod")).toBeTruthy();
  });
});

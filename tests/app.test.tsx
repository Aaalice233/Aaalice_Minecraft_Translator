import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { DashboardPage } from "../src/pages/DashboardPage";
import { SettingsPage } from "../src/pages/SettingsPage";
import type { Settings } from "../src/types";

const settings: Settings = {
  appLanguage: "zh_cn",
  sourceLanguage: "auto",
  targetLanguage: "zh_cn",
  instancePath: "E:/PCL2/.minecraft/versions/Aaalice Craft",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-flash",
  temperature: 0.3,
  maxTokens: 4096,
  concurrency: 6,
  batchSize: 80,
  batchMaxChars: 120000,
  timeoutSecs: 120,
  retryCount: 3,
  retryDelaySecs: 2,
  rateLimitRpm: 3000,
  reuseI18nPacks: true,
  reuseVmPacks: true,
  preferUserDictionary: true,
  keepExistingResourceTranslations: true,
  enableFtbQuests: false,
  resetMainLogOnStart: true,
  enableDebugLog: false,
  enableHttpLog: false,
  enableTokenStats: true,
};

afterEach(() => {
  cleanup();
});

describe("app shell", () => {
  it("renders dashboard navigation", async () => {
    render(<App />);

    expect(await screen.findByText("Aaalice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /总览/ })).toBeInTheDocument();
    expect(screen.getByText("第一阶段：扫描闭环")).toBeInTheDocument();
  });
});

describe("dashboard page", () => {
  it("renders scan controls and empty state", () => {
    render(
      <DashboardPage
        settings={settings}
        scanSummary={null}
        onSettingsChange={() => undefined}
        onScanSummaryChange={() => undefined}
        language="zh_cn"
      />,
    );

    expect(screen.getByText("项目扫描概览")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始扫描/ })).toBeInTheDocument();
    expect(screen.getByText("选择实例并开始扫描后显示结果。")).toBeInTheDocument();
  });
});

describe("settings page", () => {
  it("renders editable provider fields", () => {
    render(<SettingsPage settings={settings} onSettingsChange={() => undefined} />);

    expect(screen.getByText("设置中心")).toBeInTheDocument();
    expect(screen.getByLabelText("应用语言")).toHaveValue("zh_cn");
    expect(screen.getByLabelText("来源语言")).toHaveValue("auto");
    expect(screen.getByLabelText("目标语言")).toHaveValue("zh_cn");

    fireEvent.click(screen.getByRole("button", { name: /API 设置/ }));

    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByLabelText("Model")).toHaveValue("deepseek-v4-flash");
  });
});

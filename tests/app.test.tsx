import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { AppProvider } from "../src/app/AppContext";
import { DashboardPage } from "../src/pages/DashboardPage";
import { SettingsPage } from "../src/pages/SettingsPage";
import type { Settings } from "../src/types";

const settings: Settings = {
  appLanguage: "zh_cn",
  sourceLanguage: "auto",
  targetLanguage: "zh_cn",
  instancePath: "E:/PCL2/.minecraft/versions/Aaalice Craft",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-flash",
  temperature: 1.0,
  maxTokens: 0,
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
  resourcePackNames: [
    "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
    "VMTranslationPack-Converted-1.21.1.zip",
  ],
  systemPrompt: "",
  uiFont: "system",
  uiTheme: "default",
};

afterEach(() => {
  cleanup();
});

describe("app shell", () => {
  it("renders without crashing", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".app-shell")).toBeTruthy();
  });

  it("renders sidebar navigation", () => {
    render(<App />);
    expect(screen.getByText("扫描")).toBeTruthy();
  });

  it("renders settings page with tabs", () => {
    render(
      <AppProvider>
        <SettingsPage
          settings={settings}
          onSettingsChange={() => {}}
        />
      </AppProvider>,
    );
    expect(screen.getByText("API 设置")).toBeTruthy();
  });
});

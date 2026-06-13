import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { AppProvider } from "../src/app/AppContext";
import { DashboardPage } from "../src/pages/DashboardPage";
import { SettingsPage } from "../src/pages/SettingsPage";
import type { Settings } from "../src/types";

const apiMocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  scanInstance: vi.fn(),
  startTranslation: vi.fn(),
  retryFailedEntries: vi.fn(),
  loadLatestTranslationJobMeta: vi.fn(),
  markJobReviewed: vi.fn(),
  generatePackFromJob: vi.fn(),
  checkUpdate: vi.fn((): Promise<{ version: string; body?: string } | null> => Promise.resolve(null)),
  downloadAndInstallUpdate: vi.fn(() => Promise.resolve()),
  relaunchApp: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/api/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/tauri")>();
  return {
    ...actual,
    saveSettings: apiMocks.saveSettings,
    scanInstance: apiMocks.scanInstance,
    startTranslation: apiMocks.startTranslation,
    retryFailedEntries: apiMocks.retryFailedEntries,
    loadLatestTranslationJobMeta: apiMocks.loadLatestTranslationJobMeta,
    markJobReviewed: apiMocks.markJobReviewed,
    generatePackFromJob: apiMocks.generatePackFromJob,
    checkUpdate: apiMocks.checkUpdate,
    downloadAndInstallUpdate: apiMocks.downloadAndInstallUpdate,
    relaunchApp: apiMocks.relaunchApp,
  };
});

const settings: Settings = {
  appLanguage: "zh_cn",
  sourceLanguage: "auto",
  targetLanguage: "zh_cn",
  instancePath: "",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-flash",
  temperature: 1.0,
  maxTokens: 0,
  concurrency: 100,
  batchSize: 80,
  timeoutSecs: 180,
  retryCount: 5,
  autoRetryCount: 2,
  rateLimitRpm: 3000,
  preferUserDictionary: true,
  resetMainLogOnStart: true,
  enableDebugLog: false,
  enableHttpLog: false,
  resourcePackNames: [
    "Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
    "VMTranslationPack-Converted-1.21.1.zip",
  ],
  outputPackName: "Aaalice-MC-Translator-{{mc_version}}",
  systemPrompt: "",
  uiFont: "system",
  uiTheme: "default",
  uiDarkMode: false,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  apiMocks.checkUpdate.mockResolvedValue(null);
  apiMocks.downloadAndInstallUpdate.mockResolvedValue(undefined);
  apiMocks.relaunchApp.mockResolvedValue(undefined);
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

  it("shows about intro above update controls without an empty update progress bar", async () => {
    apiMocks.checkUpdate.mockResolvedValue({ version: "9.9.9", body: "test notes" });

    render(
      <AppProvider>
        <SettingsPage
          settings={settings}
          onSettingsChange={() => {}}
        />
      </AppProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "关于" }));

    expect(await screen.findByText("发现新版本 v9.9.9")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    const intro = screen.getByText(/Aaalice Minecraft Translator/);
    const checkButton = screen.getByRole("button", { name: "检查更新" });
    expect(Boolean(intro.compareDocumentPosition(checkButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("hands auto mode to the app shell after scanning", async () => {
    const scanSummary = {
      jobId: "scan_auto",
      instancePath: "E:/Instance",
      validation: {
        instancePath: "E:/Instance",
        isValid: true,
        modsPath: "E:/Instance/mods",
        resourcepacksPath: "E:/Instance/resourcepacks",
        warnings: [],
      },
      mods: [],
      resourcePacks: [],
      sourceLanguage: "auto",
      targetLanguage: "zh_cn",
      totalLanguageFiles: 0,
      totalSourceEntries: 0,
      totalTargetEntries: 0,
      totalPendingEntries: 1,
      resourcePackCoveredEntries: 0,
      actualPendingEntries: 1,
      dictionaryCacheHits: 0,
      dictionaryCacheTotal: 0,
      warnings: [],
      cancelled: false,
    };
    const onAutoScanComplete = vi.fn();

    apiMocks.saveSettings.mockResolvedValue(undefined);
    apiMocks.scanInstance.mockResolvedValue(scanSummary);

    render(
      <DashboardPage
        settings={{ ...settings, apiKey: "sk-test", instancePath: "E:/Instance" }}
        language="zh_cn"
        autoMode
        onAutoModeChange={() => {}}
        onAutoScanComplete={onAutoScanComplete}
      />,
    );

    fireEvent.click(screen.getByText("开始扫描"));

    await waitFor(() => {
      expect(onAutoScanComplete).toHaveBeenCalledWith(
        scanSummary,
        expect.objectContaining({ instancePath: "E:/Instance" }),
      );
    });
    expect(apiMocks.startTranslation).not.toHaveBeenCalled();
    expect(apiMocks.markJobReviewed).not.toHaveBeenCalled();
    expect(apiMocks.generatePackFromJob).not.toHaveBeenCalled();
  });
});

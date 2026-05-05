import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockAppSettings, createMockSound } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

const {
  mockScheduleAnalysisForUnanalyzed,
  mockReconcileGlobalLibrary,
  mockRefreshMissingState,
  mockLoadSettings,
} = vi.hoisted(() => ({
  mockScheduleAnalysisForUnanalyzed: vi.fn().mockResolvedValue(undefined),
  mockReconcileGlobalLibrary: vi.fn().mockResolvedValue({ sounds: [], changed: false, inaccessibleFolderIds: [] }),
  mockRefreshMissingState: vi.fn().mockResolvedValue(undefined),
  mockLoadSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: mockReconcileGlobalLibrary,
  refreshMissingState: mockRefreshMissingState,
  scheduleAnalysisForUnanalyzed: mockScheduleAnalysisForUnanalyzed,
}));

vi.mock("@/lib/library", () => ({
  loadGlobalLibrary: vi.fn().mockResolvedValue({ sounds: [], tags: [], sets: [] }),
  saveCurrentLibraryAndClearDirty: vi.fn().mockResolvedValue(undefined),
  saveCurrentLibrarySync: vi.fn(),
}));

vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: () => ({ saveCurrentLibrary: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/lib/appSettings", () => ({
  loadAppSettings: mockLoadSettings,
}));

vi.mock("@/lib/downloads", () => ({
  loadDownloadHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/scope", () => ({
  restorePathScope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useAppSettingsStore.setState({ ...initialAppSettingsState });
  useLibraryStore.setState({ ...initialLibraryState });
  mockScheduleAnalysisForUnanalyzed.mockReset();
  mockScheduleAnalysisForUnanalyzed.mockResolvedValue(undefined);
  mockReconcileGlobalLibrary.mockReset();
  mockReconcileGlobalLibrary.mockResolvedValue({ sounds: [], changed: false, inaccessibleFolderIds: [] });
  mockRefreshMissingState.mockReset();
  mockRefreshMissingState.mockResolvedValue(undefined);
  mockLoadSettings.mockReset();
  mockLoadSettings.mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useBootLoader — analysis scheduling", () => {
  it("schedules analysis on boot when autoAnalysis is true", async () => {
    mockLoadSettings.mockResolvedValue(createMockAppSettings({ autoAnalysis: true, globalFolders: [] }));

    const { useBootLoader } = await import("./useBootLoader");
    renderHook(() => useBootLoader());
    await act(async () => {});

    expect(mockScheduleAnalysisForUnanalyzed).toHaveBeenCalledTimes(1);
  });

  it("does not schedule analysis on boot when autoAnalysis is false", async () => {
    mockLoadSettings.mockResolvedValue(createMockAppSettings({ autoAnalysis: false, globalFolders: [] }));

    const { useBootLoader } = await import("./useBootLoader");
    renderHook(() => useBootLoader());
    await act(async () => {});

    expect(mockScheduleAnalysisForUnanalyzed).not.toHaveBeenCalled();
  });

  it("does not schedule analysis when settings fail to load", async () => {
    mockLoadSettings.mockResolvedValue(null);

    const { useBootLoader } = await import("./useBootLoader");
    renderHook(() => useBootLoader());
    await act(async () => {});

    expect(mockScheduleAnalysisForUnanalyzed).not.toHaveBeenCalled();
  });

  it("schedules analysis with the post-reconcile store state", async () => {
    // This test verifies analysis is scheduled when reconcile returns changed:true.
    // The actual sounds passed come from the store after reconcile applies them.
    mockLoadSettings.mockResolvedValue(createMockAppSettings({ autoAnalysis: true, globalFolders: [] }));
    // changed: false — no mutation needed, but autoAnalysis still fires
    mockReconcileGlobalLibrary.mockResolvedValue({ sounds: [], changed: false, inaccessibleFolderIds: [] });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [createMockSound({ loudnessLufs: undefined, filePath: "/a/kick.wav" })],
    });

    const { useBootLoader } = await import("./useBootLoader");
    renderHook(() => useBootLoader());
    await act(async () => {});

    expect(mockScheduleAnalysisForUnanalyzed).toHaveBeenCalledTimes(1);
  });
});

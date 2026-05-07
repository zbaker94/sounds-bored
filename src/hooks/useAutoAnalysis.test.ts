import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useAnalysisStore, initialAnalysisState } from "@/state/analysisStore";
import { createMockAppSettings } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockScheduleAnalysisForUnanalyzed = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/library.reconcile", () => ({
  scheduleAnalysisForUnanalyzed: mockScheduleAnalysisForUnanalyzed,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  useAppSettingsStore.setState({ ...initialAppSettingsState });
  useLibraryStore.setState({ ...initialLibraryState });
  useAnalysisStore.setState({ ...initialAnalysisState });
  mockScheduleAnalysisForUnanalyzed.mockReset();
  mockScheduleAnalysisForUnanalyzed.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useAutoAnalysis", () => {
  it("does not schedule analysis on first render (boot-time handled by useBootLoader)", async () => {
    const { useAutoAnalysis } = await import("./useAutoAnalysis");
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ autoAnalysis: true }),
    });

    renderHook(() => useAutoAnalysis());
    await act(async () => {});

    expect(mockScheduleAnalysisForUnanalyzed).not.toHaveBeenCalled();
  });

  it("schedules analysis when autoAnalysis toggles from false to true while not running", async () => {
    const { useAutoAnalysis } = await import("./useAutoAnalysis");
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ autoAnalysis: false }),
    });

    renderHook(() => useAutoAnalysis());
    await act(async () => {});

    // Toggle on
    act(() => {
      useAppSettingsStore.getState().setAutoAnalysis(true);
    });
    await act(async () => {});

    expect(mockScheduleAnalysisForUnanalyzed).toHaveBeenCalledTimes(1);
  });

  it("does not schedule analysis when toggled on but analysis is already running", async () => {
    const { useAutoAnalysis } = await import("./useAutoAnalysis");
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ autoAnalysis: false }),
    });
    useAnalysisStore.setState({ ...initialAnalysisState, status: "running" });

    renderHook(() => useAutoAnalysis());
    await act(async () => {});

    act(() => {
      useAppSettingsStore.getState().setAutoAnalysis(true);
    });
    await act(async () => {});

    expect(mockScheduleAnalysisForUnanalyzed).not.toHaveBeenCalled();
  });

  it("schedules analysis when toggled on after a prior analysis completed", async () => {
    const { useAutoAnalysis } = await import("./useAutoAnalysis");
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ autoAnalysis: false }),
    });
    useAnalysisStore.setState({ ...initialAnalysisState, status: "completed" });

    renderHook(() => useAutoAnalysis());
    await act(async () => {});

    act(() => {
      useAppSettingsStore.getState().setAutoAnalysis(true);
    });
    await act(async () => {});

    expect(mockScheduleAnalysisForUnanalyzed).toHaveBeenCalledTimes(1);
    expect(mockScheduleAnalysisForUnanalyzed).toHaveBeenCalledWith(expect.any(Array));
  });

  it("cancels the queue when autoAnalysis toggles from true to false", async () => {
    const { useAutoAnalysis } = await import("./useAutoAnalysis");
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ autoAnalysis: false }),
    });

    renderHook(() => useAutoAnalysis());
    await act(async () => {});

    // Toggle on to get past the first render
    act(() => { useAppSettingsStore.getState().setAutoAnalysis(true); });
    await act(async () => {});

    // Simulate analysis running
    useAnalysisStore.setState({ ...initialAnalysisState, status: "running" });
    const cancelSpy = vi.spyOn(useAnalysisStore.getState(), "cancelQueue");

    // Toggle off
    act(() => { useAppSettingsStore.getState().setAutoAnalysis(false); });
    await act(async () => {});

    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("cancels the queue when autoAnalysis toggles off while status is completed", async () => {
    const { useAutoAnalysis } = await import("./useAutoAnalysis");
    // Start with autoAnalysis already on so the first-render skip sets prevRef to true
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ autoAnalysis: true }),
    });
    useAnalysisStore.setState({ ...initialAnalysisState, status: "completed" });

    renderHook(() => useAutoAnalysis());
    await act(async () => {});

    const cancelSpy = vi.spyOn(useAnalysisStore.getState(), "cancelQueue");

    act(() => { useAppSettingsStore.getState().setAutoAnalysis(false); });
    await act(async () => {});

    expect(cancelSpy).toHaveBeenCalled();
    expect(mockScheduleAnalysisForUnanalyzed).not.toHaveBeenCalled();
  });
});

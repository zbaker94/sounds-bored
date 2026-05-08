import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnalysisStore, initialAnalysisState } from "@/state/analysisStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { mockEvent } from "@/test/tauri-mocks";
import { createMockSound } from "@/test/factories";
import { ANALYSIS_COMPLETE_EVENT, ANALYSIS_STARTED_EVENT } from "@/lib/constants";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockDispatchNextFromQueue = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/library.reconcile", () => ({
  dispatchNextFromQueue: mockDispatchNextFromQueue,
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

type EventHandler = (e: { payload: unknown }) => void;

function getHandler(event: string): EventHandler {
  const calls = mockEvent.listen.mock.calls as unknown as Array<[string, EventHandler]>;
  const call = calls.find(([name]) => name === event);
  if (!call) throw new Error(`listen handler for "${event}" not registered`);
  return call[1];
}

function emitComplete(payload: unknown) { getHandler(ANALYSIS_COMPLETE_EVENT)({ payload }); }
function emitStarted(payload: unknown) { getHandler(ANALYSIS_STARTED_EVENT)({ payload }); }

beforeEach(() => {
  useAnalysisStore.setState({ ...initialAnalysisState });
  useLibraryStore.setState({ ...initialLibraryState });
  mockDispatchNextFromQueue.mockReset();
  mockDispatchNextFromQueue.mockResolvedValue(undefined);
  mockEvent.listen.mockClear();
  mockEvent.listen.mockReturnValue(Promise.resolve(vi.fn()));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useAudioAnalysis", () => {
  it("registers listeners for started and complete events on mount", async () => {
    const { useAudioAnalysis } = await import("./useAudioAnalysis");
    renderHook(() => useAudioAnalysis());
    await act(async () => {});

    const registeredEvents = (mockEvent.listen.mock.calls as unknown as Array<[string, unknown]>).map(([e]) => e);
    expect(registeredEvents).toContain(ANALYSIS_STARTED_EVENT);
    expect(registeredEvents).toContain(ANALYSIS_COMPLETE_EVENT);
  });

  it("records started event into store", async () => {
    const { useAudioAnalysis } = await import("./useAudioAnalysis");
    useAnalysisStore.getState().startAnalysis([{ id: "s1", path: "/a.wav" }]);
    renderHook(() => useAudioAnalysis());
    await act(async () => {});

    act(() => emitStarted({ soundId: "s1" }));
    expect(useAnalysisStore.getState().currentSoundId).toBe("s1");
  });

  it("ignores a malformed started payload", async () => {
    const { useAudioAnalysis } = await import("./useAudioAnalysis");
    renderHook(() => useAudioAnalysis());
    await act(async () => {});

    act(() => emitStarted({ notASoundId: 42 }));
    expect(useAnalysisStore.getState().currentSoundId).toBeNull();
  });

  it("updates loudnessLufs on complete event", async () => {
    const sound = createMockSound({ id: "s1", filePath: "/a.wav" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });
    useAnalysisStore.getState().startAnalysis([{ id: "s1", path: "/a.wav" }]);

    const { useAudioAnalysis } = await import("./useAudioAnalysis");
    renderHook(() => useAudioAnalysis());
    await act(async () => {});

    act(() => emitComplete({ soundId: "s1", loudnessLufs: -18, error: null }));

    const updated = useLibraryStore.getState().sounds.find((s) => s.id === "s1");
    expect(updated?.loudnessLufs).toBe(-18);
    expect(useAnalysisStore.getState().completedCount).toBe(1);
  });

  it("records error and dispatches next when error is set", async () => {
    const { logError } = await import("@/lib/logger");
    useAnalysisStore.getState().startAnalysis([{ id: "s1", path: "/a.wav" }]);

    const { useAudioAnalysis } = await import("./useAudioAnalysis");
    renderHook(() => useAudioAnalysis());
    await act(async () => {});

    act(() => emitComplete({ soundId: "s1", loudnessLufs: null, error: "decode failed" }));

    expect(useAnalysisStore.getState().errors).toEqual({ s1: "decode failed" });
    expect(logError).toHaveBeenCalledWith("Audio analysis failed", expect.objectContaining({ soundId: "s1" }));
    expect(mockDispatchNextFromQueue).toHaveBeenCalled();
  });

  it("ignores a malformed complete payload", async () => {
    useAnalysisStore.getState().startAnalysis([{ id: "s1", path: "/a.wav" }]);

    const { useAudioAnalysis } = await import("./useAudioAnalysis");
    renderHook(() => useAudioAnalysis());
    await act(async () => {});

    act(() => emitComplete({ unexpected: true }));

    expect(useAnalysisStore.getState().completedCount).toBe(0);
    expect(mockDispatchNextFromQueue).not.toHaveBeenCalled();
  });

  it("calls dispatchNextFromQueue after each completed event", async () => {
    useAnalysisStore.getState().startAnalysis([{ id: "s1", path: "/a.wav" }]);

    const { useAudioAnalysis } = await import("./useAudioAnalysis");
    renderHook(() => useAudioAnalysis());
    await act(async () => {});

    act(() => emitComplete({ soundId: "s1", loudnessLufs: -14, error: null }));
    await act(async () => {});

    expect(mockDispatchNextFromQueue).toHaveBeenCalledTimes(1);
  });
});

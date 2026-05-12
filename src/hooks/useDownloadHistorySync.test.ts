import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDownloadHistorySync } from "./useDownloadHistorySync";
import { useDownloadStore } from "@/state/downloadStore";
import { saveDownloadHistory } from "@/lib/downloads";
import type { DownloadJob } from "@/lib/schemas";

vi.mock("@/lib/downloads", () => ({
  saveDownloadHistory: vi.fn().mockResolvedValue(undefined),
  loadDownloadHistory: vi.fn().mockResolvedValue([]),
}));

const saveMock = vi.mocked(saveDownloadHistory);

// Flush the promise queue used by the hook to serialize saves.
// setTimeout(0) drains ALL pending microtasks before resolving, which is required
// because the hook chains saves through a promise queue.
const flushSaveQueue = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "job-1",
    url: "https://example.com/audio",
    outputName: "My Track",
    status: "queued",
    percent: 0,
    tags: [],
    sets: [],
    ...overrides,
  };
}

describe("useDownloadHistorySync", () => {
  beforeEach(() => {
    useDownloadStore.setState({ jobs: {} });
    vi.clearAllMocks();
  });

  it("does NOT save on progress-only (non-terminal) updates", async () => {
    renderHook(() => useDownloadHistorySync());

    act(() => {
      useDownloadStore.getState().addJob(makeJob({ status: "downloading", percent: 50 }));
    });
    await flushSaveQueue();

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("does NOT save when a queued job is added", async () => {
    renderHook(() => useDownloadHistorySync());

    act(() => {
      useDownloadStore.getState().addJob(makeJob());
    });
    await flushSaveQueue();

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("saves when a job reaches completed status", async () => {
    renderHook(() => useDownloadHistorySync());

    act(() => {
      useDownloadStore.getState().addJob(makeJob());
    });
    act(() => {
      useDownloadStore.getState().updateJob("job-1", { status: "completed", percent: 100, outputPath: "C:/sounds/file.mp3" });
    });
    await flushSaveQueue();

    expect(saveMock).toHaveBeenCalledOnce();
    expect(saveMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "job-1", status: "completed" })]),
    );
  });

  it("saves when a job reaches failed status", async () => {
    renderHook(() => useDownloadHistorySync());

    act(() => {
      useDownloadStore.getState().addJob(makeJob());
      useDownloadStore.getState().updateJob("job-1", { status: "failed", error: "Network error" });
    });
    await flushSaveQueue();

    expect(saveMock).toHaveBeenCalledOnce();
  });

  it("saves when a job reaches cancelled status", async () => {
    renderHook(() => useDownloadHistorySync());

    act(() => {
      useDownloadStore.getState().addJob(makeJob());
      useDownloadStore.getState().updateJob("job-1", { status: "cancelled" });
    });
    await flushSaveQueue();

    expect(saveMock).toHaveBeenCalledOnce();
  });

  it("does NOT save again when a progress update arrives after a terminal job exists", async () => {
    renderHook(() => useDownloadHistorySync());

    act(() => {
      useDownloadStore.getState().addJob(makeJob({ id: "job-1" }));
      useDownloadStore.getState().addJob(makeJob({ id: "job-2" }));
      useDownloadStore.getState().updateJob("job-1", { status: "completed", percent: 100, outputPath: "C:/sounds/file.mp3" });
    });
    await flushSaveQueue();

    act(() => {
      useDownloadStore.getState().updateJob("job-2", { status: "downloading", percent: 60 });
    });
    await flushSaveQueue();

    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("saves again when a second job reaches terminal status — call includes both jobs", async () => {
    renderHook(() => useDownloadHistorySync());

    act(() => {
      useDownloadStore.getState().addJob(makeJob({ id: "job-1" }));
      useDownloadStore.getState().addJob(makeJob({ id: "job-2" }));
      useDownloadStore.getState().updateJob("job-1", { status: "completed", percent: 100, outputPath: "C:/sounds/file.mp3" });
    });
    await flushSaveQueue();

    act(() => {
      useDownloadStore.getState().updateJob("job-2", { status: "failed", error: "Timeout" });
    });
    await flushSaveQueue();

    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "job-1", status: "completed" }),
        expect.objectContaining({ id: "job-2", status: "failed" }),
      ]),
    );
  });

  it("saves terminal jobs already in store on mount", async () => {
    useDownloadStore.setState({
      jobs: {
        "job-1": makeJob({ id: "job-1", status: "completed", percent: 100, outputPath: "C:/sounds/file.mp3" }),
      },
    });

    renderHook(() => useDownloadHistorySync());
    await flushSaveQueue();

    expect(saveMock).toHaveBeenCalledOnce();
    expect(saveMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "job-1", status: "completed" })]),
    );
  });

  it("does NOT save again via subscription when initial terminal jobs are unchanged", async () => {
    useDownloadStore.setState({
      jobs: {
        "job-1": makeJob({ id: "job-1", status: "completed", percent: 100, outputPath: "C:/sounds/file.mp3" }),
      },
    });

    renderHook(() => useDownloadHistorySync());
    await flushSaveQueue();

    const callsAfterMount = saveMock.mock.calls.length;

    act(() => {
      useDownloadStore.getState().addJob(makeJob({ id: "job-2", status: "downloading", percent: 30 }));
    });
    await flushSaveQueue();

    expect(saveMock.mock.calls.length).toBe(callsAfterMount);
  });

  it("unsubscribes on unmount — no save after unmount", async () => {
    const { unmount } = renderHook(() => useDownloadHistorySync());
    unmount();

    act(() => {
      useDownloadStore.getState().addJob(makeJob());
      useDownloadStore.getState().updateJob("job-1", { status: "completed", percent: 100, outputPath: "C:/sounds/file.mp3" });
    });
    await flushSaveQueue();

    expect(saveMock).not.toHaveBeenCalled();
  });
});

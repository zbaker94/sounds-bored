import { renderHook, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useDownloadEventListener } from "@/hooks/useDownloadEventListener";
import type { DownloadJob, DownloadProgressEvent } from "@/lib/schemas";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const {
  mockListenToDownloadEvents,
  mockUpdateJob,
  mockUpdateLibrary,
  mockJobs,
} = vi.hoisted(() => ({
  mockListenToDownloadEvents: vi.fn(),
  mockUpdateJob: vi.fn(),
  mockUpdateLibrary: vi.fn(),
  mockJobs: { current: {} as Record<string, DownloadJob> },
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/ytdlp", () => ({
  startDownload: vi.fn(),
  cancelDownload: vi.fn(),
  listenToDownloadEvents: mockListenToDownloadEvents,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
}));

vi.mock("@/state/downloadStore", () => ({
  useDownloadStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        jobs: mockJobs.current,
        addJob: vi.fn(),
        updateJob: mockUpdateJob,
        removeJob: vi.fn(),
        setDownloadFolderId: vi.fn(),
        downloadFolderId: null,
      }),
    ),
    {
      getState: vi.fn(() => ({
        jobs: mockJobs.current,
        addJob: vi.fn(),
        updateJob: mockUpdateJob,
        removeJob: vi.fn(),
        downloadFolderId: null,
      })),
    },
  ),
}));

vi.mock("@/state/libraryStore", () => ({
  useLibraryStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        sounds: [],
        tags: [],
        sets: [],
        isDirty: false,
        updateLibrary: mockUpdateLibrary,
      }),
    ),
    {
      getState: vi.fn(() => ({
        sounds: [],
        tags: [],
        sets: [],
        isDirty: false,
        updateLibrary: mockUpdateLibrary,
      })),
    },
  ),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useDownloadEventListener — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobs.current = {};
    // Default: listenToDownloadEvents resolves (returns unlisten fn)
    mockListenToDownloadEvents.mockResolvedValue(() => {});
  });

  it("shows a toast error when listenToDownloadEvents rejects with an Error", async () => {
    const { toast } = await import("sonner");
    mockListenToDownloadEvents.mockRejectedValue(new Error("Tauri listen failed"));

    renderHook(() => useDownloadEventListener());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to start download listener",
        { description: "Tauri listen failed" },
      ),
    );
  });

  it("shows a toast error when listenToDownloadEvents rejects with a non-Error value", async () => {
    const { toast } = await import("sonner");
    mockListenToDownloadEvents.mockRejectedValue("network timeout");

    renderHook(() => useDownloadEventListener());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to start download listener",
        { description: "network timeout" },
      ),
    );
  });

  it("does not throw when listenToDownloadEvents resolves normally", async () => {
    const unlisten = vi.fn();
    mockListenToDownloadEvents.mockResolvedValue(unlisten);

    expect(() => renderHook(() => useDownloadEventListener())).not.toThrow();
  });
});

describe("useDownloadEventListener — sound creation with tags/sets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobs.current = {};
    mockListenToDownloadEvents.mockResolvedValue(() => {});
  });

  function emitEvent(event: DownloadProgressEvent) {
    const callback = mockListenToDownloadEvents.mock.calls[0][0] as (
      e: DownloadProgressEvent,
    ) => void;
    callback(event);
  }

  it("creates a Sound with the job's tags and sets when download completes", async () => {
    mockJobs.current = {
      "job-with-tags": {
        id: "job-with-tags",
        url: "https://example.com/video",
        outputName: "cool-clip",
        status: "downloading",
        percent: 50,
        tags: ["tag-a", "tag-b"],
        sets: ["set-x"],
      },
    };

    renderHook(() => useDownloadEventListener("folder-id"));
    await waitFor(() => expect(mockListenToDownloadEvents).toHaveBeenCalled());

    emitEvent({
      id: "job-with-tags",
      percent: 100,
      status: "completed",
      outputPath: "/downloads/cool-clip.mp3",
    });

    await waitFor(() => expect(mockUpdateLibrary).toHaveBeenCalledTimes(1));
    const updater = mockUpdateLibrary.mock.calls[0][0] as (
      draft: { sounds: Array<Record<string, unknown>> },
    ) => void;
    const draft = { sounds: [] as Array<Record<string, unknown>> };
    updater(draft);

    expect(draft.sounds).toHaveLength(1);
    expect(draft.sounds[0]).toMatchObject({
      name: "cool-clip",
      filePath: "/downloads/cool-clip.mp3",
      folderId: "folder-id",
      sourceUrl: "https://example.com/video",
      tags: ["tag-a", "tag-b"],
      sets: ["set-x"],
    });
  });

  it("creates a Sound with empty tags/sets when job has none (backward compat)", async () => {
    mockJobs.current = {
      "job-no-tags": {
        id: "job-no-tags",
        url: "https://example.com/other",
        outputName: "plain-clip",
        status: "downloading",
        percent: 50,
        tags: [],
        sets: [],
      },
    };

    renderHook(() => useDownloadEventListener("folder-id"));
    await waitFor(() => expect(mockListenToDownloadEvents).toHaveBeenCalled());

    emitEvent({
      id: "job-no-tags",
      percent: 100,
      status: "completed",
      outputPath: "/downloads/plain-clip.mp3",
    });

    await waitFor(() => expect(mockUpdateLibrary).toHaveBeenCalledTimes(1));
    const updater = mockUpdateLibrary.mock.calls[0][0] as (
      draft: { sounds: Array<Record<string, unknown>> },
    ) => void;
    const draft = { sounds: [] as Array<Record<string, unknown>> };
    updater(draft);

    expect(draft.sounds).toHaveLength(1);
    expect(draft.sounds[0]).toMatchObject({
      tags: [],
      sets: [],
    });
  });
});

describe("useDownloadEventListener — buildJobUpdate status variants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobs.current = {};
    mockListenToDownloadEvents.mockResolvedValue(() => {});
  });

  function emitEvent(event: DownloadProgressEvent) {
    const callback = mockListenToDownloadEvents.mock.calls[0][0] as (
      e: DownloadProgressEvent,
    ) => void;
    callback(event);
  }

  it("remaps completed-without-outputPath to failed and does not update library", async () => {
    renderHook(() => useDownloadEventListener());
    await waitFor(() => expect(mockListenToDownloadEvents).toHaveBeenCalled());

    emitEvent({ id: "job-1", percent: 100, status: "completed" });

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledTimes(1));
    expect(mockUpdateJob).toHaveBeenCalledWith("job-1", {
      status: "failed",
      error: "Download completed but no output path was reported",
    });
    expect(mockUpdateLibrary).not.toHaveBeenCalled();
  });

  it("maps failed event to { status: failed, error }", async () => {
    renderHook(() => useDownloadEventListener());
    await waitFor(() => expect(mockListenToDownloadEvents).toHaveBeenCalled());

    emitEvent({ id: "job-1", percent: 0, status: "failed", error: "network error" });

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith("job-1", {
      status: "failed",
      error: "network error",
    }));
  });

  it("maps cancelled event to { status: cancelled }", async () => {
    renderHook(() => useDownloadEventListener());
    await waitFor(() => expect(mockListenToDownloadEvents).toHaveBeenCalled());

    emitEvent({ id: "job-1", percent: 0, status: "cancelled" });

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith("job-1", { status: "cancelled" }));
  });

  it("maps downloading event with progress fields", async () => {
    renderHook(() => useDownloadEventListener());
    await waitFor(() => expect(mockListenToDownloadEvents).toHaveBeenCalled());

    emitEvent({ id: "job-1", percent: 42, status: "downloading", speed: "1MiB/s", eta: "10s" });

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith("job-1", {
      status: "downloading",
      percent: 42,
      speed: "1MiB/s",
      eta: "10s",
    }));
  });

  it("maps processing event with progress fields", async () => {
    renderHook(() => useDownloadEventListener());
    await waitFor(() => expect(mockListenToDownloadEvents).toHaveBeenCalled());

    emitEvent({ id: "job-1", percent: 80, status: "processing", speed: "500KiB/s", eta: "2s" });

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith("job-1", {
      status: "processing",
      percent: 80,
      speed: "500KiB/s",
      eta: "2s",
    }));
  });

  it("maps queued event to { status: queued }", async () => {
    renderHook(() => useDownloadEventListener());
    await waitFor(() => expect(mockListenToDownloadEvents).toHaveBeenCalled());

    emitEvent({ id: "job-1", percent: 0, status: "queued" });

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith("job-1", { status: "queued" }));
  });
});

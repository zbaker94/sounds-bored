import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useDownloadEventListener, useStartDownload } from "@/lib/ytdlp.queries";
import type { DownloadJob, DownloadProgressEvent } from "@/lib/schemas";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const {
  mockListenToDownloadEvents,
  mockStartDownload,
  mockAddJob,
  mockUpdateJob,
  mockUpdateLibrary,
  mockJobs,
} = vi.hoisted(() => ({
  mockListenToDownloadEvents: vi.fn(),
  mockStartDownload: vi.fn(),
  mockAddJob: vi.fn(),
  mockUpdateJob: vi.fn(),
  mockUpdateLibrary: vi.fn(),
  mockJobs: { current: {} as Record<string, DownloadJob> },
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/ytdlp", () => ({
  startDownload: mockStartDownload,
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
        addJob: mockAddJob,
        updateJob: mockUpdateJob,
        removeJob: vi.fn(),
        setDownloadFolderId: vi.fn(),
        downloadFolderId: null,
      }),
    ),
    {
      getState: vi.fn(() => ({
        jobs: mockJobs.current,
        addJob: mockAddJob,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

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

describe("useStartDownload — job creation with tags/sets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobs.current = {};
    mockStartDownload.mockResolvedValue(undefined);
  });

  it("creates a DownloadJob with tags and sets when provided", async () => {
    const { result } = renderHook(() => useStartDownload(), {
      wrapper: makeWrapper(),
    });

    result.current.mutate({
      url: "https://example.com/video",
      outputName: "clip",
      downloadFolderPath: "/downloads",
      jobId: "job-1",
      tags: ["tag-a", "tag-b"],
      sets: ["set-x"],
    });

    await waitFor(() => expect(mockAddJob).toHaveBeenCalledTimes(1));

    const job = mockAddJob.mock.calls[0][0] as DownloadJob;
    expect(job).toMatchObject({
      id: "job-1",
      url: "https://example.com/video",
      outputName: "clip",
      status: "queued",
      percent: 0,
      tags: ["tag-a", "tag-b"],
      sets: ["set-x"],
    });
  });

  it("defaults tags and sets to empty arrays when omitted", async () => {
    const { result } = renderHook(() => useStartDownload(), {
      wrapper: makeWrapper(),
    });

    result.current.mutate({
      url: "https://example.com/video",
      outputName: "clip",
      downloadFolderPath: "/downloads",
      jobId: "job-2",
    });

    await waitFor(() => expect(mockAddJob).toHaveBeenCalledTimes(1));

    const job = mockAddJob.mock.calls[0][0] as DownloadJob;
    expect(job.tags).toEqual([]);
    expect(job.sets).toEqual([]);
  });

  it("does not forward tags or sets to the yt-dlp sidecar", async () => {
    const { result } = renderHook(() => useStartDownload(), {
      wrapper: makeWrapper(),
    });

    result.current.mutate({
      url: "https://example.com/video",
      outputName: "clip",
      downloadFolderPath: "/downloads",
      jobId: "job-3",
      tags: ["tag-a"],
      sets: ["set-x"],
    });

    await waitFor(() => expect(mockStartDownload).toHaveBeenCalledTimes(1));
    expect(mockStartDownload).toHaveBeenCalledWith(
      "https://example.com/video",
      "clip",
      "/downloads",
      "job-3",
    );
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

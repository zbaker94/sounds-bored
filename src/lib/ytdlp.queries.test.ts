import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useStartDownload } from "@/lib/ytdlp.queries";
import type { DownloadJob } from "@/lib/schemas";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const {
  mockStartDownload,
  mockAddJob,
  mockUpdateJob,
  mockJobs,
} = vi.hoisted(() => ({
  mockStartDownload: vi.fn(),
  mockAddJob: vi.fn(),
  mockUpdateJob: vi.fn(),
  mockJobs: { current: {} as Record<string, DownloadJob> },
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/ytdlp", () => ({
  startDownload: mockStartDownload,
  cancelDownload: vi.fn(),
  listenToDownloadEvents: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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

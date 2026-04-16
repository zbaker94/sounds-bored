import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useDownloadEventListener } from "@/lib/ytdlp.queries";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const { mockListenToDownloadEvents } = vi.hoisted(() => ({
  mockListenToDownloadEvents: vi.fn(),
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
        jobs: {},
        addJob: vi.fn(),
        updateJob: vi.fn(),
        removeJob: vi.fn(),
        setDownloadFolderId: vi.fn(),
        downloadFolderId: null,
      }),
    ),
    {
      getState: vi.fn(() => ({
        jobs: {},
        addJob: vi.fn(),
        updateJob: vi.fn(),
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
        updateLibrary: vi.fn(),
      }),
    ),
    {
      getState: vi.fn(() => ({
        sounds: [],
        tags: [],
        sets: [],
        isDirty: false,
        updateLibrary: vi.fn(),
      })),
    },
  ),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useDownloadEventListener — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: listenToDownloadEvents resolves (returns unlisten fn)
    mockListenToDownloadEvents.mockResolvedValue(() => {});
  });

  it("shows a toast error when listenToDownloadEvents rejects with an Error", async () => {
    const { toast } = await import("sonner");
    mockListenToDownloadEvents.mockRejectedValue(new Error("Tauri listen failed"));

    renderHook(() => useDownloadEventListener());

    // Allow promise microtasks to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(toast.error).toHaveBeenCalledWith(
      "Failed to start download listener",
      { description: "Tauri listen failed" },
    );
  });

  it("shows a toast error when listenToDownloadEvents rejects with a non-Error value", async () => {
    const { toast } = await import("sonner");
    mockListenToDownloadEvents.mockRejectedValue("network timeout");

    renderHook(() => useDownloadEventListener());

    await Promise.resolve();
    await Promise.resolve();

    expect(toast.error).toHaveBeenCalledWith(
      "Failed to start download listener",
      { description: "network timeout" },
    );
  });

  it("does not throw when listenToDownloadEvents resolves normally", async () => {
    const unlisten = vi.fn();
    mockListenToDownloadEvents.mockResolvedValue(unlisten);

    expect(() => renderHook(() => useDownloadEventListener())).not.toThrow();
  });
});

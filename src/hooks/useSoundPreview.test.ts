import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createMockSound } from "@/test/factories";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPlayPreview = vi.fn();
const mockStopPreview = vi.fn();
vi.mock("@/lib/audio/preview", () => ({
  playPreview: mockPlayPreview,
  stopPreview: mockStopPreview,
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

const mockRefreshMissingState = vi.fn();
// MissingFileError must be the real class so instanceof checks work
class MissingFileError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "MissingFileError";
  }
}
vi.mock("@/lib/library.reconcile", () => ({
  MissingFileError,
  refreshMissingState: mockRefreshMissingState,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useSoundPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayPreview.mockResolvedValue(undefined);
    mockStopPreview.mockReturnValue(undefined);
    mockRefreshMissingState.mockResolvedValue(undefined);
  });

  it("starts preview and sets previewingId on togglePreview", async () => {
    const { useSoundPreview } = await import("./useSoundPreview");
    const sound = createMockSound({ id: "s1", filePath: "kick.wav" });
    const { result } = renderHook(() => useSoundPreview());

    await act(async () => {
      await result.current.togglePreview(sound);
    });

    expect(result.current.previewingId).toBe("s1");
    expect(mockPlayPreview).toHaveBeenCalledWith(sound, expect.any(Function));
  });

  it("stops preview and clears previewingId when toggling the active sound", async () => {
    const { useSoundPreview } = await import("./useSoundPreview");
    const sound = createMockSound({ id: "s1", filePath: "kick.wav" });
    const { result } = renderHook(() => useSoundPreview());

    await act(async () => { await result.current.togglePreview(sound); });
    await act(async () => { await result.current.togglePreview(sound); });

    expect(mockStopPreview).toHaveBeenCalled();
    expect(result.current.previewingId).toBeNull();
  });

  it("shows MissingFileError toast and refreshes missing state", async () => {
    const { useSoundPreview } = await import("./useSoundPreview");
    const sound = createMockSound({ id: "s1", filePath: "missing.wav" });
    mockPlayPreview.mockRejectedValue(new MissingFileError(`Sound "missing" has no file path`));
    const { result } = renderHook(() => useSoundPreview());

    await act(async () => { await result.current.togglePreview(sound); });

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockRefreshMissingState).toHaveBeenCalled();
    expect(result.current.previewingId).toBeNull();
  });

  it("shows generic toast and logs console.error for non-MissingFileError (#171)", async () => {
    const { useSoundPreview } = await import("./useSoundPreview");
    const sound = createMockSound({ id: "s1", filePath: "corrupt.wav" });
    const decodeError = new Error("Decode failed: unsupported codec");
    mockPlayPreview.mockRejectedValue(decodeError);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSoundPreview());

    await act(async () => { await result.current.togglePreview(sound); });

    expect(consoleSpy).toHaveBeenCalledWith("[useSoundPreview]", decodeError);
    expect(mockToastError).toHaveBeenCalledWith("Preview failed: Decode failed: unsupported codec");
    expect(result.current.previewingId).toBeNull();
    consoleSpy.mockRestore();
  });

  it("does NOT call refreshMissingState for non-MissingFileError", async () => {
    const { useSoundPreview } = await import("./useSoundPreview");
    const sound = createMockSound({ id: "s1", filePath: "corrupt.wav" });
    mockPlayPreview.mockRejectedValue(new Error("Network error"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSoundPreview());

    await act(async () => { await result.current.togglePreview(sound); });

    expect(mockRefreshMissingState).not.toHaveBeenCalled();
  });

  it("shows 'Unknown error' toast when a non-Error is thrown (#171)", async () => {
    const { useSoundPreview } = await import("./useSoundPreview");
    const sound = createMockSound({ id: "s1", filePath: "corrupt.wav" });
    mockPlayPreview.mockRejectedValue("string rejection");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSoundPreview());

    await act(async () => { await result.current.togglePreview(sound); });

    expect(mockToastError).toHaveBeenCalledWith("Preview failed: Unknown error");
  });

  it("does nothing when sound has no filePath", async () => {
    const { useSoundPreview } = await import("./useSoundPreview");
    const sound = createMockSound({ id: "s1", filePath: undefined });
    const { result } = renderHook(() => useSoundPreview());

    await act(async () => { await result.current.togglePreview(sound); });

    expect(mockPlayPreview).not.toHaveBeenCalled();
    expect(result.current.previewingId).toBeNull();
  });
});

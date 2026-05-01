import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { emitAudioError, setAudioErrorHandler } from "@/lib/audio";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockToastError, mockRefreshMissingState } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockRefreshMissingState: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

vi.mock("@/lib/library.reconcile", () => ({
  refreshMissingState: mockRefreshMissingState,
  MissingFileError: class MissingFileError extends Error {},
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

// Import after mocks are set up
const { useAudioErrorHandler } = await import("./useAudioErrorHandler");

describe("useAudioErrorHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: scan resolves successfully
    mockRefreshMissingState.mockResolvedValue(undefined);
    // Reset to a no-op between tests so each renderHook starts with a clean slate
    setAudioErrorHandler(() => {});
  });

  it("registers the audio error handler on mount", () => {
    renderHook(() => useAudioErrorHandler());
    // Emitting an error should show a toast, proving the handler was registered
    emitAudioError(new Error("test"), { soundName: "test.wav" });
    expect(mockToastError).toHaveBeenCalledOnce();
  });

  it("leaves the handler registered after unmount (audio engine emits outside React lifecycle)", () => {
    // The hook intentionally skips cleanup so Web Audio `onended` callbacks can
    // still report errors after the component unmounts.
    const { unmount } = renderHook(() => useAudioErrorHandler());
    unmount();
    emitAudioError(new Error("late error"), { soundName: "late.wav" });
    expect(mockToastError).toHaveBeenCalledOnce();
  });

  describe("isMissingFile errors", () => {
    it("shows a toast naming the missing sound file", () => {
      renderHook(() => useAudioErrorHandler());
      emitAudioError(new Error("not found"), { soundName: "kick.wav", isMissingFile: true });
      expect(mockToastError).toHaveBeenCalledWith(
        'Failed to play "kick.wav" — file not found. Check the Sounds panel.'
      );
    });

    it("shows a generic toast when no soundName is provided", () => {
      renderHook(() => useAudioErrorHandler());
      emitAudioError(new Error("not found"), { isMissingFile: true });
      expect(mockToastError).toHaveBeenCalledWith("Playback error: file not found.");
    });

    it("fires refreshMissingState as a background scan (fire-and-forget)", () => {
      renderHook(() => useAudioErrorHandler());
      emitAudioError(new Error("not found"), { soundName: "kick.wav", isMissingFile: true });
      // refreshMissingState must be called but we do not block on it
      expect(mockRefreshMissingState).toHaveBeenCalledOnce();
    });

    it("shows the toast immediately without waiting for the scan to finish", () => {
      // Make the scan never resolve so we can verify the toast still fires
      mockRefreshMissingState.mockReturnValue(new Promise(() => {}));
      renderHook(() => useAudioErrorHandler());
      emitAudioError(new Error("not found"), { soundName: "kick.wav", isMissingFile: true });
      // Toast fires synchronously before scan completes
      expect(mockToastError).toHaveBeenCalledOnce();
    });

    it("swallows scan errors silently — a failed refresh must not propagate", async () => {
      mockRefreshMissingState.mockRejectedValue(new Error("scan failed"));
      const unhandled: unknown[] = [];
      const listener = (e: PromiseRejectionEvent) => {
        unhandled.push(e.reason);
        e.preventDefault();
      };
      window.addEventListener("unhandledrejection", listener);
      try {
        renderHook(() => useAudioErrorHandler());
        emitAudioError(new Error("not found"), { soundName: "kick.wav", isMissingFile: true });
        // Two microtask ticks to let the rejection and its .catch handler both flush
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
        // Toast was still shown despite scan failure
        expect(mockToastError).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener("unhandledrejection", listener);
      }
    });
  });

  describe("generic (non-missing-file) errors", () => {
    it("shows the error message with sound name", () => {
      renderHook(() => useAudioErrorHandler());
      emitAudioError(new Error("decode failed"), { soundName: "ambience.mp3" });
      expect(mockToastError).toHaveBeenCalledWith(
        "Failed to play \"ambience.mp3\": decode failed"
      );
    });

    it("shows a generic playback error when no soundName is provided", () => {
      renderHook(() => useAudioErrorHandler());
      emitAudioError(new Error("gain node error"));
      expect(mockToastError).toHaveBeenCalledWith(
        "Playback error: gain node error"
      );
    });

    it("does NOT call refreshMissingState for non-missing-file errors", () => {
      renderHook(() => useAudioErrorHandler());
      emitAudioError(new Error("decode failed"), { soundName: "sound.wav", isMissingFile: false });
      expect(mockRefreshMissingState).not.toHaveBeenCalled();
    });

    it("stringifies non-Error thrown values", () => {
      renderHook(() => useAudioErrorHandler());
      emitAudioError("raw string error", { soundName: "sound.wav" });
      expect(mockToastError).toHaveBeenCalledWith(
        'Failed to play "sound.wav": raw string error'
      );
    });
  });
});

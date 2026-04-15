import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadBuffer, evictBuffer, clearAllBuffers } from "./bufferCache";
import { createMockSound } from "@/test/factories";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

const mockDecodeAudioData = vi.fn();
const mockCtx = { decodeAudioData: mockDecodeAudioData };

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBuffer(): AudioBuffer {
  return {} as AudioBuffer;
}

function okResponse(body: ArrayBuffer = new ArrayBuffer(8)): Response {
  return {
    ok: true,
    arrayBuffer: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("bufferCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllBuffers();
  });

  describe("loadBuffer", () => {
    it("fetches and decodes on first call", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      const buffer = makeBuffer();
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(buffer);

      const result = await loadBuffer(sound);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockDecodeAudioData).toHaveBeenCalledTimes(1);
      expect(result).toBe(buffer);
    });

    it("returns cached buffer without fetching on second call", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      const buffer = makeBuffer();
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(buffer);

      const first = await loadBuffer(sound);
      const second = await loadBuffer(sound);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it("throws MissingFileError when sound has no filePath", async () => {
      const sound = createMockSound({ filePath: undefined });

      await expect(loadBuffer(sound)).rejects.toThrow();
    });

    it("throws MissingFileError when fetch returns non-ok response", async () => {
      const sound = createMockSound({ filePath: "sounds/missing.wav" });
      mockFetch.mockResolvedValue({ ok: false, status: 404 } as Response);

      await expect(loadBuffer(sound)).rejects.toThrow();
    });

    it("throws MissingFileError when fetch throws (network error)", async () => {
      const sound = createMockSound({ filePath: "sounds/network-err.wav" });
      mockFetch.mockRejectedValue(new Error("network error"));

      await expect(loadBuffer(sound)).rejects.toThrow();
    });
  });

  describe("evictBuffer", () => {
    it("removes the entry so the next loadBuffer re-fetches", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      const buffer1 = makeBuffer();
      const buffer2 = makeBuffer();
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValueOnce(buffer1).mockResolvedValueOnce(buffer2);

      await loadBuffer(sound);
      evictBuffer(sound.id);
      const result = await loadBuffer(sound);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toBe(buffer2);
    });

    it("is a no-op for an unknown sound id", () => {
      expect(() => evictBuffer("not-in-cache")).not.toThrow();
    });
  });

  describe("clearAllBuffers", () => {
    it("removes all entries so subsequent loads re-fetch", async () => {
      const sound1 = createMockSound({ filePath: "sounds/kick.wav" });
      const sound2 = createMockSound({ filePath: "sounds/snare.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(makeBuffer());

      await loadBuffer(sound1);
      await loadBuffer(sound2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      clearAllBuffers();

      // After clearing, loading either sound must fetch again
      mockDecodeAudioData.mockResolvedValue(makeBuffer());
      await loadBuffer(sound1);
      await loadBuffer(sound2);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("is safe to call on an empty cache", () => {
      expect(() => clearAllBuffers()).not.toThrow();
    });

    it("is idempotent — calling twice does not throw", () => {
      expect(() => {
        clearAllBuffers();
        clearAllBuffers();
      }).not.toThrow();
    });
  });
});

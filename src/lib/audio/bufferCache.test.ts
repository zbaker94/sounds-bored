import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadBuffer,
  evictBuffer,
  clearAllBuffers,
  MissingFileError,
  BUFFER_CACHE_MAX_BYTES,
  _getCacheStats,
  _setMaxBytes,
} from "./bufferCache";
import { createMockSound } from "@/test/factories";

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

function makeBuffer(channels = 1, length = 1024): AudioBuffer {
  return { numberOfChannels: channels, length } as unknown as AudioBuffer;
}

// 1 channel × 1024 samples × 4 bytes (Float32) = 4096 bytes
const SMALL_BUFFER_BYTES = 1 * 1024 * 4;

function okResponse(body: ArrayBuffer = new ArrayBuffer(8)): Response {
  return {
    ok: true,
    arrayBuffer: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

async function expectMissingFileError(promise: Promise<unknown>, soundName: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(MissingFileError);
  await expect(promise).rejects.toThrow(soundName);
}

describe("bufferCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllBuffers();
    _setMaxBytes(BUFFER_CACHE_MAX_BYTES);
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

    it("de-duplicates concurrent loads of the same sound (single fetch, correct byte count)", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(makeBuffer());

      const [a, b] = await Promise.all([loadBuffer(sound), loadBuffer(sound)]);

      expect(a).toBe(b);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(_getCacheStats()).toEqual({ entries: 1, totalBytes: SMALL_BUFFER_BYTES });
    });

    it("throws MissingFileError when sound has no filePath", async () => {
      const sound = createMockSound({ filePath: undefined });
      await expectMissingFileError(loadBuffer(sound), sound.name);
    });

    it("throws MissingFileError when sound has an empty filePath", async () => {
      const sound = createMockSound({ filePath: "" });
      await expectMissingFileError(loadBuffer(sound), sound.name);
    });

    it("throws MissingFileError when fetch returns non-ok response", async () => {
      const sound = createMockSound({ filePath: "sounds/missing.wav" });
      mockFetch.mockResolvedValue({ ok: false, status: 404 } as Response);
      await expectMissingFileError(loadBuffer(sound), sound.name);
    });

    it("throws MissingFileError when fetch throws (network error)", async () => {
      const sound = createMockSound({ filePath: "sounds/network-err.wav" });
      mockFetch.mockRejectedValue(new Error("network error"));
      await expectMissingFileError(loadBuffer(sound), sound.name);
    });

    it("decode failure does not pollute cache or totalBytes", async () => {
      const sound = createMockSound({ filePath: "sounds/bad.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockRejectedValue(new Error("Unable to decode audio data"));

      await expect(loadBuffer(sound)).rejects.toThrow();
      expect(_getCacheStats()).toEqual({ entries: 0, totalBytes: 0 });
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

    it("is a no-op for an unknown sound id and does not corrupt totalBytes", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(makeBuffer());
      await loadBuffer(sound);
      const before = _getCacheStats().totalBytes;

      evictBuffer("not-in-cache");

      expect(_getCacheStats().totalBytes).toBe(before);
      expect(Number.isFinite(_getCacheStats().totalBytes)).toBe(true);
    });

    it("decrements totalBytes", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(makeBuffer());

      await loadBuffer(sound);
      expect(_getCacheStats().totalBytes).toBe(SMALL_BUFFER_BYTES);

      evictBuffer(sound.id);
      expect(_getCacheStats()).toEqual({ entries: 0, totalBytes: 0 });
    });

    it("double evictBuffer on same id does not drive totalBytes negative", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(makeBuffer());
      await loadBuffer(sound);

      evictBuffer(sound.id);
      evictBuffer(sound.id);

      expect(_getCacheStats().totalBytes).toBe(0);
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

    it("resets totalBytes to zero", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(makeBuffer());

      await loadBuffer(sound);
      expect(_getCacheStats().totalBytes).toBeGreaterThan(0);

      clearAllBuffers();
      expect(_getCacheStats()).toEqual({ entries: 0, totalBytes: 0 });
    });
  });

  describe("LRU eviction", () => {
    it("does not evict when totalBytes equals exactly maxBytes", async () => {
      _setMaxBytes(SMALL_BUFFER_BYTES * 2);
      const [s1, s2] = [
        createMockSound({ filePath: "sounds/a.wav" }),
        createMockSound({ filePath: "sounds/b.wav" }),
      ];
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData
        .mockResolvedValueOnce(makeBuffer())
        .mockResolvedValueOnce(makeBuffer());

      await loadBuffer(s1);
      await loadBuffer(s2);

      expect(_getCacheStats()).toEqual({
        entries: 2,
        totalBytes: SMALL_BUFFER_BYTES * 2,
      });
    });

    it("evicts the oldest entry when the byte cap is exceeded", async () => {
      _setMaxBytes(SMALL_BUFFER_BYTES * 2);
      const [s1, s2, s3] = [
        createMockSound({ filePath: "sounds/a.wav" }),
        createMockSound({ filePath: "sounds/b.wav" }),
        createMockSound({ filePath: "sounds/c.wav" }),
      ];
      const [b1, b2, b3] = [makeBuffer(), makeBuffer(), makeBuffer()];
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData
        .mockResolvedValueOnce(b1)
        .mockResolvedValueOnce(b2)
        .mockResolvedValueOnce(b3);

      await loadBuffer(s1);
      await loadBuffer(s2);
      await loadBuffer(s3); // s1 evicted (oldest)

      expect(_getCacheStats().entries).toBe(2);
      // s2 and s3 still cached — no re-fetch
      expect(await loadBuffer(s2)).toBe(b2);
      expect(await loadBuffer(s3)).toBe(b3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // s1 evicted — re-fetches
      mockDecodeAudioData.mockResolvedValueOnce(makeBuffer());
      await loadBuffer(s1);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("evicts multiple oldest entries when a large buffer requires it", async () => {
      _setMaxBytes(SMALL_BUFFER_BYTES * 3);
      const smalls = [1, 2, 3].map((i) =>
        createMockSound({ filePath: `sounds/${i}.wav` })
      );
      mockFetch.mockResolvedValue(okResponse());
      for (const s of smalls) {
        mockDecodeAudioData.mockResolvedValueOnce(makeBuffer());
        await loadBuffer(s);
      }
      expect(_getCacheStats().entries).toBe(3);

      // One buffer 3× size → must evict 2 small entries to stay ≤ cap
      const big = createMockSound({ filePath: "sounds/big.wav" });
      mockDecodeAudioData.mockResolvedValueOnce(makeBuffer(1, 1024 * 3));
      await loadBuffer(big);

      // big (3×) + one small (1×) = 4× > 3× cap → only big stays after cascading evictions
      // Actually: after adding big: totalBytes = 3+3 = 6 units > 3 cap, so evict until ≤3
      // Evict s1 → 5 > 3, evict s2 → 4 > 3, evict s3 → 3 = cap (stop). Only big remains.
      expect(_getCacheStats().entries).toBe(1);
      expect(_getCacheStats().totalBytes).toBe(SMALL_BUFFER_BYTES * 3);
    });

    it("promotes an accessed buffer to MRU, saving it from eviction", async () => {
      _setMaxBytes(SMALL_BUFFER_BYTES * 2);
      const [s1, s2, s3] = [
        createMockSound({ filePath: "sounds/a.wav" }),
        createMockSound({ filePath: "sounds/b.wav" }),
        createMockSound({ filePath: "sounds/c.wav" }),
      ];
      const [b1, b2, b3] = [makeBuffer(), makeBuffer(), makeBuffer()];
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData
        .mockResolvedValueOnce(b1)
        .mockResolvedValueOnce(b2)
        .mockResolvedValueOnce(b3);

      await loadBuffer(s1); // s1 oldest
      await loadBuffer(s2); // s2 second
      const hit = await loadBuffer(s1); // promote s1 to MRU; s2 is now LRU
      expect(hit).toBe(b1);
      expect(mockFetch).toHaveBeenCalledTimes(2); // no re-fetch for cache hit

      await loadBuffer(s3); // s2 evicted (LRU), not s1

      expect(_getCacheStats().entries).toBe(2);
      // s1 still cached — no re-fetch
      expect(await loadBuffer(s1)).toBe(b1);
      expect(mockFetch).toHaveBeenCalledTimes(3); // a, b, c only
      // s2 evicted — re-fetches
      mockDecodeAudioData.mockResolvedValueOnce(makeBuffer());
      await loadBuffer(s2);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("tracks decoded byte size per entry", async () => {
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(makeBuffer(2, 2048)); // 2 × 2048 × 4 = 16384

      await loadBuffer(sound);

      expect(_getCacheStats()).toEqual({ entries: 1, totalBytes: 16384 });
    });

    it("does not evict the sole entry even if it exceeds the cap", async () => {
      _setMaxBytes(10); // smaller than any real buffer
      const sound = createMockSound({ filePath: "sounds/kick.wav" });
      mockFetch.mockResolvedValue(okResponse());
      mockDecodeAudioData.mockResolvedValue(makeBuffer());

      await loadBuffer(sound);

      expect(_getCacheStats().entries).toBe(1);
      // Still a cache hit — no re-fetch
      await loadBuffer(sound);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

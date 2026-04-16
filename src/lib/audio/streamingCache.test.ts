import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkIsLargeFile,
  evictSizeCache,
  clearAllSizeCache,
  LARGE_FILE_THRESHOLD_BYTES,
  preloadStreamingAudio,
  getOrCreateStreamingElement,
  evictStreamingElement,
  clearAllStreamingElements,
} from "./streamingCache";
import { createMockSound } from "@/test/factories";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Audio element mock for streaming element cache tests ──────────────────────

vi.stubGlobal("Audio", vi.fn().mockImplementation(function (this: any) {
  this.src = "";
  this.crossOrigin = "";
  this.preload = "";
  this.pause = vi.fn();
  this.load = vi.fn();
  this.currentTime = 0;
}));

function makeMockCtx() {
  return {
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
  };
}

function headResponse(contentLength: number | null) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length" && contentLength !== null
          ? String(contentLength)
          : null,
    },
  };
}

const SMALL = LARGE_FILE_THRESHOLD_BYTES - 1;
const LARGE = LARGE_FILE_THRESHOLD_BYTES;

describe("checkIsLargeFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllSizeCache();
  });

  it("returns false for a file below the threshold", async () => {
    mockFetch.mockResolvedValue(headResponse(SMALL));
    const sound = createMockSound({ filePath: "small.mp3" });
    expect(await checkIsLargeFile(sound)).toBe(false);
  });

  it("returns true for a file at the threshold", async () => {
    mockFetch.mockResolvedValue(headResponse(LARGE));
    const sound = createMockSound({ filePath: "big.wav" });
    expect(await checkIsLargeFile(sound)).toBe(true);
  });

  it("returns true for a file above the threshold", async () => {
    mockFetch.mockResolvedValue(headResponse(LARGE + 1024));
    const sound = createMockSound({ filePath: "huge.wav" });
    expect(await checkIsLargeFile(sound)).toBe(true);
  });

  it("returns false when Content-Length header is absent", async () => {
    mockFetch.mockResolvedValue(headResponse(null));
    const sound = createMockSound({ filePath: "unknown.mp3" });
    expect(await checkIsLargeFile(sound)).toBe(false);
  });

  it("returns false when fetch throws (missing file, network error, etc.)", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const sound = createMockSound({ filePath: "missing.mp3" });
    expect(await checkIsLargeFile(sound)).toBe(false);
  });

  it("caches the false result when fetch throws — does not re-fetch", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const sound = createMockSound({ filePath: "missing.mp3" });
    await checkIsLargeFile(sound);
    await checkIsLargeFile(sound);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns false without fetching when sound has no filePath", async () => {
    const sound = createMockSound({ filePath: undefined });
    expect(await checkIsLargeFile(sound)).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("caches the result — only one HEAD request per sound ID", async () => {
    mockFetch.mockResolvedValue(headResponse(SMALL));
    const sound = createMockSound({ filePath: "sound.mp3" });
    await checkIsLargeFile(sound);
    await checkIsLargeFile(sound);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses a HEAD request (not GET)", async () => {
    mockFetch.mockResolvedValue(headResponse(SMALL));
    const sound = createMockSound({ filePath: "sound.mp3" });
    await checkIsLargeFile(sound);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  describe("fileSizeBytes fast path", () => {
    it("returns true when fileSizeBytes is at threshold — no fetch", async () => {
      const sound = createMockSound({ filePath: "big.wav", fileSizeBytes: LARGE });
      expect(await checkIsLargeFile(sound)).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns true when fileSizeBytes is above threshold — no fetch", async () => {
      const sound = createMockSound({ filePath: "huge.wav", fileSizeBytes: LARGE + 1024 });
      expect(await checkIsLargeFile(sound)).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns false when fileSizeBytes is below threshold — no fetch", async () => {
      const sound = createMockSound({ filePath: "small.mp3", fileSizeBytes: SMALL });
      expect(await checkIsLargeFile(sound)).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("caches the fast-path result — second call also skips fetch", async () => {
      const sound = createMockSound({ filePath: "big.wav", fileSizeBytes: LARGE });
      await checkIsLargeFile(sound);
      await checkIsLargeFile(sound);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("falls back to HEAD request when fileSizeBytes is undefined", async () => {
      mockFetch.mockResolvedValue(headResponse(SMALL));
      const sound = createMockSound({ filePath: "unknown.mp3" });
      expect(await checkIsLargeFile(sound)).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("evictSizeCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllSizeCache();
  });

  it("forces a re-fetch after eviction", async () => {
    mockFetch.mockResolvedValue(headResponse(SMALL));
    const sound = createMockSound({ filePath: "sound.mp3" });
    await checkIsLargeFile(sound);
    evictSizeCache(sound.id);
    await checkIsLargeFile(sound);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── Streaming element cache ───────────────────────────────────────────────────

describe("preloadStreamingAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllStreamingElements();
  });

  it("creates an Audio element with preload=auto and sets src", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    preloadStreamingAudio(sound);
    const audio = (globalThis.Audio as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(audio.preload).toBe("auto");
    expect(audio.src).toBe("asset://localhost/big.wav");
  });

  it("is a no-op if the sound has no filePath", () => {
    const sound = createMockSound({ filePath: undefined });
    preloadStreamingAudio(sound);
    expect(globalThis.Audio).not.toHaveBeenCalled();
  });

  it("is a no-op for the same sound called twice — only one Audio element", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    preloadStreamingAudio(sound);
    preloadStreamingAudio(sound);
    expect(globalThis.Audio).toHaveBeenCalledTimes(1);
  });
});

describe("getOrCreateStreamingElement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllStreamingElements();
  });

  it("creates an Audio element and sourceNode on first call", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx = makeMockCtx();
    const { audio, sourceNode } = getOrCreateStreamingElement(sound, ctx as any);
    expect(audio).toBeDefined();
    expect(sourceNode).toBeDefined();
    expect(ctx.createMediaElementSource).toHaveBeenCalledOnce();
  });

  it("returns the cached element on subsequent calls — no new Audio or sourceNode", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx = makeMockCtx();
    const first = getOrCreateStreamingElement(sound, ctx as any);
    const second = getOrCreateStreamingElement(sound, ctx as any);
    expect(first.audio).toBe(second.audio);
    expect(first.sourceNode).toBe(second.sourceNode);
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it("reuses a pre-warmed element from preloadStreamingAudio — no extra Audio constructor call", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    preloadStreamingAudio(sound);
    const audioBeforeTrigger = (globalThis.Audio as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;

    const ctx = makeMockCtx();
    const { audio } = getOrCreateStreamingElement(sound, ctx as any);

    expect(audio).toBe(audioBeforeTrigger);
    expect(globalThis.Audio).toHaveBeenCalledTimes(1); // no extra Audio created
    expect(ctx.createMediaElementSource).toHaveBeenCalledOnce(); // sourceNode created lazily
  });

  it("sets crossOrigin=anonymous and preload=auto on the Audio element", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx = makeMockCtx();
    getOrCreateStreamingElement(sound, ctx as any);
    const audio = (globalThis.Audio as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(audio.crossOrigin).toBe("anonymous");
    expect(audio.preload).toBe("auto");
  });
});

describe("getOrCreateStreamingElement — stale context rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllStreamingElements();
  });

  it("creates a fresh Audio element and sourceNode when called with a different AudioContext", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx1 = makeMockCtx();
    const ctx2 = makeMockCtx();

    const first = getOrCreateStreamingElement(sound, ctx1 as any);

    // Simulate a context change (e.g. HMR module reload recreated the AudioContext).
    const second = getOrCreateStreamingElement(sound, ctx2 as any);

    // A fresh Audio element must be created for the new context.
    expect(second.audio).not.toBe(first.audio);
    // createMediaElementSource must be called on the new context, not the old one.
    expect(ctx2.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(ctx1.createMediaElementSource).toHaveBeenCalledTimes(1); // only the original call
  });

  it("preserves the audio src on the fresh element after a context change", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx1 = makeMockCtx();
    const ctx2 = makeMockCtx();

    getOrCreateStreamingElement(sound, ctx1 as any);
    const { audio: freshAudio } = getOrCreateStreamingElement(sound, ctx2 as any);

    expect(freshAudio.src).toBe("asset://localhost/big.wav");
  });

  it("pauses and clears the old Audio element during a context change rebuild", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx1 = makeMockCtx();
    const ctx2 = makeMockCtx();

    const { audio: oldAudio } = getOrCreateStreamingElement(sound, ctx1 as any);
    getOrCreateStreamingElement(sound, ctx2 as any);

    expect(oldAudio.pause).toHaveBeenCalledOnce();
    expect(oldAudio.src).toBe("");
  });

  it("returns the same element on repeated calls with the same context after a rebuild", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx1 = makeMockCtx();
    const ctx2 = makeMockCtx();

    getOrCreateStreamingElement(sound, ctx1 as any);
    const second = getOrCreateStreamingElement(sound, ctx2 as any);
    const third = getOrCreateStreamingElement(sound, ctx2 as any);

    expect(third.audio).toBe(second.audio);
    expect(third.sourceNode).toBe(second.sourceNode);
    expect(ctx2.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error when sound has no filePath", () => {
    // Expected: getOrCreateStreamingElement must throw rather than silently pass
    // undefined to convertFileSrc — the non-null assertion (!) was the bug.
    const sound = createMockSound({ filePath: undefined });
    const ctx = makeMockCtx();
    expect(() => getOrCreateStreamingElement(sound, ctx as any)).toThrow(
      /no filePath/,
    );
  });
});

describe("evictStreamingElement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllStreamingElements();
  });

  it("causes getOrCreateStreamingElement to create a fresh element after eviction", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx = makeMockCtx();
    const first = getOrCreateStreamingElement(sound, ctx as any);
    evictStreamingElement(sound.id);
    const second = getOrCreateStreamingElement(sound, ctx as any);
    expect(first.audio).not.toBe(second.audio);
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(2);
  });

  it("pauses and clears src on the evicted audio element", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx = makeMockCtx();
    const { audio } = getOrCreateStreamingElement(sound, ctx as any);
    evictStreamingElement(sound.id);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.src).toBe("");
  });

  it("is a no-op for an unknown sound ID", () => {
    expect(() => evictStreamingElement("nonexistent-id")).not.toThrow();
  });
});

describe("clearAllStreamingElements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllStreamingElements();
  });

  it("causes fresh elements to be created after clearing", () => {
    const sound = createMockSound({ filePath: "big.wav" });
    const ctx = makeMockCtx();
    const first = getOrCreateStreamingElement(sound, ctx as any);
    clearAllStreamingElements();
    const second = getOrCreateStreamingElement(sound, ctx as any);
    expect(first.audio).not.toBe(second.audio);
  });

  it("pauses all cached audio elements and clears their src", () => {
    const soundA = createMockSound({ filePath: "a.wav" });
    const soundB = createMockSound({ filePath: "b.wav" });
    const ctx = makeMockCtx();
    const { audio: audioA } = getOrCreateStreamingElement(soundA, ctx as any);
    const { audio: audioB } = getOrCreateStreamingElement(soundB, ctx as any);
    clearAllStreamingElements();
    expect(audioA.pause).toHaveBeenCalledOnce();
    expect(audioB.pause).toHaveBeenCalledOnce();
    expect(audioA.src).toBe("");
    expect(audioB.src).toBe("");
  });
});

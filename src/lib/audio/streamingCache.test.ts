import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkIsLargeFile, evictSizeCache, clearAllSizeCache, LARGE_FILE_THRESHOLD_BYTES } from "./streamingCache";
import { createMockSound } from "@/test/factories";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

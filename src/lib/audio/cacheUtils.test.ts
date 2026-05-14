import { describe, it, expect, vi, beforeEach } from "vitest";
import { evictSoundCaches, evictSoundCachesMany } from "./cacheUtils";

vi.mock("./bufferCache", () => ({ evictBuffer: vi.fn() }));
vi.mock("./streamingCache", () => ({
  evictStreamingElement: vi.fn(),
  evictSizeCache: vi.fn(),
}));

import { evictBuffer } from "./bufferCache";
import { evictStreamingElement, evictSizeCache } from "./streamingCache";

const mockEvictBuffer = evictBuffer as ReturnType<typeof vi.fn>;
const mockEvictStreamingElement = evictStreamingElement as ReturnType<typeof vi.fn>;
const mockEvictSizeCache = evictSizeCache as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("evictSoundCaches", () => {
  it("evicts buffer, streaming element, and size cache exactly once for given id", () => {
    evictSoundCaches("snd-1");
    expect(mockEvictBuffer).toHaveBeenCalledTimes(1);
    expect(mockEvictBuffer).toHaveBeenCalledWith("snd-1");
    expect(mockEvictStreamingElement).toHaveBeenCalledTimes(1);
    expect(mockEvictStreamingElement).toHaveBeenCalledWith("snd-1");
    expect(mockEvictSizeCache).toHaveBeenCalledTimes(1);
    expect(mockEvictSizeCache).toHaveBeenCalledWith("snd-1");
  });
});

describe("evictSoundCachesMany", () => {
  it("evicts all three caches for each id in an array, in order", () => {
    evictSoundCachesMany(["snd-1", "snd-2"]);
    expect(mockEvictBuffer.mock.calls).toEqual([["snd-1"], ["snd-2"]]);
    expect(mockEvictStreamingElement.mock.calls).toEqual([["snd-1"], ["snd-2"]]);
    expect(mockEvictSizeCache.mock.calls).toEqual([["snd-1"], ["snd-2"]]);
  });

  it("accepts a Set (any Iterable<string>)", () => {
    evictSoundCachesMany(new Set(["snd-1", "snd-2"]));
    expect(mockEvictBuffer).toHaveBeenCalledTimes(2);
    expect(mockEvictBuffer).toHaveBeenCalledWith("snd-1");
    expect(mockEvictBuffer).toHaveBeenCalledWith("snd-2");
    expect(mockEvictStreamingElement).toHaveBeenCalledTimes(2);
    expect(mockEvictStreamingElement).toHaveBeenCalledWith("snd-1");
    expect(mockEvictStreamingElement).toHaveBeenCalledWith("snd-2");
    expect(mockEvictSizeCache).toHaveBeenCalledTimes(2);
    expect(mockEvictSizeCache).toHaveBeenCalledWith("snd-1");
    expect(mockEvictSizeCache).toHaveBeenCalledWith("snd-2");
  });

  it.each([
    ["empty array", []],
    ["empty Set", new Set<string>()],
  ])("handles %s without calling any evictor", (_label, input) => {
    evictSoundCachesMany(input);
    expect(mockEvictBuffer).not.toHaveBeenCalled();
    expect(mockEvictStreamingElement).not.toHaveBeenCalled();
    expect(mockEvictSizeCache).not.toHaveBeenCalled();
  });
});

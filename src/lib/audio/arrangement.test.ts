import { describe, it, expect } from "vitest";
import { buildPlayOrder, isChained, shuffleArray } from "./arrangement";
import { createMockSound } from "@/test/factories";

describe("shuffleArray", () => {
  it("returns an array with the same elements", () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffleArray(arr);
    expect(result.sort()).toEqual([...arr].sort());
  });

  it("returns an array of the same length", () => {
    const arr = [1, 2, 3];
    expect(shuffleArray(arr)).toHaveLength(arr.length);
  });

  it("does not mutate the original array", () => {
    const arr = [1, 2, 3];
    shuffleArray(arr);
    expect(arr).toEqual([1, 2, 3]);
  });

  it("produces at least one non-identity ordering across 50 trials", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = Array.from({ length: 50 }, () => shuffleArray(arr));
    expect(results.some((r) => !r.every((v, i) => v === arr[i]))).toBe(true);
  });

  it("produces no duplicate elements", () => {
    const result = shuffleArray([1, 2, 3, 4, 5]);
    expect(new Set(result).size).toBe(result.length);
  });
});

describe("buildPlayOrder", () => {
  const sounds = [
    createMockSound({ filePath: "a.wav" }),
    createMockSound({ filePath: "b.wav" }),
    createMockSound({ filePath: "c.wav" }),
  ];

  it("simultaneous: returns all sounds", () => {
    const order = buildPlayOrder("simultaneous", sounds);
    expect(order).toHaveLength(3);
    expect(order.map((s) => s.id).sort()).toEqual(sounds.map((s) => s.id).sort());
  });

  it("sequential: returns sounds in their original order", () => {
    const order = buildPlayOrder("sequential", sounds);
    expect(order.map((s) => s.id)).toEqual(sounds.map((s) => s.id));
  });

  it("shuffled: returns all sounds (order may vary)", () => {
    const order = buildPlayOrder("shuffled", sounds);
    expect(order).toHaveLength(3);
    expect(order.map((s) => s.id).sort()).toEqual(sounds.map((s) => s.id).sort());
  });

  it("does not mutate the input array", () => {
    const ids = sounds.map((s) => s.id);
    buildPlayOrder("shuffled", sounds);
    expect(sounds.map((s) => s.id)).toEqual(ids);
  });
});

describe("isChained", () => {
  it("simultaneous is not chained", () => {
    expect(isChained("simultaneous")).toBe(false);
  });

  it("sequential is chained", () => {
    expect(isChained("sequential")).toBe(true);
  });

  it("shuffled is chained", () => {
    expect(isChained("shuffled")).toBe(true);
  });
});

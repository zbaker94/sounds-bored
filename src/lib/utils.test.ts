import { describe, it, expect } from "vitest";
import { truncatePath } from "./utils";

describe("truncatePath", () => {
  it("returns the path unchanged when it fits within maxLength", () => {
    expect(truncatePath("/short/path.wav", 40)).toBe("/short/path.wav");
  });

  it("truncates long paths with ellipsis before the filename", () => {
    const result = truncatePath("/very/long/directory/path/to/file.wav", 30);
    expect(result).toContain("file.wav");
    expect(result).toContain("…");
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it("preserves the filename when path is long", () => {
    const result = truncatePath("/a/b/c/d/e/f/g/h/my-sound.mp3", 25);
    expect(result.endsWith("my-sound.mp3")).toBe(true);
  });

  it("handles Windows backslash paths", () => {
    const result = truncatePath("C:\\Users\\Zack\\Music\\very\\long\\path\\sound.wav", 30);
    expect(result).toContain("sound.wav");
    expect(result).toContain("…");
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it("handles a filename that is itself longer than maxLength", () => {
    const result = truncatePath("/path/a-very-long-filename-that-exceeds-limit.wav", 20);
    expect(result).toContain("…");
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("uses the default maxLength of 40", () => {
    const short = "/short.wav";
    expect(truncatePath(short)).toBe(short);
    const long = "/very/long/path/that/definitely/exceeds/forty/chars/file.wav";
    expect(truncatePath(long).length).toBeLessThanOrEqual(40);
  });
});

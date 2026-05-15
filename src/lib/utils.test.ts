import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { truncatePath, detectIsMac, nameFromFilename, basename, recordsEqual } from "./utils";

describe("detectIsMac", () => {
  let originalUADataDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Capture descriptor so afterEach can restore it — vi.restoreAllMocks() does not
    // revert Object.defineProperty changes.
    originalUADataDescriptor = Object.getOwnPropertyDescriptor(navigator, "userAgentData");
  });

  afterEach(() => {
    if (originalUADataDescriptor) {
      Object.defineProperty(navigator, "userAgentData", originalUADataDescriptor);
    } else {
      // navigator.userAgentData was not present before the test; remove our definition.
      delete (navigator as Navigator & { userAgentData?: unknown }).userAgentData;
    }
    vi.restoreAllMocks();
  });

  it("returns true when userAgentData.platform is 'macOS' (Chromium Client Hints path)", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: { platform: "macOS" },
      configurable: true,
    });
    expect(detectIsMac()).toBe(true);
  });

  it("returns false when userAgentData.platform is 'Windows'", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: { platform: "Windows" },
      configurable: true,
    });
    expect(detectIsMac()).toBe(false);
  });

  it("returns false when userAgentData.platform is 'Linux'", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: { platform: "Linux" },
      configurable: true,
    });
    expect(detectIsMac()).toBe(false);
  });

  it("falls back to userAgent when userAgentData is undefined (WKWebView path)", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    );
    expect(detectIsMac()).toBe(true);
  });

  it("returns false for Windows userAgent when userAgentData is undefined", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );
    expect(detectIsMac()).toBe(false);
  });

  it("returns false for iPhone userAgent even though it contains 'Mac' (userAgent fallback)", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15"
    );
    expect(detectIsMac()).toBe(false);
  });

  it("returns false for iPad userAgent even though it contains 'Mac' (userAgent fallback)", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15"
    );
    expect(detectIsMac()).toBe(false);
  });

  it("returns false when userAgentData.platform is 'iOS' (Client Hints path — no iphone/ipad check needed)", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: { platform: "iOS" },
      configurable: true,
    });
    // "iOS" does not match /mac/i — no false-positive
    expect(detectIsMac()).toBe(false);
  });

  it("falls back to userAgent when userAgentData.platform is empty string (privacy-preserving hint)", () => {
    Object.defineProperty(navigator, "userAgentData", {
      value: { platform: "" },
      configurable: true,
    });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    );
    // Empty platform string is falsy → falls through to userAgent branch
    expect(detectIsMac()).toBe(true);
  });
});

describe("basename", () => {
  it("extracts the filename from a forward-slash path", () => {
    expect(basename("/foo/bar/baz.wav")).toBe("baz.wav");
  });

  it("extracts the filename from a Windows backslash path", () => {
    expect(basename("C:\\Users\\Zack\\Music\\kick.wav")).toBe("kick.wav");
  });

  it("handles a path with no separator (bare filename)", () => {
    expect(basename("kick.wav")).toBe("kick.wav");
  });

  it("ignores a trailing slash when extracting basename", () => {
    expect(basename("/foo/bar/")).toBe("bar");
  });

  it("returns the fallback when path is empty", () => {
    expect(basename("", "fallback")).toBe("fallback");
  });

  it("returns the default empty-string fallback when path is empty and no fallback is given", () => {
    expect(basename("")).toBe("");
  });

  it("handles mixed forward and backslash separators", () => {
    expect(basename("C:/Users\\Zack/sound.mp3")).toBe("sound.mp3");
  });
});

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

describe("recordsEqual", () => {
  const exact = (av: number, bv: number) => av === bv;

  it("returns true for two equal records", () => {
    expect(recordsEqual({ a: 1, b: 2 }, { a: 1, b: 2 }, exact)).toBe(true);
  });

  it("returns true for two empty records", () => {
    expect(recordsEqual({}, {}, exact)).toBe(true);
  });

  it("returns false when a has a key missing from b", () => {
    expect(recordsEqual({ a: 1, b: 2 }, { a: 1 }, exact)).toBe(false);
  });

  it("returns false when b has a key missing from a", () => {
    expect(recordsEqual({ a: 1 }, { a: 1, b: 2 }, exact)).toBe(false);
  });

  it("returns false when keys match but values differ", () => {
    expect(recordsEqual({ a: 1 }, { a: 2 }, exact)).toBe(false);
  });

  it("returns false when key counts match but keys differ", () => {
    expect(recordsEqual({ a: 1 }, { b: 1 }, exact)).toBe(false);
  });

  it("uses the eq comparator for value comparison", () => {
    const epsilonEq = (av: number, bv: number) => Math.abs(av - bv) <= 0.001;
    expect(recordsEqual({ x: 1.0 }, { x: 1.0005 }, epsilonEq)).toBe(true);
    expect(recordsEqual({ x: 1.0 }, { x: 1.002 }, epsilonEq)).toBe(false);
  });

  it("ignores inherited prototype properties on a", () => {
    const proto = { inherited: 99 };
    const a = Object.create(proto) as Record<string, number>;
    a['own'] = 1;
    const b = { own: 1 };
    expect(recordsEqual(a, b, exact)).toBe(true);
  });

  it("ignores inherited prototype properties on b", () => {
    const proto = { inherited: 99 };
    const a = { own: 1 };
    const b = Object.create(proto) as Record<string, number>;
    b['own'] = 1;
    expect(recordsEqual(a, b, exact)).toBe(true);
  });
});

describe("nameFromFilename", () => {
  it("strips extension, splits on hyphens and underscores, and title-cases", () => {
    expect(nameFromFilename("my-audio_bgm_whatever.wav")).toBe("My Audio Bgm Whatever");
  });

  it("handles a plain name with no extension", () => {
    expect(nameFromFilename("kick")).toBe("Kick");
  });

  it("handles a name with only an extension dot", () => {
    expect(nameFromFilename("snare.mp3")).toBe("Snare");
  });

  it("collapses multiple consecutive separators", () => {
    expect(nameFromFilename("hi--hat__open.wav")).toBe("Hi Hat Open");
  });

  it("lowercases the non-initial characters of each word", () => {
    expect(nameFromFilename("BIG_ROOM.wav")).toBe("Big Room");
  });

  it("treats a leading-dot filename as having no extension (dot at index 0 is not a separator)", () => {
    expect(nameFromFilename(".wav")).toBe(".wav");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { truncatePath, detectIsMac, nameFromFilename } from "./utils";

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

import { describe, it, expect } from "vitest";
import { shouldWarnBeforeAnalysis } from "./AnalysisWarningDialog";
import { createMockSound } from "@/test/factories";
import { ANALYSIS_LARGE_FILE_BYTES, ANALYSIS_LARGE_TOTAL_BYTES } from "@/lib/constants";

describe("shouldWarnBeforeAnalysis", () => {
  it("returns false for an empty list", () => {
    expect(shouldWarnBeforeAnalysis([])).toBe(false);
  });

  it("returns false for a single small unanalyzed sound", () => {
    const sounds = [createMockSound({ loudnessLufs: undefined, fileSizeBytes: 1_000_000 })];
    expect(shouldWarnBeforeAnalysis(sounds)).toBe(false);
  });

  it("returns true when any sound has already been analyzed", () => {
    const sounds = [
      createMockSound({ loudnessLufs: -14 }),
      createMockSound({ loudnessLufs: undefined }),
    ];
    expect(shouldWarnBeforeAnalysis(sounds)).toBe(true);
  });

  it("returns true when a single file exceeds ANALYSIS_LARGE_FILE_BYTES", () => {
    const sounds = [createMockSound({ loudnessLufs: undefined, fileSizeBytes: ANALYSIS_LARGE_FILE_BYTES })];
    expect(shouldWarnBeforeAnalysis(sounds)).toBe(true);
  });

  it("returns true when total size exceeds ANALYSIS_LARGE_TOTAL_BYTES", () => {
    const half = ANALYSIS_LARGE_TOTAL_BYTES / 2;
    const sounds = [
      createMockSound({ loudnessLufs: undefined, fileSizeBytes: half }),
      createMockSound({ loudnessLufs: undefined, fileSizeBytes: half }),
    ];
    expect(shouldWarnBeforeAnalysis(sounds)).toBe(true);
  });

  it("returns false when all sounds are small and unanalyzed", () => {
    const sounds = [
      createMockSound({ loudnessLufs: undefined, fileSizeBytes: 1_000_000 }),
      createMockSound({ loudnessLufs: undefined, fileSizeBytes: 2_000_000 }),
    ];
    expect(shouldWarnBeforeAnalysis(sounds)).toBe(false);
  });

  it("returns false when fileSizeBytes is missing and no sound is analyzed", () => {
    const sounds = [createMockSound({ loudnessLufs: undefined, fileSizeBytes: undefined })];
    expect(shouldWarnBeforeAnalysis(sounds)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { isFadeablePad } from "@/lib/padUtils";
import { createMockPad, createMockLayer } from "@/test/factories";

describe("isFadeablePad", () => {
  it("returns true for a pad with only one-shot layers", () => {
    const pad = createMockPad({
      layers: [createMockLayer({ playbackMode: "one-shot" })],
    });
    expect(isFadeablePad(pad)).toBe(true);
  });

  it("returns true for a pad with only loop layers", () => {
    const pad = createMockPad({
      layers: [createMockLayer({ playbackMode: "loop" })],
    });
    expect(isFadeablePad(pad)).toBe(true);
  });

  it("returns true for a pad with multiple non-hold layers", () => {
    const pad = createMockPad({
      layers: [
        createMockLayer({ playbackMode: "one-shot" }),
        createMockLayer({ playbackMode: "loop" }),
      ],
    });
    expect(isFadeablePad(pad)).toBe(true);
  });

  it("returns false for a pad with no layers", () => {
    const pad = createMockPad({ layers: [] });
    expect(isFadeablePad(pad)).toBe(false);
  });

  it("returns false for a pad with a single hold-mode layer", () => {
    const pad = createMockPad({
      layers: [createMockLayer({ playbackMode: "hold" })],
    });
    expect(isFadeablePad(pad)).toBe(false);
  });

  it("returns false for a mixed-mode pad with one hold layer", () => {
    const pad = createMockPad({
      layers: [
        createMockLayer({ playbackMode: "one-shot" }),
        createMockLayer({ playbackMode: "hold" }),
      ],
    });
    expect(isFadeablePad(pad)).toBe(false);
  });

  it("returns false for a pad where all layers are hold", () => {
    const pad = createMockPad({
      layers: [
        createMockLayer({ playbackMode: "hold" }),
        createMockLayer({ playbackMode: "hold" }),
      ],
    });
    expect(isFadeablePad(pad)).toBe(false);
  });
});

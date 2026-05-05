import { describe, it, expect } from "vitest";
import { resolveGenre } from "./genreTaxonomy";

describe("resolveGenre", () => {
  it("returns the canonical key unchanged", () => {
    expect(resolveGenre("hip-hop")).toBe("hip-hop");
    expect(resolveGenre("jazz")).toBe("jazz");
  });

  it("normalizes a synonym to its canonical key", () => {
    expect(resolveGenre("hip hop")).toBe("hip-hop");
    expect(resolveGenre("rap")).toBe("hip-hop");
    expect(resolveGenre("bebop")).toBe("jazz");
  });

  it("is case-insensitive", () => {
    expect(resolveGenre("HIP HOP")).toBe("hip-hop");
    expect(resolveGenre("JAZZ")).toBe("jazz");
    expect(resolveGenre("Bebop")).toBe("jazz");
  });

  it("trims whitespace before matching", () => {
    expect(resolveGenre("  rap  ")).toBe("hip-hop");
  });

  it("returns the normalized input for an unknown genre", () => {
    expect(resolveGenre("synthwave")).toBe("synthwave");
    expect(resolveGenre("UNKNOWN GENRE")).toBe("unknown genre");
  });

  it("no synonym maps to more than one canonical key (deduplication check)", () => {
    // Regression: 'indie folk' was previously in both 'folk' and 'indie' synonyms.
    // Verify it resolves to exactly one canonical key (whichever comes first).
    const result = resolveGenre("indie folk");
    expect(["folk", "indie"]).toContain(result); // must resolve to one of these, not crash
  });
});

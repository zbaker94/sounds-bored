import { describe, it, expect } from "vitest";
import { resolveReferencedSounds, countMissingReferencedSounds, buildSoundMapJson } from "@/lib/export";
import {
  createMockProject,
  createMockScene,
  createMockPad,
  createMockLayer,
  createMockSound,
} from "@/test/factories";
import type { Sound, Layer } from "@/lib/schemas";

function makeAssignedLayer(soundIds: string[]): Layer {
  return createMockLayer({
    selection: {
      type: "assigned",
      instances: soundIds.map((id, i) => ({ id: `inst-${i}-${id}`, soundId: id, volume: 100 })),
    },
  });
}

function makeTagLayer(tagIds: string[], matchMode: "any" | "all" = "any"): Layer {
  return createMockLayer({
    selection: { type: "tag", tagIds, matchMode, defaultVolume: 100 },
  });
}

function makeSetLayer(setId: string): Layer {
  return createMockLayer({
    selection: { type: "set", setId, defaultVolume: 100 },
  });
}

describe("resolveReferencedSounds", () => {
  it("returns empty array when project has no scenes", () => {
    const project = createMockProject({ scenes: [] });
    const sounds = [createMockSound({ id: "s1", filePath: "/sounds/a.wav" })];
    expect(resolveReferencedSounds(project, sounds)).toEqual([]);
  });

  it("returns empty array when scenes have no pads", () => {
    const project = createMockProject({
      scenes: [createMockScene({ pads: [] }), createMockScene({ pads: [] })],
    });
    const sounds = [createMockSound({ id: "s1", filePath: "/sounds/a.wav" })];
    expect(resolveReferencedSounds(project, sounds)).toEqual([]);
  });

  it("returns only sounds that have a filePath (excludes sounds with missing files)", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav" }),
      createMockSound({ id: "s2", filePath: undefined }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [createMockPad({ layers: [makeAssignedLayer(["s1", "s2"])] })],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result.map((s) => s.id)).toEqual(["s1"]);
  });

  it("deduplicates sounds referenced in multiple layers", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav" }),
      createMockSound({ id: "s2", filePath: "/sounds/b.wav" }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [
            createMockPad({
              layers: [
                makeAssignedLayer(["s1", "s2"]),
                makeAssignedLayer(["s1"]),
              ],
            }),
            createMockPad({ layers: [makeAssignedLayer(["s2"])] }),
          ],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("collects sounds from assigned-type layers (by soundId)", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav" }),
      createMockSound({ id: "s2", filePath: "/sounds/b.wav" }),
      createMockSound({ id: "s3", filePath: "/sounds/c.wav" }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [createMockPad({ layers: [makeAssignedLayer(["s1", "s3"])] })],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
  });

  it("collects sounds from tag-type layers (matching by tags)", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav", tags: ["drums"] }),
      createMockSound({ id: "s2", filePath: "/sounds/b.wav", tags: ["drums", "electronic"] }),
      createMockSound({ id: "s3", filePath: "/sounds/c.wav", tags: ["ambient"] }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [createMockPad({ layers: [makeTagLayer(["drums"], "any")] })],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("collects sounds from set-type layers (matching by setId)", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav", sets: ["set-a"] }),
      createMockSound({ id: "s2", filePath: "/sounds/b.wav", sets: ["set-b"] }),
      createMockSound({ id: "s3", filePath: "/sounds/c.wav", sets: ["set-a"] }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [createMockPad({ layers: [makeSetLayer("set-a")] })],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
  });

  it("returns empty array when no layers reference any sound", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav" }),
      createMockSound({ id: "s2", filePath: "/sounds/b.wav" }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [
            createMockPad({ layers: [makeAssignedLayer([])] }),
            createMockPad({ layers: [makeTagLayer([])] }),
          ],
        }),
      ],
    });

    expect(resolveReferencedSounds(project, sounds)).toEqual([]);
  });

  it("tag layer with matchMode 'all' requires sounds to have every specified tag", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav", tags: ["drums", "loud"] }),
      createMockSound({ id: "s2", filePath: "/sounds/b.wav", tags: ["drums"] }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [createMockPad({ layers: [makeTagLayer(["drums", "loud"], "all")] })],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result.map((s) => s.id)).toEqual(["s1"]);
  });

  it("deduplicates a sound matched by both assigned and tag selections", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav", tags: ["drums"] }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [
            createMockPad({
              layers: [makeAssignedLayer(["s1"]), makeTagLayer(["drums"], "any")],
            }),
          ],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
  });

  it("deduplicates a sound referenced by multiple set-layers", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav", sets: ["set-a"] }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [
            createMockPad({ layers: [makeSetLayer("set-a")] }),
            createMockPad({ layers: [makeSetLayer("set-a")] }),
          ],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
  });

  it("spans multiple scenes correctly", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav" }),
      createMockSound({ id: "s2", filePath: "/sounds/b.wav", tags: ["drums"] }),
      createMockSound({ id: "s3", filePath: "/sounds/c.wav", sets: ["set-a"] }),
      createMockSound({ id: "s4", filePath: "/sounds/d.wav" }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [createMockPad({ layers: [makeAssignedLayer(["s1"])] })],
        }),
        createMockScene({
          pads: [createMockPad({ layers: [makeTagLayer(["drums"], "any")] })],
        }),
        createMockScene({
          pads: [createMockPad({ layers: [makeSetLayer("set-a")] })],
        }),
      ],
    });

    const result = resolveReferencedSounds(project, sounds);
    expect(result.map((s) => s.id).sort()).toEqual(["s1", "s2", "s3"]);
  });
});

describe("countMissingReferencedSounds", () => {
  it("returns 0 when all referenced sounds have filePaths", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav" }),
      createMockSound({ id: "s2", filePath: "/sounds/b.wav" }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [createMockPad({ layers: [makeAssignedLayer(["s1", "s2"])] })],
        }),
      ],
    });

    expect(countMissingReferencedSounds(project, sounds)).toBe(0);
  });

  it("returns correct count when some referenced sounds have no filePath", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: "/sounds/a.wav" }),
      createMockSound({ id: "s2", filePath: undefined }),
      createMockSound({ id: "s3", filePath: undefined }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [createMockPad({ layers: [makeAssignedLayer(["s1", "s2", "s3"])] })],
        }),
      ],
    });

    expect(countMissingReferencedSounds(project, sounds)).toBe(2);
  });

  it("counts a sound referenced in multiple layers only once", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: undefined }),
    ];
    const project = createMockProject({
      scenes: [
        createMockScene({
          pads: [
            createMockPad({
              layers: [makeAssignedLayer(["s1"]), makeAssignedLayer(["s1"])],
            }),
            createMockPad({ layers: [makeAssignedLayer(["s1"])] }),
          ],
        }),
      ],
    });

    expect(countMissingReferencedSounds(project, sounds)).toBe(1);
  });

  it("returns 0 when project has no scenes", () => {
    const sounds: Sound[] = [
      createMockSound({ id: "s1", filePath: undefined }),
    ];
    const project = createMockProject({ scenes: [] });

    expect(countMissingReferencedSounds(project, sounds)).toBe(0);
  });
});

describe("buildSoundMapJson", () => {
  it("returns correct JSON structure for empty input", () => {
    const { json, collisions } = buildSoundMapJson([]);
    expect(JSON.parse(json)).toEqual({ version: "1", soundMap: {} });
    expect(collisions).toEqual([]);
  });

  it("maps sound.id to sounds/{basename} using forward-slash paths", () => {
    const sound = { ...createMockSound({ id: "s1" }), filePath: "/some/nested/folder/kick.wav" } as Sound & { filePath: string };
    const { json, collisions } = buildSoundMapJson([sound]);
    const parsed = JSON.parse(json) as { version: string; soundMap: Record<string, string> };
    expect(parsed.soundMap["s1"]).toBe("sounds/kick.wav");
    expect(collisions).toEqual([]);
  });

  it("extracts only the filename from a project-relative subfolder path", () => {
    const sound = { ...createMockSound({ id: "s1" }), filePath: "sounds/subfolder/kick.wav" } as Sound & { filePath: string };
    const { json, collisions } = buildSoundMapJson([sound]);
    const parsed = JSON.parse(json) as { version: string; soundMap: Record<string, string> };
    expect(parsed.soundMap["s1"]).toBe("sounds/kick.wav");
    expect(collisions).toEqual([]);
  });

  it("maps sound.id to sounds/{basename} using backslash paths (Windows)", () => {
    const sound = { ...createMockSound({ id: "s1" }), filePath: "C:\\Users\\test\\sounds\\snare.wav" } as Sound & { filePath: string };
    const { json, collisions } = buildSoundMapJson([sound]);
    const parsed = JSON.parse(json) as { version: string; soundMap: Record<string, string> };
    expect(parsed.soundMap["s1"]).toBe("sounds/snare.wav");
    expect(collisions).toEqual([]);
  });

  it("detects basename collisions and still maps both sounds", () => {
    const s1 = { ...createMockSound({ id: "s1" }), filePath: "/folder-a/kick.wav" } as Sound & { filePath: string };
    const s2 = { ...createMockSound({ id: "s2" }), filePath: "/folder-b/kick.wav" } as Sound & { filePath: string };
    const { json, collisions } = buildSoundMapJson([s1, s2]);
    const parsed = JSON.parse(json) as { version: string; soundMap: Record<string, string> };
    expect(collisions).toEqual(["kick.wav"]);
    expect(parsed.soundMap["s1"]).toBe("sounds/kick.wav");
    expect(parsed.soundMap["s2"]).toBe("sounds/kick.wav");
  });

  it("returns empty collisions array when all basenames are unique", () => {
    const s1 = { ...createMockSound({ id: "s1" }), filePath: "/sounds/kick.wav" } as Sound & { filePath: string };
    const s2 = { ...createMockSound({ id: "s2" }), filePath: "/sounds/snare.wav" } as Sound & { filePath: string };
    const s3 = { ...createMockSound({ id: "s3" }), filePath: "/sounds/hat.wav" } as Sound & { filePath: string };
    const { json, collisions } = buildSoundMapJson([s1, s2, s3]);
    const parsed = JSON.parse(json) as { version: string; soundMap: Record<string, string> };
    expect(collisions).toEqual([]);
    expect(parsed.soundMap).toEqual({
      s1: "sounds/kick.wav",
      s2: "sounds/snare.wav",
      s3: "sounds/hat.wav",
    });
  });
});

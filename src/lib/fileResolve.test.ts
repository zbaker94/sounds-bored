import { describe, it, expect } from "vitest";
import { classifyPickedAudioFile, findDuplicateByPath } from "./fileResolve";
import { createMockSound } from "@/test/factories";

// @tauri-apps/api/path is auto-mocked via src/test/tauri-mocks.ts (imported in setup).
// mockPath.basename performs real basename extraction synchronously; await resolves it.

describe("classifyPickedAudioFile", () => {
  it('returns "ok" when basenames match and no duplicate exists', async () => {
    const sound = createMockSound({ id: "s1", filePath: "/music/kick.wav" });
    const result = await classifyPickedAudioFile({
      pickedPath: "/new-location/kick.wav",
      existingSound: sound,
      allSounds: [sound],
    });
    expect(result).toEqual({ kind: "ok", newBasename: "kick.wav" });
  });

  it('returns "name-mismatch" when picked basename differs from stored basename', async () => {
    const sound = createMockSound({ id: "s1", filePath: "/music/kick.wav" });
    const result = await classifyPickedAudioFile({
      pickedPath: "/music/snare.wav",
      existingSound: sound,
      allSounds: [sound],
    });
    expect(result).toEqual({ kind: "name-mismatch", newBasename: "snare.wav" });
  });

  it('returns "duplicate" when another sound already references the picked path', async () => {
    const sound = createMockSound({ id: "s1", filePath: "/music/kick.wav" });
    const other = createMockSound({ id: "s2", filePath: "/music/kick.wav" });
    const result = await classifyPickedAudioFile({
      pickedPath: "/music/kick.wav",
      existingSound: sound,
      allSounds: [sound, other],
    });
    if (result.kind !== "duplicate") throw new Error("expected kind=duplicate");
    expect(result.newBasename).toBe("kick.wav");
    expect(result.duplicate).toBe(other);
  });

  it("does not count the existingSound itself as a duplicate", async () => {
    const sound = createMockSound({ id: "s1", filePath: "/music/kick.wav" });
    const result = await classifyPickedAudioFile({
      pickedPath: "/music/kick.wav",
      existingSound: sound,
      allSounds: [sound],
    });
    expect(result.kind).toBe("ok");
  });

  it('treats an existingSound with no filePath as empty oldBasename — returns "name-mismatch" for any non-empty pick', async () => {
    const sound = createMockSound({ id: "s1", filePath: undefined });
    const result = await classifyPickedAudioFile({
      pickedPath: "/music/kick.wav",
      existingSound: sound,
      allSounds: [sound],
    });
    expect(result.kind).toBe("name-mismatch");
    expect(result.newBasename).toBe("kick.wav");
  });
});

describe("findDuplicateByPath", () => {
  it("returns the sound whose filePath matches and is not excluded", () => {
    const a = createMockSound({ id: "a", filePath: "/music/kick.wav" });
    const b = createMockSound({ id: "b", filePath: "/music/kick.wav" });
    expect(findDuplicateByPath("/music/kick.wav", "a", [a, b])).toBe(b);
  });

  it("returns undefined when no other sound has that path", () => {
    const a = createMockSound({ id: "a", filePath: "/music/kick.wav" });
    expect(findDuplicateByPath("/music/snare.wav", "a", [a])).toBeUndefined();
  });

  it("excludes the sound with excludeId even when path matches", () => {
    const a = createMockSound({ id: "a", filePath: "/music/kick.wav" });
    expect(findDuplicateByPath("/music/kick.wav", "a", [a])).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { atomicWriteJson, atomicWriteText, loadJsonWithRecovery, sweepOrphanedTmpFiles } from "./fsUtils";
import { mockFs, createMockFileSystem } from "@/test/tauri-mocks";

describe("atomicWriteText", () => {
  beforeEach(() => {
    mockFs.writeTextFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.remove.mockResolvedValue(undefined);
  });

  it("writes text to a unique .tmp file then renames to the final path in that order", async () => {
    await atomicWriteText("/some/dir/file.json", "hello");

    const tmpPath = mockFs.writeTextFile.mock.calls[0][0] as string;
    expect(tmpPath).toMatch(/^\/some\/dir\/file\.json\.[0-9a-f-]{36}\.tmp$/);
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(tmpPath, "hello");
    expect(mockFs.rename).toHaveBeenCalledWith(tmpPath, "/some/dir/file.json");
    expect(mockFs.remove).not.toHaveBeenCalled();
    expect(mockFs.writeTextFile.mock.invocationCallOrder[0])
      .toBeLessThan(mockFs.rename.mock.invocationCallOrder[0]);
  });

  it("does not call rename if writeTextFile throws, and removes the .tmp file", async () => {
    const files = createMockFileSystem({});
    mockFs.writeTextFile.mockImplementation((path: string, content: string) => {
      files[path] = content;
      return Promise.reject(new Error("disk full"));
    });

    await expect(atomicWriteText("/dir/file.json", "x")).rejects.toThrow("disk full");
    expect(mockFs.rename).not.toHaveBeenCalled();
    const tmpFiles = Object.keys(files).filter((k) => k.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("attempts tmp cleanup and propagates rename errors", async () => {
    mockFs.rename.mockRejectedValue(new Error("EPERM"));

    await expect(atomicWriteText("/dir/file.json", "x")).rejects.toThrow("EPERM");
    const tmpPath = mockFs.writeTextFile.mock.calls[0][0] as string;
    expect(mockFs.remove).toHaveBeenCalledWith(tmpPath);
  });

  it("does not throw if cleanup remove fails after a write error", async () => {
    mockFs.writeTextFile.mockRejectedValue(new Error("disk full"));
    mockFs.remove.mockRejectedValue(new Error("ENOENT"));

    await expect(atomicWriteText("/dir/file.json", "x")).rejects.toThrow("disk full");
  });

  it("overwrites an existing target file", async () => {
    const files = createMockFileSystem({ "/dir/file.json": "old-content" });

    await atomicWriteText("/dir/file.json", "new-content");

    expect(files["/dir/file.json"]).toBe("new-content");
  });

  it("uses a unique tmp path for each concurrent write to the same file", async () => {
    const tmpPaths: string[] = [];
    const writeResolvers: Array<() => void> = [];

    // Stall both writes mid-writeTextFile so they're simultaneously in-flight
    mockFs.writeTextFile.mockImplementation((path: string) => {
      tmpPaths.push(path);
      return new Promise<void>((resolve) => writeResolvers.push(resolve));
    });
    mockFs.rename.mockResolvedValue(undefined);

    const writeA = atomicWriteText("/dir/file.json", "write-A");
    const writeB = atomicWriteText("/dir/file.json", "write-B");

    // Both writes are now stalled inside writeTextFile — genuinely simultaneous
    expect(tmpPaths).toHaveLength(2);
    expect(tmpPaths[0]).not.toBe(tmpPaths[1]);

    writeResolvers.forEach((r) => r());
    await Promise.all([writeA, writeB]);

    expect(mockFs.rename).toHaveBeenCalledTimes(2);
    const renamedFrom = new Set(mockFs.rename.mock.calls.map((c) => c[0] as string));
    expect(renamedFrom).toEqual(new Set(tmpPaths));
  });

  it("leaves the target file with one write's content intact after concurrent calls", async () => {
    const files = createMockFileSystem({});

    await Promise.all([
      atomicWriteText("/dir/file.json", "write-A"),
      atomicWriteText("/dir/file.json", "write-B"),
    ]);

    expect(files["/dir/file.json"]).toMatch(/^write-[AB]$/);
    const orphans = Object.keys(files).filter((k) => k.endsWith(".tmp"));
    expect(orphans).toHaveLength(0);
  });
});

describe("atomicWriteJson", () => {
  beforeEach(() => {
    mockFs.writeTextFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.remove.mockResolvedValue(undefined);
  });

  it("writes serialized JSON to a unique .tmp file then renames to the final path", async () => {
    const data = { foo: "bar", count: 42 };

    await atomicWriteJson("/some/dir/file.json", data);

    const tmpPath = mockFs.writeTextFile.mock.calls[0][0] as string;
    expect(tmpPath).toMatch(/^\/some\/dir\/file\.json\.[0-9a-f-]{36}\.tmp$/);
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(tmpPath, JSON.stringify(data, null, 2));
    expect(mockFs.rename).toHaveBeenCalledWith(tmpPath, "/some/dir/file.json");
  });

  it("serializes arrays correctly", async () => {
    await atomicWriteJson("/dir/list.json", [1, 2, 3]);

    const written = mockFs.writeTextFile.mock.calls[0][1] as string;
    expect(JSON.parse(written)).toEqual([1, 2, 3]);
  });

  it("serializes empty array as []", async () => {
    await atomicWriteJson("/dir/list.json", []);

    const written = mockFs.writeTextFile.mock.calls[0][1] as string;
    expect(written).toBe("[]");
  });
});

describe("loadJsonWithRecovery", () => {
  beforeEach(() => {
    mockFs.readTextFile.mockResolvedValue("[]");
    mockFs.writeTextFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.readDir.mockResolvedValue([]);
  });

  it("parses and returns the value from the file on success", async () => {
    mockFs.readTextFile.mockResolvedValue(JSON.stringify({ value: 42 }));

    const result = await loadJsonWithRecovery({
      path: "/dir/file.json",
      parse: (raw) => (raw as { value: number }).value,
      defaults: 0,
      corruptMessage: "file was corrupt",
    });

    expect(result).toBe(42);
    expect(mockFs.rename).not.toHaveBeenCalled();
  });

  it("recovers from SyntaxError — backs up, writes defaults, calls onCorruption, returns defaults", async () => {
    mockFs.readTextFile.mockResolvedValue("not valid { json");
    const onCorruption = vi.fn();

    const result = await loadJsonWithRecovery({
      path: "/dir/file.json",
      parse: (raw) => raw as string[],
      defaults: [],
      onCorruption,
      corruptMessage: "file was corrupt",
    });

    expect(result).toEqual([]);
    expect(mockFs.rename).toHaveBeenCalledWith("/dir/file.json", "/dir/file.corrupt.json");
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/dir\/file\.json\.[0-9a-f-]{36}\.tmp$/),
      "[]",
    );
    expect(onCorruption).toHaveBeenCalledWith("file was corrupt");
  });

  it("recovers from a parse() error (e.g. ZodError) — backs up, writes defaults, returns defaults", async () => {
    mockFs.readTextFile.mockResolvedValue(JSON.stringify({ unexpected: true }));
    const onCorruption = vi.fn();

    const result = await loadJsonWithRecovery({
      path: "/dir/file.json",
      parse: () => { throw new Error("validation failed"); },
      defaults: ["fallback"],
      onCorruption,
      corruptMessage: "schema mismatch",
    });

    expect(result).toEqual(["fallback"]);
    expect(mockFs.rename).toHaveBeenCalledWith("/dir/file.json", "/dir/file.corrupt.json");
    expect(onCorruption).toHaveBeenCalledWith("schema mismatch");
  });

  it("rethrows I/O errors from readTextFile without recovery", async () => {
    mockFs.readTextFile.mockRejectedValue(new Error("EPERM: permission denied"));

    await expect(
      loadJsonWithRecovery({
        path: "/dir/file.json",
        parse: (raw) => raw,
        defaults: null,
        corruptMessage: "corrupt",
      }),
    ).rejects.toThrow("EPERM: permission denied");

    expect(mockFs.rename).not.toHaveBeenCalled();
    expect(mockFs.writeTextFile).not.toHaveBeenCalled();
  });

  it("works without onCorruption callback — no crash on corrupt file", async () => {
    mockFs.readTextFile.mockResolvedValue("bad json {{");

    const result = await loadJsonWithRecovery({
      path: "/dir/file.json",
      parse: (raw) => raw as string[],
      defaults: [],
      corruptMessage: "file was corrupt",
    });

    expect(result).toEqual([]);
    expect(mockFs.writeTextFile).toHaveBeenCalled();
  });

  it("sweeps orphaned .tmp files before reading by default", async () => {
    const uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    mockFs.readDir.mockResolvedValue([{ name: `file.json.${uuid}.tmp` }]);

    await loadJsonWithRecovery({
      path: "/dir/file.json",
      parse: (raw) => raw as string[],
      defaults: [],
      corruptMessage: "corrupt",
    });

    expect(mockFs.readDir).toHaveBeenCalledWith("/dir");
    expect(mockFs.remove).toHaveBeenCalledWith(`/dir/file.json.${uuid}.tmp`);
    expect(mockFs.readDir.mock.invocationCallOrder[0])
      .toBeLessThan(mockFs.readTextFile.mock.invocationCallOrder[0]);
  });

  it("skips sweep when sweep: false but recovery still works", async () => {
    mockFs.readTextFile.mockResolvedValue("bad json {{");
    const onCorruption = vi.fn();

    const result = await loadJsonWithRecovery({
      path: "/dir/file.json",
      parse: (raw) => raw as string[],
      defaults: ["fallback"],
      onCorruption,
      corruptMessage: "corrupt",
      sweep: false,
    });

    expect(mockFs.readDir).not.toHaveBeenCalled();
    expect(result).toEqual(["fallback"]);
    expect(onCorruption).toHaveBeenCalledWith("corrupt");
  });

  it("proceeds with recovery even if the backup rename fails — writes defaults and calls onCorruption", async () => {
    mockFs.readTextFile.mockResolvedValue("bad json {{");
    // First rename (backup to .corrupt.json) fails; second rename (atomic write tmp→final) resolves
    mockFs.rename.mockRejectedValueOnce(new Error("EEXIST")).mockResolvedValue(undefined);
    const onCorruption = vi.fn();

    const result = await loadJsonWithRecovery({
      path: "/dir/file.json",
      parse: (raw) => raw as string[],
      defaults: [],
      onCorruption,
      corruptMessage: "file was corrupt",
    });

    expect(result).toEqual([]);
    expect(mockFs.writeTextFile).toHaveBeenCalled();
    expect(onCorruption).toHaveBeenCalledWith("file was corrupt");
  });

  it("writes defaults to disk on recovery so subsequent reads return a valid file", async () => {
    const files = createMockFileSystem({ "/dir/file.json": "garbage" });

    await loadJsonWithRecovery({
      path: "/dir/file.json",
      parse: (raw) => { if (!Array.isArray(raw)) throw new Error("not array"); return raw as number[]; },
      defaults: [1, 2, 3],
      corruptMessage: "corrupt",
    });

    const written = files["/dir/file.json"];
    expect(written).toBeDefined();
    expect(JSON.parse(written)).toEqual([1, 2, 3]);
  });
});

describe("sweepOrphanedTmpFiles", () => {
  const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

  beforeEach(() => {
    mockFs.readDir.mockReset();
    mockFs.remove.mockResolvedValue(undefined);
  });

  it("removes all orphaned <base>.<uuid>.tmp files in the directory", async () => {
    const uuid2 = "a4e8b2c1-9d3f-4a5b-8c7e-1f2e3d4c5b6a";
    mockFs.readDir.mockResolvedValue([
      { name: `file.json.${UUID}.tmp` },
      { name: `file.json.${uuid2}.tmp` },
      { name: "file.json" },
      { name: "other.txt" },
    ]);

    await sweepOrphanedTmpFiles("/some/dir/file.json");

    expect(mockFs.remove).toHaveBeenCalledTimes(2);
    expect(mockFs.remove).toHaveBeenCalledWith(`/some/dir/file.json.${UUID}.tmp`);
    expect(mockFs.remove).toHaveBeenCalledWith(`/some/dir/file.json.${uuid2}.tmp`);
  });

  it("does nothing when no orphans exist", async () => {
    mockFs.readDir.mockResolvedValue([{ name: "file.json" }, { name: "other.txt" }]);

    await sweepOrphanedTmpFiles("/some/dir/file.json");

    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it("does not remove files that do not match the base name prefix", async () => {
    mockFs.readDir.mockResolvedValue([
      { name: "file.json.bak" },
      { name: "unrelated.txt" },
      { name: `settings.json.${UUID}.tmp` },
    ]);

    await sweepOrphanedTmpFiles("/some/dir/file.json");

    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it("silently ignores remove errors for individual orphans", async () => {
    mockFs.readDir.mockResolvedValue([{ name: `file.json.${UUID}.tmp` }]);
    mockFs.remove.mockRejectedValue(new Error("ENOENT"));

    await expect(sweepOrphanedTmpFiles("/some/dir/file.json")).resolves.toBeUndefined();
  });

  it("does not remove a file matching the base prefix but without .tmp suffix", async () => {
    mockFs.readDir.mockResolvedValue([
      { name: `file.json.${UUID}` },
      { name: "file.json.backup" },
    ]);

    await sweepOrphanedTmpFiles("/some/dir/file.json");

    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it("returns without error when readDir throws (directory does not exist)", async () => {
    mockFs.readDir.mockRejectedValue(new Error("ENOENT: directory not found"));

    await expect(sweepOrphanedTmpFiles("/nonexistent/dir/file.json")).resolves.toBeUndefined();
  });

  it("skips entries with undefined name without throwing", async () => {
    mockFs.readDir.mockResolvedValue([
      { name: undefined },
      { name: `file.json.${UUID}.tmp` },
    ]);

    await sweepOrphanedTmpFiles("/some/dir/file.json");

    expect(mockFs.remove).toHaveBeenCalledTimes(1);
    expect(mockFs.remove).toHaveBeenCalledWith(`/some/dir/file.json.${UUID}.tmp`);
  });

  it("does not remove .tmp files with non-UUID suffix (e.g. editor swap files)", async () => {
    mockFs.readDir.mockResolvedValue([
      { name: "file.json.editor-swap.tmp" },
      { name: "file.json.not-a-uuid.tmp" },
      { name: `file.json.${UUID}.tmp` },
    ]);

    await sweepOrphanedTmpFiles("/some/dir/file.json");

    expect(mockFs.remove).toHaveBeenCalledTimes(1);
    expect(mockFs.remove).toHaveBeenCalledWith(`/some/dir/file.json.${UUID}.tmp`);
  });
});

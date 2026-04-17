import { describe, it, expect, beforeEach } from "vitest";
import { atomicWriteJson, atomicWriteText } from "./fsUtils";
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

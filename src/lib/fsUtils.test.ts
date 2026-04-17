import { describe, it, expect, beforeEach } from "vitest";
import { atomicWriteJson, atomicWriteText } from "./fsUtils";
import { mockFs, createMockFileSystem } from "@/test/tauri-mocks";

describe("atomicWriteText", () => {
  beforeEach(() => {
    mockFs.writeTextFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.remove.mockResolvedValue(undefined);
  });

  it("writes text to a .tmp file then renames to the final path in that order", async () => {
    await atomicWriteText("/some/dir/file.json", "hello");

    expect(mockFs.writeTextFile).toHaveBeenCalledWith("/some/dir/file.json.tmp", "hello");
    expect(mockFs.rename).toHaveBeenCalledWith("/some/dir/file.json.tmp", "/some/dir/file.json");
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
    expect(files["/dir/file.json.tmp"]).toBeUndefined();
  });

  it("attempts tmp cleanup and propagates rename errors", async () => {
    mockFs.rename.mockRejectedValue(new Error("EPERM"));

    await expect(atomicWriteText("/dir/file.json", "x")).rejects.toThrow("EPERM");
    expect(mockFs.remove).toHaveBeenCalledWith("/dir/file.json.tmp");
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

  it("overwrites a pre-existing stale .tmp file on write", async () => {
    const files = createMockFileSystem({ "/dir/file.json.tmp": "stale" });

    await atomicWriteText("/dir/file.json", "fresh");

    expect(files["/dir/file.json"]).toBe("fresh");
    expect(files["/dir/file.json.tmp"]).toBeUndefined();
  });
});

describe("atomicWriteJson", () => {
  beforeEach(() => {
    mockFs.writeTextFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.remove.mockResolvedValue(undefined);
  });

  it("writes serialized JSON to a .tmp file then renames to the final path", async () => {
    const data = { foo: "bar", count: 42 };

    await atomicWriteJson("/some/dir/file.json", data);

    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/some/dir/file.json.tmp",
      JSON.stringify(data, null, 2)
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/some/dir/file.json.tmp",
      "/some/dir/file.json"
    );
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

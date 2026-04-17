import { describe, it, expect } from "vitest";
import { createMockFileSystem, mockFs } from "./tauri-mocks";

// Global afterEach in src/test/setup.ts calls resetTauriMocks(), which resets all mockFs
// functions — no local beforeEach needed.

describe("createMockFileSystem — rename", () => {
  it("rejects with ENOENT when source path does not exist", async () => {
    createMockFileSystem({});

    await expect(mockFs.rename("/nonexistent/file.json", "/dest/file.json")).rejects.toThrow(
      "ENOENT: no such file or directory, rename '/nonexistent/file.json'"
    );
  });

  it("rejects with ENOENT when source was never written and not in initial structure", async () => {
    createMockFileSystem({ "/other/file.json": "content" });

    await expect(mockFs.rename("/missing.json", "/dest.json")).rejects.toThrow("ENOENT");
  });

  it("rejects with ENOENT after source was removed", async () => {
    createMockFileSystem({ "/dir/file.json": "data" });

    await mockFs.remove("/dir/file.json");

    await expect(mockFs.rename("/dir/file.json", "/dir/dest.json")).rejects.toThrow("ENOENT");
  });

  it("resolves when source exists in initial structure", async () => {
    createMockFileSystem({ "/dir/file.json": "data" });

    await expect(mockFs.rename("/dir/file.json", "/dir/file.json.bak")).resolves.toBeUndefined();
  });

  it("resolves when source was written via writeTextFile", async () => {
    createMockFileSystem({});

    await mockFs.writeTextFile("/dir/file.json.tmp", "hello");
    await expect(mockFs.rename("/dir/file.json.tmp", "/dir/file.json")).resolves.toBeUndefined();
  });

  it("moves content from source to destination", async () => {
    const files = createMockFileSystem({ "/dir/source.json": "original" });

    await mockFs.rename("/dir/source.json", "/dir/dest.json");

    expect(files["/dir/dest.json"]).toBe("original");
    expect("/dir/source.json" in files).toBe(false);
  });

  it("moves writeTextFile content to destination", async () => {
    const files = createMockFileSystem({});

    await mockFs.writeTextFile("/dir/file.json.tmp", "new-content");
    await mockFs.rename("/dir/file.json.tmp", "/dir/file.json");

    expect(files["/dir/file.json"]).toBe("new-content");
    expect("/dir/file.json.tmp" in files).toBe(false);
  });

  it("overwrites destination when it already exists", async () => {
    const files = createMockFileSystem({
      "/dir/src.json": "new",
      "/dir/dst.json": "old",
    });

    await mockFs.rename("/dir/src.json", "/dir/dst.json");

    expect(files["/dir/dst.json"]).toBe("new");
    expect("/dir/src.json" in files).toBe(false);
  });

  it("is a no-op when renaming a file to itself", async () => {
    createMockFileSystem({ "/dir/file.json": "data" });

    await mockFs.rename("/dir/file.json", "/dir/file.json");

    // File must still be accessible after a self-rename
    await expect(mockFs.exists("/dir/file.json")).resolves.toBe(true);
    await expect(mockFs.readTextFile("/dir/file.json")).resolves.toBe("data");
  });

  it("source no longer accessible via exists after rename", async () => {
    createMockFileSystem({ "/dir/file.json": "data" });

    await mockFs.rename("/dir/file.json", "/dir/file.bak");

    await expect(mockFs.exists("/dir/file.json")).resolves.toBe(false);
    await expect(mockFs.exists("/dir/file.bak")).resolves.toBe(true);
  });
});

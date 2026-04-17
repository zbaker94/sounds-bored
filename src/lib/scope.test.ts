import { describe, it, expect, beforeEach } from "vitest";
import { grantPathAccess, grantParentAccess, grantParentDirectories, pickFolder, pickFile, pickFiles } from "./scope";
import { mockCore, mockPath, mockDialog, resetTauriMocks } from "@/test/tauri-mocks";

describe("grantPathAccess", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
  });

  it("calls invoke with 'grant_path_access' and the provided folder path", async () => {
    await grantPathAccess("/some/folder");

    expect(mockCore.invoke).toHaveBeenCalledTimes(1);
    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "/some/folder",
    });
  });

  it("propagates errors from invoke", async () => {
    mockCore.invoke.mockRejectedValue(new Error("scope denied"));

    await expect(grantPathAccess("/some/folder")).rejects.toThrow("scope denied");
  });
});

describe("grantParentAccess", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
    // Restore the default synchronous dirname implementation from tauri-mocks.
    // The real Tauri dirname returns Promise<string>, but `await` works on both
    // sync strings and promises, so the runtime behavior is identical.
    mockPath.dirname.mockImplementation((path: string) => {
      const normalized = path.replace(/\\/g, "/");
      const idx = normalized.lastIndexOf("/");
      return idx > 0 ? normalized.substring(0, idx) : "/";
    });
  });

  it("calls dirname to get the parent, then invoke with 'grant_path_access' and the parent path", async () => {
    await grantParentAccess("/some/folder/file.json");

    expect(mockPath.dirname).toHaveBeenCalledWith("/some/folder/file.json");
    expect(mockCore.invoke).toHaveBeenCalledTimes(1);
    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "/some/folder",
    });
  });

  it("grants access to the parent for a file at a nested path", async () => {
    await grantParentAccess("/a/b/c/d/song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "/a/b/c/d",
    });
  });

  it("propagates errors from dirname", async () => {
    mockPath.dirname.mockImplementation(() => {
      throw new Error("invalid path");
    });

    await expect(grantParentAccess("/some/folder/file.json")).rejects.toThrow(
      "invalid path"
    );
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("propagates errors from invoke", async () => {
    mockCore.invoke.mockRejectedValue(new Error("scope denied"));

    await expect(grantParentAccess("/some/folder/file.json")).rejects.toThrow(
      "scope denied"
    );
  });

  it("does not grant access when the parent is the Unix root", async () => {
    mockPath.dirname.mockImplementation(() => "/");

    await grantParentAccess("/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a Windows drive root", async () => {
    mockPath.dirname.mockImplementation(() => "C:\\");

    await grantParentAccess("C:\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });
});

describe("pickFolder", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
  });

  it("opens a directory picker and returns the selected folder path", async () => {
    mockDialog.open.mockResolvedValue("/user/music");

    const result = await pickFolder();

    expect(mockDialog.open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(result).toBe("/user/music");
  });

  it("passes title and defaultPath options to the dialog", async () => {
    mockDialog.open.mockResolvedValue("/user/music");

    await pickFolder({ title: "Choose Folder", defaultPath: "/user" });

    expect(mockDialog.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Choose Folder",
      defaultPath: "/user",
    });
  });

  it("grants path access after the user selects a folder", async () => {
    mockDialog.open.mockResolvedValue("/user/music");

    await pickFolder();

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "/user/music",
    });
  });

  it("handles an array response and grants access to the first element", async () => {
    mockDialog.open.mockResolvedValue(["/user/music", "/other"]);

    const result = await pickFolder();

    expect(result).toBe("/user/music");
    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", { path: "/user/music" });
  });

  it("returns null and does not grant access when the dialog is cancelled", async () => {
    mockDialog.open.mockResolvedValue(null);

    const result = await pickFolder();

    expect(result).toBeNull();
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("returns null and does not grant access when the dialog returns an empty array", async () => {
    mockDialog.open.mockResolvedValue([]);

    const result = await pickFolder();

    expect(result).toBeNull();
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });
});

describe("pickFile", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
    mockPath.dirname.mockImplementation((path: string) => {
      const normalized = path.replace(/\\/g, "/");
      const idx = normalized.lastIndexOf("/");
      return idx > 0 ? normalized.substring(0, idx) : "/";
    });
  });

  it("opens a file picker and returns the selected file path", async () => {
    mockDialog.open.mockResolvedValue("/user/music/kick.wav");

    const result = await pickFile();

    expect(mockDialog.open).toHaveBeenCalledWith({ multiple: false });
    expect(result).toBe("/user/music/kick.wav");
  });

  it("passes filters and defaultPath options to the dialog", async () => {
    mockDialog.open.mockResolvedValue("/user/music/kick.wav");
    const filters = [{ name: "Audio", extensions: ["wav", "mp3"] }];

    await pickFile({ filters, defaultPath: "/user/music" });

    expect(mockDialog.open).toHaveBeenCalledWith({
      multiple: false,
      filters,
      defaultPath: "/user/music",
    });
  });

  it("grants access to the parent directory after the user selects a file", async () => {
    mockDialog.open.mockResolvedValue("/user/music/kick.wav");

    await pickFile();

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "/user/music",
    });
  });

  it("returns null and does not grant access when the dialog is cancelled", async () => {
    mockDialog.open.mockResolvedValue(null);

    const result = await pickFile();

    expect(result).toBeNull();
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("returns null and does not grant access when the dialog returns an empty array", async () => {
    mockDialog.open.mockResolvedValue([]);

    const result = await pickFile();

    expect(result).toBeNull();
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });
});

describe("grantParentDirectories", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
    mockPath.dirname.mockImplementation((path: string) => {
      const normalized = path.replace(/\\/g, "/");
      const idx = normalized.lastIndexOf("/");
      return idx > 0 ? normalized.substring(0, idx) : "/";
    });
  });

  it("grants unique parent directories for multiple file paths", async () => {
    await grantParentDirectories(["/music/kick.wav", "/music/snare.wav", "/sfx/boom.wav"]);

    const paths = mockCore.invoke.mock.calls.map((c) => (c[1] as { path: string }).path);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("/music");
    expect(paths).toContain("/sfx");
  });

  it("does not grant access when the parent is the Unix root", async () => {
    mockPath.dirname.mockImplementation(() => "/");
    await grantParentDirectories(["/song.wav"]);
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("resolves without throwing when a grant fails (allSettled)", async () => {
    mockCore.invoke.mockRejectedValue(new Error("scope denied"));
    await expect(grantParentDirectories(["/music/kick.wav"])).resolves.toBeUndefined();
  });

  it("does nothing for an empty array", async () => {
    await grantParentDirectories([]);
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });
});

describe("pickFiles", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
    mockPath.dirname.mockImplementation((path: string) => {
      const normalized = path.replace(/\\/g, "/");
      const idx = normalized.lastIndexOf("/");
      return idx > 0 ? normalized.substring(0, idx) : "/";
    });
  });

  it("opens a multi-file picker and returns all selected paths", async () => {
    mockDialog.open.mockResolvedValue(["/music/kick.wav", "/music/snare.wav"]);

    const result = await pickFiles();

    expect(mockDialog.open).toHaveBeenCalledWith({ multiple: true });
    expect(result).toEqual(["/music/kick.wav", "/music/snare.wav"]);
  });

  it("grants access to unique parent directories", async () => {
    mockDialog.open.mockResolvedValue(["/music/kick.wav", "/music/snare.wav", "/sfx/boom.wav"]);

    await pickFiles();

    const invokeCalls = mockCore.invoke.mock.calls.map((c) => (c[1] as { path: string }).path);
    expect(invokeCalls).toHaveLength(2);
    expect(invokeCalls).toContain("/music");
    expect(invokeCalls).toContain("/sfx");
  });

  it("returns an empty array and does not grant access when the dialog is cancelled", async () => {
    mockDialog.open.mockResolvedValue(null);

    const result = await pickFiles();

    expect(result).toEqual([]);
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("returns an empty array and does not grant access when the dialog returns an empty array", async () => {
    mockDialog.open.mockResolvedValue([]);

    const result = await pickFiles();

    expect(result).toEqual([]);
    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("passes filters and other options to the dialog", async () => {
    mockDialog.open.mockResolvedValue(["/music/kick.wav"]);
    const filters = [{ name: "Audio", extensions: ["wav", "mp3"] }];

    await pickFiles({ filters });

    expect(mockDialog.open).toHaveBeenCalledWith({ filters, multiple: true });
  });
});

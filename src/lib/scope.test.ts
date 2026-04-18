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

  it("does not grant access when dirname returns an empty string", async () => {
    mockPath.dirname.mockImplementation(() => "");

    await grantParentAccess("song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a Windows drive root without trailing slash (C:)", async () => {
    mockPath.dirname.mockImplementation(() => "C:");

    await grantParentAccess("C:song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a Windows drive root with a forward slash (C:/)", async () => {
    mockPath.dirname.mockImplementation(() => "C:/");

    await grantParentAccess("C:/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a UNC share root (\\\\server\\share)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server\\share");

    await grantParentAccess("\\\\server\\share\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a UNC share root with a trailing backslash", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server\\share\\");

    await grantParentAccess("\\\\server\\share\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a Windows extended-length drive root (\\\\?\\\\C:\\\\)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\C:\\");

    await grantParentAccess("\\\\?\\C:\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a Windows extended-length drive root without trailing slash (\\\\?\\\\C:)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\C:");

    await grantParentAccess("\\\\?\\C:song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a Windows extended-length UNC root (\\\\?\\\\UNC\\\\server\\\\share)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\UNC\\server\\share");

    await grantParentAccess("\\\\?\\UNC\\server\\share\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("grants access when the parent is a UNC subfolder (\\\\server\\share\\music)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server\\share\\music");

    await grantParentAccess("\\\\server\\share\\music\\song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\server\\share\\music",
    });
  });

  it("grants access when the parent is a Windows extended-length subfolder (\\\\?\\\\C:\\\\music)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\C:\\music");

    await grantParentAccess("\\\\?\\C:\\music\\song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\?\\C:\\music",
    });
  });

  it("does not grant access when the parent contains a null byte (\\x00)", async () => {
    mockPath.dirname.mockImplementation(() => "/music\x00/evil");

    await grantParentAccess("/music\x00/evil/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent contains SOH (\\x01)", async () => {
    mockPath.dirname.mockImplementation(() => "/music\x01folder");

    await grantParentAccess("/music\x01folder/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent contains a tab character (\\x09)", async () => {
    mockPath.dirname.mockImplementation(() => "/music\x09folder");

    await grantParentAccess("/music\x09folder/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent contains a newline character (\\x0A)", async () => {
    mockPath.dirname.mockImplementation(() => "/music\nfolder");

    await grantParentAccess("/music\nfolder/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent contains a carriage return character (\\x0D)", async () => {
    mockPath.dirname.mockImplementation(() => "/music\rfolder");

    await grantParentAccess("/music\rfolder/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent contains an ESC character (\\x1B)", async () => {
    mockPath.dirname.mockImplementation(() => "/music\x1bfolder");

    await grantParentAccess("/music\x1bfolder/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent contains US (\\x1F)", async () => {
    mockPath.dirname.mockImplementation(() => "/music\x1ffolder");

    await grantParentAccess("/music\x1ffolder/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent contains DEL (\\x7F)", async () => {
    mockPath.dirname.mockImplementation(() => "/music\x7ffolder");

    await grantParentAccess("/music\x7ffolder/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when the parent is a Windows path containing a null byte (\\x00)", async () => {
    mockPath.dirname.mockImplementation(() => "C:\\music\x00folder");

    await grantParentAccess("C:\\music\x00folder\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a forward-slash UNC share root (//server/share)", async () => {
    mockPath.dirname.mockImplementation(() => "//server/share");

    await grantParentAccess("//server/share/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a mixed-separator UNC share root (\\\\server/share)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server/share");

    await grantParentAccess("\\\\server/share/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns doubled-prefix UNC share root (\\\\\\\\server\\share)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\\\\\server\\share");

    await grantParentAccess("\\\\\\\\server\\share\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns doubled-prefix forward-slash UNC share root (////server/share)", async () => {
    mockPath.dirname.mockImplementation(() => "////server/share");

    await grantParentAccess("////server/share/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("grants access when dirname returns doubled-prefix UNC subfolder (\\\\\\\\server\\share\\music)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\\\\\server\\share\\music");

    await grantParentAccess("\\\\\\\\server\\share\\music\\song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\\\\\server\\share\\music",
    });
  });

  it("does not grant access when dirname returns doubled-interior-separator UNC share root (\\\\server\\\\share)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server\\\\share");

    await grantParentAccess("\\\\server\\\\share\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns doubled-interior-separator UNC share root with trailing sep (\\\\server\\\\share\\)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server\\\\share\\");

    await grantParentAccess("\\\\server\\\\share\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns doubled-interior-separator forward-slash UNC share root (//server//share)", async () => {
    mockPath.dirname.mockImplementation(() => "//server//share");

    await grantParentAccess("//server//share/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("grants access when dirname returns doubled-interior-separator UNC subfolder (\\\\server\\\\share\\folder)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server\\\\share\\folder");

    await grantParentAccess("\\\\server\\\\share\\folder\\song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\server\\\\share\\folder",
    });
  });

  it("grants access when dirname returns doubled-interior-separator UNC subfolder with doubled sep (\\\\server\\\\share\\\\folder)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server\\\\share\\\\folder");

    await grantParentAccess("\\\\server\\\\share\\\\folder\\song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\server\\\\share\\\\folder",
    });
  });

  it("does not grant access when dirname returns mixed-separator doubled-interior UNC share root (\\\\server/\\\\share)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\server/\\\\share");

    await grantParentAccess("\\\\server/\\\\share\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a Windows extended-length prefix with forward-slash (\\\\?/C:\\\\)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?/C:\\");

    await grantParentAccess("\\\\?/C:\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a bare extended-length prefix with no inner path (\\\\?\\\\)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\");

    await grantParentAccess("\\\\?\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a GLOBALROOT device path (\\\\?\\\\GLOBALROOT\\\\Device)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\GLOBALROOT\\Device");

    await grantParentAccess("\\\\?\\GLOBALROOT\\Device\\Volume1\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a DOS device namespace path (\\\\\\\\.\\\\C:\\\\)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\.\\C:\\");

    await grantParentAccess("\\\\.\\C:\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a Volume GUID root (\\\\?\\\\Volume{GUID})", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}");

    await grantParentAccess("\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a Volume GUID root with trailing backslash", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}\\");

    await grantParentAccess("\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a lowercase Volume GUID root (case-insensitive)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\volume{12345678-1234-1234-1234-1234567890AB}");

    await grantParentAccess("\\\\?\\volume{12345678-1234-1234-1234-1234567890AB}\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a forward-slash Volume GUID root (//?/Volume{GUID})", async () => {
    mockPath.dirname.mockImplementation(() => "//?/Volume{12345678-1234-1234-1234-1234567890AB}");

    await grantParentAccess("//?/Volume{12345678-1234-1234-1234-1234567890AB}/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("grants access when dirname returns a subfolder under a Volume GUID path", async () => {
    mockPath.dirname.mockImplementation(
      () => "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}\\music"
    );

    await grantParentAccess(
      "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}\\music\\song.wav"
    );

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}\\music",
    });
  });

  it("does not grant access when dirname returns an empty-GUID Volume root (\\\\?\\\\Volume{})", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\Volume{}");

    await grantParentAccess("\\\\?\\Volume{}\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a Volume GUID path with no separator after '}' (\\\\?\\\\Volume{GUID}suffix)", async () => {
    mockPath.dirname.mockImplementation(
      () => "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}suffix"
    );

    await grantParentAccess(
      "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}suffix\\song.wav"
    );

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a raw volume device path (\\\\?\\\\HarddiskVolume3)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\HarddiskVolume3");

    await grantParentAccess("\\\\?\\HarddiskVolume3\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a raw physical drive path (\\\\?\\\\PhysicalDrive0)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\PhysicalDrive0");

    await grantParentAccess("\\\\?\\PhysicalDrive0\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a BootPartition device path (\\\\?\\\\BootPartition)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\BootPartition");

    await grantParentAccess("\\\\?\\BootPartition\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a SystemPartition device path (\\\\?\\\\SystemPartition)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\SystemPartition");

    await grantParentAccess("\\\\?\\SystemPartition\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a named pipe device path (\\\\?\\\\PIPE\\\\foo)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\PIPE\\foo");

    await grantParentAccess("\\\\?\\PIPE\\foo\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access when dirname returns a mailslot device path (\\\\?\\\\MAILSLOT\\\\foo)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\MAILSLOT\\foo");

    await grantParentAccess("\\\\?\\MAILSLOT\\foo\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("grants access when dirname returns an extended-length UNC subfolder (\\\\?\\\\UNC\\\\server\\\\share\\\\music)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\UNC\\server\\share\\music");

    await grantParentAccess("\\\\?\\UNC\\server\\share\\music\\song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\?\\UNC\\server\\share\\music",
    });
  });

  it("does not grant access for forward-slash extended-length PIPE path (//?/PIPE/foo)", async () => {
    mockPath.dirname.mockImplementation(() => "//?/PIPE/foo");

    await grantParentAccess("//?/PIPE/foo/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access for forward-slash extended-length raw volume (//?/HarddiskVolume3)", async () => {
    mockPath.dirname.mockImplementation(() => "//?/HarddiskVolume3");

    await grantParentAccess("//?/HarddiskVolume3/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access for mixed-separator extended-length MAILSLOT (\\\\?/MAILSLOT/foo)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?/MAILSLOT/foo");

    await grantParentAccess("\\\\?/MAILSLOT/foo/song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access for multi-level device-namespace path (\\\\?\\\\PIPE\\\\a\\\\b\\\\c)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\PIPE\\a\\b\\c");

    await grantParentAccess("\\\\?\\PIPE\\a\\b\\c\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("does not grant access for an unknown arbitrary device-namespace path (proves allowlist)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\UnknownDevice\\sub");

    await grantParentAccess("\\\\?\\UnknownDevice\\sub\\song.wav");

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("grants access when dirname returns an extended-length drive subfolder with forward-slash inner sep (\\\\?\\\\C:/music)", async () => {
    mockPath.dirname.mockImplementation(() => "\\\\?\\C:/music");

    await grantParentAccess("\\\\?\\C:/music/song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\?\\C:/music",
    });
  });

  it("grants access when dirname returns an extended-length UNC subfolder with forward slashes (//server/share/music)", async () => {
    mockPath.dirname.mockImplementation(() => "//?/UNC/server/share/music");

    await grantParentAccess("//?/UNC/server/share/music/song.wav");

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "//?/UNC/server/share/music",
    });
  });

  it("grants access when dirname returns an extended-length Volume GUID subfolder with forward-slash separator (\\\\?\\\\Volume{GUID}/music)", async () => {
    mockPath.dirname.mockImplementation(
      () => "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}/music"
    );

    await grantParentAccess(
      "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}/music/song.wav"
    );

    expect(mockCore.invoke).toHaveBeenCalledWith("grant_path_access", {
      path: "\\\\?\\Volume{12345678-1234-1234-1234-1234567890AB}/music",
    });
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

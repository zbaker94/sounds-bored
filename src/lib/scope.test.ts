import { describe, it, expect, beforeEach, vi } from "vitest";
import { restorePathScope, pickFolder, pickFile, pickFiles, grantDroppedPaths, openPathInExplorer } from "./scope";
import { mockCore, mockPath, resetTauriMocks } from "@/test/tauri-mocks";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

describe("openPathInExplorer", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
  });

  it("invokes open_path_in_explorer with the provided path", async () => {
    await openPathInExplorer("/some/folder");

    expect(mockCore.invoke).toHaveBeenCalledTimes(1);
    expect(mockCore.invoke).toHaveBeenCalledWith("open_path_in_explorer", {
      path: "/some/folder",
    });
  });

  it("propagates errors from invoke", async () => {
    mockCore.invoke.mockRejectedValue(new Error("Path not within granted scope"));

    await expect(openPathInExplorer("/some/folder")).rejects.toThrow("Path not within granted scope");
  });
});

describe("restorePathScope", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
  });

  it("invokes restore_path_scope with the provided path", async () => {
    await restorePathScope("/some/folder");

    expect(mockCore.invoke).toHaveBeenCalledTimes(1);
    expect(mockCore.invoke).toHaveBeenCalledWith("restore_path_scope", {
      path: "/some/folder",
    });
  });

  it("propagates errors from invoke", async () => {
    mockCore.invoke.mockRejectedValue(new Error("scope denied"));

    await expect(restorePathScope("/some/folder")).rejects.toThrow("scope denied");
  });
});

describe("pickFolder", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("invokes pick_folder_and_grant with null options when none provided", async () => {
    mockCore.invoke.mockResolvedValue("/user/music");

    const result = await pickFolder();

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_folder_and_grant", {
      title: null,
      defaultPath: null,
      canCreateDirectories: null,
    });
    expect(result).toBe("/user/music");
  });

  it("passes title and defaultPath to the Rust command", async () => {
    mockCore.invoke.mockResolvedValue("/user/music");

    await pickFolder({ title: "Choose Folder", defaultPath: "/user" });

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_folder_and_grant", {
      title: "Choose Folder",
      defaultPath: "/user",
      canCreateDirectories: null,
    });
  });

  it("passes canCreateDirectories to the Rust command when set", async () => {
    mockCore.invoke.mockResolvedValue("/user/projects");

    await pickFolder({ title: "Select Save Location", canCreateDirectories: true });

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_folder_and_grant", {
      title: "Select Save Location",
      defaultPath: null,
      canCreateDirectories: true,
    });
  });

  it("forwards canCreateDirectories: false without coercing to null", async () => {
    mockCore.invoke.mockResolvedValue("/user/projects");

    await pickFolder({ canCreateDirectories: false });

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_folder_and_grant", {
      title: null,
      defaultPath: null,
      canCreateDirectories: false,
    });
  });

  it("coerces canCreateDirectories: undefined to null", async () => {
    mockCore.invoke.mockResolvedValue("/user/projects");

    await pickFolder({ canCreateDirectories: undefined });

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_folder_and_grant", {
      title: null,
      defaultPath: null,
      canCreateDirectories: null,
    });
  });

  it("returns null when the Rust command returns null (user cancelled)", async () => {
    mockCore.invoke.mockResolvedValue(null);

    const result = await pickFolder();

    expect(result).toBeNull();
  });

  it("returns null and shows an error toast when the command rejects", async () => {
    const { toast } = await import("sonner");
    mockCore.invoke.mockRejectedValue(new Error("scope denied"));

    const result = await pickFolder();

    expect(result).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("scope denied")
    );
  });
});

describe("pickFile", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("invokes pick_file_and_grant with null options when none provided", async () => {
    mockCore.invoke.mockResolvedValue("/user/music/kick.wav");

    const result = await pickFile();

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_file_and_grant", {
      title: null,
      defaultPath: null,
      filters: null,
    });
    expect(result).toBe("/user/music/kick.wav");
  });

  it("passes title, defaultPath, and filters to the Rust command", async () => {
    mockCore.invoke.mockResolvedValue("/user/music/kick.wav");
    const filters = [{ name: "Audio", extensions: ["wav", "mp3"] }];

    await pickFile({ title: "Choose File", defaultPath: "/user/music", filters });

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_file_and_grant", {
      title: "Choose File",
      defaultPath: "/user/music",
      filters,
    });
  });

  it("returns null when the command returns null (user cancelled)", async () => {
    mockCore.invoke.mockResolvedValue(null);

    const result = await pickFile();

    expect(result).toBeNull();
  });
});

describe("pickFiles", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("invokes pick_files_and_grant and returns the selected paths", async () => {
    mockCore.invoke.mockResolvedValue(["/music/kick.wav", "/music/snare.wav"]);

    const result = await pickFiles();

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_files_and_grant", {
      title: null,
      defaultPath: null,
      filters: null,
    });
    expect(result).toEqual(["/music/kick.wav", "/music/snare.wav"]);
  });

  it("passes filters and options to the Rust command", async () => {
    mockCore.invoke.mockResolvedValue(["/music/kick.wav"]);
    const filters = [{ name: "Audio", extensions: ["wav", "mp3"] }];

    await pickFiles({ filters });

    expect(mockCore.invoke).toHaveBeenCalledWith("pick_files_and_grant", {
      title: null,
      defaultPath: null,
      filters,
    });
  });

  it("returns an empty array when the command returns an empty array (user cancelled)", async () => {
    mockCore.invoke.mockResolvedValue([]);

    const result = await pickFiles();

    expect(result).toEqual([]);
  });
});

describe("grantDroppedPaths", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockCore.invoke.mockResolvedValue(undefined);
    mockPath.dirname.mockImplementation((path: string) => {
      const normalized = path.replace(/\\/g, "/");
      const idx = normalized.lastIndexOf("/");
      return idx > 0 ? normalized.substring(0, idx) : "/";
    });
  });

  it("calls restorePathScope for each unique parent directory", async () => {
    await grantDroppedPaths(["/music/kick.wav", "/music/snare.wav", "/sfx/boom.wav"]);

    const paths = mockCore.invoke.mock.calls.map((c) => (c[1] as { path: string }).path);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("/music");
    expect(paths).toContain("/sfx");
  });

  it("deduplicates parent directories so each is granted only once", async () => {
    await grantDroppedPaths(["/music/kick.wav", "/music/snare.wav"]);

    expect(mockCore.invoke).toHaveBeenCalledTimes(1);
    expect(mockCore.invoke).toHaveBeenCalledWith("restore_path_scope", { path: "/music" });
  });

  it("does nothing for an empty array", async () => {
    await grantDroppedPaths([]);

    expect(mockCore.invoke).not.toHaveBeenCalled();
  });

  it("resolves without throwing when a grant fails (allSettled)", async () => {
    mockCore.invoke.mockRejectedValue(new Error("scope denied"));

    await expect(grantDroppedPaths(["/music/kick.wav"])).resolves.toBeUndefined();
  });
});

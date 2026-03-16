import { describe, it, expect, beforeEach } from "vitest";
import { useAppSettingsStore, initialAppSettingsState } from "./appSettingsStore";
import { createMockAppSettings, createMockGlobalFolder } from "@/test/factories";

function getState() {
  return useAppSettingsStore.getState();
}

describe("appSettingsStore", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ ...initialAppSettingsState });
  });

  describe("initial state", () => {
    it("should start with null settings", () => {
      expect(getState().settings).toBeNull();
    });
  });

  describe("loadSettings", () => {
    it("should set settings", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      expect(getState().settings).toEqual(settings);
    });

    it("should replace previous settings on re-load", () => {
      getState().loadSettings(createMockAppSettings());
      const updated = createMockAppSettings({ version: "2.0.0" });
      getState().loadSettings(updated);
      expect(getState().settings?.version).toBe("2.0.0");
    });
  });

  describe("addGlobalFolder", () => {
    it("should append a folder to globalFolders", () => {
      getState().loadSettings(createMockAppSettings());
      const initialCount = getState().settings!.globalFolders.length;
      const newFolder = createMockGlobalFolder({ name: "Extra" });
      getState().addGlobalFolder(newFolder);
      expect(getState().settings!.globalFolders).toHaveLength(initialCount + 1);
      expect(getState().settings!.globalFolders.at(-1)?.name).toBe("Extra");
    });

    it("should do nothing when settings is null", () => {
      expect(() => getState().addGlobalFolder(createMockGlobalFolder())).not.toThrow();
    });
  });

  describe("removeGlobalFolder", () => {
    it("should remove a folder by id", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      const rootFolder = settings.globalFolders[0];
      getState().removeGlobalFolder(rootFolder.id);
      expect(getState().settings!.globalFolders.some((f) => f.id === rootFolder.id)).toBe(false);
    });

    it("should throw when removing the downloadFolderId folder", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      expect(() => getState().removeGlobalFolder(settings.downloadFolderId)).toThrow(
        /download or import destination/
      );
    });

    it("should throw when removing the importFolderId folder", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      expect(() => getState().removeGlobalFolder(settings.importFolderId)).toThrow(
        /download or import destination/
      );
    });

    it("should not change state when throw occurs", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      const countBefore = getState().settings!.globalFolders.length;
      try {
        getState().removeGlobalFolder(settings.downloadFolderId);
      } catch {
        // expected
      }
      expect(getState().settings!.globalFolders).toHaveLength(countBefore);
    });
  });

  describe("setDownloadFolder", () => {
    it("should update downloadFolderId", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      const newId = settings.globalFolders[0].id;
      getState().setDownloadFolder(newId);
      expect(getState().settings!.downloadFolderId).toBe(newId);
    });
  });

  describe("setImportFolder", () => {
    it("should update importFolderId", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      const newId = settings.globalFolders[0].id;
      getState().setImportFolder(newId);
      expect(getState().settings!.importFolderId).toBe(newId);
    });
  });

  describe("updateSettings", () => {
    it("should apply an immer updater to settings", () => {
      getState().loadSettings(createMockAppSettings());
      getState().updateSettings((draft) => {
        draft.version = "9.9.9";
      });
      expect(getState().settings?.version).toBe("9.9.9");
    });

    it("should do nothing when settings is null", () => {
      expect(() =>
        getState().updateSettings((draft) => {
          draft.version = "9.9.9";
        })
      ).not.toThrow();
    });
  });
});

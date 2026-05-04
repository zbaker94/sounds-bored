import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { AppSettings, GlobalFolder } from "@/lib/schemas";

interface AppSettingsState {
  settings: AppSettings | null;
}

interface AppSettingsActions {
  loadSettings: (settings: AppSettings) => void;
  updateSettings: (updater: (draft: AppSettings) => void) => void;
  addGlobalFolder: (folder: GlobalFolder) => void;
  removeGlobalFolder: (folderId: string) => void;
  setDownloadFolder: (folderId: string) => void;
  setImportFolder: (folderId: string) => void;
  setAutoAnalysis: (enabled: boolean) => void;
}

type AppSettingsStore = AppSettingsState & AppSettingsActions;

export const initialAppSettingsState: AppSettingsState = {
  settings: null,
};

export const useAppSettingsStore = create<AppSettingsStore>()(
  immer((set) => ({
    ...initialAppSettingsState,

    loadSettings: (settings) =>
      set((draft) => {
        draft.settings = settings;
      }),

    updateSettings: (updater) =>
      set((draft) => {
        if (draft.settings) {
          updater(draft.settings);
        }
      }),

    addGlobalFolder: (folder) =>
      set((draft) => {
        draft.settings?.globalFolders.push(folder);
      }),

    removeGlobalFolder: (folderId) => {
      // Check invariant BEFORE entering the Immer set callback to ensure
      // the error propagates synchronously to the caller.
      const { settings } = useAppSettingsStore.getState();
      if (
        settings?.downloadFolderId === folderId ||
        settings?.importFolderId === folderId
      ) {
        throw new Error(
          `Cannot remove folder: it is currently used as a download or import destination. Reassign it first.`
        );
      }
      set((draft) => {
        draft.settings?.globalFolders &&
          (draft.settings.globalFolders = draft.settings.globalFolders.filter(
            (f) => f.id !== folderId
          ));
      });
    },

    setDownloadFolder: (folderId) =>
      set((draft) => {
        if (!draft.settings) return;
        draft.settings.downloadFolderId = folderId;
      }),

    setImportFolder: (folderId) =>
      set((draft) => {
        if (!draft.settings) return;
        draft.settings.importFolderId = folderId;
      }),

    setAutoAnalysis: (enabled) =>
      set((draft) => {
        if (!draft.settings) return;
        draft.settings.autoAnalysis = enabled;
      }),
  }))
);

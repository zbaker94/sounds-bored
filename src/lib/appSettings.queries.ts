import { useMutation } from "@tanstack/react-query";
import { saveAppSettings } from "./appSettings";
import { AppSettings } from "./schemas";
import { useAppSettingsStore } from "@/state/appSettingsStore";

export function useSaveAppSettings() {
  return useMutation({
    mutationFn: async (settings: AppSettings) => {
      await saveAppSettings(settings);
      return settings;
    },
    onSuccess: (settings) => {
      // Push the saved settings back into the Zustand store so every
      // subscriber reflects the new state immediately — no query invalidation
      // or refetch needed. This eliminates the window where a stale query
      // result could overwrite in-flight mutations.
      useAppSettingsStore.getState().loadSettings(settings);
    },
  });
}


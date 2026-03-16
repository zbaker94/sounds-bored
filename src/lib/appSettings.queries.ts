import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadAppSettings, saveAppSettings } from "./appSettings";
import { AppSettings } from "./schemas";
import { QUERY_STALE_TIME } from "./constants";

export function useAppSettings() {
  return useQuery<AppSettings, Error>({
    queryKey: ["appSettings"],
    queryFn: loadAppSettings,
    staleTime: QUERY_STALE_TIME,
  });
}

export function useSaveAppSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: AppSettings) => {
      await saveAppSettings(settings);
      return settings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] });
    },
  });
}

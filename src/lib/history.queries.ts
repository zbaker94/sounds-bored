import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { loadProjectHistory, saveProjectHistory } from "./history";
import { ProjectHistory } from "./schemas";
import { QUERY_STALE_TIME } from "./constants";

export function useProjectHistory() {
  return useQuery<ProjectHistory, Error>({
    queryKey: ["projectHistory"],
    queryFn: () => loadProjectHistory({ onCorruption: (msg) => toast.warning(msg) }),
    staleTime: QUERY_STALE_TIME,
  });
}

export function useSaveProjectHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (history: ProjectHistory) => {
      await saveProjectHistory(history);
      return history;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projectHistory"] });
    },
  });
}

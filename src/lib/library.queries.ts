import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadGlobalLibrary, saveGlobalLibrary } from "./library";
import { GlobalLibrary } from "./schemas";
import { QUERY_STALE_TIME } from "./constants";

export function useGlobalLibrary() {
  return useQuery<GlobalLibrary, Error>({
    queryKey: ["globalLibrary"],
    queryFn: loadGlobalLibrary,
    staleTime: QUERY_STALE_TIME,
  });
}

export function useSaveGlobalLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (library: GlobalLibrary) => {
      await saveGlobalLibrary(library);
      return library;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["globalLibrary"] });
    },
  });
}

import { create } from "zustand";
import type { DownloadJob } from "@/lib/schemas";

interface DownloadStoreState {
  jobs: Record<string, DownloadJob>;
}

interface DownloadStoreActions {
  addJob: (job: DownloadJob) => void;
  updateJob: (id: string, updates: Partial<DownloadJob>) => void;
  removeJob: (id: string) => void;
}

export const initialDownloadState: DownloadStoreState = {
  jobs: {},
};

export const useDownloadStore = create<DownloadStoreState & DownloadStoreActions>((set) => ({
  ...initialDownloadState,
  addJob: (job) =>
    set((state) => ({ jobs: { ...state.jobs, [job.id]: job } })),
  updateJob: (id, updates) =>
    set((state) => {
      if (!state.jobs[id]) return state;
      return { jobs: { ...state.jobs, [id]: { ...state.jobs[id], ...updates } } };
    }),
  removeJob: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.jobs;
      return { jobs: rest };
    }),
}));

import { create } from "zustand";
import type { DownloadJob, DownloadStatus } from "@/lib/schemas";

/**
 * Discriminated union of all valid updateJob payloads.
 * Each variant enforces the fields that must accompany that status transition,
 * preventing callers from constructing semantically invalid job states.
 * The `{ soundId }` variant handles the post-completion association step
 * without changing status.
 */
export type DownloadJobUpdate =
  | { status: "queued" }
  | { status: "downloading"; percent: number; speed?: string; eta?: string }
  | { status: "processing"; percent: number; speed?: string; eta?: string }
  | { status: "completed"; percent: number; outputPath: string }
  | { status: "failed"; error: string }
  | { status: "cancelled" }
  | { soundId: string };

/**
 * Statuses from which no further status transition is valid.
 * Late sidecar events arriving after cancel/complete must be silently dropped.
 */
export const TERMINAL_STATUSES = new Set<DownloadStatus>(["completed", "failed", "cancelled"]);

interface DownloadStoreState {
  jobs: Record<string, DownloadJob>;
}

interface DownloadStoreActions {
  addJob: (job: DownloadJob) => void;
  updateJob: (id: string, update: DownloadJobUpdate) => void;
  removeJob: (id: string) => void;
}

export const initialDownloadState: DownloadStoreState = {
  jobs: {},
};

export const useDownloadStore = create<DownloadStoreState & DownloadStoreActions>((set) => ({
  ...initialDownloadState,
  addJob: (job) =>
    set((state) => ({ jobs: { ...state.jobs, [job.id]: job } })),
  updateJob: (id, update) =>
    set((state) => {
      const existing = state.jobs[id];
      if (!existing) return state;

      // Guard against late events resurrecting terminal jobs (e.g. a progress
      // event arriving after the user cancelled, or a duplicate completion).
      if ("status" in update && TERMINAL_STATUSES.has(existing.status) && update.status !== existing.status) {
        return state;
      }

      // Project each variant explicitly so status transitions clear stale fields
      // instead of silently accumulating them via a shallow spread.
      let next: DownloadJob;
      if (!("status" in update)) {
        // soundId-only update — no status change
        next = { ...existing, soundId: update.soundId };
      } else {
        switch (update.status) {
          case "queued":
            next = { ...existing, status: "queued", percent: 0, speed: undefined, eta: undefined, error: undefined };
            break;
          case "downloading":
            next = { ...existing, status: "downloading", percent: update.percent, speed: update.speed, eta: update.eta, error: undefined };
            break;
          case "processing":
            next = { ...existing, status: "processing", percent: update.percent, speed: update.speed, eta: update.eta, error: undefined };
            break;
          case "completed":
            next = { ...existing, status: "completed", percent: update.percent, outputPath: update.outputPath, speed: undefined, eta: undefined, error: undefined };
            break;
          case "failed":
            next = { ...existing, status: "failed", error: update.error, speed: undefined, eta: undefined };
            break;
          case "cancelled":
            next = { ...existing, status: "cancelled", speed: undefined, eta: undefined };
            break;
        }
      }
      return { jobs: { ...state.jobs, [id]: next } };
    }),
  removeJob: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.jobs;
      return { jobs: rest };
    }),
}));

import { create } from "zustand";

type AnalysisStatus = "idle" | "running" | "completed";

export type AnalysisEntry = { id: string; path: string };

interface AnalysisState {
  status: AnalysisStatus;
  queueLength: number;
  analyzingCount: number;
  completedCount: number;
  errors: Record<string, string>;
  currentSoundId: string | null;
  pendingQueue: AnalysisEntry[];
  completedIds: Set<string>;
}

interface AnalysisActions {
  startAnalysis: (queue: AnalysisEntry[]) => void;
  /** Append entries mid-flight; deduplicates against pendingQueue + currentSoundId + completedIds. No-op unless status is "running". */
  appendToQueue: (entries: AnalysisEntry[]) => void;
  recordComplete: (soundId: string) => void;
  recordError: (soundId: string, error: string) => void;
  /** Atomically dequeues the head of pendingQueue and sets currentSoundId. Returns the entry (or undefined if empty). */
  advance: () => AnalysisEntry | undefined;
  cancelQueue: () => void;
  reset: () => void;
}

export const initialAnalysisState: AnalysisState = {
  status: "idle",
  queueLength: 0,
  analyzingCount: 0,
  completedCount: 0,
  errors: {},
  currentSoundId: null,
  pendingQueue: [],
  completedIds: new Set<string>(),
};

export const useAnalysisStore = create<AnalysisState & AnalysisActions>((set, get) => ({
  ...initialAnalysisState,

  startAnalysis: (queue) =>
    set({
      status: "running",
      queueLength: queue.length,
      analyzingCount: queue.length,
      completedCount: 0,
      errors: {},
      pendingQueue: queue,
      currentSoundId: null,
      completedIds: new Set<string>(),
    }),

  appendToQueue: (entries) =>
    set((state) => {
      if (state.status !== "running") return state;
      // Dedup against pending + in-flight + completed. Already-completed entries are
      // filtered here so the same sound isn't analyzed twice within a single run.
      const existingIds = new Set([
        ...state.pendingQueue.map((e) => e.id),
        ...(state.currentSoundId ? [state.currentSoundId] : []),
        ...state.completedIds,
      ]);
      const newEntries = entries.filter((e) => !existingIds.has(e.id));
      if (newEntries.length === 0) return state;
      return {
        pendingQueue: [...state.pendingQueue, ...newEntries],
        queueLength: state.queueLength + newEntries.length,
        analyzingCount: state.analyzingCount + newEntries.length,
      };
    }),

  recordComplete: (soundId) =>
    set((state) => {
      if (state.status !== "running") return state;
      const completedCount = state.completedCount + 1;
      const analyzingCount = Math.max(0, state.analyzingCount - 1);
      const done = completedCount >= state.queueLength;
      return {
        completedCount,
        analyzingCount,
        status: done ? "completed" : "running",
        currentSoundId: done ? null : state.currentSoundId,
        completedIds: new Set([...state.completedIds, soundId]),
      };
    }),

  recordError: (soundId, error) =>
    set((state) => {
      if (state.status !== "running") return state;
      const completedCount = state.completedCount + 1;
      const analyzingCount = Math.max(0, state.analyzingCount - 1);
      const done = completedCount >= state.queueLength;
      return {
        completedCount,
        analyzingCount,
        errors: { ...state.errors, [soundId]: error },
        status: done ? "completed" : "running",
        currentSoundId: done ? null : state.currentSoundId,
        completedIds: new Set([...state.completedIds, soundId]),
      };
    }),

  advance: () => {
    const state = get();
    if (state.status !== "running" || state.pendingQueue.length === 0) return undefined;
    const next = state.pendingQueue[0];
    set({ pendingQueue: state.pendingQueue.slice(1), currentSoundId: next.id });
    return next;
  },

  cancelQueue: () =>
    set((state) => {
      if (state.status !== "running") return state;
      // Shrink the queue to just what's already completed + the one in-flight,
      // so the progress UI reaches 100% naturally when the current file finishes.
      // Pending sounds are dropped; the in-flight Rust task will complete on its own.
      const inFlight = state.currentSoundId ? 1 : 0;
      return {
        pendingQueue: [],
        queueLength: state.completedCount + inFlight,
        analyzingCount: inFlight,
      };
    }),

  reset: () => set({ ...initialAnalysisState, completedIds: new Set<string>(), pendingQueue: [], errors: {} }),
}));

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
}

interface AnalysisActions {
  startAnalysis: (queue: AnalysisEntry[]) => void;
  /** Append entries mid-flight; deduplicates against pendingQueue + currentSoundId. No-op if idle. Re-activates status if completed (race). */
  appendToQueue: (entries: AnalysisEntry[]) => void;
  recordStarted: (soundId: string) => void;
  recordComplete: (soundId: string) => void;
  recordError: (soundId: string, error: string) => void;
  dequeueNext: () => AnalysisEntry | undefined;
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
    }),

  appendToQueue: (entries) =>
    set((state) => {
      if (state.status === "idle") return state;
      const existingIds = new Set([
        ...state.pendingQueue.map((e) => e.id),
        ...(state.currentSoundId ? [state.currentSoundId] : []),
      ]);
      const newEntries = entries.filter((e) => !existingIds.has(e.id));
      if (newEntries.length === 0) return state;
      // Re-activating from "completed" (race: last item finished just before append).
      // Start a clean batch so prior errors and progress don't bleed into the new run.
      if (state.status === "completed") {
        return {
          pendingQueue: newEntries,
          queueLength: newEntries.length,
          analyzingCount: newEntries.length,
          completedCount: 0,
          errors: {},
          status: "running",
        };
      }
      return {
        pendingQueue: [...state.pendingQueue, ...newEntries],
        queueLength: state.queueLength + newEntries.length,
        analyzingCount: state.analyzingCount + newEntries.length,
        status: "running",
      };
    }),

  recordStarted: (soundId) => set({ currentSoundId: soundId }),

  recordComplete: (_soundId) =>
    set((state) => {
      const completedCount = state.completedCount + 1;
      const analyzingCount = Math.max(0, state.analyzingCount - 1);
      const done = completedCount >= state.queueLength;
      return {
        completedCount,
        analyzingCount,
        status: done ? "completed" : "running",
        currentSoundId: done ? null : state.currentSoundId,
      };
    }),

  recordError: (soundId, error) =>
    set((state) => {
      const completedCount = state.completedCount + 1;
      const analyzingCount = Math.max(0, state.analyzingCount - 1);
      const done = completedCount >= state.queueLength;
      return {
        completedCount,
        analyzingCount,
        errors: { ...state.errors, [soundId]: error },
        status: done ? "completed" : "running",
        currentSoundId: done ? null : state.currentSoundId,
      };
    }),

  dequeueNext: () => {
    const { pendingQueue } = get();
    if (pendingQueue.length === 0) return undefined;
    const [next, ...rest] = pendingQueue;
    set({ pendingQueue: rest });
    return next;
  },

  cancelQueue: () =>
    set((state) => {
      if (state.status !== "running") return state;
      // Shrink the queue to just what's already completed + the one in-flight,
      // so the progress UI reaches 100% naturally when the current file finishes.
      // Pending sounds are dropped; the in-flight Rust task will complete on its own.
      const inFlight = 1;
      return {
        pendingQueue: [],
        queueLength: state.completedCount + inFlight,
        analyzingCount: inFlight,
      };
    }),

  reset: () => set(initialAnalysisState),
}));

// Per-pad transient display metadata, written imperatively by the audio engine
// (layerTrigger.ts) on each successful voice start. Distinct from padMetricsStore
// (RAF-driven volumes/progress) and playbackStore (binary playing/fading sets).
// Cleared on project close by MainPage.tsx and on pad stop by padPlayer.ts.
import { create } from "zustand";
import type { PlaybackMode } from "@/lib/schemas";

export interface PadVoiceInfo {
  soundName: string;
  layerName: string | undefined;
  playbackMode: PlaybackMode;
  durationMs: number | undefined;
  coverArtDataUrl?: string;
  /** Monotonically increasing sequence number assigned by the store on enqueue. */
  seq: number;
}

/** Input shape accepted by enqueueVoice — `seq` is assigned by the store. */
export type PadVoiceInput = Omit<PadVoiceInfo, "seq">;

interface PadDisplayState {
  currentVoice: Record<string, PadVoiceInfo | null>;
  voiceQueue: Record<string, PadVoiceInfo[]>;
  enqueueVoice(padId: string, info: PadVoiceInput): void;
  shiftVoice(padId: string): void;
  clearPadDisplay(padId: string): void;
  clearAllPadDisplays(): void;
}

let _voiceSeq = 0;
/** Test-only reset of the internal monotonic sequence counter. */
export function _resetVoiceSeq(): void {
  _voiceSeq = 0;
}

export const initialPadDisplayState = {
  get currentVoice(): Record<string, PadVoiceInfo | null> { return {}; },
  get voiceQueue(): Record<string, PadVoiceInfo[]> { return {}; },
};

export const usePadDisplayStore = create<PadDisplayState>()((set) => ({
  currentVoice: {},
  voiceQueue: {},

  enqueueVoice: (padId, info) =>
    set((s) => {
      const withSeq: PadVoiceInfo = { ...info, seq: ++_voiceSeq };
      const current = s.currentVoice[padId];
      if (current == null) {
        return {
          currentVoice: { ...s.currentVoice, [padId]: withSeq },
        };
      }
      const existingQueue = s.voiceQueue[padId] ?? [];
      return {
        voiceQueue: { ...s.voiceQueue, [padId]: [...existingQueue, withSeq] },
      };
    }),

  shiftVoice: (padId) =>
    set((s) => {
      const queue = s.voiceQueue[padId] ?? [];
      if (queue.length > 0) {
        const [next, ...rest] = queue;
        return {
          currentVoice: { ...s.currentVoice, [padId]: next },
          voiceQueue: { ...s.voiceQueue, [padId]: rest },
        };
      }
      return {
        currentVoice: { ...s.currentVoice, [padId]: null },
      };
    }),

  clearPadDisplay: (padId) =>
    set((s) => ({
      currentVoice: { ...s.currentVoice, [padId]: null },
      voiceQueue: { ...s.voiceQueue, [padId]: [] },
    })),

  clearAllPadDisplays: () => set({ currentVoice: {}, voiceQueue: {} }),
}));

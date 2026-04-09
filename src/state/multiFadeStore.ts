import { create } from "zustand";

export interface SelectedPadFade {
  padId: string;
  levels: [number, number]; // [fromLevel, toLevel] in 0–100 scale
}

interface MultiFadeState {
  active: boolean;
  originPadId: string | null;
  selectedPads: Map<string, SelectedPadFade>;
  reopenPadId: string | null;
}

interface MultiFadeActions {
  enterMultiFade: (originPadId: string, playing: boolean, initialVolume?: number) => void;
  toggleMultiFadePad: (padId: string, playing: boolean, currentVolume: number) => void;
  setMultiFadeLevels: (padId: string, levels: [number, number]) => void;
  cancelMultiFade: () => void;
  resetMultiFade: () => void;
  clearMultiFadeReopenPadId: () => void;
}

const initialState: MultiFadeState = {
  active: false,
  originPadId: null,
  selectedPads: new Map(),
  reopenPadId: null,
};

export const useMultiFadeStore = create<MultiFadeState & MultiFadeActions>((set) => ({
  ...initialState,

  enterMultiFade: (originPadId, playing, initialVolume) =>
    set(() => {
      const vol = initialVolume ?? 1.0;
      const levels: [number, number] = playing
        ? [0, Math.round(vol * 100)]
        : [0, 100];
      const selectedPads = new Map<string, SelectedPadFade>([
        [originPadId, { padId: originPadId, levels }],
      ]);
      return {
        active: true,
        originPadId,
        selectedPads,
        reopenPadId: null,
      };
    }),

  toggleMultiFadePad: (padId, playing, currentVolume) =>
    set((state) => {
      const next = new Map(state.selectedPads);
      if (next.has(padId)) {
        next.delete(padId);
      } else {
        const vol = currentVolume;
        const levels: [number, number] = playing
          ? [0, Math.round(vol * 100)]
          : [0, 100];
        next.set(padId, { padId, levels });
      }
      return { selectedPads: next };
    }),

  setMultiFadeLevels: (padId, levels) =>
    set((state) => {
      const existing = state.selectedPads.get(padId);
      if (!existing) return state;
      const next = new Map(state.selectedPads);
      next.set(padId, { ...existing, levels });
      return { selectedPads: next };
    }),

  cancelMultiFade: () =>
    set((state) => ({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: state.originPadId,
    })),

  resetMultiFade: () =>
    set({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
    }),

  clearMultiFadeReopenPadId: () => set({ reopenPadId: null }),
}));

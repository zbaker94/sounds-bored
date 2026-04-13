import { usePlaybackStore } from "@/state/playbackStore";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function getMasterGain(): GainNode {
  const c = getAudioContext();
  if (!masterGain) {
    masterGain = c.createGain();
    masterGain.gain.value = usePlaybackStore.getState().masterVolume / 100;
    masterGain.connect(c.destination);

    usePlaybackStore.subscribe((state, prevState) => {
      if (masterGain && state.masterVolume !== prevState.masterVolume) {
        masterGain.gain.value = state.masterVolume / 100;
      }
    });
  }
  return masterGain;
}

export async function ensureResumed(): Promise<AudioContext> {
  const c = getAudioContext();
  if (c.state === "suspended") await c.resume();
  return c;
}

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
// Most recent volume from applyMasterVolume (0–1 scale). Applied immediately when
// masterGain exists; queued here so getMasterGain() can initialize with the correct
// value even if the slider was moved before the first sound triggered.
let pendingVolume = 1.0;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function getMasterGain(): GainNode {
  const c = getAudioContext();
  if (!masterGain) {
    masterGain = c.createGain();
    masterGain.gain.value = pendingVolume;
    masterGain.connect(c.destination);
  }
  return masterGain;
}

export function applyMasterVolume(volumePct: number): void {
  pendingVolume = volumePct / 100;
  if (masterGain) masterGain.gain.value = pendingVolume;
}

export async function ensureResumed(): Promise<AudioContext> {
  const c = getAudioContext();
  if (c.state === "suspended") await c.resume();
  return c;
}

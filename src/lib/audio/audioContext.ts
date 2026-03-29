let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export async function ensureResumed(): Promise<AudioContext> {
  const c = getAudioContext();
  if (c.state === "suspended") await c.resume();
  return c;
}

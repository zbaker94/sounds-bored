import { ensureResumed, getMasterGain } from "./audioContext";
import { loadBuffer } from "./bufferCache";
import type { Sound } from "@/lib/schemas";

let currentSource: AudioBufferSourceNode | null = null;

export function stopPreview(): void {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // already stopped
    }
    currentSource = null;
  }
}

export async function playPreview(sound: Sound, onEnded?: () => void): Promise<void> {
  stopPreview();

  const ctx = await ensureResumed();
  const buffer = await loadBuffer(sound);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(getMasterGain());
  source.onended = () => {
    if (currentSource === source) {
      currentSource = null;
    }
    onEnded?.();
  };
  source.start();
  currentSource = source;
}

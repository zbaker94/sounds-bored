import { convertFileSrc } from "@tauri-apps/api/core";
import { getAudioContext, ensureResumed, getMasterGain } from "./audioContext";

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

export async function playPreview(filePath: string, onEnded?: () => void): Promise<void> {
  stopPreview();

  await ensureResumed();
  const ctx = getAudioContext();

  const url = convertFileSrc(filePath);
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
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

import { convertFileSrc } from "@tauri-apps/api/core";

let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

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

  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const url = convertFileSrc(filePath);
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  source.onended = () => {
    if (currentSource === source) {
      currentSource = null;
    }
    onEnded?.();
  };
  source.start();
  currentSource = source;
}

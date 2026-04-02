import { ensureResumed, getMasterGain } from "./audioContext";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile } from "./streamingCache";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Sound } from "@/lib/schemas";

let currentSource: AudioBufferSourceNode | null = null;
let currentStreamingAudio: HTMLAudioElement | null = null;

export function stopPreview(): void {
  if (currentSource) {
    currentSource.onended = null; // prevent Web Audio double-fire on natural end
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  if (currentStreamingAudio) {
    currentStreamingAudio.pause();
    currentStreamingAudio.currentTime = 0;
    currentStreamingAudio = null;
  }
}

export async function playPreview(sound: Sound, onEnded?: () => void): Promise<void> {
  stopPreview();
  const ctx = await ensureResumed();

  if (await checkIsLargeFile(sound)) {
    // -- Streaming path -------------------------------------------------------
    if (!sound.filePath) throw new MissingFileError(`Sound "${sound.name}" has no file path`);
    const url = convertFileSrc(sound.filePath);
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.src = url;
    const sourceNode = ctx.createMediaElementSource(audio);
    sourceNode.connect(getMasterGain());
    currentStreamingAudio = audio;
    audio.onended = () => {
      if (currentStreamingAudio === audio) currentStreamingAudio = null;
      onEnded?.();
    };
    await audio.play();
  } else {
    // -- Buffer path ----------------------------------------------------------
    const buffer = await loadBuffer(sound);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(getMasterGain());
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      onEnded?.();
    };
    source.start();
    currentSource = source;
  }
}

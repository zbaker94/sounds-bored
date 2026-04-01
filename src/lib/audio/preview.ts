import { convertFileSrc } from "@tauri-apps/api/core";
import { getAudioContext, ensureResumed, getMasterGain } from "./audioContext";
import { MissingFileError } from "@/lib/library.reconcile";

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
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new MissingFileError(`Could not load audio file: ${err}`);
  }
  if (!response.ok) throw new MissingFileError(`Audio file not found (status: ${response.status})`);
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

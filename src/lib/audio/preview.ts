import { ensureResumed, getMasterGain } from "./audioContext";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile } from "./streamingCache";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Sound } from "@/lib/schemas";

let currentSource: AudioBufferSourceNode | null = null;
let currentStreamingAudio: HTMLAudioElement | null = null;
let previewRafId: number | null = null;
// Tracks the last emitted progress so the RAF loop skips no-op store updates,
// mirroring the PROGRESS_EPSILON diff guard used by audioTick.ts.
let prevPreviewProgress = -1;
const PROGRESS_EPSILON = 0.001;

function emitPreviewProgress(value: number): void {
  const clamped = Math.min(1, Math.max(0, value));
  if (Math.abs(clamped - prevPreviewProgress) > PROGRESS_EPSILON) {
    prevPreviewProgress = clamped;
    usePlaybackStore.getState().setPreviewProgress(clamped);
  }
}

function stopPreviewRaf(): void {
  if (previewRafId !== null) {
    cancelAnimationFrame(previewRafId);
    previewRafId = null;
  }
  prevPreviewProgress = -1;
  usePlaybackStore.getState().setPreviewProgress(null);
}

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
  stopPreviewRaf();
  usePlaybackStore.getState().setIsPreviewPlaying(false);
}

export async function playPreview(sound: Sound, onEnded?: () => void): Promise<void> {
  stopPreview();
  const ctx = await ensureResumed();
  usePlaybackStore.getState().setIsPreviewPlaying(true);

  try {
    if (await checkIsLargeFile(sound)) {
      // -- Streaming path -------------------------------------------------------
      if (!sound.filePath) throw new MissingFileError(`Sound "${sound.name}" has no file path`);
      const url = convertFileSrc(sound.filePath);
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = url;
      const sourceNode = ctx.createMediaElementSource(audio);
      sourceNode.connect(getMasterGain());
      currentStreamingAudio = audio;
      audio.onended = () => {
        if (currentStreamingAudio === audio) {
          currentStreamingAudio = null;
          stopPreviewRaf();
          usePlaybackStore.getState().setIsPreviewPlaying(false);
          onEnded?.();
        }
      };
      try {
        await audio.play();
      } catch (err) {
        // play() rejected (autoplay policy, decode error, permission denied, etc.).
        // Tear down the partial audio graph so we don't leak the source node or
        // leave isPreviewPlaying=true with no active voice.
        try { sourceNode.disconnect(); } catch { /* already disconnected */ }
        if (currentStreamingAudio === audio) {
          currentStreamingAudio = null;
        }
        throw err;
      }
      // Start RAF loop after play() resolves successfully.
      const tickStreaming = () => {
        // Guard against stale closure: if the active streaming audio has changed
        // (stopPreview cleared it or another preview started), stop ticking.
        if (currentStreamingAudio !== audio) {
          previewRafId = null;
          return;
        }
        const dur = audio.duration;
        const value = !isFinite(dur) || dur <= 0 ? 0 : audio.currentTime / dur;
        emitPreviewProgress(value);
        previewRafId = requestAnimationFrame(tickStreaming);
      };
      previewRafId = requestAnimationFrame(tickStreaming);
    } else {
      // -- Buffer path ----------------------------------------------------------
      const buffer = await loadBuffer(sound);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(getMasterGain());
      source.onended = () => {
        if (currentSource === source) {
          currentSource = null;
          stopPreviewRaf();
          usePlaybackStore.getState().setIsPreviewPlaying(false);
          onEnded?.();
        }
      };
      const startedAt = ctx.currentTime;
      const duration = buffer.duration;
      // Assign currentSource before start() so onended (which fires asynchronously
      // but could fire during start() on zero-duration buffers) sees the correct source.
      currentSource = source;
      source.start();
      const tickBuffer = () => {
        // Guard against stale closure: if the active source has changed, stop ticking.
        if (currentSource !== source) {
          previewRafId = null;
          return;
        }
        const value = duration <= 0 ? 0 : (ctx.currentTime - startedAt) / duration;
        emitPreviewProgress(value);
        previewRafId = requestAnimationFrame(tickBuffer);
      };
      previewRafId = requestAnimationFrame(tickBuffer);
    }
  } catch (err) {
    // Any failure (loadBuffer, checkIsLargeFile, play rejection, etc.) must not
    // leave isPreviewPlaying=true with no active voice.
    stopPreviewRaf();
    usePlaybackStore.getState().setIsPreviewPlaying(false);
    throw err;
  }
}

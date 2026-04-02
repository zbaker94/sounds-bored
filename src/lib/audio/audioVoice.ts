/**
 * Shared abstraction over the two voice implementations:
 *   - AudioBufferSourceNode  (short files: fully decoded, cached in RAM)
 *   - HTMLAudioElement        (large files: browser-managed streaming)
 *
 * Both satisfy this interface so padPlayer and playbackStore can treat
 * them uniformly without knowing which path was taken.
 */
export interface AudioVoice {
  /** Begin playback. Always returns Promise<void> for consistent awaiting. */
  start(): Promise<void>;
  /** Stop playback immediately. For streaming voices, also fires any pending
   *  onended callback synchronously so retrigger chains can advance. */
  stop(): void;
  /** Register (or clear) the callback to run when playback ends. */
  setOnEnded(cb: (() => void) | null): void;
}

export function wrapBufferSource(source: AudioBufferSourceNode): AudioVoice {
  let endedCb: (() => void) | null = null;

  return {
    start() {
      source.start();
      return Promise.resolve();
    },
    stop() {
      source.onended = null; // prevent double-fire from Web Audio's async event
      try {
        source.stop();
      } catch {
        // Already ended — safe to ignore.
      }
      const cb = endedCb;
      endedCb = null;
      cb?.(); // fire synchronously so "next" retrigger chains advance
    },
    setOnEnded(cb) {
      endedCb = cb;
      source.onended = cb
        ? () => {
            endedCb = null;
            cb();
          }
        : null;
    },
  };
}

export function wrapStreamingElement(audio: HTMLAudioElement): AudioVoice {
  // Kept outside the object literal so stop() can clear it before firing.
  let endedCb: (() => void) | null = null;

  return {
    start() {
      return audio.play();
    },
    stop() {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      const cb = endedCb;
      endedCb = null;
      cb?.(); // fire synchronously so "next" retrigger chains advance
    },
    setOnEnded(cb) {
      endedCb = cb;
      audio.onended = cb
        ? () => {
            endedCb = null;
            cb();
          }
        : null;
    },
  };
}

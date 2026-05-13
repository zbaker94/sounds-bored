export const STOP_RAMP_S = 0.025;

export interface AudioVoice {
  start(): Promise<void>;
  /** Hard/immediate stop. Fires onended synchronously. */
  stop(): void;
  /** Ramp voiceGain → 0 over rampS seconds, then stop. Fires onended async. */
  stopWithRamp(rampS?: number): void;
  /** Set voiceGain directly (0–1). */
  setVolume(v: number): void;
  setOnEnded(cb: (() => void) | null): void;
  /** Update the underlying source loop flag live. For buffer sources, takes effect at the
   *  next loop boundary; for streaming elements, takes effect immediately. */
  setLoop(v: boolean): void;
}

/**
 * Strategy interface for the underlying playback source.
 * Each implementation adapts a specific audio source type
 * (AudioBufferSourceNode or HTMLAudioElement/MediaElementAudioSourceNode)
 * to a common protocol consumed by the shared createVoice() factory.
 */
interface PlayableSource {
  /** Connect the underlying audio graph node to the given destination. */
  connectTo(destination: AudioNode): void;
  /** Start playback. */
  start(): Promise<void>;
  /** Immediately stop playback. endedCb handling is owned by createVoice — do NOT fire it here. */
  stop(): void;
  /** Wire the native source-ended event to the given callback, or null to clear. */
  setNativeOnEnded(cb: (() => void) | null): void;
  /** Update the loop flag on the underlying source. */
  setLoop(v: boolean): void;
  /** Optional post-stop cleanup called after every stop (hard, ramped, or natural end).
   *  Implementations disconnect nodes they own from the audio graph.
   *  The buffer adapter disconnects both the single-use source and voiceGain;
   *  the streaming adapter disconnects only voiceGain because its sourceNode
   *  is cached and reused across triggers (see streamingCache.ts). */
  cleanup?(voiceGain: GainNode): void;
}

/**
 * Shared voice factory. Manages the voiceGain node, endedCb lifecycle, and
 * stop/stopWithRamp scheduling. Source-specific behaviour is delegated to the
 * PlayableSource strategy — this function contains no streaming/buffer-specific logic.
 */
function createVoice(
  source: PlayableSource,
  ctx: AudioContext,
  destination: AudioNode,
  initialVolume = 1.0,
): AudioVoice {
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = initialVolume;
  source.connectTo(voiceGain);
  voiceGain.connect(destination);

  let endedCb: (() => void) | null = null;
  let stopped = false;

  function doStop() {
    if (stopped) return;
    stopped = true;
    source.setNativeOnEnded(null);
    source.stop();
    source.cleanup?.(voiceGain);
    const cb = endedCb;
    endedCb = null;
    cb?.();
  }

  return {
    start: () => source.start(),
    stop: doStop,
    stopWithRamp(rampS = STOP_RAMP_S) {
      // Ramps the per-voice gain node (voiceGain) to zero — intentionally does NOT
      // call markGainRamp, because the audioTick reads padGainMap/layerGainMap, not
      // individual voice gains. Importing audioState here would create a circular
      // dependency (audioVoice ← padPlayer → gainRegistry).
      voiceGain.gain.cancelScheduledValues(ctx.currentTime);
      voiceGain.gain.setValueAtTime(voiceGain.gain.value, ctx.currentTime);
      voiceGain.gain.linearRampToValueAtTime(0, ctx.currentTime + rampS);
      setTimeout(doStop, rampS * 1000 + 5);
    },
    setVolume(v) {
      voiceGain.gain.value = v;
    },
    setOnEnded(cb) {
      endedCb = cb;
      source.setNativeOnEnded(cb ? () => doStop() : null);
    },
    setLoop: (v) => source.setLoop(v),
  };
}

export function wrapBufferSource(
  source: AudioBufferSourceNode,
  ctx: AudioContext,
  destination: AudioNode,
  initialVolume = 1.0,
): AudioVoice {
  const adapter: PlayableSource = {
    connectTo: (dest) => source.connect(dest),
    start: () => { source.start(); return Promise.resolve(); },
    stop: () => { try { source.stop(); } catch { /* already ended */ } },
    setNativeOnEnded: (cb) => { source.onended = cb; },
    setLoop: (v) => { source.loop = v; },
    cleanup: (voiceGain) => {
      try { source.disconnect(); } catch { /* already disconnected */ }
      try { voiceGain.disconnect(); } catch { /* already disconnected */ }
    },
  };
  return createVoice(adapter, ctx, destination, initialVolume);
}

export function wrapStreamingElement(
  audio: HTMLAudioElement,
  sourceNode: MediaElementAudioSourceNode,
  ctx: AudioContext,
  destination: AudioNode,
  initialVolume = 1.0,
): AudioVoice {
  const adapter: PlayableSource = {
    connectTo: (dest) => sourceNode.connect(dest),
    start: () => audio.play(),
    stop: () => { audio.pause(); audio.currentTime = 0; },
    setNativeOnEnded: (cb) => { audio.onended = cb; },
    setLoop: (v) => { audio.loop = v; },
    // sourceNode is cached and reused across triggers (see streamingCache.ts); caller disconnects it before next trigger
    cleanup: (voiceGain) => voiceGain.disconnect(),
  };
  return createVoice(adapter, ctx, destination, initialVolume);
}

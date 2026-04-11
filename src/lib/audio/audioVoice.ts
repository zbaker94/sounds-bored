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

export function wrapBufferSource(
  source: AudioBufferSourceNode,
  ctx: AudioContext,
  destination: AudioNode,
  initialVolume = 1.0,
): AudioVoice {
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = initialVolume;
  source.connect(voiceGain);
  voiceGain.connect(destination);

  let endedCb: (() => void) | null = null;

  return {
    start() {
      source.start();
      return Promise.resolve();
    },
    stop() {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      const cb = endedCb;
      endedCb = null;
      cb?.();
    },
    stopWithRamp(rampS = STOP_RAMP_S) {
      voiceGain.gain.cancelScheduledValues(ctx.currentTime);
      voiceGain.gain.setValueAtTime(voiceGain.gain.value, ctx.currentTime);
      voiceGain.gain.linearRampToValueAtTime(0, ctx.currentTime + rampS);
      setTimeout(() => {
        source.onended = null;
        try { source.stop(); } catch { /* already ended */ }
        const cb = endedCb;
        endedCb = null;
        cb?.();
      }, rampS * 1000 + 5);
    },
    setVolume(v) {
      voiceGain.gain.value = v;
    },
    setOnEnded(cb) {
      endedCb = cb;
      source.onended = cb
        ? () => { endedCb = null; cb(); }
        : null;
    },
    setLoop(v) {
      source.loop = v;
    },
  };
}

export function wrapStreamingElement(
  audio: HTMLAudioElement,
  sourceNode: MediaElementAudioSourceNode,
  ctx: AudioContext,
  destination: AudioNode,
  initialVolume = 1.0,
): AudioVoice {
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = initialVolume;
  sourceNode.connect(voiceGain);
  voiceGain.connect(destination);

  let endedCb: (() => void) | null = null;

  return {
    start() {
      return audio.play();
    },
    stop() {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      voiceGain.disconnect();
      const cb = endedCb;
      endedCb = null;
      cb?.();
    },
    stopWithRamp(rampS = STOP_RAMP_S) {
      voiceGain.gain.cancelScheduledValues(ctx.currentTime);
      voiceGain.gain.setValueAtTime(voiceGain.gain.value, ctx.currentTime);
      voiceGain.gain.linearRampToValueAtTime(0, ctx.currentTime + rampS);
      setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.onended = null;
        voiceGain.disconnect();
        const cb = endedCb;
        endedCb = null;
        cb?.();
      }, rampS * 1000 + 5);
    },
    setVolume(v) {
      voiceGain.gain.value = v;
    },
    setOnEnded(cb) {
      endedCb = cb;
      audio.onended = cb
        ? () => { endedCb = null; cb(); }
        : null;
    },
    setLoop(v) {
      audio.loop = v;
    },
  };
}

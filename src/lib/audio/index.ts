// src/lib/audio/index.ts
// Public facade for the audio engine.
// All code OUTSIDE src/lib/audio/ must import from "@/lib/audio" — not from internal submodules.
// Internal modules (audioState, fadeMixer, etc.) may still import from each other directly.

// ── Orchestration ─────────────────────────────────────────────────────────────
export {
  triggerPad,
  triggerLayer,
  triggerAndFade,
  stopPad,
  stopScene,
  stopAllPads,
  releasePadHoldLayers,
  executeFadeTap,
  executeCrossfadeSelection,
  reverseFade,
  stopFade,
  crossfadePads,
} from "./padPlayer";

// ── Layer control ─────────────────────────────────────────────────────────────
export {
  selectionsEqual,
  syncLayerPlaybackMode,
  syncLayerArrangement,
  syncLayerSelection,
  syncLayerConfig,
  stopLayerWithRamp,
  skipLayerForward,
  skipLayerBack,
  getLayerNormalizedVolume,
} from "./layerTrigger";

// ── Fade and gain control ─────────────────────────────────────────────────────
export {
  freezePadAtCurrentVolume,
  resolveFadeDuration,
  fadePad,
} from "./fadeMixer";

export {
  setPadVolume,
  resetPadGain,
  syncLayerVolume,
  setLayerVolume,
  clampGain01,
} from "./gainManager";

// ── Audio state queries ───────────────────────────────────────────────────────
export {
  clearAllFadeTracking,
  clearAllPadGains,
  clearAllLayerGains,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  isPadFadingOut,
  isPadFading,
  isPadStreaming,
  getPadProgress,
  getPadGain,
  isLayerActive,
  isPadActive,
  clearAllAudioState,
} from "./audioState";

// ── Streaming / buffer caches ─────────────────────────────────────────────────
export {
  preloadStreamingAudio,
  LARGE_FILE_THRESHOLD_BYTES,
  clearAllStreamingElements,
  clearAllSizeCache,
} from "./streamingCache";

export { clearAllBuffers } from "./bufferCache";

export { evictSoundCaches, evictSoundCachesMany } from "./cacheUtils";

// ── Tick and lifecycle ────────────────────────────────────────────────────────
export { stopAudioTick } from "./audioTick";

// ── Preview playback ──────────────────────────────────────────────────────────
export { playPreview, stopPreview } from "./preview";

// ── Error events ──────────────────────────────────────────────────────────────
export { emitAudioError, setAudioErrorHandler } from "./audioEvents";
export type { AudioErrorContext, AudioErrorHandler } from "./audioEvents";

// ── Sound resolution ──────────────────────────────────────────────────────────
export { filterSoundsByTags, filterSoundsBySet, resolveLayerSounds } from "./resolveSounds";

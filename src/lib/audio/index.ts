// src/lib/audio/index.ts
// Public facade for the audio engine.
// All code OUTSIDE src/lib/audio/ must import from "@/lib/audio" — not from internal submodules.
// Internal modules (audioState, fadeMixer, etc.) may still import from each other directly.

// ── Orchestration ─────────────────────────────────────────────────────────────
export {
  triggerPad,
  triggerLayer,
  stopPad,
  stopScene,
  stopAllPads,
  releasePadHoldLayers,
  executeFadeTap,
  reverseFade,
  stopFade,
} from "./padPlayer";

// ── Layer control ─────────────────────────────────────────────────────────────
export {
  syncLayerConfig,
  stopLayerWithRamp,
  skipLayerForward,
  skipLayerBack,
  getLayerNormalizedVolume,
} from "./layerTrigger";

// Test mock targets — consumed only by vi.mock() in *.test.tsx files; must remain
// in the public facade so module-level mocks can intercept them.
// fallow-ignore-next-line unused-export
export { selectionsEqual } from "./layerTrigger";
// fallow-ignore-next-line unused-export
export { syncLayerPlaybackMode } from "./layerTrigger";
// fallow-ignore-next-line unused-export
export { syncLayerArrangement } from "./layerTrigger";
// fallow-ignore-next-line unused-export
export { syncLayerSelection } from "./layerTrigger";

// ── Fade and gain control ─────────────────────────────────────────────────────
export { freezePadAtCurrentVolume } from "./fadeMixer";

// Test mock targets
// fallow-ignore-next-line unused-export
export { resolveFadeDuration } from "./fadeMixer";
// fallow-ignore-next-line unused-export
export { fadePad } from "./fadeMixer";

export {
  setPadVolume,
  resetPadGain,
  syncLayerVolume,
  setLayerVolume,
  clampGain01,
} from "./gainManager";

// ── Audio state queries ───────────────────────────────────────────────────────
export {
  isPadFading,
  isLayerActive,
  isPadActive,
  clearAllAudioState,
} from "./audioState";

// Test mock target
// fallow-ignore-next-line unused-export
export { getPadProgress } from "./audioState";

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

// ── Sound resolution ──────────────────────────────────────────────────────────
export { filterSoundsByTags, filterSoundsBySet, resolveLayerSounds } from "./resolveSounds";

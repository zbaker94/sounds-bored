/**
 * Voice registry — pad/layer voice tracking for the audio engine.
 *
 * Owns the active-voice Maps and the reverse index from pad IDs to layer IDs.
 * Maintains an invariant that every layer voice is also a pad voice, so the
 * reverse index lets stopPadVoices touch only layers belonging to the stopped
 * pad — O(layers_in_pad) instead of O(all_layers).
 *
 * A single voice-set-changed listener slot is used by audioTick to know when
 * to rebuild the active layer set. Mutation sites notify via the private
 * helper rather than incrementing a counter, so future mutation paths
 * automatically signal the listener.
 *
 * This module imports only from ./audioVoice — it does NOT depend on the
 * AudioContext, gain graph, or playbackStore. Callers mirror voice changes
 * to playbackStore at the call site.
 */

import type { AudioVoice } from "./audioVoice";

const voiceMap = new Map<string, AudioVoice[]>();
const layerVoiceMap = new Map<string, AudioVoice[]>();
// Reverse index: pad ID → Set of layer IDs with active voices.
// O(layers_in_pad) for stopPadVoices instead of O(all_layers).
const padToLayerIds = new Map<string, Set<string>>();

type LayerVoiceSetChangedListener = () => void;
let layerVoiceSetChangeListener: LayerVoiceSetChangedListener | null = null;

// INVARIANT: Must be the final statement in every mutation before any external side effects
// (e.g., voice.stop()). All three Maps — voiceMap, layerVoiceMap, padToLayerIds — must
// be in their final post-mutation state before this fires; the listener reads them and
// assumes full consistency.
function notifyLayerVoiceSetChanged(): void {
  layerVoiceSetChangeListener?.();
}

/** Register a listener that fires whenever layerVoiceMap is mutated.
 *  Returns an unsubscribe function. Only one listener slot exists; registering
 *  a second listener replaces the first. This slot is owned exclusively by audioTick —
 *  any other registrant will silently evict it. */
export function onLayerVoiceSetChanged(listener: LayerVoiceSetChangedListener): () => void {
  layerVoiceSetChangeListener = listener;
  return () => { if (layerVoiceSetChangeListener === listener) layerVoiceSetChangeListener = null; };
}

export function isPadActive(padId: string): boolean {
  return (voiceMap.get(padId)?.length ?? 0) > 0;
}

export function isLayerActive(layerId: string): boolean {
  return (layerVoiceMap.get(layerId)?.length ?? 0) > 0;
}

// Internal helpers — only called by recordLayerVoice / clearLayerVoice. External callers
// that bypass the layer functions would break the voiceMap / layerVoiceMap invariant.
export function recordVoice(padId: string, voice: AudioVoice): void {
  voiceMap.set(padId, [...(voiceMap.get(padId) ?? []), voice]);
}

export function clearVoice(padId: string, voice: AudioVoice): void {
  const updated = (voiceMap.get(padId) ?? []).filter((v) => v !== voice);
  if (updated.length === 0) {
    voiceMap.delete(padId);
  } else {
    voiceMap.set(padId, updated);
  }
}

export function recordLayerVoice(padId: string, layerId: string, voice: AudioVoice): void {
  layerVoiceMap.set(layerId, [...(layerVoiceMap.get(layerId) ?? []), voice]);
  let padLayers = padToLayerIds.get(padId);
  if (!padLayers) {
    padLayers = new Set();
    padToLayerIds.set(padId, padLayers);
  }
  padLayers.add(layerId);
  recordVoice(padId, voice);
  notifyLayerVoiceSetChanged();
}

export function clearLayerVoice(padId: string, layerId: string, voice: AudioVoice): void {
  const updated = (layerVoiceMap.get(layerId) ?? []).filter((v) => v !== voice);
  if (updated.length === 0) {
    layerVoiceMap.delete(layerId);
    const padLayers = padToLayerIds.get(padId);
    if (padLayers) {
      padLayers.delete(layerId);
      if (padLayers.size === 0) padToLayerIds.delete(padId);
    }
  } else {
    layerVoiceMap.set(layerId, updated);
  }
  clearVoice(padId, voice);
  notifyLayerVoiceSetChanged();
}

export function stopPadVoices(padId: string): void {
  const voices = voiceMap.get(padId) ?? [];
  const stoppedSet = new Set(voices);
  voiceMap.delete(padId);
  // Use reverse index to touch only layers belonging to this pad — O(layers_in_pad).
  // Per invariant, every layer voice is also a pad voice, so stoppedSet covers all
  // voices in every tracked layer. The `remaining.length > 0` branch is dead under
  // normal operation but kept defensively; when triggered, the layer stays in the
  // index so the reverse-index remains consistent.
  const padLayers = padToLayerIds.get(padId);
  if (padLayers) {
    for (const layerId of padLayers) {
      const remaining = (layerVoiceMap.get(layerId) ?? []).filter((v) => !stoppedSet.has(v));
      if (remaining.length === 0) {
        layerVoiceMap.delete(layerId);
        padLayers.delete(layerId);
      } else {
        layerVoiceMap.set(layerId, remaining);
      }
    }
    if (padLayers.size === 0) padToLayerIds.delete(padId);
  }
  notifyLayerVoiceSetChanged();
  for (const voice of voices) {
    try { voice.stop(); } catch { /* already ended */ }
  }
}

export function stopLayerVoices(padId: string, layerId: string): void {
  const voices = layerVoiceMap.get(layerId) ?? [];
  const stoppedSet = new Set(voices);

  // All three Maps are drained first. Notify fires after all writes so the listener
  // sees consistent state. Notify fires before voice.stop() because stop() can trigger
  // onended synchronously (wrapStreamingElement), re-entering clearLayerVoice — that
  // re-entry is a safe no-op because the maps are already drained.
  layerVoiceMap.delete(layerId);
  const padLayers = padToLayerIds.get(padId);
  if (padLayers) {
    padLayers.delete(layerId);
    if (padLayers.size === 0) padToLayerIds.delete(padId);
  }
  const padVoices = (voiceMap.get(padId) ?? []).filter((v) => !stoppedSet.has(v));
  if (padVoices.length === 0) {
    voiceMap.delete(padId);
  } else {
    voiceMap.set(padId, padVoices);
  }
  notifyLayerVoiceSetChanged();

  for (const voice of voices) {
    try { voice.stop(); } catch { /* already ended */ }
  }
}

export function stopAllVoices(): void {
  // NOTE: Always call padPlayer.stopAllPads() instead of this directly.
  // stopAllPads() ensures chain queues, fade tracking, and gain ramps are
  // handled before voices are stopped.
  const allVoices = [...voiceMap.values()].flat();
  voiceMap.clear();
  layerVoiceMap.clear();
  padToLayerIds.clear();
  notifyLayerVoiceSetChanged();
  for (const voice of allVoices) {
    try { voice.stop(); } catch { /* already ended */ }
  }
}

// Caller MUST update voiceMap and call notifyLayerVoiceSetChanged() after invoking this helper.
function removeVoicesFromLayers(padId: string, voiceSet: Set<AudioVoice>): void {
  const padLayers = padToLayerIds.get(padId);
  if (!padLayers) return;
  for (const layerId of [...padLayers]) {
    const layerVoices = layerVoiceMap.get(layerId) ?? [];
    const remaining = layerVoices.filter(v => !voiceSet.has(v));
    if (remaining.length === 0) {
      layerVoiceMap.delete(layerId);
      padLayers.delete(layerId);
    } else {
      layerVoiceMap.set(layerId, remaining);
    }
  }
  if (padLayers.size === 0) padToLayerIds.delete(padId);
}

/**
 * Stop only the voice objects in the snapshot, scoped to the given pad IDs.
 * Voices added to those pads after the snapshot was taken (new triggers during
 * the ramp window) are left intact in voiceMap and layerVoiceMap.
 *
 * @returns The subset of stoppedPadIds whose voiceMap entry reached zero.
 *   Callers must mirror these to usePlaybackStore.getState().removePlayingPad() —
 *   this function does not write to playbackStore.
 */
export function stopSpecificVoices(voices: readonly AudioVoice[], stoppedPadIds: ReadonlySet<string>): Set<string> {
  const fullyStopped = new Set<string>();
  const voiceSet = new Set<AudioVoice>(voices);
  for (const padId of stoppedPadIds) {
    const padVoices = voiceMap.get(padId) ?? [];
    const remaining = padVoices.filter(v => !voiceSet.has(v));
    if (remaining.length === 0) {
      voiceMap.delete(padId);
      fullyStopped.add(padId);
    } else {
      voiceMap.set(padId, remaining);
    }
    removeVoicesFromLayers(padId, voiceSet);
  }
  notifyLayerVoiceSetChanged();
  for (const voice of voices) {
    try { voice.stop(); } catch { /* already ended */ }
  }
  return fullyStopped;
}

export function getLayerVoices(layerId: string): readonly AudioVoice[] {
  return layerVoiceMap.get(layerId) ?? [];
}

export function nullAllOnEnded(): void {
  for (const voices of voiceMap.values()) {
    for (const voice of voices) {
      voice.setOnEnded(null);
    }
  }
}

/** Null onended callbacks for all voices belonging to a specific pad. */
export function nullPadOnEnded(padId: string): void {
  const voices = voiceMap.get(padId) ?? [];
  for (const voice of voices) {
    voice.setOnEnded(null);
  }
}

/** Snapshot the IDs of all pads with active voices. */
export function getActivePadIds(): Set<string> {
  return new Set(voiceMap.keys());
}

/** Snapshot all currently active voice objects. */
export function getAllVoices(): AudioVoice[] {
  return [...voiceMap.values()].flat();
}

/** Collect the layer IDs owned by the given pad IDs, via the reverse index. */
export function getLayerIdsForPads(padIds: ReadonlySet<string>): Set<string> {
  const layerIds = new Set<string>();
  for (const padId of padIds) {
    const layers = padToLayerIds.get(padId);
    if (layers) for (const layerId of layers) layerIds.add(layerId);
  }
  return layerIds;
}

/** Return the number of pads with active voices. Used by the tick to self-terminate. */
export function getActivePadCount(): number {
  return voiceMap.size;
}

/** Return the Set of currently active layer IDs (layers with at least one voice). */
export function getActiveLayerIdSet(): Set<string> {
  return new Set(layerVoiceMap.keys());
}

export function clearAllVoices(): void {
  voiceMap.clear();
  layerVoiceMap.clear();
  padToLayerIds.clear();
  notifyLayerVoiceSetChanged();
}

/**
 * Reset all voice registry state. For use in test setup only.
 * Does NOT fire the layerVoiceSetChanged listener — use clearAllVoices() in production code paths.
 */
export function clearAll(): void {
  voiceMap.clear();
  layerVoiceMap.clear();
  padToLayerIds.clear();
  layerVoiceSetChangeListener = null;
}

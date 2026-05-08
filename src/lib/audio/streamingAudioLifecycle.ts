/**
 * Streaming audio element lifecycle and best-element cache.
 *
 * Streaming voices use HTMLAudioElement (not AudioBuffer) so duration is not
 * known synchronously at registration. The best-element caches let RAF-driven
 * progress reads (getPadProgress / computeAllLayerProgress) do O(1) lookups
 * instead of nested linear scans. The caches are invalidated only on register/
 * dispose/clearAll plus a one-shot loadedmetadata listener — never on the hot
 * path.
 *
 * Invariants:
 *   - Every element in padBestCache/layerBestCache is also in padStreamingAudio.
 *   - AbortControllers are keyed 1:1 per (element, `${padId}|${layerId}`) and
 *     removed on dispose/clearAll so stale loadedmetadata callbacks cannot update
 *     the caches after an element is replaced or cleared.
 *   - The membership guard inside the loadedmetadata listener is defense-in-depth
 *     in case an AbortController fires late or is bypassed.
 *
 * Public API: register, dispose, clearAll, isPadStreaming, getStreamingElement,
 *   getBestForPad, iterateBestLayers.
 */

// pad ID → layer ID → set of active streaming HTMLAudioElements.
// Multiple voices per layer are possible (simultaneous arrangement).
// Membership here is the source of truth for isPadStreaming and cache validity.
const padStreamingAudio = new Map<string, Map<string, Set<HTMLAudioElement>>>();
const padBestCache = new Map<string, HTMLAudioElement>();
const layerBestCache = new Map<string, HTMLAudioElement>();
const pendingMetadataAborts = new WeakMap<HTMLAudioElement, Map<string, AbortController>>();

function recomputePadBest(padId: string): void {
  const layerMap = padStreamingAudio.get(padId);
  if (!layerMap) { padBestCache.delete(padId); return; }
  let best: HTMLAudioElement | null = null;
  let bestDur = -Infinity;
  for (const audioSet of layerMap.values()) {
    for (const audio of audioSet) {
      const d = isFinite(audio.duration) ? audio.duration : -Infinity;
      if (!best || d > bestDur) { best = audio; bestDur = d; }
    }
  }
  if (best) padBestCache.set(padId, best);
  else padBestCache.delete(padId);
}

function recomputeLayerBest(padId: string, layerId: string): void {
  const audioSet = padStreamingAudio.get(padId)?.get(layerId);
  if (!audioSet || audioSet.size === 0) { layerBestCache.delete(layerId); return; }
  let best: HTMLAudioElement | null = null;
  let bestDur = -Infinity;
  for (const audio of audioSet) {
    const d = isFinite(audio.duration) ? audio.duration : -Infinity;
    if (!best || d > bestDur) { best = audio; bestDur = d; }
  }
  if (best) layerBestCache.set(layerId, best);
  else layerBestCache.delete(layerId);
}

export function register(padId: string, layerId: string, el: HTMLAudioElement): void {
  let padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) {
    padLayerMap = new Map();
    padStreamingAudio.set(padId, padLayerMap);
  }
  const audioSet = padLayerMap.get(layerId) ?? new Set<HTMLAudioElement>();
  audioSet.add(el);
  padLayerMap.set(layerId, audioSet);
  recomputePadBest(padId);
  recomputeLayerBest(padId, layerId);
  if (!isFinite(el.duration)) {
    const key = `${padId}|${layerId}`;
    let controllers = pendingMetadataAborts.get(el);
    if (!controllers) {
      controllers = new Map();
      pendingMetadataAborts.set(el, controllers);
    }
    controllers.get(key)?.abort();
    const ac = new AbortController();
    controllers.set(key, ac);
    const capturedControllers = controllers;
    el.addEventListener("loadedmetadata", () => {
      capturedControllers.delete(key);
      if (padStreamingAudio.get(padId)?.get(layerId)?.has(el)) {
        recomputePadBest(padId);
        recomputeLayerBest(padId, layerId);
      }
    }, { once: true, signal: ac.signal });
  }
}

/**
 * @param el When provided, removes only this element (onended path).
 *   When omitted, removes ALL elements for the (padId, layerId) tuple (retrigger-stop / ramp-stop path).
 */
export function dispose(padId: string, layerId: string, el?: HTMLAudioElement): void {
  const padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) return;
  const audioSet = padLayerMap.get(layerId);
  if (!audioSet) return;
  const key = `${padId}|${layerId}`;
  if (el) {
    const controllers = pendingMetadataAborts.get(el);
    if (controllers) {
      controllers.get(key)?.abort();
      controllers.delete(key);
      if (controllers.size === 0) pendingMetadataAborts.delete(el);
    }
    audioSet.delete(el);
    if (audioSet.size === 0) padLayerMap.delete(layerId);
    if (padLayerMap.size === 0) padStreamingAudio.delete(padId);
    recomputePadBest(padId);
    recomputeLayerBest(padId, layerId);
    return;
  }
  for (const elem of audioSet) {
    const controllers = pendingMetadataAborts.get(elem);
    if (controllers) {
      controllers.get(key)?.abort();
      controllers.delete(key);
      if (controllers.size === 0) pendingMetadataAborts.delete(elem);
    }
  }
  padLayerMap.delete(layerId);
  if (padLayerMap.size === 0) padStreamingAudio.delete(padId);
  layerBestCache.delete(layerId);
  recomputePadBest(padId);
}

export function clearAll(): void {
  for (const [padId, padLayerMap] of padStreamingAudio) {
    for (const [layerId, audioSet] of padLayerMap) {
      const key = `${padId}|${layerId}`;
      for (const el of audioSet) {
        const controllers = pendingMetadataAborts.get(el);
        if (controllers) {
          controllers.get(key)?.abort();
          controllers.delete(key);
          if (controllers.size === 0) pendingMetadataAborts.delete(el);
        }
      }
    }
  }
  padStreamingAudio.clear();
  padBestCache.clear();
  layerBestCache.clear();
}

export function isPadStreaming(padId: string): boolean {
  const padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) return false;
  for (const audioSet of padLayerMap.values()) {
    if (audioSet.size > 0) return true;
  }
  return false;
}

/** Returns the best streaming element for the given layer, or undefined if none is tracked.
 *  padId is used only as a precondition guard — layer IDs are globally unique,
 *  so the returned element is the best across that layer regardless of which pad owns it. */
export function getStreamingElement(padId: string, layerId: string): HTMLAudioElement | undefined {
  const audioSet = padStreamingAudio.get(padId)?.get(layerId);
  if (!audioSet || audioSet.size === 0) return undefined;
  return layerBestCache.get(layerId);
}

export function getBestForPad(padId: string): HTMLAudioElement | undefined {
  return padBestCache.get(padId);
}

/** Yields [layerId, bestElement] for all layers with active streaming elements.
 *  Do NOT call register/dispose/clearAll while iterating — the iterator walks the live cache. */
export function* iterateBestLayers(): IterableIterator<[string, HTMLAudioElement]> {
  for (const [layerId, el] of layerBestCache) {
    yield [layerId, el];
  }
}

/**
 * audioState.ts — pad/layer progress tracking and stop-cleanup timeout tracking.
 *
 * INVARIANT: Never call stopAllVoices() without first clearing chain queues and
 *   fade tracking — voice.stop() fires onended synchronously which reads
 *   LayerPlaybackContext.chainQueue; clearing first prevents chain restarts.
 *
 * INVARIANT: Always use padPlayer.stopAllPads() as the single stop entry point.
 */

import { getAudioContext } from "./audioContext";
import { getBestForPad, iterateBestLayers, clearAll as clearAllStreamingAudio, hasAnyStreamingPad, hasAnyStreamingLayer } from "./streamingAudioLifecycle";
import { isGainRampPending, clearAll as clearAllGainRegistry, resetGainRampDeadline } from "./gainRegistry";
import { getActivePadIds, nullAllOnEnded, stopAllVoices } from "./voiceRegistry";
import { clearAll as clearAllChainCycleState } from "./chainCycleState";
import { clearAllFades, isAnyFadeActive } from "./fadeCoordinator";
import {
  type LayerProgressInfo,
  ensureLayerContext,
  getLayerContext,
  clearLayerContextProgress,
  clearAllLayerContextProgress,
  getAllLayerContextEntries,
} from "./layerPlaybackContext";

const padProgressInfo = new Map<string, { startedAt: number; duration: number; isLooping: boolean }>();

let globalStopTimeoutId: ReturnType<typeof setTimeout> | null = null;
const pendingStopCleanupTimeouts = new Set<ReturnType<typeof setTimeout>>();

export function isAnyGainChanging(): boolean {
  if (isAnyFadeActive()) return true;
  return isGainRampPending();
}

// Pass `currentTime` when computing progress for multiple pads in one RAF frame.
export function getPadProgress(padId: string, currentTime?: number): number | null {
  const info = padProgressInfo.get(padId);
  if (info) {
    const t = currentTime ?? getAudioContext().currentTime;
    const elapsed = t - info.startedAt;
    if (info.isLooping && info.duration > 0) {
      return (elapsed % info.duration) / info.duration;
    }
    return Math.min(1, Math.max(0, elapsed / info.duration));
  }
  const best = getBestForPad(padId);
  if (best !== undefined) {
    const d = best.duration;
    if (d > 0 && isFinite(d)) {
      return Math.min(1, Math.max(0, best.currentTime / d));
    }
    return 0;
  }
  return null;
}

export function computeAllPadProgress(): Record<string, number> {
  if (padProgressInfo.size === 0 && !hasAnyStreamingPad()) return {};
  const activePadIds = getActivePadIds();
  if (activePadIds.size === 0) return {};
  const currentTime = getAudioContext().currentTime;
  const result: Record<string, number> = {};
  for (const padId of activePadIds) {
    const progress = getPadProgress(padId, currentTime);
    if (progress !== null) result[padId] = progress;
  }
  return result;
}

export function computeAllLayerProgress(): Record<string, number> {
  // Check if any context has progressInfo, or if streaming layers exist
  let hasAnyProgress = false;
  for (const [, ctx] of getAllLayerContextEntries()) {
    if (ctx.progressInfo !== undefined) { hasAnyProgress = true; break; }
  }
  if (!hasAnyProgress && !hasAnyStreamingLayer()) return {};

  const result: Record<string, number> = {};
  if (hasAnyProgress) {
    const ctx = getAudioContext();
    for (const [layerId, layerCtx] of getAllLayerContextEntries()) {
      const info = layerCtx.progressInfo;
      if (!info) continue;
      const elapsed = ctx.currentTime - info.startedAt;
      if (info.isLooping && info.duration > 0) {
        result[layerId] = (elapsed % info.duration) / info.duration;
      } else {
        result[layerId] = Math.min(1, Math.max(0, elapsed / info.duration));
      }
    }
  }
  for (const [layerId, best] of iterateBestLayers()) {
    if (layerId in result) continue;
    const d = best.duration;
    result[layerId] = d > 0 && isFinite(d) ? Math.min(1, Math.max(0, best.currentTime / d)) : 0;
  }
  return result;
}

export function setPadProgressInfo(padId: string, info: { startedAt: number; duration: number; isLooping: boolean }): void {
  padProgressInfo.set(padId, info);
}

export function getPadProgressInfo(padId: string): { startedAt: number; duration: number; isLooping: boolean } | undefined {
  return padProgressInfo.get(padId);
}

export function clearPadProgressInfo(padId: string): void {
  padProgressInfo.delete(padId);
}

export function clearAllPadProgressInfo(): void {
  padProgressInfo.clear();
}

export function setLayerProgressInfo(layerId: string, info: LayerProgressInfo): void {
  ensureLayerContext(layerId).progressInfo = info;
}

export function getLayerProgressInfo(layerId: string): LayerProgressInfo | undefined {
  return getLayerContext(layerId)?.progressInfo;
}

export function clearLayerProgressInfo(layerId: string): void {
  clearLayerContextProgress(layerId);
}

export function clearAllLayerProgressInfo(): void {
  clearAllLayerContextProgress();
}

export function setGlobalStopTimeout(id: ReturnType<typeof setTimeout>): void {
  globalStopTimeoutId = id;
}

export function cancelGlobalStopTimeout(): void {
  if (globalStopTimeoutId !== null) {
    clearTimeout(globalStopTimeoutId);
    globalStopTimeoutId = null;
  }
}

export function addStopCleanupTimeout(id: ReturnType<typeof setTimeout>): void {
  pendingStopCleanupTimeouts.add(id);
}

export function deleteStopCleanupTimeout(id: ReturnType<typeof setTimeout>): void {
  pendingStopCleanupTimeouts.delete(id);
}

function clearAllStopCleanupTimeouts(): void {
  for (const id of pendingStopCleanupTimeouts) clearTimeout(id);
  pendingStopCleanupTimeouts.clear();
}

export function clearAllAudioState(): void {
  // Reset gain ramp deadline first so isAnyGainChanging() reports false during teardown.
  resetGainRampDeadline();
  cancelGlobalStopTimeout();
  clearAllStopCleanupTimeouts();
  // Clear chains + fades before stopping voices — prevents onended from restarting chains.
  // clearAllChainCycleState() zeroes chain/cycle/pending/failure fields only;
  // context entries and layer GainNodes remain intact so voices stop against a valid graph.
  clearAllFades();
  clearAllChainCycleState();
  nullAllOnEnded();
  clearAllStreamingAudio();
  clearAllPadProgressInfo();
  clearAllLayerProgressInfo();
  // stopAllVoices() runs while layer GainNodes are still connected — original invariant preserved.
  // clearAllGainRegistry() then disconnects pad GainNodes, limiters, and all layer contexts.
  stopAllVoices();
  clearAllGainRegistry();
}

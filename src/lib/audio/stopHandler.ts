/**
 * stopHandler.ts — Synchronous engine teardown for pad and all-pad stop paths.
 *
 * Owns the ordering invariant: chain queues and fade tracking must be cleared
 * before any voice.stop() call. voice.stop() fires onended synchronously;
 * if chain state is not cleared first, onended advances the chain and restarts
 * sounds despite the stop request.
 *
 * stopAllPads: pre-ramp teardown sequence. Call before the gain ramp in padPlayer.
 * stopPad: single-pad synchronous teardown. Call before removing the pad from stores.
 */

import type { Pad } from "@/lib/schemas";
import { clearAllFades } from "./fadeCoordinator";
import {
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  clearAllLayerPlayOrders,
  clearAllLayerPending,
} from "./chainCycleState";
import { nullAllOnEnded, nullPadOnEnded, stopPadVoices } from "./voiceRegistry";
import { stopAudioTick } from "./audioTick";

// Chain queues and fade tracking must be cleared before voice.stop() fires — voice.stop()
// triggers onended synchronously, which reads chainCycleState; clearing first prevents
// onended from restarting chains or advancing fade sequences.
export function stopAllPads(): void {
  clearAllFades();
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllLayerPlayOrders();
  clearAllLayerPending();
  nullAllOnEnded();
  stopAudioTick();
}

// Same invariant as stopAllPads: per-layer chain state must be cleared before voice.stop().
// Also nulls onended for the pad's voices as a defense-in-depth measure — the original
// stopPadInternal in fadeMixer did not do this, but the synchronous onended risk applies here too.
export function stopPad(pad: Pad): void {
  for (const layer of pad.layers) {
    deleteLayerChain(layer.id);
    deleteLayerCycleIndex(layer.id);
    deleteLayerPlayOrder(layer.id);
  }
  nullPadOnEnded(pad.id);
  stopPadVoices(pad.id);
}

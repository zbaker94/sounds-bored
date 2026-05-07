import { useEffect, useRef, useState } from "react";
import { usePadMetricsStore } from "@/state/padMetricsStore";

export interface PadVolumeDisplay {
  showVolumeDisplay: boolean;
  volumeExiting: boolean;
  displayVolume: number;
}

/**
 * Manages volume bar display state for a pad button.
 *
 * Subscribes to padVolumes[padId] from padMetricsStore and coordinates:
 * - A 300ms stability timer to detect when a fade has settled
 * - A 450ms linger then 220ms fade-out sequence when volume becomes inactive
 *
 * @param padId - The pad ID to watch in padMetricsStore
 * @param isDragging - Whether the user is actively dragging the volume slider
 * @param dragVolume - The instantaneous drag volume (0–1), or null when not dragging
 * @param defaultVolume - Fallback volume (0–1) when no live or drag volume is present
 */
export function usePadVolumeDisplay(
  padId: string,
  isDragging: boolean,
  dragVolume: number | null,
  defaultVolume: number,
): PadVolumeDisplay {
  // padVolumes entry exists only when tick sees gain < 0.999 — absence means full volume
  const liveVolume = usePadMetricsStore((s) => s.padVolumes[padId]);

  // liveVolumeChanging: true while an audio fade is actively running (liveVolume changing each frame).
  // A stability timer fires 300ms after liveVolume stops changing — at that point the volume has
  // settled and the bar should start its linger-then-hide sequence.
  // isDragging suppresses the stability timer so a pause mid-drag doesn't prematurely hide the bar.
  const [liveVolumeChanging, setLiveVolumeChanging] = useState(false);
  const liveVolumeStabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isDragging) {
      // Drag active — show bar, cancel any pending stability timer
      setLiveVolumeChanging(true);
      if (liveVolumeStabilityTimerRef.current !== null) {
        clearTimeout(liveVolumeStabilityTimerRef.current);
        liveVolumeStabilityTimerRef.current = null;
      }
      return;
    }
    if (liveVolume !== undefined) {
      // Non-drag volume change (audio fade) — show bar, reset stability timer
      setLiveVolumeChanging(true);
      if (liveVolumeStabilityTimerRef.current !== null) clearTimeout(liveVolumeStabilityTimerRef.current);
      liveVolumeStabilityTimerRef.current = setTimeout(() => {
        liveVolumeStabilityTimerRef.current = null;
        setLiveVolumeChanging(false);
      }, 300);
    } else {
      // Volume returned to full or pad stopped — clear immediately
      if (liveVolumeStabilityTimerRef.current !== null) {
        clearTimeout(liveVolumeStabilityTimerRef.current);
        liveVolumeStabilityTimerRef.current = null;
      }
      setLiveVolumeChanging(false);
    }
    return () => {
      if (liveVolumeStabilityTimerRef.current !== null) {
        clearTimeout(liveVolumeStabilityTimerRef.current);
        liveVolumeStabilityTimerRef.current = null;
      }
    };
  }, [liveVolume, isDragging]);

  // isVolumeActive: true while volume is actively changing (drag or audio fade).
  // Goes false when drag ends or volume stabilizes → triggers the linger-then-hide sequence.
  const isVolumeActive = isDragging || liveVolumeChanging;
  const [showVolumeDisplay, setShowVolumeDisplay] = useState(false);
  const [volumeExiting, setVolumeExiting] = useState(false);
  const volumeFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep defaultVolume in a ref so the hide-timeout closure reads the latest value.
  // This is updated on every render — safe because it's a ref write, not state.
  const defaultVolumeRef = useRef(defaultVolume);
  defaultVolumeRef.current = defaultVolume;

  // Mutating a ref during render is intentional here: we need the most recent
  // liveVolume/dragVolume synchronously when computing displayVolume below, without
  // adding them as useState (which would delay by one render) or useEffect (async).
  // React Strict Mode's double-render is safe because refs persist across both calls
  // and the second write is idempotent with the first.
  // Initialized to defaultVolume (not 1.0) so cross-session fallback agrees with
  // the back-face slider, which also falls back to pad.volume when liveVolume is absent.
  const lastVolumeRef = useRef(liveVolume ?? defaultVolume);
  if (liveVolume !== undefined) lastVolumeRef.current = liveVolume;
  if (dragVolume !== null) lastVolumeRef.current = dragVolume;
  // During a drag, prefer dragVolume (updated synchronously on every pointer move) over
  // liveVolume (tick-driven, up to one RAF frame stale). Fallback to last seen tick value.
  const displayVolume = isDragging && dragVolume !== null
    ? dragVolume
    : (liveVolume ?? dragVolume ?? lastVolumeRef.current);

  useEffect(() => {
    if (isVolumeActive) {
      if (volumeFadeTimerRef.current !== null) {
        clearTimeout(volumeFadeTimerRef.current);
        volumeFadeTimerRef.current = null;
      }
      if (volumeHideTimerRef.current !== null) {
        clearTimeout(volumeHideTimerRef.current);
        volumeHideTimerRef.current = null;
      }
      setShowVolumeDisplay(true);
      setVolumeExiting(false);
    } else {
      volumeFadeTimerRef.current = setTimeout(() => {
        volumeFadeTimerRef.current = null;
        setVolumeExiting(true);
        volumeHideTimerRef.current = setTimeout(() => {
          volumeHideTimerRef.current = null;
          setShowVolumeDisplay(false);
          setVolumeExiting(false);
          // Reset for the next display cycle so stale cross-session values don't
          // persist — next show will start from the schema default (same fallback
          // the back-face slider uses), not from a previous play session's volume.
          lastVolumeRef.current = defaultVolumeRef.current;
        }, 220);
      }, 450);
    }
    return () => {
      if (volumeFadeTimerRef.current !== null) {
        clearTimeout(volumeFadeTimerRef.current);
        volumeFadeTimerRef.current = null;
      }
      if (volumeHideTimerRef.current !== null) {
        clearTimeout(volumeHideTimerRef.current);
        volumeHideTimerRef.current = null;
      }
    };
  }, [isVolumeActive]);

  return { showVolumeDisplay, volumeExiting, displayVolume };
}

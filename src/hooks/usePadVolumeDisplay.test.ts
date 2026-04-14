import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { usePadVolumeDisplay } from "./usePadVolumeDisplay";

const PAD_ID = "pad-1";

beforeEach(() => {
  vi.useFakeTimers();
  usePlaybackStore.setState({ ...initialPlaybackState });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePadVolumeDisplay", () => {
  describe("initial state", () => {
    it("starts with display hidden and full volume", () => {
      const { result } = renderHook(() =>
        usePadVolumeDisplay(PAD_ID, false, null)
      );
      expect(result.current.showVolumeDisplay).toBe(false);
      expect(result.current.volumeExiting).toBe(false);
      expect(result.current.displayVolume).toBe(1.0);
    });
  });

  describe("drag volume", () => {
    it("shows display immediately when dragging starts", () => {
      const { result, rerender } = renderHook(
        ({ isDragging, dragVolume }: { isDragging: boolean; dragVolume: number | null }) =>
          usePadVolumeDisplay(PAD_ID, isDragging, dragVolume),
        { initialProps: { isDragging: false, dragVolume: null as number | null } }
      );
      expect(result.current.showVolumeDisplay).toBe(false);
      rerender({ isDragging: true, dragVolume: 0.5 });
      expect(result.current.showVolumeDisplay).toBe(true);
      expect(result.current.displayVolume).toBe(0.5);
    });

    it("prefers dragVolume over liveVolume while dragging", () => {
      usePlaybackStore.setState({
        ...initialPlaybackState,
        padVolumes: { [PAD_ID]: 0.8 },
      });
      const { result } = renderHook(() =>
        usePadVolumeDisplay(PAD_ID, true, 0.3)
      );
      // dragVolume takes precedence
      expect(result.current.displayVolume).toBe(0.3);
    });

    it("starts linger timer when dragging stops (isVolumeActive → false)", () => {
      const { result, rerender } = renderHook(
        ({ isDragging, dragVolume }: { isDragging: boolean; dragVolume: number | null }) =>
          usePadVolumeDisplay(PAD_ID, isDragging, dragVolume),
        { initialProps: { isDragging: true, dragVolume: 0.5 as number | null } }
      );
      expect(result.current.showVolumeDisplay).toBe(true);
      // Stop dragging — linger timer starts (450ms)
      rerender({ isDragging: false, dragVolume: null });
      expect(result.current.showVolumeDisplay).toBe(true);
      expect(result.current.volumeExiting).toBe(false);
      // After 450ms: exiting phase starts
      act(() => { vi.advanceTimersByTime(450); });
      expect(result.current.volumeExiting).toBe(true);
      // After another 220ms: display hidden
      act(() => { vi.advanceTimersByTime(220); });
      expect(result.current.showVolumeDisplay).toBe(false);
      expect(result.current.volumeExiting).toBe(false);
    });
  });

  describe("audio fade (liveVolume from store)", () => {
    it("shows display when liveVolume appears in store", () => {
      const { result } = renderHook(() =>
        usePadVolumeDisplay(PAD_ID, false, null)
      );
      act(() => {
        usePlaybackStore.getState().setAudioTick({
          padVolumes: { [PAD_ID]: 0.6 },
        });
      });
      expect(result.current.showVolumeDisplay).toBe(true);
      expect(result.current.displayVolume).toBe(0.6);
    });

    it("starts stability timer (300ms) when liveVolume stops changing", () => {
      const { result } = renderHook(() =>
        usePadVolumeDisplay(PAD_ID, false, null)
      );
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: { [PAD_ID]: 0.7 } });
      });
      // Stability timer: 300ms without a new liveVolume value
      act(() => { vi.advanceTimersByTime(300); });
      // liveVolumeChanging → false; but liveVolume is still 0.7 in store
      // so isVolumeActive goes false, starting the 450ms linger timer
      act(() => { vi.advanceTimersByTime(450); });
      expect(result.current.volumeExiting).toBe(true);
    });

    it("hides display after full linger + fade sequence from store update", () => {
      const { result } = renderHook(() =>
        usePadVolumeDisplay(PAD_ID, false, null)
      );
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: { [PAD_ID]: 0.5 } });
      });
      // Remove liveVolume (pad stopped / volume back to full).
      // When liveVolume goes undefined the stability timer is cleared immediately
      // (no 300ms wait), so isVolumeActive becomes false right away.
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: {} });
      });
      // 450ms linger → volumeExiting = true
      act(() => { vi.advanceTimersByTime(450); });
      expect(result.current.volumeExiting).toBe(true);
      // 220ms fade-out → display hidden
      act(() => { vi.advanceTimersByTime(220); });
      expect(result.current.showVolumeDisplay).toBe(false);
    });

    it("does not start linger when padVolumes clears while bar was never shown (no-op)", () => {
      // Simulate the engine-layer fix: padVolumes cleared synchronously when pad stops,
      // so liveVolume was never set before the hook mounted.
      const { result } = renderHook(() =>
        usePadVolumeDisplay(PAD_ID, false, null)
      );
      // Bar was never showing (padVolumes was never set)
      expect(result.current.showVolumeDisplay).toBe(false);
      // padVolumes clears (no-op — was never set)
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: {} });
      });
      act(() => { vi.advanceTimersByTime(450 + 220); });
      // Still hidden — no linger should fire
      expect(result.current.showVolumeDisplay).toBe(false);
    });

    it("cancels pending linger timer when drag resumes during linger", () => {
      const { result, rerender } = renderHook(
        ({ isDragging, dragVolume }: { isDragging: boolean; dragVolume: number | null }) =>
          usePadVolumeDisplay(PAD_ID, isDragging, dragVolume),
        { initialProps: { isDragging: true, dragVolume: 0.4 as number | null } }
      );
      rerender({ isDragging: false, dragVolume: null });
      // In linger window (300ms before exit starts)
      act(() => { vi.advanceTimersByTime(200); });
      expect(result.current.volumeExiting).toBe(false);
      // Resume drag — should cancel linger timer and stay shown
      rerender({ isDragging: true, dragVolume: 0.6 });
      act(() => { vi.advanceTimersByTime(500); }); // well past original 450ms linger
      expect(result.current.showVolumeDisplay).toBe(true);
      expect(result.current.volumeExiting).toBe(false);
    });

    it("clears pending stability timer when liveVolume disappears mid-fade", () => {
      // Scenario: pad is playing with a fade, bar is visible, stability timer is running.
      // Pad stops → clearVoice clears padVolumes synchronously → liveVolume goes undefined.
      // The stability timer must be cancelled immediately (not fire 300ms later).
      const { result } = renderHook(() =>
        usePadVolumeDisplay(PAD_ID, false, null)
      );
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: { [PAD_ID]: 0.4 } });
      });
      expect(result.current.showVolumeDisplay).toBe(true);
      // Mid-stability-timer window (150ms in, 150ms before it fires)
      act(() => { vi.advanceTimersByTime(150); });
      // Pad stops — padVolumes cleared synchronously by clearVoice
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: {} });
      });
      // liveVolumeChanging cleared immediately (stability timer cancelled, not rescheduled)
      // isVolumeActive → false → linger starts
      act(() => { vi.advanceTimersByTime(450); });
      expect(result.current.volumeExiting).toBe(true);
      act(() => { vi.advanceTimersByTime(220); });
      expect(result.current.showVolumeDisplay).toBe(false);
    });

    it("cancels linger timer when drag starts during linger phase after pad stop", () => {
      // Pad was playing, bar visible, drag ends → linger starts.
      // Before linger finishes, pad stops → padVolumes cleared.
      // The linger should be cancelled and the bar should hide once the linger completes
      // (but the bar was already showing due to drag, so the linger runs).
      const { result, rerender } = renderHook(
        ({ isDragging, dragVolume }: { isDragging: boolean; dragVolume: number | null }) =>
          usePadVolumeDisplay(PAD_ID, isDragging, dragVolume),
        { initialProps: { isDragging: true, dragVolume: 0.5 as number | null } }
      );
      // Drag ends — linger starts
      rerender({ isDragging: false, dragVolume: null });
      act(() => { vi.advanceTimersByTime(200); }); // mid-linger
      expect(result.current.volumeExiting).toBe(false);
      // Resume drag — cancels linger, bar stays
      rerender({ isDragging: true, dragVolume: 0.6 });
      act(() => { vi.advanceTimersByTime(500); }); // would have been past the original linger
      expect(result.current.showVolumeDisplay).toBe(true);
      expect(result.current.volumeExiting).toBe(false);
    });

    it("re-shows bar on rapid re-trigger after natural end", () => {
      // Verifies that after a pad stops (padVolumes cleared) and re-triggers,
      // a new fade correctly shows the bar again.
      const { result } = renderHook(() =>
        usePadVolumeDisplay(PAD_ID, false, null)
      );
      // First trigger: fade shows bar
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: { [PAD_ID]: 0.5 } });
      });
      expect(result.current.showVolumeDisplay).toBe(true);
      // Pad stops → padVolumes cleared by engine (synchronous)
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: {} });
      });
      // linger runs, bar eventually hides
      act(() => { vi.advanceTimersByTime(450 + 220); });
      expect(result.current.showVolumeDisplay).toBe(false);
      // Re-trigger: new fade
      act(() => {
        usePlaybackStore.getState().setAudioTick({ padVolumes: { [PAD_ID]: 0.6 } });
      });
      expect(result.current.showVolumeDisplay).toBe(true);
      expect(result.current.displayVolume).toBe(0.6);
    });
  });

  describe("cleanup on unmount", () => {
    it("clears pending timers when unmounted during linger phase", () => {
      const { result, rerender, unmount } = renderHook(
        ({ isDragging, dragVolume }: { isDragging: boolean; dragVolume: number | null }) =>
          usePadVolumeDisplay(PAD_ID, isDragging, dragVolume),
        { initialProps: { isDragging: true, dragVolume: 0.5 as number | null } }
      );
      rerender({ isDragging: false, dragVolume: null });
      // Timers are pending
      expect(result.current.showVolumeDisplay).toBe(true);
      // Unmount — should not throw or schedule new state updates
      expect(() => {
        unmount();
        act(() => { vi.runAllTimers(); });
      }).not.toThrow();
    });
  });
});

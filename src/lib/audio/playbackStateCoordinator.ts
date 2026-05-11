import { usePlaybackStore } from '@/state/playbackStore';
import { usePadDisplayStore } from '@/state/padDisplayStore';
import type { PadVoiceInput } from '@/state/padDisplayStore';

export function padStarted(padId: string): void {
  usePlaybackStore.getState().addPlayingPad(padId);
}

export function padStopped(padId: string): void {
  usePlaybackStore.getState().removePlayingPad(padId);
}

export function padReversing(padId: string): void {
  usePlaybackStore.getState().addReversingPad(padId);
}

export function padStoppedReversing(padId: string): void {
  usePlaybackStore.getState().removeReversingPad(padId);
}

export function voiceEnqueued(padId: string, voice: PadVoiceInput): void {
  usePadDisplayStore.getState().enqueueVoice(padId, voice);
}

export function voiceDequeued(padId: string): void {
  usePadDisplayStore.getState().shiftVoice(padId);
}

export function clearPadMetadata(padId: string): void {
  usePadDisplayStore.getState().clearPadDisplay(padId);
}

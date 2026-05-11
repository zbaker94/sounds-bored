import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore, initialPlaybackState } from '@/state/playbackStore';
import { usePadDisplayStore, initialPadDisplayState, _resetVoiceSeq } from '@/state/padDisplayStore';
import {
  padStarted,
  padStopped,
  padReversing,
  padStoppedReversing,
  voiceEnqueued,
  voiceDequeued,
  clearPadMetadata,
} from './playbackStateCoordinator';

beforeEach(() => {
  usePlaybackStore.setState({ ...initialPlaybackState });
  usePadDisplayStore.setState({ ...initialPadDisplayState });
  _resetVoiceSeq();
});

describe('padStarted', () => {
  it('adds padId to playingPadIds', () => {
    padStarted('pad-1');
    expect(usePlaybackStore.getState().playingPadIds.has('pad-1')).toBe(true);
  });

  it('does not affect other pads', () => {
    padStarted('pad-1');
    expect(usePlaybackStore.getState().playingPadIds.has('pad-2')).toBe(false);
  });

  it('does not mutate unrelated store fields', () => {
    padStarted('pad-1');
    const s = usePlaybackStore.getState();
    expect(s.fadingPadIds.size).toBe(0);
    expect(s.fadingOutPadIds.size).toBe(0);
    expect(s.reversingPadIds.size).toBe(0);
  });
});

describe('padStopped', () => {
  it('removes padId from playingPadIds', () => {
    usePlaybackStore.getState().addPlayingPad('pad-1');
    padStopped('pad-1');
    expect(usePlaybackStore.getState().playingPadIds.has('pad-1')).toBe(false);
  });

  it('is a no-op for absent padId', () => {
    padStopped('pad-x');
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
  });

  it('does not affect other playing pads', () => {
    usePlaybackStore.getState().addPlayingPad('pad-1');
    usePlaybackStore.getState().addPlayingPad('pad-2');
    padStopped('pad-1');
    expect(usePlaybackStore.getState().playingPadIds.has('pad-2')).toBe(true);
  });

  it('does not clear pad display metadata', () => {
    usePadDisplayStore.getState().enqueueVoice('pad-1', {
      soundName: 'test',
      layerName: 'layer',
      playbackMode: 'one-shot',
      durationMs: 1000,
    });
    padStopped('pad-1');
    expect(usePadDisplayStore.getState().currentVoice['pad-1']).not.toBeNull();
  });
});

describe('padReversing', () => {
  it('adds padId to reversingPadIds', () => {
    padReversing('pad-1');
    expect(usePlaybackStore.getState().reversingPadIds.has('pad-1')).toBe(true);
  });

  it('does not affect other pads', () => {
    padReversing('pad-1');
    expect(usePlaybackStore.getState().reversingPadIds.has('pad-2')).toBe(false);
  });

  it('does not mutate unrelated store fields', () => {
    padReversing('pad-1');
    const s = usePlaybackStore.getState();
    expect(s.playingPadIds.size).toBe(0);
    expect(s.fadingPadIds.size).toBe(0);
    expect(s.fadingOutPadIds.size).toBe(0);
  });
});

describe('padStoppedReversing', () => {
  it('removes padId from reversingPadIds', () => {
    usePlaybackStore.getState().addReversingPad('pad-1');
    padStoppedReversing('pad-1');
    expect(usePlaybackStore.getState().reversingPadIds.has('pad-1')).toBe(false);
  });

  it('is a no-op for absent padId', () => {
    padStoppedReversing('pad-x');
    expect(usePlaybackStore.getState().reversingPadIds.size).toBe(0);
  });

  it('does not affect other reversing pads', () => {
    usePlaybackStore.getState().addReversingPad('pad-1');
    usePlaybackStore.getState().addReversingPad('pad-2');
    padStoppedReversing('pad-1');
    expect(usePlaybackStore.getState().reversingPadIds.has('pad-2')).toBe(true);
  });
});

describe('voiceEnqueued', () => {
  const voice = {
    soundName: 'kick',
    layerName: 'Layer 1',
    playbackMode: 'one-shot' as const,
    durationMs: 500,
  };

  it('sets currentVoice when empty', () => {
    voiceEnqueued('pad-1', voice);
    const current = usePadDisplayStore.getState().currentVoice['pad-1'];
    expect(current?.soundName).toBe('kick');
    expect(current?.layerName).toBe('Layer 1');
  });

  it('queues voice when currentVoice already set', () => {
    voiceEnqueued('pad-1', voice);
    voiceEnqueued('pad-1', { ...voice, soundName: 'snare' });
    const queue = usePadDisplayStore.getState().voiceQueue['pad-1'];
    expect(queue).toHaveLength(1);
    expect(queue[0].soundName).toBe('snare');
  });

  it('does not affect other pads', () => {
    voiceEnqueued('pad-1', voice);
    expect(usePadDisplayStore.getState().currentVoice['pad-2']).toBeUndefined();
  });

  it('does not mutate playbackStore', () => {
    voiceEnqueued('pad-1', voice);
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
  });
});

describe('voiceDequeued', () => {
  const voice = {
    soundName: 'kick',
    layerName: 'Layer 1',
    playbackMode: 'one-shot' as const,
    durationMs: 500,
  };

  it('promotes next queued voice to currentVoice', () => {
    usePadDisplayStore.getState().enqueueVoice('pad-1', voice);
    usePadDisplayStore.getState().enqueueVoice('pad-1', { ...voice, soundName: 'snare' });
    voiceDequeued('pad-1');
    expect(usePadDisplayStore.getState().currentVoice['pad-1']?.soundName).toBe('snare');
  });

  it('sets currentVoice to null when queue empty', () => {
    usePadDisplayStore.getState().enqueueVoice('pad-1', voice);
    voiceDequeued('pad-1');
    expect(usePadDisplayStore.getState().currentVoice['pad-1']).toBeNull();
  });

  it('does not affect other pads', () => {
    usePadDisplayStore.getState().enqueueVoice('pad-1', voice);
    usePadDisplayStore.getState().enqueueVoice('pad-2', { ...voice, soundName: 'hi-hat' });
    voiceDequeued('pad-1');
    expect(usePadDisplayStore.getState().currentVoice['pad-2']?.soundName).toBe('hi-hat');
  });
});

describe('clearPadMetadata', () => {
  const voice = {
    soundName: 'kick',
    layerName: 'Layer 1',
    playbackMode: 'one-shot' as const,
    durationMs: 500,
  };

  it('clears currentVoice for the pad', () => {
    usePadDisplayStore.getState().enqueueVoice('pad-1', voice);
    clearPadMetadata('pad-1');
    expect(usePadDisplayStore.getState().currentVoice['pad-1']).toBeNull();
  });

  it('clears voiceQueue for the pad', () => {
    usePadDisplayStore.getState().enqueueVoice('pad-1', voice);
    usePadDisplayStore.getState().enqueueVoice('pad-1', { ...voice, soundName: 'snare' });
    clearPadMetadata('pad-1');
    expect(usePadDisplayStore.getState().voiceQueue['pad-1']).toHaveLength(0);
  });

  it('does not affect other pads', () => {
    usePadDisplayStore.getState().enqueueVoice('pad-1', voice);
    usePadDisplayStore.getState().enqueueVoice('pad-2', { ...voice, soundName: 'hi-hat' });
    clearPadMetadata('pad-1');
    expect(usePadDisplayStore.getState().currentVoice['pad-2']?.soundName).toBe('hi-hat');
  });

  it('does not mutate playbackStore', () => {
    usePlaybackStore.getState().addPlayingPad('pad-1');
    clearPadMetadata('pad-1');
    expect(usePlaybackStore.getState().playingPadIds.has('pad-1')).toBe(true);
  });
});

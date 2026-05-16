import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureLayerContext,
  getLayerContext,
  getOrCreateLayerContext,
  deleteLayerContext,
  clearAllLayerContexts,
  clearAllLayerChainFields,
  clearLayerContextProgress,
  clearAllLayerContextProgress,
  clearLayerContextGain,
  clearAllLayerContextGains,
  clearLayerContextGainsForIds,
  forEachLayerContextWithGain,
  getAllLayerContextEntries,
  _getContextMap,
} from './layerPlaybackContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockGain() {
  return {
    gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as GainNode;
}

beforeEach(() => {
  clearAllLayerContexts();
});

// ---------------------------------------------------------------------------
// ensureLayerContext
// ---------------------------------------------------------------------------

describe('ensureLayerContext', () => {
  it('creates a new context with padId empty string when layer is unknown', () => {
    const ctx = ensureLayerContext('layer-1');
    expect(ctx.layerId).toBe('layer-1');
    expect(ctx.padId).toBe('');
    expect(ctx.gain).toBeNull();
    expect(ctx.chainQueue).toBeUndefined();
    expect(ctx.cycleIndex).toBeUndefined();
    expect(ctx.playOrder).toBeUndefined();
    expect(ctx.pending).toBe(false);
    expect(ctx.consecutiveFailures).toBe(0);
    expect(ctx.progressInfo).toBeUndefined();
  });

  it('returns the existing context on subsequent calls', () => {
    const first = ensureLayerContext('layer-1');
    const second = ensureLayerContext('layer-1');
    expect(second).toBe(first);
  });

  it('creates separate contexts for different layer IDs', () => {
    const a = ensureLayerContext('layer-a');
    const b = ensureLayerContext('layer-b');
    expect(a).not.toBe(b);
    expect(_getContextMap().size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getLayerContext
// ---------------------------------------------------------------------------

describe('getLayerContext', () => {
  it('returns undefined for unknown layer ID', () => {
    expect(getLayerContext('layer-unknown')).toBeUndefined();
  });

  it('returns the context after ensureLayerContext', () => {
    const ctx = ensureLayerContext('layer-1');
    expect(getLayerContext('layer-1')).toBe(ctx);
  });

  it('returns undefined after clearAllLayerContexts', () => {
    ensureLayerContext('layer-1');
    clearAllLayerContexts();
    expect(getLayerContext('layer-1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getOrCreateLayerContext
// ---------------------------------------------------------------------------

describe('getOrCreateLayerContext', () => {
  it('creates a new context with the given padId and gain', () => {
    const gain = makeMockGain();
    const ctx = getOrCreateLayerContext('layer-1', 'pad-1', gain);
    expect(ctx.layerId).toBe('layer-1');
    expect(ctx.padId).toBe('pad-1');
    expect(ctx.gain).toBe(gain);
  });

  it('updates gain and padId on an existing context', () => {
    const first = ensureLayerContext('layer-1');
    expect(first.padId).toBe('');
    expect(first.gain).toBeNull();

    const gain = makeMockGain();
    const updated = getOrCreateLayerContext('layer-1', 'pad-99', gain);
    expect(updated).toBe(first); // same object
    expect(updated.padId).toBe('pad-99');
    expect(updated.gain).toBe(gain);
  });

  it('preserves existing chain fields when updating gain', () => {
    const ctx = ensureLayerContext('layer-1');
    ctx.chainQueue = [];
    ctx.cycleIndex = 2;
    ctx.consecutiveFailures = 3;

    const gain = makeMockGain();
    getOrCreateLayerContext('layer-1', 'pad-1', gain);

    expect(ctx.chainQueue).toEqual([]);
    expect(ctx.cycleIndex).toBe(2);
    expect(ctx.consecutiveFailures).toBe(3);
  });

  it('disconnects old gain when replacing it with a new one', () => {
    const oldGain = makeMockGain();
    const newGain = makeMockGain();
    getOrCreateLayerContext('layer-1', 'pad-1', oldGain);
    getOrCreateLayerContext('layer-1', 'pad-1', newGain);
    expect(oldGain.disconnect).toHaveBeenCalledOnce();
    expect(newGain.disconnect).not.toHaveBeenCalled();
  });

  it('does not disconnect when same gain is re-passed', () => {
    const gain = makeMockGain();
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    expect(gain.disconnect).not.toHaveBeenCalled();
  });

  it('does not throw when old gain disconnect() fails during replacement', () => {
    const oldGain = makeMockGain();
    const newGain = makeMockGain();
    (oldGain.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('already disconnected'); });
    getOrCreateLayerContext('layer-1', 'pad-1', oldGain);
    expect(() => getOrCreateLayerContext('layer-1', 'pad-1', newGain)).not.toThrow();
    expect(getLayerContext('layer-1')?.gain).toBe(newGain);
  });

  it('adds a new entry to the context map', () => {
    const gain = makeMockGain();
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    expect(_getContextMap().size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// deleteLayerContext
// ---------------------------------------------------------------------------

describe('deleteLayerContext', () => {
  it('removes the context entry', () => {
    ensureLayerContext('layer-1');
    expect(_getContextMap().size).toBe(1);
    deleteLayerContext('layer-1');
    expect(_getContextMap().size).toBe(0);
  });

  it('is a no-op for unknown layer ID', () => {
    expect(() => deleteLayerContext('layer-unknown')).not.toThrow();
  });

  it('disconnects the gain node before deleting', () => {
    const gain = makeMockGain();
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    deleteLayerContext('layer-1');
    expect(gain.disconnect).toHaveBeenCalledOnce();
    expect(getLayerContext('layer-1')).toBeUndefined();
  });

  it('does not throw if gain.disconnect() fails', () => {
    const gain = makeMockGain();
    (gain.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('already disconnected'); });
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    expect(() => deleteLayerContext('layer-1')).not.toThrow();
    expect(_getContextMap().size).toBe(0);
  });

  it('does not disconnect when gain is null', () => {
    ensureLayerContext('layer-1'); // gain starts as null
    expect(() => deleteLayerContext('layer-1')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearAllLayerContexts
// ---------------------------------------------------------------------------

describe('clearAllLayerContexts', () => {
  it('deletes all context entries', () => {
    ensureLayerContext('layer-1');
    ensureLayerContext('layer-2');
    expect(_getContextMap().size).toBe(2);
    clearAllLayerContexts();
    expect(_getContextMap().size).toBe(0);
  });

  it('disconnects all gain nodes', () => {
    const gainA = makeMockGain();
    const gainB = makeMockGain();
    getOrCreateLayerContext('layer-a', 'pad-1', gainA);
    getOrCreateLayerContext('layer-b', 'pad-1', gainB);
    clearAllLayerContexts();
    expect(gainA.disconnect).toHaveBeenCalledOnce();
    expect(gainB.disconnect).toHaveBeenCalledOnce();
  });

  it('does not throw when gains.disconnect() fails', () => {
    const gain = makeMockGain();
    (gain.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('already disconnected'); });
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    expect(() => clearAllLayerContexts()).not.toThrow();
    expect(_getContextMap().size).toBe(0);
  });

  it('is safe to call on an empty map', () => {
    expect(() => clearAllLayerContexts()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearLayerContextGain / clearAllLayerContextGains
// ---------------------------------------------------------------------------

describe('clearLayerContextGain', () => {
  it('disconnects and nulls the gain for the specified layer', () => {
    const gain = makeMockGain();
    const ctx = getOrCreateLayerContext('layer-1', 'pad-1', gain);
    clearLayerContextGain('layer-1');
    expect(gain.disconnect).toHaveBeenCalledOnce();
    expect(ctx.gain).toBeNull();
  });

  it('is a no-op when the layer has no gain', () => {
    ensureLayerContext('layer-1');
    expect(() => clearLayerContextGain('layer-1')).not.toThrow();
  });

  it('is a no-op for an unknown layer ID', () => {
    expect(() => clearLayerContextGain('layer-unknown')).not.toThrow();
  });

  it('does not delete the context entry', () => {
    const gain = makeMockGain();
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    clearLayerContextGain('layer-1');
    expect(getLayerContext('layer-1')).toBeDefined();
  });

  it('does not throw when disconnect() fails', () => {
    const gain = makeMockGain();
    (gain.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('already disconnected'); });
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    expect(() => clearLayerContextGain('layer-1')).not.toThrow();
    expect(getLayerContext('layer-1')?.gain).toBeNull();
  });
});

describe('clearAllLayerContextGains', () => {
  it('disconnects all gains and nulls them without deleting contexts', () => {
    const gainA = makeMockGain();
    const gainB = makeMockGain();
    getOrCreateLayerContext('layer-a', 'pad-1', gainA);
    getOrCreateLayerContext('layer-b', 'pad-1', gainB);
    clearAllLayerContextGains();
    expect(gainA.disconnect).toHaveBeenCalledOnce();
    expect(gainB.disconnect).toHaveBeenCalledOnce();
    expect(getLayerContext('layer-a')?.gain).toBeNull();
    expect(getLayerContext('layer-b')?.gain).toBeNull();
    expect(_getContextMap().size).toBe(2); // contexts still present
  });

  it('skips contexts with null gain', () => {
    ensureLayerContext('layer-1'); // no gain
    expect(() => clearAllLayerContextGains()).not.toThrow();
  });

  it('does not throw when disconnect() fails', () => {
    const gain = makeMockGain();
    (gain.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('already disconnected'); });
    getOrCreateLayerContext('layer-1', 'pad-1', gain);
    expect(() => clearAllLayerContextGains()).not.toThrow();
    expect(_getContextMap().size).toBe(1); // context preserved
  });
});

// ---------------------------------------------------------------------------
// clearLayerContextGainsForIds
// ---------------------------------------------------------------------------

describe('clearLayerContextGainsForIds', () => {
  it('disconnects gain for specified IDs and preserves context entries', () => {
    const gainA = makeMockGain();
    const gainB = makeMockGain();
    getOrCreateLayerContext('layer-a', 'pad-1', gainA);
    getOrCreateLayerContext('layer-b', 'pad-1', gainB);
    clearLayerContextGainsForIds(new Set(['layer-a']));
    expect(gainA.disconnect).toHaveBeenCalledOnce();
    expect(gainB.disconnect).not.toHaveBeenCalled();
    expect(getLayerContext('layer-a')).toBeDefined();
    expect(getLayerContext('layer-a')?.gain).toBeNull();
    expect(getLayerContext('layer-b')?.gain).toBe(gainB);
  });
});

// ---------------------------------------------------------------------------
// forEachLayerContextWithGain
// ---------------------------------------------------------------------------

describe('forEachLayerContextWithGain', () => {
  it('calls the callback only for contexts with an active gain in the active set', () => {
    const gainA = makeMockGain();
    getOrCreateLayerContext('layer-a', 'pad-1', gainA);
    getOrCreateLayerContext('layer-b', 'pad-1', makeMockGain());
    ensureLayerContext('layer-c'); // no gain

    const visited = new Map<string, GainNode>();
    forEachLayerContextWithGain(new Set(['layer-a', 'layer-c']), (id, g) => visited.set(id, g));

    expect(visited.size).toBe(1);
    expect(visited.get('layer-a')).toBe(gainA);
    expect(visited.has('layer-b')).toBe(false);
    expect(visited.has('layer-c')).toBe(false); // layer-c has no gain
  });

  it('does not call callback when active set is empty', () => {
    getOrCreateLayerContext('layer-a', 'pad-1', makeMockGain());
    const cb = vi.fn();
    forEachLayerContextWithGain(new Set(), cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearAllLayerChainFields
// ---------------------------------------------------------------------------

describe('clearAllLayerChainFields', () => {
  it('zeroes chain/cycle/pending/failure fields but preserves gain and progressInfo', () => {
    const gain = makeMockGain();
    const ctx = getOrCreateLayerContext('layer-1', 'pad-1', gain);
    ctx.chainQueue = [];
    ctx.cycleIndex = 3;
    ctx.playOrder = [];
    ctx.pending = true;
    ctx.consecutiveFailures = 5;
    ctx.progressInfo = { startedAt: 1, duration: 2, isLooping: false };

    clearAllLayerChainFields();

    expect(ctx.chainQueue).toBeUndefined();
    expect(ctx.cycleIndex).toBeUndefined();
    expect(ctx.playOrder).toBeUndefined();
    expect(ctx.pending).toBe(false);
    expect(ctx.consecutiveFailures).toBe(0);
    // Preserved:
    expect(ctx.gain).toBe(gain);
    expect(ctx.progressInfo).toBeDefined();
  });

  it('works across multiple contexts', () => {
    const ctxA = ensureLayerContext('layer-a');
    ctxA.pending = true;
    const ctxB = ensureLayerContext('layer-b');
    ctxB.consecutiveFailures = 2;

    clearAllLayerChainFields();

    expect(ctxA.pending).toBe(false);
    expect(ctxB.consecutiveFailures).toBe(0);
  });

  it('is safe to call on an empty map', () => {
    expect(() => clearAllLayerChainFields()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearLayerContextProgress / clearAllLayerContextProgress
// ---------------------------------------------------------------------------

describe('clearLayerContextProgress', () => {
  it('sets progressInfo to undefined for the specified layer', () => {
    const ctx = ensureLayerContext('layer-1');
    ctx.progressInfo = { startedAt: 0, duration: 1, isLooping: false };
    clearLayerContextProgress('layer-1');
    expect(ctx.progressInfo).toBeUndefined();
  });

  it('is a no-op for unknown layer ID', () => {
    expect(() => clearLayerContextProgress('layer-unknown')).not.toThrow();
  });
});

describe('clearAllLayerContextProgress', () => {
  it('clears progressInfo on all contexts', () => {
    const ctxA = ensureLayerContext('layer-a');
    ctxA.progressInfo = { startedAt: 0, duration: 1, isLooping: false };
    const ctxB = ensureLayerContext('layer-b');
    ctxB.progressInfo = { startedAt: 1, duration: 2, isLooping: true };

    clearAllLayerContextProgress();

    expect(ctxA.progressInfo).toBeUndefined();
    expect(ctxB.progressInfo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAllLayerContextEntries
// ---------------------------------------------------------------------------

describe('getAllLayerContextEntries', () => {
  it('returns all context entries', () => {
    ensureLayerContext('layer-1');
    ensureLayerContext('layer-2');
    const entries = [...getAllLayerContextEntries()];
    expect(entries.length).toBe(2);
    const ids = entries.map(([id]) => id).sort();
    expect(ids).toEqual(['layer-1', 'layer-2']);
  });

  it('returns an empty iterator when map is empty', () => {
    const entries = [...getAllLayerContextEntries()];
    expect(entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// _getContextMap
// ---------------------------------------------------------------------------

describe('_getContextMap', () => {
  it('reflects the current size of the context map', () => {
    expect(_getContextMap().size).toBe(0);
    ensureLayerContext('layer-1');
    expect(_getContextMap().size).toBe(1);
    ensureLayerContext('layer-2');
    expect(_getContextMap().size).toBe(2);
    clearAllLayerContexts();
    expect(_getContextMap().size).toBe(0);
  });

  it('reflects deletion via deleteLayerContext', () => {
    ensureLayerContext('layer-1');
    ensureLayerContext('layer-2');
    deleteLayerContext('layer-1');
    expect(_getContextMap().size).toBe(1);
  });
});

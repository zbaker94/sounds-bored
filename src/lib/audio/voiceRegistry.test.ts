import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AudioVoice } from './audioVoice';
import {
  onLayerVoiceSetChanged,
  isPadActive,
  isLayerActive,
  recordVoice,
  clearVoice,
  recordLayerVoice,
  clearLayerVoice,
  stopPadVoices,
  stopLayerVoices,
  stopAllVoices,
  stopSpecificVoices,
  getLayerVoices,
  nullAllOnEnded,
  nullPadOnEnded,
  getActivePadIds,
  getAllVoices,
  getLayerIdsForPads,
  getActivePadCount,
  getActiveLayerIdSet,
  clearAllVoices,
  clearAll,
} from './voiceRegistry';

beforeEach(() => {
  clearAll();
});

function makeVoice(opts: { onStop?: () => void } = {}): AudioVoice {
  return {
    start: async () => {},
    stop: vi.fn(() => { opts.onStop?.(); }),
    stopWithRamp: vi.fn(),
    setVolume: vi.fn(),
    setLoop: vi.fn(),
    setOnEnded: vi.fn(),
  };
}

// ── isPadActive / isLayerActive ─────────────────────────────────────────────

describe('isPadActive / isLayerActive', () => {
  it('returns false when no voices exist', () => {
    expect(isPadActive('pad-1')).toBe(false);
    expect(isLayerActive('layer-1')).toBe(false);
  });

  it('returns true once a voice is recorded', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    expect(isPadActive('pad-1')).toBe(true);
    expect(isLayerActive('layer-1')).toBe(true);
  });
});

// ── recordVoice / clearVoice ────────────────────────────────────────────────

describe('recordVoice / clearVoice', () => {
  it('recordVoice tracks a voice and marks pad as active', () => {
    recordVoice('pad-1', makeVoice());
    expect(isPadActive('pad-1')).toBe(true);
  });

  it('clearVoice removes a voice and deactivates pad when empty', () => {
    const voice = makeVoice();
    recordVoice('pad-1', voice);
    clearVoice('pad-1', voice);
    expect(isPadActive('pad-1')).toBe(false);
  });

  it('clearVoice keeps pad active while other voices remain', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordVoice('pad-1', v1);
    recordVoice('pad-1', v2);
    clearVoice('pad-1', v1);
    expect(isPadActive('pad-1')).toBe(true);
  });

  it('clearVoice on an unknown pad is a safe no-op', () => {
    expect(() => clearVoice('never-recorded', makeVoice())).not.toThrow();
    expect(isPadActive('never-recorded')).toBe(false);
  });

  it('does not fire the voice-set listener when recordVoice is called (no layer)', () => {
    const listener = vi.fn();
    onLayerVoiceSetChanged(listener);
    recordVoice('pad-1', makeVoice());
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not fire the voice-set listener when clearVoice is called (no layer)', () => {
    const voice = makeVoice();
    recordVoice('pad-1', voice);
    const listener = vi.fn();
    onLayerVoiceSetChanged(listener);
    clearVoice('pad-1', voice);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── recordLayerVoice / clearLayerVoice ──────────────────────────────────────

describe('recordLayerVoice / clearLayerVoice', () => {
  it('records into both voiceMap and layerVoiceMap', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    expect(isPadActive('pad-1')).toBe(true);
    expect(isLayerActive('layer-1')).toBe(true);
    expect(getLayerVoices('layer-1')).toHaveLength(1);
  });

  it('clearLayerVoice removes from both maps', () => {
    const voice = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', voice);
    clearLayerVoice('pad-1', 'layer-1', voice);
    expect(isLayerActive('layer-1')).toBe(false);
    expect(isPadActive('pad-1')).toBe(false);
  });

  it('clearLayerVoice keeps the layer active while other voices remain', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-1', v2);
    clearLayerVoice('pad-1', 'layer-1', v1);
    expect(isLayerActive('layer-1')).toBe(true);
    expect(isPadActive('pad-1')).toBe(true);
  });
});

// ── stopPadVoices ───────────────────────────────────────────────────────────

describe('stopPadVoices', () => {
  it('stops all voices and clears layer entries for that pad', () => {
    const stopped: boolean[] = [];
    const v1 = makeVoice({ onStop: () => stopped.push(true) });
    const v2 = makeVoice({ onStop: () => stopped.push(true) });
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-2', v2);
    stopPadVoices('pad-1');
    expect(stopped).toHaveLength(2);
    expect(isPadActive('pad-1')).toBe(false);
    expect(isLayerActive('layer-1')).toBe(false);
    expect(isLayerActive('layer-2')).toBe(false);
  });

  it('does not touch other pads', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    stopPadVoices('pad-1');
    expect(isPadActive('pad-2')).toBe(true);
    expect(isLayerActive('layer-2')).toBe(true);
  });

  it('is a no-op on an unknown pad', () => {
    expect(() => stopPadVoices('never-recorded')).not.toThrow();
    expect(getActivePadCount()).toBe(0);
  });

  it('survives reentrant clearLayerVoice fired synchronously by voice.stop()', () => {
    // Simulates wrapStreamingElement.stop() firing onended synchronously, which
    // can reenter the registry via clearLayerVoice. The cleanup ordering in
    // stopPadVoices must make the reentrant call a safe no-op.
    const reentrantVoice = makeVoice();
    reentrantVoice.stop = vi.fn(() => {
      clearLayerVoice('pad-1', 'layer-1', reentrantVoice);
    });
    recordLayerVoice('pad-1', 'layer-1', reentrantVoice);
    expect(() => stopPadVoices('pad-1')).not.toThrow();
    expect(isLayerActive('layer-1')).toBe(false);
    expect(isPadActive('pad-1')).toBe(false);
  });
});

// ── stopLayerVoices ─────────────────────────────────────────────────────────

describe('stopLayerVoices', () => {
  it('stops only the targeted layer; pad stays active when other layers remain', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-1', 'layer-2', makeVoice());
    stopLayerVoices('pad-1', 'layer-1');
    expect(isLayerActive('layer-1')).toBe(false);
    expect(isLayerActive('layer-2')).toBe(true);
    expect(isPadActive('pad-1')).toBe(true);
  });

  it('clears pad when last layer is stopped', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    stopLayerVoices('pad-1', 'layer-1');
    expect(isPadActive('pad-1')).toBe(false);
  });

  it('cleans maps before stop() so synchronous onended reentrancy is a safe no-op', () => {
    const reentrantVoice = makeVoice();
    reentrantVoice.stop = vi.fn(() => {
      clearLayerVoice('pad-1', 'layer-1', reentrantVoice);
    });
    recordLayerVoice('pad-1', 'layer-1', reentrantVoice);
    expect(() => stopLayerVoices('pad-1', 'layer-1')).not.toThrow();
    expect(isLayerActive('layer-1')).toBe(false);
    expect(isPadActive('pad-1')).toBe(false);
  });

  it('stops every voice in the layer', () => {
    const stopped: boolean[] = [];
    const v1 = makeVoice({ onStop: () => stopped.push(true) });
    const v2 = makeVoice({ onStop: () => stopped.push(true) });
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-1', v2);
    stopLayerVoices('pad-1', 'layer-1');
    expect(stopped).toHaveLength(2);
  });
});

// ── stopAllVoices ───────────────────────────────────────────────────────────

describe('stopAllVoices', () => {
  it('stops every voice and deactivates all pads', () => {
    const stopped: boolean[] = [];
    recordLayerVoice('pad-1', 'layer-1', makeVoice({ onStop: () => stopped.push(true) }));
    recordLayerVoice('pad-2', 'layer-2', makeVoice({ onStop: () => stopped.push(true) }));
    stopAllVoices();
    expect(stopped).toHaveLength(2);
    expect(isPadActive('pad-1')).toBe(false);
    expect(isPadActive('pad-2')).toBe(false);
    expect(getActivePadCount()).toBe(0);
  });
});

// ── stopSpecificVoices ──────────────────────────────────────────────────────

describe('stopSpecificVoices', () => {
  it('stops only the listed voices and reports fully-stopped pads', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-2', v2);
    const stopped = stopSpecificVoices([v1, v2], new Set(['pad-1']));
    expect(stopped.has('pad-1')).toBe(true);
    expect(isPadActive('pad-1')).toBe(false);
  });

  it('leaves voices added to the same pad after the snapshot intact', () => {
    const original = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', original);
    const stopped = stopSpecificVoices([original], new Set(['pad-1']));
    expect(stopped.has('pad-1')).toBe(true);

    // Simulate a new trigger arriving after the snapshot
    const fresh = makeVoice();
    recordLayerVoice('pad-1', 'layer-2', fresh);
    expect(isPadActive('pad-1')).toBe(true);
    expect(isLayerActive('layer-2')).toBe(true);
  });

  it('does not include pads with surviving voices in the fully-stopped result', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-2', v2);
    // Only stop v1 — pad-1 still has v2
    const stopped = stopSpecificVoices([v1], new Set(['pad-1']));
    expect(stopped.has('pad-1')).toBe(false);
    expect(isPadActive('pad-1')).toBe(true);
    expect(isLayerActive('layer-2')).toBe(true);
  });

  it('calls voice.stop() for each listed voice', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-2', 'layer-2', v2);
    stopSpecificVoices([v1, v2], new Set(['pad-1', 'pad-2']));
    expect(v1.stop).toHaveBeenCalled();
    expect(v2.stop).toHaveBeenCalled();
  });

  it('swallows errors thrown by voice.stop()', () => {
    const throwing = makeVoice();
    throwing.stop = vi.fn(() => { throw new Error('already ended'); });
    recordLayerVoice('pad-1', 'layer-1', throwing);
    expect(() => stopSpecificVoices([throwing], new Set(['pad-1']))).not.toThrow();
  });
});

// ── getLayerVoices ──────────────────────────────────────────────────────────

describe('getLayerVoices', () => {
  it('returns empty array when layer not active', () => {
    expect(getLayerVoices('no-such-layer')).toEqual([]);
  });

  it('returns all voices for an active layer', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-1', v2);
    expect(getLayerVoices('layer-1')).toHaveLength(2);
  });
});

// ── nullAllOnEnded / nullPadOnEnded ─────────────────────────────────────────

describe('nullAllOnEnded / nullPadOnEnded', () => {
  it('nullAllOnEnded sets all onended callbacks to null', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-2', 'layer-2', v2);
    nullAllOnEnded();
    expect(v1.setOnEnded).toHaveBeenCalledWith(null);
    expect(v2.setOnEnded).toHaveBeenCalledWith(null);
  });

  it('nullPadOnEnded only nulls callbacks for the named pad', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-2', 'layer-2', v2);
    nullPadOnEnded('pad-1');
    expect(v1.setOnEnded).toHaveBeenCalledWith(null);
    expect(v2.setOnEnded).not.toHaveBeenCalled();
  });

  it('nullPadOnEnded is a no-op for an unknown pad', () => {
    expect(() => nullPadOnEnded('never-recorded')).not.toThrow();
  });
});

// ── snapshot accessors ──────────────────────────────────────────────────────

describe('getActivePadIds / getAllVoices / getActivePadCount / getActiveLayerIdSet', () => {
  it('getActivePadCount returns 0 in empty state', () => {
    expect(getActivePadCount()).toBe(0);
  });

  it('getActivePadCount counts pads with voices', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    expect(getActivePadCount()).toBe(2);
  });

  it('getActivePadIds returns the active pad ID set', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    const ids = getActivePadIds();
    expect(ids).toEqual(new Set(['pad-1', 'pad-2']));
  });

  it('getActivePadIds returns a snapshot — mutating it does not affect the registry', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    const snapshot = getActivePadIds();
    snapshot.delete('pad-1');
    expect(isPadActive('pad-1')).toBe(true);
  });

  it('getAllVoices returns every active voice', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-2', 'layer-2', v2);
    const all = getAllVoices();
    expect(all).toHaveLength(2);
    expect(all).toContain(v1);
    expect(all).toContain(v2);
  });

  it('getActiveLayerIdSet returns the active layer ID set', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-1', 'layer-2', makeVoice());
    recordLayerVoice('pad-2', 'layer-3', makeVoice());
    const ids = getActiveLayerIdSet();
    expect(ids).toEqual(new Set(['layer-1', 'layer-2', 'layer-3']));
  });

  it('getActiveLayerIdSet returns empty set when no voices active', () => {
    expect(getActiveLayerIdSet().size).toBe(0);
  });

  it('returns a snapshot — mutating it does not affect the registry', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    const snapshot = getActiveLayerIdSet();
    snapshot.delete('layer-1');
    expect(getActiveLayerIdSet().has('layer-1')).toBe(true);
  });

  it('returns a new array — mutating it does not affect the registry', () => {
    const v = makeVoice();
    recordVoice('pad-1', v);
    const snapshot = getAllVoices();
    snapshot.length = 0;
    expect(getAllVoices().length).toBe(1);
  });
});

// ── getLayerIdsForPads (reverse-index invariants) ───────────────────────────

describe('getLayerIdsForPads — reverse-index invariants', () => {
  it('returns the layers tracked for a single pad', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-1', 'layer-2', makeVoice());
    expect(getLayerIdsForPads(new Set(['pad-1']))).toEqual(new Set(['layer-1', 'layer-2']));
  });

  it('unions layers across multiple pads', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    expect(getLayerIdsForPads(new Set(['pad-1', 'pad-2']))).toEqual(new Set(['layer-1', 'layer-2']));
  });

  it('returns an empty set for an unknown pad', () => {
    expect(getLayerIdsForPads(new Set(['never-recorded'])).size).toBe(0);
  });

  it('clearLayerVoice removes the layer from the reverse index when no voices remain', () => {
    const voice = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', voice);
    clearLayerVoice('pad-1', 'layer-1', voice);
    expect(getLayerIdsForPads(new Set(['pad-1'])).size).toBe(0);
    expect(getActivePadIds().has('pad-1')).toBe(false);
  });

  it('clearLayerVoice keeps the layer in the reverse index while other voices remain', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-1', v2);
    clearLayerVoice('pad-1', 'layer-1', v1);
    expect(getLayerIdsForPads(new Set(['pad-1']))).toEqual(new Set(['layer-1']));
  });

  it('stopPadVoices clears the pad from the reverse index', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-1', 'layer-2', makeVoice());
    stopPadVoices('pad-1');
    expect(getLayerIdsForPads(new Set(['pad-1'])).size).toBe(0);
  });

  it('stopPadVoices does NOT touch other pads in the reverse index', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    stopPadVoices('pad-1');
    expect(getLayerIdsForPads(new Set(['pad-2']))).toEqual(new Set(['layer-2']));
  });

  it('stopLayerVoices removes only the stopped layer from the reverse index', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-1', 'layer-2', makeVoice());
    stopLayerVoices('pad-1', 'layer-1');
    expect(getLayerIdsForPads(new Set(['pad-1']))).toEqual(new Set(['layer-2']));
  });

  it('stopLayerVoices removes the pad from the reverse index when its last layer is stopped', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    stopLayerVoices('pad-1', 'layer-1');
    expect(getLayerIdsForPads(new Set(['pad-1'])).size).toBe(0);
    expect(getActivePadIds().has('pad-1')).toBe(false);
  });

  it('stopAllVoices clears the entire reverse index', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    stopAllVoices();
    expect(getLayerIdsForPads(new Set(['pad-1', 'pad-2'])).size).toBe(0);
  });

  it('clearAllVoices clears the entire reverse index', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    clearAllVoices();
    expect(getLayerIdsForPads(new Set(['pad-1'])).size).toBe(0);
  });

  it('recording the same voice twice does not corrupt the index on clear', () => {
    const voice = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', voice);
    recordLayerVoice('pad-1', 'layer-1', voice); // duplicate
    clearLayerVoice('pad-1', 'layer-1', voice);  // filter removes both
    expect(isLayerActive('layer-1')).toBe(false);
    expect(getLayerIdsForPads(new Set(['pad-1'])).size).toBe(0);
  });

  it('stopSpecificVoices removes the stopped voices from the reverse index', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-2', v2);
    stopSpecificVoices([v1], new Set(['pad-1']));
    expect(getLayerIdsForPads(new Set(['pad-1']))).toEqual(new Set(['layer-2']));
  });
});

// ── onLayerVoiceSetChanged listener ─────────────────────────────────────────

describe('onLayerVoiceSetChanged', () => {
  it('fires the listener when a layer voice is recorded', () => {
    let calls = 0;
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    expect(calls).toBe(1);
    unsub();
  });

  it('fires the listener when a layer voice is cleared', () => {
    let calls = 0;
    const voice = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', voice);
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    clearLayerVoice('pad-1', 'layer-1', voice);
    expect(calls).toBe(1);
    unsub();
  });

  it('fires the listener when clearAllVoices is called', () => {
    let calls = 0;
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    clearAllVoices();
    expect(calls).toBe(1);
    unsub();
  });

  it('fires the listener when stopPadVoices is called', () => {
    let calls = 0;
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    stopPadVoices('pad-1');
    expect(calls).toBe(1);
    unsub();
  });

  it('fires the listener when stopAllVoices is called', () => {
    let calls = 0;
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    stopAllVoices();
    expect(calls).toBe(1);
    unsub();
  });

  it('fires the listener when stopLayerVoices is called', () => {
    let calls = 0;
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    stopLayerVoices('pad-1', 'layer-1');
    expect(calls).toBe(1);
    unsub();
  });

  it('fires the listener when stopSpecificVoices is called', () => {
    let calls = 0;
    const voice = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', voice);
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    stopSpecificVoices([voice], new Set(['pad-1']));
    expect(calls).toBe(1);
    unsub();
  });

  it('fires once per recorded voice, not once per call', () => {
    let calls = 0;
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-1', 'layer-2', makeVoice());
    recordLayerVoice('pad-2', 'layer-3', makeVoice());
    expect(calls).toBe(3);
    unsub();
  });

  it('does not fire after the listener is unsubscribed', () => {
    let calls = 0;
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    unsub();
    clearAllVoices();
    expect(calls).toBe(1);
  });

  it('registering a second listener replaces the first', () => {
    let first = 0;
    let second = 0;
    onLayerVoiceSetChanged(() => { first++; });
    const unsub = onLayerVoiceSetChanged(() => { second++; });
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    expect(first).toBe(0);
    expect(second).toBe(1);
    unsub();
  });

  it('recordLayerVoice: listener sees both voiceMap and layerVoiceMap updated', () => {
    const voice = makeVoice();
    let padActiveAtNotify: boolean | null = null;
    let layerActiveAtNotify: boolean | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      padActiveAtNotify = isPadActive('pad-1');
      layerActiveAtNotify = isLayerActive('layer-1');
    });
    recordLayerVoice('pad-1', 'layer-1', voice);
    expect(padActiveAtNotify).toBe(true);
    expect(layerActiveAtNotify).toBe(true);
    unsub();
  });

  it('clearLayerVoice: listener sees both voiceMap and layerVoiceMap updated (last voice)', () => {
    const voice = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', voice);
    let padActiveAtNotify: boolean | null = null;
    let layerActiveAtNotify: boolean | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      padActiveAtNotify = isPadActive('pad-1');
      layerActiveAtNotify = isLayerActive('layer-1');
    });
    clearLayerVoice('pad-1', 'layer-1', voice);
    expect(padActiveAtNotify).toBe(false);
    expect(layerActiveAtNotify).toBe(false);
    unsub();
  });

  it('clearLayerVoice: listener sees both voiceMap and layerVoiceMap updated (partial clear)', () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', v1);
    recordLayerVoice('pad-1', 'layer-1', v2);
    let layerVoiceCountAtNotify: number | null = null;
    let padVoiceCountAtNotify: number | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      layerVoiceCountAtNotify = getLayerVoices('layer-1').length;
      padVoiceCountAtNotify = getAllVoices().length;
    });
    clearLayerVoice('pad-1', 'layer-1', v1);
    // Both layerVoiceMap and voiceMap must be updated at notify time.
    // Pre-fix: notify fired before clearVoice, so getAllVoices() would return 2 not 1.
    expect(layerVoiceCountAtNotify).toBe(1);
    expect(padVoiceCountAtNotify).toBe(1);
    unsub();
  });

  it('stopLayerVoices: listener sees both voiceMap and layerVoiceMap updated (last layer)', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    let padActiveAtNotify: boolean | null = null;
    let layerActiveAtNotify: boolean | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      padActiveAtNotify = isPadActive('pad-1');
      layerActiveAtNotify = isLayerActive('layer-1');
    });
    stopLayerVoices('pad-1', 'layer-1');
    expect(padActiveAtNotify).toBe(false);
    expect(layerActiveAtNotify).toBe(false);
    unsub();
  });

  it('stopLayerVoices: listener sees consistent state when pad retains another layer', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-1', 'layer-2', makeVoice());
    let padActiveAtNotify: boolean | null = null;
    let layer1ActiveAtNotify: boolean | null = null;
    let layer2ActiveAtNotify: boolean | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      padActiveAtNotify = isPadActive('pad-1');
      layer1ActiveAtNotify = isLayerActive('layer-1');
      layer2ActiveAtNotify = isLayerActive('layer-2');
    });
    stopLayerVoices('pad-1', 'layer-1');
    expect(padActiveAtNotify).toBe(true);
    expect(layer1ActiveAtNotify).toBe(false);
    expect(layer2ActiveAtNotify).toBe(true);
    unsub();
  });

  it('stopPadVoices: listener sees both voiceMap and layerVoiceMap updated', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-1', 'layer-2', makeVoice());
    let padActiveAtNotify: boolean | null = null;
    let layer1ActiveAtNotify: boolean | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      padActiveAtNotify = isPadActive('pad-1');
      layer1ActiveAtNotify = isLayerActive('layer-1');
    });
    stopPadVoices('pad-1');
    expect(padActiveAtNotify).toBe(false);
    expect(layer1ActiveAtNotify).toBe(false);
    unsub();
  });

  it('stopAllVoices: listener sees all maps cleared', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    let pad1ActiveAtNotify: boolean | null = null;
    let pad2ActiveAtNotify: boolean | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      pad1ActiveAtNotify = isPadActive('pad-1');
      pad2ActiveAtNotify = isPadActive('pad-2');
    });
    stopAllVoices();
    expect(pad1ActiveAtNotify).toBe(false);
    expect(pad2ActiveAtNotify).toBe(false);
    unsub();
  });

  it('stopSpecificVoices: listener sees voiceMap and layerVoiceMap updated', () => {
    const voice = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', voice);
    let padActiveAtNotify: boolean | null = null;
    let layerActiveAtNotify: boolean | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      padActiveAtNotify = isPadActive('pad-1');
      layerActiveAtNotify = isLayerActive('layer-1');
    });
    stopSpecificVoices([voice], new Set(['pad-1']));
    expect(padActiveAtNotify).toBe(false);
    expect(layerActiveAtNotify).toBe(false);
    unsub();
  });

  it('clearAllVoices: listener sees all maps cleared', () => {
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    let padActiveAtNotify: boolean | null = null;
    let layerActiveAtNotify: boolean | null = null;
    const unsub = onLayerVoiceSetChanged(() => {
      padActiveAtNotify = isPadActive('pad-1');
      layerActiveAtNotify = isLayerActive('layer-1');
    });
    clearAllVoices();
    expect(padActiveAtNotify).toBe(false);
    expect(layerActiveAtNotify).toBe(false);
    unsub();
  });
});

// ── clearAllVoices / clearAll ───────────────────────────────────────────────

describe('clearAllVoices / clearAll', () => {
  it('clearAllVoices empties all maps but keeps the listener registered', () => {
    let calls = 0;
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    expect(calls).toBe(1);
    clearAllVoices();
    expect(calls).toBe(2);
    expect(getActivePadCount()).toBe(0);
    expect(getActiveLayerIdSet().size).toBe(0);

    // Listener still registered — a follow-up record fires it again
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    expect(calls).toBe(3);
    unsub();
  });

  it('clearAll empties all maps AND drops the listener', () => {
    let calls = 0;
    onLayerVoiceSetChanged(() => { calls++; });
    recordLayerVoice('pad-1', 'layer-1', makeVoice());
    expect(calls).toBe(1);
    clearAll();
    // After clearAll, no listener — subsequent mutations do not fire
    recordLayerVoice('pad-2', 'layer-2', makeVoice());
    expect(calls).toBe(1);
    expect(getActivePadCount()).toBe(1);
  });

  it('clearAllVoices does not call voice.stop() on the cleared voices', () => {
    const voice = makeVoice();
    recordLayerVoice('pad-1', 'layer-1', voice);
    clearAllVoices();
    expect(voice.stop).not.toHaveBeenCalled();
  });
});

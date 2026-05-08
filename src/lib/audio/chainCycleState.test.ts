import { describe, it, expect, beforeEach } from 'vitest';
import { createMockSound } from '@/test/factories';
import {
  getLayerChain,
  setLayerChain,
  deleteLayerChain,
  clearAllLayerChains,
  getLayerCycleIndex,
  setLayerCycleIndex,
  deleteLayerCycleIndex,
  clearAllLayerCycleIndexes,
  setLayerPlayOrder,
  getLayerPlayOrder,
  deleteLayerPlayOrder,
  clearAllLayerPlayOrders,
  isLayerPending,
  setLayerPending,
  clearLayerPending,
  clearAllLayerPending,
  getLayerConsecutiveFailures,
  incrementLayerConsecutiveFailures,
  resetLayerConsecutiveFailures,
  clearAllLayerConsecutiveFailures,
  clearAll,
} from './chainCycleState';

beforeEach(() => {
  clearAll();
});

// ── Layer chain queue ────────────────────────────────────────────────────────

describe('layerChainQueue', () => {
  it('returns undefined for a layer with no chain set', () => {
    expect(getLayerChain('layer-1')).toBeUndefined();
  });

  it('stores and retrieves a chain', () => {
    const chain = [createMockSound({ name: 'a' }), createMockSound({ name: 'b' })];
    setLayerChain('layer-1', chain);
    expect(getLayerChain('layer-1')).toBe(chain);
  });

  it('overwrites an existing chain', () => {
    const first = [createMockSound({ name: 'a' })];
    const second = [createMockSound({ name: 'b' }), createMockSound({ name: 'c' })];
    setLayerChain('layer-1', first);
    setLayerChain('layer-1', second);
    expect(getLayerChain('layer-1')).toBe(second);
  });

  it('stores an empty chain as a defined value', () => {
    setLayerChain('layer-1', []);
    expect(getLayerChain('layer-1')).toEqual([]);
  });

  it('deleteLayerChain removes the entry', () => {
    setLayerChain('layer-1', [createMockSound()]);
    deleteLayerChain('layer-1');
    expect(getLayerChain('layer-1')).toBeUndefined();
  });

  it('deleteLayerChain is a no-op on an unknown layer', () => {
    expect(() => deleteLayerChain('unknown')).not.toThrow();
  });

  it('clearAllLayerChains removes all entries', () => {
    setLayerChain('layer-1', [createMockSound()]);
    setLayerChain('layer-2', [createMockSound()]);
    clearAllLayerChains();
    expect(getLayerChain('layer-1')).toBeUndefined();
    expect(getLayerChain('layer-2')).toBeUndefined();
  });

  it('getLayerChain returns the stored reference (not a copy)', () => {
    const chain = [createMockSound()];
    setLayerChain('layer-1', chain);
    expect(getLayerChain('layer-1')).toBe(chain); // same reference
  });
});

// ── Layer cycle index ────────────────────────────────────────────────────────

describe('layerCycleIndex', () => {
  it('returns undefined for a layer with no cycle index set', () => {
    expect(getLayerCycleIndex('layer-1')).toBeUndefined();
  });

  it('stores and retrieves a cycle index', () => {
    setLayerCycleIndex('layer-1', 2);
    expect(getLayerCycleIndex('layer-1')).toBe(2);
  });

  it('overwrites an existing cycle index', () => {
    setLayerCycleIndex('layer-1', 0);
    setLayerCycleIndex('layer-1', 3);
    expect(getLayerCycleIndex('layer-1')).toBe(3);
  });

  it('deleteLayerCycleIndex removes the entry', () => {
    setLayerCycleIndex('layer-1', 1);
    deleteLayerCycleIndex('layer-1');
    expect(getLayerCycleIndex('layer-1')).toBeUndefined();
  });

  it('clearAllLayerCycleIndexes removes all entries', () => {
    setLayerCycleIndex('layer-1', 0);
    setLayerCycleIndex('layer-2', 5);
    clearAllLayerCycleIndexes();
    expect(getLayerCycleIndex('layer-1')).toBeUndefined();
    expect(getLayerCycleIndex('layer-2')).toBeUndefined();
  });
});

// ── Layer play order ─────────────────────────────────────────────────────────

describe('layerPlayOrder', () => {
  it('returns undefined for a layer with no play order set', () => {
    expect(getLayerPlayOrder('layer-1')).toBeUndefined();
  });

  it('stores and retrieves a play order', () => {
    const sounds = [createMockSound({ name: 'a' }), createMockSound({ name: 'b' })];
    setLayerPlayOrder('layer-1', sounds);
    expect(getLayerPlayOrder('layer-1')).toBe(sounds);
  });

  it('overwrites an existing play order', () => {
    const first = [createMockSound({ name: 'a' })];
    const second = [createMockSound({ name: 'b' })];
    setLayerPlayOrder('layer-1', first);
    setLayerPlayOrder('layer-1', second);
    expect(getLayerPlayOrder('layer-1')).toBe(second);
  });

  it('deleteLayerPlayOrder removes the entry', () => {
    setLayerPlayOrder('layer-1', [createMockSound()]);
    deleteLayerPlayOrder('layer-1');
    expect(getLayerPlayOrder('layer-1')).toBeUndefined();
  });

  it('does nothing when deleting an unknown layer', () => {
    expect(() => deleteLayerPlayOrder('nonexistent')).not.toThrow();
  });

  it('clearAllLayerPlayOrders removes all entries', () => {
    setLayerPlayOrder('layer-1', [createMockSound()]);
    setLayerPlayOrder('layer-2', [createMockSound()]);
    clearAllLayerPlayOrders();
    expect(getLayerPlayOrder('layer-1')).toBeUndefined();
    expect(getLayerPlayOrder('layer-2')).toBeUndefined();
  });
});

// ── Layer pending ────────────────────────────────────────────────────────────

describe('layerPending', () => {
  it('returns false for a layer that was never marked pending', () => {
    expect(isLayerPending('layer-1')).toBe(false);
  });

  it('returns true after setLayerPending', () => {
    setLayerPending('layer-1');
    expect(isLayerPending('layer-1')).toBe(true);
  });

  it('returns false after clearLayerPending', () => {
    setLayerPending('layer-1');
    clearLayerPending('layer-1');
    expect(isLayerPending('layer-1')).toBe(false);
  });

  it('setLayerPending is idempotent', () => {
    setLayerPending('layer-1');
    setLayerPending('layer-1');
    expect(isLayerPending('layer-1')).toBe(true);
    clearLayerPending('layer-1');
    expect(isLayerPending('layer-1')).toBe(false);
  });

  it('clearLayerPending is a no-op on a layer that was never pending', () => {
    expect(() => clearLayerPending('unknown')).not.toThrow();
    expect(isLayerPending('unknown')).toBe(false);
  });

  it('clearAllLayerPending removes all entries', () => {
    setLayerPending('layer-1');
    setLayerPending('layer-2');
    clearAllLayerPending();
    expect(isLayerPending('layer-1')).toBe(false);
    expect(isLayerPending('layer-2')).toBe(false);
  });

  it('tracks each layer independently', () => {
    setLayerPending('layer-1');
    expect(isLayerPending('layer-1')).toBe(true);
    expect(isLayerPending('layer-2')).toBe(false);
  });
});

// ── Layer consecutive failures ───────────────────────────────────────────────

describe('layerConsecutiveFailures', () => {
  it('returns 0 for a layer with no recorded failures', () => {
    expect(getLayerConsecutiveFailures('layer-1')).toBe(0);
  });

  it('incrementLayerConsecutiveFailures returns 1 on first call', () => {
    expect(incrementLayerConsecutiveFailures('layer-1')).toBe(1);
    expect(getLayerConsecutiveFailures('layer-1')).toBe(1);
  });

  it('incrementLayerConsecutiveFailures accumulates across calls', () => {
    expect(incrementLayerConsecutiveFailures('layer-1')).toBe(1);
    expect(incrementLayerConsecutiveFailures('layer-1')).toBe(2);
    expect(incrementLayerConsecutiveFailures('layer-1')).toBe(3);
    expect(getLayerConsecutiveFailures('layer-1')).toBe(3);
  });

  it('resetLayerConsecutiveFailures returns the count to 0', () => {
    incrementLayerConsecutiveFailures('layer-1');
    incrementLayerConsecutiveFailures('layer-1');
    resetLayerConsecutiveFailures('layer-1');
    expect(getLayerConsecutiveFailures('layer-1')).toBe(0);
  });

  it('resetLayerConsecutiveFailures is a no-op on an unknown layer', () => {
    expect(() => resetLayerConsecutiveFailures('unknown')).not.toThrow();
    expect(getLayerConsecutiveFailures('unknown')).toBe(0);
  });

  it('tracks each layer independently', () => {
    incrementLayerConsecutiveFailures('layer-1');
    incrementLayerConsecutiveFailures('layer-1');
    incrementLayerConsecutiveFailures('layer-2');
    expect(getLayerConsecutiveFailures('layer-1')).toBe(2);
    expect(getLayerConsecutiveFailures('layer-2')).toBe(1);
  });

  it('clearAllLayerConsecutiveFailures removes all entries', () => {
    incrementLayerConsecutiveFailures('layer-1');
    incrementLayerConsecutiveFailures('layer-2');
    clearAllLayerConsecutiveFailures();
    expect(getLayerConsecutiveFailures('layer-1')).toBe(0);
    expect(getLayerConsecutiveFailures('layer-2')).toBe(0);
  });
});

// ── clearAll ─────────────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('clears chain, cycle index, play order, pending, and consecutive failures in one call', () => {
    setLayerChain('layer-1', [createMockSound()]);
    setLayerCycleIndex('layer-1', 2);
    setLayerPlayOrder('layer-1', [createMockSound()]);
    setLayerPending('layer-1');
    incrementLayerConsecutiveFailures('layer-1');

    clearAll();

    expect(getLayerChain('layer-1')).toBeUndefined();
    expect(getLayerCycleIndex('layer-1')).toBeUndefined();
    expect(getLayerPlayOrder('layer-1')).toBeUndefined();
    expect(isLayerPending('layer-1')).toBe(false);
    expect(getLayerConsecutiveFailures('layer-1')).toBe(0);
  });

  it('is safe to call when all maps are empty', () => {
    expect(() => clearAll()).not.toThrow();
  });

  it('clears entries across multiple layers', () => {
    setLayerChain('layer-1', [createMockSound()]);
    setLayerChain('layer-2', [createMockSound()]);
    setLayerCycleIndex('layer-1', 0);
    setLayerCycleIndex('layer-2', 1);
    setLayerPlayOrder('layer-1', [createMockSound()]);
    setLayerPending('layer-2');
    incrementLayerConsecutiveFailures('layer-1');
    incrementLayerConsecutiveFailures('layer-2');

    clearAll();

    expect(getLayerChain('layer-1')).toBeUndefined();
    expect(getLayerChain('layer-2')).toBeUndefined();
    expect(getLayerCycleIndex('layer-1')).toBeUndefined();
    expect(getLayerCycleIndex('layer-2')).toBeUndefined();
    expect(getLayerPlayOrder('layer-1')).toBeUndefined();
    expect(isLayerPending('layer-2')).toBe(false);
    expect(getLayerConsecutiveFailures('layer-1')).toBe(0);
    expect(getLayerConsecutiveFailures('layer-2')).toBe(0);
  });
});

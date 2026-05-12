import { describe, it, expect } from 'vitest';
import { createMockLayer, createMockSound, createMockTag, createMockSet } from '@/test/factories';
import type { LayerConfigForm } from '@/lib/schemas';
import {
  createDefaultLayer,
  createDefaultStoreLayer,
  layerToFormLayer,
  formLayerToLayer,
  summarizeLayerSelection,
} from '@/lib/layerHelpers';

describe('createDefaultLayer', () => {
  it('returns expected default field values', () => {
    const layer = createDefaultLayer();
    expect(layer.selection).toEqual({ type: 'assigned', instances: [] });
    expect(layer.arrangement).toBe('simultaneous');
    expect(layer.cycleMode).toBe(false);
    expect(layer.playbackMode).toBe('one-shot');
    expect(layer.retriggerMode).toBe('restart');
    expect(layer.volume).toBe(100);
    expect(typeof layer.id).toBe('string');
    expect(layer.id.length).toBeGreaterThan(0);
  });

  it('generates a unique id on each call', () => {
    expect(createDefaultLayer().id).not.toBe(createDefaultLayer().id);
  });
});

describe('createDefaultStoreLayer', () => {
  it('returns field values consistent with createDefaultLayer', () => {
    const form = createDefaultLayer();
    const store = createDefaultStoreLayer();
    expect(store.selection).toEqual(form.selection);
    expect(store.arrangement).toBe(form.arrangement);
    expect(store.cycleMode).toBe(form.cycleMode);
    expect(store.playbackMode).toBe(form.playbackMode);
    expect(store.retriggerMode).toBe(form.retriggerMode);
    expect(store.volume).toBe(form.volume);
  });

  it('does not include a name field', () => {
    expect('name' in createDefaultStoreLayer()).toBe(false);
  });
});

describe('layerToFormLayer', () => {
  it('converts all shared fields from Layer to LayerConfigForm', () => {
    const layer = createMockLayer({
      id: 'abc',
      selection: { type: 'assigned', instances: [] },
      arrangement: 'simultaneous',
      cycleMode: false,
      playbackMode: 'one-shot',
      retriggerMode: 'restart',
      volume: 80,
    });
    const result = layerToFormLayer(layer);
    expect(result).toEqual({
      id: 'abc',
      selection: { type: 'assigned', instances: [] },
      arrangement: 'simultaneous',
      cycleMode: false,
      playbackMode: 'one-shot',
      retriggerMode: 'restart',
      volume: 80,
    });
  });

  it('drops the optional name field', () => {
    const layer = createMockLayer({ name: 'Kick' });
    const result = layerToFormLayer(layer);
    expect('name' in result).toBe(false);
  });

  it('preserves tag selection fields', () => {
    const layer = createMockLayer({
      selection: { type: 'tag', tagIds: ['t1', 't2'], matchMode: 'all', defaultVolume: 75 },
    });
    expect(layerToFormLayer(layer).selection).toEqual({
      type: 'tag',
      tagIds: ['t1', 't2'],
      matchMode: 'all',
      defaultVolume: 75,
    });
  });

  it('preserves set selection fields', () => {
    const layer = createMockLayer({
      selection: { type: 'set', setId: 's1', defaultVolume: 90 },
    });
    expect(layerToFormLayer(layer).selection).toEqual({
      type: 'set',
      setId: 's1',
      defaultVolume: 90,
    });
  });
});

describe('formLayerToLayer', () => {
  it('converts all shared fields from LayerConfigForm to Layer', () => {
    const form: LayerConfigForm = {
      id: 'abc',
      selection: { type: 'assigned', instances: [] },
      arrangement: 'simultaneous',
      cycleMode: false,
      playbackMode: 'one-shot',
      retriggerMode: 'restart',
      volume: 80,
    };
    const result = formLayerToLayer(form);
    expect(result).toEqual({
      id: 'abc',
      selection: { type: 'assigned', instances: [] },
      arrangement: 'simultaneous',
      cycleMode: false,
      playbackMode: 'one-shot',
      retriggerMode: 'restart',
      volume: 80,
    });
  });

  it('does not add a name field', () => {
    const form: LayerConfigForm = {
      id: 'abc',
      selection: { type: 'assigned', instances: [] },
      arrangement: 'simultaneous',
      cycleMode: false,
      playbackMode: 'one-shot',
      retriggerMode: 'restart',
      volume: 100,
    };
    expect('name' in formLayerToLayer(form)).toBe(false);
  });

  it('round-trips with layerToFormLayer for a layer without a name', () => {
    const original = createMockLayer({
      id: 'xyz',
      selection: { type: 'assigned', instances: [] },
      arrangement: 'shuffled',
      cycleMode: true,
      playbackMode: 'loop',
      retriggerMode: 'next',
      volume: 60,
    });
    expect(formLayerToLayer(layerToFormLayer(original))).toEqual(original);
  });

  it('preserves tag selection fields', () => {
    const form: LayerConfigForm = {
      id: 'def',
      selection: { type: 'tag', tagIds: ['t1'], matchMode: 'any', defaultVolume: 50 },
      arrangement: 'simultaneous',
      cycleMode: false,
      playbackMode: 'one-shot',
      retriggerMode: 'restart',
      volume: 100,
    };
    expect(formLayerToLayer(form).selection).toEqual({
      type: 'tag',
      tagIds: ['t1'],
      matchMode: 'any',
      defaultVolume: 50,
    });
  });

  it("preserves tag selection with matchMode 'all'", () => {
    const form: LayerConfigForm = {
      id: 'jkl',
      selection: { type: 'tag', tagIds: ['t1', 't2'], matchMode: 'all', defaultVolume: 80 },
      arrangement: 'simultaneous',
      cycleMode: false,
      playbackMode: 'one-shot',
      retriggerMode: 'restart',
      volume: 100,
    };
    expect(formLayerToLayer(form).selection).toEqual({
      type: 'tag',
      tagIds: ['t1', 't2'],
      matchMode: 'all',
      defaultVolume: 80,
    });
  });

  it('preserves set selection fields', () => {
    const form: LayerConfigForm = {
      id: 'ghi',
      selection: { type: 'set', setId: 's1', defaultVolume: 90 },
      arrangement: 'simultaneous',
      cycleMode: false,
      playbackMode: 'one-shot',
      retriggerMode: 'restart',
      volume: 100,
    };
    expect(formLayerToLayer(form).selection).toEqual({
      type: 'set',
      setId: 's1',
      defaultVolume: 90,
    });
  });
});

describe('summarizeLayerSelection', () => {
  it("returns 'No sounds assigned' for an assigned selection with 0 sounds", () => {
    const layer = createMockLayer({ selection: { type: 'assigned', instances: [] } });
    expect(summarizeLayerSelection(layer, [], [], [])).toBe('No sounds assigned');
  });

  it('returns the single sound name for an assigned selection with 1 sound', () => {
    const layer = createMockLayer({ selection: { type: 'assigned', instances: [] } });
    const sound = createMockSound({ name: 'Kick' });
    expect(summarizeLayerSelection(layer, [sound], [], [])).toBe('Kick');
  });

  it('returns comma-joined names for an assigned selection with multiple sounds', () => {
    const layer = createMockLayer({ selection: { type: 'assigned', instances: [] } });
    const s1 = createMockSound({ name: 'Kick' });
    const s2 = createMockSound({ name: 'Snare' });
    const s3 = createMockSound({ name: 'Hat' });
    expect(summarizeLayerSelection(layer, [s1, s2, s3], [], [])).toBe('Kick, Snare, Hat');
  });

  it("returns 'Tag: <name>' for a tag selection with a matching tag", () => {
    const tag = createMockTag({ id: 't1', name: 'drums' });
    const layer = createMockLayer({
      selection: { type: 'tag', tagIds: ['t1'], matchMode: 'any', defaultVolume: 100 },
    });
    expect(summarizeLayerSelection(layer, [], [tag], [])).toBe('Tag: drums');
  });

  it('returns comma-joined tag names for a tag selection with multiple tags', () => {
    const t1 = createMockTag({ id: 't1', name: 'drums' });
    const t2 = createMockTag({ id: 't2', name: 'loops' });
    const layer = createMockLayer({
      selection: { type: 'tag', tagIds: ['t1', 't2'], matchMode: 'all', defaultVolume: 100 },
    });
    expect(summarizeLayerSelection(layer, [], [t1, t2], [])).toBe('Tag: drums, loops');
  });

  it('falls back to the tag ID when the tag is unknown', () => {
    const layer = createMockLayer({
      selection: { type: 'tag', tagIds: ['unknown-id'], matchMode: 'any', defaultVolume: 100 },
    });
    expect(summarizeLayerSelection(layer, [], [], [])).toBe('Tag: unknown-id');
  });

  it("returns 'Tag: —' for a tag selection with empty tagIds", () => {
    const layer = createMockLayer({
      selection: { type: 'tag', tagIds: [], matchMode: 'any', defaultVolume: 100 },
    });
    expect(summarizeLayerSelection(layer, [], [], [])).toBe('Tag: —');
  });

  it("returns 'Set: <name>' for a set selection with a matching set", () => {
    const set = createMockSet({ id: 's1', name: 'intro-sounds' });
    const layer = createMockLayer({
      selection: { type: 'set', setId: 's1', defaultVolume: 100 },
    });
    expect(summarizeLayerSelection(layer, [], [], [set])).toBe('Set: intro-sounds');
  });

  it('falls back to the set ID when the set is unknown', () => {
    const layer = createMockLayer({
      selection: { type: 'set', setId: 'unknown-set', defaultVolume: 100 },
    });
    expect(summarizeLayerSelection(layer, [], [], [])).toBe('Set: unknown-set');
  });
});

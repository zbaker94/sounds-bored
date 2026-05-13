import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createMockSound, createMockTag } from '@/test/factories';
import { useSoundStats } from './useSoundStats';

describe('useSoundStats', () => {
  describe('empty input', () => {
    it('returns empty maps and no fuse results for an empty sounds array', () => {
      const { result } = renderHook(() => useSoundStats([], []));
      expect(result.current.tagCountMap).toEqual({});
      expect(result.current.setCountMap).toEqual({});
      expect(result.current.fuse.search('anything')).toEqual([]);
    });
  });

  describe('tagCountMap', () => {
    it('counts sounds per tag across multiple sounds', () => {
      const tagA = createMockTag({ id: 'tag-a', name: 'Drums' });
      const tagB = createMockTag({ id: 'tag-b', name: 'Loops' });
      const tagC = createMockTag({ id: 'tag-c', name: 'FX' });
      const sounds = [
        createMockSound({ id: 's1', tags: ['tag-a', 'tag-b'] }),
        createMockSound({ id: 's2', tags: ['tag-a'] }),
        createMockSound({ id: 's3', tags: ['tag-b', 'tag-c'] }),
      ];
      const { result } = renderHook(() => useSoundStats(sounds, [tagA, tagB, tagC]));

      expect(result.current.tagCountMap).toEqual({
        'tag-a': 2,
        'tag-b': 2,
        'tag-c': 1,
      });
    });

    it('returns an empty object when no sounds have tags', () => {
      const sounds = [
        createMockSound({ id: 's1', tags: [] }),
        createMockSound({ id: 's2', tags: [] }),
      ];
      const { result } = renderHook(() => useSoundStats(sounds, []));

      expect(result.current.tagCountMap).toEqual({});
    });

    it('counts duplicate tag IDs in a single sound multiple times', () => {
      const sounds = [createMockSound({ id: 's1', tags: ['tag-a', 'tag-a'] })];
      const { result } = renderHook(() => useSoundStats(sounds, []));
      expect(result.current.tagCountMap).toEqual({ 'tag-a': 2 });
    });
  });

  describe('setCountMap', () => {
    it('counts each set once per sound, across multiple sets', () => {
      const sounds = [
        createMockSound({ id: 's1', sets: ['set-a', 'set-b'] }),
        createMockSound({ id: 's2', sets: ['set-a'] }),
        createMockSound({ id: 's3', sets: ['set-b', 'set-c'] }),
      ];
      const { result } = renderHook(() => useSoundStats(sounds, []));

      expect(result.current.setCountMap).toEqual({
        'set-a': 2,
        'set-b': 2,
        'set-c': 1,
      });
    });

    it('returns an empty object when no sounds belong to any set', () => {
      const sounds = [
        createMockSound({ id: 's1', sets: [] }),
        createMockSound({ id: 's2', sets: [] }),
      ];
      const { result } = renderHook(() => useSoundStats(sounds, []));

      expect(result.current.setCountMap).toEqual({});
    });
  });

  describe('fuse search index', () => {
    it('fuzzy-matches by sound name', () => {
      const sounds = [
        createMockSound({ id: 's1', name: 'Kick Drum' }),
        createMockSound({ id: 's2', name: 'Snare Drum' }),
        createMockSound({ id: 's3', name: 'Hi-Hat' }),
      ];
      const { result } = renderHook(() => useSoundStats(sounds, []));

      // Slightly fuzzy query against "Kick Drum"
      const matches = result.current.fuse.search('kik').map((r) => r.item.sound.id);
      expect(matches).toContain('s1');
      expect(matches[0]).toBe('s1');
      expect(matches).not.toContain('s3');
    });

    it('matches by tag name resolved from tag IDs', () => {
      const tagDrums = createMockTag({ id: 'tag-drums', name: 'Drums' });
      const tagFx = createMockTag({ id: 'tag-fx', name: 'FX' });
      const sounds = [
        createMockSound({ id: 's1', name: 'Alpha', tags: ['tag-drums'] }),
        createMockSound({ id: 's2', name: 'Beta', tags: ['tag-fx'] }),
        createMockSound({ id: 's3', name: 'Gamma', tags: [] }),
      ];
      const { result } = renderHook(() => useSoundStats(sounds, [tagDrums, tagFx]));

      const matches = result.current.fuse.search('Drum').map((r) => r.item.sound.id);
      expect(matches).toContain('s1');
      expect(matches).not.toContain('s2');
      expect(matches).not.toContain('s3');
    });

    it('returns an empty array when nothing matches the query', () => {
      const sounds = [
        createMockSound({ id: 's1', name: 'Kick' }),
        createMockSound({ id: 's2', name: 'Snare' }),
      ];
      const { result } = renderHook(() => useSoundStats(sounds, []));

      expect(result.current.fuse.search('zzzzzzz-no-match-zzzzzzz')).toEqual([]);
    });

    it('resolves unknown tag IDs to empty string without false matches', () => {
      const sounds = [createMockSound({ id: 's1', name: 'Alpha', tags: ['nonexistent-id'] })];
      const { result } = renderHook(() => useSoundStats(sounds, []));
      // Sound has a stale tag ID — its tagName resolves to ''; should not match on tag name
      const matches = result.current.fuse.search('nonexistent').map((r) => r.item.sound.id);
      expect(matches).not.toContain('s1');
    });
  });

  describe('recomputation on prop changes', () => {
    it('updates count maps when the sounds array changes', () => {
      const initialSounds = [
        createMockSound({ id: 's1', tags: ['tag-a'], sets: ['set-a'] }),
      ];
      const { result, rerender } = renderHook(
        ({ sounds }: { sounds: ReturnType<typeof createMockSound>[] }) =>
          useSoundStats(sounds, []),
        { initialProps: { sounds: initialSounds } }
      );

      expect(result.current.tagCountMap).toEqual({ 'tag-a': 1 });
      expect(result.current.setCountMap).toEqual({ 'set-a': 1 });

      const updatedSounds = [
        createMockSound({ id: 's1', tags: ['tag-a'], sets: ['set-a'] }),
        createMockSound({ id: 's2', tags: ['tag-a', 'tag-b'], sets: ['set-b'] }),
      ];
      rerender({ sounds: updatedSounds });

      expect(result.current.tagCountMap).toEqual({ 'tag-a': 2, 'tag-b': 1 });
      expect(result.current.setCountMap).toEqual({ 'set-a': 1, 'set-b': 1 });
    });

    it('rebuilds fuse index when tags array changes', () => {
      const tagDrums = createMockTag({ id: 'tag-1', name: 'Drums' });
      const sounds = [createMockSound({ id: 's1', name: 'Alpha', tags: ['tag-1'] })];
      const { result, rerender } = renderHook(
        ({ tags }: { tags: ReturnType<typeof createMockTag>[] }) =>
          useSoundStats(sounds, tags),
        { initialProps: { tags: [tagDrums] } }
      );
      expect(result.current.fuse.search('Drums').map((r) => r.item.sound.id)).toContain('s1');
      const tagBeats = createMockTag({ id: 'tag-1', name: 'Beats' });
      rerender({ tags: [tagBeats] });
      expect(result.current.fuse.search('Beats').map((r) => r.item.sound.id)).toContain('s1');
      expect(result.current.fuse.search('Drums').map((r) => r.item.sound.id)).not.toContain('s1');
    });
  });
});

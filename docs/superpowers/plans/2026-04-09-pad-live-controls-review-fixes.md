# Pad Live Controls — Review Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 22 issues identified in the 4-dimensional code review of `feature/pad-live-controls`, then re-run the same review.

**Architecture:** Fixes are grouped into phases: (1) isolated bug fixes, (2) consolidation/refactoring, (3) prop-drilling elimination via new `multiFadeStore`, (4) test coverage. The store refactor (Task 10) is the most impactful change — it moves all multi-fade UI state out of a hook and into a Zustand store so `PadButton`, `MultiFadePill`, and `PadLiveControlPopover` can subscribe directly without prop-drilling.

**Tech Stack:** React 19, TypeScript strict, Zustand, Vitest + Testing Library, Web Audio API, react-hotkeys-hook, motion/react

---

## File Map

| File | Change |
|------|--------|
| `src/components/composite/SceneView/SceneView.tsx` | Remove duplicate `MultiFadePill`, use `multiFadeStore` selectors |
| `src/components/composite/SceneView/MultiFadePill.tsx` | Remove unused `pads` prop, read from store |
| `src/components/composite/SceneView/PadButton.tsx` | Remove `multiFadeMode` prop, read from store; fix `multiFadeHandlers`, fix `useCallback` |
| `src/components/composite/SceneView/PadLiveControlPopover.tsx` | Fix RAF gating, fix stale `fadeLevels`, fix `layerVolumes` selector, fix `onPointerUp`, remove `onMultiFadeStart` prop |
| `src/hooks/useMultiFadeMode.ts` | Simplify to orchestration only (effects + `execute` + hotkeys); reads/writes `multiFadeStore` |
| `src/state/multiFadeStore.ts` | **NEW** — Zustand store for multi-fade UI state |
| `src/lib/audio/padPlayer.ts` | Fix `skipLayerForward`/`skipLayerBack`; add `fadePadWithLevels` helper |
| `src/state/playbackStore.ts` | Add `removeLayerVolume` action |
| `src/hooks/useMultiFadeMode.test.ts` | **NEW** — comprehensive tests |
| `src/components/composite/SceneView/MultiFadePill.test.tsx` | **NEW** — rendering tests |
| `src/components/composite/SceneView/PadButton.test.tsx` | Add multi-fade and right-click tests |
| `src/state/playbackStore.test.ts` | Add `updateLayerVolume`/`removeLayerVolume` tests |
| `src/lib/audio/padPlayer.test.ts` | Add `skipLayerForward`, `skipLayerBack`, `setLayerVolume` tests |

---

## Task 1: Quick one-liner fixes

**Files:**
- Modify: `src/components/composite/SceneView/SceneView.tsx`
- Modify: `src/components/composite/SceneView/MultiFadePill.tsx`
- Modify: `src/components/composite/SceneView/PadButton.tsx`

- [ ] **Step 1: Remove duplicate MultiFadePill render from SceneView.tsx**

In `SceneView.tsx`, the `MultiFadePill` is rendered twice. Find and delete the second `<AnimatePresence>` block (the one that appears AFTER the pagination block, around line 290–294):

```tsx
// DELETE these 5 lines:
      <AnimatePresence>
        {multiFadeMode.active && (
          <MultiFadePill key="multi-fade-pill" mode={multiFadeMode} pads={pads} />
        )}
      </AnimatePresence>
```

Keep only the first instance (before the pagination block).

- [ ] **Step 2: Remove unused `pads` prop from MultiFadePill**

In `src/components/composite/SceneView/MultiFadePill.tsx`, update the interface and function signature:

```tsx
// BEFORE:
interface MultiFadePillProps {
  mode: UseMultiFadeModeReturn;
  pads: Pad[];
}

export function MultiFadePill({ mode, pads: _pads }: MultiFadePillProps) {

// AFTER:
interface MultiFadePillProps {
  mode: UseMultiFadeModeReturn;
}

export function MultiFadePill({ mode }: MultiFadePillProps) {
```

Remove the `import type { Pad }` line if it becomes unused.

- [ ] **Step 3: Fix `handleContextMenu` in PadButton — useMemo → useCallback**

In `src/components/composite/SceneView/PadButton.tsx`, find the `handleContextMenu` declaration (around line 192) and change `useMemo` to `useCallback`:

```tsx
// BEFORE:
  const handleContextMenu = useMemo(() => (e: React.MouseEvent) => {
    if (editMode || multiFadeActive) return;
    e.preventDefault();
    setPopoverOpen(true);
  }, [editMode, multiFadeActive]);

// AFTER:
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (editMode || multiFadeActive) return;
    e.preventDefault();
    setPopoverOpen(true);
  }, [editMode, multiFadeActive]);
```

- [ ] **Step 4: Update the SceneView.tsx `MultiFadePill` call site to remove `pads` prop**

In `SceneView.tsx`, find the remaining `MultiFadePill` render and remove the `pads` prop:

```tsx
// BEFORE:
          <MultiFadePill key="multi-fade-pill" mode={multiFadeMode} pads={pads} />
// AFTER:
          <MultiFadePill key="multi-fade-pill" mode={multiFadeMode} />
```

- [ ] **Step 5: Run TypeScript + tests to verify**

```bash
cd C:/Repos/sounds-bored && npx tsc --noEmit
```
Expected: no errors.

```bash
npm run test:run 2>&1 | tail -20
```
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/SceneView/SceneView.tsx src/components/composite/SceneView/MultiFadePill.tsx src/components/composite/SceneView/PadButton.tsx
git commit -m "fix: remove duplicate MultiFadePill render and unused pads prop"
```

---

## Task 2: Fix skipLayerForward and skipLayerBack

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`

Both skip functions call `stopLayerWithRamp(pad, layerId)` which internally deletes the chain and play-order, then try to read them — always finding nothing. Additionally, `skipLayerBack` uses `layerCycleIndex` which only tracks position for `cycleMode=true` layers.

The fix: save the chain/playOrder references BEFORE calling `stopLayerWithRamp`, then use the play-order length minus chain length to determine current position for `skipLayerBack`.

- [ ] **Step 1: Fix `skipLayerForward`**

Find `skipLayerForward` in `padPlayer.ts` (around line 965). Replace the function body:

```typescript
export function skipLayerForward(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (!isChained(layer.arrangement)) return;

  // Save the chain BEFORE stopLayerWithRamp deletes it
  const remaining = getLayerChain(layerId);
  if (!remaining || remaining.length === 0) return;

  const [next, ...rest] = remaining;

  stopLayerWithRamp(pad, layerId);
  setLayerChain(layerId, rest);

  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, sounds);

  ensureResumed().then((ctx) => {
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layerId, layer.volume, padGain);
    startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
    usePlaybackStore.getState().addPlayingPad(pad.id);
  });
}
```

- [ ] **Step 2: Fix `skipLayerBack`**

Find `skipLayerBack` in `padPlayer.ts` (around line 992). Replace the function body:

```typescript
export function skipLayerBack(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (!isChained(layer.arrangement)) return;

  // Save playOrder and chain BEFORE stopLayerWithRamp deletes them
  const playOrder = getLayerPlayOrder(layerId);
  if (!playOrder || playOrder.length === 0) return;

  const chain = getLayerChain(layerId);

  // Derive current position from play order length vs remaining chain length.
  // When sound at index N is playing, chain contains [N+1, N+2, ...].
  // currentPos = playOrder.length - chain.length - 1, clamped to valid range.
  const currentPos = Math.max(0, playOrder.length - (chain?.length ?? 0) - 1);
  const prevPos = Math.max(0, currentPos - 1);

  const sound = playOrder[prevPos];

  stopLayerWithRamp(pad, layerId);

  // Rebuild chain from prevPos+1 forward
  setLayerChain(layerId, playOrder.slice(prevPos + 1));

  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, sounds);

  ensureResumed().then((ctx) => {
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layerId, layer.volume, padGain);
    startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
    usePlaybackStore.getState().addPlayingPad(pad.id);
  });
}
```

- [ ] **Step 3: Run TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/audio/padPlayer.ts
git commit -m "fix: skipLayerForward/Back now save chain refs before stop so skip actually works"
```

---

## Task 3: Fix RAF loop gating in PadLiveControlPopover

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`

The polling loop runs unconditionally at 60fps, allocating a new `Set` and calling `setState` every frame even when nothing is playing. Fix: gate on `isPlaying` and bail if the new set contents match the previous.

- [ ] **Step 1: Replace the `useEffect` polling block**

In `PadLiveControlPopover.tsx`, find the `useEffect` that creates the RAF polling loop (around line 82). Replace it entirely:

```typescript
  useEffect(() => {
    if (!isPlaying) {
      setActiveLayerIds(new Set());
      return;
    }
    const poll = () => {
      const active = new Set<string>();
      for (const layer of pad.layers) {
        if (checkLayerActive(layer.id)) active.add(layer.id);
      }
      setActiveLayerIds((prev) => {
        if (prev.size === active.size && [...prev].every((id) => active.has(id))) return prev;
        return active;
      });
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [pad.layers, isPlaying]);
```

- [ ] **Step 2: Run TypeScript + tests**

```bash
npx tsc --noEmit && npm run test:run 2>&1 | tail -10
```

Expected: no errors, all passing.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/SceneView/PadLiveControlPopover.tsx
git commit -m "perf: gate popover RAF loop on isPlaying, skip setState when set unchanged"
```

---

## Task 4: Fix stale `fadeLevels` initializer in PadLiveControlPopover

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`

`fadeLevels` is initialized once at mount. If the pad's playing state changes after the popover opens, the slider retains stale values. Fix: add a `useEffect` that resets the levels when `isPlaying` changes.

- [ ] **Step 1: Add a sync effect after the fadeLevels declaration**

In `PadLiveControlContent`, after the `fadeLevels` state declaration (around line 71), add:

```typescript
  // Sync fade levels when playing state changes (e.g. pad starts/stops while popover is open)
  useEffect(() => {
    setFadeLevels(isPlaying ? [0, Math.round(padVolume * 100)] : [0, 100]);
    // Only reset on playback-state transitions, not on every padVolume tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);
```

- [ ] **Step 2: Run TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/SceneView/PadLiveControlPopover.tsx
git commit -m "fix: reset fadeLevels when pad playing state changes while popover is open"
```

---

## Task 5: Fix `useHotkeys` stale closure deps in `useMultiFadeMode`

**Files:**
- Modify: `src/hooks/useMultiFadeMode.ts`

The `useHotkeys` calls wrap `execute` and `cancel` in arrow functions but don't pass them as deps. When `execute` or `cancel` change (e.g. `selectedPads` changes), the hotkey invokes a stale version.

- [ ] **Step 1: Fix the two `useHotkeys` calls**

In `useMultiFadeMode.ts`, find the two `useHotkeys` calls at the bottom of the function. Replace them:

```typescript
  // BEFORE:
  useHotkeys("enter", () => {
    if (active && canExecute) execute();
  }, { enabled: active });

  useHotkeys("escape", () => {
    if (active) cancel();
  }, { enabled: active });

  // AFTER:
  useHotkeys("enter", execute, { enabled: active && canExecute }, [execute]);
  useHotkeys("escape", cancel, { enabled: active }, [cancel]);
```

- [ ] **Step 2: Run TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMultiFadeMode.ts
git commit -m "fix: pass execute/cancel as useHotkeys deps to prevent stale closure"
```

---

## Task 6: Fix PadButton multiFadeHandlers performance

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`

`liveVolume` changes every RAF frame during fades, causing `multiFadeHandlers` to be recreated every frame. Fix: read volume imperatively inside the handler instead of closing over the reactive value.

- [ ] **Step 1: Update `multiFadeHandlers` useMemo**

In `PadButton.tsx`, find the `multiFadeHandlers` declaration (around line 183). Replace:

```typescript
  // BEFORE:
  const multiFadeHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      multiFadeMode?.togglePad(pad, liveVolume);
    },
  }), [multiFadeMode, pad, liveVolume]);

  // AFTER:
  const multiFadeHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const vol = usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0;
      multiFadeMode?.togglePad(pad, vol);
    },
  }), [multiFadeMode, pad]);
```

Make sure `usePlaybackStore` is already imported at the top of `PadButton.tsx` (it is).

- [ ] **Step 2: Run TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx
git commit -m "perf: read liveVolume imperatively in multiFadeHandlers to prevent 60fps invalidation"
```

---

## Task 7: Fix `onPointerUp` out-of-bounds in PadLiveControlPopover

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`

When the user drags a slider thumb and releases the pointer outside the slider element, the `onPointerUp` on `SliderPrimitive.Root` doesn't fire, leaving `thumbsDragging` stuck. Fix: listen on `window` via `useEffect`.

- [ ] **Step 1: Replace the onPointerUp prop with a window listener**

In `PadLiveControlContent`, find the `SliderPrimitive.Root` for the fade slider (around line 182). Remove the `onPointerUp` prop:

```tsx
// BEFORE:
          <SliderPrimitive.Root
            value={fadeLevels}
            onValueChange={(v) => setFadeLevels(v as [number, number])}
            onPointerUp={() => setThumbsDragging([false, false])}
            ...

// AFTER:
          <SliderPrimitive.Root
            value={fadeLevels}
            onValueChange={(v) => setFadeLevels(v as [number, number])}
            ...
```

Then add a `useEffect` near the `thumbsDragging` state declaration:

```typescript
  // Clear drag state on any pointer-up, even outside the slider element
  useEffect(() => {
    const handlePointerUp = () => setThumbsDragging([false, false]);
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);
```

- [ ] **Step 2: Run TypeScript + tests**

```bash
npx tsc --noEmit && npm run test:run 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/SceneView/PadLiveControlPopover.tsx
git commit -m "fix: clear slider drag state on window pointerup to handle out-of-bounds release"
```

---

## Task 8: Consolidate fade execution logic

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/hooks/useMultiFadeMode.ts`
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`

`useMultiFadeMode.execute()` and `PadLiveControlPopover.handleFade()` both contain identical logic: choose `fadePadOut` vs `fadePadIn` based on playing state, with levels from a `[number, number]` tuple. Extract a shared helper `fadePadWithLevels` in `padPlayer.ts`.

- [ ] **Step 1: Add `fadePadWithLevels` to padPlayer.ts**

After the `fadePadIn` function (around line 199), add:

```typescript
/**
 * Execute a fade using a two-thumb level pair [from, to] (0–100 integers).
 * For a playing pad: fades out from levels[1]/100 to levels[0]/100.
 * For a stopped pad: fades in from levels[0]/100 to levels[1]/100.
 */
export function fadePadWithLevels(
  pad: Pad,
  durationMs: number,
  levels: [number, number],
  playing: boolean,
): void {
  if (playing) {
    fadePadOut(pad, durationMs, levels[1] / 100, levels[0] / 100);
  } else {
    fadePadIn(pad, durationMs, levels[0] / 100, levels[1] / 100).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Playback error: audio fade failed — ${message}`);
    });
  }
}
```

- [ ] **Step 2: Update `useMultiFadeMode.execute()` to use `fadePadWithLevels`**

In `useMultiFadeMode.ts`, update the imports to add `fadePadWithLevels`:

```typescript
import {
  fadePadWithLevels,
  resolveFadeDuration,
} from "@/lib/audio/padPlayer";
```

Remove the `fadePadOut` and `fadePadIn` imports (they're no longer used directly in this file).

Then update `execute()`:

```typescript
  const execute = useCallback(() => {
    if (!canExecute) return;
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

    for (const [padId, fade] of selectedPads) {
      const pad = pads.find((p) => p.id === padId);
      if (!pad) continue;
      const duration = resolveFadeDuration(pad, globalFadeDurationMs);
      fadePadWithLevels(pad, duration, fade.levels, isPadActive(padId));
    }

    setActive(false);
    setOriginPadId(null);
    setSelectedPads(new Map());
  }, [canExecute, selectedPads, pads]);
```

- [ ] **Step 3: Update `handleFade` in PadLiveControlPopover to use `fadePadWithLevels`**

In `PadLiveControlPopover.tsx`, update the import from `@/lib/audio/padPlayer`:

```typescript
import {
  triggerPad,
  stopPad,
  fadePadWithLevels,
  resolveFadeDuration,
  triggerLayer,
  stopLayerWithRamp,
  setLayerVolume,
  skipLayerForward,
  skipLayerBack,
} from "@/lib/audio/padPlayer";
```

Remove `fadePadOut` and `fadePadIn` from the import.

Then replace `handleFade`:

```typescript
  const handleFade = useCallback(() => {
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;
    const duration = resolveFadeDuration(pad, globalFadeDurationMs);
    fadePadWithLevels(pad, duration, fadeLevels, isPlaying);
    onClose();
  }, [isPlaying, pad, fadeLevels, onClose]);
```

- [ ] **Step 4: Run TypeScript + tests**

```bash
npx tsc --noEmit && npm run test:run 2>&1 | tail -10
```

Expected: no errors, all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/padPlayer.ts src/hooks/useMultiFadeMode.ts src/components/composite/SceneView/PadLiveControlPopover.tsx
git commit -m "refactor: extract fadePadWithLevels helper to eliminate duplicate fade logic"
```

---

## Task 9: Fix `layerVolumes` whole-record selector — extract `LayerRow` component

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`

`PadLiveControlContent` subscribes to `s.layerVolumes` (the entire record). Each call to `updateLayerVolume` creates a new record object, triggering a re-render of the whole component on every slider tick, even if only one layer's volume changed. Fix: extract a `LayerRow` sub-component that subscribes to a single layer's volume via a targeted selector.

- [ ] **Step 1: Extract `LayerRow` component in `PadLiveControlPopover.tsx`**

Just before the `PadLiveControlContent` function definition, add a new component:

```typescript
interface LayerRowProps {
  pad: Pad;
  layer: Pad["layers"][number];
  layerActive: boolean;
  idx: number;
}

function LayerRow({ pad, layer, layerActive, idx }: LayerRowProps) {
  const layerVol = usePlaybackStore((s) => Math.round((s.layerVolumes[layer.id] ?? 1.0) * 100));
  const showSkip = layer.arrangement === "sequential" || layer.arrangement === "shuffled";

  return (
    <motion.div
      key={layer.id}
      className="flex flex-col gap-1 rounded-lg bg-muted/50 p-1.5"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, delay: STAGGER_DELAY * 2 + idx * 0.03 }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-xs ${layerActive ? "text-emerald-400" : "text-muted-foreground"}`}>
          {layerActive ? "\u25CF" : "\u25CB"}
        </span>
        <span className="text-xs font-medium flex-1 truncate">
          {layer.name || `Layer ${idx + 1}`}
        </span>
        <AnimatePresence mode="wait">
          {layerActive ? (
            <motion.div key="stop-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <button
                type="button"
                onClick={() => stopLayerWithRamp(pad, layer.id)}
                className="p-0.5 rounded hover:bg-destructive/20 transition-colors"
                aria-label={`Stop ${layer.name || `Layer ${idx + 1}`}`}
              >
                <HugeiconsIcon icon={StopIcon} size={12} />
              </button>
            </motion.div>
          ) : (
            <motion.div key="play-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <button
                type="button"
                onClick={() => {
                  triggerLayer(pad, layer).catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    toast.error(`Playback error: ${message}`);
                  });
                }}
                className="p-0.5 rounded hover:bg-primary/20 transition-colors"
                aria-label={`Play ${layer.name || `Layer ${idx + 1}`}`}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {showSkip && (
          <>
            <button
              type="button"
              onClick={() => skipLayerBack(pad, layer.id)}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              aria-label="Skip back"
            >
              <HugeiconsIcon icon={PreviousIcon} size={12} />
            </button>
            <button
              type="button"
              onClick={() => skipLayerForward(pad, layer.id)}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              aria-label="Skip forward"
            >
              <HugeiconsIcon icon={NextIcon} size={12} />
            </button>
          </>
        )}
      </div>
      <SliderPrimitive.Root
        value={[layerVol]}
        onValueChange={([v]) => setLayerVolume(layer.id, v / 100)}
        min={0}
        max={100}
        step={1}
        className="relative flex w-full touch-none items-center select-none"
      >
        <SliderPrimitive.Track className="relative grow overflow-hidden rounded-4xl bg-muted h-2 w-full">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-3 shrink-0 rounded-4xl border border-primary bg-white shadow-sm ring-ring/50 transition-colors select-none hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden" />
      </SliderPrimitive.Root>
    </motion.div>
  );
}
```

- [ ] **Step 2: Update `PadLiveControlContent` to remove `layerVolumes` subscription and use `LayerRow`**

In `PadLiveControlContent`, remove this line:
```typescript
  const layerVolumes = usePlaybackStore((s) => s.layerVolumes);
```

Then replace the layers `map` inside the "Layers section" `<div>`:

```tsx
        <div className="flex flex-col gap-1">
          {pad.layers.map((layer, idx) => (
            <LayerRow
              key={layer.id}
              pad={pad}
              layer={layer}
              layerActive={activeLayerIds.has(layer.id)}
              idx={idx}
            />
          ))}
        </div>
```

Remove the old per-layer `motion.div` map (the entire block that includes `layerVol`, `showSkip`, the layer render, etc.) since it's now in `LayerRow`.

- [ ] **Step 3: Run TypeScript + tests**

```bash
npx tsc --noEmit && npm run test:run 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/PadLiveControlPopover.tsx
git commit -m "perf: extract LayerRow to scope layerVolumes subscription per-layer"
```

---

## Task 10: Move multi-fade state to dedicated Zustand store

**Files:**
- Create: `src/state/multiFadeStore.ts`
- Modify: `src/hooks/useMultiFadeMode.ts`
- Modify: `src/components/composite/SceneView/PadButton.tsx`
- Modify: `src/components/composite/SceneView/SceneView.tsx`
- Modify: `src/components/composite/SceneView/MultiFadePill.tsx`
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`

Multi-fade UI state (`active`, `originPadId`, `selectedPads`, `reopenPadId`) is currently held in `useState` inside `useMultiFadeMode` and prop-drilled through SceneView → PadButton. CLAUDE.md says domain components connect to the store directly. This task moves the state to a store and lets each component subscribe directly.

- [ ] **Step 1: Create `src/state/multiFadeStore.ts`**

```typescript
import { create } from "zustand";

export interface SelectedPadFade {
  padId: string;
  levels: [number, number]; // [from, to] as 0–100 integers
}

interface MultiFadeState {
  active: boolean;
  originPadId: string | null;
  selectedPads: Map<string, SelectedPadFade>;
  reopenPadId: string | null;
}

interface MultiFadeActions {
  /** Activate multi-fade mode with the origin pad pre-selected. */
  enterMultiFade: (padId: string, levels: [number, number]) => void;
  /** Toggle a pad in/out of the selection. */
  toggleMultiFadePad: (padId: string, levels: [number, number]) => void;
  /** Update fade levels for an already-selected pad. No-op if not selected. */
  setMultiFadeLevels: (padId: string, levels: [number, number]) => void;
  /**
   * Cancel multi-fade mode, storing originPadId in reopenPadId so the caller
   * can reopen the pad's live-control popover.
   */
  cancelMultiFade: () => void;
  /**
   * Reset all multi-fade state without setting reopenPadId.
   * Used by auto-cancel effects (editMode, overlay open).
   */
  resetMultiFade: () => void;
  clearMultiFadeReopenPadId: () => void;
}

export type MultiFadeStore = MultiFadeState & MultiFadeActions;

export const initialMultiFadeState: MultiFadeState = {
  active: false,
  originPadId: null,
  get selectedPads() { return new Map<string, SelectedPadFade>(); },
  reopenPadId: null,
};

export const useMultiFadeStore = create<MultiFadeStore>()((set) => ({
  active: false,
  originPadId: null,
  selectedPads: new Map(),
  reopenPadId: null,

  enterMultiFade: (padId, levels) =>
    set({
      active: true,
      originPadId: padId,
      selectedPads: new Map([[padId, { padId, levels }]]),
    }),

  toggleMultiFadePad: (padId, levels) =>
    set((s) => {
      const next = new Map(s.selectedPads);
      if (next.has(padId)) {
        next.delete(padId);
      } else {
        next.set(padId, { padId, levels });
      }
      return { selectedPads: next };
    }),

  setMultiFadeLevels: (padId, levels) =>
    set((s) => {
      const entry = s.selectedPads.get(padId);
      if (!entry) return s;
      const next = new Map(s.selectedPads);
      next.set(padId, { ...entry, levels });
      return { selectedPads: next };
    }),

  cancelMultiFade: () =>
    set((s) => ({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: s.originPadId,
    })),

  resetMultiFade: () =>
    set({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
    }),

  clearMultiFadeReopenPadId: () => set({ reopenPadId: null }),
}));
```

- [ ] **Step 2: Rewrite `src/hooks/useMultiFadeMode.ts`**

The hook becomes a thin orchestrator: it reads from the store, handles the auto-cancel effects, provides the `execute` function (which calls audio APIs), and registers hotkeys. It no longer returns all the state — callers read that from `useMultiFadeStore` directly.

```typescript
import { useCallback, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { fadePadWithLevels, resolveFadeDuration } from "@/lib/audio/padPlayer";
import { isPadActive } from "@/lib/audio/audioState";
import type { Pad } from "@/lib/schemas";
import { useMultiFadeStore } from "@/state/multiFadeStore";

export type { SelectedPadFade } from "@/state/multiFadeStore";

/** Orchestrates multi-fade mode: auto-cancel effects, execute (audio calls), hotkeys.
 *  State is in useMultiFadeStore — subscribe there for reactive UI. */
export function useMultiFadeMode(pads: Pad[]): { execute: () => void } {
  const active = useMultiFadeStore((s) => s.active);
  const selectedPads = useMultiFadeStore((s) => s.selectedPads);
  const resetMultiFade = useMultiFadeStore((s) => s.resetMultiFade);
  const cancelMultiFade = useMultiFadeStore((s) => s.cancelMultiFade);

  const editMode = useUiStore((s) => s.editMode);
  const overlayStackLength = useUiStore((s) => s.overlayStack.length);

  // Auto-cancel (no reopen) when edit mode activates or any overlay opens
  useEffect(() => {
    if (editMode && active) resetMultiFade();
  }, [editMode, active, resetMultiFade]);

  useEffect(() => {
    if (overlayStackLength > 0 && active) resetMultiFade();
  }, [overlayStackLength, active, resetMultiFade]);

  const canExecute = active && selectedPads.size >= 1;

  const execute = useCallback(() => {
    if (!canExecute) return;
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

    for (const [padId, fade] of selectedPads) {
      const pad = pads.find((p) => p.id === padId);
      if (!pad) continue;
      const duration = resolveFadeDuration(pad, globalFadeDurationMs);
      fadePadWithLevels(pad, duration, fade.levels, isPadActive(padId));
    }

    resetMultiFade();
  }, [canExecute, selectedPads, pads, resetMultiFade]);

  useHotkeys("enter", execute, { enabled: active && canExecute }, [execute]);
  useHotkeys("escape", cancelMultiFade, { enabled: active }, [cancelMultiFade]);

  return { execute };
}
```

- [ ] **Step 3: Update `src/components/composite/SceneView/PadButton.tsx`**

Remove the `multiFadeMode` and `forcePopoverOpen`/`onPopoverOpened` props (they're unchanged — keep `forcePopoverOpen` and `onPopoverOpened`). Remove the `multiFadeMode` prop and add store subscriptions.

Update the import section — add the store import:
```typescript
import { useMultiFadeStore } from "@/state/multiFadeStore";
```

Remove the `UseMultiFadeModeReturn` import from `useMultiFadeMode`.

Update `PadButtonProps`:
```typescript
interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  index?: number;
  onEditClick?: (pad: Pad) => void;
  forcePopoverOpen?: boolean;
  onPopoverOpened?: () => void;
}
```

Update the component signature:
```typescript
export const PadButton = memo(function PadButton({ pad, sceneId, index = 0, onEditClick, forcePopoverOpen, onPopoverOpened }: PadButtonProps) {
```

Replace the old multi-fade derived state block with store subscriptions:
```typescript
  const multiFadeActive = useMultiFadeStore((s) => s.active);
  const isMultiFadeSelected = useMultiFadeStore((s) => s.active && s.selectedPads.has(pad.id));
  const multiFadeLevels = useMultiFadeStore((s) => s.selectedPads.get(pad.id)?.levels ?? null);
  const toggleMultiFadePad = useMultiFadeStore((s) => s.toggleMultiFadePad);
```

Remove the `liveVolume` usage from `multiFadeHandlers` (it now reads from store imperatively):
```typescript
  const multiFadeHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const vol = usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0;
      toggleMultiFadePad(pad.id, isPadActive(pad.id) ? [0, Math.round(vol * 100)] : [0, 100]);
    },
  }), [toggleMultiFadePad, pad.id]);
```

Add the `isPadActive` import from audioState if not already imported:
```typescript
import { getPadProgress, stopPad } from "@/lib/audio/padPlayer";
import { isPadActive } from "@/lib/audio/audioState";
```

Update the multi-fade slider `onValueChange` to use the store action:
```typescript
  const setMultiFadeLevels = useMultiFadeStore((s) => s.setMultiFadeLevels);
  // ...
  // In the slider:
  onValueChange={(v) => setMultiFadeLevels(pad.id, [v[0], v[1]])}
```

Update the `PadLiveControlPopover` call site — remove the `onMultiFadeStart` prop:
```tsx
      <PadLiveControlPopover
        pad={pad}
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        anchorRef={buttonRef}
      />
```

- [ ] **Step 4: Update `src/components/composite/SceneView/MultiFadePill.tsx`**

The component now reads all state from the store and receives `onExecute` as a prop (since execute involves audio calls that live in the hook):

```typescript
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { useMultiFadeStore } from "@/state/multiFadeStore";

interface MultiFadePillProps {
  onExecute: () => void;
}

export function MultiFadePill({ onExecute }: MultiFadePillProps) {
  const count = useMultiFadeStore((s) => s.selectedPads.size);
  const canExecute = useMultiFadeStore((s) => s.active && s.selectedPads.size >= 1);
  const cancelMultiFade = useMultiFadeStore((s) => s.cancelMultiFade);

  return (
    <motion.div
      className="absolute bottom-4 left-1/2 z-30 flex items-center gap-3 rounded-full bg-black/80 px-4 py-2 text-white shadow-lg border border-white/20 backdrop-blur-sm"
      style={{ x: "-50%" }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      <span className="text-sm font-medium tabular-nums">
        {count} pad{count !== 1 ? "s" : ""} selected
      </span>
      <Button
        size="sm"
        variant="default"
        disabled={!canExecute}
        onClick={onExecute}
        className="gap-1.5"
      >
        <HugeiconsIcon icon={PlayIcon} size={14} />
        Execute Fade
      </Button>
      <button
        type="button"
        onClick={cancelMultiFade}
        className="p-1 rounded-full hover:bg-white/20 transition-colors"
        aria-label="Cancel multi-fade"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={16} />
      </button>
    </motion.div>
  );
}
```

- [ ] **Step 5: Update `src/components/composite/SceneView/SceneView.tsx`**

Remove the `multiFadeMode` prop from `PadButton`, remove the `mode` prop from `MultiFadePill`, read `active` + `reopenPadId` from the store, and call `useMultiFadeMode` only for the `execute` function.

Add imports:
```typescript
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useMultiFadeMode } from "@/hooks/useMultiFadeMode";
```

Inside `SceneView()`, replace the `useMultiFadeMode` hook usage:
```typescript
  const { execute } = useMultiFadeMode(pads);
  const multiFadeActive = useMultiFadeStore((s) => s.active);
  const reopenPadId = useMultiFadeStore((s) => s.reopenPadId);
  const clearMultiFadeReopenPadId = useMultiFadeStore((s) => s.clearMultiFadeReopenPadId);
```

Update the `useEffect` that reopens the popover:
```typescript
  useEffect(() => {
    if (reopenPadId) {
      setOpenPopoverPadId(reopenPadId);
      clearMultiFadeReopenPadId();
    }
  }, [reopenPadId, clearMultiFadeReopenPadId]);
```

Update `PadButton` render — remove `multiFadeMode` prop:
```tsx
                <PadButton
                  pad={pad}
                  sceneId={activeScene.id}
                  index={i}
                  onEditClick={handleEditClick}
                  forcePopoverOpen={openPopoverPadId === pad.id}
                  onPopoverOpened={handlePopoverOpened}
                />
```

Update `MultiFadePill` render:
```tsx
      <AnimatePresence>
        {multiFadeActive && (
          <MultiFadePill key="multi-fade-pill" onExecute={execute} />
        )}
      </AnimatePresence>
```

- [ ] **Step 6: Update `src/components/composite/SceneView/PadLiveControlPopover.tsx`**

Remove the `onMultiFadeStart` prop (it's no longer needed — the component reads from the store directly).

Update `PadLiveControlPopoverProps`:
```typescript
interface PadLiveControlPopoverProps {
  pad: Pad;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}
```

Add the store import:
```typescript
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { isPadActive } from "@/lib/audio/audioState";
```

In `PadLiveControlContent`, replace `onMultiFadeStart` usage:
```typescript
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);

  const handleMultiFade = useCallback(() => {
    const playing = isPadActive(pad.id);
    const levels: [number, number] = playing ? [0, Math.round(padVolume * 100)] : [0, 100];
    enterMultiFade(pad.id, levels);
    onClose();
  }, [pad.id, padVolume, enterMultiFade, onClose]);
```

Update the `PadLiveControlContent` function signature (remove `onMultiFadeStart` param):
```typescript
function PadLiveControlContent({
  pad,
  onClose,
}: {
  pad: Pad;
  onClose: () => void;
}) {
```

Update both call sites in `PadLiveControlPopover` (desktop and mobile):
```tsx
            <PadLiveControlContent
              pad={pad}
              onClose={handleClose}
            />
```

- [ ] **Step 7: Run TypeScript**

```bash
npx tsc --noEmit
```

Fix any remaining type errors before proceeding.

- [ ] **Step 8: Run tests**

```bash
npm run test:run 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 9: Commit**

```bash
git add src/state/multiFadeStore.ts src/hooks/useMultiFadeMode.ts src/components/composite/SceneView/PadButton.tsx src/components/composite/SceneView/SceneView.tsx src/components/composite/SceneView/MultiFadePill.tsx src/components/composite/SceneView/PadLiveControlPopover.tsx
git commit -m "refactor: move multi-fade state to multiFadeStore, eliminate prop-drilling"
```

---

## Task 11: Add `removeLayerVolume` to playbackStore

**Files:**
- Modify: `src/state/playbackStore.ts`

`layerVolumes` accumulates entries but never removes them. Add a cleanup action.

- [ ] **Step 1: Add `removeLayerVolume` to the interface and implementation**

In `playbackStore.ts`, add to the interface:
```typescript
  /** Remove a single layer's volume entry (call when a layer is permanently deleted). */
  removeLayerVolume: (layerId: string) => void;
```

Add to the store implementation:
```typescript
  removeLayerVolume: (layerId) =>
    set((s) => {
      if (!(layerId in s.layerVolumes)) return s;
      const next = { ...s.layerVolumes };
      delete next[layerId];
      return { layerVolumes: next };
    }),
```

- [ ] **Step 2: Run TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/state/playbackStore.ts
git commit -m "feat: add removeLayerVolume action to playbackStore for cleanup"
```

---

## Task 12: Tests for `useMultiFadeMode`

**Files:**
- Create: `src/hooks/useMultiFadeMode.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiFadeMode } from "./useMultiFadeMode";
import { useMultiFadeStore, initialMultiFadeState } from "@/state/multiFadeStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { createMockPad, createMockLayer } from "@/test/factories";

vi.mock("@/lib/audio/padPlayer", () => ({
  fadePadWithLevels: vi.fn(),
  resolveFadeDuration: vi.fn().mockReturnValue(2000),
}));
vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
}));
vi.mock("@/state/appSettingsStore", () => ({
  useAppSettingsStore: { getState: () => ({ settings: null }) },
}));

import { fadePadWithLevels } from "@/lib/audio/padPlayer";
import { isPadActive } from "@/lib/audio/audioState";

function makePads(count = 2) {
  return Array.from({ length: count }, (_, i) =>
    createMockPad({ id: `pad-${i + 1}`, layers: [createMockLayer()] })
  );
}

describe("useMultiFadeMode", () => {
  beforeEach(() => {
    useMultiFadeStore.setState({ ...initialMultiFadeState, selectedPads: new Map() });
    useUiStore.setState({ ...initialUiState });
  });

  describe("auto-cancel on editMode", () => {
    it("resets multi-fade when editMode becomes true while active", () => {
      const pads = makePads();
      renderHook(() => useMultiFadeMode(pads));

      act(() => {
        useMultiFadeStore.getState().enterMultiFade("pad-1", [0, 100]);
      });
      expect(useMultiFadeStore.getState().active).toBe(true);

      act(() => {
        useUiStore.getState().toggleEditMode(); // sets editMode = true
      });
      expect(useMultiFadeStore.getState().active).toBe(false);
      // resetMultiFade does NOT set reopenPadId
      expect(useMultiFadeStore.getState().reopenPadId).toBeNull();
    });
  });

  describe("auto-cancel on overlay open", () => {
    it("resets multi-fade when an overlay opens while active", () => {
      const pads = makePads();
      renderHook(() => useMultiFadeMode(pads));

      act(() => {
        useMultiFadeStore.getState().enterMultiFade("pad-1", [0, 100]);
        useUiStore.getState().openOverlay("test-overlay", "dialog");
      });
      expect(useMultiFadeStore.getState().active).toBe(false);
      expect(useMultiFadeStore.getState().reopenPadId).toBeNull();
    });
  });

  describe("execute", () => {
    it("calls fadePadWithLevels for each selected pad", () => {
      const pads = makePads(2);
      const { result } = renderHook(() => useMultiFadeMode(pads));

      act(() => {
        useMultiFadeStore.getState().enterMultiFade("pad-1", [10, 80]);
        useMultiFadeStore.getState().toggleMultiFadePad("pad-2", [0, 100]);
      });

      act(() => {
        result.current.execute();
      });

      expect(fadePadWithLevels).toHaveBeenCalledTimes(2);
      expect(fadePadWithLevels).toHaveBeenCalledWith(pads[0], 2000, [10, 80], false);
      expect(fadePadWithLevels).toHaveBeenCalledWith(pads[1], 2000, [0, 100], false);
    });

    it("passes isPadActive result for playing vs stopped pads", () => {
      const pads = makePads(1);
      vi.mocked(isPadActive).mockReturnValue(true); // pad-1 is playing
      const { result } = renderHook(() => useMultiFadeMode(pads));

      act(() => {
        useMultiFadeStore.getState().enterMultiFade("pad-1", [0, 70]);
      });
      act(() => {
        result.current.execute();
      });

      expect(fadePadWithLevels).toHaveBeenCalledWith(pads[0], 2000, [0, 70], true);
    });

    it("resets all state after execute", () => {
      const pads = makePads(1);
      const { result } = renderHook(() => useMultiFadeMode(pads));

      act(() => {
        useMultiFadeStore.getState().enterMultiFade("pad-1", [0, 100]);
        result.current.execute();
      });

      expect(useMultiFadeStore.getState().active).toBe(false);
      expect(useMultiFadeStore.getState().selectedPads.size).toBe(0);
      expect(useMultiFadeStore.getState().originPadId).toBeNull();
    });

    it("is a no-op when no pads are selected", () => {
      const pads = makePads(1);
      const { result } = renderHook(() => useMultiFadeMode(pads));

      act(() => {
        result.current.execute(); // canExecute = false
      });

      expect(fadePadWithLevels).not.toHaveBeenCalled();
    });

    it("skips pads that are no longer in the pads array", () => {
      const pads = makePads(1);
      const { result } = renderHook(() => useMultiFadeMode(pads));

      act(() => {
        // Manually insert a pad ID that doesn't exist in pads
        useMultiFadeStore.getState().enterMultiFade("nonexistent-pad", [0, 100]);
      });

      act(() => {
        result.current.execute();
      });

      expect(fadePadWithLevels).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
npm run test:run -- src/hooks/useMultiFadeMode.test.ts 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMultiFadeMode.test.ts
git commit -m "test: add useMultiFadeMode tests for execute, auto-cancel, and edge cases"
```

---

## Task 13: Tests for `skipLayerForward`, `skipLayerBack`, and `setLayerVolume`

**Files:**
- Modify: `src/lib/audio/padPlayer.test.ts`

- [ ] **Step 1: Add tests at the end of the padPlayer test file**

Open `src/lib/audio/padPlayer.test.ts`. Find where the existing imports and mock setup are, then add a new describe block at the bottom. The test file already mocks `audioContext`, `bufferCache`, `streamingCache`, etc. — reuse those mocks.

First, check what imports exist at the top of the test file and add any missing ones:

```typescript
import {
  skipLayerForward,
  skipLayerBack,
  setLayerVolume,
  triggerPad,
  stopPad,
} from "./padPlayer";
import {
  setLayerChain,
  setLayerPlayOrder,
  getLayerChain,
  getLayerGain,
  clearAllPadGains,
  clearAllLayerGains,
  clearAllVoices,
} from "./audioState";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
```

Then add a describe block (use the same mock setup pattern as existing tests in that file):

```typescript
describe("setLayerVolume", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
    clearAllPadGains();
    clearAllLayerGains();
    clearAllVoices();
  });

  it("is a no-op when the layer has no active gain node", () => {
    // No gain created yet — should not throw
    expect(() => setLayerVolume("layer-x", 0.5)).not.toThrow();
    expect(usePlaybackStore.getState().layerVolumes["layer-x"]).toBeUndefined();
  });

  it("updates the store when a gain node exists", async () => {
    const layer = createMockLayer({ id: "layer-1", volume: 100 });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    const sound = createMockSound({ filePath: "kick.wav" });
    useLibraryStore.getState().loadLibrary({ sounds: [sound], tags: [], sets: [] });
    // Set up the layer selection
    const assignedLayer = { ...layer, selection: { type: "assigned" as const, instances: [{ soundId: sound.id, volume: 100, startOffsetMs: 0 }] } };
    const assignedPad = { ...pad, layers: [assignedLayer] };

    mockLoadBuffer.mockResolvedValueOnce({
      duration: 1,
      getChannelData: vi.fn().mockReturnValue(new Float32Array(1)),
    });
    const mockGain = { gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    vi.mocked(mockCtx.createGain).mockReturnValue(mockGain as unknown as GainNode);

    await triggerPad(assignedPad);
    setLayerVolume("layer-1", 0.5);

    expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.5);
  });
});

describe("skipLayerForward", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
    clearAllPadGains();
    clearAllLayerGains();
    clearAllVoices();
  });

  it("is a no-op for simultaneous arrangement", () => {
    const layer = createMockLayer({ id: "layer-1", arrangement: "simultaneous" });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    setLayerChain("layer-1", [createMockSound()]);

    skipLayerForward(pad, "layer-1");

    // Chain should be unchanged (no-op)
    expect(getLayerChain("layer-1")).toBeDefined();
  });

  it("is a no-op when chain is empty", () => {
    const layer = createMockLayer({ id: "layer-1", arrangement: "sequential" });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    setLayerChain("layer-1", []);

    expect(() => skipLayerForward(pad, "layer-1")).not.toThrow();
  });

  it("advances to the next sound in the chain", async () => {
    const sound1 = createMockSound({ id: "s1", filePath: "a.wav" });
    const sound2 = createMockSound({ id: "s2", filePath: "b.wav" });
    const sound3 = createMockSound({ id: "s3", filePath: "c.wav" });
    const layer = createMockLayer({ id: "layer-1", arrangement: "sequential", selection: { type: "assigned", instances: [
      { soundId: "s1", volume: 100, startOffsetMs: 0 },
      { soundId: "s2", volume: 100, startOffsetMs: 0 },
      { soundId: "s3", volume: 100, startOffsetMs: 0 },
    ]} });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });

    // Simulate: sound1 was playing, chain = [sound2, sound3]
    setLayerChain("layer-1", [sound2, sound3]);
    useLibraryStore.getState().loadLibrary({ sounds: [sound1, sound2, sound3], tags: [], sets: [] });

    const mockGain = { gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    vi.mocked(mockCtx.createGain).mockReturnValue(mockGain as unknown as GainNode);
    mockLoadBuffer.mockResolvedValue({ duration: 1, getChannelData: vi.fn().mockReturnValue(new Float32Array(1)) });

    skipLayerForward(pad, "layer-1");

    // After skip, chain should be [sound3] (sound2 was popped as "next")
    await vi.waitFor(() => {
      expect(getLayerChain("layer-1")).toEqual([sound3]);
    });
  });
});

describe("skipLayerBack", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
    clearAllPadGains();
    clearAllLayerGains();
    clearAllVoices();
  });

  it("is a no-op for simultaneous arrangement", () => {
    const layer = createMockLayer({ id: "layer-1", arrangement: "simultaneous" });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    setLayerPlayOrder("layer-1", [createMockSound()]);

    skipLayerBack(pad, "layer-1");
    // Should not throw
  });

  it("is a no-op when no play order exists", () => {
    const layer = createMockLayer({ id: "layer-1", arrangement: "sequential" });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    expect(() => skipLayerBack(pad, "layer-1")).not.toThrow();
  });

  it("goes to previous sound based on play order position", async () => {
    const sounds = [
      createMockSound({ id: "s1", filePath: "a.wav" }),
      createMockSound({ id: "s2", filePath: "b.wav" }),
      createMockSound({ id: "s3", filePath: "c.wav" }),
    ];
    const layer = createMockLayer({ id: "layer-1", arrangement: "sequential", selection: { type: "assigned", instances: sounds.map(s => ({ soundId: s.id, volume: 100, startOffsetMs: 0 })) } });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });

    useLibraryStore.getState().loadLibrary({ sounds, tags: [], sets: [] });

    // Simulate: currently playing s2 (index 1), chain = [s3]
    setLayerPlayOrder("layer-1", sounds);
    setLayerChain("layer-1", [sounds[2]]);

    const mockGain = { gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    vi.mocked(mockCtx.createGain).mockReturnValue(mockGain as unknown as GainNode);
    mockLoadBuffer.mockResolvedValue({ duration: 1, getChannelData: vi.fn().mockReturnValue(new Float32Array(1)) });

    skipLayerBack(pad, "layer-1");

    // prevPos = max(0, 1 - 1) = 0 → play s1, chain should be [s2, s3]
    await vi.waitFor(() => {
      expect(getLayerChain("layer-1")).toEqual([sounds[1], sounds[2]]);
    });
  });

  it("clamps to first sound when already at index 0", async () => {
    const sounds = [
      createMockSound({ id: "s1", filePath: "a.wav" }),
      createMockSound({ id: "s2", filePath: "b.wav" }),
    ];
    const layer = createMockLayer({ id: "layer-1", arrangement: "sequential", selection: { type: "assigned", instances: sounds.map(s => ({ soundId: s.id, volume: 100, startOffsetMs: 0 })) } });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });

    useLibraryStore.getState().loadLibrary({ sounds, tags: [], sets: [] });

    // Currently at index 0 (s1 playing, chain = [s2])
    setLayerPlayOrder("layer-1", sounds);
    setLayerChain("layer-1", [sounds[1]]);

    const mockGain = { gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    vi.mocked(mockCtx.createGain).mockReturnValue(mockGain as unknown as GainNode);
    mockLoadBuffer.mockResolvedValue({ duration: 1, getChannelData: vi.fn().mockReturnValue(new Float32Array(1)) });

    skipLayerBack(pad, "layer-1");

    // Still plays s1 (clamp to index 0), chain = [s2]
    await vi.waitFor(() => {
      expect(getLayerChain("layer-1")).toEqual([sounds[1]]);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run test:run -- src/lib/audio/padPlayer.test.ts 2>&1 | tail -30
```

Fix any failures before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio/padPlayer.test.ts
git commit -m "test: add skipLayerForward, skipLayerBack, setLayerVolume tests"
```

---

## Task 14: Tests for `playbackStore.updateLayerVolume` and `removeLayerVolume`

**Files:**
- Modify: `src/state/playbackStore.test.ts`

- [ ] **Step 1: Add tests to the existing test file**

In `src/state/playbackStore.test.ts`, add a new describe block:

```typescript
describe("updateLayerVolume / removeLayerVolume", () => {
  it("updateLayerVolume sets volume for a layer", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.75);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.75);
  });

  it("multiple layer volumes coexist independently", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.5);
    usePlaybackStore.getState().updateLayerVolume("layer-2", 0.8);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.5);
    expect(usePlaybackStore.getState().layerVolumes["layer-2"]).toBe(0.8);
  });

  it("updateLayerVolume does not affect other layers", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.5);
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.9);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.9);
  });

  it("removeLayerVolume removes the entry", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.5);
    usePlaybackStore.getState().removeLayerVolume("layer-1");
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBeUndefined();
  });

  it("removeLayerVolume is a no-op for non-existent layer", () => {
    expect(() => usePlaybackStore.getState().removeLayerVolume("nonexistent")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run test:run -- src/state/playbackStore.test.ts 2>&1 | tail -15
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add src/state/playbackStore.test.ts
git commit -m "test: add updateLayerVolume and removeLayerVolume tests"
```

---

## Task 15: Tests for PadButton multi-fade and right-click behaviors

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.test.tsx`

- [ ] **Step 1: Add multi-fade store reset to beforeEach**

In `PadButton.test.tsx`, update the top import section to add:

```typescript
import { useMultiFadeStore, initialMultiFadeState } from "@/state/multiFadeStore";
```

And update the `beforeEach` to also reset the multi-fade store:

```typescript
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useMultiFadeStore.setState({ ...initialMultiFadeState, selectedPads: new Map() });
    // ...
  });
```

- [ ] **Step 2: Add new describe blocks**

After the existing `describe("volume drag label", ...)` block, add:

```typescript
  describe("multi-fade mode", () => {
    it("calls toggleMultiFadePad when left-clicked during multi-fade mode", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      // Activate multi-fade mode
      act(() => {
        useMultiFadeStore.getState().enterMultiFade("other-pad", [0, 100]);
      });

      const button = screen.getByRole("button", { name: "Kick" });
      fireEvent.pointerDown(button, { button: 0 });

      expect(useMultiFadeStore.getState().selectedPads.has("pad-1")).toBe(true);
    });

    it("does not trigger gesture handlers when multi-fade mode is active", async () => {
      const { triggerPad } = await import("@/lib/audio/padPlayer");
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      act(() => {
        useMultiFadeStore.getState().enterMultiFade("other-pad", [0, 100]);
      });

      const button = screen.getByRole("button", { name: "Kick" });
      // Click — should toggle selection, NOT play
      fireEvent.pointerDown(button, { button: 0 });

      expect(triggerPad).not.toHaveBeenCalled();
    });
  });

  describe("right-click live controls", () => {
    it("opens popover on right-click (contextmenu event)", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const wrapper = screen.getByRole("button", { name: "Kick" }).closest("div")!;
      fireEvent.contextMenu(wrapper);

      // Popover renders pad name in the content
      expect(await screen.findByText("Kick")).toBeInTheDocument();
    });

    it("does not open popover when editMode is active", () => {
      useUiStore.setState({ ...initialUiState, editMode: true });
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const wrapper = screen.getByRole("button", { name: /edit pad/i }).closest("div[data-slot]") ?? document.body;
      fireEvent.contextMenu(wrapper);

      // The popover should not have opened
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("does not open popover when multi-fade mode is active", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      act(() => {
        useMultiFadeStore.getState().enterMultiFade("other-pad", [0, 100]);
      });

      const wrapper = screen.getByRole("button", { name: "Kick" }).closest("div")!;
      fireEvent.contextMenu(wrapper);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run the tests**

```bash
npm run test:run -- src/components/composite/SceneView/PadButton.test.tsx 2>&1 | tail -20
```

Fix any selector issues (the exact DOM structure for the contextmenu test may need adjustment based on what `fireEvent.contextMenu` fires on). If the popover test fails due to portal rendering, wrap the render with `<TooltipProvider>` same as other tests.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/SceneView/PadButton.test.tsx
git commit -m "test: add multi-fade click handling and right-click popover tests to PadButton"
```

---

## Task 16: Tests for `MultiFadePill`

**Files:**
- Create: `src/components/composite/SceneView/MultiFadePill.test.tsx`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { MultiFadePill } from "./MultiFadePill";
import { useMultiFadeStore, initialMultiFadeState } from "@/state/multiFadeStore";

describe("MultiFadePill", () => {
  const onExecute = vi.fn();

  beforeEach(() => {
    onExecute.mockClear();
    useMultiFadeStore.setState({ ...initialMultiFadeState, selectedPads: new Map() });
  });

  it("shows correct pad count — singular", () => {
    act(() => {
      useMultiFadeStore.getState().enterMultiFade("pad-1", [0, 100]);
    });
    render(<MultiFadePill onExecute={onExecute} />);
    expect(screen.getByText("1 pad selected")).toBeInTheDocument();
  });

  it("shows correct pad count — plural", () => {
    act(() => {
      useMultiFadeStore.getState().enterMultiFade("pad-1", [0, 100]);
      useMultiFadeStore.getState().toggleMultiFadePad("pad-2", [0, 100]);
    });
    render(<MultiFadePill onExecute={onExecute} />);
    expect(screen.getByText("2 pads selected")).toBeInTheDocument();
  });

  it("Execute Fade button is disabled when canExecute is false", () => {
    // No pads selected means canExecute = false
    act(() => {
      useMultiFadeStore.setState({ active: true, originPadId: null, selectedPads: new Map(), reopenPadId: null });
    });
    render(<MultiFadePill onExecute={onExecute} />);
    expect(screen.getByRole("button", { name: /execute fade/i })).toBeDisabled();
  });

  it("Execute Fade button calls onExecute when clicked", async () => {
    act(() => {
      useMultiFadeStore.getState().enterMultiFade("pad-1", [0, 100]);
    });
    render(<MultiFadePill onExecute={onExecute} />);
    await userEvent.click(screen.getByRole("button", { name: /execute fade/i }));
    expect(onExecute).toHaveBeenCalledOnce();
  });

  it("Cancel button calls cancelMultiFade", async () => {
    act(() => {
      useMultiFadeStore.getState().enterMultiFade("pad-1", [0, 100]);
    });
    render(<MultiFadePill onExecute={onExecute} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel multi-fade/i }));
    expect(useMultiFadeStore.getState().active).toBe(false);
    expect(useMultiFadeStore.getState().reopenPadId).toBe("pad-1");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run test:run -- src/components/composite/SceneView/MultiFadePill.test.tsx 2>&1 | tail -15
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/SceneView/MultiFadePill.test.tsx
git commit -m "test: add MultiFadePill rendering and interaction tests"
```

---

## Final: Re-run the 4-dimensional review

- [ ] **Step 1: Run all tests and TypeScript one final time**

```bash
npx tsc --noEmit && npm run test:run 2>&1 | tail -10
```

Expected: no type errors, all tests passing.

- [ ] **Step 2: Request the review**

Ask the orchestrating agent to spawn 4 reviewer agents across Architecture, Performance, Correctness, and Test Coverage — same dimensions as the first review — against the current working tree.

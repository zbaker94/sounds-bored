# Layer Sound Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scrolling sound-name display and list popover to each LayerRow in PadLiveControlPopover.

**Architecture:** All changes live in `PadLiveControlPopover.tsx` (and its test file). A pure helper `getSoundsForLayer` resolves layer selection → `Sound[]` from the library. LayerRow reads from `useLibraryStore` directly (no prop-drilling). A RAF loop inside LayerRow polls `audioState` when a chained layer is active to track the currently-playing sound. A list icon (hidden for single-sound layers) opens a controlled Popover listing all sounds with a selection-type title.

**Tech Stack:** React 19, Zustand, Tailwind 4, Radix UI Popover, HugeIcons, Vitest + Testing Library

---

## Files

| File | Change |
|---|---|
| `src/components/composite/SceneView/PadLiveControlPopover.tsx` | Add `getSoundsForLayer` helper (exported), update `LayerRow` with sound display row + list popover |
| `src/components/composite/SceneView/PadLiveControlPopover.test.tsx` | Add tests for helper and new UI; update mocks |
| `src/App.css` | Add `@keyframes marquee` animation |

---

## Task 1: `getSoundsForLayer` helper + tests

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.test.tsx`

- [ ] **Step 1: Add the helper to the component file**

Open `src/components/composite/SceneView/PadLiveControlPopover.tsx`. Add the following import at the top alongside existing imports:

```typescript
import type { Sound, Tag, Set, Layer } from "@/lib/schemas";
```

(`Sound` is already imported via `import type { Pad } from "@/lib/schemas"` — replace that line with):

```typescript
import type { Pad, Sound, Tag, Set, Layer } from "@/lib/schemas";
```

Then add the helper function **before** the `LayerRow` component definition (around line 56):

```typescript
/**
 * Resolves the set of sounds that will play for a layer, based on its selection type.
 * For "assigned": maps instances to library sounds in instance order.
 * For "tag": returns all library sounds matching the tag criteria.
 * For "set": returns all library sounds that belong to the set.
 * Sounds with no matching library entry are excluded.
 */
export function getSoundsForLayer(layer: Layer, sounds: Sound[]): Sound[] {
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => sounds.find((s) => s.id === inst.soundId))
        .filter((s): s is Sound => s !== undefined);
    case "tag":
      return sounds.filter((s) => {
        if (sel.matchMode === "all") {
          return sel.tagIds.every((id) => s.tags.includes(id));
        }
        return sel.tagIds.some((id) => s.tags.includes(id));
      });
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId));
  }
}
```

- [ ] **Step 2: Write failing tests for `getSoundsForLayer`**

Add a new `describe("getSoundsForLayer", ...)` block to `src/components/composite/SceneView/PadLiveControlPopover.test.tsx`.

Add this import at the top of the test file, alongside existing imports:

```typescript
import { getSoundsForLayer } from "./PadLiveControlPopover";
import { createMockSound, createMockSoundInstance } from "@/test/factories";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
```

Add `useLibraryStore.setState({ ...initialLibraryState })` inside the existing `beforeEach`. Find the `beforeEach` block and add that line:

```typescript
beforeEach(() => {
  usePlaybackStore.setState({ ...initialPlaybackState });
  useLibraryStore.setState({ ...initialLibraryState }); // add this line
  useMultiFadeStore.setState({ ... }); // existing
  vi.clearAllMocks();
  // ... existing restore lines
});
```

Add the new test block anywhere after the imports:

```typescript
describe("getSoundsForLayer", () => {
  describe("assigned selection", () => {
    it("returns sounds matching instance soundIds in instance order", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick" });
      const s2 = createMockSound({ id: "s2", name: "Snare" });
      const s3 = createMockSound({ id: "s3", name: "Hi-hat" });
      const inst1 = createMockSoundInstance({ soundId: "s2" });
      const inst2 = createMockSoundInstance({ soundId: "s1" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [inst1, inst2] },
      });
      expect(getSoundsForLayer(layer, [s1, s2, s3])).toEqual([s2, s1]);
    });

    it("excludes instances with no matching library sound", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick" });
      const inst = createMockSoundInstance({ soundId: "missing-id" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [inst] },
      });
      expect(getSoundsForLayer(layer, [s1])).toEqual([]);
    });

    it("returns empty array when no instances", () => {
      const layer = createMockLayer({ selection: { type: "assigned", instances: [] } });
      expect(getSoundsForLayer(layer, [])).toEqual([]);
    });
  });

  describe("tag selection", () => {
    it("returns sounds that have any of the specified tag IDs (matchMode: any)", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick", tags: ["tag-a"] });
      const s2 = createMockSound({ id: "s2", name: "Snare", tags: ["tag-b"] });
      const s3 = createMockSound({ id: "s3", name: "Hi-hat", tags: [] });
      const layer = createMockLayer({
        selection: { type: "tag", tagIds: ["tag-a"], matchMode: "any", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1, s2, s3])).toEqual([s1]);
    });

    it("returns only sounds that have ALL tag IDs (matchMode: all)", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick", tags: ["tag-a", "tag-b"] });
      const s2 = createMockSound({ id: "s2", name: "Snare", tags: ["tag-a"] });
      const layer = createMockLayer({
        selection: { type: "tag", tagIds: ["tag-a", "tag-b"], matchMode: "all", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1, s2])).toEqual([s1]);
    });

    it("returns empty array when no sounds match", () => {
      const s1 = createMockSound({ id: "s1", tags: ["tag-z"] });
      const layer = createMockLayer({
        selection: { type: "tag", tagIds: ["tag-a"], matchMode: "any", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1])).toEqual([]);
    });
  });

  describe("set selection", () => {
    it("returns sounds that belong to the specified set", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick", sets: ["set-1"] });
      const s2 = createMockSound({ id: "s2", name: "Snare", sets: ["set-2"] });
      const s3 = createMockSound({ id: "s3", name: "Hi-hat", sets: [] });
      const layer = createMockLayer({
        selection: { type: "set", setId: "set-1", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1, s2, s3])).toEqual([s1]);
    });

    it("returns empty array when no sounds match the set", () => {
      const s1 = createMockSound({ id: "s1", sets: [] });
      const layer = createMockLayer({
        selection: { type: "set", setId: "set-1", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1])).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Run failing tests to confirm they fail**

```bash
cd C:/Repos/sounds-bored && npx tsc --noEmit && npx vitest run --reporter=verbose src/components/composite/SceneView/PadLiveControlPopover.test.tsx 2>&1 | tail -30
```

Expected: TypeScript passes silently. Tests under `getSoundsForLayer` fail with "getSoundsForLayer is not a function" or similar (because the export doesn't exist yet).

- [ ] **Step 4: Verify tests pass after Step 1 implementation**

The helper was added in Step 1. Run again to confirm all `getSoundsForLayer` tests pass:

```bash
npx vitest run --reporter=verbose src/components/composite/SceneView/PadLiveControlPopover.test.tsx 2>&1 | tail -30
```

Expected: All `getSoundsForLayer` describe blocks pass. Existing tests continue to pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/components/composite/SceneView/PadLiveControlPopover.tsx src/components/composite/SceneView/PadLiveControlPopover.test.tsx && git commit -m "feat: add getSoundsForLayer helper with tests"
```

---

## Task 2: Marquee CSS + static sound display row

**Files:**
- Modify: `src/App.css`
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.test.tsx`

- [ ] **Step 1: Add marquee keyframe to App.css**

Open `src/App.css`. After the last existing `@keyframes` block (or before the `:root` block if none exist), add:

```css
@keyframes marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
```

- [ ] **Step 2: Write failing tests for the sound display row**

In the existing test file, add a new `describe("LayerRow sound display", ...)` block. Add this helper function near the top of the test file, after the `renderPopover` function:

```typescript
function renderPopoverWithSounds(
  soundNames: string[],
  arrangementOverride?: Layer["arrangement"]
) {
  const sounds = soundNames.map((name, i) =>
    createMockSound({ id: `sound-${i}`, name })
  );
  useLibraryStore.setState({
    ...initialLibraryState,
    sounds,
  });
  const instances = sounds.map((s) =>
    createMockSoundInstance({ soundId: s.id })
  );
  const layer = createMockLayer({
    id: "layer-1",
    selection: { type: "assigned", instances },
    arrangement: arrangementOverride ?? "simultaneous",
  });
  const pad = createMockPad({ id: "pad-1", layers: [layer] });
  const anchorRef = { current: null };
  render(
    <PadLiveControlPopover
      pad={pad}
      sceneId="scene-1"
      open={true}
      onOpenChange={vi.fn()}
      anchorRef={anchorRef as React.RefObject<HTMLButtonElement | null>}
    />
  );
  return { sounds, layer, pad };
}
```

Also add this import at the top of the test file (alongside existing imports):

```typescript
import type { Layer } from "@/lib/schemas";
```

Add the new test block:

```typescript
describe("LayerRow sound display", () => {
  it("shows all sound names joined by ' · ' when layer has multiple assigned sounds", () => {
    renderPopoverWithSounds(["Kick", "Snare", "Hi-hat"]);
    expect(screen.getByText("Kick · Snare · Hi-hat")).toBeInTheDocument();
  });

  it("shows a single sound name without separator", () => {
    renderPopoverWithSounds(["Kick"]);
    expect(screen.getByText("Kick")).toBeInTheDocument();
  });

  it("shows nothing when layer has no sounds", () => {
    renderPopoverWithSounds([]);
    // No sound display text should appear — the row is not rendered
    const displayRows = document.querySelectorAll("[data-testid='layer-sound-display']");
    expect(displayRows).toHaveLength(0);
  });

  it("shows sounds from a tag selection", () => {
    const s1 = createMockSound({ id: "s1", name: "Snare", tags: ["tag-drums"] });
    const s2 = createMockSound({ id: "s2", name: "Kick", tags: ["tag-drums"] });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [s1, s2] });
    const layer = createMockLayer({
      id: "layer-1",
      selection: { type: "tag", tagIds: ["tag-drums"], matchMode: "any", defaultVolume: 100 },
    });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    render(
      <PadLiveControlPopover
        pad={pad}
        sceneId="scene-1"
        open={true}
        onOpenChange={vi.fn()}
        anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
      />
    );
    expect(screen.getByText("Snare · Kick")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx vitest run --reporter=verbose src/components/composite/SceneView/PadLiveControlPopover.test.tsx 2>&1 | grep -E "(FAIL|PASS|✓|✗|×|sound display)" | head -20
```

Expected: `LayerRow sound display` tests fail (display row not yet implemented).

- [ ] **Step 4: Implement the sound display row in LayerRow**

Open `src/components/composite/SceneView/PadLiveControlPopover.tsx`.

Add these imports at the top of the file:

```typescript
import { useLibraryStore } from "@/state/libraryStore";
```

Update the `LayerRow` component. Replace the existing `LayerRow` function body with the following (keep the existing props interface `{ pad, layer, idx, layerActive }` unchanged):

```typescript
function LayerRow({
  pad,
  layer,
  idx,
  layerActive,
}: {
  pad: Pad;
  layer: Pad["layers"][number];
  idx: number;
  layerActive: boolean;
}) {
  const layerVol = usePlaybackStore((s) => Math.round((s.layerVolumes[layer.id] ?? (layer.volume / 100)) * 100));
  const showSkip = layer.arrangement === "sequential" || layer.arrangement === "shuffled";
  const sounds = useLibraryStore((s) => s.sounds);

  const allSounds = getSoundsForLayer(layer, sounds);
  const displayText = allSounds.map((s) => s.name).join(" · ");

  // Overflow detection for marquee animation
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflow, setIsOverflow] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsOverflow(el.scrollWidth > el.clientWidth);
  }, [displayText]);

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

      {/* Sound display row */}
      {allSounds.length > 0 && (
        <div className="flex items-center gap-1" data-testid="layer-sound-display">
          <div ref={containerRef} className="overflow-hidden flex-1 min-w-0">
            {isOverflow ? (
              <div
                className="flex"
                style={{ animation: "marquee 10s linear infinite", gap: "2rem" }}
              >
                <span className="whitespace-nowrap text-xs text-muted-foreground">{displayText}</span>
                <span className="whitespace-nowrap text-xs text-muted-foreground" aria-hidden>{displayText}</span>
              </div>
            ) : (
              <span className="whitespace-nowrap text-xs text-muted-foreground">{displayText}</span>
            )}
          </div>
        </div>
      )}

      <Slider
        compact
        tooltipLabel={(v) => `${v}%`}
        value={[layerVol]}
        onValueChange={([v]) => setLayerVolume(layer.id, v / 100)}
        onValueCommit={([v]) => commitLayerVolume(layer.id, v / 100)}
        min={0}
        max={100}
        step={1}
      />
    </motion.div>
  );
}
```

Also add `useState` and `useEffect` to the existing React import if not already there (they already are at line 1).

- [ ] **Step 5: Run TypeScript check then tests**

```bash
cd C:/Repos/sounds-bored && npx tsc --noEmit && npx vitest run --reporter=verbose src/components/composite/SceneView/PadLiveControlPopover.test.tsx 2>&1 | tail -30
```

Expected: TypeScript passes silently. All `LayerRow sound display` tests pass. All previous tests continue to pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.css src/components/composite/SceneView/PadLiveControlPopover.tsx src/components/composite/SceneView/PadLiveControlPopover.test.tsx && git commit -m "feat: add static sound display row to LayerRow with marquee animation"
```

---

## Task 3: Current-sound RAF polling (sequential/shuffled)

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.test.tsx`

- [ ] **Step 1: Update the audioState mock to expose chain/playOrder functions**

In `PadLiveControlPopover.test.tsx`, find the existing `vi.mock("@/lib/audio/audioState", ...)` block and replace it with:

```typescript
vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
  isLayerActive: vi.fn().mockReturnValue(false),
  getLayerChain: vi.fn().mockReturnValue(undefined),
  getLayerPlayOrder: vi.fn().mockReturnValue(undefined),
}));
```

Add these imports after the `import { triggerPad, stopPad } from "@/lib/audio/padPlayer"` line:

```typescript
import { isLayerActive, getLayerChain, getLayerPlayOrder } from "@/lib/audio/audioState";
```

- [ ] **Step 2: Write failing tests for current-sound display**

Add this block inside the existing `describe("LayerRow sound display", ...)` block, after the existing tests:

```typescript
describe("currently-playing sound for sequential/shuffled layers", () => {
  it("shows only the current sound name when layer is active and sequential", async () => {
    const sounds = [
      createMockSound({ id: "s1", name: "Kick" }),
      createMockSound({ id: "s2", name: "Snare" }),
      createMockSound({ id: "s3", name: "Hi-hat" }),
    ];
    useLibraryStore.setState({ ...initialLibraryState, sounds });
    const instances = sounds.map((s) => createMockSoundInstance({ soundId: s.id }));
    const layer = createMockLayer({
      id: "layer-1",
      selection: { type: "assigned", instances },
      arrangement: "sequential",
    });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });

    // Layer is active and playing the second sound (chain has 1 remaining)
    vi.mocked(isLayerActive).mockReturnValue(true);
    vi.mocked(getLayerPlayOrder).mockReturnValue(sounds);
    vi.mocked(getLayerChain).mockReturnValue([sounds[2]]); // 1 remaining → current is index 1 = "Snare"
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set(["pad-1"]),
    });

    render(
      <PadLiveControlPopover
        pad={pad}
        sceneId="scene-1"
        open={true}
        onOpenChange={vi.fn()}
        anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
      />
    );

    // RAF fires asynchronously — wait for the poll to update state
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByText("Snare")).toBeInTheDocument();
    // Full list text should not be visible
    expect(screen.queryByText("Kick · Snare · Hi-hat")).not.toBeInTheDocument();
  });

  it("shows all sounds when layer is simultaneous even if active", async () => {
    const sounds = [
      createMockSound({ id: "s1", name: "Kick" }),
      createMockSound({ id: "s2", name: "Snare" }),
    ];
    useLibraryStore.setState({ ...initialLibraryState, sounds });
    const instances = sounds.map((s) => createMockSoundInstance({ soundId: s.id }));
    const layer = createMockLayer({
      id: "layer-1",
      selection: { type: "assigned", instances },
      arrangement: "simultaneous",
    });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });

    vi.mocked(isLayerActive).mockReturnValue(true);
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-1"]) });

    render(
      <PadLiveControlPopover
        pad={pad}
        sceneId="scene-1"
        open={true}
        onOpenChange={vi.fn()}
        anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
      />
    );

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(screen.getByText("Kick · Snare")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run failing tests**

```bash
npx tsc --noEmit && npx vitest run --reporter=verbose src/components/composite/SceneView/PadLiveControlPopover.test.tsx 2>&1 | grep -E "(currently-playing|FAIL|✗|×)" | head -20
```

Expected: The two new "currently-playing" tests fail.

- [ ] **Step 4: Add imports and RAF polling to LayerRow**

In `PadLiveControlPopover.tsx`, add these imports at the top:

```typescript
import {
  getLayerChain,
  getLayerPlayOrder,
} from "@/lib/audio/audioState";
```

Inside the `LayerRow` function, replace the current `allSounds` / `displayText` / `isOverflow` block with the following (keep the `layerVol` and `showSkip` lines unchanged):

```typescript
  const sounds = useLibraryStore((s) => s.sounds);
  const allSounds = getSoundsForLayer(layer, sounds);

  const isChainedArrangement = layer.arrangement === "sequential" || layer.arrangement === "shuffled";

  // ─── Current-sound RAF polling (sequential/shuffled while active) ───────────
  const [currentSoundId, setCurrentSoundId] = useState<string | null>(null);
  const soundRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!layerActive || !isChainedArrangement) {
      setCurrentSoundId(null);
      if (soundRafRef.current !== null) {
        cancelAnimationFrame(soundRafRef.current);
        soundRafRef.current = null;
      }
      return;
    }

    const poll = () => {
      const playOrder = getLayerPlayOrder(layer.id);
      const chain = getLayerChain(layer.id);
      if (playOrder && playOrder.length > 0) {
        const chainLength = chain?.length ?? 0;
        const currentIdx = Math.max(0, playOrder.length - chainLength - 1);
        const currentSound = playOrder[currentIdx];
        const nextId = currentSound?.id ?? null;
        setCurrentSoundId((prev) => (prev === nextId ? prev : nextId));
      }
      soundRafRef.current = requestAnimationFrame(poll);
    };
    soundRafRef.current = requestAnimationFrame(poll);

    return () => {
      if (soundRafRef.current !== null) {
        cancelAnimationFrame(soundRafRef.current);
        soundRafRef.current = null;
      }
      setCurrentSoundId(null);
    };
  }, [layerActive, isChainedArrangement, layer.id]);

  // ─── Display text ────────────────────────────────────────────────────────────
  const displayText = (() => {
    if (layerActive && isChainedArrangement && currentSoundId) {
      const current = allSounds.find((s) => s.id === currentSoundId);
      return current?.name ?? allSounds.map((s) => s.name).join(" · ");
    }
    return allSounds.map((s) => s.name).join(" · ");
  })();

  // ─── Overflow detection for marquee ─────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflow, setIsOverflow] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsOverflow(el.scrollWidth > el.clientWidth);
  }, [displayText]);
```

- [ ] **Step 5: Run TypeScript check then tests**

```bash
npx tsc --noEmit && npx vitest run --reporter=verbose src/components/composite/SceneView/PadLiveControlPopover.test.tsx 2>&1 | tail -30
```

Expected: TypeScript passes silently. All tests pass, including the two new "currently-playing" tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/SceneView/PadLiveControlPopover.tsx src/components/composite/SceneView/PadLiveControlPopover.test.tsx && git commit -m "feat: poll current sound name for sequential/shuffled layers in LayerRow"
```

---

## Task 4: List icon + popover

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.test.tsx`

- [ ] **Step 1: Update the Popover mock to include PopoverTrigger**

In `PadLiveControlPopover.test.tsx`, find the `vi.mock("@/components/ui/popover", ...)` block and replace it with:

```typescript
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  PopoverAnchor: () => null,
  PopoverTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <>{children}</> : <button type="button">{children}</button>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));
```

- [ ] **Step 2: Write failing tests for the list icon and popover**

Add this new `describe` block inside the existing `describe("LayerRow sound display", ...)` block:

```typescript
describe("list icon and popover", () => {
  it("does not show the list icon when layer has only one sound", () => {
    renderPopoverWithSounds(["Kick"]);
    expect(screen.queryByRole("button", { name: /show sound list/i })).not.toBeInTheDocument();
  });

  it("shows the list icon when layer has multiple sounds", () => {
    renderPopoverWithSounds(["Kick", "Snare"]);
    expect(screen.getByRole("button", { name: /show sound list/i })).toBeInTheDocument();
  });

  it("does not show the list icon when layer has no sounds", () => {
    renderPopoverWithSounds([]);
    expect(screen.queryByRole("button", { name: /show sound list/i })).not.toBeInTheDocument();
  });

  it("clicking list icon opens a popover listing all sounds", async () => {
    renderPopoverWithSounds(["Kick", "Snare", "Hi-hat"]);
    const listBtn = screen.getByRole("button", { name: /show sound list/i });
    await userEvent.click(listBtn);

    // Popover should now contain numbered sounds
    expect(screen.getByText("1. Kick")).toBeInTheDocument();
    expect(screen.getByText("2. Snare")).toBeInTheDocument();
    expect(screen.getByText("3. Hi-hat")).toBeInTheDocument();
  });

  it("assigned selection shows 'Sounds' as popover title", async () => {
    renderPopoverWithSounds(["Kick", "Snare"]);
    await userEvent.click(screen.getByRole("button", { name: /show sound list/i }));
    expect(screen.getByText("Sounds")).toBeInTheDocument();
  });

  it("tag selection shows 'Tag: <name>' as popover title", async () => {
    const tag = createMockTag({ id: "tag-1", name: "Drums" });
    const s1 = createMockSound({ id: "s1", name: "Kick", tags: ["tag-1"] });
    const s2 = createMockSound({ id: "s2", name: "Snare", tags: ["tag-1"] });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [s1, s2], tags: [tag] });
    const layer = createMockLayer({
      id: "layer-1",
      selection: { type: "tag", tagIds: ["tag-1"], matchMode: "any", defaultVolume: 100 },
    });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    render(
      <PadLiveControlPopover
        pad={pad}
        sceneId="scene-1"
        open={true}
        onOpenChange={vi.fn()}
        anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /show sound list/i }));
    expect(screen.getByText("Tag: Drums")).toBeInTheDocument();
  });

  it("set selection shows 'Set: <name>' as popover title", async () => {
    const set = createMockSet({ id: "set-1", name: "My Drums" });
    const s1 = createMockSound({ id: "s1", name: "Kick", sets: ["set-1"] });
    const s2 = createMockSound({ id: "s2", name: "Snare", sets: ["set-1"] });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [s1, s2], sets: [set] });
    const layer = createMockLayer({
      id: "layer-1",
      selection: { type: "set", setId: "set-1", defaultVolume: 100 },
    });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    render(
      <PadLiveControlPopover
        pad={pad}
        sceneId="scene-1"
        open={true}
        onOpenChange={vi.fn()}
        anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /show sound list/i }));
    expect(screen.getByText("Set: My Drums")).toBeInTheDocument();
  });
});
```

Also add `createMockTag` and `createMockSet` to the factories import:

```typescript
import { createMockPad, createMockLayer, createMockSound, createMockSoundInstance, createMockTag, createMockSet } from "@/test/factories";
```

- [ ] **Step 3: Run failing tests**

```bash
npx tsc --noEmit && npx vitest run --reporter=verbose src/components/composite/SceneView/PadLiveControlPopover.test.tsx 2>&1 | grep -E "(list icon|FAIL|✗|×)" | head -20
```

Expected: The "list icon and popover" tests fail.

- [ ] **Step 4: Add list icon imports and implement the list popover**

In `PadLiveControlPopover.tsx`, add `ListMusicIcon` to the HugeIcons import:

```typescript
import {
  PlayIcon,
  StopIcon,
  VolumeHighIcon,
  NextIcon,
  PreviousIcon,
  ListMusicIcon,
} from "@hugeicons/core-free-icons";
```

Add `PopoverTrigger` to the Popover import (it's already imported but missing `PopoverTrigger`). Find the existing popover import and update it:

```typescript
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
```

Inside `LayerRow`, add these reads after the existing `const sounds = useLibraryStore(...)` line:

```typescript
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);

  // ─── List popover state ──────────────────────────────────────────────────────
  const [listOpen, setListOpen] = useState(false);
  const listAnchorRef = useRef<HTMLButtonElement>(null);

  // Count includes all assigned instances (even those with no library match)
  const totalSoundCount =
    layer.selection.type === "assigned"
      ? layer.selection.instances.length
      : allSounds.length;

  const selectionTitle = (() => {
    const sel = layer.selection;
    switch (sel.type) {
      case "assigned":
        return "Sounds";
      case "tag": {
        const names = sel.tagIds
          .map((id) => tags.find((t) => t.id === id)?.name ?? id)
          .join(", ");
        return `Tag: ${names}`;
      }
      case "set": {
        const name = sets.find((s) => s.id === sel.setId)?.name ?? sel.setId;
        return `Set: ${name}`;
      }
    }
  })();
```

Replace the existing `{/* Sound display row */}` block in the JSX with:

```tsx
      {/* Sound display row */}
      {allSounds.length > 0 && (
        <div className="flex items-center gap-1" data-testid="layer-sound-display">
          <div ref={containerRef} className="overflow-hidden flex-1 min-w-0">
            {isOverflow ? (
              <div
                className="flex"
                style={{ animation: "marquee 10s linear infinite", gap: "2rem" }}
              >
                <span className="whitespace-nowrap text-xs text-muted-foreground">{displayText}</span>
                <span className="whitespace-nowrap text-xs text-muted-foreground" aria-hidden>{displayText}</span>
              </div>
            ) : (
              <span className="whitespace-nowrap text-xs text-muted-foreground">{displayText}</span>
            )}
          </div>

          {totalSoundCount > 1 && (
            <>
              <button
                ref={listAnchorRef}
                type="button"
                aria-label="Show sound list"
                onClick={() => setListOpen((o) => !o)}
                className="p-0.5 rounded hover:bg-muted transition-colors flex-shrink-0"
              >
                <HugeiconsIcon icon={ListMusicIcon} size={12} />
              </button>
              <Popover open={listOpen} onOpenChange={setListOpen}>
                <PopoverAnchor virtualRef={listAnchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
                <PopoverContent side="top" sideOffset={6} className="w-48 p-2">
                  <p className="text-xs font-semibold mb-1.5">{selectionTitle}</p>
                  <ol className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                    {allSounds.map((sound, i) => (
                      <li
                        key={sound.id}
                        className={cn(
                          "text-xs py-0.5",
                          currentSoundId === sound.id
                            ? "font-semibold text-foreground"
                            : missingSoundIds.has(sound.id)
                            ? "text-muted-foreground italic"
                            : "text-muted-foreground"
                        )}
                      >
                        {i + 1}. {sound.name}
                      </li>
                    ))}
                  </ol>
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 5: Run TypeScript check then all tests**

```bash
npx tsc --noEmit && npx vitest run --reporter=verbose src/components/composite/SceneView/PadLiveControlPopover.test.tsx 2>&1 | tail -40
```

Expected: TypeScript passes silently. All tests pass, including all `list icon and popover` tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/SceneView/PadLiveControlPopover.tsx src/components/composite/SceneView/PadLiveControlPopover.test.tsx && git commit -m "feat: add sound list icon and popover to LayerRow"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Display row between name row and volume slider | Task 2, Step 4 |
| Scrolling marquee animation when overflow | Task 2, Steps 1 & 4 |
| All sounds when not playing or simultaneous | Task 2, Step 4 |
| Currently-playing sound for sequential/shuffled | Task 3, Step 4 |
| `getSoundsForLayer` for assigned/tag/set | Task 1, Step 1 |
| List icon hidden for ≤1 sound (uses totalSoundCount incl. missing for assigned) | Task 4, Step 4 |
| List icon opens popover with sound list | Task 4, Step 4 |
| Popover title: "Sounds" / "Tag: ..." / "Set: ..." | Task 4, Steps 2 & 4 |
| `max-h-48 overflow-y-auto` list body | Task 4, Step 4 |
| Missing sounds in muted italic | Task 4, Step 4 |
| Currently-playing sound bolded in list | Task 4, Step 4 (uses `currentSoundId`) |

**Placeholder scan:** No TBDs or TODOs found.

**Type consistency:**
- `getSoundsForLayer(layer: Layer, sounds: Sound[]): Sound[]` — used consistently across Task 1 and Task 2+.
- `currentSoundId: string | null` — introduced in Task 3, referenced in Task 4 list item `cn()`.
- `totalSoundCount` — introduced in Task 4 for list icon visibility, not used elsewhere.
- `listAnchorRef` — `useRef<HTMLButtonElement>(null)`, cast to `React.RefObject<{ getBoundingClientRect: () => DOMRect }>` for `PopoverAnchor.virtualRef` (matches existing pattern at line 459).
- `selectionTitle` — computed inline in Task 4, only used in the JSX.

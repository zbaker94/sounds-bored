# PERF1: Extract `useMultiFadeSideEffects` to eliminate SceneView re-renders

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `SceneView` from re-rendering on every multi-fade pad selection by moving the side-effect registration (hotkeys + auto-cancel subscriptions) into a dedicated zero-subscription hook.

**Architecture:** `useMultiFadeMode` currently registers three `useHotkeys` calls and two `useEffect` auto-cancel effects, subscribing SceneView to `active`, `originPadId`, `selectedPads`, `reopenPadId`, `editMode`, and `overlayStack`. A new `useMultiFadeSideEffects` hook re-implements those effects using `getState()` inside hotkey callbacks and a single Zustand `subscribe` listener — zero React subscriptions, so calling it from SceneView produces zero re-renders. `useMultiFadeMode` becomes a pure state-reader whose subscriptions only affect components that explicitly read its return value.

**Tech Stack:** React 19, Zustand, `react-hotkeys-hook`, Vitest + Testing Library

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `src/hooks/useMultiFadeSideEffects.ts` | New hook: hotkeys + uiStore subscription |
| Create | `src/hooks/useMultiFadeSideEffects.test.ts` | Tests for the new hook |
| Modify | `src/hooks/useMultiFadeMode.ts` | Remove 3 `useHotkeys` + 2 `useEffect` blocks; remove `editMode`/`overlayStack` subscriptions |
| Modify | `src/hooks/useMultiFadeMode.test.ts` | Remove hotkey + auto-cancel test blocks (they move to new test file) |
| Modify | `src/components/composite/SceneView/SceneView.tsx` | Replace `useMultiFadeMode()` with `useMultiFadeSideEffects()` |
| Modify | `docs/review-HEAD.md` | Mark PERF1 fixed |

---

## Task 1: Write failing tests for `useMultiFadeSideEffects`

**Files:**
- Create: `src/hooks/useMultiFadeSideEffects.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/hooks/useMultiFadeSideEffects.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiFadeSideEffects } from "./useMultiFadeSideEffects";
import { useMultiFadeStore, initialMultiFadeState } from "@/state/multiFadeStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockProject, createMockScene, createMockPad, createMockHistoryEntry } from "@/test/factories";
import { useHotkeys } from "react-hotkeys-hook";

vi.mock("@/lib/audio/padPlayer", () => ({
  executeFadeTap: vi.fn(),
}));

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
}));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

function loadPadsInStore(numPads = 2) {
  const pads = Array.from({ length: numPads }, (_, i) =>
    createMockPad({ id: `pad-${i}` })
  );
  const scene = createMockScene({ pads });
  useProjectStore
    .getState()
    .loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
  return pads;
}

beforeEach(() => {
  useProjectStore.setState({ ...initialProjectState });
  useMultiFadeStore.setState({ ...initialMultiFadeState });
  useUiStore.setState({ ...initialUiState });
  vi.clearAllMocks();
});

describe("useMultiFadeSideEffects — hotkeys", () => {
  it("registers f,x hotkeys with useHotkeys", () => {
    loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("f"));
    expect(fxCall).toBeDefined();
  });

  it("f,x handler executes multi-fade when active and pads selected", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    const pads = loadPadsInStore(1);

    useMultiFadeStore.setState({
      active: true,
      originPadId: pads[0].id,
      selectedPads: new Map([[pads[0].id, { padId: pads[0].id, levels: [0, 80] as [number, number] }]]),
      reopenPadId: null,
    });

    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("f"));
    const handler = fxCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(executeFadeTap).toHaveBeenCalled();
  });

  it("f,x handler is a no-op when not active", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    loadPadsInStore(1);

    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("f"));
    const handler = fxCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(executeFadeTap).not.toHaveBeenCalled();
  });

  it("escape handler cancels multi-fade when active", () => {
    const pads = loadPadsInStore(1);
    useMultiFadeStore.setState({
      active: true,
      originPadId: pads[0].id,
      selectedPads: new Map([[pads[0].id, { padId: pads[0].id, levels: [100, 0] as [number, number] }]]),
      reopenPadId: null,
    });

    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const escCall = calls.find((c) => c[0] === "escape");
    const handler = escCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(useMultiFadeStore.getState().active).toBe(false);
  });

  it("escape handler is a no-op when not active", () => {
    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const escCall = calls.find((c) => c[0] === "escape");
    const handler = escCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    const before = useMultiFadeStore.getState().active;
    act(() => { handler!(); });
    expect(useMultiFadeStore.getState().active).toBe(before);
  });
});

describe("useMultiFadeSideEffects — auto-cancel on editMode", () => {
  it("cancels multi-fade when editMode becomes true", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 1, 0); });
    expect(useMultiFadeStore.getState().active).toBe(true);

    act(() => { useUiStore.getState().toggleEditMode(); });

    expect(useMultiFadeStore.getState().active).toBe(false);
  });

  it("does not cancel when editMode is false and multi-fade is active", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 1, 0); });
    // Some other uiStore change that leaves editMode false
    act(() => { useUiStore.getState().setActiveSceneId(null); });

    expect(useMultiFadeStore.getState().active).toBe(true);
  });
});

describe("useMultiFadeSideEffects — auto-cancel on overlay", () => {
  it("cancels multi-fade when an overlay is pushed to overlayStack", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 1, 0); });
    expect(useMultiFadeStore.getState().active).toBe(true);

    act(() => { useUiStore.getState().openOverlay("some-dialog", "dialog"); });

    expect(useMultiFadeStore.getState().active).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — expect import error (file doesn't exist yet)**

```
npx vitest run src/hooks/useMultiFadeSideEffects.test.ts
```

Expected: fails with "Cannot find module './useMultiFadeSideEffects'"

---

## Task 2: Implement `useMultiFadeSideEffects`

**Files:**
- Create: `src/hooks/useMultiFadeSideEffects.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/useMultiFadeSideEffects.ts
import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore } from "@/state/uiStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { executeMultiFadeNow } from "./useMultiFadeMode";

/**
 * Registers multi-fade hotkeys and auto-cancel side effects with zero React
 * subscriptions. Uses getState() inside callbacks and a single Zustand
 * subscribe listener so the calling component never re-renders due to
 * multi-fade state changes.
 *
 * Call this once at the SceneView level. Components that need to read
 * multi-fade state should use useMultiFadeMode() or subscribe to
 * useMultiFadeStore directly.
 */
export function useMultiFadeSideEffects(): void {
  // Execute hotkey: enter / f / x — same keys as useMultiFadeMode, but
  // driven by getState() so this hook carries no subscriptions.
  useHotkeys(
    "enter,f,x",
    () => {
      const { active, selectedPads } = useMultiFadeStore.getState();
      if (!active || selectedPads.size === 0) return;
      executeMultiFadeNow();
    },
    { enableOnFormTags: true },
  );

  // Cancel hotkey: escape
  useHotkeys(
    "escape",
    () => {
      const { active, cancelMultiFade } = useMultiFadeStore.getState();
      if (!active) return;
      cancelMultiFade();
    },
    { enableOnFormTags: true },
  );

  // Auto-cancel when editMode activates or any overlay opens.
  // Uses Zustand subscribe (not useEffect on reactive state) so this
  // component does not re-render when uiStore changes.
  useEffect(() => {
    const unsub = useUiStore.subscribe((state) => {
      const { active, cancelMultiFade } = useMultiFadeStore.getState();
      if (!active) return;
      if (state.editMode || state.overlayStack.length > 0) {
        cancelMultiFade();
      }
    });
    return unsub;
  }, []);
}
```

- [ ] **Step 2: Run the tests — all should pass**

```
npx vitest run src/hooks/useMultiFadeSideEffects.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMultiFadeSideEffects.ts src/hooks/useMultiFadeSideEffects.test.ts
git commit -m "feat(PERF1): add useMultiFadeSideEffects — zero-subscription side-effect hook"
```

---

## Task 3: Strip effects and hotkeys from `useMultiFadeMode`

**Files:**
- Modify: `src/hooks/useMultiFadeMode.ts`
- Modify: `src/hooks/useMultiFadeMode.test.ts`

The hook retains all state subscriptions and `useCallback` action wrappers. The three `useHotkeys` calls and two `useEffect` auto-cancel blocks move to `useMultiFadeSideEffects`; the `editMode` and `overlayStack` subscriptions are no longer needed.

- [ ] **Step 1: Update `useMultiFadeMode.ts`**

Replace the entire file content with:

```typescript
// src/hooks/useMultiFadeMode.ts
import { useCallback } from "react";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { executeFadeTap } from "@/lib/audio/padPlayer";
import type { Pad, Scene } from "@/lib/schemas";

export type { SelectedPadFade } from "@/state/multiFadeStore";

/**
 * Build an O(1) lookup map of padId → Pad across all scenes. Avoids the
 * O(scenes × pads) cost of scenes.flatMap(...).find(...) inside per-pad loops.
 */
function buildPadMap(scenes: Scene[]): Map<string, Pad> {
  const map = new Map<string, Pad>();
  for (const scene of scenes) {
    for (const pad of scene.pads) {
      map.set(pad.id, pad);
    }
  }
  return map;
}

export function executeMultiFadeNow(): void {
  const { selectedPads, resetMultiFade } = useMultiFadeStore.getState();
  if (selectedPads.size === 0) return;
  const scenes = useProjectStore.getState().project?.scenes ?? [];
  const padMap = buildPadMap(scenes);
  const globalFadeDurationMs = undefined; // resolved inside executeFadeTap

  for (const [padId] of selectedPads) {
    const pad = padMap.get(padId);
    if (!pad) continue;
    executeFadeTap(pad, globalFadeDurationMs);
  }
  resetMultiFade();
}

export interface UseMultiFadeModeReturn {
  active: boolean;
  originPadId: string | null;
  selectedPads: ReturnType<typeof useMultiFadeStore.getState>["selectedPads"];
  enter: (originPadId: string) => void;
  togglePad: (padId: string) => void;
  setFadeLevels: (padId: string, levels: [number, number]) => void;
  canExecute: boolean;
  execute: () => void;
  cancel: () => void;
  reopenPadId: string | null;
  clearReopenPadId: () => void;
}

/**
 * Read multi-fade state and get stable action callbacks. Does NOT register
 * hotkeys or side effects — use useMultiFadeSideEffects() for that.
 */
export function useMultiFadeMode(): UseMultiFadeModeReturn {
  const active = useMultiFadeStore((s) => s.active);
  const originPadId = useMultiFadeStore((s) => s.originPadId);
  const selectedPads = useMultiFadeStore((s) => s.selectedPads);
  const reopenPadId = useMultiFadeStore((s) => s.reopenPadId);
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const toggleMultiFadePad = useMultiFadeStore((s) => s.toggleMultiFadePad);
  const setMultiFadeLevels = useMultiFadeStore((s) => s.setMultiFadeLevels);
  const cancelMultiFade = useMultiFadeStore((s) => s.cancelMultiFade);
  const clearMultiFadeReopenPadId = useMultiFadeStore((s) => s.clearMultiFadeReopenPadId);

  const canExecute = active && selectedPads.size >= 1;

  const enter = useCallback((padId: string) => {
    const scenes = useProjectStore.getState().project?.scenes ?? [];
    const padMap = buildPadMap(scenes);
    const pad = padMap.get(padId);
    enterMultiFade(padId, pad?.volume ?? 1, pad?.fadeTargetVol ?? 0);
  }, [enterMultiFade]);

  const togglePad = useCallback((padId: string) => {
    const scenes = useProjectStore.getState().project?.scenes ?? [];
    const padMap = buildPadMap(scenes);
    const pad = padMap.get(padId);
    toggleMultiFadePad(padId, pad?.volume ?? 1, pad?.fadeTargetVol ?? 0);
  }, [toggleMultiFadePad]);

  const setFadeLevels = useCallback((padId: string, levels: [number, number]) => {
    setMultiFadeLevels(padId, levels);
  }, [setMultiFadeLevels]);

  const execute = useCallback(() => {
    if (!canExecute) return;
    executeMultiFadeNow();
  }, [canExecute]);

  const cancel = useCallback(() => {
    cancelMultiFade();
  }, [cancelMultiFade]);

  const clearReopenPadId = useCallback(() => {
    clearMultiFadeReopenPadId();
  }, [clearMultiFadeReopenPadId]);

  return {
    active,
    originPadId,
    selectedPads,
    enter,
    togglePad,
    setFadeLevels,
    canExecute,
    execute,
    cancel,
    reopenPadId,
    clearReopenPadId,
  };
}
```

**Important:** `executeMultiFadeNow` previously imported `useAppSettingsStore` for `globalFadeDurationMs`. Keep that import — do not pass `undefined`. Here is the corrected `executeMultiFadeNow`:

```typescript
import { useAppSettingsStore } from "@/state/appSettingsStore";

export function executeMultiFadeNow(): void {
  const { selectedPads, resetMultiFade } = useMultiFadeStore.getState();
  if (selectedPads.size === 0) return;
  const scenes = useProjectStore.getState().project?.scenes ?? [];
  const padMap = buildPadMap(scenes);
  const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

  for (const [padId] of selectedPads) {
    const pad = padMap.get(padId);
    if (!pad) continue;
    executeFadeTap(pad, globalFadeDurationMs);
  }
  resetMultiFade();
}
```

The full file after edit (combining both snippets):

```typescript
// src/hooks/useMultiFadeMode.ts
import { useCallback } from "react";
import { useProjectStore } from "@/state/projectStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { executeFadeTap } from "@/lib/audio/padPlayer";
import type { Pad, Scene } from "@/lib/schemas";

export type { SelectedPadFade } from "@/state/multiFadeStore";

function buildPadMap(scenes: Scene[]): Map<string, Pad> {
  const map = new Map<string, Pad>();
  for (const scene of scenes) {
    for (const pad of scene.pads) {
      map.set(pad.id, pad);
    }
  }
  return map;
}

export function executeMultiFadeNow(): void {
  const { selectedPads, resetMultiFade } = useMultiFadeStore.getState();
  if (selectedPads.size === 0) return;
  const scenes = useProjectStore.getState().project?.scenes ?? [];
  const padMap = buildPadMap(scenes);
  const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

  for (const [padId] of selectedPads) {
    const pad = padMap.get(padId);
    if (!pad) continue;
    executeFadeTap(pad, globalFadeDurationMs);
  }
  resetMultiFade();
}

export interface UseMultiFadeModeReturn {
  active: boolean;
  originPadId: string | null;
  selectedPads: ReturnType<typeof useMultiFadeStore.getState>["selectedPads"];
  enter: (originPadId: string) => void;
  togglePad: (padId: string) => void;
  setFadeLevels: (padId: string, levels: [number, number]) => void;
  canExecute: boolean;
  execute: () => void;
  cancel: () => void;
  reopenPadId: string | null;
  clearReopenPadId: () => void;
}

/**
 * Read multi-fade state and get stable action callbacks. Does NOT register
 * hotkeys or side effects — use useMultiFadeSideEffects() for that.
 */
export function useMultiFadeMode(): UseMultiFadeModeReturn {
  const active = useMultiFadeStore((s) => s.active);
  const originPadId = useMultiFadeStore((s) => s.originPadId);
  const selectedPads = useMultiFadeStore((s) => s.selectedPads);
  const reopenPadId = useMultiFadeStore((s) => s.reopenPadId);
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const toggleMultiFadePad = useMultiFadeStore((s) => s.toggleMultiFadePad);
  const setMultiFadeLevels = useMultiFadeStore((s) => s.setMultiFadeLevels);
  const cancelMultiFade = useMultiFadeStore((s) => s.cancelMultiFade);
  const clearMultiFadeReopenPadId = useMultiFadeStore((s) => s.clearMultiFadeReopenPadId);

  const canExecute = active && selectedPads.size >= 1;

  const enter = useCallback((padId: string) => {
    const scenes = useProjectStore.getState().project?.scenes ?? [];
    const padMap = buildPadMap(scenes);
    const pad = padMap.get(padId);
    enterMultiFade(padId, pad?.volume ?? 1, pad?.fadeTargetVol ?? 0);
  }, [enterMultiFade]);

  const togglePad = useCallback((padId: string) => {
    const scenes = useProjectStore.getState().project?.scenes ?? [];
    const padMap = buildPadMap(scenes);
    const pad = padMap.get(padId);
    toggleMultiFadePad(padId, pad?.volume ?? 1, pad?.fadeTargetVol ?? 0);
  }, [toggleMultiFadePad]);

  const setFadeLevels = useCallback((padId: string, levels: [number, number]) => {
    setMultiFadeLevels(padId, levels);
  }, [setMultiFadeLevels]);

  const execute = useCallback(() => {
    if (!canExecute) return;
    executeMultiFadeNow();
  }, [canExecute]);

  const cancel = useCallback(() => {
    cancelMultiFade();
  }, [cancelMultiFade]);

  const clearReopenPadId = useCallback(() => {
    clearMultiFadeReopenPadId();
  }, [clearMultiFadeReopenPadId]);

  return {
    active,
    originPadId,
    selectedPads,
    enter,
    togglePad,
    setFadeLevels,
    canExecute,
    execute,
    cancel,
    reopenPadId,
    clearReopenPadId,
  };
}
```

- [ ] **Step 2: Update `useMultiFadeMode.test.ts` — remove hotkey and auto-cancel blocks**

Remove the `describe("useMultiFadeMode — f/x hotkey registration", ...)` block (lines ~141–191) and the `describe("useMultiFadeMode — auto-cancel side effects", ...)` block (lines ~280–316). Those behaviors now live in `useMultiFadeSideEffects.test.ts`.

Also remove the `useHotkeys` mock and import since the hook no longer calls it:

```typescript
// Remove these lines from useMultiFadeMode.test.ts:
import { useHotkeys } from "react-hotkeys-hook";
// ...
vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));
```

- [ ] **Step 3: Run tests to confirm both files pass**

```
npx vitest run src/hooks/useMultiFadeMode.test.ts src/hooks/useMultiFadeSideEffects.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useMultiFadeMode.ts src/hooks/useMultiFadeMode.test.ts
git commit -m "refactor(PERF1): strip hotkeys and auto-cancel effects from useMultiFadeMode"
```

---

## Task 4: Wire `SceneView` to `useMultiFadeSideEffects`

**Files:**
- Modify: `src/components/composite/SceneView/SceneView.tsx`

- [ ] **Step 1: Update the import and call site**

In `SceneView.tsx`, replace:

```typescript
import { useMultiFadeMode } from "@/hooks/useMultiFadeMode";
```

with:

```typescript
import { useMultiFadeSideEffects } from "@/hooks/useMultiFadeSideEffects";
```

And replace the call at line 50:

```typescript
useMultiFadeMode();
```

with:

```typescript
useMultiFadeSideEffects();
```

- [ ] **Step 2: TypeScript check**

```
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 3: Run the full test suite**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/SceneView.tsx
git commit -m "fix(PERF1): SceneView uses useMultiFadeSideEffects — no re-renders from multi-fade selection"
```

---

## Task 5: Update `docs/review-HEAD.md`

**Files:**
- Modify: `docs/review-HEAD.md`

- [ ] **Step 1: Mark PERF1 fixed**

Change the PERF1 heading from:

```markdown
### [PERF1] `useMultiFadeMode()` called for side-effects only causes full `SceneView` re-renders
```

to:

```markdown
### ~~[PERF1] `useMultiFadeMode()` called for side-effects only causes full `SceneView` re-renders~~ ✅ FIXED
```

Add fix details below the existing finding text:

```markdown
- **Fix applied**: Extracted `useMultiFadeSideEffects` hook (zero React subscriptions) that replaces `useMultiFadeMode()` at the SceneView call site. Hotkeys use `getState()` inside callbacks; auto-cancel on editMode/overlayStack uses `useUiStore.subscribe()` in a single mount effect. `useMultiFadeMode` retains all state subscriptions for components that explicitly read its return value but no longer registers hotkeys or effects. SceneView no longer re-renders on `selectedPads`, `originPadId`, `reopenPadId`, or `overlayStack` changes.
```

Update the Medium count in the summary table from `17 (5 fixed)` to `16 (6 fixed)`.

Add to the Fixed Items table at the bottom:

```markdown
| PERF1 | `useMultiFadeSideEffects` extracted; SceneView no longer subscribes to multi-fade state; zero-subscription hotkeys + Zustand subscribe for auto-cancel |
```

- [ ] **Step 2: Verify the document looks correct**

Open `docs/review-HEAD.md` and confirm PERF1 section and summary counts are right.

- [ ] **Step 3: Commit**

```bash
git add docs/review-HEAD.md
git commit -m "docs: mark PERF1 fixed in review-HEAD.md"
```

---

## Self-Review

**Spec coverage:**
- ✅ Side-effect registration moved out of SceneView's render path → Task 2
- ✅ Hotkeys use `getState()` — no subscriptions → Task 2
- ✅ Auto-cancel uses `useUiStore.subscribe` — no React subscription → Task 2
- ✅ `useMultiFadeMode` retains state-reading capability unchanged → Task 3
- ✅ SceneView wired to new hook → Task 4
- ✅ Tests for new behavior → Task 1
- ✅ Stale tests removed from `useMultiFadeMode.test.ts` → Task 3
- ✅ Review doc updated → Task 5

**Placeholder scan:** No TBDs, no "fill in later", all code blocks complete.

**Type consistency:**
- `useMultiFadeSideEffects` is imported by name in `useMultiFadeSideEffects.test.ts`, `SceneView.tsx` — matches the export in `useMultiFadeSideEffects.ts` ✅
- `executeMultiFadeNow` is re-exported from `useMultiFadeMode.ts` and imported in `useMultiFadeSideEffects.ts` — no rename ✅
- `UseMultiFadeModeReturn` interface unchanged — all callers unaffected ✅

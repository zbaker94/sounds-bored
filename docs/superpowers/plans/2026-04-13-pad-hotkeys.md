# Pad Hotkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add F/X keyboard shortcuts to the pad context-menu popover and edit-mode backside, plus f/x execute and escape-guard improvements in multi-fade mode, all with hover tooltips.

**Architecture:** Local `useHotkeys` calls in `PadControlContent` (scoped by a new `context` prop) handle the popover case. Global handlers in `useGlobalHotkeys` cover the edit-mode and multi-fade cases. A new `enterMultiFadeEmpty` store action lets multi-fade start with no pre-selected pad.

**Tech Stack:** react-hotkeys-hook, Zustand, Radix UI Tooltip, shadcn/ui `Kbd` component, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-04-13-pad-hotkeys-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/state/multiFadeStore.ts` | Add `enterMultiFadeEmpty` action |
| `src/state/multiFadeStore.test.ts` | Add `enterMultiFadeEmpty` tests |
| `src/hooks/useMultiFadeMode.ts` | Add f/x execute hotkeys |
| `src/hooks/useMultiFadeMode.test.ts` | Add f/x registration and execution tests |
| `src/hooks/useGlobalHotkeys.ts` | Patch escape; add f/x edit-mode handler |
| `src/components/composite/SceneView/PadControlContent.tsx` | Add `context` prop, f/x hotkeys, Tooltip wrappers |
| `src/components/composite/SceneView/PadControlContent.test.tsx` | Add hotkey + tooltip tests; add `TooltipProvider` wrapper |
| `src/components/composite/SceneView/PadButton.tsx` | Pass `context` prop to all three `PadControlContent` usages |
| `docs/manual-tests/19-pad-control-popover.md` | Add hotkey test sections |
| `docs/manual-tests/20-keyboard-shortcuts.md` | Add f/x and escape/multi-fade test updates |

---

## Task 1: Add `enterMultiFadeEmpty` to multiFadeStore

**Files:**
- Modify: `src/state/multiFadeStore.ts`
- Test: `src/state/multiFadeStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block at the bottom of `src/state/multiFadeStore.test.ts`, before the final `}`  of the outer describe, alongside the other action tests:

```typescript
describe("enterMultiFadeEmpty", () => {
  it("should set active to true", () => {
    const { enterMultiFadeEmpty } = useMultiFadeStore.getState();
    enterMultiFadeEmpty();
    expect(useMultiFadeStore.getState().active).toBe(true);
  });

  it("should set originPadId to null", () => {
    const { enterMultiFadeEmpty } = useMultiFadeStore.getState();
    enterMultiFadeEmpty();
    expect(useMultiFadeStore.getState().originPadId).toBeNull();
  });

  it("should start with empty selectedPads", () => {
    const { enterMultiFadeEmpty } = useMultiFadeStore.getState();
    enterMultiFadeEmpty();
    expect(useMultiFadeStore.getState().selectedPads.size).toBe(0);
  });

  it("should set reopenPadId to null", () => {
    useMultiFadeStore.setState({ reopenPadId: "pad-1" });
    const { enterMultiFadeEmpty } = useMultiFadeStore.getState();
    enterMultiFadeEmpty();
    expect(useMultiFadeStore.getState().reopenPadId).toBeNull();
  });

  it("should clear any existing selectedPads", () => {
    useMultiFadeStore.setState({
      selectedPads: new Map<string, SelectedPadFade>([
        ["pad-1", { padId: "pad-1", levels: [0, 80] as [number, number] }],
      ]),
    });
    const { enterMultiFadeEmpty } = useMultiFadeStore.getState();
    enterMultiFadeEmpty();
    expect(useMultiFadeStore.getState().selectedPads.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd C:\Repos\sounds-bored && npx vitest run src/state/multiFadeStore.test.ts
```

Expected: 5 failures — `enterMultiFadeEmpty is not a function` (or similar).

- [ ] **Step 3: Add the action to the store**

In `src/state/multiFadeStore.ts`, add `enterMultiFadeEmpty` to the `MultiFadeActions` interface:

```typescript
interface MultiFadeActions {
  enterMultiFade: (originPadId: string, playing: boolean, initialVolume?: number) => void;
  enterMultiFadeEmpty: () => void;   // ← add this line
  toggleMultiFadePad: (padId: string, playing: boolean, currentVolume: number) => void;
  setMultiFadeLevels: (padId: string, levels: [number, number]) => void;
  cancelMultiFade: () => void;
  resetMultiFade: () => void;
  clearMultiFadeReopenPadId: () => void;
}
```

Then add the implementation inside `create(...)`, after the `enterMultiFade` action:

```typescript
  enterMultiFadeEmpty: () =>
    set({
      active: true,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
    }),
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run src/state/multiFadeStore.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/multiFadeStore.ts src/state/multiFadeStore.test.ts
git commit -m "feat: add enterMultiFadeEmpty action to multiFadeStore"
```

---

## Task 2: Add f/x execute hotkeys to useMultiFadeMode

**Files:**
- Modify: `src/hooks/useMultiFadeMode.ts`
- Test: `src/hooks/useMultiFadeMode.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block in `src/hooks/useMultiFadeMode.test.ts`, after the existing `"useMultiFadeMode — cancel()"` describe block:

```typescript
describe("useMultiFadeMode — f/x hotkey registration", () => {
  it("registers f,x hotkeys with useHotkeys", () => {
    loadPadsInStore(1);
    renderHook(() => useMultiFadeMode());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "f,x");
    expect(fxCall).toBeDefined();
  });

  it("f,x handler executes multi-fade when canExecute is true", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    const pads = loadPadsInStore(1);

    // Set up active multi-fade state with a selected pad before rendering
    useMultiFadeStore.setState({
      active: true,
      originPadId: pads[0].id,
      selectedPads: new Map([[pads[0].id, { padId: pads[0].id, levels: [0, 80] as [number, number] }]]),
      reopenPadId: null,
    });

    renderHook(() => useMultiFadeMode());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "f,x");
    const handler = fxCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(fadePadWithLevels).toHaveBeenCalled();
  });

  it("f,x handler is a no-op when canExecute is false", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    loadPadsInStore(1);

    // Not active, no selected pads
    renderHook(() => useMultiFadeMode());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "f,x");
    const handler = fxCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(fadePadWithLevels).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/hooks/useMultiFadeMode.test.ts
```

Expected: 3 new failures (f,x hotkey not registered yet).

- [ ] **Step 3: Add the f/x useHotkeys call**

In `src/hooks/useMultiFadeMode.ts`, add this line immediately after the existing `useHotkeys("enter", ...)` line:

```typescript
  useHotkeys("enter", execute, { enabled: active && canExecute }, [active, canExecute, execute]);
  useHotkeys("f,x", execute, { enabled: active && canExecute }, [active, canExecute, execute]);  // ← add
  useHotkeys("escape", cancel, { enabled: active }, [active, cancel]);
```

- [ ] **Step 4: Run to confirm pass**

```bash
npx vitest run src/hooks/useMultiFadeMode.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMultiFadeMode.ts src/hooks/useMultiFadeMode.test.ts
git commit -m "feat: add f/x hotkeys to execute multi-fade in useMultiFadeMode"
```

---

## Task 3: Patch useGlobalHotkeys — escape guard + edit-mode f/x

**Files:**
- Modify: `src/hooks/useGlobalHotkeys.ts`

No automated unit test exists for this hook (it integrates too many stores/router concerns). Coverage is provided by the manual tests updated in Task 6.

- [ ] **Step 1: Add the multiFadeStore import**

At the top of `src/hooks/useGlobalHotkeys.ts`, add:

```typescript
import { useMultiFadeStore } from "@/state/multiFadeStore";
```

The full import block should read:

```typescript
import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
```

- [ ] **Step 2: Patch the escape handler to bail early when multi-fade is active**

Replace the existing escape `useHotkeys` block:

```typescript
  useHotkeys("esc", () => {
    const { overlayStack, closeOverlay, toggleOverlay } = useUiStore.getState();
    const top = overlayStack[overlayStack.length - 1];
    if (top) {
      if (top.id === OVERLAY_ID.EXPORT_PROGRESS_DIALOG) return;
      closeOverlay(top.id);
    } else {
      toggleOverlay(OVERLAY_ID.MENU_DRAWER, "drawer");
    }
  }, { enableOnFormTags: true });
```

With:

```typescript
  useHotkeys("esc", () => {
    // Multi-fade mode owns escape — its useHotkeys handler in useMultiFadeMode
    // cancels the fade. Don't also open the menu drawer.
    if (useMultiFadeStore.getState().active) return;
    const { overlayStack, closeOverlay, toggleOverlay } = useUiStore.getState();
    const top = overlayStack[overlayStack.length - 1];
    if (top) {
      if (top.id === OVERLAY_ID.EXPORT_PROGRESS_DIALOG) return;
      closeOverlay(top.id);
    } else {
      toggleOverlay(OVERLAY_ID.MENU_DRAWER, "drawer");
    }
  }, { enableOnFormTags: true });
```

- [ ] **Step 3: Add the f/x edit-mode handler**

Append this block inside `useGlobalHotkeys`, after the existing `useHotkeys("mod+e", ...)` block:

```typescript
  // F or X in edit mode: exit edit mode and enter multi-fade with no pre-selected pad.
  // Both store mutations happen in the same synchronous call so React 18 batches them —
  // the useMultiFadeMode "cancel when editMode && active" effect sees editMode=false
  // in the same render and does not cancel.
  useHotkeys("f,x", () => {
    const { editMode, toggleEditMode } = useUiStore.getState();
    const { active: multiFadeActive, enterMultiFadeEmpty } = useMultiFadeStore.getState();
    if (!editMode || multiFadeActive) return;
    toggleEditMode();
    enterMultiFadeEmpty();
  });
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no output (empty = success).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGlobalHotkeys.ts
git commit -m "feat: patch escape guard and add f/x edit-mode hotkeys in useGlobalHotkeys"
```

---

## Task 4: Add `context` prop, hotkeys, and tooltips to PadControlContent

**Files:**
- Modify: `src/components/composite/SceneView/PadControlContent.tsx`
- Test: `src/components/composite/SceneView/PadControlContent.test.tsx`

- [ ] **Step 1: Update the test helper and write failing tests**

In `src/components/composite/SceneView/PadControlContent.test.tsx`:

**Add imports** at the top of the file (after existing imports):

```typescript
import { TooltipProvider } from "@/components/ui/tooltip";
```

**Replace the `renderContent` function** with this updated version that adds `TooltipProvider` and accepts `context`:

```typescript
function renderContent(
  padOverrides = {},
  onEditClick = vi.fn(),
  onClose = vi.fn(),
  context: "popover" | "backface" = "popover"
) {
  const pad = loadPadInStore(padOverrides);
  render(
    <TooltipProvider>
      <PadControlContent
        pad={pad}
        sceneId="scene-1"
        onClose={onClose}
        onEditClick={onEditClick}
        context={context}
      />
    </TooltipProvider>
  );
  return { pad, onEditClick, onClose };
}
```

**Add these failing tests** at the bottom of the file, before the `getSoundsForLayer` describe:

```typescript
describe("PadControlContent — hotkeys", () => {
  it("pressing f in popover context triggers fade", async () => {
    renderContent({}, vi.fn(), vi.fn(), "popover");
    await userEvent.keyboard("f");
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    expect(fadePadWithLevels).toHaveBeenCalled();
  });

  it("pressing x in popover context enters multi-fade mode", async () => {
    renderContent({}, vi.fn(), vi.fn(), "popover");
    await userEvent.keyboard("x");
    expect(useMultiFadeStore.getState().active).toBe(true);
  });

  it("pressing f in backface context does NOT trigger fade", async () => {
    renderContent({}, vi.fn(), vi.fn(), "backface");
    await userEvent.keyboard("f");
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    expect(fadePadWithLevels).not.toHaveBeenCalled();
  });

  it("pressing x in backface context does NOT enter multi-fade mode", async () => {
    renderContent({}, vi.fn(), vi.fn(), "backface");
    await userEvent.keyboard("x");
    expect(useMultiFadeStore.getState().active).toBe(false);
  });
});

describe("PadControlContent — tooltips", () => {
  function mockResizeObserverWithHeight(height: number) {
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation(function (this: unknown, cb: ResizeObserverCallback) {
        return {
          observe: vi.fn().mockImplementation(() => {
            cb([{ contentRect: { height } } as ResizeObserverEntry], {} as ResizeObserver);
          }),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        };
      })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Fade In button shows [F] tooltip in popover context (full mode)", async () => {
    mockResizeObserverWithHeight(300);
    renderContent({}, vi.fn(), vi.fn(), "popover");
    await userEvent.hover(screen.getByRole("button", { name: /fade in/i }));
    expect(await screen.findByText("F")).toBeInTheDocument();
  });

  it("Synchronized Fades button shows [X] tooltip in popover context (full mode)", async () => {
    mockResizeObserverWithHeight(300);
    renderContent({}, vi.fn(), vi.fn(), "popover");
    await userEvent.hover(screen.getByRole("button", { name: /synchronized fades/i }));
    expect(await screen.findByText("X")).toBeInTheDocument();
  });

  it("Synchronized Fades button shows [F] / [X] tooltip in backface context (full mode)", async () => {
    mockResizeObserverWithHeight(300);
    renderContent({}, vi.fn(), vi.fn(), "backface");
    await userEvent.hover(screen.getByRole("button", { name: /synchronized fades/i }));
    // Both Kbd elements appear in the tooltip
    expect(await screen.findByText("F")).toBeInTheDocument();
    expect(await screen.findByText("X")).toBeInTheDocument();
  });

  it("Fade In button has no tooltip in backface context (full mode)", async () => {
    mockResizeObserverWithHeight(300);
    renderContent({}, vi.fn(), vi.fn(), "backface");
    await userEvent.hover(screen.getByRole("button", { name: /fade in/i }));
    // Wait a tick to give tooltip time to appear if it were going to
    await new Promise((r) => setTimeout(r, 50));
    // "F" should not appear as a standalone kbd since there's no tooltip on the fade button
    const kbdElements = document.querySelectorAll("[data-slot='kbd']");
    expect(kbdElements.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run src/components/composite/SceneView/PadControlContent.test.tsx
```

Expected: the new hotkey and tooltip tests fail (type error on missing `context` prop, and runtime failures).

- [ ] **Step 3: Add imports to PadControlContent.tsx**

In `src/components/composite/SceneView/PadControlContent.tsx`, add to the existing imports:

```typescript
import { useHotkeys } from "react-hotkeys-hook";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
```

- [ ] **Step 4: Add `context` to the props interface**

Replace the existing `PadControlContentProps` interface:

```typescript
export interface PadControlContentProps {
  pad: Pad;
  sceneId: string;
  onClose: () => void;
  onEditClick?: (pad: Pad) => void;
  /** Called after enterMultiFade — allows the caller to exit edit mode in the same
   *  event-handler flush so React 18 batches it with the store update, preventing
   *  the useMultiFadeMode "cancel when editMode && active" effect from firing. */
  onMultiFade?: () => void;
  /** "popover": f=fade, x=multi-fade; tooltip hints shown per-key.
   *  "backface": no local hotkeys (global f/x in useGlobalHotkeys handle edit mode);
   *  tooltip on Synchronized Fades shows both keys. */
  context: "popover" | "backface";
}
```

- [ ] **Step 5: Destructure `context` and add the hotkey calls**

In the `PadControlContent` function body, destructure `context` from props:

```typescript
export const PadControlContent = memo(function PadControlContent({
  pad,
  sceneId,
  onClose,
  onEditClick,
  onMultiFade,
  context,
}: PadControlContentProps) {
```

Then add the two `useHotkeys` calls immediately after all existing `useCallback` / `useEffect` declarations and before the `fadeSection` JSX block (around line 471 in the original file, after `handleMultiFade`):

```typescript
  // Popover-scoped hotkeys: only active when this component is mounted as a popover/drawer.
  // In backface context, f/x are handled globally by useGlobalHotkeys (edit-mode handler).
  useHotkeys("f", handleFade,      { enabled: context === "popover" }, [handleFade, context]);
  useHotkeys("x", handleMultiFade, { enabled: context === "popover" }, [handleMultiFade, context]);
```

- [ ] **Step 6: Wrap the full-mode Fade In/Out button with a tooltip**

Find the full-mode "Fade In/Out" `Button` (it is inside `const fadeSection = (...)` around line 535):

```tsx
      <Button size="sm" variant="secondary" onClick={handleFade} className="w-full gap-1.5">
        <HugeiconsIcon icon={VolumeHighIcon} size={14} />
        {isPlaying ? "Fade Out" : "Fade In"}
      </Button>
```

Replace it with:

```tsx
      {context === "popover" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="secondary" onClick={handleFade} className="w-full gap-1.5">
              <HugeiconsIcon icon={VolumeHighIcon} size={14} />
              {isPlaying ? "Fade Out" : "Fade In"}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <Kbd>F</Kbd>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button size="sm" variant="secondary" onClick={handleFade} className="w-full gap-1.5">
          <HugeiconsIcon icon={VolumeHighIcon} size={14} />
          {isPlaying ? "Fade Out" : "Fade In"}
        </Button>
      )}
```

- [ ] **Step 7: Wrap the full-mode Synchronized Fades button with a tooltip**

Find the full-mode Synchronized Fades `Button` (inside `displayMode === "full"`, around line 673):

```tsx
              <Button
                size="sm"
                variant="ghost"
                onClick={handleMultiFade}
                className="bg-yellow-500 w-full text-xs"
              >
                Synchronized Fades
              </Button>
```

Replace it with:

```tsx
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleMultiFade}
                    className="bg-yellow-500 w-full text-xs"
                  >
                    Synchronized Fades
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {context === "popover" ? (
                    <Kbd>X</Kbd>
                  ) : (
                    <><Kbd>F</Kbd> / <Kbd>X</Kbd></>
                  )}
                </TooltipContent>
              </Tooltip>
```

- [ ] **Step 8: Wrap the condensed-mode Fade In/Out button with a tooltip**

Find the condensed-mode "Fade In/Out" `Button` (inside the `(displayMode === "condensed" || displayMode === "scroll")` block, around line 735):

```tsx
              <Button
                size="sm"
                variant="secondary"
                onClick={handleFade}
                className="flex-1 gap-1 text-xs"
              >
                <HugeiconsIcon icon={VolumeHighIcon} size={12} />
                {isPlaying ? "Fade Out" : "Fade In"}
              </Button>
```

Replace it with:

```tsx
              {context === "popover" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleFade}
                      className="flex-1 gap-1 text-xs"
                    >
                      <HugeiconsIcon icon={VolumeHighIcon} size={12} />
                      {isPlaying ? "Fade Out" : "Fade In"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <Kbd>F</Kbd>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleFade}
                  className="flex-1 gap-1 text-xs"
                >
                  <HugeiconsIcon icon={VolumeHighIcon} size={12} />
                  {isPlaying ? "Fade Out" : "Fade In"}
                </Button>
              )}
```

- [ ] **Step 9: Wrap the condensed-mode Synchronized Fades icon button with a tooltip**

Find the condensed-mode Synchronized Fades icon `Button` (around line 770):

```tsx
              {/* Synchronized Fades — fires directly */}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Synchronized Fades"
                className="bg-yellow-500"
                onClick={handleMultiFade}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
              </Button>
```

Replace it with:

```tsx
              {/* Synchronized Fades — fires directly */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Synchronized Fades"
                    className="bg-yellow-500"
                    onClick={handleMultiFade}
                  >
                    <HugeiconsIcon icon={PlayIcon} size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {context === "popover" ? (
                    <Kbd>X</Kbd>
                  ) : (
                    <><Kbd>F</Kbd> / <Kbd>X</Kbd></>
                  )}
                </TooltipContent>
              </Tooltip>
```

- [ ] **Step 10: Run the tests**

```bash
npx vitest run src/components/composite/SceneView/PadControlContent.test.tsx
```

Expected: all tests pass. If any tooltip test is flaky due to Radix animation timing, increase the `findByText` timeout: `screen.findByText("F", {}, { timeout: 2000 })`.

- [ ] **Step 11: Commit**

```bash
git add src/components/composite/SceneView/PadControlContent.tsx src/components/composite/SceneView/PadControlContent.test.tsx
git commit -m "feat: add context prop, f/x hotkeys, and tooltips to PadControlContent"
```

---

## Task 5: Pass `context` prop in PadButton

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`

- [ ] **Step 1: Pass `context="backface"` to the back-face PadControlContent**

In `src/components/composite/SceneView/PadButton.tsx`, find the back-face `PadControlContent` usage (around line 505):

```tsx
              <PadControlContent
                pad={pad}
                sceneId={sceneId}
                // No dismiss action on back face — user exits edit mode via the global toggle
                onClose={() => {}}
                // Exit edit mode when multi-fade is entered so both state changes land in the
                // same React render (editMode=false, active=true), preventing useMultiFadeMode
                // from immediately cancelling and reopening the live-control popover.
                onMultiFade={toggleEditMode}
                onEditClick={onEditClick}
              />
```

Replace with:

```tsx
              <PadControlContent
                pad={pad}
                sceneId={sceneId}
                context="backface"
                // No dismiss action on back face — user exits edit mode via the global toggle
                onClose={() => {}}
                // Exit edit mode when multi-fade is entered so both state changes land in the
                // same React render (editMode=false, active=true), preventing useMultiFadeMode
                // from immediately cancelling and reopening the live-control popover.
                onMultiFade={toggleEditMode}
                onEditClick={onEditClick}
              />
```

- [ ] **Step 2: Pass `context="popover"` to the PopoverContent PadControlContent**

Find the `PopoverContent` usage (around line 521):

```tsx
      <PopoverContent side="bottom" sideOffset={10} showArrow>
        <PadControlContent
          pad={pad}
          sceneId={sceneId}
          onClose={() => setPopoverOpen(false)}
          onEditClick={onEditClick}
        />
      </PopoverContent>
```

Replace with:

```tsx
      <PopoverContent side="bottom" sideOffset={10} showArrow>
        <PadControlContent
          pad={pad}
          sceneId={sceneId}
          context="popover"
          onClose={() => setPopoverOpen(false)}
          onEditClick={onEditClick}
        />
      </PopoverContent>
```

- [ ] **Step 3: Pass `context="popover"` to the DrawerContent PadControlContent**

Find the `DrawerContent` usage (around line 534):

```tsx
          <div className="px-4 pb-4 pt-2">
            <PadControlContent
              pad={pad}
              sceneId={sceneId}
              onClose={() => setPopoverOpen(false)}
              onEditClick={onEditClick}
            />
          </div>
```

Replace with:

```tsx
          <div className="px-4 pb-4 pt-2">
            <PadControlContent
              pad={pad}
              sceneId={sceneId}
              context="popover"
              onClose={() => setPopoverOpen(false)}
              onEditClick={onEditClick}
            />
          </div>
```

- [ ] **Step 4: Type-check and run the full test suite**

```bash
npx tsc --noEmit
```

Expected: no output (empty = success).

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx
git commit -m "feat: pass context prop to PadControlContent in PadButton"
```

---

## Task 6: Update manual test documentation

**Files:**
- Modify: `docs/manual-tests/19-pad-control-popover.md`
- Modify: `docs/manual-tests/20-keyboard-shortcuts.md`

- [ ] **Step 1: Add hotkey tests to 19-pad-control-popover.md**

Append to `docs/manual-tests/19-pad-control-popover.md`:

```markdown
---

## Test I: Hotkey F — fade from popover

1. Right-click any playing pad to open its control popover.
2. Press **F**.

**Expected:** The pad fades using the current fade levels and duration. The popover closes.

3. Right-click a non-playing pad to open its control popover.
4. Press **F**.

**Expected:** The pad fades in (triggers then ramps volume). The popover closes.

---

## Test J: Hotkey X — enter Synchronized Fades from popover

1. Right-click any pad to open its control popover.
2. Press **X**.

**Expected:**
- The popover closes.
- Multi-fade mode activates (the yellow MultiFade pill appears).
- The origin pad is pre-selected (ring visible on it).

---

## Test K: Tooltip hints visible on hover

1. Right-click any pad to open its control popover.
2. Hover over the **Fade In / Fade Out** button.

**Expected:** A tooltip appears showing **F**.

3. Hover over the **Synchronized Fades** button.

**Expected:** A tooltip appears showing **X**.

4. Enter edit mode (Ctrl+E). Hover over the **Synchronized Fades** button on any pad's back face.

**Expected:** A tooltip appears showing **F / X**.
```

- [ ] **Step 2: Update 20-keyboard-shortcuts.md**

Append to `docs/manual-tests/20-keyboard-shortcuts.md`:

```markdown
---

## Test J: F / X — fade or enter multi-fade from pad popover

1. Right-click a pad to open its control popover.
2. Press **F**.

**Expected:** The pad fades (same as clicking the Fade In/Out button). Popover closes.

3. Right-click a pad. Press **X**.

**Expected:** Multi-fade mode activates with this pad pre-selected. Popover closes.

---

## Test K: F / X — enter multi-fade from edit mode (no pad pre-selected)

1. Press **Ctrl+E** to enter edit mode.
2. Press **F** (or **X**).

**Expected:**
- Edit mode exits.
- Multi-fade mode activates with **no pad pre-selected** (yellow pill shows, pads are not highlighted until clicked).

---

## Test L: Escape in multi-fade mode — no menu drawer

1. Enter multi-fade mode via any method.
2. Press **Escape**.

**Expected:**
- Multi-fade mode cancels.
- The hamburger menu drawer does **not** open.
- If multi-fade was entered from a pad popover, the pad's popover reopens.

---

## Test M: F / X execute multi-fade

1. Enter multi-fade mode.
2. Select one or more pads by clicking them.
3. Press **F** (or **X**).

**Expected:** Multi-fade executes on all selected pads (same as pressing Enter).
```

- [ ] **Step 3: Update Test I in 20-keyboard-shortcuts.md**

Find the existing Test I text in `docs/manual-tests/20-keyboard-shortcuts.md`:

```markdown
## Test I: Enter / Escape in Synchronized Fades mode

*(See also test doc 11 — Fade and Synchronized Fades)*

1. Enter multi-fade mode (click Synchronized Fades on a pad popover).
2. Press **Enter**.

**Expected:** Multi-fade executes on all selected pads.

3. Enter multi-fade mode again. Press **Escape**.

**Expected:** Multi-fade cancels with no pads faded.
```

Replace with:

```markdown
## Test I: Enter / Escape / F / X in Synchronized Fades mode

*(See also test doc 11 — Fade and Synchronized Fades)*

1. Enter multi-fade mode (click Synchronized Fades on a pad popover).
2. Select one or more pads, then press **Enter**.

**Expected:** Multi-fade executes on all selected pads.

3. Enter multi-fade mode again. Select pads, then press **F** or **X**.

**Expected:** Multi-fade executes (same as Enter).

4. Enter multi-fade mode again. Press **Escape** without executing.

**Expected:** Multi-fade cancels with no pads faded. The hamburger menu drawer does NOT open.
```

- [ ] **Step 4: Commit**

```bash
git add docs/manual-tests/19-pad-control-popover.md docs/manual-tests/20-keyboard-shortcuts.md
git commit -m "docs: update manual tests for pad hotkeys and multi-fade keyboard shortcuts"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full type-check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 2: Full test run**

```bash
npx vitest run
```

Expected: all tests pass, no regressions.

- [ ] **Step 3: Manual smoke test (dev app)**

```bash
npm run tauri dev
```

Verify:
- Right-click a pad → popover opens → hover Fade button shows **[F]** tooltip → press F → pad fades
- Right-click a pad → press X → multi-fade activates with pad pre-selected
- Ctrl+E (edit mode) → press F → edit mode exits, multi-fade activates with no pre-selected pad
- Multi-fade active → press F or X → fade executes
- Multi-fade active → press Escape → cancels, menu drawer does NOT open

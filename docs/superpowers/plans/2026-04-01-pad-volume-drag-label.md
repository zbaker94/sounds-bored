# Pad Volume Drag Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a pad's volume drag gesture is active, replace the pad name with the current volume percentage (e.g. `75%`); restore the name instantly when the drag ends.

**Architecture:** Single conditional in the `PadButton` JSX — `fillVolume` is already threaded in from `usePadGesture`. No new state, hooks, or props needed.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, happy-dom

---

### Task 1: Add failing tests for the volume label swap

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.test.tsx`

- [ ] **Step 1: Add the padPlayer mock and missing imports at the top of the test file**

Open `src/components/composite/SceneView/PadButton.test.tsx`. Add the following directly after the existing import block (after line 7):

```tsx
import { fireEvent, act } from "@testing-library/react";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn(),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  getPadProgress: vi.fn().mockReturnValue(null),
}));
```

- [ ] **Step 2: Add the volume drag describe block at the end of the outer `describe("PadButton")`**

Append this block before the closing `});` of `describe("PadButton", () => {`:

```tsx
  describe("volume drag label", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // happy-dom does not implement setPointerCapture
      HTMLButtonElement.prototype.setPointerCapture = vi.fn();
      useUiStore.setState({ ...initialUiState });
      useProjectStore.setState({ ...initialProjectState });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows volume percentage instead of pad name while in hold phase", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const button = screen.getByRole("button");

      // Pointer down on a non-playing pad
      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });

      // Advance past HOLD_MS (150 ms) to enter hold phase; startVolume=0 (not playing)
      act(() => { vi.advanceTimersByTime(150); });

      expect(screen.getByText("0%")).toBeInTheDocument();
      expect(screen.queryByText("Kick")).not.toBeInTheDocument();
    });

    it("updates percentage as volume changes while dragging", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const button = screen.getByRole("button");

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); });

      // Drag 100 px up: startVolume=0, delta=100, range=200 → newVolume=0.5
      fireEvent.pointerMove(button, { clientY: 100, pointerId: 1 });

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("restores pad name after drag ends", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const button = screen.getByRole("button");

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); });

      // Drag 5 px up to enter drag phase
      fireEvent.pointerMove(button, { clientY: 195, pointerId: 1 });

      expect(screen.queryByText("Kick")).not.toBeInTheDocument();

      fireEvent.pointerUp(button, { pointerId: 1 });

      expect(screen.getByText("Kick")).toBeInTheDocument();
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 3: Run the new tests and confirm they all fail**

```bash
npm run test:run -- PadButton
```

Expected: 3 new tests fail. The first two fail because `"0%"` / `"50%"` are not in the document (pad name still shows). The third fails because the percentage is not present while dragging (pad name never disappears).

---

### Task 2: Implement the label swap

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx:127-129`

- [ ] **Step 1: Replace the static pad name with a conditional**

In `src/components/composite/SceneView/PadButton.tsx`, find the normal-mode name span (currently lines 126–129):

```tsx
        {/* Pad name — normal mode */}
        {!editMode && (
          <span className="relative z-10 line-clamp-3 break-words leading-tight">
            {pad.name}
          </span>
        )}
```

Replace with:

```tsx
        {/* Pad name / volume percentage — normal mode */}
        {!editMode && (
          <span className="relative z-10 line-clamp-3 break-words leading-tight">
            {fillVolume !== null ? `${Math.round(fillVolume * 100)}%` : pad.name}
          </span>
        )}
```

- [ ] **Step 2: Run the tests and confirm all pass**

```bash
npm run test:run -- PadButton
```

Expected: All tests pass, including the 3 new volume drag tests.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx src/components/composite/SceneView/PadButton.test.tsx
git commit -m "feat: show volume percentage on pad label during drag"
```

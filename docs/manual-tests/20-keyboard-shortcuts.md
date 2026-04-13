# Manual Test: Keyboard shortcuts

**Feature area:** `src/hooks/useGlobalHotkeys.ts`, `src/hooks/useMultiFadeMode.ts`  
**Risk area:** Any change to hotkey bindings, overlay management, scene navigation, or edit mode toggle

---

## Test A: Esc — close topmost overlay, or toggle menu drawer

1. With no overlays open, press **Escape**.

**Expected:** The hamburger menu drawer toggles open/closed.

2. Open any overlay (e.g., a dialog). Press **Escape**.

**Expected:** The topmost overlay closes. If another overlay is beneath it, it remains open.

---

## Test B: Ctrl+Shift+M — toggle Sounds panel

1. Press **Ctrl+Shift+M**.

**Expected:** The Sounds panel opens.

2. Press **Ctrl+Shift+M** again.

**Expected:** The Sounds panel closes.

3. With another overlay open (not the Sounds panel), press **Ctrl+Shift+M**.

**Expected:** The shortcut is ignored — the Sounds panel does not open while another overlay is on top.

---

## Test C: Ctrl+S — save project

1. Make a change to the project (add or rename a pad).
2. Press **Ctrl+S**.

**Expected:** Project saves. The unsaved-changes indicator clears.

---

## Test D: Ctrl+Shift+S — Save As

1. Press **Ctrl+Shift+S**.

**Expected:** The Save As dialog opens (or the native folder picker appears for a temporary project).

---

## Test E: Mod+E — toggle edit mode

1. Press **Ctrl+E** (Cmd+E on Mac).

**Expected:** Edit mode activates — pads show edit controls (edit, duplicate, delete buttons).

2. Press **Ctrl+E** again.

**Expected:** Edit mode deactivates — pads return to normal trigger state.

---

## Test F: Mod+Shift+N — open pad config drawer

1. With a project open and an active scene containing pads, press **Ctrl+Shift+N**.

**Expected:** The pad config drawer opens (in create mode, ready to add a new pad to the active scene).

---

## Test G: Number keys 1–9 — jump to scene by index

1. Load a project with 3+ scenes.
2. Press **2**.

**Expected:** Scene 2 becomes active immediately.

3. Press **1**.

**Expected:** Scene 1 becomes active.

---

## Test H: Arrow keys — navigate between scenes

1. Load a project with 3+ scenes. Active scene is Scene 1.
2. Press the **Right arrow**.

**Expected:** Scene 2 becomes active.

3. Press the **Left arrow**.

**Expected:** Scene 1 becomes active.

4. From the last scene, press **Right arrow**.

**Expected:** Wraps around to Scene 1.

---

## Test I: Enter / Escape / F / X in Synchronized Fades mode

*(See also test doc 11 — Fade and Synchronized Fades)*

1. Enter multi-fade mode (click Synchronized Fades on a pad popover).
2. Select one or more pads, then press **Enter**.

**Expected:** Multi-fade executes on all selected pads.

3. Enter multi-fade mode again. Select pads, then press **F** or **X**.

**Expected:** Multi-fade executes (same as Enter).

4. Enter multi-fade mode again. Press **Escape** without executing.

**Expected:** Multi-fade cancels with no pads faded. The hamburger menu drawer does NOT open.

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

# Manual Test: Pad control popover

**Feature area:** `src/components/composite/SceneView/PadControlContent.tsx`, `src/components/composite/SceneView/PadButton.tsx`  
**Risk area:** Any change to `PadControlContent`, `LayerRow`, pad popover open/close logic, or `usePadGesture`

---

## Background

Clicking a pad (short press) opens its control popover. The popover shows the pad name, quick action buttons (edit, duplicate, delete), a Start/Stop toggle, per-layer controls (play, skip back/forward, sound list), fade controls, and the Synchronized Fades entry point.

---

## Test A: Popover opens on click; Start/Stop

1. Click any pad — its control popover opens.
2. Click **Start** (or **Stop** if already playing).

**Expected:**
- Popover opens on click.
- Clicking **Start** triggers the pad — audio plays, button changes to **Stop**.
- Clicking **Stop** stops the pad — audio stops, button changes to **Start**.

---

## Test B: Duplicate pad

1. Open a pad's popover.
2. Click the **Duplicate** icon button.

**Expected:**
- A new pad appears in the scene immediately, identical to the original (same name, layers, sounds).
- The popover closes.

---

## Test C: Delete pad from popover

1. Open a pad's popover.
2. Click the **Delete** icon button.
3. Confirm deletion in the confirmation prompt.

**Expected:**
- The pad is removed from the scene.
- If it was playing, audio stops immediately on confirmation.

---

## Test D: Per-layer play buttons

1. Open a pad's popover that has **2+ layers**.
2. Click the **Play** button next to Layer 1 only.

**Expected:**
- Only Layer 1 starts playing; Layer 2 does not.
- Clicking **Play** on Layer 2 independently starts Layer 2.
- Each layer can be running independently of the others.

---

## Test E: Skip back / Skip forward (sequential layers)

1. Open a pad popover with a **Sequential** layer that has 3+ sounds.
2. Trigger the layer (Start or Play Layer button).
3. While Sound A is playing, click **Skip Forward**.

**Expected:** Playback advances to Sound B immediately.

4. Click **Skip Back**.

**Expected:** Playback returns to Sound A (or the previous sound in the sequence).

---

## Test F: Show sound list

1. Open a pad popover with a layer that has multiple sounds assigned.
2. Click **Show sound list**.

**Expected:**
- A list of the sounds in the layer is shown.
- Clicking a sound in the list jumps playback to that sound directly.

---

## Test G: Edit button opens config drawer

1. Open a pad's popover.
2. Click the **Edit** (pencil) icon button.

**Expected:**
- The popover closes.
- The pad config drawer opens for that pad.

---

## Test H: Popover closes on overlay open

1. Open a pad's popover.
2. Open another overlay (e.g., Settings dialog via Ctrl+Shift+M or Settings button).

**Expected:** The pad popover closes automatically.

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

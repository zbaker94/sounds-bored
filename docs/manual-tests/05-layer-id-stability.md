# Manual Test: Layer ID stability after delete/reorder

**Issue:** #5 — Layer IDs use positional mapping; deleting or reordering shifts IDs onto wrong voices  
**File changed:** `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx` (useFieldArray with embedded `id`)  
**Risk area:** Any change to `PadConfigDrawer` layer array handling or `useFieldArray` integration

---

## Background

This is hard to observe directly in the UI — the symptom is stale retrigger behavior or phantom "active" indicators after deleting a layer while audio is playing. The main test here is verifying correct save behavior after layer deletion.

---

## Setup

1. Create a pad with **3 layers**, each with a different sound assigned. Name the pad "ID Test".
2. Save the pad. Note the layer order: Layer 1, Layer 2, Layer 3.

## Steps — Delete middle layer, verify remaining

1. Open the pad config drawer.
2. Delete **Layer 2** (the middle layer) using the Remove Layer button.
3. Click **Save**.
4. Re-open the config drawer.

## Expected Result

- The pad now has 2 layers: what was Layer 1 and what was Layer 3.
- **Layer 3's sounds are preserved correctly** — it should have the sounds that were on the original Layer 3, not Layer 2's sounds.
- Triggering the pad plays the correct two sets of sounds.

## Failure Indicators

- Layer 3's sounds appear as Layer 2's sounds (ID shifted down to Layer 2's position).
- After triggering the pad, one layer plays unexpected sounds.

---

## Steps — Delete first layer, verify remaining

1. Open config, delete **Layer 1**.
2. Save and re-open.

**Expected:** Only the original Layer 2 and Layer 3 remain with their respective sounds intact.

---

## Steps — Trigger while deleting layer in drawer

1. Open config on a **playing loop pad** with 2 layers (Layer A looping, Layer B one-shot).
2. In the drawer, delete Layer A.
3. Save.

**Expected:** The pad continues running but now only Layer B is active. On next trigger, only Layer B fires. No phantom voices from the deleted Layer A resurface.

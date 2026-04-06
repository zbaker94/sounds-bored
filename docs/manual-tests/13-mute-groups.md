# Manual Test: Mute groups (exclusive and directional)

**Feature area:** `src/lib/audio/padPlayer.ts` — `muteGroupId` (exclusive) and `muteTargetPadIds` (directional)  
**Risk area:** Any change to `triggerPad`, `stopPad`, mute group resolution, or pad config mute fields

---

## Background

Two muting systems exist:
- **Exclusive mute** (`muteGroupId`): pads sharing the same group ID stop each other on trigger — like hi-hat open/closed. Only one can play at a time.
- **Directional mute** (`muteTargetPadIds`): triggering pad A explicitly stops a specific list of other pads. One-way relationship.

---

## Test A: Exclusive mute (hi-hat style)

**Setup:**
1. Create two pads: "Open Hi-hat" and "Closed Hi-hat".
2. In the config for each, set **Mute Group** to the same group name (e.g., `hihat`).
3. Assign a looping or long sound to each.

**Steps:**
1. Click **Open Hi-hat** — it starts playing.
2. Click **Closed Hi-hat** — it starts playing.

**Expected:**
- When Closed Hi-hat triggers, Open Hi-hat stops immediately (or with a short fade).
- Only Closed Hi-hat is now playing.

3. Click **Open Hi-hat** again.

**Expected:** Closed Hi-hat stops. Open Hi-hat plays.

---

## Test B: Exclusive mute — three pads in the same group

**Setup:** Three pads, all with the same `muteGroupId`, each with a different looping sound.

1. Click Pad 1 — playing.
2. Click Pad 2 — Pad 1 stops, Pad 2 plays.
3. Click Pad 3 — Pad 2 stops, Pad 3 plays.

**Expected:** Only the most recently triggered pad in the group plays at any time.

---

## Test C: Directional mute

**Setup:**
1. Create two pads: "Stinger" and "Ambience".
2. On **Stinger**, set **Mute Targets** to include **Ambience** (directional mute).
3. Do **not** set mute targets on Ambience.
4. Give each a long looping sound.

**Steps:**
1. Click **Ambience** — it loops.
2. Click **Stinger** — it triggers.

**Expected:**
- Ambience stops immediately when Stinger triggers.
- Stinger continues playing.

3. Click **Ambience** again — it plays.
4. Click **Ambience** a second time — it retrigers (based on retrigger mode).

**Expected:** Stinger is **not** affected when Ambience is triggered (directional mute is one-way).

---

## Test D: Exclusive mute does not affect pads outside the group

**Setup:** Three pads — Pad A and Pad B share a mute group; Pad C has no mute group.

1. Click Pad C — it plays.
2. Click Pad A — it plays.
3. Click Pad B — Pad A stops; Pad C should continue playing.

**Expected:** Pad C is unaffected by the mute group interaction between A and B.

---

## Test E: Mute group with fade enabled

**Setup:** Two pads in the same mute group. Global fade duration set to 1 second.

1. Click Pad 1 — playing.
2. Click Pad 2.

**Expected:** Pad 1 fades out over ~1 second while Pad 2 starts immediately at full volume. (Behavior depends on whether mute uses the fade duration or an instant stop — verify this matches the configured setting.)

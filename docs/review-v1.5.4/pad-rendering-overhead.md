# Group: Unnecessary Rendering Overhead in Pad Components

## Relationship

All three findings are cases where pad components perform expensive work unconditionally — even for pads that are not in the relevant state. PERF-3 mounts `PadBackFace` (and its RAF store subscriptions) for every pad regardless of whether the back face is visible. PERF-4 runs a Framer Motion opacity-loop animation and allocates springs on every visible pad. PERF-7 is the same spring allocation issue noted in the Low table — `useSpring` + `useTransform` run even when `tiltEnabled` is false. All three are fixed by gating expensive setup behind the condition that actually requires it.

---

## Findings

---

**[PERF-3] Hidden PadBackFace RAF subscriptions on every visible pad**
`src/components/composite/SceneView/PadBackFace.tsx:71–73`

`PadButton` mounts `PadBackFace` unconditionally inside the flip container. Each `BackFaceLayerRow` subscribes to `layerVolumes` and `activeLayerIds` — both written by the RAF tick on every frame during playback. Every non-visible back face (for all pads not in edit mode) pays these RAF subscription costs even though they render nothing to screen.

**Fix:** Gate the `PadBackFace` mount or its store subscriptions behind `editingPadId === pad.id` so non-editing pads never subscribe to tick-churned fields.

---

**[PERF-4] Unconditional AnimatePresence + continuous spring machinery on all visible pads**
`src/components/composite/SceneView/PadButton.tsx:223–232, 307–312`

Every visible pad runs a Motion `animate={{ opacity: [0.3, 0.8, 0.3] }}` pulse-ring loop while playing, plus `useSpring`/`useTransform` for tilt — allocated unconditionally even when `tiltEnabled` is false (line 215 clamps the displayed value to 0 but the spring still runs). 12 pads on screen = 12 opacity keyframe loops + 24 RAF-driven springs running in parallel.

**Fix:** Conditionally mount the tilt child component (only when `tiltEnabled`) and cancel `handleMouseMove` writes when not tilt-enabled. Replace the Motion opacity keyframe loop with a CSS `@keyframes` class for zero-JS-overhead animation.

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| PERF-7 | Performance | `PadButton.tsx:127–128` | `useSpring` + `useTransform` allocated unconditionally even when `tiltEnabled` is false |

> **Audit note (2026-04-23):** PERF-3 confirmed valid — `BackFaceLayerRow` subscribes to `layerVolumes` and `activeLayerIds` (both RAF-churned) at mount, and `PadButton` mounts `PadBackFace` for every pad. PERF-4 and PERF-7 not inspected in this pass (PadButton.tsx lines 127–128 and 223–232 not read). Findings are plausible given the pattern. Deferred — all three require testing visual/animation parity after the fix.

# Group: activeSceneId Invariant and Cross-Store Coupling

## Relationship

Both findings concern the same invariant: `activeSceneId` must always reference a scene that exists in `project.scenes`. ARCH-1 describes how `projectStore` now imports and calls `uiStore.setActiveSceneId` directly, breaking store independence and creating non-atomic state transitions. ARCH-4 is the direct consequence: now that `setActiveSceneId` is an unchecked setter and the guard was removed, the invariant is no longer enforced anywhere. Fixing ARCH-1 (by keeping `activeSceneId` in `projectStore` or re-adding the scene-existence guard) also resolves ARCH-4.

---

## Findings

---

**[ARCH-1] Cross-store import introduces hidden coupling and non-atomic state transitions**
`src/state/projectStore.ts:10–16`

`projectStore` now imports and calls `useUiStore.getState().setActiveSceneId(...)` from `loadProject`, `clearProject`, `addScene`, and `deleteScene`. This breaks store independence: Immer's `set` publishes the project mutation, then a second Zustand `set` fires on `uiStore` — subscribers can observe intermediate inconsistent state (new/cleared scenes, stale `activeSceneId`). The membership check that previously validated `activeSceneId` against `project.scenes` was removed; `setActiveSceneId` is now an unchecked setter.

**Fix:** (a) Keep `activeSceneId` in `projectStore` so scene transitions are atomic, or (b) re-add the scene-existence guard to `setActiveSceneId`, or (c) create a dedicated orchestration helper (e.g., `src/lib/sceneActions.ts`) that owns both calls so the coupling is explicit and contained.

> **Audit note (2026-04-23):** Both findings confirmed valid. Cross-store calls are at `projectStore.ts:70,97,113,128,142` with a deliberate rationale comment at lines 4–9. `setActiveSceneId` at `uiStore.ts:123` is an unchecked setter, acknowledged at line 29. **Recommended fix: option (b)** — smallest targeted change. Option (a) is a larger migration; option (c) adds a new abstraction layer without closing the invariant gap. ARCH-4 location is corrected: `uiStore.ts:70–80` range refers to `initialUiState`; the actual unchecked setter is at `uiStore.ts:123`.

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| ARCH-4 | Architecture | `src/state/uiStore.ts:123` | `activeSceneId` invariant (must match a real scene) no longer enforced — only by convention |

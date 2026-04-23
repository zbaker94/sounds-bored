| QUAL-11 | Quality | `useAutoSave.ts:101` | `saveProjectMutation.mutate` called from a stale closure while `isPending` is read via ref — inconsistent ref/closure split |

> **Audit note (2026-04-23):** **False positive.** TanStack Query guarantees `mutate` is a stable (ref-stable) function identity across renders — it does not change between effect runs and does not need to be listed in the dependency array. `isPending` is correctly read via `isProjectSavePendingRef` which is updated on every render (line 41). The ref/closure split is intentional and correct. No fix needed.

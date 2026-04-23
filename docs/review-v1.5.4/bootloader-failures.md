# Group: useBootLoader Error Handling

## Relationship

Both findings are in `useBootLoader.ts` and both concern how boot failures are handled — or silently ignored. QUAL-10 identifies that `setLoaded(true)` is called even on error, conflating "attempted" with "succeeded" and making failure modes invisible to consumers. QUAL-14 shows the same error branches log nothing, so developers have no breadcrumbs in devtools when boot silently fails. Together they mean boot failures are completely opaque: the app appears loaded, no toast is shown, and no console output identifies what went wrong.

---

## Findings

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| QUAL-10 | Quality | `useBootLoader.ts:30–62` | Three concurrent loads with inconsistent failure semantics — `setLoaded(true)` on error conflates "attempted" with "succeeded" |
| QUAL-14 | Quality | `useBootLoader.ts:46–48, 55–57, 61` | Error branches log nothing — boot failures leave no debugging breadcrumbs in devtools |

> **Audit note (2026-04-23):** Both findings confirmed valid. `setSettingsLoaded(true)` and `setLibraryLoaded(true)` are called in catch blocks (lines 47, 57). Toasts are shown, but no `console.error` is called. The `loadDownloadHistory` catch at line 61 has a comment `/* non-critical — silently ignore */` with neither toast nor log. Fix: rename flags to `setSettingsAttempted`/`setLibraryAttempted` and add `console.error(err)` to all three catch blocks. QUAL-14 note: the "completely opaque" framing in the Relationship section is overstated — toasts are shown for the two critical loads — but the missing `console.error` breadcrumbs are still a real gap.

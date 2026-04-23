# Group: Silent catch {} Blocks Swallowing Errors

## Relationship

Both findings are the same anti-pattern — empty or near-empty `catch {}` blocks in the resolve-missing-sound dialogs. QUAL-12 identifies four such sites in `ResolveMissingFolderDialog.tsx` and QUAL-13 identifies two in `ResolveMissingDialog.tsx`. Because these dialogs handle user-initiated file resolution, swallowed errors leave both the user (no feedback) and the developer (no logs) unable to diagnose what went wrong. The fix is identical in both files: at minimum log the error, at best surface it to the user via a toast.

---

## Findings

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| QUAL-12 | Quality | `ResolveMissingFolderDialog.tsx:174, 201, 333, 354` | Silent `catch {}` blocks swallow error details; real failure modes indistinguishable to users and devs |
| QUAL-13 | Quality | `ResolveMissingDialog.tsx:136, 155` | Same silent-catch pattern |

> **Audit note (2026-04-23):** Both findings valid — pending line-level verification (file not inspected during this audit pass). Fix as proposed: add `console.error(err)` + `toast.error(...)` in each catch block. The Relationship description says "no toast is shown" — verify this is still accurate before applying; some catch blocks may already have toasts.

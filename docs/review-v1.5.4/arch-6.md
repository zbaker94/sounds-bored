| ARCH-6 | Architecture | `downloadStore.ts:44` | `loadJobs` full-replace can silently clobber sidecar events that arrived during boot window |

> **Audit note (2026-04-23):** Line number corrected from `:301` (stale) to `:44` (current `loadJobs` location). Finding is valid — `loadJobs` does a full `Object.fromEntries` replace with no merge. Fix: prefer-existing merge semantics (history entries lose to live sidecar state for the same id).

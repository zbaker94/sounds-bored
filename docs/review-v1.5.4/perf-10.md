| PERF-10 | Performance | `streamingCache.ts:47–52` | `preloadStreamingAudio` fires N synchronous `new Audio()` + `.load()` calls in one `useEffect` tick |

> **Audit note (2026-04-23):** Not inspected in detail during this pass. Finding is plausible — N synchronous `new Audio()` + `.load()` in a single effect tick blocks the main thread. Deferred pending code read.

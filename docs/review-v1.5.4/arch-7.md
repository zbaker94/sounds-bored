| ARCH-7 | Architecture | `audioState.ts:56–57` | `clearAllAudioState` imports and calls external cache modules — breaks the pure-state-container design |

> **Audit note (2026-04-23):** Line number corrected from `:16–17` (comment lines) to `:56–57` (actual imports of `clearAllBuffers` from `bufferCache` and `clearAllStreamingElements`/`clearAllSizeCache` from `streamingCache`). Finding is valid. Fix: move these three clear calls to `MainPage.tsx` (the single caller of `clearAllAudioState`) so `audioState.ts` no longer imports peer cache modules.

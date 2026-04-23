| PERF-8 | Performance | `PadButtonProgress.tsx:33–41` | `layerProgress` selector iterates all layers (not just active) per playing pad per tick |

> **Audit note (2026-04-23):** Not inspected in detail during this pass. Finding is plausible — if the selector maps over all `pad.layers` to extract progress entries, it iterates O(all layers) per pad per RAF tick even for non-active layers. Deferred pending code read.

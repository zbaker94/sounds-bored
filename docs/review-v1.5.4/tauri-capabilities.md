# Group: Tauri Capabilities Misconfiguration

## Relationship

Both findings are overly broad Tauri permission grants that violate the principle of least privilege. SEC-5 grants `mcp-bridge:default` in release builds even though the plugin is only registered in debug mode, meaning the capability is dead weight in production but still listed as an allowed surface. SEC-6 grants recursive directory scope via `grantParentAccess` when file-level grants would suffice. Both are in the capabilities/permissions layer and should be tightened as part of the same audit.

---

## Findings

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| SEC-5 | Security | `capabilities/default.json:50` | `mcp-bridge:default` granted in release builds; plugin only registered in debug |
| SEC-6 | Security | `src/lib/scope.ts:48–52` | `grantParentAccess` grants recursive directory scope — should be file-level grants |

> **Audit note (2026-04-23):**
> - **SEC-5 is valid and actionable.** `mcp-bridge:default` appears on line 50 of `default.json` in the shared capability. Removing it from the default capability (or gating it to a debug-only capability file) is the correct fix.
> - **SEC-6 is advisory/intentional.** `grantParentAccess` grants the parent directory rather than individual files because the audio file picker is used for sounds that share a folder — file-level grants would require re-granting on every pick from the same directory. The path validation in `isRootPath` already prevents root-level grants. Changing to file-level grants would require a different UX flow (one grant per file) which is not currently warranted.

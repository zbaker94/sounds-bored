# Settings Dialog — Design Spec

**Date:** 2026-04-02  
**Status:** Approved  
**Scope:** Folder management settings accessible from StartScreen and MainPage MenuDrawer

---

## Overview

A settings dialog, accessible from both the StartScreen and the project-view MenuDrawer, for managing app-level configuration. Initial scope: global folder management (download folder, import folder). Tab structure is established now so the Audio tab can be added later without restructuring.

---

## What Is Out of Scope

- **Audio output device selection** is deferred. `setSinkId()` on `AudioContext` is Chromium/WebView2-only and will not work on macOS (WKWebView) or Linux (WebKitGTK). Full cross-platform support requires a Rust-side audio engine using `cpal`. See `memory/project_audio_device_xplatform.md`.

---

## Architecture

### Overlay Registration

Add `SETTINGS_DIALOG: "settings-dialog"` to `OVERLAY_ID` in `src/state/uiStore.ts`.

### Component

**`src/components/modals/SettingsDialog.tsx`**

- Uses shadcn `Dialog` + `Tabs`
- Opened/closed via `uiStore.openOverlay` / `uiStore.closeOverlay` with `OVERLAY_ID.SETTINGS_DIALOG`
- Single tab: **Folders** (tab structure preserved for future Audio tab)
- No explicit Save button — each mutation persists immediately to disk

### Trigger Points

1. **`StartScreen`** — gear icon button added to the screen. Exact visual placement is up to the implementer; logical behavior is `openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog")`.
2. **`MenuDrawer`** — new "Settings" menu item with a settings icon, inserted above the separator before "Return to Main Menu".

---

## Folders Tab

### Display

List all entries in `appSettingsStore.settings.globalFolders`. Each row shows:
- Display name (editable inline)
- Full path (read-only, truncated if long)
- Role select dropdown: **Download**, **Import**, or **None**
- Remove button (trash icon)

### Add Folder

- Button triggers Tauri `open({ directory: true })` file picker
- On confirm: `appSettingsStore.addGlobalFolder({ id: crypto.randomUUID(), path, name: basename(path) })` then save

### Remove Folder

- Remove button is **disabled** when the folder is the current `downloadFolderId` or `importFolderId`
- The store already throws on attempted removal of an assigned folder — the UI prevents reaching that state

### Change Role (Download / Import)

- Changing a folder's role to Download calls `appSettingsStore.setDownloadFolder(folderId)` then save
- Changing a folder's role to Import calls `appSettingsStore.setImportFolder(folderId)` then save
- Each folder can hold at most one role; selecting a role for folder A automatically removes it from folder B (enforced by the store setting the new ID)

### Rename Folder

- Clicking the display name makes it an editable text input
- On blur or Enter: `appSettingsStore.updateSettings(draft => { folder.name = newName })` then save
- On Escape: revert to original name, no save

---

## Persistence Flow

Every mutation follows this pattern:

```
UI action
  → appSettingsStore action (optimistic, updates Zustand state)
  → useSaveAppSettings().mutate(useAppSettingsStore.getState().settings)
  → saveAppSettings() writes to disk
  → queryClient.invalidateQueries(["appSettings"])
```

`useSaveAppSettings` already exists in `src/lib/appSettings.queries.ts`.

---

## Files Changed / Created

| File | Change |
|------|--------|
| `src/state/uiStore.ts` | Add `SETTINGS_DIALOG` to `OVERLAY_ID` |
| `src/components/modals/SettingsDialog.tsx` | New component |
| `src/components/screens/start/StartScreen.tsx` | Add gear icon button |
| `src/components/composite/SceneTabBar/MenuDrawer.tsx` | Add Settings menu item |

No schema changes required. `AppSettings` already contains `globalFolders`, `downloadFolderId`, and `importFolderId`.

---

## Future: Audio Tab

When the Rust audio engine (`cpal`) is ready:

1. Add `outputDeviceId: z.string().default("")` to `AppSettingsSchema`
2. Add an Audio tab to `SettingsDialog` with a device selector
3. Enumerate devices via a Tauri command backed by `cpal`
4. Apply selection immediately; `""` = OS default fallback
5. On startup, validate stored `outputDeviceId` against available devices; fall back to `""` if not found

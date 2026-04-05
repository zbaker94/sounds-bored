# SoundsBored — User Guide

SoundsBored is a desktop soundboard for Windows. You set up scenes with trigger pads, assign sounds to those pads, and fire them on demand. It's free.

---

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [The Main Editor](#the-main-editor)
- [Managing Scenes](#managing-scenes)
- [Managing Pads](#managing-pads)
- [Configuring a Pad](#configuring-a-pad)
- [The Sound Library](#the-sound-library)
- [Fade and Crossfade](#fade-and-crossfade)
- [Saving Your Project](#saving-your-project)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

---

## Installation

Download the installer from the releases page and run it. No additional software needs to be installed separately — everything the app needs is bundled.

---

## Getting Started

When you open the app you'll see the start screen.

![Start screen with Create New Project, Load Project buttons, and a recent projects list](screenshots/start-screen.png)
<!-- screenshot: start screen — logo at top, two buttons (Create New Project, Load Project), recent projects list below -->

- **Create New Project** — starts a fresh project. The app creates a folder for it in a temporary location; you can move it properly later via Save As.
- **Load Project** — opens a folder picker to load an existing project from disk.
- **Recent Projects** — lists previously opened projects with a timestamp. Click **Load** to reopen one, or the folder icon to open its location in Explorer.

The gear icon in the top-right corner opens Settings.

---

## The Main Editor

Once a project is open, you'll see the main editor.

![Main editor with scene tabs at top, pad grid in the center, and yellow sidebar on the right](screenshots/main-editor.png)
<!-- screenshot: main editor overview — scene tab bar at top, pad grid filling center, narrow yellow sidebar on right -->

The layout has three areas:

- **Scene tab bar** (top) — switch between scenes, add new ones, access the menu
- **Pad grid** (center) — your pads; click one to trigger it
- **Sidebar** (right, yellow) — buttons for the sound library and edit mode toggle

---

## Managing Scenes

Scenes are like pages of pads. Each scene is independent — you might have one scene for music beds, another for sound effects, another for stingers.

![Scene tabs with add button and hamburger menu](screenshots/scene-tabs.png)
<!-- screenshot: scene tab bar — tabs labeled "Scene 1", "Scene 2", + button on right, hamburger menu on left -->

- Click the **+** button (or press **Ctrl+N**) to add a new scene.
- Click a scene tab to switch to it.
- **Hover** over a tab to reveal rename (pencil) and delete (X) buttons.
- In **Edit Mode** (Ctrl+E), those controls are always visible and you can drag tabs to reorder scenes.
- Press **1–9** to jump directly to a scene by position.
- Press **Left/Right arrow keys** to step through scenes in order.

To rename a scene, click the pencil icon on the tab, type a new name, and press Enter (or click the checkmark). Press Escape to cancel.

---

## Managing Pads

Pads fill the grid in the active scene. Clicking a pad triggers it — it plays whatever sounds are assigned to it.

![Pad grid with several colored pads and an add pad button in the corner](screenshots/pad-grid.png)
<!-- screenshot: pad grid — 8–10 pads of varying colors, dashed + button at the end of the grid -->

- Click the **dashed + button** at the end of the grid to add a new pad.
- Each scene can hold more than 12 pads — they paginate. Use the arrows at the bottom of the grid (or **Shift+Left/Right**) to move between pages.
- In **Edit Mode**, you can drag pads to rearrange them.

### Edit Mode

Toggle Edit Mode with **Ctrl+E** or the pencil icon in the sidebar. In this mode:

- Clicking a pad opens its configuration instead of triggering it
- Pads can be dragged to reorder
- Scene tabs become draggable for reordering
- Rename/delete controls on scene tabs are always visible
- The Fade/Crossfade toolbar is hidden

When you're done rearranging, press **Ctrl+E** again to leave Edit Mode.

---

## Configuring a Pad

In Edit Mode, click a pad to open the pad configuration drawer. You can also press **Ctrl+Shift+N** to add a new pad.

![Pad config drawer with name field, layer accordion, and fade duration slider](screenshots/pad-config.png)
<!-- screenshot: pad config drawer open — pad name field at top, collapsible layer section below, fade duration slider at bottom, Cancel/Save buttons -->

### Pad Name

The name shown on the pad button. Keep it short.

### Layers

Each pad can have one or more layers. All layers in a pad fire simultaneously when the pad is triggered. Add layers when you want multiple sounds to play at once from a single pad trigger.

Click a layer in the accordion to expand its settings.

![Layer config expanded showing Sound Selection, Arrangement, Playback Mode, Retrigger Mode, Volume](screenshots/layer-config.png)
<!-- screenshot: layer accordion expanded — tabs for Assigned/Tag/Set, Arrangement row, Playback Mode row, Retrigger Mode row, Volume slider -->

#### Sound Selection

Controls which sound(s) this layer plays. Three modes:

| Mode | What it does |
|------|-------------|
| **Assigned** | Plays specific sounds you pick directly from your library |
| **Tag** | Picks from any sounds that have a given tag |
| **Set** | Picks from sounds in a named set |

Tag and Set modes are useful when you want a pad to draw from a pool of sounds rather than always playing the same one.

#### Arrangement

When a layer has multiple sounds to choose from (via Tag or Set, or multiple assigned sounds), this controls how they're played:

| Mode | What it does |
|------|-------------|
| **Simultaneous** | All sounds play at once |
| **Sequential** | Plays through them in order, one per trigger |
| **Shuffled** | Picks randomly each trigger |

#### Playback Mode

| Mode | What it does |
|------|-------------|
| **One-shot** | Plays through once and stops |
| **Hold** | Plays only while the pad is held down |
| **Loop** | Loops until you trigger the pad again or stop it |

#### Retrigger Mode

What happens when the pad is triggered while it's already playing:

| Mode | What it does | Available when |
|------|-------------|----------------|
| **Restart** | Stops and starts from the beginning | Always |
| **Continue** | Keeps playing, starts another instance | Always |
| **Stop** | Stops playback | Always |
| **Next** | Advances to the next sound in the sequence | Sequential or Shuffled only |

#### Volume

Per-layer volume from 0–100%. Independent of your system volume.

### Fade Duration

How long the fade in/out lasts for this pad when using the Fade or Crossfade feature. Leave it at the default to use the global setting (configurable in Settings), or drag the slider to set a per-pad override.

---

## The Sound Library

The sound library is global — it's shared across all your projects. Open it with the folder-music icon in the sidebar, or press **Ctrl+Shift+M**.

![Sounds panel with sets/folders on the left and sound list on the right](screenshots/sounds-panel.png)
<!-- screenshot: sounds panel — left side has "Sets" panel on top and "Folders" panel below; right side shows list of sounds with checkboxes and play buttons; Import Sounds and Download from URL buttons at top -->

### Adding Sounds

**Import from files** — click **Import Sounds** to open a file picker. Supported formats: `.wav`, `.mp3`, `.ogg`, `.flac`, `.aiff`, `.m4a`.

**Drag and drop** — drag audio files from Explorer onto the Sounds panel. They'll be imported automatically.

**Download from URL** — click **Download from URL** and paste a link. The app downloads the audio using yt-dlp. Downloads appear in the sound list while in progress and complete to a local file.

### Folders

The bottom-left panel lists your linked folders. Any audio files inside a linked folder are automatically included in your library.

Click **Add Folder** to link a folder on your computer. All supported audio files inside it are scanned and added.

### Sets

Sets are named groups you create manually. They're useful for organizing sounds and for the **Set** selection mode in pad layers.

Click **Add Set** to create one. Select sounds on the right side (check their checkboxes), then click **Add to Set**. You can also **Duplicate Set** to copy and modify an existing set.

### Tags

Tags are labels you apply to sounds. They're most useful with the **Tag** selection mode — a layer set to a tag draws from all sounds with that tag.

Select sounds, then click **Manage Tags** to apply or remove tags.

### Previewing Sounds

Each sound in the right panel has a play/stop button. Click it to preview the sound without triggering any pads.

### Missing Files

If a sound's file can't be found (e.g. the file was moved or renamed), it shows a warning icon. Click the warning to locate the file at its new path. The banner at the top of the list lets you review missing items one by one or remove them all at once.

---

## Fade and Crossfade

The Fade and Crossfade buttons appear in the toolbar above the pad grid. They're hidden in Edit Mode.

![Fade toolbar with Fade and Crossfade buttons and a status label](screenshots/fade-toolbar.png)
<!-- screenshot: toolbar above pad grid — "Fade" button on left with F kbd hint, "Crossfade" button next to it with X kbd hint, status text to the right showing "Select a pad" -->

### Fade (F)

Press **F** or click **Fade** to enter Fade mode. The status label shows "Select a pad."

- Click a **playing** pad to fade it **out** over its configured fade duration.
- Click a **stopped** pad to fade it **in**.

Fade mode exits automatically after you select a pad. Press **F** or **Escape** to cancel without selecting.

### Crossfade (X)

Press **X** or click **Crossfade** to enter Crossfade mode. Crossfade requires at least one pad to currently be playing — the button is grayed out otherwise.

1. Click a playing pad to mark it to **fade out** (shown with an indicator).
2. Click a stopped pad to mark it to **fade in**.
3. Once you've selected at least one of each, the status label shows "Ready." Press **X** or **Enter** to execute.

You can select multiple pads before executing. Press **Escape** to cancel.

---

## Saving Your Project

- **Ctrl+S** — saves the project to its current location. If the project hasn't been saved to a permanent location yet, this prompts you to pick one (Save As).
- **Ctrl+Shift+S** (or Menu → Save As) — saves to a new location.

The hamburger menu in the top-left of the scene tab bar has Save, Save As, and Export options. It also has "Return to Main Menu" to go back to the start screen.

New projects start in a temporary folder until you do a Save As. The app will warn you about unsaved changes when closing.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+S** | Save |
| **Ctrl+Shift+S** | Save As |
| **Ctrl+E** | Toggle Edit Mode |
| **Ctrl+N** | Add new scene |
| **Ctrl+Shift+M** | Toggle sound library |
| **Ctrl+Shift+N** | Add new pad to active scene |
| **1–9** | Jump to scene by position |
| **Left / Right** | Step through scenes |
| **Shift+Left / Shift+Right** | Navigate pad pages |
| **F** | Toggle Fade mode |
| **X** | Toggle Crossfade mode |
| **Enter** | Execute crossfade (when ready) |
| **Escape** | Close top overlay / cancel fade / toggle menu |

---

## Troubleshooting

**A sound shows a warning icon.**
The file has been moved, renamed, or deleted. Click the warning icon to locate it at its new path. If you no longer need it, use "Remove All" in the warning banner to clean up missing entries.

**A folder shows a warning icon.**
The linked folder has moved or been deleted. Click it to point to the new location, or remove it from the library.

**A pad doesn't play anything.**
The pad needs at least one layer with at least one sound assigned. Open the pad in Edit Mode and check the layer's Sound Selection.

**The Crossfade button is grayed out.**
Crossfade requires at least one pad to currently be playing. Start a looping or held pad first.

**My sounds are missing after moving the project folder.**
The sound library stores paths to your linked folders. If you moved a linked folder, open the Sounds panel and re-link it at its new location.

**The app saved my project to a temp folder.**
New projects start in a temporary location. Use **Ctrl+Shift+S** (Save As) to move it somewhere permanent.

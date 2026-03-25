# Sound Selector Search & Folder Tree — Design

**Date:** 2026-03-24
**Status:** Approved
**Phase:** 3 (MainPage UI)

---

## Overview

Enhance `SoundSelector` with a search field and a folder tree for the `assigned` selection type. Search uses Fuse.js for fuzzy matching on sounds and simple substring matching for tags/sets. The folder tree derives its hierarchy from `GlobalFolder.path` values at render time using `Collapsible` nodes.

---

## Scope

### In MVP

- Search input at the top of `SoundSelector` for all three modes (assigned / tag / set)
- Assigned mode: fuzzy search via Fuse.js over sound names; flat results while query is active
- Tag / set modes: case-insensitive substring filter
- Assigned mode (no query): `SoundFolderTree` replaces the flat sound list
- Folder tree derived from `appSettingsStore.settings.globalFolders` paths
- Folder node checkbox selects / deselects all sounds in that subtree recursively
- Individual sound leaf checkboxes
- Folders start collapsed
- Sounds with no `folderId` appear at root level
- Empty search results: show "No results." message

### Deferred

- Virtualized tree for very large libraries
- Folder-level volume override
- Highlighting matched characters in search results

---

## Dependencies

- `fuse.js` — new; install with `npm install fuse.js`
- shadcn `collapsible` component — add with `npx shadcn@latest add collapsible`

---

## Data Flow

### Tree derivation

`SoundFolderTree` reads folders from `useAppSettingsStore((s) => s.settings?.globalFolders ?? [])` and receives sounds as a prop. Tree hierarchy is inferred from folder paths: folder B is a child of folder A when `B.path` starts with `A.path + "/"` and no other registered folder sits between them (i.e., B's parent is the folder with the longest matching path prefix).

**Path normalization:** All `GlobalFolder.path` values must be normalized to forward slashes before comparison, since Windows may store backslash-separated paths:

```ts
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}
```

This normalization is applied inside `SoundFolderTree` before any prefix comparison. No changes are made to persisted data.

A `TreeNode` is the internal representation:

```ts
type TreeNode =
  | { kind: "folder"; folder: GlobalFolder; children: TreeNode[] }
  | { kind: "sound"; sound: Sound }
```

Root nodes are: top-level folders (no registered parent) + sounds whose `folderId` is `undefined` or references an unknown/unregistered folder.

### Selection state

`SoundFolderTree` receives `selectedIds: Set<string>` and `onToggleSound` / `onToggleFolder` callbacks from `SoundSelector`. It does not own selection state.

- `onToggleSound(soundId: string)` — called when a sound leaf checkbox is toggled. `SoundSelector` is responsible for adding or removing the `SoundInstance`. When adding, the instance is created with: `{ id: crypto.randomUUID(), soundId, volume: 100 }`. When removing, the instance whose `soundId` matches is filtered out.
- `onToggleFolder(folderId: string)` — `SoundFolderTree` derives `soundsInSubtree` internally and calls this callback with only `folderId`. `SoundSelector` receives this and calls `onToggleFolder` on its own internal handler that re-derives the affected sounds from the same `sounds` prop it passed to `SoundFolderTree`. If all sounds in the subtree are already selected, all are deselected; otherwise all are selected (missing instances created with default volume 100).

A folder checkbox renders as:
- **checked** — all sounds in subtree are selected
- **indeterminate** — some but not all are selected
- **unchecked** — none are selected

---

## Component Structure

### Modified: `SoundSelector.tsx`

- Adds a search `<Input>` at the top for all three modes
- `assigned` mode:
  - Search active: renders filtered flat list using Fuse.js (keys: `["name"]`, threshold `0.4`)
  - No query: renders `<SoundFolderTree>`
  - Empty library: existing "No sounds in library yet." message
  - No search results: "No results." message
- `tag` mode: filters `tags` by case-insensitive substring on `tag.name`; "No results." if empty
- `set` mode: filters `sets` by case-insensitive substring on `set.name`; "No results." if empty
- Search query is local state (`useState`) — cleared when selection type tab changes
- `sounds` and `tags` selectors use Zustand `useShallow` to avoid unnecessary Fuse index rebuilds:
  ```ts
  const sounds = useLibraryStore(useShallow((s) => s.sounds));
  const tags = useLibraryStore(useShallow((s) => s.tags));
  ```

### New: `SoundFolderTree.tsx`

```ts
interface SoundFolderTreeProps {
  sounds: Sound[]
  selectedIds: Set<string>
  onToggleSound: (soundId: string) => void
  onToggleFolder: (folderId: string) => void
}
```

- Reads `globalFolders` from `useAppSettingsStore` internally (with `useShallow`)
- Normalizes all paths to forward slashes before tree derivation
- Derives `TreeNode[]` root array via path comparison (memoized with `useMemo` on `[sounds, globalFolders]`)
- Renders each root node via `TreeNodeRow` (recursive, defined in same file)

### Internal: `TreeNodeRow` (in same file as `SoundFolderTree`)

Recursive renderer for a single `TreeNode`:

- **Folder node**: shadcn `Collapsible` — trigger row has expand/collapse chevron icon + folder name + checkbox. Children rendered recursively inside `CollapsibleContent`. Checkbox `indeterminate` state set via `ref` on the `<input>`.
- **Sound node**: checkbox + sound name (same visual style as current flat list rows)

---

## Search Behavior

### Assigned (Fuse.js)

Search covers both sound name and resolved tag names. `Sound.tags` is an array of Tag IDs, so a denormalized search document is built before indexing:

```ts
type SoundSearchDoc = { sound: Sound; tagNames: string[] }

const docs: SoundSearchDoc[] = useMemo(
  () => sounds.map((sound) => ({
    sound,
    tagNames: sound.tags.map((tid) => tags.find((t) => t.id === tid)?.name ?? ""),
  })),
  [sounds, tags]  // both stable via useShallow
)

const fuse = useMemo(
  () => new Fuse(docs, { keys: ["sound.name", "tagNames"], threshold: 0.4 }),
  [docs]
)

const results = query.trim()
  ? fuse.search(query.trim()).map((r) => r.item.sound)
  : []  // only used when query is active; empty array means no results
```

`tags` is read from `useLibraryStore` with `useShallow` alongside `sounds`.

### Tag / Set (substring)

```ts
const filtered = items.filter((item) =>
  item.name.toLowerCase().includes(query.toLowerCase())
)
```

---

## Testing

### `SoundSelector.test.tsx` additions

- Search input is rendered for assigned mode
- Typing a query filters sounds by name (flat list shown, not tree)
- Clearing the query restores the tree view (SoundFolderTree rendered)
- Searching with no matching sounds shows "No results."
- Searching by tag name returns sounds that have that tag
- Tag mode: typing filters tags by substring
- Set mode: typing filters sets by substring

### `SoundFolderTree.test.tsx`

- Renders folder nodes and sound nodes from provided data
- Sounds with no `folderId` appear at root level
- Folder checkbox toggles all sounds in its subtree (select all)
- Folder checkbox toggles all sounds in its subtree (deselect all when all selected)
- Individual sound checkbox calls `onToggleSound`
- Folder checkbox shows indeterminate state when partially selected
- Multi-level nesting: grandchild folders are placed under their parent folder, not at root
- Path normalization: backslash paths are treated identically to forward-slash paths

---

## Out of Scope

- Phase 4: sound import UI (adding sounds to the library)
- Phase 5: audio playback

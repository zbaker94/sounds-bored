# LibraryPickers — Shared Tag and Set Combobox Components

**Date**: 2026-04-18  
**Status**: Approved

## Problem

The tag and set Combobox picker pattern is duplicated across three locations:

- `src/components/composite/SidePanel/AddToSetDialog.tsx` — set picker
- `src/components/modals/DownloadDialog.tsx` — tag picker + set picker (added in #120)

Each copy owns identical logic: input state, `__create__` sentinel handling, empty-input guard, case-insensitive duplicate check, and ~30 lines of Combobox JSX.

`AddTagsDialog` has a more complex partial-tag variant and is **not** part of this extraction.

## Solution

Extract the shared pattern into a new `LibraryPickers/` folder under `src/components/composite/`.

## File Structure

```
src/components/composite/LibraryPickers/
├── LibraryItemPicker.tsx   # generic Combobox — internal, not exported from index
├── TagPicker.tsx           # thin wrapper: wires useLibraryStore tags + ensureTagExists
├── SetPicker.tsx           # thin wrapper: wires useLibraryStore sets + addSet
└── index.ts                # export { TagPicker, SetPicker }
```

## Component Interfaces

### `LibraryItemPicker` (internal)

```typescript
interface LibraryItemPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  items: Array<{ id: string; name: string }>;
  onCreate: (name: string) => { id: string };
  placeholder?: string;
  emptyText?: string;
}
```

Owns internally: `inputValue` state, `useComboboxAnchor()` ref, `__create__` handler with empty-input guard, all Combobox JSX.

`__create__` handler logic:
```typescript
if (newIds.includes("__create__")) {
  if (!trimmedInput) {
    onChange(newIds.filter(id => id !== "__create__"));
    return;
  }
  const created = onCreate(trimmedInput);
  onChange([...newIds.filter(id => id !== "__create__"), created.id]);
  return;
}
onChange(newIds);
```

### `TagPicker` (exported)

```typescript
interface TagPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
}
```

Reads `tags` + `ensureTagExists` from `useLibraryStore`. Filters `isSystem` tags before passing to `LibraryItemPicker`. Defaults: `placeholder="Search or create tags..."`, `emptyText="No tags found."`.

### `SetPicker` (exported)

```typescript
interface SetPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
}
```

Reads `sets` + `addSet` from `useLibraryStore`. Defaults: `placeholder="Search or create sets..."`, `emptyText="No sets found."`.

## Callers After Extraction

### `DownloadDialog`

Removes: ~80 lines of Combobox JSX, `tagInputValue`/`setInputValue` state, `handleTagValueChange`/`handleSetValueChange`, `trimmedTagInput`/`trimmedSetInput`, `canCreateTag`/`canCreateSet`, `tagsAnchorRef`/`setsAnchorRef`, `ensureTagExists`/`addSet` store subscriptions.

Replaces with:
```tsx
<TagPicker value={selectedTagIds} onChange={setSelectedTagIds} />
<SetPicker value={selectedSetIds} onChange={setSelectedSetIds} />
```

`selectedTagIds`/`selectedSetIds` state stays in `DownloadDialog` for reset-on-submit and reset-on-close behavior.

### `AddToSetDialog`

Removes: Combobox import block, `inputValue` state, `handleValueChange`, `trimmedInput`/`canCreate`, `anchorRef`, all Combobox JSX in `content`.

Replaces with:
```tsx
<SetPicker value={selectedSetIds} onChange={setSelectedSetIds} />
```

`selectedSetIds` stays in `AddToSetDialog` for the `handleConfirm` logic.

### `AddTagsDialog`

**Untouched.** The partial-tag variant (dashed chips, tooltips, promotion logic, snapshot ref, diff-based confirm) is too specialized to share.

## Testing

### `LibraryItemPicker.test.tsx`

Core behavior tests (these currently live scattered across `DownloadDialog.test.tsx`):
- Renders items from `items` prop in the dropdown
- Selecting an item adds its id to `onChange` call
- Empty list shows `emptyText`
- Typing a novel name shows `Create "..."` option
- Clicking `Create "..."` calls `onCreate(name)` and includes the returned id in `onChange`
- Typing an empty string does not show `Create "..."` (empty-input guard)
- Typing an existing name (case-insensitive) does not show `Create "..."` (duplicate guard)

### `TagPicker.test.tsx` / `SetPicker.test.tsx`

Lightweight smoke tests:
- Renders without error when library is empty
- Passes `userTags` (non-system only) to the picker for `TagPicker`
- Passes all sets to the picker for `SetPicker`

### Existing tests

`DownloadDialog.test.tsx` and `AddToSetDialog.test.tsx` retain their end-to-end tests — they verify that the pickers are wired correctly in context. The detailed picker tests move to `LibraryItemPicker.test.tsx`.

## Out of Scope

- `AddTagsDialog` partial-tag variant
- Any changes to `AddTagsDialog` behavior or interface

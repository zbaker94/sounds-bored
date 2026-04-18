# LibraryPickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the duplicated tag and set Combobox picker pattern into `TagPicker` and `SetPicker` components backed by a shared generic `LibraryItemPicker`, then update `DownloadDialog` and `AddToSetDialog` to use them.

**Architecture:** `LibraryItemPicker` (internal to the folder) owns all Combobox JSX, input state, and `__create__` sentinel handling. `TagPicker` and `SetPicker` are thin wrappers that wire `useLibraryStore` and pass domain-specific defaults. Callers (`DownloadDialog`, `AddToSetDialog`) retain their own selection state (`string[]`) and pass it down as controlled props.

**Tech Stack:** React 19, TypeScript strict, Zustand (`useLibraryStore`), Base UI Combobox via `@/components/ui/combobox`

---

## File Map

| Action | Path |
|--------|------|
| Create | `src/components/composite/LibraryPickers/LibraryItemPicker.tsx` |
| Create | `src/components/composite/LibraryPickers/LibraryItemPicker.test.tsx` |
| Create | `src/components/composite/LibraryPickers/TagPicker.tsx` |
| Create | `src/components/composite/LibraryPickers/TagPicker.test.tsx` |
| Create | `src/components/composite/LibraryPickers/SetPicker.tsx` |
| Create | `src/components/composite/LibraryPickers/SetPicker.test.tsx` |
| Create | `src/components/composite/LibraryPickers/index.ts` |
| Modify | `src/components/modals/DownloadDialog.tsx` |
| Modify | `src/components/composite/SidePanel/AddToSetDialog.tsx` |

`DownloadDialog.test.tsx` — no changes required; all existing tests remain valid because the rendered DOM (placeholders, options, chips) is identical after the refactor.

---

## Task 1: LibraryItemPicker — generic Combobox component

**Files:**
- Create: `src/components/composite/LibraryPickers/LibraryItemPicker.tsx`
- Create: `src/components/composite/LibraryPickers/LibraryItemPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/composite/LibraryPickers/LibraryItemPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryItemPicker } from "./LibraryItemPicker";

const items = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];

function renderPicker(
  overrides: Partial<Parameters<typeof LibraryItemPicker>[0]> = {},
) {
  const onChange = vi.fn();
  const onCreate = vi.fn().mockReturnValue({ id: "new-1" });
  render(
    <LibraryItemPicker
      value={[]}
      onChange={onChange}
      items={items}
      onCreate={onCreate}
      placeholder="Pick something..."
      emptyText="Nothing here."
      {...overrides}
    />,
  );
  return { onChange, onCreate };
}

describe("LibraryItemPicker", () => {
  it("renders the placeholder in the input", () => {
    renderPicker();
    expect(screen.getByPlaceholderText("Pick something...")).toBeInTheDocument();
  });

  it("shows items in the dropdown when the input is clicked", async () => {
    renderPicker();
    await userEvent.click(screen.getByPlaceholderText("Pick something..."));
    expect(await screen.findByRole("option", { name: /alpha/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /beta/i })).toBeInTheDocument();
  });

  it("shows emptyText when items list is empty", async () => {
    renderPicker({ items: [] });
    await userEvent.click(screen.getByPlaceholderText("Pick something..."));
    expect(await screen.findByText("Nothing here.")).toBeInTheDocument();
  });

  it("renders chips for current value", () => {
    renderPicker({ value: ["a"] });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("shows Create option when typing a novel name", async () => {
    renderPicker();
    const input = screen.getByPlaceholderText("Pick something...");
    await userEvent.click(input);
    await userEvent.type(input, "Gamma");
    expect(await screen.findByRole("option", { name: /create "Gamma"/i })).toBeInTheDocument();
  });

  it("does not show Create option when typing an existing name (case-insensitive)", async () => {
    renderPicker();
    const input = screen.getByPlaceholderText("Pick something...");
    await userEvent.click(input);
    await userEvent.type(input, "alpha");
    // The existing "Alpha" item will appear but no Create option
    expect(await screen.findByRole("option", { name: /alpha/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /create/i })).not.toBeInTheDocument();
  });

  it("does not show Create option when input is empty", async () => {
    renderPicker();
    await userEvent.click(screen.getByPlaceholderText("Pick something..."));
    // Don't type anything — popup opens with empty input
    expect(screen.queryByRole("option", { name: /create/i })).not.toBeInTheDocument();
  });

  it("calls onCreate with the typed name when Create is clicked", async () => {
    const { onCreate } = renderPicker();
    const input = screen.getByPlaceholderText("Pick something...");
    await userEvent.click(input);
    await userEvent.type(input, "Gamma");
    const createItem = await screen.findByRole("option", { name: /create "Gamma"/i });
    await act(async () => { fireEvent.click(createItem); });
    expect(onCreate).toHaveBeenCalledWith("Gamma");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd C:/Repos/sounds-bored && npx vitest run src/components/composite/LibraryPickers/LibraryItemPicker.test.tsx 2>&1
```

Expected: all tests fail with "Cannot find module './LibraryItemPicker'"

- [ ] **Step 3: Create LibraryItemPicker.tsx**

Create `src/components/composite/LibraryPickers/LibraryItemPicker.tsx`:

```tsx
import { useState } from "react";
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxCollection,
  ComboboxEmpty,
  useComboboxAnchor,
} from "@/components/ui/combobox";

interface LibraryItemPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  items: Array<{ id: string; name: string }>;
  onCreate: (name: string) => { id: string };
  placeholder?: string;
  emptyText?: string;
}

export function LibraryItemPicker({
  value,
  onChange,
  items,
  onCreate,
  placeholder = "Search...",
  emptyText = "No items found.",
}: LibraryItemPickerProps) {
  const [inputValue, setInputValue] = useState("");
  const anchorRef = useComboboxAnchor();

  const trimmedInput = inputValue.trim();
  const inputMatchesExisting = items.some(
    (item) => item.name.toLowerCase() === trimmedInput.toLowerCase(),
  );
  const canCreate = trimmedInput.length > 0 && !inputMatchesExisting;

  function handleValueChange(newIds: string[]) {
    if (newIds.includes("__create__")) {
      if (!trimmedInput) {
        onChange(newIds.filter((id) => id !== "__create__"));
        return;
      }
      const created = onCreate(trimmedInput);
      onChange([...newIds.filter((id) => id !== "__create__"), created.id]);
      return;
    }
    onChange(newIds);
  }

  return (
    <Combobox
      value={value}
      onValueChange={handleValueChange}
      onInputValueChange={(val) => setInputValue(val)}
      items={items}
      multiple
    >
      <ComboboxChips ref={anchorRef}>
        {value.map((id) => {
          const item = items.find((i) => i.id === id);
          return item ? <ComboboxChip key={id}>{item.name}</ComboboxChip> : null;
        })}
        <ComboboxChipsInput placeholder={placeholder} />
      </ComboboxChips>
      <ComboboxContent anchor={anchorRef}>
        <ComboboxList>
          <ComboboxEmpty>{emptyText}</ComboboxEmpty>
          <ComboboxCollection>
            {(item) => (
              <ComboboxItem key={item.id} value={item.id}>
                {item.name}
              </ComboboxItem>
            )}
          </ComboboxCollection>
          {canCreate && (
            <ComboboxItem value="__create__">
              Create "{trimmedInput}"
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd C:/Repos/sounds-bored && npx vitest run src/components/composite/LibraryPickers/LibraryItemPicker.test.tsx 2>&1
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/components/composite/LibraryPickers/LibraryItemPicker.tsx src/components/composite/LibraryPickers/LibraryItemPicker.test.tsx && git commit -m "feat: add LibraryItemPicker generic combobox component"
```

---

## Task 2: TagPicker — store-wired tag selector

**Files:**
- Create: `src/components/composite/LibraryPickers/TagPicker.tsx`
- Create: `src/components/composite/LibraryPickers/TagPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/composite/LibraryPickers/TagPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockTag } from "@/test/factories";
import { TagPicker } from "./TagPicker";

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
});

describe("TagPicker", () => {
  it("renders the tags placeholder", () => {
    render(<TagPicker value={[]} onChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText("Search or create tags..."),
    ).toBeInTheDocument();
  });

  it("shows user tags from the library in the dropdown", async () => {
    const tag = createMockTag({ name: "Drums" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [tag] });

    render(<TagPicker value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByPlaceholderText("Search or create tags..."));

    expect(
      await screen.findByRole("option", { name: /drums/i }),
    ).toBeInTheDocument();
  });

  it("excludes system tags from the dropdown", async () => {
    const systemTag = createMockTag({ name: "system-tag", isSystem: true });
    const userTag = createMockTag({ name: "user-tag" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [systemTag, userTag] });

    render(<TagPicker value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByPlaceholderText("Search or create tags..."));

    expect(
      await screen.findByRole("option", { name: /user-tag/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /system-tag/i }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd C:/Repos/sounds-bored && npx vitest run src/components/composite/LibraryPickers/TagPicker.test.tsx 2>&1
```

Expected: all 3 tests fail with "Cannot find module './TagPicker'"

- [ ] **Step 3: Create TagPicker.tsx**

Create `src/components/composite/LibraryPickers/TagPicker.tsx`:

```tsx
import { useMemo } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { LibraryItemPicker } from "./LibraryItemPicker";

interface TagPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

export function TagPicker({ value, onChange }: TagPickerProps) {
  const tags = useLibraryStore((s) => s.tags);
  const ensureTagExists = useLibraryStore((s) => s.ensureTagExists);
  const userTags = useMemo(() => tags.filter((t) => !t.isSystem), [tags]);

  return (
    <LibraryItemPicker
      value={value}
      onChange={onChange}
      items={userTags}
      onCreate={(name) => ensureTagExists(name)}
      placeholder="Search or create tags..."
      emptyText="No tags found."
    />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd C:/Repos/sounds-bored && npx vitest run src/components/composite/LibraryPickers/TagPicker.test.tsx 2>&1
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/components/composite/LibraryPickers/TagPicker.tsx src/components/composite/LibraryPickers/TagPicker.test.tsx && git commit -m "feat: add TagPicker component"
```

---

## Task 3: SetPicker — store-wired set selector

**Files:**
- Create: `src/components/composite/LibraryPickers/SetPicker.tsx`
- Create: `src/components/composite/LibraryPickers/SetPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/composite/LibraryPickers/SetPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockSet } from "@/test/factories";
import { SetPicker } from "./SetPicker";

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
});

describe("SetPicker", () => {
  it("renders the sets placeholder", () => {
    render(<SetPicker value={[]} onChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText("Search or create sets..."),
    ).toBeInTheDocument();
  });

  it("shows sets from the library in the dropdown", async () => {
    const set = createMockSet({ name: "Intro" });
    useLibraryStore.setState({ ...initialLibraryState, sets: [set] });

    render(<SetPicker value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByPlaceholderText("Search or create sets..."));

    expect(
      await screen.findByRole("option", { name: /intro/i }),
    ).toBeInTheDocument();
  });

  it("shows empty state when library has no sets", async () => {
    render(<SetPicker value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByPlaceholderText("Search or create sets..."));
    expect(await screen.findByText("No sets found.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd C:/Repos/sounds-bored && npx vitest run src/components/composite/LibraryPickers/SetPicker.test.tsx 2>&1
```

Expected: all 3 tests fail with "Cannot find module './SetPicker'"

- [ ] **Step 3: Create SetPicker.tsx**

Create `src/components/composite/LibraryPickers/SetPicker.tsx`:

```tsx
import { useLibraryStore } from "@/state/libraryStore";
import { LibraryItemPicker } from "./LibraryItemPicker";

interface SetPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

export function SetPicker({ value, onChange }: SetPickerProps) {
  const sets = useLibraryStore((s) => s.sets);
  const addSet = useLibraryStore((s) => s.addSet);

  return (
    <LibraryItemPicker
      value={value}
      onChange={onChange}
      items={sets}
      onCreate={(name) => addSet(name)}
      placeholder="Search or create sets..."
      emptyText="No sets found."
    />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd C:/Repos/sounds-bored && npx vitest run src/components/composite/LibraryPickers/SetPicker.test.tsx 2>&1
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/components/composite/LibraryPickers/SetPicker.tsx src/components/composite/LibraryPickers/SetPicker.test.tsx && git commit -m "feat: add SetPicker component"
```

---

## Task 4: Barrel export

**Files:**
- Create: `src/components/composite/LibraryPickers/index.ts`

- [ ] **Step 1: Create index.ts**

Create `src/components/composite/LibraryPickers/index.ts`:

```ts
export { TagPicker } from "./TagPicker";
export { SetPicker } from "./SetPicker";
```

- [ ] **Step 2: Verify TypeScript is happy**

```bash
cd C:/Repos/sounds-bored && npx tsc --noEmit 2>&1
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/components/composite/LibraryPickers/index.ts && git commit -m "feat: export TagPicker and SetPicker from LibraryPickers"
```

---

## Task 5: Refactor DownloadDialog

**Files:**
- Modify: `src/components/modals/DownloadDialog.tsx`

No changes to `DownloadDialog.test.tsx` — all existing tests remain valid because the rendered DOM (placeholders, chip text, dropdown options) is identical.

- [ ] **Step 1: Replace DownloadDialog.tsx with the refactored version**

Replace the entire contents of `src/components/modals/DownloadDialog.tsx`:

```tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useStartDownload } from "@/lib/ytdlp.queries";
import { useDownloadStore } from "@/state/downloadStore";
import { useLibraryStore } from "@/state/libraryStore";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { TagPicker, SetPicker } from "@/components/composite/LibraryPickers";

interface DownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DownloadDialog({ open, onOpenChange }: DownloadDialogProps) {
  const [url, setUrl] = useState("");
  const [outputName, setOutputName] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);

  const settings = useAppSettingsStore((s) => s.settings);
  const { mutateAsync: startDownload, isPending } = useStartDownload();

  const downloadFolderId = settings?.downloadFolderId;
  const downloadFolder = settings?.globalFolders.find(
    (f) => f.id === downloadFolderId,
  )?.path;

  function sanitizeName(value: string): string {
    return value.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
  }

  function handleOutputNameChange(value: string) {
    setOutputName(sanitizeName(value));
  }

  function validate(): boolean {
    let valid = true;

    if (!url.trim()) {
      setUrlError("URL is required");
      valid = false;
    } else {
      try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          setUrlError("URL must use http:// or https://");
          valid = false;
        } else {
          setUrlError(null);
        }
      } catch {
        setUrlError("URL must use http:// or https://");
        valid = false;
      }
    }

    if (!outputName) {
      setNameError("Output name is required");
      valid = false;
    } else {
      // Read live store state to avoid stale React render-cycle snapshots.
      // Two rapid submits would both pass if we relied on the subscribed values,
      // because the first job does not appear in the React snapshot until the
      // next render cycle.
      const latestJobs = useDownloadStore.getState().jobs;
      const latestSounds = useLibraryStore.getState().sounds;
      const activeJobWithSameName = Object.values(latestJobs).some(
        (j) =>
          j.outputName === outputName &&
          j.status !== "failed" &&
          j.status !== "cancelled",
      );
      const libraryHasSameName = latestSounds.some(
        (s) => s.folderId === downloadFolderId && s.name === outputName,
      );
      if (activeJobWithSameName) {
        setNameError("A download with this name is already in progress");
        valid = false;
      } else if (libraryHasSameName) {
        setNameError("A file with this name already exists in your downloads folder");
        valid = false;
      } else {
        setNameError(null);
      }
    }

    return valid;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (!downloadFolder) return;

    await startDownload({
      url: url.trim(),
      outputName: outputName,
      downloadFolderPath: downloadFolder,
      jobId: crypto.randomUUID(),
      tags: selectedTagIds,
      sets: selectedSetIds,
    });

    setUrl("");
    setOutputName("");
    setUrlError(null);
    setNameError(null);
    setSelectedTagIds([]);
    setSelectedSetIds([]);
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setUrlError(null);
      setNameError(null);
      setSelectedTagIds([]);
      setSelectedSetIds([]);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download from URL</DialogTitle>
          <DialogDescription>
            Download audio from a URL using yt-dlp. The file will be saved to
            your download folder.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="download-url">URL</Label>
            <Input
              id="download-url"
              placeholder="https://..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (urlError) setUrlError(null);
              }}
            />
            {urlError && (
              <p className="text-xs text-destructive">{urlError}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="download-name">Output Name</Label>
            <Input
              id="download-name"
              placeholder="my-sound"
              value={outputName}
              onChange={(e) => {
                handleOutputNameChange(e.target.value);
                if (nameError) setNameError(null);
              }}
            />
            {nameError ? (
              <p className="text-xs text-destructive">{nameError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Letters, numbers, hyphens, and underscores only. The file extension is added automatically.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              Tags{" "}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <TagPicker value={selectedTagIds} onChange={setSelectedTagIds} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              Sets{" "}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <SetPicker value={selectedSetIds} onChange={setSelectedSetIds} />
          </div>
          {!downloadFolder && (
            <p className="text-xs text-destructive">
              No download folder configured. Set a download folder in Settings
              first.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !downloadFolder}>
              {isPending ? (
                <>
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="animate-spin"
                  />
                  Downloading...
                </>
              ) : (
                "Download"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run the DownloadDialog tests to verify nothing broke**

```bash
cd C:/Repos/sounds-bored && npx vitest run src/components/modals/DownloadDialog.test.tsx 2>&1
```

Expected: all tests pass (count should match pre-refactor).

- [ ] **Step 3: TypeScript check**

```bash
cd C:/Repos/sounds-bored && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/components/modals/DownloadDialog.tsx && git commit -m "refactor: use TagPicker and SetPicker in DownloadDialog"
```

---

## Task 6: Refactor AddToSetDialog

**Files:**
- Modify: `src/components/composite/SidePanel/AddToSetDialog.tsx`

- [ ] **Step 1: Replace AddToSetDialog.tsx with the refactored version**

Replace the entire contents of `src/components/composite/SidePanel/AddToSetDialog.tsx`:

```tsx
import { useState, useEffect } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { SetPicker } from "@/components/composite/LibraryPickers";

interface AddToSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soundIds: string[];
}

export function AddToSetDialog({ open, onOpenChange, soundIds }: AddToSetDialogProps) {
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const { saveCurrentLibrary } = useSaveCurrentLibrary();

  useEffect(() => {
    if (open) {
      setSelectedSetIds([]);
    }
  }, [open]);

  async function handleConfirm() {
    const { addSoundsToSet } = useLibraryStore.getState();
    for (const setId of selectedSetIds) {
      addSoundsToSet(soundIds, setId);
    }
    await saveCurrentLibrary();
    onOpenChange(false);
  }

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add to Set"
      description={`Add ${soundIds.length} sound(s) to one or more sets.`}
      content={
        <div className="p-4">
          <SetPicker value={selectedSetIds} onChange={setSelectedSetIds} />
        </div>
      }
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={selectedSetIds.length === 0} onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      }
    />
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd C:/Repos/sounds-bored && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/components/composite/SidePanel/AddToSetDialog.tsx && git commit -m "refactor: use SetPicker in AddToSetDialog"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
cd C:/Repos/sounds-bored && npm run test:run 2>&1
```

Expected: all test files pass. Count should be pre-refactor count + 3 new test files (LibraryItemPicker, TagPicker, SetPicker) + new tests within them.

- [ ] **Step 2: Final TypeScript check**

```bash
cd C:/Repos/sounds-bored && npx tsc --noEmit 2>&1
```

Expected: no output.

# Settings Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings dialog accessible from StartScreen and the project MenuDrawer, with a Folders tab for managing global folder configuration (add/remove/rename, download/import role assignment).

**Architecture:** A single `SettingsDialog` component mounted at app root in `App.tsx`, wired to the existing `uiStore` overlay system via `OVERLAY_ID.SETTINGS_DIALOG`. The Folders tab reads from `appSettingsStore` and persists each mutation immediately via `useSaveAppSettings`. Two trigger points: gear icon on `StartScreen`, Settings item in `MenuDrawer`.

**Tech Stack:** React 19 + TypeScript, Zustand (`uiStore`, `appSettingsStore`), TanStack Query (`useSaveAppSettings`), Vitest + Testing Library + `userEvent`, Tauri `plugin-dialog` (`open()`), shadcn/ui (Dialog, Tabs, Select, Input, Button)

---

## File Map

| File | Action |
|------|--------|
| `src/state/uiStore.ts` | Modify — add `SETTINGS_DIALOG` to `OVERLAY_ID` |
| `src/components/modals/SettingsDialog.tsx` | Create — full dialog with Folders tab |
| `src/components/modals/SettingsDialog.test.tsx` | Create — all tests |
| `src/App.tsx` | Modify — mount `<SettingsDialog />` |
| `src/components/screens/start/StartScreen.tsx` | Modify — add gear icon trigger |
| `src/components/composite/SceneTabBar/MenuDrawer.tsx` | Modify — add Settings menu item |

---

## Task 1: Register SETTINGS_DIALOG overlay ID

**Files:**
- Modify: `src/state/uiStore.ts`

- [ ] **Step 1: Add SETTINGS_DIALOG to OVERLAY_ID**

In `src/state/uiStore.ts`, add one line to the `OVERLAY_ID` object:

```typescript
export const OVERLAY_ID = {
  MENU_DRAWER: "menu-drawer",
  SOUNDS_PANEL: "sounds-panel",
  SAVE_PROJECT_DIALOG: "save-project-dialog",
  CONFIRM_NAVIGATE_DIALOG: "confirm-navigate-dialog",
  CONFIRM_CLOSE_DIALOG: "confirm-close-dialog",
  PAD_CONFIG_DRAWER: "pad-config-drawer",
  SETTINGS_DIALOG: "settings-dialog",
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/state/uiStore.ts
git commit -m "feat(ui): add SETTINGS_DIALOG to OVERLAY_ID"
```

---

## Task 2: Create SettingsDialog shell with Folders tab

**Files:**
- Create: `src/components/modals/SettingsDialog.tsx`
- Create: `src/components/modals/SettingsDialog.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/modals/SettingsDialog.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { createMockAppSettings } from "@/test/factories";
import { SettingsDialog } from "./SettingsDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const mockSaveSettings = vi.fn();
vi.mock("@/lib/appSettings.queries", () => ({
  useSaveAppSettings: vi.fn(() => ({ mutate: mockSaveSettings })),
}));

function renderDialog() {
  return render(<SettingsDialog />);
}

function openDialog() {
  act(() => {
    useUiStore.getState().openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog");
  });
}

beforeEach(() => {
  useUiStore.setState({ ...initialUiState });
  useAppSettingsStore.setState({ ...initialAppSettingsState });
  mockSaveSettings.mockClear();
  vi.mocked(open).mockReset();
});

describe("SettingsDialog — shell", () => {
  it("is not visible when overlay is closed", () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is visible when overlay is open", () => {
    renderDialog();
    openDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows a Folders tab", () => {
    renderDialog();
    openDialog();
    expect(screen.getByRole("tab", { name: /folders/i })).toBeInTheDocument();
  });

  it("closes overlay when dialog close button is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.SETTINGS_DIALOG)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: fail with "Cannot find module './SettingsDialog'"

- [ ] **Step 3: Create SettingsDialog component**

Create `src/components/modals/SettingsDialog.tsx`:

```typescript
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useSaveAppSettings } from "@/lib/appSettings.queries";
import { GlobalFolder } from "@/lib/schemas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TruncatedPath } from "@/components/ui/truncated-path";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, FolderAddIcon } from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

type FolderRole = "download" | "import" | "none";

export function SettingsDialog() {
  const isOpen = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.SETTINGS_DIALOG));
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeOverlay(OVERLAY_ID.SETTINGS_DIALOG);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="folders">
          <TabsList>
            <TabsTrigger value="folders">Folders</TabsTrigger>
          </TabsList>
          <TabsContent value="folders">
            <FoldersTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function FoldersTab() {
  const settings = useAppSettingsStore((s) => s.settings);
  const addGlobalFolder = useAppSettingsStore((s) => s.addGlobalFolder);
  const removeGlobalFolder = useAppSettingsStore((s) => s.removeGlobalFolder);
  const setDownloadFolder = useAppSettingsStore((s) => s.setDownloadFolder);
  const setImportFolder = useAppSettingsStore((s) => s.setImportFolder);
  const updateSettings = useAppSettingsStore((s) => s.updateSettings);
  const { mutate: saveSettings } = useSaveAppSettings();

  if (!settings) return null;

  const { globalFolders, downloadFolderId, importFolderId } = settings;

  function getRole(folderId: string): FolderRole {
    if (folderId === downloadFolderId) return "download";
    if (folderId === importFolderId) return "import";
    return "none";
  }

  function isAssigned(folderId: string): boolean {
    return folderId === downloadFolderId || folderId === importFolderId;
  }

  function persist() {
    saveSettings(useAppSettingsStore.getState().settings!);
  }

  function handleRoleChange(folderId: string, role: FolderRole) {
    if (role === "download") setDownloadFolder(folderId);
    else if (role === "import") setImportFolder(folderId);
    persist();
  }

  async function handleAddFolder() {
    const selected = await open({ directory: true });
    if (!selected) return;
    const folderPath = typeof selected === "string" ? selected : selected[0];
    if (!folderPath) return;
    const name = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
    addGlobalFolder({ id: crypto.randomUUID(), path: folderPath, name });
    persist();
  }

  function handleRemoveFolder(folderId: string) {
    removeGlobalFolder(folderId);
    persist();
  }

  function handleRename(folderId: string, newName: string) {
    updateSettings((draft) => {
      const folder = draft.globalFolders.find((f) => f.id === folderId);
      if (folder) folder.name = newName;
    });
    persist();
  }

  return (
    <div className="space-y-2 mt-2">
      {globalFolders.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          role={getRole(folder.id)}
          assigned={isAssigned(folder.id)}
          onRoleChange={(role) => handleRoleChange(folder.id, role)}
          onRemove={() => handleRemoveFolder(folder.id)}
          onRename={(name) => handleRename(folder.id, name)}
        />
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={handleAddFolder}
        className="mt-4 w-full"
      >
        <HugeiconsIcon icon={FolderAddIcon} size={16} />
        Add Folder
      </Button>
    </div>
  );
}

interface FolderRowProps {
  folder: GlobalFolder;
  role: FolderRole;
  assigned: boolean;
  onRoleChange: (role: FolderRole) => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}

function FolderRow({
  folder,
  role,
  assigned,
  onRoleChange,
  onRemove,
  onRename,
}: FolderRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(folder.name);

  function commitRename() {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== folder.name) {
      onRename(trimmed);
    } else {
      setEditValue(folder.name);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") {
      setEditing(false);
      setEditValue(folder.name);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded border p-2">
      <div className="flex-1 min-w-0">
        {editing ? (
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            autoFocus
            className="h-7 text-sm"
            aria-label="Folder name"
          />
        ) : (
          <button
            className="text-sm font-medium hover:underline text-left truncate w-full"
            onClick={() => {
              setEditing(true);
              setEditValue(folder.name);
            }}
          >
            {folder.name}
          </button>
        )}
        <TruncatedPath
          path={folder.path}
          className="block text-xs text-muted-foreground"
        />
      </div>
      <Select
        value={role}
        onValueChange={(v) => onRoleChange(v as FolderRole)}
      >
        <SelectTrigger size="sm" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none" disabled={assigned}>
            None
          </SelectItem>
          <SelectItem value="download">Download</SelectItem>
          <SelectItem value="import">Import</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        disabled={assigned}
        aria-label={`Remove ${folder.name}`}
      >
        <HugeiconsIcon icon={Delete02Icon} size={16} />
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run shell tests — confirm they pass**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: 4 tests pass (shell describe block)

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/SettingsDialog.tsx src/components/modals/SettingsDialog.test.tsx
git commit -m "feat(settings): add SettingsDialog shell with Folders tab structure"
```

---

## Task 3: Mount SettingsDialog in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add SettingsDialog to App**

In `src/App.tsx`, import and render `SettingsDialog` alongside `<Toaster />`:

```typescript
import "./App.css";
import { StartScreen } from "@/components/screens/start/StartScreen";
import { MainPage } from "@/components/screens/main/MainPage";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppErrorBoundary, RouteErrorElement } from "@/components/ErrorBoundary";
import { useBootLoader } from "@/hooks/useBootLoader";
import { SettingsDialog } from "@/components/modals/SettingsDialog";

function App() {
  useBootLoader();

  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StartScreen />} errorElement={<RouteErrorElement />} />
          <Route path="/main" element={<MainPage />} errorElement={<RouteErrorElement />} />
        </Routes>
        <Toaster />
        <SettingsDialog />
      </BrowserRouter>
    </AppErrorBoundary>
  );
}

export default App;
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat(settings): mount SettingsDialog at app root"
```

---

## Task 4: Add Settings trigger to StartScreen

**Files:**
- Modify: `src/components/screens/start/StartScreen.tsx`
- Modify: `src/components/modals/SettingsDialog.test.tsx` (add tests)

- [ ] **Step 1: Write failing test**

Add to `src/components/modals/SettingsDialog.test.tsx` (after the existing describe block):

```typescript
import { StartScreen } from "@/components/screens/start/StartScreen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Additional mocks needed for StartScreen
vi.mock("@/lib/history.queries", () => ({
  useProjectHistory: vi.fn(() => ({ data: [], isLoading: false, error: null })),
}));
vi.mock("@/lib/project.queries", () => ({
  useLoadProject: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useLoadProjectFromPath: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateProject: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: vi.fn(() => vi.fn()) };
});
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn(() => Promise.resolve(false)) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

function renderStartScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StartScreen />
    </QueryClientProvider>
  );
}

describe("SettingsDialog — StartScreen trigger", () => {
  it("renders a Settings button on StartScreen", () => {
    renderStartScreen();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("opens settings dialog when Settings button is clicked", async () => {
    const user = userEvent.setup();
    renderStartScreen();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.SETTINGS_DIALOG)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: 2 new tests fail — "Settings" button not found

- [ ] **Step 3: Add Settings button to StartScreen**

In `src/components/screens/start/StartScreen.tsx`, add the import and button. The gear button goes in the top-right corner of the screen as a fixed/absolute positioned icon button.

Add imports:
```typescript
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
```

Add the hook inside `StartScreen`:
```typescript
const openOverlay = useUiStore((s) => s.openOverlay);
```

Add the button inside the return, wrapping the existing content in a relative container:
```typescript
return (
  <div className="relative flex flex-col items-center justify-center min-h-screen backdrop-blur-xs">
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Settings"
      className="absolute top-4 right-4"
      onClick={() => openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog")}
    >
      <HugeiconsIcon icon={Settings01Icon} size={16} />
    </Button>
    {/* existing content unchanged below */}
    <img src={logo} alt="Sounds Bored Logo" className="mb-8 w-48" style={{filter: "drop-shadow(6px 8px 0px #000000)"}} />
    ...
  </div>
);
```

The full updated return of `StartScreen`:

```typescript
  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen backdrop-blur-xs">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Settings"
        className="absolute top-4 right-4"
        onClick={() => openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog")}
      >
        <HugeiconsIcon icon={Settings01Icon} size={16} />
      </Button>
      <img src={logo} alt="Sounds Bored Logo" className="mb-8 w-48" style={{filter: "drop-shadow(6px 8px 0px #000000)"}} />
      <h1 className="text-center mb-8 logo tracking-widest text-4xl" style={{color: "var(--secondary)", filter: "drop-shadow(6px 8px 0px #000000)"}}>
        SOUNDS BORED
      </h1>
      <Card className="w-full max-w-md shadowed">
        <CardContent>
          <div className="flex flex-col gap-4">
            <Button
              variant="default"
              className="w-full"
              onClick={handleCreateProject}
              disabled={isCreatingProject || createProjectMutation.isPending}
            >
              {isCreatingProject || createProjectMutation.isPending ? "Creating..." : "Create New Project"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleLoadProject}
              disabled={loadProjectMutation.isPending}
            >
              {loadProjectMutation.isPending ? "Loading..." : "Load Project"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="w-full max-w-md mt-8 shadowed">
        <CardHeader>
          <h2 className="font-semibold">Recent Projects</h2>
        </CardHeader>
        <CardContent>
              {isLoading && <div>Loading...</div>}
              {error && <div className="text-red-500">{error.message}</div>}
              {recentProjects.length === 0 && !isLoading && <div>No recent projects found.</div>}
              <ul className="space-y-2">
                {recentProjects.map((entry) => (
                  <li key={entry.path} className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">{entry.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{new Date(entry.date).toLocaleString()}</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const pathExists = await exists(entry.path);
                          if (!pathExists) {
                            toast.error("Project folder no longer exists at this location.");
                            return;
                          }
                          await openPath(entry.path);
                        } catch {
                          toast.error("Could not open project folder.");
                        }
                      }} aria-label={`Open folder for ${entry.name}`}>
                        <HugeiconsIcon icon={FolderOpenIcon} size={16} />
                      </Button>
                      <Button size="sm" onClick={() => handleLoad(entry)}>Load</Button>
                    </div>
                  </li>
                ))}
              </ul>
        </CardContent>
      </Card>
    </div>
  );
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: all 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/screens/start/StartScreen.tsx src/components/modals/SettingsDialog.test.tsx
git commit -m "feat(settings): add Settings trigger to StartScreen"
```

---

## Task 5: Add Settings trigger to MenuDrawer

**Files:**
- Modify: `src/components/composite/SceneTabBar/MenuDrawer.tsx`
- Modify: `src/components/modals/SettingsDialog.test.tsx` (add tests)

- [ ] **Step 1: Write failing test**

Add to `src/components/modals/SettingsDialog.test.tsx`:

```typescript
import { MenuDrawer } from "@/components/composite/SceneTabBar/MenuDrawer";

vi.mock("@/contexts/ProjectActionsContext", () => ({
  useProjectActions: vi.fn(() => ({
    canSave: false,
    handleSaveClick: vi.fn(),
    requestNavigateAway: vi.fn(),
  })),
}));

function renderMenuDrawer() {
  return render(<MenuDrawer />);
}

function openMenuDrawer() {
  act(() => {
    useUiStore.getState().openOverlay(OVERLAY_ID.MENU_DRAWER, "drawer");
  });
}

describe("SettingsDialog — MenuDrawer trigger", () => {
  it("renders a Settings button in the menu drawer", () => {
    renderMenuDrawer();
    openMenuDrawer();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("opens settings dialog when Settings is clicked in drawer", async () => {
    const user = userEvent.setup();
    renderMenuDrawer();
    openMenuDrawer();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.SETTINGS_DIALOG)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: 2 new tests fail — "Settings" button not found in drawer

- [ ] **Step 3: Add Settings item to MenuDrawer**

In `src/components/composite/SceneTabBar/MenuDrawer.tsx`, add the Settings01Icon import and a new button above the final `<Separator />`:

Add to imports:
```typescript
import { ClipboardIcon, FolderExportIcon, Hamburger01Icon, HomeIcon, SaveIcon, Settings01Icon } from "@hugeicons/core-free-icons";
```

Add inside `DrawerContent`, just before the last `<Separator />` before "Return to Main Menu":

```typescript
<Separator />
<Button
  variant="secondary"
  className="w-full mt-2"
  onClick={() => { closeOverlay(OVERLAY_ID.MENU_DRAWER); openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog"); }}
  aria-label="Settings"
>
  <HugeiconsIcon icon={Settings01Icon} size={16} />
  Settings
</Button>
```

The full updated `DrawerContent` body in `MenuDrawer.tsx`:

```typescript
      <DrawerContent
        className="w-64"
        style={{
          backgroundImage: `url(${brickOverlay})`,
          backgroundRepeat: "repeat",
          backgroundColor: "var(--background)",
        }}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DrawerHeader>
          <h1 className="text-lg font-semibold text-white">Menu</h1>
        </DrawerHeader>
        <Button disabled={!canSave} variant="secondary" className="w-full mb-2" onClick={handleSaveClick}>
          <HugeiconsIcon icon={SaveIcon} size={16} />
          Save
          <Kbd className="ml-auto">{modKey} + S</Kbd>
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => null}>
          <HugeiconsIcon icon={ClipboardIcon} size={16} />
          Save As
          <Kbd className="ml-auto">{modKey} + Shift + S</Kbd>
        </Button>
        <Separator />
        <Button variant="secondary" className="w-full mt-2" onClick={() => null}>
          <HugeiconsIcon icon={FolderExportIcon} size={16} />
          Export
          <Kbd className="ml-auto">{modKey} + X</Kbd>
        </Button>
        <Separator />
        <Button
          variant="secondary"
          className="w-full mt-2"
          onClick={() => { closeOverlay(OVERLAY_ID.MENU_DRAWER); openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog"); }}
          aria-label="Settings"
        >
          <HugeiconsIcon icon={Settings01Icon} size={16} />
          Settings
        </Button>
        <Separator />
        <Button
          variant="default"
          className="w-full mt-2"
          onClick={() => { closeOverlay(OVERLAY_ID.MENU_DRAWER); requestNavigateAway("/"); }}
        >
          <HugeiconsIcon icon={HomeIcon} size={16} />
          Return to Main Menu
        </Button>
        <img
          src={handsigil}
          alt=""
          aria-hidden
          className="pointer-events-none mt-auto w-full object-contain"
        />
      </DrawerContent>
```

Also add `openOverlay` to the store destructuring at the top of `MenuDrawer`:
```typescript
  const openOverlay = useUiStore((s) => s.openOverlay);
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: all 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneTabBar/MenuDrawer.tsx src/components/modals/SettingsDialog.test.tsx
git commit -m "feat(settings): add Settings trigger to MenuDrawer"
```

---

## Task 6: Test Folders tab display

> **Note on role select interaction testing:** Radix UI's `SelectContent` renders into a portal, which makes userEvent interaction unreliable in happy-dom. The role assignment logic (`setDownloadFolder` / `setImportFolder`) is straightforward store delegation. The tests below verify the correct *initial* role state via disabled states on the remove button, which is sufficient coverage. Full role-change interaction is covered by manual verification in Task 10.

**Files:**
- Modify: `src/components/modals/SettingsDialog.test.tsx`

The `FoldersTab` and `FolderRow` implementations are already written in Task 2. This task adds tests to verify their behavior.

- [ ] **Step 1: Add folder display and role select tests**

Add to `src/components/modals/SettingsDialog.test.tsx`:

```typescript
import { open } from "@tauri-apps/plugin-dialog";
import { createMockGlobalFolder } from "@/test/factories";

function setupFolderState() {
  const downloadFolder = createMockGlobalFolder({ id: "dl-id", name: "Downloads", path: "/music/downloads" });
  const importFolder = createMockGlobalFolder({ id: "imp-id", name: "Imported", path: "/music/imported" });
  const otherFolder = createMockGlobalFolder({ id: "other-id", name: "Other", path: "/music/other" });
  const settings = createMockAppSettings({
    globalFolders: [downloadFolder, importFolder, otherFolder],
    downloadFolderId: downloadFolder.id,
    importFolderId: importFolder.id,
  });
  useAppSettingsStore.setState({ settings });
  return { downloadFolder, importFolder, otherFolder };
}

describe("SettingsDialog — Folders tab display", () => {
  it("renders folder names when dialog is open", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByText("Downloads")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("shows the Add Folder button", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByRole("button", { name: /add folder/i })).toBeInTheDocument();
  });

  it("remove button is disabled for the download folder", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByRole("button", { name: /remove downloads/i })).toBeDisabled();
  });

  it("remove button is disabled for the import folder", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByRole("button", { name: /remove imported/i })).toBeDisabled();
  });

  it("remove button is enabled for an unassigned folder", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByRole("button", { name: /remove other/i })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests — confirm they pass**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: all tests pass (implementation already exists from Task 2)

- [ ] **Step 3: Commit**

```bash
git add src/components/modals/SettingsDialog.test.tsx
git commit -m "test(settings): add folder display and role tests"
```

---

## Task 7: Test Add Folder behavior

**Files:**
- Modify: `src/components/modals/SettingsDialog.test.tsx`

- [ ] **Step 1: Add add-folder tests**

Add to `src/components/modals/SettingsDialog.test.tsx`:

```typescript
describe("SettingsDialog — Add Folder", () => {
  it("calls Tauri open with directory:true when Add Folder is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue(null);
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    expect(open).toHaveBeenCalledWith({ directory: true });
  });

  it("adds a new folder to the store when a path is returned", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue("/new/folder/path");
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.path === "/new/folder/path")).toBe(true);
  });

  it("uses the last path segment as the default folder name", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue("/some/path/mysounds");
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.name === "mysounds")).toBe(true);
  });

  it("calls saveSettings after adding a folder", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue("/new/folder");
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });

  it("does not modify the store if the picker is cancelled (null)", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue(null);
    setupFolderState();
    renderDialog();
    openDialog();
    const countBefore = useAppSettingsStore.getState().settings!.globalFolders.length;
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    const countAfter = useAppSettingsStore.getState().settings!.globalFolders.length;
    expect(countAfter).toBe(countBefore);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — confirm they pass**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/components/modals/SettingsDialog.test.tsx
git commit -m "test(settings): add folder add/remove tests"
```

---

## Task 8: Test Remove Folder behavior

**Files:**
- Modify: `src/components/modals/SettingsDialog.test.tsx`

- [ ] **Step 1: Add remove-folder tests**

Add to `src/components/modals/SettingsDialog.test.tsx`:

```typescript
describe("SettingsDialog — Remove Folder", () => {
  it("removes a folder from the store when the remove button is clicked", async () => {
    const user = userEvent.setup();
    const { otherFolder } = setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /remove other/i }));
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.id === otherFolder.id)).toBe(false);
  });

  it("calls saveSettings after removing a folder", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /remove other/i }));
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests — confirm they pass**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/components/modals/SettingsDialog.test.tsx
git commit -m "test(settings): add remove folder tests"
```

---

## Task 9: Test Rename Folder behavior

**Files:**
- Modify: `src/components/modals/SettingsDialog.test.tsx`

- [ ] **Step 1: Add rename tests**

Add to `src/components/modals/SettingsDialog.test.tsx`:

```typescript
describe("SettingsDialog — Rename Folder", () => {
  it("clicking a folder name shows an input field", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    expect(screen.getByRole("textbox", { name: /folder name/i })).toBeInTheDocument();
  });

  it("blurring with a changed name updates the store and saves", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    const input = screen.getByRole("textbox", { name: /folder name/i });
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.tab(); // trigger blur
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.name === "Renamed")).toBe(true);
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });

  it("pressing Enter with a changed name updates the store and saves", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    const input = screen.getByRole("textbox", { name: /folder name/i });
    await user.clear(input);
    await user.type(input, "EnteredName");
    await user.keyboard("{Enter}");
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.name === "EnteredName")).toBe(true);
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });

  it("pressing Escape reverts the name without saving", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    const input = screen.getByRole("textbox", { name: /folder name/i });
    await user.clear(input);
    await user.type(input, "Abandoned");
    await user.keyboard("{Escape}");
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.name === "Other")).toBe(true);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("does not save if the name is unchanged on blur", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    await user.tab(); // blur without changing
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — confirm they pass**

```bash
npm run test:run -- src/components/modals/SettingsDialog.test.tsx
```

Expected: all tests pass

- [ ] **Step 3: Run full test suite**

```bash
npm run test:run
```

Expected: all existing tests still pass, no regressions

- [ ] **Step 4: Commit**

```bash
git add src/components/modals/SettingsDialog.test.tsx
git commit -m "test(settings): add rename folder tests"
```

---

## Task 10: Verify in the running app

- [ ] **Step 1: Start the app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Verify StartScreen trigger**

Open the app. A gear icon should appear in the top-right corner of the start screen. Click it — the Settings dialog opens with a Folders tab.

- [ ] **Step 3: Verify MenuDrawer trigger**

Create or load a project. Open the hamburger menu (left side of SceneTabBar). A "Settings" item should appear above "Return to Main Menu". Click it — the menu drawer closes and the Settings dialog opens.

- [ ] **Step 4: Verify Folders tab features**

With the Settings dialog open:
- All global folders are listed with names, truncated paths, role dropdowns, and remove buttons
- The Download and Import folders have their remove buttons disabled
- Adding a folder opens the system directory picker, and the new folder appears in the list
- Clicking a folder name makes it editable; pressing Enter or blurring saves, Escape reverts
- Changing a role dropdown updates the assignment and persists on next app load

- [ ] **Step 5: Final commit (if any visual tweaks were needed)**

```bash
git add -p
git commit -m "fix(settings): visual adjustments from manual testing"
```

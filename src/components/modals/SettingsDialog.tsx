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

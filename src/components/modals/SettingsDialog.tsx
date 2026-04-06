import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useSaveAppSettings } from "@/lib/appSettings.queries";
import { useUpdaterStore } from "@/state/updaterStore";
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
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { TruncatedPath } from "@/components/ui/truncated-path";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, FolderAddIcon, Loading03Icon, CheckmarkCircle01Icon, Alert01Icon, RefreshIcon, Download04Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { useState, useEffect, useRef } from "react";

export function SettingsDialog() {
  const isOpen = useUiStore(selectIsOverlayOpen(OVERLAY_ID.SETTINGS_DIALOG));
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
            <TabsTrigger value="playback">Playback</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
          <TabsContent value="folders">
            <FoldersTab />
          </TabsContent>
          <TabsContent value="playback">
            <PlaybackTab />
          </TabsContent>
          <TabsContent value="about">
            <AboutTab />
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

  function isAssigned(folderId: string): boolean {
    return folderId === downloadFolderId || folderId === importFolderId;
  }

  function persist() {
    saveSettings(useAppSettingsStore.getState().settings!);
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
    try {
      removeGlobalFolder(folderId);
      persist();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove folder.");
    }
  }

  function handleRename(folderId: string, newName: string) {
    updateSettings((draft) => {
      const folder = draft.globalFolders.find((f) => f.id === folderId);
      if (folder) folder.name = newName;
    });
    persist();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium w-28 shrink-0">Download folder</span>
          <Select
            value={downloadFolderId}
            onValueChange={(id) => { setDownloadFolder(id); persist(); }}
          >
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {globalFolders.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium w-28 shrink-0">Import folder</span>
          <Select
            value={importFolderId}
            onValueChange={(id) => { setImportFolder(id); persist(); }}
          >
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {globalFolders.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Separator />
      <div className="space-y-2">
        {globalFolders.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            assigned={isAssigned(folder.id)}
            onRemove={() => handleRemoveFolder(folder.id)}
            onRename={(name) => handleRename(folder.id, name)}
          />
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={handleAddFolder}
          className="mt-2 w-full"
        >
          <HugeiconsIcon icon={FolderAddIcon} size={16} />
          Add Folder
        </Button>
      </div>
    </div>
  );
}

function PlaybackTab() {
  const settings = useAppSettingsStore((s) => s.settings);
  const updateSettings = useAppSettingsStore((s) => s.updateSettings);
  const { mutate: saveSettings } = useSaveAppSettings();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveSettings(useAppSettingsStore.getState().settings!);
      }
    };
  }, [saveSettings]);

  if (!settings) return null;

  const fadeDurationMs = settings.globalFadeDurationMs ?? 2000;

  function handleFadeDurationChange(value: number) {
    updateSettings((draft) => {
      draft.globalFadeDurationMs = value;
    });
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSettings(useAppSettingsStore.getState().settings!);
      saveTimerRef.current = null;
    }, 300);
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Default Fade Duration</Label>
          <span className="text-sm tabular-nums text-muted-foreground">
            {(fadeDurationMs / 1000).toFixed(1)}s
          </span>
        </div>
        <Slider
          min={100}
          max={10000}
          step={100}
          value={[fadeDurationMs]}
          onValueChange={(vals) => handleFadeDurationChange(vals[0])}
        />
        <p className="text-xs text-muted-foreground">
          Applied to all pads that do not have a custom fade duration set.
        </p>
      </div>
    </div>
  );
}

function AboutTab() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const status = useUpdaterStore((s) => s.status);
  const availableVersion = useUpdaterStore((s) => s.availableVersion);
  const progress = useUpdaterStore((s) => s.progress);
  const hasChecked = useUpdaterStore((s) => s.hasChecked);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const install = useUpdaterStore((s) => s.install);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">SoundsBored</p>
        <p className="text-sm text-muted-foreground">
          Version {appVersion ?? '…'}
        </p>
      </div>
      <Separator />
      <div className="space-y-2">
        <p className="text-sm font-medium">Updates</p>
        <UpdateStatusRow
          status={status}
          availableVersion={availableVersion}
          progress={progress}
          hasChecked={hasChecked}
          onCheck={checkForUpdates}
          onInstall={install}
          onRestart={relaunch}
        />
      </div>
    </div>
  );
}

interface UpdateStatusRowProps {
  status: ReturnType<typeof useUpdaterStore.getState>['status'];
  availableVersion: string | null;
  progress: number | null;
  hasChecked: boolean;
  onCheck: () => void;
  onInstall: () => void;
  onRestart: () => void;
}

function UpdateStatusRow({ status, availableVersion, progress, hasChecked, onCheck, onInstall, onRestart }: UpdateStatusRowProps) {
  if (status === 'checking') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin" />
        Checking for updates…
      </div>
    );
  }

  if (status === 'downloading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin" />
        {progress !== null ? `Downloading… ${progress}%` : 'Downloading…'}
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} className="text-green-500" />
          Update installed — restart to apply
        </div>
        <Button size="sm" onClick={onRestart}>
          <HugeiconsIcon icon={Refresh01Icon} size={14} />
          Restart now
        </Button>
      </div>
    );
  }

  if (status === 'available') {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <HugeiconsIcon icon={Download04Icon} size={16} className="text-blue-500" />
          Version {availableVersion} available
        </div>
        <Button size="sm" onClick={onInstall}>
          Install now
        </Button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <HugeiconsIcon icon={Alert01Icon} size={16} />
          Update check failed
        </div>
        <Button variant="secondary" size="sm" onClick={onCheck}>
          <HugeiconsIcon icon={RefreshIcon} size={14} />
          Retry
        </Button>
      </div>
    );
  }

  // idle
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">
        {hasChecked ? 'Up to date' : 'Check for latest updates'}
      </p>
      <Button variant="secondary" size="sm" onClick={onCheck}>
        <HugeiconsIcon icon={RefreshIcon} size={14} />
        Check for updates
      </Button>
    </div>
  );
}

interface FolderRowProps {
  folder: GlobalFolder;
  assigned: boolean;
  onRemove: () => void;
  onRename: (name: string) => void;
}

function FolderRow({
  folder,
  assigned,
  onRemove,
  onRename,
}: FolderRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(folder.name);

  useEffect(() => {
    if (!editing) {
      setEditValue(folder.name);
    }
  }, [folder.name, editing]);

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

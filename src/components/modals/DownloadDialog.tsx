import { useMemo, useState } from "react";
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
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useStartDownload } from "@/lib/ytdlp.queries";
import { useDownloadStore } from "@/state/downloadStore";
import { useLibraryStore } from "@/state/libraryStore";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";

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
  const [tagInputValue, setTagInputValue] = useState("");
  const [setInputValue, setSetInputValue] = useState("");

  const settings = useAppSettingsStore((s) => s.settings);
  const { mutateAsync: startDownload, isPending } = useStartDownload();

  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);
  const ensureTagExists = useLibraryStore((s) => s.ensureTagExists);
  const addSet = useLibraryStore((s) => s.addSet);

  const userTags = useMemo(() => tags.filter((t) => !t.isSystem), [tags]);

  const tagsAnchorRef = useComboboxAnchor();
  const setsAnchorRef = useComboboxAnchor();

  const downloadFolderId = settings?.downloadFolderId;
  const downloadFolder = settings?.globalFolders.find(
    (f) => f.id === downloadFolderId,
  )?.path;

  const trimmedTagInput = tagInputValue.trim();
  const tagInputMatchesExisting = userTags.some(
    (t) => t.name.toLowerCase() === trimmedTagInput.toLowerCase(),
  );
  const canCreateTag = trimmedTagInput.length > 0 && !tagInputMatchesExisting;

  const trimmedSetInput = setInputValue.trim();
  const setInputMatchesExisting = sets.some(
    (s) => s.name.toLowerCase() === trimmedSetInput.toLowerCase(),
  );
  const canCreateSet = trimmedSetInput.length > 0 && !setInputMatchesExisting;

  function sanitizeName(value: string): string {
    return value.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
  }

  function handleOutputNameChange(value: string) {
    setOutputName(sanitizeName(value));
  }

  function handleTagValueChange(newIds: string[]) {
    if (newIds.includes("__create__")) {
      if (!trimmedTagInput) {
        setSelectedTagIds(newIds.filter((id) => id !== "__create__"));
        return;
      }
      const newTag = ensureTagExists(trimmedTagInput);
      setSelectedTagIds([
        ...newIds.filter((id) => id !== "__create__"),
        newTag.id,
      ]);
      return;
    }
    setSelectedTagIds(newIds);
  }

  function handleSetValueChange(newIds: string[]) {
    if (newIds.includes("__create__")) {
      if (!trimmedSetInput) {
        setSelectedSetIds(newIds.filter((id) => id !== "__create__"));
        return;
      }
      const newSet = addSet(trimmedSetInput);
      setSelectedSetIds([
        ...newIds.filter((id) => id !== "__create__"),
        newSet.id,
      ]);
      return;
    }
    setSelectedSetIds(newIds);
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
    setTagInputValue("");
    setSetInputValue("");
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setUrlError(null);
      setNameError(null);
      setSelectedTagIds([]);
      setSelectedSetIds([]);
      setTagInputValue("");
      setSetInputValue("");
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
            <Combobox
              value={selectedTagIds}
              onValueChange={handleTagValueChange}
              onInputValueChange={(val) => setTagInputValue(val)}
              items={userTags}
              multiple
            >
              <ComboboxChips ref={tagsAnchorRef}>
                {selectedTagIds.map((id) => {
                  const tag = userTags.find((t) => t.id === id);
                  return tag ? (
                    <ComboboxChip key={id}>{tag.name}</ComboboxChip>
                  ) : null;
                })}
                <ComboboxChipsInput placeholder="Search or create tags..." />
              </ComboboxChips>
              <ComboboxContent anchor={tagsAnchorRef}>
                <ComboboxList>
                  <ComboboxEmpty>No tags found.</ComboboxEmpty>
                  <ComboboxCollection>
                    {(t) => (
                      <ComboboxItem key={t.id} value={t.id}>
                        {t.name}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                  {canCreateTag && (
                    <ComboboxItem value="__create__">
                      Create "{trimmedTagInput}"
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              Sets{" "}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Combobox
              value={selectedSetIds}
              onValueChange={handleSetValueChange}
              onInputValueChange={(val) => setSetInputValue(val)}
              items={sets}
              multiple
            >
              <ComboboxChips ref={setsAnchorRef}>
                {selectedSetIds.map((id) => {
                  const set = sets.find((s) => s.id === id);
                  return set ? (
                    <ComboboxChip key={id}>{set.name}</ComboboxChip>
                  ) : null;
                })}
                <ComboboxChipsInput placeholder="Search or create sets..." />
              </ComboboxChips>
              <ComboboxContent anchor={setsAnchorRef}>
                <ComboboxList>
                  <ComboboxEmpty>No sets found.</ComboboxEmpty>
                  <ComboboxCollection>
                    {(s) => (
                      <ComboboxItem key={s.id} value={s.id}>
                        {s.name}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                  {canCreateSet && (
                    <ComboboxItem value="__create__">
                      Create "{trimmedSetInput}"
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
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

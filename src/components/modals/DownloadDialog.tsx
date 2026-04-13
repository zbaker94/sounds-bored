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
import { useAppSettings } from "@/lib/appSettings.queries";
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

  const { data: settings } = useAppSettings();
  const { mutateAsync: startDownload, isPending } = useStartDownload();
  const downloadJobs = useDownloadStore((s) => s.jobs);
  const sounds = useLibraryStore((s) => s.sounds);

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
      const activeJobWithSameName = Object.values(downloadJobs).some(
        (j) =>
          j.outputName === outputName &&
          j.status !== "failed" &&
          j.status !== "cancelled",
      );
      const libraryHasSameName = sounds.some(
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
    });

    setUrl("");
    setOutputName("");
    setUrlError(null);
    setNameError(null);
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setUrlError(null);
      setNameError(null);
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

import { useProjectStore } from "@/state/projectStore";
import { SceneTabBar } from "@/components/composite/SceneTabBar/SceneTabBar";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { useSaveProjectAs } from "@/lib/project.queries";
import { discardTemporaryProject } from "@/lib/project";
import { SaveProjectDialog } from "@/components/modals/SaveProjectDialog";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WINDOW_CLOSE_DELAY } from "@/lib/constants";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  HeadphonesIcon,
  PencilEdit01Icon,
  Upload03Icon,
  HeadphoneMuteIcon,
  StopIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { Slider } from "@/components/ui/slider";

export function MainPage() {
  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markAsPermanent = useProjectStore((s) => s.markAsPermanent);
  const navigate = useNavigate();
  const saveProjectMutation = useSaveProjectAs();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [shouldCloseAfterSave, setShouldCloseAfterSave] = useState(false);
  const [volume, setVolume] = useState(100);

  // Enable auto-save for the current project
  useAutoSave();

  // Memoize the close requested callback to prevent effect re-runs
  const handleCloseRequested = useCallback(() => {
    setShowConfirmClose(true);
  }, []);

  // Handle window close requests
  const { allowClose } = useWindowCloseHandler(
    isTemporary || isDirty,
    handleCloseRequested,
  );

  useEffect(() => {
    // Redirect to start screen if no project is loaded
    if (!project) {
      toast.error("No project loaded. Returning to start screen.");
      navigate("/");
    }
  }, [project, navigate]);

  const handleSave = async (projectName: string) => {
    if (!project || !folderPath) return;

    try {
      const result = await saveProjectMutation.mutateAsync({
        projectName,
        currentPath: folderPath,
        project,
      });

      if (result) {
        markAsPermanent(
          {
            name: result.project.name,
            path: result.newPath,
            date: new Date().toISOString(),
          },
          result.project,
        );
        setShowSaveDialog(false);

        if (shouldCloseAfterSave) {
          allowClose();
          setTimeout(async () => {
            const appWindow = getCurrentWindow();
            await appWindow.close();
          }, WINDOW_CLOSE_DELAY);
        }
      }
    } catch (error) {
      toast.error("Failed to save project. Please try again.");
      setShouldCloseAfterSave(false);
    }
  };

  const handleSaveAndClose = () => {
    setShowConfirmClose(false);
    setShouldCloseAfterSave(true);
    setShowSaveDialog(true);
  };

  const handleDiscardAndClose = async () => {
    if (isTemporary && folderPath) {
      try {
        await discardTemporaryProject(folderPath);
      } catch (error) {
        console.warn("Could not discard temporary project:", error);
      }
    }

    allowClose();

    setTimeout(async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.close();
      } catch (error) {
        console.error("Failed to close window:", error);
      }
    }, WINDOW_CLOSE_DELAY);
  };

  const handleCancelClose = () => {
    setShowConfirmClose(false);
  };

  if (!project) {
    return null;
  }

  return (
    <>
      <div id="main-page" className="w-full h-screen flex flex-col md:flex-row">
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <SceneTabBar />
          <div className="flex-1" />
        </div>
        <aside className="h-16 w-full shrink-0 bg-yellow-500 drop-shadow-[0_-5px_0px_rgba(0,0,0,1)] flex flex-row md:h-full md:w-12 md:drop-shadow-[-5px_0_0px_rgba(0,0,0,1)] md:flex-col md:justify-between">
          {/* Section 1: Edit controls — pinned to start */}
          <div className="flex flex-row items-center p-1 gap-2 md:flex-col">
            <Button variant="default" size="icon" className="size-11 md:size-9">
              <HugeiconsIcon icon={Upload03Icon} />
            </Button>
            <Button variant="default" size="icon" className="size-11 md:size-9">
              <HugeiconsIcon icon={PencilEdit01Icon} />
            </Button>
          </div>
          {/* Section 2: Volume — fills width on horizontal, natural size on vertical */}
          <div className="flex-1 md:flex-none flex flex-row items-center justify-center gap-2 md:flex-col">
            <Slider
              orientation="horizontal"
              value={[volume]}
              onValueChange={(vals) => setVolume(vals[0])}
              max={100}
              min={0}
              className="w-42 md:hidden"
            />
            <Slider
              orientation="vertical"
              value={[volume]}
              onValueChange={(vals) => setVolume(vals[0])}
              max={100}
              min={0}
              className="hidden md:flex"
            />
            <Button variant="default" size="icon" className="size-11 md:size-9" onClick={() => volume > 0 ? setVolume(0) : setVolume(50)}>
              {volume > 0 ? <HugeiconsIcon icon={HeadphonesIcon} /> : <HugeiconsIcon icon={HeadphoneMuteIcon} />}
            </Button>
          </div>
          {/* Section 3: Play — pinned to end */}
          <div className="flex items-center p-1 md:pb-2">
            <Button variant="default" size="icon" className="size-11 md:size-9">
              <HugeiconsIcon icon={PlayIcon} />
            </Button>
          </div>
        </aside>
      </div>
      <SaveProjectDialog
        isOpen={showSaveDialog}
        onSave={handleSave}
        onCancel={() => {
          setShowSaveDialog(false);
          setShouldCloseAfterSave(false);
        }}
        defaultName={project.name}
        isPending={saveProjectMutation.isPending}
      />

      <ConfirmCloseDialog
        isOpen={showConfirmClose}
        onSave={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={handleCancelClose}
      />
    </>
  );
}

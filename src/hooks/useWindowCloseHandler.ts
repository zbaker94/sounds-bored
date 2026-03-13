import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindowCloseHandler(
  hasUnsavedChanges: boolean,
  onCloseRequested: () => void
) {
  const allowCloseRef = useRef(false);
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  const onCloseRequestedRef = useRef(onCloseRequested);

  // Keep refs up to date
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
    onCloseRequestedRef.current = onCloseRequested;
  }, [hasUnsavedChanges, onCloseRequested]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      const appWindow = getCurrentWindow();

      unlisten = await appWindow.onCloseRequested(async (event) => {
        if (hasUnsavedChangesRef.current && !allowCloseRef.current) {
          event.preventDefault();
          onCloseRequestedRef.current();
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []); // Empty deps - only set up once!

  // Return functions to control close behavior
  return {
    allowClose: () => {
      allowCloseRef.current = true;
    },
  };
}

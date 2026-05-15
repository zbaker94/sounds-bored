import { useEffect } from 'react';
import { toast } from 'sonner';
import { relaunch } from '@tauri-apps/plugin-process';
import { useUpdaterStore } from '@/state/updaterStore';
import { logError } from '@/lib/logger';

// Module-scoped so HMR / remount cycles don't re-trigger the update check on each render.
let updateChecked = false;
const TOAST_ID = 'app-updater';
const STICKY = { duration: Infinity } as const;

// fallow-ignore-next-line unused-export
export function _resetUpdateChecked() {
  updateChecked = false;
}

export function useUpdater() {
  useEffect(() => {
    let prevStatus = useUpdaterStore.getState().status;

    const unsubscribe = useUpdaterStore.subscribe((state) => {
      const { status, progress, availableVersion } = state;
      const statusChanged = status !== prevStatus;
      prevStatus = status;

      if (statusChanged && status === 'available') {
        toast(`Update ${availableVersion} available`, {
          id: TOAST_ID,
          description: 'A new version of SoundsBored is ready to install.',
          action: {
            label: 'Install now',
            onClick: () => useUpdaterStore.getState().install(),
          },
          ...STICKY,
        });
        return;
      }

      if (status === 'downloading') {
        const description = progress !== null ? `${progress}% downloaded` : 'Starting download…';
        toast.loading('Downloading update…', {
          id: TOAST_ID,
          description,
          ...STICKY,
        });
        return;
      }

      if (statusChanged && status === 'ready') {
        toast.success('Update ready', {
          id: TOAST_ID,
          description: 'Restart the app to apply the update.',
          action: {
            label: 'Restart now',
            onClick: () => {
              relaunch().catch((err: unknown) => logError('updater relaunch failed', err instanceof Error ? err : { error: String(err) }));
            },
          },
          ...STICKY,
        });
        return;
      }

      if (statusChanged && status === 'error') {
        toast.error('Update failed', {
          id: TOAST_ID,
          description: 'Could not install the update. Try again later.',
          duration: 8000,
        });
      }
    });

    if (!updateChecked) {
      updateChecked = true;
      useUpdaterStore.getState().checkForUpdates();
    }

    return unsubscribe;
  }, []);
}

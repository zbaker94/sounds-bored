import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toast } from 'sonner';

let updateChecked = false;
const TOAST_ID = 'app-updater';

export function useUpdater() {
  useEffect(() => {
    async function checkForUpdates() {
      if (updateChecked) return;
      updateChecked = true;
      try {
        const update = await check();
        if (!update?.available) return;

        toast(`Update ${update.version} available`, {
          id: TOAST_ID,
          description: 'A new version of SoundsBored is ready to install.',
          action: {
            label: 'Install now',
            onClick: async () => {
              let downloaded = 0;
              let total: number | undefined;

              toast.loading('Downloading update…', {
                id: TOAST_ID,
                description: 'Starting download…',
                duration: Infinity,
              });

              try {
                await update.downloadAndInstall((event) => {
                  switch (event.event) {
                    case 'Started':
                      total = event.data.contentLength ?? undefined;
                      break;
                    case 'Progress':
                      downloaded += event.data.chunkLength;
                      toast.loading('Downloading update…', {
                        id: TOAST_ID,
                        description: total
                          ? `${Math.round((downloaded / total) * 100)}% of ${(total / 1024 / 1024).toFixed(1)} MB`
                          : `${(downloaded / 1024 / 1024).toFixed(1)} MB downloaded`,
                        duration: Infinity,
                      });
                      break;
                    case 'Finished':
                      break;
                  }
                });

                toast.success('Update ready', {
                  id: TOAST_ID,
                  description: 'Restart the app to apply the update.',
                  action: {
                    label: 'Restart now',
                    onClick: () => relaunch(),
                  },
                  duration: Infinity,
                });
              } catch {
                toast.error('Update failed', {
                  id: TOAST_ID,
                  description: 'Could not install the update. Try again later.',
                  duration: 8000,
                });
              }
            },
          },
          duration: Infinity,
        });
      } catch {
        // Updater is best-effort — never crash the app on update check failure
      }
    }

    checkForUpdates();
  }, []);
}

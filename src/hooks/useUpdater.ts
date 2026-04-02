import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toast } from 'sonner';

export function useUpdater() {
  useEffect(() => {
    async function checkForUpdates() {
      try {
        const update = await check();
        if (!update?.available) return;

        toast(`Update ${update.version} available`, {
          description: 'A new version of SoundsBored is ready to install.',
          action: {
            label: 'Install now',
            onClick: async () => {
              await update.downloadAndInstall();
              toast('Update installed', {
                description: 'Restart the app to apply the update.',
                action: {
                  label: 'Restart',
                  onClick: () => relaunch(),
                },
                duration: Infinity,
              });
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

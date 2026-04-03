import { useEffect } from 'react';
import { toast } from 'sonner';
import { useUpdaterStore } from '@/state/updaterStore';

let updateChecked = false;
const TOAST_ID = 'app-updater';

export function useUpdater() {
  useEffect(() => {
    if (updateChecked) return;
    updateChecked = true;

    useUpdaterStore.getState().checkForUpdates().then(() => {
      const { status, availableVersion, install } = useUpdaterStore.getState();
      if (status !== 'available') return;

      toast(`Update ${availableVersion} available`, {
        id: TOAST_ID,
        description: 'A new version of SoundsBored is ready to install.',
        action: {
          label: 'Install now',
          onClick: install,
        },
        duration: Infinity,
      });
    });
  }, []);
}

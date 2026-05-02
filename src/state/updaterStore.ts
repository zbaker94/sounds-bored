import { create } from 'zustand';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toast } from 'sonner';

type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

const TOAST_ID = 'app-updater';

interface UpdaterState {
  status: UpdaterStatus;
  availableVersion: string | null;
  /** Download progress 0–100, only populated while status === 'downloading' */
  progress: number | null;
  /** True after at least one check has completed (success or failure) */
  hasChecked: boolean;
  _pendingUpdate: Update | null;

  checkForUpdates: () => Promise<void>;
  install: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  availableVersion: null,
  progress: null,
  hasChecked: false,
  _pendingUpdate: null,

  checkForUpdates: async () => {
    set({ status: 'checking', availableVersion: null, progress: null, _pendingUpdate: null });
    try {
      const update = await check();
      if (update?.available) {
        set({ status: 'available', availableVersion: update.version, _pendingUpdate: update, hasChecked: true });
      } else {
        set({ status: 'idle', hasChecked: true });
      }
    } catch {
      set({ status: 'error', hasChecked: true });
    }
  },

  install: async () => {
    const { _pendingUpdate } = get();
    if (!_pendingUpdate) return;

    let downloaded = 0;
    let total: number | undefined;

    set({ status: 'downloading', progress: 0 });

    toast.loading('Downloading update…', {
      id: TOAST_ID,
      description: 'Starting download…',
      duration: Infinity,
    });

    try {
      await _pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? undefined;
            break;
          case 'Progress': {
            downloaded += event.data.chunkLength;
            const progress = total ? Math.round((downloaded / total) * 100) : null;
            const description = total
              ? `${progress}% of ${(total / 1024 / 1024).toFixed(1)} MB`
              : `${(downloaded / 1024 / 1024).toFixed(1)} MB downloaded`;
            set({ progress });
            toast.loading('Downloading update…', { id: TOAST_ID, description, duration: Infinity });
            break;
          }
          case 'Finished':
            break;
        }
      });

      set({ status: 'ready', progress: null });
      toast.success('Update ready', {
        id: TOAST_ID,
        description: 'Restart the app to apply the update.',
        action: { label: 'Restart now', onClick: () => relaunch() },
        duration: Infinity,
      });
    } catch {
      set({ status: 'error', progress: null });
      toast.error('Update failed', {
        id: TOAST_ID,
        description: 'Could not install the update. Try again later.',
        duration: 8000,
      });
    }
  },
}));

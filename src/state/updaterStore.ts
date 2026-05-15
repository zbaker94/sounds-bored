import { create } from 'zustand';
import { check, Update } from '@tauri-apps/plugin-updater';
import { logError } from '@/lib/logger';

type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  status: UpdaterStatus;
  availableVersion: string | null;
  /** null when content-length header is absent — UI should show indeterminate spinner */
  progress: number | null;
  /** True after at least one check has completed (success or failure) */
  hasChecked: boolean;
  _pendingUpdate: Update | null;

  checkForUpdates: () => Promise<void>;
  install: () => Promise<void>;
}

export const initialUpdaterState: Omit<UpdaterState, 'checkForUpdates' | 'install'> = {
  status: 'idle',
  availableVersion: null,
  progress: null,
  hasChecked: false,
  _pendingUpdate: null,
};

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  ...initialUpdaterState,

  checkForUpdates: async () => {
    if (get().status === 'checking') return;
    set({ status: 'checking', availableVersion: null, progress: null, _pendingUpdate: null });
    try {
      const update = await check();
      if (update?.available) {
        set({ status: 'available', availableVersion: update.version, _pendingUpdate: update, hasChecked: true });
      } else {
        set({ status: 'idle', hasChecked: true });
      }
    } catch (err) {
      logError('updater check failed', err instanceof Error ? err : { error: String(err) });
      set({ status: 'error', hasChecked: true, availableVersion: null, _pendingUpdate: null });
    }
  },

  install: async () => {
    const { _pendingUpdate, status } = get();
    if (!_pendingUpdate || status === 'downloading' || status === 'ready') return;

    let downloaded = 0;
    let total: number | undefined;

    set({ status: 'downloading', progress: null });

    try {
      await _pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? undefined;
            break;
          case 'Progress': {
            downloaded += event.data.chunkLength;
            const progress = total ? Math.round((downloaded / total) * 100) : null;
            set({ progress });
            break;
          }
        }
      });

      set({ status: 'ready', progress: null });
    } catch (err) {
      logError('updater install failed', err instanceof Error ? err : { error: String(err) });
      set({ status: 'error', progress: null });
    }
  },
}));

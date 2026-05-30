import { create } from 'zustand';
import type { AppState, Clip, Profile, Settings, Sound } from '@shared/types';

export type ToastKind = 'info' | 'success' | 'error';

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional auto-dismiss in ms. Errors default to sticky. */
  autoDismissMs?: number;
  /** Up to two inline action buttons (e.g. "Open clips"). */
  actions?: Array<{ label: string; onClick: () => void }>;
};

type Store = AppState & {
  hydrated: boolean;
  playingSoundIds: Set<string>;
  trimSoundId: string | null;
  trimClipId: string | null;
  toasts: Toast[];
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  setProfiles: (profiles: Profile[]) => void;
  setSettings: (settings: Settings) => void;
  setClips: (clips: Clip[]) => void;
  setPlayingSoundIds: (ids: Set<string>) => void;
  setTrimSoundId: (id: string | null) => void;
  setTrimClipId: (id: string | null) => void;
  pushToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
  activeProfile: () => Profile | undefined;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
  updateSoundLocal: (profileId: string, soundId: string, patch: Partial<Sound>) => void;
};

export const useStore = create<Store>((set, get) => ({
  profiles: [],
  settings: {
    virtualMicDeviceId: null,
    monitorDeviceId: null,
    masterVolume: 1,
    stopAllHotkey: null,
    activeProfileId: '',
    restartOnRepress: true,
    viewMode: 'grid',
    theme: 'midnight',
    compactCards: false,
    clipBuffer: {
      enabled: false,
      source: 'system',
      deviceId: null,
      bufferSeconds: 30,
      hotkey: null,
      captureWhenHidden: false,
    },
    clipRetentionHours: 24,
    dismissedWarnings: {},
    micDucking: {
      enabled: false,
      stripIndex: 0,
      duckDb: -12,
    },
    setupComplete: false,
    mixerMode: false,
    realMicDeviceId: null,
  },
  clips: [],
  hydrated: false,
  playingSoundIds: new Set<string>(),
  trimSoundId: null,
  trimClipId: null,
  toasts: [],
  hydrate: async () => {
    const state = await window.api.getState();
    set({ ...state, hydrated: true });
  },
  refresh: async () => {
    const state = await window.api.getState();
    set({ profiles: state.profiles, settings: state.settings, clips: state.clips });
  },
  setProfiles: (profiles) => set({ profiles }),
  setSettings: (settings) => set({ settings }),
  setClips: (clips) => set({ clips }),
  setPlayingSoundIds: (ids) => set({ playingSoundIds: ids }),
  setTrimSoundId: (id) => set({ trimSoundId: id }),
  setTrimClipId: (id) => set({ trimClipId: id }),
  pushToast: (toast) => {
    const id = Math.random().toString(36).slice(2, 10);
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    // 0 (or any non-positive) means "stick until manually dismissed".
    // undefined falls back to a default — errors stick, everything else fades.
    const ms =
      toast.autoDismissMs !== undefined
        ? toast.autoDismissMs
        : toast.kind === 'error'
          ? 0
          : 3500;
    if (ms > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, ms);
    }
    return id;
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  activeProfile: () => {
    const s = get();
    return s.profiles.find((p) => p.id === s.settings.activeProfileId);
  },
  patchSettings: async (patch) => {
    const next = await window.api.updateSettings(patch);
    set({ settings: next });
  },
  updateSoundLocal: (profileId, soundId, patch) => {
    set((s) => ({
      profiles: s.profiles.map((p) =>
        p.id === profileId
          ? { ...p, sounds: p.sounds.map((sn) => (sn.id === soundId ? { ...sn, ...patch } : sn)) }
          : p,
      ),
    }));
  },
}));

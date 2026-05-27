import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  AppState,
  Clip,
  Hotkey,
  HotkeyEvent,
  Profile,
  Settings,
  Sound,
  SoundContextAction,
  UpdateStatus,
  UrlImportProgress,
  VbCableProgress,
} from '../shared/types';

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  showAboutPanel: (): Promise<void> => ipcRenderer.invoke('app:show-about'),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:update', patch),

  createProfile: (name: string): Promise<Profile> =>
    ipcRenderer.invoke('profile:create', name),
  renameProfile: (id: string, name: string): Promise<Profile[]> =>
    ipcRenderer.invoke('profile:rename', id, name),
  updateProfile: (
    id: string,
    patch: {
      name?: string;
      focusFilter?: Profile['focusFilter'];
      autoPtt?: Profile['autoPtt'];
    },
  ): Promise<Profile[]> => ipcRenderer.invoke('profile:update', id, patch),
  listOpenWindows: (): Promise<Array<{ processName: string; title: string }>> =>
    ipcRenderer.invoke('windows:list'),

  notifyPlayingCount: (count: number): Promise<void> =>
    ipcRenderer.invoke('audio:playing-count', count),

  voicemeeterStatus: (): Promise<{ available: boolean; error: string | null }> =>
    ipcRenderer.invoke('voicemeeter:status'),

  detectVbCable: (): Promise<boolean> => ipcRenderer.invoke('vbcable:detect'),
  installVbCable: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('vbcable:install'),
  onVbCableProgress: (handler: (event: VbCableProgress) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, event: VbCableProgress) => handler(event);
    ipcRenderer.on('vbcable-progress', listener);
    return () => ipcRenderer.removeListener('vbcable-progress', listener);
  },
  deleteProfile: (id: string): Promise<Profile[]> =>
    ipcRenderer.invoke('profile:delete', id),

  importSoundsDialog: (profileId: string): Promise<Sound[]> =>
    ipcRenderer.invoke('sound:import-dialog', profileId),
  importSoundsByPath: (profileId: string, paths: string[]): Promise<Sound[]> =>
    ipcRenderer.invoke('sound:import-paths', profileId, paths),
  updateSound: (
    profileId: string,
    soundId: string,
    patch: Partial<Sound>,
  ): Promise<Profile[]> => ipcRenderer.invoke('sound:update', profileId, soundId, patch),
  removeSound: (profileId: string, soundId: string): Promise<Profile[]> =>
    ipcRenderer.invoke('sound:remove', profileId, soundId),
  restoreSound: (
    profileId: string,
    sound: Sound,
    atIndex?: number,
  ): Promise<Profile[]> =>
    ipcRenderer.invoke('sound:restore', profileId, sound, atIndex),

  captureHotkey: (): Promise<Hotkey> => ipcRenderer.invoke('hotkey:capture'),
  cancelCapture: (): Promise<void> => ipcRenderer.invoke('hotkey:cancel-capture'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-external', url),

  exportProfile: (profileId: string, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('profile:export', profileId, suggestedName),

  importProfile: (): Promise<{ profile: Profile; profiles: Profile[] } | null> =>
    ipcRenderer.invoke('profile:import'),

  readSoundBytes: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('sound:read-bytes', filePath),

  duplicateSound: (profileId: string, soundId: string): Promise<Profile[]> =>
    ipcRenderer.invoke('sound:duplicate', profileId, soundId),

  reorderSounds: (profileId: string, from: number, to: number): Promise<Profile[]> =>
    ipcRenderer.invoke('sound:reorder', profileId, from, to),

  replaceSoundAudio: (
    profileId: string,
    soundId: string,
    bytes: Uint8Array,
    ext: string,
  ): Promise<Profile[]> =>
    ipcRenderer.invoke('sound:replace-audio', profileId, soundId, bytes, ext),

  saveClipAsSound: (
    profileId: string,
    bytes: Uint8Array,
    ext: string,
    name: string,
  ): Promise<{ sound: Sound; profiles: Profile[] }> =>
    ipcRenderer.invoke('sound:save-clip', profileId, bytes, ext, name),

  addClip: (
    bytes: Uint8Array,
    ext: string,
    durationSeconds: number,
    name?: string,
  ): Promise<{ clip: Clip; clips: Clip[] }> =>
    ipcRenderer.invoke('clip:add', bytes, ext, durationSeconds, name),

  listClips: (): Promise<Clip[]> => ipcRenderer.invoke('clip:list'),

  removeClip: (clipId: string): Promise<Clip[]> =>
    ipcRenderer.invoke('clip:remove', clipId),

  clearAllClips: (): Promise<Clip[]> => ipcRenderer.invoke('clip:clear-all'),

  expireOldClips: (): Promise<Clip[]> => ipcRenderer.invoke('clip:expire-old'),

  trimClipToSound: (
    clipId: string,
    profileId: string,
    bytes: Uint8Array,
    ext: string,
    name: string,
  ): Promise<{ sound: Sound; profiles: Profile[]; clips: Clip[] }> =>
    ipcRenderer.invoke('clip:trim-to-sound', clipId, profileId, bytes, ext, name),

  showInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('shell:show-in-folder', filePath),

  showSoundContextMenu: (
    sourceProfileId?: string,
  ): Promise<SoundContextAction | null> =>
    ipcRenderer.invoke('sound:show-context-menu', sourceProfileId),

  moveSound: (
    fromProfileId: string,
    soundId: string,
    toProfileId: string,
  ): Promise<Profile[]> =>
    ipcRenderer.invoke('sound:move', fromProfileId, soundId, toProfileId),

  isUrlImportAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('url:is-available'),

  ensureUrlImportBinary: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('url:ensure-binary'),

  importFromUrl: (profileId: string, url: string): Promise<Sound> =>
    ipcRenderer.invoke('sound:import-url', profileId, url),

  onUrlImportProgress: (
    handler: (event: UrlImportProgress) => void,
  ): (() => void) => {
    const listener = (_: IpcRendererEvent, event: UrlImportProgress) =>
      handler(event);
    ipcRenderer.on('url-import-progress', listener);
    return () => ipcRenderer.removeListener('url-import-progress', listener);
  },

  onHotkey: (handler: (event: HotkeyEvent) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, event: HotkeyEvent) => handler(event);
    ipcRenderer.on('hotkey-event', listener);
    return () => ipcRenderer.removeListener('hotkey-event', listener);
  },

  onUpdateStatus: (handler: (event: UpdateStatus) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, event: UpdateStatus) => handler(event);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);

import { app, ipcMain, dialog, BrowserWindow, shell, Menu } from 'electron';
import { readFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { basename, extname } from 'node:path';
import type {
  Clip,
  Hotkey,
  HotkeyEvent,
  Profile,
  Sound,
  SoundContextAction,
} from '../shared/types';
import {
  addClipFromBytes,
  addProfileFromBundle,
  addSound,
  clearAllClips,
  createProfile,
  createSoundFromBytes,
  deleteProfile,
  duplicateSound,
  expireOldClips,
  getClips,
  getState,
  removeClip,
  removeSound,
  restoreSound,
  renameProfile,
  reorderSounds,
  replaceSoundAudio,
  setSettings,
  trimClipToSound,
  updateProfile,
  updateSound,
} from './storage';
import { importAudioFile } from './file-import';
import { ensureYtDlp, importFromUrl, isYtDlpAvailable } from './url-import';
import { installVbCable, vbCableLikelyPresent } from './vb-cable';
import { exportProfile, importProfileBundle } from './profile-io';
import {
  captureNextHotkey,
  cancelCapture,
  onPress,
  onRelease,
} from './hotkeys';
import type { InputEvent as SbInputEvent } from '../shared/types';
import {
  listOpenWindows,
  matchesForeground,
  startForegroundPolling,
  stopForegroundPolling,
} from './foreground';
import { autoPttController } from './auto-ptt';
import { micDuckingController } from './mic-ducking';

let activeBindings: Array<() => void> = [];

function clearBindings() {
  for (const off of activeBindings) off();
  activeBindings = [];
}

// Hash hotkeys and input events into the same string space so dispatch is a
// single Map lookup instead of an O(N) loop over per-sound listeners. Keycode
// for keyboards, button for mouse, plus the four modifier bits.
type Action =
  | { kind: 'sound-press'; soundId: string; gated: boolean }
  | { kind: 'sound-release'; soundId: string; gated: boolean }
  | { kind: 'stop-all' }
  | { kind: 'clip-save' };

function modBits(h: {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}): string {
  return `${h.ctrl ? 1 : 0}${h.alt ? 1 : 0}${h.shift ? 1 : 0}${h.meta ? 1 : 0}`;
}
function hashHotkey(h: Hotkey): string | null {
  const kind = h.kind ?? 'keyboard';
  if (kind === 'mouse') {
    if (h.button === undefined) return null;
    return `mb:${h.button}:${modBits(h)}`;
  }
  if (h.keycode === undefined) return null;
  return `kb:${h.keycode}:${modBits(h)}`;
}
function hashEvent(e: SbInputEvent): string {
  if (e.kind === 'mouse') return `mb:${e.button}:${modBits(e)}`;
  return `kb:${e.keycode}:${modBits(e)}`;
}

function rebindHotkeys(window: BrowserWindow) {
  clearBindings();
  const { profiles, settings } = getState();
  const profile = profiles.find((p) => p.id === settings.activeProfileId);

  const send = (event: HotkeyEvent) => {
    if (!window.isDestroyed()) window.webContents.send('hotkey-event', event);
  };

  const focusFilter = profile?.focusFilter?.processName ?? null;
  const gate = () => matchesForeground(focusFilter);

  // Only run the foreground poller when something actually consumes its
  // output. The active profile reads it via `gate()` and auto-PTT reads it
  // via `getForegroundProcessName()` — if neither feature is configured on
  // the active profile, the 500 ms poll is pure overhead.
  const needsForeground = !!focusFilter || !!profile?.autoPtt;
  if (needsForeground) {
    void startForegroundPolling();
  } else {
    stopForegroundPolling();
  }

  const press = new Map<string, Action[]>();
  const release = new Map<string, Action[]>();
  const push = (m: Map<string, Action[]>, hash: string, a: Action) => {
    const arr = m.get(hash);
    if (arr) arr.push(a);
    else m.set(hash, [a]);
  };

  if (profile) {
    for (const sound of profile.sounds) {
      if (!sound.hotkey) continue;
      const h = hashHotkey(sound.hotkey);
      if (!h) continue;
      push(press, h, { kind: 'sound-press', soundId: sound.id, gated: true });
      if (sound.mode === 'hold') {
        push(release, h, { kind: 'sound-release', soundId: sound.id, gated: true });
      }
    }
  }

  if (settings.stopAllHotkey) {
    const h = hashHotkey(settings.stopAllHotkey);
    if (h) push(press, h, { kind: 'stop-all' });
  }

  if (settings.clipBuffer?.enabled && settings.clipBuffer.hotkey) {
    const h = hashHotkey(settings.clipBuffer.hotkey);
    if (h) push(press, h, { kind: 'clip-save' });
  }

  // Single press/release listener — O(1) Map lookup per keystroke regardless
  // of how many sounds are bound. Stop-all and clip-save are not gated by the
  // profile's focus filter; sound triggers are.
  activeBindings.push(
    onPress((e) => {
      const actions = press.get(hashEvent(e));
      if (!actions) return;
      let gateChecked = false;
      let gateOk = false;
      for (const a of actions) {
        if (a.kind === 'stop-all') {
          send({ type: 'stop-all' });
        } else if (a.kind === 'clip-save') {
          send({ type: 'clip-save' });
        } else if (a.kind === 'sound-press') {
          if (!gateChecked) {
            gateOk = gate();
            gateChecked = true;
          }
          if (gateOk) send({ type: 'sound-down', soundId: a.soundId });
        }
      }
    }),
  );
  activeBindings.push(
    onRelease((e) => {
      const actions = release.get(hashEvent(e));
      if (!actions) return;
      let gateChecked = false;
      let gateOk = false;
      for (const a of actions) {
        if (a.kind === 'sound-release') {
          if (!gateChecked) {
            gateOk = gate();
            gateChecked = true;
          }
          if (gateOk) send({ type: 'sound-up', soundId: a.soundId });
        }
      }
    }),
  );
}

export function registerIpc(window: BrowserWindow): void {
  ipcMain.handle('state:get', () => getState());

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:show-about', () => app.showAboutPanel());

  ipcMain.handle('settings:update', (_, patch) => {
    const next = setSettings(patch);
    rebindHotkeys(window);
    autoPttController.onProfileChanged();
    micDuckingController.onSettingsChanged();
    return next;
  });

  ipcMain.handle('profile:create', (_, name: string) => {
    const p = createProfile(name);
    autoPttController.onProfileChanged();
    return p;
  });

  ipcMain.handle('audio:playing-count', (_, count: number) => {
    autoPttController.onPlayingCountChanged(count);
    micDuckingController.onPlayingCountChanged(count);
  });

  ipcMain.handle('voicemeeter:status', () => micDuckingController.status());
  ipcMain.handle('profile:rename', (_, id: string, name: string) => renameProfile(id, name));
  ipcMain.handle(
    'profile:update',
    (
      _,
      id: string,
      patch: Partial<{
        name: string;
        focusFilter: Profile['focusFilter'];
        autoPtt: Profile['autoPtt'];
      }>,
    ) => {
      const profiles = updateProfile(id, patch);
      rebindHotkeys(window);
      autoPttController.onProfileChanged();
      return profiles;
    },
  );
  ipcMain.handle('profile:delete', (_, id: string) => {
    const profiles = deleteProfile(id);
    rebindHotkeys(window);
    return profiles;
  });

  ipcMain.handle('sound:import-dialog', async (_, profileId: string): Promise<Sound[]> => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Add sounds',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'webm'] },
      ],
    });
    if (result.canceled) return [];
    const added: Sound[] = [];
    for (const path of result.filePaths) {
      const sound = importAudioFile(profileId, path);
      addSound(profileId, sound);
      added.push(sound);
    }
    rebindHotkeys(window);
    return added;
  });

  ipcMain.handle('sound:import-paths', (_, profileId: string, paths: string[]): Sound[] => {
    const added: Sound[] = [];
    for (const path of paths) {
      const sound = importAudioFile(profileId, path);
      addSound(profileId, sound);
      added.push(sound);
    }
    rebindHotkeys(window);
    return added;
  });

  ipcMain.handle(
    'sound:update',
    (_, profileId: string, soundId: string, patch: Partial<Sound>) => {
      const profiles = updateSound(profileId, soundId, patch);
      rebindHotkeys(window);
      return profiles;
    },
  );

  ipcMain.handle('sound:remove', (_, profileId: string, soundId: string) => {
    const profiles = removeSound(profileId, soundId);
    rebindHotkeys(window);
    return profiles;
  });

  ipcMain.handle(
    'sound:restore',
    (_, profileId: string, sound: Sound, atIndex?: number) => {
      const profiles = restoreSound(profileId, sound, atIndex);
      rebindHotkeys(window);
      return profiles;
    },
  );

  ipcMain.handle('hotkey:capture', (): Promise<Hotkey> => captureNextHotkey());
  ipcMain.handle('hotkey:cancel-capture', () => {
    cancelCapture();
  });

  ipcMain.handle('shell:open-external', (_, url: string) => shell.openExternal(url));

  ipcMain.handle('windows:list', () => listOpenWindows());

  ipcMain.handle('vbcable:detect', () => vbCableLikelyPresent());

  ipcMain.handle('vbcable:install', async (event) => {
    const sender = event.sender;
    return installVbCable((p) => {
      if (!sender.isDestroyed()) sender.send('vbcable-progress', p);
    });
  });

  ipcMain.handle(
    'profile:export',
    async (_, profileId: string, suggestedName: string) => {
      const result = await dialog.showSaveDialog(window, {
        title: 'Export soundboard',
        defaultPath: `${suggestedName.replace(/[^a-zA-Z0-9 _-]/g, '')}.zip`,
        filters: [{ name: 'Soundboard bundle', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return null;
      await exportProfile(profileId, result.filePath);
      return result.filePath;
    },
  );

  ipcMain.handle('profile:import', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Import soundboard',
      properties: ['openFile'],
      filters: [{ name: 'Soundboard bundle', extensions: ['zip'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const newProfile = await importProfileBundle(result.filePaths[0]);
    addProfileFromBundle(newProfile);
    setSettings({ activeProfileId: newProfile.id });
    rebindHotkeys(window);
    return { profile: newProfile, profiles: getState().profiles };
  });

  ipcMain.handle('sound:read-bytes', async (_, filePath: string): Promise<Uint8Array> => {
    const buf = await readFile(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  ipcMain.handle(
    'sound:duplicate',
    (_, profileId: string, soundId: string) => {
      const profiles = duplicateSound(profileId, soundId);
      rebindHotkeys(window);
      return profiles;
    },
  );

  ipcMain.handle(
    'sound:reorder',
    (_, profileId: string, from: number, to: number) => {
      const profiles = reorderSounds(profileId, from, to);
      return profiles;
    },
  );

  ipcMain.handle(
    'sound:replace-audio',
    (_, profileId: string, soundId: string, bytes: Uint8Array, ext: string) => {
      const profiles = replaceSoundAudio(profileId, soundId, bytes, ext);
      return profiles;
    },
  );

  ipcMain.handle(
    'sound:save-clip',
    (_, profileId: string, bytes: Uint8Array, ext: string, name: string) => {
      const result = createSoundFromBytes(profileId, bytes, ext, name);
      rebindHotkeys(window);
      return result;
    },
  );

  // Clip drawer — staging area for raw captures before they become sounds.
  ipcMain.handle(
    'clip:add',
    (_, bytes: Uint8Array, ext: string, durationSeconds: number, name?: string) => {
      return addClipFromBytes(bytes, ext, durationSeconds, name);
    },
  );

  ipcMain.handle('clip:list', () => getClips());

  ipcMain.handle('clip:remove', (_, clipId: string) => removeClip(clipId));

  ipcMain.handle('clip:clear-all', () => clearAllClips());

  ipcMain.handle('clip:expire-old', () => expireOldClips());

  ipcMain.handle(
    'clip:trim-to-sound',
    (
      _,
      clipId: string,
      profileId: string,
      bytes: Uint8Array,
      ext: string,
      name: string,
    ) => {
      const result = trimClipToSound(clipId, profileId, bytes, ext, name);
      rebindHotkeys(window);
      return result;
    },
  );


  ipcMain.handle('shell:show-in-folder', (_, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('url:is-available', () => isYtDlpAvailable());

  ipcMain.handle('url:ensure-binary', async (event) => {
    const sender = event.sender;
    try {
      await ensureYtDlp((percent) => {
        if (!sender.isDestroyed())
          sender.send('url-import-progress', { kind: 'progress', percent });
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'sound:import-url',
    async (event, profileId: string, url: string): Promise<Sound> => {
      const sender = event.sender;
      const send = (channel: string, payload: unknown) => {
        if (!sender.isDestroyed()) sender.send(channel, payload);
      };
      const { filePath, title } = await importFromUrl(profileId, url, (p) => {
        send('url-import-progress', p);
      });
      const ext = extname(filePath);
      const fallbackName = basename(filePath, ext) || 'Downloaded sound';
      const sound: Sound = {
        id: nanoid(),
        name: title || fallbackName,
        filePath,
        hotkey: null,
        volume: 1,
        pitch: 1,
        mode: 'oneshot',
      };
      addSound(profileId, sound);
      rebindHotkeys(window);
      return sound;
    },
  );

  ipcMain.handle(
    'sound:show-context-menu',
    (event): Promise<SoundContextAction | null> => {
      return new Promise((resolve) => {
        let action: SoundContextAction | null = null;
        const menu = Menu.buildFromTemplate([
          { label: 'Rename', click: () => (action = 'rename') },
          { label: 'Duplicate', click: () => (action = 'duplicate') },
          { label: 'Trim…', click: () => (action = 'trim') },
          { type: 'separator' },
          { label: 'Show in folder', click: () => (action = 'show-in-folder') },
          { type: 'separator' },
          { label: 'Remove', click: () => (action = 'remove') },
        ]);
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) {
          resolve(null);
          return;
        }
        menu.popup({
          window: win,
          callback: () => resolve(action),
        });
      });
    },
  );

  rebindHotkeys(window);
}

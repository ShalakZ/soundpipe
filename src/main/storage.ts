import Store from 'electron-store';
import { app } from 'electron';
import { mkdirSync, existsSync, copyFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { nanoid } from 'nanoid';
import type { AppState, Clip, Profile, Settings, Sound } from '../shared/types';

const DEFAULT_PROFILE_ID = 'default';

const defaultSettings: Settings = {
  virtualMicDeviceId: null,
  monitorDeviceId: null,
  masterVolume: 1,
  stopAllHotkey: null,
  activeProfileId: DEFAULT_PROFILE_ID,
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
};

const defaultState: AppState = {
  profiles: [
    {
      id: DEFAULT_PROFILE_ID,
      name: 'Default',
      sounds: [],
    },
  ],
  settings: defaultSettings,
  clips: [],
};

const store = new Store<AppState>({
  name: 'soundpipe',
  defaults: defaultState,
});

export function soundsDir(profileId: string): string {
  const dir = join(app.getPath('userData'), 'sounds', profileId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function clipsDir(): string {
  const dir = join(app.getPath('userData'), 'clips');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getState(): AppState {
  const saved = store.get('settings', defaultState.settings);
  return {
    profiles: store.get('profiles', defaultState.profiles),
    settings: {
      ...defaultSettings,
      ...saved,
      // Deep-merge nested objects so newly-added fields get sane defaults
      // even when the user has an older saved settings blob.
      clipBuffer: { ...defaultSettings.clipBuffer, ...(saved.clipBuffer ?? {}) },
      dismissedWarnings: {
        ...defaultSettings.dismissedWarnings,
        ...(saved.dismissedWarnings ?? {}),
      },
      micDucking: {
        ...defaultSettings.micDucking,
        ...(saved.micDucking ?? {}),
      } as Settings['micDucking'],
    },
    clips: store.get('clips', defaultState.clips),
  };
}

function writeClips(clips: Clip[]) {
  store.set('clips', clips);
}

export function getClips(): Clip[] {
  return store.get('clips', defaultState.clips);
}

export function addClipFromBytes(
  bytes: Uint8Array,
  ext: string,
  durationSeconds: number,
  name?: string,
): { clip: Clip; clips: Clip[] } {
  const id = nanoid();
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  const filePath = join(clipsDir(), `${id}${cleanExt}`);
  writeFileSync(filePath, bytes);
  const clip: Clip = {
    id,
    name: name ?? defaultClipName(),
    filePath,
    capturedAt: Date.now(),
    durationSeconds,
  };
  const clips = [clip, ...getClips()];
  writeClips(clips);
  return { clip, clips };
}

export function removeClip(clipId: string): Clip[] {
  const clips = getClips();
  const target = clips.find((c) => c.id === clipId);
  if (target) {
    try {
      unlinkSync(target.filePath);
    } catch {
      /* file already gone */
    }
  }
  const next = clips.filter((c) => c.id !== clipId);
  writeClips(next);
  return next;
}

export function clearAllClips(): Clip[] {
  const clips = getClips();
  for (const c of clips) {
    try {
      unlinkSync(c.filePath);
    } catch {
      /* ignore */
    }
  }
  writeClips([]);
  return [];
}

export function expireOldClips(): Clip[] {
  const retentionHours = getState().settings.clipRetentionHours;
  if (retentionHours <= 0) return getClips();
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  const clips = getClips();
  const keep: Clip[] = [];
  for (const c of clips) {
    if (c.capturedAt >= cutoff) {
      keep.push(c);
    } else {
      try {
        unlinkSync(c.filePath);
      } catch {
        /* ignore */
      }
    }
  }
  if (keep.length !== clips.length) writeClips(keep);
  return keep;
}

function defaultClipName(): string {
  const d = new Date();
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Clip ${month} ${day} ${hh}:${mm}`;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getState().settings, ...patch };
  store.set('settings', next);
  return next;
}

export function getProfiles(): Profile[] {
  return store.get('profiles', defaultState.profiles);
}

function writeProfiles(profiles: Profile[]) {
  store.set('profiles', profiles);
}

export function createProfile(name: string): Profile {
  const profile: Profile = { id: nanoid(), name, sounds: [] };
  writeProfiles([...getProfiles(), profile]);
  soundsDir(profile.id);
  return profile;
}

/**
 * Adds an already-constructed Profile (e.g. from importProfileBundle) to
 * storage. The caller is expected to have set up `sounds[*].filePath` already.
 */
export function addProfileFromBundle(profile: Profile): Profile {
  writeProfiles([...getProfiles(), profile]);
  return profile;
}

export function renameProfile(profileId: string, name: string): Profile[] {
  const profiles = getProfiles().map((p) => (p.id === profileId ? { ...p, name } : p));
  writeProfiles(profiles);
  return profiles;
}

export function updateProfile(
  profileId: string,
  patch: Partial<Pick<Profile, 'name' | 'focusFilter' | 'autoPtt'>>,
): Profile[] {
  const profiles = getProfiles().map((p) =>
    p.id === profileId ? { ...p, ...patch } : p,
  );
  writeProfiles(profiles);
  return profiles;
}

export function deleteProfile(profileId: string): Profile[] {
  const profiles = getProfiles().filter((p) => p.id !== profileId);
  const safe = profiles.length
    ? profiles
    : [{ id: DEFAULT_PROFILE_ID, name: 'Default', sounds: [] }];
  writeProfiles(safe);
  const s = getState().settings;
  if (s.activeProfileId === profileId) {
    setSettings({ activeProfileId: safe[0].id });
  }
  return safe;
}

export function addSound(profileId: string, sound: Sound): Profile[] {
  const profiles = getProfiles().map((p) =>
    p.id === profileId ? { ...p, sounds: [...p.sounds, sound] } : p,
  );
  writeProfiles(profiles);
  return profiles;
}

export function updateSound(
  profileId: string,
  soundId: string,
  patch: Partial<Sound>,
): Profile[] {
  const profiles = getProfiles().map((p) =>
    p.id === profileId
      ? {
          ...p,
          sounds: p.sounds.map((s) => (s.id === soundId ? { ...s, ...patch } : s)),
        }
      : p,
  );
  writeProfiles(profiles);
  return profiles;
}

export function removeSound(profileId: string, soundId: string): Profile[] {
  const profiles = getProfiles().map((p) =>
    p.id === profileId ? { ...p, sounds: p.sounds.filter((s) => s.id !== soundId) } : p,
  );
  writeProfiles(profiles);
  return profiles;
}

// Re-inserts a previously-removed sound. Used by the renderer's undo toast.
// removeSound() does not unlink the underlying file, so the original filePath
// is typically still valid during a short undo window.
export function restoreSound(
  profileId: string,
  sound: Sound,
  atIndex?: number,
): Profile[] {
  const profiles = getProfiles().map((p) => {
    if (p.id !== profileId) return p;
    if (p.sounds.some((s) => s.id === sound.id)) return p;
    const sounds = [...p.sounds];
    const idx =
      typeof atIndex === 'number' && atIndex >= 0 && atIndex <= sounds.length
        ? atIndex
        : sounds.length;
    sounds.splice(idx, 0, sound);
    return { ...p, sounds };
  });
  writeProfiles(profiles);
  return profiles;
}

export function duplicateSound(profileId: string, soundId: string): Profile[] {
  const profiles = getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return profiles;
  const original = profile.sounds.find((s) => s.id === soundId);
  if (!original) return profiles;

  const newId = nanoid();
  const ext = extname(original.filePath);
  const newPath = join(soundsDir(profileId), `${newId}${ext}`);
  copyFileSync(original.filePath, newPath);

  const duplicate: Sound = {
    ...original,
    id: newId,
    name: `${original.name} (copy)`,
    filePath: newPath,
    hotkey: null, // copies don't inherit hotkeys to avoid binding conflicts
  };
  const idx = profile.sounds.findIndex((s) => s.id === soundId);
  const newSounds = [...profile.sounds];
  newSounds.splice(idx + 1, 0, duplicate);

  const next = profiles.map((p) =>
    p.id === profileId ? { ...p, sounds: newSounds } : p,
  );
  writeProfiles(next);
  return next;
}

export function trimClipToSound(
  clipId: string,
  profileId: string,
  bytes: Uint8Array,
  ext: string,
  name: string,
): { sound: Sound; profiles: Profile[]; clips: Clip[] } {
  const { sound, profiles } = createSoundFromBytes(profileId, bytes, ext, name);
  const clips = removeClip(clipId);
  return { sound, profiles, clips };
}

export function createSoundFromBytes(
  profileId: string,
  bytes: Uint8Array,
  ext: string,
  name: string,
): { sound: Sound; profiles: Profile[] } {
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  const id = nanoid();
  const filePath = join(soundsDir(profileId), `${id}${cleanExt}`);
  writeFileSync(filePath, bytes);
  const sound: Sound = {
    id,
    name,
    filePath,
    hotkey: null,
    volume: 1,
    pitch: 1,
    mode: 'oneshot',
  };
  const profiles = getProfiles().map((p) =>
    p.id === profileId ? { ...p, sounds: [...p.sounds, sound] } : p,
  );
  writeProfiles(profiles);
  return { sound, profiles };
}

export function replaceSoundAudio(
  profileId: string,
  soundId: string,
  bytes: Uint8Array,
  ext: string,
): Profile[] {
  const profiles = getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return profiles;
  const sound = profile.sounds.find((s) => s.id === soundId);
  if (!sound) return profiles;

  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  const newId = nanoid();
  const newPath = join(soundsDir(profileId), `${newId}${cleanExt}`);
  writeFileSync(newPath, bytes);

  const oldPath = sound.filePath;
  const next = profiles.map((p) =>
    p.id === profileId
      ? {
          ...p,
          sounds: p.sounds.map((s) =>
            s.id === soundId ? { ...s, filePath: newPath } : s,
          ),
        }
      : p,
  );
  writeProfiles(next);

  // Best-effort: clean up the old file. Don't fail if it's already gone.
  if (oldPath && oldPath !== newPath) {
    try {
      unlinkSync(oldPath);
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function reorderSounds(
  profileId: string,
  fromIndex: number,
  toIndex: number,
): Profile[] {
  const profiles = getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return profiles;
  if (
    fromIndex < 0 ||
    fromIndex >= profile.sounds.length ||
    toIndex < 0 ||
    toIndex >= profile.sounds.length ||
    fromIndex === toIndex
  ) {
    return profiles;
  }
  const sounds = [...profile.sounds];
  const [moved] = sounds.splice(fromIndex, 1);
  sounds.splice(toIndex, 0, moved);
  const next = profiles.map((p) =>
    p.id === profileId ? { ...p, sounds } : p,
  );
  writeProfiles(next);
  return next;
}

export { DEFAULT_PROFILE_ID };

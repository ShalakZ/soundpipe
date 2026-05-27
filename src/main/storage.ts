import Store from 'electron-store';
import { app } from 'electron';
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  readdirSync,
  rmdirSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import { nanoid } from 'nanoid';
import type { AppState, Clip, Profile, Settings, Sound } from '../shared/types';

const DEFAULT_PROFILE_ID = 'default';

// ─── friendly-name helpers ────────────────────────────────────────────────
// Profile folders and sound files live under userData/sounds/. Until sprint
// 14 we used nanoids for both (cryptic when the user clicked "Show in
// folder"). These helpers turn user-chosen names into safe filesystem names
// — stripping the chars Windows refuses, dodging reserved names like CON/PRN
// /COM1, truncating overlong inputs — and resolve collisions by appending
// " (2)", " (3)", … until a free name is found.

const RESERVED_WIN = new Set<string>([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

function sanitizeForFilename(raw: string, fallback: string): string {
  let safe = (raw ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  // Windows refuses trailing dots/spaces.
  safe = safe.replace(/[. ]+$/, '');
  if (!safe) safe = fallback;
  if (safe.length > 80) safe = safe.slice(0, 80).trimEnd();
  const stem = safe.toUpperCase().split('.')[0];
  if (RESERVED_WIN.has(stem)) safe = `_${safe}`;
  return safe;
}

function pickUnique(base: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!isTaken(candidate)) return candidate;
  }
  // Fallback only if there are literally hundreds of dup names.
  return `${base} (${nanoid(4)})`;
}

function uniqueProfileFolder(name: string, excludeProfileId?: string): string {
  const safe = sanitizeForFilename(name, 'Soundboard');
  const taken = new Set(
    getProfiles()
      .filter((p) => p.id !== excludeProfileId)
      .map((p) => (p.folderName ?? p.id).toLowerCase()),
  );
  return pickUnique(safe, (c) => taken.has(c.toLowerCase()));
}

function uniqueSoundFilename(
  profile: Profile,
  rawName: string,
  ext: string,
  excludeSoundId?: string,
): string {
  const stem = sanitizeForFilename(rawName, 'sound');
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  const taken = new Set(
    profile.sounds
      .filter((s) => s.id !== excludeSoundId)
      .map((s) => basename(s.filePath).toLowerCase()),
  );
  const picked = pickUnique(stem, (c) => taken.has((c + cleanExt).toLowerCase()));
  return picked + cleanExt;
}

// Exported alias for callers in other modules (file-import, url-import).
export const buildUniqueSoundFilename = uniqueSoundFilename;

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

function soundsRoot(): string {
  return join(app.getPath('userData'), 'sounds');
}

export function soundsDir(profileId: string): string {
  const profile = getProfiles().find((p) => p.id === profileId);
  const folder = profile?.folderName ?? profileId;
  const dir = join(soundsRoot(), folder);
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
  const profile: Profile = {
    id: nanoid(),
    name,
    sounds: [],
    folderName: uniqueProfileFolder(name),
  };
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
  return updateProfile(profileId, { name });
}

export function updateProfile(
  profileId: string,
  patch: Partial<Pick<Profile, 'name' | 'focusFilter' | 'autoPtt'>>,
): Profile[] {
  const profiles = getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return profiles;

  // If the name is changing, also rename the on-disk folder + update every
  // sound's filePath. Done before the store write so any rename failure
  // leaves the store consistent with disk.
  let renamedFolder: string | null = null;
  let renamedSounds: Sound[] | null = null;
  if (patch.name && patch.name !== profile.name) {
    const oldFolder = profile.folderName ?? profile.id;
    const oldDir = join(soundsRoot(), oldFolder);
    const newFolder = uniqueProfileFolder(patch.name, profileId);
    if (newFolder !== oldFolder) {
      const newDir = join(soundsRoot(), newFolder);
      try {
        if (existsSync(oldDir)) {
          renameSync(oldDir, newDir);
        } else {
          mkdirSync(newDir, { recursive: true });
        }
        renamedFolder = newFolder;
        renamedSounds = profile.sounds.map((s) => ({
          ...s,
          filePath: join(newDir, basename(s.filePath)),
        }));
      } catch (err) {
        console.warn('[storage] profile folder rename failed:', err);
        // fall through with patch only — name updates, folder stays old
      }
    }
  }

  const next = profiles.map((p) => {
    if (p.id !== profileId) return p;
    const merged: Profile = { ...p, ...patch };
    if (renamedFolder) merged.folderName = renamedFolder;
    if (renamedSounds) merged.sounds = renamedSounds;
    return merged;
  });
  writeProfiles(next);
  return next;
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
  const profiles = getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return profiles;
  const sound = profile.sounds.find((s) => s.id === soundId);
  if (!sound) return profiles;

  // Rename the on-disk file when the user-visible name changes. If the rename
  // fails we keep the old filePath so the store stays consistent with disk.
  let renamedPath: string | null = null;
  if (patch.name && patch.name !== sound.name) {
    const ext = extname(sound.filePath);
    const newName = uniqueSoundFilename(profile, patch.name, ext, soundId);
    const newPath = join(soundsDir(profileId), newName);
    if (newPath !== sound.filePath && existsSync(sound.filePath)) {
      try {
        renameSync(sound.filePath, newPath);
        renamedPath = newPath;
      } catch (err) {
        console.warn('[storage] sound file rename failed:', err);
      }
    }
  }

  const next = profiles.map((p) =>
    p.id === profileId
      ? {
          ...p,
          sounds: p.sounds.map((s) =>
            s.id === soundId
              ? { ...s, ...patch, ...(renamedPath ? { filePath: renamedPath } : {}) }
              : s,
          ),
        }
      : p,
  );
  writeProfiles(next);
  return next;
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

/**
 * Move a sound from one profile to another. Renames the file across folders
 * (with collision resolution against the target profile's existing sounds)
 * and removes the entry from the source profile. The sound keeps its id,
 * name, hotkey, volume, etc. — only the parent profile + filePath change.
 */
export function moveSound(
  fromProfileId: string,
  soundId: string,
  toProfileId: string,
): Profile[] {
  const profiles = getProfiles();
  if (fromProfileId === toProfileId) return profiles;
  const fromProfile = profiles.find((p) => p.id === fromProfileId);
  const toProfile = profiles.find((p) => p.id === toProfileId);
  if (!fromProfile || !toProfile) return profiles;
  const sound = fromProfile.sounds.find((s) => s.id === soundId);
  if (!sound) return profiles;

  const ext = extname(sound.filePath);
  const filename = uniqueSoundFilename(toProfile, sound.name, ext);
  const newPath = join(soundsDir(toProfileId), filename);

  try {
    if (existsSync(sound.filePath) && sound.filePath !== newPath) {
      renameSync(sound.filePath, newPath);
    }
  } catch (err) {
    console.warn('[storage] moveSound rename failed:', err);
    return profiles; // bail out without touching the store
  }

  const movedSound: Sound = { ...sound, filePath: newPath };
  const next = profiles.map((p) => {
    if (p.id === fromProfileId) {
      return { ...p, sounds: p.sounds.filter((s) => s.id !== soundId) };
    }
    if (p.id === toProfileId) {
      return { ...p, sounds: [...p.sounds, movedSound] };
    }
    return p;
  });
  writeProfiles(next);
  return next;
}

export function duplicateSound(profileId: string, soundId: string): Profile[] {
  const profiles = getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return profiles;
  const original = profile.sounds.find((s) => s.id === soundId);
  if (!original) return profiles;

  const newId = nanoid();
  const ext = extname(original.filePath);
  const newName = `${original.name} (copy)`;
  const filename = uniqueSoundFilename(profile, newName, ext);
  const newPath = join(soundsDir(profileId), filename);
  copyFileSync(original.filePath, newPath);

  const duplicate: Sound = {
    ...original,
    id: newId,
    name: newName,
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
  const id = nanoid();
  const profiles = getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  const filename = profile
    ? uniqueSoundFilename(profile, name, ext)
    : `${sanitizeForFilename(name, 'sound')}${ext.startsWith('.') ? ext : `.${ext}`}`;
  const filePath = join(soundsDir(profileId), filename);
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
  const next = profiles.map((p) =>
    p.id === profileId ? { ...p, sounds: [...p.sounds, sound] } : p,
  );
  writeProfiles(next);
  return { sound, profiles: next };
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

  const filename = uniqueSoundFilename(profile, sound.name, ext, soundId);
  const newPath = join(soundsDir(profileId), filename);
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

/**
 * One-shot migration: rename id-keyed profile folders + nanoid-keyed sound
 * files to human-readable names. Pre-sprint-14 data uses `sounds/<nanoid>/
 * <nanoid>.<ext>`; after this runs, everything reads like
 * `sounds/Default/Skull crusher.wav`.
 *
 * Idempotent — gated by `settings.friendlyNamesMigrated`. Each rename is
 * try/catch'd individually so a single failing file doesn't stop the rest.
 * Persists updated paths to the store at the end.
 */
export function migrateToFriendlyNames(): void {
  const s = getState().settings;
  if (s.friendlyNamesMigrated) return;

  const profiles = getProfiles();
  const updatedProfiles: Profile[] = profiles.map((profile) => {
    const targetFolder = uniqueProfileFolder(profile.name, profile.id);
    const oldFolder = profile.folderName ?? profile.id;
    const oldDir = join(soundsRoot(), oldFolder);
    const newDir = join(soundsRoot(), targetFolder);

    // Rename the folder if needed.
    let folderRenamed = oldFolder;
    if (targetFolder !== oldFolder) {
      try {
        if (existsSync(oldDir) && !existsSync(newDir)) {
          renameSync(oldDir, newDir);
        } else if (!existsSync(newDir)) {
          mkdirSync(newDir, { recursive: true });
        }
        folderRenamed = targetFolder;
      } catch (err) {
        console.warn(
          `[migrate] folder rename failed for profile "${profile.name}":`,
          err,
        );
      }
    }

    // After folder rename, rebuild a synthetic profile that owns no sounds
    // yet — uniqueSoundFilename uses it to compute collision-free names.
    const stagingProfile: Profile = { ...profile, folderName: folderRenamed, sounds: [] };
    const newSounds: Sound[] = [];
    for (const sound of profile.sounds) {
      const ext = extname(sound.filePath);
      // Compute the new on-disk path under the (possibly-renamed) folder.
      const oldPathAfterFolderMove = join(
        soundsRoot(),
        folderRenamed,
        basename(sound.filePath),
      );
      const wantedName = uniqueSoundFilename(stagingProfile, sound.name, ext);
      const wantedPath = join(soundsRoot(), folderRenamed, wantedName);

      let finalPath = oldPathAfterFolderMove;
      if (wantedPath !== oldPathAfterFolderMove) {
        try {
          if (existsSync(oldPathAfterFolderMove) && !existsSync(wantedPath)) {
            renameSync(oldPathAfterFolderMove, wantedPath);
            finalPath = wantedPath;
          } else if (existsSync(wantedPath)) {
            // Already at the new name (e.g. re-run) — accept it.
            finalPath = wantedPath;
          }
        } catch (err) {
          console.warn(
            `[migrate] sound rename failed for "${sound.name}":`,
            err,
          );
        }
      }
      const movedSound: Sound = { ...sound, filePath: finalPath };
      newSounds.push(movedSound);
      // Make subsequent collision checks see this sound's name as taken.
      stagingProfile.sounds.push(movedSound);
    }

    return { ...profile, folderName: folderRenamed, sounds: newSounds };
  });

  writeProfiles(updatedProfiles);
  setSettings({ friendlyNamesMigrated: true });
}

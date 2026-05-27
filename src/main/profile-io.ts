// Pack/unpack a profile to a .zip bundle so users can share soundboards.
//
// Bundle layout:
//   manifest.json    -> serialized Profile metadata (sounds reference relative paths)
//   sounds/<file>    -> the actual audio files
//
// Hotkeys are NOT stored in the manifest because the recipient's keyboard layout
// may differ and we don't want to clobber their existing bindings.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { nanoid } from 'nanoid';
import JSZip from 'jszip';
import type { Profile, Sound } from '../shared/types';
import { getProfiles, soundsDir } from './storage';

type ManifestSound = {
  id: string;
  name: string;
  fileEntry: string; // path inside the zip
  volume: number;
  pitch: number;
  mode: Sound['mode'];
  color?: string | null;
};

type Manifest = {
  schemaVersion: 1;
  profileName: string;
  exportedAt: number;
  sounds: ManifestSound[];
};

export async function exportProfile(
  profileId: string,
  targetPath: string,
): Promise<void> {
  const profile = getProfiles().find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);

  const zip = new JSZip();
  const sounds: ManifestSound[] = [];

  for (const sound of profile.sounds) {
    if (!existsSync(sound.filePath)) continue;
    const ext = extname(sound.filePath) || '.bin';
    // Make the in-zip filename predictable but unique.
    const safeName = sanitize(sound.name);
    const fileEntry = `sounds/${safeName}-${sound.id}${ext}`;
    const bytes = await readFile(sound.filePath);
    zip.file(fileEntry, bytes);
    sounds.push({
      id: sound.id,
      name: sound.name,
      fileEntry,
      volume: sound.volume,
      pitch: sound.pitch,
      mode: sound.mode,
      color: sound.color ?? null,
    });
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    profileName: profile.name,
    exportedAt: Date.now(),
    sounds,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const zipBytes = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(targetPath, zipBytes);
}

/**
 * Read a profile-bundle zip, copy its sound files into a fresh profile's
 * sounds directory, and return a new Profile object (without yet adding it
 * to storage — caller decides).
 */
export async function importProfileBundle(
  zipPath: string,
): Promise<Profile> {
  const zipBytes = await readFile(zipPath);
  const zip = await JSZip.loadAsync(zipBytes);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('Bundle is missing manifest.json — not a valid soundboard export.');
  }
  const manifestText = await manifestFile.async('string');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('manifest.json is not valid JSON.');
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `Unsupported bundle version (${manifest.schemaVersion}). This app needs schema 1.`,
    );
  }

  const newProfileId = nanoid();
  const dir = soundsDir(newProfileId);
  const sounds: Sound[] = [];

  for (const entry of manifest.sounds) {
    const zipEntry = zip.file(entry.fileEntry);
    if (!zipEntry) continue;
    const buf = await zipEntry.async('nodebuffer');
    const ext = extname(entry.fileEntry) || '.bin';
    const newId = nanoid();
    const target = join(dir, `${newId}${ext}`);
    await writeFile(target, buf);
    sounds.push({
      id: newId,
      name: entry.name,
      filePath: target,
      hotkey: null, // Don't transplant hotkeys onto the new user's machine.
      volume: typeof entry.volume === 'number' ? entry.volume : 1,
      pitch: typeof entry.pitch === 'number' ? entry.pitch : 1,
      mode: entry.mode ?? 'oneshot',
      color: entry.color ?? null,
    });
  }

  return {
    id: newProfileId,
    name: manifest.profileName || 'Imported soundboard',
    sounds,
  };
}

function sanitize(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '')
    || 'sound';
}
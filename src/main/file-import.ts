import { copyFileSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { nanoid } from 'nanoid';
import { soundsDir, getProfiles, buildUniqueSoundFilename } from './storage';
import type { Sound } from '../shared/types';

const SUPPORTED = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.webm']);

export function importAudioFile(profileId: string, sourcePath: string): Sound {
  const ext = extname(sourcePath).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    throw new Error(`Unsupported audio format: ${ext}`);
  }
  const id = nanoid();
  const name = basename(sourcePath, ext);
  const profile = getProfiles().find((p) => p.id === profileId);
  const filename = profile
    ? buildUniqueSoundFilename(profile, name, ext)
    : `${id}${ext}`;
  const dest = join(soundsDir(profileId), filename);
  copyFileSync(sourcePath, dest);
  return {
    id,
    name,
    filePath: dest,
    hotkey: null,
    volume: 1,
    pitch: 1,
    mode: 'oneshot',
  };
}

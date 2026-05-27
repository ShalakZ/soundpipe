import { copyFileSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { nanoid } from 'nanoid';
import { soundsDir } from './storage';
import type { Sound } from '../shared/types';

const SUPPORTED = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.webm']);

export function importAudioFile(profileId: string, sourcePath: string): Sound {
  const ext = extname(sourcePath).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    throw new Error(`Unsupported audio format: ${ext}`);
  }
  const id = nanoid();
  const dest = join(soundsDir(profileId), `${id}${ext}`);
  copyFileSync(sourcePath, dest);
  return {
    id,
    name: basename(sourcePath, ext),
    filePath: dest,
    hotkey: null,
    volume: 1,
    pitch: 1,
    mode: 'oneshot',
  };
}

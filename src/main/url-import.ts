import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';
import { app } from 'electron';
import type { UrlImportProgress } from '../shared/types';
import { soundsDir } from './storage';

const isDev = !app.isPackaged;
const YT_DLP_URL =
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

function userDataYtDlpPath(): string {
  const binDir = join(app.getPath('userData'), 'bin');
  if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });
  return join(binDir, 'yt-dlp.exe');
}

/**
 * Where yt-dlp lives. Prefers a user-data download (the lazy path we now ship);
 * falls back to a resources-folder copy for dev runs where `npm run fetch-yt-dlp`
 * still puts it there.
 */
function ytDlpPath(): string {
  const userData = userDataYtDlpPath();
  if (existsSync(userData) && statSync(userData).size > 1_000_000) return userData;
  if (isDev) {
    return join(dirname(dirname(__dirname)), 'resources', 'yt-dlp.exe');
  }
  // Production fallback (in case the resources path is still populated from an
  // older install). The installer no longer ships this binary.
  return join(process.resourcesPath, 'yt-dlp.exe');
}

export function isYtDlpAvailable(): boolean {
  const p = ytDlpPath();
  return existsSync(p) && statSync(p).size > 1_000_000;
}

/**
 * Downloads yt-dlp.exe into userData/bin. Reports progress in 0-100 percent.
 * Resolves with the final path. Safe to call concurrently — already-downloading
 * calls coalesce.
 */
let inflight: Promise<string> | null = null;
export async function ensureYtDlp(
  onProgress: (percent: number) => void,
): Promise<string> {
  if (isYtDlpAvailable()) return ytDlpPath();
  if (inflight) return inflight;
  inflight = (async () => {
    const dest = userDataYtDlpPath();
    await downloadToFile(YT_DLP_URL, dest, onProgress);
    return dest;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

function downloadToFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void,
  redirectsLeft = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'User-Agent': 'soundboard' } }, (res) => {
      if (
        (res.statusCode === 301 ||
          res.statusCode === 302 ||
          res.statusCode === 307 ||
          res.statusCode === 308) &&
        res.headers.location
      ) {
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        downloadToFile(next, dest, onProgress, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`yt-dlp download HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      let received = 0;
      const file = createWriteStream(dest);
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) onProgress(Math.floor((received / total) * 100));
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

export function importFromUrl(
  profileId: string,
  url: string,
  onProgress: (p: UrlImportProgress) => void,
): Promise<{ filePath: string; title: string }> {
  return new Promise((resolve, reject) => {
    const binary = ytDlpPath();
    if (!existsSync(binary)) {
      reject(
        new Error(
          'yt-dlp.exe is not installed. Run `npm run fetch-yt-dlp`, or download it from https://github.com/yt-dlp/yt-dlp/releases and place it in the resources/ folder.',
        ),
      );
      return;
    }

    const fileId = nanoid();
    const outDir = soundsDir(profileId);
    const outputTemplate = join(outDir, `${fileId}.%(ext)s`);

    const args = [
      '-f',
      'bestaudio',
      '-o',
      outputTemplate,
      '--no-playlist',
      '--restrict-filenames',
      '--newline',
      '--no-warnings',
      '--print',
      'before_dl:TITLE:%(title)s',
      '--print',
      'after_move:FILE:%(filepath)s',
      url,
    ];

    const proc = spawn(binary, args, { windowsHide: true });

    let title = '';
    let finalPath = '';
    let stderr = '';
    let stdoutBuf = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBuf += data.toString('utf8');
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).replace(/\r$/, '');
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        if (line.startsWith('TITLE:')) {
          title = line.slice('TITLE:'.length).trim();
          onProgress({ kind: 'title', title });
          continue;
        }
        if (line.startsWith('FILE:')) {
          finalPath = line.slice('FILE:'.length).trim();
          continue;
        }
        const m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
        if (m) {
          onProgress({ kind: 'progress', percent: parseFloat(m[1]) });
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8');
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || `yt-dlp exited with code ${code}`;
        reject(new Error(msg));
        return;
      }
      if (!finalPath) {
        reject(new Error('Download finished but yt-dlp did not report a file path.'));
        return;
      }
      onProgress({ kind: 'done', filePath: finalPath });
      resolve({ filePath: finalPath, title: title || 'Downloaded sound' });
    });
  });
}

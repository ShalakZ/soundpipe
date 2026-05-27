// Downloads yt-dlp.exe (Windows standalone) into resources/ if it's not already there.
// Runs at npm install time. Skips silently if the file already exists.

import { existsSync, mkdirSync, createWriteStream, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpsGet } from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TARGET_DIR = join(ROOT, 'resources');
const TARGET = join(TARGET_DIR, 'yt-dlp.exe');
const SOURCE_URL =
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

async function main() {
  if (existsSync(TARGET) && statSync(TARGET).size > 1_000_000) {
    console.log(
      `[yt-dlp] already present at ${TARGET} (${formatSize(statSync(TARGET).size)})`,
    );
    return;
  }
  if (!existsSync(TARGET_DIR)) mkdirSync(TARGET_DIR, { recursive: true });

  console.log(`[yt-dlp] downloading from ${SOURCE_URL}`);
  try {
    await download(SOURCE_URL, TARGET);
    console.log(`[yt-dlp] saved to ${TARGET} (${formatSize(statSync(TARGET).size)})`);
  } catch (err) {
    console.warn(`[yt-dlp] download failed: ${err?.message ?? err}`);
    console.warn(
      '[yt-dlp] URL-import will be disabled until yt-dlp.exe is in place.',
    );
    console.warn('[yt-dlp] manual fix: grab yt-dlp.exe from');
    console.warn(
      '[yt-dlp]   https://github.com/yt-dlp/yt-dlp/releases/latest',
    );
    console.warn(`[yt-dlp] and save it as ${TARGET}`);
    // Don't fail the install — the app should still run without URL import.
  }
}

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolveDl, rejectDl) => {
    httpsGet(
      url,
      { headers: { 'User-Agent': 'soundboard-installer' } },
      (res) => {
        if (
          (res.statusCode === 301 ||
            res.statusCode === 302 ||
            res.statusCode === 307 ||
            res.statusCode === 308) &&
          res.headers.location
        ) {
          if (redirectsLeft <= 0) {
            rejectDl(new Error('too many redirects'));
            return;
          }
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          download(next, dest, redirectsLeft - 1).then(resolveDl, rejectDl);
          return;
        }
        if (res.statusCode !== 200) {
          rejectDl(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const total = Number(res.headers['content-length'] ?? 0);
        let received = 0;
        let lastPct = -1;
        const file = createWriteStream(dest);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct !== lastPct && pct % 10 === 0) {
              process.stdout.write(`[yt-dlp]   ${pct}%\n`);
              lastPct = pct;
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolveDl()));
        file.on('error', rejectDl);
        res.on('error', rejectDl);
      },
    ).on('error', rejectDl);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

await main();

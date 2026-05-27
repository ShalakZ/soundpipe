// Make sure the Electron native binary is actually present in node_modules.
//
// Background: electron's own postinstall (install.js) sometimes silently exits
// without downloading the binary on Windows (some env-var, npm-bug, or proxy
// situation we couldn't pin down). When that happens, electron-vite can't
// launch the app and you see "Error: Electron uninstall".
//
// This script:
//   1. Reads node_modules/electron/package.json for the version.
//   2. If node_modules/electron/dist/electron.exe + path.txt already exist, done.
//   3. Otherwise downloads the official electron-vX-win32-x64.zip from GitHub
//      releases and extracts it.
//
// Runs as part of `postinstall`, so a fresh `npm install` will always end with
// a working Electron binary.

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpsGet } from 'node:https';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ELECTRON_DIR = join(ROOT, 'node_modules', 'electron');
const PATH_TXT = join(ELECTRON_DIR, 'path.txt');
const DIST_DIR = join(ELECTRON_DIR, 'dist');
const EXE_FILE = join(DIST_DIR, 'electron.exe');

if (process.platform !== 'win32') {
  // Linux/macOS path — different binary; we only patch the Windows hole.
  process.exit(0);
}

if (!existsSync(ELECTRON_DIR)) {
  console.log('[electron] node_modules/electron not present; skipping (run `npm install` first).');
  process.exit(0);
}

if (existsSync(EXE_FILE) && existsSync(PATH_TXT) && statSync(EXE_FILE).size > 100_000) {
  console.log('[electron] binary already installed.');
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(join(ELECTRON_DIR, 'package.json'), 'utf-8'));
const version = pkg.version;
const zipUrl = `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`;
const zipPath = join(tmpdir(), `electron-v${version}-win32-x64.zip`);

console.log(`[electron] binary missing — downloading v${version}…`);
try {
  await download(zipUrl, zipPath);
  console.log(`[electron] downloaded to ${zipPath}`);
} catch (err) {
  console.error(`[electron] download failed: ${err?.message ?? err}`);
  console.error(`[electron] manual fix: download ${zipUrl} and extract it into ${DIST_DIR}`);
  process.exit(0); // don't fail the install — the app just won't run until this is fixed
}

if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });
console.log(`[electron] extracting…`);
try {
  // PowerShell's Expand-Archive is available on every modern Windows.
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${DIST_DIR}' -Force`],
    { stdio: 'inherit', shell: false },
  );
  if (result.status !== 0) {
    throw new Error(`Expand-Archive exited with ${result.status}`);
  }
} catch (err) {
  console.error(`[electron] extract failed: ${err?.message ?? err}`);
  process.exit(0);
}

writeFileSync(PATH_TXT, 'electron.exe');
try {
  rmSync(zipPath);
} catch {
  /* ignore */
}

if (existsSync(EXE_FILE)) {
  console.log(`[electron] installed at ${EXE_FILE}`);
} else {
  console.error(`[electron] something went wrong — electron.exe still missing.`);
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
              process.stdout.write(`[electron]   ${pct}%\n`);
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

// VB-CABLE auto-install support.
//
// VB-Audio distributes the driver as a zip with an installer .exe inside.
// We download from their official URL, extract to a temp folder, spawn the
// installer with elevation, then poll until the CABLE device is detected
// (or the user cancels the wizard).
//
// We do NOT bundle the driver in our installer because VB-Audio's license
// restricts redistribution. Downloading the publicly-available installer at
// the user's request is unambiguously fine.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { readFile, writeFile } from 'node:fs/promises';

// Official URL hosted by VB-Audio. Subject to change rarely; we surface a
// clear error if the download fails so the user can fall back to manual.
const VB_CABLE_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack43.zip';

export type CableInstallProgress =
  | { kind: 'downloading'; percent: number }
  | { kind: 'extracting' }
  | { kind: 'launching' }
  | { kind: 'awaiting-user' }
  | { kind: 'error'; message: string };

/**
 * Downloads + extracts + launches the official VB-CABLE installer. The
 * installer is interactive — it shows an "Install Driver" button the user
 * must click, and then asks for a reboot. We return as soon as the installer
 * is spawned; the renderer polls for the resulting audio device.
 */
export async function installVbCable(
  onProgress: (p: CableInstallProgress) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const tmp = join(tmpdir(), 'soundpipe-vbcable');
    if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
    const zipPath = join(tmp, 'VBCABLE_Driver_Pack.zip');

    onProgress({ kind: 'downloading', percent: 0 });
    await download(VB_CABLE_URL, zipPath, (pct) =>
      onProgress({ kind: 'downloading', percent: pct }),
    );

    onProgress({ kind: 'extracting' });
    const zipBytes = await readFile(zipPath);
    const zip = await JSZip.loadAsync(zipBytes);
    let installerPath: string | null = null;
    // Walk every file and write each to disk so the installer can find its
    // sidecar resources. The setup binary we want is "VBCABLE_Setup_x64.exe".
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const out = join(tmp, entry.name);
      const dir = out.slice(0, out.lastIndexOf('\\') !== -1 ? out.lastIndexOf('\\') : out.lastIndexOf('/'));
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      const bytes = await entry.async('nodebuffer');
      await writeFile(out, bytes);
      if (/VBCABLE_Setup_x64\.exe$/i.test(entry.name)) {
        installerPath = out;
      }
    }
    if (!installerPath || !existsSync(installerPath)) {
      return { ok: false, error: 'VB-CABLE installer .exe not found inside the downloaded zip.' };
    }

    onProgress({ kind: 'launching' });
    // Spawn the installer detached so it runs independently of our app.
    // Windows automatically pops the UAC prompt since the installer's
    // manifest requests administrator privileges.
    const proc = spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    proc.unref();
    onProgress({ kind: 'awaiting-user' });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onProgress({ kind: 'error', message: msg });
    return { ok: false, error: msg };
  }
}

function download(
  url: string,
  dest: string,
  onPercent: (pct: number) => void,
  redirectsLeft = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'User-Agent': 'soundpipe' } }, (res) => {
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
        download(next, dest, onPercent, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      let received = 0;
      const file = createWriteStream(dest);
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) onPercent(Math.floor((received / total) * 100));
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Marker file size check — we don't need to verify the installer here; the
// renderer will know "VB-CABLE is now installed" by re-enumerating audio
// devices and finding "CABLE Input" / "CABLE Output".
export function vbCableLikelyPresent(): boolean {
  // Heuristic: look for the standard install path on disk. We can't
  // enumerate audio devices from main (Electron requires the renderer).
  const standardPath = 'C:\\Program Files\\VB\\CABLE\\vbaudio_cable.inf';
  try {
    return existsSync(standardPath) && statSync(standardPath).size > 0;
  } catch {
    return false;
  }
}

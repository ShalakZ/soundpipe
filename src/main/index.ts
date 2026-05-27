import {
  app,
  BrowserWindow,
  protocol,
  Tray,
  Menu,
  nativeImage,
  session,
  desktopCapturer,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { join } from 'node:path';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { startHook, stopHook } from './hotkeys';
import { registerIpc } from './ipc';
import { stopForegroundPolling } from './foreground';
import { autoPttController } from './auto-ptt';
import { micDuckingController } from './mic-ducking';
import { migrateToFriendlyNames } from './storage';

const isDev = !app.isPackaged;

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sb-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
};

function mimeFor(p: string): string {
  const ext = (p.split('.').pop() || '').toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

function decodeRequestPath(rawUrl: string): string {
  const url = new URL(rawUrl);
  let filePath = decodeURIComponent(url.pathname);
  if (process.platform === 'win32' && filePath.startsWith('/')) {
    filePath = filePath.slice(1);
  }
  return filePath;
}

function trayIconPath(): string {
  if (isDev) return join(__dirname, '../../resources/tray-icon.png');
  return join(process.resourcesPath, 'tray-icon.png');
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function setupAutoUpdater(win: BrowserWindow): void {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  autoUpdater.on('update-available', (info) => {
    send('update-status', { kind: 'available', version: info.version });
  });
  autoUpdater.on('update-downloaded', (info) => {
    send('update-status', { kind: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    send('update-status', {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      // Usually a benign "no releases yet" or a transient network blip.
      console.warn('[update] check failed:', err);
    });
  };

  // Initial check shortly after launch (give the renderer a moment to wire
  // its toast listener), then every 30 min while the app is running so an
  // update released mid-session reaches users without a restart.
  setTimeout(check, 4000);
  setInterval(check, 30 * 60 * 1000);
}

function createTray(): Tray {
  const icon = nativeImage.createFromPath(trayIconPath());
  const t = new Tray(icon);
  t.setToolTip(`SoundPipe v${app.getVersion()}`);
  t.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show SoundPipe', click: showMainWindow },
      { label: 'About SoundPipe', click: () => app.showAboutPanel() },
      { type: 'separator' },
      {
        label: 'Quit SoundPipe',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  t.on('click', showMainWindow);
  t.on('double-click', showMainWindow);
  return t;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 520,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  // About-panel metadata. Surfaced via the tray menu and the in-app "About"
  // chip in the header. Keeping the copyright generic since this is MIT-
  // licensed and not commercially attributed to anyone in particular.
  app.setAboutPanelOptions({
    applicationName: 'SoundPipe',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} — MIT licensed`,
    credits:
      'Free open alternative to Steam Soundpad.\n' +
      'Built with Electron, React, and VB-Audio Virtual Cable.',
    iconPath: trayIconPath(),
  });

  protocol.handle('sb-file', (request) => {
    try {
      const filePath = decodeRequestPath(request.url);
      const stat = statSync(filePath);
      const mime = mimeFor(filePath);
      const range = request.headers.get('range');

      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        if (m) {
          const start = parseInt(m[1], 10);
          const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
          const stream = createReadStream(filePath, { start, end });
          return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(end - start + 1),
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      return new Response(
        Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit,
        {
          headers: {
            'Content-Type': mime,
            'Content-Length': String(stat.size),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          },
        },
      );
    } catch (err) {
      console.error('sb-file handler error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Not found: ${msg}`, { status: 404 });
    }
  });

  // Auto-grant system audio loopback via getDisplayMedia. The renderer asks
  // for `{ video: true, audio: true }` and Electron normally pops a screen
  // picker; here we silently grant the first available screen + audio=loopback
  // so the clip buffer can capture system sound on Windows.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (sources.length === 0) {
            callback({});
            return;
          }
          callback({ video: sources[0], audio: 'loopback' });
        })
        .catch((err) => {
          console.error('display media request error', err);
          callback({});
        });
    },
  );

  // One-shot rename of nanoid-keyed profile folders / sound files to
  // human-readable names. Idempotent (gated by a settings flag) and safe to
  // run before the renderer hydrates — paths are updated in the store so the
  // renderer sees the new layout from its first getState() call.
  migrateToFriendlyNames();

  startHook();
  // Foreground polling + auto-PTT focus check are started lazily by
  // rebindHotkeys/onProfileChanged when the active profile actually needs
  // them. The bare app start doesn't spin up either timer.
  autoPttController.start();
  mainWindow = createWindow();
  tray = createTray();
  registerIpc(mainWindow);
  setupAutoUpdater(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      showMainWindow();
    }
  });
});

// On Windows/Linux, do NOT quit when the window is closed —
// the tray keeps the app (and hotkeys) alive. Quit only via the tray menu.
app.on('window-all-closed', () => {
  // Window is hidden (not closed) when X is clicked, so this won't normally fire.
  // It fires only when something genuinely destroys all windows (e.g. tray Quit).
  if (isQuitting && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  autoPttController.stop();
  micDuckingController.stop();
  stopHook();
  stopForegroundPolling();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

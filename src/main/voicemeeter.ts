// Thin koffi wrapper around VoicemeeterRemote64.dll.
//
// We only need a small subset of the API:
//   - Login / Logout (lifecycle)
//   - GetParameterFloat / SetParameterFloat (read/write strip gain, etc.)
//
// VoiceMeeter installs the DLL into a couple of well-known locations. We try
// them in order. If none exists, the whole module silently degrades to no-op
// so the rest of the app still works without VoiceMeeter installed.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

type KoffiLib = { func: (signature: string) => unknown };
type KoffiModule = { load: (path: string) => KoffiLib };

type Funcs = {
  Login: () => number;
  Logout: () => number;
  GetParameterFloat: (name: string, out: number[] | Float32Array) => number;
  SetParameterFloat: (name: string, value: number) => number;
};

let funcs: Funcs | null = null;
let loaded = false;
let loginOk = false;
let loadError: string | null = null;

function findDllPath(): string | null {
  // Default install paths for VoiceMeeter (Standard / Banana / Potato all
  // share these locations with the same DLL).
  const candidates = [
    'C:\\Program Files (x86)\\VB\\Voicemeeter\\VoicemeeterRemote64.dll',
    'C:\\Program Files\\VB\\Voicemeeter\\VoicemeeterRemote64.dll',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fallback: walk the registry uninstall key to find the install dir.
  try {
    const result = spawnSync(
      'reg',
      [
        'query',
        'HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VB:Voicemeeter {17359A74-1236-5467}',
        '/v',
        'UninstallString',
      ],
      { encoding: 'utf-8' },
    );
    const m = result.stdout?.match(/REG_SZ\s+(.+\.exe)/i);
    if (m) {
      const installDir = m[1].replace(/[\\/][^\\/]+\.exe$/i, '');
      const candidate = `${installDir}\\VoicemeeterRemote64.dll`;
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const dllPath = findDllPath();
  if (!dllPath) {
    loadError = 'VoicemeeterRemote64.dll not found — VoiceMeeter probably not installed.';
    return;
  }
  try {
    const moduleName = 'koffi';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require(moduleName) as KoffiModule;
    const lib = koffi.load(dllPath);
    funcs = {
      Login: lib.func('long VBVMR_Login()') as Funcs['Login'],
      Logout: lib.func('long VBVMR_Logout()') as Funcs['Logout'],
      GetParameterFloat: lib.func(
        'long VBVMR_GetParameterFloat(str szParamName, _Out_ float *pValue)',
      ) as Funcs['GetParameterFloat'],
      SetParameterFloat: lib.func(
        'long VBVMR_SetParameterFloat(str szParamName, float NewValue)',
      ) as Funcs['SetParameterFloat'],
    };
    // Read the DLL bytes once just to validate access — surfaces permission
    // errors early. Not strictly needed but cheap and helps debugging.
    readFileSync(dllPath).length;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    console.warn('[voicemeeter] koffi/DLL load failed:', loadError);
    funcs = null;
  }
}

function tryLogin(): boolean {
  if (loginOk) return true;
  if (!funcs) return false;
  try {
    // Return values: 0 = OK, 1 = OK but VoiceMeeter not running, <0 = error.
    const result = funcs.Login();
    loginOk = result === 0 || result === 1;
    if (!loginOk) {
      console.warn('[voicemeeter] login returned', result);
    }
    return loginOk;
  } catch (err) {
    console.warn('[voicemeeter] login threw:', err);
    return false;
  }
}

export const voicemeeter = {
  /** True if the DLL was found AND login succeeded (VoiceMeeter may or may not be running). */
  isAvailable(): boolean {
    load();
    return tryLogin();
  },

  getParameter(name: string): number | null {
    load();
    if (!funcs || !tryLogin()) return null;
    const out = new Float32Array(1);
    try {
      const result = funcs.GetParameterFloat(name, out);
      if (result !== 0) return null;
      return out[0];
    } catch (err) {
      console.warn('[voicemeeter] getParameter failed:', err);
      return null;
    }
  },

  setParameter(name: string, value: number): boolean {
    load();
    if (!funcs || !tryLogin()) return false;
    try {
      return funcs.SetParameterFloat(name, value) === 0;
    } catch (err) {
      console.warn('[voicemeeter] setParameter failed:', err);
      return false;
    }
  },

  shutdown(): void {
    if (funcs && loginOk) {
      try {
        funcs.Logout();
      } catch {
        /* ignore */
      }
    }
    loginOk = false;
  },

  /** Reason VoiceMeeter integration is unavailable (DLL missing / load failure / etc.). */
  getLoadError(): string | null {
    load();
    return loadError;
  },
};

// Minimal Windows key-output helper.
//
// Uses `koffi` (FFI) to call user32.dll → keybd_event directly. We chose
// keybd_event over the more modern SendInput because the FFI signature is
// dead-simple (4 scalar args, no struct marshaling) and the OS handles both
// identically for synthetic key presses. ~3 lines of native plumbing for the
// whole feature.
//
// If koffi fails to load (missing prebuilt, x86 box, dev env without Windows),
// all the press/release helpers become no-ops so the rest of the app keeps
// working — Auto-PTT just silently doesn't fire.

import type { Hotkey } from '../shared/types';

// ---- Virtual-key map (subset that covers anything a sane PTT key would be) ----
// Sourced from Microsoft's Virtual-Key Codes docs. Lower-cased names mapped to
// VK codes; both uiohook-style names (e.g. "K") and friendlier aliases.

const VK_LETTERS: Record<string, number> = Object.fromEntries(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => [l, l.charCodeAt(0)]),
);
const VK_DIGITS: Record<string, number> = Object.fromEntries(
  '0123456789'.split('').map((d) => [d, d.charCodeAt(0)]),
);

const VK_NAMED: Record<string, number> = {
  Space: 0x20,
  Enter: 0x0d,
  Tab: 0x09,
  Backspace: 0x08,
  Escape: 0x1b,
  Esc: 0x1b,
  Shift: 0xa0, // L Shift
  ShiftRight: 0xa1,
  Ctrl: 0xa2, // L Ctrl
  CtrlRight: 0xa3,
  Alt: 0xa4, // L Alt (Menu)
  AltRight: 0xa5,
  Meta: 0x5b, // L Windows
  MetaRight: 0x5c,
  CapsLock: 0x14,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75,
  F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7a, F12: 0x7b,
  F13: 0x7c, F14: 0x7d, F15: 0x7e, F16: 0x7f, F17: 0x80, F18: 0x81,
  F19: 0x82, F20: 0x83, F21: 0x84, F22: 0x85, F23: 0x86, F24: 0x87,
  ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
  Insert: 0x2d, Delete: 0x2e,
  // Numpad
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64,
  Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e, NumpadDivide: 0x6f,
};

// ---- koffi loading (best-effort) ----

const KEYEVENTF_KEYUP = 0x0002;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;
const MOUSEEVENTF_XDOWN = 0x0080;
const MOUSEEVENTF_XUP = 0x0100;
const XBUTTON1 = 1;
const XBUTTON2 = 2;

type KeybdEventFn = (vk: number, scan: number, flags: number, extra: number) => void;
type MouseEventFn = (flags: number, dx: number, dy: number, data: number, extra: number) => void;

let keybd_event: KeybdEventFn | null = null;
let mouse_event: MouseEventFn | null = null;
let loadError: string | null = null;

type KoffiLib = {
  func: (signature: string) => unknown;
};
type KoffiModule = {
  load: (name: string) => KoffiLib;
};

function loadNative(): void {
  if (keybd_event !== null || loadError) return;
  try {
    // Dynamic require so other platforms / missing-binary cases don't crash,
    // and so TypeScript doesn't need koffi's types to compile.
    const moduleName = 'koffi';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require(moduleName) as KoffiModule;
    const user32 = koffi.load('user32.dll');
    keybd_event = user32.func(
      'void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)',
    ) as KeybdEventFn;
    mouse_event = user32.func(
      'void mouse_event(uint32 dwFlags, int32 dx, int32 dy, uint32 dwData, uintptr dwExtraInfo)',
    ) as MouseEventFn;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    console.warn('[key-output] koffi failed to load — Auto-PTT will be a no-op:', loadError);
  }
}

export function isKeyOutputAvailable(): boolean {
  loadNative();
  return keybd_event !== null;
}

// ---- Public press/release ----

/** Looks up the virtual-key code (or special mouse marker) for a Hotkey. */
function resolveHotkey(hk: Hotkey): { kind: 'key' | 'mouse'; code: number } | null {
  if ((hk.kind ?? 'keyboard') === 'mouse') {
    if (typeof hk.button !== 'number') return null;
    return { kind: 'mouse', code: hk.button };
  }
  if (typeof hk.keycode !== 'number') return null;
  // hk.keycode is a uiohook keycode; for our needs we lean on the display
  // string which carries the friendly name (set by hotkeys.ts).
  // Strip modifier prefixes from the display and grab the trailing key name.
  const displayKey = hk.display.split('+').pop() ?? '';
  const vk =
    VK_NAMED[displayKey] ??
    VK_LETTERS[displayKey.toUpperCase()] ??
    VK_DIGITS[displayKey];
  if (vk == null) return null;
  return { kind: 'key', code: vk };
}

function pressVk(vk: number): void {
  if (!keybd_event) return;
  try {
    keybd_event(vk, 0, 0, 0);
  } catch (err) {
    console.error('[key-output] press failed', err);
  }
}

function releaseVk(vk: number): void {
  if (!keybd_event) return;
  try {
    keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
  } catch (err) {
    console.error('[key-output] release failed', err);
  }
}

function pressMouse(button: number): void {
  if (!mouse_event) return;
  try {
    if (button === 1) mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    else if (button === 2) mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
    else if (button === 3) mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0);
    else if (button === 4) mouse_event(MOUSEEVENTF_XDOWN, 0, 0, XBUTTON1, 0);
    else if (button === 5) mouse_event(MOUSEEVENTF_XDOWN, 0, 0, XBUTTON2, 0);
  } catch (err) {
    console.error('[key-output] mouse press failed', err);
  }
}

function releaseMouse(button: number): void {
  if (!mouse_event) return;
  try {
    if (button === 1) mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    else if (button === 2) mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
    else if (button === 3) mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0);
    else if (button === 4) mouse_event(MOUSEEVENTF_XUP, 0, 0, XBUTTON1, 0);
    else if (button === 5) mouse_event(MOUSEEVENTF_XUP, 0, 0, XBUTTON2, 0);
  } catch (err) {
    console.error('[key-output] mouse release failed', err);
  }
}

/**
 * Press a hotkey (modifier-aware). Returns true if anything was actually sent.
 */
export function pressHotkey(hk: Hotkey): boolean {
  loadNative();
  if (!keybd_event) return false;
  const resolved = resolveHotkey(hk);
  if (!resolved) return false;
  if (hk.ctrl) pressVk(VK_NAMED.Ctrl);
  if (hk.alt) pressVk(VK_NAMED.Alt);
  if (hk.shift) pressVk(VK_NAMED.Shift);
  if (hk.meta) pressVk(VK_NAMED.Meta);
  if (resolved.kind === 'key') pressVk(resolved.code);
  else pressMouse(resolved.code);
  return true;
}

export function releaseHotkey(hk: Hotkey): void {
  loadNative();
  if (!keybd_event) return;
  const resolved = resolveHotkey(hk);
  if (!resolved) return;
  if (resolved.kind === 'key') releaseVk(resolved.code);
  else releaseMouse(resolved.code);
  if (hk.meta) releaseVk(VK_NAMED.Meta);
  if (hk.shift) releaseVk(VK_NAMED.Shift);
  if (hk.alt) releaseVk(VK_NAMED.Alt);
  if (hk.ctrl) releaseVk(VK_NAMED.Ctrl);
}

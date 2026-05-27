// Auto-PTT controller.
//
// Listens for renderer "active sounds" updates and synthesizes the active
// profile's configured PTT hotkey while anything is playing. Always releases
// the key on profile change, focus loss, empty playback, app quit — i.e.
// never leaves a key stuck.

import type { Hotkey } from '../shared/types';
import { getState } from './storage';
import { getForegroundProcessName } from './foreground';
import { pressHotkey, releaseHotkey } from './key-output';

let activeSoundCount = 0;
let pressedHotkey: Hotkey | null = null;
let lastFocusName: string | null = null;
let focusCheckHandle: NodeJS.Timeout | null = null;

function activeProfilePtt(): { hotkey: Hotkey; focusFilter: string | null } | null {
  const { profiles, settings } = getState();
  const profile = profiles.find((p) => p.id === settings.activeProfileId);
  if (!profile?.autoPtt) return null;
  return {
    hotkey: profile.autoPtt,
    focusFilter: profile.focusFilter?.processName ?? null,
  };
}

function shouldHoldKey(): boolean {
  if (activeSoundCount <= 0) return false;
  const ptt = activeProfilePtt();
  if (!ptt) return false;
  if (!ptt.focusFilter) return true;
  const fg = getForegroundProcessName();
  if (!fg) return true; // poll hasn't populated; fail-open (won't fire because no sounds yet)
  return fg.toLowerCase().includes(ptt.focusFilter.toLowerCase().replace(/\.exe$/, ''));
}

function syncKeyState(): void {
  const wantHold = shouldHoldKey();
  const ptt = activeProfilePtt();
  if (wantHold && ptt && !pressedHotkey) {
    if (pressHotkey(ptt.hotkey)) pressedHotkey = ptt.hotkey;
  } else if (!wantHold && pressedHotkey) {
    releaseHotkey(pressedHotkey);
    pressedHotkey = null;
  } else if (wantHold && pressedHotkey && ptt && !sameHotkey(pressedHotkey, ptt.hotkey)) {
    // Profile (and therefore PTT key) changed mid-playback. Release the old key, press the new one.
    releaseHotkey(pressedHotkey);
    pressedHotkey = null;
    if (pressHotkey(ptt.hotkey)) pressedHotkey = ptt.hotkey;
  }
}

function sameHotkey(a: Hotkey, b: Hotkey): boolean {
  return (
    (a.kind ?? 'keyboard') === (b.kind ?? 'keyboard') &&
    a.keycode === b.keycode &&
    a.button === b.button &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta
  );
}

// The 250 ms focus-check interval only matters when the active profile has
// both `autoPtt` and a `focusFilter` — that's the only configuration where
// changes in foreground app need to flip the held key. Skip the interval
// otherwise so we don't burn a wakeup/sec on the common "no game filter" case.
function focusCheckNeeded(): boolean {
  const ptt = activeProfilePtt();
  return !!(ptt && ptt.focusFilter);
}

function ensureFocusCheck(): void {
  const needed = focusCheckNeeded();
  if (needed && !focusCheckHandle) {
    focusCheckHandle = setInterval(() => {
      const fg = getForegroundProcessName();
      if (fg !== lastFocusName) {
        lastFocusName = fg;
        syncKeyState();
      }
    }, 250);
  } else if (!needed && focusCheckHandle) {
    clearInterval(focusCheckHandle);
    focusCheckHandle = null;
    lastFocusName = null;
  }
}

export const autoPttController = {
  /** Called by the renderer whenever the set of playing sounds changes. */
  onPlayingCountChanged(count: number): void {
    activeSoundCount = Math.max(0, count);
    syncKeyState();
  },

  /** Called by IPC when active profile or its autoPtt/focusFilter changes. */
  onProfileChanged(): void {
    ensureFocusCheck();
    syncKeyState();
  },

  /** App-start hook. The interval only spins up if a profile actually needs it. */
  start(): void {
    ensureFocusCheck();
  },

  stop(): void {
    if (focusCheckHandle) {
      clearInterval(focusCheckHandle);
      focusCheckHandle = null;
    }
    if (pressedHotkey) {
      releaseHotkey(pressedHotkey);
      pressedHotkey = null;
    }
    activeSoundCount = 0;
  },
};

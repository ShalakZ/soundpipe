import {
  uIOhook,
  UiohookKey,
  UiohookKeyboardEvent,
  UiohookMouseEvent,
} from 'uiohook-napi';
import type { Hotkey, InputEvent as SbInputEvent } from '../shared/types';

type Listener = (event: SbInputEvent) => void;

let started = false;
let captureResolver: ((hotkey: Hotkey) => void) | null = null;

// Modifier state cached from latest keyboard event, used to attach modifiers
// to mouse events (uiohook mouse events don't carry modifier flags).
let mods = { ctrl: false, alt: false, shift: false, meta: false };

const pressListeners = new Set<Listener>();
const releaseListeners = new Set<Listener>();

const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
]);

const KEY_LABELS: Record<number, string> = (() => {
  const out: Record<number, string> = {};
  for (const [name, code] of Object.entries(UiohookKey)) {
    if (typeof code === 'number' && !(code in out)) out[code] = name;
  }
  return out;
})();

function keycodeToLabel(keycode: number): string {
  return KEY_LABELS[keycode] ?? `Key(${keycode})`;
}

function mouseButtonLabel(button: number): string {
  if (button === 3) return 'Middle Click';
  return `Mouse ${button}`;
}

function modifierParts(): string[] {
  const parts: string[] = [];
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.alt) parts.push('Alt');
  if (mods.shift) parts.push('Shift');
  if (mods.meta) parts.push('Win');
  return parts;
}

function buildHotkeyFromKey(e: UiohookKeyboardEvent): Hotkey | null {
  if (MODIFIER_KEYCODES.has(e.keycode)) return null;
  const parts = modifierParts();
  parts.push(keycodeToLabel(e.keycode));
  return {
    kind: 'keyboard',
    keycode: e.keycode,
    ctrl: mods.ctrl,
    alt: mods.alt,
    shift: mods.shift,
    meta: mods.meta,
    display: parts.join('+'),
  };
}

function buildHotkeyFromMouse(button: number): Hotkey | null {
  // Skip left (1) and right (2) — too disruptive to bind globally.
  if (button === 1 || button === 2) return null;
  const parts = modifierParts();
  parts.push(mouseButtonLabel(button));
  return {
    kind: 'mouse',
    button,
    ctrl: mods.ctrl,
    alt: mods.alt,
    shift: mods.shift,
    meta: mods.meta,
    display: parts.join('+'),
  };
}

function updateMods(e: UiohookKeyboardEvent): void {
  mods = {
    ctrl: !!e.ctrlKey,
    alt: !!e.altKey,
    shift: !!e.shiftKey,
    meta: !!e.metaKey,
  };
}

export function startHook(): void {
  if (started) return;

  uIOhook.on('keydown', (e: UiohookKeyboardEvent) => {
    updateMods(e);
    if (captureResolver) {
      const hk = buildHotkeyFromKey(e);
      if (hk) {
        const r = captureResolver;
        captureResolver = null;
        r(hk);
      }
      return;
    }
    const ev: SbInputEvent = {
      kind: 'keyboard',
      keycode: e.keycode,
      ctrl: mods.ctrl,
      alt: mods.alt,
      shift: mods.shift,
      meta: mods.meta,
    };
    for (const l of pressListeners) l(ev);
  });

  uIOhook.on('keyup', (e: UiohookKeyboardEvent) => {
    updateMods(e);
    if (captureResolver) return;
    const ev: SbInputEvent = {
      kind: 'keyboard',
      keycode: e.keycode,
      ctrl: mods.ctrl,
      alt: mods.alt,
      shift: mods.shift,
      meta: mods.meta,
    };
    for (const l of releaseListeners) l(ev);
  });

  uIOhook.on('mousedown', (e: UiohookMouseEvent) => {
    const button = Number(e.button);
    if (captureResolver) {
      const hk = buildHotkeyFromMouse(button);
      if (hk) {
        const r = captureResolver;
        captureResolver = null;
        r(hk);
      }
      return;
    }
    const ev: SbInputEvent = {
      kind: 'mouse',
      button,
      ctrl: mods.ctrl,
      alt: mods.alt,
      shift: mods.shift,
      meta: mods.meta,
    };
    for (const l of pressListeners) l(ev);
  });

  uIOhook.on('mouseup', (e: UiohookMouseEvent) => {
    if (captureResolver) return;
    const ev: SbInputEvent = {
      kind: 'mouse',
      button: Number(e.button),
      ctrl: mods.ctrl,
      alt: mods.alt,
      shift: mods.shift,
      meta: mods.meta,
    };
    for (const l of releaseListeners) l(ev);
  });

  uIOhook.start();
  started = true;
}

export function stopHook(): void {
  if (!started) return;
  uIOhook.stop();
  started = false;
}

export function onPress(fn: Listener): () => void {
  pressListeners.add(fn);
  return () => pressListeners.delete(fn);
}

export function onRelease(fn: Listener): () => void {
  releaseListeners.add(fn);
  return () => releaseListeners.delete(fn);
}

export function captureNextHotkey(): Promise<Hotkey> {
  if (captureResolver) captureResolver = null;
  return new Promise((resolve) => {
    captureResolver = resolve;
  });
}

export function cancelCapture(): void {
  captureResolver = null;
}

export function matchesHotkey(e: SbInputEvent, h: Hotkey): boolean {
  const kind = h.kind ?? 'keyboard';
  if (kind !== e.kind) return false;

  if (e.kind === 'keyboard') {
    return (
      e.keycode === h.keycode &&
      e.ctrl === h.ctrl &&
      e.alt === h.alt &&
      e.shift === h.shift &&
      e.meta === h.meta
    );
  }
  return (
    e.button === h.button &&
    e.ctrl === h.ctrl &&
    e.alt === h.alt &&
    e.shift === h.shift &&
    e.meta === h.meta
  );
}

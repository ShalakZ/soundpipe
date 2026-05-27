export type PlayMode = 'oneshot' | 'toggle' | 'hold';

/**
 * A bindable hotkey. `kind` is optional for backward compat — anything saved
 * before v2 will lack the field and is treated as 'keyboard'.
 */
export type Hotkey = {
  kind?: 'keyboard' | 'mouse';
  keycode?: number; // for keyboard
  button?: number;  // for mouse (3=middle, 4=Mouse4/Back, 5=Mouse5/Forward, 6+)
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  display: string;
};

export type InputEvent =
  | {
      kind: 'keyboard';
      keycode: number;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;
    }
  | {
      kind: 'mouse';
      button: number;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;
    };

export type Sound = {
  id: string;
  name: string;
  filePath: string;
  hotkey: Hotkey | null;
  volume: number;
  pitch: number;
  mode: PlayMode;
  /** Hex color (e.g. "#7c5cff") for visual differentiation. null = default. */
  color?: string | null;
  /** How many times to play in `oneshot` mode. Default 1. Ignored for toggle/hold. */
  loopCount?: number;
};

export type FocusFilter = {
  /** Process executable name to match against (e.g. "cs2.exe"). Case-insensitive. */
  processName: string;
  /** Display name for the UI (e.g. "Counter-Strike 2"). */
  displayName?: string;
};

export type Profile = {
  id: string;
  name: string;
  sounds: Sound[];
  /**
   * If set, hotkeys in this profile only fire when the OS's foreground window
   * belongs to the matching process. Useful for game-specific soundboards.
   */
  focusFilter?: FocusFilter | null;
  /**
   * If set, this hotkey is synthesized into the OS while any sound from this
   * profile is playing. Used to auto-engage push-to-talk in games. The user
   * accepts the anti-cheat risk by enabling it (UI shows a warning).
   */
  autoPtt?: Hotkey | null;
  /**
   * Actual on-disk directory name under `userData/sounds/`. Derived from the
   * profile name with sanitization + collision suffix. Stored explicitly so
   * we can rename the folder when the profile is renamed without losing track
   * of which directory belongs to which profile. Falls back to `id` if unset
   * (pre-migration data).
   */
  folderName?: string;
};

export type ViewMode = 'grid' | 'list';

export type ClipBufferSource = 'input-device' | 'system';

export type ClipBufferSettings = {
  enabled: boolean;
  /** 'system' = capture everything Windows is playing; 'input-device' = pick a specific recording device. */
  source: ClipBufferSource;
  /** Only used when source === 'input-device'. */
  deviceId: string | null;
  bufferSeconds: number;
  hotkey: Hotkey | null;
  /**
   * Keep capturing while the window is hidden (minimized / tray). Default off
   * to save ~10–15 MB RAM + 1–3% CPU when the app is idle in the background.
   * Turn on if you want to capture clips from a game session without keeping
   * the window in view.
   */
  captureWhenHidden?: boolean;
};

export type ThemeId = 'auto' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'light';

export type Settings = {
  virtualMicDeviceId: string | null;
  monitorDeviceId: string | null;
  masterVolume: number;
  stopAllHotkey: Hotkey | null;
  activeProfileId: string;
  restartOnRepress: boolean;
  viewMode: ViewMode;
  /** Color theme applied to the whole app. */
  theme?: ThemeId;
  /** Hides volume/pitch/mode on grid cards by default; per-card chevron expands. */
  compactCards?: boolean;
  clipBuffer: ClipBufferSettings;
  /** Hours to keep captured clips before auto-deleting. 0 = never expire. */
  clipRetentionHours: number;
  /** One-shot dismissals for warning/info banners. Avoids nagging. */
  dismissedWarnings?: {
    autoPttRisk?: boolean;
  };
  /** Auto-lower the user's mic in VoiceMeeter while soundboard audio plays. */
  micDucking?: MicDuckingSettings;
  /** Set once the user has finished the first-run setup wizard. */
  setupComplete?: boolean;
  /**
   * Set once the one-shot file-naming migration has run (renames legacy
   * id-based folders/files to human-readable names on first launch).
   */
  friendlyNamesMigrated?: boolean;
};

export type MicDuckingSettings = {
  enabled: boolean;
  /** VoiceMeeter strip index for the mic (0-based: Strip[0] = Hardware Input 1). */
  stripIndex: number;
  /** dB to subtract from the mic strip's gain while playing. Typically -12 to -24. */
  duckDb: number;
};

export type Clip = {
  id: string;
  name: string;
  filePath: string;
  /** Unix epoch milliseconds when the clip was captured. */
  capturedAt: number;
  durationSeconds: number;
};

export type AppState = {
  profiles: Profile[];
  settings: Settings;
  clips: Clip[];
};

export type HotkeyEvent =
  | { type: 'sound-down'; soundId: string }
  | { type: 'sound-up'; soundId: string }
  | { type: 'stop-all' }
  | { type: 'clip-save' };

export type SoundContextAction =
  | { kind: 'rename' }
  | { kind: 'duplicate' }
  | { kind: 'trim' }
  | { kind: 'show-in-folder' }
  | { kind: 'remove' }
  | { kind: 'move-to-profile'; targetProfileId: string };

export type UrlImportProgress =
  | { kind: 'title'; title: string }
  | { kind: 'progress'; percent: number }
  | { kind: 'done'; filePath: string };

export type UpdateStatus =
  | { kind: 'available'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

export type VbCableProgress =
  | { kind: 'downloading'; percent: number }
  | { kind: 'extracting' }
  | { kind: 'launching' }
  | { kind: 'awaiting-user' }
  | { kind: 'error'; message: string };

export type ImportedFile = {
  originalName: string;
  storedPath: string;
};

export type CaptureMode = 'start' | 'stop';

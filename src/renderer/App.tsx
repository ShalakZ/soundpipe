import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './state/store';
import { AudioEngine } from './audio/AudioEngine';
import { ClipBuffer } from './audio/ClipBuffer';
import { encodeWav } from './audio/wav';
import { SoundboardGrid } from './components/SoundboardGrid';
import { ProfileSwitcher } from './components/ProfileSwitcher';
import { SettingsPanel } from './components/SettingsPanel';
import { SetupWizard } from './components/SetupWizard';
import { ClipsModal } from './components/ClipsModal';
import { TrimEditor } from './components/TrimEditor';
import { ToastStack } from './components/ToastStack';
import { Button } from './components/Button';

export function App() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const settings = useStore((s) => s.settings);
  const profiles = useStore((s) => s.profiles);
  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId);

  const engineRef = useRef<AudioEngine | null>(null);
  const clipBufferRef = useRef<ClipBuffer | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clipsOpen, setClipsOpen] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const clips = useStore((s) => s.clips);
  const playingCount = useStore((s) => s.playingSoundIds.size);
  const trimClipId = useStore((s) => s.trimClipId);
  const setTrimClipId = useStore((s) => s.setTrimClipId);
  const [isVisible, setIsVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    void window.api.getAppVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    const handler = () => setIsVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Apply the active theme to <html data-theme="…">. CSS variables in index.css
  // drive every color token, so flipping this attribute switches the whole UI.
  // 'auto' resolves via prefers-color-scheme — light system → "light", dark
  // system → "midnight" — and re-applies if the user flips OS dark mode while
  // the app is open.
  useEffect(() => {
    const theme = settings.theme ?? 'midnight';
    if (theme !== 'auto') {
      document.documentElement.dataset.theme = theme;
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = mq.matches ? 'midnight' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Initialize engine once hydrated
  useEffect(() => {
    if (!hydrated) return;
    if (!engineRef.current) {
      engineRef.current = new AudioEngine(settings);
      engineRef.current.setOnPlayingChange((ids) => {
        useStore.getState().setPlayingSoundIds(ids);
        // Notify main so auto-PTT can hold/release the configured key.
        void window.api.notifyPlayingCount(ids.size);
      });
    } else {
      engineRef.current.updateSettings(settings);
    }
  }, [hydrated, settings]);

  // Re-target sink IDs on already-playing voices when device selection changes
  useEffect(() => {
    if (!engineRef.current) return;
    void engineRef.current.retargetSinks();
  }, [settings.virtualMicDeviceId, settings.monitorDeviceId]);

  // Request mic permission ONCE (no recording — just unlocks device labels in enumerateDevices)
  useEffect(() => {
    if (!hydrated) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => stream.getTracks().forEach((t) => t.stop()),
      () => {
        /* user denied — device labels will be empty but app still works */
      },
    );
  }, [hydrated]);

  // First-run: open the setup wizard until the user has completed it once.
  useEffect(() => {
    if (!hydrated) return;
    if (!settings.setupComplete) setNeedsSetup(true);
  }, [hydrated, settings.setupComplete]);

  // Safety net: if activeProfileId ever points to a missing profile (e.g. main
  // changed it during a delete but the renderer didn't pick that up), fall back
  // to the first available profile so the UI never gets stuck on "No profile
  // selected."
  useEffect(() => {
    if (!hydrated || profiles.length === 0) return;
    if (!profiles.some((p) => p.id === settings.activeProfileId)) {
      void useStore.getState().patchSettings({ activeProfileId: profiles[0].id });
    }
  }, [hydrated, profiles, settings.activeProfileId]);

  // Manage the clip buffer's lifecycle from settings. Pauses while the window
  // is hidden to tray/minimized unless captureWhenHidden is set (saves the
  // AudioWorklet ring buffer + getDisplayMedia track from running idle).
  useEffect(() => {
    if (!hydrated) return;
    const { enabled, source, deviceId, bufferSeconds, captureWhenHidden } =
      settings.clipBuffer;
    const shouldRun = enabled && (captureWhenHidden || isVisible);
    let cancelled = false;
    (async () => {
      const buffer = clipBufferRef.current ?? new ClipBuffer();
      clipBufferRef.current = buffer;
      if (!shouldRun) {
        await buffer.stop();
        return;
      }
      try {
        if (source === 'system') {
          await buffer.startWithSystemAudio(bufferSeconds);
        } else {
          if (!deviceId) {
            await buffer.stop();
            return;
          }
          await buffer.startWithDevice(deviceId, bufferSeconds);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('ClipBuffer start failed', err);
          useStore.getState().pushToast({
            kind: 'error',
            message: `Clip buffer failed to start: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    hydrated,
    settings.clipBuffer.enabled,
    settings.clipBuffer.source,
    settings.clipBuffer.deviceId,
    settings.clipBuffer.bufferSeconds,
    settings.clipBuffer.captureWhenHidden,
    isVisible,
  ]);

  // Clean up clip buffer on unmount.
  useEffect(() => {
    return () => {
      void clipBufferRef.current?.stop();
      clipBufferRef.current = null;
    };
  }, []);

  // Surface update notifications from the auto-updater into the toast stack.
  useEffect(() => {
    if (!hydrated) return;
    return window.api.onUpdateStatus((event) => {
      const pushToast = useStore.getState().pushToast;
      switch (event.kind) {
        case 'available':
          pushToast({
            kind: 'info',
            message: `Update available: ${event.version}. Downloading in the background…`,
            autoDismissMs: 5000,
          });
          break;
        case 'downloaded':
          pushToast({
            kind: 'success',
            message: `Update ${event.version} downloaded. It will install next time you quit (tray → Quit).`,
            autoDismissMs: 8000,
          });
          break;
        case 'error':
          // Quietly log auto-update errors — usually 'no releases yet' on a fresh install.
          console.warn('[update]', event.message);
          break;
      }
    });
  }, [hydrated]);

  // Expire old clips on app start, then periodically while running. Skip the
  // IPC roundtrip entirely on each tick if there are no clips to sweep — the
  // 5-minute interval is cheap, but the IPC + JSON serialization isn't free
  // when there's literally nothing to do.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const sweep = async () => {
      if (useStore.getState().clips.length === 0) return;
      try {
        const remaining = await window.api.expireOldClips();
        if (!cancelled) useStore.getState().setClips(remaining);
      } catch (err) {
        console.error('clip expire failed', err);
      }
    };
    void sweep();
    const interval = setInterval(() => void sweep(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hydrated, settings.clipRetentionHours]);

  // Wire global hotkey events from main process to the audio engine
  useEffect(() => {
    if (!hydrated) return;
    return window.api.onHotkey((event) => {
      const engine = engineRef.current;
      if (!engine) return;
      if (event.type === 'stop-all') {
        engine.stopAll();
        return;
      }
      if (event.type === 'clip-save') {
        void saveClipNow();
        return;
      }
      const profile = useStore.getState().activeProfile();
      const sound = profile?.sounds.find((s) => s.id === event.soundId);
      if (!sound) return;
      if (event.type === 'sound-down') {
        void engine.trigger(sound, useStore.getState().settings.restartOnRepress);
      } else {
        void engine.release(sound);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const saveClipNow = async () => {
    const buffer = clipBufferRef.current;
    const { pushToast } = useStore.getState();
    if (!buffer) return;
    if (!buffer.isRunning()) {
      pushToast({
        kind: 'error',
        message: 'Clip buffer is not running — check Settings.',
      });
      return;
    }
    try {
      const audioBuffer = await buffer.snapshot(
        useStore.getState().settings.clipBuffer.bufferSeconds,
      );
      if (!audioBuffer) throw new Error('No audio in the buffer yet.');
      let peak = 0;
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        const data = audioBuffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
      }
      console.log(
        `[soundboard] clip captured: ${audioBuffer.duration.toFixed(2)}s, peak=${peak.toFixed(4)}, channels=${audioBuffer.numberOfChannels}`,
      );
      if (peak < 0.001) {
        console.warn(
          '[soundboard] captured audio is silent — check the selected capture source.',
        );
      }
      const wavBytes = encodeWav(audioBuffer);
      const { clip, clips } = await window.api.addClip(
        wavBytes,
        'wav',
        audioBuffer.duration,
      );
      useStore.getState().setClips(clips);
      pushToast({
        kind: 'success',
        message: `Clipped “${clip.name}”`,
        actions: [{ label: 'Open clips', onClick: () => setClipsOpen(true) }],
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onPreview = useMemo(
    () => (soundId: string) => {
      const engine = engineRef.current;
      if (!engine || !activeProfile) return;
      const sound = activeProfile.sounds.find((s) => s.id === soundId);
      if (!sound) return;
      void engine.trigger(sound, true);
    },
    [activeProfile],
  );

  const onStopPreview = useMemo(
    () => (soundId: string) => {
      engineRef.current?.stop(soundId);
    },
    [],
  );

  if (!hydrated) {
    return (
      <div className="h-full flex items-center justify-center text-muted">Loading…</div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg text-text">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface">
        <div className="flex items-baseline gap-1.5">
          <h1 className="text-lg font-semibold">Soundboard</h1>
          {appVersion && (
            <button
              type="button"
              onClick={() => void window.api.showAboutPanel()}
              className="text-[11px] text-muted font-mono hover:text-text transition-colors"
              title="About Soundboard"
            >
              v{appVersion}
            </button>
          )}
        </div>
        <ProfileSwitcher />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center bg-surface2 border border-border rounded overflow-hidden text-sm">
            <button
              className={`px-2.5 py-1.5 flex items-center justify-center ${
                settings.viewMode === 'grid'
                  ? 'bg-accent text-white'
                  : 'hover:bg-border text-text'
              }`}
              onClick={() =>
                void useStore.getState().patchSettings({ viewMode: 'grid' })
              }
              title="Grid view"
              aria-label="Grid view"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="1" />
                <rect x="9" y="1" width="6" height="6" rx="1" />
                <rect x="1" y="9" width="6" height="6" rx="1" />
                <rect x="9" y="9" width="6" height="6" rx="1" />
              </svg>
            </button>
            <button
              className={`px-2.5 py-1.5 flex items-center justify-center ${
                settings.viewMode === 'list'
                  ? 'bg-accent text-white'
                  : 'hover:bg-border text-text'
              }`}
              onClick={() =>
                void useStore.getState().patchSettings({ viewMode: 'list' })
              }
              title="List view"
              aria-label="List view"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="14" height="2" rx="1" />
                <rect x="1" y="7" width="14" height="2" rx="1" />
                <rect x="1" y="12" width="14" height="2" rx="1" />
              </svg>
            </button>
          </div>
          <button
            className="px-3 py-1.5 rounded bg-surface2 hover:bg-border text-sm relative"
            onClick={() => setClipsOpen(true)}
            title="Captured clips waiting to be trimmed into sounds"
          >
            Clips
            {clips.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-accent text-white text-xs">
                {clips.length}
              </span>
            )}
          </button>
          <button
            className={`px-3 py-1.5 rounded text-sm transition-colors disabled:opacity-40 ${
              playingCount > 0
                ? 'bg-danger/20 hover:bg-danger/30 text-danger border border-danger/40'
                : 'bg-surface2 hover:bg-border'
            }`}
            onClick={() => {
              const count = playingCount;
              engineRef.current?.stopAll();
              if (count > 0) {
                useStore.getState().pushToast({
                  kind: 'info',
                  message: `Stopped ${count} sound${count === 1 ? '' : 's'}.`,
                  autoDismissMs: 1500,
                });
              }
            }}
            disabled={playingCount === 0}
            title={
              playingCount > 0
                ? `Stop all ${playingCount} playing sound${playingCount === 1 ? '' : 's'}`
                : 'Nothing is playing'
            }
          >
            Stop all{playingCount > 0 ? ` (${playingCount})` : ''}
          </button>
          <Button onClick={() => setSettingsOpen(true)}>Settings</Button>
        </div>
      </header>

      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface">
        <label
          htmlFor="master-volume"
          className="text-xs text-muted shrink-0 flex items-center gap-1.5"
        >
          <span aria-hidden>🔊</span>
          Master
        </label>
        <input
          id="master-volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.masterVolume}
          onChange={(e) =>
            void useStore
              .getState()
              .patchSettings({ masterVolume: Number(e.target.value) })
          }
          className="flex-1"
          title="Master volume — scales every sound that plays"
        />
        <span className="text-xs text-muted tabular-nums w-10 text-right shrink-0">
          {Math.round(settings.masterVolume * 100)}%
        </span>
      </div>

      <main className="flex-1 overflow-auto p-4">
        {activeProfile ? (
          <SoundboardGrid
            profile={activeProfile}
            onPreview={onPreview}
            onStopPreview={onStopPreview}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted gap-3">
            <div className="text-lg">No soundboard selected</div>
            <p className="text-sm text-center max-w-sm">
              Create one to get started, or use Settings to set up audio routing.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="primary" onClick={() => setSettingsOpen(true)}>
                Open Settings
              </Button>
            </div>
          </div>
        )}
      </main>

      <ToastStack />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {clipsOpen && <ClipsModal onClose={() => setClipsOpen(false)} />}
      {needsSetup && <SetupWizard onClose={() => setNeedsSetup(false)} />}

      {trimClipId && (() => {
        const target = clips.find((c) => c.id === trimClipId);
        if (!target) {
          setTrimClipId(null);
          return null;
        }
        const profile = useStore.getState().activeProfile();
        if (!profile) {
          setTrimClipId(null);
          return null;
        }
        return (
          <TrimEditor
            key={target.filePath}
            sourceFilePath={target.filePath}
            sourceName={target.name}
            onClose={() => setTrimClipId(null)}
            onSave={async (bytes) => {
              const result = await window.api.trimClipToSound(
                target.id,
                profile.id,
                bytes,
                'wav',
                target.name,
              );
              useStore.getState().setProfiles(result.profiles);
              useStore.getState().setClips(result.clips);
              setTrimClipId(null);
            }}
          />
        );
      })()}

    </div>
  );
}

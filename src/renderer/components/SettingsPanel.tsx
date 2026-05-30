import { useEffect, useState } from 'react';
import type { ThemeId } from '@shared/types';
import { useStore } from '../state/store';
import { DeviceSelector } from './DeviceSelector';
import { HotkeyCaptureModal } from './HotkeyCaptureModal';
import { useModalKeys } from './useModalKeys';
import { Button } from './Button';

// Swatches mirror the palettes in src/renderer/index.css. Hex form for the
// settings picker only — the live UI reads CSS variables.
type ThemeEntry = {
  id: ThemeId;
  label: string;
  // Auto uses a 2-color split swatch; the named themes show a single palette.
  swatches:
    | { kind: 'palette'; bg: string; surface: string; accent: string }
    | { kind: 'split'; left: string; right: string };
};
const THEMES: ThemeEntry[] = [
  {
    id: 'auto',
    label: 'Auto',
    swatches: { kind: 'split', left: '#f8fafc', right: '#0f1115' },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    swatches: { kind: 'palette', bg: '#0f1115', surface: '#1f2330', accent: '#7c5cff' },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    swatches: { kind: 'palette', bg: '#0a1422', surface: '#1c3151', accent: '#14b8a6' },
  },
  {
    id: 'forest',
    label: 'Forest',
    swatches: { kind: 'palette', bg: '#0a140e', surface: '#1a3527', accent: '#84cc16' },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    swatches: { kind: 'palette', bg: '#1a0f0a', surface: '#3d2418', accent: '#f97316' },
  },
  {
    id: 'light',
    label: 'Light',
    swatches: { kind: 'palette', bg: '#f8fafc', surface: '#f1f5f9', accent: '#7c5cff' },
  },
];

type Props = { onClose: () => void };

export function SettingsPanel({ onClose }: Props) {
  const settings = useStore((s) => s.settings);
  const patchSettings = useStore((s) => s.patchSettings);
  const [capturingStopAll, setCapturingStopAll] = useState(false);
  const [capturingClip, setCapturingClip] = useState(false);

  const patchClipBuffer = (patch: Partial<typeof settings.clipBuffer>) =>
    patchSettings({ clipBuffer: { ...settings.clipBuffer, ...patch } });

  const ducking = settings.micDucking ?? { enabled: false, stripIndex: 0, duckDb: -12 };
  const patchDucking = (patch: Partial<typeof ducking>) =>
    patchSettings({ micDucking: { ...ducking, ...patch } });

  const [vmStatus, setVmStatus] = useState<{ available: boolean; error: string | null } | null>(
    null,
  );
  useEffect(() => {
    void window.api.voicemeeterStatus().then(setVmStatus);
  }, []);

  useModalKeys({ onClose });

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 w-[520px] max-h-[90vh] overflow-auto">
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            className="ml-auto px-2 py-1 rounded bg-surface2 hover:bg-border text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <section className="mb-5">
          <label className="block text-sm font-medium mb-2">Theme</label>
          <div className="grid grid-cols-6 gap-2">
            {THEMES.map((t) => {
              const active = (settings.theme ?? 'midnight') === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void patchSettings({ theme: t.id })}
                  title={
                    t.id === 'auto'
                      ? 'Follows your system color scheme (light or dark)'
                      : t.label
                  }
                  aria-pressed={active}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded border transition ${
                    active
                      ? 'border-accent ring-2 ring-accent/40'
                      : 'border-border hover:border-muted'
                  }`}
                >
                  {t.swatches.kind === 'split' ? (
                    <div
                      className="w-full h-10 rounded overflow-hidden flex"
                      aria-hidden
                    >
                      <div
                        className="flex-1"
                        style={{ backgroundColor: t.swatches.left }}
                      />
                      <div
                        className="flex-1"
                        style={{ backgroundColor: t.swatches.right }}
                      />
                    </div>
                  ) : (
                    <div
                      className="w-full h-10 rounded overflow-hidden flex"
                      aria-hidden
                      style={{ backgroundColor: t.swatches.bg }}
                    >
                      <div
                        className="flex-1"
                        style={{ backgroundColor: t.swatches.surface }}
                      />
                      <div
                        className="flex-1"
                        style={{ backgroundColor: t.swatches.accent }}
                      />
                    </div>
                  )}
                  <span className="text-[11px] text-text">{t.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-5">
          <label className="block text-sm font-medium mb-1">Virtual microphone output</label>
          <p className="text-xs text-muted mb-2">
            This is the device games and voice apps will hear from. Usually <code>CABLE Input (VB-Audio Virtual Cable)</code>.
          </p>
          <DeviceSelector
            value={settings.virtualMicDeviceId}
            onChange={(v) => void patchSettings({ virtualMicDeviceId: v })}
            emptyLabel="— Select an output device —"
          />
        </section>

        <section className="mb-5">
          <div className="flex items-center mb-1">
            <label className="text-sm font-medium">
              Mixer mode — your voice + sounds on one mic
            </label>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.mixerMode ?? false}
                onChange={(e) => void patchSettings({ mixerMode: e.target.checked })}
              />
              Enable
            </label>
          </div>
          <p className="text-xs text-muted mb-2">
            Blends your real microphone with the soundboard and sends both to the
            virtual microphone above — so people in Discord and games hear you talk{' '}
            <em>and</em> your sounds, with no extra routing. When off, only the
            sounds are sent to the virtual mic.
          </p>
          {(settings.mixerMode ?? false) && (
            <>
              <label className="block text-xs text-muted mb-1">
                Your real microphone
              </label>
              <DeviceSelector
                kind="audioinput"
                value={settings.realMicDeviceId ?? null}
                onChange={(v) => void patchSettings({ realMicDeviceId: v })}
                emptyLabel="— Default microphone —"
              />
              {!settings.virtualMicDeviceId && (
                <p className="text-xs text-danger mt-2">
                  Pick the virtual microphone output above for mixer mode to work.
                </p>
              )}

              <div className="mt-3">
                <label className="block text-xs text-muted mb-1">
                  {(() => {
                    const d = settings.mixerVoiceDuckDb ?? 0;
                    if (d <= 0) return 'Duck my voice while sounds play: Off (both equal)';
                    if (d >= 60) return 'Duck my voice while sounds play: Full (voice muted)';
                    return `Duck my voice while sounds play: −${d} dB`;
                  })()}
                </label>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={3}
                  value={settings.mixerVoiceDuckDb ?? 0}
                  onChange={(e) =>
                    void patchSettings({ mixerVoiceDuckDb: Number(e.target.value) })
                  }
                  className="w-full"
                />
                <p className="text-xs text-muted mt-1">
                  Left = talk over your sounds. Right = sounds take priority and your
                  voice drops while they play.
                </p>
              </div>

              <p className="text-xs text-muted mt-3">
                In your game or voice app, select the virtual microphone as your input device.
              </p>
            </>
          )}
        </section>

        <section className="mb-5">
          <label className="block text-sm font-medium mb-1">
            Monitor output (you hear yourself)
          </label>
          <p className="text-xs text-muted mb-2">
            Plays the same sound on your speakers/headphones so you know when it played. Leave empty to disable.
          </p>
          <DeviceSelector
            value={settings.monitorDeviceId}
            onChange={(v) => void patchSettings({ monitorDeviceId: v })}
            emptyLabel="— No monitor (silent on your end) —"
          />
        </section>

        <section className="mb-5">
          <label className="block text-sm font-medium mb-1">Stop-all hotkey</label>
          <p className="text-xs text-muted mb-2">
            Pressing this from anywhere immediately stops all playing sounds.
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 text-left px-3 py-1.5 rounded bg-surface2 hover:bg-border text-sm font-mono"
              onClick={() => setCapturingStopAll(true)}
            >
              {settings.stopAllHotkey?.display ?? '— none —'}
            </button>
            {settings.stopAllHotkey && (
              <Button
                size="sm"
                onClick={() => void patchSettings({ stopAllHotkey: null })}
              >
                Clear
              </Button>
            )}
          </div>
        </section>

        <section className="mb-5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.restartOnRepress}
              onChange={(e) => void patchSettings({ restartOnRepress: e.target.checked })}
            />
            Restart a one-shot sound if its hotkey is pressed while playing
          </label>
        </section>

        <section className="mb-5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.compactCards ?? false}
              onChange={(e) => void patchSettings({ compactCards: e.target.checked })}
            />
            Compact cards (hide volume / pitch / mode by default)
          </label>
          <p className="text-xs text-muted mt-1 ml-6">
            Each card gains a <span className="font-mono">▾ More</span> toggle to reveal the controls when you need them.
          </p>
        </section>

        <section className="mb-2 border-t border-border pt-4">
          <div className="flex items-center mb-1">
            <label className="text-sm font-medium">Audio clip buffer</label>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.clipBuffer.enabled}
                onChange={(e) => void patchClipBuffer({ enabled: e.target.checked })}
              />
              Enable
            </label>
          </div>
          <p className="text-xs text-muted mb-3">
            Continuously records audio from the chosen device. Press the clip hotkey to save the last N seconds as a new sound, which opens the trim editor so you can pick the exact moment.
          </p>

          <label className="block text-xs text-muted mb-1">Capture source</label>
          <div className="flex items-center bg-surface2 border border-border rounded overflow-hidden text-sm mb-3">
            <button
              type="button"
              className={`flex-1 px-3 py-1.5 ${
                settings.clipBuffer.source === 'system'
                  ? 'bg-accent text-white'
                  : 'hover:bg-border text-muted'
              }`}
              onClick={() => void patchClipBuffer({ source: 'system' })}
              title="Records everything you hear (game audio, Discord teammates, music, etc.)"
            >
              System audio
            </button>
            <button
              type="button"
              className={`flex-1 px-3 py-1.5 ${
                settings.clipBuffer.source === 'input-device'
                  ? 'bg-accent text-white'
                  : 'hover:bg-border text-muted'
              }`}
              onClick={() => void patchClipBuffer({ source: 'input-device' })}
              title="Records from a specific recording device (mic, VoiceMeeter Out, Stereo Mix, etc.)"
            >
              Specific device
            </button>
          </div>

          {settings.clipBuffer.source === 'input-device' && (
            <div className="mb-3">
              <label className="block text-xs text-muted mb-1">Input device</label>
              <DeviceSelector
                kind="audioinput"
                value={settings.clipBuffer.deviceId}
                onChange={(v) => void patchClipBuffer({ deviceId: v })}
                emptyLabel="— Select an input device —"
              />
            </div>
          )}

          {settings.clipBuffer.source === 'system' && (
            <p className="text-xs text-muted mb-3">
              Captures the same audio you hear on your default Windows playback device — game audio, Discord voice, music, etc. No additional setup required.
            </p>
          )}

          <div className="mt-3 mb-3">
            <label className="block text-xs text-muted mb-1">
              Buffer length: {settings.clipBuffer.bufferSeconds}s
            </label>
            <input
              type="range"
              min={5}
              max={120}
              step={5}
              value={settings.clipBuffer.bufferSeconds}
              onChange={(e) =>
                void patchClipBuffer({ bufferSeconds: Number(e.target.value) })
              }
              className="w-full"
            />
          </div>

          <label className="block text-xs text-muted mb-1">Clip hotkey</label>
          <div className="flex gap-2">
            <button
              className="flex-1 text-left px-3 py-1.5 rounded bg-surface2 hover:bg-border text-sm font-mono"
              onClick={() => setCapturingClip(true)}
            >
              {settings.clipBuffer.hotkey?.display ?? '— none —'}
            </button>
            {settings.clipBuffer.hotkey && (
              <Button
                size="sm"
                onClick={() => void patchClipBuffer({ hotkey: null })}
              >
                Clear
              </Button>
            )}
          </div>
          {settings.clipBuffer.enabled &&
            settings.clipBuffer.source === 'input-device' &&
            !settings.clipBuffer.deviceId && (
              <p className="text-xs text-danger mt-2">
                Capture is enabled but no input device is selected.
              </p>
            )}
          {settings.clipBuffer.enabled && !settings.clipBuffer.hotkey && (
            <p className="text-xs text-muted mt-2">
              Bind a hotkey above to save clips on demand.
            </p>
          )}

          <label className="flex items-center gap-2 text-xs text-muted mt-3">
            <input
              type="checkbox"
              checked={settings.clipBuffer.captureWhenHidden ?? false}
              onChange={(e) =>
                void patchClipBuffer({ captureWhenHidden: e.target.checked })
              }
            />
            Keep capturing while the window is hidden / minimized
          </label>
          <p className="text-xs text-muted mt-1 ml-6">
            Off by default — pauses the ring buffer when the app is in the tray to save RAM/CPU while gaming.
          </p>

          <label className="block text-xs text-muted mt-4 mb-1">
            Auto-delete clips after
          </label>
          <select
            value={settings.clipRetentionHours}
            onChange={(e) =>
              void patchSettings({ clipRetentionHours: Number(e.target.value) })
            }
            className="w-full bg-surface2 border border-border rounded px-2 py-1 text-sm"
          >
            <option value={0}>Never (keep forever)</option>
            <option value={1}>1 hour</option>
            <option value={6}>6 hours</option>
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>7 days</option>
            <option value={720}>30 days</option>
          </select>
          <p className="text-xs text-muted mt-1">
            Captured clips that exceed this age are silently deleted. Trimming a clip into a soundboard sound also removes the original clip.
          </p>
        </section>

        <section className="mb-2 border-t border-border pt-4">
          <div className="flex items-center mb-1">
            <label className="text-sm font-medium">Mic ducking</label>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ducking.enabled}
                disabled={vmStatus !== null && !vmStatus.available}
                onChange={(e) => void patchDucking({ enabled: e.target.checked })}
              />
              Enable
            </label>
          </div>
          <p className="text-xs text-muted mb-3">
            While any sound plays, lowers your mic strip in VoiceMeeter so your voice doesn't fight the clip. Restores automatically when the sound ends.
          </p>

          {vmStatus && !vmStatus.available && (
            <div className="bg-danger/10 border border-danger/40 text-xs rounded p-3 mb-3">
              <p className="font-medium mb-1">VoiceMeeter not detected</p>
              <p className="text-muted">
                {vmStatus.error ??
                  'Make sure VoiceMeeter (Standard / Banana / Potato) is installed and running.'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted block mb-1">
                Mic strip index
              </span>
              <input
                type="number"
                min={0}
                max={7}
                value={ducking.stripIndex}
                disabled={!ducking.enabled}
                onChange={(e) =>
                  void patchDucking({
                    stripIndex: Math.max(0, Math.min(7, Number(e.target.value) || 0)),
                  })
                }
                className="w-full bg-surface2 border border-border rounded px-2 py-1 text-sm disabled:opacity-50"
                title="0 = first strip. In Banana your mic is usually Strip 1 → index 0."
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted block mb-1">
                Duck amount: {ducking.duckDb} dB
              </span>
              <input
                type="range"
                min={-30}
                max={-3}
                step={1}
                value={ducking.duckDb}
                disabled={!ducking.enabled}
                onChange={(e) =>
                  void patchDucking({ duckDb: Number(e.target.value) })
                }
                className="w-full disabled:opacity-50"
              />
            </label>
          </div>
        </section>

        {capturingStopAll && (
          <HotkeyCaptureModal
            onCapture={(hk) => {
              setCapturingStopAll(false);
              void patchSettings({ stopAllHotkey: hk });
            }}
            onCancel={() => {
              setCapturingStopAll(false);
              void window.api.cancelCapture();
            }}
          />
        )}

        {capturingClip && (
          <HotkeyCaptureModal
            onCapture={(hk) => {
              setCapturingClip(false);
              void patchClipBuffer({ hotkey: hk });
            }}
            onCancel={() => {
              setCapturingClip(false);
              void window.api.cancelCapture();
            }}
          />
        )}
      </div>
    </div>
  );
}

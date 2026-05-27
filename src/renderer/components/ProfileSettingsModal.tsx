import { useEffect, useState } from 'react';
import type { Hotkey, Profile } from '@shared/types';
import { useStore } from '../state/store';
import { HotkeyCaptureModal } from './HotkeyCaptureModal';
import { useModalKeys } from './useModalKeys';
import { Button } from './Button';

type Props = {
  profile: Profile;
  onClose: () => void;
};

type OpenWindow = { processName: string; title: string };

export function ProfileSettingsModal({ profile, onClose }: Props) {
  const setProfiles = useStore((s) => s.setProfiles);
  const refresh = useStore((s) => s.refresh);
  const patchSettings = useStore((s) => s.patchSettings);
  const dismissedAutoPtt = useStore(
    (s) => s.settings.dismissedWarnings?.autoPttRisk ?? false,
  );
  const [name, setName] = useState(profile.name);
  const [filterProcess, setFilterProcess] = useState(
    profile.focusFilter?.processName ?? '',
  );
  const [filterDisplay, setFilterDisplay] = useState(
    profile.focusFilter?.displayName ?? '',
  );
  const [autoPtt, setAutoPtt] = useState<Hotkey | null>(profile.autoPtt ?? null);
  const [capturingPtt, setCapturingPtt] = useState(false);
  const [openWindows, setOpenWindows] = useState<OpenWindow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showWindowsList, setShowWindowsList] = useState(false);
  const [saving, setSaving] = useState(false);

  useModalKeys({ onClose, busy: saving || capturingPtt });

  // Re-sync local state if the underlying profile changes while the modal is
  // open (e.g. a previous save just landed). Keyed on profile.id so a profile
  // switch wholesale resets the form, but staying on the same profile just
  // refreshes the displayed values.
  useEffect(() => {
    setName(profile.name);
    setFilterProcess(profile.focusFilter?.processName ?? '');
    setFilterDisplay(profile.focusFilter?.displayName ?? '');
    setAutoPtt(profile.autoPtt ?? null);
  }, [
    profile.id,
    profile.name,
    profile.focusFilter?.processName,
    profile.focusFilter?.displayName,
    profile.autoPtt?.display,
  ]);

  const refreshWindows = async () => {
    setScanning(true);
    try {
      const result = await window.api.listOpenWindows();
      setOpenWindows(result);
    } finally {
      setScanning(false);
    }
  };

  // Don't scan windows until the user opens the picker — saves a get-windows
  // native call (and ~50ms) on every modal open.
  useEffect(() => {
    if (showWindowsList && openWindows.length === 0) void refreshWindows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWindowsList]);

  const pickWindow = (w: OpenWindow) => {
    setFilterProcess(w.processName);
    setFilterDisplay(w.title || w.processName);
  };

  const clearFilter = () => {
    setFilterProcess('');
    setFilterDisplay('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const trimmedName = name.trim() || profile.name;
      const focusFilter = filterProcess.trim()
        ? {
            processName: filterProcess.trim(),
            displayName: filterDisplay.trim() || filterProcess.trim(),
          }
        : null;
      const next = await window.api.updateProfile(profile.id, {
        name: trimmedName,
        focusFilter,
        autoPtt,
      });
      setProfiles(next);
      setSaving(false);
      onClose();
    } catch (err) {
      useStore.getState().pushToast({
        kind: 'error',
        message: `Couldn't save profile: ${err instanceof Error ? err.message : String(err)}`,
      });
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 w-[540px] max-h-[90vh] overflow-auto">
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold">Profile settings</h2>
          <button
            className="ml-auto px-2 py-1 rounded bg-surface2 hover:bg-border text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
        </div>

        <section className="mb-5">
          <label className="block text-sm font-medium mb-1">Profile name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-surface2 border border-border rounded px-2 py-1 text-sm"
            autoComplete="off"
            spellCheck={false}
          />
        </section>

        <section className="mb-5">
          <label className="block text-sm font-medium mb-1">
            Only fire hotkeys when this app is focused
          </label>
          <p className="text-xs text-muted mb-2">
            Useful for game-specific soundboards: pick CS2, Valorant, etc. and the hotkeys in this profile will be ignored when any other app has focus. Leave empty to always fire.
          </p>
          <div className="flex gap-2 mb-2">
            <input
              value={filterProcess}
              onChange={(e) => setFilterProcess(e.target.value)}
              placeholder="cs2.exe"
              className="flex-1 bg-surface2 border border-border rounded px-2 py-1 text-sm font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            {filterProcess && (
              <Button size="sm" onClick={clearFilter}>
                Clear
              </Button>
            )}
          </div>

          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-1.5 rounded bg-surface2 hover:bg-border text-xs text-muted"
            onClick={() => setShowWindowsList((v) => !v)}
          >
            <span>
              {showWindowsList ? '▼' : '▶'} Pick from currently-open windows
            </span>
            {showWindowsList && (
              <span
                role="button"
                tabIndex={0}
                className="text-xs hover:text-text cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  void refreshWindows();
                }}
                title="Re-scan"
              >
                ⟳
              </span>
            )}
          </button>

          {showWindowsList && (
            <div className="mt-2 bg-surface2 border border-border rounded max-h-48 overflow-auto">
              {scanning && openWindows.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">Scanning…</div>
              ) : openWindows.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">
                  No windows detected. The native helper may not be installed yet (run `npm install`).
                </div>
              ) : (
                <ul>
                  {openWindows.map((w) => (
                    <li key={w.processName}>
                      <button
                        type="button"
                        className={`w-full text-left px-3 py-1.5 hover:bg-border text-sm ${
                          filterProcess.toLowerCase() === w.processName.toLowerCase()
                            ? 'bg-accent/30'
                            : ''
                        }`}
                        onClick={() => pickWindow(w)}
                        title={w.processName}
                      >
                        <span className="font-mono text-xs text-muted">
                          {w.processName}
                        </span>
                        <span className="ml-2 text-sm truncate inline-block max-w-[280px] align-bottom">
                          {w.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="mb-5 border-t border-border pt-4">
          <label className="block text-sm font-medium mb-1">
            Auto-PTT (push-to-talk synthesis)
          </label>
          <p className="text-xs text-muted mb-2">
            When any sound from this profile plays, the app holds the chosen key for the duration of the sound — so games that require PTT to transmit still hear the clip even if you're not holding the key yourself.
          </p>

          {!dismissedAutoPtt && (
            <div className="bg-danger/10 border border-danger/40 text-xs rounded p-3 mb-3 relative">
              <p className="font-medium mb-1">⚠ Anti-cheat warning</p>
              <p className="text-muted">
                This synthesizes a real keystroke via the Windows input API. Most anti-cheats (VAC for CS2/TF2) have tolerated AutoHotkey-style macros for years, but stricter ones (Vanguard for Valorant, BattlEye) may flag this. <strong className="text-text">Use at your own risk; bans are not guaranteed against.</strong> Pair this with a focus filter so the key only fires inside the intended game.
              </p>
              <button
                type="button"
                className="absolute top-2 right-2 text-muted hover:text-text text-sm"
                onClick={() =>
                  void patchSettings({
                    dismissedWarnings: { autoPttRisk: true },
                  })
                }
                title="Got it — don't show again"
              >
                ×
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 text-left px-3 py-1.5 rounded bg-surface2 hover:bg-border text-sm font-mono"
              onClick={() => setCapturingPtt(true)}
            >
              {autoPtt?.display ?? '— not set —'}
            </button>
            {autoPtt && (
              <Button size="sm" onClick={() => setAutoPtt(null)}>
                Clear
              </Button>
            )}
          </div>

          {autoPtt && !filterProcess.trim() && (
            <p className="text-xs text-yellow-400 mt-2">
              ⚠ No focus filter is set — this key will be synthesized whenever this profile's hotkeys fire, including in Discord/browser. Set a focus filter above to scope it.
            </p>
          )}
        </section>

        <section className="mb-5 border-t border-border pt-4">
          <label className="block text-sm font-medium mb-1">Share this soundboard</label>
          <p className="text-xs text-muted mb-3">
            Export packages the sounds + settings into a <code>.zip</code> file your friends can import. Hotkeys are stripped so they don't conflict on the receiving end.
          </p>
          <div className="flex gap-2">
            <Button
              disabled={saving}
              onClick={async () => {
                try {
                  const saved = await window.api.exportProfile(profile.id, profile.name);
                  if (saved) {
                    useStore.getState().pushToast({
                      kind: 'success',
                      message: `Exported “${profile.name}” to ${saved}`,
                    });
                  }
                } catch (err) {
                  useStore.getState().pushToast({
                    kind: 'error',
                    message: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
                  });
                }
              }}
            >
              Export…
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                const { pushToast, dismissToast } = useStore.getState();
                const loadingId = pushToast({
                  kind: 'info',
                  message: '⏳ Importing soundboard…',
                  autoDismissMs: 0,
                });
                try {
                  const result = await window.api.importProfile();
                  dismissToast(loadingId);
                  if (result) {
                    await refresh();
                    pushToast({
                      kind: 'success',
                      message: `Imported “${result.profile.name}” (${result.profile.sounds.length} sound${
                        result.profile.sounds.length === 1 ? '' : 's'
                      }).`,
                    });
                    onClose();
                  }
                } catch (err) {
                  dismissToast(loadingId);
                  pushToast({
                    kind: 'error',
                    message: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
                  });
                }
              }}
            >
              Import…
            </Button>
          </div>
        </section>

        <div className="flex gap-2 justify-end">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>

        {capturingPtt && (
          <HotkeyCaptureModal
            onCapture={(hk) => {
              setCapturingPtt(false);
              if (hk) setAutoPtt(hk);
            }}
            onCancel={() => {
              setCapturingPtt(false);
              void window.api.cancelCapture();
            }}
          />
        )}
      </div>
    </div>
  );
}

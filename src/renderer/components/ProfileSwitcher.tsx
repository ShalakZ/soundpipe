import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@shared/types';
import { useStore } from '../state/store';
import { ProfileSettingsModal } from './ProfileSettingsModal';
import { confirmDialog } from './confirm';

export function ProfileSwitcher() {
  const profiles = useStore((s) => s.profiles);
  const settings = useStore((s) => s.settings);
  const refresh = useStore((s) => s.refresh);
  const patchSettings = useStore((s) => s.patchSettings);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Imperative focus — more reliable than `autoFocus` in Electron renderers,
  // which can race with the renderer's own focus events.
  useEffect(() => {
    if (adding) {
      // Microtask so the element is actually in the DOM
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [adding]);

  const cancelAdd = () => {
    setAdding(false);
    setNewName('');
  };

  const onCreate = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const profile = await window.api.createProfile(name);
      await window.api.updateSettings({ activeProfileId: profile.id });
      await refresh();
    } catch (err) {
      console.error('createProfile failed', err);
      useStore.getState().pushToast({
        kind: 'error',
        message: `Couldn't create soundboard: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      setNewName('');
      setAdding(false);
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (busy) return;
    const active = profiles.find((p) => p.id === settings.activeProfileId);
    const ok = await confirmDialog({
      title: 'Delete this soundboard?',
      message: active
        ? `“${active.name}” and its ${active.sounds.length} sound${
            active.sounds.length === 1 ? '' : 's'
          } will be removed. The audio files stay on disk in case you want to recover them.`
        : 'This soundboard will be removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await window.api.deleteProfile(settings.activeProfileId);
      await refresh();
    } catch (err) {
      console.error('deleteProfile failed', err);
      useStore.getState().pushToast({
        kind: 'error',
        message: `Couldn't delete soundboard: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const onSwitch = async (id: string) => {
    if (id === settings.activeProfileId || busy) return;
    try {
      await patchSettings({ activeProfileId: id });
    } catch (err) {
      console.error('switch profile failed', err);
    }
  };

  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId);

  return (
    <div className="flex items-center gap-2">
      <ProfilePicker
        profiles={profiles}
        activeProfileId={settings.activeProfileId}
        disabled={busy}
        open={pickerOpen}
        setOpen={setPickerOpen}
        onSwitch={(id) => void onSwitch(id)}
      />
      {adding ? (
        <>
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCreate();
              if (e.key === 'Escape') cancelAdd();
            }}
            placeholder="Name…"
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            className="bg-surface2 border border-border rounded px-2 py-1 text-sm w-32 disabled:opacity-50"
          />
          <button
            className="px-2 py-1 rounded bg-accent hover:bg-accentHover text-sm disabled:opacity-50"
            onClick={() => void onCreate()}
            disabled={busy || !newName.trim()}
          >
            {busy ? '…' : 'Add'}
          </button>
          <button
            className="px-2 py-1 rounded bg-surface2 hover:bg-border text-sm disabled:opacity-50"
            onClick={cancelAdd}
            disabled={busy}
            title="Cancel"
          >
            ×
          </button>
        </>
      ) : (
        <button
          className="px-2 py-1 rounded bg-surface2 hover:bg-border text-sm disabled:opacity-50"
          onClick={() => setAdding(true)}
          disabled={busy}
          title="New soundboard"
        >
          +
        </button>
      )}
      {profiles.length > 1 && !adding && (
        <button
          className="px-2 py-1 rounded bg-surface2 hover:bg-border text-sm text-muted disabled:opacity-50"
          onClick={() => void onDelete()}
          disabled={busy}
          title="Delete current soundboard"
        >
          ×
        </button>
      )}
      {!adding && (
        <>
          <button
            className="px-2 py-1 rounded bg-surface2 hover:bg-border text-sm text-muted disabled:opacity-50"
            onClick={() => activeProfile && setProfileSettingsOpen(true)}
            disabled={busy || !activeProfile}
            title="Profile settings (rename, filter, auto-PTT, export/import…)"
            aria-label="Profile settings"
          >
            ⚙
          </button>
          {activeProfile?.focusFilter?.processName && (
            <span
              className="text-xs text-muted px-2 py-1 rounded bg-surface2 font-mono truncate max-w-[140px]"
              title={`Hotkeys only fire when ${activeProfile.focusFilter.processName} is focused`}
            >
              🎯 {activeProfile.focusFilter.displayName ||
                activeProfile.focusFilter.processName}
            </span>
          )}
        </>
      )}

      {profileSettingsOpen && activeProfile && (
        <ProfileSettingsModal
          profile={activeProfile}
          onClose={() => setProfileSettingsOpen(false)}
        />
      )}
    </div>
  );
}

type ProfilePickerProps = {
  profiles: Profile[];
  activeProfileId: string;
  disabled: boolean;
  open: boolean;
  setOpen: (next: boolean) => void;
  onSwitch: (id: string) => void;
};

function ProfilePicker({
  profiles,
  activeProfileId,
  disabled,
  open,
  setOpen,
  onSwitch,
}: ProfilePickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [focusIdx, setFocusIdx] = useState<number>(() =>
    Math.max(0, profiles.findIndex((p) => p.id === activeProfileId)),
  );

  const active = profiles.find((p) => p.id === activeProfileId);

  useEffect(() => {
    if (!open) return;
    setFocusIdx(Math.max(0, profiles.findIndex((p) => p.id === activeProfileId)));
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (
        t &&
        !popoverRef.current?.contains(t) &&
        !triggerRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(profiles.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = profiles[focusIdx];
        if (target) {
          onSwitch(target.id);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, profiles, activeProfileId, focusIdx, onSwitch, setOpen]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="flex items-center gap-1.5 bg-surface2 border border-border rounded px-2 py-1 text-sm hover:bg-border disabled:opacity-50 min-w-[140px]"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch soundboard"
      >
        <span className="truncate flex-1 text-left">
          {active?.name ?? 'No soundboard'}
        </span>
        <span className="text-muted text-xs shrink-0" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          className="absolute left-0 top-full mt-1 z-30 min-w-[240px] max-w-[320px] max-h-[320px] overflow-y-auto bg-surface border border-border rounded shadow-xl py-1"
        >
          {profiles.map((p, i) => {
            const isActive = p.id === activeProfileId;
            const isFocused = i === focusIdx;
            const count = p.sounds.length;
            const filter = p.focusFilter?.processName ?? null;
            const filterLabel =
              p.focusFilter?.displayName || p.focusFilter?.processName || null;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition ${
                  isFocused ? 'bg-surface2' : ''
                } ${isActive ? 'border-l-2 border-accent' : 'border-l-2 border-transparent'} hover:bg-surface2`}
                onMouseEnter={() => setFocusIdx(i)}
                onClick={() => {
                  onSwitch(p.id);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-text flex-1">
                    {p.name}
                  </span>
                  {isActive && (
                    <span className="text-accent text-xs shrink-0" aria-hidden>
                      ✓
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>
                    {count} sound{count === 1 ? '' : 's'}
                  </span>
                  {filter && (
                    <span
                      className="px-1.5 py-0.5 rounded bg-surface2 font-mono truncate max-w-[140px]"
                      title={`Hotkeys only fire when ${filter} is focused`}
                    >
                      🎯 {filterLabel}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

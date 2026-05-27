import { MouseEvent as ReactMouseEvent, useState } from 'react';
import type { Hotkey, PlayMode, Sound } from '@shared/types';
import { HotkeyCaptureModal } from './HotkeyCaptureModal';
import { ColorSwatch } from './ColorSwatch';
import { Button } from './Button';
import { useStore } from '../state/store';

type Props = {
  profileId: string;
  sound: Sound;
  onPreview: () => void;
  onStopPreview: () => void;
  onChange: (patch: Partial<Sound>) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onTrim: () => void;
};

export function SoundRow({
  profileId,
  sound,
  onPreview,
  onStopPreview,
  onChange,
  onRemove,
  onTrim,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(sound.name);
  const [capturing, setCapturing] = useState(false);
  const playing = useStore((s) => s.playingSoundIds.has(sound.id));
  const setProfiles = useStore((s) => s.setProfiles);

  const startRenaming = () => {
    setName(sound.name);
    setRenaming(true);
  };

  const commitRename = () => {
    setRenaming(false);
    const next = name.trim();
    if (next && next !== sound.name) void onChange({ name: next });
    else setName(sound.name);
  };

  const onHotkeyCaptured = (hk: Hotkey | null) => {
    setCapturing(false);
    void onChange({ hotkey: hk });
  };

  const onContextMenu = async (e: ReactMouseEvent) => {
    e.preventDefault();
    const action = await window.api.showSoundContextMenu();
    if (!action) return;
    switch (action) {
      case 'rename':
        startRenaming();
        break;
      case 'duplicate': {
        const next = await window.api.duplicateSound(profileId, sound.id);
        setProfiles(next);
        break;
      }
      case 'trim':
        onTrim();
        break;
      case 'show-in-folder':
        await window.api.showInFolder(sound.filePath);
        break;
      case 'remove':
        await onRemove();
        break;
    }
  };

  const cardColor = sound.color || undefined;

  return (
    <div
      className={`group relative flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2 transition-colors min-w-0 ${
        playing ? 'sb-playing' : ''
      }`}
      style={
        cardColor
          ? { borderLeftColor: cardColor, borderLeftWidth: 3 }
          : undefined
      }
      onContextMenu={onContextMenu}
    >
      <ColorSwatch
        value={sound.color}
        onChange={(c) => void onChange({ color: c })}
      />
      {/* Name — takes the available space, truncates */}
      <div className="flex-1 min-w-0">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setName(sound.name);
                setRenaming(false);
              }
            }}
            className="w-full bg-surface2 border border-border rounded px-2 py-1 text-sm"
          />
        ) : (
          <button
            className="w-full text-left font-medium truncate hover:text-accent"
            onClick={startRenaming}
            title="Click to rename — right-click for more"
          >
            {sound.name}
          </button>
        )}
      </div>

      {/* Hotkey */}
      <button
        className="hidden md:block text-xs w-28 shrink-0 text-left px-2 py-1 rounded bg-surface2 hover:bg-border border border-border truncate"
        onClick={() => setCapturing(true)}
        title={sound.hotkey?.display ?? 'Click to bind a hotkey'}
      >
        <span className="font-mono truncate block">
          {sound.hotkey?.display ?? '— none —'}
        </span>
      </button>

      {/* Volume */}
      <div className="hidden sm:flex items-center gap-1 shrink-0" title="Volume">
        <span className="text-xs text-muted">🔊</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sound.volume}
          onChange={(e) => void onChange({ volume: Number(e.target.value) })}
          className="w-20"
        />
      </div>

      {/* Pitch */}
      <div className="hidden lg:flex items-center gap-1 shrink-0" title="Pitch (also affects speed)">
        <span className="text-xs text-muted">♪</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={sound.pitch}
          onChange={(e) => void onChange({ pitch: Number(e.target.value) })}
          className="w-20"
        />
      </div>

      {/* Mode */}
      <select
        value={sound.mode}
        onChange={(e) => void onChange({ mode: e.target.value as PlayMode })}
        className="bg-surface2 border border-border rounded px-1.5 py-1 text-xs shrink-0"
        title="Playback mode"
      >
        <option value="oneshot">One-shot</option>
        <option value="toggle">Toggle</option>
        <option value="hold">Hold</option>
      </select>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="primary"
          size="sm"
          onMouseDown={onPreview}
          onMouseUp={sound.mode === 'hold' ? onStopPreview : undefined}
          onMouseLeave={sound.mode === 'hold' ? onStopPreview : undefined}
          title="Play"
        >
          ▶
        </Button>
        <Button size="sm" onClick={onStopPreview} title="Stop">
          ■
        </Button>
        <button
          className="px-2 py-1 rounded text-muted hover:text-danger text-xs opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
          onClick={() => void onRemove()}
          title="Remove sound"
          aria-label="Remove sound"
        >
          ×
        </button>
      </div>

      {capturing && (
        <HotkeyCaptureModal
          onCapture={onHotkeyCaptured}
          onCancel={() => {
            setCapturing(false);
            void window.api.cancelCapture();
          }}
        />
      )}

      {playing && <div className="sb-playing-sweep" aria-hidden />}
    </div>
  );
}

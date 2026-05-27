import { MouseEvent as ReactMouseEvent, useState } from 'react';
import type { Hotkey, PlayMode, Sound } from '@shared/types';
import { HotkeyCaptureModal } from './HotkeyCaptureModal';
import { ColorSwatch } from './ColorSwatch';
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

export function SoundCard({
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
  const compactCards = useStore((s) => s.settings.compactCards ?? false);
  const [expanded, setExpanded] = useState(false);
  const showAdvanced = !compactCards || expanded;

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
      className={`group relative bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 transition-colors ${
        playing ? 'sb-playing' : ''
      }`}
      style={
        cardColor
          ? { borderLeftColor: cardColor, borderLeftWidth: 3 }
          : undefined
      }
      onContextMenu={onContextMenu}
    >
      <div className="flex items-start gap-2">
        <ColorSwatch
          value={sound.color}
          onChange={(c) => void onChange({ color: c })}
        />
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
            className="flex-1 bg-surface2 border border-border rounded px-2 py-1 text-sm"
          />
        ) : (
          <button
            className="flex-1 text-left font-medium truncate hover:text-accent"
            onClick={startRenaming}
            title="Click to rename — or right-click for more options"
          >
            {sound.name}
          </button>
        )}
        <button
          className="text-muted hover:text-danger text-sm px-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
          onClick={() => void onRemove()}
          title="Remove sound"
          aria-label="Remove sound"
        >
          ×
        </button>
      </div>

      <div className="flex gap-2">
        <button
          className="flex-1 px-2 py-1.5 rounded bg-accent hover:bg-accentHover text-white text-sm"
          onMouseDown={onPreview}
          onMouseUp={sound.mode === 'hold' ? onStopPreview : undefined}
          onMouseLeave={sound.mode === 'hold' ? onStopPreview : undefined}
        >
          ▶ Play
        </button>
        <button
          className="px-2 py-1.5 rounded bg-surface2 hover:bg-border text-sm"
          onClick={onStopPreview}
          title="Stop"
        >
          ■
        </button>
      </div>

      <button
        className="text-xs text-left px-2 py-1.5 rounded bg-surface2 hover:bg-border border border-border"
        onClick={() => setCapturing(true)}
        title="Click to bind a hotkey"
      >
        <span className="text-muted">Hotkey: </span>
        <span className="font-mono">{sound.hotkey?.display ?? '— none —'}</span>
      </button>

      {showAdvanced && (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-12 text-muted">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={sound.volume}
              onChange={(e) => void onChange({ volume: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-8 text-right text-muted">{Math.round(sound.volume * 100)}</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="w-12 text-muted" title="Also affects speed">
              Pitch
            </span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={sound.pitch}
              onChange={(e) => void onChange({ pitch: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-10 text-right text-muted">{sound.pitch.toFixed(2)}×</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="w-12 text-muted">Mode</span>
            <select
              value={sound.mode}
              onChange={(e) => void onChange({ mode: e.target.value as PlayMode })}
              className="flex-1 bg-surface2 border border-border rounded px-2 py-1"
            >
              <option value="oneshot">One-shot</option>
              <option value="toggle">Toggle</option>
              <option value="hold">Hold to play</option>
            </select>
            {sound.mode === 'oneshot' && (
              <>
                <span className="text-muted" title="Number of times to replay">
                  ×
                </span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={sound.loopCount ?? 1}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                    void onChange({ loopCount: n });
                  }}
                  className="w-12 bg-surface2 border border-border rounded px-1 py-1 text-center"
                  title="Loop count (1 = play once, 2 = play twice, etc.)"
                />
              </>
            )}
          </div>
        </>
      )}

      {compactCards && (
        <button
          type="button"
          className="self-end text-xs text-muted hover:text-text px-1.5 py-0.5 rounded hover:bg-surface2 transition"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? 'Hide volume/pitch/mode' : 'Show volume/pitch/mode'}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide advanced controls' : 'Show advanced controls'}
        >
          {expanded ? '▴ Less' : '▾ More'}
        </button>
      )}

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

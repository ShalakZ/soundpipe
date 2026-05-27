import { useEffect, useRef, useState } from 'react';
import type { Clip } from '@shared/types';
import { useStore } from '../state/store';
import { confirmDialog } from './confirm';
import { useModalKeys } from './useModalKeys';
import { Button } from './Button';

type Props = { onClose: () => void };

export function ClipsModal({ onClose }: Props) {
  const clips = useStore((s) => s.clips);
  const setClips = useStore((s) => s.setClips);
  const setTrimClipId = useStore((s) => s.setTrimClipId);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrls = useRef<Map<string, string>>(new Map());

  useModalKeys({ onClose });

  // Stop preview + revoke any blob URLs we created when the modal closes.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.removeAttribute('src');
          audioRef.current.load();
        } catch {
          /* ignore */
        }
      }
      blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
      blobUrls.current.clear();
    };
  }, []);

  const getBlobUrl = async (clip: Clip): Promise<string> => {
    const cached = blobUrls.current.get(clip.id);
    if (cached) return cached;
    const bytes = await window.api.readSoundBytes(clip.filePath);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    blobUrls.current.set(clip.id, url);
    return url;
  };

  const onPlay = async (clip: Clip) => {
    if (previewId === clip.id && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setPreviewId(null);
      return;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* ignore */
      }
    }
    const url = await getBlobUrl(clip);
    const el = new Audio(url);
    audioRef.current = el;
    el.addEventListener('ended', () => setPreviewId(null));
    setPreviewId(clip.id);
    void el.play().catch((err) => {
      console.error('clip preview failed', err);
      setPreviewId(null);
    });
  };

  const onTrim = (clip: Clip) => {
    setTrimClipId(clip.id);
    onClose();
  };

  const onRemove = async (clip: Clip) => {
    const ok = await confirmDialog({
      title: 'Delete this clip?',
      message: `“${clip.name}” will be removed permanently.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const next = await window.api.removeClip(clip.id);
    setClips(next);
    const url = blobUrls.current.get(clip.id);
    if (url) {
      URL.revokeObjectURL(url);
      blobUrls.current.delete(clip.id);
    }
  };

  const onClearAll = async () => {
    if (clips.length === 0) return;
    const ok = await confirmDialog({
      title: 'Clear all clips?',
      message: `${clips.length} clip${clips.length === 1 ? '' : 's'} will be deleted permanently.`,
      confirmLabel: 'Clear all',
      tone: 'danger',
    });
    if (!ok) return;
    const next = await window.api.clearAllClips();
    setClips(next);
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
    blobUrls.current.clear();
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg w-[640px] max-h-[90vh] flex flex-col">
        <div className="flex items-center px-5 pt-5 pb-3 border-b border-border">
          <h2 className="text-lg font-semibold">Clips</h2>
          <span className="ml-3 text-xs text-muted">
            {clips.length} clip{clips.length === 1 ? '' : 's'} in the drawer
          </span>
          <div className="ml-auto flex items-center gap-2">
            {clips.length > 0 && (
              <Button size="sm" onClick={() => void onClearAll()}>
                Clear all
              </Button>
            )}
            <button
              className="px-2 py-1 rounded bg-surface2 hover:bg-border text-sm"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          {clips.length === 0 ? (
            <div className="py-12 text-center text-muted text-sm">
              No clips yet. Press your clip hotkey from anywhere to capture the last few seconds of system audio.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {clips.map((clip) => {
                const isPlaying = previewId === clip.id;
                return (
                  <div
                    key={clip.id}
                    className="flex items-center gap-3 bg-surface2 border border-border rounded px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{clip.name}</div>
                      <div className="text-xs text-muted">
                        {formatRelative(clip.capturedAt)} · {clip.durationSeconds.toFixed(1)}s
                      </div>
                    </div>
                    <button
                      className="px-2 py-1 rounded bg-accent hover:bg-accentHover text-white text-xs"
                      onClick={() => void onPlay(clip)}
                      title={isPlaying ? 'Stop' : 'Preview'}
                    >
                      {isPlaying ? '■' : '▶'}
                    </button>
                    <button
                      className="px-2 py-1 rounded bg-surface hover:bg-border text-xs border border-border"
                      onClick={() => onTrim(clip)}
                      title="Trim and save to soundboard"
                    >
                      Trim…
                    </button>
                    <button
                      className="px-2 py-1 rounded text-muted hover:text-danger text-xs"
                      onClick={() => void onRemove(clip)}
                      title="Delete this clip"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border text-xs text-muted">
          Clips are temporary — they auto-delete based on your retention setting (Settings → Audio clip buffer). Trim a clip to turn it into a permanent sound on the active soundboard.
        </div>
      </div>
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) {
    const m = Math.floor(diff / 60_000);
    return `${m} min${m === 1 ? '' : 's'} ago`;
  }
  if (diff < 24 * 3600_000) {
    const h = Math.floor(diff / 3600_000);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = new Date(ts);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

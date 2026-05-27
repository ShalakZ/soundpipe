import { useEffect, useRef, useState } from 'react';
import type { Sound } from '@shared/types';
import { Button } from './Button';

type Props = {
  profileId: string;
  onClose: () => void;
  onImported: (sound: Sound) => void | Promise<void>;
};

type Status = 'idle' | 'downloading' | 'error' | 'done';

export function UrlImportModal({ profileId, onClose, onImported }: Props) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [percent, setPercent] = useState(0);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void window.api.isUrlImportAvailable().then(setAvailable);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    return window.api.onUrlImportProgress((event) => {
      if (event.kind === 'title') setTitle(event.title);
      else if (event.kind === 'progress') setPercent(event.percent);
    });
  }, []);

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setStatus('downloading');
    setPercent(0);
    setTitle('');
    setError(null);
    try {
      // Lazy-fetch yt-dlp on first use — it isn't bundled with the installer anymore.
      if (!available) {
        setTitle('Fetching yt-dlp (one-time, ~18MB)…');
        const result = await window.api.ensureUrlImportBinary();
        if (!result.ok) {
          throw new Error(`Couldn't download yt-dlp: ${result.error}`);
        }
        setAvailable(true);
        setTitle('');
        setPercent(0);
      }
      const sound = await window.api.importFromUrl(profileId, trimmed);
      setStatus('done');
      onClose();
      await onImported(sound);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && status !== 'downloading') void submit();
    if (e.key === 'Escape' && status !== 'downloading') onClose();
  };

  const downloading = status === 'downloading';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 w-[520px]">
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold">Add sound from URL</h2>
          <button
            className="ml-auto px-2 py-1 rounded bg-surface2 hover:bg-border text-sm disabled:opacity-50"
            onClick={onClose}
            disabled={downloading}
          >
            Close
          </button>
        </div>

        {available === false && (
          <div className="bg-surface2 border border-border text-xs rounded p-3 mb-4 text-muted">
            yt-dlp isn't installed yet. The first download below will fetch it
            automatically (~18&nbsp;MB, one-time).
          </div>
        )}

        <p className="text-sm text-muted mb-3">
          Paste a link to a YouTube video, Twitch clip, SoundCloud track, or anything else
          supported by yt-dlp. Audio will be downloaded and added to this soundboard.
        </p>

        <input
          ref={inputRef}
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="https://www.youtube.com/watch?v=…"
          disabled={downloading}
          className="w-full bg-surface2 border border-border rounded px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:border-accent disabled:opacity-50"
        />

        {status === 'downloading' && (
          <div className="mt-4">
            {title && (
              <div className="text-sm mb-2 truncate">
                <span className="text-muted">Downloading: </span>
                {title}
              </div>
            )}
            <div className="h-2 bg-surface2 rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
              />
            </div>
            <div className="text-xs text-muted mt-1 text-right tabular-nums">
              {percent.toFixed(1)}%
            </div>
          </div>
        )}

        {status === 'done' && (
          <div className="mt-4 text-sm text-accent">
            ✓ Added{title ? ` “${title}”` : ''} to the soundboard.
          </div>
        )}

        {status === 'error' && error && (
          <div className="mt-4 text-sm text-danger break-words whitespace-pre-wrap">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end mt-4">
          <Button onClick={onClose} disabled={downloading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={downloading || !url.trim()}
          >
            {downloading ? 'Downloading…' : 'Download'}
          </Button>
        </div>
      </div>
    </div>
  );
}

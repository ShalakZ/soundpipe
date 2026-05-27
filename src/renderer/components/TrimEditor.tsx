import { useEffect, useRef, useState } from 'react';
import { computePeaks, peakAmplitude, renderTrimmed, type Peak } from '../audio/waveform';
import { encodeWav } from '../audio/wav';
import { Button } from './Button';
import { useStore } from '../state/store';

// Resolve `--c-X` CSS variable (space-separated RGB triple) to a canvas-usable
// rgba() string. Falls back to mid-grey if the variable isn't set yet (which
// shouldn't happen after first paint, but keeps the canvas from crashing).
function themeColor(name: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--c-${name}`)
    .trim();
  const [r, g, b] = raw ? raw.split(/\s+/).map(Number) : [128, 128, 128];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Props = {
  /** Path to the audio file to load and edit. */
  sourceFilePath: string;
  /** Display name shown in the modal title. */
  sourceName: string;
  onClose: () => void;
  /** Called when the user clicks Save. Receives the trimmed WAV bytes. */
  onSave: (bytes: Uint8Array) => Promise<void>;
};

const WAVEFORM_WIDTH = 760;
const WAVEFORM_HEIGHT = 120;
const HANDLE_GRAB_PX = 12;

type DragTarget = 'start' | 'end' | null;

export function TrimEditor({ sourceFilePath, sourceName, onClose, onSave }: Props) {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Peak[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [fadeInSec, setFadeInSec] = useState(0);
  const [fadeOutSec, setFadeOutSec] = useState(0);
  const [normalize, setNormalize] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState<number | null>(null);
  const [loopPlay, setLoopPlay] = useState(true);
  const [pausedAtSec, setPausedAtSec] = useState<number | null>(null);
  const theme = useStore((s) => s.settings.theme);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const dragRef = useRef<DragTarget>(null);
  const playStartedAtRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const rangeRef = useRef({ start: 0, end: 0 });

  // Decode the file once on mount.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const bytes = await window.api.readSoundBytes(sourceFilePath);
        // Web Audio expects an ArrayBuffer; copy out of the Uint8Array view.
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(ab);
        if (cancelled) {
          void ctx.close();
          return;
        }
        ctxRef.current = ctx;
        const initialPeaks = computePeaks(buf, WAVEFORM_WIDTH);
        setAudioBuffer(buf);
        setPeaks(initialPeaks);
        setStartSec(0);
        setEndSec(buf.duration);
      } catch (err) {
        if (!cancelled) {
          setError(
            `Couldn't decode audio: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceFilePath]);

  // Clean up audio context on unmount.
  useEffect(() => {
    return () => {
      stopPlayback();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint canvas whenever selection, peaks, playhead, or theme change.
  // (Theme is in the deps because the canvas draws with resolved RGB strings —
  // CSS variable changes on <html> don't auto-repaint pixels.)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !audioBuffer) return;
    drawWaveform(
      canvas,
      peaks,
      audioBuffer.duration,
      startSec,
      endSec,
      playheadSec,
    );
  }, [peaks, audioBuffer, startSec, endSec, playheadSec, theme]);

  const cancelPlayhead = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  };

  const stopPlayback = () => {
    cancelPlayhead();
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* ignore */
      }
      sourceRef.current = null;
    }
    setIsPlaying(false);
    setPlayheadSec(null);
  };

  // Keyboard nudges for the trim handles — left/right move by 0.05s, with
  // Shift for coarser 0.5s steps. Easier than fine-mouse-dragging for short
  // precision edits.
  useEffect(() => {
    if (!audioBuffer) return;
    const handler = (e: KeyboardEvent) => {
      // Don't hijack when the user is typing in inputs
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const step = (e.shiftKey ? 0.5 : 0.05) * (e.key === 'ArrowLeft' ? -1 : 1);
      // Default to nudging the end handle; Alt+arrow nudges the start.
      if (e.altKey) {
        setStartSec((prev) =>
          Math.max(0, Math.min(endSec - 0.01, prev + step)),
        );
      } else {
        setEndSec((prev) =>
          Math.max(startSec + 0.01, Math.min(audioBuffer.duration, prev + step)),
        );
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [audioBuffer, startSec, endSec]);

  const playSelection = (fromSec?: number) => {
    if (!audioBuffer || !ctxRef.current) return;
    if (endSec <= startSec) return;
    stopPlayback();
    const ctx = ctxRef.current;
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = loopPlay;
    source.loopStart = startSec;
    source.loopEnd = endSec;
    source.connect(ctx.destination);

    const startFrom = clamp(fromSec ?? startSec, startSec, endSec - 0.001);
    const initialOffset = startFrom - startSec;
    if (loopPlay) {
      source.start(0, startFrom);
    } else {
      source.start(0, startFrom, endSec - startFrom);
    }
    sourceRef.current = source;
    playStartedAtRef.current = ctx.currentTime;
    rangeRef.current = { start: startSec, end: endSec };
    setIsPlaying(true);
    setPausedAtSec(null);

    // Fires when the source stops — naturally (non-loop end) or via our stop().
    // We only care about the natural case; check that this source is still active.
    source.onended = () => {
      if (sourceRef.current === source) {
        cancelPlayhead();
        sourceRef.current = null;
        setIsPlaying(false);
        setPlayheadSec(null);
        setPausedAtSec(null);
      }
    };

    const tick = () => {
      const audioCtx = ctxRef.current;
      if (!audioCtx || !sourceRef.current) return;
      const { start, end } = rangeRef.current;
      const loopLen = Math.max(0.0001, end - start);
      const elapsed = audioCtx.currentTime - playStartedAtRef.current + initialOffset;
      const pos = loopPlay ? elapsed % loopLen : Math.min(elapsed, loopLen);
      setPlayheadSec(start + pos);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  };

  const pausePlayback = () => {
    if (!isPlaying) return;
    const current = playheadSec ?? startSec;
    setPausedAtSec(current);
    cancelPlayhead();
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* ignore */
      }
      sourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (isPlaying) pausePlayback();
    else playSelection(pausedAtSec ?? undefined);
  };

  const stopAndReset = () => {
    stopPlayback();
    setPausedAtSec(null);
  };

  // If the user moves a handle while playing, restart so the new range takes
  // effect immediately (loopStart/loopEnd changes are sometimes ignored by
  // Chromium until the next loop boundary). Debounced so dragging a handle
  // doesn't recreate the AudioBufferSource on every mousemove tick — once the
  // user stops moving for ~80ms, the restart fires. If paused outside the new
  // range, forget the pause position.
  useEffect(() => {
    if (isPlaying) {
      const id = window.setTimeout(() => playSelection(), 80);
      return () => window.clearTimeout(id);
    }
    if (pausedAtSec !== null && (pausedAtSec < startSec || pausedAtSec > endSec)) {
      setPausedAtSec(null);
      setPlayheadSec(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSec, endSec]);

  // Toggling loop mid-playback: restart from the current playhead so the
  // change takes effect immediately. Live `source.loop` mutations are
  // unreliable across browsers.
  useEffect(() => {
    if (!isPlaying) return;
    const resumeAt = playheadSec ?? startSec;
    playSelection(resumeAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopPlay]);

  const xToSec = (x: number): number => {
    if (!audioBuffer) return 0;
    return clamp((x / WAVEFORM_WIDTH) * audioBuffer.duration, 0, audioBuffer.duration);
  };

  const secToX = (sec: number): number => {
    if (!audioBuffer) return 0;
    return (sec / audioBuffer.duration) * WAVEFORM_WIDTH;
  };

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioBuffer) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startX = secToX(startSec);
    const endX = secToX(endSec);
    const distStart = Math.abs(x - startX);
    const distEnd = Math.abs(x - endX);

    let target: DragTarget;
    if (distStart < HANDLE_GRAB_PX && distStart <= distEnd) target = 'start';
    else if (distEnd < HANDLE_GRAB_PX) target = 'end';
    else {
      // Clicked outside either handle — snap the nearest one to the click
      target = distStart < distEnd ? 'start' : 'end';
      const t = xToSec(x);
      if (target === 'start') setStartSec(Math.min(t, endSec - 0.01));
      else setEndSec(Math.max(t, startSec + 0.01));
    }

    dragRef.current = target;
    // Capture global mouse events while dragging
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const cx = ev.clientX - rect.left;
      const t = xToSec(cx);
      if (dragRef.current === 'start') {
        setStartSec(clamp(t, 0, endSec - 0.01));
      } else {
        setEndSec(clamp(t, startSec + 0.01, audioBuffer.duration));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const save = async () => {
    if (!audioBuffer) return;
    if (endSec <= startSec) {
      setError('End must be after start.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const trimmedLength = endSec - startSec;
      const fadeIn = clamp(fadeInSec, 0, trimmedLength);
      const fadeOut = clamp(fadeOutSec, 0, trimmedLength - fadeIn);
      const gain = normalize
        ? 1 / Math.max(peakAmplitude(audioBuffer), 0.0001)
        : 1;
      const trimmed = renderTrimmed(audioBuffer, {
        startSec,
        endSec,
        fadeInSec: fadeIn,
        fadeOutSec: fadeOut,
        gain,
      });
      const wavBytes = encodeWav(trimmed);
      stopPlayback();
      await onSave(wavBytes);
    } catch (err) {
      setError(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  };

  const duration = audioBuffer?.duration ?? 0;
  const trimmedLength = Math.max(0, endSec - startSec);
  const loaded = audioBuffer !== null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 w-[820px] max-h-[90vh] overflow-auto">
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold truncate">Trim — {sourceName}</h2>
          <button
            className="ml-auto px-2 py-1 rounded bg-surface2 hover:bg-border text-sm disabled:opacity-50"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
        </div>

        {!loaded && !error && (
          <div className="py-12 text-center text-muted">Decoding audio…</div>
        )}

        {error && (
          <div className="bg-danger/10 border border-danger/40 text-sm rounded p-3 mb-4 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {loaded && (
          <>
            <div className="bg-surface2 border border-border rounded p-2 mb-3 inline-block">
              <canvas
                ref={canvasRef}
                width={WAVEFORM_WIDTH}
                height={WAVEFORM_HEIGHT}
                onMouseDown={onCanvasMouseDown}
                className="block cursor-ew-resize select-none"
                style={{ width: WAVEFORM_WIDTH, height: WAVEFORM_HEIGHT }}
              />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
              <label className="flex items-center gap-2">
                <span className="w-14 text-muted">Start</span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.01}
                  value={startSec}
                  onChange={(e) =>
                    setStartSec(clamp(Number(e.target.value), 0, endSec - 0.01))
                  }
                  className="flex-1"
                />
                <span className="font-mono w-16 text-right tabular-nums">
                  {formatTime(startSec)}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-14 text-muted">End</span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.01}
                  value={endSec}
                  onChange={(e) =>
                    setEndSec(clamp(Number(e.target.value), startSec + 0.01, duration))
                  }
                  className="flex-1"
                />
                <span className="font-mono w-16 text-right tabular-nums">
                  {formatTime(endSec)}
                </span>
              </label>

              <label
                className="flex items-center gap-2"
                title="Ramps the start of the clip up from silent to full volume over this many seconds. Use to smooth a hard cut at the beginning."
              >
                <span className="w-14 text-muted">Fade in</span>
                <input
                  type="range"
                  min={0}
                  max={Math.min(2, trimmedLength)}
                  step={0.01}
                  value={Math.min(fadeInSec, trimmedLength)}
                  onChange={(e) => setFadeInSec(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="font-mono w-16 text-right tabular-nums">
                  {fadeInSec.toFixed(2)}s
                </span>
              </label>
              <label
                className="flex items-center gap-2"
                title="Ramps the end of the clip down from full volume to silent over this many seconds. Use to avoid an abrupt cut at the end."
              >
                <span className="w-14 text-muted">Fade out</span>
                <input
                  type="range"
                  min={0}
                  max={Math.min(2, trimmedLength)}
                  step={0.01}
                  value={Math.min(fadeOutSec, trimmedLength)}
                  onChange={(e) => setFadeOutSec(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="font-mono w-16 text-right tabular-nums">
                  {fadeOutSec.toFixed(2)}s
                </span>
              </label>
            </div>

            <div className="flex items-center gap-3 mb-4 text-sm">
              <Button
                variant="primary"
                onClick={togglePlay}
                disabled={trimmedLength <= 0}
                title={isPlaying ? 'Pause (selection)' : 'Play selection'}
              >
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </Button>
              <Button
                onClick={stopAndReset}
                disabled={!isPlaying && pausedAtSec === null}
                title="Stop and reset to start"
              >
                ■ Stop
              </Button>
              <label
                className="flex items-center gap-2"
                title="Loop the selection while it plays"
              >
                <input
                  type="checkbox"
                  checked={loopPlay}
                  onChange={(e) => setLoopPlay(e.target.checked)}
                />
                Loop
              </label>
              <label
                className="flex items-center gap-2"
                title="Scales the whole clip up so its loudest point reaches maximum volume. No effect if the source is already loud (e.g. most YouTube audio)."
              >
                <input
                  type="checkbox"
                  checked={normalize}
                  onChange={(e) => setNormalize(e.target.checked)}
                />
                Normalize volume
                {audioBuffer && (
                  <span className="text-xs text-muted">
                    ({normalizationGainDb(audioBuffer)})
                  </span>
                )}
              </label>
              <span className="ml-auto text-muted">
                Length: <span className="font-mono">{formatTime(trimmedLength)}</span>
                {' / '}
                <span className="font-mono">{formatTime(duration)}</span>
              </span>
            </div>

            <p className="text-xs text-muted mb-4">
              Drag the purple lines on the waveform, use the sliders, or nudge with{' '}
              <kbd className="bg-surface2 border border-border px-1 rounded text-[10px]">←</kbd>{' '}
              <kbd className="bg-surface2 border border-border px-1 rounded text-[10px]">→</kbd>{' '}
              (hold <kbd className="bg-surface2 border border-border px-1 rounded text-[10px]">Shift</kbd> for bigger steps;{' '}
              <kbd className="bg-surface2 border border-border px-1 rounded text-[10px]">Alt</kbd> targets the start handle).
              The saved file replaces the original audio (lossless WAV).
            </p>

            <div className="flex gap-2 justify-end">
              <Button onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={saving || trimmedLength <= 0}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Peak[],
  duration: number,
  startSec: number,
  endSec: number,
  playheadSec: number | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = themeColor('surface');
  ctx.fillRect(0, 0, w, h);

  const startX = duration > 0 ? (startSec / duration) * w : 0;
  const endX = duration > 0 ? (endSec / duration) * w : w;

  // Dim regions outside the selection. Use the bg color at half opacity so
  // outside reads as "less prominent" on both dark and light themes (a flat
  // black overlay would invert poorly on light backgrounds).
  ctx.fillStyle = themeColor('bg', 0.6);
  if (startX > 0) ctx.fillRect(0, 0, startX, h);
  if (endX < w) ctx.fillRect(endX, 0, w - endX, h);

  // Waveform
  const center = h / 2;
  const ampScale = (h - 4) / 2;
  ctx.strokeStyle = themeColor('accent-hover');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < Math.min(peaks.length, w); x++) {
    const peak = peaks[x];
    const y1 = center - peak.max * ampScale;
    const y2 = center - peak.min * ampScale;
    ctx.moveTo(x + 0.5, y1);
    ctx.lineTo(x + 0.5, y2);
  }
  ctx.stroke();

  // Selection handles
  ctx.strokeStyle = themeColor('accent');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX + 0.5, 0);
  ctx.lineTo(startX + 0.5, h);
  ctx.moveTo(endX + 0.5, 0);
  ctx.lineTo(endX + 0.5, h);
  ctx.stroke();

  // Grab handles (small triangles top/bottom)
  ctx.fillStyle = themeColor('accent');
  drawHandle(ctx, startX, h, 'left');
  drawHandle(ctx, endX, h, 'right');

  // Playhead (drawn last, on top of everything). Uses the text token so it
  // stays high-contrast on both dark and light themes.
  if (playheadSec !== null && duration > 0) {
    const playheadX = (playheadSec / duration) * w;
    ctx.strokeStyle = themeColor('text');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX + 0.5, 0);
    ctx.lineTo(playheadX + 0.5, h);
    ctx.stroke();
  }
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  h: number,
  side: 'left' | 'right',
): void {
  const size = 6;
  const dir = side === 'left' ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x + dir * size, 0);
  ctx.lineTo(x, size);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, h);
  ctx.lineTo(x + dir * size, h);
  ctx.lineTo(x, h - size);
  ctx.closePath();
  ctx.fill();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function normalizationGainDb(buffer: AudioBuffer): string {
  const peak = peakAmplitude(buffer);
  if (peak <= 0) return '+0.0 dB';
  const db = 20 * Math.log10(1 / peak);
  if (db < 0.1) return 'no boost — already at peak';
  return `+${db.toFixed(1)} dB`;
}

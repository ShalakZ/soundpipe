import type { Settings, Sound } from '@shared/types';

type Voice = {
  soundId: string;
  micEl: HTMLAudioElement;
  monitorEl: HTMLAudioElement | null;
  /** Plays remaining after the current one. Used for oneshot loopCount > 1. */
  repeatsLeft: number;
};

// HTMLAudioElement.setSinkId exists in Chromium but isn't on the standard lib types.
type AudioElementWithSink = HTMLAudioElement & {
  setSinkId(deviceId: string): Promise<void>;
  sinkId?: string;
};

// Stream the file from disk via the custom sb-file:// protocol handler in
// main/index.ts. This removes the previous Blob/ObjectURL cache, which grew
// unbounded as the user triggered more sounds (each blob held a full copy of
// the audio file in memory). The protocol handler supports Range requests so
// HTMLAudioElement seeks the same way it would with a regular URL.
//
// Note: the URL must have a host segment ("local" here) — Electron 42+ /
// Chromium's media element URL-safety check rejects host-less custom-protocol
// URLs ("Media load rejected by URL safety check"). The main-side handler
// reads url.pathname and ignores the host, so any non-empty string works.
function toSbFileUrl(filePath: string): string {
  let p = filePath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  const encoded = p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `sb-file://local${encoded}`;
}

const MEDIA_ERR_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

type SilentableAudio = HTMLAudioElement & { __sbDisposed?: boolean };

function attachMediaErrorLogger(el: HTMLAudioElement, label: string, src: string): void {
  el.addEventListener('error', () => {
    if ((el as SilentableAudio).__sbDisposed) return;
    const e = el.error;
    console.error(
      `[soundpipe] ${label} audio error`,
      e ? `code=${e.code} (${MEDIA_ERR_NAMES[e.code] ?? '?'}) message=${e.message}` : '(no error)',
      'src=',
      src,
    );
  });
}

export class AudioEngine {
  private voices = new Map<string, Voice>();
  private settings: Settings;
  private playingListener: ((playing: Set<string>) => void) | null = null;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  /** Subscribe to changes in the set of currently-playing sound IDs. */
  setOnPlayingChange(fn: (playing: Set<string>) => void): void {
    this.playingListener = fn;
    fn(new Set(this.voices.keys()));
  }

  private notifyPlayingChange(): void {
    if (this.playingListener) this.playingListener(new Set(this.voices.keys()));
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    // Apply master volume to in-flight voices
    for (const v of this.voices.values()) {
      this.applyVolume(v, undefined);
    }
  }

  /** Re-target sink on already-playing voices when device selection changes. */
  async retargetSinks(): Promise<void> {
    for (const v of this.voices.values()) {
      await this.applySinks(v);
    }
  }

  isPlaying(soundId: string): boolean {
    return this.voices.has(soundId);
  }

  async trigger(sound: Sound, restartOnRepress: boolean): Promise<void> {
    // toggle mode: pressing again stops
    if (sound.mode === 'toggle' && this.voices.has(sound.id)) {
      this.stop(sound.id);
      return;
    }
    // oneshot mode honors restartOnRepress
    if (sound.mode === 'oneshot' && this.voices.has(sound.id)) {
      if (restartOnRepress) {
        this.stop(sound.id);
      } else {
        return;
      }
    }
    // hold mode: ignore re-trigger if already playing (auto-repeat keys)
    if (sound.mode === 'hold' && this.voices.has(sound.id)) {
      return;
    }
    await this.play(sound);
  }

  async release(sound: Sound): Promise<void> {
    if (sound.mode === 'hold') this.stop(sound.id);
  }

  stop(soundId: string): void {
    const voice = this.voices.get(soundId);
    if (!voice) return;
    this.disposeVoice(voice);
    this.voices.delete(soundId);
    this.notifyPlayingChange();
  }

  stopAll(): void {
    if (this.voices.size === 0) return;
    for (const v of this.voices.values()) this.disposeVoice(v);
    this.voices.clear();
    this.notifyPlayingChange();
  }

  private async play(sound: Sound): Promise<void> {
    const src = toSbFileUrl(sound.filePath);
    console.log('[soundpipe] play', sound.name, 'src=', src, 'fsPath=', sound.filePath);
    // hold + toggle both keep the sound playing until externally stopped;
    // oneshot may either play once or N times (handled via repeatsLeft + onEnded).
    const shouldLoopForever = sound.mode === 'hold' || sound.mode === 'toggle';
    const micEl = new Audio(src) as AudioElementWithSink;
    micEl.preload = 'auto';
    micEl.loop = shouldLoopForever;
    attachMediaErrorLogger(micEl, 'mic', src);

    let monitorEl: AudioElementWithSink | null = null;
    if (this.settings.monitorDeviceId) {
      monitorEl = new Audio(src) as AudioElementWithSink;
      monitorEl.preload = 'auto';
      monitorEl.loop = shouldLoopForever;
      attachMediaErrorLogger(monitorEl, 'monitor', src);
    }

    const initialRepeats = Math.max(0, (sound.loopCount ?? 1) - 1);
    const voice: Voice = {
      soundId: sound.id,
      micEl,
      monitorEl,
      repeatsLeft: initialRepeats,
    };
    this.voices.set(sound.id, voice);
    this.notifyPlayingChange();
    this.applyVolume(voice, sound);
    this.applyPitch(voice, sound);

    try {
      await this.applySinks(voice);
    } catch (err) {
      console.error('setSinkId failed', err);
    }

    const onEnded = () => {
      // Hold + toggle both have loop=true so 'ended' shouldn't fire on them,
      // but skip defensively in case of edge cases (e.g. source error).
      if (sound.mode === 'hold' || sound.mode === 'toggle') return;
      // Oneshot with loopCount > 1: rewind both elements and play again.
      if (voice.repeatsLeft > 0) {
        voice.repeatsLeft--;
        try {
          voice.micEl.currentTime = 0;
          void voice.micEl.play();
        } catch {
          /* ignore */
        }
        if (voice.monitorEl) {
          try {
            voice.monitorEl.currentTime = 0;
            void voice.monitorEl.play();
          } catch {
            /* ignore */
          }
        }
        return;
      }
      this.stop(sound.id);
    };
    // Listen only on micEl — the two elements end ~simultaneously, and dual
    // listeners would double-decrement repeatsLeft.
    micEl.addEventListener('ended', onEnded);

    const promises: Promise<void>[] = [micEl.play()];
    if (monitorEl) promises.push(monitorEl.play());
    try {
      await Promise.all(promises);
    } catch (err) {
      console.error('audio.play failed', err);
      this.stop(sound.id);
    }
  }

  private async applySinks(voice: Voice): Promise<void> {
    const micId = this.settings.virtualMicDeviceId;
    if (micId && typeof voice.micEl.setSinkId === 'function') {
      await (voice.micEl as AudioElementWithSink).setSinkId(micId);
    }
    if (voice.monitorEl && this.settings.monitorDeviceId) {
      if (typeof (voice.monitorEl as AudioElementWithSink).setSinkId === 'function') {
        await (voice.monitorEl as AudioElementWithSink).setSinkId(
          this.settings.monitorDeviceId,
        );
      }
    }
  }

  private applyVolume(voice: Voice, sound: Sound | undefined): void {
    // When called without a sound (e.g., master volume changed), keep current per-sound volume.
    // We stash it on the element via dataset.
    const perSound = sound?.volume ?? Number(voice.micEl.dataset.perSoundVolume ?? '1');
    if (sound) voice.micEl.dataset.perSoundVolume = String(perSound);
    const vol = Math.max(0, Math.min(1, perSound * this.settings.masterVolume));
    voice.micEl.volume = vol;
    if (voice.monitorEl) voice.monitorEl.volume = vol;
  }

  private applyPitch(voice: Voice, sound: Sound): void {
    const rate = Math.max(0.25, Math.min(4, sound.pitch));
    voice.micEl.playbackRate = rate;
    if (voice.monitorEl) voice.monitorEl.playbackRate = rate;
  }

  private disposeVoice(v: Voice): void {
    (v.micEl as SilentableAudio).__sbDisposed = true;
    try {
      v.micEl.pause();
      v.micEl.removeAttribute('src');
      v.micEl.load();
    } catch {}
    if (v.monitorEl) {
      (v.monitorEl as SilentableAudio).__sbDisposed = true;
      try {
        v.monitorEl.pause();
        v.monitorEl.removeAttribute('src');
        v.monitorEl.load();
      } catch {}
    }
  }
}

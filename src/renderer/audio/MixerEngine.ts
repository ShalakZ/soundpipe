import type { Settings } from '@shared/types';

// HTMLAudioElement.setSinkId exists in Chromium but isn't on the standard lib types.
type AudioElementWithSink = HTMLAudioElement & {
  setSinkId(deviceId: string): Promise<void>;
};

const TARGET_SAMPLE_RATE = 48000;

/**
 * MixerEngine — host-side mixer-mode audio graph.
 *
 * Captures the user's real microphone and blends it with soundboard playback
 * into a single MediaStream, then renders that stream into the configured
 * virtual mic device (SoundPipe / VB-CABLE / VoiceMeeter render endpoint).
 * Other apps (Discord, CS2, OBS) then hear voice + sounds together on one
 * mic — the "just works" UX. When mixer mode is off, this engine stays idle
 * and AudioEngine routes clips directly to the device via setSinkId
 * (preserving the original v0.1.0 behavior bit-for-bit).
 *
 * Lifecycle:
 *   - `setSettings(next)` (re)starts/stops the graph based on `mixerMode`,
 *     re-targets the output when `virtualMicDeviceId` changes, and re-acquires
 *     the mic when `realMicDeviceId` changes.
 *   - `attachClip(el)` / `detachClip(el)` are called by AudioEngine per voice.
 *
 * Web Audio gotcha: `createMediaElementSource(el)` is one-time per element.
 * Once attached, the element can never play to the default output again, and
 * can't be re-attached to another context. So we only attach voices that
 * started AFTER mixer mode was enabled, and AudioEngine stops in-flight voices
 * when mixer mode toggles (driven from App.tsx).
 */
export class MixerEngine {
  private settings: Settings;
  private ctx: AudioContext | null = null;
  private mixGain: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private outputEl: HTMLAudioElement | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGain: GainNode | null = null;
  private started = false;
  private clipSources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

  constructor(settings: Settings) {
    this.settings = settings;
  }

  async setSettings(next: Settings): Promise<void> {
    const prev = this.settings;
    this.settings = next;
    if (next.mixerMode) {
      await this.ensureStarted();
      if (prev.virtualMicDeviceId !== next.virtualMicDeviceId) {
        await this.applyOutputSink();
      }
      if ((prev.realMicDeviceId ?? null) !== (next.realMicDeviceId ?? null)) {
        await this.applyMicSource();
      }
    } else if (this.started) {
      this.stop();
    }
  }

  isActive(): boolean {
    return this.started;
  }

  /** Wire a playing soundboard voice into the mix. Called by AudioEngine
   * before the element starts playing, so audio is captured from sample 1. */
  attachClip(el: HTMLAudioElement): void {
    if (!this.started || !this.ctx || !this.mixGain) return;
    if (this.clipSources.has(el)) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.mixGain);
      this.clipSources.set(el, src);
    } catch (err) {
      console.error('[soundpipe] mixer attachClip failed', err);
    }
  }

  detachClip(el: HTMLAudioElement): void {
    const src = this.clipSources.get(el);
    if (!src) return;
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
    this.clipSources.delete(el);
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    try {
      this.ctx = new AudioContext({
        sampleRate: TARGET_SAMPLE_RATE,
        latencyHint: 'interactive',
      });
    } catch (err) {
      console.error('[soundpipe] mixer AudioContext init failed', err);
      return;
    }
    this.mixGain = this.ctx.createGain();
    this.mixGain.gain.value = 1.0;
    this.dest = this.ctx.createMediaStreamDestination();
    this.mixGain.connect(this.dest);

    // Long-lived output element: continuously streams the mix to the virtual
    // mic device. Pause/srcObject=null on stop().
    this.outputEl = new Audio();
    this.outputEl.srcObject = this.dest.stream;
    await this.applyOutputSink();
    try {
      await this.outputEl.play();
    } catch (err) {
      console.error('[soundpipe] mixer output play failed', err);
    }

    await this.applyMicSource();
    this.started = true;
  }

  private async applyOutputSink(): Promise<void> {
    if (!this.outputEl) return;
    const sinkId = this.settings.virtualMicDeviceId;
    if (!sinkId) return;
    const el = this.outputEl as AudioElementWithSink;
    if (typeof el.setSinkId !== 'function') return;
    try {
      await el.setSinkId(sinkId);
    } catch (err) {
      console.error('[soundpipe] mixer setSinkId failed', err);
    }
  }

  private async applyMicSource(): Promise<void> {
    if (!this.ctx || !this.mixGain) return;

    // Tear down any previous mic chain so we can re-acquire cleanly.
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch { /* ignore */ }
      this.micSource = null;
    }
    if (this.micGain) {
      try { this.micGain.disconnect(); } catch { /* ignore */ }
      this.micGain = null;
    }
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop();
      this.micStream = null;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: this.settings.realMicDeviceId
          ? { deviceId: { exact: this.settings.realMicDeviceId } }
          : true,
      };
      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micGain = this.ctx.createGain();
      this.micGain.gain.value = 1.0; // future: mic level, mute, push-to-talk
      this.micSource.connect(this.micGain);
      this.micGain.connect(this.mixGain);
    } catch (err) {
      console.error('[soundpipe] mixer getUserMedia failed', err);
    }
  }

  private stop(): void {
    if (!this.started) return;
    if (this.outputEl) {
      try { this.outputEl.pause(); } catch { /* ignore */ }
      this.outputEl.srcObject = null;
      this.outputEl = null;
    }
    if (this.dest) {
      try { this.dest.disconnect(); } catch { /* ignore */ }
      this.dest = null;
    }
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch { /* ignore */ }
      this.micSource = null;
    }
    if (this.micGain) {
      try { this.micGain.disconnect(); } catch { /* ignore */ }
      this.micGain = null;
    }
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop();
      this.micStream = null;
    }
    if (this.mixGain) {
      try { this.mixGain.disconnect(); } catch { /* ignore */ }
      this.mixGain = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => { /* ignore */ });
      this.ctx = null;
    }
    this.started = false;
  }
}

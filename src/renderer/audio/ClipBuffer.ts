// Rolling N-second audio capture buffer, AudioWorklet edition.
//
// We register a small AudioWorkletProcessor that runs on the audio rendering
// thread and maintains a per-channel ring buffer. Main-thread talks to it
// via port messages: `init` to configure ring size, `snapshot` to request
// the last N seconds back as Float32Array transferable channels.
//
// The worklet source is shipped inline as a Blob URL — avoids any Vite asset
// handling and keeps everything in one file.

const WORKLET_SOURCE = `
class ClipBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = [];
    this.ringLen = 0;
    this.writeIndex = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m && m.type === 'init') {
        this.channels = [];
        this.ringLen = m.ringLen;
        for (let c = 0; c < m.numChannels; c++) {
          this.channels.push(new Float32Array(m.ringLen));
        }
        this.writeIndex = 0;
      } else if (m && m.type === 'snapshot') {
        const requested = Math.min(this.ringLen, Math.max(1, m.samples | 0));
        const start = (this.writeIndex - requested + this.ringLen) % this.ringLen;
        const channels = this.channels.map(ring => {
          const out = new Float32Array(requested);
          for (let i = 0; i < requested; i++) {
            out[i] = ring[(start + i) % this.ringLen];
          }
          return out;
        });
        this.port.postMessage(
          { type: 'snapshot-data', channels, sampleRate, requestId: m.requestId },
          channels.map(c => c.buffer)
        );
      }
    };
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || this.channels.length === 0) return true;
    const samples = input[0].length;
    const numCh = Math.min(input.length, this.channels.length);
    for (let c = 0; c < numCh; c++) {
      const src = input[c];
      const ring = this.channels[c];
      let w = this.writeIndex;
      for (let i = 0; i < samples; i++) {
        ring[w] = src[i];
        w = (w + 1) % this.ringLen;
      }
    }
    this.writeIndex = (this.writeIndex + samples) % this.ringLen;
    return true;
  }
}
registerProcessor('clip-buffer', ClipBufferProcessor);
`;

let workletModuleUrl: string | null = null;

function getWorkletUrl(): string {
  if (workletModuleUrl) return workletModuleUrl;
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  workletModuleUrl = URL.createObjectURL(blob);
  return workletModuleUrl;
}

type PendingSnapshot = {
  requestId: number;
  resolve: (channels: Float32Array[]) => void;
  reject: (err: Error) => void;
  timeout: number;
};

export class ClipBuffer {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;

  private sampleRate = 48000;
  private numChannels = 2;
  private ringLength = 0;

  private nextRequestId = 1;
  private pending = new Map<number, PendingSnapshot>();

  isRunning(): boolean {
    return this.worklet !== null;
  }

  async startWithDevice(deviceId: string, bufferSeconds: number): Promise<void> {
    await this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    await this.setupFromStream(stream, bufferSeconds);
  }

  async startWithSystemAudio(bufferSeconds: number): Promise<void> {
    await this.stop();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    for (const t of stream.getVideoTracks()) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
      try {
        stream.removeTrack(t);
      } catch {
        /* ignore */
      }
    }
    if (stream.getAudioTracks().length === 0) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      throw new Error(
        'System audio capture returned no audio track. Try restarting the app or fall back to a specific input device.',
      );
    }
    await this.setupFromStream(stream, bufferSeconds);
  }

  private async setupFromStream(
    stream: MediaStream,
    bufferSeconds: number,
  ): Promise<void> {
    this.stream = stream;

    const ctx = new AudioContext();
    this.ctx = ctx;
    this.sampleRate = ctx.sampleRate;

    await ctx.audioWorklet.addModule(getWorkletUrl());

    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings() ?? {};
    const inferredChannels = settings.channelCount ?? 2;
    this.numChannels = Math.max(1, Math.min(2, inferredChannels));
    this.ringLength = Math.ceil(this.sampleRate * Math.max(1, bufferSeconds));

    const source = ctx.createMediaStreamSource(stream);
    this.source = source;

    const worklet = new AudioWorkletNode(ctx, 'clip-buffer', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: this.numChannels,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.worklet = worklet;

    worklet.port.onmessage = (e) => {
      const m = e.data;
      if (!m || m.type !== 'snapshot-data') return;
      const pending = this.pending.get(m.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(m.requestId);
      pending.resolve(m.channels as Float32Array[]);
    };

    worklet.port.postMessage({
      type: 'init',
      numChannels: this.numChannels,
      ringLen: this.ringLength,
    });

    source.connect(worklet);
    // AudioWorkletNode with numberOfOutputs: 0 doesn't need to be connected to
    // destination — unlike ScriptProcessor it runs unconditionally.
  }

  async snapshot(seconds: number): Promise<AudioBuffer | null> {
    if (!this.ctx || !this.worklet) return null;
    const requestId = this.nextRequestId++;
    const samples = Math.min(
      this.ringLength,
      Math.max(1, Math.floor(seconds * this.sampleRate)),
    );

    const channels = await new Promise<Float32Array[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error('Snapshot timed out (worklet did not respond)'));
        }
      }, 2000) as unknown as number;
      this.pending.set(requestId, { requestId, resolve, reject, timeout });
      this.worklet!.port.postMessage({ type: 'snapshot', samples, requestId });
    });

    if (channels.length === 0 || channels[0].length === 0) return null;
    const length = channels[0].length;
    const offline = new OfflineAudioContext(channels.length, length, this.sampleRate);
    const out = offline.createBuffer(channels.length, length, this.sampleRate);
    for (let c = 0; c < channels.length; c++) {
      out.getChannelData(c).set(channels[c]);
    }
    return out;
  }

  async stop(): Promise<void> {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error('ClipBuffer stopped'));
    }
    this.pending.clear();

    if (this.worklet) {
      try {
        this.worklet.port.onmessage = null;
        this.worklet.disconnect();
      } catch {
        /* ignore */
      }
      this.worklet = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      await this.ctx.close().catch(() => {
        /* ignore */
      });
      this.ctx = null;
    }
  }
}

// Downsample an AudioBuffer into one (min, max) amplitude pair per pixel column.
// Used to draw a static waveform with a single canvas pass.

export type Peak = { min: number; max: number };

export function computePeaks(buffer: AudioBuffer, columns: number): Peak[] {
  const totalSamples = buffer.length;
  const numChannels = buffer.numberOfChannels;
  const samplesPerColumn = Math.max(1, Math.floor(totalSamples / columns));

  // Pre-fetch all channel data to avoid per-frame method calls
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  const peaks: Peak[] = new Array(columns);
  for (let col = 0; col < columns; col++) {
    const start = col * samplesPerColumn;
    const end = col === columns - 1 ? totalSamples : Math.min(start + samplesPerColumn, totalSamples);
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i++) {
      // Average across channels for the visible waveform
      let s = 0;
      for (let c = 0; c < numChannels; c++) s += channels[c][i];
      s /= numChannels;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    // If the column was empty (shouldn't happen with our floor), clamp
    if (min > max) {
      min = 0;
      max = 0;
    }
    peaks[col] = { min, max };
  }
  return peaks;
}

/** Find the peak absolute amplitude across the buffer. Used for normalization. */
export function peakAmplitude(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Produce a new AudioBuffer that is a slice of the input from `startSec` to
 * `endSec`, with optional fade-in / fade-out and gain. Used as the final
 * "render" step before encoding to WAV.
 */
export function renderTrimmed(
  source: AudioBuffer,
  options: {
    startSec: number;
    endSec: number;
    fadeInSec?: number;
    fadeOutSec?: number;
    gain?: number;
  },
): AudioBuffer {
  const { startSec, endSec, fadeInSec = 0, fadeOutSec = 0, gain = 1 } = options;
  const sampleRate = source.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(source.length, Math.floor(endSec * sampleRate));
  const length = Math.max(0, endSample - startSample);
  const numChannels = source.numberOfChannels;

  // OfflineAudioContext just to construct an AudioBuffer — never actually rendered.
  const offline = new OfflineAudioContext(numChannels, length || 1, sampleRate);
  const out = offline.createBuffer(numChannels, length || 1, sampleRate);

  const fadeInSamples = Math.min(length, Math.floor(fadeInSec * sampleRate));
  const fadeOutSamples = Math.min(length, Math.floor(fadeOutSec * sampleRate));

  for (let c = 0; c < numChannels; c++) {
    const src = source.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < length; i++) {
      let g = gain;
      if (fadeInSamples > 0 && i < fadeInSamples) {
        g *= i / fadeInSamples;
      }
      if (fadeOutSamples > 0 && i >= length - fadeOutSamples) {
        g *= (length - 1 - i) / fadeOutSamples;
      }
      dst[i] = src[startSample + i] * g;
    }
  }
  return out;
}

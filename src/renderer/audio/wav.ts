// Minimal WAV encoder. Takes an AudioBuffer (Web Audio) and returns 16-bit PCM
// WAV bytes. No external dependencies — WAV is just RIFF + fmt + data chunks.

export function encodeWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const out = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(out);

  let p = 0;
  // RIFF header
  writeAscii(view, p, 'RIFF'); p += 4;
  view.setUint32(p, 36 + dataSize, true); p += 4;
  writeAscii(view, p, 'WAVE'); p += 4;

  // fmt chunk
  writeAscii(view, p, 'fmt '); p += 4;
  view.setUint32(p, 16, true); p += 4;        // chunk size
  view.setUint16(p, 1, true); p += 2;         // format = PCM
  view.setUint16(p, numChannels, true); p += 2;
  view.setUint32(p, sampleRate, true); p += 4;
  view.setUint32(p, byteRate, true); p += 4;
  view.setUint16(p, blockAlign, true); p += 2;
  view.setUint16(p, bitsPerSample, true); p += 2;

  // data chunk
  writeAscii(view, p, 'data'); p += 4;
  view.setUint32(p, dataSize, true); p += 4;

  // Interleave channels and convert Float32 [-1, 1] to Int16 PCM
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      // Round toward zero for symmetric clipping at -32768 / 32767
      const v = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
      view.setInt16(p, v, true);
      p += 2;
    }
  }

  return new Uint8Array(out);
}

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

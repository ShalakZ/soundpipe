// Lightweight post-import validation. Reads a sound file's bytes through the
// existing IPC channel and tries to decode it via Web Audio. If decoding fails,
// the file isn't a real audio file (or uses a codec Chromium can't decode) and
// we should remove the dud sound from storage.

export async function validateSoundFile(filePath: string): Promise<{
  ok: true;
  durationSeconds: number;
} | {
  ok: false;
  reason: string;
}> {
  let bytes: Uint8Array;
  try {
    bytes = await window.api.readSoundBytes(filePath);
  } catch (err) {
    return {
      ok: false,
      reason: `Couldn't read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (bytes.byteLength < 64) {
    return { ok: false, reason: 'File is too small to be valid audio.' };
  }

  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  // OfflineAudioContext is lighter than AudioContext for decode-only work.
  const ctx = new OfflineAudioContext(1, 1, 48000);
  try {
    const decoded = await ctx.decodeAudioData(ab);
    return { ok: true, durationSeconds: decoded.duration };
  } catch (err) {
    return {
      ok: false,
      reason: `Couldn't decode audio (corrupt or unsupported format): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

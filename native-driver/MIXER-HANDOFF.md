# Mixer-mode handoff spec (driver → app)

For whoever builds **mixer mode** in the SoundPipe app (host side, real hardware).
This is the precise contract the driver exposes; see `SUITE-ARCHITECTURE.md` for the why.

## What the driver gives you
Two endpoints (and nothing else), created by our signed driver:

| Role | Friendly name (as shown in Windows) | Use it as |
|---|---|---|
| Render (playback) | **SoundPipe** (`SoundPipe (SoundPipe)`) | the app's audio **output** target |
| Capture (recording) | **SoundPipe Virtual Mic** (`SoundPipe Virtual Mic (SoundPipe)`) | what other apps select as their **mic** |

Whatever PCM the app renders into **SoundPipe** comes out of **SoundPipe Virtual Mic**,
in stereo, via an in-kernel FIFO. That's the entire driver behavior — it's a "cable."

## The hard contract (must follow or audio breaks)
- **Format: 48000 Hz, 16-bit PCM, 2 channels (stereo). Both endpoints. Always.**
  The driver does **no sample-rate conversion** — the FIFO is a raw byte pipe. The
  app must run its audio graph at 48 kHz. (Windows will resample the *real mic* to
  48 kHz for you when you open it shared-mode; your render to SoundPipe must be 48 k.)
- **One producer.** Only the app should render into SoundPipe. Don't let other apps
  use it as their output, or their audio mixes into the virtual mic too.
- **Pick the device explicitly** — do **not** rely on the default render/capture
  device. Enumerate and match by friendly name ("SoundPipe" / "SoundPipe Virtual Mic").

## How to wire it (WASAPI, user-mode)
1. **Capture the real mic:** `IMMDeviceEnumerator` → pick the user's real input →
   `IAudioClient` shared mode, event-driven, request 48 kHz/stereo (let WASAPI convert).
2. **Run the DSP chain** on the mic buffer: gate → noise-suppress → compressor → EQ →
   (optional) pitch/auto-tune. All at 48 kHz stereo. (See architecture doc for libs.)
3. **Mix in soundboard clips / music** (decode to 48 kHz stereo, sum, clamp).
4. **Render the mix into SoundPipe:** `IMMDeviceEnumerator` → find the render endpoint
   whose friendly name is "SoundPipe" → `IAudioClient` → 48 kHz/16-bit/stereo →
   feed it continuously (silence when idle is fine).
5. Other apps (Discord/CS2/OBS) just select **SoundPipe Virtual Mic** as their mic.

Finding the device by name (sketch): enumerate `eRender`/`eCapture` with
`IMMDeviceEnumerator::EnumAudioEndpoints`, read `PKEY_Device_FriendlyName`, match the
SoundPipe names. (Or store the device ID once found.)

## Latency budget (watch this early)
- Use small, event-driven WASAPI buffers (~10 ms) on both capture and render.
- The kernel FIFO holds ~85 ms max and pads silence on underrun / drops oldest on
  overflow — so it tolerates jitter but adds latency. Keep your app buffers tight.
- **Measure mic→virtual-mic round-trip early** (step 3 of the build order). If it's
  too high for live conversation, shrink buffers / use exclusive-mode render to SoundPipe.

## Testing
- **Can't be tested in the dev VM** (no real audio hardware there). Build/test on a
  real PC with a real mic. Verify by recording the SoundPipe Virtual Mic in a real app
  (Discord call, OBS, or Voice Recorder) while the app mixes mic + a clip.
- The driver itself is verified by playing into SoundPipe and recording SoundPipe
  Virtual Mic (see worklog) — that contract is proven; mixer mode builds on top.

## Gotchas inherited from the driver work (see memory / worklog)
- Windows **caches endpoint formats**; our installer clears them so 48 kHz stereo
  applies. On a real-PC installer, do the same (or the driver already advertises only
  48 kHz stereo on the mic, so it can't be wrong there).
- **Signing (~$300/yr attestation/EV)** is required to install the driver on a real PC.
  Until then, mixer mode can only be exercised against VB-CABLE/a test-signed machine.

## Status of the driver side (done)
Stereo loopback proven; two branded 48 kHz-stereo endpoints; crash-free install;
format hardened. Code + build/sign/install recipe in `native-driver/loopback-src/`.

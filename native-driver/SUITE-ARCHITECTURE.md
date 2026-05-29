# SoundPipe — Suite Architecture (design)

Goal: grow SoundPipe from a soundboard into a unified real-time voice/audio suite
(soundboard + noise gate + compressor + EQ + pitch/auto-tune + mixer), the way
VoiceMod / VoiceMeeter / Soundpad each do *part* of — but in one app, on top of
**our own** virtual audio driver.

## The core principle: dumb driver, smart app
Keep the **kernel driver minimal and stable** (it's the one place a bug = BSOD)
and put all the features in **user-mode**, where iteration is fast and a crash is
just a crash. We already have the hard part working: a signed virtual driver that
loops a render endpoint into a capture endpoint in stereo. Treat that as a solved
"cable" and build features above it.

## The layers

```
   Real mic (USB/headset)                       Soundboard clips, music, app audio
            |                                                   |
            v                                                   v
   +-------------------------------------------------------------------------+
   |                      SoundPipe app  (user-mode - "the brain")           |
   |                                                                         |
   |   capture real mic  ->  [ noise gate ] [ compressor ] [ EQ ]           |
   |                         [ noise suppression ] [ pitch / auto-tune ]     |
   |                              |                                          |
   |   soundboard / music  -------+--->  [ MIXER ]  ---> processed stereo    |
   +-------------------------------------------------------------------------+
            |  (render to the "SoundPipe" speaker endpoint, 48 kHz stereo)
            v
   +-------------------------------------------------------------------------+
   |   SoundPipe virtual driver (kernel) - the "cable" (DONE)                 |
   |   "SoundPipe" speaker  == in-kernel FIFO ==>  "SoundPipe Virtual Mic"    |
   +-------------------------------------------------------------------------+
            |  (other apps select "SoundPipe Virtual Mic" as their microphone)
            v
        Discord / CS2 / OBS / Teams / browser  ->  your friends hear the result
```

Optional 4th layer: **APOs** (Audio Processing Objects) — the "(with APO
Extensions)" pieces already in the package. APOs run *inside the Windows audio
engine* on our endpoints and can host always-on, system-level effects. They're
more constrained and harder to debug than app-side DSP, so use them only for
effects that must apply even when the app isn't focused. Default: do DSP in the app.

## Where each feature lives
| Feature | Home | Notes |
|---|---|---|
| Virtual mic/speaker (routing) | **Kernel driver** | Done. Keep it dumb. |
| Soundboard (play clips) | App | Already SoundPipe's core. Render into "SoundPipe". |
| Mixer (real mic + clips) | App | The keystone — see below. |
| Noise gate / compressor / EQ | App DSP | Standard, well-understood DSP blocks. |
| Noise suppression | App DSP | e.g. an RNNoise-style model. |
| Pitch shift / auto-tune | App DSP | e.g. SoundTouch / Rubber Band for pitch; pitch-detect + snap for auto-tune. |
| Always-on system effect | APO (optional) | Only if it must run without the app. |

## The keystone: mixer mode
This is what makes it feel like a product (talk *and* play clips, both processed):

1. App opens the **real mic** for capture.
2. App runs the chain on it: gate -> noise-suppress -> compressor -> EQ -> (optional pitch/auto-tune).
3. App **mixes** in soundboard clips / music.
4. App **renders the mix into the "SoundPipe" speaker** endpoint (48 kHz stereo).
5. Driver loops it to **"SoundPipe Virtual Mic"**, which Discord/CS2/etc. capture.

"Raw passthrough" (clips only, no mic) and "advanced/VB-CABLE fallback" are just
config variations of the same path. Latency target: keep the app's buffer small
(WASAPI shared/event-driven) so round-trip stays low enough for conversation.

## Build order (incremental, each shippable)
1. **(done)** Driver: stereo loopback, 2 branded endpoints, 48 kHz-locked, no BSOD.
2. **Mixer MVP** in the app: real mic + soundboard -> SoundPipe speaker. No effects yet.
3. **One effect end-to-end** (noise gate) to prove the DSP slot + UI + low latency.
4. Add effects incrementally: compressor, EQ, noise suppression, then pitch/auto-tune.
5. **Sign the driver (~$300/yr)** — the gate to install on real PCs / ship to friends.
6. Presets, per-app routing, polish.

## Hard constraints / honest notes
- **No DSP in the kernel.** Effects belong in the app (or APO). The driver stays a cable.
- **48 kHz throughout.** Our loopback does not resample; the app should run its
  graph at 48 kHz to match the endpoints (Windows resamples the real mic for us).
- **Signing is the real-world gate.** Everything can be prototyped on the dev VM,
  but a friend installing it needs the signed driver (attestation/EV).
- **Latency is the risk to watch** for the live mic path — measure early (step 2/3).

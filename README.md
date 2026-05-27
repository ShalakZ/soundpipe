# SoundPipe

A free, open-source soundboard for Windows that pipes your sounds **into a virtual microphone** — so games, Discord, OBS, or anything else that listens to a mic hears them as if you'd spoken them.

Inspired by Steam Soundpad, without the price tag.

## What it does

Press a hotkey from any focused app — your game, Discord, the browser — and the bound sound plays through a virtual mic. To everyone you're talking to, it sounds like it came out of your mouth.

The trick: Windows has no built-in way to inject audio into a microphone, so the app uses a free third-party driver (VB-Audio Virtual Cable) to create one. The setup wizard installs it for you on first run.

## Install

1. Grab the latest `SoundPipe-Setup-<version>.exe` from the [Releases page](https://github.com/ShalakZ/soundpipe/releases).
   - Windows SmartScreen will show "Unrecognized app" — the app isn't code-signed (yet). Click **More info → Run anyway**.
2. Run the installer. Pick where to install, or accept the defaults.
3. Launch SoundPipe. The first-run wizard walks you through:
   - Installing **VB-CABLE** (auto-downloaded; will ask for admin permission, then reboot)
   - Picking which audio device the soundboard plays into (CABLE Input is auto-detected)
   - Configuring your game / Discord / OBS to listen to CABLE Output as their mic

Total time: about 2 minutes plus the reboot.

## Using it

- **Add sounds** — drag audio files into the grid, or click `+ Add sounds`. URL imports work too (YouTube, Twitch, SoundCloud — anything yt-dlp handles).
- **Bind a hotkey** — click the hotkey button on a sound and press the keys / buttons you want. Mouse side-buttons (Mouse4, Mouse5, middle-click) are supported.
- **Modes**:
  - **One-shot** — press once, plays once. Set a loop count for N replays.
  - **Toggle** — press to start, press again to stop.
  - **Hold** — sound plays only while you hold the key.
- **Profiles** — switch between soundboards via the dropdown. Each profile has its own sounds, hotkeys, and optional focus filter ("only fire hotkeys when CS2 is the foreground app").
- **Clip buffer** — opt-in continuous recording. Press the clip hotkey to save the last N seconds as a new sound. The trim editor opens automatically so you can pick the exact moment.
- **Themes** — five built-in: Midnight (default), Ocean, Forest, Sunset, Light. Settings → Theme.
- **Tray** — closing the window minimizes to the system tray; hotkeys keep working. Quit via the tray menu.

## Troubleshooting

**Discord / game can't hear me play sounds**
Make sure the app's microphone is set to `CABLE Output (VB-Audio Virtual Cable)`, not your real mic. Also disable noise suppression / Krisp — it filters out sound clips.

**My own voice stopped being heard once I switched the mic**
Setting Discord's mic to CABLE Output means Discord only hears what plays into CABLE Input — so your actual mic is gone. Two fixes:
- **Quick**: right-click the Windows speaker icon → Sound settings → More sound settings → Recording tab → your mic → Properties → Listen tab → check **Listen to this device** and route playback to `CABLE Input`.
- **Advanced**: install [VoiceMeeter Banana](https://vb-audio.com/Voicemeeter/banana.htm) and route your mic + SoundPipe's CABLE Input through it. SoundPipe supports mic ducking via VoiceMeeter (Settings → Mic ducking).

**"CABLE Output" doesn't appear in my apps**
Either VB-CABLE didn't finish installing or your machine needs a reboot. Re-run the setup wizard from Settings.

**SmartScreen blocked the installer**
The app isn't code-signed (an EV certificate is ~$300/year and isn't worth it for a free side project). Click **More info → Run anyway**. The source is in this repo if you want to build it yourself.

**Hotkeys fire while I'm typing in chat**
Set a *focus filter* on the profile (Profile Settings → "Hotkeys only fire when this app is focused" → pick your game). Hotkeys will then only trigger when the named app is in front.

**Push-to-talk games (CS2, Valorant, etc.) don't transmit my soundboard**
Enable **Auto-PTT** in Profile Settings — the app will hold your PTT key for the duration of each clip. Pair it with a focus filter so the synthesized key only fires inside the game. (See the warning in the dialog about anti-cheat tolerance.)

## Features

- Drag-and-drop sound import (mp3, wav, ogg, flac, m4a, aac, webm) + URL imports via yt-dlp (lazy-downloaded on first use)
- Per-sound global hotkeys with one-shot / toggle / hold modes; mouse buttons supported
- Per-sound volume, pitch (also affects speed), color, and loop count
- Multiple profiles with optional per-profile focus filter and auto-PTT key synthesis
- Local monitor: play to your speakers / headphones simultaneously
- Global stop-all hotkey
- Mic ducking via VoiceMeeter (optional, auto-detected)
- Clip buffer: continuous recording, save the last N seconds with a hotkey
- Trim editor: visual waveform, fade in / out, normalize, keyboard nudge (← →, Shift, Alt)
- Five themes (Midnight, Ocean, Forest, Sunset, Light)
- Lives in the system tray so hotkeys keep working when the window is closed

## Development

Run all commands from **Windows** (PowerShell or Windows Terminal). The native keyboard hook (`uiohook-napi`) and audio routing only work on Windows — WSL is fine for editing code but the app must run on the host.

```powershell
npm install
npm run dev          # boots Electron with hot-reload on the renderer
npm run typecheck    # tsc on both node + web targets
npm run package      # builds the NSIS installer under release/
```

### Project layout

```
src/
  main/       Electron main process — windowing, IPC, hotkey hook, persistence
  preload/    Sandboxed bridge between main and renderer
  renderer/   React UI + audio engine
  shared/     Types shared between main and renderer
```

## Known limitations

- Pitch shift also changes speed (uses `playbackRate`). True pitch-only shifting would need a DSP library — out of scope.
- Some keys with system-level binding (e.g. `PrintScreen`) may not be capturable; the OS reserves them.
- Windows-only. macOS would need a different virtual-audio approach (BlackHole / Loopback); Linux would need PipeWire / pulse-loopback routing.

## License

MIT.

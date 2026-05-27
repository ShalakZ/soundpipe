# Roadmap

Features missing from v1, grouped by impact. Ordered roughly by effort/value within each group.

## High-impact UX gaps

- [x] **System tray + close-to-tray** — closing the window currently quits the app and kills hotkeys. Tray icon with Show / Quit context menu.
- [x] **Search box** at the top of the grid — filter sounds by name.
- [x] **Drag-to-reorder** sound cards within a profile.
- [x] **Visual playing feedback** — pulse/glow card while its sound is playing.
- [x] **Right-click context menu on cards** — Rename, Duplicate, Show in folder, Remove.
- [x] **Per-card color** — palette picker on each sound card. Icon (custom image) still pending; pairs with Stream Deck for icon sync later.
- [ ] **Categories / tags within a soundboard** — for grouping inside a profile.

## Audio capability gaps

- [ ] **True pitch shift without tempo change** — currently `playbackRate` couples them. Needs a DSP lib (e.g. `soundtouchjs`).
- [x] **Mic ducking** — auto-lowers the user's VoiceMeeter mic strip while sound plays, restores on stop. Uses koffi → `VoicemeeterRemote64.dll`. Settings: enable, strip index, duck dB. Degrades gracefully if VoiceMeeter isn't installed.
- [x] **Fade in / out + trim start/end + normalize** per sound, via the trim editor (waveform, drag handles, loop-play, fades, normalize). Output is lossless WAV.
- [x] **Loop count** per sound — small ×N stepper next to Mode on the card (oneshot only).

## Sourcing / content

- [x] **YouTube / URL import** — paste a link, app uses bundled `yt-dlp` to download. Works for YouTube, Twitch clips, SoundCloud, and everything else yt-dlp supports. Trim editor opens automatically after download.
- [x] **In-app recorder / replay buffer** — keep a rolling N-second buffer of a chosen device (mic, CABLE Output, VoiceMeeter B1, etc.); hotkey saves the last N seconds, opens trim editor.
- [x] **Import / export profiles** — `.zip` bundle (manifest.json + sounds/) sharable between users. Hotkeys are stripped on import so they don't clobber the recipient's bindings.

## Hotkey expansion

- [x] **Mouse-button bindings** (Mouse4/5/side buttons). Modifier keys can be held alongside.
- [x] **Game-specific binds (focus filter)** — per-profile `focusFilter` field. Hotkeys only fire when the matching app is the foreground window. Configure in the profile-settings modal (⚙ icon next to the profile dropdown). Uses `get-windows` for foreground detection.
- [ ] **MIDI controller support** for hardware controllers.
- [ ] **Native Stream Deck plugin** — registered with Elgato SDK so the LCD reflects bound sounds dynamically and icons sync automatically. Stream Deck already works *today* via the existing hotkey system (set the SD key to emit the same combo) — this item is the polished version with proper integration.

## Production-readiness

- [x] **Auto-update** via `electron-updater` — wired in main. Requires publishing releases (GitHub Releases by default) for it to actually pull updates.
- [ ] **Code-sign the installer** so Windows SmartScreen doesn't scare users.
- [x] **User-visible error toasts** — global toast stack; import/IPC/audio failures surface as dismissable notifications instead of silent dev-console logs.
- [x] **Validate audio on import** — every imported file is decoded via Web Audio after import; failures remove the bad sound and toast the user.
- [ ] **Detect when the virtual cable is removed / device disappears** and surface it.

## Game integration

- [x] **Auto-PTT integration** — per-profile, synthesizes a configured key via Win32 `keybd_event` (via `koffi`) while any sound from that profile plays. Released on focus loss, profile change, or app quit. Ships with an explicit anti-cheat warning ("use at your own risk").

## Tests

- [ ] No tests yet. Add unit tests for storage, hotkey matching, and AudioEngine playback logic.

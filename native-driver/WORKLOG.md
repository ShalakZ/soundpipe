# SoundPipe native-driver — worklog

Newest entry first. Short, plain-English status on every push — for the user and the host-side Claude, not a code changelog.

## 2026-05-30 — Host: mixer mode wired into App + Settings UI (ready for a real-PC test)
- **Mixer mode is now usable from the UI.** Added a "Mixer mode — your voice + sounds on one mic" toggle in Settings (under the virtual-mic output), plus a real-mic device picker that appears when it's on. App.tsx creates the `MixerEngine`, drives its start/stop + device re-targeting reactively, clears in-flight voices on a mixerMode flip (one-time `createMediaElementSource` constraint), and disposes the graph on unmount.
- **No main-process permission change needed** (had it on the to-do list): the app already calls `getUserMedia({audio:true})` at startup to unlock device labels, so mic capture is already permitted in this Electron build. Skipped adding a handler rather than add code for a non-problem.
- **Both tsconfig projects typecheck clean** (ran `tsc --noEmit` for web + node). Behavior is unchanged when mixer mode is off (stable v0.1.0 path untouched).
- **Needs a real Windows run to verify** — WSL can't exercise audio. Test recipe below.

### How to test mixer mode on the main PC (uses VB-CABLE, no cert needed)
1. Pull `feat/native-driver`, `npm install` + `npm run dev` from a Windows PowerShell at `C:\Users\Ziad2\soundboard` (NOT WSL).
2. Settings → set **Virtual microphone output = "CABLE Input (VB-Audio Virtual Cable)"**.
3. Turn **Mixer mode = on**, pick your real headset mic as "Your real microphone".
4. Open Windows **Voice Recorder**, set its input to **"CABLE Output"**, record while you talk AND fire a soundboard clip. Play it back: you should hear BOTH your voice and the clip. (Or join a Discord test call with mic = CABLE Output.)
5. Expected: voice + sounds mixed on one mic. Watch latency on the live voice path — if it's too laggy, we shrink WASAPI buffers / consider exclusive-mode render. Report back and host-Claude iterates.
- When the signed SoundPipe driver eventually lands on the main PC, just pick "SoundPipe" / "SoundPipe Virtual Mic" instead of CABLE — same code path.

## 2026-05-30 — Host: mixer-mode foundation (audio graph + settings; no UI yet)
- **Set up the host-side audio graph for mixer mode.** New `src/renderer/audio/MixerEngine.ts` owns a single 48 kHz `AudioContext`, captures the user's real mic via `getUserMedia`, and mixes mic + soundboard playback into a `MediaStreamAudioDestinationNode`. A long-lived `<audio>` element streams that mix into the configured virtual mic device via `setSinkId`. `AudioEngine` now optionally takes a `MixerEngine` and routes each soundboard voice through it (`createMediaElementSource`) when mixer mode is on, instead of `setSinkId`-ing the clip element directly.
- **Two new settings:** `mixerMode` (default off while we dev) and `realMicDeviceId` (null = OS default input). Defaults wired in `storage.ts` and the renderer store.
- **Passthrough behavior unchanged** when `mixerMode` is off — v0.1.0's audio path is bit-identical to today. Dev target = VB-CABLE on the main PC (test-signed SoundPipe driver only exists in the VM); user picks the virtual mic device manually for now, auto-pick-by-friendly-name is later polish.
- **Next (host turn):** UI toggle + real-mic picker in `SettingsPanel.tsx`, mic-permission grant in `main/index.ts` (Electron blocks `getUserMedia` without it), and `App.tsx` wiring to create `MixerEngine` and drive `setSettings` reactively. Then: flip mixer mode on, point virtual mic at "CABLE Input", and verify in Voice Recorder that the recording carries both real voice and a played soundboard clip.
- **Gotcha for the toggle wiring:** `createMediaElementSource(el)` is one-time per element, so when mixer mode flips we'll call `stopAll()` to clear in-flight voices (next commit).

## 2026-05-29 — ✅ VM DRIVER WORK WRAPPED — handing off to host for mixer mode
This closes the VM-side driver track. Everything is on `feat/native-driver`.

**Done & proven (prototype):**
- Our own virtual audio driver: **SoundPipe** (speaker) + **SoundPipe Virtual Mic**, manufacturer "SoundPipe", 48 kHz/16-bit **stereo** locked, auto-format on install.
- **Stereo loopback proven** end-to-end (speaker→mic, channels independent), runtime rock-solid (no crashes in use, incl. a 2.5-min soak).
- Gentle in-place installer (`loopback-src/install-and-test.ps1`), build/sign recipe, full change snapshot in `loopback-src/`.
- Docs for the host: **`SUITE-ARCHITECTURE.md`** (the big picture) and **`MIXER-HANDOFF.md`** (the exact driver contract to build mixer mode against).

**Host side picks up next (real hardware, the app — NOT the VM):**
- **Mixer mode**: real mic + soundboard → DSP chain → render into "SoundPipe" → emerges on "SoundPipe Virtual Mic". Build against `MIXER-HANDOFF.md` (48 kHz stereo, pick devices by name, watch latency).
- Then the effect suite (gate/compressor/EQ/noise-suppress/auto-tune) as app-side DSP blocks.

**Deferred to the signing / real-PC phase (documented, don't lose):**
- Bulletproof the install/uninstall teardown race (no BSOD ever, across many cycles).
- Cosmetic: make the speaker read literally "SoundPipe".
- Buy the ~$300/yr signing cert — the gate to install on a real PC (and the only way to test with a real headset/voice).

## 2026-05-29 — Consistency resolved: gentle install = no BSOD + pristine audio ✅
- **Fixed install reliability.** Reworked the installer to update the driver **in place** (single `devcon update`) instead of the old double remove+reinstall churn. Ran it: **no BSOD**, both endpoints back, loopback **pristine on both channels** again (L 440 / R 880, ~0.15 each, no cross-talk across repeated grabs). The earlier "degraded left channel" was just the messy half-finished-install state — a clean install restores it.
- So **runtime is correct + consistent, and the gentle install is reliable.** The deep teardown-race fix (a 100% no-BSOD guarantee across many install/uninstall cycles on a friend's PC) is still the real-PC / signing-phase task.
- **Known cosmetic:** speaker still shows "Speakers (SoundPipe)" (its custom-name registration isn't applying via devcon update); unmistakably SoundPipe, deferred rather than burn more install cycles. Mic is correctly "SoundPipe Virtual Mic"; manufacturer is SoundPipe.

## 2026-05-29 — KNOWN ISSUE: install-churn teardown race (BSOD during repeated reinstalls)
- Re-running the installer again BSOD'd (0xD1 in TimerNotifyRT, use-after-free: a stream freed mid-install-churn, timer tick fired on reused memory). This is **install/uninstall-time only** — the driver is **stable once running** (loopback proven repeatedly incl. a 2.5-min soak, no runtime crashes).
- Root: the sysvad sample's stream teardown vs its 1 ms timer is racy under heavy PnP churn. My destructor timer-drain fixed the common NULL case; this rarer reused-memory case isn't fully closed. The install script's aggressive double remove+reinstall (step 2c) maximizes the churn that triggers it.
- **Decision: stop the reinstall loop.** The driver is functionally complete, proven, and installed. We were only reinstalling for a cosmetic speaker rename ("SoundPipe" vs "Speakers (SoundPipe)") — not worth BSOD risk. Speaker name stays "Speakers (SoundPipe)" for now.
- **To harden before any real-PC release** (must-fix then, not now): (a) make install gentler (drop the double remove+reinstall), and (b) properly serialize stream teardown vs the timer DPC (e.g. a validity flag checked under m_PositionSpinLock, or guarantee ExDeleteTimer(wait) on every teardown path). Needs careful install testing — deferred to when we tackle signing/real-PC.

## 2026-05-29 — Driver polish + mixer-mode handoff spec ✅ (one cosmetic item pending a clean reinstall)
- **Branding fixed:** the device "Controller Information / Manufacturer" (and Provider/Copyright) read **"TODO-set-Manufacturer"** — now set to **SoundPipe**. Verified after reboot: device shows Manufacturer = SoundPipe.
- **Speaker rename to "SoundPipe":** added a custom name to the speaker pin (mirroring how the mic gets its name). The code is in and builds, but it shows up only on a **clean** driver install — the last install hit a Windows "remove on reboot" snag (device was busy), so the one-time name registration didn't run, and the speaker still reads "Speakers (SoundPipe)". A clean reinstall (post-reboot) will apply it; the installer now also clears the cached endpoint *name* so the rename takes. **Pending one more install.**
- **BT/USB code removal: tried, reverted.** Stripping the Bluetooth/USB build flags breaks Microsoft's sample (one of their files uses that code without the proper #ifdef guard). Since the code is already dormant (no BT/USB endpoints, never runs), I reverted rather than patch MS's code for a cosmetic size win. Keyword-detector removal similarly deferred.
- **Wrote `native-driver/MIXER-HANDOFF.md`** — the precise driver contract for whoever builds mixer mode app-side (endpoint names, the 48 kHz-stereo rule, WASAPI render/capture steps, latency budget, testing notes). The driver side is a stable, documented "cable" now.
- Everything functional re-verified after reboot: 2 endpoints, 48 kHz stereo both, loopback clean (L=440/R=880 separated), no BSOD.

## 2026-05-29 — Format locked to 48 kHz stereo + suite architecture written ✅
- **Fixed the "mono / 44100" default** Ziad caught. The mic now advertises **only** 48 kHz / 16-bit / stereo (one format, nothing else), and the speaker now defaults to 48 kHz too. Confirmed on a fresh install: both endpoints came up **48 kHz stereo automatically** (no manual "Advanced tab" step — the installer's cache-clear handles it), and the loopback is still clean (left=440 / right=880 fully separated). No BSOD. This is what makes a friend's clean install "just work."
- **Wrote `native-driver/SUITE-ARCHITECTURE.md`** — the plan to grow SoundPipe into a full voice suite (soundboard + noise gate + compressor + EQ + pitch/auto-tune + mixer). Key principle: keep the **kernel driver a dumb, stable "cable"** (done) and put all features in the **user-mode app** (safe, fast). Keystone feature = **mixer mode** (real mic + clips → effects → virtual mic). Effects are well-trodden DSP blocks. Signing (~$300/yr) is the gate to real PCs.
- **Next:** start **mixer-mode groundwork** in the app (capture real mic + soundboard → render into "SoundPipe" speaker). Then one effect end-to-end (noise gate) to prove the DSP slot + latency.

## 2026-05-29 — Phase 2: down to TWO branded endpoints, verified ✅
- **Slimmed to exactly two endpoints** (was 8 kitchen-sink): one render + one capture. Windows now shows just **"SoundPipe Virtual Mic (SoundPipe)"** and **"Speakers (SoundPipe)"**.
- **Rebranded** the names via the driver's INF source (`.inx`): device + endpoints now say SoundPipe / SoundPipe Virtual Mic. (The speaker endpoint still shows Windows' default word "Speakers" before the "(SoundPipe)" — it needs a custom name tag like the mic has; small cosmetic follow-up.)
- **Locked to 48 kHz stereo**, and the **installer now auto-clears Windows' cached endpoint format**, so the right format applies on install with **no manual Advanced-tab fiddling** (that was the friction we hit by hand earlier — now automatic, important for a friend's install).
- **Re-verified end-to-end** (I measure it, since audio can't be heard in the VM): only one capture device present, 48 kHz stereo, and the left=440 / right=880 test came back perfectly channel-separated. No BSOD on install.
- Heads-up for later: the green level meters in Windows sit at a constant ~50% for both endpoints — that's the sysvad **simulated peak meter** (fake), not a real signal indicator; cosmetic only, can be wired to the real pipe level later.
- **Next:** (optional) custom name so the speaker reads exactly "SoundPipe"; remove the now-unused phone/tablet/BT/USB/keyword code; then **mixer mode** (blend real mic + soundboard) and wiring into the SoundPipe app. Signing (~$300/yr) remains the gate for installing on a real PC. Still $0.

## 2026-05-29 — Stereo virtual mic PROVEN + BSOD root-caused & fixed ✅
- **Stereo loopback works.** Made the virtual mic 48 kHz / 16-bit **stereo** (was mono) and switched the in-kernel pipe from down-mixing to straight stereo passthrough. Verified by playing a tone that's **440 Hz in the left channel, 880 Hz in the right** into the SoundPipe speaker and recording the mic: left came back as pure 440, right as pure 880, fully separated. So stereo is preserved end-to-end (VoiceMeeter-style), and audio→mic still works.
- **The BSODs are root-caused and fixed.** The crashes (bugcheck 0xD1, both identical) were a real ordering bug in the *sample's* stream-cleanup code: it released the audio "miniport" object **before** stopping the timer that uses it, so a timer tick landing mid-teardown dereferenced a freed pointer. Confirmed with the kernel debugger (faulting function `TimerNotifyRT`, our driver). Fixed by stopping/draining the timer **first**, plus a safety null-check. Reinstalled with no crash, including the device swap that used to trip it.
- **Two gotchas worth knowing (will matter for the installer/app):**
  1. Windows **caches each endpoint's audio format**; after changing the driver, the mic kept its old mono format until we picked "2-channel 48000 Hz" in its Advanced properties. Both speaker and mic must be **48000 Hz** (the pipe does no resampling) — a rate mismatch garbles the audio.
  2. With the current 8 kitchen-sink endpoints, only a mic whose format matches the pipe reads it cleanly; other mics/apps reading at a different rate get garbage. **Phase 2 (one speaker + one mic, fixed 48 kHz stereo) removes this entirely.**
- Signing recipe unchanged (fresh self-signed `SoundPipeTest.cer`, build `SignMode=Off`, sign the .cat by hand). Install helper now auto-mounts the EWDK ISO and clears stale packages.
- **Next: Phase 2** — slim to exactly two endpoints, force a single 48 kHz stereo format on both (so no manual format-picking / cache issues for a friend's install), rebrand to "SoundPipe" / "SoundPipe Virtual Mic", and drop the phone/tablet/BT/USB/keyword code. Still $0, no cert yet.

## 2026-05-29 — Phase 1b loopback PROVEN end-to-end ✅
- **It works.** Audio played into the SYSVAD speaker now comes out of the SYSVAD microphone. Verified by recording the virtual mic while playing a 440 Hz test tone into the virtual speaker: the mic captured the tone at the **exact** amplitude sent in (sent peak 12000 -> recorded peak 12001, RMS 8485 = textbook 12000/sqrt2) and at the right pitch (energy concentrated at 440 Hz). With nothing playing, the mic records **digital silence** (RMS 0.5), not the old tone. So routing + silence-on-idle both work, and the make-or-break "can we really loop speaker->mic?" question is **YES**.
- **Crash found and fixed along the way.** First install BSOD'd (DRIVER_IRQL_NOT_LESS_OR_EQUAL): my producer code read the audio buffer for *every* speaker sub-stream, but some (the power-saving "offload" path) have no buffer -> read of a near-null address. Added a guard so it only runs for streams that actually have a buffer. No crashes since, including a 2.5-minute continuous-audio soak.
- **Signing note for next time:** the old WDKTestCert's private key was dead after a VM reset, so I made a fresh self-signed cert (`SoundPipeTest.cer`) and sign the catalog by hand. Build with `/p:SignMode=Off` so the unsigned .sys survives the known DrvCat failure, then sign the .cat.
- **How to reproduce/install:** elevated + Basic Session, run `native-driver/loopback-src/install-and-test.ps1` (it trusts the cert, removes old packages, installs the fresh build, restarts the audio service, lists endpoints). Heads-up: the Windows sound-settings level meters are **fake** for sysvad (it reports a simulated peak), so they read a constant ~50% regardless — don't trust them; record the mic to verify for real.
- **Still a prototype:** kitchen-sink endpoints (8 of them) still present; "any speaker feeds any mic" with no pairing; tiny clock-drift glitches possible. Next = **Phase 2: slim to two endpoints + rebrand to "SoundPipe" / "SoundPipe Virtual Mic".** Still $0, no EV cert needed yet.

## 2026-05-29 — Phase 1b loopback: code written + builds clean; BLOCKED on admin to install/test
- **Wrote the loopback.** The driver's mic used to play a fake buzzing tone. I added a small in-kernel "pipe" (a shared buffer): whatever audio is played into a speaker endpoint now gets pushed into that pipe, and the mic endpoint reads its sound out of the pipe instead of generating the tone. When nothing is playing, the mic goes silent (no tone, no leftover noise). Speaker audio is stereo and the mic is mono, so it's mixed down to mono on the way in. Sample rates already match (both 48 kHz), so no pitch problems expected.
- **It compiles and links.** The driver (`TabletAudioSample.sys`) built cleanly with the new code — no errors. (Only the usual cosmetic `DrvCat` catalog-tool failure, which we bypass by signing by hand, as noted before.)
- **Signed the package.** Found the old test signing certificate was dead (its private key didn't survive a VM reset), so I made a fresh self-signed test cert and signed the driver catalog with it.
- **BLOCKED here:** installing the driver, trusting the cert, and restarting the audio service all need Administrator rights. This background session runs without them, and the safe-mode guard refused to let me auto-elevate. So I could not install or test the loopback yet — **the proof itself is still unproven.**
- **What's needed from you (Ziad):** in the VM, switch to **Basic Session** (Enhanced Session off), open an **Administrator PowerShell**, and run `native-driver/loopback-src/install-and-test.ps1`. Then set the SYSVAD Speaker as default playback, play a sound, and record from the SYSVAD Mic In — you should hear the played audio on the recording. Tell me the result (or just let me know to retry once elevation is allowed).
- The full code changes are snapshotted in `native-driver/loopback-src/` (new files + a patch + a README) so the host side can review the actual implementation. Nothing pushed to Microsoft's sample repo — these are our local changes only.

## 2026-05-29 — Phase 1 proven (done host-side, before VM-Claude took over)
- Built Microsoft's `sysvad` sample in the VM, self-signed it, installed it. Confirmed it creates **Windows-recognized microphone + speaker endpoints** (`Get-PnpDevice -Class AudioEndpoint`, all Status OK). Make-or-break risk — "can our own driver create a real mic?" — answered **YES**.
- Caveat: those endpoints play a **synthetic tone**, not real audio, and sysvad is a bloated kitchen-sink sample (8 endpoints).
- **Next:** Phase 1b — prove the **loopback** (audio played into a render endpoint comes out the capture/mic endpoint). Then Phase 2 — slim to two branded "SoundPipe" / "SoundPipe Virtual Mic" endpoints.
- No EV signing cert purchased yet — deferred until loopback is proven end-to-end.

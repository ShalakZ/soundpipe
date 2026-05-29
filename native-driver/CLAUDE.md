# SoundPipe — Native Virtual Audio Driver (prototype)

This folder holds SoundPipe's **own virtual audio driver** — the initiative to make SoundPipe fully self-contained so it no longer needs VB-CABLE or VoiceMeeter installed separately. If you are Claude Code running **inside the Windows dev VM**, you are the hands-on engineer for this driver: you edit, build, sign, install, and test it directly.

## The product goal
SoundPipe is a Soundpad-style soundboard (Electron app, shipped v0.1.0). Today it routes audio into a virtual mic provided by VB-CABLE/VoiceMeeter, which the user has to install separately. We want to **ship our own signed virtual audio driver bundled in the installer** so a friend installs only SoundPipe and it just works (VoiceMod-style).

Endpoints we ultimately want, fully branded:
- **"SoundPipe"** — a playback (render) device the app plays sounds into.
- **"SoundPipe Virtual Mic"** — a capture (recording) device other apps (Discord, CS2, OBS) select as a microphone.
- Wired as a **loopback**: whatever is played into "SoundPipe" comes out of "SoundPipe Virtual Mic".
- Later: a mixer mode (real mic + soundboard blended) as the just-works default; raw passthrough for power users. Keep VB-CABLE/VoiceMeeter detection as an optional advanced fallback.

## Where we are — Phase 1 PROVEN (2026-05-29)
We built Microsoft's `sysvad` sample, self-signed it, loaded it in this VM, and confirmed it creates **Windows-recognized microphone + speaker endpoints**. So "can our own driver create a real mic?" = **YES**. Working build lives at:
`C:\drv\Windows-driver-samples\audio\sysvad` (package at `...\x64\Release\package`).

BUT sysvad's capture is a **synthetic test tone**, not real routing, and it's a kitchen-sink sample (8 endpoints for phones/tablets/Bluetooth/USB). It's only a proof, not the product.

## Next goals (still $0 — no cert needed for VM testing)
1. **Phase 1b — prove loopback.** Make audio rendered into a render endpoint come out of a capture endpoint. This is the last real technical risk. Likely route: strip sysvad to ONE render + ONE capture pin and feed the render stream's buffer into the capture stream (stock sample fills capture from a tone generator — replace that with the render buffer).
2. **Phase 2 — slim + brand.** Reduce to exactly two endpoints, rename everything to "SoundPipe" / "SoundPipe Virtual Mic" (names live in the INF `[Strings]` section + the topology code). Remove phone/tablet/BT/USB/keyword-detector code.

**Do NOT buy the EV signing cert yet.** The user decided to prove loopback first, then decide on the ~$300/yr cert (Microsoft attestation signing) needed to ship to friends.

## Build / sign / install recipe (worked out by hand — automate it)
Environment: Win11 Pro Hyper-V VM, **test-signing ON**, **Secure Boot OFF**. EWDK mounted at `D:` (VS2026 Build Tools 18.3, WDK 10.0.28000). Git installed.

1. **Build:** run `D:\LaunchBuildEnv.cmd` for the build console, then `msbuild <sln> /p:Configuration=Release /p:Platform=x64 /m`.
2. **EWDK gotcha:** the `DrvCat` MSBuild task FAILS (`Microsoft.Kits.Logger` assembly not found). Everything else builds, and `Inf2Cat` already produced the `.cat`. **Bypass — sign the catalog manually:**
   `signtool sign /fd sha256 /sha1 <WDKTestCert-thumbprint> <pkg>\<name>.cat`
   (the build auto-creates `WDKTestCert` and exports `<proj>\x64\Release\<name>.cer`)
3. **Trust the cert:** `certutil -addstore -f Root <name>.cer` and `certutil -addstore -f TrustedPublisher <name>.cer`
4. **Install (componentized sysvad):** `devcon install <base>.inf Root\<HWID>`, then `pnputil /add-driver <extension>.inf /install` and `pnputil /add-driver <apo>.inf /install`, then remove + reinstall the base so endpoints light up. (devcon: `D:\Program Files\Windows Kits\10\Tools\10.0.28000.0\x64\devcon.exe`.)
5. **Verify:** `Get-PnpDevice -Class AudioEndpoint` (look for our names, Status OK).

### CRITICAL test-environment gotcha
This VM is normally reached via Hyper-V **Enhanced Session (RDP)**, which **suppresses building of local audio endpoints** — you only see "Remote Audio" and wrongly think it failed. You MUST be in **Basic Session** (toggle Enhanced Session off in the VM connection window) and run `Restart-Service AudioEndpointBuilder -Force` for local endpoints to build/appear.

## Guardrails
- This is a **prototype on the `feat/native-driver` branch**. NEVER touch stable `main` or the shipped Electron app.
- The user (Ziad) is **non-technical on kernel/driver internals** — when reporting up, explain plainly. He makes product/spend decisions; prove things before spending money.
- **Coordination:** the host PC is home base (the Electron app + planning/memory). Sync via this branch — commit your driver work plus a short progress note so the host side can review.

## Handy facts
- VM user is `User`; host user is `Ziad2`.
- On the host this repo lives at `C:\Users\Ziad2\soundboard` (also `~/soundpipe` from WSL). Product is "SoundPipe"; the folder is still named `soundboard`.
- GitHub: `https://github.com/ShalakZ/soundpipe`.

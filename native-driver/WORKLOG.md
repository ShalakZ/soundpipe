# SoundPipe native-driver — worklog

Newest entry first. Short, plain-English status on every push — for the user and the host-side Claude, not a code changelog.

## 2026-05-29 — Phase 1 proven (done host-side, before VM-Claude took over)
- Built Microsoft's `sysvad` sample in the VM, self-signed it, installed it. Confirmed it creates **Windows-recognized microphone + speaker endpoints** (`Get-PnpDevice -Class AudioEndpoint`, all Status OK). Make-or-break risk — "can our own driver create a real mic?" — answered **YES**.
- Caveat: those endpoints play a **synthetic tone**, not real audio, and sysvad is a bloated kitchen-sink sample (8 endpoints).
- **Next:** Phase 1b — prove the **loopback** (audio played into a render endpoint comes out the capture/mic endpoint). Then Phase 2 — slim to two branded "SoundPipe" / "SoundPipe Virtual Mic" endpoints.
- No EV signing cert purchased yet — deferred until loopback is proven end-to-end.

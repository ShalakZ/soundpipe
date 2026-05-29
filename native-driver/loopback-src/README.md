# Phase 1b loopback — driver change snapshot

The actual driver sources live in the VM at
`C:\drv\Windows-driver-samples\audio\sysvad` (a clone of Microsoft's upstream
`sysvad` sample — *not* this repo, so the changes can't be pushed there). This
folder snapshots the Phase 1b loopback changes so the host side can review them.

## What changed
The stock sysvad mic fills its capture buffer with a synthetic sine tone. The
loopback change makes a **render (speaker) endpoint feed a capture (mic)
endpoint** through a single global in-kernel FIFO:

- **`LoopbackBuffer.h` / `LoopbackBuffer.cpp`** (new) — a process-wide ring
  buffer (NonPagedPool, spin-lock guarded). Render streams push PCM in; capture
  streams pull it out. Canonical format is 48 kHz / 16-bit / mono; stereo
  render audio is downmixed (avg L/R) on write. Empty FIFO → silence; overflow →
  drop oldest. (Full files included here for direct reading.)
- **`loopback.patch`** — diff of the 4 modified files (apply from the sysvad
  repo root with `git apply`):
  - `EndpointsCommon/minwavertstream.cpp` — capture `WriteBytes()` now reads the
    FIFO instead of the tone generator; new `ReadBytesForLoopback()` pushes
    rendered audio into the FIFO from `UpdatePosition()`, **outside** the
    `g_DoNotCreateDataFiles` guard (that guard defaults to on, so the producer
    would never run otherwise).
  - `EndpointsCommon/minwavertstream.h` — declares `ReadBytesForLoopback`.
  - `EndpointsCommon/EndpointsCommon.vcxproj` — adds `LoopbackBuffer.cpp`.
  - `adapter.cpp` — `LoopbackBuffer_Init()` in DriverEntry,
    `LoopbackBuffer_Cleanup()` in DriverUnload.

## Scope (prototype)
"Any render writes, any capture reads" — no endpoint pairing yet (Phase 2).
During testing only one render + one capture device should be active. Producer =
SYSVAD Speaker (48 kHz stereo, downmixed); consumer = SYSVAD Mic In (48 kHz mono,
already the default — no format edits needed).

## Phase 2 changes (slim + brand + stereo)
- `minipairs.h` — trimmed `g_RenderEndpoints`/`g_CaptureEndpoints` to **one each** (Speaker + MicIn) → exactly two endpoints.
- `micinwavtable.h` — mic is **48 kHz / 16-bit / stereo** (all signal-processing modes resolve to the 48 kHz stereo format).
- **Rebrand** (in the UTF-16 `.inx` source, so not shown in `loopback.patch` — see `loopback.patch.stat`):
  - `ComponentizedAudioSample.inx`: WaveSpeaker/TopologySpeaker szPname → `SoundPipe`; WaveMicIn/TopologyMicIn szPname and `MicInCustomName` → `SoundPipe Virtual Mic`; DeviceDesc → `SoundPipe Audio Device`.
  - `ComponentizedAudioSampleExtension.inx`: `ExtendedFriendlyName` → `SoundPipe`.
  - Result: endpoints show as **SoundPipe Virtual Mic (SoundPipe)** and **Speakers (SoundPipe)**. (Speaker keeps Windows' default "Speakers" pin name; giving it a custom name tag like the mic is a small follow-up.)
- `install-and-test.ps1` — now **clears the cached endpoint format** (MMDevices `DeviceFormat`) so the 48 kHz stereo default applies automatically (no manual Advanced-tab step).

## Build / install
- Build (in the VM, EWDK at D:): `SignMode=Off` so the unsigned `.sys` survives
  the known `DrvCat` task failure; the catalog is then signed manually.
- `install-and-test.ps1` — run **elevated, in Hyper-V Basic Session** — trusts
  the test cert, installs/refreshes the driver, restarts AudioEndpointBuilder,
  and lists endpoints. See the worklog for current status.

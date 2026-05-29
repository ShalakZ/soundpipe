/*++

Module Name:

    LoopbackBuffer.h

Abstract:

    SoundPipe Phase 1b - loopback bridge.

    A single process-wide FIFO that carries PCM audio from any RENDER stream
    (producer) to any CAPTURE stream (consumer), so that audio played into a
    render endpoint comes out of a capture (microphone) endpoint instead of the
    stock synthetic test tone.

    Render and capture are separate miniport/device instances and share no
    memory, so this global FIFO is the bridge. Canonical FIFO format is
    48 kHz / 16-bit / STEREO; stereo producers pass through, mono is up-mixed.

    Prototype scope: "any render writes, any capture reads" - no endpoint
    pairing yet (that's Phase 2). During testing only one render + one capture
    device is active.

--*/

#ifndef _SOUNDPIPE_LOOPBACKBUFFER_H_
#define _SOUNDPIPE_LOOPBACKBUFFER_H_

//
// Allocate the FIFO backing store and init the lock. Call once at PASSIVE_LEVEL
// from DriverEntry. Returns an NTSTATUS.
//
NTSTATUS LoopbackBuffer_Init(void);

//
// Free the FIFO backing store. Call once from DriverUnload (PASSIVE_LEVEL).
//
VOID LoopbackBuffer_Cleanup(void);

//
// Producer: push rendered PCM into the FIFO. Safe to call up to DISPATCH_LEVEL.
//   Src          - rendered 16-bit PCM bytes from the render DMA buffer.
//   ByteCount    - number of bytes at Src.
//   SrcChannels  - channel count of the render stream (1 = mono, 2 = stereo).
//                  Stereo passes straight through; mono is up-mixed (L = R) so
//                  the FIFO always holds 48 kHz / 16-bit / stereo frames.
// On overflow the oldest data is dropped.
//
VOID LoopbackBuffer_Write(_In_reads_bytes_(ByteCount) const BYTE* Src, _In_ ULONG ByteCount, _In_ USHORT SrcChannels);

//
// Consumer: pull 48 kHz / 16-bit / stereo PCM out of the FIFO into the capture DMA buffer.
// Safe to call up to DISPATCH_LEVEL. If the FIFO holds fewer bytes than
// requested, the remainder is filled with silence (zero) - so when nothing is
// playing, the mic produces silence, never stale data or a tone.
//
VOID LoopbackBuffer_Read(_Out_writes_bytes_(ByteCount) BYTE* Dst, _In_ ULONG ByteCount);

#endif // _SOUNDPIPE_LOOPBACKBUFFER_H_

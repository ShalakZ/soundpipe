/*++

Module Name:

    LoopbackBuffer.cpp

Abstract:

    SoundPipe Phase 1b - loopback bridge implementation. See LoopbackBuffer.h.

    A single global byte FIFO (NonPagedPool) guarded by a spin lock. Producer =
    any render stream; consumer = any capture stream. The FIFO always stores
    mono 16-bit PCM; stereo producers are downmixed (avg L/R) on write. The ring
    stays sample-aligned (whole 16-bit samples) so the consumer never reads a
    half-sample-shifted stream. Underrun -> silence; overflow -> drop oldest.

--*/

#include <sysvad.h>
#include "LoopbackBuffer.h"

#define LOOPBACK_POOLTAG 'BLPS'   // "SPLB" - SoundPipe LoopBack

// ~170 ms of 48 kHz / 16-bit / mono audio (48000 * 2 * 0.17). Even number so the
// ring stays 16-bit-sample aligned. Size is not critical: bigger = more latency
// and more tolerance to clock drift between the two independent 1 ms timers.
#define LOOPBACK_CAPACITY  (16 * 1024)

typedef struct _LOOPBACK_FIFO
{
    BYTE*       Buffer;         // ring storage (mono 16-bit), NonPagedPool
    ULONG       Capacity;       // size of Buffer in bytes (even)
    ULONG       Head;           // write offset (even)
    ULONG       Tail;           // read offset (even)
    ULONG       Count;          // bytes currently stored (even)
    KSPIN_LOCK  Lock;
    BOOLEAN     Initialized;

    // Producer-side carry for an incomplete stereo frame (a stereo 16-bit frame
    // is 4 bytes; a write chunk may end mid-frame). Holds 0..3 leftover bytes.
    BYTE        Carry[4];
    ULONG       CarryBytes;
} LOOPBACK_FIFO;

static LOOPBACK_FIFO g_Loopback = { 0 };

//=============================================================================
#pragma code_seg("PAGE")
NTSTATUS LoopbackBuffer_Init(void)
{
    PAGED_CODE();

    RtlZeroMemory(&g_Loopback, sizeof(g_Loopback));

    g_Loopback.Buffer = (BYTE*)ExAllocatePool2(POOL_FLAG_NON_PAGED, LOOPBACK_CAPACITY, LOOPBACK_POOLTAG);
    if (g_Loopback.Buffer == NULL)
    {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    g_Loopback.Capacity    = LOOPBACK_CAPACITY;
    g_Loopback.Head         = 0;
    g_Loopback.Tail         = 0;
    g_Loopback.Count        = 0;
    g_Loopback.CarryBytes   = 0;
    KeInitializeSpinLock(&g_Loopback.Lock);
    g_Loopback.Initialized  = TRUE;

    return STATUS_SUCCESS;
}

//=============================================================================
#pragma code_seg("PAGE")
VOID LoopbackBuffer_Cleanup(void)
{
    PAGED_CODE();

    if (g_Loopback.Buffer != NULL)
    {
        // No streams should be running at unload; safe to free without the lock.
        g_Loopback.Initialized = FALSE;
        ExFreePoolWithTag(g_Loopback.Buffer, LOOPBACK_POOLTAG);
        g_Loopback.Buffer = NULL;
    }
}

//=============================================================================
// Push raw mono 16-bit bytes into the ring (caller holds the lock). On overflow,
// drop the oldest bytes to make room. ByteCount is assumed even.
#pragma code_seg()
static VOID PushLocked(_In_reads_bytes_(ByteCount) const BYTE* Src, _In_ ULONG ByteCount)
{
    if (ByteCount == 0)
    {
        return;
    }

    // If more than the whole ring is offered, keep only the most recent tail.
    if (ByteCount >= g_Loopback.Capacity)
    {
        Src       += (ByteCount - g_Loopback.Capacity);
        ByteCount = g_Loopback.Capacity;
    }

    // Drop oldest if not enough free space.
    ULONG freeSpace = g_Loopback.Capacity - g_Loopback.Count;
    if (ByteCount > freeSpace)
    {
        ULONG drop = ByteCount - freeSpace;
        g_Loopback.Tail   = (g_Loopback.Tail + drop) % g_Loopback.Capacity;
        g_Loopback.Count -= drop;
    }

    // Copy in, wrapping at the end of the ring.
    ULONG first = MIN(ByteCount, g_Loopback.Capacity - g_Loopback.Head);
    RtlCopyMemory(g_Loopback.Buffer + g_Loopback.Head, Src, first);
    if (ByteCount > first)
    {
        RtlCopyMemory(g_Loopback.Buffer, Src + first, ByteCount - first);
    }
    g_Loopback.Head   = (g_Loopback.Head + ByteCount) % g_Loopback.Capacity;
    g_Loopback.Count += ByteCount;
}

//=============================================================================
// Downmix one interleaved stereo 16-bit frame (4 bytes) to one mono sample
// (2 bytes) and push it (caller holds the lock).
#pragma code_seg()
static VOID PushStereoFrameLocked(_In_reads_bytes_(4) const BYTE* Frame)
{
    SHORT left  = (SHORT)(Frame[0] | (Frame[1] << 8));
    SHORT right = (SHORT)(Frame[2] | (Frame[3] << 8));
    SHORT mono  = (SHORT)(((LONG)left + (LONG)right) / 2);

    BYTE out[2];
    out[0] = (BYTE)(mono & 0xFF);
    out[1] = (BYTE)((mono >> 8) & 0xFF);
    PushLocked(out, 2);
}

//=============================================================================
#pragma code_seg()
VOID LoopbackBuffer_Write(_In_reads_bytes_(ByteCount) const BYTE* Src, _In_ ULONG ByteCount, _In_ USHORT SrcChannels)
{
    KIRQL oldIrql;

    if (Src == NULL || ByteCount == 0)
    {
        return;
    }

    KeAcquireSpinLock(&g_Loopback.Lock, &oldIrql);

    if (!g_Loopback.Initialized)
    {
        KeReleaseSpinLock(&g_Loopback.Lock, oldIrql);
        return;
    }

    if (SrcChannels >= 2)
    {
        // Stereo (or more, but treat as stereo): downmix L/R to mono, frame by
        // frame, carrying any partial 4-byte frame across calls.
        const ULONG frameSize = 4; // 2 channels * 16-bit

        // 1) Complete a carried partial frame first.
        if (g_Loopback.CarryBytes > 0)
        {
            ULONG need = frameSize - g_Loopback.CarryBytes;
            ULONG take = MIN(need, ByteCount);
            RtlCopyMemory(g_Loopback.Carry + g_Loopback.CarryBytes, Src, take);
            g_Loopback.CarryBytes += take;
            Src       += take;
            ByteCount -= take;

            if (g_Loopback.CarryBytes == frameSize)
            {
                PushStereoFrameLocked(g_Loopback.Carry);
                g_Loopback.CarryBytes = 0;
            }
        }

        // 2) Process all complete frames in the remaining input.
        while (ByteCount >= frameSize)
        {
            PushStereoFrameLocked(Src);
            Src       += frameSize;
            ByteCount -= frameSize;
        }

        // 3) Stash any leftover bytes (< 1 frame) for the next call.
        if (ByteCount > 0)
        {
            RtlCopyMemory(g_Loopback.Carry, Src, ByteCount);
            g_Loopback.CarryBytes = ByteCount;
        }
    }
    else
    {
        // Mono already matches the FIFO format. Push whole 16-bit samples; drop a
        // trailing odd byte (negligible, keeps the ring sample-aligned).
        PushLocked(Src, ByteCount & ~1u);
    }

    KeReleaseSpinLock(&g_Loopback.Lock, oldIrql);
}

//=============================================================================
#pragma code_seg()
VOID LoopbackBuffer_Read(_Out_writes_bytes_(ByteCount) BYTE* Dst, _In_ ULONG ByteCount)
{
    KIRQL oldIrql;

    if (Dst == NULL || ByteCount == 0)
    {
        return;
    }

    KeAcquireSpinLock(&g_Loopback.Lock, &oldIrql);

    ULONG avail = 0;
    if (g_Loopback.Initialized)
    {
        // Pop whole 16-bit samples only, so the ring stays sample-aligned.
        ULONG evenCount = ByteCount & ~1u;
        avail = MIN(g_Loopback.Count, evenCount);

        ULONG first = MIN(avail, g_Loopback.Capacity - g_Loopback.Tail);
        RtlCopyMemory(Dst, g_Loopback.Buffer + g_Loopback.Tail, first);
        if (avail > first)
        {
            RtlCopyMemory(Dst + first, g_Loopback.Buffer, avail - first);
        }
        g_Loopback.Tail   = (g_Loopback.Tail + avail) % g_Loopback.Capacity;
        g_Loopback.Count -= avail;
    }

    KeReleaseSpinLock(&g_Loopback.Lock, oldIrql);

    // Pad the rest with silence (covers underrun and any trailing odd byte).
    if (avail < ByteCount)
    {
        RtlZeroMemory(Dst + avail, ByteCount - avail);
    }
}

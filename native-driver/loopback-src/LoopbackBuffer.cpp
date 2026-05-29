/*++

Module Name:

    LoopbackBuffer.cpp

Abstract:

    SoundPipe Phase 1b loopback bridge. See LoopbackBuffer.h.

    A single global byte FIFO (NonPagedPool) guarded by a spin lock. Producer =
    any render stream; consumer = any capture stream. The FIFO holds the SoundPipe
    canonical format: 48 kHz / 16-bit / STEREO (4-byte frames). Render producers
    are stereo, so audio passes through unchanged; a mono producer (rare) is
    up-mixed to stereo so the FIFO stays stereo and frame-aligned. The ring stays
    4-byte-frame aligned so the consumer never reads channel/sample-shifted data.
    Underrun -> silence; overflow -> drop oldest.

--*/

#include <sysvad.h>
#include "LoopbackBuffer.h"

#define LOOPBACK_POOLTAG 'BLPS'   // "SPLB" - SoundPipe LoopBack

// ~85 ms of 48 kHz / 16-bit / stereo audio. Multiple of 4 so the ring stays
// stereo-frame aligned. Size is not critical: bigger = more latency and more
// tolerance to clock drift between the two independent 1 ms timers.
#define LOOPBACK_CAPACITY  (16 * 1024)
#define LOOPBACK_FRAME      4         // stereo 16-bit frame size in bytes

typedef struct _LOOPBACK_FIFO
{
    BYTE*       Buffer;         // ring storage (stereo 16-bit), NonPagedPool
    ULONG       Capacity;       // size of Buffer in bytes (multiple of 4)
    ULONG       Head;           // write offset (multiple of 4)
    ULONG       Tail;           // read offset (multiple of 4)
    ULONG       Count;          // bytes currently stored (multiple of 4)
    KSPIN_LOCK  Lock;
    BOOLEAN     Initialized;

    // Producer-side carry for an incomplete input frame held across calls.
    // Stereo: 0..3 leftover bytes of a 4-byte frame. Mono: 0..1 leftover byte.
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

    g_Loopback.Capacity     = LOOPBACK_CAPACITY;
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
// Push raw bytes into the ring (caller holds the lock). On overflow, drop the
// oldest bytes to make room. ByteCount is assumed a multiple of LOOPBACK_FRAME.
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
        // Stereo passthrough: the FIFO is already stereo, so copy 4-byte frames
        // straight through, carrying any partial frame across calls.
        if (g_Loopback.CarryBytes > 0)
        {
            ULONG need = LOOPBACK_FRAME - g_Loopback.CarryBytes;
            ULONG take = MIN(need, ByteCount);
            RtlCopyMemory(g_Loopback.Carry + g_Loopback.CarryBytes, Src, take);
            g_Loopback.CarryBytes += take;
            Src       += take;
            ByteCount -= take;
            if (g_Loopback.CarryBytes == LOOPBACK_FRAME)
            {
                PushLocked(g_Loopback.Carry, LOOPBACK_FRAME);
                g_Loopback.CarryBytes = 0;
            }
        }

        ULONG whole = ByteCount & ~3u;   // largest multiple of 4
        if (whole > 0)
        {
            PushLocked(Src, whole);
            Src       += whole;
            ByteCount -= whole;
        }

        if (ByteCount > 0)
        {
            RtlCopyMemory(g_Loopback.Carry, Src, ByteCount);
            g_Loopback.CarryBytes = ByteCount;
        }
    }
    else
    {
        // Mono producer (rare - render endpoints are stereo): up-mix each 16-bit
        // mono sample to a stereo frame (L = R) so the FIFO stays stereo. Carry a
        // trailing odd byte (half a mono sample) across calls.
        BYTE frame[LOOPBACK_FRAME];

        if (g_Loopback.CarryBytes == 1 && ByteCount > 0)
        {
            frame[0] = g_Loopback.Carry[0]; frame[1] = Src[0];
            frame[2] = g_Loopback.Carry[0]; frame[3] = Src[0];
            PushLocked(frame, LOOPBACK_FRAME);
            Src       += 1;
            ByteCount -= 1;
            g_Loopback.CarryBytes = 0;
        }

        while (ByteCount >= 2)
        {
            frame[0] = Src[0]; frame[1] = Src[1];
            frame[2] = Src[0]; frame[3] = Src[1];
            PushLocked(frame, LOOPBACK_FRAME);
            Src       += 2;
            ByteCount -= 2;
        }

        if (ByteCount == 1)
        {
            g_Loopback.Carry[0]   = Src[0];
            g_Loopback.CarryBytes = 1;
        }
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
        // Pop whole stereo frames only, so the ring stays frame-aligned.
        ULONG frameCount = ByteCount & ~3u;
        avail = MIN(g_Loopback.Count, frameCount);

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

    // Pad the rest with silence (covers underrun and any trailing partial frame).
    if (avail < ByteCount)
    {
        RtlZeroMemory(Dst + avail, ByteCount - avail);
    }
}

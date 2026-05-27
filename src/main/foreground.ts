// Lightweight foreground-window polling.
//
// We don't want to query the OS on every hotkey press (~20-50ms latency per
// call) so a background poller keeps the latest result in a module-level cache.
// On hotkey press we just read the cache (sub-millisecond).
//
// Uses `get-windows` (native binding on Windows). If the package fails to load
// for any reason, focus filtering is effectively disabled (we return null,
// which the hotkey handler treats as "no filter mismatch").

let activeWindow:
  | null
  | ((opts?: unknown) => Promise<{ owner?: { name?: string; path?: string } } | undefined>) = null;

let pollHandle: NodeJS.Timeout | null = null;
let cached: { processName: string | null; updatedAt: number } = {
  processName: null,
  updatedAt: 0,
};

async function loadActiveWindow(): Promise<void> {
  if (activeWindow) return;
  try {
    // Dynamic import keeps the rest of the app running even if the native
    // binding fails to load. Module name is built dynamically so TypeScript
    // doesn't insist on type definitions before `npm install` completes.
    const moduleName = 'get-windows';
    const mod = (await import(/* @vite-ignore */ moduleName)) as {
      activeWindow: typeof activeWindow;
    };
    activeWindow = mod.activeWindow;
  } catch (err) {
    console.warn('[foreground] get-windows failed to load:', err);
  }
}

async function poll(): Promise<void> {
  if (!activeWindow) return;
  try {
    const win = await activeWindow();
    const name = win?.owner?.name ?? null;
    cached = { processName: name, updatedAt: Date.now() };
  } catch (err) {
    // Some windows (e.g. UAC prompt, lock screen) can throw — keep the previous value.
    if (Date.now() - cached.updatedAt > 5000) {
      cached = { processName: null, updatedAt: Date.now() };
    }
    void err;
  }
}

export async function startForegroundPolling(intervalMs = 500): Promise<void> {
  await loadActiveWindow();
  if (!activeWindow) return;
  if (pollHandle) clearInterval(pollHandle);
  void poll();
  pollHandle = setInterval(() => void poll(), intervalMs);
}

export function stopForegroundPolling(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

/** Returns the cached foreground process name (e.g. "cs2.exe"). */
export function getForegroundProcessName(): string | null {
  return cached.processName;
}

/**
 * Convenience: returns true if either `filter` is empty, or the current
 * foreground process matches it (case-insensitive substring match on the
 * filter — so "cs2.exe" matches "cs2.exe", and "cs2" matches "cs2.exe").
 */
export function matchesForeground(filterProcessName: string | null | undefined): boolean {
  if (!filterProcessName) return true;
  const current = cached.processName;
  if (!current) {
    // Cache hasn't populated yet (poll not finished, or get-windows missing).
    // Fail-open so users aren't locked out of their soundboard while we wait.
    return true;
  }
  return current.toLowerCase().includes(filterProcessName.toLowerCase().replace(/\.exe$/, ''));
}

/** Lists currently-open windows for the UI's "pick a target app" dropdown. */
export async function listOpenWindows(): Promise<Array<{ processName: string; title: string }>> {
  if (!activeWindow) await loadActiveWindow();
  try {
    const moduleName = 'get-windows';
    const mod = (await import(/* @vite-ignore */ moduleName)) as {
      openWindows?: () => Promise<
        Array<{ owner?: { name?: string }; title?: string }>
      >;
    };
    if (!mod.openWindows) return [];
    const wins = await mod.openWindows();
    const seen = new Set<string>();
    const result: Array<{ processName: string; title: string }> = [];
    for (const w of wins) {
      const name = w.owner?.name;
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ processName: name, title: w.title ?? name });
    }
    result.sort((a, b) => a.processName.localeCompare(b.processName));
    return result;
  } catch (err) {
    console.warn('[foreground] listOpenWindows failed:', err);
    return [];
  }
}

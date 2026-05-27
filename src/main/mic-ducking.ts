// While any soundboard audio is playing, drop the user's mic strip gain in
// VoiceMeeter by the configured dB, then restore on stop. Saves the strip's
// pre-duck gain so we don't lose user adjustments.
//
// Failure modes (VoiceMeeter not installed, not running, DLL missing) all
// degrade to silently doing nothing.

import { getState } from './storage';
import { voicemeeter } from './voicemeeter';

let activeSoundCount = 0;
let ducked = false;
let savedGain: number | null = null;
let savedStripIndex: number | null = null;

function paramName(stripIndex: number): string {
  return `Strip[${stripIndex}].Gain`;
}

function applyDuck(): void {
  const { settings } = getState();
  const cfg = settings.micDucking;
  if (!cfg?.enabled) return;
  if (ducked) return;
  const stripIndex = cfg.stripIndex;
  const current = voicemeeter.getParameter(paramName(stripIndex));
  if (current === null) return;
  savedGain = current;
  savedStripIndex = stripIndex;
  // duckDb is negative; e.g. -12 dB drops the strip 12 dB below its current
  // setting. Clamp the target so we don't slam below VoiceMeeter's -60 floor.
  const target = Math.max(-60, current + cfg.duckDb);
  if (voicemeeter.setParameter(paramName(stripIndex), target)) {
    ducked = true;
  }
}

function restoreDuck(): void {
  if (!ducked || savedGain === null || savedStripIndex === null) return;
  voicemeeter.setParameter(paramName(savedStripIndex), savedGain);
  ducked = false;
  savedGain = null;
  savedStripIndex = null;
}

export const micDuckingController = {
  onPlayingCountChanged(count: number): void {
    activeSoundCount = Math.max(0, count);
    if (activeSoundCount > 0) applyDuck();
    else restoreDuck();
  },

  /** Called when settings change — re-evaluate; possibly un-duck if disabled mid-play. */
  onSettingsChanged(): void {
    const { settings } = getState();
    const cfg = settings.micDucking;
    if (!cfg?.enabled && ducked) {
      restoreDuck();
      return;
    }
    if (cfg?.enabled && activeSoundCount > 0 && !ducked) {
      applyDuck();
    }
  },

  stop(): void {
    restoreDuck();
    voicemeeter.shutdown();
  },

  /** Returns whether the VoiceMeeter integration is responsive — for the Settings UI. */
  status(): { available: boolean; error: string | null } {
    return {
      available: voicemeeter.isAvailable(),
      error: voicemeeter.getLoadError(),
    };
  },
};

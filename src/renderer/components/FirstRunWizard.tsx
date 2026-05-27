import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Button } from './Button';

type Props = { onClose: () => void };

const VB_CABLE_URL = 'https://vb-audio.com/Cable/';

async function findVBCableDeviceId(): Promise<string | null> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const match = devices.find(
    (d) =>
      d.kind === 'audiooutput' &&
      (d.label.toLowerCase().includes('cable input') ||
        d.label.toLowerCase().includes('vb-audio')),
  );
  return match?.deviceId ?? null;
}

export function FirstRunWizard({ onClose }: Props) {
  const patchSettings = useStore((s) => s.patchSettings);
  const [scanState, setScanState] = useState<'idle' | 'found' | 'missing'>('idle');
  const [foundId, setFoundId] = useState<string | null>(null);

  const scan = async () => {
    const id = await findVBCableDeviceId();
    if (id) {
      setFoundId(id);
      setScanState('found');
    } else {
      setScanState('missing');
    }
  };

  useEffect(() => {
    void scan();
  }, []);

  const useFound = async () => {
    if (!foundId) return;
    await patchSettings({ virtualMicDeviceId: foundId });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 w-[560px]">
        <h2 className="text-xl font-semibold mb-2">Welcome — one-time setup</h2>
        <p className="text-sm text-muted mb-4">
          To make sounds play through your microphone in games and Discord, you need a virtual audio cable. The free <strong>VB-CABLE</strong> driver creates one and is the standard tool for this.
        </p>

        <ol className="list-decimal pl-5 text-sm space-y-2 mb-4">
          <li>
            Download VB-CABLE from{' '}
            <button
              className="text-accent underline"
              onClick={() => void window.api.openExternal(VB_CABLE_URL)}
            >
              vb-audio.com/Cable
            </button>
            .
          </li>
          <li>Extract the zip, right-click <code>VBCABLE_Setup_x64.exe</code> → Run as administrator → Install Driver.</li>
          <li>Reboot if it asks.</li>
          <li>In Discord / your game / OBS, set the microphone input to <code>CABLE Output (VB-Audio Virtual Cable)</code>.</li>
          <li>Click “Re-scan” below.</li>
        </ol>

        <div className="bg-surface2 border border-border rounded p-3 mb-4">
          {scanState === 'idle' && <span className="text-muted text-sm">Scanning…</span>}
          {scanState === 'found' && (
            <span className="text-sm">
              ✓ Detected a VB-CABLE output. Click “Use it” to route sounds there.
            </span>
          )}
          {scanState === 'missing' && (
            <span className="text-sm text-danger">
              VB-CABLE not detected. Install it and click Re-scan. Or pick a device manually in Settings.
            </span>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <Button onClick={() => void scan()}>Re-scan</Button>
          <Button onClick={onClose}>Skip for now</Button>
          <button
            className={`px-3 py-1.5 rounded text-sm text-white ${
              scanState === 'found'
                ? 'bg-accent hover:bg-accentHover'
                : 'bg-surface2 text-muted cursor-not-allowed'
            }`}
            disabled={scanState !== 'found'}
            onClick={() => void useFound()}
          >
            Use it
          </button>
        </div>
      </div>
    </div>
  );
}

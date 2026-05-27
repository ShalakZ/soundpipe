import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Callout } from './Callout';
import { Button } from './Button';

type Props = { onClose: () => void };

type Step = 'welcome' | 'cable' | 'soundboard' | 'discord' | 'voice' | 'done';

const VB_CABLE_URL = 'https://vb-audio.com/Cable/';
const VOICEMEETER_URL = 'https://vb-audio.com/Voicemeeter/banana.htm';

export function SetupWizard({ onClose }: Props) {
  const settings = useStore((s) => s.settings);
  const patchSettings = useStore((s) => s.patchSettings);
  const [step, setStep] = useState<Step>('welcome');
  const [cableDetected, setCableDetected] = useState<boolean | null>(null);
  const [installState, setInstallState] = useState<
    | { kind: 'idle' }
    | { kind: 'downloading'; percent: number }
    | { kind: 'extracting' }
    | { kind: 'launching' }
    | { kind: 'awaiting-user' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // ---------- detection ----------

  const detectCable = async (): Promise<boolean> => {
    const fileExists = await window.api.detectVbCable();
    if (fileExists) return true;
    // Also check audio devices — covers cases where the inf is missing but the
    // device is registered, or our heuristic path is wrong.
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hit = devices.some((d) =>
      d.label.toLowerCase().includes('cable input') ||
      d.label.toLowerCase().includes('cable output'),
    );
    return hit;
  };

  useEffect(() => {
    void detectCable().then(setCableDetected);
  }, []);

  // Subscribe to live install progress from main.
  useEffect(() => {
    return window.api.onVbCableProgress((p) => {
      setInstallState(p);
    });
  }, []);

  // Auto-advance past cable step once it's installed.
  useEffect(() => {
    if (step === 'cable' && cableDetected) {
      setStep('soundboard');
    }
  }, [step, cableDetected]);

  // While we're on the cable step waiting for the user to finish the
  // installer, poll periodically for the device.
  useEffect(() => {
    if (step !== 'cable' || cableDetected) return;
    const handle = setInterval(() => {
      void detectCable().then((v) => {
        if (v) setCableDetected(true);
      });
    }, 3000);
    return () => clearInterval(handle);
  }, [step, cableDetected]);

  // ---------- actions ----------

  const startInstall = async () => {
    setInstallState({ kind: 'downloading', percent: 0 });
    const result = await window.api.installVbCable();
    if (!result.ok) {
      setInstallState({ kind: 'error', message: result.error });
    }
    // Otherwise progress will arrive via onVbCableProgress.
  };

  const autoPickCableInput = async (): Promise<boolean> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const match = devices.find(
      (d) => d.kind === 'audiooutput' && d.label.toLowerCase().includes('cable input'),
    );
    if (match) {
      await patchSettings({ virtualMicDeviceId: match.deviceId });
      return true;
    }
    return false;
  };

  const finishWizard = async () => {
    await patchSettings({ setupComplete: true });
    onClose();
  };

  // ---------- step components ----------

  const renderWelcome = () => (
    <>
      <h2 className="text-xl font-semibold mb-3">Welcome — let's get you set up</h2>
      <p className="text-sm text-muted mb-4">
        This walks you through the three things the soundboard needs to play sounds into Discord, games, OBS, or any other app that uses a microphone. It takes about 2 minutes.
      </p>
      <ol className="text-sm text-muted list-decimal pl-5 space-y-1 mb-6">
        <li>Install <strong className="text-text">VB-CABLE</strong> — a free virtual audio cable (one-time, ~5 MB).</li>
        <li>Pick which audio device the soundboard plays into.</li>
        <li>Tell your other apps (Discord, CS2, etc.) to listen to that device as their microphone.</li>
      </ol>
      <div className="flex justify-end gap-2">
        <Button onClick={() => void finishWizard()}>Skip wizard</Button>
        <Button variant="primary" onClick={() => setStep('cable')} autoFocus>
          Get started
        </Button>
      </div>
    </>
  );

  const renderCable = () => (
    <>
      <h2 className="text-xl font-semibold mb-3">Step 1 of 3 — Install VB-CABLE</h2>
      <p className="text-sm text-muted mb-4">
        VB-CABLE is a free, widely-used virtual audio cable. The soundboard needs it to route sounds to a microphone-like device that other apps can listen to.
      </p>

      {cableDetected ? (
        <Callout tone="success" title="VB-CABLE is already installed">
          We detected the driver on this machine. Click Next to continue.
        </Callout>
      ) : installState.kind === 'idle' ? (
        <div className="space-y-3">
          <Callout tone="info">
            Clicking <strong className="text-text">Install VB-CABLE</strong> downloads the official installer from vb-audio.com (~5 MB) and runs it. Windows will prompt for permission — click <strong className="text-text">Yes</strong>. In the installer, click <strong className="text-text">Install Driver</strong>, then reboot when asked.
          </Callout>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void startInstall()}>
              Install VB-CABLE
            </Button>
            <Button onClick={() => void window.api.openExternal(VB_CABLE_URL)}>
              Open download page
            </Button>
          </div>
        </div>
      ) : installState.kind === 'downloading' ? (
        <div>
          <div className="text-sm mb-2">Downloading VB-CABLE… {installState.percent}%</div>
          <div className="h-2 bg-surface2 rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.max(2, installState.percent)}%` }}
            />
          </div>
        </div>
      ) : installState.kind === 'extracting' ? (
        <div className="text-sm">Extracting installer…</div>
      ) : installState.kind === 'launching' ? (
        <div className="text-sm">Launching installer (look for the Windows UAC prompt)…</div>
      ) : installState.kind === 'awaiting-user' ? (
        <Callout tone="info" title="Finish the VB-CABLE installer">
          The VB-CABLE installer is now open. Click <strong className="text-text">Install Driver</strong>, then <strong className="text-text">reboot when prompted</strong>. After reboot, relaunch SoundPipe — we'll pick up right here.
        </Callout>
      ) : installState.kind === 'error' ? (
        <Callout tone="danger" title="Install failed">
          {installState.message}
          <br />
          You can install VB-CABLE manually from{' '}
          <button
            className="text-accent underline"
            onClick={() => void window.api.openExternal(VB_CABLE_URL)}
          >
            vb-audio.com/Cable
          </button>{' '}
          and click Next when done.
        </Callout>
      ) : null}

      <div className="flex justify-between mt-6">
        <Button onClick={() => setStep('welcome')}>Back</Button>
        <Button
          variant="primary"
          onClick={() => setStep('soundboard')}
          disabled={!cableDetected}
        >
          Next
        </Button>
      </div>
    </>
  );

  const renderSoundboard = () => (
    <SoundboardStep
      onBack={() => setStep('cable')}
      onNext={() => setStep('discord')}
      autoPick={autoPickCableInput}
      currentDeviceId={settings.virtualMicDeviceId}
    />
  );

  const renderDiscord = () => (
    <>
      <h2 className="text-xl font-semibold mb-3">Step 3 of 3 — Tell apps about it</h2>
      <p className="text-sm text-muted mb-4">
        In Discord, your game, or any app where you want soundboard sounds to come through as your microphone:
      </p>
      <ol className="text-sm list-decimal pl-5 space-y-2 mb-4">
        <li>Open the app's voice/audio settings.</li>
        <li>
          Set the <strong>microphone / input device</strong> to{' '}
          <code className="bg-surface2 px-1 rounded text-text">CABLE Output (VB-Audio Virtual Cable)</code>.
        </li>
        <li>Disable any noise suppression / Krisp — it'll filter out your soundboard sounds.</li>
      </ol>
      <Callout tone="warn" title="Heads up — your own voice">
        Setting Discord's mic to CABLE Output means Discord only hears what plays into CABLE Input — so your actual mic stops being heard. The next (optional) step covers mixing your voice back in.
      </Callout>
      <div className="flex justify-between mt-6">
        <Button onClick={() => setStep('soundboard')}>Back</Button>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              void window.api.openExternal('https://discord.com/channels/@me')
            }
          >
            Open Discord
          </Button>
          <Button variant="primary" onClick={() => setStep('voice')}>
            Next
          </Button>
        </div>
      </div>
    </>
  );

  const renderVoice = () => (
    <>
      <h2 className="text-xl font-semibold mb-3">Optional — mix your voice in</h2>
      <p className="text-sm text-muted mb-4">
        Right now Discord/games hear only the soundboard, not your actual mic. To fix that, route your mic into CABLE Input alongside the soundboard. Two ways:
      </p>

      <div className="space-y-3 mb-6">
        <Callout tone="info" title='Quick option — Windows "Listen to this device"'>
          Right-click the speaker icon → Sound settings → More sound settings → Recording tab → right-click your mic → Properties → Listen tab → check <strong className="text-text">Listen to this device</strong>, set playback to <code className="bg-surface2 px-1 rounded text-text">CABLE Input (VB-Audio Virtual Cable)</code>. Done.
        </Callout>
        <Callout tone="info" title="Advanced — VoiceMeeter">
          For noise gates, mic ducking, and EQ, install <button
            className="text-accent underline"
            onClick={() => void window.api.openExternal(VOICEMEETER_URL)}
          >VoiceMeeter Banana</button> and route your mic + the soundboard's Voicemeeter Input through it. There's a detailed setup in the project README.
        </Callout>
      </div>

      <div className="flex justify-between">
        <Button onClick={() => setStep('discord')}>Back</Button>
        <Button variant="primary" onClick={() => setStep('done')}>
          I'll deal with it later
        </Button>
      </div>
    </>
  );

  const renderDone = () => (
    <>
      <h2 className="text-xl font-semibold mb-3">You're set up</h2>
      <p className="text-sm text-muted mb-6">
        Drag audio files onto the grid, click a sound's hotkey button to bind it, and you're playing into Discord. Visit Settings any time to tweak audio routing, the clip buffer, profile filters, or mic ducking.
      </p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void finishWizard()} autoFocus>
          Open SoundPipe
        </Button>
      </div>
    </>
  );

  // ---------- shell ----------

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 w-[600px] max-w-[95vw] max-h-[90vh] overflow-auto">
        {step === 'welcome' && renderWelcome()}
        {step === 'cable' && renderCable()}
        {step === 'soundboard' && renderSoundboard()}
        {step === 'discord' && renderDiscord()}
        {step === 'voice' && renderVoice()}
        {step === 'done' && renderDone()}
      </div>
    </div>
  );
}

// ---------- step: pick soundboard output device ----------

function SoundboardStep({
  onBack,
  onNext,
  autoPick,
  currentDeviceId,
}: {
  onBack: () => void;
  onNext: () => void;
  autoPick: () => Promise<boolean>;
  currentDeviceId: string | null;
}) {
  const [autoPicked, setAutoPicked] = useState<boolean | null>(null);
  const [outputs, setOutputs] = useState<Array<{ deviceId: string; label: string }>>([]);
  const patchSettings = useStore((s) => s.patchSettings);

  useEffect(() => {
    const fetch = async () => {
      const all = await navigator.mediaDevices.enumerateDevices();
      setOutputs(
        all
          .filter((d) => d.kind === 'audiooutput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Unknown device' })),
      );
    };
    void fetch();
  }, []);

  useEffect(() => {
    if (autoPicked !== null) return;
    void autoPick().then(setAutoPicked);
  }, [autoPicked, autoPick]);

  const selectedLabel =
    outputs.find((o) => o.deviceId === currentDeviceId)?.label ?? null;

  return (
    <>
      <h2 className="text-xl font-semibold mb-3">Step 2 of 3 — Soundboard output</h2>
      <p className="text-sm text-muted mb-4">
        This is the device the app plays sounds into. Other apps will listen to it as their microphone.
      </p>

      {autoPicked ? (
        <Callout tone="success" title="Auto-configured">
          We set the soundboard's output to <code className="bg-surface2 px-1 rounded text-text">{selectedLabel ?? 'CABLE Input'}</code>. Change it below if you'd rather use a different device.
        </Callout>
      ) : (
        <Callout tone="warn">
          Couldn't find <code className="bg-surface2 px-1 rounded text-text">CABLE Input</code> in your audio devices. Pick one manually below or go back and re-install VB-CABLE.
        </Callout>
      )}

      <label className="block text-xs text-muted mt-4 mb-1">Soundboard output device</label>
      <select
        className="w-full bg-surface2 border border-border rounded px-2 py-1 text-sm"
        value={currentDeviceId ?? ''}
        onChange={(e) => void patchSettings({ virtualMicDeviceId: e.target.value || null })}
      >
        <option value="">— Select a device —</option>
        {outputs.map((o) => (
          <option key={o.deviceId} value={o.deviceId}>
            {o.label}
          </option>
        ))}
      </select>

      <div className="flex justify-between mt-6">
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" onClick={onNext} disabled={!currentDeviceId}>
          Next
        </Button>
      </div>
    </>
  );
}

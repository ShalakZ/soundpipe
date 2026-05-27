import { useEffect, useState } from 'react';
import { Button } from './Button';

type Props = {
  value: string | null;
  onChange: (deviceId: string | null) => void;
  emptyLabel: string;
  filter?: (label: string) => boolean;
  /** Which audio device kind to enumerate. Defaults to 'audiooutput'. */
  kind?: 'audiooutput' | 'audioinput';
};

type Device = { deviceId: string; label: string };

async function listDevices(
  kind: 'audiooutput' | 'audioinput',
): Promise<Device[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === kind)
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Unknown device' }));
}

export function DeviceSelector({
  value,
  onChange,
  emptyLabel,
  filter,
  kind = 'audiooutput',
}: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    void listDevices(kind).then(setDevices);
    const handler = () => void listDevices(kind).then(setDevices);
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, [reloadKey, kind]);

  const filtered = filter ? devices.filter((d) => filter(d.label)) : devices;

  return (
    <div className="flex gap-2">
      <select
        className="flex-1 bg-surface2 border border-border rounded px-2 py-1 text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{emptyLabel}</option>
        {filtered.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
        {filter && filtered.length === 0 && (
          <option disabled>No matching devices found</option>
        )}
      </select>
      <Button
        size="sm"
        onClick={() => setReloadKey((k) => k + 1)}
        title="Re-scan audio devices"
      >
        ⟳
      </Button>
    </div>
  );
}

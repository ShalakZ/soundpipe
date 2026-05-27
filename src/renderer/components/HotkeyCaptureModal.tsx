import { useEffect } from 'react';
import type { Hotkey } from '@shared/types';
import { Button } from './Button';

type Props = {
  onCapture: (hotkey: Hotkey | null) => void;
  onCancel: () => void;
  allowClear?: boolean;
};

export function HotkeyCaptureModal({ onCapture, onCancel, allowClear = true }: Props) {
  useEffect(() => {
    let cancelled = false;
    window.api
      .captureHotkey()
      .then((hk) => {
        if (!cancelled) onCapture(hk);
      })
      .catch(() => {
        if (!cancelled) onCancel();
      });
    return () => {
      cancelled = true;
    };
  }, [onCapture, onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 w-[400px] text-center">
        <h3 className="text-lg font-semibold mb-2">Press a key or mouse button</h3>
        <p className="text-sm text-muted mb-4">
          Hold any modifiers (Ctrl, Alt, Shift, Win) then press a key, the middle mouse button, or a side button (Mouse4, Mouse5, …). Left and right click are ignored so this dialog stays usable.
        </p>
        <div className="flex gap-2 justify-center">
          {allowClear && (
            <Button
              onClick={() => {
                void window.api.cancelCapture();
                onCapture(null);
              }}
            >
              Clear binding
            </Button>
          )}
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

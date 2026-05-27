import { useEffect, useRef } from 'react';
import { Button } from './Button';

type Props = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Branded replacement for `window.confirm`. Esc cancels; Enter confirms.
 * Autofocuses the Confirm button so keyboard users can hit Enter immediately.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  const confirmClass =
    tone === 'danger'
      ? 'bg-danger hover:bg-danger/80 text-white'
      : 'bg-accent hover:bg-accentHover text-white';

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-surface border border-border rounded-lg p-5 w-[400px] max-w-[90vw]">
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        {message && (
          <p className="text-sm text-muted whitespace-pre-wrap mb-5">{message}</p>
        )}
        <div className="flex gap-2 justify-end">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <button
            ref={confirmRef}
            type="button"
            className={`px-3 py-1.5 rounded text-sm ${confirmClass}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

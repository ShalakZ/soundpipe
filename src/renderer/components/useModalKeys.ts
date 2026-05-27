import { useEffect } from 'react';

/**
 * Common modal keyboard plumbing:
 *   - Esc → onClose (unless busy)
 *   - Optional autofocus of a ref'd element on mount
 *
 * Keep it minimal — full focus-trap requires more orchestration than we
 * actually need, and `:focus-visible` rings make tabbing visible enough.
 */
export function useModalKeys(options: {
  onClose: () => void;
  busy?: boolean;
  autoFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const { onClose, busy, autoFocusRef } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (busy) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, busy]);

  useEffect(() => {
    if (!autoFocusRef?.current) return;
    // queueMicrotask: ensures the element is fully mounted in the DOM tree
    // before focus is attempted (avoids races inside React.StrictMode).
    queueMicrotask(() => autoFocusRef.current?.focus());
  }, [autoFocusRef]);
}

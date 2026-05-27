import { createRoot } from 'react-dom/client';
import { ConfirmDialog } from './ConfirmDialog';

type Options = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
};

/**
 * Imperative confirm() replacement: returns a Promise<boolean>. Mounts the
 * dialog into a transient DOM node and unmounts on resolution. Use from any
 * async flow without dragging dialog state through component trees.
 *
 *   if (await confirmDialog({ title: 'Delete this?', tone: 'danger' })) ...
 */
export function confirmDialog(opts: Options): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const cleanup = (result: boolean) => {
      try {
        root.unmount();
      } catch {
        /* ignore */
      }
      if (container.parentNode) container.parentNode.removeChild(container);
      resolve(result);
    };

    root.render(
      <ConfirmDialog
        title={opts.title}
        message={opts.message}
        confirmLabel={opts.confirmLabel}
        cancelLabel={opts.cancelLabel}
        tone={opts.tone}
        onConfirm={() => cleanup(true)}
        onCancel={() => cleanup(false)}
      />,
    );
  });
}

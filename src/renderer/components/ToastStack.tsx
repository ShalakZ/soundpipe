import { useStore } from '../state/store';

export function ToastStack() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-30 flex flex-col gap-2 max-w-md">
      {toasts.map((t) => {
        const tone =
          t.kind === 'error'
            ? 'bg-surface border-danger'
            : t.kind === 'success'
              ? 'bg-surface border-accent'
              : 'bg-surface border-border';
        const iconColor =
          t.kind === 'error'
            ? 'text-danger'
            : t.kind === 'success'
              ? 'text-accent'
              : 'text-muted';
        const icon =
          t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : 'ℹ';
        return (
          <div
            key={t.id}
            className={`flex items-start gap-2 px-3 py-2 rounded shadow-lg border text-sm ${tone} text-text`}
          >
            <span aria-hidden className={iconColor}>
              {icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="break-words whitespace-pre-wrap">{t.message}</div>
              {t.actions && t.actions.length > 0 && (
                <div className="flex gap-2 mt-2">
                  {t.actions.map((a, i) => (
                    <button
                      key={i}
                      type="button"
                      className="px-2 py-0.5 rounded bg-surface2 hover:bg-border text-xs"
                      onClick={() => {
                        a.onClick();
                        dismiss(t.id);
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="text-muted hover:text-text shrink-0"
              onClick={() => dismiss(t.id)}
              title="Dismiss"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

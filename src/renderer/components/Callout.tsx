import type { ReactNode } from 'react';

type Tone = 'info' | 'warn' | 'danger' | 'success';

type Props = {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
  /** Compact 1-line variant (skinnier padding, no icon stack). */
  compact?: boolean;
};

const ICONS: Record<Tone, string> = {
  info: 'ℹ',
  warn: '⚠',
  danger: '⚠',
  success: '✓',
};

const STYLES: Record<Tone, { border: string; icon: string }> = {
  info: { border: 'border-border', icon: 'text-muted' },
  warn: { border: 'border-yellow-500/50', icon: 'text-yellow-400' },
  danger: { border: 'border-danger/50', icon: 'text-danger' },
  success: { border: 'border-accent/50', icon: 'text-accent' },
};

export function Callout({
  tone = 'info',
  title,
  children,
  onDismiss,
  compact = false,
}: Props) {
  const s = STYLES[tone];
  return (
    <div
      className={`relative bg-surface border ${s.border} rounded text-sm ${
        compact ? 'px-3 py-2' : 'p-3'
      }`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className={`${s.icon} ${compact ? '' : 'mt-0.5'}`}>
          {ICONS[tone]}
        </span>
        <div className="flex-1 min-w-0">
          {title && <div className="font-medium mb-0.5">{title}</div>}
          <div className={`${compact ? '' : 'text-muted'} text-xs leading-relaxed`}>
            {children}
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="text-muted hover:text-text text-sm shrink-0"
            onClick={onDismiss}
            title="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

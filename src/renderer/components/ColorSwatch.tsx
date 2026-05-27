import { useEffect, useRef, useState } from 'react';

/** Curated palette — friendly with the dark theme; visually distinct at small sizes. */
export const SOUND_COLORS: Array<{ name: string; value: string }> = [
  { name: 'Default', value: '' }, // empty string = unset, shows accent color
  { name: 'Purple', value: '#9479ff' },
  { name: 'Blue', value: '#4ea1ff' },
  { name: 'Teal', value: '#3ec6c9' },
  { name: 'Green', value: '#52c977' },
  { name: 'Yellow', value: '#ffc94e' },
  { name: 'Orange', value: '#ff8a3d' },
  { name: 'Red', value: '#ef5454' },
  { name: 'Pink', value: '#ff6fb3' },
  { name: 'Gray', value: '#8b91a3' },
];

type Props = {
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  /** Size in px for the trigger swatch. Defaults to 16. */
  size?: number;
};

export function ColorSwatch({ value, onChange, size = 16 }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = value || '';

  // Close popover on click outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        className="rounded-full border border-border hover:border-accent hover:ring-2 hover:ring-accent/40 transition"
        style={{
          width: size,
          height: size,
          backgroundColor: current || '#3a4055',
          backgroundImage: current
            ? undefined
            : 'repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 4px)',
        }}
        title={current ? 'Change color' : 'Pick a color'}
        aria-label={current ? 'Change color' : 'Pick a color'}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div
          className="absolute z-20 mt-2 left-0 bg-surface border border-border rounded-lg p-2 shadow-lg"
          style={{ width: 200 }}
        >
          <div className="grid grid-cols-5 gap-1.5">
            {SOUND_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`relative rounded-full w-7 h-7 border ${
                  (current || '') === c.value
                    ? 'border-accent ring-2 ring-accent/40'
                    : 'border-border hover:border-text'
                } transition`}
                style={{ backgroundColor: c.value || '#3a4055' }}
                title={c.name}
                onClick={() => {
                  onChange(c.value || null);
                  setOpen(false);
                }}
              >
                {c.value === '' && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted">
                    ⊘
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

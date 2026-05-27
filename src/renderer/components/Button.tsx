import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary';
type Size = 'sm' | 'md';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const BASE = 'rounded disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-colors';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent hover:bg-accentHover text-white',
  secondary: 'bg-surface2 hover:bg-border text-text',
};

const SIZE: Record<Size, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  const cls = `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`.trim();
  return <button ref={ref} type={type} className={cls} {...rest} />;
});

import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'primary';
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center gap-1.5 rounded-token border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<Variant, string> = {
  default:
    'border-border bg-surface text-text hover:bg-surface-muted disabled:hover:bg-surface',
  primary:
    'border-brand bg-brand text-on-brand hover:brightness-95 disabled:hover:brightness-100',
};

const sizes: Record<Size, string> = {
  md: 'px-3 py-1.5 text-body',
  sm: 'px-2.5 py-1 text-caption',
};

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    />
  );
}

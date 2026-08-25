import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

// Primary rides the brand tokens (UBC navy, and whatever high-contrast mode
// swaps them to) instead of a raw blue-700 that matched nothing else on the
// page. Danger keeps the danger tokens for the same reason.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-brand text-brand-foreground hover:bg-brand-hover',
  secondary: 'border border-border text-foreground hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:opacity-90',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export default function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-lg px-5 py-2.5 text-base transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-100 disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}

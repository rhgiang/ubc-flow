import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

// Mirrors the classes already repeated across the app (course/[code]/review/form.tsx,
// login/signup pages) rather than inventing a new visual language.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800',
  secondary: 'border text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-700 text-white hover:bg-red-800',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export default function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-lg px-5 py-2 text-sm transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-100 disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}

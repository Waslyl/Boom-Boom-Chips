import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { audio } from '../../audio/audio';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children: ReactNode;
  onClick?: () => void;
  /** Suppress the built-in click sound for buttons that play their own. */
  silent?: boolean;
}

const VARIANT_CLASS: Record<Variant, string> = {
  default: '',
  primary: 'btn-primary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
};

export function Button({
  variant = 'default',
  size = 'md',
  block = false,
  silent = false,
  className = '',
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${block ? 'w-full' : ''} ${className}`}
      onPointerEnter={() => {
        if (!rest.disabled) audio.play('hover');
      }}
      onClick={() => {
        if (rest.disabled) return;
        // The audio context can only start inside a real gesture.
        audio.unlock();
        if (!silent) audio.play('click');
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-forest text-ink-inverse hover:bg-forest-hover active:bg-forest-deep disabled:bg-forest/50',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-ivory active:bg-sage disabled:text-ink-subtle',
  ghost: 'bg-transparent text-ink hover:bg-sage/70 active:bg-sage disabled:text-ink-subtle',
  subtle: 'bg-sage text-forest-deep hover:bg-sage-strong disabled:text-ink-subtle',
  danger: 'bg-danger text-ink-inverse hover:bg-danger/90 disabled:bg-danger/50',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const buttonClasses = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) =>
  cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium',
    'transition-colors duration-fast disabled:cursor-not-allowed',
    variantClasses[variant],
    sizeClasses[size],
    extra,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, leftIcon, rightIcon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(fullWidth && 'w-full', className))}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name — required because the button has no visible text. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const iconSize: Record<ButtonSize, string> = { sm: 'size-8', md: 'size-10', lg: 'size-12' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        iconSize[size],
        className,
      )}
      {...rest}
    >
      <span aria-hidden className="[&>svg]:size-[18px]">{icon}</span>
    </button>
  );
});

import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Accessibility attributes for a control rendered inside <FormField>. */
export function useFieldControl(): Partial<{ id: string; 'aria-describedby': string; 'aria-invalid': boolean; 'aria-required': boolean }> {
  const ctx = useContext(FieldContext);
  if (!ctx) return {};
  return {
    id: ctx.id,
    'aria-describedby': ctx.describedBy,
    'aria-invalid': ctx.invalid || undefined,
    'aria-required': ctx.required || undefined,
  };
}

export interface FormFieldProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optionalLabel?: string;
  className?: string;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
}

export function FormField({ label, children, hint, error, required = false, optionalLabel, className, hideLabel }: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <label htmlFor={id} className={cn('flex items-baseline gap-1 text-sm font-medium text-ink', hideLabel && 'sr-only')}>
          {label}
          {required ? (
            <span className="text-danger" aria-hidden>
              *
            </span>
          ) : optionalLabel ? (
            <span className="text-xs font-normal text-ink-muted">({optionalLabel})</span>
          ) : null}
        </label>
        {children}
        {hint && !error && (
          <p id={hintId} className="text-xs text-ink-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn('grid gap-4 border-t border-line pt-6 first:border-t-0 first:pt-0', className)}>
      <div>
        <legend className="font-display text-base font-semibold text-ink">{title}</legend>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}

export function FormGrid({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const map = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const;
  return <div className={cn('grid grid-cols-1 gap-4', map[cols], className)}>{children}</div>;
}

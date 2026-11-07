import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);
/** True inside <FormGrid>, where fields share row tracks so inputs line up. */
const GridContext = createContext(false);

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
  /** For a set of controls (checkboxes): the label names the group instead of one input. */
  group?: boolean;
}

export function FormField({ label, children, hint, error, required = false, optionalLabel, className, hideLabel, group = false }: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const inGrid = useContext(GridContext);

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div
        className={cn(
          'min-w-0',
          // In a grid each field spans three shared rows (label, control, help),
          // so a label that wraps never pushes its input below its neighbours'.
          // Spacing sits on the label and help text (not a row gap) so an empty
          // help row takes no room.
          inGrid ? 'row-span-3 grid grid-rows-subgrid gap-y-0' : 'flex flex-col',
          className,
        )}
      >
        {(() => {
          const content = (
            <>
              {label}
              {required ? (
                <span className="text-danger" aria-hidden>
                  *
                </span>
              ) : optionalLabel ? (
                <span className="text-xs font-normal text-ink-muted">({optionalLabel})</span>
              ) : null}
            </>
          );
          const labelClass = cn('flex items-end gap-1 pb-1.5 text-sm font-medium text-ink', hideLabel && 'sr-only');
          return group ? (
            <span id={`${id}-label`} className={labelClass}>
              {content}
            </span>
          ) : (
            <label htmlFor={id} className={labelClass}>
              {content}
            </label>
          );
        })()}
        {group ? (
          <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="min-w-0">
            {children}
          </div>
        ) : (
          <div className="min-w-0">{children}</div>
        )}
        {hint && !error && (
          <p id={hintId} className="mt-1.5 text-xs text-ink-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-danger">
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
  // Row spacing comes from each child's bottom margin, because fields use the rows
  // as a subgrid and keep their own tight label-to-input gap. The last row's margin
  // is cancelled inside a flow-root wrapper, so parent `space-y-*` cannot undo it.
  return (
    <GridContext.Provider value>
      <div className="flow-root">
        <div className={cn('-mb-4 grid grid-cols-1 gap-x-4 [&>*]:mb-4 [&>*]:self-start [&>[class*=row-span-3]]:self-stretch', map[cols], className)}>{children}</div>
      </div>
    </GridContext.Provider>
  );
}

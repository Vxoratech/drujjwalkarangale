import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { useFieldControl } from '@/components/forms/FormField';
import { cn } from '@/lib/cn';

export const controlClasses = cn(
  'w-full rounded-md border border-line-strong bg-surface text-sm text-ink placeholder:text-ink-subtle',
  'transition-colors duration-fast hover:border-forest/40',
  'focus-visible:border-forest focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:bg-ivory disabled:text-ink-muted',
  'aria-[invalid=true]:border-danger',
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, leading, trailing, ...rest }, ref) {
  const field = useFieldControl();
  const input = (
    <input
      ref={ref}
      className={cn(controlClasses, 'h-10 px-3', leading && 'pl-9', trailing && 'pr-9', className)}
      {...field}
      {...rest}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className="relative">
      {leading && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted [&>svg]:size-4">{leading}</span>}
      {input}
      {trailing && <span className="absolute inset-y-0 right-2 flex items-center text-ink-muted">{trailing}</span>}
    </div>
  );
});

/** Native date input — accessible, mobile-friendly; displays DD/MM/YYYY for en-IN. */
export const DateInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(function DateInput(props, ref) {
  return <Input ref={ref} type="date" {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  const field = useFieldControl();
  return <textarea ref={ref} rows={rows} className={cn(controlClasses, 'min-h-[2.5rem] px-3 py-2 leading-relaxed', className)} {...field} {...rest} />;
});

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, options, placeholder, ...rest }, ref) {
  const field = useFieldControl();
  return (
    <div className="relative">
      <select ref={ref} className={cn(controlClasses, 'h-10 appearance-none pl-3 pr-9', className)} {...field} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
    </div>
  );
});

export interface SearchInputProps extends Omit<InputProps, 'type' | 'onChange' | 'value'> {
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, clearLabel = 'Clear search', ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="search"
      role="searchbox"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      leading={<Search />}
      trailing={
        value ? (
          <button type="button" onClick={() => onValueChange('')} aria-label={clearLabel} className="rounded p-1 hover:bg-sage">
            <X className="size-4" aria-hidden />
          </button>
        ) : null
      }
      className="[&::-webkit-search-cancel-button]:hidden"
      {...rest}
    />
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, className, id, ...rest }, ref) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 text-sm', rest.disabled && 'cursor-not-allowed opacity-60', className)} htmlFor={id}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong accent-[var(--color-forest)]"
        {...rest}
      />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="block text-ink-muted">{description}</span>}
      </span>
    </label>
  );
});

export interface RadioGroupProps<V extends string> {
  name: string;
  value: V | null | undefined;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  legend: string;
  hideLegend?: boolean;
  inline?: boolean;
  disabled?: boolean;
}

export function RadioGroup<V extends string>({ name, value, onChange, options, legend, hideLegend, inline = true, disabled }: RadioGroupProps<V>) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className={cn('mb-1.5 text-sm font-medium text-ink', hideLegend && 'sr-only')}>{legend}</legend>
      <div className={cn('flex gap-2', inline ? 'flex-wrap' : 'flex-col')}>
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors duration-fast',
                'has-[:focus-visible]:shadow-focus',
                checked ? 'border-forest bg-sage text-forest-deep' : 'border-line-strong bg-surface text-ink hover:bg-ivory',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              <span aria-hidden className={cn('size-3.5 rounded-full border', checked ? 'border-[4px] border-forest' : 'border-line-strong')} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

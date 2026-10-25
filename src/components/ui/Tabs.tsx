import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Tabs = RadixTabs.Root;

export function TabsList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <RadixTabs.List aria-label={label} className={cn('-mb-px flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]', className)}>
      {children}
    </RadixTabs.List>
  );
}

export function TabsTrigger({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  return (
    <RadixTabs.Trigger
      value={value}
      className={cn(
        'relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium text-ink-muted transition-colors duration-fast',
        'hover:text-ink data-[state=active]:text-forest-deep',
        'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-forest',
      )}
    >
      {children}
      {count !== undefined && <span className="tabular rounded-full bg-sage px-1.5 text-xs text-forest-deep">{count}</span>}
    </RadixTabs.Trigger>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RadixTabs.Content value={value} className={cn('pt-5 focus-visible:outline-none', className)}>
      {children}
    </RadixTabs.Content>
  );
}

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

/** Single-choice toggle group (e.g. date presets, view switches). */
export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: V;
  onChange: (value: V) => void;
  options: readonly SegmentedOption<V>[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md border border-line bg-ivory p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 whitespace-nowrap rounded px-3 text-sm font-medium transition-colors duration-fast',
              active ? 'bg-surface text-forest-deep shadow-xs' : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

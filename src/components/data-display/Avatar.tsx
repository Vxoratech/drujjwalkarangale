import { cn } from '@/lib/cn';
import { initials } from '@/lib/formatters';

const sizes = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' } as const;

export function Avatar({ name, size = 'md', tone = 'sage', className }: { name: string; size?: keyof typeof sizes; tone?: 'sage' | 'gold' | 'forest'; className?: string }) {
  const toneClass = { sage: 'bg-sage text-forest-deep', gold: 'bg-gold-soft text-gold-ink', forest: 'bg-forest text-ink-inverse' }[tone];
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-display font-semibold', sizes[size], toneClass, className)}>
      {initials(name)}
    </span>
  );
}

export interface PatientIdentityProps {
  name: string;
  code?: string | null;
  meta?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function PatientIdentity({ name, code, meta, size = 'sm', className }: PatientIdentityProps) {
  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      <Avatar name={name} size={size} />
      <span className="min-w-0">
        <span className={cn('block truncate font-medium text-ink', size === 'lg' && 'font-display text-xl font-semibold')}>{name}</span>
        {(code || meta) && (
          <span className="block truncate text-xs text-ink-muted">
            {code && <span className="tabular">{code}</span>}
            {code && meta && <span aria-hidden> · </span>}
            {meta}
          </span>
        )}
      </span>
    </span>
  );
}

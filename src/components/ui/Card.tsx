import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface', className)} {...rest} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...rest} />;
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: 'forest' | 'gold' | 'warning' | 'info';
  loading?: boolean;
}

const accentMap = {
  forest: 'bg-sage text-forest',
  gold: 'bg-gold-soft text-gold-ink',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
} as const;

export function StatCard({ label, value, hint, icon, accent = 'forest', loading }: StatCardProps) {
  return (
    <Card className="flex items-start gap-4 p-5">
      {icon && (
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md [&>svg]:size-5', accentMap[accent])} aria-hidden>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm text-ink-muted">{label}</p>
        {loading ? (
          <span className="mt-1 block h-7 w-24 animate-pulse rounded bg-sage" aria-hidden />
        ) : (
          <p className="tabular mt-0.5 font-display text-2xl font-semibold text-ink">{value}</p>
        )}
        {hint && !loading && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      </div>
    </Card>
  );
}

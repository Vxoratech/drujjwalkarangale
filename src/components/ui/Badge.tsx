import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'forest' | 'gold' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-ivory text-ink-muted border-line',
  forest: 'bg-sage text-forest-deep border-sage-strong',
  gold: 'bg-gold-soft text-gold-ink border-gold',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/20',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
};

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-ink-subtle',
  forest: 'bg-forest',
  gold: 'bg-gold-ink',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function Badge({ tone = 'neutral', children, dot = false, className }: { tone?: BadgeTone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', toneClasses[tone], className)}>
      {dot && <span aria-hidden className={cn('size-1.5 rounded-full', dotClasses[tone])} />}
      {children}
    </span>
  );
}

/** Status → tone mapping shared across modules so states read consistently. */
export const STATUS_TONES: Record<string, BadgeTone> = {
  // appointments
  scheduled: 'info',
  checked_in: 'gold',
  in_consultation: 'forest',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'warning',
  // clinical records
  draft: 'warning',
  finalized: 'success',
  issued: 'success',
  // investigations
  ordered: 'info',
  sample_collected: 'gold',
  resulted: 'success',
  // invoices (issued maps to "Unpaid")
  partially_paid: 'warning',
  paid: 'success',
  void: 'neutral',
  // members
  active: 'success',
  invited: 'info',
  suspended: 'danger',
};

export function StatusBadge({ status, label, toneOverride }: { status: string; label: string; toneOverride?: BadgeTone }) {
  return (
    <Badge tone={toneOverride ?? STATUS_TONES[status] ?? 'neutral'} dot>
      {label}
    </Badge>
  );
}

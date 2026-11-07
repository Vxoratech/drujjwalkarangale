import { AlertTriangle, Inbox, Loader2, Lock, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/i18n';

interface StateProps {
  title?: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  compact?: boolean;
}

function StateFrame({ title, body, action, icon, className, compact, role }: StateProps & { role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16', className)}>
      {icon && (
        <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-sage text-forest [&>svg]:size-6">
          {icon}
        </span>
      )}
      {title && <h3 className="font-display text-base font-semibold text-ink">{title}</h3>}
      {body && <div className="max-w-prose text-sm text-ink-muted">{body}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon = <Inbox />, ...props }: StateProps) {
  const { t } = useI18n();
  return <StateFrame icon={icon} title={props.title ?? t('states.emptyTitle')} {...props} />;
}

export function ErrorState({ onRetry, message, ...props }: StateProps & { onRetry?: () => void; message?: string }) {
  const { t } = useI18n();
  return (
    <StateFrame
      role="alert"
      icon={<AlertTriangle className="text-danger" />}
      title={props.title ?? t('states.errorTitle')}
      body={message ?? t('states.errorBody')}
      action={
        onRetry && (
          <Button variant="secondary" leftIcon={<RefreshCw className="size-4" />} onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )
      }
      {...props}
    />
  );
}

export function PermissionDenied(props: StateProps) {
  const { t } = useI18n();
  return <StateFrame role="alert" icon={<Lock />} title={t('states.deniedTitle')} body={t('states.deniedBody')} {...props} />;
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  const { t } = useI18n();
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-ink-muted', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className={label ? undefined : 'sr-only'}>{label ?? t('common.loading')}</span>
    </span>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block animate-pulse rounded bg-sage/80', className)} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn('space-y-3 p-5', className)} role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Inline banner for contextual messages (info, warnings, locked records). */
export function Alert({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children?: ReactNode; icon?: ReactNode }) {
  const tones = {
    info: 'bg-info-soft text-info border-info/20',
    warning: 'bg-warning-soft text-warning border-warning/20',
    danger: 'bg-danger-soft text-danger border-danger/20',
    success: 'bg-success-soft text-success border-success/20',
  } as const;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-md border px-4 py-3 text-sm', tones[tone])}>
      {icon && <span aria-hidden className="mt-0.5 [&>svg]:size-4">{icon}</span>}
      <div>
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-ink')}>{children}</div>}
      </div>
    </div>
  );
}

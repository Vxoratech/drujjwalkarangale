import { Compass } from 'lucide-react';
import { Link, useRouteError } from 'react-router-dom';
import { EmptyState, ErrorState } from '@/components/feedback/States';
import { buttonClasses } from '@/components/ui/Button';
import { useI18n } from '@/locales/i18n';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={<Compass />}
      title={t('states.notFoundTitle')}
      body={t('states.notFoundBody')}
      action={
        <Link to="/" className={buttonClasses('secondary')}>
          {t('nav.dashboard')}
        </Link>
      }
    />
  );
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  // Log a generic marker only — error objects may carry record data.
  console.error('Route error', error instanceof Error ? error.name : typeof error);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ivory">
      <ErrorState onRetry={() => window.location.reload()} />
    </div>
  );
}

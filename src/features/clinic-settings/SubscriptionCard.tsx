import { useQuery } from '@tanstack/react-query';
import { ErrorState, SkeletonRows } from '@/components/feedback/States';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDate, formatINR } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { fetchSubscription } from '@/services/subscription';

/** Read-only: plans are changed by the platform, never from the clinic UI. */
export function SubscriptionCard() {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const query = useQuery({ queryKey: [clinicId, 'subscription'], queryFn: () => fetchSubscription(clinicId) });
  const sub = query.data;
  const limits = sub?.plan?.limits ?? {};
  const limit = (n: number | undefined) => (n === undefined ? t('settings.unlimited') : String(n));

  return (
    <Card>
      <CardHeader title={t('settings.subscription')} />
      {query.isLoading ? (
        <SkeletonRows rows={2} />
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} />
      ) : !sub ? (
        <CardBody>
          <p className="text-sm text-ink-muted">—</p>
        </CardBody>
      ) : (
        <CardBody className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-display text-base font-semibold">{sub.plan?.name}</p>
              {sub.plan && sub.plan.price_paise > 0 && <p className="tabular text-xs text-ink-muted">{formatINR(sub.plan.price_paise, { whole: true })} / {sub.billing_interval}</p>}
            </div>
            <Badge tone={sub.status === 'active' ? 'success' : sub.status === 'trialing' ? 'gold' : 'warning'}>{t(`subscriptionStatus.${sub.status}`)}</Badge>
          </div>
          <dl className="space-y-1.5">
            {sub.status === 'trialing' && sub.trial_ends_at && (
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t('settings.trialEnds')}</dt>
                <dd className="tabular">{formatDate(sub.trial_ends_at)}</dd>
              </div>
            )}
            {sub.status !== 'trialing' && sub.current_period_end && (
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t('settings.renews')}</dt>
                <dd className="tabular">{formatDate(sub.current_period_end)}</dd>
              </div>
            )}
          </dl>
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">{t('settings.limits')}</p>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['settings.limitDoctors', limits.max_doctors],
                  ['settings.limitBranches', limits.max_branches],
                  ['settings.limitStaff', limits.max_staff],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-md bg-ivory px-2 py-2">
                  <dd className="tabular font-display text-lg font-semibold">{limit(v)}</dd>
                  <dt className="text-xs text-ink-muted">{t(k)}</dt>
                </div>
              ))}
            </dl>
          </div>
          <p className="text-xs text-ink-muted">{t('settings.planManaged')}</p>
        </CardBody>
      )}
    </Card>
  );
}

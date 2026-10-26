import { useQuery } from '@tanstack/react-query';
import { Activity, CalendarDays, ClipboardCheck, FlaskConical, IndianRupee, Receipt, UserPlus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AUDIT_ICONS, describeMetadata, humanizeEntity } from '@/components/data-display/AuditEvent';
import { ColumnChart } from '@/components/data-display/ColumnChart';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/Tabs';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDateTime, formatINR, formatNumber } from '@/lib/formatters';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import { fetchProfileNames } from '@/services/clinic';
import { fetchBranchMetrics, fetchClinicOverview, fetchClinicTrends, listAuditEvents } from '@/services/reports';
import { periodLabels, rangeFor, type RangeKey } from './dashboardRanges';

function RecentActivity() {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const params = { page: 1, pageSize: 8 };
  const q = useQuery({ queryKey: [clinicId, 'audit', 'recent'], queryFn: () => listAuditEvents(clinicId, params), refetchInterval: 60_000 });
  const actorIds = [...new Set((q.data?.rows ?? []).map((r) => r.actor_id).filter((x): x is string => Boolean(x)))];
  const names = useQuery({ queryKey: ['profile-names', actorIds], queryFn: () => fetchProfileNames(actorIds), enabled: actorIds.length > 0 });
  return (
    <Card>
      <CardHeader
        title={t('dashboard.recentActivity')}
        actions={
          <Link to="/audit" className="text-sm font-medium text-forest hover:underline">
            {t('dashboard.viewAudit')}
          </Link>
        }
      />
      {q.isLoading ? (
        <SkeletonRows rows={4} />
      ) : q.isError ? (
        <ErrorState compact onRetry={() => void q.refetch()} />
      ) : q.data!.rows.length === 0 ? (
        <EmptyState compact icon={<Activity />} title={t('audit.emptyTitle')} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data!.rows.map((e) => {
            const Icon = AUDIT_ICONS[e.action];
            const detail = describeMetadata(e.metadata);
            return (
              <li key={e.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate">
                    <span className="font-medium">{e.actor_type === 'platform' ? t('audit.actorPlatform') : e.actor_id ? names.data?.get(e.actor_id) ?? '—' : t('audit.system')}</span>{' '}
                    <span className="text-ink-muted">
                      {t(`audit.${e.action}` as TranslationKey)} · {humanizeEntity(e.entity_type)}
                      {detail && ` · ${detail}`}
                    </span>
                  </p>
                  <p className="tabular text-xs text-ink-subtle">{formatDateTime(e.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function TrendCharts({ from, to, bucket }: { from: string; to: string; bucket: 'day' | 'week' | 'month' }) {
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const range = { from, to, bucket };
  const trends = useQuery({ queryKey: [clinicId, 'trends', range], queryFn: () => fetchClinicTrends(clinicId, from, to, bucket) });
  const series = (pick: (r: NonNullable<typeof trends.data>[number]) => number) =>
    (trends.data ?? []).map((r) => ({ key: r.period, ...periodLabels(r.period, bucket, t('dashboard.weekOf')), value: pick(r) }));
  return (
    <Card>
        <CardHeader title={t('dashboard.trends')} />
        <CardBody>
          {trends.isLoading ? (
            <SkeletonRows rows={4} className="p-0" />
          ) : trends.isError ? (
            <ErrorState compact onRetry={() => void trends.refetch()} />
          ) : (
            <div className="grid gap-8 md:grid-cols-2">
              <ColumnChart title={t('dashboard.newPatients')} data={series((r) => r.new_patients)} formatValue={formatNumber} />
              <ColumnChart title={t('reports.appointmentTrend')} data={series((r) => r.appointments)} formatValue={formatNumber} />
              <ColumnChart title={t('dashboard.consultationsCompleted')} data={series((r) => r.consultations_completed)} formatValue={formatNumber} />
              {can('billing.read') && (
                <ColumnChart title={t('reports.collected')} data={series((r) => r.collected_paise)} formatValue={(v) => formatINR(v, { whole: true })} formatTick={(v) => formatINR(v, { whole: true }).replace(/,\d{3}$/, 'K')} />
              )}
            </div>
          )}
        </CardBody>
      </Card>
  );
}

/** Per-branch comparison; hidden when the caller can see only one branch. */
export function BranchComparison({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const branches = useQuery({ queryKey: [clinicId, 'branch-metrics', { from, to }], queryFn: () => fetchBranchMetrics(clinicId, from, to) });
  return (
    <>
      {(branches.data ?? []).length > 1 && (
        <Card>
          <CardHeader title={t('dashboard.branchComparison')} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('dashboard.branchComparison')}</caption>
              <thead>
                <tr className="border-b border-line bg-ivory/60 text-xs uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">{t('settings.branchName')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('nav.appointments')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('dashboard.noShows')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('dashboard.consultationsCompleted')}</th>
                  {can('billing.read') && <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('reports.collected')}</th>}
                  {can('billing.read') && <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('dashboard.outstanding')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {branches.data!.map((b) => (
                  <tr key={b.branch_id}>
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">{b.branch_name}</th>
                    <td className="tabular px-4 py-2.5 text-right">{formatNumber(b.appointments)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatNumber(b.no_shows)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatNumber(b.consultations_completed)}</td>
                    {can('billing.read') && <td className="tabular px-4 py-2.5 text-right">{formatINR(b.collected_paise, { whole: true })}</td>}
                    {can('billing.read') && <td className="tabular px-4 py-2.5 text-right">{formatINR(b.outstanding_paise, { whole: true })}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * Clinic-wide figures for admins. All numbers come from SECURITY DEFINER
 * aggregate functions that return counts and sums only, scoped to the
 * caller's branches; admins never see consultation contents here.
 */
export function AdminOverview() {
  const { t } = useI18n();
  const { clinicId, clinic, can } = useClinic();
  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const range = rangeFor(rangeKey);
  const overview = useQuery({ queryKey: [clinicId, 'overview', range], queryFn: () => fetchClinicOverview(clinicId, range.from, range.to) });
  const o = overview.data;

  return (
    <section aria-labelledby="clinic-overview" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="clinic-overview" className="font-display text-lg font-semibold">
          {t('dashboard.clinicOverview')}
        </h2>
        <SegmentedControl
          label={t('dashboard.rangeLabel')}
          value={rangeKey}
          onChange={setRangeKey}
          options={[
            { value: '7', label: t('reports.last7') },
            { value: '30', label: t('reports.last30') },
            { value: '90', label: t('dashboard.range90') },
          ]}
        />
      </div>
      {clinic.settings.demo && (
        <Alert tone="warning" title={t('dashboard.demoData')}>
          {t('dashboard.demoDataBody')}
        </Alert>
      )}
      {overview.isError ? (
        <Card>
          <ErrorState compact onRetry={() => void overview.refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t('dashboard.totalPatients')} value={formatNumber(o?.patients_total ?? 0)} hint={t('dashboard.newInRange', { count: o?.patients_new ?? 0 })} icon={<UsersRound />} loading={overview.isLoading} />
          <StatCard label={t('dashboard.todayAppointments')} value={formatNumber(o?.appointments_today ?? 0)} hint={t('dashboard.noShowsInRange', { count: o?.appointments_no_show ?? 0 })} icon={<CalendarDays />} loading={overview.isLoading} />
          <StatCard
            label={t('dashboard.consultationsCompleted')}
            value={formatNumber(o?.consultations_completed ?? 0)}
            hint={t('dashboard.openConsultations', { count: o?.consultations_open ?? 0 })}
            icon={<ClipboardCheck />}
            accent="info"
            loading={overview.isLoading}
          />
          <StatCard
            label={t('dashboard.followUpsPending')}
            value={formatNumber(o?.follow_ups_pending ?? 0)}
            hint={t('dashboard.overdueCount', { count: o?.follow_ups_overdue ?? 0 })}
            icon={<FlaskConical />}
            accent="warning"
            loading={overview.isLoading}
          />
          {can('billing.read') && (
            <>
              <StatCard
                label={t('dashboard.netCollected')}
                value={formatINR((o?.collected_paise ?? 0) - (o?.refunded_paise ?? 0), { whole: true })}
                hint={o?.refunded_paise ? t('dashboard.refundedAmount', { amount: formatINR(o.refunded_paise, { whole: true }) }) : undefined}
                icon={<IndianRupee />}
                accent="gold"
                loading={overview.isLoading}
              />
              <StatCard label={t('dashboard.outstanding')} value={formatINR(o?.outstanding_paise ?? 0, { whole: true })} icon={<Receipt />} accent="warning" loading={overview.isLoading} />
              <StatCard label={t('dashboard.unreconciled')} value={formatNumber(o?.unreconciled_payments ?? 0)} icon={<Receipt />} accent="info" loading={overview.isLoading} />
              <StatCard label={t('dashboard.newPatients')} value={formatNumber(o?.patients_new ?? 0)} icon={<UserPlus />} loading={overview.isLoading} />
            </>
          )}
        </div>
      )}
      <p className="text-xs text-ink-muted">{t('dashboard.aggregateNote')}</p>

      <TrendCharts from={range.from} to={range.to} bucket={range.bucket} />
      <BranchComparison from={range.from} to={range.to} />

      {can('audit.read') && <RecentActivity />}
    </section>
  );
}

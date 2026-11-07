import { useQuery } from '@tanstack/react-query';
import { Activity, Building2, CalendarDays, ClipboardCheck, FlaskConical, IndianRupee, Receipt, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AUDIT_ICONS, describeMetadata, humanizeEntity } from '@/components/data-display/AuditEvent';
import { ColumnChart } from '@/components/data-display/ColumnChart';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/Tabs';
import { useAccess } from '@/features/access/AccessProvider';
import { formatDateTime, formatINR, formatNumber } from '@/lib/formatters';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import { fetchProfileNames } from '@/services/organization';
import { fetchBranchMetrics, fetchClinicTrends, fetchOverview } from '@/services/reports';
import { fetchStaffActivity } from '@/services/staff';
import { BranchFilter } from '@/components/ui/BranchFilter';
import { listAuditEvents } from '@/services/audit';
import { periodLabels, rangeFor, type RangeKey } from './dashboardRanges';

function RecentActivity() {
  const { t } = useI18n();
  const { branchFilter } = useAccess();
  const params = { page: 1, pageSize: 8, branchId: branchFilter };
  const q = useQuery({ queryKey: ['audit', 'recent', params], queryFn: () => listAuditEvents(params), refetchInterval: 60_000 });
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
                    <span className="font-medium">{e.actor_id ? names.data?.get(e.actor_id) ?? '—' : t('audit.system')}</span>{' '}
                    <span className="text-ink-muted">
                      {t(`audit.${e.action}` as TranslationKey)} · {humanizeEntity(e.entity_type)}
                      {detail && ` · ${detail}`}
                    </span>
                  </p>
                  <p className="tabular text-xs text-ink-muted">{formatDateTime(e.created_at)}</p>
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
  const { can, branchFilter } = useAccess();
  const range = { from, to, bucket, branchFilter };
  const trends = useQuery({ queryKey: ['trends', range], queryFn: () => fetchClinicTrends(branchFilter, from, to, bucket) });
  const series = (pick: (r: NonNullable<typeof trends.data>[number]) => number | null) =>
    (trends.data ?? []).map((r) => ({ key: r.period, ...periodLabels(r.period, bucket, t('dashboard.weekOf')), value: pick(r) ?? 0 }));
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
              {can('reports.financial') && (
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
  const { can } = useAccess();
  const branches = useQuery({ queryKey: ['branch-metrics', { from, to }], queryFn: () => fetchBranchMetrics(from, to) });
  return (
    <>
      {(branches.data ?? []).length > 1 && (
        <Card>
          <CardHeader title={t('dashboard.branchPerformance')} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('dashboard.branchPerformance')}</caption>
              <thead>
                <tr className="border-b border-line bg-ivory/60 text-xs uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">{t('branches.branch')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('dashboard.newPatients')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('nav.appointments')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('dashboard.noShows')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('dashboard.consultationsCompleted')}</th>
                  {can('reports.financial') && <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('reports.collected')}</th>}
                  {can('reports.financial') && <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('dashboard.outstanding')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {branches.data!.map((b) => (
                  <tr key={b.branch_id}>
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      {b.branch_name}
                      {!b.is_active && <span className="ml-2 text-xs font-normal text-ink-muted">{t('branches.inactive')}</span>}
                    </th>
                    <td className="tabular px-4 py-2.5 text-right">{formatNumber(b.patients_registered)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatNumber(b.appointments)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatNumber(b.no_shows)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatNumber(b.consultations_completed)}</td>
                    {can('reports.financial') && <td className="tabular px-4 py-2.5 text-right">{formatINR(b.collected_paise, { whole: true })}</td>}
                    {can('reports.financial') && <td className="tabular px-4 py-2.5 text-right">{formatINR(b.outstanding_paise, { whole: true })}</td>}
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

function StaffActivityCard({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['staff-activity', { from, to }], queryFn: () => fetchStaffActivity(from, to) });
  const rows = (q.data ?? []).filter((r) => r.status !== 'inactive').slice(0, 8);
  return (
    <Card>
      <CardHeader
        title={t('dashboard.staffActivity')}
        description={t('dashboard.staffActivityHint')}
        actions={
          <Link to="/staff" className="text-sm font-medium text-forest hover:underline">
            {t('common.view')}
          </Link>
        }
      />
      {q.isLoading ? (
        <SkeletonRows rows={4} />
      ) : q.isError ? (
        <ErrorState compact onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={<UsersRound />} title={t('staff.emptyTitle')} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.staff_id}>
              <Link to={`/staff/${r.staff_id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-ivory">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.full_name}</span>
                  <span className="block text-xs text-ink-muted">{t(`designation.${r.designation}`)}</span>
                </span>
                <span className="text-right">
                  <span className="tabular block">{t('dashboard.actionsCount', { count: r.event_count })}</span>
                  <span className="tabular block text-xs text-ink-muted">{r.last_activity_at ? formatDateTime(r.last_activity_at) : t('staff.noActivity')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Clinic-wide figures for admins. All numbers come from SECURITY DEFINER
 * aggregate functions that return counts and sums only, scoped to the
 * caller's branches; admins never see consultation contents here.
 */
export function AdminOverview() {
  const { t } = useI18n();
  const { settings, can, branchFilter } = useAccess();
  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const range = rangeFor(rangeKey);
  const overview = useQuery({ queryKey: ['overview', range, branchFilter], queryFn: () => fetchOverview(branchFilter, range.from, range.to) });
  const o = overview.data;

  return (
    <section aria-labelledby="clinic-overview" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="clinic-overview" className="font-display text-lg font-semibold">
          {t('dashboard.clinicOverview')}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
        <BranchFilter />
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
      </div>
      {settings.preferences.demo && (
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
          <StatCard label={t('dashboard.activeBranches')} value={formatNumber(o?.branches_active ?? 0)} icon={<Building2 />} loading={overview.isLoading} />
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
          {can('reports.financial') && (
            <>
              <StatCard
                label={t('dashboard.netCollected')}
                value={formatINR((o?.collected_paise ?? 0) - (o?.refunded_paise ?? 0), { whole: true })}
                hint={o?.refunded_paise ? t('dashboard.refundedAmount', { amount: formatINR(o.refunded_paise, { whole: true }) }) : undefined}
                icon={<IndianRupee />}
                accent="gold"
                loading={overview.isLoading}
              />
              <StatCard
                label={t('dashboard.outstanding')}
                value={formatINR(o?.outstanding_paise ?? 0, { whole: true })}
                hint={t('dashboard.outstandingInvoices', { count: o?.outstanding_invoices ?? 0 })}
                icon={<Receipt />}
                accent="warning"
                loading={overview.isLoading}
              />
              <StatCard label={t('dashboard.unreconciled')} value={formatNumber(o?.unreconciled_payments ?? 0)} icon={<Receipt />} accent="info" loading={overview.isLoading} />
            </>
          )}
        </div>
      )}
      <p className="text-xs text-ink-muted">{t('dashboard.aggregateNote')}</p>

      <TrendCharts from={range.from} to={range.to} bucket={range.bucket} />
      {!branchFilter && <BranchComparison from={range.from} to={range.to} />}

      <div className="grid gap-6 xl:grid-cols-2">
        {can('staff.view') && <StaffActivityCard from={range.from} to={range.to} />}
        {can('audit.view') && <RecentActivity />}
      </div>
    </section>
  );
}

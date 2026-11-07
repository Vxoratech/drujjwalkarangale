import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { DateInput } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/Tabs';
import { useAccess } from '@/features/access/AccessProvider';
import { addDaysISO, formatDate, formatINR, formatNumber, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { fetchAppointmentStatusReport, fetchClinicalReport, fetchPaymentMethodReport, fetchRevenueReport } from '@/services/reports';
import { BranchFilter } from '@/components/ui/BranchFilter';
import { BranchComparison, TrendCharts } from '@/features/dashboard/AdminOverview';

type Preset = 'last7' | 'last30' | 'thisMonth';

function presetRange(p: Preset): { from: string; to: string } {
  const today = todayISO();
  if (p === 'last7') return { from: addDaysISO(today, -6), to: today };
  if (p === 'last30') return { from: addDaysISO(today, -29), to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

function bucketFor(from: string, to: string): 'day' | 'week' | 'month' {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return days > 120 ? 'month' : days > 31 ? 'week' : 'day';
}

/** Horizontal bar used for small, accessible charts (values are also shown as text). */
function Bar({ value, max, tone = 'forest' }: { value: number; max: number; tone?: 'forest' | 'gold' }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <span aria-hidden className="block h-2 w-full overflow-hidden rounded-full bg-sage">
      <span className={tone === 'gold' ? 'block h-full rounded-full bg-gold-ink' : 'block h-full rounded-full bg-forest'} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function ReportsPage() {
  const { t } = useI18n();
  const { can, branchFilter: branch } = useAccess();
  const [preset, setPreset] = useState<Preset | 'custom'>('last30');
  const [range, setRange] = useState(presetRange('last30'));
  // Each section appears only with its report permission (the server checks the same).
  const financial = can('reports.financial');
  const operational = can('reports.operational');
  const clinical = can('reports.clinical');
  const key = { ...range, branch };

  const revenue = useQuery({ queryKey: qk.reports({ kind: 'revenue', ...key }), queryFn: () => fetchRevenueReport(branch, range.from, range.to), enabled: financial });
  const methods = useQuery({ queryKey: qk.reports({ kind: 'methods', ...key }), queryFn: () => fetchPaymentMethodReport(branch, range.from, range.to), enabled: financial });
  const statuses = useQuery({ queryKey: qk.reports({ kind: 'statuses', ...key }), queryFn: () => fetchAppointmentStatusReport(branch, range.from, range.to), enabled: operational });
  const clinicalReport = useQuery({ queryKey: qk.reports({ kind: 'clinical', ...key }), queryFn: () => fetchClinicalReport(branch, range.from, range.to), enabled: clinical });

  const rows = revenue.data ?? [];
  const totalInvoiced = rows.reduce((s, r) => s + r.invoiced_paise, 0);
  const totalCollected = rows.reduce((s, r) => s + r.collected_paise - r.refunded_paise, 0);
  const invoiceCount = rows.reduce((s, r) => s + r.invoice_count, 0);
  const maxDay = Math.max(0, ...rows.map((r) => Math.max(r.invoiced_paise, r.collected_paise)));
  const activeDays = rows.filter((r) => r.invoiced_paise > 0 || r.collected_paise > 0 || r.refunded_paise > 0);
  const maxMethod = Math.max(0, ...(methods.data ?? []).map((m) => m.total_paise));
  const maxStatus = Math.max(0, ...(statuses.data ?? []).map((s) => s.appointment_count));

  return (
    <>
      <PageHeader title={t('reports.title')} description={t('reports.subtitle')} />
      <Card className="mb-6">
        <Toolbar className="border-b-0">
          <SegmentedControl
            label={t('reports.title')}
            value={preset === 'custom' ? ('' as Preset) : preset}
            onChange={(p) => {
              setPreset(p);
              setRange(presetRange(p));
            }}
            options={[
              { value: 'last7', label: t('reports.last7') },
              { value: 'last30', label: t('reports.last30') },
              { value: 'thisMonth', label: t('reports.thisMonth') },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <BranchFilter />
            <DateInput aria-label={t('reports.from')} value={range.from} max={range.to} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value || r.from })); }} className="w-auto" />
            <span className="text-ink-muted">–</span>
            <DateInput aria-label={t('reports.to')} value={range.to} min={range.from} max={todayISO()} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value || r.to })); }} className="w-auto" />
          </div>
        </Toolbar>
      </Card>

      {clinical && (
        <Card className="mb-6">
          <CardHeader title={t('reports.clinicalActivity')} description={t('reports.clinicalHint')} />
          {clinicalReport.isLoading ? (
            <SkeletonRows rows={2} />
          ) : clinicalReport.isError ? (
            <ErrorState compact onRetry={() => void clinicalReport.refetch()} />
          ) : (
            <CardBody>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {(
                  [
                    ['dashboard.consultationsCompleted', clinicalReport.data!.consultations_finalized],
                    ['dashboard.newPatientsSeen', clinicalReport.data!.new_patients_seen],
                    ['dashboard.prescriptionsIssued', clinicalReport.data!.prescriptions_issued],
                    ['reports.prescriptionsRevised', clinicalReport.data!.prescriptions_revised],
                    ['reports.investigationsOrdered', clinicalReport.data!.investigations_ordered],
                    ['dashboard.investigationsResulted', clinicalReport.data!.investigations_resulted],
                    ['reports.followUpsCreated', clinicalReport.data!.follow_ups_created],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-ink-muted">{t(label)}</dt>
                    <dd className="tabular text-lg font-semibold">{formatNumber(value)}</dd>
                  </div>
                ))}
              </dl>
              {clinicalReport.data!.by_branch.length > 1 && (
                <ul className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
                  {clinicalReport.data!.by_branch.map((b) => (
                    <li key={b.branch_id} className="flex justify-between">
                      <span>{b.branch_name}</span>
                      <span className="tabular font-medium">{t('reports.consultationsCount', { count: b.consultations })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          )}
        </Card>
      )}

      {financial && (
        <section aria-label={t('reports.totals')} className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label={t('reports.invoiced')} value={formatINR(totalInvoiced, { whole: true })} loading={revenue.isLoading} />
          <StatCard label={t('reports.collected')} value={formatINR(totalCollected, { whole: true })} accent="gold" loading={revenue.isLoading} />
          <StatCard label={t('reports.invoices')} value={formatNumber(invoiceCount)} accent="info" loading={revenue.isLoading} />
        </section>
      )}

      {(operational || financial) && (
        <div className="mb-6 space-y-6">
          <TrendCharts from={range.from} to={range.to} bucket={bucketFor(range.from, range.to)} />
          {!branch && <BranchComparison from={range.from} to={range.to} />}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {financial && (
        <Card className="lg:col-span-2">
          <CardHeader title={t('reports.daily')} description={`${formatDate(range.from)} – ${formatDate(range.to)}`} />
          {revenue.isLoading ? (
            <SkeletonRows rows={6} />
          ) : revenue.isError ? (
            <ErrorState compact message={undefined} onRetry={() => void revenue.refetch()} />
          ) : activeDays.length === 0 ? (
            <EmptyState compact icon={<LineChart />} title={t('reports.noData')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('reports.daily')}</caption>
                <thead>
                  <tr className="border-b border-line bg-ivory/60 text-xs uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">{t('billing.date')}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('reports.invoiced')}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('reports.collected')}</th>
                    <th scope="col" className="hidden w-1/3 px-4 py-2.5 md:table-cell"><span className="sr-only">Chart</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {activeDays.map((r) => (
                    <tr key={r.day}>
                      <td className="tabular px-4 py-2.5">{formatDate(r.day)}</td>
                      <td className="tabular px-4 py-2.5 text-right">{formatINR(r.invoiced_paise)}</td>
                      <td className="tabular px-4 py-2.5 text-right">
                        {formatINR(r.collected_paise - r.refunded_paise)}
                        {r.refunded_paise > 0 && <span className="block text-xs text-danger">−{formatINR(r.refunded_paise)}</span>}
                      </td>
                      <td className="hidden space-y-1 px-4 py-2.5 md:table-cell">
                        <Bar value={r.invoiced_paise} max={maxDay} />
                        <Bar value={r.collected_paise} max={maxDay} tone="gold" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        )}
        <div className="space-y-6">
          {financial && (
          <Card>
            <CardHeader title={t('reports.byMethod')} />
            <CardBody>
              {methods.isLoading ? (
                <SkeletonRows rows={3} className="p-0" />
              ) : (methods.data ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">{t('reports.noData')}</p>
              ) : (
                <ul className="space-y-3">
                  {methods.data!.map((m) => (
                    <li key={m.method} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{t(`paymentMethod.${m.method}`)}</span>
                        <span className="tabular font-medium">{formatINR(m.total_paise, { whole: true })}</span>
                      </div>
                      <Bar value={m.total_paise} max={maxMethod} tone="gold" />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          )}
          {operational && (
          <Card>
            <CardHeader title={t('reports.byStatus')} />
            <CardBody>
              {statuses.isLoading ? (
                <SkeletonRows rows={3} className="p-0" />
              ) : (statuses.data ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">{t('reports.noData')}</p>
              ) : (
                <ul className="space-y-3">
                  {statuses.data!.map((s) => (
                    <li key={s.status} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{t(`appointmentStatus.${s.status}`)}</span>
                        <span className="tabular font-medium">{formatNumber(s.appointment_count)}</span>
                      </div>
                      <Bar value={s.appointment_count} max={maxStatus} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          )}
        </div>
      </div>
    </>
  );
}

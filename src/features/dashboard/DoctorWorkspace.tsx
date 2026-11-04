import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, CalendarDays, CheckCircle2, Clock, FilePen, FlaskConical, History, Pill, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { StatusBadge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { useAccess } from '@/features/access/AccessProvider';
import { AppointmentActions } from '@/features/appointments/AppointmentActions';
import { formatDate, formatDateTime, formatNumber, formatTime, fullName, istDayRange, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listAppointments } from '@/services/appointments';
import { listConsultations } from '@/services/clinical';
import { fetchClinicalReport, fetchDoctorOverview, fetchRecentPatients } from '@/services/reports';
import type { AppointmentStatus } from '@/types/domain';

const QUEUE_ORDER: Record<AppointmentStatus, number> = { in_consultation: 0, checked_in: 1, scheduled: 2, completed: 3, no_show: 4, cancelled: 5 };

/** Clinical-first workspace for Dr. Ujjwal: next patient, today's queue across branches, drafts and activity. */
export function DoctorWorkspace() {
  const { t } = useI18n();
  const { branches, branchFilter, branchName } = useAccess();
  const showBranch = branches.length > 1 && !branchFilter;
  const today = todayISO();
  const monthStart = `${today.slice(0, 8)}01`;
  const range = istDayRange(today);
  const overview = useQuery({ queryKey: ['doctor-overview'], queryFn: () => fetchDoctorOverview(), refetchInterval: 60_000 });
  const queue = useQuery({
    queryKey: qk.appointments({ day: today, branchId: branchFilter }),
    queryFn: () => listAppointments({ from: range.from, to: range.to, branchId: branchFilter }),
    refetchInterval: 60_000,
  });
  const drafts = useQuery({ queryKey: qk.consultations({ status: 'draft', limit: 5 }), queryFn: () => listConsultations({ status: 'draft', limit: 5 }) });
  const activity = useQuery({ queryKey: ['clinical-report', monthStart, today], queryFn: () => fetchClinicalReport(null, monthStart, today) });
  const recent = useQuery({ queryKey: ['recent-patients'], queryFn: () => fetchRecentPatients() });
  const o = overview.data;
  const rows = [...(queue.data ?? [])].sort((a, b) => QUEUE_ORDER[a.status] - QUEUE_ORDER[b.status] || a.starts_at.localeCompare(b.starts_at));

  return (
    <section aria-labelledby="my-workspace" className="space-y-6">
      <h2 id="my-workspace" className="font-display text-lg font-semibold">
        {t('dashboard.myWorkspace')}
      </h2>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard label={t('dashboard.todayAcrossBranches')} value={formatNumber(o?.appointments_today ?? 0)} hint={t('dashboard.waitingCount', { count: o?.waiting ?? 0 })} icon={<CalendarDays />} loading={overview.isLoading} />
        <StatCard label={t('dashboard.inProgress')} value={formatNumber(o?.in_progress ?? 0)} icon={<FilePen />} accent="warning" loading={overview.isLoading} />
        <StatCard label={t('dashboard.pendingPrescriptions')} value={formatNumber(o?.pending_prescriptions ?? 0)} icon={<Pill />} accent="info" loading={overview.isLoading} />
        <StatCard label={t('dashboard.followUps')} value={formatNumber(o?.follow_ups_due ?? 0)} icon={<Clock />} accent="gold" loading={overview.isLoading} />
        <StatCard label={t('dashboard.completedToday')} value={formatNumber(o?.completed_today ?? 0)} hint={t('dashboard.completedMonth', { count: o?.completed_this_month ?? 0 })} icon={<CheckCircle2 />} accent="info" loading={overview.isLoading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t('dashboard.nextPatient')} />
          <CardBody>
            {overview.isLoading ? (
              <SkeletonRows rows={2} className="p-0" />
            ) : !o?.next_patient ? (
              <p className="text-sm text-ink-muted">{t('dashboard.noNextPatient')}</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <PatientIdentity size="md" name={fullName(o.next_patient)} code={o.next_patient.patient_code} meta={[formatTime(o.next_patient.starts_at), o.next_patient.branch_name, o.next_patient.reason].filter(Boolean).join(' · ')} />
                  <div className="mt-2">
                    <StatusBadge status={o.next_patient.status} label={t(`appointmentStatus.${o.next_patient.status}`)} />
                  </div>
                </div>
                <Link to={`/consultations/new?patient=${o.next_patient.patient_id}&appointment=${o.next_patient.appointment_id}`} className={buttonClasses('primary')}>
                  {t('dashboard.startConsultation')} <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('dashboard.branchSchedule')} />
          {(o?.branch_schedule ?? []).length === 0 ? (
            <EmptyState compact icon={<Building2 />} title={t('dashboard.noAppointmentsToday')} />
          ) : (
            <ul className="divide-y divide-line">
              {o!.branch_schedule.map((b) => (
                <li key={b.branch_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="font-medium">{b.branch_name}</span>
                  <span className="tabular text-ink-muted">
                    {b.appointments === 0 ? t('dashboard.noVisits') : t('dashboard.branchVisits', { count: b.appointments, remaining: b.remaining, time: b.first_at ? formatTime(b.first_at) : '—' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t('dashboard.queue')} description={t('dashboard.queueHint')} />
          {queue.isLoading ? (
            <SkeletonRows rows={4} />
          ) : queue.isError ? (
            <ErrorState compact onRetry={() => void queue.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState compact icon={<Stethoscope />} title={t('dashboard.noAppointmentsToday')} />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:flex-nowrap">
                  <span className="tabular w-16 shrink-0 text-sm font-medium">{formatTime(a.starts_at)}</span>
                  <Link to={`/patients/${a.patient_id}`} className="min-w-0 flex-1 rounded hover:underline">
                    <PatientIdentity name={fullName(a.patient)} code={a.patient?.patient_code} meta={[t(`appointmentType.${a.type}`), showBranch ? branchName(a.branch_id) : null, a.reason].filter(Boolean).join(' · ')} />
                  </Link>
                  <StatusBadge status={a.status} label={t(`appointmentStatus.${a.status}`)} />
                  <AppointmentActions appointment={a} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader
              title={t('consultations.myDrafts')}
              actions={
                <Link to="/consultations" className="text-sm font-medium text-forest hover:underline">
                  {t('common.view')}
                </Link>
              }
            />
            {drafts.isLoading ? (
              <SkeletonRows rows={2} />
            ) : (drafts.data ?? []).length === 0 ? (
              <EmptyState compact icon={<FilePen />} title={t('states.emptyTitle')} />
            ) : (
              <ul className="divide-y divide-line">
                {drafts.data!.map((c) => (
                  <li key={c.id}>
                    <Link to={`/consultations/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-ivory">
                      <PatientIdentity name={fullName(c.patient)} code={c.patient?.patient_code} meta={c.chief_complaint} />
                      <span className="tabular text-xs text-ink-muted">{formatDate(c.visit_date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t('dashboard.recentPatients')} description={t('dashboard.recentPrivacy')} />
            {recent.isLoading ? (
              <SkeletonRows rows={3} />
            ) : (recent.data ?? []).length === 0 ? (
              <EmptyState compact icon={<History />} title={t('dashboard.noRecentPatients')} />
            ) : (
              <ul className="divide-y divide-line">
                {recent.data!.map((p) => (
                  <li key={p.patient_id}>
                    <Link to={`/patients/${p.patient_id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-ivory">
                      <PatientIdentity name={fullName(p)} code={p.patient_code} />
                      <span className="tabular text-xs text-ink-muted">{formatDateTime(p.last_viewed_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t('dashboard.clinicalActivity')} description={t('dashboard.thisMonth')} />
            {activity.isLoading ? (
              <SkeletonRows rows={3} />
            ) : activity.isError ? (
              <ErrorState compact onRetry={() => void activity.refetch()} />
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-sm">
                {(
                  [
                    ['dashboard.consultationsCompleted', activity.data!.consultations_finalized, Stethoscope],
                    ['dashboard.newPatientsSeen', activity.data!.new_patients_seen, History],
                    ['dashboard.prescriptionsIssued', activity.data!.prescriptions_issued, Pill],
                    ['dashboard.investigationsResulted', activity.data!.investigations_resulted, FlaskConical],
                  ] as const
                ).map(([label, value, Icon]) => (
                  <div key={label} className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-forest" aria-hidden />
                    <div>
                      <dt className="text-xs text-ink-muted">{t(label)}</dt>
                      <dd className="tabular font-medium">{formatNumber(value)}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}

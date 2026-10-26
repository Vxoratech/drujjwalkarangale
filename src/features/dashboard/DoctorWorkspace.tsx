import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Clock, FilePen, History, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { AppointmentActions } from '@/features/appointments/AppointmentActions';
import { formatDate, formatDateTime, formatNumber, formatTime, fullName, istDayRange, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listAppointments } from '@/services/appointments';
import { listConsultations } from '@/services/clinical';
import { fetchDoctorOverview, fetchRecentPatients } from '@/services/reports';
import type { AppointmentStatus } from '@/types/domain';

const QUEUE_ORDER: Record<AppointmentStatus, number> = { in_consultation: 0, checked_in: 1, scheduled: 2, completed: 3, no_show: 4, cancelled: 5 };

/** Clinical-first workspace for doctors: queue, drafts, recent patients. */
export function DoctorWorkspace() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId } = useClinic();
  const today = todayISO();
  const range = istDayRange(today);
  const overview = useQuery({ queryKey: [clinicId, 'doctor-overview'], queryFn: () => fetchDoctorOverview(clinicId), refetchInterval: 60_000 });
  const queue = useQuery({
    queryKey: qk.appointments(clinicId, { day: today, doctorId: user.id }),
    queryFn: () => listAppointments(clinicId, { from: range.from, to: range.to, doctorId: user.id }),
    refetchInterval: 60_000,
  });
  const drafts = useQuery({ queryKey: qk.consultations(clinicId, { doctorId: user.id, status: 'draft' }), queryFn: () => listConsultations(clinicId, { doctorId: user.id, status: 'draft', limit: 5 }) });
  const recent = useQuery({ queryKey: [clinicId, 'recent-patients'], queryFn: () => fetchRecentPatients(clinicId) });
  const o = overview.data;
  const rows = [...(queue.data ?? [])].sort((a, b) => QUEUE_ORDER[a.status] - QUEUE_ORDER[b.status] || a.starts_at.localeCompare(b.starts_at));

  return (
    <section aria-labelledby="my-workspace" className="space-y-6">
      <h2 id="my-workspace" className="font-display text-lg font-semibold">
        {t('dashboard.myWorkspace')}
      </h2>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t('dashboard.todayAppointments')} value={formatNumber(o?.appointments_today ?? 0)} hint={t('dashboard.waitingCount', { count: o?.waiting ?? 0 })} icon={<CalendarDays />} loading={overview.isLoading} />
        <StatCard label={t('dashboard.inProgress')} value={formatNumber(o?.in_progress ?? 0)} icon={<FilePen />} accent="warning" loading={overview.isLoading} />
        <StatCard label={t('dashboard.completedToday')} value={formatNumber(o?.completed_today ?? 0)} hint={t('dashboard.completedMonth', { count: o?.completed_this_month ?? 0 })} icon={<CheckCircle2 />} accent="info" loading={overview.isLoading} />
        <StatCard label={t('dashboard.followUps')} value={formatNumber(o?.follow_ups_due ?? 0)} icon={<Clock />} accent="gold" loading={overview.isLoading} />
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
                    <PatientIdentity name={fullName(a.patient)} code={a.patient?.patient_code} meta={[t(`appointmentType.${a.type}`), a.reason].filter(Boolean).join(' · ')} />
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
        </div>
      </div>
    </section>
  );
}

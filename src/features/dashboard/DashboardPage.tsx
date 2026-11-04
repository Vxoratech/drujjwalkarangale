import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Plus, UserPlus, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { StatusBadge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { FollowUpsCard } from '@/features/follow-ups/FollowUpsCard';
import { formatLongDate, formatNumber, formatTime, fullName, getDisplayTimeZone, istDayRange, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listAppointments } from '@/services/appointments';
import { fetchOverview } from '@/services/reports';
import { AdminOverview } from './AdminOverview';
import { DoctorWorkspace } from './DoctorWorkspace';

function greetingKey(): 'dashboard.greetingMorning' | 'dashboard.greetingAfternoon' | 'dashboard.greetingEvening' {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: getDisplayTimeZone(), hour: 'numeric', hour12: false }).format(new Date()));
  if (hour < 12) return 'dashboard.greetingMorning';
  if (hour < 17) return 'dashboard.greetingAfternoon';
  return 'dashboard.greetingEvening';
}

/** Today's schedule at the user's branches (or the filtered branch). */
function ClinicSchedule() {
  const { t } = useI18n();
  const { branches, branchFilter, branchName } = useAccess();
  const showBranch = branches.length > 1 && !branchFilter;
  const today = todayISO();
  const range = istDayRange(today);
  const schedule = useQuery({ queryKey: qk.appointments({ day: today, branchId: branchFilter }), queryFn: () => listAppointments({ from: range.from, to: range.to, branchId: branchFilter }) });
  return (
    <Card>
      <CardHeader
        title={t('dashboard.schedule')}
        actions={
          <Link to="/appointments" className="text-sm font-medium text-forest hover:underline">
            {t('dashboard.viewSchedule')}
          </Link>
        }
      />
      {schedule.isLoading ? (
        <SkeletonRows rows={4} />
      ) : schedule.isError ? (
        <ErrorState compact onRetry={() => void schedule.refetch()} />
      ) : schedule.data!.length === 0 ? (
        <EmptyState compact icon={<CalendarDays />} title={t('dashboard.noAppointmentsToday')} />
      ) : (
        <ul className="divide-y divide-line">
          {schedule.data!.map((a) => (
            <li key={a.id}>
              <Link to={`/appointments/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-ivory sm:flex-nowrap">
                <span className="tabular w-20 shrink-0 text-sm font-medium text-ink">{formatTime(a.starts_at)}</span>
                <PatientIdentity className="min-w-0 flex-1" name={fullName(a.patient)} code={a.patient?.patient_code} meta={[t(`appointmentType.${a.type}`), showBranch ? branchName(a.branch_id) : null].filter(Boolean).join(' · ')} />
                <StatusBadge status={a.status} label={t(`appointmentStatus.${a.status}`)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Front-desk summary for staff with operational reports only (branch-scoped server-side). */
function BasicSummary() {
  const { t } = useI18n();
  const { branchFilter } = useAccess();
  const today = todayISO();
  const summary = useQuery({ queryKey: qk.dashboard({ branchFilter }), queryFn: () => fetchOverview(branchFilter, today, today) });
  const s = summary.data;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={t('dashboard.todayAppointments')} value={formatNumber(s?.appointments_today ?? 0)} hint={t('dashboard.remaining', { count: s?.appointments_remaining_today ?? 0 })} icon={<CalendarDays />} loading={summary.isLoading} />
      <StatCard label={t('dashboard.totalPatients')} value={formatNumber(s?.patients_total ?? 0)} icon={<UsersRound />} loading={summary.isLoading} />
      <StatCard label={t('dashboard.followUpsPending')} value={formatNumber(s?.follow_ups_pending ?? 0)} hint={t('dashboard.overdueCount', { count: s?.follow_ups_overdue ?? 0 })} icon={<CalendarDays />} accent="gold" loading={summary.isLoading} />
    </div>
  );
}

export function DashboardPage() {
  const { t } = useI18n();
  const { can, account, fullName: name } = useAccess();
  const firstName = name.split(' ').slice(0, 2).join(' ');
  const isDoctor = account === 'primary_doctor';
  // Admins and staff with financial or branch reports get the full overview.
  const isManager = !isDoctor && (account === 'admin' || can('reports.financial'));

  return (
    <>
      <PageHeader
        title={`${t(greetingKey())}${firstName ? `, ${firstName}` : ''}`}
        description={formatLongDate(todayISO())}
        actions={
          <>
            {can('patients.create') && (
              <Link to="/patients?new=1" className={buttonClasses('secondary')}>
                <UserPlus className="size-4" aria-hidden /> {t('patients.add')}
              </Link>
            )}
            {can('appointments.create') && (
              <Link to="/appointments?book=1" className={buttonClasses('primary')}>
                <Plus className="size-4" aria-hidden /> {t('appointments.book')}
              </Link>
            )}
          </>
        }
      />
      <div className="space-y-10">
        {isDoctor ? (
          <>
            <DoctorWorkspace />
            <FollowUpsCard />
          </>
        ) : (
          <>
            {isManager ? <AdminOverview /> : can('reports.operational') && <BasicSummary />}
            {(can('appointments.view') || can('follow_ups.view')) && (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                {can('appointments.view') && <ClinicSchedule />}
                {can('follow_ups.view') && <FollowUpsCard />}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

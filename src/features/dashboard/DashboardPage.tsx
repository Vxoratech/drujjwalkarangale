import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CalendarDays, FilePen, FlaskConical, IndianRupee, Plus, Receipt, Stethoscope, UserPlus, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDoctors } from '@/hooks/useDoctors';
import { formatINR, formatLongDate, formatNumber, formatTime, fullName, istDayRange, todayISO } from '@/lib/formatters';
import { CAN_VIEW_SCHEDULE } from '@/lib/permissions/permissions';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listAppointments } from '@/services/appointments';
import { fetchDashboardSummary } from '@/services/reports';

function greetingKey(): 'dashboard.greetingMorning' | 'dashboard.greetingAfternoon' | 'dashboard.greetingEvening' {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  if (hour < 12) return 'dashboard.greetingMorning';
  if (hour < 17) return 'dashboard.greetingAfternoon';
  return 'dashboard.greetingEvening';
}

export function DashboardPage() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can, isDoctor } = useClinic();
  const { names } = useDoctors();
  const today = todayISO();
  const range = istDayRange(today);

  const summary = useQuery({ queryKey: qk.dashboard(clinicId), queryFn: () => fetchDashboardSummary(clinicId) });
  const schedule = useQuery({
    queryKey: qk.appointments(clinicId, { day: today }),
    queryFn: () => listAppointments(clinicId, { from: range.from, to: range.to }),
    enabled: can(CAN_VIEW_SCHEDULE),
  });

  const s = summary.data;
  const firstName = ((user.user_metadata.full_name as string | undefined) ?? '').split(' ').slice(0, 2).join(' ');
  const showFinance = can('billing.read');
  const showClinical = can('clinical.write');

  return (
    <>
      <PageHeader
        title={`${t(greetingKey())}${firstName ? `, ${firstName}` : ''}`}
        description={formatLongDate(today)}
        actions={
          <>
            {can('patients.create') && (
              <Link to="/patients?new=1" className={buttonClasses('secondary')}>
                <UserPlus className="size-4" aria-hidden /> {t('patients.add')}
              </Link>
            )}
            {can('appointments.manage') && (
              <Link to="/appointments?book=1" className={buttonClasses('primary')}>
                <Plus className="size-4" aria-hidden /> {t('appointments.book')}
              </Link>
            )}
          </>
        }
      />

      {summary.isError ? (
        <Card className="mb-6">
          <ErrorState compact onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <section aria-label="Summary" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t('dashboard.todayAppointments')}
            value={formatNumber(s?.appointments_today ?? 0)}
            hint={t('dashboard.remaining', { count: s?.appointments_remaining_today ?? 0 })}
            icon={<CalendarDays />}
            loading={summary.isLoading}
          />
          {can('patients.read_all') || can('patients.read_assigned') ? (
            <StatCard
              label={t('dashboard.totalPatients')}
              value={formatNumber(s?.patients_total ?? 0)}
              hint={t('dashboard.newThisMonth', { count: s?.patients_new_this_month ?? 0 })}
              icon={<UsersRound />}
              loading={summary.isLoading}
            />
          ) : null}
          {showFinance && (
            <>
              <StatCard label={t('dashboard.collectedThisMonth')} value={formatINR(s?.collected_this_month_paise, { whole: true })} icon={<IndianRupee />} accent="gold" loading={summary.isLoading} />
              <StatCard label={t('dashboard.outstanding')} value={formatINR(s?.outstanding_paise, { whole: true })} icon={<Receipt />} accent="warning" loading={summary.isLoading} />
            </>
          )}
          {showClinical && (
            <>
              <StatCard label={t('dashboard.draftConsultations')} value={formatNumber(s?.draft_consultations ?? 0)} icon={<FilePen />} accent="warning" loading={summary.isLoading} />
              {!showFinance && <StatCard label={t('dashboard.followUps')} value={formatNumber(s?.follow_ups_next_7_days ?? 0)} icon={<CalendarCheck />} accent="info" loading={summary.isLoading} />}
            </>
          )}
          {showClinical && !showFinance && (
            <StatCard label={t('dashboard.pendingInvestigations')} value={formatNumber(s?.pending_investigations ?? 0)} icon={<FlaskConical />} accent="gold" loading={summary.isLoading} />
          )}
        </section>
      )}

      {can(CAN_VIEW_SCHEDULE) && (
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
                    <PatientIdentity
                      className="min-w-0 flex-1"
                      name={fullName(a.patient)}
                      code={a.patient?.patient_code}
                      meta={`${t(`appointmentType.${a.type}`)}${!isDoctor || can('appointments.read_all') ? ` · ${names.get(a.doctor_id) ?? ''}` : ''}`}
                    />
                    <StatusBadge status={a.status} label={t(`appointmentStatus.${a.status}`)} />
                    {showClinical && a.doctor_id === user.id && ['scheduled', 'checked_in', 'in_consultation'].includes(a.status) && (
                      <span className="hidden items-center gap-1 text-sm font-medium text-forest sm:inline-flex">
                        <Stethoscope className="size-4" aria-hidden />
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

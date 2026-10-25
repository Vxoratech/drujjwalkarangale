import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput, Select } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDoctors } from '@/hooks/useDoctors';
import { addDaysISO, formatLongDate, formatTime, fullName, istDayRange, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listAppointments } from '@/services/appointments';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '@/types/domain';
import { AppointmentActions } from './AppointmentActions';
import { AppointmentFormModal } from './AppointmentFormModal';

export function AppointmentsPage() {
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const { doctors, names } = useDoctors();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayISO();
  const doctorId = params.get('doctor') ?? '';
  const status = (params.get('status') ?? '') as AppointmentStatus | '';
  const [bookOpen, setBookOpen] = useState(params.get('book') === '1');
  const showAllDoctors = can('appointments.read_all');

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('book');
    next.delete('patient');
    setParams(next, { replace: true });
  }

  const range = istDayRange(date);
  const listParams = { from: range.from, to: range.to, doctorId: doctorId || undefined, statuses: status ? [status] : undefined };
  const query = useQuery({ queryKey: qk.appointments(clinicId, listParams), queryFn: () => listAppointments(clinicId, listParams) });

  return (
    <>
      <PageHeader
        title={t('appointments.title')}
        description={t('appointments.subtitle')}
        actions={
          can('appointments.manage') && (
            <Button leftIcon={<Plus className="size-4" />} onClick={() => setBookOpen(true)}>
              {t('appointments.book')}
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <div className="flex items-center gap-1">
            <IconButton label={t('appointments.previousDay')} icon={<ChevronLeft />} onClick={() => update('date', addDaysISO(date, -1))} />
            <DateInput aria-label={t('appointments.date')} value={date} onChange={(e) => update('date', e.target.value)} className="w-auto" />
            <IconButton label={t('appointments.nextDay')} icon={<ChevronRight />} onClick={() => update('date', addDaysISO(date, 1))} />
            {date !== todayISO() && (
              <Button variant="ghost" size="sm" onClick={() => update('date', '')}>
                {t('common.today')}
              </Button>
            )}
          </div>
          <div className="flex flex-1 flex-wrap gap-3 sm:justify-end">
            {showAllDoctors && (
              <div className="min-w-[11rem]">
                <Select
                  aria-label={t('appointments.doctor')}
                  value={doctorId}
                  onChange={(e) => update('doctor', e.target.value)}
                  placeholder={t('appointments.allDoctors')}
                  options={doctors.map((d) => ({ value: d.user_id, label: d.full_name }))}
                />
              </div>
            )}
            <div className="min-w-[10rem]">
              <Select
                aria-label={t('appointments.status')}
                value={status}
                onChange={(e) => update('status', e.target.value)}
                placeholder={t('common.all')}
                options={APPOINTMENT_STATUSES.map((s) => ({ value: s, label: t(`appointmentStatus.${s}`) }))}
              />
            </div>
          </div>
        </Toolbar>
        <h2 className="border-b border-line px-5 py-3 font-display text-sm font-semibold text-ink-muted">{formatLongDate(date)}</h2>
        {query.isLoading ? (
          <SkeletonRows rows={6} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data!.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title={t('appointments.emptyDay')}
            action={can('appointments.manage') && <Button onClick={() => setBookOpen(true)}>{t('appointments.book')}</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {query.data!.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:flex-nowrap">
                <div className="tabular w-24 shrink-0 text-sm">
                  <span className="font-medium text-ink">{formatTime(a.starts_at)}</span>
                  <span className="block text-xs text-ink-muted">{formatTime(a.ends_at)}</span>
                </div>
                <Link to={`/appointments/${a.id}`} className="min-w-0 flex-1 rounded hover:underline">
                  <PatientIdentity name={fullName(a.patient)} code={a.patient?.patient_code} meta={[t(`appointmentType.${a.type}`), showAllDoctors ? names.get(a.doctor_id) : null, a.reason].filter(Boolean).join(' · ')} />
                </Link>
                <StatusBadge status={a.status} label={t(`appointmentStatus.${a.status}`)} />
                <AppointmentActions appointment={a} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <AppointmentFormModal
        open={bookOpen}
        onOpenChange={(o) => {
          setBookOpen(o);
          if (!o && params.get('book')) update('book', '');
        }}
        defaultDate={date}
        defaultPatientId={params.get('patient')}
        defaultDoctorId={doctorId || null}
      />
    </>
  );
}

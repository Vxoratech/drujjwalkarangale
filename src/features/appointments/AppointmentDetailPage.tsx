import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, FullPageSpinner, PermissionDenied } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { isPermissionError, toUserMessage } from '@/lib/errors';
import { formatLongDate, formatTime, fullName, maskPhone } from '@/lib/formatters';
import { REQUIRES } from '@/lib/permissions/permissions';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { getAppointment } from '@/services/appointments';
import { AppointmentActions } from './AppointmentActions';

export function AppointmentDetailPage() {
  const { appointmentId = '' } = useParams();
  const { t } = useI18n();
  const { can, branchName } = useAccess();
  const query = useQuery({ queryKey: qk.appointment(appointmentId), queryFn: () => getAppointment(appointmentId) });

  if (query.isLoading) return <FullPageSpinner />;
  if (query.isError) {
    if (isPermissionError(query.error) || (query.error as { code?: string }).code === 'PGRST116') return <PermissionDenied />;
    return <ErrorState message={toUserMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  const a = query.data!;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.appointments'), to: '/appointments' }, { label: formatLongDate(a.starts_at) }]}
        title={`${formatTime(a.starts_at)} – ${formatTime(a.ends_at)}`}
        description={formatLongDate(a.starts_at)}
        meta={<StatusBadge status={a.status} label={t(`appointmentStatus.${a.status}`)} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('appointments.patient')} />
          <CardBody className="space-y-4">
            {can(REQUIRES.viewPatients) && a.patient ? (
              <Link to={`/patients/${a.patient_id}`} className="inline-block rounded hover:underline">
                <PatientIdentity size="md" name={fullName(a.patient)} code={a.patient.patient_code} meta={maskPhone(a.patient.phone)} />
              </Link>
            ) : (
              <PatientIdentity size="md" name={fullName(a.patient)} code={a.patient?.patient_code} />
            )}
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t('appointments.branch')}</dt>
                <dd className="mt-0.5 text-sm">{branchName(a.branch_id)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t('appointments.type')}</dt>
                <dd className="mt-0.5 text-sm">{t(`appointmentType.${a.type}`)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t('appointments.reason')}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm">{a.reason || '—'}</dd>
              </div>
              {a.cancellation_reason && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t('appointments.cancelReason')}</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-sm">{a.cancellation_reason}</dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('common.actions')} />
          <CardBody>
            <AppointmentActions appointment={a} variant="buttons" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

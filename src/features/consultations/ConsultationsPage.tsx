import { useQuery } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDate, fullName } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listConsultations, type ConsultationSummary } from '@/services/clinical';

function ConsultationList({ rows }: { rows: ConsultationSummary[] }) {
  const { t } = useI18n();
  return (
    <ul className="divide-y divide-line">
      {rows.map((c) => (
        <li key={c.id}>
          <Link to={`/consultations/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-ivory">
            <PatientIdentity name={fullName(c.patient)} code={c.patient?.patient_code} meta={c.chief_complaint} className="flex-1" />
            <span className="tabular text-sm text-ink-muted">{formatDate(c.visit_date)}</span>
            <StatusBadge status={c.status} label={c.status === 'draft' ? t('consultations.draft') : t('consultations.final')} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ConsultationsPage() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId } = useClinic();
  const drafts = useQuery({ queryKey: qk.consultations(clinicId, { doctorId: user.id, status: 'draft' }), queryFn: () => listConsultations(clinicId, { doctorId: user.id, status: 'draft' }) });
  const recent = useQuery({ queryKey: qk.consultations(clinicId, { doctorId: user.id, status: 'finalized' }), queryFn: () => listConsultations(clinicId, { doctorId: user.id, status: 'finalized', limit: 20 }) });

  return (
    <>
      <PageHeader title={t('nav.consultations')} description={t('consultations.emptyBody')} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t('consultations.myDrafts')} />
          {drafts.isLoading ? <SkeletonRows rows={3} /> : drafts.isError ? <ErrorState compact onRetry={() => void drafts.refetch()} /> : drafts.data!.length === 0 ? <EmptyState compact icon={<Stethoscope />} title={t('states.emptyTitle')} /> : <ConsultationList rows={drafts.data!} />}
        </Card>
        <Card>
          <CardHeader title={t('consultations.final')} />
          {recent.isLoading ? <SkeletonRows rows={3} /> : recent.isError ? <ErrorState compact onRetry={() => void recent.refetch()} /> : recent.data!.length === 0 ? <EmptyState compact icon={<Stethoscope />} title={t('consultations.emptyTitle')} /> : <ConsultationList rows={recent.data!} />}
        </Card>
      </div>
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Leaf, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { formatDate, fullName } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listConsultations, type ConsultationSummary } from '@/services/clinical';

function ConsultationList({ rows, showExam }: { rows: ConsultationSummary[]; showExam?: boolean }) {
  const { t } = useI18n();
  const { branches, branchFilter, branchName } = useAccess();
  const showBranch = branches.length > 1 && !branchFilter;
  return (
    <ul className="divide-y divide-line">
      {rows.map((c) => {
        const exam = Array.isArray(c.exam) ? c.exam[0] : c.exam;
        return (
          <li key={c.id}>
            <Link to={`/consultations/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-ivory">
              <PatientIdentity
                name={fullName(c.patient)}
                code={c.patient?.patient_code}
                meta={[c.chief_complaint, showBranch ? branchName(c.branch_id) : null].filter(Boolean).join(' · ')}
                className="flex-1"
              />
              {showExam && exam?.prakriti && <Badge tone="forest">{t(`prakriti.${exam.prakriti}`)}</Badge>}
              {showExam && exam?.agni && <Badge>{`${t('exam.agni')}: ${t(`agni.${exam.agni}`)}`}</Badge>}
              <span className="tabular text-sm text-ink-muted">{formatDate(c.visit_date)}</span>
              <StatusBadge status={c.status} label={c.status === 'draft' ? t('consultations.draft') : t('consultations.final')} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ConsultationLists({ showExam }: { showExam?: boolean }) {
  const { t } = useI18n();
  const { can, branchFilter } = useAccess();
  // Drafts are the doctor's working copies; other viewers see finalized records only.
  const isAuthor = can('consultations.edit');
  const draftParams = { status: 'draft' as const, branchId: branchFilter };
  const recentParams = { status: 'finalized' as const, branchId: branchFilter, limit: 30 };
  const drafts = useQuery({ queryKey: qk.consultations(draftParams), queryFn: () => listConsultations(draftParams), enabled: isAuthor });
  const recent = useQuery({ queryKey: qk.consultations(recentParams), queryFn: () => listConsultations(recentParams) });
  const icon = showExam ? <Leaf /> : <Stethoscope />;

  return (
    <div className="space-y-6">
      {isAuthor && (
        <Card>
          <CardHeader title={t('consultations.myDrafts')} />
          {drafts.isLoading ? <SkeletonRows rows={3} /> : drafts.isError ? <ErrorState compact onRetry={() => void drafts.refetch()} /> : drafts.data!.length === 0 ? <EmptyState compact icon={icon} title={t('states.emptyTitle')} /> : <ConsultationList rows={drafts.data!} showExam={showExam} />}
        </Card>
      )}
      <Card>
        <CardHeader title={t('consultations.recentFinalized')} />
        {recent.isLoading ? <SkeletonRows rows={3} /> : recent.isError ? <ErrorState compact onRetry={() => void recent.refetch()} /> : recent.data!.length === 0 ? <EmptyState compact icon={icon} title={t('consultations.emptyTitle')} /> : <ConsultationList rows={recent.data!} showExam={showExam} />}
      </Card>
    </div>
  );
}

export function ConsultationsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.consultations')} description={t('consultations.listSubtitle')} />
      <ConsultationLists />
    </>
  );
}

/** Ayurvedic examinations are recorded inside consultations; this lists them with their key findings. */
export function ExaminationsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.examinations')} description={t('consultations.examinationsSubtitle')} />
      <ConsultationLists showExam />
    </>
  );
}

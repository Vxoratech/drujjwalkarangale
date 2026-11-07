import { useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { formatDate, fullName } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listOpenInvestigations } from '@/services/clinical';

/** Open investigations across the user's branches; results are recorded on the patient profile. */
export function InvestigationsPage() {
  const { t } = useI18n();
  const { branchFilter, branches, branchName } = useAccess();
  const showBranch = branches.length > 1 && !branchFilter;
  const params = { open: true, branchId: branchFilter };
  const q = useQuery({ queryKey: qk.investigations(params), queryFn: () => listOpenInvestigations(branchFilter) });

  return (
    <>
      <PageHeader title={t('nav.investigations')} description={t('investigations.pageSubtitle')} />
      <Card>
        <CardHeader title={t('investigations.open')} />
        {q.isLoading ? (
          <SkeletonRows rows={5} />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : q.data!.length === 0 ? (
          <EmptyState icon={<FlaskConical />} title={t('investigations.noneOpen')} />
        ) : (
          <ul className="divide-y divide-line">
            {q.data!.map((inv) => (
              <li key={inv.id}>
                <Link to={`/patients/${inv.patient_id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-ivory">
                  <PatientIdentity className="min-w-0 flex-1" name={fullName(inv.patient)} code={inv.patient?.patient_code} meta={[inv.test_name, showBranch ? branchName(inv.branch_id) : null].filter(Boolean).join(' · ')} />
                  <span className="tabular text-sm text-ink-muted">
                    {t('investigations.orderedOn')} {formatDate(inv.ordered_at)}
                  </span>
                  <StatusBadge status={inv.status} label={t(`investigationStatus.${inv.status}`)} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

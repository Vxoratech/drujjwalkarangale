import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { humanizeEntity, humanizeField } from '@/components/data-display/AuditEvent';
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDateTime } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { fetchProfileNames } from '@/services/clinic';
import { listAuditLogs } from '@/services/reports';
import type { AuditLog } from '@/types/domain';

const PAGE_SIZE = 25;
const ENTITY_TYPES = ['patients', 'appointments', 'consultations', 'ayurvedic_examinations', 'prescriptions', 'investigations', 'invoices', 'payments', 'clinic_members', 'clinics', 'branches'];
const TONES = { insert: 'success', update: 'info', delete: 'danger' } as const;

export function AuditLogPage() {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const params = { page, pageSize: PAGE_SIZE, entityType: entityType || undefined };
  const query = useQuery({ queryKey: qk.audit(clinicId, params), queryFn: () => listAuditLogs(clinicId, params), placeholderData: keepPreviousData });
  const actorIds = [...new Set((query.data?.rows ?? []).map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
  const actors = useQuery({ queryKey: ['profile-names', actorIds], queryFn: () => fetchProfileNames(actorIds), enabled: actorIds.length > 0 });

  const actorName = (id: string | null) => (id ? actors.data?.get(id) ?? '—' : t('audit.system'));

  const columns: Column<AuditLog>[] = [
    { key: 'when', header: t('audit.when'), cell: (l) => <span className="tabular whitespace-nowrap text-ink-muted">{formatDateTime(l.created_at)}</span> },
    { key: 'who', header: t('audit.who'), cell: (l) => actorName(l.actor_id) },
    { key: 'action', header: t('audit.action'), cell: (l) => <Badge tone={TONES[l.action]}>{t(`audit.${l.action}`)}</Badge> },
    { key: 'entity', header: t('audit.entity'), cell: (l) => humanizeEntity(l.entity_type) },
    { key: 'fields', header: t('audit.fields'), hideBelow: 'md', cell: (l) => <span className="text-xs text-ink-muted">{l.changed_fields.map(humanizeField).join(', ') || '—'}</span> },
  ];

  return (
    <>
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} />
      <Card>
        <Toolbar>
          <div className="sm:min-w-[14rem]">
            <Select
              aria-label={t('audit.entityType')}
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
              placeholder={t('common.all')}
              options={ENTITY_TYPES.map((e) => ({ value: e, label: humanizeEntity(e) }))}
            />
          </div>
        </Toolbar>
        {query.isLoading ? (
          <SkeletonRows rows={10} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption={t('audit.title')}
            columns={columns}
            rows={query.data!.rows}
            rowKey={(l) => String(l.id)}
            mobileCard={(l) => (
              <div className="text-sm">
                <p>
                  <span className="font-medium">{actorName(l.actor_id)}</span> <Badge tone={TONES[l.action]}>{t(`audit.${l.action}`)}</Badge> {humanizeEntity(l.entity_type)}
                </p>
                <p className="tabular text-xs text-ink-muted">{formatDateTime(l.created_at)}</p>
              </div>
            )}
            pagination={{ page, pageSize: PAGE_SIZE, total: query.data!.total, onPageChange: setPage }}
            empty={<EmptyState icon={<ScrollText />} title={t('audit.emptyTitle')} body={t('audit.emptyBody')} />}
          />
        )}
      </Card>
    </>
  );
}

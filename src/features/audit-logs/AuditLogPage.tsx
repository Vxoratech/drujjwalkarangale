import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { AUDIT_ICONS, AUDIT_TONES, describeMetadata, humanizeEntity, humanizeField } from '@/components/data-display/AuditEvent';
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDateTime } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import { fetchProfileNames } from '@/services/clinic';
import { listAuditEvents } from '@/services/reports';
import type { AuditAction, AuditEvent } from '@/types/domain';

const PAGE_SIZE = 25;
const ENTITY_TYPES = [
  'patients', 'patient_consents', 'patient_documents', 'appointments', 'follow_ups', 'consultations', 'ayurvedic_examinations',
  'prescriptions', 'prescription_revisions', 'investigations', 'invoices', 'payments', 'refunds', 'clinic_members',
  'member_branches', 'clinics', 'branches', 'tenant_subscriptions', 'session',
];
const ACTIONS: AuditAction[] = ['insert', 'update', 'delete', 'view', 'access', 'security'];

export function AuditLogPage() {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const params = { page, pageSize: PAGE_SIZE, entityType: entityType || undefined, action: action || undefined };
  const query = useQuery({ queryKey: qk.audit(clinicId, params), queryFn: () => listAuditEvents(clinicId, params), placeholderData: keepPreviousData });
  const actorIds = [...new Set((query.data?.rows ?? []).map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
  const actors = useQuery({ queryKey: ['profile-names', actorIds], queryFn: () => fetchProfileNames(actorIds), enabled: actorIds.length > 0 });

  const actorName = (e: AuditEvent) => (e.actor_type === 'platform' ? t('audit.actorPlatform') : e.actor_id ? actors.data?.get(e.actor_id) ?? '—' : t('audit.system'));
  const actionLabel = (a: AuditAction) => t(`audit.${a}` as TranslationKey);
  const detail = (e: AuditEvent) => [describeMetadata(e.metadata), e.changed_fields.map(humanizeField).join(', ')].filter(Boolean).join(' · ') || '—';

  const columns: Column<AuditEvent>[] = [
    { key: 'when', header: t('audit.when'), cell: (e) => <span className="tabular whitespace-nowrap text-ink-muted">{formatDateTime(e.created_at)}</span> },
    { key: 'who', header: t('audit.who'), cell: actorName },
    {
      key: 'action',
      header: t('audit.action'),
      cell: (e) => {
        const Icon = AUDIT_ICONS[e.action];
        return (
          <Badge tone={AUDIT_TONES[e.action]}>
            <Icon className="size-3" aria-hidden /> {actionLabel(e.action)}
          </Badge>
        );
      },
    },
    { key: 'entity', header: t('audit.entity'), cell: (e) => humanizeEntity(e.entity_type) },
    { key: 'fields', header: t('audit.fields'), hideBelow: 'md', cell: (e) => <span className="text-xs text-ink-muted">{detail(e)}</span> },
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
          <div className="sm:min-w-[11rem]">
            <Select
              aria-label={t('audit.filterAction')}
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              placeholder={t('common.all')}
              options={ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }))}
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
            rowKey={(e) => String(e.id)}
            mobileCard={(e) => (
              <div className="text-sm">
                <p>
                  <span className="font-medium">{actorName(e)}</span> <Badge tone={AUDIT_TONES[e.action]}>{actionLabel(e.action)}</Badge> {humanizeEntity(e.entity_type)}
                </p>
                <p className="text-xs text-ink-muted">{detail(e)}</p>
                <p className="tabular text-xs text-ink-muted">{formatDateTime(e.created_at)}</p>
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

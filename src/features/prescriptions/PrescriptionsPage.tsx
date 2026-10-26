import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Pill, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput, SearchInput, Select } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDoctors } from '@/hooks/useDoctors';
import { formatDate, fullName, istDayRange } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { searchPrescriptions, type PrescriptionListItem, type PrescriptionSearchParams } from '@/services/clinical';

const PAGE_SIZE = 20;

/** Clinic-wide prescription search. Admins see issued/cancelled prescriptions only (enforced by RLS). */
export function PrescriptionsPage() {
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const { doctors, names } = useDoctors();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'issued' | 'draft' | 'cancelled'>('');
  const [doctorId, setDoctorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search);
  const canSeeDrafts = can('clinical.write');

  const params: PrescriptionSearchParams = {
    page,
    pageSize: PAGE_SIZE,
    search: debounced || undefined,
    status: status || undefined,
    doctorId: doctorId || undefined,
    from: from ? istDayRange(from).from : undefined,
    to: to ? istDayRange(to).to : undefined,
  };
  const query = useQuery({ queryKey: [clinicId, 'prescriptions', 'search', params], queryFn: () => searchPrescriptions(clinicId, params), placeholderData: keepPreviousData });
  const reset = () => setPage(1);

  const columns: Column<PrescriptionListItem>[] = [
    {
      key: 'no',
      header: t('prescriptions.reference'),
      cell: (rx) => (
        <Link to={`/prescriptions/${rx.id}`} className="tabular font-medium text-forest-deep hover:underline" onClick={(e) => e.stopPropagation()}>
          {rx.prescription_no ?? t('prescriptionStatus.draft')}
        </Link>
      ),
    },
    { key: 'patient', header: t('billing.patient'), cell: (rx) => <PatientIdentity name={fullName(rx.patient)} code={rx.patient?.patient_code} /> },
    { key: 'medicines', header: t('prescriptions.medicine'), hideBelow: 'lg', cell: (rx) => <span className="line-clamp-1 text-ink-muted">{rx.items.map((i) => i.medicine_name).join(', ') || '—'}</span> },
    { key: 'doctor', header: t('appointments.doctor'), hideBelow: 'md', cell: (rx) => names.get(rx.doctor_id) ?? '—' },
    { key: 'date', header: t('billing.date'), cell: (rx) => <span className="tabular text-ink-muted">{formatDate(rx.issued_at ?? rx.created_at)}</span> },
    {
      key: 'status',
      header: t('billing.status'),
      cell: (rx) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={rx.status} label={t(`prescriptionStatus.${rx.status}`)} />
          {rx.revision_number > 1 && <Badge tone="gold">{t('prescriptions.revisionN', { n: rx.revision_number })}</Badge>}
          <Badge>{rx.language === 'mr' ? 'मराठी' : 'EN'}</Badge>
        </span>
      ),
    },
    {
      key: 'print',
      header: <span className="sr-only">{t('common.print')}</span>,
      align: 'right',
      cell: (rx) =>
        rx.status === 'issued' && (
          <IconButton size="sm" label={`${t('common.print')} ${rx.prescription_no}`} icon={<Printer />} onClick={(e) => { e.stopPropagation(); window.open(`/print/prescriptions/${rx.id}`, '_blank', 'noopener'); }} />
        ),
    },
  ];

  return (
    <>
      <PageHeader title={t('prescriptions.listTitle')} description={canSeeDrafts ? t('prescriptions.listSubtitleDoctor') : t('prescriptions.listSubtitleAdmin')} />
      <Card>
        <Toolbar>
          <div className="w-full sm:max-w-xs">
            <SearchInput value={search} onValueChange={(v) => { setSearch(v); reset(); }} placeholder={t('prescriptions.searchPlaceholder')} aria-label={t('prescriptions.searchPlaceholder')} />
          </div>
          <div className="flex flex-wrap gap-3 sm:ml-auto">
            <div className="min-w-[9rem]">
              <Select
                aria-label={t('billing.status')}
                value={status}
                onChange={(e) => { setStatus(e.target.value as typeof status); reset(); }}
                placeholder={t('common.all')}
                options={(canSeeDrafts ? (['issued', 'draft', 'cancelled'] as const) : (['issued', 'cancelled'] as const)).map((s) => ({ value: s, label: t(`prescriptionStatus.${s}`) }))}
              />
            </div>
            <div className="min-w-[10rem]">
              <Select aria-label={t('appointments.doctor')} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); reset(); }} placeholder={t('appointments.allDoctors')} options={doctors.map((d) => ({ value: d.user_id, label: d.full_name }))} />
            </div>
            <DateInput aria-label={t('reports.from')} value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); reset(); }} className="w-auto" />
            <DateInput aria-label={t('reports.to')} value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value ? e.target.value : ''); reset(); }} className="w-auto" />
          </div>
        </Toolbar>
        {query.isLoading ? (
          <SkeletonRows rows={8} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption={t('prescriptions.listTitle')}
            columns={columns}
            rows={query.data!.rows}
            rowKey={(rx) => rx.id}
            onRowClick={(rx) => navigate(`/prescriptions/${rx.id}`)}
            mobileCard={(rx) => (
              <div className="flex items-center justify-between gap-3">
                <PatientIdentity name={fullName(rx.patient)} code={rx.prescription_no ?? undefined} meta={formatDate(rx.issued_at ?? rx.created_at)} />
                <StatusBadge status={rx.status} label={t(`prescriptionStatus.${rx.status}`)} />
              </div>
            )}
            pagination={{ page, pageSize: PAGE_SIZE, total: query.data!.total, onPageChange: setPage }}
            empty={<EmptyState icon={<Pill />} title={t('prescriptions.emptyTitle')} body={t('prescriptions.emptyBody')} />}
          />
        )}
      </Card>
    </>
  );
}


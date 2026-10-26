import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SearchInput, Select } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatDate, formatINR, fullName } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listInvoices, type InvoiceListParams } from '@/services/billing';
import type { Invoice, InvoiceStatus } from '@/types/domain';
import { BillingTabs } from './BillingTabs';
import { InvoiceStatusBadge } from './InvoiceStatusBadge';

const PAGE_SIZE = 20;

export function InvoicesPage() {
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const navigate = useNavigate();
  const [status, setStatus] = useState<InvoiceStatus | 'outstanding' | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search);

  const params: InvoiceListParams = { page, pageSize: PAGE_SIZE, status: status || undefined, search: debounced || undefined };
  const query = useQuery({ queryKey: qk.invoices(clinicId, params), queryFn: () => listInvoices(clinicId, params), placeholderData: keepPreviousData });

  const columns: Column<Invoice>[] = [
    {
      key: 'invoice_no',
      header: t('billing.invoiceNo'),
      cell: (i) => (
        <Link to={`/billing/${i.id}`} className="tabular font-medium text-forest-deep hover:underline" onClick={(e) => e.stopPropagation()}>
          {i.invoice_no}
        </Link>
      ),
    },
    { key: 'date', header: t('billing.date'), cell: (i) => <span className="tabular text-ink-muted">{formatDate(i.issue_date)}</span> },
    { key: 'patient', header: t('billing.patient'), cell: (i) => <span>{fullName(i.patient)}</span> },
    { key: 'total', header: t('billing.total'), align: 'right', cell: (i) => <span className="tabular font-medium">{formatINR(i.total_paise)}</span> },
    {
      key: 'balance',
      header: t('billing.balance'),
      align: 'right',
      hideBelow: 'lg',
      cell: (i) => <span className="tabular text-ink-muted">{i.status === 'void' ? '—' : formatINR(i.total_paise - i.amount_paid_paise)}</span>,
    },
    { key: 'status', header: t('billing.status'), align: 'right', cell: (i) => <InvoiceStatusBadge status={i.status} /> },
  ];

  return (
    <>
      <PageHeader
        title={t('billing.title')}
        description={t('billing.subtitle')}
        actions={
          can('billing.create') && (
            <Link to="/billing/new" className={buttonClasses('primary')}>
              <Plus className="size-4" aria-hidden /> {t('billing.newInvoice')}
            </Link>
          )
        }
      />
      <BillingTabs />
      <Card>
        <Toolbar>
          <div className="w-full sm:max-w-xs">
            <SearchInput
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder={t('billing.invoiceNo')} aria-label={t('billing.invoiceNo')} />
          </div>
          <div className="sm:ml-auto sm:min-w-[12rem]">
            <Select
              aria-label={t('billing.status')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as InvoiceStatus | 'outstanding' | '');
                setPage(1);
              }}
              placeholder={t('common.all')}
              options={[
                { value: 'outstanding', label: t('billing.outstandingOnly') },
                ...(['issued', 'partially_paid', 'paid', 'void'] as const).map((s) => ({ value: s, label: t(`invoiceStatus.${s}`) })),
              ]}
            />
          </div>
        </Toolbar>
        {query.isLoading ? (
          <SkeletonRows rows={8} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption={t('billing.title')}
            columns={columns}
            rows={query.data!.rows}
            rowKey={(i) => i.id}
            onRowClick={(i) => navigate(`/billing/${i.id}`)}
            mobileCard={(i) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="tabular font-medium">{i.invoice_no}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {fullName(i.patient)} · {formatDate(i.issue_date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular font-medium">{formatINR(i.total_paise)}</p>
                  <p className="text-xs text-ink-muted">{t(`invoiceStatus.${i.status}`)}</p>
                </div>
              </div>
            )}
            pagination={{ page, pageSize: PAGE_SIZE, total: query.data!.total, onPageChange: setPage }}
            empty={<EmptyState icon={<Receipt />} title={t('billing.emptyTitle')} body={t('billing.emptyBody')} />}
          />
        )}
      </Card>
    </>
  );
}

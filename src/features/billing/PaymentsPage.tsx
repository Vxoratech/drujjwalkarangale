import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, MoreHorizontal, Printer, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { FormField } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { DateInput, Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDateTime, formatINR, fullName, istDayRange } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { listPayments, reconcilePayment, type PaymentListParams } from '@/services/billing';
import { PAYMENT_METHODS, type PaymentMethod, type PaymentWithContext } from '@/types/domain';
import { BillingTabs } from './BillingTabs';

const PAGE_SIZE = 25;

function ReconcileDialog({ payment, onClose }: { payment: PaymentWithContext; onClose: () => void }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const [ref, setRef] = useState(payment.settlement_reference ?? payment.reference ?? '');
  const [note, setNote] = useState(payment.reconciliation_note ?? '');
  const mutation = useMutation({
    mutationFn: () => reconcilePayment({ paymentId: payment.id, reconciled: true, settlementReference: ref.trim() || null, note: note.trim() || null }),
    onSuccess: async () => {
      notify.success(t('billing.reconciled'));
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'payments'] });
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'overview'] });
      onClose();
    },
    onError: (e) => notify.error(e),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('billing.reconcile')}
      description={`${payment.receipt_no ?? ''} · ${formatINR(payment.amount_paise)} · ${t(`paymentMethod.${payment.method}`)}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
            {t('billing.markReconciled')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label={t('billing.settlementReference')} hint={t('billing.settlementHint')}>
          <Input maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} />
        </FormField>
        <FormField label={t('billing.notes')}>
          <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}

export function PaymentsPage() {
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reconciled, setReconciled] = useState<'' | 'yes' | 'no'>('');
  const [page, setPage] = useState(1);
  const [reconciling, setReconciling] = useState<PaymentWithContext | null>(null);
  const canReconcile = can('payments.reconcile');

  const params: PaymentListParams = {
    page,
    pageSize: PAGE_SIZE,
    from: from ? istDayRange(from).from : undefined,
    to: to ? istDayRange(to).to : undefined,
    method: method || undefined,
    reconciled: reconciled === '' ? undefined : reconciled === 'yes',
  };
  const query = useQuery({ queryKey: [clinicId, 'payments', params], queryFn: () => listPayments(clinicId, params), placeholderData: keepPreviousData });
  const undo = useMutation({
    mutationFn: (p: PaymentWithContext) => reconcilePayment({ paymentId: p.id, reconciled: false, settlementReference: null, note: null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [clinicId, 'payments'] }),
    onError: (e) => notify.error(e),
  });
  const total = (query.data?.rows ?? []).reduce((s, p) => s + p.amount_paise, 0);

  const columns: Column<PaymentWithContext>[] = [
    { key: 'when', header: t('billing.paidAt'), cell: (p) => <span className="tabular whitespace-nowrap text-ink-muted">{formatDateTime(p.paid_at)}</span> },
    { key: 'receipt', header: t('billing.receipt'), cell: (p) => <span className="tabular font-medium">{p.receipt_no ?? '—'}</span> },
    {
      key: 'invoice',
      header: t('billing.invoiceNo'),
      hideBelow: 'md',
      cell: (p) =>
        p.invoice ? (
          <Link to={`/billing/${p.invoice.id}`} className="tabular text-forest-deep hover:underline">
            {p.invoice.invoice_no}
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'patient', header: t('billing.patient'), hideBelow: 'lg', cell: (p) => fullName(p.patient) },
    { key: 'method', header: t('billing.method'), cell: (p) => <span>{t(`paymentMethod.${p.method}`)}{p.reference && <span className="tabular block text-xs text-ink-muted">{p.reference}</span>}</span> },
    { key: 'amount', header: t('billing.amount'), align: 'right', cell: (p) => <span className="tabular font-medium">{formatINR(p.amount_paise)}</span> },
    {
      key: 'reconciled',
      header: t('billing.reconciliation'),
      cell: (p) =>
        p.reconciled_at ? (
          <Badge tone="success">
            <CheckCircle2 className="size-3" aria-hidden /> {t('billing.reconciled')}
          </Badge>
        ) : (
          <Badge>
            <CircleDashed className="size-3" aria-hidden /> {t('billing.unreconciled')}
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'right',
      cell: (p) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" label={`${t('common.actions')}: ${p.receipt_no ?? ''}`} icon={<MoreHorizontal />} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem icon={<Printer />} onSelect={() => window.open(`/print/receipts/${p.id}`, '_blank', 'noopener')}>
              {t('billing.printReceipt')}
            </DropdownMenuItem>
            {canReconcile && !p.reconciled_at && (
              <DropdownMenuItem icon={<CheckCircle2 />} onSelect={() => setReconciling(p)}>
                {t('billing.reconcile')}
              </DropdownMenuItem>
            )}
            {canReconcile && p.reconciled_at && (
              <DropdownMenuItem icon={<CircleDashed />} onSelect={() => undo.mutate(p)}>
                {t('billing.undoReconcile')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('billing.title')} description={t('billing.paymentsSubtitle')} />
      <BillingTabs />
      <Card>
        <Toolbar>
          <div className="flex flex-wrap items-center gap-2">
            <DateInput aria-label={t('reports.from')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-auto" />
            <span className="text-ink-muted" aria-hidden>–</span>
            <DateInput aria-label={t('reports.to')} value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-auto" />
          </div>
          <div className="flex flex-wrap gap-3 sm:ml-auto">
            <div className="min-w-[9rem]">
              <Select aria-label={t('billing.method')} value={method} onChange={(e) => { setMethod(e.target.value as PaymentMethod | ''); setPage(1); }} placeholder={t('common.all')} options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`paymentMethod.${m}`) }))} />
            </div>
            <div className="min-w-[10rem]">
              <Select
                aria-label={t('billing.reconciliation')}
                value={reconciled}
                onChange={(e) => { setReconciled(e.target.value as '' | 'yes' | 'no'); setPage(1); }}
                placeholder={t('common.all')}
                options={[
                  { value: 'no', label: t('billing.unreconciled') },
                  { value: 'yes', label: t('billing.reconciled') },
                ]}
              />
            </div>
          </div>
        </Toolbar>
        {query.isLoading ? (
          <SkeletonRows rows={8} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <>
            {query.data!.rows.length > 0 && (
              <p className="tabular border-b border-line px-5 py-2 text-sm text-ink-muted">{t('billing.pageTotal', { amount: formatINR(total) })}</p>
            )}
            <DataTable
              caption={t('billing.payments')}
              columns={columns}
              rows={query.data!.rows}
              rowKey={(p) => p.id}
              mobileCard={(p) => (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="tabular font-medium">{p.receipt_no}</p>
                    <p className="text-xs text-ink-muted">
                      {fullName(p.patient)} · {t(`paymentMethod.${p.method}`)}
                    </p>
                  </div>
                  <span className="tabular font-medium">{formatINR(p.amount_paise)}</span>
                </div>
              )}
              pagination={{ page, pageSize: PAGE_SIZE, total: query.data!.total, onPageChange: setPage }}
              empty={<EmptyState icon={<Wallet />} title={t('billing.noPayments')} />}
            />
          </>
        )}
      </Card>
      {reconciling && <ReconcileDialog payment={reconciling} onClose={() => setReconciling(null)} />}
    </>
  );
}

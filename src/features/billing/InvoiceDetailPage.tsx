import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, IndianRupee, Printer, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, FullPageSpinner, PermissionDenied } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { DateInput, Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { isPermissionError, toUserMessage } from '@/lib/errors';
import { formatDate, formatDateTime, formatINR, fullName, paiseToRupees, todayISO } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { getInvoice, recordPayment, recordRefund, voidInvoice } from '@/services/billing';
import { PAYMENT_METHODS, type InvoiceDetail } from '@/types/domain';
import { paymentSchema, refundSchema, type PaymentFormInput, type PaymentFormValues, type RefundFormInput, type RefundFormValues } from './invoiceSchema';
import { InvoiceStatusBadge } from './InvoiceStatusBadge';

function PaymentModal({ invoice, open, onOpenChange }: { invoice: InvoiceDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const balance = invoice.total_paise - invoice.amount_paid_paise;
  const form = useForm<PaymentFormInput, unknown, PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    values: { amount: String(paiseToRupees(balance)), method: 'upi', reference: '', paid_on: todayISO(), notes: '' },
  });

  const mutation = useMutation({
    mutationFn: (v: PaymentFormValues) => {
      // Payments dated today use the current time; back-dated ones use midday IST.
      const paidAt = v.paid_on === todayISO() ? new Date().toISOString() : new Date(`${v.paid_on}T12:00:00+05:30`).toISOString();
      return recordPayment({ invoiceId: invoice.id, amountPaise: v.amount, method: v.method, reference: v.reference || null, paidAt, notes: v.notes || null });
    },
    onSuccess: async () => {
      notify.success(t('billing.paymentRecorded'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.invoice(clinicId, invoice.id) }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'invoices'] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'dashboard'] }),
      ]);
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });

  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}
      title={t('billing.recordPayment')}
      description={`${invoice.invoice_no} · ${t('billing.balance')} ${formatINR(balance)}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="payment-form" loading={mutation.isPending}>
            {t('billing.recordPayment')}
          </Button>
        </>
      }
    >
      <form id="payment-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormGrid>
          <FormField label={t('billing.amount')} error={fieldError(e.amount)} required>
            <Input inputMode="decimal" className="tabular" {...form.register('amount')} />
          </FormField>
          <FormField label={t('billing.method')} required>
            <Select options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`paymentMethod.${m}`) }))} {...form.register('method')} />
          </FormField>
          <FormField label={t('billing.reference')} error={fieldError(e.reference)}>
            <Input autoComplete="off" {...form.register('reference')} />
          </FormField>
          <FormField label={t('billing.paidAt')} error={fieldError(e.paid_on)} required>
            <DateInput max={todayISO()} {...form.register('paid_on')} />
          </FormField>
        </FormGrid>
        <FormField label={t('billing.notes')} error={fieldError(e.notes)}>
          <Textarea rows={2} {...form.register('notes')} />
        </FormField>
      </form>
    </Modal>
  );
}

function RefundModal({ invoice, open, onOpenChange }: { invoice: InvoiceDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const refundable = invoice.amount_paid_paise - invoice.amount_refunded_paise;
  const form = useForm<RefundFormInput, unknown, RefundFormValues>({
    resolver: zodResolver(refundSchema),
    values: { amount: String(paiseToRupees(refundable)), method: invoice.payments.at(-1)?.method ?? 'cash', reason: '', payment_id: '', reference: '' },
  });
  const mutation = useMutation({
    mutationFn: (v: RefundFormValues) => {
      if (v.amount > refundable) throw { message: 'Refund exceeds the amount paid' };
      return recordRefund({ invoiceId: invoice.id, amountPaise: v.amount, method: v.method, reason: v.reason, paymentId: v.payment_id || null, reference: v.reference || null });
    },
    onSuccess: async () => {
      notify.success(t('billing.refundRecorded'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.invoice(clinicId, invoice.id) }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'invoices'] }),
        queryClient.invalidateQueries({ queryKey: [clinicId, 'dashboard'] }),
      ]);
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}
      title={t('billing.refund')}
      description={`${invoice.invoice_no} · ${t('billing.refundable', { amount: formatINR(refundable) })}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="refund-form" variant="danger" loading={mutation.isPending}>
            {t('billing.refund')}
          </Button>
        </>
      }
    >
      <form id="refund-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormGrid>
          <FormField label={t('billing.amount')} error={fieldError(e.amount)} required>
            <Input inputMode="decimal" className="tabular" {...form.register('amount')} />
          </FormField>
          <FormField label={t('billing.method')} required>
            <Select options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`paymentMethod.${m}`) }))} {...form.register('method')} />
          </FormField>
          <FormField label={t('billing.againstPayment')}>
            <Select
              placeholder={t('billing.anyPayment')}
              options={invoice.payments.map((p) => ({ value: p.id, label: `${p.receipt_no ?? t(`paymentMethod.${p.method}`)} · ${formatINR(p.amount_paise)}` }))}
              {...form.register('payment_id')}
            />
          </FormField>
          <FormField label={t('billing.reference')} error={fieldError(e.reference)}>
            <Input autoComplete="off" {...form.register('reference')} />
          </FormField>
        </FormGrid>
        <FormField label={t('billing.refundReason')} error={fieldError(e.reason)} required>
          <Textarea rows={2} {...form.register('reason')} />
        </FormField>
      </form>
    </Modal>
  );
}

export function InvoiceDetailPage() {
  const { invoiceId = '' } = useParams();
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const queryClient = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: qk.invoice(clinicId, invoiceId), queryFn: () => getInvoice(clinicId, invoiceId) });

  const voidMutation = useMutation({
    mutationFn: () => voidInvoice(invoiceId, reason),
    onSuccess: async () => {
      notify.success(t('billing.voided'));
      await Promise.all([queryClient.invalidateQueries({ queryKey: qk.invoice(clinicId, invoiceId) }), queryClient.invalidateQueries({ queryKey: [clinicId, 'invoices'] })]);
    },
    onError: (e) => notify.error(e),
  });

  if (query.isLoading) return <FullPageSpinner />;
  if (query.isError) {
    if (isPermissionError(query.error) || (query.error as { code?: string }).code === 'PGRST116') return <PermissionDenied />;
    return <ErrorState message={toUserMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  const inv = query.data!;
  const balance = inv.total_paise - inv.amount_paid_paise;
  const canPay = can('payments.record') && ['issued', 'partially_paid'].includes(inv.status) && balance > 0;
  const canVoid = can('billing.void') && inv.status !== 'void' && inv.amount_paid_paise === 0;
  const canRefund = can('payments.refund') && inv.amount_paid_paise - inv.amount_refunded_paise > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.billing'), to: '/billing' }, { label: inv.invoice_no }]}
        title={<span className="tabular">{inv.invoice_no}</span>}
        meta={
          <>
            <InvoiceStatusBadge status={inv.status} />
            <span className="tabular text-sm text-ink-muted">{formatDate(inv.issue_date)}</span>
          </>
        }
        actions={
          <>
            <Link to={`/print/invoices/${inv.id}`} target="_blank" rel="noopener" className={buttonClasses('secondary')}>
              <Printer className="size-4" aria-hidden /> {t('common.print')}
            </Link>
            {canVoid && (
              <Button variant="ghost" className="text-danger" leftIcon={<Ban className="size-4" />} onClick={() => setVoidOpen(true)}>
                {t('billing.void')}
              </Button>
            )}
            {canRefund && (
              <Button variant="secondary" leftIcon={<Undo2 className="size-4" />} onClick={() => setRefundOpen(true)}>
                {t('billing.refund')}
              </Button>
            )}
            {canPay && (
              <Button leftIcon={<IndianRupee className="size-4" />} onClick={() => setPayOpen(true)}>
                {t('billing.recordPayment')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('billing.patient')} />
            <CardBody>
              {inv.patient && (
                <Link to={`/patients/${inv.patient_id}`} className="inline-block rounded hover:underline">
                  <PatientIdentity name={fullName(inv.patient)} code={inv.patient.patient_code} />
                </Link>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('billing.items')} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('billing.items')}</caption>
                <thead>
                  <tr className="border-b border-line bg-ivory/60 text-xs uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">{t('billing.description')}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('billing.quantity')}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('billing.unitPrice')}</th>
                    <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">{t('billing.taxRate')}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('billing.lineTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inv.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-3">
                        <p>{i.description}</p>
                        <p className="text-xs text-ink-muted">{t(`invoiceItemType.${i.item_type}`)}</p>
                      </td>
                      <td className="tabular px-4 py-3 text-right">{Number(i.quantity)}</td>
                      <td className="tabular px-4 py-3 text-right">{formatINR(i.unit_price_paise)}</td>
                      <td className="tabular hidden px-4 py-3 text-right sm:table-cell">{Number(i.tax_rate)}%</td>
                      <td className="tabular px-4 py-3 text-right">{formatINR(i.line_total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {inv.notes && <p className="border-t border-line px-5 py-3 text-sm text-ink-muted">{inv.notes}</p>}
            {inv.void_reason && <p className="border-t border-line px-5 py-3 text-sm text-danger">{t('billing.voidReason')}: {inv.void_reason}</p>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('billing.total')} />
            <CardBody>
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ['billing.subtotal', inv.subtotal_paise],
                    ['billing.tax', inv.tax_paise],
                    ['billing.discount', -inv.discount_paise],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-ink-muted">{t(k).replace(' (₹)', '')}</dt>
                    <dd className="tabular">{formatINR(v)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-2 font-display text-base font-semibold">
                  <dt>{t('billing.total')}</dt>
                  <dd className="tabular">{formatINR(inv.total_paise)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">{t('billing.paid')}</dt>
                  <dd className="tabular text-success">{formatINR(inv.amount_paid_paise)}</dd>
                </div>
                {inv.amount_refunded_paise > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">{t('billing.refunded')}</dt>
                    <dd className="tabular text-danger">−{formatINR(inv.amount_refunded_paise)}</dd>
                  </div>
                )}
                <div className="flex justify-between font-medium">
                  <dt>{t('billing.balance')}</dt>
                  <dd className="tabular">{inv.status === 'void' ? '—' : formatINR(balance)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('billing.payments')} />
            <CardBody>
              {inv.payments.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('billing.noPayments')}</p>
              ) : (
                <ul className="space-y-3">
                  {inv.payments.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium">
                          {t(`paymentMethod.${p.method}`)}
                          {p.receipt_no && <span className="tabular ml-2 text-xs font-normal text-ink-muted">{t('billing.receiptNo', { no: p.receipt_no })}</span>}
                        </p>
                        <p className="tabular text-xs text-ink-muted">
                          {formatDateTime(p.paid_at)}
                          {p.reference && ` · ${p.reference}`}
                        </p>
                      </div>
                      <span className="tabular font-medium">{formatINR(p.amount_paise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      {inv.refunds.length > 0 && (
        <Card className="mt-4">
          <CardHeader title={t('billing.refunds')} />
          <CardBody>
            <ul className="space-y-3">
              {inv.refunds.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="tabular font-medium">{r.refund_no}</p>
                    <p className="text-xs text-ink-muted">
                      {t(`paymentMethod.${r.method}`)} · {formatDateTime(r.refunded_at)} · {r.reason}
                    </p>
                  </div>
                  <span className="tabular font-medium text-danger">−{formatINR(r.amount_paise)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {canPay && <PaymentModal invoice={inv} open={payOpen} onOpenChange={setPayOpen} />}
      {canRefund && <RefundModal invoice={inv} open={refundOpen} onOpenChange={setRefundOpen} />}
      <ConfirmDialog
        open={voidOpen}
        onOpenChange={(o) => {
          setVoidOpen(o);
          if (!o) setReason('');
        }}
        title={t('billing.void')}
        body={t('billing.voidConfirmBody')}
        confirmLabel={t('billing.void')}
        cancelLabel={t('common.back')}
        tone="danger"
        confirmDisabled={!reason.trim()}
        onConfirm={() => voidMutation.mutateAsync()}
      >
        <FormField label={t('billing.voidReason')} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </FormField>
      </ConfirmDialog>
    </>
  );
}

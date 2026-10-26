import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ErrorState, FullPageSpinner } from '@/components/feedback/States';
import { PrintableDocument } from '@/components/data-display/PrintableDocument';
import { Button } from '@/components/ui/Button';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { toUserMessage } from '@/lib/errors';
import { formatDate, formatINR, fullName } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { getInvoice } from '@/services/billing';

export function InvoicePrintPage() {
  const { invoiceId = '' } = useParams();
  const { t } = useI18n();
  const { clinicId, clinic } = useClinic();
  const query = useQuery({ queryKey: qk.invoice(clinicId, invoiceId), queryFn: () => getInvoice(clinicId, invoiceId) });

  if (query.isLoading) return <FullPageSpinner />;
  if (query.isError || !query.data) return <ErrorState message={toUserMessage(query.error)} />;
  const inv = query.data;

  return (
    <div className="min-h-dvh bg-ivory px-4 py-6 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end">
        <Button leftIcon={<Printer className="size-4" />} onClick={() => window.print()}>
          {t('common.print')}
        </Button>
      </div>
      <PrintableDocument
        clinic={clinic}
        title={inv.status === 'void' ? `${t('billing.invoice')} — ${t('invoiceStatus.void')}` : t('billing.invoice')}
        meta={
          <span className="tabular">
            {inv.invoice_no} · {formatDate(inv.issue_date)}
          </span>
        }
        footer={<p>{t('billing.thankYou')}</p>}
      >
        <p className="text-xs">
          <span className="text-ink-muted">{t('billing.patient')}: </span>
          <span className="font-medium">{fullName(inv.patient)}</span> <span className="tabular text-ink-muted">({inv.patient?.patient_code})</span>
        </p>
        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-line-strong text-left text-ink-muted">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">{t('billing.description')}</th>
              <th className="py-2 pr-2 text-right font-medium">{t('billing.quantity')}</th>
              <th className="py-2 pr-2 text-right font-medium">{t('billing.unitPrice')}</th>
              <th className="py-2 pr-2 text-right font-medium">{t('billing.taxRate')}</th>
              <th className="py-2 text-right font-medium">{t('billing.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i, idx) => (
              <tr key={i.id} className="border-b border-line">
                <td className="tabular py-2 pr-2">{idx + 1}</td>
                <td className="py-2 pr-2">{i.description}</td>
                <td className="tabular py-2 pr-2 text-right">{Number(i.quantity)}</td>
                <td className="tabular py-2 pr-2 text-right">{formatINR(i.unit_price_paise)}</td>
                <td className="tabular py-2 pr-2 text-right">{Number(i.tax_rate)}%</td>
                <td className="tabular py-2 text-right">{formatINR(i.line_total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-xs">
          <div className="flex justify-between"><dt>{t('billing.subtotal')}</dt><dd className="tabular">{formatINR(inv.subtotal_paise)}</dd></div>
          <div className="flex justify-between"><dt>{t('billing.tax')}</dt><dd className="tabular">{formatINR(inv.tax_paise)}</dd></div>
          {inv.discount_paise > 0 && <div className="flex justify-between"><dt>{t('billing.discount').replace(' (₹)', '')}</dt><dd className="tabular">−{formatINR(inv.discount_paise)}</dd></div>}
          <div className="flex justify-between border-t border-line-strong pt-1 text-sm font-semibold"><dt>{t('billing.total')}</dt><dd className="tabular">{formatINR(inv.total_paise)}</dd></div>
          <div className="flex justify-between"><dt>{t('billing.paid')}</dt><dd className="tabular">{formatINR(inv.amount_paid_paise)}</dd></div>
          {inv.amount_refunded_paise > 0 && <div className="flex justify-between"><dt>{t('billing.refunded')}</dt><dd className="tabular">−{formatINR(inv.amount_refunded_paise)}</dd></div>}
          <div className="flex justify-between font-medium"><dt>{t('billing.balance')}</dt><dd className="tabular">{formatINR(inv.total_paise - inv.amount_paid_paise)}</dd></div>
        </dl>
        {inv.payments.length > 0 && (
          <p className="mt-4 text-xs text-ink-muted">
            {t('billing.payments')}:{' '}
            {inv.payments.map((p) => `${p.receipt_no ? `${p.receipt_no} · ` : ''}${t(`paymentMethod.${p.method}`)} ${formatINR(p.amount_paise)} (${formatDate(p.paid_at)})`).join('; ')}
          </p>
        )}
        {inv.refunds.length > 0 && (
          <p className="mt-1 text-xs text-ink-muted">
            {t('billing.refunds')}: {inv.refunds.map((r) => `${r.refund_no} · ${formatINR(r.amount_paise)} (${formatDate(r.refunded_at)})`).join('; ')}
          </p>
        )}
      </PrintableDocument>
    </div>
  );
}

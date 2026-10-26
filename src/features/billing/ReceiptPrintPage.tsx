import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ErrorState, FullPageSpinner } from '@/components/feedback/States';
import { PrintableDocument } from '@/components/data-display/PrintableDocument';
import { Button } from '@/components/ui/Button';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { toUserMessage } from '@/lib/errors';
import { formatDateTime, formatINR, fullName } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { getPayment } from '@/services/billing';

export function ReceiptPrintPage() {
  const { paymentId = '' } = useParams();
  const { t } = useI18n();
  const { clinicId, clinic } = useClinic();
  const q = useQuery({ queryKey: [clinicId, 'payment', paymentId], queryFn: () => getPayment(clinicId, paymentId) });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.isError || !q.data) return <ErrorState message={toUserMessage(q.error)} />;
  const p = q.data;
  return (
    <div className="min-h-dvh bg-ivory px-4 py-6 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end">
        <Button leftIcon={<Printer className="size-4" />} onClick={() => window.print()}>
          {t('common.print')}
        </Button>
      </div>
      <PrintableDocument clinic={clinic} title={t('billing.receipt')} meta={<span className="tabular">{p.receipt_no}</span>} footer={<p>{t('billing.thankYou')}</p>}>
        <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-muted">{t('billing.patient')}</dt>
          <dd className="font-medium">
            {fullName(p.patient)} <span className="tabular text-ink-muted">({p.patient?.patient_code})</span>
          </dd>
          <dt className="text-ink-muted">{t('billing.invoiceNo')}</dt>
          <dd className="tabular">{p.invoice?.invoice_no}</dd>
          <dt className="text-ink-muted">{t('billing.paidAt')}</dt>
          <dd className="tabular">{formatDateTime(p.paid_at)}</dd>
          <dt className="text-ink-muted">{t('billing.method')}</dt>
          <dd>{t(`paymentMethod.${p.method}`)}</dd>
          {p.reference && (
            <>
              <dt className="text-ink-muted">{t('billing.reference')}</dt>
              <dd className="tabular">{p.reference}</dd>
            </>
          )}
          <dt className="text-ink-muted">{t('billing.amountReceived')}</dt>
          <dd className="tabular font-display text-xl font-semibold">{formatINR(p.amount_paise)}</dd>
        </dl>
      </PrintableDocument>
    </div>
  );
}

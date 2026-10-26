import { StatusBadge } from '@/components/ui/Badge';
import { useI18n } from '@/locales/i18n';
import type { InvoiceStatus } from '@/types/domain';

/** "issued" means unpaid for invoices, so it gets a warning tone rather than the generic success tone. */
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useI18n();
  return <StatusBadge status={status} toneOverride={status === 'issued' ? 'danger' : undefined} label={t(`invoiceStatus.${status}`)} />;
}

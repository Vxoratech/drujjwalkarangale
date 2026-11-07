import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/i18n';

/** Route-level tabs between invoices and payment history. */
export function BillingTabs() {
  const { t } = useI18n();
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative inline-flex h-11 items-center px-3 text-sm font-medium transition-colors duration-fast',
      isActive ? 'text-forest-deep after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-forest' : 'text-ink-muted hover:text-ink',
    );
  return (
    <nav aria-label={t('nav.billing')} className="mb-4 flex gap-1 border-b border-line">
      <NavLink to="/billing" end className={link}>
        {t('billing.invoicesTab')}
      </NavLink>
      <NavLink to="/billing/payments" className={link}>
        {t('billing.payments')}
      </NavLink>
    </nav>
  );
}

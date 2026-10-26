import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/i18n';

/** Vaidyora mark: a stylised leaf/flame drawn with a single stroke. */
export function BrandMark({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill={inverted ? 'var(--color-gold)' : 'var(--color-forest-deep)'} />
      <path d="M16 7c-4 4-6 8-6 11a6 6 0 0 0 12 0c0-3-2-7-6-11z" fill="none" stroke={inverted ? 'var(--color-forest-deep)' : 'var(--color-gold)'} strokeWidth="1.8" />
      <path d="M16 12.5v12" stroke={inverted ? 'var(--color-forest-deep)' : 'var(--color-gold)'} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLockup({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  // The product name stays in Latin script as the registered brand; the byline is translated.
  const { t } = useI18n();
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark inverted={tone === 'light'} />
      <span className="leading-tight">
        <span className={cn('block font-display text-lg font-bold tracking-tight', tone === 'light' ? 'text-ink-inverse' : 'text-forest-deep')}>Vaidyora</span>
        <span className={cn('block text-[11px] font-medium', tone === 'light' ? 'text-gold' : 'text-gold-ink')}>{t('brand.byline')}</span>
      </span>
    </span>
  );
}

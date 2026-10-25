import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/ui/BrandMark';
import { useI18n } from '@/locales/i18n';

/** Split layout: calm brand panel + focused form column. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="grid min-h-dvh bg-ivory lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-forest-deep p-12 text-ink-inverse lg:flex lg:flex-col lg:justify-between">
        <BrandLockup tone="light" />
        <div className="relative z-[1] max-w-md">
          <p className="font-display text-4xl font-semibold leading-tight tracking-tight">{t('brand.tagline')}</p>
          <p className="mt-4 text-base text-sage/80">
            Patient records, Ashtavidha Pariksha, prescriptions and billing — designed for Ayurvedic practice in India.
          </p>
        </div>
        <p className="relative z-[1] text-xs text-sage/60">© {new Date().getFullYear()} Vxora Tech</p>
        {/* Subtle botanical line motif */}
        <svg aria-hidden viewBox="0 0 400 400" className="absolute -bottom-24 -right-24 size-[28rem] text-gold/15">
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M200 40c-70 70-105 140-105 192a105 105 0 0 0 210 0c0-52-35-122-105-192z" />
            <path d="M200 120v230" />
            <path d="M200 190c-25-10-45-28-58-52M200 240c30-8 52-26 66-52M200 290c-28-6-50-20-66-42" />
          </g>
        </svg>
      </aside>
      <main className="flex flex-col px-4 py-8 sm:px-8">
        <div className="flex items-center justify-between">
          <span className="lg:hidden">
            <BrandLockup />
          </span>
          <div className="ml-auto flex gap-1 text-sm" role="group" aria-label={t('common.language')}>
            {(['en', 'mr'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                onClick={() => setLocale(l)}
                className={locale === l ? 'rounded px-2 py-1 font-medium text-forest-deep underline underline-offset-4' : 'rounded px-2 py-1 text-ink-muted hover:text-ink'}
              >
                {l === 'en' ? 'English' : 'मराठी'}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

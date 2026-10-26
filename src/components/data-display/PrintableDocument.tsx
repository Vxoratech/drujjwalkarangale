import type { ReactNode } from 'react';
import { en } from '@/locales/en';
import { translate, useI18n } from '@/locales/i18n';
import { mr } from '@/locales/mr';
import type { Clinic, Locale } from '@/types/domain';

/**
 * A4 print layout with clinic letterhead. Screen view shows the same paper
 * on an ivory backdrop; @media print in index.css removes app chrome.
 */
/** `language` sets the document's own language (e.g. a Marathi prescription printed from an English UI). */
export function PrintableDocument({ clinic, title, meta, children, footer, language }: { clinic: Clinic; title: string; meta?: ReactNode; children: ReactNode; footer?: ReactNode; language?: Locale }) {
  const { locale } = useI18n();
  const dict = (language ?? locale) === 'mr' ? mr : en;
  const address = [clinic.address_line, clinic.city, clinic.state, clinic.pincode].filter(Boolean).join(', ');
  return (
    <article className="mx-auto w-full max-w-[210mm] rounded-lg border border-line bg-surface p-6 text-[13px] leading-relaxed text-ink shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-forest pb-4">
        <div>
          <p className="font-display text-xl font-bold text-forest-deep">{clinic.name}</p>
          {clinic.legal_name && <p className="text-xs text-ink-muted">{clinic.legal_name}</p>}
          {address && <p className="mt-1 max-w-sm text-xs text-ink-muted">{address}</p>}
          <p className="text-xs text-ink-muted">
            {[clinic.phone, clinic.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="text-right text-xs text-ink-muted">
          {clinic.registration_no && <p>{translate(dict, 'print.registrationNo')}: {clinic.registration_no}</p>}
          {clinic.gstin && <p>{translate(dict, 'settings.gstin')}: {clinic.gstin}</p>}
        </div>
      </header>
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-lg font-semibold uppercase tracking-wide text-forest-deep">{title}</h1>
        {meta && <div className="text-xs text-ink-muted">{meta}</div>}
      </div>
      <div className="mt-4">{children}</div>
      {footer && <footer className="mt-10 border-t border-line pt-4 text-xs text-ink-muted">{footer}</footer>}
      <p className="mt-6 text-center text-[10px] text-ink-subtle">{translate(dict, 'print.generatedWith')}</p>
    </article>
  );
}

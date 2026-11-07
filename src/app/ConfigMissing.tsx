import { Database } from 'lucide-react';
import { BrandLockup } from '@/components/ui/BrandMark';
import { useI18n } from '@/locales/i18n';

/** Shown when Supabase env vars are missing. The app never fakes a backend. */
export function ConfigMissing({ missing }: { missing: string[] }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ivory px-4 text-center">
      <BrandLockup />
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-8 text-left">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-warning-soft text-warning">
            <Database className="size-5" aria-hidden />
          </span>
          <h1 className="font-display text-xl font-semibold">{t('config.title')}</h1>
        </div>
        <p className="mt-4 text-sm text-ink-muted">{t('config.body')}</p>
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">{t('config.missing')}</p>
        <ul className="mt-1 list-inside list-disc text-sm">
          {missing.map((m) => (
            <li key={m}>
              <code className="rounded bg-ivory px-1 py-0.5 text-xs">{m}</code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { addDaysISO, formatTime, fullName, isoToIstParts, todayISO } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { STATUS_TONES } from '@/components/ui/Badge';
import type { AppointmentWithPatient } from '@/types/domain';

const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const toneBorder: Record<string, string> = {
  info: 'border-l-info',
  gold: 'border-l-gold-ink',
  forest: 'border-l-forest',
  success: 'border-l-success',
  warning: 'border-l-warning',
  neutral: 'border-l-line-strong',
  danger: 'border-l-danger',
};

/** Seven-day agenda: one column per day on wide screens, stacked days on mobile. */
export function WeekView({
  weekStart,
  appointments,
  doctorNames,
  onPickDay,
}: {
  weekStart: string;
  appointments: AppointmentWithPatient[];
  doctorNames?: Map<string, string>;
  onPickDay: (date: string) => void;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const byDay = new Map<string, AppointmentWithPatient[]>(days.map((d) => [d, []]));
  for (const a of appointments) byDay.get(isoToIstParts(a.starts_at).date)?.push(a);
  const localDay = (d: string) =>
    locale === 'mr' ? new Intl.DateTimeFormat('mr-IN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)) : dayName.format(new Date(`${d}T12:00:00Z`));

  return (
    <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-7 lg:divide-x lg:divide-y-0">
      {days.map((d) => {
        const items = byDay.get(d) ?? [];
        return (
          <section key={d} aria-label={d} className="min-w-0 p-3">
            <button
              type="button"
              onClick={() => onPickDay(d)}
              className={cn('mb-2 flex w-full items-baseline justify-between rounded px-1 text-left hover:bg-ivory', d === today && 'text-forest-deep')}
            >
              <span className="font-display text-sm font-semibold">{localDay(d)}</span>
              <span className={cn('tabular text-xs', d === today ? 'rounded bg-forest px-1.5 text-ink-inverse' : 'text-ink-muted')}>{d.slice(8, 10)}/{d.slice(5, 7)}</span>
            </button>
            {items.length === 0 ? (
              <p className="px-1 text-xs text-ink-subtle">{t('appointments.noneShort')}</p>
            ) : (
              <ul className="space-y-1.5">
                {items.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/appointments/${a.id}`}
                      className={cn('block rounded border border-line border-l-[3px] bg-surface px-2 py-1.5 text-xs hover:bg-ivory', toneBorder[STATUS_TONES[a.status] ?? 'neutral'], a.status === 'cancelled' && 'opacity-60 line-through')}
                    >
                      <span className="tabular block font-medium">{formatTime(a.starts_at)}</span>
                      <span className="block truncate">{fullName(a.patient)}</span>
                      {doctorNames && <span className="block truncate text-ink-muted">{doctorNames.get(a.doctor_id)}</span>}
                      <span className="block text-[11px] text-ink-muted">{t(`appointmentStatus.${a.status}`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

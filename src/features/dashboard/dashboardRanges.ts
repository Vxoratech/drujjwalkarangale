import { addDaysISO, formatDate, todayISO } from '@/lib/formatters';

export type RangeKey = '7' | '30' | '90';

export function rangeFor(key: RangeKey): { from: string; to: string; bucket: 'day' | 'week' } {
  const days = Number(key);
  const to = todayISO();
  return { from: addDaysISO(to, -(days - 1)), to, bucket: days > 31 ? 'week' : 'day' };
}

/** Axis label (DD/MM) and long label for a trend bucket. */
export function periodLabels(period: string, bucket: 'day' | 'week' | 'month', weekOf: string): { label: string; longLabel: string } {
  const full = formatDate(period);
  const short = full.slice(0, 5);
  return bucket === 'week' ? { label: short, longLabel: `${weekOf} ${full}` } : { label: short, longLabel: full };
}

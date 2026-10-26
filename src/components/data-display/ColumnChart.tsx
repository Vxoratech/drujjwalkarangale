import { useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/i18n';

export interface ColumnDatum {
  key: string;
  /** Axis label, e.g. "12/10". */
  label: string;
  /** Full label for tooltips and the table, e.g. "Week of 12/10/2026". */
  longLabel?: string;
  value: number;
}

export interface ColumnChartProps {
  title: string;
  data: ColumnDatum[];
  formatValue?: (v: number) => string;
  /** Compact tick formatter (defaults to 1K style). */
  formatTick?: (v: number) => string;
  height?: number;
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Single-series column chart. One hue (forest) on the card surface; thin
 * columns with a 4px rounded data end; hairline gridlines; tooltip on hover
 * and keyboard focus; only the peak is labeled; a table view is always available.
 */
export function ColumnChart({ title, data, formatValue = (v) => String(v), formatTick = (v) => compact.format(v), height = 160 }: ColumnChartProps) {
  const { t } = useI18n();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [0, max / 2, max];
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <figure className="min-w-0">
      <figcaption id={`${id}-title`} className="mb-3 text-sm font-medium text-ink">
        {title}
      </figcaption>
      <div className="flex gap-2">
        <div className="tabular flex flex-col justify-between pb-5 text-right text-[11px] text-ink-muted" style={{ height }} aria-hidden>
          {[...ticks].reverse().map((v) => (
            <span key={v}>{formatTick(v)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* Gridlines: hairline, recessive */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: height - 20 }} aria-hidden>
            {ticks.map((v) => (
              <span key={v} className="h-px w-full bg-line" />
            ))}
          </div>
          <ul role="list" aria-labelledby={`${id}-title`} className="relative flex items-end gap-0.5" style={{ height: height - 20 }} onMouseLeave={() => setActive(null)}>
            {data.map((d, i) => {
              const h = max > 0 ? Math.round((d.value / max) * (height - 20)) : 0;
              const text = `${d.longLabel ?? d.label}: ${formatValue(d.value)}`;
              return (
                <li key={d.key} className="relative flex h-full flex-1 items-end justify-center">
                  <button
                    type="button"
                    aria-label={text}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="group flex h-full w-full items-end justify-center rounded-sm focus-visible:outline-none"
                  >
                    <span
                      className={cn('block w-full max-w-[24px] rounded-t-[4px] transition-colors duration-fast', active === i ? 'bg-forest-deep' : 'bg-forest', 'group-focus-visible:shadow-focus')}
                      style={{ height: Math.max(d.value > 0 ? 2 : 0, h) }}
                    />
                  </button>
                  {i === peak && d.value > 0 && active === null && (
                    <span className="tabular pointer-events-none absolute whitespace-nowrap pb-1 text-[11px] font-medium text-ink" style={{ bottom: h }}>
                      {formatValue(d.value)}
                    </span>
                  )}
                  {active === i && (
                    <span role="status" className="tabular pointer-events-none absolute z-tooltip whitespace-nowrap rounded bg-forest-deep px-2 py-1 text-xs text-ink-inverse shadow-md" style={{ bottom: h + 6 }}>
                      {text}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex gap-0.5 pt-1" aria-hidden>
            {data.map((d, i) => (
              <span key={d.key} className="tabular flex-1 truncate text-center text-[11px] text-ink-muted">
                {i % labelEvery === 0 ? d.label : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">{t('reports.showTable')}</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{title}</caption>
          <tbody className="divide-y divide-line">
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row" className="tabular py-1 font-normal text-ink-muted">
                  {d.longLabel ?? d.label}
                </th>
                <td className="tabular py-1 text-right">{formatValue(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

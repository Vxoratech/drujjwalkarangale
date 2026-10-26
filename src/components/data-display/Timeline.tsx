import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TimelineItem {
  id: string;
  title: ReactNode;
  time: ReactNode;
  body?: ReactNode;
  icon?: ReactNode;
  tone?: 'forest' | 'gold' | 'neutral';
}

export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol aria-label={label} className="relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
      {items.map((item) => (
        <li key={item.id} className="relative flex gap-4">
          <span
            aria-hidden
            className={cn(
              'relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-surface [&>svg]:size-4',
              item.tone === 'gold' ? 'bg-gold-soft text-gold-ink' : item.tone === 'neutral' ? 'bg-ivory text-ink-muted' : 'bg-sage text-forest',
            )}
          >
            {item.icon}
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <div className="font-medium text-ink">{item.title}</div>
              <div className="tabular text-xs text-ink-muted">{item.time}</div>
            </div>
            {item.body && <div className="mt-1 text-sm text-ink-muted">{item.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

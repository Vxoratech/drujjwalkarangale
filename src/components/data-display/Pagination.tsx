import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { useI18n } from '@/locales/i18n';

export interface PaginationProps {
  page: number; // 1-based
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={t('common.pagination')} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-muted">
      <p className="tabular">{t('common.showing', { from, to, total })}</p>
      <div className="flex items-center gap-1">
        <IconButton size="sm" label={t('common.previous')} icon={<ChevronLeft />} disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
        <span className="tabular px-2" aria-live="polite">
          {t('common.page', { page, total: pages })}
        </span>
        <IconButton size="sm" label={t('common.next')} icon={<ChevronRight />} disabled={page >= pages} onClick={() => onPageChange(page + 1)} />
      </div>
    </nav>
  );
}

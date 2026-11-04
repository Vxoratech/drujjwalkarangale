import { Building2 } from 'lucide-react';
import { useAccess } from '@/features/access/AccessProvider';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/i18n';
import { Select } from './Input';

/**
 * "All branches / one branch" filter for dashboards and lists. Hidden for
 * users with a single branch. The server limits data to the user's branches
 * whatever is chosen here.
 */
export function BranchFilter({ className }: { className?: string }) {
  const { t } = useI18n();
  const { branches, branchFilter, setBranchFilter } = useAccess();
  if (branches.length < 2) return null;
  return (
    <label className={cn('relative block w-44', className)}>
      <span className="sr-only">{t('branches.filterLabel')}</span>
      <Building2 aria-hidden className="pointer-events-none absolute left-3 top-1/2 z-[1] size-4 -translate-y-1/2 text-ink-muted" />
      <Select
        className="pl-9"
        value={branchFilter ?? ''}
        onChange={(e) => setBranchFilter(e.target.value || null)}
        options={[{ value: '', label: t('branches.allBranches') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
      />
    </label>
  );
}

/** Branch choice for new records: the user's branches only. */
export function BranchSelect({ value, onChange, id, disabled }: { value: string; onChange: (id: string) => void; id?: string; disabled?: boolean }) {
  const { branches } = useAccess();
  return <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} options={branches.map((b) => ({ value: b.id, label: b.name }))} />;
}

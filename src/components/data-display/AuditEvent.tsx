import { FilePen, FilePlus2, FileX2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/formatters';
import type { AuditLog } from '@/types/domain';
import { useI18n } from '@/locales/i18n';

const ICONS = { insert: FilePlus2, update: FilePen, delete: FileX2 } as const;
const TONES = { insert: 'success', update: 'info', delete: 'danger' } as const;

export function humanizeEntity(entity: string): string {
  return entity.replace(/_/g, ' ').replace(/s$/, '').replace(/^\w/, (c) => c.toUpperCase());
}

export function humanizeField(field: string): string {
  return field.replace(/_paise$/, '').replace(/_id$/, '').replace(/_/g, ' ');
}

export function AuditEvent({ log, actorName }: { log: AuditLog; actorName: string }) {
  const { t } = useI18n();
  const Icon = ICONS[log.action];
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
      <div className="min-w-0 text-sm">
        <p>
          <span className="font-medium">{actorName}</span> <Badge tone={TONES[log.action]}>{t(`audit.${log.action}`)}</Badge>{' '}
          <span className="text-ink-muted">{humanizeEntity(log.entity_type)}</span>
        </p>
        {log.changed_fields.length > 0 && <p className="mt-0.5 text-xs text-ink-muted">{log.changed_fields.map(humanizeField).join(', ')}</p>}
        <p className="tabular mt-0.5 text-xs text-ink-subtle">{formatDateTime(log.created_at)}</p>
      </div>
    </div>
  );
}

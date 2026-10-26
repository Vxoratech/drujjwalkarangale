import { Eye, FilePen, FilePlus2, FileSearch, FileX2, KeyRound } from 'lucide-react';
import type { BadgeTone } from '@/components/ui/Badge';
import type { AuditAction } from '@/types/domain';

export const AUDIT_ICONS: Record<AuditAction, typeof FilePen> = {
  insert: FilePlus2,
  update: FilePen,
  delete: FileX2,
  view: Eye,
  access: FileSearch,
  security: KeyRound,
};

export const AUDIT_TONES: Record<AuditAction, BadgeTone> = {
  insert: 'success',
  update: 'info',
  delete: 'danger',
  view: 'neutral',
  access: 'gold',
  security: 'forest',
};

export function humanizeEntity(entity: string): string {
  return entity.replace(/_/g, ' ').replace(/s$/, '').replace(/^\w/, (c) => c.toUpperCase());
}

export function humanizeField(field: string): string {
  return field.replace(/_paise$/, '').replace(/_id$/, '').replace(/_/g, ' ');
}

/** Short, PHI-free description of audit metadata (statuses and roles only). */
export function describeMetadata(meta: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (typeof meta.status_from === 'string' || typeof meta.status_to === 'string') {
    parts.push(`${String(meta.status_from ?? '—').replace(/_/g, ' ')} → ${String(meta.status_to ?? '—').replace(/_/g, ' ')}`);
  }
  if (Array.isArray(meta.roles_after)) {
    parts.push(`roles: ${Array.isArray(meta.roles_before) ? meta.roles_before.join(', ') + ' → ' : ''}${meta.roles_after.join(', ')}`);
  }
  if (typeof meta.revision_number === 'number' && meta.revision_number > 1) parts.push(`revision ${meta.revision_number}`);
  return parts.length ? parts.join(' · ') : null;
}

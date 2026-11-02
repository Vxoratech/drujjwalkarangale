import { getSupabase } from '@/lib/supabase/client';
import type { AuditEvent, UUID } from '@/types/domain';
import { unwrapPage } from './_helpers';

/** Audit events for a clinic, newest first (RLS: `audit.read`). Read-only; events are written server-side. */
export async function listAuditEvents(clinicId: UUID, params: { page: number; pageSize: number; entityType?: string; action?: string }) {
  let q = getSupabase().from('audit_events').select('*', { count: 'exact' }).eq('clinic_id', clinicId);
  if (params.entityType) q = q.eq('entity_type', params.entityType);
  if (params.action) q = q.eq('action', params.action);
  const from = (params.page - 1) * params.pageSize;
  return unwrapPage<AuditEvent>(await q.order('created_at', { ascending: false }).range(from, from + params.pageSize - 1));
}


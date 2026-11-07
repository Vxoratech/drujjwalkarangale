import { getSupabase } from '@/lib/supabase/client';
import type { AuditEvent, UUID } from '@/types/domain';
import { unwrapPage } from './_helpers';

/** Audit events, newest first (RLS: `audit.view`, branch-scoped for staff). Read-only; events are written server-side. */
export async function listAuditEvents(params: { page: number; pageSize: number; entityType?: string; action?: string; branchId?: UUID | null }) {
  let q = getSupabase().from('audit_events').select('*', { count: 'exact' });
  if (params.branchId) q = q.eq('branch_id', params.branchId);
  if (params.entityType) q = q.eq('entity_type', params.entityType);
  if (params.action) q = q.eq('action', params.action);
  const from = (params.page - 1) * params.pageSize;
  return unwrapPage<AuditEvent>(await q.order('created_at', { ascending: false }).range(from, from + params.pageSize - 1));
}


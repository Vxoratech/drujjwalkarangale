import { getSupabase } from '@/lib/supabase/client';
import type { AppointmentStatus, AuditEvent, AppNotification, DashboardSummary, DateString, Paise, PaymentMethod, RevenueRow, UUID } from '@/types/domain';
import { unwrap, unwrapPage } from './_helpers';

export async function fetchDashboardSummary(clinicId: UUID): Promise<DashboardSummary> {
  return unwrap<DashboardSummary>(await getSupabase().rpc('dashboard_summary', { p_clinic: clinicId }));
}

export async function fetchRevenueReport(clinicId: UUID, from: DateString, to: DateString): Promise<RevenueRow[]> {
  const rows = unwrap<RevenueRow[]>(await getSupabase().rpc('revenue_report', { p_clinic: clinicId, p_from: from, p_to: to }));
  return rows.map((r) => ({
    ...r,
    invoiced_paise: Number(r.invoiced_paise),
    collected_paise: Number(r.collected_paise),
    refunded_paise: Number(r.refunded_paise),
    invoice_count: Number(r.invoice_count),
  }));
}

export async function fetchPaymentMethodReport(clinicId: UUID, from: DateString, to: DateString): Promise<{ method: PaymentMethod; total_paise: Paise; payment_count: number }[]> {
  const rows = unwrap<{ method: PaymentMethod; total_paise: Paise; payment_count: number }[]>(
    await getSupabase().rpc('payment_method_report', { p_clinic: clinicId, p_from: from, p_to: to }),
  );
  return rows.map((r) => ({ ...r, total_paise: Number(r.total_paise), payment_count: Number(r.payment_count) }));
}

export async function fetchAppointmentStatusReport(clinicId: UUID, from: DateString, to: DateString): Promise<{ status: AppointmentStatus; appointment_count: number }[]> {
  const rows = unwrap<{ status: AppointmentStatus; appointment_count: number }[]>(
    await getSupabase().rpc('appointment_status_report', { p_clinic: clinicId, p_from: from, p_to: to }),
  );
  return rows.map((r) => ({ ...r, appointment_count: Number(r.appointment_count) }));
}

export async function listAuditEvents(clinicId: UUID, params: { page: number; pageSize: number; entityType?: string; action?: string }) {
  let q = getSupabase().from('audit_events').select('*', { count: 'exact' }).eq('clinic_id', clinicId);
  if (params.entityType) q = q.eq('entity_type', params.entityType);
  if (params.action) q = q.eq('action', params.action);
  const from = (params.page - 1) * params.pageSize;
  return unwrapPage<AuditEvent>(await q.order('created_at', { ascending: false }).range(from, from + params.pageSize - 1));
}

export async function listNotifications(clinicId: UUID): Promise<AppNotification[]> {
  return unwrap<AppNotification[]>(
    await getSupabase().from('notifications').select('id, clinic_id, kind, title, link, read_at, created_at').eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(20),
  );
}

export async function markNotificationsRead(ids: UUID[]): Promise<void> {
  if (ids.length === 0) return;
  unwrap(await getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).select('id'));
}
